/**
 * @fileoverview 연출 레이어. 클라이언트는 매 STATE마다 `#content`를 갈아엎으므로,
 * 배너·번쩍임 같은 연출은 재렌더로 지워지지 않는 `#fx` 레이어에 그린다(`attach()`로 렌더 뒤 다시 붙인다).
 */

/** @param {HTMLElement} stage 무대 @returns {{attach:()=>void, banner:(text:string, o?:object)=>void, special:(kind:string, o?:object)=>void, flash:(color?:string)=>void, shake:(n?:number)=>void}} */
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

  /**
   * 특수 카드(용·봉황·개·참새)를 냈을 때 화면 중앙에 카드를 크게 보여 주는 연출.
   * 낸 사람 쪽에서 날아와 가운데에서 멈췄다가 사라진다(개는 선을 넘겨받는 사람 쪽으로 빠져나간다).
   * @param {'drg'|'phx'|'dog'|'spr'} kind 카드 종류(CSS 색·애니메이션 선택)
   * @param {{card:string, name:string, sub?:string, from?:number[], to?:number[], ms?:number}} o card: 카드 HTML, from/to: 출발·도착 화면 오프셋(px)
   */
  function special(kind, o) {
    for (const old of layer.querySelectorAll('.special')) old.remove();
    const ms = o.ms || 1500;
    const [sx, sy] = o.from || [0, 120];
    const [ex, ey] = o.to || [0, -40];
    const el = document.createElement('div');
    el.className = `special ${kind}`;
    el.style.cssText = `--sx:${sx}px;--sy:${sy}px;--ex:${ex}px;--ey:${ey}px;--ms:${ms}ms;--es:${o.to ? 0.7 : 1.9}`;
    el.innerHTML = `<i class="gl"></i><i class="rays"></i><div class="sc">${o.card}</div><div class="cap"><b></b><small></small></div>`;
    el.querySelector('.cap b').textContent = o.name;
    el.querySelector('.cap small').textContent = o.sub || '';
    if (kind === 'drg' || kind === 'phx') {
      for (let i = 0; i < 16; i++) {
        const u = document.createElement('u');
        u.style.cssText = `--px:${Math.round((Math.random() - 0.5) * 300)}px;--d:${Math.round(Math.random() * 600)}ms;--sz:${3 + Math.round(Math.random() * 5)}px`;
        el.appendChild(u);
      }
    }
    layer.appendChild(el);
    setTimeout(() => el.remove(), ms + 100);
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

  return { attach, banner, special, flash, shake };
}
