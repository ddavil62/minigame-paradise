/**
 * @fileoverview QA 능동 공격 — 렌주 금수(쌍삼·사사) 정확성 파괴 테스트.
 * 리포트/기존 테스트가 다루지 않은 경계·오탐·미탐 시나리오를 직접 도출해 검증한다.
 * 이 파일은 QA가 작성한 검증 전용이며 코드 본체는 수정하지 않는다.
 */
import {
  createGame, placeStone,
  checkDoubleThree, checkDoubleFour,
  BOARD_SIZE,
} from '../game.js';

let passed = 0, failed = 0;
const fails = [];
function ok(cond, label) {
  if (cond) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}`); fails.push(label); }
}
function sec(n) { console.log(`\n[${n}]`); }

const idx = (r, c) => r * BOARD_SIZE + c;

// 빈 보드(361 null)에 주어진 좌표들에 color를 직접 박는다(턴/검증 우회).
function boardWith(stones) {
  const b = new Array(BOARD_SIZE * BOARD_SIZE).fill(null);
  for (const [r, c, col] of stones) b[idx(r, c)] = col;
  return b;
}

// ────────────────────────────────────────────────────────────
// A. 진짜 쌍삼 거부
// ────────────────────────────────────────────────────────────
sec('A1: 진짜 쌍삼(가로 열린3 + 세로 열린3) → 거부');
{
  // 착수점 (9,9). 가로: (9,8)(9,9)(9,10) 양끝 (9,7),(9,11) 빈칸.
  //            세로: (8,9)(9,9)(10,9) 양끝 (7,9),(11,9) 빈칸.
  const b = boardWith([
    [9, 8, 'black'], [9, 10, 'black'],
    [8, 9, 'black'], [10, 9, 'black'],
    [9, 9, 'black'], // 가상 착수 반영
  ]);
  ok(checkDoubleThree(b, 9, 9, 'black') === true, '가로+세로 열린3 동시 = 쌍삼');
}

sec('A2: 대각 두 방향 쌍삼 → 거부');
{
  // ↘ 대각: (8,8)(9,9)(10,10), 양끝 (7,7),(11,11) 빈
  // ↗ 대각: (10,8)(9,9)(8,10), 양끝 (11,7),(7,11) 빈
  const b = boardWith([
    [8, 8, 'black'], [10, 10, 'black'],
    [10, 8, 'black'], [8, 10, 'black'],
    [9, 9, 'black'],
  ]);
  ok(checkDoubleThree(b, 9, 9, 'black') === true, '↘+↗ 대각 열린3 동시 = 쌍삼');
}

sec('A3: 백도 쌍삼 거부');
{
  const b = boardWith([
    [9, 8, 'white'], [9, 10, 'white'],
    [8, 9, 'white'], [10, 9, 'white'],
    [9, 9, 'white'],
  ]);
  ok(checkDoubleThree(b, 9, 9, 'white') === true, '백 가로+세로 = 쌍삼');
}

// ────────────────────────────────────────────────────────────
// B. 닫힌3은 쌍삼 아님 (오탐 없어야)
// ────────────────────────────────────────────────────────────
sec('B1: 한 방향 한쪽 막힘(닫힌3) + 다른 방향 열린3 → 쌍삼 아님');
{
  // 가로: (9,7)백 막음 → (9,8)(9,9)(9,10), 역방향 끝 (9,8) 바깥 (9,7)=white → backOpen=false → 닫힌3
  // 세로: 열린3
  const b = boardWith([
    [9, 7, 'white'], // 가로 한쪽 막음
    [9, 8, 'black'], [9, 10, 'black'],
    [8, 9, 'black'], [10, 9, 'black'],
    [9, 9, 'black'],
  ]);
  ok(checkDoubleThree(b, 9, 9, 'black') === false, '닫힌3 1 + 열린3 1 = 쌍삼 아님(열린3 단 1개)');
}

sec('B2: 양쪽 다 닫힌3 → 쌍삼 아님');
{
  const b = boardWith([
    [9, 7, 'white'], [9, 8, 'black'], [9, 10, 'black'], // 가로 닫힌
    [7, 9, 'white'], [8, 9, 'black'], [10, 9, 'black'], // 세로 닫힌
    [9, 9, 'black'],
  ]);
  ok(checkDoubleThree(b, 9, 9, 'black') === false, '닫힌3 2개 = 쌍삼 아님');
}

// ────────────────────────────────────────────────────────────
// C. 진짜 사사 거부 + 닫힌4
// ────────────────────────────────────────────────────────────
sec('C1: 가로4 + 세로4 동시 → 사사');
{
  const b = boardWith([
    [9, 6, 'black'], [9, 7, 'black'], [9, 8, 'black'], // + 착수 = 가로4
    [6, 9, 'black'], [7, 9, 'black'], [8, 9, 'black'], // + 착수 = 세로4
    [9, 9, 'black'],
  ]);
  ok(checkDoubleFour(b, 9, 9, 'black') === true, '가로4+세로4 = 사사');
}

sec('C2: 닫힌4 2개(양끝 상대 돌)도 사사');
{
  const b = boardWith([
    [9, 5, 'white'], [9, 6, 'black'], [9, 7, 'black'], [9, 8, 'black'], [9, 10, 'white'],
    [5, 9, 'white'], [6, 9, 'black'], [7, 9, 'black'], [8, 9, 'black'], [11, 9, 'white'],
    [9, 9, 'black'],
  ]);
  ok(checkDoubleFour(b, 9, 9, 'black') === true, '닫힌4 2개 = 사사(열린/닫힌 불문)');
}

sec('C3: 한 방향만 4목 → 사사 아님');
{
  const b = boardWith([
    [9, 6, 'black'], [9, 7, 'black'], [9, 8, 'black'],
    [9, 9, 'black'],
  ]);
  ok(checkDoubleFour(b, 9, 9, 'black') === false, '가로4 1개 = 사사 아님');
}

sec('C4: 백도 사사 거부');
{
  const b = boardWith([
    [9, 6, 'white'], [9, 7, 'white'], [9, 8, 'white'],
    [6, 9, 'white'], [7, 9, 'white'], [8, 9, 'white'],
    [9, 9, 'white'],
  ]);
  ok(checkDoubleFour(b, 9, 9, 'white') === true, '백 가로4+세로4 = 사사');
}

// ────────────────────────────────────────────────────────────
// D. 승리 우선 (5목+ 동시 33/44)
// ────────────────────────────────────────────────────────────
sec('D1: placeStone — 5목 완성이 동시에 쌍삼 모양 → 승리(거부 아님)');
{
  const g = createGame();
  // 가로 5목 + 세로 열린3 동시. 흑 차례 유지 위해 백은 더미.
  // 흑: (9,5)(9,6)(9,7)(9,8) 미리, 세로 (8,9)(10,9) 미리 → 착수 (9,9)면 가로5 + (세로는 9,9 중심 3)
  // 단 세로 열린3 + 가로 5목. 5목이 우선 승리해야 함.
  const blacks = [[9, 5], [9, 6], [9, 7], [9, 8], [8, 9], [10, 9]];
  const used = new Set();
  let dummyR = 0;
  for (let i = 0; i < blacks.length; i++) {
    const r = placeStone(g, 'black', blacks[i][0], blacks[i][1]);
    if (!r.ok) { ok(false, `사전 흑 착수 실패 @${blacks[i]} : ${r.error}`); break; }
    // 백 더미(멀리, 자체 라인 안 만들게 0행 짝수열)
    placeStone(g, 'white', 0, (dummyR += 2));
  }
  const res = placeStone(g, 'black', 9, 9);
  ok(res.ok === true && res.gameOver === true && res.winner === 'black' && res.reason === 'five',
    '가로5 + 세로 열린3 동시 → five 승리(금수 거부 아님)');
}

sec('D2: placeStone — 장목(6목) 승리(금수 무관)');
{
  const g = createGame();
  // 사전 5개를 한 줄에 두면 5목으로 먼저 끝나므로, 양끝 2개 + 가운데 비워 두고
  // 마지막에 가운데를 메워 6목 완성. 사전: (9,4)(9,5)(9,6) (9,8)(9,9) → (9,7) 착수면 (9,4~9,9) 6목.
  const blacks = [[9, 4], [9, 5], [9, 6], [9, 8], [9, 9]];
  let dummyR = 0;
  for (let i = 0; i < blacks.length; i++) {
    const r = placeStone(g, 'black', blacks[i][0], blacks[i][1]);
    if (!r.ok) { ok(false, `사전 흑 착수 실패 @${blacks[i]}: ${r.error}`); }
    const w = placeStone(g, 'white', 0, (dummyR += 2));
    if (!w.ok) { ok(false, `백 더미 실패: ${w.error}`); }
  }
  // (9,7) 두면 (9,4..9,9) 6목 → 승리
  const res = placeStone(g, 'black', 9, 7);
  ok(res.ok === true && res.gameOver === true && res.reason === 'five', '6목 장목 → five 승리');
}

// ────────────────────────────────────────────────────────────
// E. 보드 경계 래핑 오판 방지
// ────────────────────────────────────────────────────────────
sec('E1: 코너 인접 — 가로 열린3 한쪽이 보드밖 → 열린3 아님');
{
  // (0,0)(0,1)(0,2) 가로3. 역방향 끝 (0,0)의 바깥은 (0,-1)=보드밖 → backOpen=false
  const b = boardWith([
    [0, 0, 'black'], [0, 1, 'black'], [0, 2, 'black'],
    // 세로도 만들어보지만 (0,*) 위는 보드밖
    [1, 1, 'black'], [2, 1, 'black'],
  ]);
  // 착수점 (0,1): 가로3은 한쪽이 보드밖이라 열린3 아님 + 세로는 (0,1)(1,1)(2,1) 위 바깥 보드밖 → 열린3 아님
  ok(checkDoubleThree(b, 0, 1, 'black') === false, '코너 행에서 보드밖 끝 = 열린3 미성립 → 쌍삼 아님');
}

sec('E2: 가로 카운트가 행 경계를 넘어 래핑하지 않음');
{
  // (9,16)(9,17)(9,18) 가로3. (9,18) 다음은 (9,19)=보드밖 → frontOpen false → 열린3 아님.
  // 또한 다음 행 (10,0)으로 래핑되지 않아야 함(checkWin/검사 모두).
  const b = boardWith([
    [9, 16, 'black'], [9, 17, 'black'], [9, 18, 'black'],
    [10, 0, 'black'], [10, 1, 'black'], // 다음 행 — 래핑되면 오판
  ]);
  ok(checkDoubleThree(b, 9, 17, 'black') === false, '18열 끝 보드밖 = 열린3 아님(래핑 없음)');
}

sec('E3: 사사도 경계 래핑 없음 — 18열 4목은 한 방향만');
{
  // (9,15)(9,16)(9,17)(9,18) 가로4 (착수 9,17 가정 아님; 직접 박고 18열).
  // 세로 4목 없음 → 한 방향 → 사사 아님.
  const b = boardWith([
    [9, 15, 'black'], [9, 16, 'black'], [9, 17, 'black'], [9, 18, 'black'],
  ]);
  ok(checkDoubleFour(b, 9, 18, 'black') === false, '18열 가로4 1개 = 사사 아님(다음행 래핑 없음)');
}

// ────────────────────────────────────────────────────────────
// F. placeStone 원복 정확성
// ────────────────────────────────────────────────────────────
sec('F1: 쌍삼 거부 후 board/moveCount/turn/phase 완전 원복');
{
  const g = createGame();
  // 쌍삼 형태 사전 세팅(흑). 백 더미 교대.
  const setup = [[9, 8], [9, 10], [8, 9], [10, 9]];
  let dummyC = 0;
  for (let i = 0; i < setup.length; i++) {
    placeStone(g, 'black', setup[i][0], setup[i][1]);
    placeStone(g, 'white', 0, (dummyC += 2));
  }
  const turnBefore = g.currentTurn;
  const mcBefore = g.moveCount;
  const phaseBefore = g.phase;
  const res = placeStone(g, 'black', 9, 9); // 쌍삼 시도
  ok(res.ok === false && /쌍삼/.test(res.error), '쌍삼 거부 반환');
  ok(g.board[idx(9, 9)] === null, '거부 후 board[9,9] === null (원복)');
  ok(g.moveCount === mcBefore, `거부 후 moveCount 불변 (${g.moveCount}===${mcBefore})`);
  ok(g.currentTurn === turnBefore, '거부 후 currentTurn 불변(흑 유지)');
  ok(g.phase === phaseBefore && g.phase === 'playing', '거부 후 phase=playing(게임 계속)');
  // 거부 후 같은 흑이 다른 합법 칸에 둘 수 있는지
  const res2 = placeStone(g, 'black', 0, 18);
  ok(res2.ok === true, '거부 후 흑이 다른 합법칸에 착수 가능');
}

sec('F2: 사사 거부 후 원복');
{
  const g = createGame();
  const setup = [[9, 6], [9, 7], [9, 8], [6, 9], [7, 9], [8, 9]];
  let dummyC = 0;
  for (let i = 0; i < setup.length; i++) {
    placeStone(g, 'black', setup[i][0], setup[i][1]);
    placeStone(g, 'white', 0, (dummyC += 2));
  }
  const mcBefore = g.moveCount;
  const res = placeStone(g, 'black', 9, 9);
  ok(res.ok === false && /사사/.test(res.error), '사사 거부 반환');
  ok(g.board[idx(9, 9)] === null, '거부 후 board 원복');
  ok(g.moveCount === mcBefore, '거부 후 moveCount 불변');
}

// ────────────────────────────────────────────────────────────
// G. 미묘한 미탐/오탐 — 띈삼/장목 방향 제외
// ────────────────────────────────────────────────────────────
sec('G1: 5목 연속 방향은 isFour에서 제외(len===4만) → 5목+쌍삼 시 사사 오탐 안 함');
{
  // (9,5..9,9) 가로5 직접 박고 + 세로4. checkDoubleFour 단독은 가로5를 4로 안 셈.
  const b = boardWith([
    [9, 5, 'black'], [9, 6, 'black'], [9, 7, 'black'], [9, 8, 'black'],
    [6, 9, 'black'], [7, 9, 'black'], [8, 9, 'black'],
    [9, 9, 'black'], // 착수점 → 가로5 + 세로4
  ]);
  // 가로 방향 len=5 → isFour false. 세로 len=4 → true. fours=1 → 사사 아님.
  ok(checkDoubleFour(b, 9, 9, 'black') === false, '가로5(len5 제외)+세로4 → fours=1 → 사사 아님');
}

sec('G2: 장목6 방향도 isFour에서 제외');
{
  const b = boardWith([
    [9, 4, 'black'], [9, 5, 'black'], [9, 6, 'black'], [9, 7, 'black'], [9, 8, 'black'],
    [6, 9, 'black'], [7, 9, 'black'], [8, 9, 'black'],
    [9, 9, 'black'], // 가로6 + 세로4
  ]);
  ok(checkDoubleFour(b, 9, 9, 'black') === false, '가로6(len6 제외)+세로4 → fours=1 → 사사 아님');
}

sec('G3: 띈삼(_XX_X_)은 이 구현에서 열린3으로 세지 않음(스펙: 연속 _XXX_만)');
{
  // (9,7)(9,8) _ (9,10) 형태에서 (9,9)에 착수 → (9,7)(9,8)(9,9)(9,10) 연속4가 됨(띈X).
  // 진짜 띈삼 테스트: (9,7)(9,8) [공백 9,9] (9,10) 에서 다른 착수.
  // 여기서는 연속만 센다는 점을 (9,9) 미배치로 확인: 가로 연속 분리.
  const b = boardWith([
    [9, 7, 'black'], [9, 8, 'black'], [9, 10, 'black'],
    [9, 9, 'black'], // 착수 → 가로 (9,7..9,10) 연속4 (len4)
    [8, 9, 'black'], [10, 9, 'black'], // 세로 열린3
  ]);
  // 가로는 len4 → 열린3 아님. 세로 len3 열린3. openThrees=1 → 쌍삼 아님.
  ok(checkDoubleThree(b, 9, 9, 'black') === false, '띈 메우면 가로4 되어 열린3 1개뿐 → 쌍삼 아님');
}

// ────────────────────────────────────────────────────────────
// H. placeStone 통합 — 흑 쌍삼 거부 후 백 정상 진행
// ────────────────────────────────────────────────────────────
sec('H1: 흑 쌍삼 거부는 턴을 백으로 넘기지 않음(흑이 다시 둬야 함)');
{
  const g = createGame();
  const setup = [[9, 8], [9, 10], [8, 9], [10, 9]];
  let dummyC = 0;
  for (let i = 0; i < setup.length; i++) {
    placeStone(g, 'black', setup[i][0], setup[i][1]);
    placeStone(g, 'white', 0, (dummyC += 2));
  }
  ok(g.currentTurn === 'black', '쌍삼 시도 직전 흑 차례');
  placeStone(g, 'black', 9, 9); // 거부
  // 백이 두려고 시도하면? 흑 차례이므로 거부되어야 함
  const whiteTry = placeStone(g, 'white', 5, 5);
  ok(whiteTry.ok === false && /차례/.test(whiteTry.error), '거부 후에도 백 착수는 차례 아님으로 거부');
}

// ── 결과 ──
console.log('\n────────────────────────────────────────');
console.log(`총 ${passed + failed}건, PASS=${passed}, FAIL=${failed}`);
if (failed > 0) {
  console.log('실패 목록:');
  for (const f of fails) console.log(`  - ${f}`);
  process.exit(1);
} else {
  console.log('QA 렌주 공격 테스트 전부 통과.');
}
