/**
 * @fileoverview 별빛 우편탑의 절차적 BGM과 의미 기반 효과음을 관리한다.
 * 브라우저 자동 재생 정책과 페이지 수명 주기를 안전하게 처리한다.
 */

const STORAGE_KEYS = Object.freeze({
  muted: 'starlight-muted',
  volume: 'starlight-volume',
  bgmVolume: 'starlight-bgm-volume',
  sfxVolume: 'starlight-sfx-volume'
});

const SCENES = new Set(['menu', 'play', 'danger', 'finale', 'result', 'silent']);
const DEFAULTS = Object.freeze({ master: 0.65, bgm: 0.20, sfx: 0.45 });
const SCHEDULER_INTERVAL_MS = 50;
const LOOK_AHEAD_SECONDS = 0.18;
const MAX_VOICES = 12;
const MAX_EVENT_IDS = 128;

const SFX_COOLDOWNS = Object.freeze({
  'ui.select': 50,
  'ui.confirm': 80,
  jump: 120,
  land: 120,
  'device.powered': 100,
  'device.latched': 100,
  checkpoint: 180,
  fall: 180,
  boost: 140,
  'finish.start': 250,
  'finish.expired': 250,
  result: 350,
  connection: 200
});

const SCENE_PATTERNS = Object.freeze({
  menu: { beat: 0.72, notes: [261.63, 329.63, 392, 329.63], level: 0.42 },
  play: { beat: 0.48, notes: [261.63, 392, 329.63, 440, 392, 523.25], level: 0.52 },
  danger: { beat: 0.38, notes: [220, 233.08, 220, 277.18], level: 0.44 },
  finale: { beat: 0.34, notes: [261.63, 329.63, 392, 523.25, 659.25], level: 0.62 },
  result: { beat: 0.9, notes: [261.63, 329.63, 392, 523.25], level: 0.34 }
});

/**
 * 숫자를 지정 범위로 제한한다.
 * @param {unknown} value 입력값
 * @param {number} min 최솟값
 * @param {number} max 최댓값
 * @param {number} fallback 유효하지 않을 때의 값
 * @returns {number} 제한된 값
 */
function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

/**
 * 저장소 값을 예외 없이 읽는다.
 * @param {Storage|undefined|null} storage 저장소
 * @param {string} key 키
 * @returns {string|null} 저장값
 */
