import { test, expect } from '@playwright/test';
import http from 'node:http';
import { createApp } from '../server.js';
import { getStage } from '../stages.js';

async function completeStage(page, stageId) {
  const stage = getStage(stageId);
  const imageStage = page.locator('.picture[data-image="a"] .image-stage');
  const box = await imageStage.boundingBox();
  for (const difference of stage.differences) {
    await page.mouse.click(
      box.x + (difference.zones.a.x + difference.zones.a.w / 2) * box.width,
      box.y + (difference.zones.a.y + difference.zones.a.h / 2) * box.height,
    );
  }
  await expect(page.locator('#result-title')).toHaveText('모두 찾았어요!');
  await expect(page.locator('#result')).toBeVisible({ timeout: 5_000 });
}

test('클리어 화면에서 다음 및 랜덤 스테이지를 바로 시작한다', async ({ page }) => {
  const app = createApp();
  app.prepareMatch('result-stage-actions');
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const { port } = server.address();
    await page.goto(`http://127.0.0.1:${port}/?matchId=result-stage-actions&role=p1&name=방장`);
    await page.locator('.stage-card[data-stage-id="night-market-01"]').click();
    await completeStage(page, 'night-market-01');

    await expect(page.locator('#next-stage-button')).toBeEnabled();
    await expect(page.locator('#result-random-stage-button')).toBeEnabled();
    await page.screenshot({ path: 'tests/screenshots/result-stage-actions-desktop.png', fullPage: true });

    await page.locator('#next-stage-button').click();
    await expect(page.locator('#board')).toHaveAttribute('data-stage-id', 'moonlit-greenhouse-01');
    await completeStage(page, 'moonlit-greenhouse-01');

    await page.locator('#result-random-stage-button').click();
    await expect(page.locator('#board')).not.toHaveAttribute('data-stage-id', 'moonlit-greenhouse-01');
    await expect(page.locator('#result')).toBeHidden();
  } finally {
    await page.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
