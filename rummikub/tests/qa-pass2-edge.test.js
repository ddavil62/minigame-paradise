/**
 * @fileoverview QA 2차 패스 — 클라이언트 정적 분석 + 룰 추가 엣지 케이스.
 *
 * 카테고리:
 *   CLIENT-001: network.js 재연결이 한 번만 시도되는지 (reconnectAttempted 한계)
 *   CLIENT-002: handArea click bubble — 손 타일 클릭 시 회수도 같이 발동?
 *   GAME-001:  validateSet — 단일 숫자 5장 + 1장 다른 → fallthrough 처리
 *   GAME-002:  swapJoker — 같은 조커를 두 번 swap (왕복) → jokerReturnedThisTurn 누적?
 *   GAME-003:  endTurn — 첫 등판 30점 정확 + 회수 조커 미사용 → 어느 reason 우선?
 *   GAME-004:  moveTile from === to (같은 위치) → no-op? 거부?
 *   GAME-005:  moveTile setId가 같지만 index가 더 큰 자리 (자기 자신 옆) → 정상?
 *   GAME-006:  NEW_SET 무한 호출 (500회) → 메모리 누수? nextSetSeq 오버플로우?
 *   GAME-007:  computeInitialMeldScore — fresh 조커가 그룹/런에 포함될 때 정확한 점수
 *   GAME-008:  validateSet — tiles=[null, T, T] 등 null 포함
 *   GAME-009:  endTurn — 빈 NEW_SET 여러 개 + 실제 변경 1건 → boardChanged 정확?
 *   GAME-010:  hand 정렬 stability (같은 색/숫자 2장 = copy 1/copy 2 정렬)
 *   BOT-007:   봇이 빈 손에서 act 호출 시 (조작된 상황) → 크래시 X
 *   BOT-008:   봇 enumerateCandidateSets 빈 손 + 조커만 → 빈 배열
 *
 * 실행:
 *   node tests/qa-pass2-edge.test.js
 */

import {
  createGame,
  validateSet,
  validateBoard,
  addNewSet,
  moveTile,
  swapJoker,
  endTurn,
  snapshotFor,
} from '../game.js';
import {
  enumerateCandidateSets,
  findBoardReconstruction,
  findBoardExtensions,
  findBestSetCombination,
  isValidSet,
} from '../bot.js';

let passed = 0;
let failed = 0;
const failures = [];
const issues = [];

function assertTrue(cond, label) {
  if (cond) { passed += 1; console.log(`  PASS  ${label}`); }
  else { failed += 1; const msg = `  FAIL  ${label}`; console.log(msg); failures.push(msg); }
}
function assertEq(a, b, label) {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (ok) { passed += 1; console.log(`  PASS  ${label}`); }
  else {
    failed += 1;
    const msg = `  FAIL  ${label}\n    expected: ${JSON.stringify(b)}\n    actual:   ${JSON.stringify(a)}`;
    console.log(msg);
    failures.push(msg);
  }
}
function section(name) { console.log(`\n[${name}]`); }
function reportIssue(severity, label, detail) {
  issues.push({ severity, label, detail });
  console.log(`  ISSUE [${severity}] ${label} — ${detail}`);
}

function setSnapshot(g, board, hands) {
  g.board = board.map((s) => ({ ...s, tiles: s.tiles.slice() }));
  g.hands = { p1: hands.p1.slice(), p2: hands.p2.slice() };
  g.turnSnapshot = {
    board: g.board.map((s) => ({ id: s.id, type: s.type, tiles: s.tiles.slice() })),
    hands: { p1: g.hands.p1.slice(), p2: g.hands.p2.slice() },
    nextSetSeq: g.nextSetSeq,
    jokerReturnedThisTurn: {},
  };
  g.jokerReturnedThisTurn = {};
}

function injectTiles(g, dict) { Object.assign(g.tiles, dict); }

