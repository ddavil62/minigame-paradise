/**
 * @fileoverview 루미큐브(Rummikub) WebSocket + 정적 파일 서버.
 *
 * 아키텍처: **서버 권위(Server Authoritative)**
 * - 타일 분배·세트 검증·첫 등판 30점 검증·승리 판정 모두 서버 game.js 순수 함수.
 * - 클라는 MOVE_TILE / NEW_SET / END_TURN 입력만 송신.
 * - 매 액션 후 STATE를 양쪽에 broadcast (단, 본인 손은 본인에게만 자세히, 상대는 갯수만).
 * - 의존성 최소화: Node 내장 http + ws (Express 미사용 — yahtzee/hanabi 패턴 차용).
 *
 * 통합 라우터 지원:
 *   - createApp()을 export하여 launcher가 단일 포트(3000)에서 라우팅한다.
 *   - 단독 실행(`node server.js [--port N]`)도 지원하며 포트 충돌 시 자동 폴백.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import {
  createGame,
  addNewSet,
  moveTile,
  swapJoker,
  endTurn,
  snapshotFor,
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
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

/**
 * 루미큐브 앱 인스턴스를 생성한다.
 * 모든 룸 상태(players/game)는 closure로 격리되어 다른 게임과 공유되지 않는다.
 *
 * @param {object} [opts]
 * @param {string} [opts.hostUrl] LAN 접속 URL (JOINED 메시지에 포함, 친구 안내용)
 * @param {() => string} [opts.getBotUrl] 봇이 접속할 WS URL을 반환하는 함수
 * @returns {{ handleHttp: Function, handleUpgrade: Function, setHostUrl: Function }}
 */
