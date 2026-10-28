import { test, expect } from '@playwright/test';
import http from 'node:http';
import { createApp } from '../server.js';

test('빗소리 만화 작업실의 고양이 방울 위치를 통일하고 기존 정답은 유지한다', async ({ page }) => {
  const app = createApp();
  app.prepareMatch('manga-studio-reported-bell-fix');
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const { port } = server.address();
    await page.goto(`http://127.0.0.1:${port}/?matchId=manga-studio-reported-bell-fix&role=p1&name=QA`);
    await page.locator('.stage-card[data-stage-id="japanese-comics-manga-studio-01"]').click();

    await expect(page.locator('#board')).toHaveAttribute('data-stage-id', 'japanese-comics-manga-studio-01');
    await expect(page.locator('#image-b')).toHaveAttribute('src', 'assets/puzzles/japanese-comics-manga-studio-01-b.png');
    await expect(page.locator('#image-b')).toBeVisible();

    const image = page.locator('#image-b');
    const box = await image.boundingBox();
    expect(box).not.toBeNull();

    // 신고된 방울 위치는 양쪽에서 같고, 파란 자는 기존 정답으로 남는다.
    await image.click({ position: { x: box.width * 0.2345, y: box.height * 0.6501 } });
    await expect(page.locator('.progress-dot.found')).toHaveCount(0);
    await image.click({ position: { x: box.width * 0.30, y: box.height * 0.87 } });
    await expect(page.locator('.progress-dot.found')).toHaveCount(1);

    await page.screenshot({ path: 'tests/screenshots/japanese-comics-manga-studio-bell-fixed.png', fullPage: true });
  } finally {
    await page.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
