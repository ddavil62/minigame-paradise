/**
 * @fileoverview 베네치아 아이템 숫자키 입력 판정 정책.
 */

/**
 * 일반 텍스트 편집 요소인지 확인한다. 게임 단어 입력창은 숫자키 아이템 사용을 우선한다.
 * @param {EventTarget|null} target 키 이벤트 대상
 * @returns {boolean} 아이템 단축키를 가로채면 안 되는 편집 요소 여부
 */
export function isProtectedEditable(target) {
  if (!target || typeof target !== 'object' || typeof target.closest !== 'function') return false;
  if (target.id === 'input-word') return false;
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]'));
}

/**
 * 키보드 이벤트를 아이템 슬롯 인덱스로 변환한다.
 * @param {KeyboardEvent} event 키보드 이벤트
 * @returns {number|null} 슬롯 인덱스 또는 무시 시 null
 */
export function getItemSlotIndex(event) {
  if (event.isComposing || event.key === 'Process' || event.keyCode === 229) return null;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  if (isProtectedEditable(event.target)) return null;

  const codeMap = {
    Digit1: 0, Digit2: 1, Digit3: 2,
    Numpad1: 0, Numpad2: 1, Numpad3: 2,
  };
  if (Object.prototype.hasOwnProperty.call(codeMap, event.code)) return codeMap[event.code];
  if (event.code) return null;
  return ({ '1': 0, '2': 1, '3': 2 })[event.key] ?? null;
}
