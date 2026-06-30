/**
 * @fileoverview WebSocket + 정적 파일 서버. LAN 환경에서 2인 1룸 협력 듀엣을 중계한다.
 *
 * 아키텍처: 서버 권위 게임 상태
 * - 게임 로직(클릭 판정, 토큰 차감 등)은 모두 서버에서 처리
 * - 클라이언트는 입력을 보내고, 서버는 매 상태 변경마다 양쪽에 스냅샷 브로드캐스트
 * - 의존성 최소화: Node 내장 http + ws (Express 사용 안 함)
 *
 * 통합 라우터 지원:
 *   - `createApp()`을 export하여 launcher가 단일 포트(3000)에서 라우팅할 수 있게 한다.
 *   - 단독 실행 (`node server.js [--port N]`)도 그대로 지원.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { createGame, submitClue, guessCard, passTurn, snapshotForPlayer } from './game.js';

// ── 경로 + 설정 ───────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');

// ── 정적 파일 서빙 (public/) ─────────────────────────────────────
/** MIME 매핑 (기본 확장자만). */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

/**
 * 코드네임 듀엣 게임 앱 인스턴스를 생성한다.
 * 모든 룸 상태(players/game)는 closure로 격리되어 다른 게임과 공유되지 않는다.
 *
 * @returns {{ handleHttp: Function, handleUpgrade: Function }}
 */
