/**
 * @fileoverview 루미큐브 smoke 테스트 — ad-hoc 노드 러너.
 *
 * 실행:
 *   node tests/smoke.test.js
 *
 * 회귀 시나리오:
 *   RUMMI-001: 타일 풀 구성 (106장, 1~13×4색×2 + 조커 2)
 *   RUMMI-002: 분배 정확성 (손 14×2, 더미 78)
 *   RUMMI-003: validateSet — 그룹 룰
 *   RUMMI-004: validateSet — 런 룰
 *   RUMMI-005: validateSet — 조커 포함
 *   RUMMI-006: 첫 등판 30점 미달 → 롤백
 *   RUMMI-007: 첫 등판 30점 충족 → commit + played[by]=true
 *   RUMMI-008: 변경 없이 END_TURN → 더미 1장 뽑기
 *   RUMMI-009: 손 0장 → 승리
 *   RUMMI-010: 봇 시나리오 (사람 1명 + 봇 1명 + 짧은 진행)
 *   RUMMI-011: 조커 회수 — 손 타일이 조커가 대체하던 정확한 타일과 일치 → swap 성공
 *   RUMMI-012: 조커 회수 후 END_TURN 시 조커 미사용 → invalid → 롤백 + 더미 1장
 *   RUMMI-013: 조커 회수 + 다른 세트에 사용 → END_TURN 정상 commit
 *   RUMMI-014: 봇이 손 타일을 보드 런 끝에 붙이는 시나리오
 *   RUMMI-015: 봇이 보드 그룹에 4번째 타일 추가
 *   RUMMI-016: 더미 빈 + 양쪽 패스 1회씩 → 라운드 종료 + 손 적은 자 승리
 *   RUMMI-017: 더미 빈 + 양쪽 손 같음 → 무승부
 *   RUMMI-018: 봇 조커 활용 — 손 [red7, blue7] + 조커 → 3장 그룹 후보 생성 (조커 사용)
 *   RUMMI-019: 봇 조커 활용 — 손 [red3, red5] + 조커 → [red3, J, red5] 런 후보 생성 (사이 조커)
 *   RUMMI-020: 봇 보드 재구성 — 보드 [red 3-4-5-6] + 손 [black3, orange3] → 새 그룹 [red3, black3, orange3] 생성 + 보드 [red 4-5-6] 유지
 *   RUMMI-021: 봇 재구성 시간 제한 — 500ms 내에 결과 반환 (못 찾으면 null 반환, 무한 루프 X)
 *   RUMMI-022: 봇 조커+재구성 통합 — 조커 회수 미시도(휴리스틱 단순화) 확인. 보드 조커 포함 세트는 분해 후보에서 제외.
 */

import http from 'node:http';
import { WebSocket } from 'ws';
import {
  createGame,
  validateSet,
  validateBoard,
  addNewSet,
  moveTile,
  swapJoker,
  endTurn,
  snapshotFor,
  COLORS,
  NUMBERS,
  INITIAL_HAND_SIZE,
} from '../game.js';
import { createApp } from '../server.js';
import {
  enumerateCandidateSets,
  findBoardReconstruction,
  isValidSet,
} from '../bot.js';

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

// ── 헬퍼: 타일 객체 생성(테스트용) ─────────────────────────────
function T(color, number) {
  return { id: `${color}_${number}_t`, kind: 'num', color, number };
}
function J(suffix = 'x') {
  return { id: `joker_${suffix}`, kind: 'joker', color: null, number: null };
}

// ── RUMMI-001: 타일 풀 구성 ─────────────────────────────────────
section('RUMMI-001: 타일 풀 구성 (createGame)');
{
  const g = createGame();
  const tileCount = Object.keys(g.tiles).length;
  assertEq(tileCount, 106, '총 106 타일');
  // 색·숫자별 정확히 2장.
  let numCnt = 0; let jokerCnt = 0;
  for (const id in g.tiles) {
    const t = g.tiles[id];
    if (t.kind === 'num') numCnt += 1;
    else if (t.kind === 'joker') jokerCnt += 1;
  }
  assertEq(numCnt, 104, '숫자 타일 104');
  assertEq(jokerCnt, 2, '조커 2');
  // 각 (color, number)는 2 copy.
  const pairCnt = {};
  for (const id in g.tiles) {
    const t = g.tiles[id];
    if (t.kind !== 'num') continue;
    const key = `${t.color}_${t.number}`;
    pairCnt[key] = (pairCnt[key] || 0) + 1;
  }
  let allTwo = true;
  for (const c of COLORS) {
    for (const n of NUMBERS) {
      if (pairCnt[`${c}_${n}`] !== 2) allTwo = false;
    }
  }
  assertTrue(allTwo, '모든 (color,number) = 2장');
}

