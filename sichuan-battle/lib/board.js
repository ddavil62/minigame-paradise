/**
 * @fileoverview 12×8 사천성 보드의 결정적 무작위 배치와 완주 가능한 셔플을 생성한다.
 */
import { createPrng, deriveSeed, shuffled } from './prng.js';

export const BOARD_WIDTH = 12;
export const BOARD_HEIGHT = 8;
const MAX_LAYOUT_ATTEMPTS = 24;
const EXPECTED_ADJACENT = 172 * 3 / 95;
const EXPECTED_LEGACY = 48 * 3 / 95;

/** @returns {{x:number,y:number}[]} 행 우선으로 정렬된 전체 좌표 */
function createCoordinates() {
  return Array.from({ length: BOARD_WIDTH * BOARD_HEIGHT }, (_, index) => ({ x: index % BOARD_WIDTH, y: Math.floor(index / BOARD_WIDTH) }));
}

/** @param {{x:number,y:number}} position 좌표 @returns {string} 좌표 키 */
function positionKey(position) { return `${position.x},${position.y}`; }

/**
 * 현재 남은 좌표 중 지정한 방향으로 외곽과 직선 연결된 좌표를 구한다.
 * @param {{x:number,y:number}[]} active 활성 좌표 @param {number} direction 0=위, 1=오른쪽, 2=아래, 3=왼쪽
 * @returns {{x:number,y:number}[]} 외곽 노출 좌표
 */
function exposedPositions(active, direction) {
  const chosen = new Map();
  for (const position of active) {
    const axis = direction % 2 === 0 ? position.x : position.y;
    const value = direction % 2 === 0 ? position.y : position.x;
    const previous = chosen.get(axis);
    const takesMinimum = direction === 0 || direction === 3;
    if (!previous || (takesMinimum ? value < previous.value : value > previous.value)) chosen.set(axis, { value, position });
  }
  return [...chosen.values()].map((entry) => entry.position).sort((a, b) => a.y - b.y || a.x - b.x);
}

/**
 * 외곽에 노출된 두 타일은 보드 밖의 공통 직선을 통해 2회 이하로 연결된다는 규칙으로 제거 순서를 만든다.
 * @param {{x:number,y:number}[]} coordinates 사용할 좌표 @param {() => number} random 결정적 PRNG
 * @returns {{x:number,y:number}[][]} 앞에서부터 제거할 좌표 쌍
 */
function createRemovalPairs(coordinates, random) {
  const active = coordinates.map((position) => ({ ...position }));
  const pairs = [];
  while (active.length > 0) {
    if (active.length === 2) { pairs.push([active[0], active[1]]); break; }
    // 현재 외곽의 상·하·좌·우 중 하나를 고르고, 같은 외곽으로 빠져나갈 수 있는 두 칸을 고른다.
    const firstDirection = Math.floor(random() * 4); let exposed = [];
    for (let offset = 0; offset < 4 && exposed.length < 2; offset += 1) exposed = exposedPositions(active, (firstDirection + offset) % 4);
    const firstIndex = Math.floor(random() * exposed.length);
    let secondIndex = Math.floor(random() * (exposed.length - 1));
    if (secondIndex >= firstIndex) secondIndex += 1;
    const pair = [exposed[firstIndex], exposed[secondIndex]];
    pairs.push(pair);
    const removed = new Set(pair.map(positionKey));
    for (let index = active.length - 1; index >= 0; index -= 1) if (removed.has(positionKey(active[index]))) active.splice(index, 1);
  }
  return pairs;
}

/**
 * 초기 보드의 인접 동일 문양 통계를 계산한다.
 * @param {object[]} tiles 타일 @returns {{totalAdjacent:number,horizontalAdjacent:number,verticalAdjacent:number,legacyHorizontalSlots:number}}
 */
export function measureAdjacency(tiles) {
  const byPosition = new Map(tiles.filter((tile) => !tile.removed).map((tile) => [positionKey(tile), tile]));
  let horizontalAdjacent = 0; let verticalAdjacent = 0; let legacyHorizontalSlots = 0;
  for (const tile of byPosition.values()) {
    const right = byPosition.get(`${tile.x + 1},${tile.y}`);
    const below = byPosition.get(`${tile.x},${tile.y + 1}`);
    if (right?.faceId === tile.faceId) horizontalAdjacent += 1;
    if (below?.faceId === tile.faceId) verticalAdjacent += 1;
    if (tile.x % 2 === 0 && right?.faceId === tile.faceId) legacyHorizontalSlots += 1;
  }
  return { totalAdjacent: horizontalAdjacent + verticalAdjacent, horizontalAdjacent, verticalAdjacent, legacyHorizontalSlots };
}