export function createApp() {
  // ── 룸 상태 (closure 격리, 2인 1룸 고정) ─────────────────────────
  /**
   * @typedef {Object} Player
   * @property {string} id      - 'p1' | 'p2'
   * @property {string} name
   * @property {boolean} joined  - JOIN 메시지 수신 여부
   * @property {import('ws').WebSocket} ws
   */

  /** @type {Player[]} */
  let players = [];
  /** @type {import('./game.js').GameState|null} */
  let game = null;
  /** READY 게이트: 양쪽 모두 들어있으면 게임 시작 (omok 패턴). */
  const readySet = new Set();

  /**
   * 모든 플레이어에게 각자의 시점 스냅샷을 브로드캐스트한다.
   * (자기 시점의 키 카드만 보이도록 분리 전송)
   */
  function broadcastState() {
    if (!game) return;
    for (const p of players) {
      if (p.ws.readyState === 1) {
        p.ws.send(JSON.stringify(snapshotForPlayer(game, p.id)));
      }
    }
  }

  /**
   * 각 플레이어에게 본인 기준 READY 상태를 개별 전송한다 (omok 패턴).
   */
  function broadcastReadyState() {
    for (const p of players) {
      if (p.ws.readyState !== 1) continue;
      const opp = players.find((q) => q.id !== p.id);
      sendTo(p, {
        type: 'READY_STATE',
        myReady: readySet.has(p.id),
        opponentReady: opp ? readySet.has(opp.id) : false,
      });
    }
  }

  /**
   * 양쪽 READY + JOIN 완료 시 게임을 시작한다 (READY 게이트).
   */
  function maybeStartGameIfReady() {
    if (players.length < 2) return;
    if (!players.every((p) => p.joined)) return;
    if (!players.every((p) => readySet.has(p.id))) return;
    if (game) return;
    console.log('[codenames] 양쪽 READY → 새 게임 시작');
    game = createGame('p1');
    readySet.clear();
    broadcastAll({ type: 'GAME_START' });
    broadcastState();
  }

  /**
   * 모든 플레이어에게 임의 페이로드를 브로드캐스트한다.
   * @param {object} payload
   */
  function broadcastAll(payload) {
    const msg = JSON.stringify(payload);
    for (const p of players) {
      if (p.ws.readyState === 1) p.ws.send(msg);
    }
  }

  /**
   * 특정 플레이어에게 단일 메시지를 보낸다.
   * @param {Player} player
   * @param {object} payload
   */
  function sendTo(player, payload) {
    if (player && player.ws.readyState === 1) {
      player.ws.send(JSON.stringify(payload));
    }
  }

  /**
   * 게임 종료 페이로드를 만든다.
   * 복기 모드를 위해 양쪽 시점 전체 키 카드(keyCardP1/p2)와 보드 단어를 함께 보낸다.
   * (게임이 끝났으므로 양쪽 정보를 공개해도 안전하다.)
   * @param {'won'|'lost'} outcome
   * @param {string} [reason]
   * @returns {object}
   */
  function buildGameEndPayload(outcome, reason) {
    /** @type {object} */
    const payload = { type: 'GAME_END', outcome };
    if (reason !== undefined) payload.reason = reason;
    if (game) {
      // p1 시점 색상 = keyCard[i].left, p2 시점 색상 = keyCard[i].right
      payload.review = {
        words: game.words.slice(),
        keyCardP1: game.keyCard.map((c) => c.left),
        keyCardP2: game.keyCard.map((c) => c.right),
        revealed: game.revealed.slice(),
        greenFound: { p1: game.greenFound.p1, p2: game.greenFound.p2 },
        tokensLeft: game.tokens,
      };
    }
    return payload;
  }

  // ── WebSocket 서버 (noServer 모드) ─────────────────────────────
  const wss = new WebSocketServer({ noServer: true });

  // ── WebSocket 핸들러 ──────────────────────────────────────────────
  wss.on('connection', (ws) => {
    // 정원 초과 직전, 좀비 슬롯(끊겼지만 close 이벤트 미발화) 즉시 청소 시도
    if (players.length >= 2) {
      const before = players.length;
      players = players.filter((p) => p.ws.readyState <= 1);
      if (players.length < before) {
        console.log(`[codenames] 좀비 슬롯 ${before - players.length}개 청소`);
        if (players.length === 0) game = null;
      }
    }

    // 룸 정원 초과 시 즉시 거절
    if (players.length >= 2) {
      ws.send(JSON.stringify({ type: 'ERROR', message: '방이 가득 찼다 (2/2)' }));
      ws.close();
      console.log('[codenames] 연결 거절: 룸 정원 초과');
      return;
    }

    // Heartbeat 상태 초기화
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    // 비어있는 슬롯 ID에 할당 — players.length 기반은 재접속 시 ID 충돌 발생 (P0-B fix)
    const usedIds = new Set(players.map((p) => p.id));
    const playerId = ['p1', 'p2'].find((id) => !usedIds.has(id)) || 'p1';
    /** @type {Player} */
    const player = { id: playerId, name: '(알 수 없음)', joined: false, ws };
    players.push(player);
    console.log(`[codenames] ${playerId} 연결됨 (${players.length}/2)`);

    // JOIN 메시지를 기다린다 (READY 게이트 패턴 — omok 파일럿).

    // ── 메시지 라우터 ──
    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch (e) {
        console.warn('[codenames] JSON 파싱 실패:', data.toString());
        return;
      }

      // JSON.parse('null')은 null, 'true'/'0' 등은 원시값으로 정상 파싱된다.
      // 그 후 msg.type 접근 시 TypeError로 서버 프로세스가 죽으므로 객체+type 검증을 거친다. (P0-A fix)
      if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.type !== 'string') {
        try {
          sendTo(player, { type: 'ERROR', message: '잘못된 메시지 형식입니다.' });
        } catch (e) { /* 송신 실패는 무시 */ }
        return;
      }

      switch (msg.type) {
        case 'JOIN': {
          player.name = (msg.name || '(알 수 없음)').toString().slice(0, 32);
          player.joined = true;
          const opp = players.find((p) => p.id !== player.id && p.joined);
          sendTo(player, {
            type: 'JOINED',
            playerId: player.id,
            waiting: players.length < 2 || !opp,
            opponentName: opp ? opp.name : '',
          });
          // 상대에게 내 이름 알림 — 상대가 이미 입장한 경우 JOINED 재전송
          if (opp) {
            sendTo(opp, {
              type: 'JOINED',
              playerId: opp.id,
              waiting: false,
              opponentName: player.name,
            });
          }
          broadcastReadyState();
          break;
        }

        case 'READY': {
          if (!player.joined) break;
          readySet.add(player.id);
          broadcastReadyState();
          maybeStartGameIfReady();
          break;
        }

        case 'CLUE': {
          if (!game) break;
          const result = submitClue(game, player.id, msg.word, msg.number);
          if (!result.ok) {
            sendTo(player, { type: 'ERROR', message: result.error });
            break;
          }
          console.log(`[codenames] CLUE: ${player.id} → "${msg.word}" ${msg.number}`);
          broadcastState();
          break;
        }

        case 'GUESS': {
          if (!game) break;
          const result = guessCard(game, player.id, msg.index);
          if (!result.ok) {
            sendTo(player, { type: 'ERROR', message: result.error });
            break;
          }
          console.log(`[codenames] GUESS: ${player.id} → 카드 ${msg.index} = ${result.result}`);
          broadcastState();
          if (result.win) {
            broadcastAll(buildGameEndPayload('won'));
          } else if (result.lose) {
            broadcastAll(buildGameEndPayload('lost', game.lostReason));
          }
          break;
        }

        case 'PASS': {
          if (!game) break;
          const result = passTurn(game, player.id);
          if (!result.ok) {
            sendTo(player, { type: 'ERROR', message: result.error });
            break;
          }
          console.log(`[codenames] PASS: ${player.id}`);
          broadcastState();
          if (result.lose) {
            broadcastAll(buildGameEndPayload('lost', game.lostReason));
          }
          break;
        }

        case 'NEW_GAME': {
          if (players.length < 2) {
            sendTo(player, { type: 'ERROR', message: '상대방이 없어 새 게임을 시작할 수 없다' });
            break;
          }
          const requestedTokens = parseInt(msg.tokens, 10);
          game = createGame('p1', Number.isInteger(requestedTokens) ? requestedTokens : undefined);
          console.log(`[codenames] NEW_GAME 요청 → 새 게임 시작 (토큰: ${game.tokens})`);
          broadcastAll({ type: 'GAME_START' });
          broadcastState();
          break;
        }

        default:
          console.warn(`[codenames] 알 수 없는 메시지 타입: ${msg.type}`);
      }
    });

    // ── 연결 해제 ──
    ws.on('close', () => {
      console.log(`[codenames] ${player.id} 연결 해제`);
      players = players.filter((p) => p.id !== player.id);
      readySet.delete(player.id);
      if (players.length === 0) {
        game = null;
        readySet.clear();
      } else {
        broadcastAll({
          type: 'OPPONENT_LEFT',
          message: '상대방이 나갔다. 새 친구가 접속하면 게임이 재시작된다.',
        });
        game = null; // 1명 남으면 게임 무효화 → 두 번째 접속 시 새 게임 시작
        readySet.clear();
      }
    });

    ws.on('error', (err) => {
      console.error(`[codenames] ${player.id} WS 에러:`, err.message);
    });
  });

  // ── Heartbeat: 30초마다 ping, 응답 없는 좀비 연결 강제 종료 ────────
  const HEARTBEAT_INTERVAL_MS = 30000;
  const heartbeatTimer = setInterval(() => {
    for (const p of [...players]) {
      if (p.ws.isAlive === false) {
        console.log(`[codenames] ${p.id} heartbeat 응답 없음 → 강제 종료`);
        p.ws.terminate();
        continue;
      }
      p.ws.isAlive = false;
      try { p.ws.ping(); } catch (e) { /* ws 이미 닫힘 — 다음 사이클에 정리됨 */ }
    }
  }, HEARTBEAT_INTERVAL_MS);

  wss.on('close', () => { clearInterval(heartbeatTimer); });

  // ── HTTP 핸들러 (정적 파일 서빙) ──────────────────────────────
  /**
   * 정적 파일 응답 핸들러. public/ 외 경로는 차단한다 (디렉토리 탈출 방지).
   * @param {http.IncomingMessage} req
   * @param {http.ServerResponse} res
   */
  function handleHttp(req, res) {
    const reqUrl = req.url || '/';
    const reqPath = reqUrl.split('?')[0] || '/';
    const urlPath = (reqPath === '/' || reqPath === '') ? '/index.html' : reqPath;
    const safePath = path.normalize(urlPath).replace(/^([\\/])+/, '');
    const fullPath = path.join(PUBLIC_DIR, safePath);
    // 디렉토리 탈출 방어: public/ 바깥 경로 거절
    if (!fullPath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    fs.readFile(fullPath, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }
      const ext = path.extname(fullPath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(data);
    });
  }

  /**
   * HTTP upgrade 이벤트를 WS로 전달한다 (noServer 모드).
   * @param {http.IncomingMessage} req
   * @param {import('net').Socket} socket
   * @param {Buffer} head
   */
  function handleUpgrade(req, socket, head) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  }

  return { handleHttp, handleUpgrade };
}

