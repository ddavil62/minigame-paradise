/**
 * @fileoverview 서버 단계 러너가 게임 교체·리셋·재접속 경계를 넘지 않는지 검증한다.
 */

import { test, expect } from '@playwright/test';
import http from 'http';
import { WebSocket } from 'ws';
import { buildDeck } from '../cards.js';
import { createApp } from '../server.js';

const BY_ID = Object.fromEntries(buildDeck().map((card) => [card.id, card]));

/**
 * 파일 I/O 없이 서버 로그 계약만 충족하는 테스트 로거다.
 */
class SilentLogger {
  /** @returns {string} */
  startMatch() { return 'test-match'; }

  /** @returns {string} */
  startRound() { return 'test-round'; }

  /** @returns {Promise<boolean>} */
  async log() { return true; }

  /** @returns {Promise<boolean>} */
  async endMatch() { return true; }

  /** @returns {Promise<void>} */
  async flush() {}
}

/**
 * 임의 포트에 격리된 맞고 서버를 연다.
 *
 * @returns {Promise<{app:ReturnType<typeof createApp>,server:http.Server,httpUrl:string,wsUrl:string}>}
 */
async function openServer() {
  const app = createApp({ matchLogger: new SilentLogger() });
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    app,
    server,
    httpUrl: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}/ws`,
  };
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

/**
 * 조건에 맞는 WebSocket JSON 메시지를 기다린다.
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
     * 수신 메시지를 JSON으로 변환해 조건을 판정한다.
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
 * 두 플레이어를 연결하고 READY 완료 상태까지 진행한다.
 *
 * @param {string} wsUrl
 * @returns {Promise<{p1:WebSocket,p2:WebSocket}>}
 */
async function openReadyPair(wsUrl) {
  const p1 = new WebSocket(wsUrl);
  const p2 = new WebSocket(wsUrl);
  await Promise.all([waitForOpen(p1), waitForOpen(p2)]);
  const started = Promise.all([
    waitForMessage(p1, (message) => message.type === 'STATE'),
    waitForMessage(p2, (message) => message.type === 'STATE'),
  ]);
  p1.send(JSON.stringify({ type: 'READY' }));
  p2.send(JSON.stringify({ type: 'READY' }));
  await started;
  return { p1, p2 };
}

/**
 * 테스트 서버에 결정적 게임 상태를 주입한다.
 *
 * @param {string} httpUrl
 * @returns {Promise<void>}
 */
async function injectPlayableState(httpUrl) {
  const response = await fetch(`${httpUrl}/test/inject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      p1Hand: [BY_ID.m01_gwang],
      p2Hand: [BY_ID.m02_kkeut_godori],
      floor: [],
      deck: [BY_ID.m04_kkeut_godori],
      captured: { p1: [], p2: [] },
      turn: 'p1',
      phase: 'awaiting_play',
    }),
  });
  expect(response.ok).toBe(true);
}

/**
 * 서버 러너 진단 상태를 조회한다.
 *
 * @param {string} httpUrl
 * @returns {Promise<object>}
 */
async function getStatus(httpUrl) {
  const response = await fetch(`${httpUrl}/test/status`);
  return response.json();
}

/**
 * 첫 단계 뒤 지연 타이머가 살아 있는 러너를 만든다.
 *
 * @param {string} httpUrl
 * @param {WebSocket} p1
 * @returns {Promise<object>}
 */
async function startWaitingRunner(httpUrl, p1) {
  await injectPlayableState(httpUrl);
  p1.send(JSON.stringify({ type: 'PLAY_CARD', cardId: 'm01_gwang' }));
  await expect.poll(async () => (await getStatus(httpUrl)).stepInProgress).toBe(true);
  const status = await getStatus(httpUrl);
  expect(status.activeStepTimerCount).toBeGreaterThan(0);
  expect(status.activeRunnerId).not.toBeNull();
  return status;
}

/**
 * 새 게임에서 입력이 끝까지 처리되고 잠금이 해제되는지 확인한다.
 *
 * @param {string} httpUrl
 * @param {WebSocket} p1
 * @returns {Promise<void>}
 */
