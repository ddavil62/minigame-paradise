/**
 * @fileoverview 별빛 우편탑의 프로토콜 위조, 세션 경합, XSS, 접근성 및 반응형을 공격적으로 검증한다.
 */

import http from 'node:http';
import { once } from 'node:events';
import { expect, test } from '@playwright/test';
import WebSocket from 'ws';
import { createApp } from '../server.js';
import { applyInput, createSimulation } from '../game/simulation.js';
import { validateClientMessage } from '../shared/protocol.js';

/**
 * 메시지를 유실하지 않고 타입별로 기다릴 수 있는 테스트 소켓을 만든다.
 * @param {string} url WebSocket 주소
 * @returns {Promise<{ws:WebSocket,next:(type:string,timeout?:number)=>Promise<object>,send:(payload:object)=>void}>}
 */
async function openQueuedSocket(url) {
  const ws = new WebSocket(url);
  const queue = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const message = JSON.parse(raw.toString());
    const index = waiters.findIndex((waiter) => waiter.type === message.type);
    if (index >= 0) waiters.splice(index, 1)[0].resolve(message);
    else queue.push(message);
  });
  await once(ws, 'open');
  return {
    ws,
    send(payload) { ws.send(JSON.stringify(payload)); },
    next(type, timeout = 1500) {
      const index = queue.findIndex((message) => message.type === type);
      if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = { type, resolve };
        waiters.push(waiter);
        setTimeout(() => {
          const pendingIndex = waiters.indexOf(waiter);
          if (pendingIndex >= 0) waiters.splice(pendingIndex, 1);
          reject(new Error(`${type} 메시지를 ${timeout}ms 안에 받지 못했습니다.`));
        }, timeout).unref();
      });
    },
  };
}

/**
 * 격리된 실제 HTTP/WS 서버를 임의 포트에서 시작한다.
 * @param {number} reconnectGraceMs 재접속 유예 시간
 * @returns {Promise<{app:ReturnType<typeof createApp>,server:http.Server,url:string,close:()=>Promise<void>}>}
 */
