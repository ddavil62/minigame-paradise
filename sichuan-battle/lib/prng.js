/**
 * @fileoverview 사천성 배틀의 재현 가능한 32비트 난수와 시드 파생 유틸리티.
 */

/** @param {string|number} value 시드 원문 @returns {number} 32비트 시드 */
export function hashSeed(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** @param {string|number} seed 기본 시드 @param {string} domain 도메인 @returns {number} 파생 시드 */
export function deriveSeed(seed, domain) { return hashSeed(`${seed}:${domain}`); }

/** @param {string|number} seed 시드 @returns {() => number} 0 이상 1 미만 난수 함수 */
export function createPrng(seed) {
  let state = hashSeed(seed) || 0x9e3779b9;
  return () => {
    state |= 0;
    state = (state + 0x6D2B79F5) | 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** @template T @param {T[]} values 원본 배열 @param {() => number} random 난수 함수 @returns {T[]} 섞은 복사본 */
export function shuffled(values, random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}
