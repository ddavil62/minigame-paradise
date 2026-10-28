/**
 * @fileoverview 외부 에셋 없이 Web Audio로 끝말잇기 전투 BGM과 효과음을 합성한다.
 */
const STORAGE_KEY = 'wordchain-battle:muted';

class WordchainAudio {
  constructor() {
    this.context = null;
    this.master = null;
    this.musicBus = null;
    this.effectsBus = null;
    this.musicTimer = null;
    this.musicStep = 0;
    this.playing = false;
    this.muted = localStorage.getItem(STORAGE_KEY) === '1';
    this.lastTypeAt = 0;
  }

  isMuted() { return this.muted; }

  async unlock() {
    if (!this.context) {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) return false;
      this.context = new Context();
      this.master = this.context.createGain();
      this.musicBus = this.context.createGain();
      this.effectsBus = this.context.createGain();
      this.master.gain.value = this.muted ? 0 : 0.34;
      this.musicBus.gain.value = 0.3;
      this.effectsBus.gain.value = 0.9;
      this.musicBus.connect(this.master);
      this.effectsBus.connect(this.master);
      this.master.connect(this.context.destination);
    }
    if (this.context.state === 'suspended') await this.context.resume();
    if (this.playing && !this.muted) this.startBgm();
    return this.context.state === 'running';
  }

  bindUnlock() {
    const unlock = () => this.unlock().then((ready) => {
      if (!ready) return;
      document.removeEventListener('pointerdown', unlock, true);
      document.removeEventListener('keydown', unlock, true);
    });
    document.addEventListener('pointerdown', unlock, true);
    document.addEventListener('keydown', unlock, true);
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    localStorage.setItem(STORAGE_KEY, this.muted ? '1' : '0');
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.34, this.context.currentTime, 0.02);
    }
    if (this.muted) this.stopBgm();
    else this.unlock().then(() => { if (this.playing) this.startBgm(); });
  }

  toggleMuted() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  setPlaying(active) {
    this.playing = Boolean(active);
    if (!this.playing || this.muted) this.stopBgm();
    else this.unlock().then(() => this.startBgm());
  }

  tone(frequency, duration, volume, type = 'sine', delay = 0, music = false, glideTo = null) {
    if (!this.context || !this.master || this.muted || this.context.state !== 'running') return;
    const start = this.context.currentTime + delay;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    if (Number.isFinite(glideTo)) oscillator.frequency.exponentialRampToValueAtTime(glideTo, start + duration);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(music ? this.musicBus : this.effectsBus);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.03);
  }

  play(name, detail = 0) {
    if (name === 'type') {
      const now = performance.now();
      if (now - this.lastTypeAt < 38) return;
      this.lastTypeAt = now;
    }
    const sounds = {
      type: () => this.tone(560 + (Number(detail) % 5) * 24, 0.045, 0.055, 'square'),
      submit: () => { this.tone(260, 0.16, 0.11, 'sawtooth', 0, false, 620); this.tone(720, 0.08, 0.07, 'triangle', 0.1); },
      accepted: () => { this.tone(523.25, 0.1, 0.11); this.tone(659.25, 0.13, 0.1, 'sine', 0.07); this.tone(783.99, 0.16, 0.09, 'sine', 0.13); },
      invalid: () => { this.tone(180, 0.15, 0.12, 'sawtooth', 0, false, 120); this.tone(105, 0.18, 0.08, 'square', 0.08); },
      rewardOpen: () => { this.tone(440, 0.12, 0.09, 'triangle'); this.tone(660, 0.15, 0.09, 'triangle', 0.08); this.tone(880, 0.2, 0.08, 'triangle', 0.16); },
      rewardSelect: () => { this.tone(740, 0.09, 0.12, 'square'); this.tone(1110, 0.18, 0.09, 'triangle', 0.06); },
      rewardExpired: () => { this.tone(260, 0.18, 0.08, 'triangle'); this.tone(196, 0.24, 0.08, 'triangle', 0.1); },
      countdown: () => this.tone(440 + Math.max(0, 3 - Number(detail)) * 110, 0.12, 0.11, 'square'),
      start: () => { this.tone(523.25, 0.12, 0.12, 'square'); this.tone(783.99, 0.22, 0.11, 'triangle', 0.1); },
      timer: () => this.tone(Number(detail) <= 3 ? 760 : 420, 0.055, Number(detail) <= 3 ? 0.075 : 0.026, 'square'),
      projectile: () => { this.tone(190, 0.24, 0.11, 'sawtooth', 0, false, 520); this.tone(310, 0.18, 0.06, 'triangle', 0.05, false, 690); },
      impact: () => { this.tone(92, 0.26, 0.16, 'square', 0, false, 55); this.tone(170, 0.13, 0.12, 'sawtooth'); },
      timeout: () => { this.tone(740, 0.13, 0.13, 'square'); this.tone(370, 0.18, 0.12, 'square', 0.12); this.tone(110, 0.28, 0.14, 'sawtooth', 0.22); },
      ko: () => { this.tone(220, 0.22, 0.14, 'sawtooth', 0, false, 110); this.tone(110, 0.42, 0.15, 'square', 0.16, false, 55); },
      win: () => [523.25, 659.25, 783.99, 1046.5].forEach((note, index) => this.tone(note, 0.28, 0.09, 'triangle', index * 0.1)),
      lose: () => [392, 311.13, 246.94, 196].forEach((note, index) => this.tone(note, 0.3, 0.08, 'sawtooth', index * 0.12)),
    };
    sounds[name]?.();
  }

  startBgm() {
    if (this.musicTimer || !this.context || this.context.state !== 'running' || this.muted || !this.playing) return;
    const melody = [220, 277.18, 329.63, 440, 329.63, 277.18, 246.94, 329.63, 196, 246.94, 293.66, 392, 293.66, 246.94, 220, 293.66];
    const bass = [110, 110, 98, 98, 87.31, 87.31, 98, 98];
    const pulse = () => {
      if (!this.playing || this.muted) return;
      const step = this.musicStep++;
      this.tone(melody[step % melody.length], 0.3, 0.045, 'triangle', 0, true);
      if (step % 2 === 0) this.tone(bass[Math.floor(step / 2) % bass.length], 0.38, 0.04, 'sine', 0, true);
      if (step % 4 === 2) this.tone(880, 0.025, 0.018, 'square', 0, true);
    };
    pulse();
    this.musicTimer = setInterval(pulse, 360);
  }

  stopBgm() {
    if (this.musicTimer) clearInterval(this.musicTimer);
    this.musicTimer = null;
  }
}

export const audio = new WordchainAudio();
