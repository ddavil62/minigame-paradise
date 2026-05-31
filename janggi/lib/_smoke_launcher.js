/**
 * @fileoverview P3 런처 통합 스모크 테스트.
 *
 * launcher/server.js를 백그라운드로 기동한 뒤, 다음 5가지를 자동 검증한다:
 *   1. GET /games.json 에 janggi 항목이 존재
 *   2. GET /janggi/ 가 200 OK
 *   3. GET /janggi/css/style.css 가 200 OK
 *   4. GET /janggi/js/main.js 가 200 OK
 *   5. WS /janggi/ws 핸드셰이크 성공 (JOINED 메시지 수신)
 *
 * 사용법: node janggi/lib/_smoke_launcher.js
 * 실행 위치: minigame-paradise/ 디렉토리
 */

import http from 'http';
import { WebSocket } from 'ws';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 13999; // 충돌 방지용 임시 포트
const BASE = `http://localhost:${PORT}`;
const LAUNCHER_PATH = path.join(__dirname, '..', '..', 'launcher', 'server.js');

let pass = 0;
let fail = 0;
let serverProc = null;

/**
 * 테스트 결과를 기록한다.
 * @param {string} label
 * @param {boolean} ok
 * @param {string} [detail]
 */
function report(label, ok, detail) {
  if (ok) {
    pass += 1;
    console.log(`  PASS: ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

/**
 * HTTP GET 요청을 보내고 상태 코드와 본문을 반환한다.
 * @param {string} urlStr
 * @returns {Promise<{status: number, body: string}>}
 */
function httpGet(urlStr) {
  return new Promise((resolve, reject) => {
    const req = http.get(urlStr, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

/**
 * WS 핸드셰이크를 시도하고 첫 메시지를 반환한다.
 * @param {string} url
 * @returns {Promise<object>}
 */
function wsConnect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('WS timeout'));
    }, 5000);
    ws.on('message', (data) => {
      clearTimeout(timer);
      try {
        const msg = JSON.parse(data.toString());
        ws.close();
        resolve(msg);
      } catch (e) {
        ws.close();
        reject(e);
      }
    });
    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * 서버가 준비될 때까지 폴링한다.
 * @param {number} maxRetries
 * @param {number} delayMs
 * @returns {Promise<void>}
 */
async function waitForServer(maxRetries = 20, delayMs = 500) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await httpGet(`${BASE}/games.json`);
      return;
    } catch (_) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  throw new Error(`서버 시작 대기 실패 (${maxRetries * delayMs}ms)`);
}

// ── 메인 ──────────────────────────────────────────────────────────

async function main() {
  console.log(`\n[P3 스모크] 런처 기동 중 (port=${PORT})...\n`);

  // 런처 서버 백그라운드 기동
  serverProc = spawn(process.execPath, [LAUNCHER_PATH, '--port', String(PORT)], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // 서버 stderr 에러 감시
  let stderrBuf = '';
  serverProc.stderr.on('data', (d) => { stderrBuf += d.toString(); });

  try {
    await waitForServer();
    console.log('[P3 스모크] 서버 준비 완료\n');

    // TEST 1: games.json에 janggi 항목 존재
    {
      const { status, body } = await httpGet(`${BASE}/games.json`);
      const games = JSON.parse(body);
      const janggi = games.find(g => g.id === 'janggi');
      report('GET /games.json → janggi 항목 존재', !!janggi);
      if (janggi) {
        report('games.json janggi.color === "#C8102E"', janggi.color === '#C8102E');
        report('games.json janggi.botAvailable === false', janggi.botAvailable === false);
        report('games.json janggi.httpPath === "/janggi/"', janggi.httpPath === '/janggi/');
        report('games.json janggi.wsPath === "/janggi/ws"', janggi.wsPath === '/janggi/ws');
        report('games.json janggi.port === 3006', janggi.port === 3006);
        report('games.json janggi.emoji === "\\u265F"', janggi.emoji === '\u265F');
      }
    }

    // TEST 2: GET /janggi/ → 200
    {
      const { status } = await httpGet(`${BASE}/janggi/`);
      report('GET /janggi/ → 200', status === 200);
    }

    // TEST 3: GET /janggi/css/style.css → 200
    {
      const { status, body } = await httpGet(`${BASE}/janggi/css/style.css`);
      report('GET /janggi/css/style.css → 200', status === 200);
      report('/janggi/css/style.css 내용에 --janggi-han-primary 포함',
        body.includes('--janggi-han-primary'));
    }

    // TEST 4: GET /janggi/js/main.js → 200
    {
      const { status } = await httpGet(`${BASE}/janggi/js/main.js`);
      report('GET /janggi/js/main.js → 200', status === 200);
    }

    // TEST 5: WS /janggi/ws 핸드셰이크 + JOINED 수신
    {
      try {
        const msg = await wsConnect(`ws://localhost:${PORT}/janggi/ws`);
        report('WS /janggi/ws → JOINED 메시지 수신', msg.type === 'JOINED');
        report('WS JOINED.side === "han" (첫 접속자 = 한)', msg.side === 'han');
        report('WS JOINED.waiting === true (1/2)', msg.waiting === true);
      } catch (err) {
        report('WS /janggi/ws 핸드셰이크', false, err.message);
      }
    }

    // TEST 6: 기존 5개 게임 라우팅 건재 확인 (회귀 방지)
    {
      const existingGames = ['codenames-duet', 'davinci-code', 'matgo', 'yutnori', 'tetris-battle'];
      for (const gameId of existingGames) {
        const { status } = await httpGet(`${BASE}/${gameId}/`);
        report(`GET /${gameId}/ → 200 (회귀 방지)`, status === 200);
      }
    }

  } catch (err) {
    console.error(`\n[P3 스모크] 치명적 에러: ${err.message}`);
    if (stderrBuf) console.error(`서버 stderr:\n${stderrBuf}`);
    fail += 1;
  } finally {
    // 서버 종료
    if (serverProc && !serverProc.killed) {
      serverProc.kill('SIGTERM');
      // Windows에서 SIGTERM이 안 먹을 수 있으므로 fallback
      setTimeout(() => {
        try { serverProc.kill('SIGKILL'); } catch (_) { /* noop */ }
      }, 2000);
    }
  }

  console.log(`\n[P3 스모크] 결과: ${pass} PASS / ${fail} FAIL (총 ${pass + fail})\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
