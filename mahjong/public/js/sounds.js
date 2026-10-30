/**
 * @fileoverview Web Audio 기반 효과음과 BGM. 외부 음원 파일 없이 합성한다.
 */

const MUTE_KEY = 'mahjong:muted';
const BGM_KEY = 'mahjong:bgm';

// ── BGM 악보(8분음표 8칸 = 1마디, MIDI 번호, 0은 쉼표) ──
// A·B 두 구간(8마디씩)을 이어 붙여 약 33초짜리 루프를 만든다. 코드: A = C G Am F C G F G, B = F G Em Am F G C G
const BGM_BPM = 116;
const mel = (s) => s.trim().split(/\s+/).map(Number);
const BGM_MELODY = [
  ...['76 0 72 76 79 0 76 72', '74 0 71 74 79 0 74 71', '72 0 76 0 69 72 76 72', '69 72 77 72 69 0 72 0',
    '79 0 76 0 72 76 79 84', '79 0 74 0 71 74 79 0', '77 0 72 0 69 72 77 76', '74 0 74 71 0 67 71 74'],
  ...['77 0 81 77 72 0 77 72', '79 0 74 79 83 0 79 74', '76 0 79 76 71 0 76 71', '72 76 81 76 72 0 69 0',
    '77 0 81 77 84 0 81 77', '83 0 79 0 74 79 83 0', '84 0 79 0 76 79 84 79', '74 0 79 74 71 0 67 71'],
].map(mel);
const BGM_BASS = [48, 43, 45, 41, 48, 43, 41, 43, 41, 43, 40, 45, 41, 43, 48, 43];
const BGM_CHORDS = [
  [60, 64, 67], [59, 62, 67], [57, 60, 64], [57, 60, 65], [60, 64, 67], [59, 62, 67], [57, 60, 65], [59, 62, 67],
  [57, 60, 65], [59, 62, 67], [59, 64, 67], [57, 60, 64], [57, 60, 65], [59, 62, 67], [60, 64, 67], [59, 62, 67],
];
const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

