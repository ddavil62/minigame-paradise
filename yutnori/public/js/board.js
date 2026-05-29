/**
 * @fileoverview 윷놀이 보드 좌표 정의. 칸 인덱스 → 캔버스 픽셀 좌표 매핑.
 *
 * 좌표계: 캔버스 480x480, 셀 반지름 약 22px.
 * 외곽 사각형 + 두 개의 대각 지름길 + 중앙(방).
 *
 * 인덱스 매핑 (server.js와 동일):
 *   외곽 (0=좌하 시작 → 시계방향):
 *     0(좌하), 1~4(좌측 변), 5(좌상 모서리),
 *     6~9(상단 변), 10(우상 모서리),
 *     11~14(우측 변), 15(우하 모서리), 16~19(하단 변)
 *   지름길A (좌상 → 중앙 → 우하):
 *     21, 22, 23(중앙)
 *   지름길B (우상 → 중앙 → 좌하):
 *     26, 27, 23(중앙 공유)
 *
 * 외곽은 각 변에 4칸씩(모서리 포함 5칸) — 사각형 한 변 = 5칸씩 (4+1 모서리).
 */

/** 보드 캔버스 크기 (px). */
export const BOARD_SIZE = 560;
/** 칸(셀) 반지름 (px). */
export const CELL_RADIUS = 26;
/** 강조용(모서리/중앙) 셀 반지름. */
export const CELL_RADIUS_BIG = 34;

/** 외곽 사각형 패딩 (px). */
const PAD = 50;

/** 한 변의 칸 수 (모서리 포함 양쪽). 각 변에 5칸. */
// 외곽 인덱스 분포: 좌변 0~5 (6칸), 상변 5~10 (6칸, 5와 10 공유), 우변 10~15, 하변 15~20(=0)
// 모서리 공유로 인해 한 변에 칸 5개 + 다음 모서리 1개 = 사실상 사각형 한 변에 5+1 노드.

/** 외곽 변의 칸 수(모서리 미포함). */
const SIDE_INTERIOR = 4;

/**
 * 외곽 20칸(0~19)의 좌표를 생성한다.
 * 좌하(0) → 좌상(5) → 우상(10) → 우하(15) → 좌하 직전(19) → 다음은 0.
 *
 * @returns {Array<{x:number, y:number, big:boolean}>}
 */
function buildOuter() {
  const out = [];
  const L = PAD;
  const R = BOARD_SIZE - PAD;
  const T = PAD;
  const B = BOARD_SIZE - PAD;

  // 좌하(0) → 좌상(5) — y가 감소하는 방향, x = L 고정
  // 0(좌하), 1, 2, 3, 4, 5(좌상): 6개 노드, 균등 분포
  for (let i = 0; i <= 5; i++) {
    const t = i / 5;
    out.push({ x: L, y: B - (B - T) * t, big: i === 0 || i === 5 });
  }
  // 좌상(5)는 위에서 push 했으므로 상단 변은 6부터 시작
  // 6, 7, 8, 9, 10(우상): x 증가, y = T
  for (let i = 1; i <= 5; i++) {
    const t = i / 5;
    out.push({ x: L + (R - L) * t, y: T, big: i === 5 });
  }
  // 우측 변: 11, 12, 13, 14, 15(우하)
  for (let i = 1; i <= 5; i++) {
    const t = i / 5;
    out.push({ x: R, y: T + (B - T) * t, big: i === 5 });
  }
  // 하단 변: 16, 17, 18, 19 (20=0이므로 push 안 함)
  for (let i = 1; i <= 4; i++) {
    const t = i / 5;
    out.push({ x: R - (R - L) * t, y: B, big: false });
  }
  return out;
}

/** 외곽 칸 좌표 0~19. */
export const OUTER_COORDS = buildOuter();

/** 중앙(방) 좌표 (인덱스 23). */
export const CENTER_COORD = { x: BOARD_SIZE / 2, y: BOARD_SIZE / 2, big: true };

