/**
 * @fileoverview 끝말잇기 배틀 순수 AI 선택기와 서버 관리형 봇 생명주기 테스트.
 */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import test from 'node:test';
import { WebSocket } from 'ws';
import { createAiChooser } from '../ai.js';
import { createApp } from '../server.js';

/**
 * 테스트 WebSocket에서 조건을 만족하는 메시지를 기다린다.
 * @param {WebSocket} ws 소켓
 * @param {(message: object) => boolean} predicate 완료 조건
 * @param {number} [timeoutMs=8000] 제한 시간
 * @returns {Promise<object>}
 */
function waitForMessage(ws, predicate, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMessage);
      reject(new Error('WebSocket 메시지 대기 시간 초과'));
    }, timeoutMs);
    /** @param {Buffer} data */
    function onMessage(data) {
      const message = JSON.parse(data.toString());
      if (!predicate(message)) return;
      clearTimeout(timer);
      ws.off('message', onMessage);
      resolve(message);
    }
    ws.on('message', onMessage);
  });
}

/**
 * 지정 토큰 헤더로 봇 WebSocket 연결을 만든다.
 * @param {number} port 서버 포트
 * @param {string|null} token 토큰, null이면 헤더를 보내지 않음
 * @returns {{ws: WebSocket, message: Promise<object>}}
 */
function openBotAttempt(port, token) {
  const options = token === null ? {} : { headers: { 'x-wordchain-bot-token': token } };
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?mode=bot`, options);
  return { ws, message: waitForMessage(ws, () => true) };
}

test('AI 선택기는 forced·두음법칙·공용 중복을 지킨다', () => {
  const chooser = createAiChooser(['나라', '나비', '라디오', '비누', '누리', '라마']);
  const usedWords = new Set(['나라']);
  const word = chooser.chooseAiWord({
    player: { gauge: 0, forced: '라', lastSyllable: '비' },
    usedWords,
    rng: () => 0,
  });
  assert.ok(word === '나비' || word === '라디오' || word === '라마');
  assert.notEqual(word, '나라');
  assert.deepEqual([...usedWords], ['나라']);
});

test('AI 선택기는 게이지를 완성하는 안전 후보를 우선하고 후보가 없으면 null을 반환한다', () => {
  const chooser = createAiChooser(['가나', '가나다라마', '나비', '나라', '마음', '마차']);
  const finishing = chooser.chooseAiWord({
    player: { gauge: 55, forced: '가', lastSyllable: null },
    usedWords: new Set(),
    rng: () => 0,
  });
  assert.equal(finishing, '가나다라마');
  assert.equal(chooser.chooseAiWord({
    player: { gauge: 0, forced: '힣', lastSyllable: null },
    usedWords: new Set(),
    rng: () => 0,
  }), null);
});

test('mode=ai 사람 한 명은 봇 한 명과 단일 경기를 시작하고 이탈 시 정리된다', async (t) => {
  let port = 0;
  const app = createApp({
    getBotUrl: () => `ws://127.0.0.1:${port}/ws?mode=bot`,
  });
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const human = new WebSocket(`ws://127.0.0.1:${port}/ws?mode=ai`);
  t.after(() => {
    if (human.readyState === WebSocket.OPEN) human.terminate();
  });
  await new Promise((resolve, reject) => {
    human.once('open', resolve);
    human.once('error', reject);
  });
  const gameStartPromise = waitForMessage(human, (message) => message.type === 'GAME_START');
  human.send(JSON.stringify({ type: 'JOIN', name: 'AI테스터' }));

  const gameStart = await gameStartPromise;
  assert.deepEqual(gameStart.players.map((player) => player.name), ['AI테스터', 'AI (보통)']);
  await waitForMessage(human, (message) => message.type === 'PLAYING', 5000);
  const accepted = await waitForMessage(
    human,
    (message) => message.type === 'WORD_ACCEPTED' && message.playerId === 'p2',
    5000,
  );
  assert.equal(typeof accepted.word, 'string');
  assert.ok(accepted.word.length >= 2);

  const gameOverPromise = waitForMessage(human, (message) => message.type === 'GAME_OVER');
  human.send(JSON.stringify({ type: 'RESIGN' }));
  await gameOverPromise;
  const rematchStartPromise = waitForMessage(human, (message) => message.type === 'REMATCH_START');
  const nextGamePromise = waitForMessage(human, (message) => message.type === 'GAME_START');
  human.send(JSON.stringify({ type: 'REMATCH' }));
  await rematchStartPromise;
  const nextGame = await nextGamePromise;
  assert.deepEqual(nextGame.players.map((player) => player.name), ['AI테스터', 'AI (보통)']);

  human.close();
  await new Promise((resolve) => human.once('close', resolve));

  const replacement = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const joinedPromise = waitForMessage(replacement, (message) => message.type === 'JOINED');
  await new Promise((resolve, reject) => {
    replacement.once('open', resolve);
    replacement.once('error', reject);
  });
  const joined = await joinedPromise;
  assert.equal(joined.yourId, 'p1');
  replacement.close();
  await new Promise((resolve) => replacement.once('close', resolve));
});

