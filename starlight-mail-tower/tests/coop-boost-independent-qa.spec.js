/**
 * @fileoverview 협동 부스트의 경계값, 테스트 드라이버 무결성, 5레벨 회귀를 독립 검증한다.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { isCoopBoostCandidate } from '../game/simulation.js';
import { LEVELS } from '../shared/levels.js';
import { runPhysicalPlaythrough } from './helpers/physical-playthrough.js';

/**
 * @param {number} currentDelta 현재 공격자 상단과 수혜자 하단의 차이
 * @returns {{striker:object,receiver:object,previousStriker:object,previousReceiver:object}} 경계 판정 픽스처
 */
function crossingFixture(currentDelta) {
  const receiver = { id: 'p1', x: 300, y: 100, vy: 0, grounded: false, anchored: false, respawnTimer: 0, boostConsumed: false, input: { jump: false } };
  const currentTop = 128 + currentDelta;
  const striker = { id: 'p2', x: 300, y: currentTop + 28, vy: -650, grounded: false, anchored: false, respawnTimer: 0, boostConsumed: false, input: { jump: false } };
  const previousReceiver = { left: 280, right: 320, top: 72, bottom: 128, centerX: 300, centerY: 100, grounded: false };
  const previousTop = currentTop + 17;
  const previousStriker = { left: 280, right: 320, top: previousTop, bottom: previousTop + 56, centerX: 300, centerY: previousTop + 28, grounded: false };
  return { striker, receiver, previousStriker, previousReceiver };
}

test('현재 공격자 상단 경계는 -9/-8/+8/+9에서 정확히 닫힌 구간 [-8,+8]을 적용한다', () => {
  for (const [delta, expected] of [[-9, false], [-8, true], [8, true], [9, false]]) {
    const fixture = crossingFixture(delta);
    assert.equal(isCoopBoostCandidate(fixture.striker, fixture.receiver, fixture.previousStriker, fixture.previousReceiver), expected, `delta=${delta}`);
  }
});

test('물리 완주 드라이버는 허용 API만 import하고 권위 상태를 직접 변경하지 않는다', () => {
  const source = fs.readFileSync(new URL('./helpers/physical-playthrough.js', import.meta.url), 'utf8');
  const importMatch = source.match(/import\s*\{([^}]+)\}\s*from\s*'\.\.\/\.\.\/game\/simulation\.js'/);
  assert.ok(importMatch);
  assert.deepEqual(importMatch[1].split(',').map((item) => item.trim()).sort(), ['applyInput', 'createSimulation', 'stepSimulation']);
  const forbidden = [
    /advanceModuleForTesting|triggerFinishForTesting|\/__test\/(?:advance|finish)/,
    /simulation\.players\s*\[[^\]]+\]\s*\.(?:x|y|vx|vy|grounded|anchored|respawnTimer|boostConsumed)\s*=/,
    /simulation\.devices\s*\[[^\]]+\]\s*\.(?:state|active|solid|anchorPlayerId)\s*=/,
    /Object\.assign\s*\(\s*simulation\.(?:players|devices)/,
  ];
  forbidden.forEach((pattern) => assert.equal(pattern.test(source), false, pattern.toString()));
});

for (const level of LEVELS) {
  test(`${level.id} 독립 회귀: 30Hz INPUT 완주 중 모든 장치와 복귀 경로가 실제 진행된다`, () => {
    const result = runPhysicalPlaythrough(level.id);
    assert.equal(result.simulation.phase, 'result');
    assert.equal(result.simulation.falls, 0);
    assert.deepEqual(result.simulation.devices.map((device) => device.state), Array(8).fill('LATCHED'));
    assert.equal(result.events.filter((event) => event.kind === 'DEVICE_POWERED').length, 8);
    assert.equal(result.events.filter((event) => event.kind === 'DEVICE_LATCHED').length, 8);
    assert.equal(result.events.filter((event) => event.kind === 'CHECKPOINT').length, 8);
    assert.equal(result.events.filter((event) => event.kind === 'COOP_BOOST').length, 8);
  });
}
