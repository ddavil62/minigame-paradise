/**
 * @fileoverview 아이템 행 균형, 지속 힌트, 공격 갱신과 빈 정화를 회귀 검증한다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoard } from '../lib/board.js';
import { SichuanGame } from '../lib/game.js';
import { chooseTargets } from '../lib/items.js';
import { createPrng } from '../lib/prng.js';

/** @param {number} seed 경기 시드 @returns {{game:SichuanGame,now:{value:number},a:object,b:object}} */
function setup(seed = 901) {
  const now = { value: 1000 };
  const game = new SichuanGame({ seed, now: () => now.value, duration: 180000 });
  const a = game.addPlayer('a', 'A'); const b = game.addPlayer('b', 'B');
  game.start(); now.value = 5000; game.tick();
  return { game, now, a, b };
}

test('방해 대상은 활성 y행별 최대 편차 1로 결정적으로 분산된다', () => {
  for (const itemId of ['lock', 'flip', 'fog']) {
    for (let seed = 1; seed <= 100; seed += 1) {
      const board = createBoard(seed);
      const ids = chooseTargets(board, itemId, createPrng(seed * 19));
      const counts = new Map();
      for (const tile of board.tiles.filter((entry) => ids.includes(entry.tileId))) counts.set(tile.y, (counts.get(tile.y) || 0) + 1);
      const values = Array.from({ length: 8 }, (_, y) => counts.get(y) || 0);
      assert.ok(Math.max(...values) - Math.min(...values) <= 1, `${itemId}:${seed}:${values}`);
    }
  }
});

test('힌트는 경기 deadline까지 유지되고 소유자에게만 경로가 공개된다', () => {
  const { game, now, a } = setup();
  game.grantItem('a', 'hint', 'hint');
  const used = game.useItem('a', { requestId: 'hint', matchId: game.matchId, slotId: 'hint' });
  assert.equal(used.ok, true);
  const effect = Object.values(a.effects)[0];
  assert.equal(effect.endsAt, game.deadlineAt);
  now.value += 4000; game.tick();
  assert.equal(game.snapshot('a').me.effects[0].targets.length, 2);
  assert.equal(game.snapshot('b').opponent.effects[0].targets, undefined);
});

test('같은 공격 재사용은 effect와 targets를 유지하고 만료만 초기화한다', () => {
  const { game, now, b } = setup();
  game.grantItem('a', 'flip', 'flip-1');
  const first = game.useItem('a', { requestId: 'flip-1', matchId: game.matchId, slotId: 'flip-1' });
  const before = structuredClone(Object.values(b.effects)[0]);
  now.value += 1200;
  game.grantItem('a', 'flip', 'flip-2');
  const second = game.useItem('a', { requestId: 'flip-2', matchId: game.matchId, slotId: 'flip-2' });
  const after = Object.values(b.effects)[0];
  assert.equal(first.ok, true); assert.equal(second.refreshed, true);
  assert.equal(Object.keys(b.effects).length, 1); assert.equal(after.effectId, before.effectId);
  assert.deepEqual(after.targets, before.targets); assert.equal(after.endsAt, now.value + 4000);
});

test('디버프가 없는 빈 정화도 소비되고 3초 면역을 준다', () => {
  const { game, now, a } = setup();
  game.grantItem('a', 'cleanse', 'clean');
  const result = game.useItem('a', { requestId: 'clean', matchId: game.matchId, slotId: 'clean' });
  assert.equal(result.ok, true); assert.equal(a.inventory.length, 0); assert.equal(a.immuneUntil, now.value + 3000);
});
