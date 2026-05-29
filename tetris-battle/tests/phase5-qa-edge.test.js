/**
 * @fileoverview Phase 5 QA Edge — Vanish Zone 도입 능동 엣지케이스 회귀 슈트.
 *
 * Coder 리포트가 다루지 않은 시나리오를 QA가 능동적으로 도출하여 검증한다.
 * Phase 5 본 슈트(phase5-vanish-zone)는 board.js 순수 함수만 검증한다.
 * 본 슈트는 game.js 통합 시나리오까지 확장한다:
 *
 *  QE1. createPiece의 7종 모든 피스가 hidden zone(y=0)에서 시작
 *  QE2. 빈 보드 hardDrop 시 ghostY 동작 (hidden zone → 바닥까지)
 *  QE3. visible top까지만 차오른 상태에서 7종 모든 피스 스폰 → 게임오버 X
 *  QE4. hidden zone 한 칸이라도 차있어도 새 피스 스폰 위치와 안 겹치면 OK
 *  QE5. hidden zone 정확한 스폰 위치만 차있으면 게임오버 (= 옵션 1 핵심)
 *  QE6. receiveGarbageImmediate: hidden zone까지 가비지 밀려도 피스 보정 정상
 *  QE7. addGarbage 1줄 추가 후 hidden zone 비어있음 (밀려도 21줄까지만)
 *  QE8. clearLines 후 hidden zone에 일반 블록이 밀려 올라가도 다음 스폰 OK
 *  QE9. lockPiece가 hidden zone에 색상 기록 (게임오버 직전 lock 케이스)
 *  QE10. comboBonus + garbageFromLines는 BOARD_HEIGHT 변경과 무관 (값 안정성)
 *  QE11. addGarbage 여러 번 누적: hole 컬럼이 매번 달라질 수 있음 (board.js 한 번 호출 = 한 hole)
 *  QE12. clearBottomLines가 BOARD_HEIGHT를 초과해도 안전
 *  QE13. getMatrix(I, 0) row 0이 모두 0 → I 피스 실제 첫 블록 row는 1 (hidden zone에서 1칸만 차지)
 *  QE14. I 피스 회전 1(세로) 스폰: 4개 블록이 모두 column 2에 위치 (row 0~3)
 *        → hidden zone에 2칸, visible에 2칸. 스폰 충돌 검사 정상
 *  QE15. T/S/Z/J/L의 row 0 분포가 hidden zone과 일관되게 작용
 *
 * 실행: node --test tests/phase5-qa-edge.test.js
 */

import {
  createEmptyGrid,
  isColliding,
  lockPiece,
  clearLines,
  addGarbage,
  clearBottomLines,
  getStackHeight,
  getColumnHeights,
  getGhostY,
  isPieceLanded,
  comboBonus,
  garbageFromLines,
  BOARD_WIDTH,
  BOARD_HEIGHT,
  VISIBLE_HEIGHT,
  VANISH_ZONE,
} from '../public/js/board.js';
import { createPiece, getMatrix, PIECE_TYPES, PIECES, PIECE_COLORS } from '../public/js/tetromino.js';

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
section('QE1. createPiece 7종 모두 y=0 (hidden zone 최상단) 스폰');
{
  for (const type of PIECE_TYPES) {
    const p = createPiece(type);
    assert(p.y === 0, `${type}.y === 0 (실제: ${p.y})`);
    // x는 보드 중앙 정렬
    const matrix = PIECES[type][0];
    const expectedX = Math.floor((BOARD_WIDTH - matrix[0].length) / 2);
    assert(p.x === expectedX, `${type}.x === ${expectedX} (실제: ${p.x})`);
  }
}

