import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocket } from 'ws';
import { createApp } from '../server.js';
import { loadWords } from '../words.js';

function openClient(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const messages = [];
    const waiters = [];
    ws.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      const index = waiters.findIndex((waiter) => waiter.predicate(message));
      if (index >= 0) waiters.splice(index, 1)[0].resolve(message);
      else messages.push(message);
    });
    ws.once('open', () => resolve({
      ws,
      send(payload) { ws.send(JSON.stringify(payload)); },
      wait(typeOrPredicate, timeout = 8_000) {
        const predicate = typeof typeOrPredicate === 'function'
          ? typeOrPredicate
          : (message) => message.type === typeOrPredicate;
        const index = messages.findIndex(predicate);
        if (index >= 0) return Promise.resolve(messages.splice(index, 1)[0]);
        return new Promise((waitResolve, waitReject) => {
          let waiter;
          const timer = setTimeout(() => {
            const waiterIndex = waiters.indexOf(waiter);
            if (waiterIndex >= 0) waiters.splice(waiterIndex, 1);
            waitReject(new Error('message timeout'));
          }, timeout);
          waiter = { predicate, resolve: (message) => { clearTimeout(timer); waitResolve(message); } };
          waiters.push(waiter);
        });
      },
    }));
    ws.once('error', reject);
  });
}

test('실제 WebSocket이 State별 의도 검증과 보상 전투를 서버 권위로 처리한다', async () => {
  const app = createApp({ hostUrl: '', random: () => 0 });
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const p1 = await openClient(port);
  const p2 = await openClient(port);
  try {
    await p1.wait('JOINED'); await p2.wait('JOINED');
    p1.send({ type: 'JOIN', name: 'A' }); p2.send({ type: 'JOIN', name: 'B' });
    const start = await p1.wait('GAME_START'); await p2.wait('GAME_START');
    assert.equal(start.combatConfig.rewards.length, 7);
    assert.equal(start.firstTurn, 'p1');
    await p1.wait('PLAYING', 5_000); await p2.wait('PLAYING', 5_000);
    const initial = await p1.wait('STATE'); await p2.wait('STATE');
    assert.equal(initial.turn, 'p1');
    assert.equal(initial.turnState, 'word_input');
    assert.equal(initial.chain.lastSyllable, null);

    p1.send({ type: 'REWARD_SELECT', rewardId: 'bonus_damage' });
    assert.equal((await p1.wait('REWARD_REJECTED')).reason, 'wrong_state');

    const word = [...loadWords()].find((candidate) => [...candidate].length === 3);
    assert.ok(word);
    p1.send({ type: 'WORD_SUBMIT', word });
    const accepted = await p1.wait('WORD_ACCEPTED'); await p2.wait('WORD_ACCEPTED');
    assert.equal(accepted.wordLength, 3);
    const rewardState = await p1.wait((message) => message.type === 'STATE' && message.turnState === 'reward_select');
    await p2.wait((message) => message.type === 'STATE' && message.turnState === 'reward_select');
    assert.equal(rewardState.turn, 'p1');
    assert.equal(rewardState.pendingCombat.rewardOptions.length, 3);
    assert.equal(new Set(rewardState.pendingCombat.rewardOptions).size, 3);
    assert.ok(rewardState.pendingCombat.rewardOptions.includes('bonus_damage'));

    p1.send({ type: 'WORD_SUBMIT', word });
    assert.equal((await p1.wait('WORD_REJECTED')).reason, 'wrong_state');
    p2.send({ type: 'REWARD_SELECT', rewardId: 'heal' });
    assert.equal((await p2.wait('REWARD_REJECTED')).reason, 'not_your_turn');
    p1.send({ type: 'REWARD_SELECT', rewardId: 'heal' });
    assert.equal((await p1.wait('REWARD_REJECTED')).reason, 'reward_not_offered');

    p1.send({ type: 'REWARD_SELECT', rewardId: 'bonus_damage' });
    const combat = await p1.wait('COMBAT_RESOLVED'); await p2.wait('COMBAT_RESOLVED');
    assert.equal(combat.damage, 13);
    const next = await p1.wait((message) => message.type === 'STATE' && message.turnState === 'word_input');
    await p2.wait((message) => message.type === 'STATE' && message.turnState === 'word_input');
    assert.equal(next.turn, 'p2');
    assert.equal(next.players.find((player) => player.id === 'p2').hp, 87);

    p2.ws.close();
    assert.equal((await p1.wait('OPPONENT_LEFT')).type, 'OPPONENT_LEFT');
  } finally {
    p1.ws.close(); p2.ws.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('실제 10초 보상 타이머 만료는 보상 없이 공격하고 상대 턴을 시작한다', async () => {
  const app = createApp({ hostUrl: '', random: () => 0 });
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const p1 = await openClient(port);
  const p2 = await openClient(port);
  try {
    await p1.wait('JOINED'); await p2.wait('JOINED');
    p1.send({ type: 'JOIN', name: 'A' }); p2.send({ type: 'JOIN', name: 'B' });
    await p1.wait('GAME_START'); await p2.wait('GAME_START');
    await p1.wait('PLAYING', 5_000); await p2.wait('PLAYING', 5_000);
    await p1.wait('STATE'); await p2.wait('STATE');
    const word = [...loadWords()].find((candidate) => [...candidate].length === 3);
    p1.send({ type: 'WORD_SUBMIT', word });
    await p1.wait('WORD_ACCEPTED'); await p2.wait('WORD_ACCEPTED');
    await p1.wait((message) => message.type === 'STATE' && message.turnState === 'reward_select');
    await p2.wait((message) => message.type === 'STATE' && message.turnState === 'reward_select');
    const expired = await p1.wait('REWARD_EXPIRED', 12_000);
    await p2.wait('REWARD_EXPIRED', 12_000);
    assert.equal(expired.combat.rewardId, null);
    assert.equal(expired.combat.damage, 8);
    const next = await p1.wait((message) => message.type === 'STATE' && message.turnState === 'word_input');
    assert.equal(next.turn, 'p2');
    assert.equal(next.players.find((player) => player.id === 'p2').hp, 92);
  } finally {
    p1.ws.close(); p2.ws.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
