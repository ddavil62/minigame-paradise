/**
 * @fileoverview 하나비 AI 모드의 타이밍, 수명주기, 정보 비대칭과 UI를 공격적으로 검증한다.
 */

import { test, expect } from 'playwright/test';
import http from 'http';
import { WebSocket } from 'ws';
import { createApp } from '../server.js';

/** 메시지 조건 대기와 안전 종료를 제공하는 WebSocket 테스트 클라이언트다. */
class Client {
  /** @param {WebSocket} ws 테스트 소켓 */
  constructor(ws) {
    this.ws = ws;
    this.queue = [];
    this.waiters = [];
    ws.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      const index = this.waiters.findIndex((waiter) => waiter.predicate(message));
      if (index >= 0) this.waiters.splice(index, 1)[0].resolve(message);
      else this.queue.push(message);
    });
  }

  /**
   * 조건에 맞는 다음 메시지를 기다린다.
   * @param {(message:object)=>boolean} predicate 메시지 조건
   * @param {number} [timeoutMs] 제한 시간
   * @returns {Promise<object>} 수신 메시지
   */
  nextWhere(predicate, timeoutMs = 3000) {
    const index = this.queue.findIndex(predicate);
    if (index >= 0) return Promise.resolve(this.queue.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('message timeout')), timeoutMs);
      this.waiters.push({
        predicate,
        resolve: (message) => {
          clearTimeout(timer);
          resolve(message);
        },
      });
    });
  }

  /**
   * 지정한 종류의 다음 메시지를 기다린다.
   * @param {string} type 메시지 종류
   * @param {number} [timeoutMs] 제한 시간
   * @returns {Promise<object>} 수신 메시지
   */
  next(type, timeoutMs = 3000) {
    return this.nextWhere((message) => message.type === type, timeoutMs);
  }

  /** @param {object} value 전송할 메시지 */
  send(value) {
    this.ws.send(JSON.stringify(value));
  }

  /** 소켓을 즉시 닫는다. */
  close() {
    if (this.ws.readyState < WebSocket.CLOSING) this.ws.terminate();
  }
}

/**
 * 격리된 서버를 임의 포트에 연다.
 * @param {object} [opts] 앱 주입 옵션
 * @returns {Promise<{server:http.Server,port:number}>} 서버와 포트
 */
async function openServer(opts = {}) {
  const app = createApp(opts);
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return { server, port: server.address().port };
}

/**
 * 테스트 서버에 접속한다.
 * @param {number} port 서버 포트
 * @returns {Promise<Client>} 접속 클라이언트
 */
async function connect(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  return new Client(ws);
}

/**
 * 테스트 자원을 닫는다.
 * @param {http.Server} server 서버
 * @param {Client[]} clients 클라이언트 목록
 */
