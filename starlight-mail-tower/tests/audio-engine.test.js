/**
 * @fileoverview 별빛 우편탑 오디오 엔진의 결정적 단위 테스트다.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEngine } from '../public/js/audio-engine.js';

class FakeParam {
  constructor(value = 0) {
    this.value = value;
    this.events = [];
  }
  cancelScheduledValues(time) { this.events.push(['cancel', time]); }
  setValueAtTime(value, time) { this.value = value; this.events.push(['set', value, time]); }
  linearRampToValueAtTime(value, time) { this.value = value; this.events.push(['linear', value, time]); }
  exponentialRampToValueAtTime(value, time) { this.value = value; this.events.push(['exponential', value, time]); }
}

class FakeNode {
  constructor() {
    this.connections = [];
  }
  connect(node) { this.connections.push(node); return node; }
  disconnect() { this.connections = []; }
}

class FakeGain extends FakeNode {
  constructor() {
    super();
    this.gain = new FakeParam(1);
  }
}

class FakeOscillator extends FakeNode {
  constructor(context) {
    super();
    this.context = context;
    this.frequency = new FakeParam(440);
    this.type = 'sine';
    this.onended = null;
  }
  start(time) { this.context.starts.push(time); }
  stop(time) { this.context.stops.push(time); }
}

class FakeFilter extends FakeNode {
  constructor() {
    super();
    this.frequency = new FakeParam(350);
    this.type = 'lowpass';
  }
}

class FakeAudioContext {
  constructor() {
    this.state = 'suspended';
    this.currentTime = 1;
    this.destination = new FakeNode();
    this.gains = [];
    this.starts = [];
    this.stops = [];
    this.closed = false;
  }
  createGain() { const node = new FakeGain(); this.gains.push(node); return node; }
  createOscillator() { return new FakeOscillator(this); }
  createBiquadFilter() { return new FakeFilter(); }
  async resume() { this.state = 'running'; }
  async suspend() { this.state = 'suspended'; }
  async close() { this.state = 'closed'; this.closed = true; }
}

/**
 * 테스트용 메모리 저장소를 만든다.
 * @param {object} initial 초기값
 * @returns {Storage} 저장소 대역
 */
function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    value: (key) => values.get(key)
  };
}

/**
 * 엔진과 가짜 실행 환경을 만든다.
 * @param {object} [config] 환경 설정
 * @returns {object} 테스트 묶음
 */
function fixture(config = {}) {
  const context = new FakeAudioContext();
  const timers = new Map();
  let timerId = 0;
  let now = 1000;
  const store = config.storage ?? storage();
  const engine = createAudioEngine({
    contextFactory: config.contextFactory ?? (() => context),
    storage: store,
    now: () => now,
    setInterval: (callback) => {
      timerId += 1;
      timers.set(timerId, callback);
      return timerId;
    },
    clearInterval: (id) => timers.delete(id)
  });
  return { context, engine, timers, store, tick: (ms) => { now += ms; } };
}

test('사용자 제스처 전에는 Context를 만들지 않고 한 번만 생성한다', async () => {
  let creations = 0;
  const setup = fixture({ contextFactory: () => { creations += 1; return setup.context; } });
  assert.equal(creations, 0);
  assert.equal(await setup.engine.unlock(), true);
  assert.equal(await setup.engine.unlock(), true);
  assert.equal(creations, 1);
  assert.equal(setup.timers.size, 1);
});

test('볼륨을 제한하고 mute 설정과 gain ramp를 저장한다', async () => {
  const setup = fixture();
  await setup.engine.unlock();
  assert.equal(setup.engine.setVolume(2), 1);
  assert.equal(setup.store.value('starlight-volume'), '1');
  assert.equal(setup.engine.setMuted(true), true);
  assert.equal(setup.store.value('starlight-muted'), 'true');
  assert.equal(setup.engine.getDiagnostics().schedulerActive, false);
  assert.ok(setup.context.gains[0].gain.events.some(([kind]) => kind === 'linear'));
});

