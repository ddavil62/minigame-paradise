/**
 * @fileoverview Web Audio 기반 간단한 효과음. 외부 음원 파일 없이 합성한다.
 */

const MUTE_KEY = 'mahjong:muted';

/** @returns {{play:(name:string)=>void, setMuted:(m:boolean)=>void, isMuted:()=>boolean, unlock:()=>void}} */
export function createSounds() {
  let ctx = null;
  let muted = false;
  try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch { /* noop */ }

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(freq, start, dur, type = 'sine', gain = 0.12) {
    const c = ctx;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, c.currentTime + start);
    g.gain.setValueAtTime(0.0001, c.currentTime + start);
    g.gain.exponentialRampToValueAtTime(gain, c.currentTime + start + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + dur);
    o.connect(g).connect(c.destination);
    o.start(c.currentTime + start);
    o.stop(c.currentTime + start + dur + 0.02);
  }

  function clack(gain = 0.35) {
    const c = ctx;
    const len = Math.floor(c.sampleRate * 0.06);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1800;
    const g = c.createGain();
    g.gain.value = gain;
    src.connect(f).connect(g).connect(c.destination);
    src.start();
  }

  const SOUNDS = {
    discard: () => clack(0.4),
    land: () => { clack(0.55); tone(120, 0, 0.12, 'sine', 0.2); },
    draw: () => clack(0.18),
    deal: () => { clack(0.25); setTimeout(() => ctx && clack(0.25), 90); },
    call: () => { tone(520, 0, 0.12, 'triangle'); tone(780, 0.08, 0.16, 'triangle'); },
    riichi: () => { tone(330, 0, 0.18, 'sawtooth', 0.08); tone(495, 0.12, 0.18, 'sawtooth', 0.08); tone(660, 0.24, 0.3, 'sawtooth', 0.08); },
    win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.1, 0.35, 'triangle', 0.13)),
    dora: () => tone(880, 0, 0.2, 'sine', 0.08),
    over: () => [392, 523, 659, 784].forEach((f, i) => tone(f, i * 0.14, 0.4, 'triangle', 0.12)),
    error: () => tone(180, 0, 0.18, 'square', 0.06),
  };

  return {
    play(name) {
      if (muted) return;
      if (!ensure()) return;
      try { SOUNDS[name]?.(); } catch { /* 오디오 실패는 무시 */ }
    },
    setMuted(m) {
      muted = !!m;
      try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch { /* noop */ }
    },
    isMuted: () => muted,
    unlock() { if (!muted) ensure(); },
  };
}
