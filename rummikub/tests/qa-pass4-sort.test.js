/**
 * @fileoverview QA Pass4 능동 엣지 공격 — 보드 세트 자동 정규화(normalizeSetTiles)의
 * 경계/멱등/조커/롤백/점수 정합을 game.js 공개 API(moveTile/swapJoker/endTurn) 경유로 공격한다.
 *
 * normalizeSetTiles는 export하지 않으므로 모든 검증은 공개 API를 통해 정규화를 트리거한다.
 * 스펙·구현 리포트의 단정을 믿지 않고 직접 결과 배열·점수·롤백 상태를 검증한다.
 */
import {
  createGame, moveTile, swapJoker, endTurn, validateSet,
} from '../game.js';

let pass = 0, fail = 0;
const fails = [];
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  PASS  ${msg}`); }
  else { fail++; fails.push(`${msg} — expected ${e}, got ${a}`); console.log(`  FAIL  ${msg} — expected ${e}, got ${a}`); }
}
function ok(cond, msg) { eq(!!cond, true, msg); }
function section(t) { console.log(`\n── ${t} ──`); }

/** 스냅샷 헬퍼(턴 시작 = 정규화된 보드 기준). */
function snap(g, handsOverride) {
  return {
    board: g.board.map((s) => ({ id: s.id, type: s.type, tiles: s.tiles.slice() })),
    hands: handsOverride || { p1: g.hands.p1.slice(), p2: g.hands.p2.slice() },
    nextSetSeq: g.nextSetSeq,
    jokerReturnedThisTurn: {},
  };
}

// ════════════════════════════════════════════════════════════════════
section('A. 조커 2장 런 정규화 — 빠진 슬롯 결정적 배치 + 멱등');
{
  const g = createGame();
  // 목표 런: 슬롯 5-6-7-8 (red), red5/red8 실타일 + 조커 2장 → 슬롯 6,7에 조커.
  Object.assign(g.tiles, {
    r5: { id: 'r5', kind: 'num', color: 'red', number: 5 },
    r8: { id: 'r8', kind: 'num', color: 'red', number: 8 },
    JA: { id: 'JA', kind: 'joker', color: null, number: null },
    JB: { id: 'JB', kind: 'joker', color: null, number: null },
  });
  // 뒤섞인 초기 배열 [JA, r5, JB, r8]: 손에서 r8을 마지막에 넣어 정규화 트리거.
  // 시작: invalid 3장 세트(JA, r5, JB) → 손 r8 추가 → valid 4장 → 정규화.
  g.board = [{ id: 'set_run', type: 'run', tiles: ['JA', 'r5', 'JB'] }];
  g.hands.p1 = ['r8'];
  g.played.p1 = true;
  g.turnSnapshot = snap(g, { p1: ['r8'], p2: g.hands.p2.slice() });
  // [JA, r5, JB] + r8 끝에 → [JA, r5, JB, r8] valid run(5-8) → 정규화.
  const mv = moveTile(g, 'p1', { kind: 'hand', tileId: 'r8' }, { kind: 'set', setId: 'set_run', index: 3 });
  ok(mv.ok, '조커 2장 런: r8 추가 valid');
  // 슬롯 5,6,7,8 → [r5, 조커, 조커, r8]. 조커는 jokerIds 배열 순서(JA, JB)대로 슬롯 6,7 배정.
  eq(g.board[0].tiles, ['r5', 'JA', 'JB', 'r8'], '조커 2장 런: 슬롯 5-6-7-8 = [r5,JA,JB,r8]');
  // 멱등: 같은 세트를 한 번 더 정규화 트리거(set 내부 무의미 이동 = 같은 결과여야 함).
  // r5를 같은 인덱스 0으로 이동(self move) → 재정규화.
  const before = g.board[0].tiles.slice();
  const mv2 = moveTile(g, 'p1', { kind: 'set', setId: 'set_run', tileId: 'r5', index: 0 }, { kind: 'set', setId: 'set_run', index: 0 });
  ok(mv2.ok, '멱등 트리거: r5 self-move');
  eq(g.board[0].tiles, before, '멱등: 두 번째 정규화도 동일 결과');
}

// ════════════════════════════════════════════════════════════════════
section('B. 정규화 직후 SWAP_JOKER — 바뀐 조커 인덱스로 회수');
{
  const g = createGame();
  // 보드: 정규화로 조커 위치가 바뀐 뒤, 새 인덱스로 SWAP_JOKER가 정상 동작하는지.
  Object.assign(g.tiles, {
    r5: { id: 'r5', kind: 'num', color: 'red', number: 5 },
    r6: { id: 'r6', kind: 'num', color: 'red', number: 6 },
    r7: { id: 'r7', kind: 'num', color: 'red', number: 7 },
    JK: { id: 'JK', kind: 'joker', color: null, number: null },
    r4: { id: 'r4', kind: 'num', color: 'red', number: 4 }, // 조커 회수용(슬롯 4)
  });
  // 초기 뒤섞임 [r7, JK, r5]: invalid 3장? r7,r5 + JK → 슬롯 5-6-7 valid(JK=6). 정규화 트리거 위해 손 r6 사용.
  // 시작 보드: [r7, JK] (2장, invalid) + 손 r6 → 추가하면 [r7, JK, r6]? valid? nums 6,7 + JK → 슬롯 5-6-7 or 6-7-8.
  // 명확히 하려고: 보드 [JK, r7] + 손 r5 추가 → [JK, r7, r5] valid 슬롯5-6-7(JK=5? no r5 있음).
  // nums r5,r7 + JK 1장 → span 3, 길이 3 → 슬롯 5-6-7, 빠진 슬롯 6 → JK=6.
  // 정규화 후 [r5, JK, r6=r7?]... 정확히: 슬롯 5=r5, 6=JK, 7=r7 → [r5, JK, r7]. JK 인덱스 1.
  g.board = [{ id: 'set_run', type: 'run', tiles: ['JK', 'r7'] }];
  g.hands.p1 = ['r5', 'r4'];
  g.played.p1 = true;
  g.turnSnapshot = snap(g, { p1: ['r5', 'r4'], p2: g.hands.p2.slice() });
  const mv = moveTile(g, 'p1', { kind: 'hand', tileId: 'r5' }, { kind: 'set', setId: 'set_run', index: 2 });
  ok(mv.ok, 'r5 추가 → valid run');
  eq(g.board[0].tiles, ['r5', 'JK', 'r7'], '정규화 후 [r5, JK, r7] — JK 인덱스 1');
  // 회수: 빠진 슬롯 6 = JK 대체. 손 r6으로 회수해야 하지만 손엔 r4뿐... r6은 슬롯 6.
  // 손에 r6이 있어야 회수 가능. r4는 슬롯에 안 맞음. r6을 손에 추가.
  Object.assign(g.tiles, { r6: { id: 'r6', kind: 'num', color: 'red', number: 6 } });
  g.hands.p1 = ['r6'];
  g.turnSnapshot = snap(g, { p1: ['r6'], p2: g.hands.p2.slice() });
  // JK는 인덱스 1. 새 인덱스로 SWAP_JOKER.
  const sj = swapJoker(g, 'p1', { setId: 'set_run', jokerIndex: 1, handTileId: 'r6' });
  ok(sj.ok, '정규화된 JK 인덱스(1)로 SWAP_JOKER 성공');
  eq(sj.jokerId, 'JK', '회수된 조커 ID = JK');
  // 회수 후 세트 = [r5, r6, r7] valid 정규화.
  eq(g.board[0].tiles, ['r5', 'r6', 'r7'], 'SWAP_JOKER 후 정규화 [r5,r6,r7]');
  // 잘못된(옛) 인덱스로 회수 시도 — 정규화 전 위치(0)는 이제 r5라 실패해야 함.
  const sjBad = swapJoker(g, 'p1', { setId: 'set_run', jokerIndex: 0, handTileId: 'r6' });
  ok(!sjBad.ok, '옛 인덱스(0=숫자타일)로 SWAP_JOKER 거부');
}

// ════════════════════════════════════════════════════════════════════
section('C. invalid 세트 비정규화 — 배치 중 순서 보존');
{
  const g = createGame();
  Object.assign(g.tiles, {
    r5: { id: 'r5', kind: 'num', color: 'red', number: 5 },
    r3: { id: 'r3', kind: 'num', color: 'red', number: 3 },
    b9: { id: 'b9', kind: 'num', color: 'blue', number: 9 }, // 색 충돌
  });
  // C1: 2장 세트(미완성) → 정규화 안 됨.
  g.board = [{ id: 'set_x', type: 'run', tiles: ['r5'] }];
  g.hands.p1 = ['r3'];
  g.played.p1 = true;
  g.turnSnapshot = snap(g, { p1: ['r3'], p2: g.hands.p2.slice() });
  const mv = moveTile(g, 'p1', { kind: 'hand', tileId: 'r3' }, { kind: 'set', setId: 'set_x', index: 1 });
  ok(mv.ok, '2장 세트 만들기 ok');
  eq(g.board[0].tiles, ['r5', 'r3'], 'invalid 2장 세트: 정규화 없이 [r5,r3] 보존');
  // C2: 색 충돌(런 불가, 숫자 다름) → invalid → 보존.
  g.board = [{ id: 'set_y', type: 'run', tiles: ['r5', 'r3'] }];
  g.hands.p1 = ['b9'];
  g.turnSnapshot = snap(g, { p1: ['b9'], p2: g.hands.p2.slice() });
  const mv2 = moveTile(g, 'p1', { kind: 'hand', tileId: 'b9' }, { kind: 'set', setId: 'set_y', index: 0 });
  ok(mv2.ok, '색 충돌 타일 삽입 ok');
  eq(g.board[0].tiles, ['b9', 'r5', 'r3'], 'invalid(색충돌) 세트: 삽입 순서 [b9,r5,r3] 보존');
}

// ════════════════════════════════════════════════════════════════════
section('D. 정규화와 first-meld 점수(END_TURN 경유)');
{
  const g = createGame();
  // 첫 등판: 뒤섞은 런을 정규화한 뒤 점수가 정확한지. red 9-10-11 = 30점.
  Object.assign(g.tiles, {
    r9: { id: 'r9', kind: 'num', color: 'red', number: 9 },
    r10: { id: 'r10', kind: 'num', color: 'red', number: 10 },
    r11: { id: 'r11', kind: 'num', color: 'red', number: 11 },
  });
  g.board = [];
  g.hands.p1 = ['r11', 'r9', 'r10']; // 손 순서도 뒤섞음
  g.hands.p2 = ['b1']; Object.assign(g.tiles, { b1: { id: 'b1', kind: 'num', color: 'blue', number: 1 } });
  g.played.p1 = false;
  g.deck = ['b1d']; Object.assign(g.tiles, { b1d: { id: 'b1d', kind: 'num', color: 'blue', number: 1 } });
  g.currentTurn = 'p1';
  g.turnSnapshot = snap(g, { p1: ['r11', 'r9', 'r10'], p2: ['b1'] });
  // NEW_SET 후 3장 추가 — set 추가 시점에 정규화 발생.
  g.board = [{ id: 'set_m', type: 'run', tiles: [] }];
  g.nextSetSeq = 2;
  g.turnSnapshot = snap(g, { p1: ['r11', 'r9', 'r10'], p2: ['b1'] });
  moveTile(g, 'p1', { kind: 'hand', tileId: 'r11' }, { kind: 'set', setId: 'set_m', index: 0 });
  moveTile(g, 'p1', { kind: 'hand', tileId: 'r9' }, { kind: 'set', setId: 'set_m', index: 0 });
  moveTile(g, 'p1', { kind: 'hand', tileId: 'r10' }, { kind: 'set', setId: 'set_m', index: 1 });
  // 3장 완성 시점에 valid → 정규화 → [r9,r10,r11].
  eq(g.board[0].tiles, ['r9', 'r10', 'r11'], 'first-meld 세트 정규화 [r9,r10,r11]');
  const et = endTurn(g, 'p1');
  ok(et.committed, '정규화된 30점 런 → 첫 등판 commit (30=9+10+11)');
  eq(g.played.p1, true, 'p1 첫 등판 완료');
}

// ════════════════════════════════════════════════════════════════════
section('E. 세트→세트 이동 — from/to 양쪽 정규화');
{
  const g = createGame();
  Object.assign(g.tiles, {
    // from 세트: red 3-4-5-6 (valid run, 정규화됨). r6를 빼서 to로.
    r3: { id: 'r3', kind: 'num', color: 'red', number: 3 },
    r4: { id: 'r4', kind: 'num', color: 'red', number: 4 },
    r5: { id: 'r5', kind: 'num', color: 'red', number: 5 },
    r6: { id: 'r6', kind: 'num', color: 'red', number: 6 },
    // to 세트: red 7-8 + r6 받으면 6-7-8 valid run. 뒤섞임 [r8, r7].
    r7: { id: 'r7', kind: 'num', color: 'red', number: 7 },
    r8: { id: 'r8', kind: 'num', color: 'red', number: 8 },
  });
  // from = [r3,r4,r5,r6] (4장 valid), to = [r8,r7] (2장 invalid).
  // r6를 from→to 이동: from = [r3,r4,r5] 여전히 valid → 정규화. to = [r8,r7,r6] → valid run 6-7-8 → 정규화.
  g.board = [
    { id: 'set_from', type: 'run', tiles: ['r3', 'r4', 'r5', 'r6'] },
    { id: 'set_to', type: 'run', tiles: ['r8', 'r7'] },
  ];
  g.hands.p1 = ['z1']; Object.assign(g.tiles, { z1: { id: 'z1', kind: 'num', color: 'orange', number: 1 } });
  g.played.p1 = true;
  g.turnSnapshot = snap(g, { p1: ['z1'], p2: g.hands.p2.slice() });
  const mv = moveTile(g, 'p1', { kind: 'set', setId: 'set_from', tileId: 'r6' }, { kind: 'set', setId: 'set_to', index: 0 });
  ok(mv.ok, 'set→set 이동(r6: from→to) ok');
  eq(g.board[0].tiles, ['r3', 'r4', 'r5'], 'from 세트 정규화 후 [r3,r4,r5]');
  eq(g.board[1].tiles, ['r6', 'r7', 'r8'], 'to 세트 정규화 후 [r6,r7,r8]');
}

// ════════════════════════════════════════════════════════════════════
section('F. 롤백 후 보드가 정규화된 스냅샷으로 복원');
{
  const g = createGame();
  Object.assign(g.tiles, {
    r3: { id: 'r3', kind: 'num', color: 'red', number: 3 },
    r4: { id: 'r4', kind: 'num', color: 'red', number: 4 },
    r5: { id: 'r5', kind: 'num', color: 'red', number: 5 },
    b9: { id: 'b9', kind: 'num', color: 'blue', number: 9 }, // invalid 유발용
  });
  // F1: no_tile_played 롤백 — 손에서 1장도 안 내고 보드만 재배치 → 롤백.
  // 턴 시작 보드(스냅샷)는 이미 정규화된 [r3,r4,r5]. 도중 뒤섞어도 롤백 시 정규화 상태로.
  g.board = [{ id: 'set_p', type: 'run', tiles: ['r3', 'r4', 'r5'] }];
  g.hands.p1 = ['b9'];
  g.played.p1 = true;
  g.deck = []; // 더미 비움 → no_tile_played 시 패스 카운트.
  g.currentTurn = 'p1';
  g.turnSnapshot = snap(g, { p1: ['b9'], p2: g.hands.p2.slice() });
  // 세트 내 r5를 앞으로 이동(재배치) → 정규화가 즉시 [r3,r4,r5]로 되돌림(self no-op).
  // 정규화 결과 보드가 스냅샷과 동일 → endTurn은 no_change로 판정(no_tile_played 도달 전 단계).
  // 두 reason 모두 미 commit + 덱 빈 상태에서 패스 카운터 +1 → 우회 불가(설계 정상).
  const passBefore = g.consecutivePassesAfterDeckEmpty || 0;
  moveTile(g, 'p1', { kind: 'set', setId: 'set_p', tileId: 'r5', index: 0 }, { kind: 'set', setId: 'set_p', index: 0 });
  const et = endTurn(g, 'p1');
  ok(!et.committed, '재배치만(no-op 정규화) → 미 commit');
  ok(et.reason === 'no_change' || et.reason === 'no_tile_played', `reason=${et.reason} (미 commit 계열)`);
  ok((g.consecutivePassesAfterDeckEmpty || 0) > passBefore, '덱 빈 재배치 패스 → 패스 카운터 +1 (우회 불가)');
  eq(g.board[0].tiles, ['r3', 'r4', 'r5'], '롤백/패스 후 보드 = 정규화 스냅샷 [r3,r4,r5]');

  // F2: invalid_board 롤백 — 손 타일을 넣어 valid 세트를 깨뜨림.
  const g2 = createGame();
  Object.assign(g2.tiles, {
    r3: { id: 'r3', kind: 'num', color: 'red', number: 3 },
    r4: { id: 'r4', kind: 'num', color: 'red', number: 4 },
    r5: { id: 'r5', kind: 'num', color: 'red', number: 5 },
    b9: { id: 'b9', kind: 'num', color: 'blue', number: 9 },
  });
  g2.board = [{ id: 'set_q', type: 'run', tiles: ['r3', 'r4', 'r5'] }];
  g2.hands.p1 = ['b9'];
  g2.played.p1 = true;
  g2.deck = ['d1']; Object.assign(g2.tiles, { d1: { id: 'd1', kind: 'num', color: 'blue', number: 2 } });
  g2.currentTurn = 'p1';
  g2.turnSnapshot = snap(g2, { p1: ['b9'], p2: g2.hands.p2.slice() });
  // b9를 set_q 중간에 삽입 → [r3,r4,b9,r5] invalid(색 섞임) → 정규화 안 됨, 손 -1.
  moveTile(g2, 'p1', { kind: 'hand', tileId: 'b9' }, { kind: 'set', setId: 'set_q', index: 2 });
  ok(!validateSet(g2.board[0].tiles.map((t) => g2.tiles[t])).valid, 'invalid 보드 상태 확정(색 섞임)');
  const et2 = endTurn(g2, 'p1');
  ok(!et2.committed, 'invalid_board → 미 commit');
  eq(et2.reason, 'invalid_board', 'reason=invalid_board');
  eq(g2.board[0].tiles, ['r3', 'r4', 'r5'], '롤백 후 정규화 스냅샷 [r3,r4,r5] 복원');
}

// ════════════════════════════════════════════════════════════════════
section('F3. 실제 보드 변경 + 손 무변 → no_tile_played (정규화가 우회 못 함)');
{
  // 두 valid 세트 사이에서 타일을 옮겨 보드가 "실제로" 바뀌지만 손은 1장도 안 줄인 케이스.
  // 정규화로 양쪽이 다시 valid 정렬되어도 손 감소가 없으므로 commit 불가여야 한다.
  const g = createGame();
  Object.assign(g.tiles, {
    r3: { id: 'r3', kind: 'num', color: 'red', number: 3 },
    r4: { id: 'r4', kind: 'num', color: 'red', number: 4 },
    r5: { id: 'r5', kind: 'num', color: 'red', number: 5 },
    r6: { id: 'r6', kind: 'num', color: 'red', number: 6 },
    r7: { id: 'r7', kind: 'num', color: 'red', number: 7 },
    r8: { id: 'r8', kind: 'num', color: 'red', number: 8 },
  });
  // from [r3,r4,r5,r6] (valid 4), to [r7,r8] (invalid 2). r6 옮기면 from=[r3,r4,r5] valid, to=[r6,r7,r8] valid.
  // 보드는 실제로 바뀜(boardChanged=true), 손은 그대로 → no_tile_played 롤백.
  g.board = [
    { id: 'sf', type: 'run', tiles: ['r3', 'r4', 'r5', 'r6'] },
    { id: 'st', type: 'run', tiles: ['r7', 'r8'] },
  ];
  g.hands.p1 = ['z9']; Object.assign(g.tiles, { z9: { id: 'z9', kind: 'num', color: 'orange', number: 9 } });
  g.played.p1 = true;
  g.deck = ['dd']; Object.assign(g.tiles, { dd: { id: 'dd', kind: 'num', color: 'blue', number: 1 } });
  g.currentTurn = 'p1';
  g.turnSnapshot = snap(g, { p1: ['z9'], p2: g.hands.p2.slice() });
  moveTile(g, 'p1', { kind: 'set', setId: 'sf', tileId: 'r6' }, { kind: 'set', setId: 'st', index: 0 });
  // 이동 직후 보드는 valid 2세트지만 손은 그대로.
  const et = endTurn(g, 'p1');
  ok(!et.committed, '실제 보드변경+손무변 → 미 commit');
  eq(et.reason, 'no_tile_played', 'reason=no_tile_played (정규화 무관하게 손 감소 가드 작동)');
  // 롤백 후 보드는 턴 시작 스냅샷 = 정규화된 원래 2세트.
  eq(g.board[0].tiles, ['r3', 'r4', 'r5', 'r6'], '롤백 후 from 복원');
  eq(g.board[1].tiles, ['r7', 'r8'], '롤백 후 to 복원(원래 스냅샷)');
}

// ════════════════════════════════════════════════════════════════════
section('G. 그룹 정규화 — COLOR_ORDER + 조커 마지막');
{
  const g = createGame();
  Object.assign(g.tiles, {
    o7: { id: 'o7', kind: 'num', color: 'orange', number: 7 },
    k7: { id: 'k7', kind: 'num', color: 'black', number: 7 },
    b7: { id: 'b7', kind: 'num', color: 'blue', number: 7 },
    r7: { id: 'r7', kind: 'num', color: 'red', number: 7 },
    JK: { id: 'JK', kind: 'joker', color: null, number: null },
  });
  // 시작 [o7, k7] (2장 invalid) + 손 b7 → [o7,k7,b7] valid group → 정규화.
  g.board = [{ id: 'set_g', type: 'group', tiles: ['o7', 'k7'] }];
  g.hands.p1 = ['b7'];
  g.played.p1 = true;
  g.turnSnapshot = snap(g, { p1: ['b7'], p2: g.hands.p2.slice() });
  moveTile(g, 'p1', { kind: 'hand', tileId: 'b7' }, { kind: 'set', setId: 'set_g', index: 0 });
  eq(g.board[0].tiles, ['b7', 'k7', 'o7'], '그룹 정규화: COLOR_ORDER blue<black<orange');
  // 조커 포함 4장 그룹: red 추가는 색 충돌? r7 추가 → [r7,b7,k7,o7] valid 4색 그룹.
  // 대신 조커 마지막 검증: 다른 그룹에서.
  const g2 = createGame();
  Object.assign(g2.tiles, {
    o3: { id: 'o3', kind: 'num', color: 'orange', number: 3 },
    r3: { id: 'r3', kind: 'num', color: 'red', number: 3 },
    JK: { id: 'JK', kind: 'joker', color: null, number: null },
  });
  // [o3, JK] 2장 invalid + 손 r3 → [o3, JK, r3] valid group(red,orange,joker) → 정규화 [r3,o3,JK].
  g2.board = [{ id: 'set_h', type: 'group', tiles: ['o3', 'JK'] }];
  g2.hands.p1 = ['r3'];
  g2.played.p1 = true;
  g2.turnSnapshot = snap(g2, { p1: ['r3'], p2: g2.hands.p2.slice() });
  moveTile(g2, 'p1', { kind: 'hand', tileId: 'r3' }, { kind: 'set', setId: 'set_h', index: 0 });
  eq(g2.board[0].tiles, ['r3', 'o3', 'JK'], '그룹 정규화: 조커는 항상 마지막 [r3,o3,JK]');
}

// ════════════════════════════════════════════════════════════════════
console.log('\n════════════════════════════════════════');
console.log(`QA Pass4 정규화 공격: ${pass + fail}건 / PASS=${pass} / FAIL=${fail}`);
if (fails.length) {
  console.log('\n실패 목록:');
  for (const f of fails) console.log('  - ' + f);
  process.exit(1);
}
