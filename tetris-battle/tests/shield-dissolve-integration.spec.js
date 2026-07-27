/**
 * @fileoverview 실제 2개 브라우저와 WebSocket 서버를 거쳐 방어막 소멸 역할 판별을 검증한다.
 */

import { test, expect } from '@playwright/test';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { createApp } from '../server.js';

const LEGACY_PORT = 3122;
const MODERN_PORT = 3123;
const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');

/** @type {http.Server[]} */
const servers = [];

/**
 * HTTP 서버를 지정 포트에 기동한다.
 * @param {http.Server} server 서버
 * @param {number} port 포트
 * @returns {Promise<void>}
 */
function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
}

/**
 * isDefender 필드 없이 SHIELD_BLOCK을 보내는 레거시 호환 서버를 만든다.
 * @returns {http.Server}
 */
function createLegacyServer() {
  const app = express();
  app.use(express.static(PUBLIC_DIR));
  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });
  const players = [];

  const send = (player, payload) => {
    if (player?.ws.readyState === WebSocket.OPEN) player.ws.send(JSON.stringify(payload));
  };
  const broadcastReady = () => {
    for (const player of players) {
      const opponent = players.find((entry) => entry !== player);
      send(player, { type: 'READY_STATE', myReady: player.ready, opponentReady: !!opponent?.ready });
    }
  };

  wss.on('connection', (ws) => {
    const player = { id: `p${players.length + 1}`, ws, ready: false, shieldActive: false };
    players.push(player);
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      const opponent = players.find((entry) => entry !== player);
      if (msg.type === 'JOIN') {
        send(player, { type: 'JOINED', playerId: player.id, waiting: players.length < 2, hostUrl: '' });
      } else if (msg.type === 'READY') {
        player.ready = true;
        broadcastReady();
        if (players.length === 2 && players.every((entry) => entry.ready)) {
          for (const entry of players) send(entry, { type: 'START', countdown: -1 });
        }
      } else if (msg.type === 'ITEM_USE' && msg.itemId === 'shield') {
        player.shieldActive = true;
        send(opponent, { type: 'SHIELD_ACTIVE' });
      } else if (msg.type === 'ITEM_USE' && opponent?.shieldActive) {
        opponent.shieldActive = false;
        // 레거시 서버는 공격자와 방어자 모두에게 역할 필드 없이 통보한다.
        send(player, { type: 'SHIELD_BLOCK', itemId: msg.itemId });
        send(opponent, { type: 'SHIELD_BLOCK', itemId: msg.itemId });
      }
    });
    ws.on('close', () => {
      const index = players.indexOf(player);
      if (index >= 0) players.splice(index, 1);
    });
  });
  server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
  });
  return server;
}

/**
 * 페이지가 실제로 생성한 WebSocket과 수신 payload를 관찰할 수 있게 한다.
 * @param {import('@playwright/test').Page} page 페이지
 * @returns {Promise<void>}
 */
async function trackWebSocket(page) {
  await page.addInitScript(() => {
    const NativeWebSocket = window.WebSocket;
    window.__shieldSockets = [];
    window.__shieldMessages = [];
    window.WebSocket = class extends NativeWebSocket {
      constructor(...args) {
        super(...args);
        window.__shieldSockets.push(this);
        this.addEventListener('message', (event) => {
          try { window.__shieldMessages.push(JSON.parse(event.data)); } catch { /* 비 JSON은 무시 */ }
        });
      }
    };
  });
}

/**
 * 실제 WebSocket 객체의 message 이벤트로 테스트용 아이템 지급을 주입한다.
 * 차단 이벤트 자체는 반드시 서버가 송신한다.
 * @param {import('@playwright/test').Page} page 페이지
 * @param {string} itemId 아이템 ID
 * @param {number} slotIndex 슬롯 번호
 * @returns {Promise<void>}
 */
async function grantItem(page, itemId, slotIndex = 0) {
  await page.evaluate(({ itemId: id, slotIndex: slot }) => {
    const socket = window.__shieldSockets[0];
    socket.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({ type: 'ITEM_GRANT', itemId: id, slotIndex: slot }),
    }));
  }, { itemId, slotIndex });
  await expect(page.locator(`.item-slot[data-slot="${slotIndex}"]`)).toHaveClass(/filled/);
}

/**
 * 두 브라우저를 실제 게임에 접속시키고 게임 화면까지 기다린다.
 * @param {import('@playwright/test').Browser} browser 브라우저
 * @param {number} port 서버 포트
 * @returns {Promise<{a: import('@playwright/test').Page, b: import('@playwright/test').Page, close: () => Promise<void>} >}
 */
