/**
 * @fileoverview 윷놀이의 경로 인덱스를 실제 보드 교차점의 정규 노드 ID로 변환한다.
 * 서버의 잡기·업기 판정과 클라이언트 렌더링이 같은 물리 칸을 공유하도록 한다.
 */

/** 출발 전 말의 위치. */
const HOME = -1;
/** 완주한 말의 위치. */
const GOAL = 99;

/**
 * 경로상 칸 인덱스를 실제 보드 노드 ID로 정규화한다.
 *
 * `20`은 초기 경로 모델에서 시작점 `0`의 별칭으로 사용됐으므로 같은 노드로
 * 취급한다. HOME과 GOAL은 보드 위 충돌 대상이 아니므로 `null`을 반환한다.
 *
 * @param {number} cell 경로상 칸 인덱스
 * @returns {string|null} 물리 보드 노드 ID
 */
export function canonicalNodeId(cell) {
  if (!Number.isInteger(cell) || cell === HOME || cell === GOAL) return null;
  const normalizedCell = cell === 20 ? 0 : cell;
  return `node:${normalizedCell}`;
}

/**
 * 정규 노드 ID를 렌더링에 사용하는 대표 칸 인덱스로 되돌린다.
 *
 * @param {string|null|undefined} nodeId 정규 노드 ID
 * @returns {number|null} 대표 칸 인덱스
 */
export function cellForNodeId(nodeId) {
  if (typeof nodeId !== 'string' || !nodeId.startsWith('node:')) return null;
  const cell = Number(nodeId.slice(5));
  return Number.isInteger(cell) ? cell : null;
}
