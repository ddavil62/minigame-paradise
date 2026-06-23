/**
 * @fileoverview 오목 smoke 테스트 — ad-hoc 노드 러너.
 *
 * 실행:
 *   node tests/smoke.test.js
 *
 * 회귀 시나리오:
 *   OMOK-001: createGame() 초기 상태
 *   OMOK-002: 정상 착수 흐름 (번갈아 color 교대, moveCount 증가)
 *   OMOK-003: 가로 5목 승리 판정
 *   OMOK-004: 장목(6목) 승리 처리 (패배 아님)
 *   OMOK-005: 대각선 5목 승리
 *   OMOK-006: 중복 착수 차단
 *   OMOK-007: WS 전체 흐름 (포트 3105) — JOIN p1/p2 → GAME_START → PLACE 교대 → 5목 → GAME_OVER
 *   OMOK-008: 쌍삼(33) 착수 거부 (checkDoubleThree 단위 + placeStone 원복)
 *   OMOK-009: 사사(44) 착수 거부 (checkDoubleFour 단위)
 *   OMOK-010: 5목 완성 + 쌍삼 동시 → 승리 우선
 *   OMOK-011: WS 리매치 동의 흐름 (REMATCH → REMATCH_WAITING → REMATCH_START → 새 판)
 *   OMOK-012: 흑 승리 후 리매치 색 swap (진 쪽이 다음 흑)
 *
 * 작업 포트: 3105 (사용자 launcher 3000과 다른 게임 서버 무영향).
 */

import http from 'node:http';
import { WebSocket } from 'ws';
import {
  createGame,
  placeStone,
  applyResign,
  snapshot,
  checkDoubleThree,
  checkDoubleFour,
  BOARD_SIZE,
  TOTAL_CELLS,
} from '../game.js';
import { createApp } from '../server.js';

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

/** 보드 인덱스 헬퍼. */
function idx(row, col) { return row * BOARD_SIZE + col; }

// ── OMOK-001: 초기 상태 ───────────────────────────────────────
section('OMOK-001: createGame() 초기 상태');
{
  const g = createGame();
  assertEq(g.board.length, TOTAL_CELLS, 'board 길이 361');
  assertTrue(g.board.every((c) => c === null), 'board 전부 null');
  assertEq(g.currentTurn, 'black', '선공 = black');
  assertEq(g.phase, 'playing', 'phase = playing');
  assertEq(g.result, null, 'result = null');
  assertEq(g.moveCount, 0, 'moveCount = 0');
  // snapshot 형태.
  const snap = snapshot(g);
  assertEq(snap.type, 'STATE', 'snapshot type=STATE');
  assertEq(snap.board.length, TOTAL_CELLS, 'snapshot board 361');
  assertTrue(snap.board !== g.board, 'snapshot board는 복사본(참조 다름)');
}

// ── OMOK-002: 정상 착수 흐름 ──────────────────────────────────
section('OMOK-002: 정상 착수 흐름 (color 교대 + moveCount)');
{
  const g = createGame();
  let r = placeStone(g, 'black', 9, 9);
  assertTrue(r.ok, '흑 (9,9) 착수 ok');
  assertEq(g.board[idx(9, 9)], 'black', '(9,9) = black');
  assertEq(g.moveCount, 1, 'moveCount = 1');
  assertEq(g.currentTurn, 'white', '턴 교대 → white');

  r = placeStone(g, 'white', 9, 10);
  assertTrue(r.ok, '백 (9,10) 착수 ok');
  assertEq(g.moveCount, 2, 'moveCount = 2');
  assertEq(g.currentTurn, 'black', '턴 교대 → black');

  // 상대 턴에 착수 시도 → 거부.
  r = placeStone(g, 'white', 8, 8);
  assertTrue(!r.ok, '상대 턴(white) 착수 거부');
  assertTrue(/차례/.test(r.error || ''), 'error에 "차례"');

  // 범위 밖 착수 → 거부.
  r = placeStone(g, 'black', 19, 0);
  assertTrue(!r.ok, '범위 밖 row=19 거부');
  r = placeStone(g, 'black', -1, 0);
  assertTrue(!r.ok, '범위 밖 row=-1 거부');
}

