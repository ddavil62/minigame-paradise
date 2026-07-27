/**
 * @fileoverview 스냅샷 보간 수치와 불연속 상태 초기화를 결정론적으로 검증한다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_INTERVAL_MS,
  calculateInterpolationAlpha,
  createInterpolationBuffer,
  interpolateDevice,
  interpolatePlatform,
  interpolatePlayer,
  lerp,
  updateIntervalEwma,
} from '../public/js/interpolation.js';

/** @param {object} [changes] 변경값 @returns {object} */
function snapshot(changes = {}) {
  const tick = changes.tick ?? 1;
  const x = changes.x ?? tick * 10;
  return {
    tick, levelId: changes.levelId ?? 'level-a', phase: changes.phase ?? 'playing', checkpointId: changes.checkpointId ?? 0,
    players: [{ id: 'p1', x, y: 100, vx: 30, vy: 60, grounded: changes.grounded ?? false, respawnTimer: changes.respawnTimer ?? 0 }],
    level: { platforms: [{ id: 'moving', x, y: 200, width: 100, height: 20, dynamic: {} }] },
  };
}

test('선형 보간은 경계와 중간값을 제한한다', () => {
  assert.equal(lerp(0, 10, -1), 0);
  assert.equal(lerp(0, 10, 0.5), 5);
  assert.equal(lerp(0, 10, 2), 10);
  assert.equal(calculateInterpolationAlpha(100, 200, 150), 0.5);
});

test('플레이어와 발판은 운동값만 보간하고 최신 이산 상태를 유지한다', () => {
  const player = interpolatePlayer(
    { id: 'p1', x: 0, y: 20, vx: 10, vy: 30, grounded: false, respawnTimer: 0 },
    { id: 'p1', x: 100, y: 60, vx: 30, vy: 50, grounded: true, respawnTimer: 0 },
    0.5,
  );
  assert.deepEqual({ x: player.x, y: player.y, vx: player.vx, vy: player.vy, grounded: player.grounded }, { x: 50, y: 40, vx: 20, vy: 40, grounded: true });
  const platform = interpolatePlatform({ id: 'm', x: 0, y: 10, solid: false }, { id: 'm', x: 40, y: 30, solid: true }, 0.5);
  assert.deepEqual({ x: platform.x, y: platform.y, solid: platform.solid }, { x: 20, y: 20, solid: true });
  const device = interpolateDevice({ id: 'rotary', angle: Math.PI * 1.9, state: 'POWERED' }, { id: 'rotary', angle: Math.PI * 0.1, state: 'LATCHED' }, 0.5);
  assert.equal(device.state, 'LATCHED');
  assert.ok(device.angle > Math.PI * 1.9);
});

test('리스폰, ID 누락과 큰 좌표 이동은 최신 위치로 스냅한다', () => {
  const current = { id: 'p1', x: 500, y: 500, vx: 0, vy: 0, respawnTimer: 0 };
  assert.equal(interpolatePlayer(undefined, current, 0.2).x, 500);
  assert.equal(interpolatePlayer({ ...current, x: 0, respawnTimer: 0.5 }, current, 0.2).x, 500);
  assert.equal(interpolatePlayer({ ...current, x: 0 }, current, 0.2).x, 500);
});

test('EWMA는 정상 간격에 수렴하고 비정상 표본을 제한한다', () => {
  const normal = updateIntervalEwma(DEFAULT_INTERVAL_MS, 60);
  assert.ok(normal < DEFAULT_INTERVAL_MS && normal > 60);
  assert.equal(updateIntervalEwma(60, 1000), 68);
});

test('버퍼는 한 구간 지연으로 중간 좌표를 만들고 입력을 변경하지 않는다', () => {
  const first = snapshot({ tick: 1, x: 0 });
  const second = snapshot({ tick: 2, x: 100 });
  const original = structuredClone(second);
  const buffer = createInterpolationBuffer();
  buffer.push(first, 100);
  buffer.push(second, 200);
  const rendered = buffer.sample(100 + buffer.getInterval() + 50);
  assert.ok(rendered.players[0].x > 0 && rendered.players[0].x < 100);
  assert.deepEqual(second, original);
});

test('레벨, 페이즈, 체크포인트, 중복 tick, 장시간 공백과 명시 초기화는 과거 경로를 버린다', () => {
  for (const changed of [{ levelId: 'level-b' }, { phase: 'paused' }, { checkpointId: 1 }]) {
    const buffer = createInterpolationBuffer();
    buffer.push(snapshot({ tick: 1, x: 0 }), 100);
    buffer.push(snapshot({ tick: 2, x: 100, ...changed }), 167);
    assert.equal(buffer.sample(167).players[0].x, 100);
  }
  const buffer = createInterpolationBuffer();
  buffer.push(snapshot({ tick: 3, x: 30 }), 100);
  assert.equal(buffer.push(snapshot({ tick: 3, x: 300 }), 167), false);
  assert.equal(buffer.sample(167).players[0].x, 30);
  buffer.push(snapshot({ tick: 4, x: 40 }), 700);
  assert.equal(buffer.sample(700).players[0].x, 40);
  buffer.reset();
  buffer.push(snapshot({ tick: 0, x: 50 }), 767);
  assert.equal(buffer.sample(767).players[0].x, 50);
});
