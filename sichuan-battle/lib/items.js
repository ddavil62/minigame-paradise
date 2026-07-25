/**
 * @fileoverview 고빈도 7종 아이템의 결정적 드롭과 기본 효과 규칙.
 */
import { createPrng, deriveSeed } from './prng.js';
import { findAnyLegalPair } from './pathfinder.js';

export const ITEM_DEFINITIONS = Object.freeze({
  lock: { weight: 18, kind: 'attack', duration: 3250 }, flip: { weight: 16, kind: 'attack', duration: 4000 },
  fog: { weight: 10, kind: 'attack', duration: 4500 },
  hint: { weight: 16, kind: 'support', duration: 3000 }, cleanse: { weight: 14, kind: 'defense', duration: 3000 },
  shield: { weight: 14, kind: 'defense', duration: 10000 },
});
export const ATTACK_ITEMS = new Set(['lock', 'flip', 'fog']);

/** @param {string|number} seed 경기 시드 @param {number} ordinal 성공 제거 순번 @param {number} pity 연속 실패 @returns {{dropped:boolean,itemId:string|null,pity:number}} 결과 */
export function rollDrop(seed, ordinal, pity) {
  const random = createPrng(deriveSeed(seed, `drop:${ordinal}`));
  const dropped = ordinal === 1 || pity >= 2 || random() < 0.72;
  if (!dropped) return { dropped: false, itemId: null, pity: pity + 1 };
  const totalWeight = Object.values(ITEM_DEFINITIONS).reduce((total, definition) => total + definition.weight, 0);
  let roll = random() * totalWeight;
  for (const [itemId, definition] of Object.entries(ITEM_DEFINITIONS)) { roll -= definition.weight; if (roll < 0) return { dropped: true, itemId, pity: 0 }; }
  return { dropped: true, itemId: 'shield', pity: 0 };
}

/** @param {object} board 대상 보드 @param {string} itemId 아이템 @returns {string[]} 타일 ID */
export function chooseTargets(board, itemId, random = Math.random) {
  const active = board.tiles.filter((tile) => !tile.removed); const safe = findAnyLegalPair(board.tiles);
  const protectedIds = new Set(safe ? [safe.a.tileId, safe.b.tileId] : []);
  const maximum = itemId === 'lock' ? 6 : itemId === 'flip' ? 16 : 18;
  const stateKey = itemId === 'lock' ? 'locked' : itemId === 'flip' ? 'flipped' : 'fogged';
  const candidates = active.filter((tile) => !protectedIds.has(tile.tileId) && !tile[stateKey]);
  for (let index = candidates.length - 1; index > 0; index -= 1) {
    const next = Math.floor(random() * (index + 1));
    [candidates[index], candidates[next]] = [candidates[next], candidates[index]];
  }
  return candidates.slice(0, maximum).map((tile) => tile.tileId);
}
