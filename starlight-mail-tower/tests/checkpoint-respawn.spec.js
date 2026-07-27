/**
 * @fileoverview 모든 레벨의 체크포인트 리스폰이 지지 발판을 관통하지 않는지 검증한다.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { applyInput, createSimulation, stepSimulation } from '../game/simulation.js';
import { LEVELS } from '../shared/levels.js';

const STEP = 1 / 30;
const PLAYER_HALF_HEIGHT = 28;

/**
 * 두 플레이어를 추락시킨 뒤 리스폰이 끝날 때까지 진행한다.
 * @param {object} simulation 시뮬레이션
 * @returns {void}
 */
function fallAndRespawn(simulation) {
  simulation.players.forEach((player) => { player.y = simulation.level.world.dangerY + 1; });
  for (let tick = 0; tick < 60 && simulation.players.some((player) => player.y > simulation.level.world.dangerY || player.respawnTimer > 0); tick += 1) {
    stepSimulation(simulation, STEP);
  }
}

/**
 * 플레이어 X 아래의 가장 가까운 지지 발판을 찾는다.
 * @param {object} simulation 시뮬레이션
 * @param {object} player 플레이어
 * @param {number} rawY 체크포인트 원본 Y
 * @returns {object|null} 지지 발판
 */
function findSupport(simulation, player, rawY) {
  return simulation.dynamicPlatforms
    .filter((platform) => platform.solid !== false
      && player.x >= platform.x
      && player.x <= platform.x + platform.width
      && platform.y >= rawY)
    .sort((first, second) => first.y - second.y)[0] ?? null;
}

test('구름 화물선 첫 체크포인트는 반복 사망 후에도 발판 위에 리스폰한다', () => {
  const simulation = createSimulation('cloud-cargo', { startPlaying: true });
  simulation.checkpointId = 1;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    fallAndRespawn(simulation);
    const support = simulation.dynamicPlatforms.find((platform) => platform.id === 'm1-end');
    assert.ok(support);
    for (const player of simulation.players) {
      assert.ok(player.y + PLAYER_HALF_HEIGHT <= support.y + 0.001, `${player.id}가 발판 내부에서 리스폰함`);
    }
    stepSimulation(simulation, STEP);
    assert.ok(simulation.players.every((player) => player.grounded), '리스폰 직후 지지 발판에 착지해야 한다');
  }
});

test('17개 레벨의 모든 체크포인트에서 P1/P2가 지지면을 관통하지 않는다', () => {
  for (const level of LEVELS) {
    for (let checkpointId = 0; checkpointId < level.checkpoints.length; checkpointId += 1) {
      const simulation = createSimulation(level.id, { startPlaying: true });
      simulation.checkpointId = checkpointId;
      fallAndRespawn(simulation);
      const checkpoint = level.checkpoints[checkpointId];
      simulation.players.forEach((player, index) => {
        const rawY = index === 0 ? checkpoint.y1 : checkpoint.y2;
        const support = findSupport(simulation, player, rawY);
        if (support) assert.ok(player.y + PLAYER_HALF_HEIGHT <= support.y + 0.001, `${level.id} cp${checkpointId} ${player.id}`);
      });
    }
  }
});

test('구름 화물선 첫 체크포인트 리스폰 뒤 P2 결속과 P1 스위치가 완료된다', () => {
  const simulation = createSimulation('cloud-cargo', { startPlaying: true });
  simulation.checkpointId = 1;
  fallAndRespawn(simulation);
  const module = simulation.level.modules[1];
  const p1 = simulation.players.find((player) => player.id === 'p1');
  const p2 = simulation.players.find((player) => player.id === 'p2');

  Object.assign(p2, { x: module.anchor.x, y: module.anchor.y, vx: 0, vy: 0, grounded: true });
  applyInput(simulation, 'p2', { seq: 1, left: false, right: false, jump: false, interact: true });
  for (let tick = 0; tick < 12 && simulation.devices[1].state !== 'POWERED'; tick += 1) stepSimulation(simulation, STEP);
  assert.equal(simulation.devices[1].state, 'POWERED');
  assert.equal(simulation.devices[1].anchorPlayerId, 'p2');

  Object.assign(p1, { x: module.switch.x, y: module.switch.y, vx: 0, vy: 0, grounded: true });
  applyInput(simulation, 'p1', { seq: 1, left: false, right: false, jump: false, interact: true });
  stepSimulation(simulation, STEP);
  assert.equal(simulation.devices[1].state, 'LATCHED');
});
