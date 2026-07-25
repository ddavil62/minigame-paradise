/**
 * @fileoverview 외부 파일 없이 Web Audio로 경기 BGM과 짧은 행동 효과음을 합성한다.
 */
const STORAGE_KEY = 'sichuan:muted';

export class AudioManager {
  /** 합성 오디오 상태를 초기화한다. */
  constructor() {
    this.context = null; this.master = null; this.bgmTimer = null; this.bgmStep = 0;
    this.muted = localStorage.getItem(STORAGE_KEY) === '1'; this.playing = false;
  }

  /** @returns {boolean} 현재 음소거 여부 */
  isMuted() { return this.muted; }

  /** @returns {boolean} 사용자 제스처 뒤 오디오 컨텍스트를 사용할 수 있는지 */
  async unlock() {
    if (!this.context) {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) return false;
      this.context = new Context();
      this.master = this.context.createGain(); this.master.gain.value = this.muted ? 0 : 0.32;
      this.master.connect(this.context.destination);
    }
    if (this.context.state === 'suspended') await this.context.resume();
    if (this.playing && !this.muted) this.startBgm();
    return this.context.state === 'running';
  }

  /** @param {boolean} muted 새 음소거 상태 @returns {void} */
  setMuted(muted) {
    this.muted = Boolean(muted); localStorage.setItem(STORAGE_KEY, this.muted ? '1' : '0');
    if (this.master && this.context) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.32, this.context.currentTime, 0.015);
    if (this.muted) this.stopBgm(); else if (this.playing) { this.unlock(); this.startBgm(); }
  }

  /** @returns {boolean} 토글 뒤 음소거 여부 */
  toggleMuted() { this.setMuted(!this.muted); return this.muted; }

  /** @param {boolean} active 경기 BGM 활성 여부 @returns {void} */
  setPlaying(active) {
    this.playing = Boolean(active);
    if (this.playing && !this.muted) this.startBgm(); else this.stopBgm();
  }

  /** @private @param {number} frequency 주파수 @param {number} duration 길이 @param {number} volume 음량 @param {OscillatorType} [type] 파형 @param {number} [delay] 지연 @returns {void} */
  tone(frequency, duration, volume, type = 'sine', delay = 0) {
    if (!this.context || !this.master || this.muted || this.context.state !== 'running') return;
    const start = this.context.currentTime + delay;
    const oscillator = this.context.createOscillator(); const gain = this.context.createGain();
    oscillator.type = type; oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start); gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain); gain.connect(this.master); oscillator.start(start); oscillator.stop(start + duration + 0.02);
  }

  /** @param {'select'|'match'|'invalid'|'item'|'hint'|'attack'|'blocked'} name 효과음 이름 @returns {void} */
  play(name) {
    const sounds = {
      select: () => this.tone(520, 0.07, 0.11, 'sine'),
      match: () => { this.tone(660, 0.1, 0.13); this.tone(990, 0.14, 0.11, 'sine', 0.07); },
      invalid: () => { this.tone(150, 0.14, 0.12, 'sawtooth'); this.tone(120, 0.12, 0.08, 'square', 0.08); },
      item: () => { this.tone(420, 0.08, 0.11, 'triangle'); this.tone(720, 0.13, 0.1, 'triangle', 0.045); },
      hint: () => { this.tone(740, 0.12, 0.1); this.tone(1110, 0.18, 0.1, 'sine', 0.09); },
      attack: () => { this.tone(210, 0.16, 0.13, 'sawtooth'); this.tone(330, 0.12, 0.08, 'square', 0.06); },
      blocked: () => { this.tone(880, 0.08, 0.14, 'square'); this.tone(440, 0.22, 0.12, 'triangle', 0.05); },
    };
    sounds[name]?.();
  }

  /** @private @returns {void} 저음량 반복 BGM 스케줄러를 시작한다. */
  startBgm() {
    if (this.bgmTimer || !this.context || this.context.state !== 'running' || this.muted || !this.playing) return;
    const notes = [220, 277.18, 329.63, 277.18, 196, 246.94, 329.63, 246.94];
    const pulse = () => {
      if (!this.playing || this.muted) return;
      const note = notes[this.bgmStep % notes.length]; this.bgmStep += 1;
      this.tone(note, 0.42, 0.035, 'triangle'); this.tone(note / 2, 0.36, 0.025, 'sine', 0.02);
    };
    pulse(); this.bgmTimer = setInterval(pulse, 520);
  }

  /** @returns {void} BGM 스케줄러를 정리한다. */
  stopBgm() { if (this.bgmTimer) clearInterval(this.bgmTimer); this.bgmTimer = null; }
}
