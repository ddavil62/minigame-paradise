/**
 * @fileoverview 하나비(Hanabi) WebSocket + 정적 파일 서버.
 *
 * 아키텍처: **서버 권위(Server Authoritative)**
 * - 모든 게임 판정(힌트/내기/버리기/종료)은 game.js 순수 함수로 서버에서만 처리한다.
 * - 정보 비대칭(손패 가림, §1)을 서버가 강제 보장한다: 매 액션 후 각 플레이어에게
 *   snapshotForPlayer()로 마스킹된 STATE를 개별 전송하여 본인 손패 색·숫자를 누설하지 않는다(§12-6).
 * - 의존성 최소화: Node 내장 http + ws (Express 미사용 — codenames-duet 패턴 차용).
 *
 * 통합 라우터 지원:
 *   - createApp()을 export하여 launcher가 단일 포트(3000)에서 라우팅한다.
 *   - 단독 실행(`node server.js [--port N]`)도 지원하며 포트 충돌 시 자동 폴백(yutnori 패턴).
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import {
  createGame,
  giveClue,
  playCard,
  discardCard,
  snapshotForPlayer,
} from './game.js';

// ── 경로 + 설정 ───────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');

/** MIME 매핑 (정적 파일 서빙용). */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.png':  'image/png',   // 가이드 인포그래픽(public/assets/guide/*.png) 서빙용
  '.jpg':  'image/jpeg',  // 향후 확장 대비
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

/**
 * 하나비 게임 앱 인스턴스를 생성한다.
 * 모든 룸 상태(players/game)는 closure로 격리되어 다른 게임과 공유되지 않는다.
 *
 * @param {{ hostUrl?: string }} [opts]
 * @returns {{ handleHttp: Function, handleUpgrade: Function, setHostUrl: Function }}
 */