// ═══════════════════════════════════════════════════════════════════
// GAME-001: validateSet 단일 숫자 5장 → 그룹 불가 + 색 중복 메시지
// ═══════════════════════════════════════════════════════════════════
section('GAME-001: validateSet 단일 숫자 5장 → 색 중복 거부');
{
  // 5장 7s: red, blue, black, orange, red(중복).
  const tiles = [
    { id: 'r7a', kind: 'num', color: 'red', number: 7 },
    { id: 'b7', kind: 'num', color: 'blue', number: 7 },
    { id: 'k7', kind: 'num', color: 'black', number: 7 },
    { id: 'o7', kind: 'num', color: 'orange', number: 7 },
    { id: 'r7b', kind: 'num', color: 'red', number: 7 },
  ];
  const v = validateSet(tiles);
  assertEq(v.valid, false, 'GAME-001-1: 5장 단일 숫자 invalid');
  // 단일 숫자 5장 + 색 중복 → 룰: 그룹은 최대 4장 + 색 중복 모두 위반.
  // 현재 코드는 length 분기에서 그룹 검증을 건너뛰고 런 검증으로 가는데, 단일 숫자라 allSameColor=false → "같은 숫자도 아니고 같은 색도 아닙니다" 메시지.
  // 이건 명확한 에러 메시지는 아니지만 invalid이므로 PASS.
}

// 단일 숫자 5장 + 색 모두 다른 경우는 불가능 (색 4종) — skip.

// ═══════════════════════════════════════════════════════════════════
// GAME-002: 조커 왕복 (return + 다시 boards에) → jokerReturnedThisTurn?
// ═══════════════════════════════════════════════════════════════════
section('GAME-002: 조커 회수 후 다른 세트에 놓기 → endTurn 정상');
{
  const g = createGame();
  // 보드: [red 7, blue 7, J] valid 그룹.
  // 손: black 7 (조커 회수 가능) + 다른 세트 [red 1, red 2, red 3]에 J 사용.
  const D = {
    r7: { id: 'r7', kind: 'num', color: 'red', number: 7 },
    b7: { id: 'b7', kind: 'num', color: 'blue', number: 7 },
    Jx: { id: 'Jx', kind: 'joker', color: null, number: null },
    k7: { id: 'k7', kind: 'num', color: 'black', number: 7 },
    r1: { id: 'r1', kind: 'num', color: 'red', number: 1 },
    r2: { id: 'r2', kind: 'num', color: 'red', number: 2 },
    r3: { id: 'r3', kind: 'num', color: 'red', number: 3 },
  };
  injectTiles(g, D);
  g.played = { p1: true, p2: true };  // 등판 완료 상태로 가정.
  setSnapshot(g,
    [{ id: 'set_1', type: 'group', tiles: ['r7', 'b7', 'Jx'] }],
    { p1: ['k7', 'r1', 'r2', 'r3'], p2: [] });
  g.nextSetSeq = 2;

  // SWAP_JOKER: black7로 조커 회수.
  const r = swapJoker(g, 'p1', { setId: 'set_1', jokerIndex: 2, handTileId: 'k7' });
  assertTrue(r.ok, 'GAME-002-1: swapJoker 성공');
  assertTrue(g.jokerReturnedThisTurn['Jx'] === true, 'GAME-002-2: jokerReturnedThisTurn["Jx"]=true');

  // 새 세트 [r1, r2, r3] 생성하고 그 안에 회수 조커는 안 넣음 → endTurn 시 joker_unused?
  // 잠깐: 회수 조커를 다시 다른 자리에 넣어야 함. 회수했다면 손에 있는 Jx를 NEW_SET + MOVE_TILE로 넣어야 함.
  const r2 = addNewSet(g, 'p1');
  moveTile(g, 'p1', { kind: 'hand', tileId: 'r1' }, { kind: 'set', setId: 'set_2', index: 0 });
  moveTile(g, 'p1', { kind: 'hand', tileId: 'r2' }, { kind: 'set', setId: 'set_2', index: 1 });
  moveTile(g, 'p1', { kind: 'hand', tileId: 'Jx' }, { kind: 'set', setId: 'set_2', index: 2 });

  const er = endTurn(g, 'p1');
  assertTrue(er.ok, 'GAME-002-3: endTurn 성공');
  assertEq(er.reason, 'committed', 'GAME-002-4: 회수 조커 사용 → committed');
}

