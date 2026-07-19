/**
 * @fileoverview 베네치아 전투·아이템 동기화 회귀를 실제 2인 WebSocket으로 독립 검증한다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocket } from 'ws';
import { createApp } from '../venezia/server.js';

/** 조건을 만족하는 새 메시지를 기다린다. */
function nextMessage(client, predicate, timeoutMs = 7000) {
  const startIndex = client.cursor;
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const poll = () => {
      for (let index = startIndex; index < client.messages.length; index += 1) {
        const message = client.messages[index];
        if (predicate(message)) {
          client.cursor = index + 1;
          resolve(message);
          return;
        }
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error(`메시지 대기 시간 초과: ${client.messages.slice(-8).map((m) => m.type).join(',')}`));
        return;
      }
      setTimeout(poll, 15);
    };
    poll();
  });
}

/** 테스트 WebSocket 클라이언트를 연결한다. */
function connect(url) {
  return new Promise((resolve, reject) => {
    const client = { ws: null, messages: [], cursor: 0 };
    const ws = new WebSocket(url);
    client.ws = ws;
    ws.on('message', (data) => client.messages.push(JSON.parse(data.toString())));
    ws.once('open', () => resolve(client));
    ws.once('error', reject);
  });
}

/** 두 명이 참가한 실제 테스트 서버를 연다. */
async function openPair(options = {}) {
  const app = createApp(options);
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `ws://127.0.0.1:${server.address().port}/ws?mode=human`;
  const p1 = await connect(url);
  const p2 = await connect(url);
  p1.ws.send(JSON.stringify({ type: 'JOIN', playerName: '독립QA1' }));
  p2.ws.send(JSON.stringify({ type: 'JOIN', playerName: '독립QA2' }));
  await Promise.all([
    nextMessage(p1, (m) => m.type === 'GAME_START'),
    nextMessage(p2, (m) => m.type === 'GAME_START'),
  ]);
  return { server, p1, p2 };
}

/** 서버와 클라이언트를 안전하게 닫는다. */
async function closePair(pair) {
  pair.p1.ws.close();
  pair.p2.ws.close();
  await new Promise((resolve) => pair.server.close(resolve));
}

/** 다음 자기 단어를 정답 처리한다. */
async function clearNext(client) {
  const added = await nextMessage(client, (m) => m.type === 'WORD_ADDED', 9000);
  client.ws.send(JSON.stringify({ type: 'WORD_SUBMIT', wordId: added.word.id, text: added.word.text }));
  await nextMessage(client, (m) => m.type === 'WORD_CLEARED' && m.wordId === added.word.id);
  return added.word;
}

