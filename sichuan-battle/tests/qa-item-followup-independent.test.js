/**
 * @fileoverview 후속 아이템 수정의 공간 분포, 드롭, allowlist, 방어막과 힌트를 독립 검증한다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoard } from '../lib/board.js';
import { chooseAiItem } from '../lib/ai.js';
import { SichuanGame } from '../lib/game.js';
import { ITEM_DEFINITIONS, ITEM_IDS, chooseTargets, rollDrop } from '../lib/items.js';
import { findAnyLegalPair, findPath } from '../lib/pathfinder.js';
import { createPrng } from '../lib/prng.js';

/** @param {number} seed 경기 시드 @param {()=>number} [now] 시계 @returns {SichuanGame} 진행 중인 2인 경기 */
function playingGame(seed, now = () => 10_000) {
  const game = new SichuanGame({ seed, now });
  game.addPlayer('a', 'A');
  game.addPlayer('b', 'B');
  game.start();
  game.phase = 'playing';
  return game;
}

test('5,000 seed의 공격 대상은 실제 활성 y행별로 균형이고 행 누적 편차도 허용 범위다', () => {
  const board = createBoard(7);
  for (const [itemId, expected] of [['lock', 6], ['flip', 16], ['fog', 18]]) {
    const rowTotals = Array(8).fill(0);
    for (let seed = 0; seed < 5_000; seed += 1) {
      const ids = chooseTargets(board, itemId, createPrng(seed));
      assert.equal(ids.length, expected);
      assert.equal(new Set(ids).size, expected);
      const selected = new Set(ids);
      const rows = Array(8).fill(0);
      board.tiles.forEach((tile) => { if (selected.has(tile.tileId)) rows[tile.y] += 1; });
      assert.ok(Math.max(...rows) - Math.min(...rows) <= 1, `${itemId}/${seed}: ${rows}`);
      rows.forEach((count, index) => { rowTotals[index] += count; });
    }
    const rowGrandTotal = rowTotals.reduce((sum, count) => sum + count, 0);
    rowTotals.forEach((count) => assert.ok(Math.abs(count / rowGrandTotal - 0.125) <= 0.015, `${itemId}: ${rowTotals}`));
  }
});

test('제거·보호·동종 중첩·사분면 고갈에서도 후보만 비복원 선택한다', () => {
  for (const removedPairs of [0, 12, 24, 36, 44]) {
    const board = createBoard(101 + removedPairs);
    board.tiles.slice(0, removedPairs * 2).forEach((tile) => { tile.removed = true; });
    board.tiles.filter((tile) => !tile.removed && tile.x < 3).slice(0, 4).forEach((tile) => { tile.locked = true; });
    const safe = findAnyLegalPair(board.tiles);
    const protectedIds = new Set(safe ? [safe.a.tileId, safe.b.tileId] : []);
    const ids = chooseTargets(board, 'lock', createPrng(removedPairs + 9));
    assert.equal(ids.length, Math.min(6, board.tiles.filter((tile) => !tile.removed && !tile.locked && !protectedIds.has(tile.tileId)).length));
    assert.equal(new Set(ids).size, ids.length);
    ids.forEach((id) => {
      const tile = board.tiles.find((entry) => entry.tileId === id);
      assert.ok(tile && !tile.removed && !tile.locked && !protectedIds.has(id));
    });
  }
  const depleted = createBoard(303);
  depleted.tiles.forEach((tile) => { tile.removed = !(tile.x < 6 && tile.y < 4); });
  const ids = chooseTargets(depleted, 'fog', createPrng(77));
  assert.ok(ids.every((id) => {
    const tile = depleted.tiles.find((entry) => entry.tileId === id);
    return tile.x < 6 && tile.y < 4 && !tile.removed;
  }));
});

