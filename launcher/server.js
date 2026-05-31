/**
 * @fileoverview 미니게임 천국 런처 — 단일 포트(3000) 통합 라우터.
 *
 *   하나의 http.Server가 다음을 모두 처리한다:
 *     - `/` 및 `/games.json` → 런처 정적 파일 (launcher/public)
 *     - `/{gameId}/...` → 각 게임의 정적 파일 (game.public via createApp().handleHttp)
 *     - WS `/ws` → 런처 로비 WSS
 *     - WS `/{gameId}/ws` → 각 게임 WSS (noServer 모드로 라우팅)
 *     - POST `/lobby/return` → 게임 완료 후 로비 복귀 (RETURN_LOBBY broadcast)
 *
 *   외부 의존성: ws@^8.18.0, express(yutnori/tetris-battle 한정)
 *
 * 로비 흐름:
 *   1. 클라이언트가 `/ws`로 접속 → 정원(2명) 검사 → 호스트/게스트 역할 부여
 *   2. 게임 카드가 즉시 표시됨. 호스트가 PICK_GAME → mode(ai|human) 결정 → REDIRECT broadcast
 *   3. 게임 완료 후 POST /lobby/return → RETURN_LOBBY broadcast → 양쪽 로비 복귀
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

// 각 게임 앱 import (createApp factory)
import { createApp as createCodenamesApp } from '../codenames-duet/server.js';
import { createApp as createDavinciApp }   from '../davinci-code/server.js';
import { createApp as createMatgoApp }     from '../matgo/server.js';
import { createApp as createYutnoriApp }   from '../yutnori/server.js';
import { createApp as createTetrisApp }    from '../tetris-battle/server.js';
import { createApp as createJanggiApp }   from '../janggi/server.js';

// ── 경로 및 인자 파싱 ──────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');
const MINIGAMES_ROOT = path.join(__dirname, '..');

const argv = process.argv.slice(2);
const portFlagIndex = argv.indexOf('--port');
const PORT = portFlagIndex >= 0 && argv[portFlagIndex + 1]
  ? parseInt(argv[portFlagIndex + 1], 10)
  : 3000;

// ── MIME 매핑 ────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

// ── 통합 라우터: 5개 게임 앱 인스턴스 ────────────────────────────
/**
 * key는 URL path 첫 segment 및 games.json의 `id` 필드와 정확히 일치해야 한다.
 * @type {Record<string, { handleHttp: Function, handleUpgrade: Function, setHostUrl?: Function }>}
 */
const GAME_APPS = {
  'codenames-duet': createCodenamesApp(),
  'davinci-code':   createDavinciApp(),
  'matgo':          createMatgoApp({
    // mode=ai 사용자 진입 시 matgo 서버가 자체적으로 봇을 spawn할 URL.
    getBotUrl: () => `ws://localhost:${PORT}/matgo/ws?mode=bot`,
  }),
  'yutnori':        createYutnoriApp(),
  'tetris-battle':  createTetrisApp(),
  'janggi':         createJanggiApp(),
};

/**
 * 안전한 런처 정적 파일 경로 해석 (디렉토리 트래버설 방지).
 * @param {string} urlPath 요청 URL 경로
 * @returns {string|null} 절대 경로 또는 null(불허)
 */
function resolveSafePath(urlPath) {
  // 쿼리스트링 제거
  const cleanPath = urlPath.split('?')[0];
  // 루트 또는 폴더 요청 → index.html
  const rel = cleanPath === '/' || cleanPath.endsWith('/')
    ? path.join(cleanPath, 'index.html')
    : cleanPath;
  const decoded = decodeURIComponent(rel);
  const abs = path.join(PUBLIC_DIR, decoded);
  // PUBLIC_DIR 외부로의 탈출 차단
  if (!abs.startsWith(PUBLIC_DIR)) return null;
  return abs;
}

