import { test, expect } from '@playwright/test';

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:3111';

test('테트리스 레디 화면은 항상 1~6번 슬롯을 표시한다', async ({ page }) => {
  await page.goto(BASE_URL);
  await page.evaluate(() => localStorage.setItem('minigames:nickname', 'TetrisHost'));
  await page.goto(BASE_URL);
  await page.locator('.game-card[data-game-id="tetris-battle"]').click();

  await expect(page.locator('#waiting-room-view')).toBeVisible();
  await expect(page.locator('.player-ready-card')).toHaveCount(6);
  await expect(page.locator('.player-ready-card.empty-slot')).toHaveCount(5);
  await expect(page.locator('.tetris-player-slot .prc-role')).toHaveText(['1', '2', '3', '4', '5', '6']);
  await expect(page.locator('#wr-status')).toContainText('현재 1/6');
  await page.screenshot({ path: 'tests/screenshots/tetris-lobby-6p.png', fullPage: true });
});
