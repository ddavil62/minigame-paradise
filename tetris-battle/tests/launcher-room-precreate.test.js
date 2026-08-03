/**
 * @fileoverview 런처 발급 roomId 선제 등록(ensureRoom) 회귀 테스트 — ad-hoc 노드 러너.
 *
 * 배경(Room-is-full/Room-not-found 근본원인 4차 fix, 2026-08-03):
 * 런처(launcher/server.js)는 로비 매칭 완료 시 tetris-battle 전용으로
 * crypto.randomUUID()를 생성해 매칭된 클라이언트(및 AI 채우기 봇)를
 * `?room=<roomId>`로 리다이렉트한다. 그러나 이 roomId는 tetris-battle 서버의
 * roomMap에 등록된 적이 없어, 클라이언트가 실제로 접속하면 "Room not found"로
 * 항상 거절되었다 — 즉 런처를 경유한 매칭(AI 채우기 포함)이 전혀 동작하지 않던
 * 결함이다. server.js에 추가된 ensureRoom(id)를 런처가 REDIRECT 전에 호출하면
 * 이 문제가 해소된다.
 *
 * 실행:
 *   node tests/launcher-room-precreate.test.js
 *
 * 격리 포트 3130.
 *
 * 시나리오:
 *   LP-001: ensureRoom 호출 없이 미등록 roomId로 접속 → 기존처럼 "Room not found" 유지
 *   LP-002: ensureRoom(id) 선제 호출 후 그 id로 접속 → 정상 합류 (런처 정상 매칭 재현)
 *   LP-003: ensureRoom(id) 후 동일 id로 두 번째 클라이언트 접속 → 같은 룸에서 만남 (2인 매칭 재현)
 *   LP-004: ensureRoom(id) 후 mode=ai&room=<id>로 접속 → 자체 봇 spawn 로직(JOIN 트리거) 정상 작동
 *   LP-005: 이미 존재하는 룸에 ensureRoom(id) 재호출 → 기존 상태 보존(멱등성)
 */

import http from 'node:http';
import { WebSocket } from 'ws';
import crypto from 'crypto';
import { createApp } from '../server.js';

const PORT = 3130;

// ── 미니 테스트 러너 ───────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures = [];

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

let app;
let server;

/** 격리 서버를 띄운다. 봇 spawn 없이 자체 mode=ai 로직만 트리거 여부를 확인한다. */
async function startServer() {
  let botSpawnCalls = [];
  app = createApp({
    hostUrl: '',
    getBotUrl: (roomId) => {
      botSpawnCalls.push(roomId);
      return null; // 실제 프로세스 spawn은 하지 않고 호출 여부만 기록
    },
    heartbeatIntervalMs: 0,
  });
  app._botSpawnCalls = botSpawnCalls;
  server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', resolve);
  });
}

async function stopServer() {
  if (!server) return;
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await Promise.race([
    new Promise((res) => server.close(res)),
    new Promise((res) => setTimeout(res, 3000)),
  ]);
  await sleep(200);
}

/**
 * 단일 WS 클라이언트 헬퍼.
 * @param {string} [query]
 */
