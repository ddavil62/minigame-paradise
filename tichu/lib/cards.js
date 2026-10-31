/**
 * @fileoverview 티추 카드 정의. 서버·AI·브라우저가 같이 쓰므로 Node 전용 API를 쓰지 않는다.
 *
 * 카드 id 0~55: 0~51는 일반 카드(무늬 × 13), 52 개 · 53 참새(1) · 54 봉황 · 55 용.
 * 무늬 순서는 옥(j)·검(s)·탑(p)·별(t). 일반 카드의 숫자는 2~14(J=11, Q=12, K=13, A=14).
 */

export const SUIT_NAMES = ['옥', '검', '탑', '별'];
export const SUIT_KEYS = ['jade', 'sword', 'pagoda', 'star'];
export const SUIT_CODES = ['j', 's', 'p', 't'];

export const DOG = 52;
export const MJ = 53; // 참새 (숫자 1)
export const PHX = 54;
export const DRG = 55;
export const DECK_SIZE = 56;

/** @param {number} id @returns {boolean} 특수 카드인가 */
export const isSpecial = (id) => id >= 52;
/** @param {number} id @returns {number} 무늬 0~3, 특수 카드는 -1 */
export const suitOf = (id) => (id < 52 ? Math.floor(id / 13) : -1);

/**
 * 카드의 숫자 값. 참새 1, 용 15. 개는 0, 봉황은 상황에 따라 달라져서 -1(와일드).
 * @param {number} id 카드 id
 * @returns {number} 숫자
 */
export function rankOf(id) {
  if (id < 52) return (id % 13) + 2;
  if (id === MJ) return 1;
  if (id === DRG) return 15;
  if (id === DOG) return 0;
  return -1;
}

/** @param {number} id @returns {number} 카드 점수(5=5, 10=10, K=10, 용 +25, 봉황 −25) */
export function pointsOf(id) {
  if (id === DRG) return 25;
  if (id === PHX) return -25;
  if (id >= 52) return 0;
  const r = rankOf(id);
  return r === 5 ? 5 : r === 10 || r === 13 ? 10 : 0;
}

/** @param {number[]} ids @returns {number} 점수 합 */
export const pointsSum = (ids) => ids.reduce((s, id) => s + pointsOf(id), 0);

const RANK_LABEL = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
/** @param {number} r 숫자 @returns {string} 카드에 적히는 글자 */
export const rankLabel = (r) => RANK_LABEL[r] || String(r);

const SPECIAL_CODES = { 52: 'DOG', 53: 'MJ', 54: 'PHX', 55: 'DRG' };
const CODE_TO_ID = Object.fromEntries(Object.entries(SPECIAL_CODES).map(([id, c]) => [c, Number(id)]));

/** @param {number} id @returns {string} 목업과 같은 카드 코드('5j', 'DOG' …) */
export function codeOf(id) {
  return id >= 52 ? SPECIAL_CODES[id] : `${rankLabel(rankOf(id))}${SUIT_CODES[suitOf(id)]}`;
}

/** @param {string} code 카드 코드 @returns {number} id (모르면 -1) */
export function idOf(code) {
  if (CODE_TO_ID[code] !== undefined) return CODE_TO_ID[code];
  const suit = SUIT_CODES.indexOf(code.slice(-1));
  const label = code.slice(0, -1);
  const rank = Object.keys(RANK_LABEL).find((k) => RANK_LABEL[k] === label);
  const r = rank ? Number(rank) : Number(label);
  if (suit < 0 || !(r >= 2 && r <= 14)) return -1;
  return suit * 13 + (r - 2);
}

/** 손패 정렬 키: 개 → 참새 → 2~A → 봉황 → 용. 같은 숫자는 무늬 순. */
function sortKey(id) {
  if (id === DOG) return -1;
  if (id === PHX) return 14.5;
  return rankOf(id) + (id < 52 ? suitOf(id) / 10 : 0);
}

/** @param {number[]} ids @returns {number[]} 정렬된 새 배열 */
export const sortHand = (ids) => ids.slice().sort((a, b) => sortKey(a) - sortKey(b));

/** @param {number} seed @returns {() => number} 시드 가능한 난수(mulberry32) */
export function seededRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param {number[]} arr 배열 @param {() => number} [rng] 난수
 * @returns {number[]} 섞은 새 배열
 */
export function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** @returns {number[]} 56장 전체 덱 */
export const fullDeck = () => Array.from({ length: DECK_SIZE }, (_, i) => i);
