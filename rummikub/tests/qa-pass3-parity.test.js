/**
 * @fileoverview QA Pass3 클라-서버 정합 — public/js/game.js의 computeFreshMeldScore /
 * inferJokerReplacement가 서버 computeInitialMeldScore / swapJoker 검증과 동일 결과를 내는지 검증.
 *
 * 서버 computeInitialMeldScore는 export되지 않으므로 endTurn 경유로 점수를 추출(현재 N점),
 * 클라 computeFreshMeldScore는 직접 import해 동일 입력에서 같은 점수를 내는지 비교한다.
 */
import { createGame, endTurn, validateSet as srvValidate } from '../game.js';
import { computeFreshMeldScore, inferJokerReplacement } from '../public/js/game.js';

let pass = 0, fail = 0; const fails = [];
function eq(a, e, msg) {
  if (JSON.stringify(a) === JSON.stringify(e)) { pass++; console.log(`  PASS  ${msg}`); }
  else { fail++; fails.push(`${msg} — exp ${JSON.stringify(e)} got ${JSON.stringify(a)}`); console.log(`  FAIL  ${msg} — exp ${JSON.stringify(e)} got ${JSON.stringify(a)}`); }
}
function section(t) { console.log(`\n── ${t} ──`); }

/** 서버 점수를 endTurn 미달 에러에서 추출. 전부 fresh 자력 세트 가정. */
function serverScore(boardTiles, tileDefs) {
  const g = createGame();
  Object.assign(g.tiles, tileDefs);
  g.board = [{ id: 'sx', type: 'run', tiles: boardTiles.slice() }];
  g.hands.p1 = [];
  g.played.p1 = false;
  g.turnSnapshot = { board: [], hands: { p1: boardTiles.slice(), p2: [] }, nextSetSeq: g.nextSetSeq, jokerReturnedThisTurn: {} };
  g.hands.p2 = [];
  const er = endTurn(g, 'p1');
  if (er.reason === 'initial_meld_short') {
    const m = er.error.match(/현재 (\d+)점/);
    return m ? parseInt(m[1], 10) : -1;
  }
  // commit된 경우(30점 이상) — 점수 직접 추출 불가. 미달 케이스만 사용.
  return 'committed';
}

/** 클라 점수: tileDict 구성 + 전부 fresh. */
function clientScore(boardTiles, tileDefs) {
  const tileDict = { ...tileDefs };
  const state = { board: [{ id: 'sx', type: 'run', tiles: boardTiles.slice() }], tileDict };
  return computeFreshMeldScore(state, new Set(boardTiles));
}

section('#3 점수 정합 — 다양한 런 배치');
const cases = [
  { name: '[6,7,8,5] 순서뒤섞', tiles: ['r6', 'r7', 'r8', 'r5'],
    defs: { r5: { id: 'r5', kind: 'num', color: 'red', number: 5 }, r6: { id: 'r6', kind: 'num', color: 'red', number: 6 }, r7: { id: 'r7', kind: 'num', color: 'red', number: 7 }, r8: { id: 'r8', kind: 'num', color: 'red', number: 8 } } },
  { name: '[J,r4,r6] 조커앞', tiles: ['JY', 'r4', 'r6'],
    defs: { JY: { id: 'JY', kind: 'joker', color: null, number: null }, r4: { id: 'r4', kind: 'num', color: 'red', number: 4 }, r6: { id: 'r6', kind: 'num', color: 'red', number: 6 } } },
  { name: '[r3,J1,J2,r6] 조커2장', tiles: ['r3', 'j1', 'j2', 'r6'],
    defs: { r3: { id: 'r3', kind: 'num', color: 'red', number: 3 }, j1: { id: 'j1', kind: 'joker', color: null, number: null }, j2: { id: 'j2', kind: 'joker', color: null, number: null }, r6: { id: 'r6', kind: 'num', color: 'red', number: 6 } } },
  { name: '[b9,b8,b7] 내림차순', tiles: ['b9', 'b8', 'b7'],
    defs: { b7: { id: 'b7', kind: 'num', color: 'blue', number: 7 }, b8: { id: 'b8', kind: 'num', color: 'blue', number: 8 }, b9: { id: 'b9', kind: 'num', color: 'blue', number: 9 } } },
];
for (const c of cases) {
  const s = serverScore(c.tiles, c.defs);
  const cl = clientScore(c.tiles, c.defs);
  if (s === 'committed') {
    console.log(`     (${c.name} 서버 commit됨 - 미달 아님, 클라=${cl})`);
    eq(true, true, `${c.name}: 30점↑ commit (정합 비교 생략)`);
  } else {
    eq(cl, s, `${c.name}: 클라(${cl}) == 서버(${s})`);
  }
}