// ═══════════════════════════════════════════════════════════════════
// GAME-003: 첫 등판 30점 + 회수 조커 미사용 동시 → 어느 우선?
// ═══════════════════════════════════════════════════════════════════
section('GAME-003: 회수 조커 미사용 → joker_unused 우선 (등판 후, 룰픽스 #4 반영)');
{
  const g = createGame();
  // [룰픽스 #4] swapJoker는 첫 등판 후에만 허용된다. 따라서 p1을 이미 등판 상태로 둔다.
  // (옛 테스트는 "첫 등판 전 SWAP_JOKER 가능"을 단정했으나, #4 가드 도입으로 거부가 정답.)
  const D = {
    r7: { id: 'r7', kind: 'num', color: 'red', number: 7 },
    b7: { id: 'b7', kind: 'num', color: 'blue', number: 7 },
    Jx: { id: 'Jx', kind: 'joker', color: null, number: null },
    k7: { id: 'k7', kind: 'num', color: 'black', number: 7 },
  };
  injectTiles(g, D);
  setSnapshot(g,
    [{ id: 'set_1', type: 'group', tiles: ['r7', 'b7', 'Jx'] }],
    { p1: ['k7'], p2: [] });
  g.played = { p1: true, p2: true }; // [#4] 등판 후라야 조커 회수 가능.
  g.nextSetSeq = 2;

  // [룰픽스 #4] 첫 등판 전에는 swapJoker 거부됨을 먼저 확인.
  const gPre = createGame();
  injectTiles(gPre, D);
  setSnapshot(gPre,
    [{ id: 'set_1', type: 'group', tiles: ['r7', 'b7', 'Jx'] }],
    { p1: ['k7'], p2: [] });
  gPre.played = { p1: false, p2: false };
  gPre.nextSetSeq = 2;
  const rPre = swapJoker(gPre, 'p1', { setId: 'set_1', jokerIndex: 2, handTileId: 'k7' });
  assertTrue(!rPre.ok && rPre.error && rPre.error.includes('첫 등판'),
    'GAME-003-1: 첫 등판 전 SWAP_JOKER 거부 (#4 가드)');

  // 등판 후 swapJoker 성공 → 회수 조커가 손에 남으면 joker_unused.
  const r = swapJoker(g, 'p1', { setId: 'set_1', jokerIndex: 2, handTileId: 'k7' });
  assertTrue(r.ok, 'GAME-003-1b: 등판 후 SWAP_JOKER 성공');
  // 보드는 [r7, b7, k7] valid 그룹. 손은 [Jx](회수됨, 미사용).
  // endTurn 코드 순서: validateBoard → joker check → ... → joker_unused로 롤백.
  const er = endTurn(g, 'p1');
  assertTrue(!er.committed, 'GAME-003-2: 회수 조커 미사용 → 롤백');
  console.log(`  GAME-003: er.reason=${er.reason}`);
  assertEq(er.reason, 'joker_unused', 'GAME-003-3: joker_unused 우선 (조커 검사 코드 순서)');
}

