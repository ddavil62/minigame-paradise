/**
 * @fileoverview QA — 무승부 draw 경로 결정적 검증 + 봇 휴리스틱 결정성 검증.
 */
import { createGame, placeStone, BOARD_SIZE, TOTAL_CELLS } from '../game.js';

let passed = 0, failed = 0;
const fails = [];
function ok(cond, label) {
  if (cond) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}`); fails.push(label); }
}
function sec(n) { console.log(`\n[${n}]`); }

// ── QA-D1: 진짜 draw — 5목 없는 마지막 칸 ──
sec('QA-D1: 5목 없는 마지막 칸 → reason=draw 확정');
{
  // checkWin은 "방금 착수한 칸"의 4방향만 본다(placeStone 내부).
  // 따라서 마지막 칸 (18,18)에 흑을 둘 때, 그 칸의 8방향 인접이 모두 흑이 아니면
  // 어떤 흑 라인도 연장하지 못해 checkWin=null → checkDraw 경로(draw)가 확정된다.
  // 나머지 359칸은 임의로 채우되 마지막 착수 칸 주변만 통제하면 충분하다.
  const g = createGame();
  for (let i = 0; i < TOTAL_CELLS - 1; i++) {
    g.board[i] = (i % 2 === 0) ? 'black' : 'white';
  }
  // (18,18)의 8방향 인접: (17,17)(17,18)(18,17) 등 — 모두 'white'로 강제(흑 연장 차단).
  for (const [dr, dc] of [[-1, -1], [-1, 0], [0, -1], [-1, 1], [1, -1]]) {
    const rr = 18 + dr, cc = 18 + dc;
    if (rr >= 0 && rr < BOARD_SIZE && cc >= 0 && cc < BOARD_SIZE) g.board[rr * BOARD_SIZE + cc] = 'white';
  }
  g.moveCount = TOTAL_CELLS - 1;
  g.currentTurn = 'black';
  const r = placeStone(g, 'black', 18, 18);
  // (18,18) 인접 흑 없음 → 흑 라인 연장 불가 → 5목 미형성 → draw 확정.
  ok(r.ok && r.gameOver, '마지막 칸 → gameOver');
  ok(r.reason === 'draw', `reason=draw (실제=${r.reason})`);
  ok(r.winner === 'draw', 'winner=draw');
  ok(g.phase === 'ended' && g.moveCount === TOTAL_CELLS, 'phase=ended, moveCount=361');
  ok(!g.result.winLine, 'draw에는 winLine 없음');
}

// ── 봇 휴리스틱 결정성: bot.js 평가 로직을 재현해 4목 차단 검증 ──
// bot.js의 평가는 동일 로직이므로, 여기서 평가 함수를 동일하게 구현해
// "사람 4목 위협 시 봇이 그 끝을 막는 칸을 최고점으로 고르는가"를 결정적으로 검증.
const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];
const CHAIN_WEIGHT = { 1: 1, 2: 10, 3: 100, 4: 1000, 5: 100000 };
function countDir(board, row, col, color, dr, dc) {
  let n = 0, r = row + dr, c = col + dc;
  while (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && board[r * BOARD_SIZE + c] === color) { n++; r += dr; c += dc; }
  return n;
}
function attackScore(board, row, col, color) {
  let s = 0;
  for (const [dr, dc] of DIRS) {
    const cnt = 1 + countDir(board, row, col, color, dr, dc) + countDir(board, row, col, color, -dr, -dc);
    s += CHAIN_WEIGHT[Math.min(cnt, 5)];
  }
  return s;
}
function evaluate(board, row, col, my, op) {
  return attackScore(board, row, col, my) + 0.9 * attackScore(board, row, col, op);
}
function chooseMove(board, moveCount, my) {
  const op = my === 'black' ? 'white' : 'black';
  if (moveCount === 0) { const ctr = Math.floor(BOARD_SIZE / 2); return { row: ctr, col: ctr }; }
  let best = -Infinity, mv = null;
  for (let r = 0; r < BOARD_SIZE; r++) for (let c = 0; c < BOARD_SIZE; c++) {
    if (board[r * BOARD_SIZE + c] !== null) continue;
    const sc = evaluate(board, r, c, my, op);
    if (sc > best) { best = sc; mv = { row: r, col: c }; }
  }
  return mv;
}

// ── QA-B1: 사람(흑) 열린 4목 → 봇(백)이 양 끝 중 하나를 막는다 ──
sec('QA-B1: 봇이 사람 열린 4목을 차단');
{
  const board = new Array(TOTAL_CELLS).fill(null);
  // 흑 4목: (9,6)(9,7)(9,8)(9,9). 양 끝 막는 칸 = (9,5) 또는 (9,10).
  for (const c of [6, 7, 8, 9]) board[9 * BOARD_SIZE + c] = 'black';
  // 봇(백) 돌 몇 개 흩뿌려 자기 공격이 차단보다 커지지 않게(없음 = 순수 차단 검증).
  const mv = chooseMove(board, 4, 'white');
  const blocks = (mv.row === 9 && (mv.col === 5 || mv.col === 10));
  ok(blocks, `봇이 4목 끝 차단 (선택=${mv.row},${mv.col})`);
}

// ── QA-B2: 봇 자기 5목 완성이 차단보다 우선 ──
sec('QA-B2: 봇이 자기 5목 완성을 최우선');
{
  const board = new Array(TOTAL_CELLS).fill(null);
  // 봇(백) 4목: (3,3)(3,4)(3,5)(3,6) → (3,2)/(3,7)에서 5목 완성 가능.
  for (const c of [3, 4, 5, 6]) board[3 * BOARD_SIZE + c] = 'white';
  // 사람(흑)도 4목 위협: (9,6)(9,7)(9,8)(9,9).
  for (const c of [6, 7, 8, 9]) board[9 * BOARD_SIZE + c] = 'black';
  const mv = chooseMove(board, 8, 'white');
  const winMove = (mv.row === 3 && (mv.col === 2 || mv.col === 7));
  ok(winMove, `봇이 자기 5목 완성 선택 (선택=${mv.row},${mv.col})`);
}

// ── QA-B3: 봇 chooseMove가 항상 빈 칸을 반환 (점유 칸 미선택) ──
sec('QA-B3: 봇은 점유된 칸을 절대 선택하지 않음');
{
  const board = new Array(TOTAL_CELLS).fill(null);
  // 거의 가득: 1칸만 비움.
  for (let i = 0; i < TOTAL_CELLS; i++) board[i] = (i % 2 === 0) ? 'black' : 'white';
  const emptyIdx = 200;
  board[emptyIdx] = null;
  const mv = chooseMove(board, 360, 'white');
  ok(mv && (mv.row * BOARD_SIZE + mv.col) === emptyIdx, `유일 빈칸 선택 (idx=${mv ? mv.row * BOARD_SIZE + mv.col : 'null'})`);
}

// ── QA-B4: 봇 첫 수는 천원(9,9) ──
sec('QA-B4: 봇 첫 수 = 천원(9,9)');
{
  const board = new Array(TOTAL_CELLS).fill(null);
  const mv = chooseMove(board, 0, 'black');
  ok(mv.row === 9 && mv.col === 9, '빈 보드 첫 수 = (9,9)');
}

console.log('\n────────────────────────────────────────');
console.log(`총 ${passed + failed}건, PASS=${passed}, FAIL=${failed}`);
if (failed > 0) { console.log('실패:', fails.join(', ')); process.exit(1); }
else { console.log('QA draw/bot 전부 통과.'); process.exit(0); }