test('봇 일회용 토큰은 누락·오류·재사용·이전 세대를 거부하고 활성 자식에 한 번만 승인된다', async () => {
  /** @type {string[]} 자식 프로세스에 전달된 토큰 기록. */
  const issuedTokens = [];
  /**
   * 실제 프로세스 없이 인증 세션만 유지하는 테스트 child를 만든다.
   * @param {string} _executable 실행 파일
   * @param {string[]} _args 실행 인자
   * @param {{env: NodeJS.ProcessEnv}} options spawn 옵션
   * @returns {EventEmitter & {kill: () => boolean}}
   */
  function spawnFakeChild(_executable, _args, options) {
    issuedTokens.push(options.env.WORDCHAIN_BOT_TOKEN);
    const child = new EventEmitter();
    child.kill = () => {
      child.emit('exit', 0);
      return true;
    };
    return child;
  }

  let port = 0;
  const app = createApp({
    getBotUrl: () => `ws://127.0.0.1:${port}/ws?mode=bot`,
    spawnBotProcess: spawnFakeChild,
  });
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
  /** @type {WebSocket[]} 테스트 중 생성한 모든 소켓. */
  const sockets = [];

  /** @param {string} name AI 모드 사람을 연결하고 토큰 발급까지 기다린다. */
  async function openAiHuman(name) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?mode=ai`);
    sockets.push(ws);
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    ws.send(JSON.stringify({ type: 'JOIN', name }));
    const expectedCount = issuedTokens.length + 1;
    const deadline = Date.now() + 2000;
    while (issuedTokens.length < expectedCount && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(issuedTokens.length, expectedCount);
    return ws;
  }

  /** @param {string|null} token 토큰 헤더 */
  function attemptBot(token) {
    const attempt = openBotAttempt(port, token);
    sockets.push(attempt.ws);
    return attempt;
  }

  /** @param {WebSocket} ws 소켓을 닫고 close 완료를 기다린다. */
  async function closeSocket(ws) {
    if (ws.readyState === WebSocket.CLOSED) return;
    const closed = new Promise((resolve) => ws.once('close', resolve));
    ws.close();
    await closed;
  }

  try {
    const human1 = await openAiHuman('토큰QA1');
    const token1 = issuedTokens[0];
    assert.match(token1, /^[0-9a-f]{64}$/);

    for (const token of [null, 'wrong-token']) {
      const attempt = attemptBot(token);
      assert.equal((await attempt.message).type, 'ERROR');
      await closeSocket(attempt.ws);
    }

    const valid = attemptBot(token1);
    const joined = await valid.message;
    assert.equal(joined.type, 'JOINED');
    assert.equal(joined.yourId, 'p2');

    const reused = attemptBot(token1);
    assert.equal((await reused.message).type, 'ERROR');
    await closeSocket(reused.ws);
    await closeSocket(human1);
    await closeSocket(valid.ws);

    const human2 = await openAiHuman('토큰QA2');
    const token2 = issuedTokens[1];
    assert.notEqual(token2, token1);

    const stale = attemptBot(token1);
    assert.equal((await stale.message).type, 'ERROR');
    await closeSocket(stale.ws);

    const current = attemptBot(token2);
    assert.equal((await current.message).type, 'JOINED');
    await closeSocket(human2);
    await closeSocket(current.ws);
  } finally {
    for (const ws of sockets) {
      if (ws.readyState !== WebSocket.CLOSED) ws.terminate();
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    await new Promise((resolve) => server.close(resolve));
  }
});
