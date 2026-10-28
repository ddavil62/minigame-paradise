/**
 * @fileoverview 맞고 전용 절차형 Web Audio BGM 및 효과음 엔진.
 *
 * 정적 음원 없이 신나는 판놀이 BGM과 카드 이동, 특수 족보, 선택 및 결과음을 합성한다.
 */
((root) => {
  'use strict';

  const EFFECT_COOLDOWNS = Object.freeze({
    'card.throw': 55, 'deck.flip': 90, 'card.land': 55,
    capture: 100, 'pi.steal': 160,
    'special.jjok': 220, 'special.ppeok': 260, 'special.ttadak': 220,
    'special.sweep': 300, 'special.bomb': 420, 'special.joker': 220,
    'special.shake': 300, 'special.sangtong': 500,
    'decision.go': 180, 'decision.stop': 500, 'decision.kkeut': 180,
    'round.win': 500, 'round.loss': 500, 'round.draw': 500,
  });
  const MAX_DEDUPE_KEYS = 256;
  const MAX_VOICES = 12;
  const MAX_MUSIC_VOICES = 24;
  const BGM_STORAGE_KEY = 'matgo:bgm-enabled';
  const MASTER_GAIN = 0.44;
  const BGM_GAIN = 0.82;
  const BGM_LOOK_AHEAD_SECONDS = 0.28;
  const BGM_INTERVAL_MS = 80;
  const BGM_SCENES = Object.freeze({
    play: Object.freeze({
      bpm: 136,
      melody: Object.freeze([
        587.33, 698.46, 783.99, 880.00, 783.99, 698.46, 587.33, 523.25,
        587.33, 698.46, 783.99, 1046.50, 880.00, 783.99, 698.46, null,
        587.33, 783.99, 880.00, 1046.50, 880.00, 783.99, 698.46, 587.33,
        523.25, 587.33, 698.46, 783.99, 698.46, 587.33, 523.25, null,
      ]),
      bass: Object.freeze([
        73.42, null, null, null, 65.41, null, null, null,
        87.31, null, null, null, 55.00, null, null, null,
      ]),
    }),
    win: Object.freeze({
      bpm: 112,
      melody: Object.freeze([
        523.25, 659.25, 783.99, 1046.50, 783.99, 1046.50, 1318.51, null,
        587.33, 698.46, 880.00, 1174.66, 880.00, 1046.50, 1318.51, null,
      ]),
      bass: Object.freeze([65.41, null, null, null, 73.42, null, null, null]),
    }),
    loss: Object.freeze({
      bpm: 82,
      melody: Object.freeze([
        392.00, null, 349.23, null, 293.66, null, 261.63, null,
        349.23, null, 293.66, null, 246.94, null, 220.00, null,
      ]),
      bass: Object.freeze([65.41, null, null, null, 55.00, null, null, null]),
    }),
    draw: Object.freeze({
      bpm: 96,
      melody: Object.freeze([
        392.00, null, 440.00, null, 392.00, null, 329.63, null,
        349.23, null, 392.00, null, 349.23, null, 293.66, null,
      ]),
      bass: Object.freeze([65.41, null, null, null, 73.42, null, null, null]),
    }),
  });

  /**
   * 맞고 효과음 엔진을 만든다.
   *
   * @param {object} [options]
   * @param {Function} [options.audioContextFactory] 테스트용 AudioContext 팩토리
   * @param {Function} [options.now] 단조 증가 시계(ms)
   * @returns {{unlock:Function,playSfx:Function,setBgmEnabled:Function,isBgmEnabled:Function,handleVisibility:Function,destroy:Function,getDiagnostics:Function}}
   */
  function createAudioEngine(options = {}) {
    const contextFactory = options.audioContextFactory || (() => {
      const AudioContextClass = root.AudioContext || root.webkitAudioContext;
      return AudioContextClass ? new AudioContextClass() : null;
    });
    const now = options.now || (() => (
      root.performance && typeof root.performance.now === 'function'
        ? root.performance.now()
        : Date.now()
    ));
    let storage = options.storage || null;
    if (!storage) {
      try { storage = root.localStorage || null; } catch { storage = null; }
    }
    const setIntervalFn = options.setInterval || root.setInterval?.bind(root) || (() => 0);
    const clearIntervalFn = options.clearInterval || root.clearInterval?.bind(root) || (() => {});

    let context = null;
    let master = null;
    let musicMaster = null;
    let unlocked = false;
    let destroyed = false;
    let hidden = false;
    let playCount = 0;
    let droppedCount = 0;
    let bgmEnabled = true;
    let bgmPlaying = false;
    let bgmScene = 'play';
    let bgmStep = 0;
    let nextBgmTime = 0;
    let bgmTimer = 0;
    const activeVoices = new Set();
    const activeMusicVoices = new Set();
    const recentEventKeys = new Map();
    const lastPlayedAt = new Map();

    try {
      bgmEnabled = storage?.getItem(BGM_STORAGE_KEY) !== 'false';
    } catch { /* 저장소가 차단되면 기본 ON을 유지한다. */ }

    /**
     * Web Audio 그래프를 최초 사용자 제스처 시점에만 만든다.
     * @returns {boolean} 그래프가 사용 가능하면 true
     */
    function ensureGraph() {
      if (destroyed) return false;
      if (context && master && musicMaster) return true;
      try {
        context = contextFactory();
        if (!context || typeof context.createGain !== 'function') return false;
        master = context.createGain();
        musicMaster = context.createGain();
        master.gain.setValueAtTime(MASTER_GAIN, context.currentTime || 0);
        musicMaster.gain.setValueAtTime(bgmEnabled ? BGM_GAIN : 0.0001, context.currentTime || 0);
        musicMaster.connect(master);
        master.connect(context.destination);
        return true;
      } catch {
        context = null;
        master = null;
        musicMaster = null;
        return false;
      }
    }

    /**
     * 최초 제스처에서 오디오를 활성화한다.
     * @returns {Promise<boolean>} 활성화 성공 여부
     */
    async function unlock() {
      if (destroyed) return false;
      if (!ensureGraph()) return false;
      try {
        if (context.state === 'suspended' && typeof context.resume === 'function') {
          await context.resume();
        }
        unlocked = context.state !== 'closed';
        if (unlocked && bgmEnabled && !hidden) startBgm();
        return unlocked;
      } catch {
        return false;
      }
    }

    /**
     * 종료된 voice를 추적 목록에서 제거한다.
     * @param {{nodes:Array,stop:Function}} voice
     * @returns {void}
     */
    function releaseVoice(voice) {
      if (!activeVoices.delete(voice)) return;
      for (const node of voice.nodes) {
        try { node.disconnect(); } catch { /* 이미 끊긴 노드는 무시한다. */ }
      }
    }

    /**
     * 동시 발음 수를 제한하며 새 voice를 등록한다.
     * @param {Array} nodes
     * @returns {{nodes:Array,stop:Function}}
     */
  function registerVoice(nodes) {
      while (activeVoices.size >= MAX_VOICES) {
        const oldest = activeVoices.values().next().value;
        oldest.stop();
      }
      const voice = {
        nodes,
        stop() {
          for (const node of nodes) {
            if (typeof node.stop === 'function') {
              try { node.stop(); } catch { /* 이미 종료된 노드는 무시한다. */ }
            }
          }
          releaseVoice(voice);
        },
      };
      activeVoices.add(voice);
      return voice;
    }

    /** BGM voice를 효과음 동시 발음 제한과 분리해 추적한다. */
    function registerMusicVoice(nodes) {
      while (activeMusicVoices.size >= MAX_MUSIC_VOICES) {
        activeMusicVoices.values().next().value.stop();
      }
      const voice = {
        nodes,
        stop() {
          for (const node of nodes) {
            if (typeof node.stop === 'function') {
              try { node.stop(); } catch { /* 이미 종료된 노드는 무시한다. */ }
            }
          }
          if (!activeMusicVoices.delete(voice)) return;
          for (const node of nodes) {
            try { node.disconnect(); } catch { /* 이미 끊긴 노드는 무시한다. */ }
          }
        },
      };
      activeMusicVoices.add(voice);
      return voice;
    }

    /** 지정 시각에 BGM 음 하나를 예약한다. */
    function musicTone(frequency, start, duration, options = {}) {
      if (!context || !musicMaster || !frequency) return;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = options.type || 'triangle';
      oscillator.frequency.setValueAtTime(frequency, start);
      if (options.endFrequency) {
        oscillator.frequency.exponentialRampToValueAtTime(
          Math.max(20, options.endFrequency),
          start + duration,
        );
      }
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(options.gain || 0.1, start + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(gain);
      gain.connect(musicMaster);
      const voice = registerMusicVoice([oscillator, gain]);
      oscillator.onended = () => voice.stop();
      oscillator.start(start);
      oscillator.stop(start + duration + 0.02);
    }

    /** 한 스텝의 멜로디·장단·베이스를 예약한다. */
    function scheduleBgmStep(start) {
      const scene = BGM_SCENES[bgmScene];
      const stepSeconds = 60 / scene.bpm / 2;
      const melody = scene.melody[bgmStep % scene.melody.length];
      const bass = scene.bass[bgmStep % scene.bass.length];
      if (melody) {
        musicTone(melody, start, stepSeconds * (bgmScene === 'loss' ? 1.15 : 0.72), {
          type: bgmScene === 'play' && bgmStep % 4 === 3 ? 'square' : 'triangle',
          gain: bgmScene === 'loss' ? 0.07 : (bgmStep % 4 === 0 ? 0.12 : 0.085),
        });
      }
      if (bass) {
        musicTone(bass, start, stepSeconds * 1.7, {
          type: 'triangle', gain: bgmScene === 'loss' ? 0.09 : 0.14,
        });
      }
      // 북·장구를 연상시키는 저음 장단과 짧은 채 소리를 교차한다.
      if (bgmScene === 'play' && bgmStep % 4 === 0) {
        musicTone(105, start, 0.1, { type: 'sine', endFrequency: 48, gain: 0.16 });
      } else if (bgmScene === 'play' && bgmStep % 4 === 2) {
        musicTone(920, start, 0.045, { type: 'square', endFrequency: 620, gain: 0.045 });
      } else if (bgmScene === 'win' && bgmStep % 4 === 0) {
        musicTone(130, start, 0.12, { type: 'sine', endFrequency: 64, gain: 0.12 });
      }
      bgmStep += 1;
    }

    /** look-ahead 방식으로 BGM을 끊김 없이 예약한다. */
    function scheduleBgm() {
      if (!bgmPlaying || !bgmEnabled || hidden || !context || context.state === 'closed') return;
      nextBgmTime = Math.max(nextBgmTime, (context.currentTime || 0) + 0.025);
      while (nextBgmTime < (context.currentTime || 0) + BGM_LOOK_AHEAD_SECONDS) {
        scheduleBgmStep(nextBgmTime);
        nextBgmTime += 60 / BGM_SCENES[bgmScene].bpm / 2;
      }
    }

    /** BGM 시퀀서를 시작한다. */
    function startBgm() {
      if (bgmPlaying || !unlocked || !bgmEnabled || hidden || !context || !musicMaster) return false;
      bgmPlaying = true;
      musicMaster.gain.setValueAtTime(BGM_GAIN, context.currentTime || 0);
      nextBgmTime = (context.currentTime || 0) + 0.04;
      scheduleBgm();
      bgmTimer = setIntervalFn(scheduleBgm, BGM_INTERVAL_MS);
      return true;
    }

    /** BGM 시퀀서와 예약된 BGM voice를 정리한다. */
    function stopBgm() {
      bgmPlaying = false;
      if (bgmTimer) clearIntervalFn(bgmTimer);
      bgmTimer = 0;
      for (const voice of [...activeMusicVoices]) voice.stop();
      nextBgmTime = 0;
    }

    /** BGM 사용 여부를 저장하고 즉시 반영한다. */
    function setBgmEnabled(enabled) {
      bgmEnabled = !!enabled;
      try { storage?.setItem(BGM_STORAGE_KEY, String(bgmEnabled)); } catch { /* 저장 실패는 무시한다. */ }
      if (!bgmEnabled) {
        stopBgm();
        if (musicMaster && context) musicMaster.gain.setValueAtTime(0.0001, context.currentTime || 0);
      } else if (unlocked && !hidden) {
        startBgm();
      }
      return bgmEnabled;
    }

    /** 라운드 진행·결과에 맞는 BGM 장면으로 즉시 전환한다. */
    function setBgmScene(scene) {
      if (!Object.hasOwn(BGM_SCENES, scene) || scene === bgmScene) return bgmScene;
      stopBgm();
      bgmScene = scene;
      bgmStep = 0;
      if (bgmEnabled && unlocked && !hidden) startBgm();
      return bgmScene;
    }

    /**
     * 짧은 발진기 음을 예약한다.
     * @param {number} frequency 시작 주파수
     * @param {number} duration 지속 시간(초)
     * @param {object} [options]
     * @returns {void}
     */
    function tone(frequency, duration, options = {}) {
      const start = (context.currentTime || 0) + (options.delay || 0);
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const filter = typeof context.createBiquadFilter === 'function'
        ? context.createBiquadFilter()
        : null;
      oscillator.type = options.type || 'sine';
      oscillator.frequency.setValueAtTime(frequency, start);
      if (options.endFrequency) {
        oscillator.frequency.exponentialRampToValueAtTime(
          Math.max(20, options.endFrequency),
          start + duration,
        );
      }
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(options.gain || 0.18, start + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      if (filter) {
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(options.cutoff || 4200, start);
        oscillator.connect(filter);
        filter.connect(gain);
      } else {
        oscillator.connect(gain);
      }
      gain.connect(master);
      const voice = registerVoice(filter
        ? [oscillator, filter, gain]
        : [oscillator, gain]);
      oscillator.onended = () => releaseVoice(voice);
      oscillator.start(start);
      oscillator.stop(start + duration + 0.02);
    }

    /**
     * 종이 마찰감을 위한 짧은 결정론적 노이즈를 예약한다.
     * @param {number} duration 지속 시간(초)
     * @param {object} [options]
     * @returns {void}
     */
    function noise(duration, options = {}) {
      if (typeof context.createBuffer !== 'function'
          || typeof context.createBufferSource !== 'function') return;
      const sampleRate = context.sampleRate || 44100;
      const buffer = context.createBuffer(1, Math.max(1, Math.floor(sampleRate * duration)), sampleRate);
      const data = buffer.getChannelData(0);
      // 테스트와 실제 재생 모두 재현 가능한 작은 의사 난수 노이즈를 사용한다.
      let seed = 0x45d9f3b;
      for (let index = 0; index < data.length; index += 1) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        data[index] = ((seed / 0xffffffff) * 2 - 1) * (1 - index / data.length);
      }
      const source = context.createBufferSource();
      const gain = context.createGain();
      const filter = typeof context.createBiquadFilter === 'function'
        ? context.createBiquadFilter()
        : null;
      const start = (context.currentTime || 0) + (options.delay || 0);
      source.buffer = buffer;
      gain.gain.setValueAtTime(options.gain || 0.12, start);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      if (filter) {
        filter.type = options.filterType || 'bandpass';
        filter.frequency.setValueAtTime(options.frequency || 1800, start);
        filter.Q.setValueAtTime(options.q || 0.7, start);
        source.connect(filter);
        filter.connect(gain);
      } else {
        source.connect(gain);
      }
      gain.connect(master);
      const voice = registerVoice(filter ? [source, filter, gain] : [source, gain]);
      source.onended = () => releaseVoice(voice);
      source.start(start);
      source.stop(start + duration + 0.02);
    }

    /**
     * 효과음별 합성 패턴을 예약한다.
     * @param {string} key
     * @returns {boolean} 알려진 효과음이면 true
     */
    function synthesize(key) {
      const chord = (frequencies, gap = 0.07, duration = 0.14, type = 'sine') => {
        frequencies.forEach((frequency, index) => tone(frequency, duration, {
          delay: index * gap, type, gain: 0.14,
        }));
      };
      switch (key) {
        case 'card.throw': noise(0.09, { frequency: 1450, gain: 0.1 }); tone(520, 0.07, { endFrequency: 330, type: 'triangle', gain: 0.07 }); break;
        case 'deck.flip': noise(0.11, { frequency: 2300, gain: 0.11 }); tone(620, 0.08, { endFrequency: 880, type: 'triangle', gain: 0.08 }); break;
        case 'card.land': noise(0.055, { frequency: 780, gain: 0.14 }); tone(180, 0.06, { type: 'triangle', gain: 0.08 }); break;
        case 'capture': chord([330, 494], 0.045, 0.12, 'triangle'); break;
        case 'pi.steal': chord([440, 370, 554], 0.045, 0.1, 'triangle'); break;
        case 'special.jjok': chord([660, 990, 1320], 0.04, 0.16); break;
        case 'special.ppeok': tone(150, 0.24, { endFrequency: 62, type: 'sawtooth', gain: 0.16, cutoff: 900 }); noise(0.08, { frequency: 500, gain: 0.13 }); break;
        case 'special.ttadak': chord([880, 1175, 1568], 0.035, 0.13, 'square'); break;
        case 'special.sweep': chord([392, 523, 659, 784], 0.045, 0.18, 'triangle'); break;
        case 'special.bomb': tone(95, 0.42, { endFrequency: 38, type: 'sawtooth', gain: 0.2, cutoff: 700 }); noise(0.24, { frequency: 330, gain: 0.18 }); break;
        case 'special.joker': chord([740, 988, 1480], 0.055, 0.22, 'sine'); break;
        case 'special.shake': chord([220, 247, 220, 330], 0.045, 0.13, 'square'); break;
        case 'special.sangtong': chord([392, 523, 659, 784, 1047], 0.06, 0.28); break;
        case 'decision.go': chord([392, 523, 659], 0.055, 0.18, 'triangle'); break;
        case 'decision.stop': chord([523, 330, 196], 0.085, 0.28, 'triangle'); break;
        case 'decision.kkeut': chord([587, 784], 0.06, 0.18, 'triangle'); break;
        case 'round.win': chord([392, 523, 659, 784], 0.1, 0.32, 'triangle'); break;
        case 'round.loss': chord([392, 311, 196], 0.12, 0.4, 'triangle'); break;
        case 'round.draw': chord([330, 392, 330], 0.11, 0.28, 'sine'); break;
        default: return false;
      }
      return true;
    }

    /**
     * semantic key에 해당하는 효과음을 재생한다.
     * @param {string} key 효과음 키
     * @param {{eventKey?:string}} [metadata] 중복 방지 메타데이터
     * @returns {boolean} 재생을 예약했으면 true
     */
    function playSfx(key, metadata = {}) {
      if (destroyed || hidden || !unlocked || !context || context.state === 'closed') return false;
      const timestamp = now();
      const eventKey = metadata.eventKey ? String(metadata.eventKey) : '';
      if (eventKey && recentEventKeys.has(eventKey)) {
        droppedCount += 1;
        return false;
      }
      const lastTime = lastPlayedAt.get(key);
      if (Number.isFinite(lastTime)
          && timestamp - lastTime < (EFFECT_COOLDOWNS[key] || 80)) {
        droppedCount += 1;
        return false;
      }
      if (!synthesize(key)) return false;
      lastPlayedAt.set(key, timestamp);
      if (eventKey) {
        recentEventKeys.set(eventKey, timestamp);
        while (recentEventKeys.size > MAX_DEDUPE_KEYS) {
          recentEventKeys.delete(recentEventKeys.keys().next().value);
        }
      }
      playCount += 1;
      return true;
    }

    /**
     * 문서 가시성에 따라 오디오를 정지하거나 재개한다.
     * @param {boolean} isHidden 숨김 여부
     * @returns {void}
     */
    function handleVisibility(isHidden) {
      hidden = !!isHidden;
      if (!context || destroyed) return;
      try {
        if (hidden && typeof context.suspend === 'function') {
          stopBgm();
          void context.suspend().catch(() => {});
        } else if (unlocked && typeof context.resume === 'function') {
          void context.resume().then(() => {
            if (bgmEnabled && !hidden) startBgm();
          }).catch(() => {});
        }
      } catch { /* 오디오 실패가 게임 진행을 막지 않게 한다. */ }
    }

    /**
     * 모든 voice와 AudioContext 참조를 정리한다.
     * @returns {void}
     */
    function destroy() {
      if (destroyed) return;
      destroyed = true;
      stopBgm();
      for (const voice of [...activeVoices]) voice.stop();
      recentEventKeys.clear();
      lastPlayedAt.clear();
      try {
        if (context && typeof context.close === 'function') void context.close().catch(() => {});
      } catch { /* 종료 실패도 무시한다. */ }
      context = null;
      master = null;
      musicMaster = null;
      unlocked = false;
    }

    /**
     * 테스트 및 장애 분석용 읽기 전용 스냅샷을 반환한다.
     * @returns {object}
     */
    function getDiagnostics() {
      return {
        supported: !!(context || root.AudioContext || root.webkitAudioContext),
        contextCreated: !!context,
        contextState: context?.state || 'none',
        unlocked,
        hidden,
        destroyed,
        activeVoices: activeVoices.size,
        activeMusicVoices: activeMusicVoices.size,
        bgmEnabled,
        bgmPlaying,
        bgmScene,
        bgmStep,
        dedupeSize: recentEventKeys.size,
        playCount,
        droppedCount,
      };
    }

    return {
      unlock,
      playSfx,
      setBgmEnabled,
      isBgmEnabled: () => bgmEnabled,
      setBgmScene,
      handleVisibility,
      destroy,
      getDiagnostics,
    };
  }

  root.MatgoAudio = Object.freeze({ createAudioEngine });
})(typeof window !== 'undefined' ? window : globalThis);
