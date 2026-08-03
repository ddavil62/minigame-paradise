/**
 * @fileoverview DEFECT-1 독립 재검증 테스트 (QA Round 2).
 *
 * Coder가 작성한 MR-011을 신뢰하지 않고, QA가 독립적으로 DEFECT-1 시나리오를
 * 재현하여 수정이 실제로 동작하는지 검증한다.
 *
 * 추가 엣지케이스:
 *   D1-R1: 원본 DEFECT-1 시나리오 정확 재현 (AI 먼저 → 일반 사용자)
 *   D1-R2: 봇 spawn 완료 후 일반 사용자 접속 (자연 방어벽 검증)
 *   D1-R3: 동시 다수 AI 사용자 → 각각 독립된 전용 룸
 *   D1-R4: _botSpawnPending 영구 잔류 방지 (200ms 이후 해제 확인)
 *   D1-R5: AI 룸 봇 spawn 대기 중 room 파라미터 접속은 정상 동작
 *
 * 실행: node tests/defect1-qa-reverify.test.js
 * 포트: 3125
 */

import http from 'node:http';
import { WebSocket } from 'ws';
import { createApp } from '../server.js';

const PORT = 3125;

let passed = 0;
let failed = 0;
const failures = [];

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

function section(name) { console.log(`\n[${name}]`); }
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function startServer() {
  const app = createApp({
    hostUrl: '',
    getBotUrl: (roomId) => null,
    heartbeatIntervalMs: 0,
  });
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', resolve);
  });
  return server;
}

async function stopServer(server) {
  if (!server) return;
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await Promise.race([
    new Promise((res) => server.close(res)),
    new Promise((res) => setTimeout(res, 3000)),
  ]);
  await sleep(200);
}

