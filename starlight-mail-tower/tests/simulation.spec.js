/**
 * @fileoverview 8모듈 서버 시뮬레이션, 장치 전이, 공동 체크포인트, 결승과 프로토콜을 단위 검증한다.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { advanceModuleForTesting, applyInput, createSimulation, isCoopBoostCandidate, snapshotSimulation, stepSimulation, triggerFinishForTesting } from '../game/simulation.js';
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

/**
 * 한 틱에 유효한 아래 충돌이 생기는 시뮬레이션을 만든다.
 * @param {string} levelId 레벨 ID
 * @param {number} horizontalOffset 수평 중심 차이
 * @returns {object}
 */
function createBoostContact(levelId = 'starlight-tower', horizontalOffset = 0) {
  const simulation = createSimulation(levelId); simulation.phase = 'playing';
  Object.assign(simulation.players[0], { x: 300, y: 100, vy: 0, grounded: false, boostConsumed: false });
  Object.assign(simulation.players[1], { x: 300 + horizontalOffset, y: 178, vy: -650, grounded: false, boostConsumed: false });
  return simulation;
}

/**
 * 현재 공격자 상단과 수혜자 하단의 경계 차이를 지정한 부스트 후보를 만든다.
 * @param {number} verticalBoundaryDelta 현재 수직 경계 차이
 * @returns {{striker:object,receiver:object,previousStriker:object,previousReceiver:object}}
 */
function createBoostBoundaryCandidate(verticalBoundaryDelta) {
  const receiver = { id: 'p1', x: 300, y: 100, vy: 0, grounded: false, anchored: false, respawnTimer: 0, boostConsumed: false, input: { jump: false } };
  const striker = { id: 'p2', x: 300, y: 156 + verticalBoundaryDelta, vy: -650, grounded: false, anchored: false, respawnTimer: 0, boostConsumed: false, input: { jump: false } };
  const previousReceiver = { left: 280, right: 320, top: 72, bottom: 128, centerX: 300, centerY: 100 };
  const previousStriker = { left: 280, right: 320, top: 136, bottom: 192, centerX: 300, centerY: 164 };
  return { striker, receiver, previousStriker, previousReceiver };
}

test('아래 상승 충돌은 정확히 한 COOP_BOOST와 중력 비례 속도를 만든다', () => {
  const simulation = createBoostContact();
  const events = stepTicks(simulation, 1);
  assert.equal(events.filter((event) => event.kind === 'COOP_BOOST').length, 1);
  assert.equal(events[0].payload.strikerId, 'p2');
  assert.equal(events[0].payload.receiverId, 'p1');
  assert.ok(Math.abs(simulation.players[0].vy + Math.sqrt(2 * 1450 * 190)) <= 2);
  assert.ok(simulation.players[1].vy > 0);
  assert.equal(simulation.players[0].boostConsumed, true);
  assert.equal(snapshotSimulation(simulation).players[0].boostConsumed, true);
  assert.equal('boostContactArmed' in snapshotSimulation(simulation), false);
  assert.equal(stepTicks(simulation, 3).filter((event) => event.kind === 'COOP_BOOST').length, 0);
});

test('저중력 부스트도 190px 목표 속도를 사용한다', () => {
  const simulation = createBoostContact('orbital-post');
  stepTicks(simulation, 1);
  assert.ok(Math.abs(simulation.players[0].vy + Math.sqrt(2 * 720 * 190)) <= 3);
});

test('수평 교집합 11px, 지상 수혜자, 위에서 내리찍기는 부스트가 아니다', () => {
  assert.equal(stepTicks(createBoostContact('starlight-tower', 29), 1).some((event) => event.kind === 'COOP_BOOST'), false);
  assert.equal(stepTicks(createBoostContact('starlight-tower', 28), 1).some((event) => event.kind === 'COOP_BOOST'), true);
  const grounded = createBoostContact(); grounded.players[0].grounded = true;
  assert.equal(stepTicks(grounded, 1).some((event) => event.kind === 'COOP_BOOST'), false);
  const descending = createBoostContact(); descending.players[1].vy = 180;
  assert.equal(stepTicks(descending, 1).some((event) => event.kind === 'COOP_BOOST'), false);
});

test('상대 접근 속도 119px/s는 거부하고 120px/s는 허용한다', () => {
  const slow = createBoostContact(); slow.players[0].vy = -81; slow.players[1].y = 166; slow.players[1].vy = -200;
  assert.equal(stepTicks(slow, 1).some((event) => event.kind === 'COOP_BOOST'), false);
  const boundary = createBoostContact(); boundary.players[0].vy = -80; boundary.players[1].y = 166; boundary.players[1].vy = -200;
  assert.equal(stepTicks(boundary, 1).some((event) => event.kind === 'COOP_BOOST'), true);
});

test('현재 수직 경계는 -8px와 +8px만 포함하고 -9px와 +9px를 거부한다', () => {
  for (const [delta, expected] of [[-9, false], [-8, true], [8, true], [9, false]]) {
    assert.equal(isCoopBoostCandidate(...Object.values(createBoostBoundaryCandidate(delta))), expected, `${delta}px 경계`);
  }
});

test('접촉 래치는 8px 완전 분리 전 중복 발동을 막고 착지에서 소비 상태를 초기화한다', () => {
  const simulation = createBoostContact();
  stepTicks(simulation, 1);
  assert.equal(simulation.boostContactArmed, false);
  Object.assign(simulation.players[0], { x: 200, y: 200, vy: 0 });
  Object.assign(simulation.players[1], { x: 247, y: 200, vy: 0 });
  stepTicks(simulation, 1);
  assert.equal(simulation.boostContactArmed, false);
  simulation.players[1].x = 248;
  stepTicks(simulation, 1);
  assert.equal(simulation.boostContactArmed, true);
  const landing = simulation.level.platforms[0];
  Object.assign(simulation.players[0], { x: landing.x + 80, y: landing.y - 34, vy: 240, grounded: false, boostConsumed: true });
  stepTicks(simulation, 1);
  assert.equal(simulation.players[0].grounded, true);
  assert.equal(simulation.players[0].boostConsumed, false);
});
