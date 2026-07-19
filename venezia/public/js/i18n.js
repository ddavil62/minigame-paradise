/**
 * @fileoverview 베네치아의 변경된 아이템·도움말 문구를 한국어와 영어로 제공한다.
 */

const COPY = {
  ko: {
    item_bomb: { emoji: '🧨', name: '단어 폭탄' },
    item_freeze: { emoji: '🌊', name: '급류' },
    item_dark: { emoji: '🌑', name: '암흑' },
    item_shield: { emoji: '🛡️', name: '방어막' },
    item_heal: { emoji: '💚', name: '회복' },
    emptySlot: '비어 있음',
    fastFallStart: '🌊 급류! 낙하 속도 2배',
  },
  en: {
    item_bomb: { emoji: '🧨', name: 'Word Bomb' },
    item_freeze: { emoji: '🌊', name: 'Rapids' },
    item_dark: { emoji: '🌑', name: 'Darkness' },
    item_shield: { emoji: '🛡️', name: 'Shield' },
    item_heal: { emoji: '💚', name: 'Heal' },
    emptySlot: 'Empty',
    fastFallStart: '🌊 Rapids! Fall speed ×2',
  },
};

/**
 * 현재 문서 언어를 지원 언어 코드로 정규화한다.
 * @returns {'ko'|'en'} 언어 코드
 */
export function getLanguage() {
  return document.documentElement.lang.toLowerCase().startsWith('en') ? 'en' : 'ko';
}

/**
 * 아이템 ID에 대응하는 현지화 표시 정보를 반환한다.
 * @param {string} itemId 아이템 프로토콜 ID
 * @returns {{emoji:string, name:string}} 표시 정보
 */
export function getItemPresentation(itemId) {
  return COPY[getLanguage()][itemId] || { emoji: '❔', name: itemId };
}

/**
 * 일반 UI 문구를 반환한다.
 * @param {'emptySlot'|'fastFallStart'} key 문구 키
 * @returns {string} 번역 문구
 */
export function t(key) {
  return COPY[getLanguage()][key] || key;
}
