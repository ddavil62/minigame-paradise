/**
 * @fileoverview 마작 패 기본 정의. 패 id(0~135)와 종류(kind 0~33) 변환, 도라 계산을 담당한다.
 *
 * kind: 0~8 만수, 9~17 통수, 18~26 삭수, 27~30 동남서북, 31~33 백발중.
 * id: kind * 4 + 사본번호(0~3). 적도라는 5만·5통·5삭의 0번 사본(id 16, 52, 88)이다.
 */

export const KIND_COUNT = 34;
export const TILE_COUNT = 136;
export const RED_IDS = Object.freeze([16, 52, 88]);

/** @param {number} id 패 id @returns {number} 종류 */
export const kindOf = (id) => id >> 2;
/** @param {number} id 패 id @returns {boolean} 적도라 후보 id 여부 */
export const isRedId = (id) => id === 16 || id === 52 || id === 88;
/** @param {number} k 종류 @returns {boolean} 자패 여부 */
export const isHonor = (k) => k >= 27;
/** @param {number} k 종류 @returns {boolean} 수패 여부 */
export const isSuited = (k) => k < 27;
/** @param {number} k 수패 종류 @returns {number} 0 만, 1 통, 2 삭 */
export const suitOf = (k) => (k < 27 ? Math.floor(k / 9) : 3);
/** @param {number} k 종류 @returns {boolean} 노두패(1·9) 여부 */
export const isTerminal = (k) => k < 27 && (k % 9 === 0 || k % 9 === 8);
/** @param {number} k 종류 @returns {boolean} 요구패(노두+자패) 여부 */
export const isYaochuu = (k) => k >= 27 || isTerminal(k);
/** @param {number} k 종류 @returns {boolean} 삼원패 여부 */
export const isDragon = (k) => k >= 31;
/** @param {number} k 종류 @returns {boolean} 풍패 여부 */
export const isWind = (k) => k >= 27 && k <= 30;

export const YAOCHUU_KINDS = Object.freeze([0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33]);

const SUIT_KO = ['만', '통', '삭'];
const HONOR_KO = ['동', '남', '서', '북', '백', '발', '중'];

/** @param {number} k 종류 @returns {string} 한글 패 이름 (1만, 5통, 동 ...) */
export function kindNameKo(k) {
  if (k >= 27) return HONOR_KO[k - 27];
  return `${(k % 9) + 1}${SUIT_KO[Math.floor(k / 9)]}`;
}

/**
 * 도라 표시패 종류에서 실제 도라 종류를 구한다.
 * @param {number} k 표시패 종류
 * @returns {number} 도라 종류
 */
export function doraFromIndicator(k) {
  if (k < 27) return Math.floor(k / 9) * 9 + ((k % 9) + 1) % 9;
  if (k <= 30) return 27 + ((k - 27 + 1) % 4);
  return 31 + ((k - 31 + 1) % 3);
}

/**
 * @param {number[]} ids 패 id 배열
 * @returns {number[]} 길이 34의 종류별 개수
 */
export function toCounts(ids) {
  const c = new Array(KIND_COUNT).fill(0);
  for (const id of ids) c[id >> 2] += 1;
  return c;
}

/**
 * 시드 가능한 난수 생성기(mulberry32).
 * @param {number} seed 정수 시드
 * @returns {() => number} 0 이상 1 미만 난수 함수
 */
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
 * 136장을 섞은 산을 만든다.
 * @param {() => number} rng 난수 함수
 * @returns {number[]} 섞인 패 id
 */
export function shuffledTiles(rng = Math.random) {
  const arr = Array.from({ length: TILE_COUNT }, (_, i) => i);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * 패를 종류, id 순으로 정렬한 새 배열을 반환한다.
 * @param {number[]} ids 패 id
 * @returns {number[]} 정렬된 패 id
 */
export function sortTiles(ids) {
  return ids.slice().sort((a, b) => (a >> 2) - (b >> 2) || a - b);
}