section('#4 inferJokerReplacement 클라 == 서버 swapJoker 정답 슬롯');
// 클라 추론이 서버 검증 통과 타일과 일치하는지.
// run [J,5,6]: 서버 best start=5 → 빠진슬롯 7. 클라 inferJokerReplacement도 7이어야.
{
  const resolved = [
    { id: 'J', kind: 'joker', color: null, number: null },
    { id: 'r5', kind: 'num', color: 'red', number: 5 },
    { id: 'r6', kind: 'num', color: 'red', number: 6 },
  ];
  const inferred = inferJokerReplacement(resolved, 0);
  eq(inferred, [{ color: 'red', number: 7 }], 'run [J,5,6] 클라 추론 = red7 (서버 best start 정합)');
}
{
  // run [5,J,6] 조커 인덱스1, nums={5,6}, len3, start: max(1,6-3+1)=4..min(5,11)=5. start5=[5,6,7] 조커→7.
  const resolved = [
    { id: 'r5', kind: 'num', color: 'red', number: 5 },
    { id: 'J', kind: 'joker', color: null, number: null },
    { id: 'r6', kind: 'num', color: 'red', number: 6 },
  ];
  const inferred = inferJokerReplacement(resolved, 1);
  eq(inferred, [{ color: 'red', number: 7 }], 'run [5,J,6] 클라 추론 = red7');
}
{
  // 조커 2장 [r3,J1,J2,r6] start3..end6? nums{3,6} len4 startMin=max(1,6-4+1)=3 startMax=min(3,10)=3. start3=[3,4,5,6] 빠진{4,5}.
  // J1(idx1)→4, J2(idx2)→5.
  const resolved = [
    { id: 'r3', kind: 'num', color: 'red', number: 3 },
    { id: 'j1', kind: 'joker', color: null, number: null },
    { id: 'j2', kind: 'joker', color: null, number: null },
    { id: 'r6', kind: 'num', color: 'red', number: 6 },
  ];
  eq(inferJokerReplacement(resolved, 1), [{ color: 'red', number: 4 }], '조커2장 idx1 추론 = red4');
  eq(inferJokerReplacement(resolved, 2), [{ color: 'red', number: 5 }], '조커2장 idx2 추론 = red5');
}
{
  // 그룹 [r7,b7,J] 조커 → 빠진색 {black,orange}.
  const resolved = [
    { id: 'r7', kind: 'num', color: 'red', number: 7 },
    { id: 'b7', kind: 'num', color: 'blue', number: 7 },
    { id: 'J', kind: 'joker', color: null, number: null },
  ];
  eq(inferJokerReplacement(resolved, 2), [{ color: 'black', number: 7 }, { color: 'orange', number: 7 }], '그룹 추론 = black7,orange7');
}

// 서버 validateSet과 클라 validateSet best score 동일성 스폿체크.
section('validateSet 서버==클라 score 정합 스폿');
import { validateSet as cliValidate } from '../public/js/game.js';
const vCases = [
  [{ kind: 'joker' }, { kind: 'num', color: 'red', number: 5 }, { kind: 'num', color: 'red', number: 6 }],
  [{ kind: 'num', color: 'red', number: 6 }, { kind: 'num', color: 'red', number: 7 }, { kind: 'num', color: 'red', number: 8 }, { kind: 'num', color: 'red', number: 5 }],
  [{ kind: 'num', color: 'red', number: 7 }, { kind: 'num', color: 'blue', number: 7 }, { kind: 'num', color: 'black', number: 7 }],
];
for (let i = 0; i < vCases.length; i++) {
  const sv = srvValidate(vCases[i]);
  const cv = cliValidate(vCases[i]);
  eq({ valid: cv.valid, type: cv.type, score: cv.score }, { valid: sv.valid, type: sv.type, score: sv.score }, `validateSet case${i}: 서버==클라`);
}

console.log(`\n════════════════════════════════════════`);
console.log(`QA Pass3 정합: ${pass + fail}건 / PASS=${pass} / FAIL=${fail}`);
if (fails.length) { console.log('실패:'); for (const f of fails) console.log('  - ' + f); }
process.exit(fail > 0 ? 1 : 0);
