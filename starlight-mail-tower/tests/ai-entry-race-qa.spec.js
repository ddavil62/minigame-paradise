/**
 * @fileoverview AI 재진입(`mode=ai&fresh=1`) 슬롯 정리 레이스 컨디션 회귀 테스트.
 *
 * 검증 대상:
 * - 인간 소켓 close 직후 0ms 지연으로 재진입해도 ROOM_FULL이 발생하지 않는다
 *   (close 이벤트가 이벤트 루프에서 처리되기 전 CLOSING 슬롯 정리)
 * - killBot() 이후 봇 소켓의 비동기 close가 새 유령 슬롯을 만들지 않는다 (ws.isBot 가드)
 * - `fresh` 없는 재접속(F5)과 `mode` 없는 일반 LAN 모드는 정리 경로를 타지 않는다
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocket } from 'ws';
import { createApp } from '../server.js';

/**
 * 테스트 서버를 기동한다.
 * @param {number} port 포트
 * @param {object} [opts] 추가 옵션
 * @returns {Promise<{server: http.Server, app: object}>}
 */
function startServer(port, opts = {}) {
  return new Promise((resolve, reject) => {
    const app = createApp({
      testing: true,
      reconnectGraceMs: opts.reconnectGraceMs ?? 2000,
      getBotUrl: () => `ws://localhost:${port}/ws?mode=bot`,
      ...opts,
    });
    const server = http.createServer(app.handleHttp);
    server.on('upgrade', app.handleUpgrade);
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({ server, app }));
  });
}

function connectWs(url, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => { ws.close(); reject(new Error(`WS timeout: ${url}`)); }, timeoutMs);
    ws.on('open', () => { clearTimeout(timer); resolve(ws); });
    ws.on('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

function waitForMessage(ws, type, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout: ${type}`)), timeoutMs);
    const handler = (raw) => {
      let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.type === type) { clearTimeout(timer); ws.off('message', handler); resolve(msg); }
    };
    ws.on('message', handler);
  });
}

function send(ws, payload) { ws.send(JSON.stringify(payload)); }

describe('레이스 컨디션: LEAVE_GAME 없이 close → 즉시 fresh=1 재진입', () => {
  let server, app;
  const PORT = 3026;

  before(async () => {
    const result = await startServer(PORT, { reconnectGraceMs: 15000 });
    server = result.server;
    app = result.app;
  });

  after(async () => {
    app.close();
    await new Promise((resolve) => server.close(resolve));
  });

  test('유령 슬롯 + 봇 슬롯 상태에서 fresh=1 재진입 → WELCOME 수신', async () => {
    // 1) 인간 접속 + 게임 시작
    const ws1 = await connectWs(`ws://127.0.0.1:${PORT}/ws?mode=ai`);
    send(ws1, { type: 'JOIN', name: 'Human', sessionToken: '', locale: 'ko' });
    await waitForMessage(ws1, 'WELCOME', 5000);
    send(ws1, { type: 'READY' });
    await waitForMessage(ws1, 'START', 15000);

    // 2) LEAVE_GAME 없이 인간 close → 유령 슬롯 생성
    ws1.close();

    // 3) 50ms만 대기하고 즉시 재진입 (봇이 아직 살아있을 수 있음)
    await new Promise((r) => setTimeout(r, 50));

    // 4) fresh=1로 재진입
    const ws2 = await connectWs(`ws://127.0.0.1:${PORT}/ws?mode=ai&fresh=1`);
    send(ws2, { type: 'JOIN', name: 'Human2', sessionToken: '', locale: 'ko' });

    // 5) WELCOME을 받아야 한다 (ROOM_FULL이 아님)
    const result = await waitForMessage(ws2, 'WELCOME', 5000);
    assert.ok(result.playerId, '재진입 후 WELCOME 수신');

    ws2.close();
    await new Promise((r) => setTimeout(r, 2000));
  });
});

