import test from 'node:test';
import assert from 'node:assert/strict';
import { SichuanGame, AUTO_HINT_TIMING } from '../lib/game.js';
import { findAnyLegalPair } from '../lib/pathfinder.js';
import { rollDrop } from '../lib/items.js';

function createStartedGame(seed = 31) {
  let now = 0;
  const game = new SichuanGame({ seed, now: () => now, duration: 1_000_000 });
  game.addPlayer('p1', 'A');
  game.addPlayer('p2', 'B');
  game.start();
  const setNow = (value) => { now = value; game.tick(); };
  setNow(game.startedAt);
  return { game, player: game.players[0], setNow, getNow: () => now };
}

test('자동 힌트는 6초·9초·12초에 한 타일, 짝, 1초 경로 순서로 진행된다', () => {
  const { game, setNow } = createStartedGame();
  setNow(game.startedAt + AUTO_HINT_TIMING.first - 1);
  assert.equal(game.snapshot('p1').me.autoHint, null);

  setNow(game.startedAt + AUTO_HINT_TIMING.first);
  assert.equal(game.snapshot('p1').me.autoHint.stage, 1);
  assert.equal(game.snapshot('p1').me.autoHint.targets.length, 2);

  setNow(game.startedAt + AUTO_HINT_TIMING.pair);
  assert.equal(game.snapshot('p1').me.autoHint.stage, 2);

  setNow(game.startedAt + AUTO_HINT_TIMING.path);
  const pathHint = game.snapshot('p1').me.autoHint;
  assert.equal(pathHint.stage, 3);
  assert.ok(pathHint.path.length >= 2);

  setNow(game.startedAt + AUTO_HINT_TIMING.path + AUTO_HINT_TIMING.pathDuration);
  assert.equal(game.snapshot('p1').me.autoHint.stage, 2);
  assert.deepEqual(game.snapshot('p1').me.autoHint.path, []);
});

test('수동 힌트가 활성화된 동안 자동 힌트 타이머가 멈추고 종료 후 다시 센다', () => {
  const { game, player, setNow, getNow } = createStartedGame(32);
  player.effects.manual = { effectId: 'manual', itemId: 'hint', targets: [], path: [], endsAt: game.deadlineAt };
  setNow(game.startedAt + 20_000);
  assert.equal(game.snapshot('p1').me.autoHint, null);

  delete player.effects.manual;
  setNow(getNow() + AUTO_HINT_TIMING.first - 1);
  assert.equal(game.snapshot('p1').me.autoHint, null);
  setNow(getNow() + 1);
  assert.equal(game.snapshot('p1').me.autoHint.stage, 1);
});

test('안개·뒤집기 중에는 두 디버프가 모두 없는 타일 쌍만 자동 안내한다', () => {
  const { game, player, setNow } = createStartedGame(33);
  const legal = findAnyLegalPair(player.board.tiles);
  assert.ok(legal);
  player.board.tiles.forEach((tile) => { tile.fogged = true; tile.flipped = true; });
  legal.a.fogged = false; legal.a.flipped = false;
  legal.b.fogged = false; legal.b.flipped = false;

  setNow(game.startedAt + AUTO_HINT_TIMING.pair);
  const hint = game.snapshot('p1').me.autoHint;
  assert.deepEqual(new Set(hint.targets), new Set([legal.a.tileId, legal.b.tileId]));
  for (const tileId of hint.targets) {
    const tile = player.board.tiles.find((entry) => entry.tileId === tileId);
    assert.equal(tile.fogged, false);
    assert.equal(tile.flipped, false);
  }
});

test('자동 안내 쌍을 제거하면 타이머가 초기화되고 아이템 드롭 배율이 절반으로 적용된다', () => {
  const { game, player, setNow } = createStartedGame(34);
  setNow(game.startedAt + AUTO_HINT_TIMING.pair);
  const [tileAId, tileBId] = player.autoHint.targets;
  const result = game.matchPair('p1', {
    requestId: 'guided-pair', matchId: game.matchId, tileAId, tileBId, boardRevision: player.board.revision,
  });
  assert.equal(result.ok, true);
  assert.equal(result.autoHintAssisted, true);
  assert.equal(player.autoHint, null);
  setNow(player.lastPairAt + AUTO_HINT_TIMING.first - 1);
  assert.equal(game.snapshot('p1').me.autoHint, null);

  let drops = 0;
  for (let seed = 0; seed < 4000; seed += 1) if (rollDrop(seed, 7, 5, 0.5).dropped) drops += 1;
  assert.ok(drops >= 1800 && drops <= 2200, `halved guaranteed drops: ${drops}`);
});
