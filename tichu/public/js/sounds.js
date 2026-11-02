/**
 * @fileoverview Web Audio 효과음(외부 음원 없이 합성). 첫 클릭에서 unlock()으로 오디오를 깨운다.
 */

const MUTE_KEY = 'tichu:muted';
const BGM_KEY = 'tichu:bgm';

// ── BGM 악보(8분음표 8칸 = 1마디, MIDI 번호, 0은 쉼표) ──
// A·B 두 구간(8마디씩) = 16마디 루프(약 31초). 코드: A = G D Em C G D C D, B = C G Am D C G D G
const BGM_BPM = 124;
const mel = (s) => s.trim().split(/\s+/).map(Number);
const BGM_MELODY = [
  ...['79 0 74 79 83 0 81 79', '78 0 74 78 81 0 78 74', '76 0 79 76 83 0 79 76', '79 0 76 79 84 0 83 81',
    '79 0 74 79 83 0 81 79', '78 0 81 78 74 0 78 81', '84 0 79 0 76 79 84 79', '81 0 78 0 74 78 81 0'],
  ...['76 0 79 84 79 0 76 79', '83 0 79 0 74 79 83 79', '81 0 76 81 84 0 81 76', '78 0 81 0 78 74 78 81',
    '84 0 79 84 83 0 79 76', '83 0 79 83 86 0 83 79', '81 0 78 74 78 0 81 78', '79 0 83 79 74 0 79 0'],
].map(mel);
const BGM_BASS = [43, 50, 52, 48, 43, 50, 48, 50, 48, 43, 45, 50, 48, 43, 50, 43];
const BGM_CHORDS = [
  [59, 62, 67], [57, 62, 66], [59, 64, 67], [60, 64, 67], [59, 62, 67], [57, 62, 66], [60, 64, 67], [57, 62, 66],
  [60, 64, 67], [59, 62, 67], [57, 60, 64], [57, 62, 66], [60, 64, 67], [59, 62, 67], [57, 62, 66], [59, 62, 67],
];
const BGM_VOL = 0.27; // 효과음(0.05~0.5)보다 한참 작게 깔린다
const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

/** @returns {{play:(name:string, arg?:number)=>void, setMuted:(m:boolean)=>void, isMuted:()=>boolean, setBgm:(on:boolean)=>void, isBgm:()=>boolean, unlock:()=>void}} */
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

  // ── BGM: 외부 음원 없이 합성하는 경쾌한 루프. 앞서 예약하는 스케줄러로 박자를 유지한다 ──
  let bgmOn = true;
  try { bgmOn = localStorage.getItem(BGM_KEY) !== '0'; } catch { /* noop */ }
  let bgmBus = null;
  let bgmTimer = null;
  let bgmStep = 0;
  let bgmNext = 0;
  let noiseBuf = null;
  const STEP = 60 / BGM_BPM / 2;

  function bgmNote(t, midi, dur, type, gain) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(midiHz(midi), t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(bgmBus);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  function bgmKick(t) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(125, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    g.gain.setValueAtTime(0.36, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g).connect(bgmBus);
    o.start(t);
    o.stop(t + 0.18);
  }

  /** 하이햇·브러시 같은 짧은 노이즈. */
  function bgmHat(t, gain, hp, dur) {
    if (!noiseBuf) {
      noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.2), ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = hp;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(bgmBus);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  function bgmSchedule(step, t) {
    const bar = Math.floor(step / 8) % BGM_MELODY.length;
    const k = step % 8;
    const m = BGM_MELODY[bar][k];
    if (m) bgmNote(t, m, STEP * 1.6, 'triangle', 0.15);
    const root = BGM_BASS[bar];
    if (k === 0) bgmNote(t, root, STEP * 2.2, 'sine', 0.3);
    else if (k === 3 || k === 7) bgmNote(t, root + 12, STEP * 0.9, 'sine', 0.2);
    else if (k === 4) bgmNote(t, root + 7, STEP * 1.6, 'sine', 0.26);
    if (k === 2 || k === 5) BGM_CHORDS[bar].forEach((n) => bgmNote(t, n, STEP * 0.8, 'square', 0.02));
    if (k === 0 || k === 4) bgmKick(t);
    if (k === 2 || k === 6) bgmHat(t, 0.1, 2200, 0.09); // 가벼운 백비트
    if (k % 2) bgmHat(t, 0.045, 7000, 0.04);
  }

  function bgmTick() {
    if (!ctx) return;
    while (bgmNext < ctx.currentTime + 0.5) {
      bgmSchedule(bgmStep, bgmNext);
      bgmNext += STEP;
      bgmStep = (bgmStep + 1) % (BGM_MELODY.length * 8);
    }
  }

  function bgmStart() {
    if (bgmTimer || muted || !bgmOn || !unlocked || document.hidden) return;
    if (!ensure()) return;
    bgmBus = ctx.createGain();
    bgmBus.gain.setValueAtTime(0.0001, ctx.currentTime);
    bgmBus.gain.exponentialRampToValueAtTime(BGM_VOL, ctx.currentTime + 1.2);
    bgmBus.connect(ctx.destination);
    bgmNext = ctx.currentTime + 0.1;
    bgmStep = 0;
    bgmTick();
    bgmTimer = setInterval(bgmTick, 120);
  }

  function bgmStop() {
    if (!bgmTimer) return;
    clearInterval(bgmTimer);
    bgmTimer = null;
    const bus = bgmBus;
    bgmBus = null;
    bus.gain.cancelScheduledValues(ctx.currentTime);
    bus.gain.setValueAtTime(Math.max(bus.gain.value, 0.0001), ctx.currentTime);
    bus.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
    setTimeout(() => bus.disconnect(), 600);
  }

  document.addEventListener('visibilitychange', () => (document.hidden ? bgmStop() : bgmStart()));

  return {
    play(name, arg) {
      if (muted || !unlocked) return;
      if (!ensure()) return;
      bgmStart(); // 첫 조작 직후 효과음이 먼저 나와도 BGM이 이어서 시작되게 한다
      try { SFX[name]?.(arg); } catch { /* 소리 실패는 게임에 영향을 주지 않는다 */ }
    },
    setMuted(m) {
      muted = !!m;
      try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch { /* noop */ }
      if (muted) bgmStop(); else bgmStart();
    },
    isMuted: () => muted,
    setBgm(on) {
      bgmOn = !!on;
      try { localStorage.setItem(BGM_KEY, bgmOn ? '1' : '0'); } catch { /* noop */ }
      if (bgmOn) bgmStart(); else bgmStop();
    },
    isBgm: () => bgmOn,
    unlock() { unlocked = true; ensure(); bgmStart(); },
  };
}