// ── RUMMI-002: 분배 ────────────────────────────────────────────
section('RUMMI-002: 분배 정확성');
{
  const g = createGame();
  assertEq(g.hands.p1.length, INITIAL_HAND_SIZE, 'p1 손 14장');
  assertEq(g.hands.p2.length, INITIAL_HAND_SIZE, 'p2 손 14장');
  assertEq(g.deck.length, 106 - 14 * 2, '더미 78장');
  // 중복 없음.
  const allIds = [...g.hands.p1, ...g.hands.p2, ...g.deck];
  assertEq(new Set(allIds).size, 106, '전체 106개 unique ID');
  assertEq(g.currentTurn, 'p1', '선공 p1');
  assertEq(g.turnNumber, 1, '초기 turnNumber=1');
  assertEq(g.played, { p1: false, p2: false }, '초기 played 양쪽 false');
}

// ── RUMMI-003: validateSet — 그룹 ────────────────────────────────
section('RUMMI-003: validateSet — 그룹');
assertEq(validateSet([T('red', 7), T('blue', 7), T('black', 7)]).valid, true, '7×3색 그룹 valid');
assertEq(validateSet([T('red', 7), T('blue', 7), T('black', 7)]).score, 21, '7×3 = 21점');
assertEq(validateSet([T('red', 7), T('blue', 7), T('black', 7), T('orange', 7)]).valid, true, '7×4색 그룹 valid');
assertEq(validateSet([T('red', 7), T('blue', 7), T('black', 7), T('orange', 7)]).score, 28, '7×4 = 28점');
assertEq(validateSet([T('red', 7), T('red', 7), T('blue', 7)]).valid, false, '같은 색 중복 → invalid');
assertEq(validateSet([T('red', 7), T('blue', 7)]).valid, false, '2장 → invalid (최소 3)');

// ── RUMMI-004: validateSet — 런 ──────────────────────────────────
section('RUMMI-004: validateSet — 런');
assertEq(validateSet([T('red', 4), T('red', 5), T('red', 6)]).valid, true, '같은 색 4-5-6 런 valid');
assertEq(validateSet([T('red', 4), T('red', 5), T('red', 6)]).score, 15, '4+5+6=15');
assertEq(validateSet([T('red', 4), T('red', 5), T('red', 6), T('red', 7)]).valid, true, '4장 런 valid');
assertEq(validateSet([T('red', 4), T('red', 5), T('red', 6), T('red', 7)]).score, 22, '4+5+6+7=22');
assertEq(validateSet([T('red', 4), T('blue', 5), T('red', 6)]).valid, false, '색 섞임 → invalid');
assertEq(validateSet([T('red', 4), T('red', 6), T('red', 7)]).valid, false, '비연속 → invalid');
assertEq(validateSet([T('red', 12), T('red', 13), T('red', 1)]).valid, false, 'wrap-around 금지');

// ── RUMMI-005: validateSet — 조커 포함 ─────────────────────────
section('RUMMI-005: validateSet — 조커 포함');
{
  // 그룹: red7 + blue7 + 조커 → 7로 대체 → score 21.
  const v = validateSet([T('red', 7), T('blue', 7), J('a')]);
  assertEq(v.valid, true, '그룹 + 조커 valid');
  assertEq(v.score, 21, '조커 그룹 점수');
  // 런: red 4-5-조커 → 6으로 대체 → 15.
  const v2 = validateSet([T('red', 4), T('red', 5), J('b')]);
  assertEq(v2.valid, true, '런 + 조커 valid');
  assertEq(v2.score, 15, '런 끝 조커 = 6점 (4+5+6)');
  // 런: red 4-조커-6 → 가운데 조커 5 → 15.
  const v3 = validateSet([T('red', 4), J('b'), T('red', 6)]);
  assertEq(v3.valid, true, '런 가운데 조커 valid');
  assertEq(v3.score, 15, '런 가운데 조커 = 15');
}

// ── RUMMI-006: 첫 등판 30점 미달 → 롤백 ────────────────────────
section('RUMMI-006: 첫 등판 30점 미달 → 롤백');
{
  const g = createGame();
  // p1 손에 red 1 / red 2 / red 3 강제 주입 (테스트 단순화: 손/타일 직접 조작).
  const t1 = { id: 'r1', kind: 'num', color: 'red', number: 1 };
  const t2 = { id: 'r2', kind: 'num', color: 'red', number: 2 };
  const t3 = { id: 'r3', kind: 'num', color: 'red', number: 3 };
  g.tiles.r1 = t1; g.tiles.r2 = t2; g.tiles.r3 = t3;
  g.hands.p1 = ['r1', 'r2', 'r3'];
  g.turnSnapshot = { board: [], hands: { p1: ['r1', 'r2', 'r3'], p2: g.hands.p2.slice() }, nextSetSeq: g.nextSetSeq };

  const r1 = addNewSet(g, 'p1');
  assertTrue(r1.ok, 'NEW_SET ok');
  moveTile(g, 'p1', { kind: 'hand', tileId: 'r1' }, { kind: 'set', setId: r1.setId, index: 0 });
  moveTile(g, 'p1', { kind: 'hand', tileId: 'r2' }, { kind: 'set', setId: r1.setId, index: 1 });
  moveTile(g, 'p1', { kind: 'hand', tileId: 'r3' }, { kind: 'set', setId: r1.setId, index: 2 });
  // 1+2+3=6점 — 30점 미달.
  const er = endTurn(g, 'p1');
  assertEq(er.committed, false, 'commit 안 됨');
  assertEq(er.reason, 'initial_meld_short', '이유: 첫 등판 미달');
  // 손에 r1/r2/r3 + 더미 1장 = 4장.
  assertEq(g.hands.p1.length, 4, '롤백 후 손 = 3 + 더미 1 = 4장');
  assertEq(g.played.p1, false, '여전히 미등판');
  // 보드는 비었어야 함.
  // 첫 등판 변경이 롤백됐고 빈 세트는 finishTurn에서 제거됨.
  let boardTileCnt = 0;
  for (const s of g.board) boardTileCnt += s.tiles.length;
  assertEq(boardTileCnt, 0, '보드 비었음(롤백)');
}

