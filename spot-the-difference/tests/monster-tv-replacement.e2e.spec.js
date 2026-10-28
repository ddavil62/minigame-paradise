import { test, expect } from '@playwright/test';
import http from 'node:http';
import { createApp } from '../server.js';

test('괴물 TV 스튜디오의 꺼진 조명 차이를 실제 화면에서 찾는다', async ({ browser }) => {
  const app = createApp();
  app.prepareMatch('monster-tv-replacement');
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  try {
    const { port } = server.address();
    await page.goto(`http://127.0.0.1:${port}/?matchId=monster-tv-replacement&role=p1&name=검증`);
    await page.locator('.stage-card[data-stage-id="retro-comic-monster-tv-studio-03"]').click();

    await expect(page.locator('#board')).toHaveAttribute('data-stage-id', 'retro-comic-monster-tv-studio-03');
    await expect(page.locator('#image-b')).toHaveAttribute('src', 'assets/puzzles/retro-comic-monster-tv-studio-03-b.png');
    await expect(page.locator('#image-b')).toBeVisible();

    const box = await page.locator('#image-b').boundingBox();
    expect(box).not.toBeNull();
    await page.locator('#image-b').click({ position: { x: box.width * 0.865, y: box.height * 0.155 } });

    await expect(page.locator('.progress-dot.found')).toHaveCount(1);
    await expect(page.locator('#toast')).toContainText('꺼진 오른쪽 스튜디오 조명');
    await page.screenshot({ path: 'tests/screenshots/retro-comic-monster-tv-lamp-found.png', fullPage: true });
  } finally {
    await context.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
