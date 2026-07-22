/**
 * @fileoverview 생성 보드의 저장 해답과 소형 보드 완주 가능성을 검증한다.
 */
import { findAnyLegalPair, findPath } from './pathfinder.js';

/** @param {object} board 보드 @returns {boolean} 생성 시 저장된 48단계 해답 유효 여부 */
export function verifyGeneratedSolution(board) {
  const tiles = board.tiles.map((tile) => ({ ...tile }));
  for (const [a, b] of board.solution || []) {
    if (!findPath(tiles, a, b)) return false;
    tiles.find((tile) => tile.tileId === a).removed = true; tiles.find((tile) => tile.tileId === b).removed = true;
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
