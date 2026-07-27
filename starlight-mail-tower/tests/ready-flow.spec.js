/**
 * @fileoverview 런처 준비 상태 전달과 종료 세션 재사용 회귀를 검증한다.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { createApp } from '../server.js';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * WebSocket 연결과 수신 메시지 큐를 만든다.
 * @param {string} url 연결 URL
 * @returns {Promise<{ws:WebSocket,messages:Array<object>,waitFor:(type:string,timeoutMs?:number)=>Promise<object>}>}
 */
async function connectClient(url) {
  const ws = new WebSocket(url);
  const messages = [];
  const waiters = new Set();
  ws.on('message', (raw) => {
    const message = JSON.parse(raw.toString());
    messages.push(message);
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
 * WebSocket을 닫고 close 이벤트까지 기다린다.
 * @param {WebSocket} ws 대상 소켓
 * @returns {Promise<void>}
 */
function closeClient(ws) {
  if (ws.readyState === WebSocket.CLOSED) return Promise.resolve();
  return new Promise((resolve) => {
    ws.once('close', resolve);
    ws.close();
  });
}

test('별빛 우편탑 AI 채우기는 런처 봇 대신 mode=ai를 전달한다', () => {
  const launcherSource = fs.readFileSync(path.join(PROJECT_ROOT, 'launcher', 'server.js'), 'utf8');
  assert.match(launcherSource, /GAME_MANAGED_AI_IDS\s*=\s*new Set\(\[['"]sichuan-battle['"],\s*['"]starlight-mail-tower['"]\]\)/);
  assert.match(launcherSource, /mode:\s*usesGameManagedAi\s*\?\s*['"]ai['"]\s*:\s*['"]human['"]/);
  assert.match(launcherSource, /game\.botAvailable\s*&&\s*!usesGameManagedAi/);
});

test('로비 준비 2명은 즉시 시작하고 종료 유예 만료 뒤 다음 세션도 시작한다', async (t) => {
  const recordsPath = path.join(os.tmpdir(), `starlight-ready-flow-${process.pid}-${Date.now()}.json`);
  const app = createApp({ reconnectGraceMs: 40, recordsPath });
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    app.close();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(recordsPath, { force: true });
  });

  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const url = `ws://127.0.0.1:${address.port}/ws`;

  /** @param {string} prefix 접속자 이름 접두사 @returns {Promise<Array<Awaited<ReturnType<typeof connectClient>>>>} */
  async function startLobbyPair(prefix) {
    const first = await connectClient(url);
    const second = await connectClient(url);
    first.ws.send(JSON.stringify({ type: 'JOIN', name: `${prefix}-1`, locale: 'ko', readyFromLobby: true }));
    second.ws.send(JSON.stringify({ type: 'JOIN', name: `${prefix}-2`, locale: 'ko', readyFromLobby: true }));
    await Promise.all([first.waitFor('WELCOME'), second.waitFor('WELCOME')]);
    await Promise.all([first.waitFor('START'), second.waitFor('START')]);
    assert.equal(first.messages.filter((message) => message.type === 'START').length, 1);
    assert.equal(second.messages.filter((message) => message.type === 'START').length, 1);
    return [first, second];
  }

  const firstPair = await startLobbyPair('first');
  await Promise.all(firstPair.map((client) => closeClient(client.ws)));
  await new Promise((resolve) => setTimeout(resolve, 120));

  const secondPair = await startLobbyPair('second');
  assert.equal(app.getSimulation().phase, 'playing');
  await Promise.all(secondPair.map((client) => closeClient(client.ws)));
});
