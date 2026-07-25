/**
 * @fileoverview 아이템 HUD의 세 뷰포트·ko/en 렌더와 강제 셔플 제거를 독립 시각 검증한다.
 */
import { test, expect } from '@playwright/test';

const cases = [
  { width: 1366, height: 768, locale: 'ko', name: 'qa-item-flow-1366-ko.png' },
  { width: 1024, height: 768, locale: 'en', name: 'qa-item-flow-1024-en.png' },
  { width: 390, height: 844, locale: 'ko', name: 'qa-item-flow-390-ko.png' },
  { width: 390, height: 844, locale: 'en', name: 'qa-item-flow-390-en.png' },
];

test('실제 UI의 세 슬롯을 250ms 안에 연타해 AI 상대에게 모두 적용한다', async ({ page }) => {
  await page.goto('/?name=Rapid-QA&e2e=1&mode=ai');
  await page.locator('#board .tile').first().waitFor();
  await page.waitForTimeout(3_100);
  for (const itemId of ['lock', 'flip', 'fog']) {
    await page.evaluate((id) => window.__sichuanTestSend({ type: 'TEST_GRANT_ITEM', itemId: id }), itemId);
  }
  await expect(page.locator('#inventory .item-slot:not(.empty)')).toHaveCount(3);
  const elapsed = await page.locator('#inventory').evaluate((root) => {
    const started = performance.now();
    for (const button of root.querySelectorAll('.item-slot:not(.empty)')) button.click();
    return performance.now() - started;
  });
  expect(elapsed).toBeLessThan(250);
  await expect(page.locator('#inventory .item-slot:not(.empty)')).toHaveCount(0);
  await expect(page.locator('#opponent-effects .effect-chip')).toHaveCount(3);
  await expect(page.locator('#opponent-board .tile.locked')).toHaveCount(6);
  await expect(page.locator('#opponent-board .tile.flipped')).toHaveCount(16);
  await expect(page.locator('#opponent-board .tile.fogged')).toHaveCount(18);
});

for (const scenario of cases) {
  test(`${scenario.width}×${scenario.height} ${scenario.locale} 아이템 HUD`, async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: scenario.width, height: scenario.height },
      locale: scenario.locale === 'ko' ? 'ko-KR' : 'en-US',
    });
    await context.addInitScript((locale) => localStorage.setItem('sichuan:locale', locale), scenario.locale);
    const page = await context.newPage();
    const pageErrors = [];
    const consoleErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error' && !message.text().includes('favicon.ico')) consoleErrors.push(message.text());
    });
    await page.goto(`/?name=Visual-${scenario.locale}&e2e=1&mode=ai`);
    await page.locator('#board .tile').first().waitFor();
    for (const itemId of ['hint', 'cleanse', 'shield']) {
      await page.evaluate((id) => window.__sichuanTestSend({ type: 'TEST_GRANT_ITEM', itemId: id }), itemId);
    }
    await expect(page.locator('#inventory .item-slot:not(.empty)')).toHaveCount(3);
    await expect(page.locator('[data-item-id="force_shuffle"]')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(/force shuffle|강제 셔플/i);
    const boxes = await page.evaluate(() => ({
      board: document.querySelector('.board-column').getBoundingClientRect().toJSON(),
      items: document.querySelector('.item-panel').getBoundingClientRect().toJSON(),
      opponent: document.querySelector('.opponent-panel').getBoundingClientRect().toJSON(),
      scrollWidth: document.documentElement.scrollWidth,
    }));
    if (scenario.width > 600) {
      expect(boxes.items.right).toBeLessThanOrEqual(boxes.board.left + 1);
      expect(boxes.board.right).toBeLessThanOrEqual(boxes.opponent.left + 1);
    } else {
      expect(boxes.board.bottom).toBeLessThanOrEqual(boxes.items.top + 1);
      expect(boxes.items.bottom).toBeLessThanOrEqual(boxes.opponent.top + 1);
    }
    expect(boxes.scrollWidth).toBeLessThanOrEqual(scenario.width);
    await page.screenshot({
      path: `tests/screenshots/${scenario.name}`,
      fullPage: scenario.width <= 600,
    });
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    await context.close();
  });
}
