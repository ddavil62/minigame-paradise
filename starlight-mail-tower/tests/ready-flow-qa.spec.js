/**
 * @fileoverview 별빛 우편탑 로비 준비 전달, 종료 세션 정리, 재접속 유예를 독립 검증한다.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { createApp } from '../server.js';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * 사용 가능한 로컬 TCP 포트를 찾는다.
 * @returns {Promise<number>} 사용 가능한 포트
 */
async function findFreePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  await new Promise((resolve) => server.close(resolve));
  return address.port;
}

/**
 * 지정 시간만큼 기다린다.
 * @param {number} ms 대기 밀리초
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * WebSocket 연결과 메시지 수신 큐를 만든다.
 * @param {string} url 연결 주소
 * @returns {Promise<object>} 테스트 클라이언트
 */
async function connectClient(url) {
  const ws = new WebSocket(url);
  const messages = [];
  const waiters = new Set();
  ws.on('message', (raw) => {
    messages.push(JSON.parse(raw.toString()));
    for (const waiter of waiters) waiter();
  });
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  return {
    ws,
    messages,
    waitFor(type, timeoutMs = 2_000) {
      const existing = messages.find((message) => message.type === type);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          waiters.delete(check);
          reject(new Error(`${type} 메시지 대기 시간 초과`));
        }, timeoutMs);
        /** @returns {void} */
        function check() {
          const message = messages.find((entry) => entry.type === type);
          if (!message) return;
          clearTimeout(timeout);
          waiters.delete(check);
          resolve(message);
        }
        waiters.add(check);
      });
    },
  };
}

/**
 * 소켓의 close 이벤트까지 기다린다.
 * @param {WebSocket} ws 종료할 소켓
 * @returns {Promise<void>}
 */
function closeClient(ws) {
  if (ws.readyState === WebSocket.CLOSED) return Promise.resolve();
  return new Promise((resolve) => {
    ws.once('close', resolve);
    ws.close();
  });
}

/**
 * 격리된 별빛 우편탑 서버를 시작한다.
 * @param {object} options createApp 옵션
 * @returns {Promise<object>} 서버 제어 객체
 */
async function startGameServer(options = {}) {
  const recordsPath = path.join(os.tmpdir(), `starlight-ready-qa-${process.pid}-${Date.now()}-${Math.random()}.json`);
  const app = createApp({ ...options, recordsPath });
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return {
    app,
    url: `ws://127.0.0.1:${address.port}/ws`,
    async close() {
      app.close();
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(recordsPath, { force: true });
    },
  };
}

/**
 * 두 참가자를 JOIN시키고 필요하면 로비 준비 상태를 함께 전달한다.
 * @param {string} url WebSocket 주소
 * @param {boolean} readyFromLobby 로비 준비 여부
 * @param {string} prefix 이름 접두사
 * @returns {Promise<Array<object>>} 두 클라이언트
 */
async function joinPair(url, readyFromLobby, prefix) {
  const first = await connectClient(url);
  const second = await connectClient(url);
  first.ws.send(JSON.stringify({ type: 'JOIN', name: `${prefix}-1`, locale: 'ko', readyFromLobby }));
  second.ws.send(JSON.stringify({ type: 'JOIN', name: `${prefix}-2`, locale: 'ko', readyFromLobby }));
  await Promise.all([first.waitFor('WELCOME'), second.waitFor('WELCOME')]);
  return [first, second];
}

