import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';

async function reservePort() {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function connect(url) {
  const ws = new WebSocket(url);
  const messages = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const message = JSON.parse(raw.toString());
    const index = waiters.findIndex((waiter) => waiter.predicate(message));
    if (index >= 0) waiters.splice(index, 1)[0].resolve(message);
    else messages.push(message);
  });
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  return {
    ws,
    send(payload) { ws.send(JSON.stringify(payload)); },
    wait(type, timeout = 8_000) {
      const predicate = (message) => message.type === type;
      const index = messages.findIndex(predicate);
      if (index >= 0) return Promise.resolve(messages.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        let waiter;
        const timer = setTimeout(() => {
          const waiterIndex = waiters.indexOf(waiter);
          if (waiterIndex >= 0) waiters.splice(waiterIndex, 1);
          reject(new Error(`${type} timeout`));
        }, timeout);
        waiter = { predicate, resolve: (message) => { clearTimeout(timer); resolve(message); } };
        waiters.push(waiter);
      });
    },
  };
}

test('로비 2인 READY는 동일 매치 ID와 역할로 이동하며 오래된 게임 슬롯을 교체한다', async () => {
  const port = await reservePort();
  const root = new URL('../..', import.meta.url);
  const launcher = spawn(process.execPath, ['launcher/server.js', '--port', String(port)], {
    cwd: root,
    stdio: 'ignore',
  });
  const sockets = [];
  try {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      try {
        if ((await fetch(`http://127.0.0.1:${port}/`)).ok) break;
      } catch (_) { /* 서버 리스너 대기 */ }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    const stale = await connect(`ws://127.0.0.1:${port}/wordchain-battle/ws`);
    sockets.push(stale.ws);
    await stale.wait('JOINED');
    stale.send({ type: 'JOIN', name: '오래된 탭' });

    const lobbyUrl = `ws://127.0.0.1:${port}/lobby/ws?gameId=wordchain-battle`;
    const lobbyA = await connect(lobbyUrl);
    const lobbyB = await connect(lobbyUrl);
    sockets.push(lobbyA.ws, lobbyB.ws);
    lobbyA.send({ type: 'JOIN', name: '친구A' });
    lobbyB.send({ type: 'JOIN', name: '친구B' });
    lobbyA.send({ type: 'READY' });
    lobbyB.send({ type: 'READY' });
    const [redirectA, redirectB] = await Promise.all([lobbyA.wait('REDIRECT'), lobbyB.wait('REDIRECT')]);
    assert.ok(redirectA.matchId);
    assert.equal(redirectA.matchId, redirectB.matchId);
    assert.deepEqual(new Set([redirectA.role, redirectB.role]), new Set(['p1', 'p2']));
    assert.match(redirectA.path, new RegExp(`matchId=${redirectA.matchId}`));
    assert.equal((await stale.wait('ERROR')).code, 'match_replaced');

    const openGame = async (redirect) => {
      const pageUrl = new URL(redirect.path, `http://127.0.0.1:${port}`);
      const query = new URLSearchParams(pageUrl.search);
      query.set('role', redirect.role);
      return connect(`ws://127.0.0.1:${port}/wordchain-battle/ws?${query}`);
    };
    const gameB = await openGame(redirectB);
    const gameA = await openGame(redirectA);
    sockets.push(gameA.ws, gameB.ws);
    const joinedA = await gameA.wait('JOINED');
    const joinedB = await gameB.wait('JOINED');
    assert.equal(joinedA.yourId, redirectA.role);
    assert.equal(joinedB.yourId, redirectB.role);
    gameA.send({ type: 'JOIN', name: '친구A' });
    gameB.send({ type: 'JOIN', name: '친구B' });
    const [startA, startB] = await Promise.all([gameA.wait('GAME_START'), gameB.wait('GAME_START')]);
    assert.equal(startA.players.length, 2);
    assert.equal(startB.players.length, 2);
  } finally {
    for (const ws of sockets) ws.close();
    launcher.kill();
    await new Promise((resolve) => launcher.once('exit', resolve));
  }
});