test('첫·중간·마지막 슬롯 사용, 거절 복구, 재지급과 상대 슬롯 격리', async (t) => {
  const defs = [
    { itemId: 'item_heal', emoji: '💚', name: '회복' },
    { itemId: 'item_shield', emoji: '🛡️', name: '방어막' },
    { itemId: 'item_dark', emoji: '🌑', name: '암흑' },
    { itemId: 'item_bomb', emoji: '🧨', name: '단어 폭탄' },
  ];
  const pair = await openPair({
    shouldSpawnWord: (id) => id === 'p1',
    rollItemDrop: (combo) => ({ dropped: true, ...defs[Math.min(combo - 1, defs.length - 1)] }),
  });
  t.after(() => closePair(pair));

  // 시작 동기화를 지난 뒤 세 번 지급받아 꽉 찬 서버 배열을 만든다.
  await nextMessage(pair.p1, (m) => m.type === 'ITEM_SLOTS_SYNC' && m.slots.length === 0);
  await nextMessage(pair.p2, (m) => m.type === 'ITEM_SLOTS_SYNC' && m.slots.length === 0);
  for (let count = 1; count <= 3; count += 1) {
    await clearNext(pair.p1);
    const sync = await nextMessage(pair.p1, (m) => m.type === 'ITEM_SLOTS_SYNC' && m.slots.length === count);
    assert.deepEqual(sync.slots.map((slot) => slot.itemId), defs.slice(0, count).map((slot) => slot.itemId));
  }
  assert.equal(pair.p2.messages.some((m) => m.type === 'ITEM_SLOTS_SYNC' && m.slots.length > 0), false);

  // 중간 슬롯을 쓰면 뒤 슬롯이 당겨지고, 잘못된 인덱스는 동일 배열로 복구된다.
  pair.p1.ws.send(JSON.stringify({ type: 'ITEM_USED', slotIndex: 1 }));
  let sync = await nextMessage(pair.p1, (m) => m.type === 'ITEM_SLOTS_SYNC' && m.slots.length === 2);
  assert.deepEqual(sync.slots.map((slot) => slot.itemId), ['item_heal', 'item_dark']);
  pair.p1.ws.send(JSON.stringify({ type: 'ITEM_USED', slotIndex: 2 }));
  sync = await nextMessage(pair.p1, (m) => m.type === 'ITEM_SLOTS_SYNC');
  assert.deepEqual(sync.slots.map((slot) => slot.itemId), ['item_heal', 'item_dark']);

  // 마지막, 첫 슬롯을 순서대로 써도 서버 배열과 완전히 일치한다.
  pair.p1.ws.send(JSON.stringify({ type: 'ITEM_USED', slotIndex: 1 }));
  sync = await nextMessage(pair.p1, (m) => m.type === 'ITEM_SLOTS_SYNC' && m.slots.length === 1);
  assert.deepEqual(sync.slots.map((slot) => slot.itemId), ['item_heal']);
  pair.p1.ws.send(JSON.stringify({ type: 'ITEM_USED', slotIndex: 0 }));
  sync = await nextMessage(pair.p1, (m) => m.type === 'ITEM_SLOTS_SYNC' && m.slots.length === 0);
  assert.deepEqual(sync.slots, []);

  // 빈 슬롯 거절 뒤에도 다음 지급과 정상 사용이 막히지 않는다.
  pair.p1.ws.send(JSON.stringify({ type: 'ITEM_USED', slotIndex: 0 }));
  await nextMessage(pair.p1, (m) => m.type === 'ITEM_SLOTS_SYNC' && m.slots.length === 0);
  await clearNext(pair.p1);
  sync = await nextMessage(pair.p1, (m) => m.type === 'ITEM_SLOTS_SYNC' && m.slots.length === 1);
  assert.equal(sync.slots[0].itemId, 'item_bomb');
  pair.p1.ws.send(JSON.stringify({ type: 'ITEM_USED', slotIndex: 0 }));
  await nextMessage(pair.p1, (m) => m.type === 'ITEM_SLOTS_SYNC' && m.slots.length === 0);
  assert.equal(pair.p2.messages.some((m) => m.type === 'ITEM_SLOTS_SYNC' && m.slots.length > 0), false);
});

test('정답 피해, 급류 중 바닥 피해와 서버 상태가 양쪽에 동일하게 반영된다', async (t) => {
  const pair = await openPair({
    rollItemDrop: () => ({ dropped: true, itemId: 'item_freeze', emoji: '🌊', name: '급류' }),
  });
  t.after(() => closePair(pair));
  await nextMessage(pair.p1, (m) => m.type === 'ITEM_SLOTS_SYNC');
  await nextMessage(pair.p2, (m) => m.type === 'ITEM_SLOTS_SYNC');

  const p2Initial = await nextMessage(pair.p2, (m) => m.type === 'WORD_ADDED', 9000);
  pair.p2.ws.send(JSON.stringify({ type: 'WORD_SUBMIT', wordId: p2Initial.word.id, text: p2Initial.word.text }));
  const clear = await nextMessage(pair.p2, (m) => m.type === 'WORD_CLEARED' && m.wordId === p2Initial.word.id);
  assert.equal(clear.attackDamage, 2);
  const clearHit = await nextMessage(pair.p1, (m) => m.type === 'HIT' && m.source === 'word_clear');
  assert.equal(clearHit.damage, 2);
  await nextMessage(pair.p2, (m) => m.type === 'ITEM_SLOTS_SYNC' && m.slots.length === 1);

  // p2의 급류가 p1에게 적용되고, 기존 p1 단어가 빨라진 서버 시계로 만료된다.
  pair.p2.ws.send(JSON.stringify({ type: 'ITEM_USED', slotIndex: 0 }));
  const start = await nextMessage(pair.p1, (m) => m.type === 'ITEM_EFFECT_START' && m.effect === 'fast_fall' && m.targetId === 'p1');
  assert.equal(start.fallSpeedMultiplier, 2);
  const missHit = await nextMessage(pair.p1, (m) => m.type === 'HIT' && m.source === 'word_missed', 9000);
  assert.ok(missHit.damage >= 2);
  assert.equal(missHit.damage % 2, 0);
  const p1State = await nextMessage(pair.p1, (m) => m.type === 'STATE' && m.players.find((p) => p.id === 'p1')?.hp <= 96);
  const p2State = await nextMessage(pair.p2, (m) => m.type === 'STATE' && m.players.find((p) => p.id === 'p1')?.hp === p1State.players.find((p) => p.id === 'p1').hp);
  assert.equal(p1State.players.find((p) => p.id === 'p2').hp, 100);
  assert.equal(p2State.players.find((p) => p.id === 'p2').hp, 100);
});

