/**
 * @fileoverview 끝말잇기 배틀 AI의 순수 단어 선택기.
 * 사전 인덱스와 현재 공개 상태만 사용하며 WebSocket이나 게임 상태를 직접 변경하지 않는다.
 */

import { calcGaugeGain, MAX_GAUGE } from './game.js';
import { getLastSyllable, matchesStartChar } from './words.js';

/** 안전 후보로 간주할 최소 후속 단어 수. */
const MIN_SAFE_FOLLOW_UPS = 2;

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
      gain: calcGaugeGain(word.length),
      preferredLength: word.length >= 3 && word.length <= 5 ? 1 : 0,
    }));
    const safe = ranked.filter((entry) => entry.followUps >= MIN_SAFE_FOLLOW_UPS);
    let pool = safe.length > 0 ? safe : ranked;

    const gaugeNeeded = MAX_GAUGE - (Number(player.gauge) || 0);
    const finishing = pool.filter((entry) => entry.gain >= gaugeNeeded);
    if (finishing.length > 0) pool = finishing;

    pool.sort((a, b) => (
      b.followUps - a.followUps
      || b.preferredLength - a.preferredLength
      || b.gain - a.gain
      || a.word.localeCompare(b.word, 'ko')
    ));

    // 최고권 후보 안에서만 난수를 사용해 플레이가 매번 완전히 같아지는 것을 피한다.
    const bestFollowUps = pool[0].followUps;
    const top = pool.filter((entry) => entry.followUps >= Math.max(0, bestFollowUps - 2)).slice(0, 12);
    const normalized = Math.min(0.999999, Math.max(0, Number(rng()) || 0));
    return top[Math.floor(normalized * top.length)].word;
  }

  return { chooseAiWord };
}
