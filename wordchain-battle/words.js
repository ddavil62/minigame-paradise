/**
 * @fileoverview 한국어 단어 DB 로드 + 검증 유틸리티.
 *
 * 서버 시작 시 data/words.json을 메모리에 완전 로드(Set)하고,
 * 단어 유효성 검증·두음법칙 처리·가비지 후보 맵 생성을 제공한다.
 * 런타임에 외부 API 호출 없이 완전 오프라인으로 동작한다.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── 단어 DB 로드 ────────────────────────────────────────────────

/** @type {Set<string>} 전체 단어 집합 (서버 시작 시 1회 로드) */
let WORD_SET = new Set();

/**
 * data/words.json을 로드하여 WORD_SET을 초기화한다.
 * @returns {Set<string>} 로드된 단어 Set
 */
export function loadWords() {
  const jsonPath = path.join(__dirname, 'data', 'words.json');
  const raw = fs.readFileSync(jsonPath, 'utf8');
  const data = JSON.parse(raw);
  WORD_SET = new Set(data.words);
  console.log(`[words] 단어 DB 로드 완료: ${WORD_SET.size}개`);
  return WORD_SET;
}

/**
 * 로드된 단어 Set을 반환한다.
 * @returns {Set<string>}
 */
export function getWordSet() {
  return WORD_SET;
}

// ── 두음법칙 변환 테이블 ─────────────────────────────────────────

/**
 * 두음법칙 변환 테이블.
 * 끝말잇기에서 앞 단어 끝 글자가 key일 때, value 글자로 시작하는 단어도 허용.
 * @type {Record<string, string>}
 */
export const DUEUM_MAP = {
  '녀': '여', '뇨': '요', '뉴': '유', '니': '이',
  '랴': '야', '려': '여', '례': '예', '료': '요',
  '류': '유', '리': '이',
  '라': '나', '래': '내', '로': '노', '뢰': '뇌',
  '루': '누', '르': '느',
};

// ── 한글 검증 ───────────────────────────────────────────────────

/** 한글 완성형 음절 정규식 */
const HANGUL_RE = /^[가-힣]+$/;

/**
 * 문자열이 한글 완성형으로만 구성되어 있는지 검증한다.
 * @param {string} word
 * @returns {boolean}
 */
export function isKorean(word) {
  return typeof word === 'string' && word.length >= 2 && HANGUL_RE.test(word);
}

// ── 단어 검증 ───────────────────────────────────────────────────

/**
 * 단어가 사전에 있는지 검증한다.
 * @param {string} word
 * @returns {boolean}
 */
export function isValidWord(word) {
  return WORD_SET.has(word);
}

/**
 * 끝 글자를 반환한다. (받침 포함 완성형 음절 그대로)
 * @param {string} word
 * @returns {string}
 */
export function getLastSyllable(word) {
  return word[word.length - 1];
}

/**
 * 시작 글자가 요구 글자와 일치하는지 두음법칙 포함 검증한다.
 * @param {string} wordFirstChar 제출 단어의 첫 글자
 * @param {string} requiredChar 요구되는 시작 글자
 * @returns {boolean}
 */
export function matchesStartChar(wordFirstChar, requiredChar) {
  if (wordFirstChar === requiredChar) return true;
  // 두음법칙: requiredChar가 key이고 wordFirstChar가 value인 경우
  return DUEUM_MAP[requiredChar] === wordFirstChar;
}

// ── 가비지 음절 후보 ────────────────────────────────────────────

/**
 * 가비지 음절 후보 맵을 생성한다. (서버 시작 시 1회)
 * 각 글자로 시작하는 유효 단어 수를 세고, minCount 이상인 글자만 포함한다.
 * @param {number} [minCount=50] 최소 유효 단어 수
 * @returns {Map<string, number>} syllable -> 해당 글자로 시작하는 단어 수
 */
export function buildGarbageCandidates(minCount = 50) {
  const initialsMap = new Map();
  for (const word of WORD_SET) {
    const first = word[0];
    initialsMap.set(first, (initialsMap.get(first) || 0) + 1);
  }

  /** @type {Map<string, number>} */
  const candidates = new Map();
  for (const [syllable, count] of initialsMap) {
    if (count >= minCount) {
      candidates.set(syllable, count);
    }
  }

  console.log(`[words] 가비지 후보: ${candidates.size}개 글자 (N>=${minCount})`);
  return candidates;
}

/**
 * 랜덤 가비지 음절을 선택한다.
 * 상대의 현재 lastSyllable과 동일하거나 두음법칙 변환값인 글자는 제외한다.
 * @param {Map<string, number>} candidates 가비지 후보 맵
 * @param {string|null} excludeChar 제외할 글자 (상대의 현재 시작 글자)
 * @returns {string} 선택된 가비지 음절
 */
export function pickGarbageSyllable(candidates, excludeChar = null) {
  const keys = [...candidates.keys()].filter((ch) => {
    if (!excludeChar) return true;
    // 상대가 이미 이 글자로 시작해야 하는 상황이면 제외
    return !matchesStartChar(ch, excludeChar) && !matchesStartChar(excludeChar, ch);
  });

  if (keys.length === 0) {
    // 후보가 없으면 제외 없이 선택
    const allKeys = [...candidates.keys()];
    return allKeys[Math.floor(Math.random() * allKeys.length)];
  }

  return keys[Math.floor(Math.random() * keys.length)];
}
