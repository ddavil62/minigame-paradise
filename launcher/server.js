/**
 * @fileoverview 미니게임 천국 런처 — 단일 포트(3000) 통합 라우터.
 *
 *   하나의 http.Server가 다음을 모두 처리한다:
 *     - `/` 및 `/games.json` → 런처 정적 파일 (launcher/public)
 *     - `/{gameId}/...` → 각 게임의 정적 파일 (game.public via createApp().handleHttp)
 *     - WS `/lobby/ws?gameId={gameId}` → 게임별 대기실 WSS
 *     - WS `/{gameId}/ws` → 각 게임 WSS (noServer 모드로 라우팅)
 *
 *   외부 의존성: ws@^8.18.0, express(yutnori/tetris-battle 한정)
 *
 * 로비 흐름 (v2 — 포탈 + 게임별 대기실):
 *   1. 클라이언트가 포탈 뷰에서 게임 카드 클릭 → `/lobby/ws?gameId={gameId}` WS 연결
 *   2. 대기실에서 전원 READY + 인원 >= minPlayers → REDIRECT broadcast
 *   3. 게임 완료 후 location.href='/' 로 포탈 복귀
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
import { createApp as createCodenamesClassicApp } from '../codenames/server.js';
import { createApp as createStarlightMailTowerApp } from '../starlight-mail-tower/server.js';
import { createApp as createMoonlightKitchenExpressApp } from '../moonlight-kitchen-express/server.js';
import { createApp as createVeneziaApp } from '../venezia/server.js';

// ── P0-A 안전망: WS 핸들러에서 빠져나온 예외가 런처 프로세스를 종료시키지 않게 한다.
// 각 게임 server.js의 null guard(1차 방어)로 정상 경로는 차단되며,
// 이 핸들러는 예상치 못한 예외만 최후 방어한다.
// 주의: 모든 예외를 삼키면 디버깅이 어려워지므로 에러 정보를 반드시 stderr에 출력한다.
process.on('uncaughtException', (err, origin) => {
  console.error(`[launcher] uncaughtException (origin=${origin}):`, err);
  // 프로세스를 종료하지 않고 계속 실행한다.
  // 게임 서버별 WS 핸들러 내부의 예외만 이 경로로 유입됨을 기대한다.
});

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

// ── 통합 라우터: 10개 게임 앱 인스턴스 ────────────────────────────
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
  // 코드네임 클래식 — 봇 지원 (2026-06-28 P-C 추가). role_select 단계에서 호스트가
  // FILL_WITH_AI(또는 mode=ai)로 빈 (팀,역할) 슬롯을 봇으로 채운다. 게임 서버의
  // spawnBotForSlot이 이 URL에 &team=&role=을 덧붙여 슬롯별 봇을 spawn 한다.
  'codenames':      createCodenamesClassicApp({
    getBotUrl: () => `ws://localhost:${PORT}/codenames/ws?mode=bot`,
  }),
  'starlight-mail-tower': createStarlightMailTowerApp(),
  'moonlight-kitchen-express': createMoonlightKitchenExpressApp({ testing: process.env.KITCHEN_E2E === '1' }),
  // 베네치아 타이핑 배틀 — 봇 지원 (2026-07-19 추가).
  'venezia': createVeneziaApp({
    getBotUrl: () => `ws://localhost:${PORT}/venezia/ws?mode=bot`,
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
 * 대기실 gameId 검증 및 게임 메타 참조에 사용.
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

// ── 게임별 대기실 상태 (rooms) ─────────────────────────────────
/**
 * 게임별 대기실 상태.
 * key: gameId, value: RoomState
 *
 * @typedef {Object} RoomState
 * @property {string} gameId                         - gamesMap 키와 동일
 * @property {Map<import('ws').WebSocket, PlayerMeta>} clients - 입장 중인 WS 클라이언트
 * @property {number} nextIdSeq                      - 다음 부여할 플레이어 번호 (1~)
 * @property {number} aiSlotCount                    - AI 채우기 슬롯 수 (0~maxPlayers-1)
 *
 * @typedef {Object} PlayerMeta
 * @property {string} id          - 'p1', 'p2', ...
 * @property {string|null} name   - 닉네임 (JOIN 수신 전 null)
 * @property {boolean} ready      - READY 상태
 * @property {NodeJS.Timeout|null} kickTimer - 타임아웃 킥 타이머 핸들
 *
 * @type {Map<string, RoomState>}
 */
const rooms = new Map();

/** 대기실 READY 타임아웃 (60초). 입장 후 이 시간 안에 READY 하지 않으면 자동 퇴장. */
const READY_TIMEOUT_MS = 60_000;

