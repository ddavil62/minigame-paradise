/**
 * @fileoverview Web Audio 효과음(외부 음원 없이 합성). 첫 클릭에서 unlock()으로 오디오를 깨운다.
 */

const MUTE_KEY = 'tichu:muted';

/** @returns {{play:(name:string, arg?:number)=>void, setMuted:(m:boolean)=>void, isMuted:()=>boolean, unlock:()=>void}} */
export function createSounds() {
  let ctx = null;
  let muted = false;
  let unlocked = false; // 사용자 조작(클릭·키) 전에는 오디오를 만들지 않는다(브라우저 자동재생 차단 경고 방지)
  const arm = () => { unlocked = true; };
  window.addEventListener('pointerdown', arm, { once: true, capture: true });
  window.addEventListener('keydown', arm, { once: true, capture: true });
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

  /** 음높이가 뚝 떨어지는 묵직한 쿵(f0 → f1 Hz). */
  function thud(f0, f1, dur, gain, start = 0) {
    const c = ctx;
    const t = c.currentTime + start;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** 카드 넘기는 소리: 짧은 노이즈. */
  function flick(start = 0, gain = 0.18, hp = 1800) {
    const c = ctx;
    const len = Math.floor(c.sampleRate * 0.07);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = hp;
    const g = c.createGain();
    g.gain.value = gain;
    src.connect(f).connect(g).connect(c.destination);
    src.start(c.currentTime + start);
  }

  const SFX = {
    deal() { for (let i = 0; i < 5; i++) flick(i * 0.07, 0.12, 2200); },
    play(n = 1) { flick(0, 0.2); thud(180, 70, 0.1, 0.12); for (let i = 1; i < Math.min(n, 4); i++) flick(i * 0.04, 0.12); },
    pass() { tone(330, 0, 0.07, 'triangle', 0.05); },
    turn() { tone(660, 0, 0.12, 'sine', 0.1); tone(880, 0.1, 0.16, 'sine', 0.1); },
    select() { tone(520, 0, 0.05, 'triangle', 0.06); },
    bomb() { thud(220, 38, 0.5, 0.5); flick(0, 0.4, 600); thud(120, 30, 0.7, 0.35, 0.08); },
    dragon() { thud(150, 55, 0.6, 0.3); tone(196, 0, 0.9, 'sawtooth', 0.07); tone(294, 0.05, 0.8, 'sawtooth', 0.05); },
    phoenix() { [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.07, 0.35, 'sine', 0.08)); },
    dog() { tone(262, 0, 0.1, 'square', 0.06); tone(196, 0.1, 0.14, 'square', 0.06); },
    sparrow() { tone(1568, 0, 0.06, 'sine', 0.07); tone(1760, 0.08, 0.06, 'sine', 0.07); tone(1568, 0.16, 0.08, 'sine', 0.06); },
    call() { [262, 330, 392, 523].forEach((f, i) => tone(f, i * 0.09, 0.25, 'square', 0.07)); thud(200, 80, 0.3, 0.2, 0.3); },
    grand() { [262, 330, 392, 523, 659, 784].forEach((f, i) => tone(f, i * 0.08, 0.35, 'square', 0.07)); thud(180, 50, 0.5, 0.3, 0.45); },
    trick() { tone(587, 0, 0.12, 'triangle', 0.07); tone(784, 0.08, 0.16, 'triangle', 0.07); },
    out() { [523, 659, 784].forEach((f, i) => tone(f, i * 0.09, 0.3, 'triangle', 0.09)); },
    win() { [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone(f, i * 0.11, 0.4, 'triangle', 0.1)); },
    lose() { [392, 330, 262].forEach((f, i) => tone(f, i * 0.16, 0.4, 'sine', 0.09)); },
    tick() { tone(1200, 0, 0.04, 'square', 0.05); },
    error() { tone(160, 0, 0.14, 'square', 0.07); },
  };

  return {
    play(name, arg) {
      if (muted || !unlocked) return;
      if (!ensure()) return;
      try { SFX[name]?.(arg); } catch { /* 소리 실패는 게임에 영향을 주지 않는다 */ }
    },
    setMuted(m) { muted = !!m; try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch { /* noop */ } },
    isMuted: () => muted,
    unlock() { unlocked = true; ensure(); },
  };
}