/** @param {ReturnType<typeof measureAdjacency>} metrics 통계 @returns {number} 무작 기대값과의 규격화 거리 */
function scoreMetrics(metrics) {
  return Math.abs(metrics.totalAdjacent - EXPECTED_ADJACENT) / EXPECTED_ADJACENT
    + Math.abs(metrics.legacyHorizontalSlots - EXPECTED_LEGACY) / EXPECTED_LEGACY
    + 0.5 * Math.abs(metrics.horizontalAdjacent / 88 - metrics.verticalAdjacent / 84) / (3 / 95);
}

/** @param {ReturnType<typeof measureAdjacency>} metrics 통계 @returns {boolean} 안전한 개별 후보 범위 충족 여부 */
function isPreferredCandidate(metrics) {
  return metrics.totalAdjacent >= 4 && metrics.totalAdjacent <= 7
    && metrics.legacyHorizontalSlots >= 1 && metrics.legacyHorizontalSlots <= 2
    && Math.abs(metrics.horizontalAdjacent / 88 - metrics.verticalAdjacent / 84) <= 0.02;
}

/**
 * 좌표, face 쌍 목록을 받아 완주 가능한 배치를 결정적으로 생성한다.
 * @param {{x:number,y:number,tileId:string}[]} positions 활성 타일 위치 @param {number[]} facePairs 각 제거 쌍에 할당할 face ID
 * @param {string|number} seed 기본 시드 @param {string} domain PRNG 도메인
 * @returns {{faceByTileId:Map<string,number>,solution:string[][],metrics:ReturnType<typeof measureAdjacency>}}
 */
function generateSolvableLayout(positions, facePairs, seed, domain) {
  let best = null;
  for (let attempt = 0; attempt < MAX_LAYOUT_ATTEMPTS; attempt += 1) {
    const random = createPrng(deriveSeed(seed, `${domain}:layout:${attempt}`));
    const coordinatePairs = createRemovalPairs(positions, random);
    const assignedFaces = shuffled(facePairs, random);
    const faceByTileId = new Map(); const solution = [];
    coordinatePairs.forEach((pair, index) => {
      const ids = pair.map((position) => position.tileId);
      ids.forEach((tileId) => faceByTileId.set(tileId, assignedFaces[index]));
      solution.push(ids);
    });
    const metricTiles = positions.map((position) => ({ ...position, faceId: faceByTileId.get(position.tileId), removed: false }));
    const metrics = measureAdjacency(metricTiles); const candidate = { faceByTileId, solution, metrics, attempt };
    if (!best || scoreMetrics(metrics) < scoreMetrics(best.metrics) || (scoreMetrics(metrics) === scoreMetrics(best.metrics) && attempt < best.attempt)) best = candidate;
    if (isPreferredCandidate(metrics)) return candidate;
  }
  // 제한된 24회 안에 선호 구간이 없으면 예외나 재시도 대신 기대값에 가장 가까운 완주 가능 후보를 사용한다.
  return best;
}

/** @param {string|number} seed 경기 시드 @returns {{tiles:object[],solution:string[][],revision:number,shuffleOrdinal:number}} 완전 해답 보드 */
export function createBoard(seed) {
  const positions = createCoordinates().map((position, index) => ({ ...position, tileId: `t${String(index + 1).padStart(2, '0')}` }));
  const facePairs = Array.from({ length: 48 }, (_, index) => (index % 24) + 1);
  const generated = generateSolvableLayout(positions, facePairs, seed, 'board');
  const tiles = positions.map((position) => ({ ...position, faceId: generated.faceByTileId.get(position.tileId), removed: false, locked: false, flipped: false, fogged: false }));
  return { tiles, solution: generated.solution, revision: 0, shuffleOrdinal: 0 };
}

/** @param {object} board 보드 @returns {object} 깊은 복사 가능한 스냅샷 */
export function serializeBoard(board) { return { ...board, solution: undefined, tiles: board.tiles.map((tile) => ({ ...tile })) }; }

/** @param {object} board 보드 @param {string|number} seed 경기 시드 @returns {object} 완주 가능하게 셔플된 보드 */
export function shuffleRemaining(board, seed) {
  const active = board.tiles.filter((tile) => !tile.removed).sort((a, b) => a.y - b.y || a.x - b.x);
  if (active.length > 0) {
    const counts = new Map();
    active.forEach((tile) => counts.set(tile.faceId, (counts.get(tile.faceId) || 0) + 1));
    const facePairs = [];
    for (const faceId of [...counts.keys()].sort((a, b) => a - b)) {
      const count = counts.get(faceId);
      if (count % 2 !== 0) throw new Error(`SHUFFLE_ODD_FACE_COUNT:${faceId}`);
      for (let index = 0; index < count / 2; index += 1) facePairs.push(faceId);
    }
    const ordinal = board.shuffleOrdinal + 1;
    const generated = generateSolvableLayout(active, facePairs, seed, `shuffle:${ordinal}`);
    active.forEach((tile) => { tile.faceId = generated.faceByTileId.get(tile.tileId); tile.locked = false; tile.flipped = false; tile.fogged = false; });
    board.solution = generated.solution;
  } else board.solution = [];
  board.shuffleOrdinal += 1; board.revision += 1;
  return board;
}