// ──────────────────────────────────────────────────────────────
// 단독 실행 모드: `node server.js [--port N]`
// ──────────────────────────────────────────────────────────────

/**
 * 현재 모듈이 직접 실행되었는지 (vs launcher가 import) 판정한다.
 * 윈도우 경로 구분자 차이를 흡수.
 * @returns {boolean}
 */
function isDirectExecution() {
  if (!process.argv[1]) return false;
  const argvPath = process.argv[1].replace(/\\/g, '/');
  const metaPath = import.meta.url.replace('file:///', '').replace('file://', '');
  return metaPath === argvPath || metaPath.endsWith(argvPath);
}

if (isDirectExecution()) {
  const argv = process.argv.slice(2);
  const portFlagIndex = argv.indexOf('--port');
  const PORT = portFlagIndex >= 0 && argv[portFlagIndex + 1]
    ? parseInt(argv[portFlagIndex + 1], 10)
    : 3001;

  const app = createApp();
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);

  // ── 호스트 IP 자동 감지 ──────────────────────────────────────────
  const VIRTUAL_IF_PATTERNS = [
    /vEthernet/i, /VirtualBox/i, /VMware/i, /Hyper-?V/i, /WSL/i, /Loopback Pseudo/i,
  ];

  function isVirtualInterface(name) {
    return VIRTUAL_IF_PATTERNS.some((re) => re.test(name));
  }

  function interfacePriority(name) {
    if (isVirtualInterface(name)) return 9;
    if (/wi-?fi|wireless|wlan|wlp/i.test(name)) return 0;
    if (/ethernet|이더넷|eth\d|enp/i.test(name)) return 1;
    return 2;
  }

  function getLanAddresses() {
    const nets = os.networkInterfaces();
    const results = [];
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        if (net.family === 'IPv4' && !net.internal) {
          results.push({ ip: net.address, ifname: name, virtual: isVirtualInterface(name) });
        }
      }
    }
    results.sort((a, b) => interfacePriority(a.ifname) - interfacePriority(b.ifname));
    return results;
  }

  // ── 콘솔 배너 ────────────────────────────────────────────────────
  function supportsAnsi() {
    if (process.env.NO_COLOR) return false;
    if (process.env.TERM === 'dumb') return false;
    if (!process.stdout || !process.stdout.isTTY) return false;
    return true;
  }

  const ANSI = supportsAnsi()
    ? { reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m', magenta: '\x1b[35m' }
    : { reset: '', bold: '', dim: '', cyan: '', green: '', yellow: '', magenta: '' };

  function padBoxLine(text, width) {
    const visible = text.replace(/\x1b\[[0-9;]*m/g, '');
    const padLen = Math.max(0, width - visible.length);
    return text + ' '.repeat(padLen);
  }

  function printBanner(port, lanIps) {
    const W = 60;
    const top   = `+${'-'.repeat(W)}+`;
    const sep   = `+${'-'.repeat(W)}+`;
    const empty = `|${' '.repeat(W)}|`;
    const line  = (s) => `|${padBoxLine(s, W)}|`;

    console.log('');
    console.log(ANSI.cyan + top + ANSI.reset);
    console.log(ANSI.cyan + line(`  ${ANSI.bold}CODENAMES DUET${ANSI.reset}${ANSI.cyan} - LAN 1:1 협력 플레이`) + ANSI.reset);
    console.log(ANSI.cyan + sep + ANSI.reset);
    console.log(ANSI.cyan + line(`  ${ANSI.yellow}호스트 PC 접속:${ANSI.reset}`) + ANSI.reset);
    console.log(ANSI.cyan + line(`    ${ANSI.green}http://localhost:${port}${ANSI.reset}`) + ANSI.reset);
    console.log(ANSI.cyan + empty + ANSI.reset);
    console.log(ANSI.cyan + line(`  ${ANSI.yellow}친구 PC 접속:${ANSI.reset}`) + ANSI.reset);
    if (lanIps.length > 0) {
      for (const entry of lanIps) {
        const tag = entry.virtual ? ANSI.dim + ' (가상)' + ANSI.reset : '';
        console.log(ANSI.cyan + line(`    ${ANSI.green}http://${entry.ip}:${port}${ANSI.reset}${tag}`) + ANSI.reset);
      }
    } else {
      console.log(ANSI.cyan + line(`    ${ANSI.dim}(LAN IP 미감지 — ipconfig로 확인)${ANSI.reset}`) + ANSI.reset);
    }
    console.log(ANSI.cyan + empty + ANSI.reset);
    console.log(ANSI.cyan + line(`  ${ANSI.dim}종료: Ctrl+C${ANSI.reset}`) + ANSI.reset);
    console.log(ANSI.cyan + top + ANSI.reset);
    console.log('');
  }

  // ── 서버 시작 ────────────────────────────────────────────────────
  server.on('error', (err) => {
    console.error('[codenames] HTTP 에러:', err.message);
    process.exit(1);
  });

  // LAN 접속을 허용하기 위해 0.0.0.0에 바인딩
  server.listen(PORT, '0.0.0.0', () => {
    const lanIps = getLanAddresses();
    printBanner(PORT, lanIps);
    console.log(ANSI.dim
      + ' Tip: 처음 실행 시 Windows Defender 방화벽 팝업이 뜨면 "개인 네트워크"에 체크 후 액세스 허용.'
      + ANSI.reset);
    console.log('');
  });
}