// ── RUMMI-007: 첫 등판 30점 충족 → commit ──────────────────────
section('RUMMI-007: 첫 등판 30점 충족 → commit');
{
  const g = createGame();
  // p1 손에 red 10/11/12 + blue 10/11/12 강제 주입.
  const tiles = {
    a1: { id: 'a1', kind: 'num', color: 'red', number: 10 },
    a2: { id: 'a2', kind: 'num', color: 'red', number: 11 },
    a3: { id: 'a3', kind: 'num', color: 'red', number: 12 },
    b1: { id: 'b1', kind: 'num', color: 'blue', number: 10 },
    b2: { id: 'b2', kind: 'num', color: 'blue', number: 11 },
    b3: { id: 'b3', kind: 'num', color: 'blue', number: 12 },
  };
  Object.assign(g.tiles, tiles);
  g.hands.p1 = ['a1', 'a2', 'a3', 'b1', 'b2', 'b3'];
  g.turnSnapshot = { board: [], hands: { p1: g.hands.p1.slice(), p2: g.hands.p2.slice() }, nextSetSeq: g.nextSetSeq };

  const r1 = addNewSet(g, 'p1');
  moveTile(g, 'p1', { kind: 'hand', tileId: 'a1' }, { kind: 'set', setId: r1.setId, index: 0 });
  moveTile(g, 'p1', { kind: 'hand', tileId: 'a2' }, { kind: 'set', setId: r1.setId, index: 1 });
  moveTile(g, 'p1', { kind: 'hand', tileId: 'a3' }, { kind: 'set', setId: r1.setId, index: 2 });
  // 10+11+12 = 33점 → 충족.
  const er = endTurn(g, 'p1');
  assertEq(er.committed, true, 'commit 성공');
  assertEq(g.played.p1, true, '등판 완료');
  assertEq(g.currentTurn, 'p2', '턴 교대 → p2');
  assertEq(g.hands.p1.length, 3, '손 3장 남음');
}

// ── RUMMI-008: 변경 없이 END_TURN → 더미 뽑기 ──────────────────
section('RUMMI-008: 변경 없이 END_TURN → 더미 뽑기');
{
  const g = createGame();
  const handBefore = g.hands.p1.length;
  const deckBefore = g.deck.length;
  const er = endTurn(g, 'p1');
  assertEq(er.committed, false, 'commit 안 됨');
  assertEq(er.reason, 'no_change', '이유: 변경 없음');
  assertEq(g.hands.p1.length, handBefore + 1, '손 +1');
  assertEq(g.deck.length, deckBefore - 1, '더미 -1');
  assertEq(g.currentTurn, 'p2', '턴 교대');
}

// ── RUMMI-009: 손 0장 → 승리 ────────────────────────────────────
section('RUMMI-009: 손 0장 → 승리');
{
  const g = createGame();
  // p1 등판 완료 + 손 1장만 남긴 상태에서 그 1장을 valid 세트에 추가하는 시나리오.
  // 보드에 red 4-5-6 미리 깔고(설정용), p1 손에 red 7 추가 → red 4-5-6-7로 확장.
  const setupTiles = {
    s1: { id: 's1', kind: 'num', color: 'red', number: 4 },
    s2: { id: 's2', kind: 'num', color: 'red', number: 5 },
    s3: { id: 's3', kind: 'num', color: 'red', number: 6 },
    s4: { id: 's4', kind: 'num', color: 'red', number: 7 },
  };
  Object.assign(g.tiles, setupTiles);
  g.board = [{ id: 'set_init', type: 'run', tiles: ['s1', 's2', 's3'] }];
  g.hands.p1 = ['s4'];
  g.played.p1 = true;
  g.turnSnapshot = {
    board: g.board.map((s) => ({ id: s.id, type: s.type, tiles: s.tiles.slice() })),
    hands: { p1: g.hands.p1.slice(), p2: g.hands.p2.slice() },
    nextSetSeq: g.nextSetSeq,
  };

  // p1이 s4를 set_init 끝에 추가.
  moveTile(g, 'p1', { kind: 'hand', tileId: 's4' }, { kind: 'set', setId: 'set_init', index: 3 });
  const er = endTurn(g, 'p1');
  assertEq(er.committed, true, 'commit 성공');
  assertEq(er.gameOver, true, '게임 종료');
  assertEq(g.phase, 'ended', 'phase=ended');
  assertEq(g.result.winner, 'p1', 'p1 승리');
}