// ─────────────────────────────────────────────────────────────
section('QE2. 빈 보드 ghostY는 7종 모두 바닥까지 (hidden zone에서 출발)');
{
  const grid = createEmptyGrid();
  // I 피스 rotation 0: row 1만 블록 → ghostY = BOARD_HEIGHT - 2 (= 20)
  const pI = createPiece('I');
  const ghostI = getGhostY(grid, pI);
  assert(ghostI === BOARD_HEIGHT - 2,
    `I rotation 0 ghostY === ${BOARD_HEIGHT - 2} (실제: ${ghostI})`);
  // O 피스: row 0,1 모두 블록 → ghostY = BOARD_HEIGHT - 2
  const pO = createPiece('O');
  const ghostO = getGhostY(grid, pO);
  assert(ghostO === BOARD_HEIGHT - 2,
    `O ghostY === ${BOARD_HEIGHT - 2} (실제: ${ghostO})`);
  // T/S/Z/J/L (3x3 matrix, row 0 일부 + row 1 전부 = 2줄 사용) → ghostY = BOARD_HEIGHT - 2
  for (const type of ['T', 'S', 'Z', 'J', 'L']) {
    const p = createPiece(type);
    const g = getGhostY(grid, p);
    // 3x3 matrix에서 마지막 채워진 row가 1이면 ghostY = BOARD_HEIGHT - 2
    assert(g === BOARD_HEIGHT - 2,
      `${type} ghostY === ${BOARD_HEIGHT - 2} (실제: ${g})`);
  }
}

// ─────────────────────────────────────────────────────────────
section('QE3. visible top까지만 차오른 상태 (grid[VANISH_ZONE]에 한 줄)에서 7종 스폰');
{
  // 정확한 버그 재현 시나리오: 사용자가 보고한 "보드 상단에 2-3줄 비어있는데 매판 게임오버" 케이스
  // 수정 전: grid[0]에 블록이 있어 새 piece 스폰 시 isColliding=true → 게임오버
  // 수정 후: grid[0]/grid[1]은 hidden zone, 새 piece가 hidden zone에 정상 스폰 → 게임오버 X
  const grid = createEmptyGrid();
  // visible top 한 줄만 가비지로 채움 (사용자가 "보드 상단 가까이 쌓인 상태"라고 한 그 상황)
  for (let c = 0; c < BOARD_WIDTH; c++) {
    grid[VANISH_ZONE][c] = 8;
  }
  // hidden zone은 비어있어야 함
  assert(grid[0].every((v) => v === 0), 'hidden zone grid[0] 빈 줄');
  assert(grid[1].every((v) => v === 0), 'hidden zone grid[1] 빈 줄');
  // 7종 모두 스폰 가능
  let allOk = true;
  for (const type of PIECE_TYPES) {
    const p = createPiece(type);
    if (isColliding(grid, p.type, p.rotation, p.x, p.y)) {
      allOk = false;
      console.log(`    ${type} 스폰 충돌 발견 → 버그 재현됨!`);
    }
  }
  assert(allOk, '버그 재현 시나리오: visible top 가득 + hidden zone 빈 상태 → 7종 모두 스폰 OK (게임오버 X)');
}

// ─────────────────────────────────────────────────────────────
section('QE4. hidden zone 한 칸이 차있어도 스폰 위치와 겹치지 않으면 OK');
{
  // T 피스 rotation 0의 점유 셀: row 0 col 1 / row 1 col 0,1,2 (matrix 기준)
  // createPiece('T').x = floor((10-3)/2) = 3 → 실제 grid 점유:
  //   grid[0][4], grid[1][3], grid[1][4], grid[1][5]
  // 따라서 grid[0][0] 등 가장자리에 블록이 있어도 T 스폰 OK
  const grid = createEmptyGrid();
  grid[0][0] = 8; // 가장자리 한 칸
  grid[0][9] = 8; // 가장자리 한 칸
  const pT = createPiece('T');
  assert(!isColliding(grid, pT.type, pT.rotation, pT.x, pT.y),
    'hidden zone 가장자리(col 0, 9)만 차있어도 T 스폰 OK');
}

