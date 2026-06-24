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
import { createApp as createHanabiApp }   from '../hanabi/server.js';
import { createApp as createYahtzeeApp }  from '../yahtzee/server.js';
import { createApp as createRummikubApp } from '../rummikub/server.js';
import { createApp as createOmokApp }     from '../omok/server.js';

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
  // 윷놀이 — 봇 지원 (2026-06-12 추가).
  'yutnori':        createYutnoriApp({
    // mode=ai 사용자 진입 시 yutnori 서버가 자체적으로 봇을 spawn할 URL.
    getBotUrl: () => `ws://localhost:${PORT}/yutnori/ws?mode=bot`,
  }),
  // 테트리스 배틀 — 봇 지원 (2026-06-21 추가).
  'tetris-battle':  createTetrisApp({
    getBotUrl: () => `ws://localhost:${PORT}/tetris-battle/ws?mode=bot`,
  }),
  'janggi':         createJanggiApp({
    // mode=ai 사용자 진입 시 janggi 서버가 자체적으로 봇을 spawn할 URL.
    getBotUrl: () => `ws://localhost:${PORT}/janggi/ws?mode=bot`,
  }),
  // 하나비는 봇 미지원(§13-8) — getBotUrl 옵션 불필요. setHostUrl만 사용.
  'hanabi':         createHanabiApp(),
  // 요트 다이스 — 봇 지원 (2026-06-08 추가).
  'yahtzee':        createYahtzeeApp({
    getBotUrl: () => `ws://localhost:${PORT}/yahtzee/ws?mode=bot`,
  }),
  // 루미큐브 — 봇 지원 (2026-06-10 추가).
  'rummikub':       createRummikubApp({
    getBotUrl: () => `ws://localhost:${PORT}/rummikub/ws?mode=bot`,
  }),
  // 오목 — 봇 지원 (2026-06-15 추가).
  'omok':           createOmokApp({
    getBotUrl: () => `ws://localhost:${PORT}/omok/ws?mode=bot`,
  }),
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

// ── 버그리포트 위젯 주입 미들웨어 ─────────────────────────────────
/**
 * 모든 text/html 응답의 마지막 `</body>` 앞에 삽입할 위젯 태그.
 * `/bug-widget.css`·`/bug-widget.js`는 serveLauncherStatic이 launcher/public에서 서빙한다.
 */
const WIDGET_SNIPPET =
  '<link rel="stylesheet" href="/bug-widget.css">' +
  '<script src="/bug-widget.js" defer></script>';

/**
 * res.writeHead / res.write / res.end를 1회 wrap 해, text/html 응답에만 위젯 태그를 주입한다.
 *
 *   - text/html이 아닌 응답(js/css/json/png 등)은 원본 write/end를 즉시 통과시킨다(버퍼링 없음).
 *   - text/html이면 청크를 버퍼링했다가 res.end 시점에 마지막 `</body>` 앞에 태그를 삽입한다.
 *   - 삽입으로 길이가 달라지므로 Content-Length 헤더를 제거(chunked 전환)한다.
 *   - writeHead를 거치지 않는 Express 응답(setHeader + write 직접 호출)도 커버하기 위해
 *     res.write 첫 호출 시 getHeader('content-type')로 text/html 여부를 재확인한다.
 *   - `</body>`가 없는 HTML은 끝에 append 한다(폴백).
 *
 * @param {http.ServerResponse} res 래핑 대상 응답 객체
 * @returns {void}
 */
