/**
 * @fileoverview 8모듈 서버 시뮬레이션, 장치 전이, 공동 체크포인트, 결승과 프로토콜을 단위 검증한다.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { advanceModuleForTesting, applyInput, createSimulation, stepSimulation, triggerFinishForTesting } from '../game/simulation.js';
import { FINISH, MODULES, WORLD } from '../shared/level-data.js';
import { validateClientMessage } from '../shared/protocol.js';
import { getFinishCrossfadeAlpha } from '../public/js/motion.js';
import { isNativeKeyboardTarget } from '../public/js/keyboard.js';
import { hasRestartQuorum } from '../server.js';

/**
 * 시뮬레이션을 고정 30Hz로 지정 횟수 진행한다.
 * @param {object} simulation 시뮬레이션
 * @param {number} ticks 스텝 수
 * @returns {Array<object>}
 */
function stepTicks(simulation, ticks) {
  const events = [];
  for (let index = 0; index < ticks; index += 1) events.push(...stepSimulation(simulation, 1 / 30));
  return events;
}

test('재시작 정족수는 현재 연결된 두 역할의 투표와 정확히 일치해야 한다', () => {
  const slots = new Map([['p1', { playerId: 'p1', ws: {} }], ['p2', { playerId: 'p2', ws: {} }]]);
  assert.equal(hasRestartQuorum(slots, new Set(['p1', 'p2'])), true);
  slots.get('p1').ws = null;
  assert.equal(hasRestartQuorum(slots, new Set(['p1', 'p2'])), false);
  slots.get('p1').ws = {};
  assert.equal(hasRestartQuorum(slots, new Set(['p1', 'ghost'])), false);
});

test('버튼·링크·입력·편집 대상은 게임 Enter와 Space 매핑에서 제외한다', () => {
  const nativeTarget = { closest: (selector) => selector.includes('button') ? {} : null };
  const editableTarget = { closest: (selector) => selector === '[contenteditable]' ? {} : null };
  const canvasTarget = { closest: () => null };
  assert.equal(isNativeKeyboardTarget(nativeTarget), true);
  assert.equal(isNativeKeyboardTarget(editableTarget), true);
  assert.equal(isNativeKeyboardTarget(canvasTarget), false);
});

test('30Hz 입력은 클라이언트 좌표 없이 이동과 점프를 권위 계산한다', () => {
  const simulation = createSimulation();
  simulation.phase = 'playing';
  stepTicks(simulation, 15);
  const startX = simulation.players[0].x;
  assert.equal(applyInput(simulation, 'p1', { seq: 1, left: false, right: true, jump: false, interact: false }), true);
  stepTicks(simulation, 30);
  assert.ok(simulation.players[0].x > startX + 200);
  assert.equal(applyInput(simulation, 'p1', { seq: 1, left: true, right: false, jump: false, interact: false }), false);
});

test('단자는 0.3초 고정 뒤 POWERED, 파트너 스위치로 LATCHED가 된다', () => {
  const simulation = createSimulation();
  simulation.phase = 'playing';
  const [anchor, partner] = simulation.players;
  Object.assign(anchor, { ...MODULES[0].anchor, grounded: true });
  Object.assign(partner, { x: 700, y: 1400 });
  applyInput(simulation, 'p1', { seq: 1, left: false, right: false, jump: false, interact: true });
  stepTicks(simulation, 10);
  assert.equal(simulation.devices[0].state, 'POWERED');
  assert.equal(anchor.anchored, true);
  Object.assign(partner, { ...MODULES[0].switch, grounded: true });
  applyInput(simulation, 'p2', { seq: 1, left: false, right: false, jump: false, interact: true });
  const events = stepTicks(simulation, 1);
  assert.equal(simulation.devices[0].state, 'LATCHED');
  assert.equal(anchor.anchored, false);
  assert.ok(events.some((event) => event.kind === 'DEVICE_LATCHED'));

  const shutterSimulation = createSimulation();
  shutterSimulation.phase = 'playing';
  shutterSimulation.checkpointId = 4;
  const shutter = shutterSimulation.devices[4];
  const shutterAnchor = shutterSimulation.players.find((player) => player.id === shutter.requiredPlayerId);
  const shutterPartner = shutterSimulation.players.find((player) => player.id !== shutter.requiredPlayerId);
  Object.assign(shutterAnchor, { ...shutter.anchor, grounded: true });
  Object.assign(shutterPartner, { x: 150, y: WORLD.spawnY, grounded: true });
  applyInput(shutterSimulation, shutterAnchor.id, { seq: 1, left: false, right: false, jump: false, interact: true });
  stepTicks(shutterSimulation, 10);
  assert.equal(shutter.closeAtMs, shutter.stateChangedMs + 3000);
  assert.equal(shutter.shutterCycleMs, 3600);
  const firstCloseAtMs = shutter.closeAtMs;
  stepTicks(shutterSimulation, 105);
  assert.equal(shutter.closeAtMs, firstCloseAtMs + shutter.shutterCycleMs);
});

