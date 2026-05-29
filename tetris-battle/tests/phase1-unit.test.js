/**
 * @fileoverview Phase 1 핵심 로직 단위 테스트 (Node ESM 직접 실행).
 *
 * 검증 대상:
 *  - 7-bag: 100회 샘플링하여 각 피스가 정확히 100회씩 나오는지
 *  - 보드 충돌 검사
 *  - 라인 클리어
 *  - 가비지 추가 (동일 hole, 변환표, 콤보 보너스)
 *  - 고스트 Y 계산
 *  - 회전
 *
 * 실행: node tests/phase1-unit.test.js
 */

import {
  createEmptyGrid, isColliding, lockPiece, clearLines, addGarbage,
  getGhostY, isPieceLanded, getColumnHeights, getStackHeight,
  garbageFromLines, comboBonus, BOARD_WIDTH, BOARD_HEIGHT,
  VISIBLE_HEIGHT, VANISH_ZONE,
} from '../public/js/board.js';
import {
  createBag, createPiece, getRotated, getMatrix,
  PIECES, PIECE_COLORS, PIECE_TYPES, COLOR_HEX,
} from '../public/js/tetromino.js';

let pass = 0;
let fail = 0;
const failures = [];

function assert(cond, name, detail = '') {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    failures.push({ name, detail });
    console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`);
  }
}

function section(title) {
  console.log(`\n── ${title} ─────────────────`);
}

// ─────────────────────────────────────────────────────────────
section('7-bag 무작위 분포 (100 bag = 700개 샘플링)');
{
  const bag = createBag();
  const counts = {};
  for (const t of PIECE_TYPES) counts[t] = 0;
  for (let i = 0; i < 700; i++) {
    const piece = bag.next();
    counts[piece] = (counts[piece] || 0) + 1;
  }
  let allEqual = true;
  for (const t of PIECE_TYPES) {
    if (counts[t] !== 100) {
      allEqual = false;
      break;
    }
  }
  assert(allEqual, '700회 추출 시 7종 피스가 각 100회씩 등장',
    JSON.stringify(counts));

  // 7-bag 보장: 연속된 7개 안에 같은 피스가 절대 2번 나오면 안 됨
  const bag2 = createBag();
  let dupViolation = false;
  let dupDetail = '';
  for (let b = 0; b < 50; b++) {
    const seen = new Set();
    for (let i = 0; i < 7; i++) {
      const t = bag2.next();
      if (seen.has(t)) {
        dupViolation = true;
        dupDetail = `bag ${b}, 중복: ${t}`;
        break;
      }
      seen.add(t);
    }
    if (dupViolation) break;
  }
  assert(!dupViolation, '연속된 7개 안에 중복 피스 없음 (7-bag 정의)', dupDetail);
}

// ─────────────────────────────────────────────────────────────
section('충돌 검사 (isColliding)');
{
  const grid = createEmptyGrid();
  // 빈 보드에서 모든 피스의 기본 위치 스폰 시 충돌 없어야 함
  for (const type of PIECE_TYPES) {
    const p = createPiece(type);
    assert(!isColliding(grid, p.type, p.rotation, p.x, p.y),
      `${type} 빈 보드 스폰 시 충돌 없음`);
  }

  // 좌측 경계 밖
  const p = createPiece('T');
  assert(isColliding(grid, p.type, p.rotation, -5, 0), 'T 피스 x=-5 좌측 경계 밖 충돌');

  // 우측 경계 밖
  assert(isColliding(grid, p.type, p.rotation, 20, 0), 'T 피스 x=20 우측 경계 밖 충돌');

  // 하단 경계 밖
  assert(isColliding(grid, p.type, p.rotation, 3, 100), 'T 피스 y=100 하단 경계 밖 충돌');

  // 기존 블록과 겹침
  grid[5][5] = 1;
  assert(isColliding(grid, 'O', 0, 4, 4), 'O 피스가 기존 블록 위치와 충돌');
}

// ─────────────────────────────────────────────────────────────
section('라인 클리어 (clearLines)');
{
  // Phase 5: BOARD_HEIGHT가 22(VISIBLE 20 + VANISH 2)로 확장되었으므로
  // "맨 아래 줄" 인덱스를 동적으로(BOARD_HEIGHT-1) 계산한다.
  const lastRow = BOARD_HEIGHT - 1;

  // 한 줄 가득 채움
  const grid = createEmptyGrid();
  for (let c = 0; c < BOARD_WIDTH; c++) grid[lastRow][c] = 1;
  const cleared = clearLines(grid);
  assert(cleared === 1, '한 줄 가득 채움 시 1줄 제거');
  assert(grid[lastRow].every((v) => v === 0), '제거된 자리는 빈 줄');

  // 4줄 동시 (Tetris) — 맨 아래 4줄
  const grid2 = createEmptyGrid();
  for (let r = BOARD_HEIGHT - 4; r < BOARD_HEIGHT; r++) {
    for (let c = 0; c < BOARD_WIDTH; c++) grid2[r][c] = 1;
  }
  const cleared2 = clearLines(grid2);
  assert(cleared2 === 4, '4줄 가득 채움 시 4줄 제거 (Tetris)');

  // 불완전 줄은 제거되지 않음
  const grid3 = createEmptyGrid();
  for (let c = 0; c < BOARD_WIDTH; c++) grid3[lastRow][c] = 1;
  grid3[lastRow][5] = 0; // 한 칸 비움
  const cleared3 = clearLines(grid3);
  assert(cleared3 === 0, '한 칸이 비어 있으면 클리어 없음');
}

// ─────────────────────────────────────────────────────────────
section('가비지 추가 (addGarbage) - 같은 hole 위치 검증');
{
  // 100번 반복: 각 배치 내 hole 위치가 동일한지
  let allBatchHoleConsistent = true;
  let detail = '';
  for (let iter = 0; iter < 100; iter++) {
    const grid = createEmptyGrid();
    addGarbage(grid, 4); // 한 번에 4줄
    // 마지막 4줄의 hole 위치를 모두 확인
    const holes = [];
    for (let r = BOARD_HEIGHT - 4; r < BOARD_HEIGHT; r++) {
      const holeIdx = grid[r].indexOf(0);
      holes.push(holeIdx);
    }
    if (!holes.every((h) => h === holes[0])) {
      allBatchHoleConsistent = false;
      detail = `iter ${iter}, holes: ${holes.join(',')}`;
      break;
    }
  }
  assert(allBatchHoleConsistent, '한 배치(공격) 4줄의 hole 위치는 모두 동일', detail);

  // 가비지 색상 인덱스 8 확인
  const grid = createEmptyGrid();
  addGarbage(grid, 1);
  // Phase 5: BOARD_HEIGHT=22이므로 마지막 줄은 grid[BOARD_HEIGHT-1]
  const lastRow = grid[BOARD_HEIGHT - 1];
  const nonHoleCount = lastRow.filter((v) => v === 8).length;
  assert(nonHoleCount === 9, '가비지 1줄 추가 시 9칸이 8(가비지 색상)이고 1칸이 0');
}

// ─────────────────────────────────────────────────────────────
section('변환표 (garbageFromLines)');
{
  assert(garbageFromLines(1) === 0, 'Single = 0');
  assert(garbageFromLines(2) === 1, 'Double = 1');
  assert(garbageFromLines(3) === 2, 'Triple = 2');
  assert(garbageFromLines(4) === 4, 'Tetris = 4');
  assert(garbageFromLines(0) === 0, '0줄 = 0');
  assert(garbageFromLines(5) === 0, '5줄 (이상값) = 0 (안전)');
}

// ─────────────────────────────────────────────────────────────
section('콤보 보너스 (comboBonus)');
{
  assert(comboBonus(0) === 0, '콤보 0 = 0');
  assert(comboBonus(1) === 1, '콤보 1 = round(0.5) = 1'); // Math.round(0.5)는 1
  assert(comboBonus(2) === 1, '콤보 2 = round(1.0) = 1');
  assert(comboBonus(3) === 2, '콤보 3 = round(1.5) = 2'); // Math.round(1.5)는 2
  assert(comboBonus(4) === 2, '콤보 4 = round(2.0) = 2');
  assert(comboBonus(10) === 5, '콤보 10 = round(5.0) = 5');
  assert(comboBonus(-1) === 0, '콤보 -1 (없음) = 0');
}

// ─────────────────────────────────────────────────────────────
section('고스트 Y (getGhostY)');
{
  // Phase 5: BOARD_HEIGHT가 22(VANISH 2 포함)로 확장되어 ghostY가 +2.
  // - I rotation 0: row 1에 블록 → 블록이 grid[BOARD_HEIGHT-1]에 가려면 piece.y = BOARD_HEIGHT-2 = 20
  // - O rotation 0: row 0,1에 블록 → 블록이 grid[BOARD_HEIGHT-2..BOARD_HEIGHT-1]에 가려면 piece.y = BOARD_HEIGHT-2 = 20
  const grid = createEmptyGrid();
  const iPiece = createPiece('I');
  const ghostY = getGhostY(grid, iPiece);
  const expectedI = BOARD_HEIGHT - 2;
  assert(ghostY === expectedI, `I 피스 빈 보드 ghostY = ${expectedI} (실제: ${ghostY})`);

  const oPiece = createPiece('O');
  const ghostY2 = getGhostY(grid, oPiece);
  const expectedO = BOARD_HEIGHT - 2;
  assert(ghostY2 === expectedO, `O 피스 빈 보드 ghostY = ${expectedO} (실제: ${ghostY2})`);
}

// ─────────────────────────────────────────────────────────────
section('회전 (getRotated)');
{
  const p = createPiece('T');
  assert(getRotated(p, 1) === 1, 'CW 회전: 0 -> 1');
  p.rotation = 3;
  assert(getRotated(p, 1) === 0, 'CW 회전 wrap: 3 -> 0');
  p.rotation = 0;
  assert(getRotated(p, -1) === 3, 'CCW 회전 wrap: 0 -> 3');
}

// ─────────────────────────────────────────────────────────────
section('PIECE_COLORS 색상 매핑 무결성 (Plan 스펙 명시 색상)');
{
  // plan에 명시된 색상 vs COLOR_HEX
  const expectedColors = {
    1: '#00f0f0', // I
    2: '#f0f000', // O
    3: '#a000f0', // T
    4: '#00f000', // S
    5: '#f00000', // Z
    6: '#0000f0', // J
    7: '#f0a000', // L
    8: '#444444', // Garbage
  };
  for (const [idx, hex] of Object.entries(expectedColors)) {
    assert(COLOR_HEX[idx] === hex, `COLOR_HEX[${idx}] = ${hex}`);
  }
}

// ─────────────────────────────────────────────────────────────
section('컬럼 높이 (getColumnHeights)');
{
  // Phase 5: BOARD_HEIGHT=22로 확장. "맨 아래" 인덱스는 BOARD_HEIGHT-1.
  // getColumnHeights는 visible 영역 기준이지만 BOARD_HEIGHT-1과 BOARD_HEIGHT-2는 모두 visible 영역(grid[2..21])에 속하므로 결과 동일.
  const grid = createEmptyGrid();
  grid[BOARD_HEIGHT - 1][0] = 1;
  grid[BOARD_HEIGHT - 2][0] = 1;
  grid[BOARD_HEIGHT - 1][5] = 1;
  const heights = getColumnHeights(grid);
  assert(heights[0] === 2, '컬럼 0 높이 2');
  assert(heights[5] === 1, '컬럼 5 높이 1');
  assert(heights[9] === 0, '컬럼 9 높이 0 (비어있음)');
}

// ─────────────────────────────────────────────────────────────
section('Phase 5: Vanish Zone — hidden zone 블록은 미니맵 높이에서 제외');
{
  const grid = createEmptyGrid();
  // hidden zone(grid[0], grid[1])에만 블록을 둠
  grid[0][0] = 1;
  grid[1][0] = 1;
  const heights = getColumnHeights(grid);
  assert(heights[0] === 0, 'hidden zone 블록은 컬럼 높이 0 (visible 영역 아님)');
  const stackH = getStackHeight(grid);
  assert(stackH === 0, 'hidden zone 블록만 있으면 getStackHeight = 0');

  // visible top(grid[VANISH_ZONE])에 블록이 있으면 height = VISIBLE_HEIGHT
  const grid2 = createEmptyGrid();
  grid2[VANISH_ZONE][3] = 1;
  const heights2 = getColumnHeights(grid2);
  assert(heights2[3] === VISIBLE_HEIGHT,
    `visible top(grid[${VANISH_ZONE}])에 블록 → 컬럼 높이 = VISIBLE_HEIGHT(${VISIBLE_HEIGHT}) (실제: ${heights2[3]})`);
}

// ─────────────────────────────────────────────────────────────
section('Phase 5: Vanish Zone — 상수 무결성');
{
  assert(VISIBLE_HEIGHT === 20, `VISIBLE_HEIGHT === 20 (실제: ${VISIBLE_HEIGHT})`);
  assert(VANISH_ZONE === 2, `VANISH_ZONE === 2 (실제: ${VANISH_ZONE})`);
  assert(BOARD_HEIGHT === VISIBLE_HEIGHT + VANISH_ZONE,
    `BOARD_HEIGHT === VISIBLE_HEIGHT + VANISH_ZONE (실제: ${BOARD_HEIGHT} vs ${VISIBLE_HEIGHT + VANISH_ZONE})`);
  assert(BOARD_HEIGHT === 22, `BOARD_HEIGHT === 22 (실제: ${BOARD_HEIGHT})`);
}

// ─────────────────────────────────────────────────────────────
section('isPieceLanded (Lock Delay 트리거 판정)');
{
  // Phase 5: BOARD_HEIGHT=22로 변경. T 피스(rotation 0의 마지막 채워진 row = 1)는
  // piece.y = BOARD_HEIGHT-2 일 때 마지막 블록이 grid[BOARD_HEIGHT-1] (바닥)에 닿음.
  const grid = createEmptyGrid();
  const p = createPiece('T');
  p.y = BOARD_HEIGHT - 3; // 한 칸 더 내릴 여유 있음
  assert(!isPieceLanded(grid, p), '거의 바닥이지만 한 칸 더 내릴 수 있음 → landed=false');

  // 진짜 바닥
  const p2 = createPiece('T');
  p2.y = BOARD_HEIGHT - 2; // 한 칸 더 내리면 충돌
  assert(isPieceLanded(grid, p2), 'T 피스 바닥에 닿음 → landed=true');
}

// ─────────────────────────────────────────────────────────────
console.log('\n=================================================');
console.log(` PASS: ${pass}, FAIL: ${fail}`);
console.log('=================================================');
if (fail > 0) {
  console.log('\n실패 항목:');
  for (const f of failures) {
    console.log(`  - ${f.name}${f.detail ? ' — ' + f.detail : ''}`);
  }
  process.exit(1);
}
