/**
 * @fileoverview 한국어 단어 DB 로드 + 검증 유틸리티.
 *
 * 서버 시작 시 data/words.json을 메모리에 완전 로드(Set)하고,
 * 단어 유효성 검증, 두음법칙과 막힘 종성 대체 글자 계산을 제공한다.
 * 런타임에 외부 API 호출 없이 완전 오프라인으로 동작한다.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── 단어 DB 로드 ────────────────────────────────────────────────

/**
 * 전체 단어 집합. 항상 같은 Set 인스턴스를 in-place로 갱신한다(재할당 금지).
 * server.js가 이 Set을 한 번 참조로 받아 계속 쓰기 때문에, reload 시에도 참조가
 * 유지되어야 진행 중인 게임과 이후 게임 모두 새 단어를 즉시 인식한다.
 * @type {Set<string>}
 */
const WORD_SET = new Set();

/**
 * 글자별 후속 단어 수 맵. WORD_SET과 동일하게 항상 같은 Map 인스턴스를
 * in-place로 갱신한다.
 * @type {Map<string, number>}
 */
const FOLLOWER_COUNT_MAP = new Map();

/** 정밀타 목표 후보 생성에 사용하는 사전 끝 글자 빈도 맵. */
const ENDING_CHARACTER_COUNT_MAP = new Map();

/**
 * data/words.json을 (재)로드하여 WORD_SET을 in-place로 갱신한다.
 * 서버 시작 시 1회 호출되며, 사전 파일이 바뀌면(예: `npm run build-words` 재실행)
 * 다시 호출해 핫리로드할 수 있다.
 * @returns {Set<string>} 갱신된 단어 Set (항상 동일 인스턴스)
 */