// ── 런처 대기실 WebSocket 서버 (noServer 모드) ──────────────────────
const roomWss = new WebSocketServer({ noServer: true });

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
 * 대기실이 없으면 빈 RoomState를 생성해 반환한다.
 * gameId가 gamesMap에 없으면 null 반환.
 * @param {string} gameId games.json의 id
 * @returns {RoomState|null}
 */
function getOrCreateRoom(gameId) {
  if (!gamesMap.has(gameId)) return null;
  if (!rooms.has(gameId)) {
    rooms.set(gameId, {
      gameId,
      clients: new Map(),
      nextIdSeq: 1,
      aiSlotCount: 0,
    });
  }
  return rooms.get(gameId);
}

/**
 * 특정 클라이언트에게 ROOM_STATE를 보낸다.
 * 수신자별로 myId/myReady 필드가 달라지므로 개별 전송한다.
 * @param {import('ws').WebSocket} ws 대상 클라이언트
 * @param {RoomState} room 대기실
 */
function sendRoomStateTo(ws, room) {
  const meta = room.clients.get(ws);
  if (!meta) return;

  const game = gamesMap.get(room.gameId);
  if (!game) return;

  // 플레이어 목록 구성 (Map 순서 = 입장 순서, 첫 번째 = 호스트)
  const players = [];
  let isFirst = true;
  let readyCount = 0;
  for (const [, m] of room.clients) {
    if (m.ready) readyCount++;
    players.push({
      id: m.id,
      name: m.name || '(입장 중...)',
      ready: m.ready,
      isHost: isFirst,
    });
    isFirst = false;
  }

  // AI 슬롯 배열 구성
  const aiSlots = [];
  for (let i = 0; i < room.aiSlotCount; i++) {
    aiSlots.push({ id: `ai${i + 1}`, name: `AI ${i + 1}` });
  }

  const totalCount = room.clients.size + room.aiSlotCount;
  // canStart: 전원 ready AND 인원 >= minPlayers
  const allReady = room.clients.size > 0 && [...room.clients.values()].every(m => m.ready);
  const canStart = allReady && totalCount >= game.minPlayers;

  sendJson(ws, {
    type: 'ROOM_STATE',
    gameId: room.gameId,
    players,
    aiSlots,
    readyCount,
    totalCount,
    minPlayers: game.minPlayers,
    maxPlayers: game.maxPlayers,
    myId: meta.id,
    myReady: meta.ready,
    canStart,
  });
}

/**
 * 대기실의 모든 클라이언트에게 ROOM_STATE를 브로드캐스트한다.
 * @param {RoomState} room 대기실
 */
function broadcastRoomState(room) {
  for (const ws of room.clients.keys()) {
    sendRoomStateTo(ws, room);
  }
}

/**
 * 게임 시작 조건을 평가하고, 충족 시 REDIRECT를 브로드캐스트한다.
 *   - 조건1: 대기실 입장 전원이 READY 상태
 *   - 조건2: 실인원 + AI 슬롯 >= minPlayers
 * @param {RoomState} room 대기실
 * @param {object} game gamesMap의 게임 메타
 */
function checkReady(room, game) {
  // 빈 방은 시작 불가
  if (room.clients.size === 0) return;

  const allReady = [...room.clients.values()].every(m => m.ready);
  const totalCount = room.clients.size + room.aiSlotCount;

  if (!allReady || totalCount < game.minPlayers) return;

  // ── 게임 시작 시퀀스 ──
  console.log(`[launcher] 게임 시작: ${room.gameId} (인원=${totalCount}, AI=${room.aiSlotCount})`);

  // 1. 모든 킥 타이머 취소
  for (const [, m] of room.clients) {
    if (m.kickTimer) {
      clearTimeout(m.kickTimer);
      m.kickTimer = null;
    }
  }

  // 2. AI 봇 spawn (aiSlotCount > 0 && botAvailable)
  if (room.aiSlotCount > 0 && game.botAvailable) {
    console.log(`[launcher] AI채우기 봇 ${room.aiSlotCount}개 spawn: ${room.gameId}`);
    for (let i = 0; i < room.aiSlotCount; i++) {
      spawnBotForAiFill(room.gameId);
    }
  }

  // 3. REDIRECT broadcast
  const redirectPath = `/${room.gameId}/`;
  const playerCount = totalCount;

  for (const [ws, meta] of room.clients) {
    sendJson(ws, {
      type: 'REDIRECT',
      gameId: room.gameId,
      path: redirectPath,
      mode: 'human',
      playerCount,
      role: meta.id === 'p1' ? 'p1' : 'p2',
      transitionMs: 300,
    });
  }

  // 4. 대기실 정리
  rooms.delete(room.gameId);
  console.log(`[launcher] REDIRECT → gameId=${room.gameId}, path=${redirectPath}, mode=human, playerCount=${playerCount}`);
}

