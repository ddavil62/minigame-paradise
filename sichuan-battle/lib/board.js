/**
 * @fileoverview 12×8 동일 시드 보드 생성, 직렬화와 교착 복구 셔플을 담당한다.
 */
import { createPrng, deriveSeed, shuffled } from './prng.js';
import { findAnyLegalPair } from './pathfinder.js';
import { canSolve } from './solver.js';

export const BOARD_WIDTH = 12;
export const BOARD_HEIGHT = 8;

/** @param {string|number} seed 경기 시드 @returns {{tiles:object[],solution:string[][],revision:number,shuffleOrdinal:number}} 완전 해답 보드 */
export function createBoard(seed) {
  const random = createPrng(deriveSeed(seed, 'board'));
  const dominoes = [];
  for (let y = 0; y < BOARD_HEIGHT; y += 1) for (let x = 0; x < BOARD_WIDTH; x += 2) dominoes.push([{ x, y }, { x: x + 1, y }]);
  const faces = shuffled(Array.from({ length: 48 }, (_, index) => (index % 24) + 1), random);
  const ordered = shuffled(dominoes, random); const tiles = []; const solution = [];
  ordered.forEach((pair, pairIndex) => {
    const ids = [];
    pair.forEach((position, side) => {
      const tileId = `t${String(pairIndex * 2 + side + 1).padStart(2, '0')}`;
      ids.push(tileId); tiles.push({ tileId, faceId: faces[pairIndex], ...position, removed: false, locked: false, flipped: false, fogged: false });
    });
    solution.push(ids);
  });
  tiles.sort((a, b) => a.y - b.y || a.x - b.x);
  return { tiles, solution, revision: 0, shuffleOrdinal: 0 };
}

/** @param {object} board 보드 @returns {object} 깊은 복사 가능한 스냅샷 */
export function serializeBoard(board) { return { ...board, solution: undefined, tiles: board.tiles.map((tile) => ({ ...tile })) }; }

/** @param {object} board 보드 @param {string|number} seed 경기 시드 @returns {object} 셔플된 보드 */
export function shuffleRemaining(board, seed) {
  const active = board.tiles.filter((tile) => !tile.removed); const random = createPrng(deriveSeed(seed, `shuffle:${board.shuffleOrdinal + 1}`));
  let faces = shuffled(active.map((tile) => tile.faceId), random); let legalFallback = null; let accepted = false;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    active.forEach((tile, index) => { tile.faceId = faces[index]; tile.locked = false; tile.flipped = false; tile.fogged = false; });
    if (findAnyLegalPair(board.tiles) && !legalFallback) legalFallback = [...faces];
    if (canSolve(board.tiles)) { accepted = true; break; }
    faces = shuffled(faces, random);
  }
  if (!accepted && legalFallback) active.forEach((tile, index) => { tile.faceId = legalFallback[index]; });
  if (!findAnyLegalPair(board.tiles)) restoreEmergencyPair(board.tiles);
  board.shuffleOrdinal += 1; board.revision += 1;
  return board;
}

/**
 * 200회 후보가 모두 실패했을 때 얼굴 다중집합을 보존하며 연결 가능한 두 좌표에 같은 얼굴을 배치한다.
 * @param {object[]} tiles 전체 타일
 * @returns {boolean} 복구 성공 여부
 */
function restoreEmergencyPair(tiles) {
  const active = tiles.filter((tile) => !tile.removed);
  for (let first = 0; first < active.length; first += 1) for (let second = first + 1; second < active.length; second += 1) {
    const a = active[first]; const b = active[second]; const originalFace = b.faceId; b.faceId = a.faceId;
    const connected = findAnyLegalPair(tiles); b.faceId = originalFace;
    if (!connected) continue;
    if (originalFace === a.faceId) return true;
    const donor = active.find((tile) => tile !== a && tile !== b && tile.faceId === a.faceId);
    if (!donor) continue;
    donor.faceId = originalFace; b.faceId = a.faceId; return true;
  }
  return false;
}
