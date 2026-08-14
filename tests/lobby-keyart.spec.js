import { test, expect } from '@playwright/test';

const expectedKeyArt = {
  'starlight-mail-tower': '/starlight-mail-tower/assets/key-art.webp',
  'moonlight-kitchen-express': '/moonlight-kitchen-express/assets/key-art.webp',
  'wordchain-battle': '/wordchain-battle/assets/key-art.webp',
};

test('generated lobby key art replaces the SVG card assets', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.locator('#nickname-input').fill('키아트QA');
  await page.locator('#btn-enter-lobby').click();
  await expect(page.locator('#portal-view')).toBeVisible();

  for (const [gameId, assetPath] of Object.entries(expectedKeyArt)) {
    const card = page.locator(`.game-card[data-game-id="${gameId}"]`);
    const image = card.locator('.game-card-keyart');

    await expect(card).toHaveCount(1);
    await expect(image).toHaveAttribute('src', assetPath);
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((element) => element.naturalWidth)).toBeGreaterThan(0);
  }

  await page.screenshot({
    path: `tests/screenshots/lobby-gpt-keyart-${testInfo.project.name}.png`,
    fullPage: true,
  });
});