/**
 * 클라이언트 퇴장 처리 (나가기/disconnect/킥 공통).
 * @param {import('ws').WebSocket} ws 퇴장 클라이언트
 * @param {RoomState} room 대기실
 */
function cleanupClient(ws, room) {
  const meta = room.clients.get(ws);
  if (!meta) return;

  // 킥 타이머 취소
  if (meta.kickTimer) {
    clearTimeout(meta.kickTimer);
    meta.kickTimer = null;
  }

  room.clients.delete(ws);
  console.log(`[launcher] 퇴장: ${meta.id} (${meta.name || '?'}), 방=${room.gameId}, 잔여=${room.clients.size}`);

  // 빈 방 제거
  if (room.clients.size === 0) {
    rooms.delete(room.gameId);
    console.log(`[launcher] 빈 방 제거: ${room.gameId}`);
    return;
  }

  // 남은 플레이어가 있으면 AI 슬롯 리셋 (호스트가 바뀔 수 있으므로)
  // 호스트 재판정은 Map 순서 첫 번째가 자동으로 호스트 (broadcastRoomState에서 반영)
  // AI 슬롯은 유지 (퇴장으로 인한 자동 리셋은 하지 않음)
  broadcastRoomState(room);
}

/**
 * AI 채우기용 봇을 spawn한다.
 * mode=bot 쿼리를 URL에 부착한다.
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
 * @param {RoomState} room 대기실
 */
function handleMessage(ws, msg, room) {
  const meta = room.clients.get(ws);
  if (!meta) return;

  const game = gamesMap.get(room.gameId);
  if (!game) return;

  switch (msg.type) {
    case 'JOIN': {
      // 닉네임 게이트 통과 후 최초 송신. name 누락 시 '(알 수 없음)' 폴백.
      const raw = typeof msg.name === 'string' ? msg.name.trim().slice(0, 12) : '';
      meta.name = raw || '(알 수 없음)';
      console.log(`[launcher] JOIN: ${meta.id} → "${meta.name}" (방=${room.gameId})`);
      broadcastRoomState(room);
      break;
    }

    case 'READY': {
      // 준비 토글
      meta.ready = !meta.ready;
      console.log(`[launcher] READY: ${meta.id} → ready=${meta.ready} (방=${room.gameId})`);

      if (meta.ready) {
        // 킥 타이머 취소
        if (meta.kickTimer) {
          clearTimeout(meta.kickTimer);
          meta.kickTimer = null;
        }
      } else {
        // 준비 취소 시 킥 타이머 재시작
        if (meta.kickTimer) clearTimeout(meta.kickTimer);
        meta.kickTimer = setTimeout(() => {
          console.log(`[launcher] 타임아웃 킥: ${meta.id} (${meta.name || '?'}) (방=${room.gameId})`);
          sendJson(ws, { type: 'KICKED', reason: 'timeout' });
          try { ws.close(1000, 'KICKED'); } catch (_) { /* noop */ }
          cleanupClient(ws, room);
        }, READY_TIMEOUT_MS);
      }

      // 최종 READY 상태를 먼저 보여 준 뒤 게임 시작 전환을 전달한다.
      broadcastRoomState(room);
      checkReady(room, game);
      break;
    }

    case 'LEAVE_ROOM': {
      cleanupClient(ws, room);
      try { ws.close(1000, 'LEAVE_ROOM'); } catch (_) { /* noop */ }
      break;
    }

    case 'FILL_WITH_AI': {
      // 호스트만 AI 채우기 가능 (Map 첫 번째 항목)
      const firstEntry = room.clients.entries().next().value;
      if (!firstEntry || firstEntry[0] !== ws) {
        sendJson(ws, { type: 'ERROR', message: '호스트만 AI 채우기를 할 수 있습니다.' });
        return;
      }

      // botAvailable 검증
      if (!game.botAvailable) {
        sendJson(ws, { type: 'ERROR', message: '이 게임은 AI 봇을 지원하지 않습니다.' });
        return;
      }

      // botMaxPlayers 검증: AI 봇이 지원하는 최대 인원보다 방 정원이 크면 AI 채우기 불가.
      // (예: 윷놀이는 maxPlayers=4지만 봇은 2인 대전만 지원 → 4인 AI채우기 시 게임 서버가
      //  봇 spawn을 스킵해 방이 채워지지 않고 멈춘다. 게임 진입 전에 안내로 막는다.)
      // AI 채우기는 빈 슬롯을 전부 채워 항상 maxPlayers명으로 시작하므로 maxPlayers 기준으로 판정.
      if (typeof game.botMaxPlayers === 'number' && game.maxPlayers > game.botMaxPlayers) {
        sendJson(ws, {
          type: 'ERROR',
          message: `${game.name} ${game.maxPlayers}인 AI 대전은 지원하지 않습니다. ${game.botMaxPlayers}인 AI 대전만 가능합니다.`,
        });
        console.log(`[launcher] FILL_WITH_AI 거부: ${room.gameId} (maxPlayers=${game.maxPlayers} > botMaxPlayers=${game.botMaxPlayers})`);
        return;
      }

      // 빈 슬롯 전체를 AI로 채움
      const emptySlots = game.maxPlayers - room.clients.size - room.aiSlotCount;
      if (emptySlots <= 0) {
        sendJson(ws, { type: 'ERROR', message: '이미 정원이 채워져 있습니다.' });
        return;
      }

      room.aiSlotCount = game.maxPlayers - room.clients.size;
      console.log(`[launcher] FILL_WITH_AI: ${meta.id} → aiSlotCount=${room.aiSlotCount} (방=${room.gameId})`);

      // 게임 시작 조건 즉시 평가
      checkReady(room, game);

      // REDIRECT로 방이 삭제되지 않았으면 상태 브로드캐스트
      if (rooms.has(room.gameId)) {
        broadcastRoomState(room);
      }
      break;
    }

    default:
      // 미정의 메시지 무시
      break;
  }
}

