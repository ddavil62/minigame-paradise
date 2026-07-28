/**
 * @fileoverview 매치 JSONL 로그의 스키마·순서·회전·보존·비차단 실패를 검증한다.
 */

import { test, expect } from '@playwright/test';
import { promises as fs } from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { WebSocket } from 'ws';
import { MatchLogger } from '../match-log.js';
import { createApp } from '../server.js';

const temporaryDirectories = [];

/**
 * 격리된 임시 로그 디렉터리를 만든다.
 *
 * @returns {Promise<string>}
 */
async function makeTemporaryDirectory() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'matgo-log-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

/**
 * 디렉터리 안의 모든 JSONL 엔트리를 파일명 순으로 읽는다.
 *
 * @param {string} directory
 * @returns {Promise<object[]>}
 */
async function readEntries(directory) {
  const names = (await fs.readdir(directory)).filter((name) => name.endsWith('.jsonl')).sort();
  const entries = [];
  for (const name of names) {
    const text = await fs.readFile(path.join(directory, name), 'utf8');
    entries.push(...text.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)));
  }
  return entries;
}

/**
 * WebSocket에서 조건에 맞는 JSON 메시지를 기다린다.
 *
 * @param {WebSocket} socket
 * @param {(message:object) => boolean} predicate
 * @returns {Promise<object>}
 */
function waitForMessage(socket, predicate) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', onMessage);
      reject(new Error('WebSocket 메시지 대기 시간 초과'));
    }, 5000);
    /**
     * 수신 JSON을 판정한다.
     *
     * @param {Buffer} data
     * @returns {void}
     */
    function onMessage(data) {
      const message = JSON.parse(data.toString());
      if (!predicate(message)) return;
      clearTimeout(timer);
      socket.off('message', onMessage);
      resolve(message);
    }
    socket.on('message', onMessage);
  });
}

/**
 * WebSocket 연결 완료를 기다린다.
 *
 * @param {WebSocket} socket
 * @returns {Promise<void>}
 */
function waitForOpen(socket) {
  return new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
}