/** @returns {{play:(name:string, arg?:number)=>void, setMuted:(m:boolean)=>void, isMuted:()=>boolean, setBgm:(on:boolean)=>void, isBgm:()=>boolean, unlock:()=>void}} */
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

  function tone(freq, start, dur, type = 'sine', gain = 0.12, dest = null) {
    const c = ctx;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, c.currentTime + start);
    g.gain.setValueAtTime(0.0001, c.currentTime + start);
    g.gain.exponentialRampToValueAtTime(gain, c.currentTime + start + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + dur);
    o.connect(g).connect(dest || c.destination);
    o.start(c.currentTime + start);
    o.stop(c.currentTime + start + dur + 0.02);
  }

  function clack(gain = 0.35, dest = null, freq = 1800, dur = 0.06, type = 'bandpass', startAt = 0) {
    const c = ctx;
    const len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = c.createGain();
    g.gain.value = gain;
    src.connect(f).connect(g).connect(dest || c.destination);
    src.start(c.currentTime + startAt);
  }

  // ── BGM: 외부 음원 없이 합성하는 경쾌한 루프. 앞서 예약하는 스케줄러로 박자를 유지한다 ──
  let bgmOn = true;
  try { bgmOn = localStorage.getItem(BGM_KEY) !== '0'; } catch { /* noop */ }
  let unlocked = false;
  let bgmBus = null;
  let bgmTimer = null;
  let bgmStep = 0;
  let bgmNext = 0;
  const STEP = 60 / BGM_BPM / 2;

  function kick(t, out) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.2);
  }

  function bgmNote(t, out, midi, dur, type, gain) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(midiHz(midi), t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  function bgmSchedule(step, t) {
    const out = bgmBus;
    const bar = Math.floor(step / 8) % BGM_MELODY.length;
    const k = step % 8;
    const m = BGM_MELODY[bar][k];
    if (m) bgmNote(t, out, m, STEP * 1.7, 'triangle', 0.16);
    if (k % 2 === 0) bgmNote(t, out, BGM_BASS[bar] + (k === 4 ? 7 : 0), STEP * 1.6, 'sine', 0.3);
    if (k === 3 || k === 7) BGM_CHORDS[bar].forEach((n) => bgmNote(t, out, n, STEP * 0.9, 'square', 0.022));
    if (k === 0 || k === 4) kick(t, out);
    if (k === 2 || k === 6) clack(0.1, out, 2400, 0.09, 'bandpass', t - ctx.currentTime);
    clack(k % 2 ? 0.05 : 0.03, out, 7000, 0.03, 'highpass', t - ctx.currentTime);
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
    bgmBus.gain.exponentialRampToValueAtTime(0.32, ctx.currentTime + 1.2);
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

  const SOUNDS = {
    discard: () => clack(0.4),
    land: () => { clack(0.55); tone(120, 0, 0.12, 'sine', 0.2); },
    // 리치 중 버림: 착 + 낮은 심장 박동(쿵-쿵). p(1~1.6)가 클수록 묵직하다(리치한 사람이 많거나 선언패).
    landRiichi: (p = 1) => { clack(Math.min(0.8, 0.5 * p)); tone(76, 0, 0.18, 'sine', Math.min(0.5, 0.3 * p)); tone(58, 0.17, 0.26, 'sine', Math.min(0.4, 0.22 * p)); },
    draw: () => clack(0.18),
    deal: () => { clack(0.25); setTimeout(() => ctx && clack(0.25), 90); },
    // 패 섞기(세이판): 짧은 클릭을 촘촘히 겹쳐 잘그락거리고, 끝에 패를 쌓는 소리를 낸다.
    shuffle: () => {
      const N = 52;
      const span = 1.0;
      for (let i = 0; i < N; i++) {
        const swell = Math.sin(Math.PI * (i + 0.5) / N);
        clack((0.05 + Math.random() * 0.16) * (0.35 + swell * 0.65), null, 900 + Math.random() * 2600, 0.03 + Math.random() * 0.045, 'bandpass', span * (i / N) + Math.random() * 0.014);
      }
      [1.08, 1.17, 1.26].forEach((t) => clack(0.3, null, 1500, 0.06, 'bandpass', t));
    },
    call: () => { tone(520, 0, 0.12, 'triangle'); tone(780, 0.08, 0.16, 'triangle'); },
    riichi: () => { tone(330, 0, 0.18, 'sawtooth', 0.08); tone(495, 0.12, 0.18, 'sawtooth', 0.08); tone(660, 0.24, 0.3, 'sawtooth', 0.08); },
    win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.1, 0.35, 'triangle', 0.13)),
    dora: () => tone(880, 0, 0.2, 'sine', 0.08),
    // 만관 이상 화료: 등급(1~5)이 높을수록 아르페지오가 길어지고 북 롤·긴 화음이 붙는다.
    winBig: (g = 1) => {
      const notes = [523, 659, 784, 1047, 1319, 1568, 2093];
      const n = Math.min(notes.length, 3 + g);
      notes.slice(0, n).forEach((f, i) => tone(f, i * 0.09, 0.4, 'triangle', 0.13));
      tone(98, 0, 0.5, 'sine', 0.35);
      const end = n * 0.09;
      [523, 659, 784].forEach((f) => tone(f, end, 0.8, 'sawtooth', 0.05));
      if (g >= 3) for (let i = 0; i < 8; i++) clack(0.28, null, 900, 0.05, 'bandpass', i * 0.05);
      if (g >= 5) [1047, 1319, 1568].forEach((f) => tone(f, end + 0.1, 1.3, 'triangle', 0.08));
    },
    // 내 차례 알림(띠-리-링)과 한동안 안 눌렀을 때의 재촉
    myturn: () => [[659, 0], [880, 0.09], [1319, 0.18]].forEach(([f, t]) => tone(f, t, 0.28, 'triangle', 0.13)),
    // 제한 시간 5초 전부터 1초마다: 째깍(높은 틱)·똑(0.5초 뒤 낮은 틱). 마지막 2초는 삐 소리가 더해진다.
    tick: () => { clack(0.42, null, 2800, 0.025); clack(0.28, null, 1700, 0.03, 'bandpass', 0.5); },
    tickLast: () => { clack(0.5, null, 2800, 0.025); tone(1568, 0, 0.09, 'square', 0.05); clack(0.32, null, 1700, 0.03, 'bandpass', 0.5); },
    pause: () => { tone(660, 0, 0.14, 'triangle', 0.12); tone(440, 0.1, 0.22, 'triangle', 0.12); },
    resume: () => { tone(440, 0, 0.14, 'triangle', 0.12); tone(660, 0.1, 0.14, 'triangle', 0.12); tone(880, 0.2, 0.22, 'triangle', 0.12); },
    nudge: () => { tone(988, 0, 0.12, 'sine', 0.1); tone(988, 0.15, 0.12, 'sine', 0.1); },
    over: () => [392, 523, 659, 784].forEach((f, i) => tone(f, i * 0.14, 0.4, 'triangle', 0.12)),
    error: () => tone(180, 0, 0.18, 'square', 0.06),
  };

  return {
    play(name, arg) {
      if (muted) return;
      if (!ensure()) return;
      try { SOUNDS[name]?.(arg); } catch { /* 오디오 실패는 무시 */ }
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
    /** 첫 사용자 입력에서 호출한다(브라우저가 소리를 막고 있다가 이때 풀린다). BGM도 이때 시작한다. */
    unlock() { unlocked = true; if (!muted) { ensure(); bgmStart(); } },
  };
}