// 백 더미 착수 좌표 — 서로 인접하지 않아 자체 5목을 만들지 않는다(행 간격 2).
const WHITE_DUMMIES = [[0, 0], [2, 0], [4, 0], [6, 0], [16, 16]];

// ── OMOK-003: 가로 5목 승리 ───────────────────────────────────
section('OMOK-003: 가로 5목 승리 판정');
{
  const g = createGame();
  // 흑: (9,9)(9,10)(9,11)(9,12)(9,13) / 백: 방해되지 않게 흩뿌린다.
  const blackCols = [9, 10, 11, 12, 13];
  let result = null;
  for (let i = 0; i < blackCols.length; i++) {
    result = placeStone(g, 'black', 9, blackCols[i]);
    if (i < blackCols.length - 1) {
      assertTrue(result.ok && !result.gameOver, `흑 ${i + 1}수 착수, 아직 미결`);
      // 백 더미 착수 (자체 5목 안 되게 흩뿌림).
      placeStone(g, 'white', WHITE_DUMMIES[i][0], WHITE_DUMMIES[i][1]);
    }
  }
  assertTrue(result.gameOver, '5수째 → gameOver');
  assertEq(result.winner, 'black', 'winner = black');
  assertEq(result.reason, 'five', 'reason = five');
  assertEq(g.phase, 'ended', 'phase = ended');
  assertEq(result.winLine.length, 5, 'winLine 5개');

  // 종료 후 추가 착수 거부.
  const r2 = placeStone(g, 'white', 1, 1);
  assertTrue(!r2.ok, '종료 후 착수 거부');
}

// ── OMOK-004: 장목(6목) 승리 처리 ─────────────────────────────
section('OMOK-004: 장목(6목) 승리 처리 (금수 아님)');
{
  // 흑이 가로로 6개 연속(장목)을 만들어 "6목도 승리(패배 아님)"를 검증한다.
  // 전략: 9,13만 비운 채 9,9·9,10·9,11·9,12·9,14를 먼저 둔다(5목 미형성 — 9,13에서 끊김).
  //       마지막에 9,13을 메우면 9,9~9,14 6연속(장목) → 승리.
  const g2 = createGame();
  const blackMoves = [[9, 9], [9, 10], [9, 11], [9, 12], [9, 14]];
  let res = null;
  for (let i = 0; i < blackMoves.length; i++) {
    res = placeStone(g2, 'black', blackMoves[i][0], blackMoves[i][1]);
    // 5번째까지는 5목 미형성(9,13 비어 연속 끊김) → 미결.
    assertTrue(res.ok, `흑 ${i + 1}수 ok`);
    // 백 더미 착수 (자체 5목 안 되게 흩뿌림).
    placeStone(g2, 'white', WHITE_DUMMIES[i][0], WHITE_DUMMIES[i][1]);
  }
  assertTrue(!res.gameOver, '9,13 비어 있어 아직 5목 아님');
  // 이제 흑이 9,13을 메우면 9,9~9,14 6연속(장목) → 승리.
  const win = placeStone(g2, 'black', 9, 13);
  assertTrue(win.gameOver, '장목(6목) 형성 → gameOver');
  assertEq(win.winner, 'black', '장목 winner = black (패배 아님)');
  assertEq(win.reason, 'five', 'reason = five');
  assertTrue(win.winLine.length >= 6, `winLine 6개 이상 (장목, len=${win.winLine.length})`);
}

// ── OMOK-005: 대각선 5목 ──────────────────────────────────────
section('OMOK-005: 대각선(↘) 5목 승리');
{
  const g = createGame();
  const diag = [[5, 5], [6, 6], [7, 7], [8, 8], [9, 9]];
  let res = null;
  for (let i = 0; i < diag.length; i++) {
    res = placeStone(g, 'black', diag[i][0], diag[i][1]);
    if (i < diag.length - 1) {
      placeStone(g, 'white', 0, i);
    }
  }
  assertTrue(res.gameOver, '대각 5목 → gameOver');
  assertEq(res.winner, 'black', '대각 winner = black');
  assertEq(res.winLine.length, 5, '대각 winLine 5개');
}