/**
 * 런처 정적 파일을 응답한다.
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
function serveLauncherStatic(req, res) {
  const abs = resolveSafePath(req.url || '/');
  if (!abs) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.stat(abs, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }
    const ext = path.extname(abs).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    fs.createReadStream(abs).pipe(res);
  });
}

// ── HTTP 서버 (통합 라우터) ─────────────────────────────────────
const server = http.createServer((req, res) => {
  const reqUrl = req.url || '/';
  const urlPath = reqUrl.split('?')[0];
  const queryStr = reqUrl.includes('?') ? reqUrl.slice(reqUrl.indexOf('?')) : '';
  const segments = urlPath.split('/').filter(Boolean);
  const first = segments[0] || '';

  // POST /lobby/return — 게임 완료 후 양쪽 로비 복귀
  if (req.method === 'POST' && urlPath === '/lobby/return') {
    res.writeHead(204);
    res.end();
    // 로비 상태 리셋
    currentMode = null;
    votes.clear();
    broadcast({ type: 'RETURN_LOBBY' });
    console.log('[launcher] POST /lobby/return → RETURN_LOBBY broadcast');
    return;
  }

  if (first && GAME_APPS[first]) {
    // 게임 prefix 제거 후 req.url 재작성: /matgo/style.css → '/style.css'
    const sub = segments.length === 1
      ? '/'
      : '/' + segments.slice(1).join('/');
    req.url = sub + queryStr;
    GAME_APPS[first].handleHttp(req, res);
    return;
  }

  // 런처 정적 서빙
  serveLauncherStatic(req, res);
});

// ── games.json 캐시 ──────────────────────────────────────────
/**
 * 서버 시작 시 games.json을 1회 읽어 메모리에 캐시한다.
 * PICK_GAME 처리 시 gameId 검증에 사용.
 * @returns {Map<string, object>}
 */
function loadGamesMap() {
  try {
    const raw = fs.readFileSync(path.join(PUBLIC_DIR, 'games.json'), 'utf8');
    const arr = JSON.parse(raw);
    return new Map(arr.map((g) => [g.id, g]));
  } catch (err) {
    console.error('[launcher] games.json 로드 실패:', err.message);
    return new Map();
  }
}

const gamesMap = loadGamesMap();

// ── 로비 상태 (모듈 수준) ─────────────────────────────────────
/**
 * 접속 중인 WS 클라이언트.
 * key: ws 객체, value: { id, role }
 *   - id: 'p1' | 'p2'  (입장 순서 기반)
 *   - role: 'host' | 'guest'
 * 최대 2명까지만 수용.
 * @type {Map<import('ws').WebSocket, { id: string, role: 'host'|'guest' }>}
 */
const clients = new Map();

/**
 * 현재 대전 모드. PICK_GAME 시 인원수에 따라 결정됨.
 * @type {'ai' | 'human' | null}
 */
let currentMode = null;

/**
 * 게임별 투표 현황.
 * key: gameId (string), value: Set of playerId (string, 'p1'|'p2')
 * @type {Map<string, Set<string>>}
 */
const votes = new Map();

/**
 * 다음 클라이언트에 부여할 ID 일련번호. 'p1'부터 시작.
 * 클라이언트가 모두 나갈 때 리셋된다.
 */
let nextIdSeq = 1;

// ── 런처 로비 WebSocket 서버 (noServer 모드) ──────────────────────
const lobbyWss = new WebSocketServer({ noServer: true });

/**
 * 활성 클라이언트에게 JSON 메시지를 보낸다.
 * @param {import('ws').WebSocket} ws
 * @param {object} payload
 */
function sendJson(ws, payload) {
  if (ws.readyState !== ws.OPEN) return;
  try {
    ws.send(JSON.stringify(payload));
  } catch (err) {
    console.error('[launcher] WS send 실패:', err.message);
  }
}

/**
 * 모든 활성 클라이언트에게 JSON 메시지를 broadcast 한다.
 * @param {object} payload
 */
function broadcast(payload) {
  for (const ws of clients.keys()) {
    sendJson(ws, payload);
  }
}

/**
 * 특정 클라이언트에게만 LOBBY_STATE를 보낸다.
 * count, role, mode, votes 등 현재 스냅샷을 포함.
 * @param {import('ws').WebSocket} ws
 */
function sendLobbyStateTo(ws) {
  const meta = clients.get(ws);
  if (!meta) return;
  const hostEntry = [...clients.values()].find((m) => m.role === 'host');
  // votes를 { gameId: count } 형태로 직렬화
  const votesSnapshot = {};
  for (const [gameId, playerSet] of votes) {
    votesSnapshot[gameId] = playerSet.size;
  }
  sendJson(ws, {
    type: 'LOBBY_STATE',
    count: clients.size,
    role: meta.role,
    hostId: hostEntry ? hostEntry.id : null,
    mode: currentMode,
    votes: votesSnapshot,
  });
}

/**
 * 모든 클라이언트에게 각자에 맞는 LOBBY_STATE를 보낸다 (role이 클라별로 다름).
 */
function broadcastLobbyState() {
  for (const ws of clients.keys()) {
    sendLobbyStateTo(ws);
  }
}

/**
 * 첫 번째 클라이언트(Map 순서상)를 호스트로 재판정한다.
 * 호스트 disconnect 후 남은 게스트를 승격할 때 호출.
 */
function reassignHost() {
  const entries = [...clients.entries()];
  if (entries.length === 0) return;
  // 모두 일단 게스트로 두고 첫 항목만 호스트로
  for (let i = 0; i < entries.length; i += 1) {
    const [, meta] = entries[i];
    meta.role = i === 0 ? 'host' : 'guest';
  }
}

