/**
 * @fileoverview 힌트 안내 행과 비시간제 효과 칩의 반응형 회귀를 검증한다.
 */
import { test, expect } from '@playwright/test';

test('힌트 안내는 보드 밖 상태 행에 표시되고 효과 칩은 연결 시점 종료를 알린다', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('sichuan:locale', 'ko'));
  await page.goto(`/?name=HintLayout-${Date.now()}&e2e=1&mode=ai`);
  await page.locator('#board .tile').first().waitFor();
  await page.waitForTimeout(3150);
  await page.evaluate(() => window.__sichuanTestSend({ type: 'TEST_GRANT_ITEM', itemId: 'hint' }));
  await page.locator('[data-item-id="hint"]').click();

  await expect(page.locator('#hint-status')).toHaveCount(0);
  await expect(page.locator('#board-feedback')).toContainText('힌트 ① → ②');
  await expect(page.locator('#my-effects [data-effect-id]')).toContainText('연결할 때까지');
  await expect(page.locator('#my-effects time')).toHaveCount(0);

  for (const viewport of [{ width: 1366, height: 768 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const boxes = await page.evaluate(() => {
      const frame = document.querySelector('#board-frame').getBoundingClientRect();
      const feedback = document.querySelector('#board-feedback').getBoundingClientRect();
      return { frameBottom: frame.bottom, feedbackTop: feedback.top, scrollWidth: document.documentElement.scrollWidth };
    });
    expect(boxes.feedbackTop - boxes.frameBottom).toBeGreaterThanOrEqual(4);
    expect(boxes.scrollWidth).toBeLessThanOrEqual(viewport.width);
  }

  await page.locator('#language-button').click();
  await expect(page.locator('#board-feedback')).toContainText('Hint ① → ②');
  await expect(page.locator('#my-effects [data-effect-id]')).toContainText('Until matched');
});