// ── RUMMI-011: 조커 회수 성공 ─────────────────────────────────
section('RUMMI-011: 조커 회수 — 정확한 손 타일과 swap 성공');
{
  const g = createGame();
  // 보드: [red 3, joker, red 5] 런 — 조커가 red 4를 대체.
  // 본인 손에 red 4 + 그 회수한 조커를 사용할 두 번째 세트 후보까지 준비.
  const tiles = {
    r3: { id: 'r3', kind: 'num', color: 'red', number: 3 },
    r5: { id: 'r5', kind: 'num', color: 'red', number: 5 },
    r4: { id: 'r4', kind: 'num', color: 'red', number: 4 },
    JX: { id: 'JX', kind: 'joker', color: null, number: null },
  };
  Object.assign(g.tiles, tiles);
  g.board = [{ id: 'set_init', type: 'run', tiles: ['r3', 'JX', 'r5'] }];
  g.hands.p1 = ['r4'];
  g.played.p1 = true;
  g.turnSnapshot = {
    board: g.board.map((s) => ({ id: s.id, type: s.type, tiles: s.tiles.slice() })),
    hands: { p1: g.hands.p1.slice(), p2: g.hands.p2.slice() },
    nextSetSeq: g.nextSetSeq,
    jokerReturnedThisTurn: {},
  };
  g.jokerReturnedThisTurn = {};

  const r = swapJoker(g, 'p1', { setId: 'set_init', jokerIndex: 1, handTileId: 'r4' });
  assertEq(r.ok, true, 'swapJoker ok=true');
  assertEq(r.jokerId, 'JX', '회수된 조커 ID');
  assertEq(g.board[0].tiles, ['r3', 'r4', 'r5'], '보드에 r4가 자리잡음');
  assertTrue(g.hands.p1.includes('JX'), '조커가 본인 손으로 회수됨');
  assertTrue(!g.hands.p1.includes('r4'), 'r4는 손에서 빠짐');
  assertTrue(!!g.jokerReturnedThisTurn['JX'], '회수 추적 표시됨');
}

// ── RUMMI-012: 회수 조커 미사용 → 롤백 ─────────────────────────
section('RUMMI-012: 조커 회수 후 미사용 → END_TURN invalid → 롤백 + 더미 1장');
{
  const g = createGame();
  const tiles = {
    r3: { id: 'r3', kind: 'num', color: 'red', number: 3 },
    r5: { id: 'r5', kind: 'num', color: 'red', number: 5 },
    r4: { id: 'r4', kind: 'num', color: 'red', number: 4 },
    JX: { id: 'JX', kind: 'joker', color: null, number: null },
  };
  Object.assign(g.tiles, tiles);
  g.board = [{ id: 'set_init', type: 'run', tiles: ['r3', 'JX', 'r5'] }];
  g.hands.p1 = ['r4'];
  g.played.p1 = true;
  const handBefore = g.hands.p1.slice();
  const deckBefore = g.deck.length;
  g.turnSnapshot = {
    board: g.board.map((s) => ({ id: s.id, type: s.type, tiles: s.tiles.slice() })),
    hands: { p1: handBefore, p2: g.hands.p2.slice() },
    nextSetSeq: g.nextSetSeq,
    jokerReturnedThisTurn: {},
  };
  g.jokerReturnedThisTurn = {};

  swapJoker(g, 'p1', { setId: 'set_init', jokerIndex: 1, handTileId: 'r4' });
  // 조커가 손에 들어왔지만 다른 세트에 사용 안 함 → END_TURN.
  const er = endTurn(g, 'p1');
  assertEq(er.committed, false, 'commit 안 됨');
  assertEq(er.reason, 'joker_unused', '이유: joker_unused');
  // 보드 복구.
  assertEq(g.board[0].tiles, ['r3', 'JX', 'r5'], '보드 롤백 (조커 자리 그대로)');
  // 손 = r4 + 더미 1장 = 2장 (조커 없음).
  assertEq(g.hands.p1.length, handBefore.length + 1, '손 = 원본 + 더미 1장');
  assertTrue(g.hands.p1.includes('r4'), 'r4 원상복귀');
  assertTrue(!g.hands.p1.includes('JX'), '조커는 다시 보드에 있음');
  assertEq(g.deck.length, deckBefore - 1, '더미 -1');
}