// ── OMOK-006: 중복 착수 차단 ──────────────────────────────────
section('OMOK-006: 중복 착수 차단');
{
  const g = createGame();
  placeStone(g, 'black', 5, 5);
  placeStone(g, 'white', 6, 6);
  // 흑 차례에 (5,5) 재착수 → 이미 흑 돌이 있음.
  const r = placeStone(g, 'black', 5, 5);
  assertTrue(!r.ok, '같은 자리 재착수 거부');
  assertTrue(/이미/.test(r.error || ''), 'error에 "이미"');
  assertEq(g.moveCount, 2, 'moveCount 변화 없음(거부)');

  // 기권 검증 (보너스).
  const g2 = createGame();
  const rr = applyResign(g2, 'black');
  assertTrue(rr.ok, '흑 기권 ok');
  assertEq(rr.winner, 'white', '기권 → 상대(white) 승');
  assertEq(g2.phase, 'ended', 'phase ended');
  const rr2 = applyResign(g2, 'white');
  assertTrue(!rr2.ok, '종료 후 기권 거부');
}

// ── OMOK-008: 쌍삼(33) 착수 거부 ──────────────────────────────
section('OMOK-008: 쌍삼 착수 거부 (checkDoubleThree 단위 + placeStone 거부)');
{
  // 가상 착수 상태 board를 직접 구성: (9,9)에 흑이 놓이며
  // 가로(9,8·9,9·9,10)·세로(8,9·9,9·10,9) 두 방향 모두 열린3.
  const b = new Array(TOTAL_CELLS).fill(null);
  b[idx(9, 8)] = 'black';
  b[idx(9, 9)] = 'black';
  b[idx(9, 10)] = 'black';
  b[idx(8, 9)] = 'black';
  b[idx(10, 9)] = 'black';
  assertTrue(checkDoubleThree(b, 9, 9, 'black'), '가로+세로 열린3 2개 → 쌍삼 true');

  // placeStone 흐름 거부 검증: 같은 모양을 흑이 (9,9)에 두며 완성하려는 상황.
  const g = createGame();
  // 흑 4점 + 백 더미를 교대로 배치(9,9는 마지막에 둔다).
  const blacks = [[9, 8], [9, 10], [8, 9], [10, 9]];
  const dummies = [[0, 0], [2, 0], [4, 0], [6, 0]];
  for (let i = 0; i < blacks.length; i++) {
    const rb = placeStone(g, 'black', blacks[i][0], blacks[i][1]);
    assertTrue(rb.ok, `흑 더미 ${i + 1} 착수 ok`);
    placeStone(g, 'white', dummies[i][0], dummies[i][1]);
  }
  const mcBefore = g.moveCount;
  const r = placeStone(g, 'black', 9, 9);
  assertTrue(!r.ok, '쌍삼 착수 거부(ok=false)');
  assertTrue(/쌍삼/.test(r.error || ''), 'error "금수입니다: 쌍삼"');
  assertEq(g.board[idx(9, 9)], null, '거부 후 board[9,9] 원복(null)');
  assertEq(g.moveCount, mcBefore, '거부 후 moveCount 불변');
  assertEq(g.phase, 'playing', '거부 후에도 phase=playing');
  assertEq(g.currentTurn, 'black', '거부 후 currentTurn 유지(흑)');
}

// ── OMOK-009: 사사(44) 착수 거부 ──────────────────────────────
section('OMOK-009: 사사 착수 거부 (checkDoubleFour 단위)');
{
  // (9,9)에 흑이 놓이며 가로·세로 각각 4목을 완성하는 가상 착수 상태.
  // 가로: (9,6)(9,7)(9,8)(9,9) = 4목 / 세로: (9,9)(10,9)(11,9)(12,9) = 4목.
  const b = new Array(TOTAL_CELLS).fill(null);
  b[idx(9, 6)] = 'black';
  b[idx(9, 7)] = 'black';
  b[idx(9, 8)] = 'black';
  b[idx(9, 9)] = 'black';
  b[idx(10, 9)] = 'black';
  b[idx(11, 9)] = 'black';
  b[idx(12, 9)] = 'black';
  assertTrue(checkDoubleFour(b, 9, 9, 'black'), '가로4+세로4 → 사사 true');
  // 5목이 아님을 확인(가로/세로 각각 4).
  assertTrue(!checkDoubleThree(b, 9, 9, 'black'), '4목들은 열린3으로 세지 않음(쌍삼 false)');
}

