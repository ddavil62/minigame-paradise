/**
 * @fileoverview 테트리스 배틀 봇 시나리오 smoke 테스트 — ad-hoc 노드 러너.
 *
 * 실행:
 *   node tests/bot-smoke.test.js
 *
 * 검증 시나리오 (TBOT-001~006):
 *   TBOT-001: mode=ai 진입 → 서버가 봇 자동 spawn → 사람 JOINED(p1) → START 수신
 *   TBOT-002: 봇이 실제로 피스 배치 → BOARD_STATE → 서버가 사람에게 OPPONENT_BOARD 중계
 *   TBOT-003: 사람 GAME_OVER 전송 → 봇(p2)이 승리자 GAME_RESULT 수신
 *   TBOT-004: 사람 disconnect → 방 초기화 (봇 연결도 해제됨 — 새 접속 waiting=true)
 *   TBOT-005: GAME_RESULT 후 사람 REMATCH → 봇 자동 동의 → START 재수신
 *   TBOT-006: 봇 OPPONENT_BOARD.stack이 컬럼 높이 배열(길이 BOARD_WIDTH=10, 0 초과 값 1개+)
 *             — 봇이 stack:[] 빈 배열을 보내 상대 미니맵이 비어 보이던 회귀 차단 게이트
 *
 * 작업 포트: 3110 (사용자 launcher 3000 및 기존 phase 슈트(3055)와 격리).
 */

import http from 'node:http';
import { WebSocket } from 'ws';
import { createApp } from '../server.js';

const PORT = 3110;

// ── 미니 테스트 러너 ───────────────────────────────────────────
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

function section(name) {
  console.log(`\n[${name}]`);
}

/** getBotUrl을 주입한 격리 서버를 띄운다. (멀티룸: roomId를 인자로 받는다.) */
async function startServer() {
  const app = createApp({
    hostUrl: '',
    getBotUrl: (roomId) => `ws://localhost:${PORT}/ws?mode=bot&room=${roomId}`,
  });
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', resolve);
  });
  return server;
}

/** 단일 WS 클라이언트 헬퍼 (omok bot-smoke 패턴). */
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

// ── TBOT-001 & 002: 봇 spawn → START → 봇 피스 배치 → OPPONENT_BOARD ──
section('TBOT-001~002: mode=ai → 봇 spawn → START → 봇 배치 → OPPONENT_BOARD');

async function runStartAndBoardScenario() {
  const server = await startServer();

  const me = makeClient('?mode=ai');
  await me.open();
  me.send({ type: 'JOIN', playerName: 'TestUser' });

  const joined = await me.waitFor('JOINED');
  assertEq(joined.playerId, 'p1', 'TBOT-001: 사람이 p1 자리 점유');

  // 사람도 READY를 보내야 양쪽 collect → START (봇은 JOINED 후 자동 READY).
  me.send({ type: 'READY' });

  // 봇 spawn(200ms) + 연결 + JOIN/READY 후 양쪽 START.
  const start = await me.waitFor('START', 15000);
  assertEq(start.countdown, 3, 'TBOT-001: START countdown=3 (봇 자동 spawn)');

  // 봇이 800~1200ms마다 피스를 배치 → BOARD_STATE → 서버가 사람에게 OPPONENT_BOARD 중계.
  const opp = await me.waitFor('OPPONENT_BOARD', 30000);
  assertTrue(opp !== undefined, 'TBOT-002: 봇 피스 배치 → BOARD_STATE → OPPONENT_BOARD 중계');

  await me.close();
  await new Promise((res) => server.close(res));
}

try {
  await runStartAndBoardScenario();
} catch (err) {
  failed += 1;
  failures.push(`TBOT-001/002 예외: ${err.message}\n${err.stack}`);
  console.log(`  FAIL  TBOT-001/002 예외: ${err.message}`);
}

// ── TBOT-006: 봇 OPPONENT_BOARD.stack = 컬럼 높이 배열 (미니맵 회귀 게이트) ──
//   회귀 버그(2026-06-21): 봇이 BOARD_STATE를 stack:[] 빈 배열로 보내 상대 화면
//   미니맵(ui.js renderOpponent)이 비어 보였다. 봇은 board.js getColumnHeights와
//   동일하게 컬럼별 visible 높이 배열(길이 BOARD_WIDTH=10)을 실어야 한다. 봇이 피스를
//   쌓을 시간을 충분히 준 뒤, stack 길이=10 + 0 초과 값이 1개 이상 존재함을 단언한다.
section('TBOT-006: 봇 OPPONENT_BOARD.stack = 컬럼 높이 배열(길이 10, 비어있지 않음)');

const BOARD_WIDTH = 10;

async function runMinimapStackScenario() {
  const server = await startServer();

  const me = makeClient('?mode=ai');
  await me.open();
  me.send({ type: 'JOIN', playerName: 'TestUser' });
  await me.waitFor('JOINED');
  me.send({ type: 'READY' });
  await me.waitFor('START', 15000);

  // 봇이 여러 피스를 쌓아 컬럼 높이가 0을 초과할 때까지 OPPONENT_BOARD를 반복 수신한다.
  // 봇은 800~1200ms마다 1피스 배치 → 여러 메시지를 받으며 그중 비어있지 않은 stack을 찾는다.
  let stackLen = -1;
  let maxColHeight = 0;
  let everArray = false;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const opp = await me.waitFor('OPPONENT_BOARD', 30000);
    if (Array.isArray(opp.stack)) {
      everArray = true;
      stackLen = opp.stack.length;
      const m = opp.stack.length ? Math.max(...opp.stack) : 0;
      if (m > maxColHeight) maxColHeight = m;
    }
    // 길이 10 + 컬럼 높이 1 이상을 확인하면 조기 종료.
    if (stackLen === BOARD_WIDTH && maxColHeight > 0) break;
  }

  assertTrue(everArray, 'TBOT-006: 봇 OPPONENT_BOARD.stack이 배열로 도착');
  assertEq(stackLen, BOARD_WIDTH, 'TBOT-006: stack 길이 = BOARD_WIDTH(10) (컬럼 높이 배열)');
  assertTrue(maxColHeight > 0, 'TBOT-006: stack에 0 초과 컬럼 높이 1개 이상 (봇 보드가 쌓임 → 미니맵 비어있지 않음)');

  await me.close();
  await new Promise((res) => server.close(res));
}