test.afterEach(async () => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('#43 정상 매치는 match/round/turn/batch 문맥과 단조 seq를 순서대로 기록한다', async () => {
  const directory = await makeTemporaryDirectory();
  const logger = new MatchLogger({ directory });
  const matchId = logger.startMatch({ mode: 'human', name: '기록 금지 이름' });
  const roundId = logger.startRound({ firstTurn: 'p1' });
  await logger.log('PLAYER_INPUT', {
    actor: 'p1',
    turnId: 'p1-1',
    phase: 'awaiting_play',
    payload: { type: 'PLAY_CARD', cardId: 'm01_gwang', ip: '192.0.2.1' },
  });
  await logger.log('ACTION_STEP', {
    actor: 'p1',
    turnId: 'p1-1',
    phase: 'awaiting_play',
    payload: { step: 'deck_flipped', cardId: 'm02_pi_a' },
  });
  await logger.log('CAPTURE_SETTLED', {
    actor: 'p1',
    turnId: 'p1-1',
    batchId: 'p1-1:settle',
    stateVersion: 4,
    phase: 'awaiting_play',
    payload: { cardIds: ['m01_gwang', 'm01_tti_hong'] },
  });
  await logger.log('SCORE_EVALUATED', {
    actor: 'system',
    payload: { settlementType: 'normal', finalScore: 7 },
  });
  await logger.endMatch('completed', { winner: 'p1' });
  await logger.flush();

  const entries = await readEntries(directory);
  expect(entries.map((entry) => entry.event)).toEqual([
    'MATCH_START',
    'ROUND_START',
    'PLAYER_INPUT',
    'ACTION_STEP',
    'CAPTURE_SETTLED',
    'SCORE_EVALUATED',
    'MATCH_END',
  ]);
  expect(entries.map((entry) => entry.seq)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  expect(new Set(entries.map((entry) => entry.matchId))).toEqual(new Set([matchId]));
  expect(entries.slice(1).every((entry) => entry.roundId === roundId)).toBe(true);
  expect(entries[4]).toMatchObject({
    turnId: 'p1-1',
    batchId: 'p1-1:settle',
    stateVersion: 4,
  });
  const serialized = JSON.stringify(entries);
  expect(serialized).not.toContain('기록 금지 이름');
  expect(serialized).not.toContain('192.0.2.1');
});

test('#43 중도 종료와 오류도 같은 매치 문맥에 안전한 정보만 기록한다', async () => {
  const directory = await makeTemporaryDirectory();
  const logger = new MatchLogger({ directory });
  const matchId = logger.startMatch();
  logger.startRound();
  await logger.log('INPUT_REJECTED', {
    actor: 'p2',
    phase: 'awaiting_play',
    payload: { code: 'INVALID_PHASE', message: '지금은 낼 수 없다', raw: '{"name":"secret"}' },
  });
  await logger.log('ERROR', {
    actor: 'system',
    payload: { code: 'WS_ERROR', message: 'connection reset', stack: 'secret stack' },
  });
  await logger.endMatch('interrupted', { actor: 'p2', reasonCode: 'PLAYER_LEFT' });
  await logger.flush();

  const entries = await readEntries(directory);
  expect(entries.at(-1)).toMatchObject({
    matchId,
    event: 'MATCH_END',
    payload: { outcome: 'interrupted', actor: 'p2', reasonCode: 'PLAYER_LEFT' },
  });
  expect(entries.find((entry) => entry.event === 'ERROR').payload).toEqual({
    code: 'WS_ERROR',
    message: 'connection reset',
  });
  expect(JSON.stringify(entries)).not.toContain('secret');
});

test('#43 날짜 변경과 파일 상한에서 활성 JSONL을 순차 회전한다', async () => {
  const directory = await makeTemporaryDirectory();
  let current = new Date('2026-07-29T12:00:00.000Z');
  const logger = new MatchLogger({
    directory,
    maxFileBytes: 500,
    now: () => current,
  });
  logger.startMatch();
  for (let index = 0; index < 12; index++) {
    await logger.log('ACTION_STEP', {
      actor: 'p1',
      payload: { index, cardId: `m${String(index + 1).padStart(2, '0')}_pi_a` },
    });
  }
  current = new Date('2026-07-30T00:00:01.000Z');
  await logger.log('PHASE_CHANGED', { payload: { from: 'awaiting_play', to: 'round_end' } });
  await logger.flush();

  const names = (await fs.readdir(directory)).filter((name) => name.endsWith('.jsonl')).sort();
  expect(names.some((name) => /^matgo-2026-07-29\.\d+\.jsonl$/.test(name))).toBe(true);
  expect(names).toContain('matgo-2026-07-30.jsonl');
  const entries = await readEntries(directory);
  expect(entries).toHaveLength(14);
  expect(new Set(entries.map((entry) => entry.seq)).size).toBe(14);
});

test('#43 보존은 14일 이내 전체와 오래된 파일 중 최신 20개를 유지한다', async () => {
  const recentDirectory = await makeTemporaryDirectory();
  const now = new Date('2026-07-29T12:00:00.000Z');
  for (let index = 0; index < 22; index++) {
    const filePath = path.join(recentDirectory, `matgo-2026-07-${String(index + 1).padStart(2, '0')}.jsonl`);
    await fs.writeFile(filePath, '{}\n');
    const recentTime = new Date(now.getTime() - index * 60 * 60 * 1000);
    await fs.utimes(filePath, recentTime, recentTime);
  }
  const recentLogger = new MatchLogger({ directory: recentDirectory, now: () => now });
  await recentLogger.prune();
  expect((await fs.readdir(recentDirectory)).filter((name) => name.endsWith('.jsonl'))).toHaveLength(22);

  const oldDirectory = await makeTemporaryDirectory();
  for (let index = 0; index < 22; index++) {
    const filePath = path.join(oldDirectory, `matgo-2026-06-${String(index + 1).padStart(2, '0')}.jsonl`);
    await fs.writeFile(filePath, '{}\n');
    const oldTime = new Date(now.getTime() - (30 + index) * 24 * 60 * 60 * 1000);
    await fs.utimes(filePath, oldTime, oldTime);
  }
  const oldLogger = new MatchLogger({ directory: oldDirectory, now: () => now });
  await oldLogger.prune();
  expect((await fs.readdir(oldDirectory)).filter((name) => name.endsWith('.jsonl'))).toHaveLength(20);
});

test('#43 총 용량 상한에서도 활성 파일을 보호하고 오래된 비활성 파일부터 삭제한다', async () => {
  const directory = await makeTemporaryDirectory();
  const paths = [];
  for (let index = 0; index < 3; index++) {
    const filePath = path.join(directory, `matgo-2026-07-2${index}.jsonl`);
    await fs.writeFile(filePath, 'x'.repeat(100));
    const time = new Date(`2026-07-2${index}T00:00:00.000Z`);
    await fs.utimes(filePath, time, time);
    paths.push(filePath);
  }
  const logger = new MatchLogger({
    directory,
    maxTotalBytes: 150,
    now: () => new Date('2026-07-29T12:00:00.000Z'),
  });
  logger.activePath = paths[0];
  await logger.prune();
  const remaining = await fs.readdir(directory);
  expect(remaining).toContain(path.basename(paths[0]));
  expect(remaining).toHaveLength(1);
});

test('#43 append 권한 실패는 게임 흐름을 막지 않고 다음 기록에서 복구한다', async () => {
  const directory = await makeTemporaryDirectory();
  const warnings = [];
  const logger = new MatchLogger({
    directory,
    appendFile: async () => {
      const error = new Error('permission denied');
      error.code = 'EACCES';
      throw error;
    },
    stderr: { warn: (message) => warnings.push(message) },
  });
  logger.startMatch();
  const failed = await logger.log('PLAYER_INPUT', { actor: 'p1', payload: { type: 'PLAY_CARD' } });
  expect(failed).toBe(false);
  expect(warnings.some((message) => message.includes('EACCES'))).toBe(true);

  logger.appendFile = fs.appendFile.bind(fs);
  const recovered = await logger.log('STATE_RECOVERED', {
    actor: 'system',
    payload: { recovered: true },
  });
  expect(recovered).toBe(true);
  await logger.flush();
  const entries = await readEntries(directory);
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({ event: 'STATE_RECOVERED', seq: 3 });
});

test('#43 서버 hook은 입력 거부·오류·중도 이탈을 실제 매치 문맥에 연결한다', async () => {
  const directory = await makeTemporaryDirectory();
  const logger = new MatchLogger({ directory });
  const app = createApp({ matchLogger: logger });
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const p1 = new WebSocket(`ws://127.0.0.1:${address.port}/ws`);
  const p2 = new WebSocket(`ws://127.0.0.1:${address.port}/ws`);
  try {
    await Promise.all([waitForOpen(p1), waitForOpen(p2)]);
    const p1State = waitForMessage(p1, (message) => message.type === 'STATE');
    const p2State = waitForMessage(p2, (message) => message.type === 'STATE');
    p1.send(JSON.stringify({ type: 'READY' }));
    p2.send(JSON.stringify({ type: 'READY' }));
    await Promise.all([p1State, p2State]);

    p1.send('{invalid json');
    p1.send(JSON.stringify({ type: 'PLAY_CARD', cardId: 'not-in-hand' }));
    await waitForMessage(p1, (message) => message.type === 'ERROR');
    p1.close(1000, 'test-leave');
    await new Promise((resolve) => p1.once('close', resolve));
    p2.close();
    await new Promise((resolve) => p2.once('close', resolve));
    await app.flushLogs();

    const entries = await readEntries(directory);
    expect(entries.some((entry) => entry.event === 'MATCH_START')).toBe(true);
    expect(entries.some((entry) => entry.event === 'ROUND_START')).toBe(true);
    expect(entries.some((entry) => (
      entry.event === 'INPUT_REJECTED' && entry.payload.code === 'INVALID_JSON'
    ))).toBe(true);
    expect(entries.some((entry) => (
      entry.event === 'INPUT_REJECTED' && entry.payload.code === 'RULE_REJECTED'
    ))).toBe(true);
    expect(entries.at(-1)).toMatchObject({
      event: 'MATCH_END',
      payload: { outcome: 'interrupted', reasonCode: 'PLAYER_LEFT' },
    });
    expect(new Set(entries.map((entry) => entry.matchId)).size).toBe(1);
  } finally {
    if (p1.readyState < WebSocket.CLOSING) p1.terminate();
    if (p2.readyState < WebSocket.CLOSING) p2.terminate();
    await app.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