// ── OMOK-010: 5목 + 쌍삼 → 승리 우선 ──────────────────────────
section('OMOK-010: 5목 완성 착수가 동시에 쌍삼이어도 승리 우선');
{
  const g = createGame();
  // 가로 5목: (9,7)(9,8)(9,9)(9,10)(9,11). 세로 열린3도 같이 생기도록
  // (8,9)(10,9)도 흑으로 둔다. 마지막에 (9,9)를 메우면 가로 5목 + 세로 열린3.
  // 흑이 (9,7)(9,8)(9,10)(9,11)(8,9)(10,9) 6점 선배치 후 (9,9) 메움.
  const blacks = [[9, 7], [9, 8], [9, 10], [9, 11], [8, 9], [10, 9]];
  const dummies = [[0, 0], [2, 0], [4, 0], [6, 0], [16, 0], [18, 0]];
  for (let i = 0; i < blacks.length; i++) {
    const rb = placeStone(g, 'black', blacks[i][0], blacks[i][1]);
    assertTrue(rb.ok && !rb.gameOver, `흑 선배치 ${i + 1} ok(미결)`);
    placeStone(g, 'white', dummies[i][0], dummies[i][1]);
  }
  const win = placeStone(g, 'black', 9, 9);
  assertTrue(win.ok && win.gameOver, '5목 완성 → gameOver(쌍삼이어도 승리 우선)');
  assertEq(win.winner, 'black', 'winner = black');
  assertEq(win.reason, 'five', 'reason = five');
  assertTrue(win.winLine.length >= 5, `winLine 5개 이상(len=${win.winLine.length})`);
}

// ── OMOK-007: WS 전체 흐름 (포트 3105) ────────────────────────
section('OMOK-007: WS 흐름 (JOIN p1/p2 → GAME_START → PLACE 교대 → 5목 → GAME_OVER)');

/**
 * 단일 클라이언트 헬퍼: WS 연결 + 메시지 큐 + 대기 유틸.
 * @param {string} url
 * @returns {object}
 */
function makeClient(url) {
  const ws = new WebSocket(url);
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
    ws,
    open: () => new Promise((res) => ws.once('open', res)),
    close: () => new Promise((res) => { ws.once('close', res); ws.close(); }),
    send: (msg) => ws.send(JSON.stringify(msg)),
    waitFor,
  };
}

