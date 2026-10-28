import { test, expect } from '@playwright/test';
import http from 'node:http';
import { createApp } from '../server.js';

test('눈꽃 장난감 가게의 신고된 기차 칸 색을 통일하고 기존 정답은 유지한다', async ({ page }) => {
  const app = createApp();
  app.prepareMatch('snowy-toyshop-reported-difference-fix');
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const { port } = server.address();
    await page.goto(`http://127.0.0.1:${port}/?matchId=snowy-toyshop-reported-difference-fix&role=p1&name=QA`);
    await page.locator('.stage-card[data-stage-id="snowy-toyshop-01"]').click();

    await expect(page.locator('#board')).toHaveAttribute('data-stage-id', 'snowy-toyshop-01');
    await expect(page.locator('#image-b')).toHaveAttribute('src', 'assets/puzzles/snowy-toyshop-01-b.png');
    await expect(page.locator('#image-b')).toBeVisible();

    const image = page.locator('#image-b');
    const box = await image.boundingBox();
    expect(box).not.toBeNull();

    // 신고 위치는 더 이상 별도 차이가 아니며, 위 선반의 보라색 기차 칸은 기존 정답으로 남는다.
    await image.click({ position: { x: box.width * 0.5868, y: box.height * 0.4965 } });
    await expect(page.locator('.progress-dot.found')).toHaveCount(0);
    await image.click({ position: { x: box.width * 0.755, y: box.height * 0.345 } });
    await expect(page.locator('.progress-dot.found')).toHaveCount(1);

    await page.screenshot({ path: 'tests/screenshots/snowy-toyshop-counter-car-fixed.png', fullPage: true });
  } finally {
    await page.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