export function createApp(opts = {}) {
  let HOST_URL = typeof opts.hostUrl === 'string' ? opts.hostUrl : '';
  const getBotUrl = typeof opts.getBotUrl === 'function' ? opts.getBotUrl : (() => null);

  // ── 룸 상태 (closure 격리, 2인 1룸 고정) ─────────────────
  /**
   * @typedef {Object} Player
   * @property {string} id 'p1'|'p2'
   * @property {string} name
   * @property {boolean} joined
   * @property {boolean} ready
   * @property {boolean} rematchReady
   * @property {import('ws').WebSocket} ws
   */

  /** @type {Player[]} */
  let players = [];
  /** @type {import('./game.js').GameState|null} */
  let game = null;

  /**
   * 양 플레이어에게 각자 시점의 STATE를 송신한다.
   * (본인 손은 본인에게만 자세히, 상대는 갯수만 — snapshotFor 사용.)
   */
  function broadcastState() {
    if (!game) return;
    for (const p of players) {
      if (p.ws.readyState !== 1) continue;
      const snap = snapshotFor(game, p.id);
      p.ws.send(JSON.stringify(snap));
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
   * 게임이 종료됐으면 GAME_OVER를 broadcast 한다.
   * @returns {boolean} 종료됐으면 true
   */
  function maybeBroadcastGameOver() {
    if (game && game.phase === 'ended') {
      broadcastAll({
        type: 'GAME_OVER',
        winner: game.result.winner,
        reason: game.result.reason,
        handCounts: game.result.handCounts,
      });
      return true;
    }
    return false;
  }

  /**
   * 새 게임을 시작하고 START + STATE를 전송한다.
   */
  function startNewGame() {
    game = createGame();
    for (const p of players) {
      p.ready = false;
      p.rematchReady = false;
    }
    broadcastAll({ type: 'START' });
    broadcastState();
  }

  // ── 봇 자식 프로세스 관리 ────────────────────────────────────
  /** @type {import('child_process').ChildProcess|null} */
  let botChild = null;

  /**
   * 봇 자식 프로세스를 spawn한다. 이미 실행 중이면 무시.
   */
  function spawnBotChild() {
    const botPath = path.join(__dirname, 'bot.js');
    if (!fs.existsSync(botPath)) {
      console.warn('[rummikub] bot.js 없음 — 봇 spawn 스킵');
      return;
    }
    if (botChild && botChild.exitCode === null) {
      console.log('[rummikub] 봇 이미 실행 중');
      return;
    }
    const url = getBotUrl();
    if (!url) {
      console.warn('[rummikub] getBotUrl이 null 반환 — 봇 spawn 스킵');
      return;
    }
    console.log(`[rummikub] 봇 spawn: ${url}`);
    botChild = spawn(process.execPath, [botPath, '--url', url], {
      detached: false,
      stdio: 'ignore',
    });
    botChild.on('exit', (code) => {
      console.log(`[rummikub] 봇 종료 (code=${code})`);
      botChild = null;
    });
  }

  /**
   * 봇 자식 프로세스를 종료한다.
   */
  function killBotChild() {
    if (botChild && botChild.exitCode === null) {
      console.log('[rummikub] 봇 종료 요청');
      botChild.kill();
      botChild = null;
    }
  }

  // ── WebSocket 서버 (noServer 모드) ─────────────────────────────
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws, req) => {
    const reqUrlObj = new URL(req.url || '/', 'http://localhost');
    const wsMode = reqUrlObj.searchParams.get('mode') || 'human';
    const isBot = wsMode === 'bot';
    ws._mode = wsMode;
    ws._isBot = isBot;

    // 좀비 슬롯 청소.
    if (players.length >= 2) {
      const before = players.length;
      players = players.filter((p) => p.ws.readyState <= 1);
      if (players.length < before) {
        console.log(`[rummikub] 좀비 슬롯 ${before - players.length}개 청소`);
        if (players.length === 0) game = null;
      }
    }

    // 룸 정원 초과.
    if (players.length >= 2) {
      ws.send(JSON.stringify({ type: 'ERROR', message: '방이 가득 찼다 (2/2)' }));
      ws.close();
      console.log('[rummikub] 연결 거절: 룸 정원 초과');
      return;
    }

    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    const playerId = players.length === 0 ? 'p1' : 'p2';
    /** @type {Player} */
    const player = {
      id: playerId,
      name: playerId,
      joined: false,
      ready: false,
      rematchReady: false,
      ws,
    };
    players.push(player);
    console.log(`[rummikub] ${playerId} 연결됨 (${players.length}/2, mode=${wsMode})`);

    // mode=ai 사용자 단독 진입 시 봇 spawn.
    if (wsMode === 'ai' && !isBot && players.length === 1) {
      setTimeout(() => spawnBotChild(), 200);
    }

    // ── 메시지 라우터 ──
    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch (e) {
        console.warn('[rummikub] JSON 파싱 실패:', data.toString());
        return;
      }

      switch (msg.type) {
        case 'JOIN': {
          player.name = (msg.playerName || playerId).toString().slice(0, 32);
          player.joined = true;
          sendTo(player, {
            type: 'JOINED',
            playerId: player.id,
            waiting: players.length < 2,
            hostUrl: HOST_URL,
          });
          break;
        }

        case 'READY': {
          player.ready = true;
          broadcastAll({
            type: 'READY_STATUS',
            p1Ready: players.find((p) => p.id === 'p1')?.ready || false,
            p2Ready: players.find((p) => p.id === 'p2')?.ready || false,
          });
          if (
            players.length === 2 &&
            players.every((p) => p.joined && p.ready) &&
            !game
          ) {
            console.log('[rummikub] 양쪽 READY → 새 게임 시작');
            startNewGame();
          }
          break;
        }

        case 'NEW_SET': {
          if (!game) {
            sendTo(player, { type: 'ERROR', message: '게임이 시작되지 않았습니다.' });
            break;
          }
          const r = addNewSet(game, player.id);
          if (!r.ok) {
            sendTo(player, { type: 'ERROR', message: r.error });
            break;
          }
          broadcastState();
          break;
        }

        case 'MOVE_TILE': {
          if (!game) {
            sendTo(player, { type: 'ERROR', message: '게임이 시작되지 않았습니다.' });
            break;
          }
          const r = moveTile(game, player.id, msg.from, msg.to);
          if (!r.ok) {
            sendTo(player, { type: 'ERROR', message: r.error });
            break;
          }
          broadcastState();
          break;
        }

        case 'SWAP_JOKER': {
          if (!game) {
            sendTo(player, { type: 'ERROR', message: '게임이 시작되지 않았습니다.' });
            break;
          }
          const r = swapJoker(game, player.id, {
            setId: msg.setId,
            jokerIndex: msg.jokerIndex,
            handTileId: msg.handTileId,
          });
          if (!r.ok) {
            sendTo(player, { type: 'ERROR', message: r.error });
            break;
          }
          console.log(`[rummikub] SWAP_JOKER: ${player.id} setId=${msg.setId} joker=${r.jokerId} hand=${msg.handTileId}`);
          broadcastState();
          break;
        }

        case 'END_TURN': {
          if (!game) {
            sendTo(player, { type: 'ERROR', message: '게임이 시작되지 않았습니다.' });
            break;
          }
          const r = endTurn(game, player.id);
          if (!r.ok) {
            sendTo(player, { type: 'ERROR', message: r.error });
            break;
          }
          // 결과를 양쪽에 알린다(토스트/사운드 트리거용).
          broadcastAll({
            type: 'TURN_RESULT',
            by: player.id,
            committed: !!r.committed,
            drewTile: r.drewTile || null,
            reason: r.reason || null,
            error: r.error || null,
          });
          console.log(
            `[rummikub] END_TURN: ${player.id} committed=${r.committed} reason=${r.reason}`
            + (r.drewTile ? ` drew=${r.drewTile}` : '')
          );
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
            console.log('[rummikub] 양쪽 REMATCH → 새 게임');
            startNewGame();
          }
          break;
        }

        default:
          console.warn(`[rummikub] 알 수 없는 메시지 타입: ${msg.type}`);
      }
    });

    // ── 연결 해제 ──
    ws.on('close', () => {
      console.log(`[rummikub] ${player.id} 연결 해제 (mode=${ws._mode})`);
      players = players.filter((p) => p.id !== player.id);
      if (!ws._isBot) {
        killBotChild();
      }
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
      console.error(`[rummikub] ${player.id} WS 에러:`, err.message);
    });
  });

  // ── Heartbeat ──────────────────────────────────────────────
  const HEARTBEAT_INTERVAL_MS = 30000;
  const heartbeatTimer = setInterval(() => {
    for (const p of [...players]) {
      if (p.ws.isAlive === false) {
        console.log(`[rummikub] ${p.id} heartbeat 응답 없음 → 강제 종료`);
        p.ws.terminate();
        continue;
      }
      p.ws.isAlive = false;
      try { p.ws.ping(); } catch (e) { /* noop */ }
    }
  }, HEARTBEAT_INTERVAL_MS);

  wss.on('close', () => { clearInterval(heartbeatTimer); });

  // ── HTTP 핸들러 (정적 파일 서빙) ──────────────────────────────
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

  function handleUpgrade(req, socket, head) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  }

  function setHostUrl(url) {
    HOST_URL = typeof url === 'string' ? url : '';
  }

  return { handleHttp, handleUpgrade, setHostUrl };
}

