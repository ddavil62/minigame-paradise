/**
 * @fileoverview 5레벨 카탈로그, 데이터 주입, 프로토콜, 기록 영속화와 손상 복구를 검증한다.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRecordStore } from '../game/records.js';
import { DEVICE_STATE, createDevices, updateDevice } from '../game/devices.js';
import { advanceModuleForTesting, applyInput, createSimulation, snapshotSimulation, stepSimulation, triggerFinishForTesting } from '../game/simulation.js';
import { LEVELS, getLevel, getNextLevel, validateLevel } from '../shared/levels.js';
import { validateClientMessage } from '../shared/protocol.js';

test('카탈로그는 고유 테마와 8모듈을 가진 다섯 레벨을 제공한다', () => {
  assert.equal(LEVELS.length, 5);
  assert.equal(new Set(LEVELS.map((level) => level.id)).size, 5);
  assert.equal(new Set(LEVELS.map((level) => level.motif)).size, 5);
  assert.equal(LEVELS.every((level) => level.modules.length === 8), true);
  assert.equal(getNextLevel('orbital-post').id, 'starlight-tower');
});

test('모든 레벨은 복제 코드 없이 주입되어 8/8까지 진행한다', () => {
  for (const level of LEVELS) {
    const simulation = createSimulation(level.id); simulation.phase = 'playing';
    for (let index = 0; index < 8; index += 1) advanceModuleForTesting(simulation);
    assert.equal(simulation.levelId, level.id); assert.equal(simulation.checkpointId, 8);
  }
});

test('다섯 레벨 모두 8모듈 이후 피날레를 거쳐 결과 상태에 한 번만 도달한다', () => {
  for (const level of LEVELS) {
    const simulation = createSimulation(level.id); simulation.phase = 'playing';
    for (let index = 0; index < 8; index += 1) advanceModuleForTesting(simulation);
    triggerFinishForTesting(simulation);
    const events = [];
    for (let index = 0; index < 100; index += 1) events.push(...stepSimulation(simulation, 1 / 30));
    assert.equal(simulation.phase, 'result');
    assert.equal(events.filter((event) => event.kind === 'GAME_COMPLETED').length, 1);
  }
});

test('신규 월드는 27개 독립 플랫폼과 유효한 동적 범위를 소유한다', () => {
  for (const level of LEVELS.slice(1)) {
    assert.equal(level.platforms.length, 27);
    assert.equal(validateLevel(level).ok, true, validateLevel(level).errors.join(','));
    assert.notEqual(level.platforms, LEVELS[0].platforms);
    assert.notEqual(level.world, LEVELS[0].world);
  }
});

test('동일 레벨과 입력 시퀀스는 좌표·collider·장치 위상이 결정론적으로 같다', () => {
  const run = () => {
    const simulation = createSimulation('cloud-cargo'); simulation.phase = 'playing';
    for (let tick = 0; tick < 120; tick += 1) {
      applyInput(simulation, 'p1', { seq: tick, left: false, right: tick < 45, jump: tick === 10, interact: false });
      applyInput(simulation, 'p2', { seq: tick, left: tick >= 60, right: false, jump: tick === 20, interact: false });
      stepSimulation(simulation, 1 / 30);
    }
    const snapshot = snapshotSimulation(simulation);
    return { players: snapshot.players, platforms: snapshot.level.platforms, devices: snapshot.devices, checkpointId: snapshot.checkpointId };
  };
  assert.deepEqual(run(), run());
});

test('이동 객차는 POWERED 동안 서버 collider가 움직이고 해제하면 정지한다', () => {
  const simulation = createSimulation('cloud-cargo'); simulation.phase = 'playing';
  simulation.devices[0].state = DEVICE_STATE.POWERED; simulation.devices[0].anchorPlayerId = 'p1'; simulation.players[0].input.interact = true;
  const id = 'm1-route'; const before = simulation.dynamicPlatforms.find((platform) => platform.id === id).x;
  for (let tick = 0; tick < 20; tick += 1) stepSimulation(simulation, 1 / 30);
  const moving = simulation.dynamicPlatforms.find((platform) => platform.id === id).x;
  assert.notEqual(moving, before);
  simulation.players[0].input.interact = false;
  for (let tick = 0; tick < 20; tick += 1) stepSimulation(simulation, 1 / 30);
  const stopped = simulation.dynamicPlatforms.find((platform) => platform.id === id).x;
  stepSimulation(simulation, 1 / 30);
  assert.equal(simulation.dynamicPlatforms.find((platform) => platform.id === id).x, stopped);
});

test('셔터와 주기 발판은 서버 240ms 경고 및 solid 상태를 스냅샷에 제공한다', () => {
  for (const [levelId, moduleIndex, warningAt, solid] of [['cloud-cargo', 1, 2000, false], ['moon-clock', 0, 1650, true]]) {
    const module = getLevel(levelId).modules[moduleIndex]; const device = createDevices([module])[0];
    device.state = DEVICE_STATE.POWERED; device.anchorPlayerId = module.requiredPlayerId; device.stateChangedMs = 0;
    const players = [{ id: module.requiredPlayerId, x: module.anchor.x, y: module.anchor.y, vx: 0, vy: 0, input: { interact: true } }, { id: 'partner', x: -999, y: -999, vx: 0, vy: 0, input: { interact: false } }];
    updateDevice(device, players, 1 / 30, warningAt);
    assert.equal(device.solid, solid); assert.equal(device.warning, true);
  }
});

test('궤도 우편선은 공중 입력 해제 뒤 관성을 유지한다', () => {
  const simulation = createSimulation('orbital-post'); simulation.phase = 'playing';
  simulation.players[0].grounded = false;
  applyInput(simulation, 'p1', { seq: 1, left: false, right: true, jump: false, interact: false });
  stepSimulation(simulation, 1 / 30);
  applyInput(simulation, 'p1', { seq: 2, left: false, right: false, jump: false, interact: false });
  stepSimulation(simulation, 1 / 30);
  assert.ok(simulation.players[0].vx > 0);
});

test('레벨 선택과 결과 행동 프로토콜은 allowlist 형식을 검증한다', () => {
  assert.equal(validateClientMessage({ type: 'SELECT_LEVEL', levelId: 'cloud-cargo' }).ok, true);
  assert.equal(validateClientMessage({ type: 'RESULT_VOTE', action: 'NEXT' }).ok, true);
  assert.equal(validateClientMessage({ type: 'RESULT_VOTE', action: 'DELETE' }).ok, false);
});

test('최고 기록은 더 빠른 값만 원자 저장하고 손상 JSON을 격리한다', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'starlight-records-'));
  const file = path.join(directory, 'records.json');
  try {
    const store = createRecordStore(file);
    assert.equal(store.update('cloud-cargo', 12_000).updated, true);
    assert.equal(store.update('cloud-cargo', 13_000).updated, false);
    assert.equal(createRecordStore(file).getAll()['cloud-cargo'], 12_000);
    fs.writeFileSync(file, '{broken', 'utf8');
    assert.deepEqual(createRecordStore(file).getAll(), {});
    assert.equal(fs.readdirSync(directory).some((name) => name.includes('.corrupt-')), true);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
