/**
 * @fileoverview 맞고 액션 메시지의 최소 ko/en 사전과 locale fallback을 제공한다.
 */

(() => {
  const messages = {
    ko: {
      'action.jjok': '쪽!',
      'action.ppeokSweep': '자뻑!',
    },
    en: {
      'action.jjok': 'Jjok!',
      'action.ppeokSweep': 'Jabbeok!',
    },
  };
  const requested = new URLSearchParams(location.search).get('lang')
    || document.documentElement.lang
    || 'ko';
  const locale = Object.hasOwn(messages, requested) ? requested : 'ko';
  window.MatgoI18n = {
    locale,
    /**
     * 메시지 키를 현재 locale로 변환한다.
     * @param {string} key 메시지 키
     * @returns {string} 번역 또는 한국어 fallback
     */
    t(key) {
      return messages[locale]?.[key] || messages.ko[key] || key;
    },
  };
})();
