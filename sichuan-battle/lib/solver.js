/**
 * @fileoverview 생성 보드의 저장 해답과 소형 보드 완주 가능성을 검증한다.
 */
import { findAnyLegalPair, findPath } from './pathfinder.js';

/** @param {object} board 보드 @returns {boolean} 생성 시 저장된 48단계 해답 유효 여부 */
export function verifyGeneratedSolution(board) {
  return verifyRemovalSequence(board.tiles, board.solution || []);
}

/**
 * 현재 제거 상태에서 저장된 제거 순서가 실제 경로 규칙으로 남은 타일을 모두 제거하는지 검증한다.
 * @param {object[]} sourceTiles 타일 상태 @param {string[][]} solution 제거 순서
 * @returns {boolean} 완주 가능 여부
 */
export function verifyRemovalSequence(sourceTiles, solution) {
  const tiles = sourceTiles.map((tile) => ({ ...tile }));
  const activeCount = tiles.filter((tile) => !tile.removed).length;
  if (solution.length * 2 !== activeCount) return false;
  for (const [a, b] of solution) {
    if (!findPath(tiles, a, b)) return false;
    const first = tiles.find((tile) => tile.tileId === a); const second = tiles.find((tile) => tile.tileId === b);
    if (!first || !second || first.removed || second.removed) return false;
    first.removed = true; second.removed = true;
  }
  return tiles.every((tile) => tile.removed);
}

/** @param {object[]} tiles 타일 배열 @returns {boolean} 탐욕적 완주 가능 여부 */
export function canSolve(tiles) {
  const copy = tiles.map((tile) => ({ ...tile }));
  while (copy.some((tile) => !tile.removed)) {
    const pair = findAnyLegalPair(copy); if (!pair) return false;
    pair.a.removed = true; pair.b.removed = true;
  }
  return true;
}
