import assert from 'node:assert/strict';
import { WebSocket } from 'ws';

const publicUrl = process.env.TEST_PUBLIC_URL;
const password = process.env.TEST_PASSWORD;

assert.ok(publicUrl?.startsWith('https://'), 'TEST_PUBLIC_URL must be an HTTPS URL');
assert.ok(password, 'TEST_PASSWORD is required');

const unauthenticated = await fetch(`${publicUrl}/`, { redirect: 'manual' });
assert.equal(unauthenticated.status, 303);
assert.match(unauthenticated.headers.get('location') || '', /^\/_auth\/login/);

const login = await fetch(`${publicUrl}/_auth/login`, {
  method: 'POST',
  redirect: 'manual',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ password, remember: '1', next: '/' }),
});
assert.equal(login.status, 303);
const setCookie = login.headers.get('set-cookie') || '';
assert.match(setCookie, /minigame_session=/);
assert.match(setCookie, /HttpOnly/i);
assert.match(setCookie, /Secure/i);
assert.match(setCookie, /SameSite=Strict/i);
assert.match(setCookie, /Max-Age=2592000/i);
const cookie = setCookie.split(';', 1)[0];

const connectionInfo = await fetch(`${publicUrl}/connection-info`, {
  headers: { cookie },
});
assert.equal(connectionInfo.status, 200);
assert.equal(connectionInfo.headers.get('cache-control'), 'no-store');
assert.deepEqual(await connectionInfo.json(), { publicUrl });

function openPresence(sessionCookie) {
  const url = new URL('/presence/ws', publicUrl);
  url.protocol = 'wss:';
  const socket = new WebSocket(url, {
    headers: { Cookie: sessionCookie, Origin: publicUrl },
  });
  socket.messageQueue = [];
  socket.messageWaiters = [];
  socket.on('message', (data) => {
    const message = JSON.parse(data.toString());
    const waiterIndex = socket.messageWaiters.findIndex(({ predicate }) => predicate(message));
    if (waiterIndex >= 0) {
      const [{ resolve, timer }] = socket.messageWaiters.splice(waiterIndex, 1);
      clearTimeout(timer);
      resolve(message);
    } else {
      socket.messageQueue.push(message);
    }
  });
  return new Promise((resolve, reject) => {
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}

function waitForMessage(socket, predicate, label = 'WebSocket message') {
  const queuedIndex = socket.messageQueue.findIndex(predicate);
  if (queuedIndex >= 0) return Promise.resolve(socket.messageQueue.splice(queuedIndex, 1)[0]);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), 10_000);
    socket.messageWaiters.push({ predicate, resolve, timer });
  });
}

function waitForPresence(socket, predicate) {
  return waitForMessage(socket, (message) => message.type === 'PRESENCE_STATE' && predicate(message), 'Presence state');
}

const firstPresence = await openPresence(cookie);
const firstName = `qa-${process.pid}`;
firstPresence.send(JSON.stringify({ type: 'PRESENCE_UPDATE', name: firstName, status: 'lobby' }));
const firstState = await waitForPresence(firstPresence, (state) =>
  state.users.some((user) => user.name === firstName && user.status === 'lobby')
);
const countWithFirstSession = firstState.count;

const duplicateTab = await openPresence(cookie);
duplicateTab.send(JSON.stringify({ type: 'PRESENCE_UPDATE', name: firstName, status: 'playing', gameId: 'matgo' }));
const deduplicated = await waitForPresence(firstPresence, (state) =>
  state.count === countWithFirstSession
    && state.users.some((user) => user.name === firstName && user.status === 'playing')
);
assert.equal(deduplicated.users.find((user) => user.name === firstName)?.gameId, 'matgo');

const secondLogin = await fetch(`${publicUrl}/_auth/login`, {
  method: 'POST',
  redirect: 'manual',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ password, remember: '1', next: '/' }),
});
const secondCookie = (secondLogin.headers.get('set-cookie') || '').split(';', 1)[0];
const secondPresence = await openPresence(secondCookie);
const secondName = `qb-${process.pid}`;
secondPresence.send(JSON.stringify({ type: 'PRESENCE_UPDATE', name: secondName, status: 'waiting', gameId: 'yutnori' }));
const twoUsers = await waitForPresence(firstPresence, (state) =>
  state.count === countWithFirstSession + 1
    && state.users.some((user) => user.name === secondName)
);
assert.equal(twoUsers.users.find((user) => user.name === secondName)?.status, 'waiting');

const firstId = twoUsers.users.find((user) => user.name === firstName)?.id;
const secondId = twoUsers.users.find((user) => user.name === secondName)?.id;
assert.ok(firstId && secondId);
firstPresence.send(JSON.stringify({ type: 'CHAT_SEND', to: secondId, text: '통합 채팅 테스트' }));
const receivedChat = await waitForMessage(secondPresence, (message) =>
  message.type === 'CHAT_MESSAGE'
    && message.message?.from === firstId
    && message.message?.to === secondId
, 'Chat delivery');
assert.equal(receivedChat.message.text, '통합 채팅 테스트');

secondPresence.send(JSON.stringify({ type: 'CHAT_HISTORY_REQUEST', with: firstId }));
const chatHistory = await waitForMessage(secondPresence, (message) =>
  message.type === 'CHAT_HISTORY' && message.with === firstId
, 'Chat history');
assert.equal(chatHistory.messages.at(-1)?.text, '통합 채팅 테스트');

secondPresence.close();
await waitForPresence(firstPresence, (state) =>
  state.count === countWithFirstSession && !state.users.some((user) => user.name === secondName)
);
duplicateTab.close();
firstPresence.close();

const wsUrl = new URL('/lobby/ws?gameId=matgo', publicUrl);
wsUrl.protocol = 'wss:';
await new Promise((resolve, reject) => {
  const socket = new WebSocket(wsUrl, {
    headers: { Cookie: cookie, Origin: publicUrl },
  });
  const timer = setTimeout(() => {
    socket.terminate();
    reject(new Error('WSS connection timed out'));
  }, 10_000);
  socket.once('open', () => {
    clearTimeout(timer);
    socket.close();
    resolve();
  });
  socket.once('error', (error) => {
    clearTimeout(timer);
    reject(error);
  });
});

console.log('Trusted public HTTPS + auth + invite API + presence + private chat + WSS PASS');
