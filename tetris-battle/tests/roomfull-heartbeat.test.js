/**
 * @fileoverview "Room is full" 하트비트 회수 검증 테스트 — ad-hoc 노드 러너.
 *
 * 실행:
 *   node tests/roomfull-heartbeat.test.js
 *
 * 검증 시나리오 (AC-2 / AC-3 / AC-4):
 *   HB-001 (AC-2): 게임 진행 중 p1 소켓 무응답 방치 → 하트비트가 좀비 회수 →
 *                   새 연결이 ROOM_FULL 없이 정상 입장.
 *   HB-002 (AC-3): REMATCH 후 라운드 2 진행 중 p1 소켓 방치 → 동일하게 회수.
 *   HB-003 (AC-4): heartbeatIntervalMs: 0 → 하트비트 비활성, 타이머 없이
 *                   서버/프로세스 정상 종료(hang 없음).
 *
 * 작업 포트: 3115 (기존 슈트 3055/3110/3111 및 프로덕션 3000/3005와 격리).
 */

import http from 'node:http';
import { WebSocket } from 'ws';
import { createApp } from '../server.js';

const PORT = 3115;
/** 짧은 하트비트 주기(ms). 좀비 회수를 빠르게 검증하기 위해 사용. */
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
 * 하트비트가 활성화된 격리 서버를 띄운다.
 * @param {number} hbMs 하트비트 주기 (0이면 비활성)
 * @returns {Promise<http.Server>}
 */
async function startServer(hbMs = HB_INTERVAL) {
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
 * 단일 WS 클라이언트 헬퍼 (bot-smoke 패턴).
 * @param {string} [query]
 * @returns {{ ws: WebSocket, open: () => Promise<void>, close: () => Promise<void>, send: (msg: object) => void, waitFor: (type: string, timeoutMs?: number) => Promise<object> }}
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
  /**
   * 특정 타입의 메시지를 대기한다.
   * @param {string} type
   * @param {number} [timeoutMs=15000]
   * @returns {Promise<object>}
   */
  function waitFor(type, timeoutMs = 15000) {
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
    open: () => new Promise((res) => ws.once('open', res)),
    close: () => new Promise((res) => { ws.once('close', res); ws.close(); }),
    send: (msg) => ws.send(JSON.stringify(msg)),
    waitFor,
  };
}

// ── HB-001 (AC-2): 게임 진행 중 좀비 소켓 하트비트 회수 ────────
section('HB-001 (AC-2): 게임 진행 중 p1 무응답 방치 → 하트비트 회수 → 새 접속 정상');

async function runHB001() {
  const server = await startServer();

  // p1 (사람 역할)
  const p1 = makeClient('?mode=human');
  await p1.open();
  p1.send({ type: 'JOIN', playerName: 'Player1' });
  const j1 = await p1.waitFor('JOINED');
  assertEq(j1.playerId, 'p1', 'HB-001: p1 입장');

  // p2 (수동 소켓, 봇 대역)
  const p2 = makeClient('?mode=human');
  await p2.open();
  p2.send({ type: 'JOIN', playerName: 'Player2' });
  const j2 = await p2.waitFor('JOINED');
  assertEq(j2.playerId, 'p2', 'HB-001: p2 입장');
  assertEq(j2.waiting, false, 'HB-001: 2인 충원 완료');

  // 양쪽 READY → START (게임 진행 중 상태)
  p1.send({ type: 'READY' });
  p2.send({ type: 'READY' });
  await p1.waitFor('START');

  // p1 소켓을 pong 미응답 상태로 만들기 위해 pong 리스너를 제거하고 소켓을 방치한다.
  // ws 라이브러리는 프로토콜 레벨에서 자동 pong을 반환하므로, 실제 "무응답"을
  // 시뮬레이션하려면 내부 소켓을 직접 파괴해야 한다.
  // _socket.destroy()는 TCP를 끊지만 서버 측 close 이벤트를 발생시키지 않을 수 있어
  // 좀비 상태가 된다 — 정확히 버그 재현 조건이다.
  p1.ws._socket.destroy();

  // 하트비트가 좀비를 탐지·terminate할 때까지 대기 (최대 2 * HB_INTERVAL + 여유).
  // 서버가 ping → isAlive=false 세팅 → 다음 주기에 terminate.
  await sleep(HB_INTERVAL * 3 + 200);

  // p2도 같이 정리됨 (사람 disconnect → 봇 슬롯 동기 제거와 동일 흐름,
  // 단 여기서는 p2도 사람이므로 p1 terminate 후 p2에게 OPPONENT_LEFT가 갈 수 있음).
  // p2 소켓도 방치 (양쪽 좀비 시나리오 B 재현).
  p2.ws._socket.destroy();
  await sleep(HB_INTERVAL * 3 + 200);

  // 새 연결이 ROOM_FULL 없이 정상 입장되어야 한다.
  const fresh = makeClient('?mode=human');
  await fresh.open();
  fresh.send({ type: 'JOIN', playerName: 'FreshPlayer' });

  const jFresh = await fresh.waitFor('JOINED', 5000);
  assertEq(jFresh.playerId, 'p1', 'HB-001: 새 접속이 p1 슬롯 배정 (좀비 회수 확인)');
  assertTrue(jFresh.waiting === true, 'HB-001: waiting=true (방이 비워짐)');

  await fresh.close();
  await sleep(150);
  await new Promise((res) => server.close(res));
}

