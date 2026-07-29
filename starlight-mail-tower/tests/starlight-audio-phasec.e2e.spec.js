/**
 * @fileoverview 접근 가능한 오디오 설정의 저장과 반응형 배치를 검증한다.
 */

import { expect, test } from '@playwright/test';

test('오디오 패널은 키보드로 열리고 범위값과 음소거를 저장한다', async ({ page }) => {
  await page.goto('/?mode=ai&fresh=1');
  const settings = page.locator('#audio-settings-button');
  await settings.focus();
  await page.keyboard.press('Enter');
  await expect(settings).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#audio-panel')).toBeVisible();
  await expect(page.locator('#master-volume')).toBeFocused();

  await page.locator('#master-volume').fill('65');
  await expect(page.locator('#master-volume')).toHaveAttribute('aria-valuetext', '65%');
  await page.locator('#mute-button').click();
  await expect(page.locator('#mute-button')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => localStorage.getItem('starlight-volume'))).toBe('0.65');
  expect(await page.evaluate(() => localStorage.getItem('starlight-muted'))).toBe('true');

  await page.reload();
  await expect(page.locator('#master-volume')).toHaveValue('65');
  await expect(page.locator('#mute-button')).toHaveAttribute('aria-pressed', 'true');
});

for (const viewport of [
  { width: 360, height: 640 },
  { width: 520, height: 900 },
  { width: 1024, height: 576 },
  { width: 1280, height: 720 }
]) {
  test(`오디오 컨트롤이 ${viewport.width}x${viewport.height}에서 겹치거나 잘리지 않는다`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/?mode=ai&fresh=1');
    await page.locator('#audio-settings-button').click();
    const boxes = await page.locator('#topbar, #toast, #locale-button, #mute-button, #audio-settings-button, #audio-panel').evaluateAll(
      (elements) => elements.map((element) => {
        const box = element.getBoundingClientRect();
        return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
      })
    );
    for (const box of boxes) {
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(viewport.width);
      expect(box.top).toBeGreaterThanOrEqual(0);
      expect(box.bottom).toBeLessThanOrEqual(viewport.height);
      expect(box.height).toBeGreaterThanOrEqual(36);
    }
    const readyDimensions = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    }));
    expect(readyDimensions.scrollWidth).toBeLessThanOrEqual(readyDimensions.clientWidth);

    if (viewport.width === 360) {
      await page.screenshot({ path: 'tests/screenshots/audio-phasec-360-ready.png', fullPage: true });
      await page.locator('#audio-settings-button').click();
      await page.locator('#ready-button').click();
      await expect(page.locator('#ready-overlay')).toBeHidden({ timeout: 10_000 });
      const gameBoxes = await page.locator('#topbar, #toast, #locale-button, #mute-button, #audio-settings-button').evaluateAll(
        (elements) => elements.map((element) => {
          const box = element.getBoundingClientRect();
          return { left: box.left, right: box.right };
        })
      );
      for (const box of gameBoxes) {
        expect(box.left).toBeGreaterThanOrEqual(0);
        expect(box.right).toBeLessThanOrEqual(viewport.width);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
      await page.screenshot({ path: 'tests/screenshots/audio-phasec-360-game.png', fullPage: true });
    }
  });
}

for (const viewport of [{ width: 360, height: 640 }, { width: 520, height: 900 }]) {
  for (const locale of ['ko', 'en']) {
    test(`${viewport.width}px ${locale} ready/game 전체 UI가 viewport와 bottombar 안에 유지된다`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto('/?mode=ai&fresh=1');
      if (locale === 'en') await page.locator('#locale-button').click();

      /**
       * 현재 화면의 가로 경계와 하단 안내문 경계를 검사한다.
       * @returns {Promise<void>}
       */
      async function assertBounds() {
        const state = await page.evaluate(() => {
          const selectors = ['#topbar', '#toast', '#locale-button', '#mute-button', '#audio-settings-button'];
          const rects = selectors.map((selector) => {
            const box = document.querySelector(selector).getBoundingClientRect();
            return { selector, left: box.left, right: box.right, top: box.top, bottom: box.bottom };
          });
          const hint = document.querySelector('#action-hint').getBoundingClientRect();
          const bottom = document.querySelector('#bottombar').getBoundingClientRect();
          return {
            scrollWidth: document.documentElement.scrollWidth,
            clientWidth: document.documentElement.clientWidth,
            rects,
            hint: { top: hint.top, bottom: hint.bottom },
            bottom: { top: bottom.top, bottom: bottom.bottom }
          };
        });
        expect(state.scrollWidth).toBeLessThanOrEqual(state.clientWidth);
        for (const rect of state.rects) {
          expect(rect.left, rect.selector).toBeGreaterThanOrEqual(0);
          expect(rect.right, rect.selector).toBeLessThanOrEqual(viewport.width);
        }
        expect(state.hint.top).toBeGreaterThanOrEqual(state.bottom.top);
        expect(state.hint.bottom).toBeLessThanOrEqual(state.bottom.bottom);
      }

      await page.locator('#audio-settings-button').click();
      await assertBounds();
      await page.screenshot({ path: `tests/screenshots/audio-phasec-${viewport.width}-${locale}-ready.png`, fullPage: true });
      await page.locator('#audio-settings-button').click();
      await page.locator('#ready-button').click();
      await expect(page.locator('#ready-overlay')).toBeHidden({ timeout: 10_000 });
      await assertBounds();
      await page.screenshot({ path: `tests/screenshots/audio-phasec-${viewport.width}-${locale}-game.png`, fullPage: true });
    });
  }
}
