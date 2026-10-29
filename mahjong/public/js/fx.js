/**
 * @fileoverview 마작 연출: 패 비행·착지 충격, 팝업, 배너, 파티클.
 *
 * 매 STATE마다 무대(#stage)가 통째로 다시 그려지므로 연출은 재렌더로 지워지지 않는 별도 레이어(#fx)에 그린다.
 * 재렌더로 끊길 수 있는 짧은 연출(손패 돌리기 등)은 호출하는 쪽이 시작 시각을 기억했다가
 * `elapsed`(ms)를 넘겨 이어서 재생한다.
 */

const REDUCED = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const rand = (a, b) => a + Math.random() * (b - a);

/**
 * @param {HTMLElement} stage 폭이 가변(1200~1600px)인 무대(비율 축소 transform이 걸려 있음)
 */
export function createFx(stage) {
  const layer = document.createElement('div');
  layer.id = 'fx';
  /** 비행 중인 패 id → 착지 전까지 연못의 실제 패를 숨긴다 */
  const flights = new Map();

  const attach = () => { if (layer.parentElement !== stage) stage.appendChild(layer); };

  /** 화면 rect → 무대 좌표(중심 x,y / 크기 w,h) */
  function toStage(r) {
    const sr = stage.getBoundingClientRect();
    const sc = sr.width / stage.offsetWidth || 1;
    return { x: (r.left + r.width / 2 - sr.left) / sc, y: (r.top + r.height / 2 - sr.top) / sc, w: r.width / sc, h: r.height / sc };
  }

  function mk(cls, css = {}) {
    const e = document.createElement('div');
    e.className = cls;
    Object.assign(e.style, css);
    attach();
    layer.appendChild(e);
    return e;
  }

  function run(e, keyframes, opts) {
    const a = e.animate(keyframes, { fill: 'forwards', ...opts });
    a.onfinish = () => e.remove();
    return a;
  }

  /** 연못에서 id에 해당하는 패(눕힌 패면 래퍼) */
  function pondEl(id) {
    const t = stage.querySelector(`.pond [data-id="${id}"]`);
    if (!t) return null;
    return t.parentElement.classList.contains('rot') ? t.parentElement : t;
  }

  /** 재렌더 직후 호출: 비행 중인 패의 실제 자리를 다시 숨긴다 */
  function rehide() {
    for (const id of flights.keys()) {
      const d = pondEl(id);
      if (d) d.style.visibility = 'hidden';
    }
  }

  // ── 기본 이펙트 ──────────────────────────────────────────
  function ring(x, y, { color = '#ffe27a', r = 60, dur = 520, width = 4, delay = 0 } = {}) {
    if (REDUCED) return;
    const e = mk('fx-ring', { left: `${x - r}px`, top: `${y - r}px`, width: `${r * 2}px`, height: `${r * 2}px`, borderColor: color, borderWidth: `${width}px` });
    run(e, [{ transform: 'scale(.12)', opacity: 0.95 }, { transform: 'scale(1)', opacity: 0 }], { duration: dur, delay, easing: 'cubic-bezier(.1,.7,.3,1)', fill: 'both' });
  }

  function sparks(x, y, { n = 10, colors = ['#fff', '#ffe27a'], dist = 70, size = 6, dur = 620, gravity = 30 } = {}) {
    if (REDUCED) return;
    for (let i = 0; i < n; i++) {
      const ang = rand(0, Math.PI * 2);
      const d = dist * rand(0.45, 1.15);
      const s = size * rand(0.6, 1.3);
      const e = mk('fx-p', { left: `${x - s / 2}px`, top: `${y - s / 2}px`, width: `${s}px`, height: `${s}px`, background: colors[i % colors.length] });
      run(e, [
        { transform: 'translate(0,0) scale(1)', opacity: 1 },
        { transform: `translate(${Math.cos(ang) * d}px,${Math.sin(ang) * d + gravity}px) scale(0)`, opacity: 0.2 },
      ], { duration: dur * rand(0.8, 1.2), easing: 'cubic-bezier(.1,.8,.3,1)' });
    }
  }

  function confetti(x, y, { n = 40, spread = 360, up = 220, fall = 420, dur = 1500 } = {}) {
    if (REDUCED) return;
    const colors = ['#ffe27a', '#ff6a3d', '#4dabf7', '#34d399', '#f06595', '#fff'];
    for (let i = 0; i < n; i++) {
      const dx = rand(-spread / 2, spread / 2);
      const w = rand(6, 11);
      const e = mk('fx-p', { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${w * rand(0.5, 1.6)}px`, background: colors[i % colors.length], borderRadius: '1px' });
      const rot = rand(-720, 720);
      run(e, [
        { transform: 'translate(0,0) rotate(0)', opacity: 1 },
        { transform: `translate(${dx * 0.7}px,${-rand(up * 0.5, up)}px) rotate(${rot * 0.4}deg)`, opacity: 1, offset: 0.35 },
        { transform: `translate(${dx}px,${fall}px) rotate(${rot}deg)`, opacity: 0.9 },
      ], { duration: dur * rand(0.85, 1.25), easing: 'cubic-bezier(.3,.6,.5,1)' });
    }
  }

  function confettiRain(n = 50) {
    for (let i = 0; i < 4; i++) confetti(rand(120, stage.offsetWidth - 120), -20, { n: Math.round(n / 4), spread: 160, up: 0, fall: 820, dur: 1900 });
  }

  function shake(amp = 4, dur = 260) {
    if (REDUCED) return;
    const c = stage.querySelector('#content');
    if (!c) return;
    const f = [{ transform: 'translate(0,0)' }];
    for (let i = 0; i < 6; i++) {
      const k = amp * (1 - i / 6);
      f.push({ transform: `translate(${rand(-k, k)}px,${rand(-k, k)}px)` });
    }
    f.push({ transform: 'translate(0,0)' });
    c.animate(f, { duration: dur, easing: 'linear' });
  }

  function flash(color = '#fff', peak = 0.45, dur = 380) {
    if (REDUCED) return;
    const e = mk('fx-flash', { background: color });
    run(e, [{ opacity: 0 }, { opacity: peak, offset: 0.15 }, { opacity: 0 }], { duration: dur });
  }

  /** 화면 가운데를 가로지르는 큰 글씨 배너 */
  function banner(text, { color = '#ffe27a', sub = '', y = 330, dur = 1500 } = {}) {
    if (REDUCED) return;
    const band = mk('fx-band', { top: `${y - 80}px` });
    band.innerHTML = `<span class="fx-band-t" style="color:${color}">${text}</span>${sub ? `<span class="fx-band-s">${sub}</span>` : ''}`;
    run(band, [
      { opacity: 0, transform: 'scaleY(.1)' },
      { opacity: 1, transform: 'scaleY(1)', offset: 0.1 },
      { opacity: 1, transform: 'scaleY(1)', offset: 0.82 },
      { opacity: 0, transform: 'scaleY(.2)' },
    ], { duration: dur });
    band.firstChild.animate([
      { transform: 'translateX(-260px) scale(2.8)', opacity: 0, filter: 'blur(10px)' },
      { transform: 'translateX(0) scale(1)', opacity: 1, filter: 'blur(0)', offset: 0.18, easing: 'cubic-bezier(.2,1.5,.4,1)' },
      { transform: 'translateX(0) scale(1.07)', opacity: 1, offset: 0.82 },
      { transform: 'translateX(260px) scale(1)', opacity: 0, filter: 'blur(6px)' },
    ], { duration: dur, fill: 'forwards' });
  }

  /** 좌석 옆에 튀어나오는 말풍선식 글씨(퐁/치/깡) */
  function pop(text, x, y, { color = '#ffe27a', size = 58, dur = 1100 } = {}) {
    if (REDUCED) return;
    const e = mk('fx-pop', { left: `${x}px`, top: `${y}px`, color, fontSize: `${size}px` });
    e.textContent = text;
    run(e, [
      { transform: 'translate(-50%,-50%) scale(.2) rotate(-14deg)', opacity: 0 },
      { transform: 'translate(-50%,-50%) scale(1.35) rotate(4deg)', opacity: 1, offset: 0.16 },
      { transform: 'translate(-50%,-50%) scale(1) rotate(0)', opacity: 1, offset: 0.3 },
      { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: 0.75 },
      { transform: 'translate(-50%,-150%) scale(1.1)', opacity: 0 },
    ], { duration: dur });
  }

  // ── 패 비행 ──────────────────────────────────────────────
  /**
   * 손(srcRect)에서 연못의 자리(id)까지 호를 그리며 날아가 착지한다.
   * @returns {boolean} 비행을 시작했으면 true(소리·충격은 착지 때 낸다)
   */
  function flyDiscard(id, srcRect, angle, { riichi = false, onLand } = {}) {
    const dest = pondEl(id);
    if (!dest || !srcRect || REDUCED) return false;
    const d = toStage(dest.getBoundingClientRect());
    const s = toStage(srcRect);
    const w = dest.offsetWidth;
    const clone = dest.cloneNode(true);
    clone.classList.remove('last', 'taken');
    clone.classList.add('fx-fly');
    clone.style.cssText = `left:${d.x - w / 2}px;top:${d.y - dest.offsetHeight / 2}px;width:${w}px;height:${dest.offsetHeight}px;visibility:visible`;
    clone.querySelectorAll('.last, .taken').forEach((n) => n.classList.remove('last', 'taken'));
    attach();
    layer.appendChild(clone);
    dest.style.visibility = 'hidden';
    flights.set(id, true);

    const dx = s.x - d.x;
    const dy = s.y - d.y;
    const s0 = Math.min(2.2, Math.max(0.8, s.w / w));
    const spin = rand(-40, 40);
    const lift = riichi ? 120 : 70;
    const T = (x, y2, rot, sc) => `translate(${x}px,${y2}px) rotate(${rot}deg) scale(${sc})`;
    const a = clone.animate([
      { transform: T(dx, dy, angle + spin, s0), filter: 'drop-shadow(0 6px 4px rgba(0,0,0,.25))' },
      { transform: T(dx * 0.3, dy * 0.3 - lift, angle + spin * 0.3, 1.9), filter: 'drop-shadow(0 26px 14px rgba(0,0,0,.35))', offset: 0.5 },
      { transform: T(0, 0, angle, 1), filter: 'drop-shadow(0 0 0 rgba(0,0,0,0))', offset: 0.82 },
      { transform: `${T(0, 2, angle, 1)} scale(1.16,.84)`, offset: 0.9 },
      { transform: T(0, 0, angle, 1), offset: 1 },
    ], { duration: riichi ? 520 : 400, easing: 'cubic-bezier(.35,.1,.3,1)', fill: 'forwards' });
    a.onfinish = () => {
      clone.remove();
      flights.delete(id);
      const real = pondEl(id);
      if (real) real.style.visibility = '';
      ring(d.x, d.y, { r: riichi ? 70 : 36, color: riichi ? '#ff6a5a' : '#ffffff', dur: 420, width: riichi ? 5 : 3 });
      sparks(d.x, d.y, { n: riichi ? 12 : 6, dist: riichi ? 56 : 30, size: 4, colors: riichi ? ['#ff6a5a', '#ffe27a', '#fff'] : ['#fff', '#ffe27a'], dur: 420 });
      shake(riichi ? 5 : 2.5, riichi ? 260 : 160);
      onLand?.();
    };
    return true;
  }

  // ── 재생 가능한 짧은 연출(elapsed로 이어서 재생) ──────────
  function seek(anim, elapsed) { if (elapsed > 0) anim.currentTime = elapsed; return anim; }

  function stagger(els, keyframes, { step = 40, dur = 380, delay = 0, easing = 'cubic-bezier(.2,.9,.3,1.25)', elapsed = 0 } = {}) {
    if (REDUCED) return;
    els.forEach((e, i) => seek(e.animate(keyframes, { duration: dur, delay: delay + i * step, easing, fill: 'backwards' }), elapsed));
  }

  /** 점수 숫자 카운트업. el의 텍스트를 fmt(n)으로 덮어쓴다 */
  function countUp(el, to, fmt, { delay = 0, dur = 800, elapsed = 0 } = {}) {
    if (REDUCED) return;
    const t0 = performance.now() - elapsed + delay;
    el.textContent = fmt(0);
    const tick = (t) => {
      const p = Math.min(1, Math.max(0, (t - t0) / dur));
      el.textContent = fmt(Math.round(to * (1 - (1 - p) ** 3)));
      if (p < 1 && el.isConnected) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  return {
    layer, attach, rehide, toStage, pondEl, flyDiscard,
    ring, sparks, confetti, confettiRain, shake, flash, banner, pop, stagger, countUp, seek,
  };
}