test('런처 실서버는 별빛 우편탑 AI 채우기를 mode=ai로 보내고 레거시 봇을 spawn하지 않는다', async (t) => {
  const port = await findFreePort();
  let output = '';
  const child = spawn(process.execPath, ['launcher/server.js', '--port', String(port)], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  t.after(() => { if (!child.killed) child.kill(); });

  const deadline = Date.now() + 10_000;
  while (!output.includes('games.json 캐시') && Date.now() < deadline) await delay(25);
  assert.match(output, /games\.json 캐시/);

  const client = await connectClient(`ws://127.0.0.1:${port}/lobby/ws?gameId=starlight-mail-tower`);
  t.after(() => client.ws.terminate());
  client.ws.send(JSON.stringify({ type: 'JOIN', name: 'AI-QA' }));
  client.ws.send(JSON.stringify({ type: 'READY' }));
  client.ws.send(JSON.stringify({ type: 'FILL_WITH_AI' }));
  const redirect = await client.waitFor('REDIRECT');
  assert.equal(redirect.gameId, 'starlight-mail-tower');
  assert.equal(redirect.mode, 'ai');
  assert.equal(redirect.playerCount, 2);
  await delay(100);
  assert.doesNotMatch(output, /AI채우기 봇 기동: starlight-mail-tower/);
});

test('양측 readyFromLobby JOIN은 추가 READY 없이 START를 정확히 한 번 보낸다', async (t) => {
  const game = await startGameServer();
  t.after(() => game.close());
  const pair = await joinPair(game.url, true, 'lobby');
  t.after(() => Promise.all(pair.map((client) => closeClient(client.ws))));

  await Promise.all(pair.map((client) => client.waitFor('START')));
  await delay(80);
  for (const client of pair) assert.equal(client.messages.filter((message) => message.type === 'START').length, 1);

  // 시작 이후 READY 연타는 오류만 반환하며 START를 재발생시키지 않아야 한다.
  for (let index = 0; index < 3; index += 1) pair[0].ws.send(JSON.stringify({ type: 'READY' }));
  await delay(80);
  for (const client of pair) assert.equal(client.messages.filter((message) => message.type === 'START').length, 1);
});

test('직접 접속은 양측 수동 READY 전까지 시작하지 않는다', async (t) => {
  const game = await startGameServer();
  t.after(() => game.close());
  const pair = await joinPair(game.url, false, 'direct');
  t.after(() => Promise.all(pair.map((client) => closeClient(client.ws))));

  await delay(100);
  assert.equal(pair[0].messages.some((message) => message.type === 'START'), false);
  pair[0].ws.send(JSON.stringify({ type: 'READY' }));
  await delay(100);
  assert.equal(pair[0].messages.some((message) => message.type === 'START'), false);
  pair[1].ws.send(JSON.stringify({ type: 'READY' }));
  await Promise.all(pair.map((client) => client.waitFor('START')));
});

test('엇갈린 disconnect 예약은 독립 만료되고 마지막 만료 뒤 새 2인 세션이 시작한다', async (t) => {
  const graceMs = 300;
  const game = await startGameServer({ reconnectGraceMs: graceMs });
  t.after(() => game.close());
  const firstPair = await joinPair(game.url, true, 'old');
  await Promise.all(firstPair.map((client) => client.waitFor('START')));

  await closeClient(firstPair[0].ws);
  await delay(150);
  await closeClient(firstPair[1].ws);

  // 첫 예약은 만료됐지만 두 번째 예약이 살아 있는 구간에는 ended 상태를 보존한다.
  await delay(190);
  assert.equal(game.app.getSimulation().phase, 'ended');

  // 두 번째 예약까지 만료된 뒤에만 새 waiting 시뮬레이션으로 초기화한다.
  await delay(170);
  assert.equal(game.app.getSimulation().phase, 'waiting');

  const secondPair = await joinPair(game.url, true, 'new');
  t.after(() => Promise.all(secondPair.map((client) => closeClient(client.ws))));
  await Promise.all(secondPair.map((client) => client.waitFor('START')));
  for (const client of secondPair) assert.equal(client.messages.filter((message) => message.type === 'START').length, 1);
});

test('재접속 유예 안의 토큰 재접속은 역할과 진행 상태를 보존한다', async (t) => {
  const game = await startGameServer({ reconnectGraceMs: 500 });
  t.after(() => game.close());
  const pair = await joinPair(game.url, true, 'resume');
  const welcomes = await Promise.all(pair.map((client) => client.waitFor('WELCOME')));
  await Promise.all(pair.map((client) => client.waitFor('START')));
  const firstRole = welcomes[0].playerId;
  const firstToken = welcomes[0].resumeToken;
  game.app.getSimulation().players.find((player) => player.id === firstRole).x = 777;

  await closeClient(pair[0].ws);
  const pauseDeadline = Date.now() + 1_000;
  while (game.app.getSimulation().phase !== 'paused' && Date.now() < pauseDeadline) await delay(10);
  assert.equal(game.app.getSimulation().phase, 'paused');
  await delay(120);

  const resumed = await connectClient(game.url);
  t.after(() => closeClient(resumed.ws));
  resumed.ws.send(JSON.stringify({ type: 'JOIN', name: 'resume-return', locale: 'ko', sessionToken: firstToken }));
  const resumedWelcome = await resumed.waitFor('WELCOME');
  const snapshot = await resumed.waitFor('SNAPSHOT');
  assert.equal(resumedWelcome.resumed, true);
  assert.equal(resumedWelcome.playerId, firstRole);
  assert.equal(snapshot.players.find((player) => player.id === firstRole).x, 777);
  assert.equal(game.app.getSimulation().phase, 'playing');
  assert.equal(resumed.messages.filter((message) => message.type === 'START').length, 0);
});

test('알 수 없는 이전 토큰은 슬롯을 점유하지 않고 이후 빈 토큰 2인이 정상 시작한다', async (t) => {
  const game = await startGameServer({ reconnectGraceMs: 500 });
  t.after(() => game.close());
  const stale = await connectClient(game.url);
  t.after(() => closeClient(stale.ws));

  stale.ws.send(JSON.stringify({
    type: 'JOIN',
    name: 'stale-tab',
    locale: 'ko',
    sessionToken: 'token-from-previous-server-process',
    readyFromLobby: true,
  }));
  const error = await stale.waitFor('ERROR');
  assert.equal(error.code, 'RESUME_EXPIRED');
  assert.equal(stale.messages.some((message) => message.type === 'WELCOME'), false);
  await closeClient(stale.ws);

  const freshPair = await joinPair(game.url, true, 'fresh');
  t.after(() => Promise.all(freshPair.map((client) => closeClient(client.ws))));
  const welcomes = await Promise.all(freshPair.map((client) => client.waitFor('WELCOME')));
  assert.deepEqual(new Set(welcomes.map((message) => message.playerId)), new Set(['p1', 'p2']));
  await Promise.all(freshPair.map((client) => client.waitFor('START')));
  assert.equal(game.app.getSimulation().phase, 'playing');
});

test('mode=ai 진입은 게임 서버 봇과 START하고 세션당 START는 한 번뿐이다', async (t) => {
  let botUrl = '';
  const game = await startGameServer({ getBotUrl: () => botUrl });
  botUrl = game.url;
  t.after(() => game.close());
  const human = await connectClient(`${game.url}?mode=ai`);
  t.after(() => closeClient(human.ws));
  human.ws.send(JSON.stringify({ type: 'JOIN', name: 'human-ai', locale: 'ko', readyFromLobby: true }));
  await human.waitFor('WELCOME');
  await human.waitFor('START', 5_000);
  await delay(150);
  assert.equal(human.messages.filter((message) => message.type === 'START').length, 1);
  assert.equal(game.app.getSimulation().phase, 'playing');
});
