import { test, expect } from '@playwright/test';

test('자동 힌트는 한 타일→두 타일→1초 경로로 보이고 수동 힌트가 우선한다', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('sichuan:locale', 'ko'));
  await page.goto(`/?name=AutoHint-${Date.now()}&e2e=1&mode=ai`);
  await page.locator('#board .tile').first().waitFor();

  await expect.poll(() => page.locator('#board').getAttribute('data-auto-hint-stage'), { timeout: 11_000 }).toBe('1');
  await expect(page.locator('#board .tile.auto-hinted')).toHaveCount(1);
  await expect(page.locator('#hint-banner')).toHaveClass(/hidden/);

  await expect.poll(() => page.locator('#board').getAttribute('data-auto-hint-stage'), { timeout: 4_000 }).toBe('2');
  await expect(page.locator('#board .tile.auto-hinted')).toHaveCount(2);

  await expect.poll(() => page.locator('#board').getAttribute('data-auto-hint-stage'), { timeout: 4_000, intervals: [100] }).toBe('3');
  await expect(page.locator('#path-layer [data-layer="auto-hint"]')).toHaveCount(1);

  await page.evaluate(() => window.__sichuanTestSend({ type: 'TEST_GRANT_ITEM', itemId: 'hint' }));
  await page.locator('[data-item-id="hint"]').click();
  await expect(page.locator('#board .tile.auto-hinted')).toHaveCount(0);
  await expect(page.locator('#board .tile.hinted')).toHaveCount(2);
  await expect(page.locator('#path-layer [data-layer="auto-hint"]')).toHaveCount(0);
  await expect(page.locator('#path-layer [data-layer="hint"]')).toHaveCount(1);
  await expect(page.locator('#hint-banner')).not.toHaveClass(/hidden/);
});
