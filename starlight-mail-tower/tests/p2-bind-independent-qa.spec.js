/**
 * @fileoverview 체크포인트 안전 복귀와 역할별 결속을 구현 테스트와 독립된 경계 조건으로 검증한다.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { applyInput, createSimulation, playerBounds, stepSimulation } from '../game/simulation.js';
import { LEVELS } from '../shared/levels.js';

const STEP = 1 / 30;
const PLAYER_HALF_HEIGHT = 28;

/**
 * 지정 플레이어를 추락시키고 RESPWAN 이벤트가 발생할 때까지 시뮬레이션한다.
 * @param {object} simulation 시뮬레이션
 * @param {'p1'|'p2'|'both'} target 추락시킬 역할
 * @returns {Array<object>} 복귀 틱의 이벤트
 */
function respawn(simulation, target = 'both') {
  simulation.players.forEach((player) => {
    if (target === 'both' || player.id === target) player.y = simulation.level.world.dangerY + 1;
  });
  for (let tick = 0; tick < 90; tick += 1) {
    const events = stepSimulation(simulation, STEP);
    if (events.some((event) => event.kind === 'RESPAWN')) return events;
  }
  assert.fail(`${simulation.levelId}에서 제한 시간 안에 리스폰하지 못함`);
}

/**
 * 스펙 조건에 맞는 가장 가까운 후보 지지면을 독립 계산한다.
 * @param {object} simulation 시뮬레이션
 * @param {number} x 플레이어 중심 X
 * @param {number} rawY 체크포인트 원본 Y
 * @returns {object|null} 후보 지지면
 */
function expectedSupport(simulation, x, rawY) {
  return simulation.dynamicPlatforms
    .filter((platform) => platform.solid !== false
      && x >= platform.x
      && x <= platform.x + platform.width
      && platform.y >= rawY)
    .reduce((nearest, platform) => !nearest || platform.y < nearest.y ? platform : nearest, null);
}

test('cloud-cargo cp1 원 버그 좌표에서 P1/P2 개별·동시 반복 복귀가 m1-end 위에 착지한다', () => {
  const simulation = createSimulation('cloud-cargo', { startPlaying: true });
  simulation.checkpointId = 1;
  const support = simulation.dynamicPlatforms.find((platform) => platform.id === 'm1-end');
  assert.equal(simulation.level.checkpoints[1].y1, 2820);
  assert.equal(simulation.level.checkpoints[1].y2, 2820);
  assert.equal(support?.y, 2840);

  for (const target of ['p1', 'p2', 'both', 'p1', 'p2', 'both']) {
    respawn(simulation, target);
    for (const player of simulation.players) {
      assert.ok(Math.abs(player.y - 2811.99) < 0.0001, `${target} 이후 ${player.id} 안전 중심 Y`);
      assert.ok(playerBounds(player).bottom < support.y, `${target} 이후 ${player.id} 하단이 발판 상면 위여야 함`);
    }
    stepSimulation(simulation, STEP);
    assert.ok(simulation.players.every((player) => player.grounded), `${target} 이후 두 역할 모두 안정 착지`);
  }
});

test('17개 레벨 모든 체크포인트에서 P1/P2가 실제 후속 tick 안에 안전 착지한다', () => {
  let checkpointCount = 0;
  for (const level of LEVELS) {
    for (let checkpointId = 0; checkpointId < level.checkpoints.length; checkpointId += 1) {
      checkpointCount += 1;
      const simulation = createSimulation(level.id, { startPlaying: true });
      simulation.checkpointId = checkpointId;
      respawn(simulation);
      const checkpoint = level.checkpoints[checkpointId];
      const supportedPlayers = [];
      simulation.players.forEach((player, index) => {
        const rawY = index === 0 ? checkpoint.y1 : checkpoint.y2;
        const support = expectedSupport(simulation, player.x, rawY);
        if (!support) {
          assert.equal(player.y, rawY, `${level.id} cp${checkpointId} ${player.id} 무지지면 원 좌표 유지`);
          return;
        }
        supportedPlayers.push(player.id);
        assert.ok(playerBounds(player).bottom < support.y, `${level.id} cp${checkpointId} ${player.id} 초기 관통`);
      });
      for (let tick = 0; tick < 30 && supportedPlayers.some((id) => !simulation.players.find((player) => player.id === id).grounded); tick += 1) {
        stepSimulation(simulation, STEP);
      }
      for (const playerId of supportedPlayers) {
        const player = simulation.players.find((item) => item.id === playerId);
        assert.equal(player.grounded, true, `${level.id} cp${checkpointId} ${playerId} 후속 tick 착지 실패`);
        assert.ok(player.y < level.world.dangerY, `${level.id} cp${checkpointId} ${playerId} 반복 추락`);
      }
    }
  }
  assert.equal(LEVELS.length, 17);
  assert.equal(checkpointCount, LEVELS.reduce((sum, level) => sum + level.checkpoints.length, 0));
});

