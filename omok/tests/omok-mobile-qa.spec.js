/**
 * @fileoverview 오목 모바일 뷰포트 렌더 QA — 360x640.
 */
import { test, expect } from '@playwright/test';
const BASE = 'http://localhost:3077';

test.use({ viewport: { width: 360, height: 640 } });

test('모바일(360x640) 대기 화면 + 게임 화면 렌더', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/`);
  await expect(page.locator('#screen-waiting')).toBeVisible();
  await page.screenshot({ path: 'tests/screenshots/omok-mobile-waiting.png' });

  await page.goto(`${BASE}/?mode=ai`);
  await expect(page.locator('#screen-game')).toBeVisible({ timeout: 15000 });
  // Canvas가 뷰포트 폭(360)을 넘지 않는지(90vmin=324 기대).
  const box = await page.locator('#board-canvas').boundingBox();
  expect(box.width).toBeLessThanOrEqual(360);
  await page.screenshot({ path: 'tests/screenshots/omok-mobile-game.png' });
  expect(errors).toEqual([]);
});
