/**
 * @fileoverview Phase 5 — Vanish Zone 도입 회귀 슈트.
 *
 * 배경: 보드 상단에 2~3줄 비어있는데도 매판 게임오버되는 버그를 수정하기 위해
 * 표준 SRS 스타일의 hidden zone(grid[0..VANISH_ZONE-1])을 도입했다.
 * - BOARD_HEIGHT = VISIBLE_HEIGHT(20) + VANISH_ZONE(2) = 22
 * - 피스는 hidden zone에서 스폰 → 사용자 눈에 "안 보이는 상태"로 시작
 * - 게임오버는 hidden zone까지 충돌이 발생할 때만 트리거
 *
 * 검증 시나리오:
 *  V1. 상수 무결성 (VISIBLE_HEIGHT/VANISH_ZONE/BOARD_HEIGHT 관계)
 *  V2. createEmptyGrid가 BOARD_HEIGHT(=22)줄을 생성
 *  V3. 7종 모든 피스가 빈 보드 스폰 시 충돌 없음
 *  V4. visible 영역만 가득 차도(hidden zone은 비어있음) 새 피스 스폰 가능
 *      → 즉 visible top까지 가비지가 차도 즉시 게임오버 되지 않음
 *  V5. hidden zone까지 가득 차면 다음 스폰에서 충돌(게임오버 조건)
 *  V6. getStackHeight / getColumnHeights는 visible 영역 기준으로만 계산
 *  V7. addGarbage가 위로 밀어내도 hidden zone에 여유가 있으면 게임오버 신호만 (즉 충돌 없이 스폰 가능)
 *  V8. lockPiece가 hidden zone에 블록을 남길 수 있다
 *  V9. clearLines는 BOARD_HEIGHT 기준으로 동작 (hidden/visible 구분 없이 가득 찬 줄 제거)
 *
 * 실행: node tests/phase5-vanish-zone.test.js
 */

import {
  createEmptyGrid,
  isColliding,
  lockPiece,
  clearLines,
  addGarbage,
  getStackHeight,
  getColumnHeights,
  BOARD_WIDTH,
  BOARD_HEIGHT,
  VISIBLE_HEIGHT,
  VANISH_ZONE,
} from '../public/js/board.js';
import { createPiece, PIECE_TYPES, PIECES, PIECE_COLORS } from '../public/js/tetromino.js';

let pass = 0;
let fail = 0;
const failures = [];

/**
 * 단일 assert 헬퍼.
 * @param {boolean} cond
 * @param {string} name
 * @param {string} [detail]
 */
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

/**
 * 섹션 헤더 출력.
 * @param {string} title
 */
function section(title) {
  console.log(`\n── ${title} ─────────────────`);
}

// ─────────────────────────────────────────────────────────────
section('V1. 상수 무결성');
{
  assert(VISIBLE_HEIGHT === 20, `VISIBLE_HEIGHT === 20 (실제: ${VISIBLE_HEIGHT})`);
  assert(VANISH_ZONE === 2, `VANISH_ZONE === 2 (실제: ${VANISH_ZONE})`);
  assert(BOARD_HEIGHT === 22, `BOARD_HEIGHT === 22 (실제: ${BOARD_HEIGHT})`);
  assert(BOARD_HEIGHT === VISIBLE_HEIGHT + VANISH_ZONE,
    `BOARD_HEIGHT === VISIBLE_HEIGHT + VANISH_ZONE (실제: ${BOARD_HEIGHT} vs ${VISIBLE_HEIGHT + VANISH_ZONE})`);
  assert(BOARD_WIDTH === 10, `BOARD_WIDTH === 10 (실제: ${BOARD_WIDTH})`);
}

// ─────────────────────────────────────────────────────────────
section('V2. createEmptyGrid 차원 검증');
{
  const grid = createEmptyGrid();
  assert(grid.length === BOARD_HEIGHT, `grid.length === ${BOARD_HEIGHT} (실제: ${grid.length})`);
  assert(grid.every((r) => r.length === BOARD_WIDTH),
    `모든 row의 length === ${BOARD_WIDTH}`);
  assert(grid.every((r) => r.every((v) => v === 0)),
    '모든 셀이 0 (빈 보드)');
}

// ─────────────────────────────────────────────────────────────
section('V3. 7종 피스 모두 빈 보드 스폰 시 충돌 없음');
{
  const grid = createEmptyGrid();
  for (const type of PIECE_TYPES) {
    const p = createPiece(type);
    assert(!isColliding(grid, p.type, p.rotation, p.x, p.y),
      `${type} 빈 보드 스폰 OK (x=${p.x}, y=${p.y})`);
  }
}

