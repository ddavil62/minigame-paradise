/**
 * @fileoverview 끝말잇기 배틀 AI의 순수 단어 선택기.
 * 사전 인덱스와 현재 공개 상태만 사용하며 WebSocket이나 게임 상태를 직접 변경하지 않는다.
 */

import { getLastSyllable, matchesStartChar } from './words.js';

/** 안전 후보로 간주할 최소 후속 단어 수. */
const MIN_SAFE_FOLLOW_UPS = 2;

/**
 * 후보 가중치 상한. 이 값 이상의 followUps는 모두 동일한 가중치로 취급해,
 * 극단적으로 연결이 많은 종성(예: "이", "리")으로 매번 수렴하지 않게 한다.
 * 사람 플레이어는 항상 최선의 수만 두지 않으므로, 안전한 후보 풀 안에서
 * 다양하게 골라야 자연스럽고 상대하기 쉬운 난이도가 된다.
 * (낮을수록 안전 후보 사이의 확률이 더 고르게 퍼져 AI가 덜 최적화된 선택을 한다.)
 */
const FOLLOW_UP_WEIGHT_CAP = 4;

/**
 * 매 턴 AI가 "안전 후보(followUps >= MIN_SAFE_FOLLOW_UPS)" 제한을 무시하고
 * 위험한 후보까지 포함한 전체 풀에서 고를 확률. 실제 사람도 항상 최선의
 * 연결성을 계산하지 않고 가끔 허점 있는 단어를 두기 때문에, 이 확률만큼
 * AI도 실수를 흉내내 체감 난이도를 낮춘다.
 * rng: () => 0 인 결정론적 테스트에서는 절대 발동하지 않도록
 * rng() >= (1 - MISTAKE_PROBABILITY) 조건을 사용한다.
 */
const MISTAKE_PROBABILITY = 0.25;

/**
 * @typedef {Object} AiPlayerState
 * @property {number} gauge 현재 공격 게이지
 * @property {string|null} forced 가비지로 강제된 시작 글자
 * @property {string|null} lastSyllable 자기 체인의 다음 시작 글자
 */

/**
 * 단어 iterable을 한 번만 순회해 AI 선택기를 만든다.
 * @param {Iterable<string>} words 서버와 동일한 유효 단어 모음
 * @returns {{ chooseAiWord: (input: {player: AiPlayerState, usedWords: Set<string>, rng?: () => number, excludedWords?: Set<string>}) => string|null }}
 */
export function createAiChooser(words) {
  /** @type {Map<string, string[]>} */
  const wordsByFirst = new Map();
  /** @type {string[]} */
  const allWords = [];
  /** @type {Map<string, string[]>} 요구 글자별 두음법칙 포함 후보 캐시. */
  const requiredCandidatesCache = new Map();

  for (const word of words) {
    if (typeof word !== 'string' || word.length < 2) continue;
    allWords.push(word);
    const first = word[0];
    if (!wordsByFirst.has(first)) wordsByFirst.set(first, []);
    wordsByFirst.get(first).push(word);
  }

  /**
   * 요구 글자를 만족하는 인덱스 후보를 반환한다.
   * @param {string|null} required 시작 요구 글자
   * @returns {string[]}
   */
  function getCandidates(required) {
    if (!required) return allWords;
    if (requiredCandidatesCache.has(required)) return requiredCandidatesCache.get(required);
    const result = [];
    for (const [first, indexedWords] of wordsByFirst) {
      if (matchesStartChar(first, required)) result.push(...indexedWords);
    }
    requiredCandidatesCache.set(required, result);
    return result;
  }

  /**
   * 후보 뒤에 이을 수 있는 미사용 단어 수를 센다.
   * @param {string} word 평가할 단어
   * @param {Set<string>} unavailable 사용 또는 제외된 단어 집합
   * @returns {number}
   */
  function countFollowUps(word, unavailable) {
    const required = getLastSyllable(word);
    let count = getCandidates(required).length;
    for (const unavailableWord of unavailable) {
      if (matchesStartChar(unavailableWord[0], required)) count -= 1;
    }
    if (!unavailable.has(word) && matchesStartChar(word[0], required)) count -= 1;
    return Math.max(0, count);
  }

  /**
   * 현재 상태에서 제출할 단어를 고른다. 입력 객체와 Set은 변경하지 않는다.
   * @param {{player: AiPlayerState, usedWords: Set<string>, rng?: () => number, excludedWords?: Set<string>}} input
   * @returns {string|null}
   */
  function chooseAiWord({ player, usedWords, rng = Math.random, excludedWords = new Set() }) {
    if (!player || !(usedWords instanceof Set)) return null;
    const required = player.forced || player.lastSyllable || null;
    const unavailable = new Set([...usedWords, ...excludedWords]);
    const candidates = getCandidates(required).filter((word) => !unavailable.has(word));
    if (candidates.length === 0) return null;

    const ranked = candidates.map((word) => ({
      word,
      followUps: countFollowUps(word, unavailable),
    }));
    const safe = ranked.filter((entry) => entry.followUps >= MIN_SAFE_FOLLOW_UPS);
    // 위험한 후보가 실제로 존재할 때만 실수 확률을 굴린다. rng()가 0에 가까우면
    // (결정론적 테스트 포함) 절대 실수하지 않고 항상 안전 후보를 우선한다.
    const makesMistake = safe.length > 0
      && safe.length < ranked.length
      && rng() >= (1 - MISTAKE_PROBABILITY);
    const pool = (safe.length > 0 && !makesMistake) ? safe : ranked;

    pool.sort((a, b) => (
      b.followUps - a.followUps
      || a.word.localeCompare(b.word, 'ko')
    ));

    // 안전한 후보 전체에서 followUps 비례 가중치로 뽑되, FOLLOW_UP_WEIGHT_CAP으로
    // 상한을 둬 소수의 초연결 종성(이/리 등)에 확률이 쏠리지 않게 한다.
    // rng()가 0에 가까우면 최선의 수(정렬상 첫 후보)를 그대로 고른다.
    const weights = pool.map((entry) => Math.min(entry.followUps, FOLLOW_UP_WEIGHT_CAP) + 1);
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    const normalized = Math.min(0.999999, Math.max(0, Number(rng()) || 0));
    let remaining = normalized * totalWeight;
    for (let i = 0; i < pool.length; i += 1) {
      remaining -= weights[i];
      if (remaining <= 0) return pool[i].word;
    }
    return pool[pool.length - 1].word;
  }

  return { chooseAiWord };
}
