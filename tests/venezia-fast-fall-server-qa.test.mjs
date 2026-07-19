/**
 * @fileoverview 베네치아 급류 재사용의 실제 서버 타이머 경로 QA.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocket } from 'ws';
import { createApp } from '../venezia/server.js';

/**
 * 조건에 맞는 아직 소비하지 않은 메시지를 기다린다.
 * @param {{ message: object, receivedAt: number }[]} messages 수신 기록
 * @param {(entry:{message:object,receivedAt:number}) => boolean} predicate 조건
 * @param {Set<number>} consumed 소비한 인덱스
 * @param {number} [timeoutMs=10000] 제한 시간
 * @returns {Promise<{message:object,receivedAt:number}>} 수신 항목
 */
function waitForFresh(messages, predicate, consumed, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const poll = () => {
      const index = messages.findIndex((entry, candidate) => !consumed.has(candidate) && predicate(entry));
      if (index >= 0) {
        consumed.add(index);
        resolve(messages[index]);
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error('WS 메시지 대기 시간 초과'));
        return;
      }
      setTimeout(poll, 10);
    };
    poll();
  });
}

/**
 * JSON WebSocket 클라이언트를 연결한다.
 * @param {string} url 접속 주소
 * @returns {Promise<{ws:WebSocket,messages:{message:object,receivedAt:number}[]}>} 연결 정보
 */
function connect(url) {
  return new Promise((resolve, reject) => {
    const messages = [];
    const ws = new WebSocket(url);
    ws.on('message', (data) => messages.push({ message: JSON.parse(data.toString()), receivedAt: Date.now() }));
    ws.once('open', () => resolve({ ws, messages }));
    ws.once('error', reject);
  });
}

test('급류 재사용은 2배로 중첩되지 않고 마지막 사용부터 4초로 갱신된다', async (t) => {
  const originalRandom = Math.random;
  // 콤보 7부터 드랍 판정을 통과하고 5종 중 index 1(item_freeze)을 고른다.
  Math.random = () => 0.25;

  const app = createApp();
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const url = `ws://127.0.0.1:${address.port}/ws?mode=human`;
  const first = await connect(url);
  const second = await connect(url);
  const consumed = new Set();

  t.after(async () => {
    Math.random = originalRandom;
    first.ws.close();
    second.ws.close();
    await new Promise((resolve) => server.close(resolve));
  });

  first.ws.send(JSON.stringify({ type: 'JOIN', playerName: '급류QA' }));
  second.ws.send(JSON.stringify({ type: 'JOIN', playerName: '대상QA' }));
  await waitForFresh(first.messages, ({ message }) => message.type === 'GAME_START', consumed);

  // 두 개의 급류를 얻을 때까지 자기 단어를 정확히 제출한다.
  const grants = [];
  for (let clearedCount = 0; grants.length < 2 && clearedCount < 15; clearedCount++) {
    const added = await waitForFresh(first.messages, ({ message }) => message.type === 'WORD_ADDED', consumed);
    first.ws.send(JSON.stringify({
      type: 'WORD_SUBMIT',
      wordId: added.message.word.id,
      text: added.message.word.text,
    }));
    await waitForFresh(first.messages, ({ message }) => (
      message.type === 'WORD_CLEARED' && message.wordId === added.message.word.id
    ), consumed);
    const newGrants = first.messages
      .map((entry, index) => ({ ...entry, index }))
      .filter(({ message, index }) => message.type === 'ITEM_GRANTED' && !consumed.has(index));
    for (const grant of newGrants) {
      consumed.add(grant.index);
      grants.push(grant.message);
    }
  }

  assert.equal(grants.length, 2);
  assert.equal(grants.every((grant) => grant.itemId === 'item_freeze'), true);

  first.ws.send(JSON.stringify({ type: 'ITEM_USED', slotIndex: 0 }));
  const firstStart = await waitForFresh(first.messages, ({ message }) => (
    message.type === 'ITEM_EFFECT_START' && message.effect === 'fast_fall'
  ), consumed);
  assert.equal(firstStart.message.fallSpeedMultiplier, 2);
  assert.equal(firstStart.message.durationMs, 4000);

  await new Promise((resolve) => setTimeout(resolve, 1000));
  first.ws.send(JSON.stringify({ type: 'ITEM_USED', slotIndex: 0 }));
  const secondStart = await waitForFresh(first.messages, ({ message }) => (
    message.type === 'ITEM_EFFECT_START' && message.effect === 'fast_fall'
  ), consumed);
  assert.equal(secondStart.message.fallSpeedMultiplier, 2);
  assert.equal(secondStart.message.durationMs, 4000);

  // 첫 사용 기준 4초가 지나도 종료되지 않아야 한다(두 번째 사용이 타이머를 갱신).
  await new Promise((resolve) => setTimeout(resolve, 3200));
  assert.equal(first.messages.some(({ message, receivedAt }) => (
    message.type === 'ITEM_EFFECT_END'
    && message.effect === 'fast_fall'
    && receivedAt < secondStart.receivedAt + 3800
  )), false);

  const ended = await waitForFresh(first.messages, ({ message }) => (
    message.type === 'ITEM_EFFECT_END' && message.effect === 'fast_fall'
  ), consumed, 2000);
  const refreshedDuration = ended.receivedAt - secondStart.receivedAt;
  assert.ok(refreshedDuration >= 3800 && refreshedDuration <= 4500, `종료 지연 ${refreshedDuration}ms`);
  assert.equal(ended.message.fallSpeedMultiplier, 1);
});
