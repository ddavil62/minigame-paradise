import { test, expect } from '@playwright/test';
import http from 'node:http';
import { createApp } from '../server.js';

test('로봇 정비소의 레버형 밸브 차이를 실제 화면에서 찾는다', async ({ browser }) => {
  const app = createApp();
  app.prepareMatch('robot-garage-replacement');
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  try {
    const { port } = server.address();
    await page.goto(`http://127.0.0.1:${port}/?matchId=robot-garage-replacement&role=p1&name=검증`);
    await page.locator('.stage-card[data-stage-id="retro-comic-robot-garage-01"]').click();

    await expect(page.locator('#board')).toHaveAttribute('data-stage-id', 'retro-comic-robot-garage-01');
    await expect(page.locator('#image-b')).toHaveAttribute('src', 'assets/puzzles/retro-comic-robot-garage-01-b.png');
    await expect(page.locator('#image-b')).toBeVisible();

    const box = await page.locator('#image-b').boundingBox();
    expect(box).not.toBeNull();
    await page.locator('#image-b').click({ position: { x: box.width * 0.95, y: box.height * 0.49 } });

    await expect(page.locator('.progress-dot.found')).toHaveCount(1);
    await expect(page.locator('#toast')).toContainText('레버형으로 바뀐 파이프 밸브');
    await page.screenshot({ path: 'tests/screenshots/retro-comic-robot-garage-lever-found.png', fullPage: true });
  } finally {
    await context.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
