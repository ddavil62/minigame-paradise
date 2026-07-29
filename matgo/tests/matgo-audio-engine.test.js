/**
 * @fileoverview 맞고 절차형 효과음 엔진의 지연 생성·중복 방지·수명주기를 검증한다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const ENGINE_SOURCE = fs.readFileSync(
  new URL('../public/audio-engine.js', import.meta.url),
  'utf8',
);

/** Web Audio AudioParam의 테스트 대역을 만든다. */
function makeParam() {
  return {
    value: 0,
    setValueAtTime(value) { this.value = value; },
    exponentialRampToValueAtTime(value) { this.value = value; },
  };
}

/** 연결·종료 가능한 AudioNode 테스트 대역을 만든다. */
function makeNode() {
  return {
    connections: [],
    connect(target) { this.connections.push(target); return target; },
    disconnect() { this.connections = []; },
  };
}

/** 결정론적 AudioContext 테스트 대역을 만든다. */
function makeFakeContext() {
  const context = {
    state: 'suspended',
    currentTime: 0,
    sampleRate: 8000,
    destination: makeNode(),
    oscillators: [],
    sources: [],
    gains: [],
    suspendCalls: 0,
    resumeCalls: 0,
    closeCalls: 0,
    createGain() {
      const node = { ...makeNode(), gain: makeParam() };
      this.gains.push(node);
      return node;
    },
    createOscillator() {
      const node = {
        ...makeNode(),
        type: 'sine',
        frequency: makeParam(),
        start() {},
        stop() {},
        onended: null,
      };
      this.oscillators.push(node);
      return node;
    },
    createBiquadFilter() {
      return {
        ...makeNode(),
        type: 'lowpass',
        frequency: makeParam(),
        Q: makeParam(),
      };
    },
    createBuffer(channels, length) {
      const data = new Float32Array(length);
      return { getChannelData: () => data };
    },
    createBufferSource() {
      const node = {
        ...makeNode(),
        buffer: null,
        start() {},
        stop() {},
        onended: null,
      };
      this.sources.push(node);
      return node;
    },
    async resume() { this.resumeCalls += 1; this.state = 'running'; },
    async suspend() { this.suspendCalls += 1; this.state = 'suspended'; },
    async close() { this.closeCalls += 1; this.state = 'closed'; },
  };
  return context;
}

/** 격리된 classic-script 환경에서 엔진 팩토리를 읽는다. */
function loadFactory() {
  const sandbox = {
    console,
    Date,
    performance: { now: () => 0 },
  };
  sandbox.window = sandbox;
  vm.runInNewContext(ENGINE_SOURCE, sandbox, { filename: 'audio-engine.js' });
  return sandbox.MatgoAudio.createAudioEngine;
}

test('AudioContext는 최초 unlock 전에는 생성되지 않고 unlock은 재사용된다', async () => {
  const context = makeFakeContext();
  let factoryCalls = 0;
  const engine = loadFactory()({
    audioContextFactory: () => { factoryCalls += 1; return context; },
  });
  assert.equal(factoryCalls, 0);
  assert.equal(engine.playSfx('card.throw'), false);
  assert.equal(factoryCalls, 0);
  assert.equal(await engine.unlock(), true);
  assert.equal(await engine.unlock(), true);
  assert.equal(factoryCalls, 1);
  assert.equal(context.resumeCalls, 1);
});

test('eventKey 중복과 key별 cooldown을 거른다', async () => {
  const context = makeFakeContext();
  let clock = 1000;
  const engine = loadFactory()({
    audioContextFactory: () => context,
    now: () => clock,
  });
  await engine.unlock();
  assert.equal(engine.playSfx('card.land', { eventKey: 'land:1' }), true);
  clock += 100;
  assert.equal(engine.playSfx('card.land', { eventKey: 'land:1' }), false);
  assert.equal(engine.playSfx('card.land', { eventKey: 'land:2' }), true);
  clock += 1;
  assert.equal(engine.playSfx('card.land', { eventKey: 'land:3' }), false);
  assert.equal(engine.getDiagnostics().droppedCount, 2);
});

test('dedupe 저장소는 최근 256개로 제한된다', async () => {
  const context = makeFakeContext();
  let clock = 0;
  const engine = loadFactory()({
    audioContextFactory: () => context,
    now: () => { clock += 600; return clock; },
  });
  await engine.unlock();
  for (let index = 0; index < 300; index += 1) {
    assert.equal(engine.playSfx('decision.go', { eventKey: `go:${index}` }), true);
  }
  assert.equal(engine.getDiagnostics().dedupeSize, 256);
});

test('동시 voice는 12개를 넘지 않는다', async () => {
  const context = makeFakeContext();
  let clock = 0;
  const engine = loadFactory()({
    audioContextFactory: () => context,
    now: () => { clock += 600; return clock; },
  });
  await engine.unlock();
  for (let index = 0; index < 30; index += 1) {
    engine.playSfx('round.win', { eventKey: `win:${index}` });
  }
  assert.ok(engine.getDiagnostics().activeVoices <= 12);
});

test('visibility와 destroy가 context 및 voice를 정리한다', async () => {
  const context = makeFakeContext();
  const engine = loadFactory()({ audioContextFactory: () => context });
  await engine.unlock();
  assert.equal(engine.playSfx('special.bomb', { eventKey: 'bomb:1' }), true);
  assert.ok(engine.getDiagnostics().activeVoices > 0);
  engine.handleVisibility(true);
  await Promise.resolve();
  assert.equal(context.suspendCalls, 1);
  assert.equal(engine.playSfx('card.throw', { eventKey: 'hidden' }), false);
  engine.handleVisibility(false);
  await Promise.resolve();
  assert.equal(context.resumeCalls, 2);
  engine.destroy();
  await Promise.resolve();
  assert.equal(context.closeCalls, 1);
  assert.equal(engine.getDiagnostics().activeVoices, 0);
  assert.equal(engine.getDiagnostics().destroyed, true);
});

test('Web Audio 미지원과 context 생성 실패는 예외 없이 무음 폴백한다', async () => {
  const unsupported = loadFactory()({ audioContextFactory: () => null });
  assert.equal(await unsupported.unlock(), false);
  assert.equal(unsupported.playSfx('round.win'), false);

  const failed = loadFactory()({
    audioContextFactory: () => { throw new Error('blocked'); },
  });
  assert.equal(await failed.unlock(), false);
  assert.equal(failed.playSfx('card.throw'), false);
});