test('손상된 저장값과 저장소 예외를 안전하게 처리한다', () => {
  const broken = {
    getItem(key) {
      if (key === 'starlight-volume') return 'NaN';
      throw new Error('blocked');
    },
    setItem() { throw new Error('blocked'); }
  };
  const engine = createAudioEngine({ storage: broken, contextFactory: () => null });
  assert.equal(engine.getDiagnostics().volume, 1);
  assert.doesNotThrow(() => engine.setMuted(true));
  assert.doesNotThrow(() => engine.setVolume(-5));
  assert.equal(engine.getDiagnostics().volume, 0);
});

test('장면 스케줄러는 한 개만 유지하고 silent에서 정지한다', async () => {
  const setup = fixture();
  await setup.engine.unlock();
  setup.engine.setScene('play');
  setup.engine.setScene('play');
  assert.equal(setup.timers.size, 1);
  assert.ok(setup.engine.getDiagnostics().scheduledNotes > 0);
  setup.engine.setScene('silent');
  assert.equal(setup.timers.size, 0);
});

test('eventId, cooldown과 전체 voice cap으로 중복 효과음을 억제한다', async () => {
  const setup = fixture();
  await setup.engine.unlock();
  assert.equal(setup.engine.playSfx('checkpoint', { eventId: 'event-1' }), true);
  assert.equal(setup.engine.playSfx('checkpoint', { eventId: 'event-1' }), false);
  assert.equal(setup.engine.playSfx('checkpoint', { eventId: 'event-2' }), false);
  setup.tick(181);
  assert.equal(setup.engine.playSfx('checkpoint', { eventId: 'event-3' }), true);
  for (let index = 0; index < 30; index += 1) {
    setup.tick(400);
    setup.engine.playSfx('result', { eventId: `voice-${index}` });
  }
  assert.ok(setup.engine.getDiagnostics().activeVoices <= 12);
  assert.ok(setup.engine.getDiagnostics().suppressedSfx > 0);
});

test('스냅샷은 첫 프레임을 무시하고 로컬 플레이어 jump/land edge만 관찰한다', async () => {
  const setup = fixture();
  await setup.engine.unlock();
  setup.engine.observeSnapshot({ players: [{ id: 'me', grounded: true, vy: 0 }] }, 'me');
  const baseline = setup.engine.getDiagnostics().playedSfx;
  setup.tick(121);
  setup.engine.observeSnapshot({ players: [{ id: 'me', grounded: false, vy: -3 }] }, 'me');
  setup.tick(121);
  setup.engine.observeSnapshot({ players: [{ id: 'me', grounded: true, vy: 0 }] }, 'me');
  assert.equal(setup.engine.getDiagnostics().playedSfx, baseline + 2);
});

test('visibility suspend/resume과 destroy가 타이머 및 Context를 정리한다', async () => {
  const setup = fixture();
  await setup.engine.unlock();
  await setup.engine.suspendForVisibility(true);
  assert.equal(setup.context.state, 'suspended');
  assert.equal(setup.timers.size, 0);
  await setup.engine.suspendForVisibility(false);
  assert.equal(setup.context.state, 'running');
  assert.equal(setup.timers.size, 1);
  await setup.engine.destroy();
  assert.equal(setup.context.closed, true);
  assert.equal(setup.timers.size, 0);
  assert.equal(await setup.engine.unlock(), false);
});

test('Web Audio 미지원과 resume 실패에서도 공개 API가 예외를 던지지 않는다', async () => {
  const unsupported = createAudioEngine({ contextFactory: () => null });
  assert.equal(await unsupported.unlock(), false);
  assert.equal(unsupported.playSfx('jump'), false);
  unsupported.setScene('play');
  await unsupported.suspendForVisibility(false);
  await unsupported.destroy();

  const context = new FakeAudioContext();
  context.resume = async () => { throw new Error('autoplay'); };
  const denied = createAudioEngine({ contextFactory: () => context });
  assert.equal(await denied.unlock(), false);
  assert.equal(denied.playSfx('ui.select'), false);
});
