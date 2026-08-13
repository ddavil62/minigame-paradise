import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocket } from 'ws';
import { createApp } from '../server.js';

function client(url) {
  const ws = new WebSocket(url);
  const messages = [];
  const waiters = [];
  ws.on('message', (data) => {
    const message = JSON.parse(data.toString());
    messages.push(message);
    for (const waiter of [...waiters]) {
      if (waiter.predicate(message)) {
        waiters.splice(waiters.indexOf(waiter), 1);
        clearTimeout(waiter.timer);
        waiter.resolve(message);
      }
    }
  });
  return {
    ws,
    messages,
    open: () => new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    }),
    send: (payload) => ws.send(JSON.stringify(payload)),
    waitFor(predicate, timeout = 2000) {
      const existing = messages.find(predicate);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve, timer: 0 };
        waiter.timer = setTimeout(() => {
          const index = waiters.indexOf(waiter);
          if (index >= 0) waiters.splice(index, 1);
          reject(new Error(`message timeout; received=${JSON.stringify(messages)}`));
        }, timeout);
        waiters.push(waiter);
      });
    },
  };
}

test('2~6인 준비, 대상 공격, 탈락 관전, 최후 생존 승리', async (t) => {
  const app = createApp({ heartbeatIntervalMs: 0, getBotUrl: () => null, random: () => 0 });
  app.ensureRoom('six-player-room');
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const players = Array.from({ length: 6 }, (_, i) => client(`ws://127.0.0.1:${port}/ws?room=six-player-room`));
  t.after(async () => {
    for (const player of players) player.ws.close();
    await new Promise((resolve) => server.close(resolve));
  });

  for (const player of players) await player.open();
  players.forEach((player, i) => player.send({ type: 'JOIN', playerName: `Player ${i + 1}` }));
  const joined = await Promise.all(players.map((player) => player.waitFor((m) => m.type === 'JOINED')));
  assert.deepEqual(joined.map((m) => m.playerId), ['p1', 'p2', 'p3', 'p4', 'p5', 'p6']);
  await players[0].waitFor((m) => m.type === 'ROOM_STATE' && m.players.length === 6);

  players.slice(0, 5).forEach((player) => player.send({ type: 'READY' }));
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(players[0].messages.some((m) => m.type === 'START'), false);
  players[5].send({ type: 'READY' });
  await Promise.all(players.map((player) => player.waitFor((m) => m.type === 'START')));

  players[0].send({ type: 'GARBAGE_SEND', lines: 1, combo: 0, clearEventId: 1 });
  const grant = await players[0].waitFor((m) => m.type === 'ITEM_GRANT');
  players[0].send({ type: 'ITEM_USE', itemId: grant.itemId, slotIndex: grant.slotIndex, targetPlayerId: 'p1' });
  const rejected = await players[0].waitFor((m) => m.type === 'ITEM_USE_REJECTED');
  assert.equal(rejected.reason, 'invalid_target');
  players[0].send({ type: 'ITEM_USE', itemId: grant.itemId, slotIndex: grant.slotIndex, targetPlayerId: 'p4' });
  const effect = await players[3].waitFor((m) => m.type === 'ITEM_EFFECT');
  assert.equal(effect.fromPlayerId, 'p1');

  players[0].send({ type: 'GARBAGE_SEND', lines: 2, combo: 1, clearEventId: 2 });
  const targetedGarbage = await players[3].waitFor((m) => m.type === 'GARBAGE_RECV' && m.lines === 2);
  assert.equal(targetedGarbage.fromPlayerId, 'p1');

  for (let i = 0; i < 5; i += 1) {
    players[i].send({ type: 'GAME_OVER' });
    await players[5].waitFor((m) => m.type === 'PLAYER_ELIMINATED' && m.playerId === `p${i + 1}`);
  }
  const result = await players[5].waitFor((m) => m.type === 'GAME_RESULT');
  assert.equal(result.winner, 'p6');
});
