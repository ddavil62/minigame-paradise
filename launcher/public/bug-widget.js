/**
 * @fileoverview 공통 버그리포트 위젯 — 런처 미들웨어가 모든 HTML 페이지의 `</body>` 앞에 자동 주입한다.
 *
 *   게임 10종 + 런처 로비 어디서든 우하단 🐛 버튼 → 텍스트 패널 → 제출 흐름으로
 *   버그 신고를 받아 `POST /bug-report`로 전송한다. 신고에는 자동 메타데이터
 *   (gameId / timestamp / screenSize / url)가 함께 첨부된다.
 *
 *   CSS 충돌 방지: 모든 클래스는 `.bw-` prefix를 사용하고, 게임 오버레이보다 높은
 *   z-index(≥9000)를 가진다 (상세는 bug-widget.css).
 *
 *   외부 의존성 없음 (바닐라 JS + Fetch API).
 */

(() => {
  'use strict';

  // 중복 주입 방어: 동일 페이지에 스크립트가 두 번 들어와도 위젯은 1회만 생성한다.
  if (window.__bwWidgetLoaded) return;
  window.__bwWidgetLoaded = true;

  // ── 메타데이터 헬퍼 ──────────────────────────────────────────

  /**
   * URL pathname 첫 segment에서 gameId를 파싱한다.
   *   `/matgo/`              → 'matgo'
   *   `/tetris-battle/game`  → 'tetris-battle'
   *   `/`                    → 'launcher'
   * @returns {string} 게임 식별자(로비는 'launcher')
   */
  function getGameId() {
    const segments = location.pathname.split('/').filter(Boolean);
    return segments.length > 0 ? segments[0] : 'launcher';
  }

  // ── DOM 생성 ────────────────────────────────────────────────

  /**
   * 위젯 DOM(FAB 버튼 / 입력 패널 / 토스트)을 동적으로 생성해 body에 append 한다.
   * @returns {void}
   */
  function injectDOM() {
    // FAB 버튼 — 우하단 고정 🐛 아이콘
    const fab = document.createElement('button');
    fab.className = 'bw-fab';
    fab.id = 'bw-fab';
    fab.type = 'button';
    fab.title = '버그 신고';
    fab.setAttribute('aria-label', '버그 신고');
    fab.textContent = '🐛';

    // 입력 패널 — FAB 위에 펼쳐짐
    const panel = document.createElement('div');
    panel.className = 'bw-panel';
    panel.id = 'bw-panel';
    panel.hidden = true;
    panel.innerHTML =
      '<div class="bw-panel-header">' +
      '<span>버그 신고</span>' +
      '<button class="bw-close" id="bw-close" type="button" aria-label="닫기">✕</button>' +
      '</div>' +
      '<textarea class="bw-textarea" id="bw-textarea" placeholder="어떤 문제가 발생했나요?" rows="4" maxlength="1000"></textarea>' +
      '<button class="bw-submit" id="bw-submit" type="button">제출</button>';

    // 토스트 — "기록됨"
    const toast = document.createElement('div');
    toast.className = 'bw-toast';
    toast.id = 'bw-toast';
    toast.hidden = true;
    toast.textContent = '기록됨';

    document.body.appendChild(fab);
    document.body.appendChild(panel);
    document.body.appendChild(toast);
  }

  // ── 패널 열기/닫기 ──────────────────────────────────────────

  /**
   * 입력 패널을 열고 textarea에 포커스를 준다.
   * @returns {void}
   */
  function openPanel() {
    document.getElementById('bw-panel').hidden = false;
    document.getElementById('bw-textarea').focus();
  }

  /**
   * 입력 패널을 닫는다.
   * @returns {void}
   */
  function closePanel() {
    document.getElementById('bw-panel').hidden = true;
  }

  // ── 토스트 ──────────────────────────────────────────────────

  /** 토스트 자동 숨김 타이머 핸들. @type {number|null} */
  let toastTimer = null;

  /**
   * "기록됨" 토스트를 약 2초간 표시한다.
   * @returns {void}
   */
  function showToast() {
    const toast = document.getElementById('bw-toast');
    toast.hidden = false;
    if (toastTimer !== null) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.hidden = true;
      toastTimer = null;
    }, 2000);
  }

  // ── 제출 ────────────────────────────────────────────────────

  /**
   * 입력 텍스트 + 자동 메타데이터를 `POST /bug-report`로 전송한다.
   * 빈 텍스트는 무시하고, 제출 중에는 버튼을 비활성화해 double-submit을 방지한다.
   * @returns {Promise<void>}
   */
  async function submitReport() {
    const textarea = document.getElementById('bw-textarea');
    const submitBtn = document.getElementById('bw-submit');
    const text = textarea.value.trim();

    // 빈 텍스트(공백만) → 서버 요청 없이 무시
    if (!text) return;

    // double-submit 방지: 진행 중이면 버튼 비활성화
    submitBtn.disabled = true;

    const payload = {
      text,
      gameId: getGameId(),
      timestamp: new Date().toISOString(),
      screenSize: { w: screen.width, h: screen.height },
      url: location.href,
    };

    try {
      const resp = await fetch('/bug-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (resp.ok) {
        textarea.value = '';
        closePanel();
        showToast();
      } else {
        console.error('[bug-widget] 서버 오류:', resp.status);
      }
    } catch (err) {
      console.error('[bug-widget] fetch 실패:', err.message);
    } finally {
      submitBtn.disabled = false;
    }
  }

  // ── 초기화 ──────────────────────────────────────────────────

  /**
   * 위젯 DOM을 생성하고 이벤트를 바인딩한다.
   * @returns {void}
   */
  function init() {
    injectDOM();

    document.getElementById('bw-fab').addEventListener('click', openPanel);
    document.getElementById('bw-close').addEventListener('click', closePanel);
    document.getElementById('bw-submit').addEventListener('click', submitReport);

    // 패널 외부 클릭 시 닫기 (FAB·패널 자신 클릭은 제외)
    document.addEventListener('click', (e) => {
      const panel = document.getElementById('bw-panel');
      const fab = document.getElementById('bw-fab');
      if (!panel || panel.hidden) return;
      if (!panel.contains(e.target) && !fab.contains(e.target)) {
        closePanel();
      }
    });
  }

  // defer 스크립트이므로 DOM 파싱 완료 후 실행되지만, 안전하게 상태를 확인한다.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