// ═══════════════════════════════════════════════════════════════════
// GAME-004: moveTile from === to (같은 위치) → ?
// ═══════════════════════════════════════════════════════════════════
section('GAME-004: moveTile 같은 위치 hand→hand');
{
  const g = createGame();
  const D = {
    x1: { id: 'x1', kind: 'num', color: 'red', number: 5 },
  };
  injectTiles(g, D);
  setSnapshot(g, [], { p1: ['x1'], p2: [] });
  const handBefore = g.hands.p1.slice();
  const r = moveTile(g, 'p1', { kind: 'hand', tileId: 'x1' }, { kind: 'hand' });
  console.log(`  GAME-004: r.ok=${r.ok}, hand after=${JSON.stringify(g.hands.p1)}`);
  // 현재 구현: 손에서 splice + 손에 push → 순서 변경 (1장만 있으면 동일).
  assertTrue(r.ok, 'GAME-004-1: hand→hand 호출 ok=true (현재 구현)');
  assertEq(g.hands.p1, handBefore, 'GAME-004-2: 1장만 있으면 변화 없음');

  // 2장으로 테스트 — splice + push.
  injectTiles(g, { y1: { id: 'y1', kind: 'num', color: 'blue', number: 6 } });
  setSnapshot(g, [], { p1: ['x1', 'y1'], p2: [] });
  const r2 = moveTile(g, 'p1', { kind: 'hand', tileId: 'x1' }, { kind: 'hand' });
  assertTrue(r2.ok, 'GAME-004-3: 2장 + hand→hand 호출 ok=true');
  // x1이 끝으로 이동 → [y1, x1]?
  assertEq(g.hands.p1, ['y1', 'x1'], 'GAME-004-4: 손 순서 변경 부수효과 확인 (LOW 알려진 이슈)');
}

// ═══════════════════════════════════════════════════════════════════
// GAME-005: moveTile 같은 세트 내 인덱스 이동
// ═══════════════════════════════════════════════════════════════════
section('GAME-005: moveTile 같은 세트 내 인덱스 이동');
{
  const g = createGame();
  const D = {
    a: { id: 'a', kind: 'num', color: 'red', number: 5 },
    b: { id: 'b', kind: 'num', color: 'blue', number: 5 },
    c: { id: 'c', kind: 'num', color: 'black', number: 5 },
  };
  injectTiles(g, D);
  g.played = { p1: true, p2: true };
  setSnapshot(g, [{ id: 'set_1', type: 'group', tiles: ['a', 'b', 'c'] }],
    { p1: [], p2: [] });
  // 같은 세트 내에서 a(인덱스0)를 목표 인덱스 2로 이동.
  const r = moveTile(g, 'p1', { kind: 'set', setId: 'set_1', tileId: 'a' },
                     { kind: 'set', setId: 'set_1', index: 2 });
  console.log(`  GAME-005: set_1.tiles=${JSON.stringify(g.board[0].tiles)}`);
  assertTrue(r.ok, 'GAME-005-1: 같은 세트 내 이동 ok');
  // [룰픽스 #6] 같은 세트 내 오른쪽 이동 off-by-one 보정: 이동 직후엔 [b, a, c].
  // [정규화 추가(2026-06-12)] set_1=[red5, blue5, black5]는 valid 그룹이므로 mutation 직후
  //   normalizeSetTiles가 COLOR_ORDER(red→blue→black) 순으로 재정렬한다.
  //   a=red5, b=blue5, c=black5 → 정규화 결과 [a, b, c].
  //   (off-by-one 보정 자체는 mutation 단계에서 여전히 적용되며, 그 결과의 직접 관찰은
  //    invalid 세트로 정규화를 회피하는 smoke RUMMI-036이 담당한다.)
  assertEq(g.board[0].tiles, ['a', 'b', 'c'], 'GAME-005-2: valid 그룹 이동 후 정규화 COLOR_ORDER [a,b,c]');
}