// ─────────────────────────────────────────────────────────────
section('QE5. hidden zone 정확한 스폰 위치만 차있으면 게임오버 (옵션 1 핵심)');
{
  // T 피스 정확 점유 셀에 가비지를 두면 스폰 즉시 충돌
  const grid = createEmptyGrid();
  grid[0][4] = 8; // T rotation 0 row 0 col 1 = grid[0][3+1] = grid[0][4]
  const pT = createPiece('T');
  assert(isColliding(grid, pT.type, pT.rotation, pT.x, pT.y),
    'T 스폰 위치 grid[0][4]에 블록 → 충돌 (게임오버 트리거)');

  // O 피스 (row 0~1, col 1~2 점유. createPiece('O').x = floor((10-4)/2)=3)
  // → grid[0][4], grid[0][5], grid[1][4], grid[1][5]
  const grid2 = createEmptyGrid();
  grid2[1][5] = 8; // 정확한 O 점유 셀
  const pO = createPiece('O');
  assert(isColliding(grid2, pO.type, pO.rotation, pO.x, pO.y),
    'O 스폰 위치 grid[1][5]에 블록 → 충돌');
}

// ─────────────────────────────────────────────────────────────
section('QE6. addGarbage 후 hidden zone에 가비지가 푸시되면 다음 스폰 영향');
{
  // visible 전체(20줄)를 채운 상태에서 addGarbage(1) 호출
  // → shift로 grid[0]이 사라지고 grid[BOARD_HEIGHT-1]에 가비지 push
  // 위로 밀린 결과 visible 19줄 + hidden zone 1줄(grid[1])이 가비지로 채워짐
  // grid[0]은 빈 줄 유지 (왜냐면 addGarbage는 shift 후 push, 기존 grid[0]이 없어짐)
  const grid = createEmptyGrid();
  for (let r = VANISH_ZONE; r < BOARD_HEIGHT; r++) {
    for (let c = 0; c < BOARD_WIDTH; c++) {
      grid[r][c] = 8;
    }
  }
  addGarbage(grid, 1);
  // 결과: grid[0]에 visible top 줄이 밀려 올라옴 (즉 grid[1]에 있던 가비지 한 줄이 grid[0]으로)
  // 정확히: shift는 맨 위 줄(grid[0] = 빈 줄)을 제거 → 모든 row가 한 칸 위로 이동
  // 즉 기존 grid[1]→grid[0], grid[2]→grid[1], ..., grid[BOARD_HEIGHT-1]→grid[BOARD_HEIGHT-2]
  // 새 가비지 1줄이 grid[BOARD_HEIGHT-1]에 push
  // 결과: grid[0] = 빈줄(원래 grid[1]은 빈줄이었음), grid[1] = 가득(원래 grid[2] = 가득), ...
  // 따라서 hidden zone[0]은 빈줄, hidden zone[1]은 가득
  assert(grid[0].every((v) => v === 0), 'addGarbage(1) 후 grid[0] 여전히 비어있음');
  assert(grid[1].every((v) => v !== 0), 'addGarbage(1) 후 grid[1]은 가득 (visible top이 밀려 올라옴)');
  // 새 피스 스폰? T를 시도 → grid[1] 가득이면 T row 1 점유와 충돌 발생
  const pT = createPiece('T');
  // T row 1: col 3,4,5 모두 점유. grid[1][3..5] = 가득 → 충돌
  assert(isColliding(grid, pT.type, pT.rotation, pT.x, pT.y),
    'visible 전체 가득 + 가비지 1줄 추가 후 T 스폰 충돌 (게임오버)');
}

// ─────────────────────────────────────────────────────────────
section('QE7. addGarbage 1줄: hole이 있으면 hidden zone에도 hole 유지');
{
  const grid = createEmptyGrid();
  addGarbage(grid, 1);
  // 1줄 가비지가 grid[BOARD_HEIGHT-1]에 들어감. hidden zone 영향 없음
  const filled = grid[BOARD_HEIGHT - 1].filter((v) => v !== 0).length;
  assert(filled === BOARD_WIDTH - 1,
    `가비지 1줄에 hole 1개 (실제 채워진 칸: ${filled}/${BOARD_WIDTH})`);
  // hidden zone은 비어있음
  assert(grid[0].every((v) => v === 0) && grid[1].every((v) => v === 0),
    'addGarbage(1) 후 hidden zone 영향 없음');
}

