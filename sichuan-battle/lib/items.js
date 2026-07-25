/**
 * @fileoverview 6종 아이템의 결정적 드롭과 공간 균형 공격 대상을 계산한다.
 */
import { createPrng, deriveSeed } from './prng.js';
import { findAnyLegalPair } from './pathfinder.js';

export const ITEM_DEFINITIONS = Object.freeze({
  lock: { weight: 18, kind: 'attack', duration: 3250 },
  flip: { weight: 16, kind: 'attack', duration: 4000 },
  fog: { weight: 10, kind: 'attack', duration: 4500 },
  hint: { weight: 16, kind: 'support', duration: 3000 },
  cleanse: { weight: 14, kind: 'defense', duration: 3000 },
  shield: { weight: 14, kind: 'defense' },
});
export const ITEM_IDS = Object.freeze(Object.keys(ITEM_DEFINITIONS));
export const ATTACK_ITEMS = new Set(['lock', 'flip', 'fog']);

/** @param {unknown} itemId 검사할 아이템 ID @returns {boolean} 지원하는 아이템인지 여부 */
export function isKnownItemId(itemId) { return typeof itemId === 'string' && ITEM_IDS.includes(itemId); }

/** @param {string|number} seed 경기 시드 @param {number} ordinal 성공 제거 순번 @param {number} pity 연속 실패 @returns {{dropped:boolean,itemId:string|null,pity:number}} 결과 */
export function rollDrop(seed, ordinal, pity) {
  const random = createPrng(deriveSeed(seed, `drop:${ordinal}`));
  const dropped = ordinal === 1 || pity >= 5 || random() < 0.14;
  if (!dropped) return { dropped: false, itemId: null, pity: pity + 1 };
  const totalWeight = ITEM_IDS.reduce((total, itemId) => total + ITEM_DEFINITIONS[itemId].weight, 0);
  let roll = random() * totalWeight;
  for (const itemId of ITEM_IDS) {
    roll -= ITEM_DEFINITIONS[itemId].weight;
    if (roll < 0) return { dropped: true, itemId, pity: 0 };
  }
  return { dropped: true, itemId: ITEM_IDS.at(-1), pity: 0 };
}

/**
 * 배열을 전달받은 결정적 난수로 제자리 섞는다.
 * @param {object[]} values 대상 배열
 * @param {()=>number} random 결정적 PRNG
 * @returns {object[]} 같은 배열
 */
function shuffle(values, random) {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const next = Math.floor(random() * (index + 1));
    [values[index], values[next]] = [values[next], values[index]];
  }
  return values;
}

/** @param {object} board 대상 보드 @param {string} itemId 아이템 @param {()=>number} random 결정적 PRNG @returns {string[]} 대상 ID */
export function chooseTargets(board, itemId, random = Math.random) {
  const active = board.tiles.filter((tile) => !tile.removed);
  const safe = findAnyLegalPair(board.tiles);
  const protectedIds = new Set(safe ? [safe.a.tileId, safe.b.tileId] : []);
  const maximum = itemId === 'lock' ? 6 : itemId === 'flip' ? 16 : 18;
  const stateKey = itemId === 'lock' ? 'locked' : itemId === 'flip' ? 'flipped' : 'fogged';
  const candidates = active.filter((tile) => !protectedIds.has(tile.tileId) && !tile[stateKey]);
  const targetCount = Math.min(maximum, candidates.length);
  if (!targetCount) return [];

  /**
   * 한 화면 절반에서 행을 순환하며 대상을 꺼낸다.
   * @param {object[]} halfCandidates 절반 후보
   * @param {number} quota 요청 수량
   * @returns {object[]} 선택 타일
   */
  const takeFromHalf = (halfCandidates, quota) => {
    const rows = new Map();
    for (const tile of halfCandidates) {
      const row = rows.get(tile.y) || [];
      row.push(tile);
      rows.set(tile.y, row);
    }
    const rowEntries = shuffle([...rows.entries()].sort(([a], [b]) => a - b)
      .map(([y, tiles]) => ({ y, tiles: shuffle(tiles, random), cursor: 0 })), random);
    const selected = [];
    while (selected.length < quota) {
      let progressed = false;
      for (const row of rowEntries) {
        if (selected.length >= quota) break;
        if (row.cursor >= row.tiles.length) continue;
        selected.push(row.tiles[row.cursor]);
        row.cursor += 1;
        progressed = true;
      }
      if (!progressed) break;
    }
    return selected;
  };

  const halves = [
    candidates.filter((tile) => Number(tile.y) < 4),
    candidates.filter((tile) => Number(tile.y) >= 4),
  ];
  // 화면 상·하 절반 quota를 먼저 고정해 행별 균등만으로 생기던 상단 편향을 차단한다.
  const desired = [Math.floor(targetCount / 2), Math.ceil(targetCount / 2)];
  const quota = desired.map((count, index) => Math.min(count, halves[index].length));
  let remainder = targetCount - quota[0] - quota[1];
  while (remainder > 0) {
    const available = [0, 1].filter((index) => quota[index] < halves[index].length);
    if (!available.length) break;
    const index = available[Math.floor(random() * available.length)];
    quota[index] += 1;
    remainder -= 1;
  }
  return [
    ...takeFromHalf(halves[0], quota[0]),
    ...takeFromHalf(halves[1], quota[1]),
  ].map((tile) => tile.tileId);
}
