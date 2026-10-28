/**
 * @fileoverview Web Audio 기반 테트리스 배틀 BGM 및 효과음.
 * 외부 음원 파일 없이 합성하므로 최초 로딩과 캐시 상태에 영향을 받지 않는다.
 */

export const AUDIO_STORAGE_KEY = 'tetris-battle:muted';

const BPM = 148;
const STEP_SECONDS = 60 / BPM / 2;
const LOOK_AHEAD_SECONDS = 0.3;
const SCHEDULER_INTERVAL_MS = 80;

const NOTES = Object.freeze({
  C2: 65.41, D2: 73.42, E2: 82.41, F2: 87.31, G2: 98.00, A2: 110.00, B2: 123.47,
  C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196.00, A3: 220.00, B3: 246.94,
  C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.00, A4: 440.00, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99,
});

const TRACKS = Object.freeze({
  lobby: {
    melody: ['E4', null, 'G4', null, 'B4', null, 'G4', null, 'D4', null, 'F4', null, 'A4', null, 'F4', null],
    bass: ['E2', null, null, null, 'C2', null, null, null, 'D2', null, null, null, 'B2', null, null, null],
  },
  battle: {
    melody: ['E4', 'B4', 'C5', 'B4', 'G4', 'A4', 'B4', 'G4', 'E4', 'G4', 'A4', 'F4', 'D4', 'F4', 'E4', 'D4',
      'E4', 'B4', 'C5', 'D5', 'B4', 'G4', 'A4', 'B4', 'C5', 'B4', 'A4', 'G4', 'F4', 'A4', 'G4', 'E4'],
    bass: ['E2', null, 'E2', null, 'C2', null, 'C2', null, 'D2', null, 'D2', null, 'B2', null, 'B2', null],
  },
});

function readMuted(storage) {
  try { return storage?.getItem(AUDIO_STORAGE_KEY) === 'true'; } catch { return false; }
}

/**
 * @param {object} [deps]
 * @param {Window} [deps.windowRef]
 * @param {Document} [deps.documentRef]
 * @param {Storage} [deps.storage]
 */