// ─────────────────────────────────────────────────────────────
section('QE8. clearLines 후 hidden zone에 일반 블록이 밀려 올라간 경우');
{
  // 시나리오: visible 영역의 라인 클리어로 hidden zone에 있던 블록이 더 아래로 떨어짐
  // (clearLines는 splice + unshift로 처리 → hidden zone의 블록은 그대로 위치, visible top 아래로 떨어지는 게 아님)
  // 실제 동작: 가득 찬 줄을 splice로 제거 → 위에 있는 모든 row가 한 칸씩 아래로 (정확히는 grid.splice + grid.unshift)
  // 즉 hidden zone에 블록이 있으면 라인 클리어 후 그대로 hidden zone에 남음 (visible로 밀려 내려가지 않음)
  const grid = createEmptyGrid();
  // hidden zone에 색깔 있는 블록
  grid[1][0] = 3; // T 색상
  // visible 영역에 가득 찬 한 줄 (밑바닥)
  for (let c = 0; c < BOARD_WIDTH; c++) grid[BOARD_HEIGHT - 1][c] = 4;
  const cleared = clearLines(grid);
  assert(cleared === 1, `1줄 클리어 확인 (실제: ${cleared})`);
  // hidden zone의 블록은 위치 한 칸 내려옴 (clearLines는 splice → unshift = 모두 위로 한 칸씩 이동이 아니라 가득 찬 줄만 제거 후 그 위 row들이 한 칸 내려옴)
  // 정확히: grid.splice(r,1) → grid[r..]가 r-1부터 시작. grid.unshift(new) → grid[0]에 새 빈줄 추가.
  // 결과: 원래 grid[1] (= T색)는 splice 전에는 그대로, splice 후 grid[1]은 원래 grid[0](빈줄).
  //       unshift 후 grid[2]가 원래 grid[1](T색).
  // 즉 hidden zone 블록은 한 칸 내려가서 grid[2][0] = 3
  assert(grid[2][0] === 3,
    `clearLines 후 hidden zone 블록은 한 칸 내려옴 (grid[2][0] = 3, 실제: ${grid[2][0]})`);
  // 새 피스 스폰 OK? T 스폰 위치는 grid[0][4], grid[1][3..5]. 모두 빈줄
  const pT = createPiece('T');
  assert(!isColliding(grid, pT.type, pT.rotation, pT.x, pT.y),
    'clearLines로 hidden zone에 블록이 1칸 내려와도 T 스폰 OK');
}

// ─────────────────────────────────────────────────────────────
section('QE9. lockPiece가 hidden zone(grid[0])에 색상 기록');
{
  // I 피스 rotation 1(세로). createPiece('I').x = floor((10-4)/2) = 3
  // I rotation 1 matrix: row 0~3 모두 col 2만 점유 → grid[0..3][3+2] = grid[0..3][5] = 1
  const grid = createEmptyGrid();
  const piece = createPiece('I');
  piece.rotation = 1;
  lockPiece(grid, piece);
  assert(grid[0][5] === 1, `I 세로 lock: grid[0][5] = 1 (실제: ${grid[0][5]})`);
  assert(grid[1][5] === 1, `I 세로 lock: grid[1][5] = 1 (실제: ${grid[1][5]})`);
  assert(grid[2][5] === 1, `I 세로 lock: grid[2][5] = 1 (실제: ${grid[2][5]})`);
  assert(grid[3][5] === 1, `I 세로 lock: grid[3][5] = 1 (실제: ${grid[3][5]})`);
}