async function closeAll(server, clients) {
  clients.forEach((client) => client.close());
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

/**
 * p1으로 참가해 AI 게임을 시작한다.
 * @param {Client} p1 사람 클라이언트
 * @returns {Promise<object>} 최초 상태
 */
async function startAi(p1) {
  p1.send({ type: 'JOIN', name: 'QA 사람' });
  await p1.next('JOINED');
  p1.send({ type: 'START_AI' });
  await p1.nextWhere((message) => message.type === 'JOINED' && message.opponentIsBot);
  await p1.next('START');
  return p1.next('STATE');
}

test('AI 관측은 항상 완전히 마스킹되고 예약당 행동은 정확히 하나다', async () => {
  const observations = [];
  const { server, port } = await openServer({
    botDelayMs: 80,
    chooseBotAction: (snapshot) => {
      observations.push(structuredClone(snapshot));
      return { type: 'PLAY_CARD', handIndex: 0 };
    },
  });
  const p1 = await connect(port);
  try {
    await startAi(p1);
    p1.send({ type: 'PLAY_CARD', handIndex: 0 });
    await p1.next('STATE');
    await p1.next('STATE');
    await new Promise((resolve) => setTimeout(resolve, 180));
    expect(observations).toHaveLength(1);
    expect(observations[0].myHand.length).toBeGreaterThan(0);
    expect(observations[0].myHand.every(
      (card) => card.color === null && card.number === null,
    )).toBe(true);
  } finally {
    await closeAll(server, [p1]);
  }
});

test('운영 AI 행동 지연은 500~900ms 범위이고 추가 행동이 없다', async () => {
  let decisionCount = 0;
  const { server, port } = await openServer({
    chooseBotAction: () => {
      decisionCount += 1;
      return { type: 'PLAY_CARD', handIndex: 0 };
    },
  });
  const p1 = await connect(port);
  try {
    await startAi(p1);
    const startedAt = Date.now();
    p1.send({ type: 'PLAY_CARD', handIndex: 0 });
    await p1.next('STATE');
    await p1.next('STATE', 1800);
    const elapsed = Date.now() - startedAt;
    expect(elapsed).toBeGreaterThanOrEqual(480);
    expect(elapsed).toBeLessThanOrEqual(1100);
    await new Promise((resolve) => setTimeout(resolve, 950));
    expect(decisionCount).toBe(1);
  } finally {
    await closeAll(server, [p1]);
  }
});

test('START_AI 연타는 한 게임만 만들고 나머지는 모두 거부한다', async () => {
  const { server, port } = await openServer({ botDelayMs: 0 });
  const p1 = await connect(port);
  try {
    p1.send({ type: 'JOIN', name: '연타 QA' });
    await p1.next('JOINED');
    for (let index = 0; index < 8; index += 1) p1.send({ type: 'START_AI' });
    await p1.next('START');
    await p1.next('STATE');
    const errors = [];
    for (let index = 0; index < 7; index += 1) errors.push(await p1.next('ERROR'));
    expect(errors.every((message) => message.message.includes('진행 중'))).toBe(true);
  } finally {
    await closeAll(server, [p1]);
  }
});

test('예약된 AI 행동은 사람 연결 해제 후 폐기되고 새 LAN 참가가 가능하다', async () => {
  let decisionCount = 0;
  const { server, port } = await openServer({
    botDelayMs: 160,
    chooseBotAction: () => {
      decisionCount += 1;
      return { type: 'PLAY_CARD', handIndex: 0 };
    },
  });
  const p1 = await connect(port);
  let lan1;
  let lan2;
  try {
    await startAi(p1);
    p1.send({ type: 'PLAY_CARD', handIndex: 0 });
    await p1.next('STATE');
    p1.close();
    await new Promise((resolve) => setTimeout(resolve, 280));
    expect(decisionCount).toBe(0);

    lan1 = await connect(port);
    lan2 = await connect(port);
    lan1.send({ type: 'JOIN', name: '새 P1' });
    expect((await lan1.next('JOINED')).playerId).toBe('p1');
    lan2.send({ type: 'JOIN', name: '새 P2' });
    expect((await lan2.next('JOINED')).playerId).toBe('p2');
    await lan1.nextWhere((message) => message.type === 'JOINED' && message.waiting === false);
    lan1.send({ type: 'READY' });
    lan2.send({ type: 'READY' });
    expect((await lan1.next('START')).mode).toBe('lan');
    await lan1.next('STATE');
  } finally {
    await closeAll(server, [p1, lan1, lan2].filter(Boolean));
  }
});

test('게임 종료 뒤 추가 AI 행동이 없고 사람 REMATCH 한 번으로 같은 AI와 재시작한다', async () => {
  let decisionCount = 0;
  const { server, port } = await openServer({
    botDelayMs: 0,
    chooseBotAction: () => {
      decisionCount += 1;
      return { type: 'PLAY_CARD', handIndex: 0 };
    },
  });
  const p1 = await connect(port);
  try {
    let state = await startAi(p1);
    for (let turn = 0; turn < 60 && state.phase !== 'ended'; turn += 1) {
      expect(state.currentTurn).toBe('p1');
      p1.send({ type: 'PLAY_CARD', handIndex: 0 });
      state = await p1.next('STATE');
      if (state.phase === 'ended') break;
      state = await p1.next('STATE');
    }
    expect(state.phase).toBe('ended');
    await p1.next('GAME_OVER');
    const countAtEnd = decisionCount;
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(decisionCount).toBe(countAtEnd);

    p1.send({ type: 'REMATCH' });
    const status = await p1.next('REMATCH_STATUS');
    expect(status).toEqual({ type: 'REMATCH_STATUS', p1Ready: true, p2Ready: true });
    const restart = await p1.next('START');
    expect(restart).toMatchObject({
      mode: 'ai',
      opponent: { name: '별빛 AI', isBot: true },
    });
    const fresh = await p1.next('STATE');
    expect(fresh.phase).toBe('playing');
    expect(fresh.currentTurn).toBe('p1');
  } finally {
    await closeAll(server, [p1]);
  }
});

test.describe('AI UI 반응형·접근성·콘솔 검수', () => {
  let server;
  let baseUrl;

  test.beforeAll(async () => {
    const opened = await openServer({ botDelayMs: 700 });
    server = opened.server;
    baseUrl = `http://127.0.0.1:${opened.port}`;
  });

  test.afterAll(async () => {
    await closeAll(server, []);
  });

  for (const viewport of [
    { name: '360', width: 360, height: 800 },
    { name: '520', width: 520, height: 900 },
    { name: '1280', width: 1280, height: 800 },
  ]) {
    test(`${viewport.name} CTA 이름 게이트·포커스·게임 AI 배지와 경계`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });

      await page.goto(baseUrl);
      await expect(page.locator('#name-gate-inline')).toBeVisible();
      await expect(page.locator('#ai-start-panel')).toBeHidden();
      if (viewport.name === '360') {
        await page.screenshot({
          path: 'tests/screenshots/hanabi-ai-qa-360-before-name.png',
          fullPage: true,
        });
      }

      await page.locator('#inline-name-input').fill(`QA-${viewport.name}`);
      await page.locator('#btn-inline-enter').click();
      const cta = page.locator('#btn-start-ai');
      await expect(cta).toBeVisible();
      // 이름 제출 버튼 다음 탭 순서가 AI CTA여야 하며 키보드 포커스 링이 보여야 한다.
      await page.keyboard.press('Tab');
      await expect(cta).toBeFocused();
      expect(await cta.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe('none');

      const waitingGeometry = await page.evaluate(() => {
        const root = document.documentElement;
        const button = document.querySelector('#btn-start-ai').getBoundingClientRect();
        const guide = document.querySelector('#guide-slider').getBoundingClientRect();
        return {
          scrollWidth: root.scrollWidth,
          clientWidth: root.clientWidth,
          button: { left: button.left, right: button.right, bottom: button.bottom, height: button.height },
          guide: { left: guide.left, right: guide.right, top: guide.top },
        };
      });
      expect(waitingGeometry.scrollWidth).toBeLessThanOrEqual(waitingGeometry.clientWidth);
      expect(waitingGeometry.button.left).toBeGreaterThanOrEqual(0);
      expect(waitingGeometry.button.right).toBeLessThanOrEqual(viewport.width);
      expect(waitingGeometry.button.height).toBeGreaterThanOrEqual(44);
      expect(waitingGeometry.button.bottom).toBeLessThanOrEqual(waitingGeometry.guide.top);
      expect(waitingGeometry.guide.left).toBeGreaterThanOrEqual(0);
      expect(waitingGeometry.guide.right).toBeLessThanOrEqual(viewport.width);
      await page.screenshot({
        path: `tests/screenshots/hanabi-ai-qa-${viewport.name}-cta-focus.png`,
        fullPage: true,
      });

      await page.evaluate(() => {
        window.__qaBusySeen = false;
        const button = document.querySelector('#btn-start-ai');
        const observer = new MutationObserver(() => {
          if (button.getAttribute('aria-busy') === 'true' && button.disabled) {
            window.__qaBusySeen = true;
          }
        });
        observer.observe(button, { attributes: true, attributeFilter: ['aria-busy', 'disabled'] });
      });
      await cta.click();
      await expect(page.locator('#screen-game')).toBeVisible();
      expect(await page.evaluate(() => window.__qaBusySeen)).toBe(true);
      await expect(page.locator('#game-opponent-ai-badge')).toBeVisible();
      await expect(page.locator('#opponent-hand-name')).toContainText('별빛 AI');
      const gameGeometry = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(gameGeometry.scrollWidth).toBeLessThanOrEqual(gameGeometry.clientWidth);
      await page.screenshot({
        path: `tests/screenshots/hanabi-ai-qa-${viewport.name}-game.png`,
        fullPage: true,
      });
      expect(errors).toEqual([]);
    });
  }
});
