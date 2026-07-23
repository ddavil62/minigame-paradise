/**
 * @fileoverview 1366/1024 실제 렌더, GPT 에셋 응답, ko/en과 콘솔 오류를 독립 검증한다.
 */
import { test, expect } from '@playwright/test';

/** @param {import('@playwright/test').Page} page 화면 @param {number} width 너비 @returns {Promise<void>} */
async function assertViewport(page, width) {
  const layout = await page.locator('#game-view').boundingBox();
  const board = await page.locator('#board-frame').boundingBox();
  const item = await page.locator('.item-panel').boundingBox();
  expect(layout.x).toBeGreaterThanOrEqual(0);
  expect(layout.x + layout.width).toBeLessThanOrEqual(width);
  expect(board.x + board.width).toBeLessThanOrEqual(item.x);
  expect(await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }))).toEqual({ width, height: 768 });
}

test('1366·1024에서 GPT 에셋, ko/en, 레이아웃과 콘솔이 정상이다', async ({ browser, request }) => {
  for (const asset of ['/sichuan-battle/assets/backgrounds/sichuan-courtyard.webp', '/sichuan-battle/assets/tiles/tile-01.png', '/sichuan-battle/assets/tiles/tile-24.png']) {
    const response = await request.get(asset);
    expect(response.status(), asset).toBe(200);
  }
  for (const width of [1366, 1024]) {
    const contextA = await browser.newContext({ viewport: { width, height: 768 }, locale: 'ko-KR' });
    const contextB = await browser.newContext({ viewport: { width, height: 768 }, locale: 'ko-KR' });
    const a = await contextA.newPage(); const b = await contextB.newPage();
    const errors = [];
    for (const page of [a, b]) {
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    }
    await Promise.all([a.goto('/?name=QA-A&e2e=1'), b.goto('/?name=QA-B&e2e=1')]);
    await a.locator('.tile').first().waitFor(); await b.locator('.tile').first().waitFor();
    await assertViewport(a, width);
    await expect(a.locator('#board .tile')).toHaveCount(96);
    await expect(a.locator('#opponent-board .tile')).toHaveCount(96);
    await expect(a.locator('#board .tile').first()).toHaveCSS('background-image', /tile-\d+\.png/);
    await a.screenshot({ path: `tests/screenshots/qa-sichuan-${width}x768-ko.png`, fullPage: true });
    await a.locator('#language-button').click();
    await expect(a.locator('h1')).toHaveText('Sichuan Battle');
    await a.screenshot({ path: `tests/screenshots/qa-sichuan-${width}x768-en.png`, fullPage: true });
    expect(errors).toEqual([]);
    await contextA.close(); await contextB.close();
  }
});
