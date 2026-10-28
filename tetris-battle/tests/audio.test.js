/** @fileoverview BGM/SFX 엔진과 게임 이벤트 오디오 연결 단위 테스트. */
import { createAudio, AUDIO_STORAGE_KEY } from '../public/js/audio.js';
import { createGame } from '../public/js/game.js';

let pass = 0;
let fail = 0;

function assert(condition, name) {
  if (condition) {
    pass += 1;
    console.log(`  PASS  ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${name}`);
  }
}

class FakeAudioParam {
  constructor() { this.value = 0; this.targets = []; }
  setValueAtTime(value) { this.value = value; }
  exponentialRampToValueAtTime(value) { this.value = value; }
  setTargetAtTime(value) { this.value = value; this.targets.push(value); }
}

class FakeNode {
  constructor() {
    this.gain = new FakeAudioParam();
    this.frequency = new FakeAudioParam();
    this.started = 0;
    this.stopped = 0;
  }
  connect() { return this; }
  start() { this.started += 1; }
  stop() { this.stopped += 1; }
}

class FakeAudioContext {
  constructor() {
    this.currentTime = 1;
    this.sampleRate = 8000;
    this.state = 'suspended';
    this.destination = new FakeNode();
    this.oscillators = [];
  }
  createGain() { return new FakeNode(); }
  createOscillator() { const node = new FakeNode(); this.oscillators.push(node); return node; }
  createBufferSource() { return new FakeNode(); }
  createBiquadFilter() { return new FakeNode(); }
  createBuffer(_channels, length) {
    const data = new Float32Array(length);
    return { getChannelData: () => data };
  }
  async resume() { this.state = 'running'; }
}

const values = new Map();
const storage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
};
const listeners = new Map();
const documentRef = {
  addEventListener: (name, callback) => listeners.set(name, callback),
  removeEventListener: (name) => listeners.delete(name),
};
let intervalCreated = 0;
const windowRef = {
  AudioContext: FakeAudioContext,
  setInterval: () => { intervalCreated += 1; return intervalCreated; },
  clearInterval: () => {},
};

console.log('\n── Audio engine ─────────────────');
const audio = createAudio({ windowRef, documentRef, storage });
assert(audio.isMuted() === false, '기본 상태는 소리 켜짐');
assert(listeners.has('pointerdown') && listeners.has('keydown'), '첫 사용자 입력용 unlock 리스너 등록');
audio.startMusic('battle');
assert(audio.getTheme() === 'battle', '배틀 BGM 테마 전환');
assert(await audio.unlock(), '사용자 입력 후 AudioContext unlock');
assert(intervalCreated === 1, 'unlock 후 BGM 스케줄러 1회 시작');
audio.play('drop', 15);
audio.play('clear', 4);
audio.play('win');
assert(audio.toggleMuted() === true, '음소거 토글 ON');
assert(values.get(AUDIO_STORAGE_KEY) === 'true', '음소거 설정 저장');
assert(audio.toggleMuted() === false, '음소거 토글 OFF');

console.log('\n── Game audio events ─────────────');
const originalRaf = globalThis.requestAnimationFrame;
const originalCancelRaf = globalThis.cancelAnimationFrame;
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = () => {};
const events = [];
const game = createGame({
  renderBoard() {}, renderHUD() {}, renderNext() {}, renderHold() {},
  onAttack() {}, onGameOver() {}, onBoardChange() {},
  onSound: (name, detail) => events.push([name, detail]),
});
game.start();
game.moveLeft();
game.rotateCW();
game.hold();
game.receiveGarbage(2);
game.hardDrop();
assert(events.some(([name]) => name === 'move'), '블록 이동 효과음 이벤트');
assert(events.some(([name]) => name === 'rotate'), '블록 회전 효과음 이벤트');
assert(events.some(([name]) => name === 'hold'), '홀드 효과음 이벤트');
assert(events.some(([name]) => name === 'garbage'), '가비지 수신 효과음 이벤트');
assert(events.some(([name]) => name === 'drop'), '하드드롭 효과음 이벤트');
assert(events.some(([name]) => name === 'lock'), '블록 고정 효과음 이벤트');
globalThis.requestAnimationFrame = originalRaf;
globalThis.cancelAnimationFrame = originalCancelRaf;

console.log(`\nPASS: ${pass}, FAIL: ${fail}`);
if (fail > 0) process.exit(1);
