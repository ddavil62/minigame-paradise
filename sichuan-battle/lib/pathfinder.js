/**
 * @fileoverview 외곽 한 칸을 포함한 최대 2회 꺼임 사천성 연결 경로를 탐색한다.
 */

/** @typedef {{tileId:string,faceId:number,x:number,y:number,removed:boolean,locked?:boolean}} Tile */
const DIRECTIONS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

/** @param {{x:number,y:number}[]} points 경로 점 @returns {{x:number,y:number}[]} 중복과 직선 중간점을 제거한 경로 */
function compress(points) {
  const unique = points.filter((point, index) => index === 0 || point.x !== points[index - 1].x || point.y !== points[index - 1].y);
  return unique.filter((point, index) => {
    if (index === 0 || index === unique.length - 1) return true;
    const before = unique[index - 1]; const after = unique[index + 1];
    return (point.x - before.x) !== (after.x - point.x) || (point.y - before.y) !== (after.y - point.y);
  });
}

/** @param {{x:number,y:number}} a 시작 @param {{x:number,y:number}} b 끝 @param {Set<string>} occupied 점유 좌표 @returns {boolean} 직선 이동 가능 여부 */
function clearLine(a, b, occupied) {
  if (a.x !== b.x && a.y !== b.y) return false;
  const dx = Math.sign(b.x - a.x); const dy = Math.sign(b.y - a.y); let x = a.x + dx; let y = a.y + dy;
  while (x !== b.x || y !== b.y) { if (occupied.has(`${x},${y}`)) return false; x += dx; y += dy; }
  return true;
}

/**
 * 두 점 사이의 0~1회 꺾임 경로를 찾는다.
 * @param {{x:number,y:number}} a 시작 @param {{x:number,y:number}} b 끝 @param {Set<string>} occupied 점유 좌표
 * @returns {{x:number,y:number}[][]} 가능한 경로 목록
 */
function pathsWithinOneBend(a, b, occupied) {
  const paths = []; if (clearLine(a, b, occupied)) paths.push([a, b]);
  for (const corner of [{ x: a.x, y: b.y }, { x: b.x, y: a.y }]) {
    if ((corner.x === a.x && corner.y === a.y) || (corner.x === b.x && corner.y === b.y) || occupied.has(`${corner.x},${corner.y}`)) continue;
    if (clearLine(a, corner, occupied) && clearLine(corner, b, occupied)) paths.push([a, corner, b]);
  }
  return paths;
}

/** @param {{x:number,y:number}[]} path 경로 @returns {number} 맨해튼 길이 */
function pathLength(path) { let length = 0; for (let index = 1; index < path.length; index += 1) length += Math.abs(path[index].x - path[index - 1].x) + Math.abs(path[index].y - path[index - 1].y); return length; }

/**
 * 두 타일 사이의 결정적인 최적 경로를 찾는다.
 * @param {Tile[]} tiles 타일 상태 @param {string} tileAId 시작 타일 @param {string} tileBId 끝 타일
 * @param {number} [width=12] 너비 @param {number} [height=8] 높이
 * @returns {{path:{x:number,y:number}[],bends:number}|null} 연결 경로
 */
export function findPath(tiles, tileAId, tileBId, width = 12, height = 8) {
  const start = tiles.find((tile) => tile.tileId === tileAId); const end = tiles.find((tile) => tile.tileId === tileBId);
  if (!start || !end || start === end || start.removed || end.removed || start.faceId !== end.faceId) return null;
  const occupied = new Set(tiles.filter((tile) => !tile.removed && tile !== start && tile !== end).map((tile) => `${tile.x},${tile.y}`)); const candidates = [];
  for (const path of pathsWithinOneBend(start, end, occupied)) candidates.push(compress(path));
  for (const [dx, dy] of DIRECTIONS) {
    let x = start.x + dx; let y = start.y + dy;
    while (x >= -1 && x <= width && y >= -1 && y <= height && !occupied.has(`${x},${y}`)) {
      const pivot = { x, y }; for (const suffix of pathsWithinOneBend(pivot, end, occupied)) candidates.push(compress([start, ...suffix])); x += dx; y += dy;
    }
  }
  const valid = candidates.filter((path) => path.length - 2 <= 2);
  valid.sort((a, b) => (a.length - b.length) || pathLength(a) - pathLength(b) || JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return valid[0] ? { path: valid[0], bends: valid[0].length - 2 } : null;
}

/** @param {Tile[]} tiles 타일 상태 @returns {{a:Tile,b:Tile,path:{x:number,y:number}[]}|null} 첫 합법 짝 */
export function findAnyLegalPair(tiles) {
  const active = tiles.filter((tile) => !tile.removed && !tile.locked);
  for (let index = 0; index < active.length; index += 1) for (let next = index + 1; next < active.length; next += 1) {
    if (active[index].faceId !== active[next].faceId) continue; const result = findPath(tiles, active[index].tileId, active[next].tileId); if (result) return { a: active[index], b: active[next], path: result.path };
  }
  return null;
}
