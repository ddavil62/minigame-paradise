/**
 * @fileoverview 멀티룸 격리 검증 테스트 — ad-hoc 노드 러너.
 *
 * tetris-battle server.js의 Map<roomId, Room> 멀티룸 아키텍처가
 * 독립 룸 간 격리, 명시적 room 파라미터, AI 전용 룸 생성, 하트비트 룸 한정 정리 등
 * 핵심 동작을 올바르게 수행하는지 검증한다.
 *
 * 실행:
 *   node tests/multiroom-isolation.test.js
 *
 * 격리 포트 3120 (기존 3055/3110/3111/3115/3118과 충돌 방지).
 *
 * 시나리오:
 *   MR-001: 자동 룸 분리 — 5쌍 10명 동시 접속
 *   MR-002: 룸 격리 — 한 룸의 게임 오버가 다른 룸에 영향 없음
 *   MR-003: 룸 격리 — 한 룸의 GARBAGE_SEND가 다른 룸에 누출되지 않음
 *   MR-004: 명시적 room 파라미터로 같은 룸 입장
 *   MR-005: 꽉 찬 룸에 room 파라미터로 접속 시 ERROR
 *   MR-006: 존재하지 않는 room 파라미터 → ERROR
 *   MR-007: 룸 즉시 소멸 — 인원 0명 시
 *   MR-008: AI 모드는 항상 전용 신규 룸 생성
 *   MR-009: REMATCH는 동일 룸 내에서만 동작
 *   MR-010: 하트비트 — 좀비 회수 후 해당 룸만 정리
 *   MR-011: DEFECT-1 회귀 — AI 룸 봇 spawn 대기 중 일반 사용자 격리
 */

import http from 'node:http';
import { WebSocket } from 'ws';
import { createApp } from '../server.js';

const PORT = 3120;
/** 짧은 하트비트 주기(ms). MR-010 좀비 회수를 빠르게 검증하기 위해 사용. */
const HB_INTERVAL = 300;

// ── 미니 테스트 러너 ───────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures = [];

/**
 * 기대값과 실제값이 같은지 단언한다.
 * @param {*} actual
 * @param {*} expected
 * @param {string} label
 */
function assertEq(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    const msg = `  FAIL  ${label}\n        expected: ${JSON.stringify(expected)}\n        actual:   ${JSON.stringify(actual)}`;
    console.log(msg);
    failures.push(msg);
  }
}

/**
 * 조건이 참인지 단언한다.
 * @param {boolean} cond
 * @param {string} label
 */
function assertTrue(cond, label) {
  if (cond) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    const msg = `  FAIL  ${label}`;
    console.log(msg);
    failures.push(msg);
  }
}

/** @param {string} name */
function section(name) {
  console.log(`\n[${name}]`);
}

/** @param {number} ms @returns {Promise<void>} */
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

/**
 * 격리 서버를 띄운다.
 * @param {number} [hbMs] 하트비트 주기 (0이면 비활성)
 * @returns {Promise<http.Server>}
 */
async function startServer(hbMs = 0) {
  const app = createApp({
    hostUrl: '',
    getBotUrl: (roomId) => null, // 봇 spawn 불필요 — 수동 소켓으로 시나리오 재현
    heartbeatIntervalMs: hbMs,
  });
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', resolve);
  });
  return server;
}

/**
 * 서버를 안전하게 종료한다.
 * @param {http.Server} server
 */
async function stopServer(server) {
  if (!server) return;
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await Promise.race([
    new Promise((res) => server.close(res)),
    new Promise((res) => setTimeout(res, 3000)),
  ]);
  await sleep(200);
}

/**
 * 단일 WS 클라이언트 헬퍼 (bot-smoke 패턴).
 * @param {string} [query]
 * @returns {{ ws: WebSocket, open: () => Promise<void>, close: () => Promise<void>, send: (msg: object) => void, waitFor: (type: string, timeoutMs?: number) => Promise<object>, received: object[] }}
 */
