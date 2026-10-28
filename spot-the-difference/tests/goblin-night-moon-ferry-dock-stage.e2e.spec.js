import { test, expect } from '@playwright/test';
import http from 'node:http';
import { createApp } from '../server.js';
import { getStage } from '../stages.js';

test('도깨비 밤 4단계를 선택하고 다섯 차이를 모두 판정한다', async ({ page }) => {
  const app = createApp();
  app.prepareMatch('goblin-night-moon-ferry-dock-stage');
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const { port } = server.address();
    await page.goto(`http://127.0.0.1:${port}/?matchId=goblin-night-moon-ferry-dock-stage&role=p1&name=QA`);
    const card = page.locator('.stage-collection[data-collection-id="goblin-night-village"] .stage-card[data-stage-id="goblin-night-moon-ferry-dock-04"]');
    await expect(card).toBeVisible();
    await card.click();

    await expect(page.locator('#board')).toHaveAttribute('data-stage-id', 'goblin-night-moon-ferry-dock-04');
    await expect(page.locator('#image-a')).toHaveAttribute('src', 'assets/puzzles/goblin-night-moon-ferry-dock-04-a.png');
    await expect(page.locator('#image-b')).toHaveAttribute('src', 'assets/puzzles/goblin-night-moon-ferry-dock-04-b.png');
    await page.waitForFunction(() => [...document.querySelectorAll('#image-a, #image-b')]
      .every((image) => image.complete && image.naturalWidth > 0));
    await page.screenshot({ path: 'tests/screenshots/goblin-night-moon-ferry-dock-04-gameplay.png', fullPage: true });

    const stage = getStage('goblin-night-moon-ferry-dock-04');
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
    await page.screenshot({ path: 'tests/screenshots/goblin-night-moon-ferry-dock-04-complete.png', fullPage: true });
  } finally {
    await page.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