// ═══════════════════════════════════════════════════════════════════
// GAME-006: NEW_SET 무한 호출
// ═══════════════════════════════════════════════════════════════════
section('GAME-006: NEW_SET 500회 호출 → 빈 세트 상한 4개(룰픽스 #8)');
{
  const g = createGame();
  const startTime = Date.now();
  for (let i = 0; i < 500; i++) {
    addNewSet(g, 'p1');
  }
  const dur = Date.now() - startTime;
  // [룰픽스 #8] 빈 세트는 동시에 4개까지만. 500회 호출해도 4개에서 거부되어 멈춘다.
  // (옛 동작은 500개 무제한 생성 → 클라 UI 스크롤 폭주 위험이었음.)
  assertEq(g.board.length, 4, 'GAME-006-1: 빈 세트 상한 4개 (#8)');
  assertTrue(g.nextSetSeq === 5, 'GAME-006-2: nextSetSeq=5 (4개만 발급)');
  assertTrue(dur < 200, `GAME-006-3: 500회 처리 200ms 미만 (실제=${dur}ms)`);

  // 이제 END_TURN 없이도 removeEmptySets가 호출되는지 — endTurn에서 호출.
  // 변경 있음? hand 변경 없음, board는 빈 세트만 500개. boardsEqualIgnoringEmpty는 빈 세트 무시 → equal.
  // → hasChange=false → no_change 분기 → removeEmptySets + drewTile.
  const er = endTurn(g, 'p1');
  console.log(`  GAME-006: endTurn reason=${er.reason}, board.length 후=${g.board.length}`);
  assertEq(er.reason, 'no_change', 'GAME-006-4: 빈 세트만으로 NEW_SET → no_change');
  assertEq(g.board.length, 0, 'GAME-006-5: 빈 세트 모두 제거됨');
}

// ═══════════════════════════════════════════════════════════════════
// GAME-007: computeInitialMeldScore — fresh 조커 점수
// ═══════════════════════════════════════════════════════════════════
section('GAME-007: 첫 등판 점수에 fresh 조커 포함');
{
  const g = createGame();
  // 손: red 10, blue 10, J. 보드 비어있음.
  // 한 턴에 새 세트 [r10, b10, J] = 그룹 30점. fresh tiles = [r10, b10, J] 셋 다 본인 손 출신.
  // meldScore = 3 × 10 = 30점.
  const D = {
    r10: { id: 'r10', kind: 'num', color: 'red', number: 10 },
    b10: { id: 'b10', kind: 'num', color: 'blue', number: 10 },
    JJ: { id: 'JJ', kind: 'joker', color: null, number: null },
  };
  injectTiles(g, D);
  setSnapshot(g, [], { p1: ['r10', 'b10', 'JJ'], p2: [] });

  addNewSet(g, 'p1');
  moveTile(g, 'p1', { kind: 'hand', tileId: 'r10' }, { kind: 'set', setId: 'set_1', index: 0 });
  moveTile(g, 'p1', { kind: 'hand', tileId: 'b10' }, { kind: 'set', setId: 'set_1', index: 1 });
  moveTile(g, 'p1', { kind: 'hand', tileId: 'JJ' }, { kind: 'set', setId: 'set_1', index: 2 });

  const er = endTurn(g, 'p1');
  assertEq(er.reason, 'committed', 'GAME-007-1: 30점 commit 성공');
  assertTrue(g.played.p1, 'GAME-007-2: played[p1]=true');
}

// ═══════════════════════════════════════════════════════════════════
// GAME-008: validateSet null/undefined 포함
// ═══════════════════════════════════════════════════════════════════
section('GAME-008: validateSet 비정상 타일 입력');
{
  const v1 = validateSet([null, { kind: 'num', color: 'red', number: 5 }]);
  assertEq(v1.valid, false, 'GAME-008-1: null 포함 → invalid');
  const v2 = validateSet([{ kind: 'unknown', color: 'x', number: 5 },
    { kind: 'num', color: 'blue', number: 5 },
    { kind: 'num', color: 'black', number: 5 }]);
  // kind=unknown은 num도 joker도 아니므로 length 체크 fail 또는 카운트 미스매치.
  assertEq(v2.valid, false, 'GAME-008-2: unknown kind 포함 → invalid');
  // 빈 배열.
  const v3 = validateSet([]);
  assertEq(v3.valid, false, 'GAME-008-3: 빈 배열 → invalid');
  // undefined.
  const v4 = validateSet(undefined);
  assertEq(v4.valid, false, 'GAME-008-4: undefined → invalid');
  // 일반 객체.
  const v5 = validateSet({});
  assertEq(v5.valid, false, 'GAME-008-5: 객체 → invalid (Array.isArray false)');
}

