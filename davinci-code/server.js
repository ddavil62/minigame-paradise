/**
 * @fileoverview WebSocket + 정적 파일 서버. LAN 환경에서 2인 다빈치 코드 대전을 중계한다.
 *
 * 아키텍처: 서버 권위 게임 상태
 * - 모든 룰 판정은 game.js가 처리, 클라이언트는 입력 + 시점별 스냅샷만 받음
 * - 의존성 최소화: Node 내장 http + ws
 * - 안정성: 30초 heartbeat, 좀비 슬롯 청소, 자동 좀비 정리
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
import { createGame, guess, continueDecision, selfReveal, snapshotForPlayer } from './game.js';

// ── 경로 + 설정 ───────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');

// ── 정적 파일 서빙 (public/) ─────────────────────────────────────
/** MIME 매핑. */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

/**
 * 다빈치 코드 게임 앱 인스턴스를 생성한다.
 * 모든 룸 상태(players/game)는 closure로 격리되어 다른 게임과 공유되지 않는다.
 *
 * @returns {{ handleHttp: Function, handleUpgrade: Function }}
 */
export function createApp() {
  // ── 룸 상태 (closure 격리, 2인 1룸 고정) ─────────────────────────
  /**
   * @typedef {Object} Player
   * @property {'p1'|'p2'} id
   * @property {import('ws').WebSocket} ws
   */

  /** @type {Player[]} */
  let players = [];
  /** @type {import('./game.js').GameState|null} */
  let game = null;

  /**
   * 모든 플레이어에게 각자의 시점 스냅샷을 브로드캐스트.
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
   * 모든 플레이어에게 임의 페이로드 브로드캐스트.
   * @param {object} payload
   */
  function broadcastAll(payload) {
    const msg = JSON.stringify(payload);
    for (const p of players) {
      if (p.ws.readyState === 1) p.ws.send(msg);
    }
  }

  /**
   * 특정 플레이어에게 단일 메시지.
   * @param {Player} player
   * @param {object} payload
   */
  function sendTo(player, payload) {
    if (player && player.ws.readyState === 1) {
      player.ws.send(JSON.stringify(payload));
    }
  }

  // ── WebSocket 서버 (noServer 모드) ─────────────────────────────
  const wss = new WebSocketServer({ noServer: true });

  // ── WebSocket 핸들러 ──────────────────────────────────────────────
  wss.on('connection', (ws) => {
    // 정원 초과 직전, 좀비 슬롯 즉시 청소 시도
    if (players.length >= 2) {
      const before = players.length;
      players = players.filter((p) => p.ws.readyState <= 1);
      if (players.length < before) {
        console.log(`[davinci] 좀비 슬롯 ${before - players.length}개 청소`);
        if (players.length === 0) game = null;
      }
    }

    if (players.length >= 2) {
      ws.send(JSON.stringify({ type: 'ERROR', message: '방이 가득 찼다 (2/2)' }));
      ws.close();
      console.log('[davinci] 연결 거절: 룸 정원 초과');
      return;
    }

    // Heartbeat 상태 초기화
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    const playerId = players.length === 0 ? 'p1' : 'p2';
    /** @type {Player} */
    const player = { id: playerId, ws };
    players.push(player);
    console.log(`[davinci] ${playerId} 연결됨 (${players.length}/2)`);

    sendTo(player, { type: 'JOINED', playerId, waiting: players.length < 2 });

    // 두 명 모두 입장 시 자동으로 새 게임 시작
    if (players.length === 2) {
      game = createGame('p1');
      console.log('[davinci] 두 플레이어 입장 완료 → 새 게임 시작');
      broadcastAll({ type: 'GAME_START' });
      broadcastState();
    }

    // ── 메시지 라우터 ──
    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch (e) {
        console.warn('[davinci] JSON 파싱 실패:', data.toString());
        return;
      }

      switch (msg.type) {
        case 'GUESS': {
          if (!game) break;
          const result = guess(game, player.id, msg.slot, msg.value);
          if (!result.ok) {
            sendTo(player, { type: 'ERROR', message: result.error });
            break;
          }
          console.log(`[davinci] GUESS: ${player.id} → slot=${msg.slot}, val=${msg.value}, correct=${result.correct}`);
          broadcastState();
          if (result.win) {
            broadcastAll({ type: 'GAME_END', winner: game.winner });
          }
          break;
        }

        case 'CONTINUE': {
          if (!game) break;
          const result = continueDecision(game, player.id, msg.decision);
          if (!result.ok) {
            sendTo(player, { type: 'ERROR', message: result.error });
            break;
          }
          console.log(`[davinci] CONTINUE: ${player.id} → ${msg.decision}`);
          broadcastState();
          break;
        }

        case 'SELF_REVEAL': {
          if (!game) break;
          const result = selfReveal(game, player.id, msg.slot);
          if (!result.ok) {
            sendTo(player, { type: 'ERROR', message: result.error });
            break;
          }
          console.log(`[davinci] SELF_REVEAL: ${player.id} → slot=${msg.slot}`);
          broadcastState();
          if (result.win) {
            broadcastAll({ type: 'GAME_END', winner: game.winner });
          }
          break;
        }

        case 'NEW_GAME': {
          if (players.length < 2) {
            sendTo(player, { type: 'ERROR', message: '상대방이 없어 새 게임을 시작할 수 없다' });
            break;
          }
          // 매 새 게임마다 선공 교대 (이전 패자가 선공)
          const nextFirst = game && game.winner
            ? (game.winner === 'p1' ? 'p2' : 'p1')
            : 'p1';
          game = createGame(nextFirst);
          console.log(`[davinci] NEW_GAME → 새 게임 시작 (선공: ${nextFirst})`);
          broadcastAll({ type: 'GAME_START' });
          broadcastState();
          break;
        }

        default:
          console.warn(`[davinci] 알 수 없는 메시지 타입: ${msg.type}`);
      }
    });

    ws.on('close', () => {
      console.log(`[davinci] ${player.id} 연결 해제`);
      players = players.filter((p) => p.id !== player.id);
      if (players.length === 0) {
        game = null;
      } else {
        broadcastAll({
          type: 'OPPONENT_LEFT',
          message: '상대방이 나갔다. 새 친구가 접속하면 게임이 재시작된다.',
        });
        game = null;
      }
    });

    ws.on('error', (err) => {
      console.error(`[davinci] ${player.id} WS 에러:`, err.message);
    });
  });

  // ── Heartbeat: 30초마다 ping ────────────────────────────────────
  const HEARTBEAT_INTERVAL_MS = 30000;
  const heartbeatTimer = setInterval(() => {
    for (const p of [...players]) {
      if (p.ws.isAlive === false) {
        console.log(`[davinci] ${p.id} heartbeat 응답 없음 → 강제 종료`);
        p.ws.terminate();
        continue;
      }
      p.ws.isAlive = false;
      try { p.ws.ping(); } catch (e) { /* 이미 닫힌 ws — 다음 사이클에 정리됨 */ }
    }
  }, HEARTBEAT_INTERVAL_MS);

  wss.on('close', () => { clearInterval(heartbeatTimer); });

  // ── HTTP 핸들러 (정적 파일 서빙) ──────────────────────────────
  /**
   * 정적 파일 응답 핸들러. public/ 외 경로는 차단 (디렉토리 탈출 방지).
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
    : 3002;

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
    console.log(ANSI.cyan + line(`  ${ANSI.bold}DA VINCI CODE${ANSI.reset}${ANSI.cyan} - LAN 1:1 대전`) + ANSI.reset);
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
    console.error('[davinci] HTTP 에러:', err.message);
    process.exit(1);
  });

  server.listen(PORT, '0.0.0.0', () => {
    const lanIps = getLanAddresses();
    printBanner(PORT, lanIps);
    console.log(ANSI.dim
      + ' Tip: 처음 실행 시 Windows Defender 방화벽 팝업이 뜨면 "개인 네트워크"에 체크 후 액세스 허용.'
      + ANSI.reset);
    console.log('');
  });
}
