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
    itemGuide: '연속 정답 시 아이템 획득 확률 증가 · 숫자 1·2·3으로 사용',
    mediumDropGuide: '단어 색은 난이도를 나타내며, 아이템은 연속 정답 콤보에서 확률적으로 획득합니다.',
    backToMenu: '← 게임 선택',
    backConfirm: '게임을 중단하고 게임 선택 화면으로 돌아가시겠어요? 상대방도 함께 로비로 이동합니다.',
  },
  en: {
    item_bomb: { emoji: '🧨', name: 'Word Bomb' },
    item_freeze: { emoji: '🌊', name: 'Rapids' },
    item_dark: { emoji: '🌑', name: 'Darkness' },
    item_shield: { emoji: '🛡️', name: 'Shield' },
    item_heal: { emoji: '💚', name: 'Heal' },
    emptySlot: 'Empty',
    fastFallStart: '🌊 Rapids! Fall speed ×2',
    itemGuide: 'Longer combos improve item drop odds · Use with 1, 2, or 3',
    mediumDropGuide: 'Word colors indicate difficulty. Items drop randomly during correct-answer combos.',
    backToMenu: '← Game Select',
    backConfirm: 'Stop this game and return to game select? Your opponent will also return to the lobby.',
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
 * @param {'emptySlot'|'fastFallStart'|'itemGuide'|'mediumDropGuide'|'backToMenu'|'backConfirm'} key 문구 키
 * @returns {string} 번역 문구
 */
export function t(key) {
  return COPY[getLanguage()][key] || key;
}
