/**
 * @fileoverview 아이템 연속 사용과 효과 수명주기의 공격적 독립 QA 회귀 테스트.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocket } from 'ws';
import { SichuanGame } from '../lib/game.js';
import { findAnyLegalPair } from '../lib/pathfinder.js';
import { createApp } from '../server.js';

/** @param {number} [seed=420] 시드 @returns {{game:SichuanGame,now:{value:number}}} 플레이 중 경기 */
function playingGame(seed = 420) {
  const now = { value: 1_000 };
  const game = new SichuanGame({ seed, now: () => now.value });
  game.addPlayer('p1', 'A');
  game.addPlayer('p2', 'B');
  game.start();
  now.value = 4_001;
  game.tick();
  return { game, now };
}

/** @param {object} player 플레이어 @param {object[]} slots 슬롯 @returns {void} */
function setInventory(player, slots) {
  player.inventory = slots.map((slot) => ({ ...slot }));
  player.inventoryRevision = slots.length;
}

/** @param {WebSocket} socket 소켓 @param {string} type 종류 @param {number} [timeout=2000] 제한 @returns {Promise<object>} */
function waitFor(socket, type, timeout = 2_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', listener);
      reject(new Error(`timeout: ${type}`));
    }, timeout);
    const listener = (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type !== type) return;
      clearTimeout(timer);
      socket.off('message', listener);
      resolve(message);
    };
    socket.on('message', listener);
  });
}

test('같은 tick·초기 revision의 세 슬롯은 250ms 안에 모두 소비되고 효과 ID가 충돌하지 않는다', () => {
  const { game } = playingGame();
  const [attacker, defender] = game.players;
  setInventory(attacker, [
    { slotId: 'slot-lock', itemId: 'lock' },
    { slotId: 'slot-flip', itemId: 'flip' },
    { slotId: 'slot-fog', itemId: 'fog' },
  ]);
  const slots = [...attacker.inventory];
  const started = performance.now();
  const results = slots.map((slot, index) => game.useItem('p1', {
    requestId: `rapid-${index}`,
    matchId: game.matchId,
    slotId: slot.slotId,
    inventoryRevision: 3,
  }));
  assert.ok(performance.now() - started < 250);
  assert.deepEqual(results.map((result) => result.ok), [true, true, true]);
  assert.equal(new Set(results.map((result) => result.effectId)).size, 3);
  assert.equal(attacker.inventory.length, 0);
  assert.equal(attacker.inventoryRevision, 6);
  assert.equal(Object.keys(defender.effects).length, 3);
});

test('동일 requestId 재전송과 소비 슬롯 새 요청은 각각 멱등·거절된다', () => {
  const { game } = playingGame();
  const [attacker, defender] = game.players;
  setInventory(attacker, [{ slotId: 'only-lock', itemId: 'lock' }]);
  const intent = { requestId: 'dedup', matchId: game.matchId, slotId: 'only-lock', inventoryRevision: 1 };
  const first = game.useItem('p1', intent);
  const revision = attacker.inventoryRevision;
  assert.deepEqual(game.useItem('p1', intent), first);
  assert.equal(attacker.inventoryRevision, revision);
  assert.equal(Object.keys(defender.effects).length, 1);
  assert.equal(game.useItem('p1', { ...intent, requestId: 'reuse' }).reason, 'STALE_INVENTORY');
  assert.equal(Object.keys(defender.effects).length, 1);
});

test('중첩 만료·정화 면역·방어막 연속 공격의 상태 전이가 보존된다', () => {
  const { game, now } = playingGame();
  const [attacker, defender] = game.players;
  setInventory(attacker, [
    { slotId: 'lock-1', itemId: 'lock' },
    { slotId: 'flip-1', itemId: 'flip' },
    { slotId: 'fog-1', itemId: 'fog' },
  ]);
  const attacks = [...attacker.inventory].map((slot, index) => game.useItem('p1', {
    requestId: `overlap-${index}`, matchId: game.matchId, slotId: slot.slotId, inventoryRevision: 3,
  }));
  const lockEffect = defender.effects[attacks[0].effectId];
  const otherEffect = defender.effects[attacks[1].effectId];
  const overlap = defender.board.tiles.find((tile) => tile.tileId === lockEffect.targets[0]);
  otherEffect.targets = [...new Set([...otherEffect.targets, overlap.tileId])];
  game.recomputeDisruptionFlags(defender);
  assert.equal(overlap.locked, true);
  assert.equal(overlap.flipped, true);
  game.endEffect(defender, attacks[0].effectId);
  assert.equal(overlap.locked, false);
  assert.equal(Boolean(overlap[otherEffect.itemId === 'flip' ? 'flipped' : 'fogged']), true);

  setInventory(defender, [{ slotId: 'clean', itemId: 'cleanse' }]);
  assert.equal(game.useItem('p2', { requestId: 'clean', matchId: game.matchId, slotId: 'clean', inventoryRevision: 1 }).ok, true);
  assert.equal(Object.keys(defender.effects).length, 0);
  setInventory(attacker, [{ slotId: 'immune-lock', itemId: 'lock' }]);
  const immune = game.useItem('p1', { requestId: 'immune', matchId: game.matchId, slotId: 'immune-lock', inventoryRevision: 1 });
  assert.equal(immune.reason, 'IMMUNE');
  assert.equal(attacker.inventory.length, 1);
  now.value += 3_001;
  assert.equal(game.useItem('p1', { requestId: 'after-immune', matchId: game.matchId, slotId: 'immune-lock', inventoryRevision: 1 }).ok, true);

  const second = playingGame(421);
  const [shieldAttacker, shieldDefender] = second.game.players;
  setInventory(shieldDefender, [{ slotId: 'shield', itemId: 'shield' }]);
  second.game.useItem('p2', { requestId: 'shield', matchId: second.game.matchId, slotId: 'shield', inventoryRevision: 1 });
  setInventory(shieldAttacker, [{ slotId: 'block-me', itemId: 'lock' }, { slotId: 'apply-me', itemId: 'flip' }]);
  const blocked = second.game.useItem('p1', { requestId: 'blocked', matchId: second.game.matchId, slotId: 'block-me', inventoryRevision: 2 });
  const applied = second.game.useItem('p1', { requestId: 'applied', matchId: second.game.matchId, slotId: 'apply-me', inventoryRevision: 2 });
  assert.equal(blocked.blocked, true);
  assert.equal(applied.blocked, false);
  assert.equal(shieldDefender.shieldUntil, 0);
  assert.equal(shieldDefender.board.tiles.filter((tile) => tile.flipped).length, 16);
});

