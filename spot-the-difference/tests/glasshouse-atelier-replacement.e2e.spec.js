import { test, expect } from '@playwright/test';
import http from 'node:http';
import { createApp } from '../server.js';

test('유리온실 화실의 사라진 화구 바구니 손잡이를 실제 화면에서 찾는다', async ({ browser }) => {
  const app = createApp();
  app.prepareMatch('glasshouse-atelier-replacement');
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  try {
    const { port } = server.address();
    await page.goto(`http://127.0.0.1:${port}/?matchId=glasshouse-atelier-replacement&role=p1&name=검증`);
    await page.locator('.stage-card[data-stage-id="japanese-comics-glasshouse-atelier-05"]').click();

    await expect(page.locator('#board')).toHaveAttribute('data-stage-id', 'japanese-comics-glasshouse-atelier-05');
    await expect(page.locator('#image-b')).toHaveAttribute('src', 'assets/puzzles/japanese-comics-glasshouse-atelier-05-b.png');
    await expect(page.locator('#image-b')).toBeVisible();

    const box = await page.locator('#image-b').boundingBox();
    expect(box).not.toBeNull();
    await page.locator('#image-b').click({ position: { x: box.width * 0.26, y: box.height * 0.79 } });

    await expect(page.locator('.progress-dot.found')).toHaveCount(1);
    await expect(page.locator('#toast')).toContainText('사라진 화구 바구니 손잡이');
    await page.screenshot({ path: 'tests/screenshots/japanese-comics-glasshouse-atelier-basket-handle-found.png', fullPage: true });
  } finally {
    await context.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