export function createApp(opts = {}) {
  // closure 변수: standalone listen 이후 setHostUrl로 갱신 가능.
  let HOST_URL = typeof opts.hostUrl === 'string' ? opts.hostUrl : '';

  // ── 룸 상태 (closure 격리, 2인 1룸 고정 — §13-2) ─────────────────
  /**
   * @typedef {Object} Player
   * @property {string} id   'p1' | 'p2'
   * @property {string} name
   * @property {boolean} joined JOIN 메시지 수신 여부
   * @property {boolean} rematchReady
   * @property {import('ws').WebSocket} ws
   */

  /** @type {Player[]} */
  let players = [];
  /** @type {import('./game.js').GameState|null} */
  let game = null;
  /** READY 게이트: 양쪽 모두 들어있으면 게임 시작 (omok 패턴). */
  const readySet = new Set();

  /**
   * 모든 플레이어에게 각자의 마스킹된 STATE 스냅샷을 개별 전송한다(§12-6).
   * 공통 payload broadcast가 아닌 플레이어별 마스킹 전송이 손패 가림의 핵심이다.
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
   * 모든 플레이어에게 임의 페이로드를 broadcast 한다.
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
   * 게임이 종료됐으면 GAME_OVER를 broadcast 한다(§9, §10).
   * @returns {boolean} 종료됐으면 true
   */
  function maybeBroadcastGameOver() {
    if (game && game.phase === 'ended') {
      broadcastAll({ type: 'GAME_OVER', result: game.result });
      return true;
    }
    return false;
  }

  /**
   * 각 플레이어에게 본인 기준 READY 상태를 개별 전송한다(omok 패턴).
   */
  function broadcastReadyState() {
    for (const p of players) {
      if (p.ws.readyState !== 1) continue;
      const opp = players.find(q => q.id !== p.id);
      sendTo(p, {
        type: 'READY_STATE',
        myReady: readySet.has(p.id),
        opponentReady: opp ? readySet.has(opp.id) : false,
      });
    }
  }

  /**
   * 양쪽 READY 시 게임을 시작한다(READY 게이트).
   */
  function maybeStartGameIfReady() {
    if (players.length < 2) return;
    if (!players.every(p => p.joined)) return;
    if (!players.every(p => readySet.has(p.id))) return;
    if (game) return; // 이미 시작
    console.log('[hanabi] 양쪽 READY → 새 게임 시작');
    startNewGame();
  }

  /**
   * 새 게임을 시작하고 START + STATE를 전송한다.
   */
  function startNewGame() {
    game = createGame();
    readySet.clear();
    for (const p of players) p.rematchReady = false;
    broadcastAll({ type: 'START' });
    broadcastState();
  }

  // ── WebSocket 서버 (noServer 모드) ─────────────────────────────
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws) => {
    // 정원 초과 직전, 좀비 슬롯(끊겼지만 close 미발화) 청소 시도.
    if (players.length >= 2) {
      const before = players.length;
      players = players.filter((p) => p.ws.readyState <= 1);
      if (players.length < before) {
        console.log(`[hanabi] 좀비 슬롯 ${before - players.length}개 청소`);
        if (players.length === 0) game = null;
      }
    }

    // 룸 정원 초과 시 즉시 거절.
    if (players.length >= 2) {
      ws.send(JSON.stringify({ type: 'ERROR', message: '방이 가득 찼다 (2/2)' }));
      ws.close();
      console.log('[hanabi] 연결 거절: 룸 정원 초과');
      return;
    }

    // Heartbeat 상태 초기화.
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    const playerId = players.length === 0 ? 'p1' : 'p2';
    /** @type {Player} */
    const player = { id: playerId, name: playerId, joined: false, rematchReady: false, ws };
    players.push(player);
    console.log(`[hanabi] ${playerId} 연결됨 (${players.length}/2)`);

    // ── 메시지 라우터 ──
    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch (e) {
        console.warn('[hanabi] JSON 파싱 실패:', data.toString());
        return;
      }

      switch (msg.type) {
        case 'JOIN': {
          player.name = (msg.name || msg.playerName || '(알 수 없음)').toString().slice(0, 32);
          player.joined = true;
          const opp = players.find(p => p.id !== player.id && p.joined);
          sendTo(player, {
            type: 'JOINED',
            playerId: player.id,
            waiting: players.length < 2 || !opp,
            hostUrl: HOST_URL,
            opponentName: opp ? opp.name : '',
          });
          // 상대에게 내 이름을 알린다 — 상대가 이미 입장한 경우 JOINED를 다시 보낸다.
          if (opp) {
            sendTo(opp, {
              type: 'JOINED',
              playerId: opp.id,
              waiting: false,
              hostUrl: HOST_URL,
              opponentName: player.name,
            });
          }
          // READY 상태 전송 (JOIN 직후 양쪽에 현재 READY 상태 알림).
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

        case 'GIVE_CLUE': {
          if (!game) break;
          // §5-3: 2인 고정 — 힌트 대상은 항상 상대(서버가 자동 판정).
          const target = player.id === 'p1' ? 'p2' : 'p1';
          const result = giveClue(game, player.id, target, msg.clueType, msg.value);
          if (!result.ok) {
            sendTo(player, { type: 'ERROR', message: result.error });
            break;
          }
          console.log(`[hanabi] GIVE_CLUE: ${player.id} → ${msg.clueType}=${msg.value} (${result.touchedIndices.length}장)`);
          broadcastState();
          maybeBroadcastGameOver();
          break;
        }

        case 'PLAY_CARD': {
          if (!game) break;
          const result = playCard(game, player.id, msg.handIndex);
          if (!result.ok) {
            sendTo(player, { type: 'ERROR', message: result.error });
            break;
          }
          console.log(`[hanabi] PLAY_CARD: ${player.id} → idx ${msg.handIndex} (${result.success ? '성공' : '오연주'})`);
          broadcastState();
          maybeBroadcastGameOver();
          break;
        }

        case 'DISCARD_CARD': {
          if (!game) break;
          const result = discardCard(game, player.id, msg.handIndex);
          if (!result.ok) {
            sendTo(player, { type: 'ERROR', message: result.error });
            break;
          }
          console.log(`[hanabi] DISCARD_CARD: ${player.id} → idx ${msg.handIndex}`);
          broadcastState();
          maybeBroadcastGameOver();
          break;
        }

        case 'REMATCH': {
          if (players.length < 2) {
            sendTo(player, { type: 'ERROR', message: '상대방이 없어 새 게임을 시작할 수 없습니다.' });
            break;
          }
          player.rematchReady = true;
          broadcastAll({
            type: 'REMATCH_STATUS',
            p1Ready: players.find((p) => p.id === 'p1')?.rematchReady || false,
            p2Ready: players.find((p) => p.id === 'p2')?.rematchReady || false,
          });
          if (players.every((p) => p.rematchReady)) {
            console.log('[hanabi] 양쪽 REMATCH → 새 게임');
            startNewGame();
          }
          break;
        }

        default:
          console.warn(`[hanabi] 알 수 없는 메시지 타입: ${msg.type}`);
      }
    });

    // ── 연결 해제 ──
    ws.on('close', () => {
      console.log(`[hanabi] ${player.id} 연결 해제`);
      const leftName = player.name || '(알 수 없음)';
      readySet.delete(player.id);
      players = players.filter((p) => p.id !== player.id);
      if (players.length === 0) {
        game = null;
        readySet.clear();
      } else {
        broadcastAll({
          type: 'OPPONENT_LEFT',
          name: leftName,
          message: `${leftName}님이 나갔습니다.`,
        });
        game = null; // 1명 남으면 게임 무효화 -> 두 번째 접속 시 새 게임 시작.
      }
    });

    ws.on('error', (err) => {
      console.error(`[hanabi] ${player.id} WS 에러:`, err.message);
    });
  });

  // ── Heartbeat: 30초마다 ping, 응답 없는 좀비 연결 강제 종료 ────────
  const HEARTBEAT_INTERVAL_MS = 30000;
  const heartbeatTimer = setInterval(() => {
    for (const p of [...players]) {
      if (p.ws.isAlive === false) {
        console.log(`[hanabi] ${p.id} heartbeat 응답 없음 → 강제 종료`);
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
   * 정적 파일 응답 핸들러. public/ 외 경로는 차단한다(디렉토리 탈출 방지).
   * launcher가 path prefix를 제거한 req.url을 전달한다(예: '/css/style.css').
   * Phase 3에서 public/이 채워지기 전까지는 404를 반환할 수 있다(서버 동작에는 영향 없음).
   * @param {http.IncomingMessage} req
   * @param {http.ServerResponse} res
   */
  function handleHttp(req, res) {
    const reqUrl = req.url || '/';
    const reqPath = reqUrl.split('?')[0] || '/';
    const urlPath = (reqPath === '/' || reqPath === '') ? '/index.html' : reqPath;
    const safePath = path.normalize(urlPath).replace(/^([\\/])+/, '');
    const fullPath = path.join(PUBLIC_DIR, safePath);
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
   * HTTP upgrade 이벤트를 WS로 전달한다(noServer 모드).
   * @param {http.IncomingMessage} req
   * @param {import('net').Socket} socket
   * @param {Buffer} head
   */
  function handleUpgrade(req, socket, head) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  }

  /**
   * standalone listen 이후 LAN URL이 결정되면 호출. JOINED 메시지에 포함된다.
   * @param {string} url
   */
  function setHostUrl(url) {
    HOST_URL = typeof url === 'string' ? url : '';
  }

  return { handleHttp, handleUpgrade, setHostUrl };
}

// ──────────────────────────────────────────────────────────────
// 단독 실행 모드: `node server.js [--port N]`
// 포트 충돌 시 자동 폴백(yutnori 패턴, MAX_PORT_FALLBACK).
// ──────────────────────────────────────────────────────────────

/**
 * 현재 모듈이 직접 실행되었는지(vs launcher가 import) 판정한다.
 * @returns {boolean}
 */
function isDirectExecution() {
  if (!process.argv[1]) return false;
  const argvPath = process.argv[1].replace(/\\/g, '/');
  const metaPath = import.meta.url.replace('file:///', '').replace('file://', '');
  return metaPath === argvPath || metaPath.endsWith(argvPath);
}

if (isDirectExecution() && !process.env.HANABI_NO_LISTEN) {
  const argv = process.argv.slice(2);
  const portFlagIndex = argv.indexOf('--port');
  const REQUESTED_PORT = portFlagIndex >= 0 && argv[portFlagIndex + 1]
    ? parseInt(argv[portFlagIndex + 1], 10)
    : 3007;
  let HOST_URL = '';

  const app = createApp({ hostUrl: '' });

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

  function printBanner(port, lanIps, requestedPort) {
    const W = 60;
    const top   = `+${'-'.repeat(W)}+`;
    const sep   = `+${'-'.repeat(W)}+`;
    const empty = `|${' '.repeat(W)}|`;
    const line  = (s) => `|${padBoxLine(s, W)}|`;

    console.log('');
    console.log(ANSI.cyan + top + ANSI.reset);
    console.log(ANSI.cyan + line(`  ${ANSI.bold}HANABI${ANSI.reset}${ANSI.cyan} - LAN 1:1 협력 불꽃놀이`) + ANSI.reset);
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
    if (port !== requestedPort) {
      console.log(ANSI.cyan + line(`  ${ANSI.magenta}* 요청 포트 ${requestedPort} 사용 중 → ${port}로 폴백${ANSI.reset}`) + ANSI.reset);
    }
    console.log(ANSI.cyan + top + ANSI.reset);
    console.log('');
  }

  // ── 서버 시작 (포트 충돌 시 자동 폴백) ─────────────────────
  const MAX_PORT_FALLBACK = 10;

  function startListening(port, attemptsLeft) {
    const server = http.createServer(app.handleHttp);
    server.on('upgrade', app.handleUpgrade);

    let handled = false;
    const onError = (err) => {
      if (handled) return;
      handled = true;
      server.removeListener('error', onError);
      if (err && err.code === 'EADDRINUSE' && attemptsLeft > 0) {
        console.log(`[hanabi] 포트 ${port} 사용 중. ${port + 1}로 재시도...`);
        setTimeout(() => startListening(port + 1, attemptsLeft - 1), 100);
        return;
      }
      console.error('[hanabi] listen 에러:', err && err.message ? err.message : err);
      process.exit(1);
    };
    server.once('error', onError);
    // LAN 접속을 허용하기 위해 0.0.0.0에 바인딩.
    server.listen(port, '0.0.0.0', () => {
      server.removeListener('error', onError);
      const lanIps = getLanAddresses();
      HOST_URL = lanIps.length > 0
        ? `http://${lanIps[0].ip}:${port}`
        : `http://localhost:${port}`;
      app.setHostUrl(HOST_URL);
      printBanner(port, lanIps, REQUESTED_PORT);
      console.log(ANSI.dim
        + ' Tip: 처음 실행 시 Windows Defender 방화벽 팝업이 뜨면 "개인 네트워크"에 체크 후 액세스 허용.'
        + ANSI.reset);
      console.log('');
    });
  }

  startListening(REQUESTED_PORT, MAX_PORT_FALLBACK);
}