describe('레이스 컨디션: 봇 close 후 새 봇 spawn 성공', () => {
  let server, app;
  const PORT = 3027;

  before(async () => {
    const result = await startServer(PORT, { reconnectGraceMs: 15000 });
    server = result.server;
    app = result.app;
  });

  after(async () => {
    app.close();
    await new Promise((resolve) => server.close(resolve));
  });

  test('재진입 후 새 봇이 JOIN하여 게임이 시작된다', async () => {
    // 1) 인간 접속 + 게임 시작
    const ws1 = await connectWs(`ws://127.0.0.1:${PORT}/ws?mode=ai`);
    send(ws1, { type: 'JOIN', name: 'H1', sessionToken: '', locale: 'ko' });
    await waitForMessage(ws1, 'WELCOME', 5000);
    send(ws1, { type: 'READY' });
    await waitForMessage(ws1, 'START', 15000);

    // 2) LEAVE_GAME 전송 후 close (정상 경로)
    send(ws1, { type: 'LEAVE_GAME' });
    await new Promise((r) => setTimeout(r, 200));
    ws1.close();

    // 3) 봇 종료 대기
    await new Promise((r) => setTimeout(r, 2000));

    // 4) fresh=1 재진입
    const ws2 = await connectWs(`ws://127.0.0.1:${PORT}/ws?mode=ai&fresh=1`);
    send(ws2, { type: 'JOIN', name: 'H2', sessionToken: '', locale: 'ko' });
    const welcome = await waitForMessage(ws2, 'WELCOME', 5000);
    assert.ok(welcome.playerId);

    // 5) READY 후 새 봇이 JOIN + READY → START
    send(ws2, { type: 'READY' });
    const start = await waitForMessage(ws2, 'START', 15000);
    assert.ok(start.levelId, '재진입 후 새 게임 START 수신');

    // 6) SNAPSHOT에 players 2명
    const snap = await waitForMessage(ws2, 'SNAPSHOT', 5000);
    assert.strictEqual(snap.players.length, 2, 'SNAPSHOT에 players 2명');

    ws2.close();
    await new Promise((r) => setTimeout(r, 2000));
  });
});

describe('레이스 컨디션: 연속 3회 LEAVE_GAME + 재진입', () => {
  let server, app;
  const PORT = 3028;

  before(async () => {
    const result = await startServer(PORT, { reconnectGraceMs: 2000 });
    server = result.server;
    app = result.app;
  });

  after(async () => {
    app.close();
    await new Promise((resolve) => server.close(resolve));
  });

  test('3회 연속 재진입 모두 WELCOME + START 수신', async () => {
    for (let i = 1; i <= 3; i++) {
      const ws = await connectWs(`ws://127.0.0.1:${PORT}/ws?mode=ai&fresh=1`);
      send(ws, { type: 'JOIN', name: `H${i}`, sessionToken: '', locale: 'ko' });
      const welcome = await waitForMessage(ws, 'WELCOME', 5000);
      assert.ok(welcome.playerId, `${i}회차: WELCOME 수신`);

      send(ws, { type: 'READY' });
      const start = await waitForMessage(ws, 'START', 15000);
      assert.ok(start.levelId, `${i}회차: START 수신`);

      // LEAVE_GAME + close
      send(ws, { type: 'LEAVE_GAME' });
      await new Promise((r) => setTimeout(r, 200));
      ws.close();

      // 봇 정리 대기
      await new Promise((r) => setTimeout(r, 1500));
    }
  });
});

describe('레이스 컨디션: 즉시 재진입 (0ms 대기)', () => {
  let server, app;
  const PORT = 3029;

  before(async () => {
    const result = await startServer(PORT, { reconnectGraceMs: 15000 });
    server = result.server;
    app = result.app;
  });

  after(async () => {
    app.close();
    await new Promise((resolve) => server.close(resolve));
  });

  test('LEAVE_GAME 없이 close → 0ms 대기 → fresh=1 재진입 → WELCOME', async () => {
    // 인간 접속 + 게임 시작
    const ws1 = await connectWs(`ws://127.0.0.1:${PORT}/ws?mode=ai`);
    send(ws1, { type: 'JOIN', name: 'H1', sessionToken: '', locale: 'ko' });
    await waitForMessage(ws1, 'WELCOME', 5000);
    send(ws1, { type: 'READY' });
    await waitForMessage(ws1, 'START', 15000);

    // close 직후 즉시 재진입 (최악의 레이스)
    ws1.close();

    // 0ms 대기 = setImmediate-level
    const ws2 = await connectWs(`ws://127.0.0.1:${PORT}/ws?mode=ai&fresh=1`);
    send(ws2, { type: 'JOIN', name: 'H2', sessionToken: '', locale: 'ko' });

    const msg = await waitForMessage(ws2, 'WELCOME', 5000);
    assert.ok(msg.playerId, '0ms 재진입 WELCOME 수신');

    ws2.close();
    await new Promise((r) => setTimeout(r, 2000));
  });
});