try {
  await runMinimapStackScenario();
} catch (err) {
  failed += 1;
  failures.push(`TBOT-006 예외: ${err.message}\n${err.stack}`);
  console.log(`  FAIL  TBOT-006 예외: ${err.message}`);
}

// ── TBOT-003: 사람 GAME_OVER → 봇(p2)이 승리자 GAME_RESULT ──────
section('TBOT-003: 사람 GAME_OVER → 봇 승리자 GAME_RESULT');

async function runTopoutScenario() {
  const server = await startServer();

  const me = makeClient('?mode=ai');
  await me.open();
  me.send({ type: 'JOIN', playerName: 'TestUser' });
  await me.waitFor('JOINED');
  me.send({ type: 'READY' });
  await me.waitFor('START', 15000);

  // 사람이 먼저 토프아웃(GAME_OVER) → 상대(봇=p2)가 승리.
  me.send({ type: 'GAME_OVER' });
  const result = await me.waitFor('GAME_RESULT', 15000);
  assertEq(result.winner, 'p2', 'TBOT-003: 봇(p2)이 승리자');
  assertEq(result.reason, 'topout', 'TBOT-003: reason=topout');

  await me.close();
  await new Promise((res) => server.close(res));
}

try {
  await runTopoutScenario();
} catch (err) {
  failed += 1;
  failures.push(`TBOT-003 예외: ${err.message}\n${err.stack}`);
  console.log(`  FAIL  TBOT-003 예외: ${err.message}`);
}

// ── TBOT-004: 사람 disconnect → 방 초기화 (봇 연결 해제) ─────────
section('TBOT-004: 사람 disconnect → 방 초기화 (봇 연결 해제)');

async function runDisconnectScenario() {
  const server = await startServer();

  const me = makeClient('?mode=ai');
  await me.open();
  me.send({ type: 'JOIN', playerName: 'TestUser' });
  await me.waitFor('JOINED');
  me.send({ type: 'READY' });
  await me.waitFor('START', 15000); // 봇 입장 확인.

  // 사람 disconnect → 서버가 killBotChild() 호출 → 봇 프로세스 종료 → 방이 비워짐.
  await me.close();

  // 봇 프로세스 종료 + 봇 close 핸들러 처리 시간 확보.
  await new Promise((res) => setTimeout(res, 1500));

  // 새 클라이언트 접속 → 방이 비어있으면 JOINED.waiting=true (봇도 빠졌다는 증거).
  const fresh = makeClient('?mode=human');
  await fresh.open();
  fresh.send({ type: 'JOIN', playerName: 'Fresh' });
  const j = await fresh.waitFor('JOINED', 10000);
  assertEq(j.playerId, 'p1', 'TBOT-004: 새 접속이 p1 (방이 완전히 비워짐)');
  assertEq(j.waiting, true, 'TBOT-004: waiting=true (봇 연결도 해제됨)');

  await fresh.close();
  await new Promise((res) => server.close(res));
}

try {
  await runDisconnectScenario();
} catch (err) {
  failed += 1;
  failures.push(`TBOT-004 예외: ${err.message}\n${err.stack}`);
  console.log(`  FAIL  TBOT-004 예외: ${err.message}`);
}

// ── TBOT-005: 재대결 — 사람 REMATCH → 봇 자동 동의 → START ───────
section('TBOT-005: GAME_RESULT 후 사람 REMATCH → 봇 자동 동의 → START 재수신');

async function runRematchScenario() {
  const server = await startServer();

  const me = makeClient('?mode=ai');
  await me.open();
  me.send({ type: 'JOIN', playerName: 'TestUser' });
  await me.waitFor('JOINED');
  me.send({ type: 'READY' });
  await me.waitFor('START', 15000);

  // 사람이 즉시 GAME_OVER → GAME_RESULT 도착.
  me.send({ type: 'GAME_OVER' });
  await me.waitFor('GAME_RESULT', 15000);

  // 사람이 REMATCH 전송 → 봇이 GAME_RESULT 수신 0.5초 후 자동 REMATCH 동의 → 양쪽 START.
  me.send({ type: 'REMATCH' });
  const start2 = await me.waitFor('START', 15000);
  assertEq(start2.countdown, 3, 'TBOT-005: 봇 자동 동의 → START countdown=3 재수신');

  await me.close();
  await new Promise((res) => server.close(res));
}

try {
  await runRematchScenario();
} catch (err) {
  failed += 1;
  failures.push(`TBOT-005 예외: ${err.message}\n${err.stack}`);
  console.log(`  FAIL  TBOT-005 예외: ${err.message}`);
}

// ── 요약 ────────────────────────────────────────────────────
console.log('\n────────────────────────────────────────');
console.log(`총 ${passed + failed}건, PASS=${passed}, FAIL=${failed}`);
if (failed > 0) {
  console.log('\n실패 목록:');
  for (const f of failures) console.log(f);
  process.exit(1);
} else {
  console.log('모든 봇 smoke 테스트 통과.');
  process.exit(0);
}
