/**
 * @fileoverview 월드 확장의 서버 권한, 결과 합의 레이스와 역할 교체 위조를 공격적으로 검증한다.
 */

import http from 'node:http';
import { once } from 'node:events';
import { expect, test } from '@playwright/test';
import WebSocket from 'ws';
import { createApp } from '../server.js';

/**
 * 타입별 메시지를 큐에 보존하는 테스트 소켓을 연다.
 * @param {string} url 웹소켓 주소
 * @returns {Promise<object>}
 */
async function openSocket(url) {
  const ws = new WebSocket(url); const queue = []; const waiters = [];
  ws.on('message', (raw) => {
    const message = JSON.parse(raw.toString());
    const index = waiters.findIndex((waiter) => waiter.type === message.type);
    if (index >= 0) waiters.splice(index, 1)[0].resolve(message); else queue.push(message);
  });
  await once(ws, 'open');
  return {
    ws,
    send(payload) { ws.send(JSON.stringify(payload)); },
    next(type, timeout = 1500) {
      const index = queue.findIndex((message) => message.type === type);
      if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = { type, resolve }; waiters.push(waiter);
        setTimeout(() => { const pending = waiters.indexOf(waiter); if (pending >= 0) waiters.splice(pending, 1); reject(new Error(`${type} timeout`)); }, timeout).unref();
      });
    },
  };
}

/**
 * 실제 앱을 임의 포트에서 격리 실행한다.
 * @returns {Promise<object>}
 */
async function startServer() {
  const app = createApp({ reconnectGraceMs: 1000 });
  const server = http.createServer(app.handleHttp); server.on('upgrade', app.handleUpgrade); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address();
  return { app, server, url: `ws://127.0.0.1:${address.port}/ws`, async close() { app.close(); await new Promise((resolve) => server.close(resolve)); } };
}

/**
 * 참가 후 역할 정보를 받는다.
 * @param {object} client 테스트 소켓
 * @param {string} name 닉네임
 * @returns {Promise<object>}
 */
async function join(client, name) { client.send({ type: 'JOIN', name, locale: 'ko' }); return client.next('WELCOME'); }

test('RESULT 상태의 READY 위조는 결과 합의를 우회해 게임을 재시작하지 못한다', async () => {
  const isolated = await startServer(); const a = await openSocket(isolated.url); const b = await openSocket(isolated.url);
  try {
    await join(a, 'ReadyForgeryA'); await join(b, 'ReadyForgeryB'); a.send({ type: 'READY' }); b.send({ type: 'READY' }); await a.next('START');
    isolated.app.getSimulation().phase = 'result';
    a.send({ type: 'READY' });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(isolated.app.getSimulation().phase).toBe('result');
  } finally { a.ws.terminate(); b.ws.terminate(); await isolated.close(); }
});

test('퇴장한 역할의 이전 결과 표를 새 참가자의 표로 재사용하지 않는다', async () => {
  const isolated = await startServer(); const a = await openSocket(isolated.url); const b = await openSocket(isolated.url); let replacement;
  try {
    await join(a, 'LeavingP1'); await join(b, 'StayingP2'); isolated.app.getSimulation().phase = 'result';
    a.send({ type: 'RESULT_VOTE', action: 'NEXT' }); await b.next('RESULT_VOTE_STATE');
    a.send({ type: 'LEAVE_GAME' });
    replacement = await openSocket(isolated.url); const welcome = await join(replacement, 'ReplacementP1'); expect(welcome.playerId).toBe('p1');
    b.send({ type: 'RESULT_VOTE', action: 'NEXT' });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(isolated.app.getSimulation().phase).toBe('result');
  } finally { a.ws.terminate(); b.ws.terminate(); replacement?.ws.terminate(); await isolated.close(); }
});