// ──────────────────────────────────────────────────────────────
// 단독 실행 모드: `node server.js [--port N]`
// ──────────────────────────────────────────────────────────────

/**
 * 현재 모듈이 직접 실행되었는지 판정.
 * @returns {boolean}
 */
function isDirectExecution() {
  if (!process.argv[1]) return false;
  const argvPath = process.argv[1].replace(/\\/g, '/');
  const metaPath = import.meta.url.replace('file:///', '').replace('file://', '');
  return metaPath === argvPath || metaPath.endsWith(argvPath);
}

if (isDirectExecution() && !process.env.RUMMIKUB_NO_LISTEN) {
  const argv = process.argv.slice(2);
  const portFlagIndex = argv.indexOf('--port');
  const REQUESTED_PORT = portFlagIndex >= 0 && argv[portFlagIndex + 1]
    ? parseInt(argv[portFlagIndex + 1], 10)
    : 3011;
  let HOST_URL = '';
  let listeningPort = 0;

  const app = createApp({
    hostUrl: '',
    getBotUrl: () => (listeningPort > 0
      ? `ws://localhost:${listeningPort}/ws?mode=bot`
      : null),
  });

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
    console.log(ANSI.cyan + line(`  ${ANSI.bold}RUMMIKUB${ANSI.reset}${ANSI.cyan} - LAN 1:1 루미큐브`) + ANSI.reset);
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
        console.log(`[rummikub] 포트 ${port} 사용 중. ${port + 1}로 재시도...`);
        setTimeout(() => startListening(port + 1, attemptsLeft - 1), 100);
        return;
      }
      console.error('[rummikub] listen 에러:', err && err.message ? err.message : err);
      process.exit(1);
    };
    server.once('error', onError);
    server.listen(port, '0.0.0.0', () => {
      server.removeListener('error', onError);
      listeningPort = port;
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
