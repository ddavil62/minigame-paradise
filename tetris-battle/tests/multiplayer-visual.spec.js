import { test, expect } from '@playwright/test';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('6인 대기 명단과 3x2 상대 보드 레이아웃', async ({ browser }) => {
  const app = createApp({ heartbeatIntervalMs: 0, getBotUrl: () => null });
  app.ensureRoom('visual-six');
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const contexts = [];
  const pages = [];

  try {
    for (let i = 1; i <= 6; i += 1) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      contexts.push(context);
      const page = await context.newPage();
      pages.push(page);
      await page.goto(`http://127.0.0.1:${port}/?room=visual-six&name=Player${i}`);
    }

    await expect(pages[0].locator('.waiting-player')).toHaveCount(6);
    await expect(pages[0].locator('.waiting-player').first()).toContainText('1. Player1');
    await expect(pages[0].locator('.waiting-player').last()).toContainText('6. Player6');

    for (const page of pages) await page.locator('#btn-ready').click();
    await expect(pages[0].locator('.game-main')).toBeVisible();
    await expect(pages[0].locator('.opponent-card')).toHaveCount(5);
    await expect(pages[0].locator('.opponent-item-slots')).toHaveCount(5);
    await expect(pages[0].locator('.opponent-item-slot')).toHaveCount(15);

    const cards = await pages[0].locator('.opponent-card').evaluateAll((elements) => elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
    }));
    expect(new Set(cards.map((card) => card.x)).size).toBe(3);
    expect(new Set(cards.map((card) => card.y)).size).toBe(2);
    const minimapResolution = await pages[0].locator('.opponent-card canvas').evaluateAll((canvases) => (
      canvases.map((canvas) => ({ width: canvas.width, height: canvas.height }))
    ));
    expect(minimapResolution).toEqual(Array.from({ length: 5 }, () => ({ width: 120, height: 240 })));
    await pages[0].screenshot({
      path: path.join(__dirname, 'screenshots', 'multiplayer-6p-3x2.png'),
      fullPage: true,
    });
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    await new Promise((resolve) => server.close(resolve));
  }
});

test('2인전은 내 보드와 상대 보드를 1대1 크기로 표시', async ({ browser }) => {
  const app = createApp({ heartbeatIntervalMs: 0, getBotUrl: () => null });
  app.ensureRoom('visual-two');
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const contexts = [];

  try {
    for (let i = 1; i <= 2; i += 1) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      contexts.push(context);
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:${port}/?room=visual-two&name=Duel${i}`);
    }
    const pages = contexts.map((context) => context.pages()[0]);
    await expect(pages[0].locator('.waiting-player')).toHaveCount(2);
    for (const page of pages) await page.locator('#btn-ready').click();
    await expect(pages[0].locator('.game-main')).toBeVisible();
    await expect(pages[0].locator('.opponent-card')).toHaveCount(1);
    await expect(pages[0].locator('.opponent-item-slot')).toHaveCount(3);
    await expect(pages[0].locator('.opponents-grid')).toHaveClass(/two-player/);

    const sizes = await pages[0].locator('.game-main').evaluate((element) => {
      const mine = element.querySelector('#board-canvas').getBoundingClientRect();
      const opponent = element.querySelector('.opponent-card canvas').getBoundingClientRect();
      return { mine: { width: mine.width, height: mine.height }, opponent: { width: opponent.width, height: opponent.height } };
    });
    expect(Math.round(sizes.opponent.width)).toBe(Math.round(sizes.mine.width));
    expect(Math.round(sizes.opponent.height)).toBe(Math.round(sizes.mine.height));
    const resolutions = await pages[0].locator('.game-main').evaluate((element) => {
      const mine = element.querySelector('#board-canvas');
      const opponent = element.querySelector('.opponent-card canvas');
      return {
        mine: { width: mine.width, height: mine.height },
        opponent: { width: opponent.width, height: opponent.height },
      };
    });
    expect(resolutions.opponent).toEqual(resolutions.mine);
    await pages[0].evaluate(async () => {
      const { createUI } = await import('/js/ui.js');
      const { BOARD_HEIGHT, BOARD_WIDTH } = await import('/js/board.js');
      const byId = (id) => document.getElementById(id);
      const testUI = createUI({
        boardCanvas: byId('board-canvas'),
        nextCanvas: byId('next-canvas'),
        holdCanvas: byId('hold-canvas'),
        opponentCanvas: byId('opponent-canvas'),
        scoreEl: byId('score'),
        levelEl: byId('level'),
        linesEl: byId('lines'),
        comboEl: byId('combo'),
        statusEl: byId('status-msg'),
        resultOverlay: byId('result-overlay'),
        resultText: byId('result-text'),
      });
      const cells = Array.from({ length: BOARD_HEIGHT }, () => Array(BOARD_WIDTH).fill(0));
      cells[BOARD_HEIGHT - 1] = Array.from({ length: BOARD_WIDTH }, (_, column) => (column % 2) + 1);
      cells[BOARD_HEIGHT - 2][2] = 3;
      cells[BOARD_HEIGHT - 2][3] = 3;
      testUI.renderBoard(cells, null, null);
      testUI.renderOpponent({ playerId: 'p2', cells, stack: [] });
      testUI.clearRoundVisuals();
      const sampleClearedCell = (canvas) => Array.from(canvas.getContext('2d').getImageData(15, 585, 1, 1).data);
      window.__clearedOpponentPixel = sampleClearedCell(byId('opponent-canvas'));
      testUI.animateItemAttack({
        attackId: 'visual-attack',
        itemId: 'freeze',
        attackerId: 'p1',
        targetId: 'p2',
        myPlayerId: 'p1',
      });
      testUI.resolveItemAttack({
        attackId: 'visual-attack',
        targetId: 'p2',
        blocked: false,
        myPlayerId: 'p1',
      });
    });
    const clearedOpponentPixel = await pages[0].evaluate(() => window.__clearedOpponentPixel);
    expect(clearedOpponentPixel).toEqual([26, 26, 46, 255]);
    await expect(pages[0].locator('.item-attack-flight')).toHaveCount(1);
    await pages[0].waitForTimeout(180);
    await pages[0].screenshot({
      path: path.join(__dirname, 'screenshots', 'item-attack-flight-2p.png'),
      fullPage: true,
    });
    await expect(pages[0].locator('.item-attack-flight')).toHaveCount(0, { timeout: 2000 });
    await pages[0].evaluate(async () => {
      const { createUI } = await import('/js/ui.js');
      const byId = (id) => document.getElementById(id);
      const testUI = createUI({
        boardCanvas: byId('board-canvas'),
        nextCanvas: byId('next-canvas'),
        holdCanvas: byId('hold-canvas'),
        opponentCanvas: byId('opponent-canvas'),
        scoreEl: byId('score'),
        levelEl: byId('level'),
        linesEl: byId('lines'),
        comboEl: byId('combo'),
        statusEl: byId('status-msg'),
        resultOverlay: byId('result-overlay'),
        resultText: byId('result-text'),
      });
      testUI.animateItemAttack({
        attackId: 'missing-result',
        itemId: 'dark',
        attackerId: 'p1',
        targetId: 'p2',
        myPlayerId: 'p1',
      });
    });
    await expect(pages[0].locator('.item-attack-flight')).toHaveCount(1);
    await expect(pages[0].locator('.item-attack-flight')).toHaveCount(0, { timeout: 3000 });
    await pages[0].screenshot({
      path: path.join(__dirname, 'screenshots', 'multiplayer-2p-equal-boards.png'),
      fullPage: true,
    });
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    await new Promise((resolve) => server.close(resolve));
  }
});