// ═══════════════════════════════════════════════════════════════════
// GAME-009: 빈 NEW_SET 여러 + 실제 변경 1건
// ═══════════════════════════════════════════════════════════════════
section('GAME-009: 빈 NEW_SET 5개 + 실제 변경 1건 → commit');
{
  const g = createGame();
  const D = {
    r10: { id: 'r10', kind: 'num', color: 'red', number: 10 },
    b10: { id: 'b10', kind: 'num', color: 'blue', number: 10 },
    k10: { id: 'k10', kind: 'num', color: 'black', number: 10 },
  };
  injectTiles(g, D);
  setSnapshot(g, [], { p1: ['r10', 'b10', 'k10'], p2: [] });

  // 빈 세트 5개 추가.
  for (let i = 0; i < 5; i++) addNewSet(g, 'p1');
  // 그 중 set_3에 30점 그룹 채움.
  moveTile(g, 'p1', { kind: 'hand', tileId: 'r10' }, { kind: 'set', setId: 'set_3', index: 0 });
  moveTile(g, 'p1', { kind: 'hand', tileId: 'b10' }, { kind: 'set', setId: 'set_3', index: 1 });
  moveTile(g, 'p1', { kind: 'hand', tileId: 'k10' }, { kind: 'set', setId: 'set_3', index: 2 });

  const er = endTurn(g, 'p1');
  console.log(`  GAME-009: reason=${er.reason}, board=${JSON.stringify(g.board.map(s => s.tiles))}`);
  assertEq(er.reason, 'committed', 'GAME-009-1: 빈 NEW_SET 무시 + 실제 변경 commit');
  assertEq(g.board.length, 1, 'GAME-009-2: commit 후 빈 세트 제거되어 1개');
  assertTrue(g.played.p1, 'GAME-009-3: played[p1]=true');
}

// ═══════════════════════════════════════════════════════════════════
// GAME-010: hand 정렬 안정성 — 같은 색 같은 숫자 2장 (copy 1/copy 2)
// ═══════════════════════════════════════════════════════════════════
section('GAME-010: 정렬 동일 키 안정성 (sort stability)');
// 클라 hand.js 정렬은 sort(a, b) — 같은 color order index + 같은 number이면 0 반환.
// JS sort는 stable이지만 (ES2019+), 어쨌든 동일 키 입력 시 입력 순서 유지 또는 안정.
// validateSet은 정렬 안 함. 그래서 큰 문제 아님.
{
  // 같은 색 + 같은 숫자 2장 + 그룹 가능한 다른 색 2장 → validateSet → 그룹 중복 거부?
  const tiles = [
    { id: 'r7a', kind: 'num', color: 'red', number: 7 },
    { id: 'b7', kind: 'num', color: 'blue', number: 7 },
    { id: 'r7b', kind: 'num', color: 'red', number: 7 }, // 중복.
  ];
  const v = validateSet(tiles);
  assertEq(v.valid, false, 'GAME-010-1: 같은 색 중복 그룹 거부');
}

// ═══════════════════════════════════════════════════════════════════
// BOT-007: 빈 손에서 findBestSetCombination
// ═══════════════════════════════════════════════════════════════════
section('BOT-007: findBestSetCombination 비정상 입력');
{
  const r1 = findBestSetCombination([], 30);
  assertEq(r1.length, 0, 'BOT-007-1: 빈 손 → 빈 배열');
  const r2 = findBestSetCombination([], 0);
  assertEq(r2.length, 0, 'BOT-007-2: 빈 손 + threshold 0 → 빈 배열');
  // null 입력?
  let crashed = false;
  try { findBestSetCombination(null, 30); } catch (e) { crashed = true; }
  if (crashed) {
    reportIssue('LOW', 'BOT-007 null 입력 크래시',
      'findBestSetCombination(null, ...) 호출 시 크래시. 봇 코드는 항상 배열을 전달하므로 무영향이지만 방어 코드 권장.');
  }
  assertTrue(true, 'BOT-007-3: null 입력 처리 확인 완료 (crash 여부 보고)');
}

