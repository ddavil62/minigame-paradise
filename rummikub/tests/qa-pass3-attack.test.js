/**
 * @fileoverview QA Pass3 능동 엣지 공격 — game.js를 직접 import해 룰 수정 9건의 경계/우회를 공격한다.
 * 스펙 단정을 믿지 않고 직접 commit/rollback 결과·점수·상태 복원을 검증한다.
 */
import {
  createGame, addNewSet, moveTile, swapJoker, endTurn, validateSet,
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

/** 표준 스냅샷 세팅 헬퍼. */
function snap(g, handsOverride) {
  return {
    board: g.board.map((s) => ({ id: s.id, type: s.type, tiles: s.tiles.slice() })),
    hands: handsOverride || { p1: g.hands.p1.slice(), p2: g.hands.p2.slice() },
    nextSetSeq: g.nextSetSeq,
    jokerReturnedThisTurn: {},
  };
}

// ════════════════════════════════════════════════════════════════════
section('#1 SWAP_JOKER 후 회수 조커를 보드에 사용 → 손 -1 → commit');
{
  const g = createGame();
  // 보드: run [r3, JK, r5] (조커=red4 대체). 두 번째 세트 group [b6,k6,o6] (조커 회수 후 추가용은 아님).
  // 손: r4(조커 회수용) + r6(회수한 조커를 쓸 곳: group [b6,k6,o6]에 조커로? 아니 — 조커는 어디든 쓸수있음)
  Object.assign(g.tiles, {
    r3: { id: 'r3', kind: 'num', color: 'red', number: 3 },
    r5: { id: 'r5', kind: 'num', color: 'red', number: 5 },
    JK: { id: 'JK', kind: 'joker', color: null, number: null },
    r4: { id: 'r4', kind: 'num', color: 'red', number: 4 },
    b7: { id: 'b7', kind: 'num', color: 'blue', number: 7 },
    b8: { id: 'b8', kind: 'num', color: 'blue', number: 8 },
    b9: { id: 'b9', kind: 'num', color: 'blue', number: 9 },
  });
  // 보드 두번째 세트 [b7,b8,b9] valid run, 여기 조커를 끼우면? 조커 끼우면 4장 run [b7,b8,b9,JK]=b10 자리 → valid.
  g.board = [
    { id: 'set_a', type: 'run', tiles: ['r3', 'JK', 'r5'] },
    { id: 'set_b', type: 'run', tiles: ['b7', 'b8', 'b9'] },
  ];
  g.hands.p1 = ['r4'];
  g.played.p1 = true;
  g.turnSnapshot = snap(g, { p1: ['r4'], p2: g.hands.p2.slice() });
  // 1) SWAP_JOKER: red4를 set_a에 넣고 JK 회수.
  const sj = swapJoker(g, 'p1', { setId: 'set_a', jokerIndex: 1, handTileId: 'r4' });
  ok(sj.ok, 'SWAP_JOKER 성공 (red4 → set_a, JK 회수)');
  eq(g.hands.p1.length, 1, '회수 후 손 = 1 (r4 빠지고 JK 들어옴)');
  // 2) 회수한 JK를 set_b 끝에 사용 (hand→set).
  const mv = moveTile(g, 'p1', { kind: 'hand', tileId: 'JK' }, { kind: 'set', setId: 'set_b', index: 3 });
  ok(mv.ok, '회수 조커를 보드 set_b에 사용');
  eq(g.hands.p1.length, 0, '손 0장 (snap=1보다 작음 → no_tile_played 아님)');
  // 3) endTurn → 손 0 < snap 1 → 손 0장 승리 commit.
  const er = endTurn(g, 'p1');
  eq(er.committed, true, 'commit 됨 (no_tile_played 아님)');
  eq(er.reason, 'committed', 'reason=committed');
  ok(er.gameOver, '손 0장 → 승리');
}

section('#1 재배치+빈세트 생성만 한 턴 → no_tile_played 롤백 + 패스 카운트(덱0)');
{
  const g = createGame();
  Object.assign(g.tiles, {
    x1: { id: 'x1', kind: 'num', color: 'blue', number: 3 },
    x2: { id: 'x2', kind: 'num', color: 'blue', number: 4 },
    x3: { id: 'x3', kind: 'num', color: 'blue', number: 5 },
    keep: { id: 'keep', kind: 'num', color: 'red', number: 9 },
  });
  g.deck = [];
  g.board = [{ id: 'set_x', type: 'run', tiles: ['x1', 'x2', 'x3'] }];
  g.hands.p1 = ['keep'];
  g.played.p1 = true;
  g.consecutivePassesAfterDeckEmpty = 0;
  g.turnSnapshot = snap(g, { p1: ['keep'], p2: [] });
  g.hands.p2 = [];
  // 빈 세트 추가 + 보드 타일 순서 재배치.
  const ns = addNewSet(g, 'p1');
  ok(ns.ok, '빈 세트 생성 ok');
  g.board[0].tiles = ['x1', 'x3', 'x2']; // 순서 변경 (재배치)
  const beforeBoardSig = g.board.filter((s) => s.tiles.length).map((s) => s.tiles.join(',')).join('|');
  const er = endTurn(g, 'p1');
  eq(er.reason, 'no_tile_played', 'reason=no_tile_played');
  eq(er.committed, false, 'commit 안 됨');
  eq(g.consecutivePassesAfterDeckEmpty, 1, '덱0 → 패스 카운트 +1');
  // 롤백 검증: 보드 순서 복원 + 빈 세트 제거.
  eq(g.board.length, 1, '빈 세트 제거 + 원본 세트만');
  eq(g.board[0].tiles, ['x1', 'x2', 'x3'], '보드 순서 원복 (재배치 롤백)');
  // 손 = keep + 더미? 덱 비어서 더미 없음 → keep 1장 그대로.
  eq(g.hands.p1, ['keep'], '손 원복(덱 비어 더미 없음)');
}

section('#1 롤백 시 nextSetSeq 복원 검증');
{
  const g = createGame();
  Object.assign(g.tiles, {
    y1: { id: 'y1', kind: 'num', color: 'black', number: 3 },
    y2: { id: 'y2', kind: 'num', color: 'black', number: 4 },
    y3: { id: 'y3', kind: 'num', color: 'black', number: 5 },
    yk: { id: 'yk', kind: 'num', color: 'red', number: 2 },
  });
  g.deck = ['z1'];
  g.tiles.z1 = { id: 'z1', kind: 'num', color: 'orange', number: 1 };
  g.board = [{ id: 'set_y', type: 'run', tiles: ['y1', 'y2', 'y3'] }];
  g.hands.p1 = ['yk'];
  g.played.p1 = true;
  g.nextSetSeq = 5;
  g.turnSnapshot = snap(g, { p1: ['yk'], p2: [] });
  g.hands.p2 = [];
  // NEW_SET 2개 만들어 nextSetSeq 7로 증가 + 보드 재배치.
  addNewSet(g, 'p1');
  addNewSet(g, 'p1');
  eq(g.nextSetSeq, 7, 'NEW_SET 2회 → seq 7');
  g.board[0].tiles = ['y3', 'y2', 'y1'];
  const er = endTurn(g, 'p1');
  eq(er.reason, 'no_tile_played', 'no_tile_played');
  eq(g.nextSetSeq, 5, 'nextSetSeq 스냅샷(5)으로 복원');
  eq(g.hands.p1.length, 2, '손 = yk + 더미 z1');
}

// ════════════════════════════════════════════════════════════════════
section('#2 등판 전 hand→기존 세트 결합 거부');
{
  const g = createGame();
  Object.assign(g.tiles, {
    b1: { id: 'b1', kind: 'num', color: 'blue', number: 7 },
    b2: { id: 'b2', kind: 'num', color: 'blue', number: 8 },
    b3: { id: 'b3', kind: 'num', color: 'blue', number: 9 },
    h10: { id: 'h10', kind: 'num', color: 'blue', number: 10 },
  });
  g.board = [{ id: 'set_c', type: 'run', tiles: ['b1', 'b2', 'b3'] }];
  g.hands.p1 = ['h10'];
  g.played.p1 = false;
  g.turnSnapshot = snap(g, { p1: ['h10'], p2: [] });
  g.hands.p2 = [];
  // hand h10을 기존(non-fresh) 세트 set_c에 결합 → moveTile 자체는 from=hand라 허용됨(스펙 #2는 from=set만 차단).
  // 하지만 END_TURN 시 computeInitialMeldScore 방어선(#2-2)에서 기존 보드 타일 섞임 → 점수 0 → 미달 롤백.
  const mv = moveTile(g, 'p1', { kind: 'hand', tileId: 'h10' }, { kind: 'set', setId: 'set_c', index: 3 });
  ok(mv.ok, 'hand→기존세트 moveTile은 통과(검증은 endTurn)');
  const er = endTurn(g, 'p1');
  // set_c = [b1,b2,b3,h10] valid run, h10만 added지만 기존 b1,b2,b3 섞임 → #2-2로 점수 0 → initial_meld_short.
  eq(er.reason, 'initial_meld_short', '등판 전 기존세트 결합 → 점수 0 미달 롤백');
  const m = er.error && er.error.match(/현재 (\d+)점/);
  eq(m ? parseInt(m[1], 10) : -1, 0, '#2-2 방어선: 기존 보드 타일 섞인 세트 점수=0');
}

section('#2 등판 전 set→set 기존 보드 타일 이동 거부');
{
  const g = createGame();
  Object.assign(g.tiles, {
    b1: { id: 'b1', kind: 'num', color: 'blue', number: 7 },
    b2: { id: 'b2', kind: 'num', color: 'blue', number: 8 },
    b3: { id: 'b3', kind: 'num', color: 'blue', number: 9 },
    h1: { id: 'h1', kind: 'num', color: 'red', number: 10 },
  });
  g.board = [{ id: 'set_c', type: 'run', tiles: ['b1', 'b2', 'b3'] }];
  g.hands.p1 = ['h1'];
  g.played.p1 = false;
  g.turnSnapshot = snap(g, { p1: ['h1'], p2: [] });
  g.hands.p2 = [];
  const ns = addNewSet(g, 'p1');
  const mv = moveTile(g, 'p1',
    { kind: 'set', setId: 'set_c', tileId: 'b1' },
    { kind: 'set', setId: ns.setId });
  eq(mv.ok, false, '등판 전 기존 보드 타일 set→set 이동 거부');
  ok(mv.error && mv.error.includes('첫 등판'), '에러 "첫 등판" 포함');
}

section('#2 등판 후에는 hand→기존세트 / set→set 모두 허용');
{
  const g = createGame();
  Object.assign(g.tiles, {
    b1: { id: 'b1', kind: 'num', color: 'blue', number: 7 },
    b2: { id: 'b2', kind: 'num', color: 'blue', number: 8 },
    b3: { id: 'b3', kind: 'num', color: 'blue', number: 9 },
    b4: { id: 'b4', kind: 'num', color: 'blue', number: 10 },
    rA: { id: 'rA', kind: 'num', color: 'red', number: 1 },
    rB: { id: 'rB', kind: 'num', color: 'red', number: 2 },
    rC: { id: 'rC', kind: 'num', color: 'red', number: 3 },
  });
  g.board = [
    { id: 'set_d', type: 'run', tiles: ['b1', 'b2', 'b3'] },
    { id: 'set_e', type: 'run', tiles: ['rA', 'rB', 'rC'] },
  ];
  g.hands.p1 = ['b4'];
  g.played.p1 = true; // 등판 후
  g.turnSnapshot = snap(g, { p1: ['b4'], p2: [] });
  g.hands.p2 = [];
  const mv1 = moveTile(g, 'p1', { kind: 'hand', tileId: 'b4' }, { kind: 'set', setId: 'set_d', index: 3 });
  ok(mv1.ok, '등판 후 hand→기존세트 허용');
  const mv2 = moveTile(g, 'p1', { kind: 'set', setId: 'set_e', tileId: 'rC' }, { kind: 'set', setId: 'set_d', index: 0 });
  ok(mv2.ok, '등판 후 set→set 기존 타일 이동 허용');
}

section('#2-2 방어선: 가드 우회 스냅샷 직접 조작 mixed 세트 점수 0');
{
  const g = createGame();
  // 보드에 이전 턴 타일 base(빨강 10) 존재. 손에서 fresh r5,r6,r7로 30점 자력 세트 만들되,
  // 추가로 기존 base를 같은 세트에 섞으면 그 세트는 점수 0이 되어야 한다(스냅샷 직접 조작으로 가드 우회).
  Object.assign(g.tiles, {
    base: { id: 'base', kind: 'num', color: 'red', number: 13 },
    r10: { id: 'r10', kind: 'num', color: 'red', number: 10 },
    r11: { id: 'r11', kind: 'num', color: 'red', number: 11 },
    r12: { id: 'r12', kind: 'num', color: 'red', number: 12 },
  });
  // 가드 우회: 이미 base가 보드에, 손 fresh를 base와 같은 run에 합친 상태를 직접 만든다.
  g.board = [{ id: 'set_f', type: 'run', tiles: ['r10', 'r11', 'r12', 'base'] }]; // 10,11,12,13 valid
  g.hands.p1 = [];
  g.played.p1 = false;
  // 스냅샷: base만 보드에 있었고 손은 r10,r11,r12.
  g.turnSnapshot = {
    board: [{ id: 'set_f', type: 'run', tiles: ['base'] }],
    hands: { p1: ['r10', 'r11', 'r12'], p2: [] },
    nextSetSeq: g.nextSetSeq,
    jokerReturnedThisTurn: {},
  };
  g.hands.p2 = [];
  const er = endTurn(g, 'p1');
  // set_f에 base(기존 보드 타일) 섞임 → #2-2 점수 0 → 미달 롤백.
  eq(er.reason, 'initial_meld_short', 'mixed 세트 점수 0 → 미달 롤백');
  const m = er.error && er.error.match(/현재 (\d+)점/);
  eq(m ? parseInt(m[1], 10) : -1, 0, 'mixed 세트 점수 = 0');
}

// ════════════════════════════════════════════════════════════════════
section('#3 뒤섞인 런 [6,7,8,5]에 fresh 5 추가 점수 = 5');
{
  // 시나리오: 보드에 [r6,r7,r8] 이전 존재(등판 후). 손 r5를 앞에 추가 → [r5,r6,r7,r8].
  // 점수 미리보기(클라)가 아니라 서버 computeInitialMeldScore는 등판 후엔 호출 안됨.
  // 따라서 등판 전 자력 세트로 검증: [r6,r7,r8,r5] 전부 fresh → 합 26. r5 기여만 분리 검증 위해
  // 등판 전 added=r5만인 케이스 구성: 보드에 r6,r7,r8 기존 + r5 fresh.
  const g = createGame();
  Object.assign(g.tiles, {
    r5: { id: 'r5', kind: 'num', color: 'red', number: 5 },
    r6: { id: 'r6', kind: 'num', color: 'red', number: 6 },
    r7: { id: 'r7', kind: 'num', color: 'red', number: 7 },
    r8: { id: 'r8', kind: 'num', color: 'red', number: 8 },
  });
  // 보드: [r6,r7,r8,r5] (순서 뒤섞임). r5만 added. 그러나 r6,r7,r8 기존 → #2-2로 0이 됨.
  // 순수 #3(순서 독립) 검증을 위해 전부 fresh로 구성하고 added 점수 합 확인.
  g.board = [{ id: 'set_g', type: 'run', tiles: ['r6', 'r7', 'r8', 'r5'] }];
  g.hands.p1 = [];
  g.played.p1 = false;
  g.turnSnapshot = {
    board: [],
    hands: { p1: ['r5', 'r6', 'r7', 'r8'], p2: [] },
    nextSetSeq: g.nextSetSeq,
    jokerReturnedThisTurn: {},
  };
  g.hands.p2 = [];
  const er = endTurn(g, 'p1');
  // 전부 fresh, 순서 독립 → 5+6+7+8 = 26 < 30 → 미달.
  eq(er.reason, 'initial_meld_short', '26점 미달 롤백');
  const m = er.error && er.error.match(/현재 (\d+)점/);
  eq(m ? parseInt(m[1], 10) : -1, 26, '#3 순서 뒤섞여도 합=26 (인덱스 오산 아님)');
}

section('#3 런 안 조커 인덱스 0 → 빠진슬롯 점수 (인덱스 기준 오산 검출)');
{
  // [JY, base1(r4), base2(r6)] all fresh, start=4, 빠진슬롯={5}. 조커→5.
  // 인덱스 기준이면 조커(i=0)→start+0=4 (오답). 순서 독립이면 5.
  const g = createGame();
  Object.assign(g.tiles, {
    JY: { id: 'JY', kind: 'joker', color: null, number: null },
    r4: { id: 'r4', kind: 'num', color: 'red', number: 4 },
    r6: { id: 'r6', kind: 'num', color: 'red', number: 6 },
  });
  g.board = [{ id: 'set_h', type: 'run', tiles: ['JY', 'r4', 'r6'] }];
  g.hands.p1 = [];
  g.played.p1 = false;
  g.turnSnapshot = {
    board: [],
    hands: { p1: ['JY', 'r4', 'r6'], p2: [] },
    nextSetSeq: g.nextSetSeq,
    jokerReturnedThisTurn: {},
  };
  g.hands.p2 = [];
  const er = endTurn(g, 'p1');
  const m = er.error && er.error.match(/현재 (\d+)점/);
  // JY=5(빠진슬롯), r4=4, r6=6 → 15. 인덱스 기준 오산이면 JY=4 → 14.
  eq(m ? parseInt(m[1], 10) : -1, 15, '#3 조커(인덱스0) = 빠진슬롯 5, 합=15 (오산 14 아님)');
}

section('#3 조커 2장 런, 일부만 fresh');
{
  // [base_r3, J1, J2, base_r6] → start=3, end=6, 숫자={3,6}, 빠진슬롯=[4,5]. J1→4, J2→5.
  // J1만 fresh(added), base_r3/base_r6은 기존. → #2-2로 세트 전체 점수 0(기존 섞임).
  // 순수 #3 조커 배정 검증을 위해 전부 fresh 구성.
  const g = createGame();
  Object.assign(g.tiles, {
    j1: { id: 'j1', kind: 'joker', color: null, number: null },
    j2: { id: 'j2', kind: 'joker', color: null, number: null },
    r3: { id: 'r3', kind: 'num', color: 'red', number: 3 },
    r6: { id: 'r6', kind: 'num', color: 'red', number: 6 },
  });
  g.board = [{ id: 'set_i', type: 'run', tiles: ['r3', 'j1', 'j2', 'r6'] }];
  g.hands.p1 = [];
  g.played.p1 = false;
  g.turnSnapshot = {
    board: [],
    hands: { p1: ['r3', 'j1', 'j2', 'r6'], p2: [] },
    nextSetSeq: g.nextSetSeq,
    jokerReturnedThisTurn: {},
  };
  g.hands.p2 = [];
  const er = endTurn(g, 'p1');
  const m = er.error && er.error.match(/현재 (\d+)점/);
  // r3=3, j1→4, j2→5, r6=6 → 18.
  eq(m ? parseInt(m[1], 10) : -1, 18, '#3 조커2장 = 빠진슬롯 [4,5] 배정, 합=18');
}

// ════════════════════════════════════════════════════════════════════
section('#4 [J,5,6] 런 → 손 7로 회수 거부, 4로 성공');
{
  // run [J,5,6]? 조커가 인덱스0이면 start=? nums={5,6}, len=3, startMin=max(1,6-3+1)=4, startMax=min(5,11)=5.
  // start=4:[4,5,6] 조커=4. start=5:[5,6,7] 조커=7. bestScore start=5(18>15). → 빠진슬롯 {7}.
  // 따라서 정확 회수 타일은 7, 4는 거부되어야 한다(best start 기준).
  function mk() {
    const g = createGame();
    Object.assign(g.tiles, {
      J: { id: 'J', kind: 'joker', color: null, number: null },
      r5: { id: 'r5', kind: 'num', color: 'red', number: 5 },
      r6: { id: 'r6', kind: 'num', color: 'red', number: 6 },
      r7: { id: 'r7', kind: 'num', color: 'red', number: 7 },
      r4: { id: 'r4', kind: 'num', color: 'red', number: 4 },
    });
    g.board = [{ id: 'set_j', type: 'run', tiles: ['J', 'r5', 'r6'] }];
    g.played.p1 = true;
    return g;
  }
  // best start 확인.
  const vg = validateSet([
    { kind: 'joker' }, { kind: 'num', color: 'red', number: 5 }, { kind: 'num', color: 'red', number: 6 },
  ]);
  console.log(`     (validateSet [J,5,6] score=${vg.score}, type=${vg.type})`);
  // score 18 → start=5 → 빠진슬롯 7.
  const correct = vg.score === 18 ? 7 : 4;
  const wrong = correct === 7 ? 4 : 7;

  const g1 = mk();
  g1.hands.p1 = [`r${wrong}`];
  g1.turnSnapshot = snap(g1, { p1: [`r${wrong}`], p2: [] });
  g1.hands.p2 = [];
  const rWrong = swapJoker(g1, 'p1', { setId: 'set_j', jokerIndex: 0, handTileId: `r${wrong}` });
  eq(rWrong.ok, false, `손 ${wrong}로 회수 거부 (정답=${correct})`);

  const g2 = mk();
  g2.hands.p1 = [`r${correct}`];
  g2.turnSnapshot = snap(g2, { p1: [`r${correct}`], p2: [] });
  g2.hands.p2 = [];
  const rOk = swapJoker(g2, 'p1', { setId: 'set_j', jokerIndex: 0, handTileId: `r${correct}` });
  eq(rOk.ok, true, `손 ${correct}로 회수 성공`);
}

section('#4 그룹 조커 → "이미 있는 색"으로 회수 거부');
{
  const g = createGame();
  Object.assign(g.tiles, {
    r7: { id: 'r7', kind: 'num', color: 'red', number: 7 },
    b7: { id: 'b7', kind: 'num', color: 'blue', number: 7 },
    JK: { id: 'JK', kind: 'joker', color: null, number: null },
    r7b: { id: 'r7b', kind: 'num', color: 'red', number: 7 }, // 이미 있는 색(red)
    k7: { id: 'k7', kind: 'num', color: 'black', number: 7 }, // 없는 색
  });
  g.board = [{ id: 'set_k', type: 'group', tiles: ['r7', 'b7', 'JK'] }];
  g.played.p1 = true;
  // 이미 있는 색 red로 회수 시도 → 거부.
  g.hands.p1 = ['r7b'];
  g.turnSnapshot = snap(g, { p1: ['r7b'], p2: [] });
  g.hands.p2 = [];
  const rDup = swapJoker(g, 'p1', { setId: 'set_k', jokerIndex: 2, handTileId: 'r7b' });
  eq(rDup.ok, false, '그룹 이미 있는 색(red) 회수 거부');
  // 없는 색 black로 회수 성공.
  const g2 = createGame();
  Object.assign(g2.tiles, g.tiles);
  g2.board = [{ id: 'set_k', type: 'group', tiles: ['r7', 'b7', 'JK'] }];
  g2.played.p1 = true;
  g2.hands.p1 = ['k7'];
  g2.turnSnapshot = snap(g2, { p1: ['k7'], p2: [] });
  g2.hands.p2 = [];
  const rOk = swapJoker(g2, 'p1', { setId: 'set_k', jokerIndex: 2, handTileId: 'k7' });
  eq(rOk.ok, true, '그룹 없는 색(black) 회수 성공');
}

section('#4 등판 전 회수 거부');
{
  const g = createGame();
  Object.assign(g.tiles, {
    r3: { id: 'r3', kind: 'num', color: 'red', number: 3 },
    JX: { id: 'JX', kind: 'joker', color: null, number: null },
    r5: { id: 'r5', kind: 'num', color: 'red', number: 5 },
    r4: { id: 'r4', kind: 'num', color: 'red', number: 4 },
  });
  g.board = [{ id: 'set_l', type: 'run', tiles: ['r3', 'JX', 'r5'] }];
  g.hands.p1 = ['r4'];
  g.played.p1 = false;
  g.turnSnapshot = snap(g, { p1: ['r4'], p2: [] });
  g.hands.p2 = [];
  const r = swapJoker(g, 'p1', { setId: 'set_l', jokerIndex: 1, handTileId: 'r4' });
  eq(r.ok, false, '등판 전 회수 거부');
  ok(r.error && r.error.includes('첫 등판'), '에러 "첫 등판" 포함');
}

// ════════════════════════════════════════════════════════════════════
section('#6 같은 세트 왼쪽/오른쪽 이동 + 경계값 to.index');
{
  function mk() {
    const g = createGame();
    Object.assign(g.tiles, {
      a: { id: 'a', kind: 'num', color: 'red', number: 1 },
      b: { id: 'b', kind: 'num', color: 'red', number: 2 },
      c: { id: 'c', kind: 'num', color: 'red', number: 3 },
      d: { id: 'd', kind: 'num', color: 'red', number: 4 },
    });
    g.board = [{ id: 'set_m', type: 'run', tiles: ['a', 'b', 'c', 'd'] }];
    g.hands.p1 = [];
    g.played.p1 = true;
    g.turnSnapshot = snap(g, { p1: [], p2: [] });
    g.hands.p2 = [];
    return g;
  }
  // 오른쪽 이동: a(0) → index 2. 기대 [b,a,c,d].
  let g = mk();
  moveTile(g, 'p1', { kind: 'set', setId: 'set_m', tileId: 'a' }, { kind: 'set', setId: 'set_m', index: 2 });
  eq(g.board[0].tiles, ['b', 'a', 'c', 'd'], '오른쪽 이동 a→idx2 = [b,a,c,d]');
  // 왼쪽 이동: d(3) → index 1. fromIdx=3, insertIdx=1, 1>3 거짓 → 보정 없음. [a,b,c] splice(1,0,d)=[a,d,b,c].
  g = mk();
  moveTile(g, 'p1', { kind: 'set', setId: 'set_m', tileId: 'd' }, { kind: 'set', setId: 'set_m', index: 1 });
  eq(g.board[0].tiles, ['a', 'd', 'b', 'c'], '왼쪽 이동 d→idx1 = [a,d,b,c]');
  // to.index = 0 경계: c(2) → 0. fromIdx=2, insertIdx=0, 0>2 거짓. [a,b,d] splice(0,0,c)=[c,a,b,d].
  g = mk();
  moveTile(g, 'p1', { kind: 'set', setId: 'set_m', tileId: 'c' }, { kind: 'set', setId: 'set_m', index: 0 });
  eq(g.board[0].tiles, ['c', 'a', 'b', 'd'], 'to.index=0 c→맨앞 = [c,a,b,d]');
  // QA-ISSUE-1 (수정 완료): to.index = length(4) 경계 — 이동 전 좌표(preLen) 기준
  // bounds-check로 고쳐 이중 차감 해소. 우측 끝 슬롯 이동이 정확히 끝에 꽂힌다.
  // (수정 전엔 줄어든 길이로 클램프 + #6 보정이 겹쳐 [b,c,a,d]가 나왔음. 회귀: RUMMI-032)
  g = mk();
  moveTile(g, 'p1', { kind: 'set', setId: 'set_m', tileId: 'a' }, { kind: 'set', setId: 'set_m', index: 4 });
  eq(g.board[0].tiles, ['b', 'c', 'd', 'a'], 'QA-ISSUE-1 fix: to.index=length 같은세트 우측끝 이동 = [b,c,d,a]');
}

// ════════════════════════════════════════════════════════════════════
section('#8 빈 세트 4개 → 1개 채워 3개 → 다시 생성 가능');
{
  const g = createGame();
  Object.assign(g.tiles, {
    t1: { id: 't1', kind: 'num', color: 'red', number: 5 },
  });
  g.hands.p1 = ['t1'];
  g.played.p1 = true;
  g.turnSnapshot = snap(g, { p1: ['t1'], p2: [] });
  for (let i = 0; i < 4; i++) ok(addNewSet(g, 'p1').ok, `빈 세트 ${i + 1} 생성`);
  eq(addNewSet(g, 'p1').ok, false, '5번째 거부');
  // 빈 세트 1개에 타일 넣어 채움 → 빈 세트 3개.
  const firstEmpty = g.board.find((s) => s.tiles.length === 0);
  moveTile(g, 'p1', { kind: 'hand', tileId: 't1' }, { kind: 'set', setId: firstEmpty.id });
  const emptyNow = g.board.filter((s) => s.tiles.length === 0).length;
  eq(emptyNow, 3, '채운 후 빈 세트 3개');
  eq(addNewSet(g, 'p1').ok, true, '빈 세트 3개 상태 → 다시 생성 가능');
}

// ════════════════════════════════════════════════════════════════════
console.log(`\n════════════════════════════════════════`);
console.log(`QA Pass3 공격: ${pass + fail}건 / PASS=${pass} / FAIL=${fail}`);
if (fails.length) { console.log('실패 목록:'); for (const f of fails) console.log('  - ' + f); }
process.exit(fail > 0 ? 1 : 0);