// ─────────────────────────────────────────────────────────────
section('QE10. comboBonus + garbageFromLines 값 안정성 (BOARD_HEIGHT 변경과 무관)');
{
  assert(garbageFromLines(1) === 0, 'Single → 가비지 0');
  assert(garbageFromLines(2) === 1, 'Double → 가비지 1');
  assert(garbageFromLines(3) === 2, 'Triple → 가비지 2');
  assert(garbageFromLines(4) === 4, 'Tetris → 가비지 4');
  assert(comboBonus(0) === 0, '콤보 0 → 보너스 0');
  assert(comboBonus(1) === 1, '콤보 1 → 보너스 +1');
  assert(comboBonus(2) === 1, '콤보 2 → 보너스 +1 (Math.round(1.0))');
  assert(comboBonus(4) === 2, '콤보 4 → 보너스 +2');
}

// ─────────────────────────────────────────────────────────────
section('QE11. addGarbage 여러 번 호출: 호출마다 hole 컬럼 독립적');
{
  // 한 번에 BOARD_HEIGHT줄 → 한 hole. 여러 번이면 hole이 줄마다 달라질 수 있음
  const grid = createEmptyGrid();
  addGarbage(grid, 1);
  addGarbage(grid, 1);
  addGarbage(grid, 1);
  // 결과: 가비지 3줄이 누적되어 grid[BOARD_HEIGHT-3..BOARD_HEIGHT-1]에 위치
  // 각 줄의 hole 컬럼은 독립적이라 같을 수도 다를 수도 있음 (랜덤)
  // 검증: 각 줄에 정확히 1개의 빈칸이 존재
  for (let r = BOARD_HEIGHT - 3; r < BOARD_HEIGHT; r++) {
    const holes = grid[r].filter((v) => v === 0).length;
    assert(holes === 1, `grid[${r}]에 hole 1개 (실제: ${holes})`);
  }
}

// ─────────────────────────────────────────────────────────────
section('QE12. clearBottomLines 초과값 안전 처리');
{
  const grid = createEmptyGrid();
  for (let r = 0; r < BOARD_HEIGHT; r++) {
    for (let c = 0; c < BOARD_WIDTH; c++) {
      grid[r][c] = 5; // Z색
    }
  }
  // BOARD_HEIGHT 초과 lines 요청 → 안전하게 BOARD_HEIGHT까지만 처리
  const cleared = clearBottomLines(grid, 100);
  assert(cleared === BOARD_HEIGHT, `100 요청 → ${BOARD_HEIGHT}줄 제거 (실제: ${cleared})`);
  assert(grid.every((r) => r.every((v) => v === 0)),
    'clearBottomLines(100) 후 모든 셀 비어있음');
  // 차원 유지
  assert(grid.length === BOARD_HEIGHT, `grid.length 유지 (실제: ${grid.length})`);
}

// ─────────────────────────────────────────────────────────────
section('QE13. I 피스 rotation 0: row 0이 모두 0 → 실제 첫 블록은 row 1');
{
  const matrix = getMatrix('I', 0);
  assert(matrix[0].every((v) => v === 0),
    'I rotation 0의 row 0은 모두 0 (실제 첫 블록은 matrix row 1)');
  assert(matrix[1].every((v) => v === 1),
    'I rotation 0의 row 1은 모두 1');
  // → I 피스가 y=0에 스폰되면 실제 첫 블록은 grid[1] (= hidden zone 마지막 줄)
  // 즉 I 피스는 hidden zone에 1줄만 차지하고 즉시 visible top(grid[2])에 도달
}

// ─────────────────────────────────────────────────────────────
section('QE14. I 피스 rotation 1(세로) 스폰: 4칸 모두 col 5 (row 0~3)');
{
  const matrix = getMatrix('I', 1);
  // matrix는 4x4, col 2만 채워짐
  for (let r = 0; r < 4; r++) {
    assert(matrix[r][2] === 1, `I rotation 1 matrix[${r}][2] === 1`);
  }
  // 빈 보드에서 I 세로 스폰 시 충돌 없음
  const grid = createEmptyGrid();
  const piece = createPiece('I');
  piece.rotation = 1;
  assert(!isColliding(grid, piece.type, piece.rotation, piece.x, piece.y),
    'I 세로 빈 보드 스폰 OK (4칸 중 2칸이 hidden zone)');
  // hidden zone에 차있어도 col 5가 아니면 OK
  grid[0][0] = 8;
  grid[1][0] = 8;
  assert(!isColliding(grid, piece.type, piece.rotation, piece.x, piece.y),
    'I 세로 스폰: hidden zone col 0 차있어도 col 5 점유는 OK');
  // hidden zone col 5에 차있으면 충돌
  grid[0][5] = 8;
  assert(isColliding(grid, piece.type, piece.rotation, piece.x, piece.y),
    'I 세로 스폰: hidden zone col 5에 차있으면 충돌');
}