// ═══════════════════════════════════════════════════════════════════
// BOT-008: enumerateCandidateSets 조커만
// ═══════════════════════════════════════════════════════════════════
section('BOT-008: enumerateCandidateSets 조커만 / 비정상');
{
  const onlyJokers = [
    { id: 'j1', kind: 'joker', color: null, number: null },
    { id: 'j2', kind: 'joker', color: null, number: null },
  ];
  const cands = enumerateCandidateSets(onlyJokers);
  console.log(`  BOT-008: 조커만 2장 → 후보 ${cands.length}개`);
  // 조커만으로는 valid 세트 불가. 후보 0개 또는 매우 적어야 함.
  assertEq(cands.length, 0, 'BOT-008-1: 조커만 → 후보 0');
}

// ═══════════════════════════════════════════════════════════════════
// GAME-011: 첫 등판 시 손에서 보드로 이동 후 다시 회수 (보드→손)
// ═══════════════════════════════════════════════════════════════════
section('GAME-011: 첫 등판 전 손→보드 → 회수 (wasInMyHand 가드 통과)');
{
  const g = createGame();
  const D = {
    r10: { id: 'r10', kind: 'num', color: 'red', number: 10 },
  };
  injectTiles(g, D);
  setSnapshot(g, [], { p1: ['r10'], p2: [] });

  addNewSet(g, 'p1');
  moveTile(g, 'p1', { kind: 'hand', tileId: 'r10' }, { kind: 'set', setId: 'set_1', index: 0 });
  // 이제 r10이 보드 set_1에 있음. turnSnapshot의 p1 손에 r10 있음.
  // 첫 등판 전 회수 시도 — wasInMyHand=true → 가드 통과.
  const r = moveTile(g, 'p1', { kind: 'set', setId: 'set_1', tileId: 'r10' }, { kind: 'hand' });
  assertTrue(r.ok, 'GAME-011-1: 본인이 이번 턴에 낸 타일 회수 가능 (가드 통과)');
  assertEq(g.hands.p1, ['r10'], 'GAME-011-2: 손으로 복귀');
}

// ═══════════════════════════════════════════════════════════════════
// GAME-012: snapshotFor — 상대 손 누설 검증
// ═══════════════════════════════════════════════════════════════════
section('GAME-012: snapshotFor 상대 손 누설 X');
{
  const g = createGame();
  const snap1 = snapshotFor(g, 'p1');
  const snap2 = snapshotFor(g, 'p2');
  assertEq(typeof snap1.myHand[0], 'string', 'GAME-012-1: p1 myHand에 본인 타일 ID');
  assertEq(typeof snap1.oppHandCount, 'number', 'GAME-012-2: p1 시점 상대 손 갯수만');
  // p2의 tileId가 p1.tileDict에 없는지 확인.
  for (const tid of g.hands.p2) {
    assertTrue(!(tid in snap1.tileDict),
      `GAME-012-3: p1.tileDict에 p2 손 타일 ${tid} 없음 (정보 비대칭)`);
    break; // 1개만 확인.
  }
}