test('비고체·상단·범위 밖 발판은 제외하고 좌우 경계는 포함하며 무지지면은 rawY를 유지한다', () => {
  const simulation = createSimulation('cloud-cargo', { startPlaying: true });
  simulation.checkpointId = 0;
  simulation.level = {
    ...simulation.level,
    checkpoints: [{ id: 0, x1: 100, y1: 100, x2: 200, y2: 100 }],
    platforms: [
      { id: 'non-solid', x: 80, y: 105, width: 140, height: 10, solid: false },
      { id: 'above', x: 80, y: 90, width: 140, height: 10 },
      { id: 'outside', x: 101, y: 110, width: 98, height: 10 },
      { id: 'left-edge', x: 100, y: 120, width: 20, height: 10 },
      { id: 'right-edge', x: 150, y: 120, width: 50, height: 10 },
      { id: 'farther', x: 80, y: 140, width: 140, height: 10 },
    ],
  };
  simulation.dynamicPlatforms = simulation.level.platforms.map((platform) => ({ ...platform }));
  respawn(simulation);
  assert.ok(Math.abs(simulation.players[0].y - 91.99) < 0.0001, '왼쪽 경계를 포함해야 함');
  assert.ok(Math.abs(simulation.players[1].y - 91.99) < 0.0001, '오른쪽 경계를 포함해야 함');

  simulation.level = {
    ...simulation.level,
    platforms: simulation.level.platforms.filter((platform) => ['non-solid', 'above', 'outside'].includes(platform.id)),
  };
  simulation.dynamicPlatforms = simulation.level.platforms.map((platform) => ({ ...platform }));
  respawn(simulation);
  assert.equal(simulation.players[0].y, 100);
  assert.equal(simulation.players[1].y, 100);
});

test('리스폰 뒤 P2 POWERED는 P2 소유이며 P1 스위치로만 LATCHED 된다', () => {
  const simulation = createSimulation('cloud-cargo', { startPlaying: true });
  simulation.checkpointId = 1;
  respawn(simulation);
  const module = simulation.level.modules[1];
  const p1 = simulation.players.find((player) => player.id === 'p1');
  const p2 = simulation.players.find((player) => player.id === 'p2');

  Object.assign(p2, { x: module.anchor.x, y: module.anchor.y, vx: 0, vy: 0, grounded: true });
  applyInput(simulation, 'p2', { seq: 10, left: false, right: false, jump: false, interact: true });
  const poweredEvents = [];
  for (let tick = 0; tick < 20 && simulation.devices[1].state !== 'POWERED'; tick += 1) {
    poweredEvents.push(...stepSimulation(simulation, STEP));
  }
  assert.equal(simulation.devices[1].state, 'POWERED');
  assert.equal(simulation.devices[1].anchorPlayerId, 'p2');
  assert.ok(poweredEvents.some((event) => event.kind === 'DEVICE_POWERED' && event.payload.playerId === 'p2'));

  Object.assign(p2, { x: module.switch.x, y: module.switch.y, grounded: true });
  stepSimulation(simulation, STEP);
  assert.equal(simulation.devices[1].state, 'POWERED', 'P2가 자기 결속의 파트너 스위치를 대신 완료하면 안 됨');

  Object.assign(p1, { x: module.switch.x, y: module.switch.y, vx: 0, vy: 0, grounded: true });
  applyInput(simulation, 'p1', { seq: 10, left: false, right: false, jump: false, interact: true });
  const events = stepSimulation(simulation, STEP);
  assert.equal(simulation.devices[1].state, 'LATCHED');
  assert.ok(events.some((event) => event.kind === 'DEVICE_LATCHED' && event.payload.playerId === 'p1'));
});