// ── RUMMI-013: 회수 조커를 다른 세트에 사용 → commit ───────────
section('RUMMI-013: 조커 회수 + 다른 세트에 사용 → END_TURN commit');
{
  const g = createGame();
  // 보드: [red 3, joker, red 5] 런 + 미리 깔린 다른 valid 그룹 [blue 7, black 7, orange 7]
  // 본인 손에 r4 + red 7 (조커 회수 후 red 7 그룹에 조커를 끼워 4번째로 만들기).
  const tiles = {
    r3: { id: 'r3', kind: 'num', color: 'red', number: 3 },
    r5: { id: 'r5', kind: 'num', color: 'red', number: 5 },
    r4: { id: 'r4', kind: 'num', color: 'red', number: 4 },
    JX: { id: 'JX', kind: 'joker', color: null, number: null },
    b7: { id: 'b7', kind: 'num', color: 'blue', number: 7 },
    k7: { id: 'k7', kind: 'num', color: 'black', number: 7 },
    o7: { id: 'o7', kind: 'num', color: 'orange', number: 7 },
  };
  Object.assign(g.tiles, tiles);
  g.board = [
    { id: 'set_run', type: 'run', tiles: ['r3', 'JX', 'r5'] },
    { id: 'set_grp', type: 'group', tiles: ['b7', 'k7', 'o7'] },
  ];
  g.hands.p1 = ['r4'];
  g.played.p1 = true;
  g.turnSnapshot = {
    board: g.board.map((s) => ({ id: s.id, type: s.type, tiles: s.tiles.slice() })),
    hands: { p1: g.hands.p1.slice(), p2: g.hands.p2.slice() },
    nextSetSeq: g.nextSetSeq,
    jokerReturnedThisTurn: {},
  };
  g.jokerReturnedThisTurn = {};

  swapJoker(g, 'p1', { setId: 'set_run', jokerIndex: 1, handTileId: 'r4' });
  // 회수된 조커를 set_grp(blue/black/orange 7 그룹)에 4번째 자리로 추가.
  const mr = moveTile(g, 'p1', { kind: 'hand', tileId: 'JX' }, { kind: 'set', setId: 'set_grp', index: 3 });
  assertEq(mr.ok, true, 'moveTile(JX → set_grp) ok');
  const er = endTurn(g, 'p1');
  assertEq(er.committed, true, 'commit 성공');
  assertEq(g.hands.p1.length, 0, '손 0장 → 승리 트리거');
  assertEq(g.phase, 'ended', '게임 종료(empty_hand)');
  assertEq(g.result.winner, 'p1', 'p1 승리');
}

// ── RUMMI-014/015: 봇 보드 재조합 단위 테스트 ───────────────────
section('RUMMI-014: 보드 런 끝 확장 — validateSet 단위 검증');
{
  // bot.js의 findBoardExtensions는 외부 노출이 없고 진입 시 WS 접속을 시도하므로
  // smoke에서는 game.js의 validateSet으로 "양 끝 확장이 valid 세트가 됨"만 검증.
  // end-to-end 봇 행동은 RUMMI-010에서 통합 검증.
  const D = {
    r3: { id: 'r3', kind: 'num', color: 'red', number: 3 },
    r4: { id: 'r4', kind: 'num', color: 'red', number: 4 },
    r5: { id: 'r5', kind: 'num', color: 'red', number: 5 },
    r6: { id: 'r6', kind: 'num', color: 'red', number: 6 },
    r7: { id: 'r7', kind: 'num', color: 'red', number: 7 },
  };
  const all = ['r3', 'r4', 'r5', 'r6', 'r7'].map((id) => D[id]);
  const v = validateSet(all);
  assertEq(v.valid, true, '확장 후 [3,4,5,6,7] 런 valid');
  assertEq(v.score, 3 + 4 + 5 + 6 + 7, '확장 후 점수 25');
  const front = ['r3', 'r4', 'r5', 'r6'].map((id) => D[id]);
  const back = ['r4', 'r5', 'r6', 'r7'].map((id) => D[id]);
  assertEq(validateSet(front).valid, true, '앞 끝 확장 valid');
  assertEq(validateSet(back).valid, true, '뒤 끝 확장 valid');
}

section('RUMMI-015: 그룹 4번째 색 추가 valid');
{
  // 보드 [blue 7, black 7, orange 7] + 손에 red 7 → 4장 그룹.
  const tiles = [
    { id: 'b7', kind: 'num', color: 'blue', number: 7 },
    { id: 'k7', kind: 'num', color: 'black', number: 7 },
    { id: 'o7', kind: 'num', color: 'orange', number: 7 },
    { id: 'r7', kind: 'num', color: 'red', number: 7 },
  ];
  const v = validateSet(tiles);
  assertEq(v.valid, true, '4색 그룹 valid');
  assertEq(v.score, 28, '4×7 = 28');
  // 5색 추가는 불가(색 4종 한도).
  const tiles5 = tiles.concat([{ id: 'r7b', kind: 'num', color: 'red', number: 7 }]);
  assertEq(validateSet(tiles5).valid, false, '5장 단일 숫자 → invalid');
}