// ─────────────────────────────────────────────────────────────
section('V4. visible 영역(grid[VANISH_ZONE..BOARD_HEIGHT-1])이 가득 차도 hidden zone 비어있으면 스폰 가능');
{
  // 시나리오: visible top(grid[VANISH_ZONE])부터 바닥(grid[BOARD_HEIGHT-1])까지 hole 없는 가비지로 가득.
  // hidden zone(grid[0], grid[1])은 비어있음.
  // 이때 새 피스가 스폰되면? hidden zone에 스폰 위치가 잡히므로 충돌 없이 정상 스폰.
  const grid = createEmptyGrid();
  for (let r = VANISH_ZONE; r < BOARD_HEIGHT; r++) {
    for (let c = 0; c < BOARD_WIDTH; c++) {
      grid[r][c] = 8; // 가비지로 채움
    }
  }
  // hidden zone은 비어있어야 함 (검증)
  assert(grid[0].every((v) => v === 0), 'hidden zone grid[0] 빈 줄 확인');
  assert(grid[1].every((v) => v === 0), 'hidden zone grid[1] 빈 줄 확인');
  // 7종 피스 스폰 시도 — 전부 hidden zone에서 충돌 없음
  for (const type of PIECE_TYPES) {
    const p = createPiece(type);
    const collide = isColliding(grid, p.type, p.rotation, p.x, p.y);
    assert(!collide,
      `${type}: visible 가득 + hidden zone 비어있음 → 스폰 가능 (게임오버 X)`);
  }
}

// ─────────────────────────────────────────────────────────────
section('V5. hidden zone까지 가득 차면 다음 스폰에서 충돌(게임오버)');
{
  // 시나리오: 보드 전체(grid[0..BOARD_HEIGHT-1])가 가비지로 가득 (hole 없음).
  // 새 피스 스폰 시 어디든 블록과 겹치므로 충돌 발생 → 게임오버 트리거.
  const grid = createEmptyGrid();
  for (let r = 0; r < BOARD_HEIGHT; r++) {
    for (let c = 0; c < BOARD_WIDTH; c++) {
      grid[r][c] = 8;
    }
  }
  for (const type of PIECE_TYPES) {
    const p = createPiece(type);
    const collide = isColliding(grid, p.type, p.rotation, p.x, p.y);
    assert(collide,
      `${type}: 보드 전체 가득 → 스폰 시 충돌 (게임오버 정상 트리거)`);
  }
}

// ─────────────────────────────────────────────────────────────
section('V6. getStackHeight / getColumnHeights는 visible 영역 기준');
{
  // hidden zone에만 블록 → 미니맵 높이 0
  const grid = createEmptyGrid();
  grid[0][0] = 1;
  grid[0][9] = 1;
  grid[1][5] = 1;
  assert(getStackHeight(grid) === 0,
    'hidden zone에만 블록 → getStackHeight = 0 (미니맵에 안 보임)');
  const heights = getColumnHeights(grid);
  assert(heights.every((h) => h === 0),
    'hidden zone에만 블록 → 모든 컬럼 높이 0');

  // visible top에 블록 → 높이 VISIBLE_HEIGHT
  const grid2 = createEmptyGrid();
  grid2[VANISH_ZONE][0] = 1;
  assert(getStackHeight(grid2) === VISIBLE_HEIGHT,
    `visible top(grid[${VANISH_ZONE}])에 블록 → getStackHeight = ${VISIBLE_HEIGHT} (실제: ${getStackHeight(grid2)})`);
  assert(getColumnHeights(grid2)[0] === VISIBLE_HEIGHT,
    `컬럼 0 높이 = ${VISIBLE_HEIGHT}`);

  // visible 가장 아래에 한 줄 → 높이 1
  const grid3 = createEmptyGrid();
  grid3[BOARD_HEIGHT - 1][3] = 1;
  assert(getStackHeight(grid3) === 1,
    `바닥에만 블록 → getStackHeight = 1 (실제: ${getStackHeight(grid3)})`);
  assert(getColumnHeights(grid3)[3] === 1,
    `컬럼 3 높이 = 1 (실제: ${getColumnHeights(grid3)[3]})`);
}

