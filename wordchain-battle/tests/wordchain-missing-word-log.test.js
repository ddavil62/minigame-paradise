import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { WebSocket } from 'ws';
import { createMissingWordLogger } from '../missing-word-log.js';
import { createApp } from '../server.js';

test('사전에 없는 한글 후보를 날짜별 JSONL에 정규화해 기록한다', async (t) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wordchain-missing-'));
  t.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  const logger = createMissingWordLogger({
    directory: temporaryRoot,
    now: () => new Date('2026-08-14T03:04:05.000Z'),
  });

  const written = await logger.log({
    word: '가상단어',
    expectedStart: '가',
    acceptedStartChars: ['가', '가', '나', 'x'],
    previousWord: '국가',
    playerMode: 'human',
  });
  assert.equal(written, true);

  const names = await fs.readdir(temporaryRoot);
  assert.deepEqual(names, ['wordchain-missing-2026-08-14.jsonl']);
  const record = JSON.parse(await fs.readFile(path.join(temporaryRoot, names[0]), 'utf8'));
  assert.deepEqual(record, {
    timestamp: '2026-08-14T03:04:05.000Z',
    word: '가상단어',
    expectedStart: '가',
    acceptedStartChars: ['가', '나'],
    previousWord: '국가',
    playerMode: 'human',
  });
});

test('비한글·한 글자·과도하게 긴 입력은 후보 로그에 쓰지 않는다', async () => {
  let appendCount = 0;
  const logger = createMissingWordLogger({
    appendFile: async () => { appendCount += 1; },
    mkdir: async () => undefined,
  });
  assert.equal(await logger.log({ word: 'abc' }), false);
  assert.equal(await logger.log({ word: '가' }), false);
  assert.equal(await logger.log({ word: '가'.repeat(31) }), false);
  assert.equal(appendCount, 0);
});

test('서버는 사전 미등재 한글만 경기·플레이어별 한 번 기록한다', async (t) => {
  const records = [];
  const app = createApp({
    missingWordLogger: { log: async (record) => { records.push(record); return true; } },
  });
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  async function connect(name) {
    const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws`);
    const queue = [];
    const waiters = [];
    ws.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      const index = waiters.findIndex((waiter) => waiter.type === message.type);
      if (index >= 0) waiters.splice(index, 1)[0].resolve(message);
      else queue.push(message);
    });
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    const client = {
      ws,
      wait(type) {
        const index = queue.findIndex((message) => message.type === type);
        if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0]);
        return new Promise((resolve) => waiters.push({ type, resolve }));
      },
    };
    await client.wait('JOINED');
    ws.send(JSON.stringify({ type: 'JOIN', name }));
    return client;
  }

  const a = await connect('기록A');
  const b = await connect('기록B');
  t.after(async () => {
    a.ws.terminate();
    b.ws.terminate();
    await new Promise((resolve) => server.close(resolve));
  });
  await Promise.all([a.wait('PLAYING'), b.wait('PLAYING')]);
  const state = await a.wait('STATE');
  const actor = state.turn === 'p1' ? a : b;
  const missingWord = '가상미등재어';
  actor.ws.send(JSON.stringify({ type: 'WORD_SUBMIT', word: missingWord }));
  await actor.wait('WORD_REJECTED');
  actor.ws.send(JSON.stringify({ type: 'WORD_SUBMIT', word: missingWord }));
  await actor.wait('WORD_REJECTED');
  actor.ws.send(JSON.stringify({ type: 'WORD_SUBMIT', word: 'not-korean' }));
  await actor.wait('WORD_REJECTED');
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(records.length, 1);
  assert.equal(records[0].word, missingWord);
  assert.equal(records[0].previousWord, null);
  assert.equal(records[0].playerMode, 'human');
});