async function runWsScenario() {
  const PORT = 3105;
  const app = createApp({ hostUrl: '' });
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', resolve);
  });

  const c1 = makeClient(`ws://127.0.0.1:${PORT}/ws`);
  await c1.open();
  const j1 = await c1.waitFor('JOINED');
  assertEq(j1.playerId, 'p1', 'c1 = p1');
  assertEq(j1.color, 'black', 'c1 color = black');
  assertEq(j1.waiting, true, 'c1 waiting = true');

  const c2 = makeClient(`ws://127.0.0.1:${PORT}/ws`);
  await c2.open();
  const j2 = await c2.waitFor('JOINED');
  assertEq(j2.playerId, 'p2', 'c2 = p2');
  assertEq(j2.color, 'white', 'c2 color = white');

  // READY 게이트(2026-06-22): 양쪽 READY 후에만 GAME_START.
  c1.send({ type: 'READY' });
  c2.send({ type: 'READY' });

  // 양쪽 GAME_START 수신.
  await c1.waitFor('GAME_START');
  await c2.waitFor('GAME_START');
  // 초기 STATE.
  const sInit = await c1.waitFor('STATE');
  await c2.waitFor('STATE');
  assertEq(sInit.currentTurn, 'black', '초기 currentTurn=black');
  assertEq(sInit.moveCount, 0, '초기 moveCount=0');

  // 흑(c1) 가로 5목 + 백(c2) 더미 착수 교대.
  const blackCols = [9, 10, 11, 12, 13];
  let lastGameOver = null;
  for (let i = 0; i < blackCols.length; i++) {
    // 흑 착수.
    c1.send({ type: 'PLACE', row: 9, col: blackCols[i] });
    const stBlack = await c1.waitFor('STATE');
    await c2.waitFor('STATE');
    assertEq(stBlack.board[idx(9, blackCols[i])], 'black', `흑 (9,${blackCols[i]}) 반영`);

    if (i < blackCols.length - 1) {
      assertEq(stBlack.currentTurn, 'white', '흑 착수 후 → white 차례');
      // 백 더미 착수 (멀리).
      c2.send({ type: 'PLACE', row: 0, col: i });
      await c1.waitFor('STATE');
      await c2.waitFor('STATE');
    }
  }

  // 5목 → GAME_OVER 양쪽 수신.
  const go1 = await c1.waitFor('GAME_OVER');
  const go2 = await c2.waitFor('GAME_OVER');
  assertEq(go1.winner, 'black', 'GAME_OVER winner = black');
  assertEq(go1.reason, 'five', 'GAME_OVER reason = five');
  assertTrue(Array.isArray(go1.winLine) && go1.winLine.length === 5, 'GAME_OVER winLine 5개');
  assertEq(go1.winner, go2.winner, '양쪽 winner 동일');
  lastGameOver = go1;

  // 중복 착수 ERROR 검증: 새 게임에서 같은 자리 두 번.
  await c1.close();
  await c2.close();
  await new Promise((res) => server.close(res));
}

await runWsScenario();

// ── OMOK-007b: 중복/상대턴 착수 ERROR (별도 서버) ─────────────
section('OMOK-007b: WS 중복 착수 + 상대 턴 착수 ERROR');

async function runErrorScenario() {
  const PORT = 3105;
  const app = createApp({ hostUrl: '' });
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', resolve);
  });

  const c1 = makeClient(`ws://127.0.0.1:${PORT}/ws`);
  await c1.open();
  await c1.waitFor('JOINED');
  const c2 = makeClient(`ws://127.0.0.1:${PORT}/ws`);
  await c2.open();
  await c2.waitFor('JOINED');
  // READY 게이트(2026-06-22): 양쪽 READY 후 게임 시작.
  c1.send({ type: 'READY' });
  c2.send({ type: 'READY' });
  await c1.waitFor('GAME_START');
  await c1.waitFor('STATE');
  await c2.waitFor('STATE');

  // 흑이 (9,9) 착수.
  c1.send({ type: 'PLACE', row: 9, col: 9 });
  await c1.waitFor('STATE');
  await c2.waitFor('STATE');

  // 백이 같은 자리 (9,9) 착수 → ERROR.
  c2.send({ type: 'PLACE', row: 9, col: 9 });
  const err1 = await c2.waitFor('ERROR');
  assertTrue(/이미/.test(err1.message || ''), '중복 착수 ERROR');

  // 백 차례인데 흑(c1)이 또 착수 → ERROR(차례 아님).
  c1.send({ type: 'PLACE', row: 5, col: 5 });
  const err2 = await c1.waitFor('ERROR');
  assertTrue(/차례/.test(err2.message || ''), '상대 턴 착수 ERROR');

  // 게임은 계속 진행 가능: 백이 정상 착수.
  c2.send({ type: 'PLACE', row: 5, col: 5 });
  const st = await c2.waitFor('STATE');
  assertEq(st.currentTurn, 'black', '백 정상 착수 후 → 흑 차례 (게임 계속)');

  await c1.close();
  await c2.close();
  await new Promise((res) => server.close(res));
}

await runErrorScenario();

// ── OMOK-011 & 012: WS 리매치 흐름 + 색 swap (포트 3105) ───────
section('OMOK-011~012: WS 리매치 동의 흐름 + 흑 승리 후 색 swap');