function attachWidgetInjector(res) {
  const _writeHead = res.writeHead.bind(res);
  const _write = res.write.bind(res);
  const _end = res.end.bind(res);

  let isHtml = false;   // text/html 응답 여부 (버퍼링 ON)
  let decided = false;  // content-type 판정 완료 여부 (비HTML 확정 후 재검사 생략)
  const chunks = [];    // 버퍼링된 응답 청크

  /**
   * 캐시 버스팅 대상 content-type 판정.
   * JS/CSS/JSON은 배포 후 stale 캐시(옛 파일 재사용)를 막기 위해 `no-cache`(재사용 전 재검증)를
   * 강제한다. `no-store`가 아니므로 ETag/Last-Modified가 있는 Express 게임은 304 효율을 유지한다.
   * 바이너리(PNG/WOFF2 등)·HTML은 대상이 아니다(HTML은 기존 조건부헤더 제거+위젯 주입 로직 보존).
   * @param {string} ct content-type 문자열
   * @returns {boolean} 캐시 버스팅 대상 여부
   */
  const isCacheBustTarget = (ct) => {
    if (typeof ct !== 'string') return false;
    const lc = ct.toLowerCase();
    return lc.startsWith('application/javascript')
      || lc.startsWith('text/javascript')
      || lc.startsWith('text/css')
      || lc.startsWith('application/json');
  };

  /**
   * 응답이 text/html이면 isHtml=ON + Content-Length 제거.
   * JS/CSS/JSON이면 Cache-Control: no-cache 주입(헤더 전송 전, 미전송 상태에서만).
   * @param {string} ct content-type 문자열
   */
  const decideHtml = (ct) => {
    decided = true;
    if (typeof ct === 'string' && ct.toLowerCase().startsWith('text/html')) {
      isHtml = true;
      res.removeHeader('content-length');
    } else if (isCacheBustTarget(ct) && !res.headersSent) {
      // 응답 헤더가 아직 전송되지 않았을 때만 setHeader 가능.
      res.setHeader('Cache-Control', 'no-cache');
    }
  };

  res.writeHead = function (statusCode, reasonOrHeaders, maybeHeaders) {
    // writeHead(status, headers) 또는 writeHead(status, reason, headers) 시그니처 모두 지원
    const headers = (maybeHeaders && typeof maybeHeaders === 'object')
      ? maybeHeaders
      : (reasonOrHeaders && typeof reasonOrHeaders === 'object' ? reasonOrHeaders : null);

    // headers 인자 또는 이미 setHeader된 값에서 content-type 추출
    let ct = '';
    if (headers) {
      ct = headers['content-type'] || headers['Content-Type'] || '';
    }
    if (!ct) ct = res.getHeader('content-type') || '';

    decideHtml(String(ct));

    if (isHtml && headers) {
      // 인자로 넘어온 Content-Length도 제거 (삽입 후 길이 변경)
      delete headers['content-length'];
      delete headers['Content-Length'];
    }
    return _writeHead.apply(res, arguments);
  };

  res.write = function (chunk, encoding, callback) {
    // writeHead를 거치지 않은 경로(Express setHeader+write) 대비 첫 호출 시 재판정
    if (!decided) decideHtml(String(res.getHeader('content-type') || ''));
    if (!isHtml) return _write(chunk, encoding, callback);

    if (chunk) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding || 'utf8'));
    }
    if (typeof encoding === 'function') encoding();
    else if (typeof callback === 'function') callback();
    return true;
  };

  res.end = function (chunk, encoding, callback) {
    if (!decided) decideHtml(String(res.getHeader('content-type') || ''));
    if (!isHtml) return _end(chunk, encoding, callback);

    if (chunk && typeof chunk !== 'function') {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding || 'utf8'));
    }

    let body = Buffer.concat(chunks).toString('utf8');

    // 마지막 `</body>` 앞에 삽입 (대소문자 무시, 중첩 iframe 방어로 lastIndexOf)
    const idx = body.toLowerCase().lastIndexOf('</body>');
    if (idx !== -1) {
      body = body.slice(0, idx) + WIDGET_SNIPPET + body.slice(idx);
    } else {
      // `</body>` 없는 HTML 폴백: 끝에 append
      body += WIDGET_SNIPPET;
    }

    // 콜백 위치 정규화 (end(cb) / end(chunk, cb) / end(chunk, enc, cb))
    let cb = callback;
    if (typeof chunk === 'function') cb = chunk;
    else if (typeof encoding === 'function') cb = encoding;

    return _end(Buffer.from(body, 'utf8'), cb);
  };
}