// ── RUMMI-016: 더미 빈 + 양쪽 패스 → 손 적은 자 승리 ──────────────
section('RUMMI-016: 더미 빈 + 양쪽 패스 1회씩 → 라운드 종료 + 손 적은 자 승리');
{
  const g = createGame();
  // 더미 강제로 비움.
  g.deck = [];
  // 손은 비대칭: p1=3장, p2=5장 → p1 승리 기대.
  g.hands.p1 = g.hands.p1.slice(0, 3);
  g.hands.p2 = g.hands.p2.slice(0, 5);
  g.played.p1 = true;
  g.played.p2 = true;
  g.turnSnapshot = {
    board: [],
    hands: { p1: g.hands.p1.slice(), p2: g.hands.p2.slice() },
    nextSetSeq: g.nextSetSeq,
    jokerReturnedThisTurn: {},
  };
  // p1 패스 (변경 없음).
  const e1 = endTurn(g, 'p1');
  assertEq(e1.gameOver, false, '1회 패스 — 아직 종료 아님');
  assertEq(g.consecutivePassesAfterDeckEmpty, 1, '패스 카운터 1');
  // p2 패스.
  const e2 = endTurn(g, 'p2');
  assertEq(e2.gameOver, true, '2회 패스 → 라운드 종료');
  assertEq(g.phase, 'ended', 'phase=ended');
  assertEq(g.result.winner, 'p1', '손 적은 p1 승리');
  assertEq(g.result.reason, 'deck_empty_pass', '이유: deck_empty_pass');
  assertEq(g.result.handCounts, { p1: 3, p2: 5 }, '손 개수 기록');
}

// ── RUMMI-017: 더미 빈 + 양쪽 손 같음 → 무승부 ────────────────────
section('RUMMI-017: 더미 빈 + 양쪽 손 같음 → 무승부');
{
  const g = createGame();
  g.deck = [];
  g.hands.p1 = g.hands.p1.slice(0, 4);
  g.hands.p2 = g.hands.p2.slice(0, 4);
  g.played.p1 = true;
  g.played.p2 = true;
  g.turnSnapshot = {
    board: [],
    hands: { p1: g.hands.p1.slice(), p2: g.hands.p2.slice() },
    nextSetSeq: g.nextSetSeq,
    jokerReturnedThisTurn: {},
  };
  endTurn(g, 'p1');
  const e2 = endTurn(g, 'p2');
  assertEq(e2.gameOver, true, '라운드 종료');
  assertEq(g.result.winner, 'draw', '무승부');
  assertEq(g.result.reason, 'deck_empty_pass', '이유: deck_empty_pass');
}

// ── RUMMI-018: 봇 조커 활용 (그룹) ──────────────────────────────
section('RUMMI-018: 봇 조커 활용 — 그룹 빈 색 채우기');
{
  // 손 = red 7 + blue 7 + 조커 → 3장 그룹 후보가 enumerateCandidateSets에 포함되어야 한다.
  const hand = [
    { id: 'r7', kind: 'num', color: 'red', number: 7 },
    { id: 'b7', kind: 'num', color: 'blue', number: 7 },
    { id: 'JX', kind: 'joker', color: null, number: null },
  ];
  const cands = enumerateCandidateSets(hand);
  // 조커 사용 그룹 후보가 있는지.
  const jokerGroups = cands.filter((c) =>
    c.type === 'group' && c.tiles.some((t) => t.kind === 'joker') &&
    c.tiles.some((t) => t.id === 'r7') && c.tiles.some((t) => t.id === 'b7')
  );
  assertTrue(jokerGroups.length >= 1, '조커 그룹 후보 ≥1개');
  // 그 후보가 isValidSet에 통과해야 한다.
  const v = isValidSet(jokerGroups[0].tiles);
  assertTrue(v, '조커 그룹 후보 valid');
  assertEq(jokerGroups[0].score, 21, '조커 그룹 점수 = 7×3 = 21');
  // 조커 없는 그룹 후보는 없어야 한다 (색 2장뿐이므로).
  const nonJokerGroups = cands.filter((c) =>
    c.type === 'group' && !c.tiles.some((t) => t.kind === 'joker') && c.tiles.length === 3 &&
    c.tiles.some((t) => t.id === 'r7') && c.tiles.some((t) => t.id === 'b7')
  );
  assertEq(nonJokerGroups.length, 0, '색 2장만 있어 비조커 그룹 후보 0개');
}

// ── RUMMI-019: 봇 조커 활용 (런 사이 빈 자리) ────────────────────
section('RUMMI-019: 봇 조커 활용 — 런 사이 빈 자리');
{
  const hand = [
    { id: 'r3', kind: 'num', color: 'red', number: 3 },
    { id: 'r5', kind: 'num', color: 'red', number: 5 },
    { id: 'JX', kind: 'joker', color: null, number: null },
  ];
  const cands = enumerateCandidateSets(hand);
  // [r3, J, r5] 런 후보가 있어야 한다 (3-4-5 = 12점).
  const jokerRuns = cands.filter((c) =>
    c.type === 'run' && c.tiles.some((t) => t.kind === 'joker') &&
    c.tiles.some((t) => t.id === 'r3') && c.tiles.some((t) => t.id === 'r5')
  );
  assertTrue(jokerRuns.length >= 1, '조커 런 후보 ≥1개');
  // 후보 중 점수 12점 (3+4+5) 있어야.
  const score12 = jokerRuns.find((c) => c.score === 12);
  assertTrue(!!score12, '점수 3+4+5 = 12 후보 존재');
  assertTrue(isValidSet(score12.tiles), '조커 런 후보 valid');
}

