import { test, expect } from '@playwright/test';
import http from 'node:http';
import { createApp } from '../server.js';

test('신고 #76의 소라 껍데기 좌표를 정답으로 판정한다', async ({ page }) => {
  const app = createApp();
  app.prepareMatch('coral-observatory-report-76');
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const { port } = server.address();
    await page.goto(`http://127.0.0.1:${port}/?matchId=coral-observatory-report-76&role=p1&name=QA`);
    await page.locator('.stage-card[data-stage-id="coral-observatory-01"]').click();

    const image = page.locator('#image-a');
    const box = await image.boundingBox();
    expect(box).not.toBeNull();

    await image.click({ position: { x: box.width * 0.8742, y: box.height * 0.4811 } });
    await expect(page.locator('.progress-dot.found')).toHaveCount(1);
  } finally {
    await page.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