export function loadWords() {
  const jsonPath = path.join(__dirname, 'data', 'words.json');
  const raw = fs.readFileSync(jsonPath, 'utf8');
  const data = JSON.parse(raw);
  WORD_SET.clear();
  for (const word of data.words) WORD_SET.add(word);
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

/** 사전 단어의 마지막 글자 빈도를 in-place로 다시 계산한다. */
export function buildEndingCharacterCountMap() {
  ENDING_CHARACTER_COUNT_MAP.clear();
  for (const word of WORD_SET) {
    const ending = [...word].at(-1);
    if (ending) ENDING_CHARACTER_COUNT_MAP.set(ending, (ENDING_CHARACTER_COUNT_MAP.get(ending) ?? 0) + 1);
  }
  return ENDING_CHARACTER_COUNT_MAP;
}

/** 현재 끝 글자 빈도 맵을 반환한다. */
export function getEndingCharacterCountMap() {
  return ENDING_CHARACTER_COUNT_MAP;
}

// ── 두음법칙 변환 테이블 ─────────────────────────────────────────

/**
 * 두음법칙 변환 테이블(초성+중성 기준, 받침 없는 형태).
 * 한글맞춤법 제10~12항: 어두의 "녀/뇨/뉴/니", "랴/려/례/료/류/리", "라/래/로/뢰/루/르"는
 * 각각 "여/요/유/이", "야/여/예/요/유/이", "나/내/노/뇌/누/느"로 적는다.
 * 이 규칙은 받침(종성)과 무관하게 초성+중성 조합에만 적용되므로, 이 표는 받침 없는
 * 형태만 담고 실제 매칭은 {@link matchesStartChar}에서 자모 분해로 받침을 보존한 채 적용한다.
 * @type {Record<string, string>}
 */
export const DUEUM_MAP = {
  '녀': '여', '뇨': '요', '뉴': '유', '니': '이',
  '랴': '야', '려': '여', '례': '예', '료': '요',
  '류': '유', '리': '이',
  '라': '나', '래': '내', '로': '노', '뢰': '뇌',
  '루': '누', '르': '느',
};

// ── 한글 자모 분해/조합 (두음법칙 받침 무관 일반화용) ──────────────

const HANGUL_BASE = 0xAC00;
const HANGUL_LAST = 0xD7A3;
const JUNG_COUNT = 21;
const JONG_COUNT = 28;

/**
 * 완성형 한글 음절 한 글자를 (초성,중성,종성) 인덱스로 분해한다.
 * @param {string} syllable
 * @returns {{cho: number, jung: number, jong: number}|null} 한글 완성형이 아니면 null
 */
function decomposeHangul(syllable) {
  const code = syllable.charCodeAt(0);
  if (code < HANGUL_BASE || code > HANGUL_LAST) return null;
  const offset = code - HANGUL_BASE;
  const jong = offset % JONG_COUNT;
  const jung = Math.floor(offset / JONG_COUNT) % JUNG_COUNT;
  const cho = Math.floor(offset / JONG_COUNT / JUNG_COUNT);
  return { cho, jung, jong };
}

/**
 * (초성,중성,종성) 인덱스를 완성형 한글 음절 한 글자로 조합한다.
 * @param {number} cho
 * @param {number} jung
 * @param {number} jong
 * @returns {string}
 */
function composeHangul(cho, jung, jong) {
  return String.fromCharCode(HANGUL_BASE + (cho * JUNG_COUNT + jung) * JONG_COUNT + jong);
}

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
 * 글자의 두음법칙 변환형을 계산한다. 받침(종성)과 무관하게 초성+중성 조합에만
 * 적용되므로, 자모 분해해 받침을 보존한 채 초성+중성만 변환한다.
 * 예: "력"(려+ㄱ) → "역". 변환은 DUEUM_MAP이 정의한 방향(라→나 계열)으로만
 * 적용되며 역방향은 허용하지 않는다.
 * @param {string} syllable 변환 대상 글자
 * @returns {string|null} 두음법칙 변환형. 적용 대상이 아니면 null
 */
export function getDueumAlt(syllable) {
  const d = decomposeHangul(syllable);
  if (!d) return null;

  const base = composeHangul(d.cho, d.jung, 0);
  const mappedBase = DUEUM_MAP[base];
  if (!mappedBase) return null;

  const mapped = decomposeHangul(mappedBase);
  const alt = composeHangul(mapped.cho, mapped.jung, d.jong);
  return alt !== syllable ? alt : null;
}

/**
 * 시작 글자가 요구 글자와 일치하는지 두음법칙 포함 검증한다.
 * @param {string} wordFirstChar 제출 단어의 첫 글자
 * @param {string} requiredChar 요구되는 시작 글자
 * @returns {boolean}
 */
export function matchesStartChar(wordFirstChar, requiredChar) {
  if (wordFirstChar === requiredChar) return true;
  const alt = getDueumAlt(requiredChar);
  return alt !== null && wordFirstChar === alt;
}

// ── 막힘/희귀 종성 판정 ────────────────────────────────────────

/** 막힘/희귀 종성 발동 임계값. 후속 단어 수가 이 값 미만이면 대체 글자 확장 대상. */
const DEAD_END_THRESHOLD = 6;

/**
 * 글자별 후속 단어 수 맵을 빌드한다. (서버 시작 시 1회)
 * 후속 단어 수란 해당 글자가 끝 글자로 요구될 때 matchesStartChar()가
 * true를 반환하는 단어의 수다. 두음법칙 변환 글자로 시작하는 단어를 포함한다.
 * @returns {Map<string, number>} 글자 → 후속 단어 수
 */
export function buildFollowerCountMap() {
  // 글자별 직접 시작 단어 수
  const directCountMap = new Map();
  for (const word of WORD_SET) {
    const ch = word[0];
    directCountMap.set(ch, (directCountMap.get(ch) ?? 0) + 1);
  }

  // 모든 끝 글자 집합 수집
  const endSyllables = new Set();
  for (const word of WORD_SET) {
    endSyllables.add(word[word.length - 1]);
  }

  // WORD_SET과 동일한 이유로 in-place 갱신: server.js가 참조를 계속 들고 쓴다.
  FOLLOWER_COUNT_MAP.clear();
  for (const syllable of endSyllables) {
    const d = decomposeHangul(syllable);
    let directCount = directCountMap.get(syllable) ?? 0;
    let altCount = 0;

    if (d) {
      // 요구 글자의 초성+중성(받침 제외)에 두음법칙이 적용되는지 조회
      const base = composeHangul(d.cho, d.jung, 0);
      const mappedBase = DUEUM_MAP[base];
      if (mappedBase) {
        const mappedD = decomposeHangul(mappedBase);
        if (mappedD) {
          const altChar = composeHangul(mappedD.cho, mappedD.jung, d.jong);
          if (altChar !== syllable) {
            altCount = directCountMap.get(altChar) ?? 0;
          }
        }
      }
    }

    FOLLOWER_COUNT_MAP.set(syllable, directCount + altCount);
  }

  console.log(`[words] 후속 단어 수 맵 빌드 완료: ${FOLLOWER_COUNT_MAP.size}개 글자`);
  return FOLLOWER_COUNT_MAP;
}

/**
 * 끝 글자의 후속 단어 수가 임계값 미만일 때 대체 시작 글자 집합을 계산한다.
 * 받침(종성) 있는 글자에 한해 받침 제거 형태를 추가 허용한다.
 * @param {string} syllable 끝 글자
 * @param {Map<string, number>} followerCountMap 글자별 후속 단어 수 맵
 * @param {number} [threshold=6] 발동 임계값 (미만)
 * @returns {Set<string>|null} 대체 허용 글자 집합, 임계값 이상이면 null
 */
export function computeDeadEndAlts(syllable, followerCountMap, threshold = DEAD_END_THRESHOLD) {
  const followerCount = followerCountMap.get(syllable) ?? 0;
  if (followerCount >= threshold) {
    return null; // 정상 케이스, 확장 불필요
  }

  const d = decomposeHangul(syllable);
  if (d === null) {
    return null; // 비한글, 안전 폴백
  }

  const alts = new Set();
  alts.add(syllable); // 항상 원래 글자 포함

  // 기존 두음법칙 변환 (matchesStartChar와 동일 로직)
  const dueumAlt = getDueumAlt(syllable);
  if (dueumAlt) {
    alts.add(dueumAlt);
  }

  // 받침 제거 확장 — 받침이 있는 경우에만 적용
  if (d.jong > 0) {
    const base = composeHangul(d.cho, d.jung, 0);
    const noJong = base; // 받침 없는 형태
    alts.add(noJong);
    // 받침 제거 후에도 두음법칙 적용 가능하면 추가
    const mappedBase = DUEUM_MAP[base];
    if (mappedBase) {
      alts.add(mappedBase); // DUEUM_MAP의 변환값(받침 없는 형태)
    }
  }

  return alts;
}