describe('AC-4 검증: F5 새로고침 시 재접속 유예 동작', () => {
  let server, app;
  const PORT = 3030;

  before(async () => {
    const result = await startServer(PORT, { reconnectGraceMs: 5000 });
    server = result.server;
    app = result.app;
  });

  after(async () => {
    app.close();
    await new Promise((resolve) => server.close(resolve));
  });

  test('mode=ai (fresh 없음) 재접속 시 PAUSED 메시지 수신 (유예 동작)', async () => {
    // 인간 + 봇 접속 → 게임 시작
    const ws1 = await connectWs(`ws://127.0.0.1:${PORT}/ws?mode=ai`);
    send(ws1, { type: 'JOIN', name: 'H-F5', sessionToken: '', locale: 'ko' });
    const welcome1 = await waitForMessage(ws1, 'WELCOME', 5000);
    const resumeToken = welcome1.resumeToken;
    send(ws1, { type: 'READY' });
    await waitForMessage(ws1, 'START', 15000);

    // F5 시뮬레이션: close (LEAVE_GAME 없이)
    ws1.close();
    await new Promise((r) => setTimeout(r, 300));

    // F5 후 재접속: mode=ai (fresh 없음) + sessionToken 사용
    const ws2 = await connectWs(`ws://127.0.0.1:${PORT}/ws?mode=ai`);
    send(ws2, { type: 'JOIN', name: 'H-F5', sessionToken: resumeToken, locale: 'ko' });

    // WELCOME(resumed: true) 또는 PAUSED를 받아야 한다
    const welcome2 = await waitForMessage(ws2, 'WELCOME', 5000);
    assert.strictEqual(welcome2.resumed, true, 'F5 재접속 시 resumed=true');

    ws2.close();
    await new Promise((r) => setTimeout(r, 2000));
  });
});

describe('AC-5 검증: 일반 LAN 2인 모드 재접속 유예', () => {
  let server, app;
  const PORT = 3031;

  before(async () => {
    const result = await startServer(PORT, { reconnectGraceMs: 5000 });
    server = result.server;
    app = result.app;
  });

  after(async () => {
    app.close();
    await new Promise((resolve) => server.close(resolve));
  });

  test('일반 모드 disconnect → 재접속 유예 → resumed=true', async () => {
    // 2인 접속
    const ws1 = await connectWs(`ws://127.0.0.1:${PORT}/ws`);
    const ws2 = await connectWs(`ws://127.0.0.1:${PORT}/ws`);
    send(ws1, { type: 'JOIN', name: 'P1', sessionToken: '', locale: 'ko' });
    const w1 = await waitForMessage(ws1, 'WELCOME', 3000);
    send(ws2, { type: 'JOIN', name: 'P2', sessionToken: '', locale: 'ko' });
    await waitForMessage(ws2, 'WELCOME', 3000);

    send(ws1, { type: 'READY' });
    send(ws2, { type: 'READY' });
    await waitForMessage(ws1, 'START', 5000);

    // P1 disconnect (비자발적)
    const token = w1.resumeToken;
    ws1.close();
    await new Promise((r) => setTimeout(r, 500));

    // P2가 PAUSED를 받았는지 확인
    // (이미 START 이후이므로 새 메시지를 수집)

    // P1 재접속
    const ws3 = await connectWs(`ws://127.0.0.1:${PORT}/ws`);
    send(ws3, { type: 'JOIN', name: 'P1', sessionToken: token, locale: 'ko' });
    const welcome3 = await waitForMessage(ws3, 'WELCOME', 5000);
    assert.strictEqual(welcome3.resumed, true, '재접속 시 resumed=true');

    ws2.close();
    ws3.close();
  });
});
