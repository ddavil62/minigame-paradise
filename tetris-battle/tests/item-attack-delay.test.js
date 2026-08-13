import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocket } from 'ws';
import { createApp, ITEM_ATTACK_TRAVEL_MS } from '../server.js';

function makeClient(url) {
  const ws = new WebSocket(url);
  const messages = [];
  ws.on('message', (data) => messages.push(JSON.parse(data.toString())));
  return {
    ws,
    messages,
    open: () => new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    }),
    send: (message) => ws.send(JSON.stringify(message)),
    waitFor(predicate, timeout = 1000) {
      const started = Date.now();
      return new Promise((resolve, reject) => {
        const poll = () => {
          const found = messages.find(predicate);
          if (found) return resolve(found);
          if (Date.now() - started >= timeout) return reject(new Error(`message timeout: ${JSON.stringify(messages)}`));
          setTimeout(poll, 5);
        };
        poll();
      });
    },
  };
}

test('공격은 비행 후 판정되고 비행 중 사용한 보호막으로 차단된다', async (t) => {
  assert.equal(ITEM_ATTACK_TRAVEL_MS, 1000);
  const rolls = [0, 0, 0.25, 0, 0, 0.99]; // 대상 선택, 당첨, 공격자 dark / 대상 선택, 당첨, 방어자 shield
  const app = createApp({
    heartbeatIntervalMs: 0,
    getBotUrl: () => null,
    random: () => rolls.shift() ?? 0,
    itemAttackDelayMs: 100,
  });
  app.ensureRoom('attack-delay');
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `ws://127.0.0.1:${server.address().port}/ws?room=attack-delay`;
  const attacker = makeClient(url);
  const defender = makeClient(url);
  t.after(async () => {
    attacker.ws.close();
    defender.ws.close();
    await new Promise((resolve) => server.close(resolve));
  });

  await attacker.open();
  await defender.open();
  attacker.send({ type: 'JOIN', playerName: 'Attacker' });
  defender.send({ type: 'JOIN', playerName: 'Defender' });
  const joinedA = await attacker.waitFor((message) => message.type === 'JOINED');
  const joinedD = await defender.waitFor((message) => message.type === 'JOINED');
  attacker.send({ type: 'READY' });
  defender.send({ type: 'READY' });
  await attacker.waitFor((message) => message.type === 'START');

  attacker.send({ type: 'GARBAGE_SEND', lines: 1, combo: 0, clearEventId: 1 });
  const attackItem = await attacker.waitFor((message) => message.type === 'ITEM_GRANT');
  defender.send({ type: 'GARBAGE_SEND', lines: 1, combo: 0, clearEventId: 1 });
  const shieldItem = await defender.waitFor((message) => message.type === 'ITEM_GRANT');
  assert.equal(attackItem.itemId, 'dark');
  assert.equal(shieldItem.itemId, 'shield');

  attacker.send({
    type: 'ITEM_USE',
    itemId: attackItem.itemId,
    slotIndex: attackItem.slotIndex,
    targetPlayerId: joinedD.playerId,
  });
  const launched = await defender.waitFor((message) => message.type === 'ITEM_ATTACK');
  assert.equal(launched.targetId, joinedD.playerId);
  assert.equal(defender.messages.some((message) => message.type === 'ITEM_EFFECT'), false);
  assert.equal(defender.messages.some((message) => message.type === 'SHIELD_BLOCK'), false);

  defender.send({ type: 'ITEM_USE', itemId: 'shield', slotIndex: shieldItem.slotIndex });
  const result = await defender.waitFor((message) => message.type === 'ITEM_ATTACK_RESULT');
  assert.equal(result.blocked, true);
  await defender.waitFor((message) => message.type === 'SHIELD_BLOCK' && message.isDefender === true);
  assert.equal(defender.messages.some((message) => message.type === 'ITEM_EFFECT'), false);
  assert.equal(result.attackerId, joinedA.playerId);
});
