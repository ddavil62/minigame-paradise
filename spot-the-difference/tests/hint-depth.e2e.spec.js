import { test, expect } from '@playwright/test';
import http from 'node:http';
import { createApp } from '../server.js';
import { PUZZLE } from '../game.js';

test('힌트 위치를 클릭하면 투명한 안내 링이 O 정답 마커로 전환된다', async ({ page }) => {
  const app = createApp();
  app.prepareMatch('hint-depth-test');
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const { port } = server.address();
    await page.goto(`http://127.0.0.1:${port}/?matchId=hint-depth-test&role=p1&name=QA`);
    await expect(page.locator('.stage-card')).toHaveCount(45);
    await expect(page.locator('.stage-collection')).toHaveCount(9);
    await expect(page.locator('.stage-collection[data-collection-id="moonlight-mystery"] .stage-card')).toHaveCount(5);
    await expect(page.locator('.stage-collection[data-collection-id="style-lab"] .stage-card')).toHaveCount(5);
    const nightMarketCard = page.locator('.stage-card[data-stage-id="night-market-01"]');
    await expect(nightMarketCard).toHaveCount(1);
    await page.screenshot({ path: 'tests/screenshots/stage-select-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: 'tests/screenshots/stage-select-mobile.png', fullPage: true });
    await nightMarketCard.click();
    await expect(page.locator('#connection-status')).toContainText('혼자 플레이 중');

    await page.locator('#hint-button').click();
    await expect(page.locator('.hint-marker')).toHaveCount(2);
    await expect(page.locator('.marker:not(.hint-marker)')).toHaveCount(0);
    await expect(page.locator('#progress-label')).toHaveText('0 / 5');
    await page.screenshot({ path: 'tests/screenshots/hint-depth-before-click.png', fullPage: true });

    const hintedMarker = page.locator('.picture[data-image="a"] .hint-marker');
    const position = await hintedMarker.evaluate((marker) => ({
      x: Number.parseFloat(marker.style.left) / 100,
      y: Number.parseFloat(marker.style.top) / 100,
    }));
    const stage = page.locator('.picture[data-image="a"] .image-stage');
    const box = await stage.boundingBox();
    await page.mouse.click(box.x + box.width * position.x, box.y + box.height * position.y);

    await expect(page.locator('.hint-marker')).toHaveCount(0);
    await expect(page.locator('.marker:not(.hint-marker)')).toHaveCount(2);
    await expect(page.locator('#progress-label')).toHaveText('1 / 5');
    await page.screenshot({ path: 'tests/screenshots/hint-depth-after-click.png', fullPage: true });
  } finally {
    await page.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('마지막 한 개의 힌트는 표시 후 실제 클릭해야 스테이지가 완료된다', async ({ page }) => {
  const app = createApp();
  app.prepareMatch('last-hint-test');
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const { port } = server.address();
    await page.goto(`http://127.0.0.1:${port}/?matchId=last-hint-test&role=p1&name=QA`);
    await page.locator('.stage-card[data-stage-id="night-market-01"]').click();
    const stage = page.locator('.picture[data-image="a"] .image-stage');
    const box = await stage.boundingBox();

    for (const difference of PUZZLE.differences.slice(0, -1)) {
      const zone = difference.zones.a;
      await page.mouse.click(
        box.x + box.width * (zone.x + zone.w / 2),
        box.y + box.height * (zone.y + zone.h / 2),
      );
    }

    await expect(page.locator('#progress-label')).toHaveText('4 / 5');
    await page.locator('#hint-button').click();
    await expect(page.locator('#result')).toBeHidden();
    await expect(page.locator('#progress-label')).toHaveText('4 / 5');
    await expect(page.locator('.hint-marker')).toHaveCount(2);
    await page.screenshot({ path: 'tests/screenshots/last-difference-hint-before-click.png', fullPage: true });

    const target = PUZZLE.differences.at(-1).zones.a;
    await page.mouse.click(
      box.x + box.width * (target.x + target.w / 2),
      box.y + box.height * (target.y + target.h / 2),
    );
    await expect(page.locator('#progress-label')).toHaveText('5 / 5');
    await expect(page.locator('#result')).toBeHidden();
    await expect(page.locator('#result')).toHaveClass(/result--win/);
    await expect(page.locator('#result')).toHaveAttribute('role', 'region');
    await expect(page.locator('#result')).not.toHaveAttribute('aria-modal', 'true');
    await expect(page.locator('.confetti')).toHaveCount(36);
    await expect(page.locator('#board')).toHaveClass(/celebrating/);
    await page.waitForTimeout(600);
    await page.screenshot({ path: 'tests/screenshots/completed-scene-hold.png', fullPage: true });
    await expect(page.locator('#result')).toBeVisible();
    await expect(page.locator('.confetti')).toHaveCount(0);
    await expect(page.locator('#result-title')).toHaveText('모두 찾았어요!');
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'tests/screenshots/completed-result-tray.png', fullPage: true });
  } finally {
    await page.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
