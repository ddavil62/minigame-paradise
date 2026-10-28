import { test, expect } from '@playwright/test';
import http from 'node:http';
import { createApp } from '../server.js';
import { getStage } from '../stages.js';

test('확장 26단계 블록 왕국 성문을 선택하고 다섯 차이를 모두 판정한다', async ({ page }) => {
  const app = createApp();
  app.prepareMatch('toy-kingdom-block-castle-stage');
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const { port } = server.address();
    await page.goto(`http://127.0.0.1:${port}/?matchId=toy-kingdom-block-castle-stage&role=p1&name=QA`);
    const collection = page.locator('.stage-collection[data-collection-id="toy-kingdom"]');
    const card = collection.locator('.stage-card[data-stage-id="toy-kingdom-block-castle-01"]');
    await expect(collection).toContainText('장난감 왕국 대모험');
    await expect(collection.locator('.stage-card')).toHaveCount(5);
    await expect(card).toBeVisible();
    await expect(card).toContainText('블록 왕국 성문');
    await card.click();

    await expect(page.locator('#board')).toHaveAttribute('data-stage-id', 'toy-kingdom-block-castle-01');
    await expect(page.locator('#image-a')).toHaveAttribute('src', 'assets/puzzles/toy-kingdom-block-castle-01-a-v2.png');
    await expect(page.locator('#image-b')).toHaveAttribute('src', 'assets/puzzles/toy-kingdom-block-castle-01-b.png');
    await page.waitForFunction(() => [...document.querySelectorAll('#image-a, #image-b')]
      .every((image) => image.complete && image.naturalWidth === 1536 && image.naturalHeight === 1024));
    await page.screenshot({ path: 'tests/screenshots/toy-kingdom-block-castle-01-gameplay.png', fullPage: true });

    const stage = getStage('toy-kingdom-block-castle-01');
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
    await page.screenshot({ path: 'tests/screenshots/toy-kingdom-block-castle-01-complete.png', fullPage: true });
  } finally {
    await page.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