function makeClient(query) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws${query || ''}`);
  const queue = [];
  const waiters = [];
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (waiters.length) waiters.shift()(msg);
    else queue.push(msg);
  });
  ws.on('error', () => {});
  function waitFor(type, timeoutMs = 3000) {
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
    ws,
    received: queue,
    open: () => new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); }),
    close: () => new Promise((res) => { ws.once('close', res); ws.close(); }),
    send: (msg) => ws.send(JSON.stringify(msg)),
    waitFor,
  };
}

async function connectAndJoin(name, query) {
  const client = makeClient(query);
  await client.open();
  client.send({ type: 'JOIN', playerName: name });
  const joined = await client.waitFor('JOINED');
  return { client, joined };
}

// ── LP-001: ensureRoom 없이 미등록 roomId 접속 → 기존 거절 동작 유지 ──
section('LP-001: ensureRoom 미호출 시 미등록 roomId → Room not found (기존 동작 보존)');
async function runLP001() {
  const fakeRoomId = crypto.randomUUID(); // 런처가 생성했다고 가정하되, ensureRoom을 호출하지 않음
  const client = makeClient(`?room=${fakeRoomId}`);
  await client.open();
  const err = await client.waitFor('ERROR');
  assertTrue(err.message === 'Room not found', `LP-001: 미등록 roomId 접속 시 ERROR="Room not found" (실제: "${err.message}")`);
  await client.close();
}

// ── LP-002: ensureRoom(id) 선제 호출 후 정상 합류 (런처 매칭 재현) ──
section('LP-002: ensureRoom(id) 선제 호출 후 같은 id로 접속 → 정상 합류');
async function runLP002() {
  const roomId = crypto.randomUUID();
  app.ensureRoom(roomId); // 런처가 REDIRECT 전에 호출하는 것과 동일한 시점 재현
  const { joined } = await connectAndJoin('Alice', `?room=${roomId}`);
  assertTrue(joined.roomId === roomId, `LP-002: JOINED.roomId가 ensureRoom으로 등록한 id와 일치 (실제: "${joined.roomId}")`);
  assertTrue(joined.playerId === 'p1', 'LP-002: 최초 입장자는 p1');
  assertTrue(joined.waiting === true, 'LP-002: 혼자 입장 시 waiting=true');
}

// ── LP-003: 두 번째 클라이언트도 같은 룸에서 만남 (2인 매칭 재현) ──
section('LP-003: ensureRoom(id) 후 두 클라이언트가 같은 룸에서 매칭 (정상 2인 매칭 재현)');
async function runLP003() {
  const roomId = crypto.randomUUID();
  app.ensureRoom(roomId);
  const { joined: j1 } = await connectAndJoin('P1', `?room=${roomId}`);
  const { joined: j2 } = await connectAndJoin('P2', `?room=${roomId}`);
  assertTrue(j1.roomId === roomId && j2.roomId === roomId, 'LP-003: 두 클라이언트 모두 동일 roomId로 합류');
  assertTrue(j1.playerId === 'p1' && j2.playerId === 'p2', 'LP-003: 순서대로 p1/p2 슬롯 배정');
  assertTrue(j2.waiting === false, 'LP-003: 두 번째 입장 후 waiting=false (만석)');
}

// ── LP-004: ensureRoom(id) + mode=ai&room=<id> → 자체 봇 spawn 트리거 (GAME_MANAGED_AI_IDS 경로 재현) ──
section('LP-004: ensureRoom(id) 후 mode=ai&room=<id> 접속 → 자체 봇 spawn 로직(getBotUrl) 정상 트리거');
async function runLP004() {
  const roomId = crypto.randomUUID();
  app.ensureRoom(roomId); // 런처의 checkReady()가 REDIRECT 전에 호출
  const before = app._botSpawnCalls.length;
  const { joined } = await connectAndJoin('Solo', `?mode=ai&room=${roomId}`);
  assertTrue(joined.roomId === roomId, 'LP-004: mode=ai + room 조합에서도 지정 룸으로 합류 (신규 룸 생성 아님)');
  assertTrue(joined.waiting === true, 'LP-004: 혼자 입장 시 waiting=true (봇 도착 전)');
  // 200ms 지연 후 spawnBotChild(room) → getBotUrl(room.id) 호출됨을 확인
  await sleep(350);
  const after = app._botSpawnCalls.length;
  assertTrue(after === before + 1, `LP-004: 200ms 후 getBotUrl(room.id) 호출됨 (봇 spawn 트리거, 호출횟수: ${after - before})`);
  assertTrue(app._botSpawnCalls[after - 1] === roomId, 'LP-004: getBotUrl에 전달된 roomId가 ensureRoom으로 등록한 id와 일치');
}

// ── LP-005: 이미 존재하는 룸에 ensureRoom 재호출 → 멱등성 (기존 상태 보존) ──
section('LP-005: 이미 점유된 룸에 ensureRoom(id) 재호출 → 기존 플레이어 보존 (멱등)');
async function runLP005() {
  const roomId = crypto.randomUUID();
  app.ensureRoom(roomId);
  const { joined: j1 } = await connectAndJoin('Existing', `?room=${roomId}`);
  // 런처가 동일 roomId로 checkReady()를 다시 호출하는 극단 상황을 가정 (재호출도 안전해야 함)
  app.ensureRoom(roomId);
  assertTrue(j1.playerId === 'p1', 'LP-005: 재호출 전 이미 입장한 p1 상태 그대로 확인');
  const { joined: j2 } = await connectAndJoin('Second', `?room=${roomId}`);
  assertTrue(j2.playerId === 'p2' && j2.roomId === roomId, 'LP-005: 재호출 후에도 같은 룸에 정상 합류 (p2)');
}

// ── 실행 ──────────────────────────────────────────────────────
(async () => {
  await startServer();
  try {
    await runLP001();
    await runLP002();
    await runLP003();
    await runLP004();
    await runLP005();
  } catch (e) {
    failed += 1;
    console.error('  FAIL  예외 발생:', e);
    failures.push(`예외: ${e.message}`);
  } finally {
    await stopServer();
  }

  console.log('\n' + '─'.repeat(40));
  console.log(`총 ${passed + failed}건, PASS=${passed}, FAIL=${failed}`);
  if (failed > 0) {
    console.log('\n실패 목록:');
    failures.forEach((f) => console.log(f));
    process.exitCode = 1;
  } else {
    console.log('런처 roomId 선제등록(ensureRoom) 회귀 테스트 모두 통과.');
  }
})();
