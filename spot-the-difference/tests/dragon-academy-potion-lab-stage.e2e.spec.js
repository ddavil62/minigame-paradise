import { test, expect } from '@playwright/test';
import http from 'node:http';
import { createApp } from '../server.js';
import { getStage } from '../stages.js';

test('확장 33단계 별빛 물약 실험 수업을 선택하고 다섯 차이를 모두 판정한다', async ({ page }) => {
  const app = createApp();
  app.prepareMatch('dragon-academy-potion-lab-stage');
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const { port } = server.address();
    await page.goto(`http://127.0.0.1:${port}/?matchId=dragon-academy-potion-lab-stage&role=p1&name=QA`);
    const collection = page.locator('.stage-collection[data-collection-id="dragon-academy"]');
    const card = collection.locator('.stage-card[data-stage-id="dragon-academy-potion-lab-03"]');
    await expect(collection).toContainText('꼬마 용 마법학교 대모험');
    await expect(collection.locator('.stage-card')).toHaveCount(5);
    await expect(card).toBeVisible();
    await expect(card).toContainText('별빛 물약 실험 수업');
    await page.locator('.difficulty-option[data-rule-type="speed"]').click();
    await expect(page.locator('.difficulty-option[data-rule-type="speed"]')).toHaveAttribute('aria-pressed', 'true');
    await card.click();

    await expect(page.locator('#board')).toHaveAttribute('data-stage-id', 'dragon-academy-potion-lab-03');
    await expect(page.locator('#image-a')).toHaveAttribute('src', 'assets/puzzles/dragon-academy-potion-lab-03-a.png');
    await expect(page.locator('#image-b')).toHaveAttribute('src', 'assets/puzzles/dragon-academy-potion-lab-03-b-balanced.png');
    await expect(page.locator('#active-rule')).toContainText('어려움');
    await expect(page.locator('#hint-count')).toHaveText('1');
    await page.waitForFunction(() => [...document.querySelectorAll('#image-a, #image-b')]
      .every((image) => image.complete && image.naturalWidth === 1536 && image.naturalHeight === 1024));
    await page.screenshot({ path: 'tests/screenshots/dragon-academy-potion-lab-03-gameplay.png', fullPage: true });

    const stage = getStage('dragon-academy-potion-lab-03');
    expect(stage.differences).toHaveLength(5);
    expect(stage.differences.map(({ id }) => id)).toEqual([
      'purple-potion-cork',
      'silver-crescent-badge',
      'four-point-cauldron-star',
      'blue-right-scale-crystal',
      'triangular-spellbook-clasp',
    ]);

    for (const [index, difference] of stage.differences.entries()) {
      const image = index % 2 === 0 ? 'a' : 'b';
      const imageStage = page.locator(`.picture[data-image="${image}"] .image-stage`);
      const box = await imageStage.boundingBox();
      expect(box).not.toBeNull();
      const zone = difference.zones[image];
      await page.mouse.click(
        box.x + box.width * (zone.x + zone.w / 2),
        box.y + box.height * (zone.y + zone.h / 2),
      );
    }

    await expect(page.locator('#progress-label')).toHaveText('5 / 5');
    await expect(page.locator('.progress-dot.found')).toHaveCount(5);
    await page.screenshot({ path: 'tests/screenshots/dragon-academy-potion-lab-03-complete.png', fullPage: true });
  } finally {
    await page.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