test('100,000 drop과 10,000 seed 평균은 새 확률·기존 가중치·pity 경계를 만족한다', () => {
  const counts = Object.fromEntries(ITEM_IDS.map((id) => [id, 0]));
  let pity = 0;
  let drops = 0;
  for (let ordinal = 1; ordinal <= 100_000; ordinal += 1) {
    const result = rollDrop(987654, ordinal, pity);
    assert.deepEqual(result, rollDrop(987654, ordinal, pity));
    pity = result.pity;
    if (result.dropped) {
      assert.ok(ITEM_IDS.includes(result.itemId));
      counts[result.itemId] += 1;
      drops += 1;
    }
  }
  const totalWeight = Object.values(ITEM_DEFINITIONS).reduce((sum, item) => sum + item.weight, 0);
  ITEM_IDS.forEach((id) => assert.ok(Math.abs(counts[id] / drops - ITEM_DEFINITIONS[id].weight / totalWeight) <= 0.01, `${id}: ${counts[id]}/${drops}`));
  assert.equal(rollDrop(1, 1, 0).dropped, true);
  assert.equal(rollDrop(1, 99, 5).dropped, true);
  for (const pairs of [30, 48]) {
    let total = 0;
    for (let seed = 0; seed < 10_000; seed += 1) {
      let chain = 0;
      for (let ordinal = 1; ordinal <= pairs; ordinal += 1) {
        const result = rollDrop(seed, ordinal, chain);
        chain = result.pity;
        if (result.dropped) total += 1;
        assert.ok(chain <= 5);
      }
    }
    const average = total / 10_000;
    assert.ok(average >= (pairs === 30 ? 7.35 : 11.55) && average <= (pairs === 30 ? 7.70 : 12.00), `${pairs}: ${average}`);
  }
});

test('grant·normalize·snapshot·AI는 invalid/unknown/duplicate 슬롯과 효과를 배제한다', () => {
  const game = playingGame(404);
  const player = game.players[0];
  player.inventory = [
    { slotId: 'legacy', itemId: 'force_shuffle' },
    { slotId: 'unknown', itemId: 'banana' },
    { slotId: 'missing' },
    { slotId: null, itemId: 'hint' },
    { slotId: 'valid', itemId: 'hint' },
    { slotId: 'valid', itemId: 'shield' },
  ];
  player.effects = {
    hint: { effectId: 'hint-valid', itemId: 'hint', targets: ['a', 'b'], path: [{ x: 0, y: 0 }], endsAt: 99_900 },
    bad: { effectId: 'bad', itemId: 'banana', targets: [], endsAt: 99_999 },
    legacy: { effectId: 'legacy-effect', itemId: 'force_shuffle', endsAt: 99_999 },
    shield: { effectId: 'legacy-shield', itemId: 'shield', endsAt: 99_999 },
    invalidTime: { effectId: 'invalid-time', itemId: 'lock', endsAt: '99999' },
    missing: null,
  };
  const before = player.inventoryRevision;
  const first = game.snapshot('a');
  assert.deepEqual(first.me.inventory, [{ slotId: 'valid', itemId: 'hint' }]);
  assert.equal(player.inventoryRevision, before + 1);
  assert.deepEqual(first.me.effects.map((effect) => effect.itemId), ['hint']);
  assert.deepEqual(first.me.effects[0].targets, ['a', 'b']);
  assert.deepEqual(first.me.effects[0].path, [{ x: 0, y: 0 }]);
  const opponentView = game.snapshot('b').opponent.effects;
  assert.deepEqual(opponentView.map((effect) => effect.itemId), ['hint']);
  assert.equal('targets' in opponentView[0], false);
  assert.equal('path' in opponentView[0], false);
  game.snapshot('a');
  assert.equal(player.inventoryRevision, before + 1);
  assert.equal(game.grantItem('a', 'force_shuffle', 'x'), null);
  assert.equal(game.grantItem('a', null, 'x'), null);
  assert.equal(game.grantItem('a', 'shield', 'valid'), null);
  const use = game.useItem('a', { matchId: game.matchId, requestId: 'bad', slotId: 'legacy', inventoryRevision: before });
  assert.equal(use.ok, false);
  assert.equal(use.reason, 'STALE_INVENTORY');
  const ai = chooseAiItem({
    me: { board: player.board, inventory: [
      { slotId: 'bad', itemId: 'force_shuffle' }, { slotId: null, itemId: 'shield' }, { slotId: 'ok', itemId: 'lock' },
    ], effects: [], shieldActive: false },
    opponent: { remaining: 96 },
  }, { actionOrdinal: 0 }, () => 0);
  assert.equal(ai?.itemId, 'lock');
});

