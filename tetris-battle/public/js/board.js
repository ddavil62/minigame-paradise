/**
 * @fileoverview 게임 보드 (10x22) 상태 관리, 충돌 검사, 라인 제거, 가비지 라인 추가.
 *
 * grid[row][col] 형태의 2D 배열로 보드를 표현한다.
 * - 0: 빈칸
 * - 1~7: 피스 색상 인덱스 (tetromino.js PIECE_COLORS 참조)
 * - 8: 가비지 라인 블록
 *
 * Phase 5 — Vanish Zone 도입
 * - BOARD_HEIGHT (= 데이터 영역) = VISIBLE_HEIGHT + VANISH_ZONE = 20 + 2 = 22
 * - 보드 상단 2줄(grid[0], grid[1])은 화면에 그려지지 않는 hidden zone이다.
 *   피스는 hidden zone에서 스폰하여 사용자 눈에는 "보이지 않는 상태"로 시작한다.
 * - 게임오버는 hidden zone까지 가득 차서 새 피스가 hidden zone에 겹치게 스폰될 때 발생.
 *   (visible top까지만 차있다면 새 피스는 hidden zone에 정상 스폰되어 플레이 가능)
 * - 시각 렌더링은 grid[VANISH_ZONE..BOARD_HEIGHT-1]만 표시한다 (ui.js 참조).
 */

import { getMatrix, PIECE_COLORS } from './tetromino.js';

// ── 보드 상수 ────────────────────────────────────────────────────
export const BOARD_WIDTH = 10;
/** 화면에 표시되는 영역의 줄 수 (=한게임 테트리스 시각 영역). */
export const VISIBLE_HEIGHT = 20;
/** 상단 hidden zone 줄 수 (Phase 5 — 스폰 버퍼 + 게임오버 완화). */
export const VANISH_ZONE = 2;
/** 실제 데이터 grid의 줄 수. 모든 보드 알고리즘은 이 값을 사용한다. */
export const BOARD_HEIGHT = VISIBLE_HEIGHT + VANISH_ZONE;

// ── Phase 2 아이템 상수 ─────────────────────────────────────────
/** 가비지 폭탄 아이템이 상대에게 즉시 추가하는 줄 수. */
export const GARBAGE_BOMB_LINES = 2;
/** 라인 클리어(방어 아이템)가 자신의 보드에서 제거하는 하단 줄 수. */
export const LINE_CLEAR_LINES = 2;

/**
 * 빈 보드를 생성한다.
 * @returns {number[][]} grid[20][10] (모두 0)
 */
export function createEmptyGrid() {
  return Array.from({ length: BOARD_HEIGHT }, () => Array(BOARD_WIDTH).fill(0));
}

/**
 * 피스가 주어진 위치/회전에서 보드와 충돌하는지 검사한다.
 *
 * @param {number[][]} grid - 보드 상태
 * @param {string} type     - 피스 타입
 * @param {number} rotation - 회전 상태 0~3
 * @param {number} x        - 좌측 상단 x (열)
 * @param {number} y        - 좌측 상단 y (행)
 * @returns {boolean} true면 충돌 (경계 밖 or 기존 블록과 겹침)
 */
export function isColliding(grid, type, rotation, x, y) {
  const matrix = getMatrix(type, rotation);
  for (let r = 0; r < matrix.length; r++) {
    for (let c = 0; c < matrix[r].length; c++) {
      if (matrix[r][c] === 0) continue;
      const gx = x + c;
      const gy = y + r;
      // 좌우/하단 경계 검사
      if (gx < 0 || gx >= BOARD_WIDTH || gy >= BOARD_HEIGHT) return true;
      // 상단 경계는 음수 허용 (스폰 직후 일부가 보드 밖일 수 있음)
      if (gy < 0) continue;
      // 기존 블록과 겹침
      if (grid[gy][gx] !== 0) return true;
    }
  }
  return false;
}

/**
 * 피스를 보드에 영구적으로 고정한다 (Lock).
 * @param {number[][]} grid
 * @param {object} piece - { type, rotation, x, y }
 * @returns {void}
 */
export function lockPiece(grid, piece) {
  const matrix = getMatrix(piece.type, piece.rotation);
  const colorIdx = PIECE_COLORS[piece.type];
  for (let r = 0; r < matrix.length; r++) {
    for (let c = 0; c < matrix[r].length; c++) {
      if (matrix[r][c] === 0) continue;
      const gy = piece.y + r;
      const gx = piece.x + c;
      if (gy >= 0 && gy < BOARD_HEIGHT && gx >= 0 && gx < BOARD_WIDTH) {
        grid[gy][gx] = colorIdx;
      }
    }
  }
}

/**
 * 꽉 찬 줄을 모두 제거하고 위쪽 블록을 아래로 떨어뜨린다.
 * @param {number[][]} grid - (in-place 수정)
 * @returns {number} 제거된 줄 수
 */
export function clearLines(grid) {
  let cleared = 0;
  for (let r = BOARD_HEIGHT - 1; r >= 0; r--) {
    // 한 행에 빈칸이 하나도 없으면 클리어
    if (grid[r].every((v) => v !== 0)) {
      grid.splice(r, 1);
      grid.unshift(Array(BOARD_WIDTH).fill(0));
      cleared++;
      r++; // 같은 r 위치를 다시 검사 (위에서 내려온 줄)
    }
  }
  return cleared;
}