async function runRematchScenario() {
  const PORT = 3105;
  const app = createApp({ hostUrl: '' });
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', resolve);
  });

  const c1 = makeClient(`ws://127.0.0.1:${PORT}/ws`); // p1=black(선공)
  await c1.open();
  await c1.waitFor('JOINED');
  const c2 = makeClient(`ws://127.0.0.1:${PORT}/ws`); // p2=white
  await c2.open();
  await c2.waitFor('JOINED');
  // READY 게이트(2026-06-22): 양쪽 READY 후 게임 시작.
  c1.send({ type: 'READY' });
  c2.send({ type: 'READY' });
  await c1.waitFor('GAME_START');
  await c1.waitFor('STATE');
  await c2.waitFor('STATE');

  // 흑(c1) 가로 5목으로 빠르게 승리.
  const blackCols = [9, 10, 11, 12, 13];
  for (let i = 0; i < blackCols.length; i++) {
    c1.send({ type: 'PLACE', row: 9, col: blackCols[i] });
    await c1.waitFor('STATE');
    await c2.waitFor('STATE');
    if (i < blackCols.length - 1) {
      c2.send({ type: 'PLACE', row: 0, col: i });
      await c1.waitFor('STATE');
      await c2.waitFor('STATE');
    }
  }
  const go = await c1.waitFor('GAME_OVER');
  await c2.waitFor('GAME_OVER');
  assertEq(go.winner, 'black', '리매치 전 흑 승리');

  // 한 쪽(c1)만 REMATCH → 상대(c2)에게 REMATCH_WAITING.
  c1.send({ type: 'REMATCH' });
  const waiting = await c2.waitFor('REMATCH_WAITING');
  assertTrue(waiting.type === 'REMATCH_WAITING', 'OMOK-011: 한 쪽 동의 → 상대 REMATCH_WAITING');

  // 상대(c2)도 REMATCH → REMATCH_START broadcast.
  c2.send({ type: 'REMATCH' });
  const rs1 = await c1.waitFor('REMATCH_START');
  const rs2 = await c2.waitFor('REMATCH_START');
  assertTrue(rs1.type === 'REMATCH_START', 'OMOK-011: 양쪽 동의 → REMATCH_START(c1)');
  assertTrue(rs2.type === 'REMATCH_START', 'OMOK-011: 양쪽 동의 → REMATCH_START(c2)');
  // 직전 흑 승리 → 진 쪽(p2)이 다음 흑.
  assertEq(rs1.nextBlack, 'p2', 'OMOK-012: nextBlack=p2(진 쪽이 흑)');

  // 갱신 color JOINED 재전송 확인.
  const j1 = await c1.waitFor('JOINED');
  const j2 = await c2.waitFor('JOINED');
  assertEq(j1.color, 'white', 'OMOK-012: p1(직전 흑) → 백');
  assertEq(j2.color, 'black', 'OMOK-012: p2(직전 백) → 흑(선공)');

  // READY 게이트(2026-06-22): 리매치도 양쪽 다시 READY 후 새 판 시작.
  c1.send({ type: 'READY' });
  c2.send({ type: 'READY' });

  // 새 판 시작: GAME_START + 빈 보드 STATE.
  await c1.waitFor('GAME_START');
  await c2.waitFor('GAME_START');
  const st = await c1.waitFor('STATE');
  await c2.waitFor('STATE');
  assertEq(st.moveCount, 0, 'OMOK-011: 새 판 moveCount=0(빈 보드)');
  assertEq(st.currentTurn, 'black', 'OMOK-011: 새 판 currentTurn=black');
  assertTrue(st.board.every((c) => c === null), 'OMOK-011: 새 판 board 전부 null');

  await c1.close();
  await c2.close();
  await new Promise((res) => server.close(res));
}

await runRematchScenario();

// ── 요약 ────────────────────────────────────────────────────
console.log('\n────────────────────────────────────────');
console.log(`총 ${passed + failed}건, PASS=${passed}, FAIL=${failed}`);
if (failed > 0) {
  console.log('\n실패 목록:');
  for (const f of failures) console.log(f);
  process.exit(1);
} else {
  console.log('모든 smoke 테스트 통과.');
  process.exit(0);
}