/**
 * AI 모드 시 해당 게임의 bot.js를 child_process로 spawn 한다.
 * bot.js가 없으면 경고만 출력하고 정상 흐름은 유지한다.
 * 단일 포트(3000) 통합 라우터이므로 봇 WS URL은 `ws://localhost:{PORT}/{gameId}/ws`.
 *
 * @param {string} gameId games.json의 id
 */
function spawnBot(gameId) {
  const botPath = path.join(MINIGAMES_ROOT, gameId, 'bot.js');
  if (!fs.existsSync(botPath)) {
    console.warn(`[launcher] bot.js 없음, AI 봇 생략: ${gameId} (경로: ${botPath})`);
    return;
  }
  const url = `ws://localhost:${PORT}/${gameId}/ws`;
  try {
    const child = spawn(process.execPath, [botPath, '--url', url], {
      detached: true,
      stdio: 'ignore',
    });
    child.on('error', (err) => {
      console.error(`[launcher] 봇 spawn 에러 (${gameId}):`, err.message);
    });
    child.unref(); // launcher 종료 시에도 봇 프로세스를 같이 죽이지 않음 (게임 서버에서 자연 종료 유도)
    console.log(`[launcher] 봇 기동: ${gameId} --url ${url} (pid=${child.pid})`);
  } catch (err) {
    console.error(`[launcher] 봇 spawn 예외 (${gameId}):`, err.message);
  }
}

/**
 * 클라이언트 메시지 처리 라우터.
 * @param {import('ws').WebSocket} ws
 * @param {object} msg 파싱된 JSON 메시지
 */
function handleMessage(ws, msg) {
  const meta = clients.get(ws);
  if (!meta) return;

  switch (msg.type) {
    case 'PICK_GAME': {
      if (meta.role !== 'host') return;
      const gameId = String(msg.gameId || '');
      const game = gamesMap.get(gameId);
      if (!game) {
        console.warn(`[launcher] PICK_GAME 알 수 없는 gameId: ${gameId}`);
        return;
      }
      // 인원수에 따라 모드 결정 (pick 시점에 확정)
      const isAiMode = clients.size === 1;
      // AI 모드 + 봇 미지원 게임이면 차단 (서버 이중 안전망)
      if (isAiMode && !game.botAvailable) {
        sendJson(ws, { type: 'ERROR', message: '이 게임은 AI 봇을 지원하지 않습니다.' });
        console.warn(`[launcher] PICK_GAME 차단: ${gameId} (AI 모드이나 봇 미지원)`);
        return;
      }
      currentMode = isAiMode ? 'ai' : 'human';
      // 통합 라우터: 같은 포트(3000) 내 `/{gameId}/`로 이동한다.
      const redirectPath = `/${gameId}/`;
      console.log(`[launcher] PICK_GAME → gameId=${gameId}, path=${redirectPath}, mode=${currentMode}`);
      broadcast({
        type: 'REDIRECT',
        gameId,
        path: redirectPath,
        mode: currentMode,
      });
      break;
    }

    case 'VOTE_GAME': {
      const gameId = String(msg.gameId || '');
      if (!gamesMap.has(gameId)) return;
      if (!votes.has(gameId)) votes.set(gameId, new Set());
      const voterSet = votes.get(gameId);
      // toggle: 이미 투표했으면 취소, 아니면 추가
      if (voterSet.has(meta.id)) {
        voterSet.delete(meta.id);
      } else {
        voterSet.add(meta.id);
      }
      console.log(`[launcher] VOTE_GAME: ${meta.id} → ${gameId}, count=${voterSet.size}`);
      broadcastLobbyState();
      break;
    }

    default:
      // 미정의 메시지 무시 (START 등 하위 호환)
      break;
  }
}

/**
 * 신규 WS 연결 처리.
 */