async function openMatch(browser, port) {
  const contextA = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const contextB = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const a = await contextA.newPage();
  const b = await contextB.newPage();
  await Promise.all([trackWebSocket(a), trackWebSocket(b)]);
  await Promise.all([
    a.goto(`http://127.0.0.1:${port}/?name=A`),
    b.goto(`http://127.0.0.1:${port}/?name=B`),
  ]);
  await Promise.all([
    expect(a.locator('.game-main')).toBeVisible({ timeout: 10000 }),
    expect(b.locator('.game-main')).toBeVisible({ timeout: 10000 }),
  ]);
  return { a, b, close: async () => Promise.all([contextA.close(), contextB.close()]).then(() => undefined) };
}

test.beforeAll(async () => {
  const legacyServer = createLegacyServer();
  const modernApp = createApp({ hostUrl: '' });
  const modernServer = http.createServer(modernApp.handleHttp);
  modernServer.on('upgrade', modernApp.handleUpgrade);
  servers.push(legacyServer, modernServer);
  await listen(legacyServer, LEGACY_PORT);
  await listen(modernServer, MODERN_PORT);
});

test.afterAll(async () => {
  for (const server of servers) {
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    await Promise.race([
      new Promise((resolve) => server.close(resolve)),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);
  }
});

test('레거시 무필드 단독 방어막은 active → breaking → idle로 소멸한다', async ({ browser }) => {
  const match = await openMatch(browser, LEGACY_PORT);
  try {
    await grantItem(match.b, 'shield');
    await match.b.locator('.item-slot[data-slot="0"]').click();
    await expect(match.b.locator('#shield-frame')).toHaveClass(/active/);

    await grantItem(match.a, 'dark');
    await match.a.locator('.item-slot[data-slot="0"]').click();
    await expect(match.b.locator('#shield-frame')).not.toHaveClass(/active/);
    await expect(match.b.locator('#shield-frame')).toHaveClass(/breaking/);
    await match.b.screenshot({ path: 'tests/screenshots/shield-dissolve-legacy-breaking.png' });

    const defenderPayload = await match.b.evaluate(() =>
      window.__shieldMessages.find((msg) => msg.type === 'SHIELD_BLOCK'));
    expect(defenderPayload).toEqual({ type: 'SHIELD_BLOCK', itemId: 'dark' });
    await expect(match.b.locator('#shield-frame')).not.toHaveClass(/active|breaking/, { timeout: 1100 });
    await match.b.screenshot({ path: 'tests/screenshots/shield-dissolve-legacy-idle.png' });
  } finally {
    await match.close();
  }
});

test('최신 서버의 explicit false는 동시 방어막 공격자의 글로우를 보존한다', async ({ browser }) => {
  const match = await openMatch(browser, MODERN_PORT);
  try {
    await Promise.all([grantItem(match.a, 'shield'), grantItem(match.b, 'shield')]);
    await match.a.locator('.item-slot[data-slot="0"]').click();
    await match.b.locator('.item-slot[data-slot="0"]').click();
    await Promise.all([
      expect(match.a.locator('#shield-frame')).toHaveClass(/active/),
      expect(match.b.locator('#shield-frame')).toHaveClass(/active/),
    ]);

    await grantItem(match.a, 'freeze');
    await match.a.locator('.item-slot[data-slot="0"]').click();
    await expect(match.a.locator('#shield-frame')).toHaveClass(/active/);
    await expect(match.a.locator('#shield-frame')).not.toHaveClass(/breaking/);
    await expect(match.b.locator('#shield-frame')).toHaveClass(/breaking/);

    await expect.poll(() => match.a.evaluate(() =>
      window.__shieldMessages.some((msg) => msg.type === 'SHIELD_BLOCK'))).toBe(true);
    await expect.poll(() => match.b.evaluate(() =>
      window.__shieldMessages.some((msg) => msg.type === 'SHIELD_BLOCK'))).toBe(true);

    const [attackerPayload, defenderPayload] = await Promise.all([
      match.a.evaluate(() => window.__shieldMessages.find((msg) => msg.type === 'SHIELD_BLOCK')),
      match.b.evaluate(() => window.__shieldMessages.find((msg) => msg.type === 'SHIELD_BLOCK')),
    ]);
    expect(attackerPayload.isDefender).toBe(false);
    expect(defenderPayload.isDefender).toBe(true);
    await expect(match.b.locator('#shield-frame')).not.toHaveClass(/active|breaking/, { timeout: 1100 });
    await expect(match.a.locator('#shield-frame')).toHaveClass(/active/);
    await match.a.screenshot({ path: 'tests/screenshots/shield-dissolve-modern-explicit-false.png' });
  } finally {
    await match.close();
  }
});