// ── RUMMI-019b: 봇 조커 활용 — 런 양 끝 확장 ─────────────────────
section('RUMMI-019b: 봇 조커 활용 — 런 양 끝 확장 후보');
{
  // 손 [red 4, red 5] + 조커 → [3,4,5] 또는 [4,5,6] 후보 생성.
  const hand = [
    { id: 'r4', kind: 'num', color: 'red', number: 4 },
    { id: 'r5', kind: 'num', color: 'red', number: 5 },
    { id: 'JX', kind: 'joker', color: null, number: null },
  ];
  const cands = enumerateCandidateSets(hand);
  const jokerRuns = cands.filter((c) =>
    c.type === 'run' && c.tiles.some((t) => t.kind === 'joker')
  );
  assertTrue(jokerRuns.length >= 2, '앞 확장 + 뒤 확장 양쪽 후보 ≥2개');
  // 점수 12 (3+4+5) 또는 15 (4+5+6) 있어야.
  const has12 = jokerRuns.some((c) => c.score === 12);
  const has15 = jokerRuns.some((c) => c.score === 15);
  assertTrue(has12 && has15, '점수 12 + 15 양쪽 후보 존재');
}

// ── RUMMI-020: 봇 보드 재구성 — 런 분해 + 새 그룹 ────────────────
section('RUMMI-020: 봇 보드 재구성 — 보드 [red 3-4-5-6] 분리 + 손 [k3, o3]로 [r3,k3,o3] 그룹 생성');
{
  // STATE 모의: 보드 [r3-r4-r5-r6] 런 + 손 [k3, o3].
  const tileDict = {
    r3: { id: 'r3', kind: 'num', color: 'red', number: 3 },
    r4: { id: 'r4', kind: 'num', color: 'red', number: 4 },
    r5: { id: 'r5', kind: 'num', color: 'red', number: 5 },
    r6: { id: 'r6', kind: 'num', color: 'red', number: 6 },
    k3: { id: 'k3', kind: 'num', color: 'black', number: 3 },
    o3: { id: 'o3', kind: 'num', color: 'orange', number: 3 },
  };
  const state = {
    board: [{ id: 'set_a', type: 'run', tiles: ['r3', 'r4', 'r5', 'r6'] }],
    myHand: ['k3', 'o3'],
    tileDict,
    played: { p1: true, p2: false },
    currentTurn: 'p1',
  };
  const recon = findBoardReconstruction(state, new Set());
  assertTrue(recon !== null, '재구성 결과 발견');
  assertTrue(recon.handReduction >= 2, '손 ≥2장 감소(k3, o3 둘 다 사용)');
  // 새 세트 생성 액션이 하나 있어야 한다.
  assertEq(recon.actions.length, 1, '액션 1개 (NEW_SET)');
  assertEq(recon.actions[0].kind, 'new_set_with_tiles', 'new_set_with_tiles 액션');
  // 새 세트 안에 r3(보드에서), k3/o3(손에서)이 포함되어야 한다.
  const tilesInNew = recon.actions[0].tiles;
  const fromSet = tilesInNew.filter((t) => t.source === 'set' && t.setId === 'set_a' && t.tileId === 'r3');
  const fromHand = tilesInNew.filter((t) => t.source === 'hand');
  assertEq(fromSet.length, 1, '보드 set_a에서 r3 분리');
  assertEq(fromHand.length, 2, '손에서 2장 추가');
  const handIds = new Set(fromHand.map((t) => t.tileId));
  assertTrue(handIds.has('k3') && handIds.has('o3'), 'k3 + o3 양쪽 사용');
}

// ── RUMMI-021: 봇 재구성 — 시간 제한 ────────────────────────────
section('RUMMI-021: 봇 재구성 — 500ms 시간 제한 + 못 찾으면 null');
{
  // 보드/손 모두 비어 있는 STATE → null 반환 + 즉시 종료.
  const t0 = Date.now();
  const result = findBoardReconstruction({ board: [], myHand: [], tileDict: {}, played: {}, currentTurn: 'p1' }, new Set());
  const elapsed = Date.now() - t0;
  assertEq(result, null, '재구성 후보 없음 → null');
  assertTrue(elapsed < 100, `즉시 종료 (실측 ${elapsed}ms < 100ms)`);

  // 케이스 2: 손 풍부하지만 보드 재구성 불가 (모든 세트 3장) — null 또는 시간 내 종료.
  const tiles = {};
  for (let i = 0; i < 20; i++) {
    tiles[`t${i}`] = { id: `t${i}`, kind: 'num', color: 'red', number: (i % 13) + 1 };
  }
  // 보드에 3장 그룹 1개(분해 시 invalid).
  tiles.g1 = { id: 'g1', kind: 'num', color: 'red', number: 8 };
  tiles.g2 = { id: 'g2', kind: 'num', color: 'blue', number: 8 };
  tiles.g3 = { id: 'g3', kind: 'num', color: 'black', number: 8 };
  const state2 = {
    board: [{ id: 'set_x', type: 'group', tiles: ['g1', 'g2', 'g3'] }],
    myHand: Array.from({ length: 14 }, (_, i) => `t${i}`),
    tileDict: tiles,
    played: { p1: true },
    currentTurn: 'p1',
  };
  const t1 = Date.now();
  const r2 = findBoardReconstruction(state2, new Set());
  const e2 = Date.now() - t1;
  // 3장 그룹 분해 불가 → null 기대.
  assertEq(r2, null, '3장 세트 분해 불가 → null');
  assertTrue(e2 < 600, `시간 제한 준수 (실측 ${e2}ms < 600ms)`);
}