test('invalid 권위 effect는 모든 진입점에서 정규화되고 정상 hint→attack→cleanse를 막지 않는다', () => {
  const game = playingGame(454);
  const [attacker, defender] = game.players;
  const attackerTile = attacker.board.tiles[0].tileId;
  const defenderTile = defender.board.tiles[0].tileId;
  const invalid = {
    nullEffect: null,
    unknown: { effectId: 'unknown', itemId: 'banana', endsAt: 90_000 },
    legacy: { effectId: 'legacy', itemId: 'force_shuffle', endsAt: 90_000 },
    shield: { effectId: 'shield', itemId: 'shield', endsAt: 90_000 },
    cleanse: { effectId: 'cleanse', itemId: 'cleanse', endsAt: 90_000 },
    missingId: { itemId: 'lock', endsAt: 90_000, targets: [defenderTile] },
    emptyId: { effectId: '', itemId: 'fog', endsAt: 90_000, targets: [defenderTile] },
    stringTime: { effectId: 'string-time', itemId: 'flip', endsAt: '90000', targets: [defenderTile] },
  };
  attacker.effects = {
    ...invalid,
    hint: {
      effectId: 'valid-hint',
      itemId: 'hint',
      endsAt: 90_000,
      targets: [attackerTile, null, attackerTile, 3],
      path: [null, { x: 0, y: 0 }, { x: '1', y: 0 }, { x: 1, y: Infinity }],
    },
  };
  const mine = game.snapshot('a').me.effects;
  const theirs = game.snapshot('b').opponent.effects;
  assert.deepEqual(mine.map((effect) => effect.itemId), ['hint']);
  assert.deepEqual(mine[0].targets, [attackerTile]);
  assert.deepEqual(mine[0].path, [{ x: 0, y: 0 }]);
  assert.equal('targets' in theirs[0], false);
  assert.equal('path' in theirs[0], false);
  assert.deepEqual(Object.keys(attacker.effects), ['hint']);

  attacker.effects = { ...invalid };
  assert.doesNotThrow(() => game.tick());
  assert.deepEqual(attacker.effects, {});

  defender.effects = {
    ...invalid,
    lock: { effectId: 'valid-lock', itemId: 'lock', endsAt: 90_000, targets: [defenderTile, null, defenderTile] },
  };
  assert.doesNotThrow(() => game.recomputeDisruptionFlags(defender));
  assert.deepEqual(Object.keys(defender.effects), ['lock']);
  assert.equal(defender.board.tiles[0].locked, true);
  assert.doesNotThrow(() => game.endEffect(defender, 'lock'));
  assert.equal(defender.board.tiles[0].locked, false);

  attacker.effects = {
    ...invalid,
    hint: { effectId: 'clear-hint', itemId: 'hint', endsAt: 90_000, targets: [], path: [] },
  };
  assert.doesNotThrow(() => game.clearHints(attacker));
  assert.deepEqual(attacker.effects, {});

  game.grantItem('a', 'hint', 'round3-hint');
  const hint = game.useItem('a', { matchId: game.matchId, requestId: 'round3-hint', slotId: 'round3-hint' });
  assert.equal(hint.ok, true);
  game.grantItem('a', 'lock', 'round3-lock');
  const attack = game.useItem('a', { matchId: game.matchId, requestId: 'round3-lock', slotId: 'round3-lock' });
  assert.equal(attack.ok, true);
  assert.ok(Object.values(defender.effects).some((effect) => effect.itemId === 'lock'));
  game.grantItem('b', 'cleanse', 'round3-cleanse');
  const cleanse = game.useItem('b', { matchId: game.matchId, requestId: 'round3-cleanse', slotId: 'round3-cleanse' });
  assert.equal(cleanse.ok, true);
  assert.equal(Object.values(defender.effects).some((effect) => ['lock', 'flip', 'fog'].includes(effect.itemId)), false);
});