// ─────────────────────────────────────────────────────────────
section('V7. addGarbage가 위로 밀어내도 hidden zone에 여유 있으면 스폰 가능');
{
  // visible 19줄을 채운 후 가비지 1줄 추가 → 가장 위 한 줄이 hidden zone으로 밀려남.
  // hidden zone에 가비지가 들어와도 hole이 있으므로 일부 컬럼은 비어있음.
  // 새 피스가 hole 컬럼에 정확히 스폰되면 충돌 없을 수 있고, 아니면 충돌(게임오버).
  // 여기서는 더 안전한 시나리오로 확인:
  // - visible 영역에만 가비지 5줄 추가 → hidden zone은 계속 비어있음 → 스폰 항상 가능.
  const grid = createEmptyGrid();
  const topout = addGarbage(grid, 5);
  assert(!topout, '가비지 5줄 추가 (보드 여유 충분) → topout 신호 false');
  // 모든 피스 스폰 가능
  for (const type of PIECE_TYPES) {
    const p = createPiece(type);
    const collide = isColliding(grid, p.type, p.rotation, p.x, p.y);
    assert(!collide, `${type}: 가비지 5줄 추가 후에도 스폰 가능`);
  }

  // 시나리오: 가비지를 BOARD_HEIGHT만큼 추가 (전체 보드를 가비지로 push)
  // → 모든 가비지 줄은 같은 hole 컬럼이 비어있음. hidden zone에도 가비지가 채워지지만 hole은 그대로 빈칸.
  const grid2 = createEmptyGrid();
  // addGarbage는 한 번에 호출하면 같은 hole. 여러 번 부르면 hole이 매번 달라질 수 있다.
  // 한 번에 BOARD_HEIGHT줄 추가 → hidden zone까지 같은 hole 컬럼이 통하므로 그 컬럼에 새 피스가 떨어질 수 있음.
  addGarbage(grid2, BOARD_HEIGHT);
  // 보드의 모든 줄에 정확히 하나의 hole이 있어야 함
  const holeCol = grid2[0].indexOf(0);
  assert(holeCol >= 0 && holeCol < BOARD_WIDTH,
    `hidden zone 맨 위 줄에도 hole 존재 (col=${holeCol})`);
  // 모든 줄의 hole이 동일 컬럼
  const allSameHole = grid2.every((r) => r[holeCol] === 0 && r.filter((v) => v === 0).length === 1);
  assert(allSameHole, '모든 줄(hidden zone 포함)의 hole이 동일 컬럼');
}

// ─────────────────────────────────────────────────────────────
section('V8. lockPiece는 hidden zone에도 블록을 남길 수 있다');
{
  const grid = createEmptyGrid();
  // T 피스 (matrix row 0,1에 블록)를 piece.y=0에 그대로 lock
  const piece = createPiece('T');
  lockPiece(grid, piece);
  const colorIdx = PIECE_COLORS.T;
  // T rotation 0: [0,1,0],[1,1,1],[0,0,0]. piece.x는 createPiece가 계산
  const px = piece.x;
  // grid[0][px+1] = colorIdx, grid[1][px..px+2] = colorIdx
  assert(grid[0][px + 1] === colorIdx,
    `lockPiece가 hidden zone grid[0][${px + 1}]에 T 색상 기록 (실제: ${grid[0][px + 1]})`);
  assert(grid[1][px] === colorIdx && grid[1][px + 1] === colorIdx && grid[1][px + 2] === colorIdx,
    `lockPiece가 hidden zone grid[1][${px}..${px + 2}]에 T 색상 기록`);
}

// ─────────────────────────────────────────────────────────────
section('V9. clearLines는 BOARD_HEIGHT 기준 — 가득 찬 줄(어디서든) 제거');
{
  // hidden zone의 한 줄을 가득 채움 → clearLines가 그 줄을 제거하는지
  const grid = createEmptyGrid();
  for (let c = 0; c < BOARD_WIDTH; c++) grid[1][c] = 1;
  const cleared = clearLines(grid);
  assert(cleared === 1, `hidden zone 가득 찬 줄도 제거 (실제: ${cleared})`);
  // 제거 후 모든 줄이 비어있음
  assert(grid.every((r) => r.every((v) => v === 0)),
    'clearLines 후 모든 줄 비어있음');

  // visible + hidden zone에 걸친 2줄 동시 클리어
  const grid2 = createEmptyGrid();
  for (let c = 0; c < BOARD_WIDTH; c++) {
    grid2[1][c] = 1;                  // hidden zone
    grid2[VANISH_ZONE][c] = 1;        // visible top
  }
  const cleared2 = clearLines(grid2);
  assert(cleared2 === 2, `hidden + visible 2줄 동시 클리어 (실제: ${cleared2})`);
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