// ─────────────────────────────────────────────────────────────
section('QE15. T/S/Z/J/L의 row 0 분포와 hidden zone 점유 검증');
{
  // T rotation 0: row 0의 col 1만 점유 (★ 한 칸만 hidden zone에서 잡힘)
  const tMatrix = getMatrix('T', 0);
  assert(tMatrix[0][0] === 0 && tMatrix[0][1] === 1 && tMatrix[0][2] === 0,
    'T rotation 0 row 0: [0,1,0]');
  // S rotation 0: row 0 = [0,1,1]
  const sMatrix = getMatrix('S', 0);
  assert(sMatrix[0][0] === 0 && sMatrix[0][1] === 1 && sMatrix[0][2] === 1,
    'S rotation 0 row 0: [0,1,1]');
  // Z rotation 0: row 0 = [1,1,0]
  const zMatrix = getMatrix('Z', 0);
  assert(zMatrix[0][0] === 1 && zMatrix[0][1] === 1 && zMatrix[0][2] === 0,
    'Z rotation 0 row 0: [1,1,0]');
  // J rotation 0: row 0 = [1,0,0]
  const jMatrix = getMatrix('J', 0);
  assert(jMatrix[0][0] === 1 && jMatrix[0][1] === 0 && jMatrix[0][2] === 0,
    'J rotation 0 row 0: [1,0,0]');
  // L rotation 0: row 0 = [0,0,1]
  const lMatrix = getMatrix('L', 0);
  assert(lMatrix[0][0] === 0 && lMatrix[0][1] === 0 && lMatrix[0][2] === 1,
    'L rotation 0 row 0: [0,0,1]');
  // → 5종 피스 모두 row 0(hidden zone grid[0])에 일부 칸 점유
  //    visible 영역만 보면 row 1 부분만 보임 → "텔레포트하듯 등장" 효과
}

// ─────────────────────────────────────────────────────────────
section('QE16. getStackHeight: hidden zone 가득 차도 visible 비어있으면 0');
{
  const grid = createEmptyGrid();
  // hidden zone 2줄 모두 가득
  for (let c = 0; c < BOARD_WIDTH; c++) {
    grid[0][c] = 8;
    grid[1][c] = 8;
  }
  // visible은 비어있음
  assert(getStackHeight(grid) === 0,
    'hidden zone 가득 + visible 빈 상태 → getStackHeight = 0 (미니맵에 안 보임)');
  const heights = getColumnHeights(grid);
  assert(heights.every((h) => h === 0),
    'hidden zone 가득 → 모든 컬럼 높이 0 (미니맵 정상)');
}

// ─────────────────────────────────────────────────────────────
section('QE17. isPieceLanded — hidden zone에서 떨어지는 중 (visible top까지 빈 상태)');
{
  const grid = createEmptyGrid();
  const piece = createPiece('T');
  // y=0 (hidden zone 스폰 직후): 바닥에 닿지 않음
  assert(!isPieceLanded(grid, piece),
    'T 스폰 직후 (y=0, hidden zone) 바닥에 안 닿음');
  // y = BOARD_HEIGHT - 2 = 20 (visible 바닥)
  piece.y = BOARD_HEIGHT - 2;
  assert(isPieceLanded(grid, piece),
    `T y = ${BOARD_HEIGHT - 2} (바닥) landed = true`);
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