function makeClient(query) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws${query || ''}`);
  const queue = [];
  const waiters = [];
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (waiters.length) {
      waiters.shift()(msg);
    } else {
      queue.push(msg);
    }
  });
  ws.on('error', () => {});
  /**
   * 특정 타입의 메시지를 대기한다.
   * @param {string} type
   * @param {number} [timeoutMs=5000]
   * @returns {Promise<object>}
   */
  function waitFor(type, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      function tryNext() {
        while (queue.length) {
          const m = queue.shift();
          if (m.type === type) { resolve(m); return; }
        }
        if (Date.now() - t0 > timeoutMs) { reject(new Error(`timeout waiting for ${type}`)); return; }
        waiters.push((m) => {
          if (m.type === type) resolve(m);
          else { queue.unshift(m); setTimeout(tryNext, 5); }
        });
      }
      tryNext();
    });
  }
  /**
   * 지정 시간 내 특정 타입의 메시지가 도착하지 않음을 확인한다.
   * @param {string} type
   * @param {number} [waitMs=300]
   * @returns {Promise<boolean>} 메시지가 없으면 true
   */
  function expectNoMessage(type, waitMs = 300) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(true), waitMs);
      const orig = waiters.length;
      waiters.push((m) => {
        if (m.type === type) {
          clearTimeout(timer);
          resolve(false);
        } else {
          queue.unshift(m);
        }
      });
    });
  }
  return {
    ws,
    received: queue,
    open: () => new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); }),
    close: () => new Promise((res) => { ws.once('close', res); ws.close(); }),
    send: (msg) => ws.send(JSON.stringify(msg)),
    waitFor,
    expectNoMessage,
  };
}

/**
 * 클라이언트를 접속 → JOIN → JOINED까지 수행한다.
 * @param {string} name 플레이어 이름
 * @param {string} [query] WS 쿼리 파라미터
 * @returns {Promise<{client: ReturnType<typeof makeClient>, joined: object}>}
 */
async function connectAndJoin(name, query) {
  const client = makeClient(query);
  await client.open();
  client.send({ type: 'JOIN', playerName: name });
  const joined = await client.waitFor('JOINED');
  return { client, joined };
}

/**
 * 두 클라이언트를 같은 룸에 접속 → JOIN → READY → START까지 수행한다.
 * @param {string} [query] WS 쿼리 파라미터 (첫 번째 클라이언트용, 두 번째는 JOINED.roomId 기반)
 * @returns {Promise<{a: ReturnType<typeof makeClient>, b: ReturnType<typeof makeClient>, roomId: string}>}
 */
async function startTwoInRoom(query) {
  const { client: a, joined: j1 } = await connectAndJoin('P1', query);
  const roomId = j1.roomId;
  const { client: b } = await connectAndJoin('P2', `?room=${roomId}`);
  a.send({ type: 'READY' });
  b.send({ type: 'READY' });
  await a.waitFor('START');
  return { a, b, roomId };
}

// ── MR-001: 자동 룸 분리 — 5쌍 10명 동시 접속 ──────────────────
section('MR-001: 자동 룸 분리 — 5쌍 10명 순차 접속 → 5개 독립 룸');

async function runMR001() {
  const server = await startServer();

  const clients = [];
  const joineds = [];

  // 10명 순차 접속 (room 파라미터 없이)
  for (let i = 0; i < 10; i++) {
    const { client, joined } = await connectAndJoin(`Player${i + 1}`);
    clients.push(client);
    joineds.push(joined);
  }

  // 홀수 번째(인덱스 0,2,4,6,8)는 새 룸 생성 → waiting=true
  // 짝수 번째(인덱스 1,3,5,7,9)는 직전 룸 합류 → waiting=false
  for (let i = 0; i < 10; i += 2) {
    assertTrue(joineds[i].waiting === true,
      `MR-001: 클라 ${i + 1}는 waiting=true (새 룸 생성)`);
    assertTrue(joineds[i + 1].waiting === false,
      `MR-001: 클라 ${i + 2}는 waiting=false (합류)`);
  }

  // 짝수 번째의 roomId가 직전 홀수 번째와 동일한지 확인
  for (let i = 0; i < 10; i += 2) {
    assertEq(joineds[i + 1].roomId, joineds[i].roomId,
      `MR-001: 클라 ${i + 1}-${i + 2} 같은 룸 (${joineds[i].roomId.slice(0, 8)}...)`);
  }

  // 5개의 고유 룸 ID가 있어야 한다
  const uniqueRooms = new Set(joineds.map((j) => j.roomId));
  assertEq(uniqueRooms.size, 5, 'MR-001: 고유 룸 수 = 5');

  // playerId 배정: 각 쌍에서 p1, p2
  for (let i = 0; i < 10; i += 2) {
    assertEq(joineds[i].playerId, 'p1',
      `MR-001: 클라 ${i + 1}는 p1`);
    assertEq(joineds[i + 1].playerId, 'p2',
      `MR-001: 클라 ${i + 2}는 p2`);
  }

  for (const c of clients) c.ws.close();
  await sleep(200);
  await stopServer(server);
}

try {
  await runMR001();
} catch (err) {
  failed += 1;
  failures.push(`MR-001 예외: ${err.message}\n${err.stack}`);
  console.log(`  FAIL  MR-001 예외: ${err.message}`);
}

// ── MR-002: 룸 격리 — 한 룸의 게임 오버가 다른 룸에 영향 없음 ──
section('MR-002: 룸 격리 — GAME_RESULT 누출 없음');

async function runMR002() {
  const server = await startServer();

  // 룸 A: 2인 접속 → START
  const roomA = await startTwoInRoom();
  // 룸 B: 2인 접속 → START
  const roomB = await startTwoInRoom();

  // 두 룸이 서로 다른 roomId인지 확인
  assertTrue(roomA.roomId !== roomB.roomId,
    `MR-002: 룸 A(${roomA.roomId.slice(0, 8)}) ≠ 룸 B(${roomB.roomId.slice(0, 8)})`);

  // 룸 A에서 GAME_OVER
  roomA.a.send({ type: 'GAME_OVER' });
  const resultA1 = await roomA.a.waitFor('GAME_RESULT');
  const resultA2 = await roomA.b.waitFor('GAME_RESULT');

  assertTrue(resultA1.winner === 'p2', 'MR-002: 룸 A GAME_RESULT 수신 (a1)');
  assertTrue(resultA2.winner === 'p2', 'MR-002: 룸 A GAME_RESULT 수신 (a2)');

  // 룸 B에는 GAME_RESULT가 도달하지 않아야 한다
  const noResultB1 = await roomB.a.expectNoMessage('GAME_RESULT', 400);
  const noResultB2 = await roomB.b.expectNoMessage('GAME_RESULT', 400);
  assertTrue(noResultB1, 'MR-002: 룸 B b1에 GAME_RESULT 미도달');
  assertTrue(noResultB2, 'MR-002: 룸 B b2에 GAME_RESULT 미도달');

  for (const c of [roomA.a, roomA.b, roomB.a, roomB.b]) c.ws.close();
  await sleep(200);
  await stopServer(server);
}

try {
  await runMR002();
} catch (err) {
  failed += 1;
  failures.push(`MR-002 예외: ${err.message}\n${err.stack}`);
  console.log(`  FAIL  MR-002 예외: ${err.message}`);
}

// ── MR-003: 룸 격리 — GARBAGE_SEND 누출 없음 ──────────────────
section('MR-003: 룸 격리 — GARBAGE_RECV 누출 없음');

async function runMR003() {
  const server = await startServer();

  const roomA = await startTwoInRoom();
  const roomB = await startTwoInRoom();

  // 룸 A의 a1이 가비지 전송
  roomA.a.send({ type: 'GARBAGE_SEND', lines: 2, combo: 0, clearEventId: 1 });
  const garbage = await roomA.b.waitFor('GARBAGE_RECV');
  assertEq(garbage.lines, 2, 'MR-003: 룸 A a2에 GARBAGE_RECV 도달');

  // 룸 B에는 GARBAGE_RECV가 도달하지 않아야 한다
  const noGarbageB1 = await roomB.a.expectNoMessage('GARBAGE_RECV', 400);
  const noGarbageB2 = await roomB.b.expectNoMessage('GARBAGE_RECV', 400);
  assertTrue(noGarbageB1, 'MR-003: 룸 B b1에 GARBAGE_RECV 미도달');
  assertTrue(noGarbageB2, 'MR-003: 룸 B b2에 GARBAGE_RECV 미도달');

  for (const c of [roomA.a, roomA.b, roomB.a, roomB.b]) c.ws.close();
  await sleep(200);
  await stopServer(server);
}

try {
  await runMR003();
} catch (err) {
  failed += 1;
  failures.push(`MR-003 예외: ${err.message}\n${err.stack}`);
  console.log(`  FAIL  MR-003 예외: ${err.message}`);
}

// ── MR-004: 명시적 room 파라미터로 같은 룸 입장 ─────────────────
section('MR-004: 명시적 room 파라미터로 같은 룸 입장');

async function runMR004() {
  const server = await startServer();

  // A: room 없이 접속 → JOINED에서 roomId 확인
  const { client: a, joined: j1 } = await connectAndJoin('Alice');
  assertTrue(typeof j1.roomId === 'string' && j1.roomId.length > 0,
    'MR-004: A의 JOINED에 roomId 포함');
  assertTrue(j1.waiting === true, 'MR-004: A는 waiting=true (혼자)');

  // B: A의 roomId를 명시해서 접속
  const { client: b, joined: j2 } = await connectAndJoin('Bob', `?room=${j1.roomId}`);
  assertEq(j2.waiting, false, 'MR-004: B는 waiting=false (A와 같은 룸)');
  assertEq(j2.playerId, 'p2', 'MR-004: B는 p2');
  assertEq(j2.roomId, j1.roomId, 'MR-004: B의 roomId가 A와 동일');

  a.ws.close();
  b.ws.close();
  await sleep(200);
  await stopServer(server);
}

try {
  await runMR004();
} catch (err) {
  failed += 1;
  failures.push(`MR-004 예외: ${err.message}\n${err.stack}`);
  console.log(`  FAIL  MR-004 예외: ${err.message}`);
}

// ── MR-005: 꽉 찬 룸에 room 파라미터 접속 → ERROR ──────────────
section('MR-005: 꽉 찬 룸에 room 파라미터로 접속 시 ERROR');

async function runMR005() {
  const server = await startServer();

  // A, B: 같은 룸에 접속 (2인 만석)
  const { client: a, joined: j1 } = await connectAndJoin('Alice');
  const { client: b } = await connectAndJoin('Bob', `?room=${j1.roomId}`);

  // C: 꽉 찬 A의 룸에 접속 시도
  const c = makeClient(`?room=${j1.roomId}`);
  await c.open();
  const error = await c.waitFor('ERROR');
  assertEq(error.message, 'Room is full', 'MR-005: ERROR.message = "Room is full"');

  // C의 연결이 서버에 의해 종료됨을 확인 (close 이벤트 대기)
  await new Promise((res) => {
    if (c.ws.readyState === WebSocket.CLOSED) return res();
    c.ws.once('close', res);
    setTimeout(res, 1000);
  });
  assertTrue(c.ws.readyState === WebSocket.CLOSED,
    'MR-005: C 연결이 서버에 의해 종료됨');

  a.ws.close();
  b.ws.close();
  await sleep(200);
  await stopServer(server);
}

try {
  await runMR005();
} catch (err) {
  failed += 1;
  failures.push(`MR-005 예외: ${err.message}\n${err.stack}`);
  console.log(`  FAIL  MR-005 예외: ${err.message}`);
}

// ── MR-006: 존재하지 않는 room 파라미터 → ERROR ────────────────
section('MR-006: 존재하지 않는 room 파라미터 → ERROR');

async function runMR006() {
  const server = await startServer();

  const d = makeClient('?room=nonexistent-uuid-12345');
  await d.open();
  const error = await d.waitFor('ERROR');
  assertEq(error.message, 'Room not found', 'MR-006: ERROR.message = "Room not found"');

  await new Promise((res) => {
    if (d.ws.readyState === WebSocket.CLOSED) return res();
    d.ws.once('close', res);
    setTimeout(res, 1000);
  });
  assertTrue(d.ws.readyState === WebSocket.CLOSED,
    'MR-006: D 연결이 서버에 의해 종료됨');

  await stopServer(server);
}

try {
  await runMR006();
} catch (err) {
  failed += 1;
  failures.push(`MR-006 예외: ${err.message}\n${err.stack}`);
  console.log(`  FAIL  MR-006 예외: ${err.message}`);
}

// ── MR-007: 룸 즉시 소멸 — 인원 0명 시 ──────────────────────────
section('MR-007: 룸 즉시 소멸 — 인원 0명 후 동일 roomId 접속 불가');

async function runMR007() {
  const server = await startServer();

  // 2인 접속 후 roomId 획득
  const { client: a, joined: j1 } = await connectAndJoin('Alice');
  const { client: b } = await connectAndJoin('Bob', `?room=${j1.roomId}`);
  const roomId = j1.roomId;

  // 양쪽 모두 close
  await a.close();
  await b.close();
  await sleep(300);

  // 동일 roomId로 접속 시도 → "Room not found"
  const c = makeClient(`?room=${roomId}`);
  await c.open();
  const error = await c.waitFor('ERROR');
  assertEq(error.message, 'Room not found',
    `MR-007: 소멸된 룸(${roomId.slice(0, 8)})에 재접속 시 "Room not found"`);

  await new Promise((res) => {
    if (c.ws.readyState === WebSocket.CLOSED) return res();
    c.ws.once('close', res);
    setTimeout(res, 1000);
  });

  await stopServer(server);
}

try {
  await runMR007();
} catch (err) {
  failed += 1;
  failures.push(`MR-007 예외: ${err.message}\n${err.stack}`);
  console.log(`  FAIL  MR-007 예외: ${err.message}`);
}

// ── MR-008: AI 모드는 항상 전용 신규 룸 생성 ─────────────────────
section('MR-008: AI 모드(mode=ai) → 대기 중인 사람 룸과 별도 신규 룸 생성');

async function runMR008() {
  const server = await startServer();

  // 사람 A: room 없이 접속, p1 대기 중
  const { client: a, joined: j1 } = await connectAndJoin('Alice');
  assertTrue(j1.waiting === true, 'MR-008: A는 waiting=true (대기 중)');

  // 사람 B: mode=ai로 접속 — A의 룸에 합류하지 않고 새 룸 생성
  const { client: b, joined: j2 } = await connectAndJoin('Bob', '?mode=ai');
  assertTrue(j2.waiting === true, 'MR-008: B도 waiting=true (새 전용 룸)');
  assertTrue(j1.roomId !== j2.roomId,
    `MR-008: A(${j1.roomId.slice(0, 8)}) ≠ B(${j2.roomId.slice(0, 8)}) 서로 다른 룸`);

  // A는 여전히 waiting=true (B가 합류하지 않았으므로)
  // A의 후속 접속자(C)가 A의 룸에 합류 가능한지 추가 확인
  const { client: c, joined: j3 } = await connectAndJoin('Charlie');
  assertEq(j3.roomId, j1.roomId,
    'MR-008: C는 A의 대기 룸에 합류 (AI가 안 채웠으므로)');
  assertEq(j3.waiting, false, 'MR-008: C 합류 후 waiting=false');

  for (const cl of [a, b, c]) cl.ws.close();
  await sleep(200);
  await stopServer(server);
}

try {
  await runMR008();
} catch (err) {
  failed += 1;
  failures.push(`MR-008 예외: ${err.message}\n${err.stack}`);
  console.log(`  FAIL  MR-008 예외: ${err.message}`);
}

// ── MR-009: REMATCH는 동일 룸 내에서만 동작 ─────────────────────
section('MR-009: REMATCH → 동일 룸 내 재시작, 다른 룸에 START 미누출');

async function runMR009() {
  const server = await startServer();

  // 룸 A: 게임 진행 → GAME_OVER → REMATCH
  const roomA = await startTwoInRoom();
  const roomB = await startTwoInRoom();

  // A에서 게임오버
  roomA.a.send({ type: 'GAME_OVER' });
  await roomA.a.waitFor('GAME_RESULT');
  await roomA.b.waitFor('GAME_RESULT');

  // A에서 양쪽 REMATCH → 재대결 START
  roomA.a.send({ type: 'REMATCH' });
  roomA.b.send({ type: 'REMATCH' });
  const rematchStart = await roomA.a.waitFor('START');
  assertTrue(rematchStart.countdown === 3, 'MR-009: 룸 A 재대결 START 수신');

  // 룸 B에는 GAME_RESULT도 재대결 START도 도달하지 않아야 한다
  const noResultB = await roomB.a.expectNoMessage('GAME_RESULT', 400);
  const noStartB = await roomB.a.expectNoMessage('START', 400);
  assertTrue(noResultB, 'MR-009: 룸 B에 GAME_RESULT 미누출');
  assertTrue(noStartB, 'MR-009: 룸 B에 재대결 START 미누출');

  for (const c of [roomA.a, roomA.b, roomB.a, roomB.b]) c.ws.close();
  await sleep(200);
  await stopServer(server);
}

try {
  await runMR009();
} catch (err) {
  failed += 1;
  failures.push(`MR-009 예외: ${err.message}\n${err.stack}`);
  console.log(`  FAIL  MR-009 예외: ${err.message}`);
}

// ── MR-010: 하트비트 — 좀비 회수 후 해당 룸만 정리 ───────────────
section('MR-010: 하트비트 — 좀비 회수 시 해당 룸만 정리, 다른 룸 영향 없음');

async function runMR010() {
  const server = await startServer(HB_INTERVAL);

  // 룸 A: 2인 접속 → START
  const roomA = await startTwoInRoom();
  // 룸 B: 2인 접속 → START
  const roomB = await startTwoInRoom();

  // 룸 A의 a1을 좀비로 만든다 (TCP 강제 파괴)
  roomA.a.ws._socket.destroy();

  // 하트비트가 좀비를 탐지·terminate할 때까지 대기 (2~3주기 + 여유)
  await sleep(HB_INTERVAL * 3 + 300);

  // 룸 B의 b1, b2는 여전히 연결 유지 확인
  assertTrue(roomB.a.ws.readyState === WebSocket.OPEN,
    'MR-010: 룸 B b1 연결 유지');
  assertTrue(roomB.b.ws.readyState === WebSocket.OPEN,
    'MR-010: 룸 B b2 연결 유지');

  // 룸 A의 a2도 방치 (a1 terminate 후 OPPONENT_LEFT가 갔을 것)
  roomA.b.ws._socket.destroy();
  await sleep(HB_INTERVAL * 3 + 300);

  // 새 클라이언트가 접속 가능 확인 (룸 A 자동 정리 됨)
  const { client: fresh, joined: jFresh } = await connectAndJoin('FreshPlayer');
  assertTrue(jFresh.waiting === true,
    'MR-010: 새 접속자가 p1으로 대기 (좀비 정리 확인)');

  fresh.ws.close();
  roomB.a.ws.close();
  roomB.b.ws.close();
  await sleep(200);
  await stopServer(server);
}

try {
  await runMR010();
} catch (err) {
  failed += 1;
  failures.push(`MR-010 예외: ${err.message}\n${err.stack}`);
  console.log(`  FAIL  MR-010 예외: ${err.message}`);
}

// ── MR-011: DEFECT-1 회귀 — AI 룸 봇 spawn 대기 중 일반 사용자 격리 ──
section('MR-011: DEFECT-1 회귀 — AI 룸(_botSpawnPending) 격리');

async function runMR011() {
  const server = await startServer();

  // 1. AI 모드 사용자 접속 → 전용 룸 생성 + JOIN 전송 → _botSpawnPending=true
  const aiClient = makeClient('?mode=ai');
  await aiClient.open();
  aiClient.send({ type: 'JOIN', playerName: 'AI_User' });
  const aiJoined = await aiClient.waitFor('JOINED');
  assertTrue(aiJoined.waiting === true,
    'MR-011: AI 사용자는 waiting=true (봇 spawn 대기 중)');
  const aiRoomId = aiJoined.roomId;
  assertTrue(typeof aiRoomId === 'string' && aiRoomId.length > 0,
    'MR-011: AI 룸에 유효한 roomId 할당');

  // 2. 200ms 내에 일반 사용자가 room 파라미터 없이 접속
  //    → findWaitingRoom()이 AI 룸을 반환하지 않고 별도 새 룸 생성해야 한다.
  const normalClient = makeClient(); // room 파라미터 없음
  await normalClient.open();
  normalClient.send({ type: 'JOIN', playerName: 'Normal_User' });
  const normalJoined = await normalClient.waitFor('JOINED');

  assertTrue(normalJoined.roomId !== aiRoomId,
    `MR-011: 일반 사용자(${normalJoined.roomId.slice(0, 8)})는 AI 룸(${aiRoomId.slice(0, 8)})과 다른 룸에 배정`);
  assertTrue(normalJoined.waiting === true,
    'MR-011: 일반 사용자는 새 룸에서 waiting=true (혼자 대기)');
  assertEq(normalJoined.playerId, 'p1',
    'MR-011: 일반 사용자는 새 룸의 p1 (AI 룸의 p2가 아님)');

  // 3. AI 사용자의 룸에 여전히 1명만 있는지 확인 (일반 사용자가 합류하지 않았으므로)
  //    → 이후 일반 사용자 C가 접속하면 일반 사용자 B의 대기 룸에 합류해야 한다.
  const normalClient2 = makeClient(); // room 파라미터 없음
  await normalClient2.open();
  normalClient2.send({ type: 'JOIN', playerName: 'Normal_User2' });
  const normalJoined2 = await normalClient2.waitFor('JOINED');

  assertEq(normalJoined2.roomId, normalJoined.roomId,
    'MR-011: 세 번째 사용자(C)는 일반 대기 룸(B)에 합류');
  assertEq(normalJoined2.waiting, false,
    'MR-011: C 합류 후 waiting=false');
  assertTrue(normalJoined2.roomId !== aiRoomId,
    'MR-011: C도 AI 룸에 합류하지 않음');

  for (const c of [aiClient, normalClient, normalClient2]) c.ws.close();
  await sleep(200);
  await stopServer(server);
}

try {
  await runMR011();
} catch (err) {
  failed += 1;
  failures.push(`MR-011 예외: ${err.message}\n${err.stack}`);
  console.log(`  FAIL  MR-011 예외: ${err.message}`);
}

// ── 요약 ────────────────────────────────────────────────────
console.log('\n────────────────────────────────────────');
console.log(`총 ${passed + failed}건, PASS=${passed}, FAIL=${failed}`);
if (failed > 0) {
  console.log('\n실패 목록:');
  for (const f of failures) console.log(f);
  process.exit(1);
} else {
  console.log('모든 멀티룸 격리 회귀 테스트 통과.');
  process.exit(0);
}
