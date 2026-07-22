/**
 * @fileoverview 외곽 한 칸을 포함해 최대 두 번 꺾이는 사천성 연결 경로를 찾는다.
 */

/** @typedef {{tileId:string,faceId:number,x:number,y:number,removed:boolean,locked?:boolean}} Tile */
const DIRECTIONS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

/** @param {{x:number,y:number}[]} points 전체 경로 @returns {{x:number,y:number}[]} 꼭짓점만 남긴 경로 */
function compress(points) {
  return points.filter((point, index) => {
    if (index === 0 || index === points.length - 1) return true;
    const before = points[index - 1]; const after = points[index + 1];
    return (point.x - before.x) !== (after.x - point.x) || (point.y - before.y) !== (after.y - point.y);
  });
}

/**
 * 두 타일 사이의 결정적 최적 경로를 찾는다.
 * @param {Tile[]} tiles 타일 상태 @param {string} tileAId 시작 타일 @param {string} tileBId 끝 타일
 * @param {number} [width=12] 너비 @param {number} [height=8] 높이
 * @returns {{path:{x:number,y:number}[],bends:number}|null} 연결 경로
 */
export function findPath(tiles, tileAId, tileBId, width = 12, height = 8) {
  const start = tiles.find((tile) => tile.tileId === tileAId);
  const end = tiles.find((tile) => tile.tileId === tileBId);
  if (!start || !end || start === end || start.removed || end.removed || start.faceId !== end.faceId) return null;
  const occupied = new Set(tiles.filter((tile) => !tile.removed && tile !== start && tile !== end).map((tile) => `${tile.x},${tile.y}`));
  const queue = [{ x: start.x, y: start.y, direction: -1, bends: 0, points: [{ x: start.x, y: start.y }] }];
  const visited = new Map(); const candidates = [];
  while (queue.length) {
    const state = queue.shift();
    for (let direction = 0; direction < DIRECTIONS.length; direction += 1) {
      const bends = state.direction < 0 || state.direction === direction ? state.bends : state.bends + 1;
      if (bends > 2) continue;
      const [dx, dy] = DIRECTIONS[direction]; const x = state.x + dx; const y = state.y + dy;
      if (x < -1 || x > width || y < -1 || y > height || occupied.has(`${x},${y}`)) continue;
      const points = [...state.points, { x, y }];
      if (x === end.x && y === end.y) { candidates.push({ path: compress(points), bends, length: points.length }); continue; }
      const key = `${x},${y},${direction}`;
      if ((visited.get(key) ?? 3) <= bends) continue;
      visited.set(key, bends); queue.push({ x, y, direction, bends, points });
    }
  }
  candidates.sort((a, b) => a.bends - b.bends || a.length - b.length || JSON.stringify(a.path).localeCompare(JSON.stringify(b.path)));
  return candidates[0] ? { path: candidates[0].path, bends: candidates[0].bends } : null;
}

/** @param {Tile[]} tiles 타일 상태 @returns {{a:Tile,b:Tile,path:{x:number,y:number}[]}|null} 첫 합법 짝 */
export function findAnyLegalPair(tiles) {
  const active = tiles.filter((tile) => !tile.removed && !tile.locked);
  for (let index = 0; index < active.length; index += 1) for (let next = index + 1; next < active.length; next += 1) {
    if (active[index].faceId !== active[next].faceId) continue;
    const result = findPath(tiles, active[index].tileId, active[next].tileId);
    if (result) return { a: active[index], b: active[next], path: result.path };
  }
  return null;
}