/**
 * 지름길A: 좌상(5) → 중앙(23) → 우하(15) 합류.
 * 21, 22가 5와 중앙 사이의 두 중간 노드.
 */
function buildShortcutA() {
  const start = OUTER_COORDS[5];
  const end = CENTER_COORD;
  const list = [];
  // 21, 22: 1/3, 2/3 지점
  for (let i = 1; i <= 2; i++) {
    const t = i / 3;
    list.push({
      x: start.x + (end.x - start.x) * t,
      y: start.y + (end.y - start.y) * t,
      big: false,
    });
  }
  return list;
}

/**
 * 지름길B: 우상(10) → 중앙(23) → 좌하(0).
 * 26, 27이 10과 중앙 사이의 두 중간 노드.
 */
function buildShortcutB() {
  const start = OUTER_COORDS[10];
  const end = CENTER_COORD;
  const list = [];
  for (let i = 1; i <= 2; i++) {
    const t = i / 3;
    list.push({
      x: start.x + (end.x - start.x) * t,
      y: start.y + (end.y - start.y) * t,
      big: false,
    });
  }
  return list;
}

/** 지름길A 좌표 (인덱스 21, 22). */
export const SHORTCUT_A = buildShortcutA();
/** 지름길B 좌표 (인덱스 26, 27). */
export const SHORTCUT_B = buildShortcutB();

/**
 * 칸 인덱스 → 좌표 매핑 (대표 좌표).
 * 0~19: 외곽. 21,22: 지름길A. 26,27: 지름길B. 23: 중앙.
 *
 * @param {number} cell
 * @returns {{x:number, y:number, big:boolean}|null}
 */
export function cellToCoord(cell) {
  if (cell === 23) return CENTER_COORD;
  if (cell >= 0 && cell <= 19) return OUTER_COORDS[cell];
  if (cell === 21) return SHORTCUT_A[0];
  if (cell === 22) return SHORTCUT_A[1];
  if (cell === 26) return SHORTCUT_B[0];
  if (cell === 27) return SHORTCUT_B[1];
  return null;
}

/**
 * 모든 그려야 할 칸 목록 (렌더링용).
 * @returns {Array<{cell:number, x:number, y:number, big:boolean}>}
 */
export function allCells() {
  const list = [];
  for (let i = 0; i <= 19; i++) {
    const c = OUTER_COORDS[i];
    list.push({ cell: i, x: c.x, y: c.y, big: c.big });
  }
  list.push({ cell: 21, x: SHORTCUT_A[0].x, y: SHORTCUT_A[0].y, big: false });
  list.push({ cell: 22, x: SHORTCUT_A[1].x, y: SHORTCUT_A[1].y, big: false });
  list.push({ cell: 23, x: CENTER_COORD.x, y: CENTER_COORD.y, big: true });
  list.push({ cell: 26, x: SHORTCUT_B[0].x, y: SHORTCUT_B[0].y, big: false });
  list.push({ cell: 27, x: SHORTCUT_B[1].x, y: SHORTCUT_B[1].y, big: false });
  return list;
}

/**
 * 캔버스 픽셀 좌표 → 가장 가까운 칸 (클릭 hit-test용).
 * 반환된 칸과의 거리도 함께 제공.
 *
 * @param {number} px
 * @param {number} py
 * @param {number} [hitR=30] 히트 반경 px
 * @returns {{ cell: number, dist: number } | null}
 */
export function hitTestCell(px, py, hitR = 32) {
  let best = null;
  for (const c of allCells()) {
    const dx = c.x - px;
    const dy = c.y - py;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= hitR && (best === null || dist < best.dist)) {
      best = { cell: c.cell, dist };
    }
  }
  return best;
}

/**
 * 시작점(HOME, GOAL) 표시 좌표 — 보드 외부 좌측에 표시.
 * @returns {{x:number, y:number}}
 */
export function homeCoord() {
  return { x: 18, y: BOARD_SIZE - 18 };
}

export function goalCoord() {
  return { x: 18, y: 18 };
}
