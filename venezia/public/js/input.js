/**
 * @fileoverview 베네치아 타이핑 배틀 한글 입력 처리.
 *
 * 한글 조합 중(composing) 정확도를 위해 composition 이벤트를 처리한다.
 * - compositionstart: 조합 시작 (조합 중 플래그 on)
 * - compositionupdate: 조합 중 (실시간 매칭 업데이트)
 * - compositionend: 조합 완료 (최종 확정)
 * - input: 일반 입력 (비조합 언어/붙여넣기 등)
 * - Enter/Space: 현재 타겟 단어 확정 제출
 */

/**
 * 입력 컨트롤러를 생성한다.
 * @param {HTMLInputElement} inputEl 입력 요소
 * @param {object} callbacks 콜백 객체
 * @param {(text: string) => void} callbacks.onInputChange 입력 변경 시
 * @param {(text: string) => void} callbacks.onSubmit 제출 시
 * @returns {object} 입력 컨트롤러
 */
export function createInputHandler(inputEl, callbacks) {
  /** 조합 중 플래그. */
  let isComposing = false;

  /**
   * 현재 입력값을 콜백에 전달한다.
   */
  function notifyChange() {
    const text = inputEl.value;
    if (typeof callbacks.onInputChange === 'function') {
      callbacks.onInputChange(text);
    }
  }

  /**
   * 현재 입력값을 제출하고 입력창을 비운다.
   */
  function submit() {
    const text = inputEl.value.trim();
    if (text.length === 0) return;
    if (typeof callbacks.onSubmit === 'function') {
      callbacks.onSubmit(text);
    }
    inputEl.value = '';
    notifyChange();
  }

  // ── 이벤트 리스너 ────────────────────────────────────────

  inputEl.addEventListener('compositionstart', () => {
    isComposing = true;
  });

  inputEl.addEventListener('compositionupdate', () => {
    // 조합 중에도 실시간 매칭 업데이트
    notifyChange();
  });

  inputEl.addEventListener('compositionend', () => {
    isComposing = false;
    notifyChange();
  });

  inputEl.addEventListener('input', () => {
    if (!isComposing) {
      notifyChange();
    }
  });

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !isComposing) {
      e.preventDefault();
      submit();
    }
  });

  return {
    /** 입력창을 포커스한다. */
    focus() { inputEl.focus(); },
    /** 입력창을 비운다. */
    clear() { inputEl.value = ''; notifyChange(); },
    /** 외부에서 제출을 트리거한다. */
    submit,
    /** 입력 오류 애니메이션을 재생한다. */
    showError() {
      const area = inputEl.closest('.input-area');
      if (area) {
        area.classList.add('input-error');
        setTimeout(() => area.classList.remove('input-error'), 300);
      }
    },
  };
}