test('방어막은 무기한이며 첫 유효 공격만 막고 면역·후보 없음·정화는 보존한다', () => {
  let now = 10_000;
  const game = playingGame(505, () => now);
  const [attacker, defender] = game.players;
  game.grantItem('b', 'shield', 'shield-1');
  assert.equal(game.useItem('b', { matchId: game.matchId, requestId: 'shield', slotId: 'shield-1' }).ok, true);
  now = game.deadlineAt - 1;
  game.tick();
  assert.equal(defender.shieldActive, true);
  assert.equal(game.snapshot('b').me.shieldActive, true);
  assert.equal(game.snapshot('a').opponent.shieldActive, true);
  now = game.deadlineAt + 1;
  game.tick();
  assert.equal(defender.shieldActive, false);
  game.phase = 'playing';
  game.result = null;
  game.deadlineAt = now + 1_000_000;
  game.grantItem('b', 'shield', 'shield-2');
  assert.equal(game.useItem('b', { matchId: game.matchId, requestId: 'shield-again', slotId: 'shield-2' }).ok, true);
  game.grantItem('b', 'shield', 'shield-3');
  const duplicate = game.useItem('b', { matchId: game.matchId, requestId: 'shield-duplicate', slotId: 'shield-3' });
  assert.deepEqual([duplicate.ok, duplicate.reason], [false, 'ALREADY_ACTIVE']);
  assert.ok(defender.inventory.some((slot) => slot.slotId === 'shield-3'));
  game.grantItem('a', 'lock', 'attack-1');
  game.grantItem('a', 'fog', 'attack-2');
  const blocked = game.useItem('a', { matchId: game.matchId, requestId: 'attack-1', slotId: 'attack-1', inventoryRevision: attacker.inventoryRevision });
  const applied = game.useItem('a', { matchId: game.matchId, requestId: 'attack-2', slotId: 'attack-2', inventoryRevision: attacker.inventoryRevision });
  assert.equal(blocked.blocked, true);
  assert.equal(defender.shieldActive, false);
  assert.equal(applied.blocked, false);
  assert.ok(applied.targets.length > 0);
  assert.ok(Object.values(defender.effects).some((effect) => effect.itemId === 'fog'));
  defender.shieldActive = true;
  defender.immuneUntil = now + 3_000;
  game.grantItem('a', 'flip', 'immune-attack');
  const immune = game.useItem('a', { matchId: game.matchId, requestId: 'immune', slotId: 'immune-attack' });
  assert.deepEqual([immune.ok, immune.reason, defender.shieldActive], [false, 'IMMUNE', true]);
  assert.ok(attacker.inventory.some((slot) => slot.slotId === 'immune-attack'));
  game.grantItem('b', 'cleanse', 'cleanse');
  assert.equal(game.useItem('b', { matchId: game.matchId, requestId: 'cleanse', slotId: 'cleanse' }).ok, true);
  assert.equal(defender.shieldActive, true);
  defender.immuneUntil = 0;
  defender.board.tiles.forEach((tile) => { tile.removed = true; });
  game.grantItem('a', 'lock', 'no-target');
  const noTarget = game.useItem('a', { matchId: game.matchId, requestId: 'no-target', slotId: 'no-target' });
  assert.deepEqual([noTarget.ok, noTarget.reason, defender.shieldActive], [false, 'NO_VALID_TARGET', true]);
  assert.ok(attacker.inventory.some((slot) => slot.slotId === 'no-target'));
});

test('힌트는 실제 합법 쌍 두 개를 본인에게만 공개하고 제거·셔플·경기 종료에서 정리한다', () => {
  let now = 20_000;
  const game = playingGame(606, () => now);
  game.grantItem('a', 'hint', 'hint');
  const result = game.useItem('a', { matchId: game.matchId, requestId: 'hint', slotId: 'hint' });
  assert.equal(result.ok, true);
  assert.equal(result.targets.length, 2);
  const owner = game.snapshot('a').me.effects.find((effect) => effect.itemId === 'hint');
  const opponent = game.snapshot('b').opponent.effects.find((effect) => effect.itemId === 'hint');
  assert.equal(owner.targets.length, 2);
  assert.ok(owner.path.length >= 2);
  assert.equal('targets' in opponent, false);
  assert.equal('path' in opponent, false);
  const [a, b] = owner.targets.map((id) => game.players[0].board.tiles.find((tile) => tile.tileId === id));
  assert.ok(a && b && !a.removed && !b.removed && !a.locked && !b.locked && a.faceId === b.faceId);
  assert.ok(findPath(game.players[0].board.tiles, a.tileId, b.tileId));
  const removed = game.matchPair('a', { matchId: game.matchId, requestId: 'pair', boardRevision: game.players[0].board.revision, tileAId: a.tileId, tileBId: b.tileId });
  assert.equal(removed.ok, true);
  assert.equal(game.snapshot('a').me.effects.some((effect) => effect.itemId === 'hint'), false);
  game.grantItem('a', 'hint', 'hint-2');
  game.useItem('a', { matchId: game.matchId, requestId: 'hint-2', slotId: 'hint-2' });
  game.shufflePlayer(game.players[0]);
  assert.equal(game.snapshot('a').me.effects.some((effect) => effect.itemId === 'hint'), false);
  game.grantItem('a', 'hint', 'hint-3');
  game.useItem('a', { matchId: game.matchId, requestId: 'hint-3', slotId: 'hint-3' });
  now += 3_001;
  game.tick();
  assert.equal(game.snapshot('a').me.effects.some((effect) => effect.itemId === 'hint'), true);
  now = game.deadlineAt + 1;
  game.tick();
  assert.equal(game.snapshot('a').me.effects.some((effect) => effect.itemId === 'hint'), false);
});
