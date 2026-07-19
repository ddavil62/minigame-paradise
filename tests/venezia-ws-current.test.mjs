/**
 * @fileoverview 베네치아 정답 무피해 WebSocket 프로토콜 통합 테스트.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocket } from 'ws';
import { createApp } from '../venezia/server.js';

/**
 * 조건을 만족하는 메시지가 도착할 때까지 기다린다.
 * @param {object[]} messages 수신 메시지 배열
 * @param {(message:object) => boolean} predicate 판정 함수
 * @param {number} [timeoutMs=5000] 제한 시간
 * @returns {Promise<object>} 일치 메시지
 */
function waitForMessage(messages, predicate, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const poll = () => {
      const found = messages.find(predicate);
      if (found) return resolve(found);
      if (Date.now() - startedAt >= timeoutMs) return reject(new Error('WS 메시지 대기 시간 초과'));
      setTimeout(poll, 20);
    };
    poll();
  });
}

/**
 * WebSocket 연결을 열고 모든 JSON 메시지를 배열에 기록한다.
 * @param {string} url 접속 URL
 * @returns {Promise<{ws:WebSocket,messages:object[]}>} 연결과 메시지 배열
 */
function connectClient(url) {
  return new Promise((resolve, reject) => {
    const messages = [];
    const ws = new WebSocket(url);
    ws.on('message', (data) => messages.push(JSON.parse(data.toString())));
    ws.once('open', () => resolve({ ws, messages }));
    ws.once('error', reject);
  });
}

test('정답 제출은 WORD_CLEARED만 보내고 HIT·HP 감소를 만들지 않는다', async (t) => {
  const app = createApp();
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const url = `ws://127.0.0.1:${address.port}/ws?mode=human`;
  const first = await connectClient(url);
  const second = await connectClient(url);

  t.after(async () => {
    first.ws.close();
    second.ws.close();
    await new Promise((resolve) => server.close(resolve));
  });

  first.ws.send(JSON.stringify({ type: 'JOIN', playerName: '첫째' }));
  second.ws.send(JSON.stringify({ type: 'JOIN', playerName: '둘째' }));
  await waitForMessage(first.messages, (message) => message.type === 'GAME_START');
  const added = await waitForMessage(first.messages, (message) => message.type === 'WORD_ADDED');
  first.ws.send(JSON.stringify({ type: 'WORD_SUBMIT', wordId: added.word.id, text: added.word.text }));

  const cleared = await waitForMessage(first.messages, (message) => message.type === 'WORD_CLEARED');
  await waitForMessage(second.messages, (message) => message.type === 'OPP_WORD_CLEARED');
  const synced = await waitForMessage(first.messages, (message) => (
    message.type === 'STATE' && Array.isArray(message.players)
    && message.players.every((player) => player.hp === 100)
    && !message.myWords.some((word) => word.id === added.word.id)
  ));

  assert.equal('attackDamage' in cleared, false);
  assert.equal(first.messages.some((message) => message.type === 'HIT'), false);
  assert.equal(second.messages.some((message) => message.type === 'HIT'), false);
  assert.equal(synced.players.every((player) => player.hp === 100), true);
});
