/**
 * @fileoverview 연출 레이어. 클라이언트는 매 STATE마다 `#content`를 갈아엎으므로,
 * 배너·번쩍임 같은 연출은 재렌더로 지워지지 않는 `#fx` 레이어에 그린다(`attach()`로 렌더 뒤 다시 붙인다).
 */

/** @param {HTMLElement} stage 무대 @returns {{attach:()=>void, banner:(text:string, o?:object)=>void, flash:(color?:string)=>void, shake:(n?:number)=>void}} */
export function createFx(stage) {
  const layer = document.createElement('div');
  layer.id = 'fx';

  function attach() {
    if (layer.parentNode !== stage) stage.appendChild(layer);
  }

  /**
   * 큰 글자 배너.
   * @param {string} text 문구
   * @param {{sub?:string, cls?:string, ms?:number}} [o] sub: 작은 글씨, cls: 색 계열(bomb·dragon·call·grand·info), ms: 표시 시간
   */
  function banner(text, o = {}) {
    // 같은 자리에 여러 배너가 겹쳐 글자가 뭉개지지 않게, 새 배너가 나오면 이전 배너를 치운다(작은 안내가 큰 연출을 덮지는 않는다).
    const heavy = o.cls && o.cls !== 'info';
    for (const old of layer.querySelectorAll('.banner')) if (heavy || !old.classList.contains('heavy')) old.remove();
    if (!heavy && layer.querySelector('.banner.heavy')) return;
    const el = document.createElement('div');
    el.className = `banner ${o.cls || 'info'}${heavy ? ' heavy' : ''}`;
    el.innerHTML = `<b></b>${o.sub ? '<small></small>' : ''}`;
    el.querySelector('b').textContent = text;
    if (o.sub) el.querySelector('small').textContent = o.sub;
    layer.appendChild(el);
    setTimeout(() => el.remove(), o.ms || 1500);
  }

  /** 화면 전체 번쩍임. */
  function flash(color = '#fff') {
    const el = document.createElement('div');
    el.className = 'flash';
    el.style.background = color;
    layer.appendChild(el);
    setTimeout(() => el.remove(), 420);
  }

  /** 무대 흔들림. */
  function shake(n = 8) {
    const c = stage.querySelector('#content');
    if (!c || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    c.animate([
      { transform: 'translate(0,0)' }, { transform: `translate(${-n}px,${n / 2}px)` },
      { transform: `translate(${n}px,${-n / 2}px)` }, { transform: `translate(${-n / 2}px,0)` }, { transform: 'translate(0,0)' },
    ], { duration: 380, easing: 'ease-out' });
  }

  return { attach, banner, flash, shake };
}