test('두 플레이어가 함께 도착할 때만 체크포인트를 갱신한다', () => {
  const simulation = createSimulation();
  simulation.phase = 'playing';
  simulation.devices[0].state = 'LATCHED';
  const zone = MODULES[0].checkpoint;
  Object.assign(simulation.players[0], { x: zone.x + 40, y: zone.y + 40 });
  Object.assign(simulation.players[1], { x: zone.x - 100, y: zone.y + 40 });
  stepTicks(simulation, 1);
  assert.equal(simulation.checkpointId, 0);
  Object.assign(simulation.players[1], { x: zone.x + 100, y: zone.y + 40 });
  const events = stepTicks(simulation, 1);
  assert.equal(simulation.checkpointId, 1);
  assert.ok(events.some((event) => event.kind === 'CHECKPOINT'));
});

test('한 명이 추락하면 1.2초 안에 둘을 마지막 체크포인트로 원자 복귀시킨다', () => {
  const simulation = createSimulation();
  simulation.phase = 'playing';
  simulation.players[0].y = WORLD.dangerY + 1;
  const events = stepTicks(simulation, 40);
  assert.equal(simulation.falls, 1);
  assert.equal(simulation.players[0].respawnTimer, 0);
  assert.equal(simulation.players[1].respawnTimer, 0);
  assert.equal(simulation.players[0].x, 150);
  assert.equal(simulation.players[1].x, 215);
  assert.ok(events.some((event) => event.kind === 'FALL'));
  assert.ok(events.some((event) => event.kind === 'RESPAWN'));
});

test('프로토콜은 비정상 입력과 과거 시퀀스를 거부한다', () => {
  assert.equal(validateClientMessage({ type: 'JOIN', name: '' }).ok, false);
  assert.equal(validateClientMessage({ type: 'INPUT', seq: 1, left: true, right: false, jump: false, interact: false }).ok, true);
  assert.equal(validateClientMessage({ type: 'INPUT', seq: -1 }).ok, false);
  assert.equal(validateClientMessage({ type: 'TELEPORT', x: 999 }).ok, false);
  assert.equal(validateClientMessage({ type: 'RESTART_VOTE', agree: true }).ok, true);
});

test('풍향계와 관측 안테나를 포함한 8모듈이 순서대로 완료된다', () => {
  const simulation = createSimulation();
  simulation.phase = 'playing';
  for (let index = 0; index < 8; index += 1) advanceModuleForTesting(simulation);
  assert.equal(simulation.checkpointId, 8);
  assert.equal(simulation.devices.every((device) => device.state === 'LATCHED'), true);
  assert.equal(simulation.roleSwaps, 7);
});

test('결승 두 스위치가 3초 안에 눌리면 2400ms 뒤 한 번만 완료된다', () => {
  assert.equal(getFinishCrossfadeAlpha(0, true), 0);
  assert.equal(getFinishCrossfadeAlpha(100, true), 0.5);
  assert.equal(getFinishCrossfadeAlpha(200, true), 1);
  const simulation = createSimulation();
  simulation.phase = 'playing';
  for (let index = 0; index < 8; index += 1) advanceModuleForTesting(simulation);
  triggerFinishForTesting(simulation);
  assert.equal(simulation.finishState.phase, 'launching');
  const events = stepTicks(simulation, 73);
  assert.equal(simulation.phase, 'result');
  assert.equal(simulation.finishState.phase, 'complete');
  assert.equal(events.filter((event) => event.kind === 'GAME_COMPLETED').length, 1);
});

test('결승 한쪽 스위치만 누르면 3초 뒤 안전하게 초기화된다', () => {
  const simulation = createSimulation();
  simulation.phase = 'playing';
  for (let index = 0; index < 8; index += 1) advanceModuleForTesting(simulation);
  Object.assign(simulation.players[0], { ...FINISH.leftSwitch });
  simulation.players[0].input.interact = true;
  stepTicks(simulation, 1);
  simulation.players[0].input.interact = false;
  const events = stepTicks(simulation, 91);
  assert.equal(simulation.finishState.leftPressedAt, null);
  assert.equal(simulation.finishState.phase, 'idle');
  assert.equal(simulation.finishState.expiredSide, 'left');
  assert.ok(Number.isFinite(simulation.finishState.expiredAtMs));
  assert.ok(events.some((event) => event.kind === 'FINISH_EXPIRED'));
});
