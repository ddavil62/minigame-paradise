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

    const cards = await pages[0].locator('.opponent-card').evaluateAll((elements) => elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
    }));
    expect(new Set(cards.map((card) => card.x)).size).toBe(3);
    expect(new Set(cards.map((card) => card.y)).size).toBe(2);
    await pages[0].screenshot({
      path: path.join(__dirname, 'screenshots', 'multiplayer-6p-3x2.png'),
      fullPage: true,
    });
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    await new Promise((resolve) => server.close(resolve));
  }
});
