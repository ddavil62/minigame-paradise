/**
 * @fileoverview 게임 전역 키 입력과 브라우저 기본 키보드 활성화를 구분한다.
 */

/**
 * 이벤트 대상이 네이티브 Enter/Space 동작을 보존해야 하는 요소인지 확인한다.
 * @param {EventTarget|null|undefined} target 키 이벤트 대상
 * @returns {boolean} 게임 입력 매핑을 건너뛸지 여부
 */
export function isNativeKeyboardTarget(target) {
  if (!target || typeof target.closest !== 'function') return false;
  return Boolean(target.closest('button,a,input,select,textarea') || target.closest('[contenteditable]'));
}