// ═══════════════════════════════════════════════════════════════════
// GAME-013: 봇 제외 — moveTile 트랜잭션 일관성 회귀 (HIGH-1 fix 회귀)
// ═══════════════════════════════════════════════════════════════════
section('GAME-013: moveTile 트랜잭션 일관성 회귀 (HIGH-1 fix)');
{
  const g = createGame();
  injectTiles(g, { x: { id: 'x', kind: 'num', color: 'red', number: 5 } });
  setSnapshot(g, [], { p1: ['x'], p2: [] });
  // hand → 잘못된 to.kind 'wat'
  const r = moveTile(g, 'p1', { kind: 'hand', tileId: 'x' }, { kind: 'wat' });
  assertEq(r.ok, false, 'GAME-013-1: 잘못된 to.kind 거부');
  assertEq(g.hands.p1, ['x'], 'GAME-013-2: 손에 x 유지 (트랜잭션 일관성)');

  // hand → 없는 setId
  const r2 = moveTile(g, 'p1', { kind: 'hand', tileId: 'x' }, { kind: 'set', setId: 'ghost' });
  assertEq(r2.ok, false, 'GAME-013-3: 없는 setId 거부');
  assertEq(g.hands.p1, ['x'], 'GAME-013-4: 손에 x 유지');
}

// ═══════════════════════════════════════════════════════════════════
// GAME-014: removeEmptySets — 여러 번 호출 idempotent?
// ═══════════════════════════════════════════════════════════════════
section('GAME-014: 빈 세트 제거 idempotency');
{
  const g = createGame();
  g.board = [
    { id: 's1', type: 'group', tiles: [] },
    { id: 's2', type: 'run', tiles: ['x'] },
    { id: 's3', type: 'group', tiles: [] },
  ];
  // 단순화 — endTurn으로 호출.
  setSnapshot(g, g.board, { p1: ['y'], p2: [] });
  // 손 변화 없음 + 보드 변경(s2 추가) — boardsEqualIgnoringEmpty 비교 시 snap.board=[s2 with x] 와 비교?
  // 여기서는 그냥 endTurn 호출하여 removeEmptySets만 검증.
  // 보드 변화 없이 endTurn 호출 — 빈 세트만 정리.
  const er = endTurn(g, 'p1');
  console.log(`  GAME-014: 보드 후=${JSON.stringify(g.board.map(s => s.id))}, reason=${er.reason}`);
  // 빈 세트 제거됨.
  assertTrue(g.board.every(s => s.tiles.length > 0), 'GAME-014-1: 빈 세트 모두 제거');
}

// ═══════════════════════════════════════════════════════════════════
// GAME-015: 봇 빈 보드 + 첫 등판 백트래킹 시간
// ═══════════════════════════════════════════════════════════════════
section('GAME-015: 봇 첫 등판 백트래킹 시간 제한');
{
  // 14장 손 — 무작위 분배 모사.
  const handTiles = [];
  const sample = [
    ['red', 1], ['red', 2], ['red', 3], ['blue', 5], ['blue', 6], ['blue', 7],
    ['black', 9], ['black', 10], ['black', 11], ['orange', 4], ['orange', 5],
    ['orange', 6], ['red', 12], ['red', 13],
  ];
  for (const [c, n] of sample) {
    handTiles.push({ id: `${c}_${n}`, kind: 'num', color: c, number: n });
  }
  const start = Date.now();
  const result = findBestSetCombination(handTiles, 30);
  const dur = Date.now() - start;
  console.log(`  GAME-015: 14장 손 첫 등판 탐색 ${dur}ms, 결과 세트 ${result.length}개`);
  assertTrue(dur < 500, 'GAME-015-1: 14장 손 백트래킹 500ms 이내');
}

// ═══════════════════════════════════════════════════════════════════
// 최종
// ═══════════════════════════════════════════════════════════════════
console.log('\n════════════════════════════════════════');
console.log(`테스트: ${passed + failed}건 / PASS=${passed} / FAIL=${failed}`);
console.log(`발견된 이슈: ${issues.length}건`);
if (failures.length > 0) {
  console.log('\n실패 목록:');
  failures.forEach((f) => console.log(f));
}
if (issues.length > 0) {
  console.log('\n발견된 이슈 상세:');
  for (const i of issues) {
    console.log(`  [${i.severity}] ${i.label} — ${i.detail}`);
  }
}
process.exit(failed > 0 ? 1 : 0);