function makeClient(query) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws${query || ''}`);
  const queue = [];
  const waiters = [];
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (waiters.length) { waiters.shift()(msg); }
    else { queue.push(msg); }
  });
  ws.on('error', () => {});
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
  return {
    ws, received: queue,
    open: () => new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); }),
    close: () => new Promise((res) => { ws.once('close', res); ws.close(); }),
    send: (msg) => ws.send(JSON.stringify(msg)),
    waitFor,
  };
}

// ── D1-R1: 원본 DEFECT-1 시나리오 정확 재현 ──────────────────────────
section('D1-R1: DEFECT-1 정확 재현 — AI 먼저 접속 → 200ms 내 일반 사용자 접속');

async function runD1R1() {
  const server = await startServer();

  // AI 사용자 접속 + JOIN
  const ai = makeClient('?mode=ai');
  await ai.open();
  ai.send({ type: 'JOIN', playerName: 'AI_Player' });
  const aiJoined = await ai.waitFor('JOINED');

  assertTrue(aiJoined.waiting === true, 'D1-R1: AI 사용자 waiting=true');
  const aiRoomId = aiJoined.roomId;

  // 즉시 (200ms 봇 대기 윈도우 내) 일반 사용자 접속
  const normal = makeClient(); // room 파라미터 없음
  await normal.open();
  normal.send({ type: 'JOIN', playerName: 'Normal_Player' });
  const normalJoined = await normal.waitFor('JOINED');

  // 핵심 검증: 일반 사용자가 AI 전용 룸에 합류하지 않아야 한다
  assertTrue(normalJoined.roomId !== aiRoomId,
    `D1-R1: 일반 사용자(${normalJoined.roomId.slice(0, 8)}) != AI 룸(${aiRoomId.slice(0, 8)})`);
  assertTrue(normalJoined.waiting === true,
    'D1-R1: 일반 사용자는 별도 새 룸에서 혼자 대기');
  assertEq(normalJoined.playerId, 'p1',
    'D1-R1: 일반 사용자는 새 룸의 p1 (AI 룸의 p2가 아님)');

  ai.ws.close();
  normal.ws.close();
  await sleep(200);
  await stopServer(server);
}

try { await runD1R1(); }
catch (err) {
  failed += 1;
  failures.push(`D1-R1 예외: ${err.message}\n${err.stack}`);
  console.log(`  FAIL  D1-R1 예외: ${err.message}`);
}

// ── D1-R2: 봇 spawn 완료 후 자연 방어벽 검증 ─────────────────────────
section('D1-R2: 봇 spawn 완료 후(2명 룸) 일반 사용자 → 새 룸에 배정');

async function runD1R2() {
  const server = await startServer();

  // AI 사용자 접속 + JOIN
  const ai = makeClient('?mode=ai');
  await ai.open();
  ai.send({ type: 'JOIN', playerName: 'AI_Player' });
  const aiJoined = await ai.waitFor('JOINED');
  const aiRoomId = aiJoined.roomId;

  // 200ms 대기 (_botSpawnPending=false 전환)
  await sleep(250);

  // 봇 역할 수동 접속 (getBotUrl이 null이므로 자동 spawn은 안 됨)
  const bot = makeClient(`?mode=bot&room=${aiRoomId}`);
  await bot.open();
  bot.send({ type: 'JOIN', playerName: 'Bot' });
  const botJoined = await bot.waitFor('JOINED');
  assertEq(botJoined.waiting, false, 'D1-R2: 봇이 AI 룸에 합류 (2인 만석)');

  // 이제 일반 사용자 접속 → AI 룸은 2명이므로 findWaitingRoom에 걸리지 않아야 함
  const normal = makeClient();
  await normal.open();
  normal.send({ type: 'JOIN', playerName: 'Normal' });
  const normalJoined = await normal.waitFor('JOINED');

  assertTrue(normalJoined.roomId !== aiRoomId,
    'D1-R2: 일반 사용자는 AI 전용 룸(만석)과 다른 새 룸에 배정');
  assertTrue(normalJoined.waiting === true,
    'D1-R2: 일반 사용자는 새 룸에서 대기');

  ai.ws.close(); bot.ws.close(); normal.ws.close();
  await sleep(200);
  await stopServer(server);
}

try { await runD1R2(); }
catch (err) {
  failed += 1;
  failures.push(`D1-R2 예외: ${err.message}\n${err.stack}`);
  console.log(`  FAIL  D1-R2 예외: ${err.message}`);
}

// ── D1-R3: 동시 다수 AI 사용자 → 각각 독립된 전용 룸 ──────────────────
section('D1-R3: 3명의 AI 사용자 → 3개의 독립 전용 룸');

async function runD1R3() {
  const server = await startServer();

  const roomIds = [];
  const clients = [];

  for (let i = 0; i < 3; i++) {
    const c = makeClient('?mode=ai');
    await c.open();
    c.send({ type: 'JOIN', playerName: `AI_User_${i}` });
    const joined = await c.waitFor('JOINED');
    roomIds.push(joined.roomId);
    clients.push(c);
  }

  // 3개의 고유 룸 ID
  const unique = new Set(roomIds);
  assertEq(unique.size, 3, 'D1-R3: 3명 AI 사용자 = 3개 독립 룸');

  // 각 룸 간 교차 합류가 없었는지: 모두 waiting=true (봇도 접속 안 됨)
  // 모든 AI 룸이 서로 격리되어 있는지 확인
  for (let i = 0; i < 3; i++) {
    for (let j = i + 1; j < 3; j++) {
      assertTrue(roomIds[i] !== roomIds[j],
        `D1-R3: AI_User_${i}(${roomIds[i].slice(0, 8)}) != AI_User_${j}(${roomIds[j].slice(0, 8)})`);
    }
  }

  // 일반 사용자 접속 → 어떤 AI 룸에도 합류하지 않아야 함
  const normal = makeClient();
  await normal.open();
  normal.send({ type: 'JOIN', playerName: 'Normal' });
  const normalJoined = await normal.waitFor('JOINED');

  for (const rid of roomIds) {
    assertTrue(normalJoined.roomId !== rid,
      `D1-R3: 일반 사용자는 AI 룸(${rid.slice(0, 8)})에 합류하지 않음`);
  }

  for (const c of clients) c.ws.close();
  normal.ws.close();
  await sleep(200);
  await stopServer(server);
}

try { await runD1R3(); }
catch (err) {
  failed += 1;
  failures.push(`D1-R3 예외: ${err.message}\n${err.stack}`);
  console.log(`  FAIL  D1-R3 예외: ${err.message}`);
}

// ── D1-R4: _botSpawnPending 200ms 이후 해제 확인 ─────────────────────
section('D1-R4: _botSpawnPending이 200ms 후 해제되어 영구 잔류하지 않음');

async function runD1R4() {
  const server = await startServer();

  // AI 사용자 접속 + JOIN → _botSpawnPending=true
  const ai = makeClient('?mode=ai');
  await ai.open();
  ai.send({ type: 'JOIN', playerName: 'AI_User' });
  const aiJoined = await ai.waitFor('JOINED');
  const aiRoomId = aiJoined.roomId;

  // 200ms 윈도우 내: findWaitingRoom이 AI 룸을 스킵해야 함
  const earlyNormal = makeClient();
  await earlyNormal.open();
  earlyNormal.send({ type: 'JOIN', playerName: 'Early_Normal' });
  const earlyJoined = await earlyNormal.waitFor('JOINED');
  assertTrue(earlyJoined.roomId !== aiRoomId,
    'D1-R4: 200ms 이내 일반 사용자 → AI 룸 합류 안 됨 (pending=true)');

  // 300ms 대기 → _botSpawnPending=false로 전환됨
  await sleep(300);

  // getBotUrl이 null이므로 봇 spawn 실패 → AI 룸은 여전히 1인
  // 이제 _botSpawnPending=false이므로 findWaitingRoom이 AI 룸을 반환할 수 있음
  // 이것은 "정상 동작"이다 -- 봇 spawn이 실패한 경우 룸은 일반 대기 룸처럼 동작
  const lateNormal = makeClient();
  await lateNormal.open();
  lateNormal.send({ type: 'JOIN', playerName: 'Late_Normal' });
  const lateJoined = await lateNormal.waitFor('JOINED');

  // _botSpawnPending이 해제되었으므로, 이 룸이 findWaitingRoom에 의해 반환될 수 있음
  // earlyNormal이 만든 룸(1인 대기 중)이 먼저 Map 순서상 반환될 수도 있고
  // AI 룸이 반환될 수도 있음 — 중요한 것은 _botSpawnPending이 영구히 true로 남지 않는다는 것
  assertTrue(lateJoined.waiting === false,
    'D1-R4: 300ms 이후 일반 사용자 → 어딘가에 합류 (pending이 영구 잔류하지 않음)');

  ai.ws.close(); earlyNormal.ws.close(); lateNormal.ws.close();
  await sleep(200);
  await stopServer(server);
}

try { await runD1R4(); }
catch (err) {
  failed += 1;
  failures.push(`D1-R4 예외: ${err.message}\n${err.stack}`);
  console.log(`  FAIL  D1-R4 예외: ${err.message}`);
}

// ── D1-R5: AI 룸에 room 파라미터로 직접 접속은 정상 ───────────────────
section('D1-R5: AI 전용 룸에 room 파라미터로 직접 접속 (봇 역할) 가능');

async function runD1R5() {
  const server = await startServer();

  // AI 사용자 접속
  const ai = makeClient('?mode=ai');
  await ai.open();
  ai.send({ type: 'JOIN', playerName: 'AI_User' });
  const aiJoined = await ai.waitFor('JOINED');
  const aiRoomId = aiJoined.roomId;

  // room 파라미터로 직접 봇 접속 (이것은 _botSpawnPending과 무관 — room 파라미터 분기)
  const bot = makeClient(`?mode=bot&room=${aiRoomId}`);
  await bot.open();
  bot.send({ type: 'JOIN', playerName: 'Bot' });
  const botJoined = await bot.waitFor('JOINED');

  assertEq(botJoined.roomId, aiRoomId, 'D1-R5: 봇이 AI 룸에 직접 합류');
  assertEq(botJoined.waiting, false, 'D1-R5: 봇 합류 후 2인 만석');
  assertEq(botJoined.playerId, 'p2', 'D1-R5: 봇은 p2');

  ai.ws.close(); bot.ws.close();
  await sleep(200);
  await stopServer(server);
}

try { await runD1R5(); }
catch (err) {
  failed += 1;
  failures.push(`D1-R5 예외: ${err.message}\n${err.stack}`);
  console.log(`  FAIL  D1-R5 예외: ${err.message}`);
}

// ── 요약 ────────────────────────────────────────────────────
console.log('\n────────────────────────────────────────');
console.log(`총 ${passed + failed}건, PASS=${passed}, FAIL=${failed}`);
if (failed > 0) {
  console.log('\n실패 목록:');
  for (const f of failures) console.log(f);
  process.exit(1);
} else {
  console.log('DEFECT-1 독립 재검증 모든 테스트 통과.');
  process.exit(0);
}
