/**
 * @fileoverview 루미큐브 효과음 (Web Audio API 동적 합성, 외부 에셋 0).
 *
 * 음소거 상태는 localStorage('rummikub.muted')에 영속.
 * 외부 API:
 *  - isMuted() / setMuted(v) / toggleMuted()
 *  - playTileSelect / playTilePlace / playSetComplete /
 *    playEndTurn / playDraw / playWin / playLose / playButtonClick
 */

/** @type {AudioContext|null} */
let ctx = null;
let muted = (() => {
  try { return localStorage.getItem('rummikub.muted') === '1'; }
  catch (_e) { return false; }
})();

/** @returns {boolean} */
export function isMuted() { return muted; }

/** @param {boolean} v */
export function setMuted(v) {
  muted = !!v;
  try { localStorage.setItem('rummikub.muted', muted ? '1' : '0'); }
  catch (_e) { /* noop */ }
}

/** @returns {boolean} 새 muted 상태 */
export function toggleMuted() {
  setMuted(!muted);
  return muted;
}

function ensureCtx() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }
  try {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  } catch (_e) { return null; }
}

function envelope(gain, t0, attack, decay, sustain, release, peak = 0.4) {
  const g = gain.gain;
  g.cancelScheduledValues(t0);
  g.setValueAtTime(0, t0);
  g.linearRampToValueAtTime(peak, t0 + attack);
  g.linearRampToValueAtTime(peak * sustain, t0 + attack + decay);
  g.linearRampToValueAtTime(0, t0 + attack + decay + release);
  return t0 + attack + decay + release;
}

function playTone(freq, startOffset, duration, peak, type = 'sine') {
  const c = ensureCtx();
  if (!c) return;
  const t0 = c.currentTime + Math.max(0, startOffset);
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  osc.connect(gain).connect(c.destination);
  const attack = Math.min(0.012, duration * 0.15);
  const release = Math.min(0.08, duration * 0.45);
  const sustainDur = Math.max(0, duration - attack - release);
  envelope(gain, t0, attack, sustainDur * 0.3, 1.0, release, peak);
  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
  osc.onended = () => { try { osc.disconnect(); gain.disconnect(); } catch (_e) {} };
}

function playSequence(freqs, stepDur, peak, type = 'sine') {
  for (let i = 0; i < freqs.length; i++) {
    playTone(freqs[i], i * stepDur, stepDur, peak, type);
  }
}

/** 타일 선택 — 짧은 sine 클릭 (0.04초). */
export function playTileSelect() {
  if (muted) return;
  playTone(700, 0, 0.04, 0.18, 'sine');
}

/** 타일 이동/배치 — 0.06초 triangle. */
export function playTilePlace() {
  if (muted) return;
  const c = ensureCtx();
  if (!c) return;
  const t0 = c.currentTime;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(440, t0);
  osc.frequency.exponentialRampToValueAtTime(330, t0 + 0.06);
  osc.connect(gain).connect(c.destination);
  envelope(gain, t0, 0.005, 0.015, 0.4, 0.04, 0.28);
  osc.start(t0);
  osc.stop(t0 + 0.1);
  osc.onended = () => { try { osc.disconnect(); gain.disconnect(); } catch (_e) {} };
}

/** 세트 완성/유효화 — 짧은 상승 chime. */
export function playSetComplete() {
  if (muted) return;
  // C5 → E5 → G5 (메이저 트라이어드)
  playSequence([523.25, 659.25, 783.99], 0.08, 0.24, 'sine');
}

/** 턴 종료(commit 성공) — 부드러운 2음 마침. */
export function playEndTurn() {
  if (muted) return;
  playSequence([587.33, 783.99], 0.1, 0.25, 'sine');
}

/** 더미 뽑기 — 짧은 sine 점프 (낮 → 살짝 높). */
export function playDraw() {
  if (muted) return;
  playTone(330, 0, 0.08, 0.2, 'sine');
  playTone(440, 0.08, 0.1, 0.22, 'sine');
}

/** 본인 승리 — 5음 팡파레. */
export function playWin() {
  if (muted) return;
  playSequence([523.25, 659.25, 783.99, 1046.5, 1318.51], 0.15, 0.3, 'triangle');
}

/** 본인 패배 — 4음 하강. */
export function playLose() {
  if (muted) return;
  playSequence([659.25, 587.33, 523.25, 440], 0.15, 0.22, 'sine');
}

/** UI 버튼 클릭. */
export function playButtonClick() {
  if (muted) return;
  playTone(500, 0, 0.03, 0.12, 'sine');
}
