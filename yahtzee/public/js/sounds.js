/**
 * @fileoverview 요트 다이스 효과음 모듈 (Web Audio API 동적 생성).
 *
 * 외부 에셋 0 — 모든 효과음을 코드로 oscillator/noise + ADSR envelope으로 합성한다.
 * AudioContext는 lazy init (첫 사용자 인터랙션 시점에 ensureCtx + resume).
 * 음소거 상태는 localStorage('yahtzee.muted')에 영속화.
 *
 * 외부 API:
 *  - isMuted() / setMuted(v) / toggleMuted()
 *  - playRoll / playDiceLand / playKeepToggle / playScore /
 *    playYahtzee / playUpperBonus / playWin / playLose / playButtonClick
 *
 * 각 play 함수는 muted 체크 → ensureCtx → 노드 그래프 구성 → 자동 disconnect.
 * 동시 재생 충돌 방지를 위해 매 호출마다 새 노드를 생성한다.
 */

// ── 모듈 내부 상태 ────────────────────────────────────────────────
/** @type {AudioContext|null} */
let ctx = null;
/** localStorage 영속화된 음소거 상태. */
let muted = (() => {
  try { return localStorage.getItem('yahtzee.muted') === '1'; }
  catch (_e) { return false; }
})();

// ── 공개: 음소거 토글 ────────────────────────────────────────────
/**
 * 현재 음소거 상태를 반환한다.
 * @returns {boolean}
 */
export function isMuted() {
  return muted;
}

/**
 * 음소거 상태를 설정하고 localStorage에 저장한다.
 * @param {boolean} v
 */
export function setMuted(v) {
  muted = !!v;
  try { localStorage.setItem('yahtzee.muted', muted ? '1' : '0'); }
  catch (_e) { /* private 브라우징 등 — 무시 */ }
}

/**
 * 음소거 상태를 반전하고 새 값을 반환한다.
 * @returns {boolean} 새 muted 상태
 */
export function toggleMuted() {
  setMuted(!muted);
  return muted;
}

// ── 내부: AudioContext lazy init ──────────────────────────────────
/**
 * AudioContext를 1회 생성하고 suspended면 resume을 시도한다.
 * 모바일 Safari/구형 브라우저 호환을 위해 webkitAudioContext fallback.
 * @returns {AudioContext|null} 생성 실패 시 null
 */
function ensureCtx() {
  if (ctx) {
    // 사용자 첫 인터랙션 이후에도 suspended 상태가 남아있을 수 있음 — best-effort resume.
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => { /* noop */ });
    }
    return ctx;
  }
  try {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => { /* noop */ });
    }
    return ctx;
  } catch (_e) {
    return null;
  }
}

// ── 내부: 공용 헬퍼 ──────────────────────────────────────────────
/**
 * gain 노드에 ADSR envelope을 적용한다(setValueAtTime / linearRamp 조합).
 * release 후에 자동으로 stop / disconnect되도록 호출자가 oscillator/source의 stop 시점을 조정해야 한다.
 *
 * @param {GainNode} gain
 * @param {number} t0 시작 시각(ctx.currentTime 기준)
 * @param {number} attack
 * @param {number} decay
 * @param {number} sustain 0~1
 * @param {number} release
 * @param {number} peak 피크 게인 (0~1)
 * @returns {number} envelope 종료 시각
 */
function envelope(gain, t0, attack, decay, sustain, release, peak = 0.4) {
  const g = gain.gain;
  g.cancelScheduledValues(t0);
  g.setValueAtTime(0, t0);
  g.linearRampToValueAtTime(peak, t0 + attack);
  g.linearRampToValueAtTime(peak * sustain, t0 + attack + decay);
  g.linearRampToValueAtTime(0, t0 + attack + decay + release);
  return t0 + attack + decay + release;
}

/**
 * 짧은 sine 톤 한 음을 재생한다(공통 헬퍼).
 *
 * @param {number} freq Hz
 * @param {number} startOffset 현재 시각부터 몇 초 뒤 시작
 * @param {number} duration 총 길이(초)
 * @param {number} peak 게인 (0~1)
 * @param {OscillatorType} [type='sine']
 */
function playTone(freq, startOffset, duration, peak, type = 'sine') {
  const c = ensureCtx();
  if (!c) return;
  const t0 = c.currentTime + Math.max(0, startOffset);
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  osc.connect(gain).connect(c.destination);
  // ADSR: 빠른 attack + 짧은 decay + 평탄 sustain + 부드러운 release.
  const attack = Math.min(0.012, duration * 0.15);
  const release = Math.min(0.08, duration * 0.45);
  const sustainDur = Math.max(0, duration - attack - release);
  envelope(gain, t0, attack, sustainDur * 0.3, 1.0, release, peak);
  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
  // 종료 후 GC 가능하게 disconnect.
  osc.onended = () => {
    try { osc.disconnect(); gain.disconnect(); } catch (_e) { /* noop */ }
  };
}

