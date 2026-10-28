import { test, expect } from '@playwright/test';
import http from 'node:http';
import { createApp } from '../server.js';

test('산호 해저 관측소의 신고된 책상 위 원통을 제거하고 기존 정답은 유지한다', async ({ page }) => {
  const app = createApp();
  app.prepareMatch('coral-observatory-reported-laser-fix');
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const { port } = server.address();
    await page.goto(`http://127.0.0.1:${port}/?matchId=coral-observatory-reported-laser-fix&role=p1&name=QA`);
    await page.locator('.stage-card[data-stage-id="coral-observatory-01"]').click();

    await expect(page.locator('#board')).toHaveAttribute('data-stage-id', 'coral-observatory-01');
    await expect(page.locator('#image-a')).toHaveAttribute('src', 'assets/puzzles/coral-observatory-01-a.png');
    await expect(page.locator('#image-a')).toBeVisible();

    const image = page.locator('#image-a');
    const box = await image.boundingBox();
    expect(box).not.toBeNull();

    // 신고된 원통 위치는 더 이상 별도 차이가 아니며, 보라색 문어는 기존 정답으로 남는다.
    await image.click({ position: { x: box.width * 0.4320, y: box.height * 0.6365 } });
    await expect(page.locator('.progress-dot.found')).toHaveCount(0);
    await image.click({ position: { x: box.width * 0.50, y: box.height * 0.18 } });
    await expect(page.locator('.progress-dot.found')).toHaveCount(1);

    await page.screenshot({ path: 'tests/screenshots/coral-observatory-desk-cylinder-fixed.png', fullPage: true });
  } finally {
    await page.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
