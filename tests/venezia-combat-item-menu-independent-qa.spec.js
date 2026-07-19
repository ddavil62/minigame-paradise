/**
 * @fileoverview 베네치아 전투 UI와 메뉴 복귀를 Chromium에서 독립 검증한다.
 */

import { test, expect } from '@playwright/test';

const GAME_URL = 'http://127.0.0.1:3019/venezia/?mode=ai';

test('게임 화면은 콘솔 오류 없이 표시되고 복귀 취소는 현재 세션을 유지한다', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror:${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console:${message.text()}`);
  });
  await page.goto(GAME_URL);
  await page.fill('#input-name', 'IndependentUIQA');
  await page.click('#btn-ai');
  await page.waitForSelector('#screen-game.active', { timeout: 15000 });

  const backButton = page.locator('#btn-back-to-lobby');
  await expect(backButton).toBeVisible();
  await expect(backButton).toHaveText('← 게임 선택');
  await expect(page.locator('#my-hp-value')).toHaveText('100');
  await expect(page.locator('#opp-hp-value')).toHaveText('100');

  page.once('dialog', (dialog) => dialog.dismiss());
  await backButton.click();
  await expect(page.locator('#screen-game')).toHaveClass(/active/);
  await expect(page.locator('#input-word')).toBeEnabled();

  await page.setViewportSize({ width: 390, height: 844 });
  const box = await backButton.boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.y).toBeGreaterThanOrEqual(0);
  await page.screenshot({ path: 'tests/screenshots/venezia-combat-menu-independent-390x844.png' });
  expect(errors).toEqual([]);
});