test('힌트는 본인에게만 두 대상을 공개하고 자동 셔플 대기에는 소비하지 않는다', () => {
  const { game } = playingGame();
  const [player] = game.players;
  setInventory(player, [{ slotId: 'hint', itemId: 'hint' }]);
  const used = game.useItem('p1', { requestId: 'hint', matchId: game.matchId, slotId: 'hint', inventoryRevision: 1 });
  assert.equal(used.ok, true);
  const mine = game.snapshot('p1').me.effects.find((effect) => effect.itemId === 'hint');
  const opponentView = game.snapshot('p2').opponent.effects.find((effect) => effect.itemId === 'hint');
  assert.equal(mine.targets.length, 2);
  assert.equal('targets' in opponentView, false);
  assert.equal('path' in mine, false);
  assert.equal('path' in opponentView, false);
  assert.ok(findAnyLegalPair(player.board.tiles));

  setInventory(player, [{ slotId: 'waiting-hint', itemId: 'hint' }]);
  player.pendingAutoShuffle = { effectId: 'auto', executeAt: 99_999, reason: 'auto' };
  const denied = game.useItem('p1', { requestId: 'waiting', matchId: game.matchId, slotId: 'waiting-hint', inventoryRevision: 1 });
  assert.equal(denied.reason, 'NO_HINT_AVAILABLE');
  assert.equal(player.inventory.length, 1);
});

test('자동 셔플은 활성 방해 효과의 타일 상태와 효과 칩을 모순시키지 않는다', () => {
  const { game } = playingGame();
  const defender = game.players[1];
  const targetId = defender.board.tiles[20].tileId;
  defender.effects.activeLock = {
    effectId: 'activeLock', itemId: 'lock', targets: [targetId], endsAt: 99_999,
  };
  game.recomputeDisruptionFlags(defender);
  assert.equal(defender.board.tiles[20].locked, true);
  game.shufflePlayer(defender);
  assert.equal(defender.effects.activeLock.itemId, 'lock');
  assert.equal(defender.board.tiles.find((tile) => tile.tileId === targetId).locked, true);
});

test('USE_ITEM 초당 8회 제한은 9번째 요청부터 차단한다', async () => {
  const app = createApp({ testing: true, seed: 777, duration: 30_000 });
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `ws://127.0.0.1:${server.address().port}/sichuan-battle/ws`;
  const a = new WebSocket(`${url}?name=A`);
  const b = new WebSocket(`${url}?name=B`);
  await Promise.all([waitFor(a, 'JOINED'), waitFor(b, 'JOINED')]);
  const startedA = waitFor(a, 'START');
  const startedB = waitFor(b, 'START');
  a.send(JSON.stringify({ type: 'READY' }));
  b.send(JSON.stringify({ type: 'READY' }));
  const [start] = await Promise.all([startedA, startedB]);
  let resolved = 0;
  let limited = 0;
  a.on('message', (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.type === 'ITEM_RESOLVED') resolved += 1;
    if (message.type === 'ERROR' && message.code === 'RATE_LIMIT') limited += 1;
  });
  for (let index = 0; index < 9; index += 1) {
    a.send(JSON.stringify({
      type: 'USE_ITEM', requestId: `rate-${index}`, matchId: start.snapshot.matchId,
      slotId: 'missing', inventoryRevision: 0,
    }));
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(resolved, 8);
  assert.equal(limited, 1);
  a.close();
  b.close();
  app.close();
  await new Promise((resolve) => server.close(resolve));
});