// ── RUMMI-022: 봇 재구성 — 조커 포함 세트는 분해 후보 제외 ───────
section('RUMMI-022: 봇 재구성 — 조커 포함 세트 분해 제외(안전 회피)');
{
  // 보드 [r3, J, r5] (조커 포함 런) + 손 [k3, o3] → 봇은 조커 회수를 시도하지 않으므로
  // 재구성 후보가 없어야 한다(null).
  const tileDict = {
    r3: { id: 'r3', kind: 'num', color: 'red', number: 3 },
    r5: { id: 'r5', kind: 'num', color: 'red', number: 5 },
    JX: { id: 'JX', kind: 'joker', color: null, number: null },
    k3: { id: 'k3', kind: 'num', color: 'black', number: 3 },
    o3: { id: 'o3', kind: 'num', color: 'orange', number: 3 },
  };
  const state = {
    board: [{ id: 'set_a', type: 'run', tiles: ['r3', 'JX', 'r5'] }],
    myHand: ['k3', 'o3'],
    tileDict,
    played: { p1: true },
    currentTurn: 'p1',
  };
  const recon = findBoardReconstruction(state, new Set());
  assertEq(recon, null, '조커 포함 세트 분해 불가 → null (안전 회피)');
}

// ── RUMMI-010: 봇 시나리오 ─────────────────────────────────────
section('RUMMI-010: 봇 시나리오 (mode=ai → 봇 spawn → 짧은 진행)');
async function runBotScenario() {
  const PORT = 3096;
  const app = createApp({
    hostUrl: '',
    getBotUrl: () => `ws://localhost:${PORT}/ws?mode=bot`,
  });
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', resolve);
  });

  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?mode=ai`);
  const queue = [];
  const waiters = [];
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (waiters.length) waiters.shift()(msg);
    else queue.push(msg);
  });
  function waitFor(type, timeoutMs = 30000) {
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
  function send(msg) { ws.send(JSON.stringify(msg)); }
  await new Promise((res) => ws.once('open', res));

  send({ type: 'JOIN', playerName: '나' });
  const joined = await waitFor('JOINED');
  assertEq(joined.playerId, 'p1', '사람이 p1 자리 점유');

  send({ type: 'READY' });
  await waitFor('START', 15000);
  const sInit = await waitFor('STATE', 5000);
  assertEq(sInit.currentTurn, 'p1', '선공 p1 (사람)');
  assertEq(sInit.turnNumber, 1, '초기 turnNumber=1');
  assertEq(sInit.myHand.length, 14, '사람 손 14장');
  assertEq(sInit.oppHandCount, 14, '봇 손 14장(갯수만)');

  // 사람: 변경 없이 END_TURN → 더미 1장.
  send({ type: 'END_TURN' });
  await waitFor('TURN_RESULT', 5000);
  const sAfter = await waitFor('STATE', 5000);
  assertEq(sAfter.myHand.length, 15, '사람 손 15장(더미 +1)');
  assertEq(sAfter.currentTurn, 'p2', '턴 → 봇');

  // 봇이 자기 턴 → END_TURN까지 진행. 다음 STATE에서 currentTurn = p1.
  // 봇은 30점 못 채우면 END_TURN(no_change) 또는 무효 보드 → 어느 쪽이든 결국 턴 종료된다.
  // 최대 30초 대기.
  let backToHuman = false;
  const t0 = Date.now();
  while (!backToHuman) {
    if (Date.now() - t0 > 30000) throw new Error('봇 턴 timeout');
    const s = await waitFor('STATE', 30000);
    if (s.currentTurn === 'p1' || s.phase === 'ended') {
      backToHuman = true;
      assertTrue(true, '봇 턴 정상 종료 (currentTurn → p1)');
    }
  }

  ws.close();
  await new Promise((res) => server.close(res));
}

try {
  await runBotScenario();
} catch (err) {
  failed += 1;
  failures.push(`bot scenario 예외: ${err.message}\n${err.stack}`);
  console.log(`  FAIL  bot scenario 예외: ${err.message}`);
}

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