test('HP 0 종료는 양쪽에 정확히 한 번만 전송된다', async (t) => {
  const pair = await openPair({
    shouldSpawnWord: (id) => id === 'p1',
    rollItemDrop: () => ({ dropped: true, itemId: 'item_bomb', emoji: '🧨', name: '단어 폭탄' }),
  });
  t.after(() => closePair(pair));
  await nextMessage(pair.p1, (m) => m.type === 'ITEM_SLOTS_SYNC');
  await nextMessage(pair.p2, (m) => m.type === 'ITEM_SLOTS_SYNC');

  // 정답 피해와 폭탄 단어 만료를 합쳐 실제 서버 루프로 HP 0까지 진행한다.
  let over1 = null;
  while (!over1) {
    const wordOrOver = await nextMessage(pair.p1, (m) => m.type === 'WORD_ADDED' || m.type === 'GAME_OVER', 12000);
    if (wordOrOver.type === 'GAME_OVER') {
      over1 = wordOrOver;
      break;
    }
    const word = wordOrOver;
    pair.p1.ws.send(JSON.stringify({ type: 'WORD_SUBMIT', wordId: word.word.id, text: word.word.text }));
    await nextMessage(pair.p1, (m) => m.type === 'WORD_CLEARED' && m.wordId === word.word.id);
    const slot = await nextMessage(pair.p1, (m) => m.type === 'ITEM_SLOTS_SYNC' && m.slots.length === 1);
    assert.equal(slot.slots[0].itemId, 'item_bomb');
    pair.p1.ws.send(JSON.stringify({ type: 'ITEM_USED', slotIndex: 0 }));
    await nextMessage(pair.p1, (m) => m.type === 'ITEM_SLOTS_SYNC' && m.slots.length === 0);
  }
  const over2 = await nextMessage(pair.p2, (m) => m.type === 'GAME_OVER');
  assert.equal(over1.reason, 'hp_zero');
  assert.equal(over1.winner, 'p1');
  assert.deepEqual({ winner: over2.winner, reason: over2.reason }, { winner: over1.winner, reason: over1.reason });
  assert.ok(pair.p2.messages.some((m) => m.type === 'HIT' && m.source === 'word_missed' && m.damage >= 4));
  await new Promise((resolve) => setTimeout(resolve, 800));
  assert.equal(pair.p1.messages.filter((m) => m.type === 'GAME_OVER').length, 1);
  assert.equal(pair.p2.messages.filter((m) => m.type === 'GAME_OVER').length, 1);
});

test('메뉴 복귀 HTTP 신호는 상대를 포함한 양쪽에 전달된다', async (t) => {
  const pair = await openPair({ shouldSpawnWord: () => false });
  t.after(() => closePair(pair));
  const response = await fetch(`http://127.0.0.1:${pair.server.address().port}/lobby/return`, { method: 'POST' });
  assert.equal(response.status, 204);
  await Promise.all([
    nextMessage(pair.p1, (m) => m.type === 'RETURN_TO_LOBBY'),
    nextMessage(pair.p2, (m) => m.type === 'RETURN_TO_LOBBY'),
  ]);
});