test('처리 지연 중 만장일치 행동이 바뀌면 최신 SELECT 합의를 정확히 한 번 적용한다', async () => {
  const isolated = await startServer(); const a = await openSocket(isolated.url); const b = await openSocket(isolated.url);
  try {
    await join(a, 'RaceVoteA'); await join(b, 'RaceVoteB'); isolated.app.getSimulation().phase = 'result';
    a.send({ type: 'RESULT_VOTE', action: 'NEXT' }); b.send({ type: 'RESULT_VOTE', action: 'NEXT' });
    let processing;
    do { processing = await a.next('RESULT_VOTE_STATE'); } while (processing.status !== 'processing');
    a.send({ type: 'RESULT_VOTE', action: 'SELECT' }); b.send({ type: 'RESULT_VOTE', action: 'SELECT' });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(isolated.app.getSimulation().phase).toBe('waiting');
  } finally { a.ws.terminate(); b.ws.terminate(); await isolated.close(); }
});

test('게스트·잘못된 ID·진행 중 선택 위조는 레벨을 변경하지 않는다', async () => {
  const isolated = await startServer(); const a = await openSocket(isolated.url); const b = await openSocket(isolated.url);
  try {
    const wa = await join(a, 'AuthorityA'); await join(b, 'AuthorityB'); const host = wa.playerId === 'p1' ? a : b; const guest = host === a ? b : a;
    guest.send({ type: 'SELECT_LEVEL', levelId: 'cloud-cargo' }); expect((await guest.next('ERROR')).code).toBe('INVALID_MESSAGE');
    host.send({ type: 'SELECT_LEVEL', levelId: 'not-a-level' }); expect((await host.next('ERROR')).code).toBe('INVALID_MESSAGE');
    host.send({ type: 'SELECT_LEVEL', levelId: 'moon-clock' }); await guest.next('MENU_STATE'); host.send({ type: 'READY' }); guest.send({ type: 'READY' }); await host.next('START');
    host.send({ type: 'SELECT_LEVEL', levelId: 'orbital-post' }); expect((await host.next('ERROR')).code).toBe('INVALID_MESSAGE');
    expect(isolated.app.getSimulation().levelId).toBe('moon-clock');
  } finally { a.ws.terminate(); b.ws.terminate(); await isolated.close(); }
});

test('NEXT 연타는 한 단계만 진행하며 마지막 레벨 뒤 첫 레벨로 순환한다', async () => {
  const isolated = await startServer(); const a = await openSocket(isolated.url); const b = await openSocket(isolated.url);
  try {
    await join(a, 'NextCycleA'); await join(b, 'NextCycleB');
    const expected = ['cloud-cargo', 'moon-clock', 'storm-station', 'orbital-post', 'starlight-tower'];
    for (const levelId of expected) {
      isolated.app.getSimulation().phase = 'result';
      for (let index = 0; index < 12; index += 1) { a.send({ type: 'RESULT_VOTE', action: 'NEXT' }); b.send({ type: 'RESULT_VOTE', action: 'NEXT' }); }
      const started = await a.next('START', 1200);
      expect(started.levelId).toBe(levelId);
      expect(isolated.app.getSimulation().levelId).toBe(levelId);
    }
  } finally { a.ws.terminate(); b.ws.terminate(); await isolated.close(); }
});

test('390px에서 ko/en 전환, 번역된 접근성 이름과 키보드 포커스가 안정적이다', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } }); const page = await context.newPage(); const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  try {
    await page.addInitScript(() => localStorage.setItem('starlight-locale', 'en'));
    await page.goto('/?name=LocaleKeyboard');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('#level-list')).toHaveAttribute('aria-label', 'Choose a delivery course');
    await expect(page.locator('.level-card').nth(4)).toContainText('Orbital Post');
    await page.locator('.level-card').first().focus(); await expect(page.locator('.level-card').first()).toBeFocused();
    await page.screenshot({ path: 'tests/screenshots/qa-world-expansion-en-390x844.png' });
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});
