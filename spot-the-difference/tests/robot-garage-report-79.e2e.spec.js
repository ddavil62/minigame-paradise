import { test, expect } from '@playwright/test';
import http from 'node:http';
import { createApp } from '../server.js';

test('신고 #79의 오른쪽 미러는 복원되고 왼쪽 미러만 정답으로 유지된다', async ({ page }) => {
  const app = createApp();
  app.prepareMatch('robot-garage-report-79');
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const { port } = server.address();
    await page.goto(`http://127.0.0.1:${port}/?matchId=robot-garage-report-79&role=p1&name=QA`);
    await page.locator('.stage-card[data-stage-id="retro-comic-robot-garage-01"]').click();

    const image = page.locator('#image-b');
    await expect(page.locator('#board')).toHaveAttribute('data-stage-id', 'retro-comic-robot-garage-01');
    await expect(image).toBeVisible();
    await page.waitForFunction(() => {
      const target = document.querySelector('#image-b');
      return target?.complete && target.naturalWidth > 0;
    });
    const box = await image.boundingBox();
    expect(box).not.toBeNull();

    // 신고된 오른쪽 미러는 양쪽 그림에 모두 있으므로 더 이상 정답이 아니다.
    await image.click({ position: { x: box.width * 0.2493, y: box.height * 0.4701 } });
    await expect(page.locator('.progress-dot.found')).toHaveCount(0);

    // 의도된 차이인 왼쪽 미러 제거 판정은 그대로 유지한다.
    await image.click({ position: { x: box.width * 0.10, y: box.height * 0.49 } });
    await expect(page.locator('.progress-dot.found')).toHaveCount(1);

    await page.screenshot({ path: 'tests/screenshots/robot-garage-report-79-fixed.png', fullPage: true });
  } finally {
    await page.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
