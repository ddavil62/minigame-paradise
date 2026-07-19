/**
 * @fileoverview 베네치아 정답 피해와 서버 권위 슬롯 WebSocket 프로토콜 통합 테스트.
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

test('정답 제출은 상대에게 HIT를 보내고 HP를 2 감소시킨다', async (t) => {
  const app = createApp({ shouldSpawnWord: (playerId) => playerId === 'p1' });
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
    && message.players.find((player) => player.id === 'p2')?.hp === 98
    && !message.myWords.some((word) => word.id === added.word.id)
  ));

  assert.equal(cleared.attackDamage, 2);
  const hit = await waitForMessage(second.messages, (message) => message.type === 'HIT' && message.source === 'word_clear');
  assert.equal(hit.damage, 2);
  assert.equal(first.messages.some((message) => message.type === 'HIT'), false);
  assert.equal(second.messages.filter((message) => message.type === 'HIT').length, 1);
  assert.equal(synced.players.find((player) => player.id === 'p2').hp, 98);
});

test('아이템 슬롯은 획득·사용·거절 뒤 서버 전체 배열로 동기화된다', async (t) => {
  const app = createApp({
    rollItemDrop: () => ({ dropped: true, itemId: 'item_heal', emoji: '💚', name: '회복' }),
  });
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
  await waitForMessage(first.messages, (message) => message.type === 'ITEM_SLOTS_SYNC' && message.slots.length === 1);

  first.ws.send(JSON.stringify({ type: 'ITEM_USED', slotIndex: 0 }));
  const emptied = await waitForMessage(first.messages, (message) => (
    message.type === 'ITEM_SLOTS_SYNC' && message.slots.length === 0
  ));
  assert.deepEqual(emptied.slots, []);

  const syncCount = first.messages.filter((message) => message.type === 'ITEM_SLOTS_SYNC').length;
  first.ws.send(JSON.stringify({ type: 'ITEM_USED', slotIndex: 2 }));
  await waitForMessage(first.messages, () => (
    first.messages.filter((message) => message.type === 'ITEM_SLOTS_SYNC').length > syncCount
  ));
  const latest = first.messages.filter((message) => message.type === 'ITEM_SLOTS_SYNC').at(-1);
  assert.deepEqual(latest.slots, []);
});

test('바닥에 도달한 단어는 소유자에게만 2 피해를 적용한다', async (t) => {
  const app = createApp({ shouldSpawnWord: (playerId) => playerId === 'p1' });
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

  first.ws.send(JSON.stringify({ type: 'JOIN', playerName: '낙하대상' }));
  second.ws.send(JSON.stringify({ type: 'JOIN', playerName: '정리담당' }));
  const hit = await waitForMessage(first.messages, (message) => (
    message.type === 'HIT' && message.source === 'word_missed'
  ), 12000);
  assert.equal(hit.damage, 2);
  const state = await waitForMessage(first.messages, (message) => (
    message.type === 'STATE'
    && message.players.find((player) => player.id === 'p1')?.hp === 98
  ));
  assert.equal(state.players.find((player) => player.id === 'p2').hp, 100);
});