try {
  await runHB001();
} catch (err) {
  failed += 1;
  failures.push(`HB-001 예외: ${err.message}\n${err.stack}`);
  console.log(`  FAIL  HB-001 예외: ${err.message}`);
}

// ── HB-002 (AC-3): REMATCH 후 라운드 2 진행 중 좀비 회수 ────────
section('HB-002 (AC-3): REMATCH → 라운드 2 진행 중 p1 방치 → 하트비트 회수');

async function runHB002() {
  const server = await startServer();

  const p1 = makeClient('?mode=human');
  await p1.open();
  p1.send({ type: 'JOIN', playerName: 'Player1' });
  await p1.waitFor('JOINED');

  const p2 = makeClient('?mode=human');
  await p2.open();
  p2.send({ type: 'JOIN', playerName: 'Player2' });
  await p2.waitFor('JOINED');

  // 라운드 1: READY → START → p1 GAME_OVER → GAME_RESULT
  p1.send({ type: 'READY' });
  p2.send({ type: 'READY' });
  await p1.waitFor('START');

  p1.send({ type: 'GAME_OVER' });
  await p1.waitFor('GAME_RESULT');

  // REMATCH → 라운드 2 START
  p1.send({ type: 'REMATCH' });
  p2.send({ type: 'REMATCH' });
  await p1.waitFor('START');

  // 라운드 2 진행 중 (양쪽 gameOver=false) p1 소켓 무응답 방치
  p1.ws._socket.destroy();
  await sleep(HB_INTERVAL * 3 + 200);

  // p2도 방치
  p2.ws._socket.destroy();
  await sleep(HB_INTERVAL * 3 + 200);

  // 새 연결이 ROOM_FULL 없이 정상 입장
  const fresh = makeClient('?mode=human');
  await fresh.open();
  fresh.send({ type: 'JOIN', playerName: 'FreshPlayer' });

  const jFresh = await fresh.waitFor('JOINED', 5000);
  assertEq(jFresh.playerId, 'p1', 'HB-002: REMATCH 후 좀비 회수 → 새 접속 p1 배정');
  assertTrue(jFresh.waiting === true, 'HB-002: waiting=true (방 완전 정리)');

  await fresh.close();
  await sleep(150);
  await new Promise((res) => server.close(res));
}

try {
  await runHB002();
} catch (err) {
  failed += 1;
  failures.push(`HB-002 예외: ${err.message}\n${err.stack}`);
  console.log(`  FAIL  HB-002 예외: ${err.message}`);
}

// ── HB-003 (AC-4): heartbeatIntervalMs: 0 → 비활성, 정상 종료 ──
section('HB-003 (AC-4): heartbeatIntervalMs=0 → 비활성, 서버 정상 종료 (hang 없음)');

async function runHB003() {
  const server = await startServer(0); // 하트비트 비활성

  const p1 = makeClient('?mode=human');
  await p1.open();
  p1.send({ type: 'JOIN', playerName: 'Player1' });
  const j = await p1.waitFor('JOINED', 5000);
  assertEq(j.playerId, 'p1', 'HB-003: 하트비트 비활성 상태에서 정상 입장');

  await p1.close();
  await sleep(150);

  // 서버가 타이머 없이 정상 종료되는지 확인 (hang 없음).
  // .unref() 처리가 올바르면 이 Promise가 타임아웃 없이 resolve된다.
  const closePromise = new Promise((res) => server.close(res));
  const timeoutPromise = new Promise((_, rej) =>
    setTimeout(() => rej(new Error('server.close() hang — 타이머 미해제')), 5000)
  );
  await Promise.race([closePromise, timeoutPromise]);
  assertTrue(true, 'HB-003: 서버 정상 종료 (hang 없음)');
}

try {
  await runHB003();
} catch (err) {
  failed += 1;
  failures.push(`HB-003 예외: ${err.message}\n${err.stack}`);
  console.log(`  FAIL  HB-003 예외: ${err.message}`);
}

// ── 요약 ────────────────────────────────────────────────────
console.log('\n────────────────────────────────────────');
console.log(`총 ${passed + failed}건, PASS=${passed}, FAIL=${failed}`);
if (failed > 0) {
  console.log('\n실패 목록:');
  for (const f of failures) console.log(f);
  process.exit(1);
} else {
  console.log('모든 하트비트 회귀 테스트 통과.');
  process.exit(0);
}
