/**
 * @fileoverview 운영형 슬롯 ID와 공격 대상의 상·하 화면 균형을 집중 검증한다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoard } from '../lib/board.js';
import { SichuanGame } from '../lib/game.js';
import { chooseTargets } from '../lib/items.js';
import { createPrng } from '../lib/prng.js';

test('flip 16장은 모든 seed에서 화면 상·하 8장씩, 각 절반 행별 2장씩 뽑힌다', () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    const board = createBoard(seed);
    const ids = new Set(chooseTargets(board, 'flip', createPrng(seed * 17)));
    const counts = Array.from({ length: 8 }, () => 0);
    board.tiles.forEach((tile) => { if (ids.has(tile.tileId)) counts[tile.y] += 1; });
    assert.equal(counts.slice(0, 4).reduce((sum, count) => sum + count, 0), 8);
    assert.equal(counts.slice(4).reduce((sum, count) => sum + count, 0), 8);
    assert.deepEqual(counts, [2, 2, 2, 2, 2, 2, 2, 2]);
  }
});

test('운영형 s-* 슬롯은 사용 즉시 권위 인벤토리에서 소비되고 effect와 분리된다', () => {
  let now = 10_000;
  const game = new SichuanGame({ now: () => now, seed: 77 });
  game.addPlayer('p1', 'A'); game.addPlayer('p2', 'B'); game.start(); now += 4_000; game.tick();
  const slot = game.grantItem('p1', 'flip', 's-live-flip-1');
  assert.equal(slot.slotId, 's-live-flip-1');
  const result = game.useItem('p1', { requestId: 'live-use', matchId: game.matchId, slotId: slot.slotId });
  assert.equal(result.ok, true);
  const snapshot = game.snapshot('p1');
  assert.equal(snapshot.me.inventory.some((entry) => entry.slotId === slot.slotId), false);
  assert.equal(snapshot.opponent.effects.some((effect) => effect.itemId === 'flip'), true);
});
