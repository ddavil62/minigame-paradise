/**
 * @fileoverview 1브라우저 AI 진입, 실제 진행, 아이템 효과와 재대결 UI를 검증한다.
 */
import { test, expect } from '@playwright/test';

test('mode=ai 한 명 진입으로 보통 AI 경기와 재대결이 동작한다', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('sichuan:locale', 'ko'));
  await page.goto('/?name=SoloTester&e2e=1'); await expect(page.locator('#ai-battle-button')).toBeVisible();
  await page.screenshot({ path: 'tests/screenshots/ai-waiting-1366x768-ko.png', fullPage: true });
  await page.locator('#language-button').click(); await page.screenshot({ path: 'tests/screenshots/ai-waiting-1366x768-en.png', fullPage: true });
  await page.setViewportSize({ width: 1024, height: 768 }); await page.screenshot({ path: 'tests/screenshots/ai-waiting-1024x768-en.png', fullPage: true });
  await page.locator('#language-button').click(); await page.screenshot({ path: 'tests/screenshots/ai-waiting-1024x768-ko.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: 'tests/screenshots/ai-waiting-390x844-ko.png', fullPage: true });
  await page.locator('#language-button').click(); await page.screenshot({ path: 'tests/screenshots/ai-waiting-390x844-en.png', fullPage: true });
  await page.setViewportSize({ width: 1366, height: 768 }); await page.locator('#language-button').click(); await page.locator('#ai-battle-button').click();
  await expect(page.locator('#opponent-ai-badge')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('#opponent-name')).toHaveText(/사천 현자 AI|Sichuan Sage AI/);
  await page.locator('.tile').first().waitFor(); await page.waitForTimeout(3200);
  await expect.poll(async () => Number(await page.locator('#opponent-score').textContent()), { timeout: 8000 }).toBeGreaterThan(0);
  await page.evaluate(() => window.__sichuanTestSend({ type: 'TEST_GRANT_ITEM', itemId: 'fog' }));
  await page.locator('[data-item-id="fog"]').click(); await expect(page.locator('#opponent-effects .effect-chip')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ko'); await expect(page.locator('#opponent-name')).toHaveText('사천 현자 AI');
  await page.screenshot({ path: 'tests/screenshots/ai-mode-1366x768-ko.png', fullPage: true });
  await page.locator('#language-button').click(); await expect(page.locator('html')).toHaveAttribute('lang', 'en'); await expect(page.locator('#opponent-name')).toHaveText('Sichuan Sage AI');
  await page.screenshot({ path: 'tests/screenshots/ai-mode-1366x768-en.png', fullPage: true });
  await page.setViewportSize({ width: 1024, height: 768 }); await page.screenshot({ path: 'tests/screenshots/ai-mode-1024x768-en.png', fullPage: true });
  const nameBox = await page.locator('#opponent-name').boundingBox(); const badgeBox = await page.locator('#opponent-ai-badge').boundingBox(); expect(Math.abs(nameBox.y - badgeBox.y)).toBeLessThan(18);
  await page.locator('#language-button').click(); await expect(page.locator('html')).toHaveAttribute('lang', 'ko'); await page.screenshot({ path: 'tests/screenshots/ai-mode-1024x768-ko.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'tests/screenshots/ai-mode-390x844-ko.png', fullPage: true });
  await page.locator('#toast').evaluate((node) => { node.textContent = '상태 알림'; node.classList.add('show'); }); const toastBox = await page.locator('#toast').boundingBox(); const legendBox = await page.locator('.legend').boundingBox(); expect(toastBox.y + toastBox.height).toBeLessThan(legendBox.y); await page.locator('#toast').evaluate((node) => node.classList.remove('show'));
  await page.locator('#language-button').click(); await expect(page.locator('html')).toHaveAttribute('lang', 'en'); await page.screenshot({ path: 'tests/screenshots/ai-mode-390x844-en.png', fullPage: true });
  const oldMatchId = await page.evaluate(() => window.__sichuanTestSnapshot().matchId);
  await page.locator('#language-button').click(); await expect(page.locator('html')).toHaveAttribute('lang', 'ko');
  await page.evaluate(() => window.__sichuanTestSend({ type: 'TEST_FINISH_MATCH' })); await expect(page.locator('#result-view')).toBeVisible(); await expect(page.locator('#rematch-button')).toHaveText(/AI|다시/);
  await page.locator('#rematch-button').click(); await expect.poll(async () => page.evaluate(() => window.__sichuanTestSnapshot()?.matchId), { timeout: 5000 }).not.toBe(oldMatchId);
  await expect(page.locator('#countdown')).toBeVisible(); await expect(page.locator('#toast')).not.toHaveClass(/show/); await expect(page.locator('#board-frame')).toBeVisible();
  await page.screenshot({ path: 'tests/screenshots/ai-rematch-countdown-390x844-ko.png', fullPage: true });
  await page.locator('#language-button').click(); await page.screenshot({ path: 'tests/screenshots/ai-rematch-countdown-390x844-en.png', fullPage: true });
  await page.setViewportSize({ width: 1024, height: 768 }); await page.screenshot({ path: 'tests/screenshots/ai-rematch-countdown-1024x768-en.png', fullPage: true });
  await page.locator('#language-button').click(); await page.screenshot({ path: 'tests/screenshots/ai-rematch-countdown-1024x768-ko.png', fullPage: true });
  await page.setViewportSize({ width: 1366, height: 768 }); await page.screenshot({ path: 'tests/screenshots/ai-rematch-countdown-1366x768-ko.png', fullPage: true });
  await page.locator('#language-button').click(); await page.screenshot({ path: 'tests/screenshots/ai-rematch-countdown-1366x768-en.png', fullPage: true });
  await page.evaluate(() => window.__sichuanTestSend({ type: 'LEAVE_MATCH' }));
});