async function expectFreshActionCompletes(httpUrl, p1) {
  await injectPlayableState(httpUrl);
  p1.send(JSON.stringify({ type: 'PLAY_CARD', cardId: 'm01_gwang' }));
  await expect.poll(async () => {
    const status = await getStatus(httpUrl);
    return `${status.turn}:${status.stepInProgress}:${status.activeStepTimerCount}`;
  }, { timeout: 5000 }).toBe('p2:false:0');
}

/**
 * 소켓을 정상 종료하고 close 이벤트까지 기다린다.
 *
 * @param {WebSocket} socket
 * @returns {Promise<void>}
 */
async function closeSocket(socket) {
  if (socket.readyState === WebSocket.CLOSED) return;
  const closed = new Promise((resolve) => socket.once('close', resolve));
  if (socket.readyState < WebSocket.CLOSING) socket.close();
  await closed;
}

/**
 * 테스트 서버와 남은 소켓을 안전하게 닫는다.
 *
 * @param {{app:ReturnType<typeof createApp>,server:http.Server}} fixture
 * @param {WebSocket[]} sockets
 * @returns {Promise<void>}
 */
async function closeFixture(fixture, sockets) {
  await Promise.all(sockets.map((socket) => closeSocket(socket)));
  await fixture.app.close();
  await new Promise((resolve) => fixture.server.close(resolve));
}

test('빠른 종료 뒤 재접속한 게임은 이전 러너 타이머의 영향을 받지 않는다', async () => {
  const fixture = await openServer();
  const sockets = [];
  try {
    const first = await openReadyPair(fixture.wsUrl);
    sockets.push(first.p1, first.p2);
    const oldStatus = await startWaitingRunner(fixture.httpUrl, first.p1);
    await Promise.all([closeSocket(first.p1), closeSocket(first.p2)]);

    const second = await openReadyPair(fixture.wsUrl);
    sockets.push(second.p1, second.p2);
    expect((await getStatus(fixture.httpUrl)).gameGeneration).toBeGreaterThan(oldStatus.gameGeneration);
    await expectFreshActionCompletes(fixture.httpUrl, second.p1);
  } finally {
    await closeFixture(fixture, sockets);
  }
});

test('/test/reset 직후 READY한 게임은 지연 close와 이전 러너에 의해 초기화되지 않는다', async () => {
  const fixture = await openServer();
  const sockets = [];
  try {
    const first = await openReadyPair(fixture.wsUrl);
    sockets.push(first.p1, first.p2);
    const oldStatus = await startWaitingRunner(fixture.httpUrl, first.p1);
    const reset = await fetch(`${fixture.httpUrl}/test/reset`, { method: 'POST' });
    expect(reset.ok).toBe(true);

    const second = await openReadyPair(fixture.wsUrl);
    sockets.push(second.p1, second.p2);
    const readyStatus = await getStatus(fixture.httpUrl);
    expect(readyStatus.gameGeneration).toBeGreaterThan(oldStatus.gameGeneration);
    expect(readyStatus.phase).toBe('awaiting_play');
    expect(readyStatus.stepInProgress).toBe(false);
    await expectFreshActionCompletes(fixture.httpUrl, second.p1);
  } finally {
    await closeFixture(fixture, sockets);
  }
});

test('이전 러너 대기 중 NEW_GAME과 새 입력을 처리해도 구 release가 신규 잠금을 풀지 않는다', async () => {
  const fixture = await openServer();
  const sockets = [];
  try {
    const pair = await openReadyPair(fixture.wsUrl);
    sockets.push(pair.p1, pair.p2);
    const oldStatus = await startWaitingRunner(fixture.httpUrl, pair.p1);
    const started = waitForMessage(pair.p1, (message) => message.type === 'GAME_START');
    pair.p2.send(JSON.stringify({ type: 'NEW_GAME' }));
    await started;
    expect((await getStatus(fixture.httpUrl)).gameGeneration).toBeGreaterThan(oldStatus.gameGeneration);

    await expectFreshActionCompletes(fixture.httpUrl, pair.p1);
    await new Promise((resolve) => setTimeout(resolve, 900));
    const finalStatus = await getStatus(fixture.httpUrl);
    expect(finalStatus).toMatchObject({
      turn: 'p2',
      stepInProgress: false,
      activeStepTimerCount: 0,
      activeRunnerId: null,
    });
  } finally {
    await closeFixture(fixture, sockets);
  }
});
