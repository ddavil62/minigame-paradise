/**
 * @fileoverview 사천성의 런처 준비 인계, 멱등 READY, AI 및 재접속 회귀를 검증한다.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { WebSocket } from 'ws';
import { createApp } from '../server.js';

/** @param {number} ms 대기 시간 @returns {Promise<void>} */
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 격리된 사천성 서버를 시작한다.
 * @param {object} [options] 앱 옵션
 * @returns {Promise<object>} 서버 픽스처
 */
async function startServer(options = {}) {
  let botUrl = '';
  const app = createApp({ testing: true, seed: 727, disconnectGraceMs: 500, ...options, getBotUrl: options.getBotUrl ?? (() => botUrl) });
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  botUrl = `ws://127.0.0.1:${port}/sichuan-battle/ws`;
  return {
    app,
    server,
    url: botUrl,
    async close() {
      app.close();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

/**
 * 메시지를 기록하는 클라이언트를 연결한다.
 * @param {string} url 연결 URL
 * @returns {Promise<object>} 클라이언트
 */
async function connect(url) {
  const socket = new WebSocket(url);
  const messages = [];
  const listeners = new Set();
  socket.on('message', (raw) => {
    messages.push(JSON.parse(raw.toString()));
    listeners.forEach((listener) => listener());
  });
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  return {
    socket,
    messages,
    waitFor(type, timeout = 5_000) {
      const found = messages.find((message) => message.type === type);
      if (found) return Promise.resolve(found);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          listeners.delete(check);
          reject(new Error(`${type} timeout`));
        }, timeout);
        /** @returns {void} */
        function check() {
          const message = messages.find((entry) => entry.type === type);
          if (!message) return;
          clearTimeout(timer);
          listeners.delete(check);
          resolve(message);
        }
        listeners.add(check);
      });
    },
  };
}

/** @param {WebSocket} socket 소켓 @returns {Promise<void>} */
async function closeSocket(socket) {
  if (socket.readyState === WebSocket.CLOSED) return;
  await new Promise((resolve) => {
    socket.once('close', resolve);
    socket.close();
  });
}

test('lobbyReady 두 명은 READY 메시지 없이 START를 정확히 한 번 받는다', async (context) => {
  const fixture = await startServer();
  const first = await connect(`${fixture.url}?name=LobbyA&lobbyReady=1`);
  const second = await connect(`${fixture.url}?name=LobbyB&lobbyReady=1`);
  context.after(() => Promise.all([closeSocket(first.socket), closeSocket(second.socket)]).then(() => fixture.close()));

  await Promise.all([first.waitFor('START'), second.waitFor('START')]);
  await delay(80);
  assert.equal(first.messages.filter((message) => message.type === 'START').length, 1);
  assert.equal(second.messages.filter((message) => message.type === 'START').length, 1);
});

test('직접 진입은 수동 READY가 필요하고 중복 READY가 준비를 취소하지 않는다', async (context) => {
  const fixture = await startServer();
  const first = await connect(`${fixture.url}?name=DirectA`);
  const second = await connect(`${fixture.url}?name=DirectB`);
  context.after(() => Promise.all([closeSocket(first.socket), closeSocket(second.socket)]).then(() => fixture.close()));

  await delay(80);
  assert.equal(first.messages.some((message) => message.type === 'START'), false);
  first.socket.send(JSON.stringify({ type: 'READY' }));
  first.socket.send(JSON.stringify({ type: 'READY' }));
  await delay(80);
  assert.equal(first.messages.some((message) => message.type === 'START'), false);
  second.socket.send(JSON.stringify({ type: 'READY' }));
  await Promise.all([first.waitFor('START'), second.waitFor('START')]);
  first.socket.send(JSON.stringify({ type: 'READY' }));
  await delay(80);
  assert.equal(first.messages.filter((message) => message.type === 'START').length, 1);
});

test('런처 AI 인계는 사람의 추가 READY 없이 AI 합류 뒤 시작한다', async (context) => {
  const fixture = await startServer();
  const staleToken = 'expired-launcher-session-token';
  const human = await connect(`${fixture.url}?name=LobbyAI&lobbyReady=1&sessionToken=${staleToken}`);
  context.after(() => closeSocket(human.socket).then(() => fixture.close()));

  const joined = await human.waitFor('JOINED');
  assert.equal(joined.reconnected, false);
  assert.notEqual(joined.sessionToken, staleToken);
  human.socket.send(JSON.stringify({ type: 'REQUEST_AI' }));
  const start = await human.waitFor('START', 8_000);
  assert.equal(start.snapshot.opponent?.isBot, true);
  await delay(80);
  assert.equal(human.messages.filter((message) => message.type === 'START').length, 1);
});

test('진행 중 재접속은 준비 재요구나 새 START 없이 기존 경기를 복원한다', async (context) => {
  const fixture = await startServer();
  const first = await connect(`${fixture.url}?name=ResumeA&lobbyReady=1`);
  const second = await connect(`${fixture.url}?name=ResumeB&lobbyReady=1`);
  const joined = await first.waitFor('JOINED');
  const started = await first.waitFor('START');
  await second.waitFor('START');
  const sockets = [first.socket, second.socket];
  context.after(() => Promise.all(sockets.map(closeSocket)).then(() => fixture.close()));

  await closeSocket(first.socket);
  const resumed = await connect(`${fixture.url}?name=Ignored&sessionToken=${encodeURIComponent(joined.sessionToken)}&lobbyReady=1`);
  sockets.push(resumed.socket);
  const resumedJoined = await resumed.waitFor('JOINED');
  const state = await resumed.waitFor('STATE_SYNC');
  assert.equal(resumedJoined.reconnected, true);
  assert.equal(state.snapshot.matchId, started.snapshot.matchId);
  assert.equal(resumed.messages.some((message) => message.type === 'START'), false);
});
