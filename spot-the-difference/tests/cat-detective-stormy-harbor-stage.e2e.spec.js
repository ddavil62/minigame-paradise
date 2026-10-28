import { test, expect } from '@playwright/test';
import http from 'node:http';
import { createApp } from '../server.js';
import { getStage } from '../stages.js';

test('확장 14단계 폭풍우 항구의 밀수품 추적을 선택하고 다섯 차이를 모두 판정한다', async ({ page }) => {
  const app = createApp();
  app.prepareMatch('cat-detective-stormy-harbor-stage');
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const { port } = server.address();
    await page.goto(`http://127.0.0.1:${port}/?matchId=cat-detective-stormy-harbor-stage&role=p1&name=QA`);
    const collection = page.locator('.stage-collection[data-collection-id="cat-detective-agency"]');
    const card = collection.locator('.stage-card[data-stage-id="cat-detective-stormy-harbor-04"]');
    await expect(collection).toContainText('고양이 탐정단');
    await expect(collection.locator('.stage-card')).toHaveCount(5);
    await expect(card).toBeVisible();
    await expect(card).toContainText('폭풍우 항구의 밀수품 추적');
    await card.click();

    await expect(page.locator('#board')).toHaveAttribute('data-stage-id', 'cat-detective-stormy-harbor-04');
    await expect(page.locator('#image-a')).toHaveAttribute('src', 'assets/puzzles/cat-detective-stormy-harbor-04-a.png');
    await expect(page.locator('#image-b')).toHaveAttribute('src', 'assets/puzzles/cat-detective-stormy-harbor-04-b.png');
    await page.waitForFunction(() => [...document.querySelectorAll('#image-a, #image-b')]
      .every((image) => image.complete && image.naturalWidth === 1536 && image.naturalHeight === 1024));
    await page.screenshot({ path: 'tests/screenshots/cat-detective-stormy-harbor-04-gameplay.png', fullPage: true });

    const stage = getStage('cat-detective-stormy-harbor-04');
    expect(stage.differences).toHaveLength(5);
    const imageStage = page.locator('.picture[data-image="a"] .image-stage');
    const box = await imageStage.boundingBox();
    expect(box).not.toBeNull();

    for (const difference of stage.differences) {
      const zone = difference.zones.a;
      await page.mouse.click(
        box.x + box.width * (zone.x + zone.w / 2),
        box.y + box.height * (zone.y + zone.h / 2),
      );
    }

    await expect(page.locator('#progress-label')).toHaveText('5 / 5');
    await expect(page.locator('.progress-dot.found')).toHaveCount(5);
    await page.screenshot({ path: 'tests/screenshots/cat-detective-stormy-harbor-04-complete.png', fullPage: true });
  } finally {
    await page.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