function safeRead(storage, key) {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/**
 * 저장소 값을 예외 없이 기록한다.
 * @param {Storage|undefined|null} storage 저장소
 * @param {string} key 키
 * @param {string} value 값
 * @returns {void}
 */
function safeWrite(storage, key, value) {
  try {
    storage?.setItem(key, value);
  } catch {
    // 사생활 보호 모드와 용량 제한에서도 오디오는 계속 동작해야 한다.
  }
}

/**
 * 오디오 파라미터를 짧게 램프한다.
 * @param {AudioParam} param 대상 파라미터
 * @param {number} value 목표값
 * @param {number} now 현재 오디오 시간
 * @param {number} duration 전환 시간
 * @returns {void}
 */
function ramp(param, value, now, duration = 0.04) {
  if (!param) return;
  try {
    param.cancelScheduledValues?.(now);
    const current = Number.isFinite(param.value) ? param.value : 0;
    param.setValueAtTime?.(current, now);
    param.linearRampToValueAtTime?.(value, now + duration);
    if (!param.linearRampToValueAtTime) param.value = value;
  } catch {
    param.value = value;
  }
}

/**
 * 별빛 우편탑 오디오 엔진을 만든다.
 * @param {object} [options] 테스트 및 실행 환경 주입값
 * @param {() => AudioContext} [options.contextFactory] AudioContext 생성기
 * @param {Storage} [options.storage] 설정 저장소
 * @param {Document} [options.document] visibility 관찰 문서
 * @param {() => number} [options.now] 밀리초 단위 시계
 * @param {(callback: Function, delay: number) => unknown} [options.setInterval] 타이머 생성기
 * @param {(id: unknown) => void} [options.clearInterval] 타이머 해제기
 * @returns {object} 의미 기반 오디오 API
 */
export function createAudioEngine(options = {}) {
  const globalWindow = typeof window === 'undefined' ? undefined : window;
  const documentRef = options.document ?? globalWindow?.document;
  const storage = options.storage ?? globalWindow?.localStorage;
  const nowMs = options.now ?? (() => Date.now());
  const setIntervalFn = options.setInterval ?? globalWindow?.setInterval?.bind(globalWindow) ?? setInterval;
  const clearIntervalFn = options.clearInterval ?? globalWindow?.clearInterval?.bind(globalWindow) ?? clearInterval;
  const defaultFactory = () => {
    const Context = globalWindow?.AudioContext ?? globalWindow?.webkitAudioContext;
    return Context ? new Context() : null;
  };
  const contextFactory = options.contextFactory ?? defaultFactory;

  const storedVolumeValue = safeRead(storage, STORAGE_KEYS.volume);
  const storedVolume = storedVolumeValue === null
    ? 1
    : clampNumber(storedVolumeValue, 0, 1, 1);
  let muted = safeRead(storage, STORAGE_KEYS.muted) === 'true';
  let volume = storedVolume;
  const storedBgmVolume = safeRead(storage, STORAGE_KEYS.bgmVolume);
  const storedSfxVolume = safeRead(storage, STORAGE_KEYS.sfxVolume);
  let bgmVolume = storedBgmVolume === null ? 1 : clampNumber(storedBgmVolume, 0, 1, 1);
  let sfxVolume = storedSfxVolume === null ? 1 : clampNumber(storedSfxVolume, 0, 1, 1);
  let context = null;
  let masterGain = null;
  let bgmGain = null;
  let sfxGain = null;
  let scene = 'menu';
  let timer = null;
  let nextBeatTime = 0;
  let patternIndex = 0;
  let destroyed = false;
  let hidden = Boolean(documentRef?.hidden);
  let activeVoices = 0;
  const lastPlayed = new Map();
  const eventIds = new Set();
  const eventQueue = [];
  const diagnostics = {
    contextCreations: 0,
    schedulerStarts: 0,
    scheduledNotes: 0,
    playedSfx: 0,
    suppressedSfx: 0
  };

  /**
   * 현재 출력 gain을 사용자 설정에 맞춘다.
   * @param {number} [duration] 램프 시간
   * @returns {void}
   */
  function applyMasterGain(duration = 0.04) {
    if (!context || !masterGain) return;
    ramp(masterGain.gain, muted || volume === 0 || hidden ? 0 : DEFAULTS.master * volume, context.currentTime, duration);
  }

  /**
   * GainNode를 생성하고 초기값을 지정한다.
   * @param {number} value 초기값
   * @returns {GainNode} 생성된 노드
   */
  function makeGain(value) {
    const node = context.createGain();
    node.gain.value = value;
    return node;
  }

  /**
   * 오디오 그래프를 한 번만 만든다.
   * @returns {boolean} 생성 성공 여부
   */
  function createGraph() {
    if (context || destroyed) return Boolean(context);
    try {
      context = contextFactory?.() ?? null;
      if (!context) return false;
      diagnostics.contextCreations += 1;
      masterGain = makeGain(0);
      bgmGain = makeGain(DEFAULTS.bgm * bgmVolume);
      sfxGain = makeGain(DEFAULTS.sfx * sfxVolume);
      bgmGain.connect(masterGain);
      sfxGain.connect(masterGain);
      masterGain.connect(context.destination);
      applyMasterGain(0.08);
      return true;
    } catch {
      context = null;
      masterGain = null;
      bgmGain = null;
      sfxGain = null;
      return false;
    }
  }

  /**
   * 단일 음성을 만들고 종료 시 자원을 회수한다.
   * @param {object} config 합성 설정
   * @param {number} config.frequency 시작 주파수
   * @param {number} [config.endFrequency] 종료 주파수
   * @param {number} [config.duration] 길이
   * @param {number} [config.level] 음량
   * @param {OscillatorType} [config.type] 파형
   * @param {number} [config.when] 시작 시각
   * @param {AudioNode} [config.destination] 출력 노드
   * @returns {boolean} 생성 여부
   */
  function synthVoice({
    frequency,
    endFrequency = frequency,
    duration = 0.12,
    level = 0.12,
    type = 'sine',
    when = context?.currentTime ?? 0,
    destination = sfxGain
  }) {
    if (!context || !destination || activeVoices >= MAX_VOICES) return false;
    try {
      const oscillator = context.createOscillator();
      const envelope = makeGain(0.0001);
      const filter = context.createBiquadFilter?.();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, when);
      if (endFrequency !== frequency) {
        oscillator.frequency.exponentialRampToValueAtTime?.(Math.max(1, endFrequency), when + duration);
      }
      if (filter) {
        filter.type = 'lowpass';
        filter.frequency.value = 1800;
        oscillator.connect(filter);
        filter.connect(envelope);
      } else {
        oscillator.connect(envelope);
      }
      envelope.connect(destination);
      envelope.gain.setValueAtTime(0.0001, when);
      envelope.gain.exponentialRampToValueAtTime?.(Math.max(0.0001, level), when + 0.015);
      envelope.gain.exponentialRampToValueAtTime?.(0.0001, when + duration);
      activeVoices += 1;
      let cleaned = false;
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        activeVoices = Math.max(0, activeVoices - 1);
        oscillator.disconnect?.();
        filter?.disconnect?.();
        envelope.disconnect?.();
      };
      oscillator.onended = cleanup;
      oscillator.start(when);
      oscillator.stop(when + duration + 0.02);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 현재 장면의 다음 BGM 음을 예약한다.
   * @returns {void}
   */
  function scheduleBgm() {
    if (!context || muted || hidden || scene === 'silent' || context.state !== 'running') return;
    const pattern = SCENE_PATTERNS[scene];
    if (!pattern) return;
    const horizon = context.currentTime + LOOK_AHEAD_SECONDS;
    while (nextBeatTime < horizon) {
      const frequency = pattern.notes[patternIndex % pattern.notes.length];
      synthVoice({
        frequency,
        endFrequency: frequency,
        duration: pattern.beat * 0.78,
        level: pattern.level,
        type: patternIndex % 4 === 0 ? 'triangle' : 'sine',
        when: nextBeatTime,
        destination: bgmGain
      });
      diagnostics.scheduledNotes += 1;
      patternIndex += 1;
      nextBeatTime += pattern.beat;
    }
  }

  /**
   * look-ahead 스케줄러를 중복 없이 시작한다.
   * @returns {void}
   */
  function startScheduler() {
    if (timer !== null || !context || context.state !== 'running' || hidden || muted || scene === 'silent') return;
    nextBeatTime = Math.max(context.currentTime + 0.03, nextBeatTime);
    scheduleBgm();
    timer = setIntervalFn(scheduleBgm, SCHEDULER_INTERVAL_MS);
    diagnostics.schedulerStarts += 1;
  }

  /**
   * 예약 타이머를 해제한다.
   * @returns {void}
   */
  function stopScheduler() {
    if (timer === null) return;
    clearIntervalFn(timer);
    timer = null;
  }

  /**
   * 사용자 제스처 뒤 오디오를 활성화한다.
   * @returns {Promise<boolean>} 활성화 여부
   */
  async function unlock() {
    if (destroyed || hidden || !createGraph()) return false;
    try {
      if (context.state !== 'running') await context.resume?.();
      if (context.state === 'running') {
        applyMasterGain(0.08);
        startScheduler();
        return true;
      }
    } catch {
      // resume 거부는 자동 재생 정책의 정상적인 실패 경로다.
    }
    return false;
  }

  /**
   * 음소거 상태를 설정한다.
   * @param {boolean} nextMuted 음소거 여부
   * @returns {boolean} 적용된 값
   */
  function setMuted(nextMuted) {
    muted = Boolean(nextMuted);
    safeWrite(storage, STORAGE_KEYS.muted, String(muted));
    applyMasterGain();
    if (muted) stopScheduler();
    else if (!hidden) startScheduler();
    return muted;
  }

  /**
   * 마스터 볼륨을 설정한다.
   * @param {number} nextVolume 0~1 값
   * @returns {number} 적용된 값
   */
  function setVolume(nextVolume) {
    volume = clampNumber(nextVolume, 0, 1, volume);
    if (volume > 0) muted = false;
    safeWrite(storage, STORAGE_KEYS.volume, String(volume));
    safeWrite(storage, STORAGE_KEYS.muted, String(muted));
    applyMasterGain();
    if (volume === 0) stopScheduler();
    else if (!muted && !hidden) startScheduler();
    return volume;
  }

  /**
   * BGM 또는 SFX 채널 볼륨을 설정한다.
   * @param {'bgm'|'sfx'} channel 채널
   * @param {number} nextVolume 0~1 값
   * @returns {number} 적용된 값
   */
  function setChannelVolume(channel, nextVolume) {
    if (channel !== 'bgm' && channel !== 'sfx') return 0;
    const current = channel === 'bgm' ? bgmVolume : sfxVolume;
    const next = clampNumber(nextVolume, 0, 1, current);
    if (channel === 'bgm') {
      bgmVolume = next;
      safeWrite(storage, STORAGE_KEYS.bgmVolume, String(next));
      if (bgmGain && context) ramp(bgmGain.gain, DEFAULTS.bgm * next, context.currentTime);
    } else {
      sfxVolume = next;
      safeWrite(storage, STORAGE_KEYS.sfxVolume, String(next));
      if (sfxGain && context) ramp(sfxGain.gain, DEFAULTS.sfx * next, context.currentTime);
    }
    return next;
  }

  /**
   * BGM 장면을 전환한다.
   * @param {string} nextScene 장면 이름
   * @returns {string} 적용된 장면
   */
  function setScene(nextScene) {
    if (!SCENES.has(nextScene) || destroyed || scene === nextScene) return scene;
    scene = nextScene;
    patternIndex = 0;
    nextBeatTime = context?.currentTime ?? 0;
    if (scene === 'silent') {
      stopScheduler();
      if (bgmGain && context) ramp(bgmGain.gain, 0, context.currentTime, 0.2);
    } else {
      if (bgmGain && context) ramp(bgmGain.gain, DEFAULTS.bgm * bgmVolume, context.currentTime, 0.25);
      startScheduler();
    }
    return scene;
  }

  /**
   * 서버 이벤트 ID를 제한된 저장소에 기록한다.
   * @param {string} eventId 이벤트 ID
   * @returns {boolean} 처음 관찰한 ID 여부
   */
  function rememberEvent(eventId) {
    if (!eventId) return true;
    if (eventIds.has(eventId)) return false;
    eventIds.add(eventId);
    eventQueue.push(eventId);
    if (eventQueue.length > MAX_EVENT_IDS) eventIds.delete(eventQueue.shift());
    return true;
  }

  /**
   * 의미 기반 효과음을 재생한다.
   * @param {string} key 효과음 키
   * @param {object} [metadata] eventId와 변형 정보
   * @returns {boolean} 재생 요청 수락 여부
   */
  function playSfx(key, metadata = {}) {
    if (destroyed || muted || volume === 0 || hidden || !context || context.state !== 'running') return false;
    const canonicalKey = key === 'reconnect' || key === 'resume' ? 'connection' : key;
    if (!(canonicalKey in SFX_COOLDOWNS) || !rememberEvent(metadata.eventId)) {
      diagnostics.suppressedSfx += 1;
      return false;
    }
    const timestamp = nowMs();
    if (timestamp - (lastPlayed.get(canonicalKey) ?? -Infinity) < SFX_COOLDOWNS[canonicalKey]) {
      diagnostics.suppressedSfx += 1;
      return false;
    }
    lastPlayed.set(canonicalKey, timestamp);
    const tones = {
      'ui.select': [[660, 720, 0.045, 0.08]],
      'ui.confirm': [[523.25, 523.25, 0.08, 0.12], [783.99, 783.99, 0.12, 0.1, 0.07]],
      jump: [[330, 760, 0.16, 0.13]],
      land: [[130, 70, 0.13, 0.16]],
      'device.powered': [[110, 220, 0.24, 0.1], [659.25, 659.25, 0.13, 0.11, 0.12]],
      'device.latched': [[260, 95, 0.11, 0.16]],
      checkpoint: [[523.25, 523.25, 0.12, 0.12], [659.25, 659.25, 0.15, 0.11, 0.08], [987.77, 987.77, 0.2, 0.1, 0.16]],
      fall: [[520, 90, 0.3, 0.12]],
      boost: [[240, 980, 0.24, 0.13]],
      'finish.start': [[392, 392, 0.22, 0.13], [415.3, 415.3, 0.22, 0.13, 0.04]],
      'finish.expired': [[330, 196, 0.3, 0.13], [277.18, 146.83, 0.34, 0.1, 0.08]],
      result: [[523.25, 523.25, 0.18, 0.13], [659.25, 659.25, 0.22, 0.12, 0.1], [783.99, 783.99, 0.34, 0.13, 0.2]],
      connection: metadata.resumed === false || key === 'reconnect'
        ? [[330, 220, 0.18, 0.1]]
        : [[392, 659.25, 0.22, 0.11]]
    };
    let accepted = false;
    const baseTime = context.currentTime;
    for (const [frequency, endFrequency, duration, level, offset = 0] of tones[canonicalKey]) {
      accepted = synthVoice({ frequency, endFrequency, duration, level, when: baseTime + offset }) || accepted;
    }
    if (accepted) diagnostics.playedSfx += 1;
    return accepted;
  }

  /**
   * 스냅샷의 로컬 플레이어 이동 에지를 관찰한다.
   * @param {object} snapshot 서버 스냅샷
   * @param {string|number} localPlayerId 로컬 플레이어 ID
   * @returns {void}
   */
  function observeSnapshot(snapshot, localPlayerId) {
    const players = snapshot?.players;
    const player = Array.isArray(players)
      ? players.find((candidate) => String(candidate.id) === String(localPlayerId))
      : players?.[localPlayerId];
    if (!player) return;
    const grounded = Boolean(player.grounded);
    const previous = observeSnapshot.previous;
    if (previous?.playerId === String(localPlayerId)) {
      if (previous.grounded && !grounded && Number(player.vy) < 0) playSfx('jump');
      if (!previous.grounded && grounded) playSfx('land');
    }
    observeSnapshot.previous = { playerId: String(localPlayerId), grounded };
  }

  /**
   * visibility에 따라 오디오를 정지하거나 복원한다.
   * @param {boolean} [isHidden] 숨김 여부
   * @returns {Promise<boolean>} 복원 성공 여부
   */
  async function suspendForVisibility(isHidden = Boolean(documentRef?.hidden)) {
    hidden = Boolean(isHidden);
    applyMasterGain(hidden ? 0.02 : 0.08);
    if (hidden) {
      stopScheduler();
      try {
        await context?.suspend?.();
      } catch {
        // 일부 브라우저는 전환 중 suspend를 거부한다.
      }
      return true;
    }
    if (!context || muted) return false;
    try {
      await context.resume?.();
      startScheduler();
      return context.state === 'running';
    } catch {
      return false;
    }
  }

  /**
   * 엔진 상태를 테스트와 진단용으로 반환한다.
   * @returns {object} 직렬화 가능한 상태
   */
  function getDiagnostics() {
    return {
      ...diagnostics,
      supported: Boolean(context || (options.contextFactory ?? globalWindow?.AudioContext ?? globalWindow?.webkitAudioContext)),
      unlocked: context?.state === 'running',
      muted,
      volume,
      bgmVolume,
      sfxVolume,
      scene,
      hidden,
      schedulerActive: timer !== null,
      activeVoices,
      rememberedEvents: eventQueue.length,
      destroyed
    };
  }

  /**
   * 타이머와 AudioContext를 영구 정리한다.
   * @returns {Promise<void>}
   */
  async function destroy() {
    if (destroyed) return;
    destroyed = true;
    stopScheduler();
    observeSnapshot.previous = null;
    try {
      await context?.close?.();
    } catch {
      // 이미 닫힌 Context도 안전하게 정리한다.
    }
    context = null;
    masterGain = null;
    bgmGain = null;
    sfxGain = null;
    activeVoices = 0;
  }

  const onVisibilityChange = () => void suspendForVisibility();
  documentRef?.addEventListener?.('visibilitychange', onVisibilityChange);

  return Object.freeze({
    unlock,
    setMuted,
    setVolume,
    setChannelVolume,
    setScene,
    playSfx,
    observeSnapshot,
    suspendForVisibility,
    getDiagnostics,
    destroy: async () => {
      documentRef?.removeEventListener?.('visibilitychange', onVisibilityChange);
      await destroy();
    }
  });
}

export const AUDIO_SCENES = Object.freeze([...SCENES]);
export const AUDIO_SFX_KEYS = Object.freeze(Object.keys(SFX_COOLDOWNS));