/**
 * 가비지 라인을 보드 하단에 추가한다. 기존 블록은 위로 밀린다.
 * 한 배치(공격) 내 모든 줄은 동일한 위치의 칸이 비어있다.
 *
 * @param {number[][]} grid - (in-place 수정)
 * @param {number} lines    - 추가할 줄 수
 * @returns {boolean} true면 보드가 천장에 닿아 게임 오버 위험
 */
export function addGarbage(grid, lines) {
  if (lines <= 0) return false;
  // 빈 칸 위치를 배치마다 한 번만 결정 (스펙: 같은 칸이 비어있음)
  const holeCol = Math.floor(Math.random() * BOARD_WIDTH);
  // 위로 밀어내기
  for (let i = 0; i < lines; i++) {
    grid.shift();
    const garbageRow = Array(BOARD_WIDTH).fill(8); // 8 = 가비지 색상 인덱스
    garbageRow[holeCol] = 0;
    grid.push(garbageRow);
  }
  // 가장 상단(밀린 후) 행에 블록이 있으면 토프아웃 위험 신호
  return grid[0].some((v) => v !== 0);
}

/**
 * 보드 상단(visible top)부터 얼마나 쌓여 있는지(높이)를 반환한다. 미니맵 시각화용.
 * Phase 5: hidden zone(grid[0..VANISH_ZONE-1])은 제외하고 visible 영역만 측정.
 * (hidden zone 블록은 사용자 눈에 안 보이므로 미니맵에도 표시하지 않는다.)
 *
 * @param {number[][]} grid
 * @returns {number} 0~VISIBLE_HEIGHT (=20)
 */
export function getStackHeight(grid) {
  for (let r = VANISH_ZONE; r < BOARD_HEIGHT; r++) {
    if (grid[r].some((v) => v !== 0)) return BOARD_HEIGHT - r;
  }
  return 0;
}

/**
 * 보드의 컬럼별 높이 배열을 반환한다 (미니맵 정밀 표시용).
 * Phase 5: hidden zone은 제외하고 visible 영역만 측정. 최댓값은 VISIBLE_HEIGHT.
 *
 * @param {number[][]} grid
 * @returns {number[]} length=10, 각 원소 0~VISIBLE_HEIGHT (=20)
 */
export function getColumnHeights(grid) {
  const heights = Array(BOARD_WIDTH).fill(0);
  for (let c = 0; c < BOARD_WIDTH; c++) {
    for (let r = VANISH_ZONE; r < BOARD_HEIGHT; r++) {
      if (grid[r][c] !== 0) {
        heights[c] = BOARD_HEIGHT - r;
        break;
      }
    }
  }
  return heights;
}

/**
 * 피스가 바닥에 닿았는지 판단 (한 줄 더 내려가면 충돌인지).
 * Lock Delay 트리거 판정에 사용.
 *
 * @param {number[][]} grid
 * @param {object} piece
 * @returns {boolean}
 */
export function isPieceLanded(grid, piece) {
  return isColliding(grid, piece.type, piece.rotation, piece.x, piece.y + 1);
}

/**
 * 고스트 피스의 y좌표 계산: 현재 위치에서 더 이상 내려갈 수 없을 때까지 떨어뜨린다.
 *
 * @param {number[][]} grid
 * @param {object} piece
 * @returns {number} ghostY
 */
export function getGhostY(grid, piece) {
  let y = piece.y;
  while (!isColliding(grid, piece.type, piece.rotation, piece.x, y + 1)) {
    y++;
  }
  return y;
}

/**
 * 가비지 변환표: 라인 클리어 줄 수 → 전송할 가비지 줄 수.
 * Phase 1에서는 T-spin / Perfect Clear 미감지 (Phase 3 폴리시에서 확장 가능).
 *
 * @param {number} linesCleared
 * @returns {number}
 */
export function garbageFromLines(linesCleared) {
  switch (linesCleared) {
    case 1: return 0;   // Single
    case 2: return 1;   // Double
    case 3: return 2;   // Triple
    case 4: return 4;   // Tetris
    default: return 0;
  }
}

/**
 * 콤보 보너스 계산: 콤보 1당 가비지 +0.5줄 (반올림).
 * @param {number} combo - 0 이상 (첫 클리어가 콤보 0)
 * @returns {number}
 */
export function comboBonus(combo) {
  if (combo <= 0) return 0;
  return Math.round(combo * 0.5);
}

/**
 * 보드 하단의 N줄을 즉시 제거하고 위쪽을 아래로 떨어뜨린다 (라인 클리어 아이템 효과).
 * 줄에 어떤 내용이 있든(가비지/일반 블록/빈칸) 무조건 N줄을 잘라낸다.
 *
 * @param {number[][]} grid (in-place 수정)
 * @param {number} lines 제거할 하단 줄 수
 * @returns {number} 실제로 제거된 줄 수
 */
export function clearBottomLines(grid, lines) {
  if (lines <= 0) return 0;
  const n = Math.min(lines, BOARD_HEIGHT);
  for (let i = 0; i < n; i++) {
    grid.pop();
    grid.unshift(Array(BOARD_WIDTH).fill(0));
  }
  return n;
}