export function createAudio(deps = {}) {
  const windowRef = deps.windowRef || globalThis.window;
  const documentRef = deps.documentRef || globalThis.document;
  const storage = deps.storage || globalThis.localStorage;
  let context = null;
  let masterGain = null;
  let musicGain = null;
  let sfxGain = null;
  let noiseBuffer = null;
  let muted = readMuted(storage);
  let unlocked = false;
  let musicWanted = true;
  let theme = 'lobby';
  let stepIndex = 0;
  let nextNoteTime = 0;
  let schedulerId = 0;

  function ensureContext() {
    if (context) return context;
    const AudioContextClass = windowRef?.AudioContext || windowRef?.webkitAudioContext;
    if (!AudioContextClass) return null;
    context = new AudioContextClass();
    masterGain = context.createGain();
    musicGain = context.createGain();
    sfxGain = context.createGain();
    masterGain.gain.value = muted ? 0 : 0.82;
    musicGain.gain.value = 0.28;
    sfxGain.gain.value = 0.62;
    musicGain.connect(masterGain);
    sfxGain.connect(masterGain);
    masterGain.connect(context.destination);
    return context;
  }

  function makeNoiseBuffer() {
    if (noiseBuffer || !context) return noiseBuffer;
    const length = Math.max(1, Math.floor(context.sampleRate * 0.12));
    noiseBuffer = context.createBuffer(1, length, context.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return noiseBuffer;
  }

  function tone(frequency, start, duration, options = {}) {
    if (!context || muted || !frequency) return;
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = options.type || 'square';
    osc.frequency.setValueAtTime(frequency, start);
    if (options.endFrequency) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, options.endFrequency), start + duration);
    }
    const volume = Math.max(0.0001, options.volume || 0.08);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + Math.min(0.012, duration / 3));
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain);
    gain.connect(options.bus || sfxGain);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  function noise(start, duration = 0.08, volume = 0.05) {
    if (!context || muted) return;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = makeNoiseBuffer();
    filter.type = 'highpass';
    filter.frequency.value = 1200;
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(sfxGain);
    source.start(start);
    source.stop(start + duration);
  }

  function scheduleMusicStep(at) {
    if (!context || muted) return;
    const track = TRACKS[theme] || TRACKS.lobby;
    const melodyName = track.melody[stepIndex % track.melody.length];
    const bassName = track.bass[stepIndex % track.bass.length];
    if (melodyName) tone(NOTES[melodyName], at, STEP_SECONDS * 0.72, {
      type: theme === 'battle' ? 'square' : 'triangle', volume: theme === 'battle' ? 0.047 : 0.035, bus: musicGain,
    });
    if (bassName) tone(NOTES[bassName], at, STEP_SECONDS * 1.55, {
      type: 'triangle', volume: theme === 'battle' ? 0.065 : 0.045, bus: musicGain,
    });
    if (theme === 'battle' && stepIndex % 2 === 0) {
      tone(stepIndex % 8 === 0 ? 90 : 72, at, 0.09, {
        type: 'sine', endFrequency: 38, volume: stepIndex % 8 === 0 ? 0.09 : 0.05, bus: musicGain,
      });
    }
    stepIndex += 1;
  }

  function schedule() {
    if (!context || context.state !== 'running' || muted || !musicWanted) return;
    while (nextNoteTime < context.currentTime + LOOK_AHEAD_SECONDS) {
      scheduleMusicStep(nextNoteTime);
      nextNoteTime += STEP_SECONDS;
    }
  }

  function startScheduler() {
    if (!context || muted || !musicWanted || schedulerId) return;
    nextNoteTime = Math.max(context.currentTime + 0.04, nextNoteTime);
    schedule();
    schedulerId = windowRef.setInterval(schedule, SCHEDULER_INTERVAL_MS);
  }

  function stopScheduler() {
    if (schedulerId) windowRef.clearInterval(schedulerId);
    schedulerId = 0;
    nextNoteTime = 0;
  }

  async function unlock() {
    const ctx = ensureContext();
    if (!ctx) return false;
    try {
      if (ctx.state === 'suspended') await ctx.resume();
      unlocked = ctx.state === 'running';
      if (unlocked && musicWanted && !muted) startScheduler();
      return unlocked;
    } catch {
      return false;
    }
  }

  function play(name, detail = 0) {
    if (!unlocked || muted || !context) return;
    const now = context.currentTime + 0.005;
    switch (name) {
      case 'move': tone(190, now, 0.035, { type: 'square', volume: 0.022, endFrequency: 210 }); break;
      case 'rotate': tone(330, now, 0.055, { type: 'triangle', volume: 0.045, endFrequency: 480 }); break;
      case 'hold': tone(260, now, 0.08, { type: 'sine', volume: 0.055, endFrequency: 520 }); break;
      case 'drop':
        tone(125 + Math.min(80, detail * 3), now, 0.11, { type: 'square', volume: 0.075, endFrequency: 58 });
        noise(now, 0.055, 0.035);
        break;
      case 'lock': tone(105, now, 0.055, { type: 'triangle', volume: 0.04, endFrequency: 72 }); break;
      case 'clear': {
        const count = Math.max(1, Math.min(4, detail || 1));
        [523.25, 659.25, 783.99, 1046.5].slice(0, count).forEach((freq, i) => {
          tone(freq, now + i * 0.045, 0.14, { type: 'square', volume: 0.075 });
        });
        break;
      }
      case 'garbage': noise(now, 0.15, 0.11); tone(92, now, 0.18, { type: 'sawtooth', volume: 0.08, endFrequency: 42 }); break;
      case 'item': tone(440, now, 0.08, { type: 'square', volume: 0.06, endFrequency: 880 }); tone(660, now + 0.06, 0.12, { type: 'triangle', volume: 0.07, endFrequency: 990 }); break;
      case 'itemHit': noise(now, 0.1, 0.07); tone(210, now, 0.16, { type: 'sawtooth', volume: 0.07, endFrequency: 70 }); break;
      case 'countdown': tone(detail === 0 ? 660 : 440, now, detail === 0 ? 0.24 : 0.12, { type: 'square', volume: 0.09, endFrequency: detail === 0 ? 990 : 440 }); break;
      case 'win': [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => tone(freq, now + i * 0.11, 0.32, { type: 'triangle', volume: 0.1 })); break;
      case 'lose': [392, 311.13, 246.94, 196].forEach((freq, i) => tone(freq, now + i * 0.12, 0.28, { type: 'sawtooth', volume: 0.07, endFrequency: freq * 0.88 })); break;
      default: break;
    }
  }

  function setTheme(nextTheme) {
    if (!TRACKS[nextTheme] || nextTheme === theme) return;
    theme = nextTheme;
    stepIndex = 0;
    nextNoteTime = context ? context.currentTime + 0.04 : 0;
  }

  function startMusic(nextTheme = theme) {
    setTheme(nextTheme);
    musicWanted = true;
    if (unlocked && !muted) startScheduler();
  }

  function stopMusic() {
    musicWanted = false;
    stopScheduler();
  }

  function setMuted(nextMuted) {
    muted = Boolean(nextMuted);
    try { storage?.setItem(AUDIO_STORAGE_KEY, String(muted)); } catch { /* 저장소 차단 시 세션 내 설정만 유지 */ }
    if (masterGain && context) {
      masterGain.gain.setTargetAtTime(muted ? 0 : 0.82, context.currentTime, 0.025);
    }
    if (muted) stopScheduler();
    else unlock().then(() => { if (musicWanted) startScheduler(); });
    return muted;
  }

  const unlockOnce = () => {
    unlock();
    documentRef?.removeEventListener('pointerdown', unlockOnce, true);
    documentRef?.removeEventListener('keydown', unlockOnce, true);
  };
  documentRef?.addEventListener('pointerdown', unlockOnce, true);
  documentRef?.addEventListener('keydown', unlockOnce, true);

  return {
    unlock,
    play,
    startMusic,
    stopMusic,
    setTheme,
    setMuted,
    toggleMuted() { return setMuted(!muted); },
    isMuted() { return muted; },
    getTheme() { return theme; },
  };
}