/**
 * 신규 WS 연결 처리 (대기실 입장).
 * URL 쿼리의 gameId를 기반으로 방에 배정한다.
 */
roomWss.on('connection', (ws, req) => {
  // URL에서 gameId 추출
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const gameId = url.searchParams.get('gameId') || '';

  const game = gamesMap.get(gameId);
  if (!game) {
    console.warn(`[launcher] 대기실 연결 거부: 알 수 없는 gameId="${gameId}"`);
    try { ws.close(1008, 'INVALID_GAME'); } catch (_) { /* noop */ }
    return;
  }

  const room = getOrCreateRoom(gameId);
  if (!room) {
    try { ws.close(1008, 'INVALID_GAME'); } catch (_) { /* noop */ }
    return;
  }

  // 정원 검사: 실인원 + AI 슬롯 >= maxPlayers
  if (room.clients.size + room.aiSlotCount >= game.maxPlayers) {
    sendJson(ws, { type: 'ROOM_FULL', gameId, maxPlayers: game.maxPlayers });
    setTimeout(() => {
      try { ws.close(1000, 'ROOM_FULL'); } catch (_) { /* noop */ }
    }, 50);
    console.log(`[launcher] ROOM_FULL: ${gameId} (${room.clients.size}+${room.aiSlotCount}/${game.maxPlayers})`);
    return;
  }

  // 플레이어 등록
  const id = `p${room.nextIdSeq}`;
  room.nextIdSeq += 1;

  /** @type {PlayerMeta} */
  const meta = {
    id,
    name: null,
    ready: false,
    kickTimer: null,
  };

  room.clients.set(ws, meta);
  console.log(`[launcher] 대기실 입장: ${id} (방=${gameId}), 현재 ${room.clients.size}/${game.maxPlayers} (ai=${room.aiSlotCount})`);

  // 60초 킥 타이머 시작
  meta.kickTimer = setTimeout(() => {
    console.log(`[launcher] 타임아웃 킥: ${meta.id} (${meta.name || '?'}) (방=${room.gameId})`);
    sendJson(ws, { type: 'KICKED', reason: 'timeout' });
    try { ws.close(1000, 'KICKED'); } catch (_) { /* noop */ }
    cleanupClient(ws, room);
  }, READY_TIMEOUT_MS);

  // 전체에 상태 브로드캐스트
  broadcastRoomState(room);

  // 메시지 수신
  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch (err) {
      console.warn('[launcher] 잘못된 JSON 무시:', err.message);
      return;
    }
    handleMessage(ws, msg, room);
  });

  ws.on('close', () => {
    cleanupClient(ws, room);
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

  // /lobby/ws → 게임별 대기실 WSS (쿼리에서 gameId 추출)
  if (segments.length === 2 && segments[0] === 'lobby' && segments[1] === 'ws') {
    roomWss.handleUpgrade(req, socket, head, (ws) => {
      roomWss.emit('connection', ws, req);
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
  console.log(ANSI.cyan + line(`  ${ANSI.dim}게임 14종: /venezia/ 포함${ANSI.reset}`) + ANSI.reset);
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
