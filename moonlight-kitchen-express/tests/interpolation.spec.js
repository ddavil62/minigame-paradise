/** @fileoverview 주방열차의 15Hz 권위 스냅샷을 렌더 프레임으로 보간하는 계약을 검증한다. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_INTERVAL_MS,
  calculateInterpolationAlpha,
  createInterpolationBuffer,
  interpolateItem,
  interpolatePlayer,
  interpolateSnapshot,
  lerp,
  updateIntervalEwma,
} from '../public/js/interpolation.js';

function snapshot({ tick = 1, phase = 'playing', x = 100, itemX = x, elapsedMs = tick * 66 } = {}) {
  return {
    tick, phase, elapsedMs, heat: tick * 2, score: tick * 100,
    players: [{ id: 'p1', x, y: 240, facingX: 1, facingY: 0, work: tick % 2 === 0 }],
    items: [{ id: 'item_1', x: itemX, y: 220, location: 'HELD', holderId: 'p1', process: 'RAW' }],
    stations: [{ id: 'board', state: 'ACTIVE', revision: 1, progressMs: tick * 100, readyMs: 0 }],
    train: { heat: tick * 2, coolingProgressMs: tick * 100, overheatRemainingMs: null },
  };
}

test('보간 수치는 경계 안에 제한되고 최신 이산 상태를 유지한다', () => {
  assert.equal(lerp(0, 10, -1), 0);
  assert.equal(lerp(0, 10, 0.5), 5);
  assert.equal(calculateInterpolationAlpha(100, 200, 150), 0.5);
  const player = interpolatePlayer(
    { id: 'p1', x: 0, y: 20, work: false },
    { id: 'p1', x: 100, y: 60, work: true },
    0.5,
  );
  assert.deepEqual({ x: player.x, y: player.y, work: player.work }, { x: 50, y: 40, work: true });
});

test('아이템 소유·공정 전환과 큰 위치 변화는 과거 경로를 그리지 않고 스냅한다', () => {
  const current = { id: 'item', x: 500, y: 300, location: 'FLOOR', holderId: null, process: 'PREPPED' };
  assert.equal(interpolateItem(undefined, current, 0.5).x, 500);
  assert.equal(interpolateItem({ ...current, x: 490, process: 'RAW' }, current, 0.5).x, 500);
  assert.equal(interpolateItem({ ...current, x: 0 }, current, 0.5).x, 500);
});

test('스냅샷은 좌표·진행도만 섞고 점수와 행동은 최신 권위 값을 쓴다', () => {
  const first = snapshot({ tick: 1, x: 0, itemX: 0, elapsedMs: 100 });
  const second = snapshot({ tick: 2, x: 100, itemX: 100, elapsedMs: 200 });
  const rendered = interpolateSnapshot(first, second, 0.5);
  assert.equal(rendered.players[0].x, 50);
  assert.equal(rendered.items[0].x, 50);
  assert.equal(rendered.elapsedMs, 150);
  assert.equal(rendered.stations[0].progressMs, 150);
  assert.equal(rendered.score, 200);
  assert.equal(rendered.players[0].work, true);
});

test('수신 간격 EWMA와 한 구간 지연 버퍼가 15Hz 사이 중간 프레임을 만든다', () => {
  assert.ok(updateIntervalEwma(DEFAULT_INTERVAL_MS, 60) < DEFAULT_INTERVAL_MS);
  const buffer = createInterpolationBuffer();
  const first = snapshot({ tick: 1, x: 0 });
  const second = snapshot({ tick: 2, x: 100 });
  const original = structuredClone(second);
  buffer.push(first, 100);
  buffer.push(second, 200);
  const rendered = buffer.sample(100 + buffer.getInterval() + 50);
  assert.ok(rendered.players[0].x > 0 && rendered.players[0].x < 100);
  assert.deepEqual(second, original);
});

test('페이즈 전환, 중복 틱, 긴 수신 공백과 명시 초기화는 최신 위치로 스냅한다', () => {
  const buffer = createInterpolationBuffer();
  buffer.push(snapshot({ tick: 1, x: 0 }), 100);
  buffer.push(snapshot({ tick: 2, phase: 'paused', x: 100 }), 167);
  assert.equal(buffer.sample(167).players[0].x, 100);
  assert.equal(buffer.push(snapshot({ tick: 2, phase: 'paused', x: 300 }), 200), false);
  buffer.push(snapshot({ tick: 3, phase: 'paused', x: 40 }), 800);
  assert.equal(buffer.sample(800).players[0].x, 40);
  buffer.reset();
  buffer.push(snapshot({ tick: 0, x: 50 }), 867);
  assert.equal(buffer.sample(867).players[0].x, 50);
});