/**
 * 순차적 음표(아르페지오/팡파레)를 재생한다.
 * @param {number[]} freqs Hz 배열
 * @param {number} stepDur 음표 1개당 길이(초)
 * @param {number} peak 게인
 * @param {OscillatorType} [type='sine']
 */
function playSequence(freqs, stepDur, peak, type = 'sine') {
  for (let i = 0; i < freqs.length; i++) {
    playTone(freqs[i], i * stepDur, stepDur, peak, type);
  }
}

// ── 공개: 효과음들 ────────────────────────────────────────────────

/**
 * 다이스 굴림 시작 — 화이트노이즈 + low-pass 스윕(800Hz → 200Hz)으로 다이스 5개가 굴러가는 rattle 소리.
 * 약 0.4초.
 */
export function playRoll() {
  if (muted) return;
  const c = ensureCtx();
  if (!c) return;
  const t0 = c.currentTime;
  const duration = 0.4;

  // 화이트노이즈 버퍼 1회 생성.
  const bufferSize = Math.floor(c.sampleRate * duration);
  const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }

  const noise = c.createBufferSource();
  noise.buffer = buffer;

  // low-pass filter 800Hz → 200Hz 스윕 (다이스가 점점 멈춰가는 느낌).
  const filter = c.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(800, t0);
  filter.frequency.linearRampToValueAtTime(200, t0 + duration);
  filter.Q.value = 1;

  const gain = c.createGain();
  envelope(gain, t0, 0.02, 0.05, 0.7, 0.25, 0.25);

  noise.connect(filter).connect(gain).connect(c.destination);
  noise.start(t0);
  noise.stop(t0 + duration + 0.05);
  noise.onended = () => {
    try { noise.disconnect(); filter.disconnect(); gain.disconnect(); } catch (_e) { /* noop */ }
  };
}

/**
 * 다이스 착지 — 짧은 클릭(triangle 120Hz, 0.06초).
 */
export function playDiceLand() {
  if (muted) return;
  const c = ensureCtx();
  if (!c) return;
  const t0 = c.currentTime;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(140, t0);
  osc.frequency.exponentialRampToValueAtTime(80, t0 + 0.06);
  osc.connect(gain).connect(c.destination);
  envelope(gain, t0, 0.005, 0.015, 0.4, 0.04, 0.3);
  osc.start(t0);
  osc.stop(t0 + 0.1);
  osc.onended = () => {
    try { osc.disconnect(); gain.disconnect(); } catch (_e) { /* noop */ }
  };
}

/**
 * KEEP 토글 — 매우 짧은 sine 600Hz 클릭(0.04초).
 */
export function playKeepToggle() {
  if (muted) return;
  playTone(600, 0, 0.04, 0.18, 'sine');
}

/**
 * 카테고리 점수 기록 — 짧은 상승 chime(800Hz → 1000Hz, 0.2초).
 */
export function playScore() {
  if (muted) return;
  const c = ensureCtx();
  if (!c) return;
  const t0 = c.currentTime;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(800, t0);
  osc.frequency.linearRampToValueAtTime(1000, t0 + 0.15);
  osc.connect(gain).connect(c.destination);
  envelope(gain, t0, 0.01, 0.05, 0.6, 0.13, 0.25);
  osc.start(t0);
  osc.stop(t0 + 0.25);
  osc.onended = () => {
    try { osc.disconnect(); gain.disconnect(); } catch (_e) { /* noop */ }
  };
}

/**
 * YAHTZEE! — 4음 아르페지오(C5-E5-G5-C6), 각 0.1초.
 */
export function playYahtzee() {
  if (muted) return;
  // C5=523.25, E5=659.25, G5=783.99, C6=1046.5
  playSequence([523.25, 659.25, 783.99, 1046.5], 0.1, 0.3, 'sine');
}

/**
 * 상단 보너스 달성 — 3음 상승(G5-B5-D6), 각 0.12초.
 */
export function playUpperBonus() {
  if (muted) return;
  // G5=783.99, B5=987.77, D6=1174.66
  playSequence([783.99, 987.77, 1174.66], 0.12, 0.28, 'sine');
}

/**
 * 본인 승리 — 5음 팡파레(C5-E5-G5-C6-E6), 각 0.15초.
 */
export function playWin() {
  if (muted) return;
  // C5=523.25, E5=659.25, G5=783.99, C6=1046.5, E6=1318.51
  playSequence([523.25, 659.25, 783.99, 1046.5, 1318.51], 0.15, 0.32, 'triangle');
}

/**
 * 본인 패배 — 4음 하강(E5-D5-C5-A4), 각 0.15초.
 */
export function playLose() {
  if (muted) return;
  // E5=659.25, D5=587.33, C5=523.25, A4=440
  playSequence([659.25, 587.33, 523.25, 440], 0.15, 0.22, 'sine');
}

/**
 * UI 버튼 클릭 — 매우 subtle한 sine 500Hz 클릭(0.03초). (선택적, 현재 음소거 토글에만 사용)
 */
export function playButtonClick() {
  if (muted) return;
  playTone(500, 0, 0.03, 0.12, 'sine');
}