lobbyWss.on('connection', (ws) => {
  // 정원 초과: FULL 송신 후 연결 종료
  if (clients.size >= 2) {
    sendJson(ws, { type: 'FULL', message: '현재 게임이 진행 중입니다. 잠시 후 다시 시도하세요.' });
    setTimeout(() => {
      try { ws.close(1000, 'FULL'); } catch (_) { /* noop */ }
    }, 50);
    console.log(`[launcher] FULL 거절 (정원 초과, 현재 ${clients.size}/2)`);
    return;
  }

  // 역할 부여: 첫 번째 접속자 = 호스트
  const role = clients.size === 0 ? 'host' : 'guest';
  const id = `p${nextIdSeq}`;
  nextIdSeq += 1;
  clients.set(ws, { id, role });
  console.log(`[launcher] 접속: ${id} (${role}), 현재 ${clients.size}/2`);

  // 전체에 갱신 상태 broadcast (각자 role이 다름)
  broadcastLobbyState();

  // 메시지 수신
  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch (err) {
      console.warn('[launcher] 잘못된 JSON 무시:', err.message);
      return;
    }
    handleMessage(ws, msg);
  });

  ws.on('close', () => {
    const departed = clients.get(ws);
    if (!departed) return;
    clients.delete(ws);
    console.log(`[launcher] 퇴장: ${departed.id} (${departed.role}), 잔여 ${clients.size}/2`);

    if (clients.size === 0) {
      // 모두 나감 → 상태 리셋
      currentMode = null;
      nextIdSeq = 1;
      votes.clear();
      return;
    }

    // 호스트가 떠난 경우: 게스트에게 RESET 후 호스트로 승격
    if (departed.role === 'host') {
      // 남아있는 게스트 모두에게 RESET 전송 (UI를 로비로)
      broadcast({ type: 'RESET' });
      currentMode = null;
      votes.clear();
      reassignHost();
    }
    // 게스트가 떠난 경우: 호스트는 그대로, 단지 count만 갱신
    broadcastLobbyState();
  });

  ws.on('error', (err) => {
    console.error('[launcher] WS 에러:', err.message);
  });
});

// ── WS upgrade 라우터 ────────────────────────────────────────────
server.on('upgrade', (req, socket, head) => {
  const urlPath = (req.url || '/').split('?')[0];
  const segments = urlPath.split('/').filter(Boolean);

  // /{gameId}/ws → 해당 게임 WSS로 라우팅
  if (segments.length === 2 && segments[1] === 'ws' && GAME_APPS[segments[0]]) {
    GAME_APPS[segments[0]].handleUpgrade(req, socket, head);
    return;
  }

  // /ws → 런처 로비 WSS
  if (urlPath === '/ws') {
    lobbyWss.handleUpgrade(req, socket, head, (ws) => {
      lobbyWss.emit('connection', ws, req);
    });
    return;
  }

  // 미매칭 → 연결 거절
  socket.destroy();
});

// ── 호스트 IP 자동 감지 ───────────────────────────────────────
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

// ── 콘솔 배너 ────────────────────────────────────────────────
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
  const top = `+${'-'.repeat(W)}+`;
  const sep = `+${'-'.repeat(W)}+`;
  const empty = `|${' '.repeat(W)}|`;
  const line = (s) => `|${padBoxLine(s, W)}|`;

  console.log('');
  console.log(ANSI.cyan + top + ANSI.reset);
  console.log(ANSI.cyan + line(`  ${ANSI.bold}미니게임 천국${ANSI.reset}${ANSI.cyan} - 런처 (단일 포트 통합)`) + ANSI.reset);
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
  console.log(ANSI.cyan + line(`  ${ANSI.dim}게임: /matgo/ /yutnori/ /tetris-battle/ /codenames-duet/ /davinci-code/ /janggi/${ANSI.reset}`) + ANSI.reset);
  console.log(ANSI.cyan + line(`  ${ANSI.dim}종료: Ctrl+C${ANSI.reset}`) + ANSI.reset);
  console.log(ANSI.cyan + top + ANSI.reset);
  console.log('');
}

// ── 서버 시작 ────────────────────────────────────────────────
server.on('error', (err) => {
  console.error('[launcher] HTTP 에러:', err.message);
  process.exit(1);
});

server.listen(PORT, '0.0.0.0', () => {
  const lanIps = getLanAddresses();
  printBanner(PORT, lanIps);

  // 각 게임 앱에 호스트 URL을 알려 JOINED 메시지에 친구 안내 URL이 들어가게 한다.
  // 통합 라우터에서는 모두 같은 host:port를 공유한다.
  const hostIp = lanIps.length > 0 ? lanIps[0].ip : 'localhost';
  const hostUrl = `http://${hostIp}:${PORT}`;
  for (const [gameId, app] of Object.entries(GAME_APPS)) {
    if (typeof app.setHostUrl === 'function') {
      // yutnori/tetris-battle은 게임별 path도 안내에 포함해 친구가 직접 게임으로 진입 가능하게 한다.
      app.setHostUrl(`${hostUrl}/${gameId}/`);
    }
  }

  console.log(ANSI.dim
    + ' Tip: 처음 실행 시 Windows Defender 방화벽 팝업이 뜨면 "개인 네트워크"에 체크 후 액세스 허용.'
    + ANSI.reset);
  console.log(ANSI.dim
    + ` games.json 캐시: ${gamesMap.size}개 게임 로드됨 (botAvailable=true: ${[...gamesMap.values()].filter((g) => g.botAvailable).length}개)`
    + ANSI.reset);
});