// ── HTTP 서버 (통합 라우터) ─────────────────────────────────────
const server = http.createServer((req, res) => {
  // 콜백 최상단: 라우팅 이전에 위젯 주입기를 부착 (text/html 응답에만 실제 동작)
  attachWidgetInjector(res);

  // Express 정적 서빙(yutnori/tetris-battle)은 ETag/Last-Modified를 붙이므로, 브라우저가
  // 재방문 시 조건부 요청(If-None-Match)을 보내면 304(빈 본문)를 응답한다. 그러면 주입할
  // 본문이 없어 브라우저가 캐시된 "위젯 없는" HTML을 재사용하는 버그가 생긴다.
  // → HTML 문서 요청(Accept: text/html)에 한해 조건부 헤더를 제거해 항상 200+전체본문이
  //   나오게 강제한다(주입 보장). JS/CSS/PNG 등 정적 자산 요청은 그대로 두어 304 캐시 유지.
  if ((req.headers['accept'] || '').includes('text/html')) {
    delete req.headers['if-none-match'];
    delete req.headers['if-modified-since'];
  }

  const reqUrl = req.url || '/';
  const urlPath = reqUrl.split('?')[0];
  const queryStr = reqUrl.includes('?') ? reqUrl.slice(reqUrl.indexOf('?')) : '';
  const segments = urlPath.split('/').filter(Boolean);
  const first = segments[0] || '';

  // POST /bug-report — 버그 신고 수신 + bug-reports.jsonl append (게임 라우팅보다 먼저 처리)
  if (req.method === 'POST' && urlPath === '/bug-report') {
    let body = '';
    req.on('data', (chunk) => { body += chunk.toString(); });
    req.on('end', () => {
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch (_) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid JSON' }));
        return;
      }

      // 필수 필드 검증: text가 비어있으면 거부
      const text = (typeof parsed.text === 'string') ? parsed.text.trim() : '';
      if (!text) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'text is required' }));
        return;
      }

      const record = {
        text,
        gameId: typeof parsed.gameId === 'string' ? parsed.gameId : 'unknown',
        timestamp: typeof parsed.timestamp === 'string' ? parsed.timestamp : new Date().toISOString(),
        screenSize: (parsed.screenSize && typeof parsed.screenSize.w === 'number')
          ? { w: parsed.screenSize.w, h: parsed.screenSize.h }
          : null,
        url: typeof parsed.url === 'string' ? parsed.url : '',
      };

      const line = JSON.stringify(record) + '\n';
      const filePath = path.join(MINIGAMES_ROOT, 'bug-reports.jsonl');

      fs.appendFile(filePath, line, 'utf8', (err) => {
        if (err) {
          console.error('[launcher] bug-report appendFile 실패:', err.message);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'write failed' }));
          return;
        }
        console.log(`[launcher] bug-report 기록: gameId=${record.gameId}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
    });
    req.on('error', (err) => {
      console.error('[launcher] bug-report req 에러:', err.message);
      res.writeHead(500);
      res.end();
    });
    return;
  }

  // POST /lobby/return — 게임 완료 후 양쪽 로비 복귀
  if (req.method === 'POST' && urlPath === '/lobby/return') {
    res.writeHead(204);
    res.end();
    // 로비 상태 리셋
    currentMode = null;
    aiSlotCount = 0;
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
 * key: ws 객체, value: { id, role, name }
 *   - id: 'p1' | 'p2'  (입장 순서 기반)
 *   - role: 'host' | 'guest'
 *   - name: string|null  (JOIN 수신 전까지 null — 닉네임 게이트 통과 후 확정)
 * 최대 2명까지만 수용.
 * @type {Map<import('ws').WebSocket, { id: string, role: 'host'|'guest', name: string|null }>}
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

/**
 * 호스트가 설정한 목표 인원 수 (2~5).
 * SET_TARGET 메시지로 변경되며, 모든 클라이언트가 나가면 2(기본값)로 리셋된다.
 * @type {number}
 */
let targetPlayers = 2;

/**
 * AI로 채우기 슬롯 카운트.
 * targetPlayers - clients.size 만큼 최대 허용.
 * 실제 플레이어가 추가 입장할 때마다 1 감소.
 * 모든 클라이언트 퇴장 / REDIRECT / POST /lobby/return 시 0으로 리셋.
 * @type {number}
 */
let aiSlotCount = 0;

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
  // 접속자 목록 (이름 + 역할 + 온라인 여부). name은 JOIN 전까지 null.
  const players = [...clients.values()].map((m) => ({
    id: m.id,
    name: m.name,
    role: m.role,
    online: true,
  }));
  // AI 슬롯 presence 배열 생성
  const aiSlots = [];
  for (let i = 0; i < aiSlotCount; i++) {
    aiSlots.push({ id: `ai${i + 1}`, name: `\uD83E\uDD16 AI ${i + 1}`, online: true });
  }
  sendJson(ws, {
    type: 'LOBBY_STATE',
    count: clients.size,
    target: targetPlayers, // 다인용 확장: 목표 인원 수 (기본값 2, 후방호환)
    role: meta.role,
    hostId: hostEntry ? hostEntry.id : null,
    mode: currentMode,
    votes: votesSnapshot,
    players, // 신규: presence 목록 (기존 필드는 후방호환 유지)
    aiSlotCount,  // AI 채우기 슬롯 수
    aiSlots,      // AI 슬롯 presence 배열
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
 * AI 채우기용 봇을 spawn한다.
 * 기존 spawnBot()과 달리 mode=bot 쿼리를 URL에 부착한다.
 * @param {string} gameId games.json의 id
 */
function spawnBotForAiFill(gameId) {
  const botPath = path.join(MINIGAMES_ROOT, gameId, 'bot.js');
  if (!fs.existsSync(botPath)) {
    console.warn(`[launcher] bot.js 없음, AI 채우기 봇 생략: ${gameId}`);
    return;
  }
  const url = `ws://localhost:${PORT}/${gameId}/ws?mode=bot`;
  try {
    const child = spawn(process.execPath, [botPath, '--url', url], {
      detached: true,
      stdio: 'ignore',
    });
    child.on('error', (err) => {
      console.error(`[launcher] AI채우기 봇 spawn 에러 (${gameId}):`, err.message);
    });
    child.unref();
    console.log(`[launcher] AI채우기 봇 기동: ${gameId} --url ${url} (pid=${child.pid})`);
  } catch (err) {
    console.error(`[launcher] AI채우기 봇 spawn 예외 (${gameId}):`, err.message);
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
    case 'JOIN': {
      // 닉네임 게이트 통과 후 최초 송신. name 누락 시 '(알 수 없음)' 폴백(후방호환).
      const raw = typeof msg.name === 'string' ? msg.name.trim().slice(0, 12) : '';
      meta.name = raw || '(알 수 없음)';
      console.log(`[launcher] JOIN: ${meta.id} (${meta.role}) → "${meta.name}"`);
      // 자신을 제외한 기존 접속자에게 PLAYER_JOINED broadcast (입장 토스트용)
      for (const otherWs of clients.keys()) {
        if (otherWs !== ws) {
          sendJson(otherWs, { type: 'PLAYER_JOINED', name: meta.name, role: meta.role });
        }
      }
      // 전체에 LOBBY_STATE 재broadcast (players 배열에 확정된 name 반영)
      broadcastLobbyState();
      break;
    }

    case 'SET_TARGET': {
      // 호스트만 목표 인원 수를 설정할 수 있다
      if (meta.role !== 'host') return;
      const t = Number(msg.target);
      if (!Number.isInteger(t) || t < 2 || t > 5) {
        sendJson(ws, { type: 'ERROR', message: `목표 인원은 2~5 사이 정수여야 합니다 (received: ${msg.target})` });
        return;
      }
      // 현재 접속 인원이 목표보다 많으면 거부
      if (clients.size > t) {
        sendJson(ws, { type: 'ERROR', message: `현재 접속 인원(${clients.size})이 목표(${t})보다 많아 변경할 수 없습니다` });
        return;
      }
      targetPlayers = t;
      // 목표 인원 변경 시 AI 슬롯 리셋 (정원 불일치 방지)
      if (aiSlotCount > 0) {
        aiSlotCount = 0;
        console.log(`[launcher] SET_TARGET → aiSlotCount 리셋 (목표 인원 변경)`);
      }
      console.log(`[launcher] SET_TARGET: ${meta.id} → targetPlayers=${targetPlayers}`);
      broadcastLobbyState();
      break;
    }

    case 'PICK_GAME': {
      if (meta.role !== 'host') return;
      // 목표 인원 미달 시 게임 시작 불가.
      // targetPlayers=2(기본값)일 때는 1인도 허용 (AI 봇과 시작 가능, 하위 호환).
      // targetPlayers>=3이면 실제 인원 + AI 슬롯이 정원을 채워야만 시작 가능.
      const effectiveCount = clients.size + aiSlotCount;
      if (targetPlayers > 2 && effectiveCount < targetPlayers) {
        console.log(`[launcher] PICK_GAME 무시: 현재 ${effectiveCount}/${targetPlayers} (목표 미달, AI=${aiSlotCount})`);
        return;
      }
      const gameId = String(msg.gameId || '');
      const game = gamesMap.get(gameId);
      if (!game) {
        console.warn(`[launcher] PICK_GAME 알 수 없는 gameId: ${gameId}`);
        return;
      }
      // 모드 결정: targetPlayers=2이고 1인 단독이면 AI 모드 (기존 2인 AI 흐름 하위 호환).
      // targetPlayers>=3이거나 2인 이상 입장이면 human 모드 (다인 실제 대전).
      const isAiMode = targetPlayers <= 2 && clients.size === 1 && game.botAvailable;
      currentMode = isAiMode ? 'ai' : 'human';
      // AI 채우기 봇 spawn (aiSlotCount > 0이고 해당 게임이 봇 지원할 때)
      if (aiSlotCount > 0 && game.botAvailable) {
        console.log(`[launcher] AI채우기 봇 ${aiSlotCount}개 spawn 시작: ${gameId}`);
        for (let i = 0; i < aiSlotCount; i++) {
          spawnBotForAiFill(gameId);
        }
      }
      // REDIRECT 후 AI 슬롯 리셋 (게임 이동 후 로비 상태 정리)
      const spawnedAiCount = aiSlotCount;
      aiSlotCount = 0;
      // 통합 라우터: 같은 포트(3000) 내 `/{gameId}/`로 이동한다.
      const redirectPath = `/${gameId}/`;
      // playerCount에 AI 슬롯 포함하여 게임 서버에 전달
      const totalPlayerCount = clients.size + spawnedAiCount;
      console.log(`[launcher] PICK_GAME → gameId=${gameId}, path=${redirectPath}, mode=${currentMode}, playerCount=${totalPlayerCount} (human=${clients.size}, ai=${spawnedAiCount})`);
      broadcast({
        type: 'REDIRECT',
        gameId,
        path: redirectPath,
        mode: currentMode,
        playerCount: totalPlayerCount, // 다인용 확장: 실제 인원 + AI 봇 수
      });
      break;
    }

    case 'FILL_WITH_AI': {
      // 호스트만 AI 채우기 가능
      if (meta.role !== 'host') return;
      // 3인 이상 설정에서만 가능
      if (targetPlayers <= 2) {
        sendJson(ws, { type: 'ERROR', message: 'AI 채우기는 3인 이상 설정에서만 가능합니다' });
        return;
      }
      // 이미 정원이 채워져 있으면 무시
      const emptySlots = targetPlayers - clients.size - aiSlotCount;
      if (emptySlots <= 0) {
        sendJson(ws, { type: 'ERROR', message: '이미 정원이 채워져 있습니다' });
        return;
      }
      // 빈 슬롯 전체를 AI로 채움 (부분 채우기 미지원)
      aiSlotCount = targetPlayers - clients.size;
      console.log(`[launcher] FILL_WITH_AI: ${meta.id} → aiSlotCount=${aiSlotCount} (target=${targetPlayers}, clients=${clients.size})`);
      broadcastLobbyState();
      break;
    }

    case 'CANCEL_AI_FILL': {
      // 호스트만 AI 취소 가능
      if (meta.role !== 'host') return;
      aiSlotCount = 0;
      console.log(`[launcher] CANCEL_AI_FILL: ${meta.id} → aiSlotCount=0`);
      broadcastLobbyState();
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
  // 정원 초과: AI 슬롯 포함하여 판정
  if (clients.size + aiSlotCount >= targetPlayers) {
    // AI 슬롯이 있으면 실제 플레이어를 위해 AI 슬롯 1개 양보
    if (aiSlotCount > 0) {
      aiSlotCount -= 1;
      console.log(`[launcher] 실제 플레이어 입장 → AI 슬롯 1개 양보, aiSlotCount=${aiSlotCount}`);
    } else {
      sendJson(ws, { type: 'FULL', message: '현재 게임이 진행 중입니다. 잠시 후 다시 시도하세요.', target: targetPlayers });
      setTimeout(() => {
        try { ws.close(1000, 'FULL'); } catch (_) { /* noop */ }
      }, 50);
      console.log(`[launcher] FULL 거절 (정원 초과, 현재 ${clients.size}/${targetPlayers})`);
      return;
    }
  }

  // 역할 부여: 첫 번째 접속자 = 호스트
  const role = clients.size === 0 ? 'host' : 'guest';
  const id = `p${nextIdSeq}`;
  nextIdSeq += 1;
  // name은 JOIN 수신 전까지 null (닉네임 게이트 통과 후 확정)
  clients.set(ws, { id, role, name: null });
  console.log(`[launcher] 접속: ${id} (${role}), 현재 ${clients.size}/${targetPlayers} (ai=${aiSlotCount})`);

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
    console.log(`[launcher] 퇴장: ${departed.id} (${departed.role}), 잔여 ${clients.size}/${targetPlayers}`);

    // 잔여 접속자에게 퇴장 토스트용 PLAYER_LEFT broadcast (name 없으면 폴백)
    broadcast({ type: 'PLAYER_LEFT', name: departed.name || '(알 수 없음)' });

    if (clients.size === 0) {
      // 모두 나감 → 상태 리셋 (targetPlayers도 기본값 2로 복원)
      currentMode = null;
      nextIdSeq = 1;
      targetPlayers = 2;
      aiSlotCount = 0;
      votes.clear();
      return;
    }

    // 호스트가 떠난 경우: 게스트에게 RESET 후 호스트로 승격
    if (departed.role === 'host') {
      // 남아있는 게스트 모두에게 RESET 전송 (UI를 로비로)
      broadcast({ type: 'RESET' });
      currentMode = null;
      aiSlotCount = 0;
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
  console.log(ANSI.cyan + line(`  ${ANSI.dim}게임: /matgo/ /yutnori/ /tetris-battle/ /codenames-duet/ /davinci-code/ /janggi/ /hanabi/ /yahtzee/ /rummikub/ /omok/${ANSI.reset}`) + ANSI.reset);
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
