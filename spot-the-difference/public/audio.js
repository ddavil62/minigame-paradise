/**
 * 외부 음원 파일 없이 달빛 퍼즐풍 BGM과 효과음을 합성한다.
 */
export const AUDIO_STORAGE_KEY = 'spot-the-difference:muted';

const STEP_SECONDS = 60 / 88 / 2;
const LOOK_AHEAD_SECONDS = 0.28;
const SCHEDULER_INTERVAL_MS = 80;
const NOTE = Object.freeze({
  C2: 65.41, D2: 73.42, E2: 82.41, F2: 87.31, G2: 98, A2: 110,
  C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196, A3: 220, B3: 246.94,
  C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392, A4: 440, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880, C6: 1046.5,
});

const TRACKS = Object.freeze({
  library: {
    melody: ['E4', null, 'G4', null, 'B4', null, 'G4', null, 'D4', null, 'G4', null, 'A4', null, 'E4', null],
    bass: ['C3', null, null, null, 'A2', null, null, null, 'F2', null, null, null, 'G2', null, null, null],
    volume: 0.032,
  },
  play: {
    melody: ['E4', 'G4', null, 'B4', 'A4', null, 'G4', 'E4', 'D4', 'G4', null, 'A4', 'G4', null, 'E4', 'D4'],
    bass: ['C3', null, 'C3', null, 'A2', null, 'A2', null, 'F2', null, 'F2', null, 'G2', null, 'G2', null],
    volume: 0.038,
  },
  celebration: {
    melody: ['C5', null, 'E5', null, 'G5', null, 'E5', null, 'D5', null, 'G5', null, 'A5', null, 'G5', null],
    bass: ['C3', null, null, null, 'F2', null, null, null, 'G2', null, null, null, 'C3', null, null, null],
    volume: 0.028,
  },
  result: {
    melody: ['C4', null, null, 'E4', null, null, 'G4', null, 'F4', null, null, 'D4', null, null, 'C4', null],
    bass: ['C2', null, null, null, 'F2', null, null, null, 'G2', null, null, null, 'C2', null, null, null],
    volume: 0.022,
  },
});

function readMuted(storage) {
  try { return storage?.getItem(AUDIO_STORAGE_KEY) === 'true'; } catch { return false; }
}

export function createSpotAudio(deps = {}) {
  const windowRef = deps.windowRef || globalThis.window;
  const documentRef = deps.documentRef || globalThis.document;
  const storage = deps.storage || globalThis.localStorage;
  let context = null;
  let master = null;
  let musicBus = null;
  let effectsBus = null;
  let muted = readMuted(storage);
  let unlocked = false;
  let musicWanted = true;
  let scene = 'library';
  let step = 0;
  let nextNoteTime = 0;
  let schedulerId = 0;

  function ensureContext() {
    if (context) return context;
    const Context = windowRef?.AudioContext || windowRef?.webkitAudioContext;
    if (!Context) return null;
    context = new Context();
    master = context.createGain();
    musicBus = context.createGain();
    effectsBus = context.createGain();
    master.gain.value = muted ? 0 : 0.72;
    musicBus.gain.value = 0.24;
    effectsBus.gain.value = 0.78;
    musicBus.connect(master);
    effectsBus.connect(master);
    master.connect(context.destination);
    return context;
  }

  function tone(frequency, start, duration, options = {}) {
    if (!context || muted || !frequency) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = options.type || 'sine';
    oscillator.frequency.setValueAtTime(frequency, start);
    if (options.endFrequency) oscillator.frequency.exponentialRampToValueAtTime(options.endFrequency, start + duration);
    const volume = Math.max(0.0001, options.volume || 0.06);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + Math.min(0.025, duration / 3));
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(options.bus || effectsBus);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.03);
  }

  function bell(frequency, start, duration, volume = 0.06, bus = effectsBus) {
    tone(frequency, start, duration, { type: 'sine', volume, bus });
    tone(frequency * 2, start, duration * 0.55, { type: 'sine', volume: volume * 0.25, bus });
  }

  function scheduleStep(at) {
    const track = TRACKS[scene] || TRACKS.library;
    const melody = NOTE[track.melody[step % track.melody.length]];
    const bass = NOTE[track.bass[step % track.bass.length]];
    if (melody) bell(melody, at, STEP_SECONDS * 0.78, track.volume, musicBus);
    if (bass) tone(bass, at, STEP_SECONDS * 2.5, { type: 'sine', volume: 0.04, bus: musicBus });
    step += 1;
  }

  function schedule() {
    if (!context || context.state !== 'running' || muted || !musicWanted) return;
    while (nextNoteTime < context.currentTime + LOOK_AHEAD_SECONDS) {
      scheduleStep(nextNoteTime);
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
    const activeContext = ensureContext();
    if (!activeContext) return false;
    try {
      if (activeContext.state === 'suspended') await activeContext.resume();
      unlocked = activeContext.state === 'running';
      if (unlocked && musicWanted && !muted) startScheduler();
      return unlocked;
    } catch {
      return false;
    }
  }

  function play(name) {
    const supported = ['select', 'found', 'already', 'miss', 'hint', 'win', 'lost'].includes(name);
    if (!supported || !unlocked || muted || !context) return supported;
    const now = context.currentTime + 0.008;
    if (name === 'select') bell(NOTE.C5, now, 0.12, 0.05);
    if (name === 'found') [NOTE.E5, NOTE.G5, NOTE.C6].forEach((frequency, index) => bell(frequency, now + index * 0.065, 0.24, 0.075));
    if (name === 'already') tone(NOTE.G4, now, 0.08, { type: 'triangle', volume: 0.035 });
    if (name === 'miss') {
      tone(155, now, 0.22, { type: 'triangle', volume: 0.09, endFrequency: 92 });
      tone(110, now + 0.07, 0.18, { type: 'sine', volume: 0.06, endFrequency: 65 });
    }
    if (name === 'hint') [NOTE.C5, NOTE.G5, NOTE.C6].forEach((frequency, index) => bell(frequency, now + index * 0.08, 0.3, 0.055));
    if (name === 'win') [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6, NOTE.G5, NOTE.C6].forEach((frequency, index) => bell(frequency, now + index * 0.1, 0.38, 0.085));
    if (name === 'lost') [NOTE.G4, NOTE.E4, NOTE.D4, NOTE.C4].forEach((frequency, index) => tone(frequency, now + index * 0.13, 0.32, { type: 'triangle', volume: 0.065 }));
    return true;
  }

  function setScene(nextScene) {
    if (!TRACKS[nextScene] || nextScene === scene) return scene;
    scene = nextScene;
    step = 0;
    nextNoteTime = context ? context.currentTime + 0.04 : 0;
    return scene;
  }

  function startMusic(nextScene = scene) {
    setScene(nextScene);
    musicWanted = true;
    if (unlocked && !muted) startScheduler();
  }

  function stopMusic() {
    musicWanted = false;
    stopScheduler();
  }

  function setMuted(nextMuted) {
    muted = Boolean(nextMuted);
    try { storage?.setItem(AUDIO_STORAGE_KEY, String(muted)); } catch { /* 세션 내 설정은 유지한다. */ }
    if (master && context) master.gain.setTargetAtTime(muted ? 0 : 0.72, context.currentTime, 0.025);
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
    setScene,
    setMuted,
    toggleMuted() { return setMuted(!muted); },
    isMuted() { return muted; },
    getScene() { return scene; },
    isSupported() { return Boolean(windowRef?.AudioContext || windowRef?.webkitAudioContext); },
  };
}
