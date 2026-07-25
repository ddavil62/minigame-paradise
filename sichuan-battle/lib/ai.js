/**
 * @fileoverview 사천성 AI의 합법 짝 탐색, 보통 난이도 템포와 아이템 선택 정책을 제공한다.
 */
import { findPath } from './pathfinder.js';
import { isKnownItemId } from './items.js';

export const NORMAL_AI_TIMING = Object.freeze({ first: [900, 1700], pair: [850, 1550], item: [550, 1200], think: [700, 1400], rest: [900, 1800], disrupted: [350, 800] });

/** @param {{x:number,y:number}[]} path 경로 @returns {number} 맨해튼 거리 */
function pathLength(path) { let value = 0; for (let index = 1; index < path.length; index += 1) value += Math.abs(path[index].x - path[index - 1].x) + Math.abs(path[index].y - path[index - 1].y); return value; }

/**
 * 공개 보드에서 현재 제거 가능한 모든 짝을 찾는다.
 * @param {object[]} tiles 공개 타일 배열
 * @returns {{a:object,b:object,path:{x:number,y:number}[],bends:number,score:number}[]} 합법 후보
 */
export function enumerateLegalPairs(tiles = []) {
  const buckets = new Map();
  for (const tile of tiles) if (!tile.removed && !tile.locked) { const list = buckets.get(tile.faceId) || []; list.push(tile); buckets.set(tile.faceId, list); }
  const pairs = [];
  for (const list of buckets.values()) for (let index = 0; index < list.length; index += 1) for (let next = index + 1; next < list.length; next += 1) {
    const route = findPath(tiles, list[index].tileId, list[next].tileId); if (!route) continue;
    const edge = [list[index], list[next]].filter((tile) => tile.x === 0 || tile.x === 11 || tile.y === 0 || tile.y === 7).length;
    pairs.push({ a: list[index], b: list[next], path: route.path, bends: route.bends, score: 18 - route.bends * 3 - pathLength(route.path) * 0.15 + edge });
  }
  return pairs;
}

/**
 * 상위권 후보를 섞어 완벽하지 않은 보통 난이도 짝을 고른다.
 * @param {object} snapshot 개인화 스냅샷 @param {()=>number} [rng=Math.random] 난수
 * @returns {ReturnType<typeof enumerateLegalPairs>[number]|null} 선택
 */
export function chooseLegalPair(snapshot, rng = Math.random) {
  const pairs = enumerateLegalPairs(snapshot?.me?.board?.tiles || []).sort((a, b) => b.score - a.score || a.a.tileId.localeCompare(b.a.tileId));
  if (!pairs.length) return null;
  const useTopPool = rng() < 0.65; const poolSize = useTopPool ? Math.min(pairs.length, Math.max(2, Math.ceil(pairs.length * 0.3))) : pairs.length;
  return { ...pairs[Math.min(poolSize - 1, Math.floor(rng() * poolSize))], selectionPool: useTopPool ? 'top' : 'all' };
}

/**
 * 현재 효과와 점수 상황에 따라 6종 보유 아이템 하나를 고른다.
 * @param {object} snapshot 개인화 스냅샷 @param {{actionOrdinal?:number}} [context] 문맥 @param {()=>number} [rng=Math.random] 난수
 * @returns {object|null} 인벤토리 슬롯
 */
export function chooseAiItem(snapshot, context = {}, rng = Math.random) {
  const rawInventory = snapshot?.me?.inventory || [];
  const seen = new Set();
  const inventory = rawInventory.filter((slot) => {
    const valid = slot && typeof slot.slotId === 'string' && slot.slotId && !seen.has(slot.slotId) && isKnownItemId(slot.itemId);
    if (valid) seen.add(slot.slotId);
    return valid;
  }).slice(0, 3);
  if (!inventory.length) return null;
  const effects = snapshot?.me?.effects || []; const disrupted = effects.some((effect) => ['lock', 'flip', 'fog'].includes(effect.itemId));
  const byId = (id) => inventory.find((slot) => slot.itemId === id);
  if (disrupted && byId('cleanse')) return byId('cleanse');
  if (!snapshot.me.shieldActive && byId('shield') && rng() < 0.68) return byId('shield');
  if (enumerateLegalPairs(snapshot?.me?.board?.tiles || []).length === 0 && byId('hint')) return byId('hint');
  const attacks = ['lock', 'flip', 'fog'].map(byId).filter(Boolean);
  if (attacks.length && ((snapshot?.opponent?.remaining ?? 96) < 50 || (context.actionOrdinal || 0) % 3 === 1 || inventory.length === 3)) return attacks[Math.floor(rng() * attacks.length)];
  if (byId('hint') && rng() < 0.32) return byId('hint');
  return rawInventory.length >= 3 ? inventory[Math.floor(rng() * inventory.length)] : null;
}

/**
 * 동작 종류와 방해 상태를 반영한 가변 지연을 반환한다.
 * @param {'first'|'pair'|'item'} kind 종류 @param {object} snapshot 상태 @param {()=>number} [rng=Math.random] 난수
 * @returns {number} 밀리초
 */
export function chooseAiDelay(kind, snapshot, rng = Math.random, disruptedOverride = false) {
  const range = NORMAL_AI_TIMING[kind] || NORMAL_AI_TIMING.pair; let delay = range[0] + rng() * (range[1] - range[0]);
  const disrupted = disruptedOverride || (snapshot?.me?.effects || []).some((effect) => ['flip', 'fog'].includes(effect.itemId));
  if (disrupted) delay += NORMAL_AI_TIMING.disrupted[0] + rng() * (NORMAL_AI_TIMING.disrupted[1] - NORMAL_AI_TIMING.disrupted[0]);
  return Math.round(delay);
}

/**
 * 기본 지연에 18% 숙고와 12% 추가 휴지를 결정적으로 합산한다.
 * 예약 뒤에는 컨트롤러가 최신 snapshot에서 행동을 다시 선택하므로 오래된 좌표를 보존하지 않는다.
 * @param {'first'|'pair'|'item'} kind 행동 @param {object} snapshot 상태 @param {()=>number} rng 난수 @param {boolean} [disrupted=false] 방해 후 재정비 여부
 * @returns {{delay:number,thinking:boolean,resting:boolean}} 계획
 */
export function planAiDelay(kind, snapshot, rng = Math.random, disrupted = false) {
  let delay = chooseAiDelay(kind, snapshot, rng, disrupted); const thinking = rng() < 0.18; if (thinking) delay += Math.round(NORMAL_AI_TIMING.think[0] + rng() * (NORMAL_AI_TIMING.think[1] - NORMAL_AI_TIMING.think[0]));
  const resting = rng() < 0.12; if (resting) delay += Math.round(NORMAL_AI_TIMING.rest[0] + rng() * (NORMAL_AI_TIMING.rest[1] - NORMAL_AI_TIMING.rest[0]));
  return { delay, thinking, resting };
}