async function startIsolatedServer(reconnectGraceMs = 1000) {
  const app = createApp({ reconnectGraceMs });
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  const url = `ws://127.0.0.1:${address.port}/ws`;
  return {
    app,
    server,
    url,
    async close() {
      app.close();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

/**
 * 플레이어를 서버에 참가시키고 환영 메시지를 반환한다.
 * @param {Awaited<ReturnType<typeof openQueuedSocket>>} client 테스트 소켓
 * @param {string} name 닉네임
 * @param {string} [token] 재접속 토큰
 * @returns {Promise<object>}
 */
async function join(client, name, token = '') {
  client.send({ type: 'JOIN', name, locale: 'ko', sessionToken: token });
  return client.next('WELCOME');
}

test('프로토콜은 null·배열·극단 시퀀스를 거부하고 과거 입력을 적용하지 않는다', () => {
  for (const value of [null, undefined, [], '', { type: 'INPUT', seq: -1 }, { type: 'INPUT', seq: 1e20 }, { type: 'JOIN', name: '' }]) {
    expect(validateClientMessage(value).ok).toBe(false);
  }
  const simulation = createSimulation();
  expect(applyInput(simulation, 'p1', { seq: 7, left: false, right: true, jump: false, interact: false })).toBe(true);
  expect(applyInput(simulation, 'p1', { seq: 7, left: true, right: false, jump: false, interact: false })).toBe(false);
  expect(applyInput(simulation, 'p1', { seq: 6, left: true, right: false, jump: false, interact: false })).toBe(false);
  expect(simulation.players[0].input.right).toBe(true);
});

test('JOIN 전 명령과 초당 60회를 넘는 INPUT flood를 서버가 제한한다', async () => {
  const isolated = await startIsolatedServer();
  const client = await openQueuedSocket(isolated.url);
  try {
    client.send({ type: 'READY' });
    expect((await client.next('ERROR')).code).toBe('JOIN_REQUIRED');
    await join(client, 'FloodTester');
    client.send({ type: 'READY' });
    isolated.app.getSimulation().phase = 'playing';
    for (let seq = 0; seq < 120; seq += 1) client.send({ type: 'INPUT', seq, right: true });
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(isolated.app.getSimulation().players[0].ackSeq).toBeLessThanOrEqual(59);
  } finally {
    client.ws.terminate();
    await isolated.close();
  }
});

test('두 플레이어 동시 단절 뒤 한 명만 복귀해도 세션은 계속 PAUSED여야 한다', async () => {
  const isolated = await startIsolatedServer(1200);
  const a = await openQueuedSocket(isolated.url);
  const b = await openQueuedSocket(isolated.url);
  let resumed;
  try {
    const welcomeA = await join(a, 'RaceA');
    await join(b, 'RaceB');
    a.send({ type: 'READY' }); b.send({ type: 'READY' });
    await a.next('START');
    a.ws.close(); b.ws.close();
    await Promise.all([once(a.ws, 'close'), once(b.ws, 'close')]);
    resumed = await openQueuedSocket(isolated.url);
    resumed.send({ type: 'JOIN', name: 'RaceA', locale: 'ko', sessionToken: welcomeA.resumeToken });
    const welcome = await resumed.next('WELCOME');
    expect(welcome.resumed).toBe(true);
    await resumed.next('SNAPSHOT');
    const stateMessage = await Promise.race([
      resumed.next('PAUSED', 500).then(() => 'PAUSED'),
      resumed.next('RESUMED', 500).then(() => 'RESUMED'),
    ]);
    expect(stateMessage).toBe('PAUSED');
    expect(isolated.app.getSimulation().phase).toBe('paused');
  } finally {
    resumed?.ws.terminate();
    await isolated.close();
  }
});

test('재경기 투표 후 퇴장한 플레이어의 표는 제거되어 단독 재시작되지 않아야 한다', async () => {
  const isolated = await startIsolatedServer();
  const a = await openQueuedSocket(isolated.url);
  const b = await openQueuedSocket(isolated.url);
  try {
    await join(a, 'VoteA'); await join(b, 'VoteB');
    isolated.app.getSimulation().phase = 'result';
    a.send({ type: 'RESTART_VOTE', agree: true });
    await b.next('REMATCH_STATE');
    a.send({ type: 'LEAVE_GAME' });
    await b.next('REMATCH_STATE');
    b.send({ type: 'RESTART_VOTE', agree: true });
    const outcome = await Promise.race([
      b.next('START', 900).then(() => 'START'),
      new Promise((resolve) => setTimeout(() => resolve('NO_START'), 750)),
    ]);
    expect(outcome).toBe('NO_START');
    expect(isolated.app.getSimulation().phase).toBe('result');
  } finally {
    a.ws.terminate(); b.ws.terminate();
    await isolated.close();
  }
});

test('HTML 닉네임은 텍스트로만 렌더되고 스크립트·요소를 만들지 않는다', async ({ browser }) => {
  const payload = '<img src=x onload=x>';
  const contextA = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const contextB = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const errors = [];
  pageA.on('pageerror', (error) => errors.push(error.message));
  try {
    await Promise.all([pageA.goto(`/?name=${encodeURIComponent(payload)}`), pageB.goto('/?name=SafePartner')]);
    await expect(pageA.locator('#p1-name, #p2-name').filter({ hasText: payload })).toHaveCount(1);
    await expect(pageA.locator('#p1-name img, #p2-name img')).toHaveCount(0);
    await expect(pageA.locator('img[src="x"]')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await contextA.close(); await contextB.close();
  }
});

test('1024 UI, 키보드 포커스 트랩, 영문, reduced-motion과 콘솔이 안정적이다', async ({ browser }) => {
  const contextA = await browser.newContext({ viewport: { width: 1024, height: 576 }, reducedMotion: 'reduce' });
  const contextB = await browser.newContext({ viewport: { width: 1024, height: 576 }, reducedMotion: 'reduce' });
  const pageA = await contextA.newPage(); const pageB = await contextB.newPage();
  const errors = [];
  pageA.on('pageerror', (error) => errors.push(error.message));
  pageA.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  try {
    await Promise.all([pageA.goto('/?name=KeyboardA'), pageB.goto('/?name=KeyboardB')]);
    await Promise.all([pageA.locator('#ready-button').click(), pageB.locator('#ready-button').click()]);
    await pageA.locator('#locale-button').click();
    await expect(pageA).toHaveTitle('Starlight Mail Tower');
    await pageA.locator('#toolbar-lobby-button').focus();
    await pageA.keyboard.press('Enter');
    await expect.soft(pageA.locator('#lobby-confirm-overlay'), 'Enter로 포커스된 툴바 버튼을 활성화해야 합니다.').toBeVisible();
    if (await pageA.locator('#lobby-confirm-overlay').isHidden()) await pageA.locator('#toolbar-lobby-button').click();
    await expect(pageA.locator('#continue-button')).toBeFocused();
    await pageA.keyboard.press('Shift+Tab');
    await expect(pageA.locator('#confirm-lobby-button')).toBeFocused();
    await pageA.keyboard.press('Tab');
    await expect(pageA.locator('#continue-button')).toBeFocused();
    await pageA.screenshot({ path: 'tests/screenshots/qa-keyboard-reduced-motion-1024x576.png' });
    const overlayBox = await pageA.locator('.confirm-card').boundingBox();
    expect(overlayBox.x).toBeGreaterThanOrEqual(0);
    expect(overlayBox.x + overlayBox.width).toBeLessThanOrEqual(1024);
    expect(overlayBox.y + overlayBox.height).toBeLessThanOrEqual(576);
    expect(errors).toEqual([]);
  } finally {
    await contextA.close(); await contextB.close();
  }
});
