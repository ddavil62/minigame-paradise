import { test, expect } from '@playwright/test';
import http from 'node:http';
import { createApp } from '../server.js';

test('만화 작업실의 청록색 그림 자 차이를 실제 화면에서 찾는다', async ({ browser }) => {
  const app = createApp();
  app.prepareMatch('manga-studio-replacement');
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  try {
    const { port } = server.address();
    await page.goto(`http://127.0.0.1:${port}/?matchId=manga-studio-replacement&role=p1&name=검증`);
    await page.locator('.stage-card[data-stage-id="japanese-comics-manga-studio-01"]').click();

    await expect(page.locator('#board')).toHaveAttribute('data-stage-id', 'japanese-comics-manga-studio-01');
    await expect(page.locator('#image-b')).toHaveAttribute('src', 'assets/puzzles/japanese-comics-manga-studio-01-b.png');
    await expect(page.locator('#image-b')).toBeVisible();

    const box = await page.locator('#image-b').boundingBox();
    expect(box).not.toBeNull();
    await page.locator('#image-b').click({ position: { x: box.width * 0.30, y: box.height * 0.87 } });

    await expect(page.locator('.progress-dot.found')).toHaveCount(1);
    await expect(page.locator('#toast')).toContainText('청록색으로 바뀐 긴 그림 자');
    await page.screenshot({ path: 'tests/screenshots/japanese-comics-manga-studio-ruler-found.png', fullPage: true });
  } finally {
    await context.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
