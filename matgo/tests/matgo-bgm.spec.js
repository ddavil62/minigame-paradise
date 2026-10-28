/** @fileoverview 맞고 신나는 BGM 자동 시작·토글·반응형 UI 브라우저 검증. */
import { test, expect } from 'playwright/test';

test.beforeEach(async ({ request }) => {
  await request.post('/test/reset').catch(() => {});
});

test('첫 사용자 입력부터 BGM이 재생되고 ON/OFF 설정이 저장된다', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/?name=BgmQA');

  const toggle = page.locator('#btn-bgm-toggle');
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveText('♫ BGM ON');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');

  await page.locator('.waiting-card').click({ position: { x: 30, y: 30 } });
  await page.waitForFunction(() => window.__matgoAudioDiagnostics?.engine?.bgmPlaying === true);
  const playing = await page.evaluate(() => window.__matgoAudioDiagnostics.engine);
  expect(playing.unlocked).toBe(true);
  expect(playing.activeMusicVoices).toBeGreaterThan(0);

  await toggle.click();
  await expect(toggle).toHaveText('♩ BGM OFF');
  expect(await page.evaluate(() => localStorage.getItem('matgo:bgm-enabled'))).toBe('false');
  expect(await page.evaluate(() => window.__matgoAudioDiagnostics.engine.bgmPlaying)).toBe(false);

  await toggle.click();
  await expect(toggle).toHaveText('♫ BGM ON');
  await page.waitForFunction(() => window.__matgoAudioDiagnostics?.engine?.bgmPlaying === true);
  expect(pageErrors).toEqual([]);
  await page.screenshot({ path: 'tests/screenshots/matgo-bgm-desktop.png', fullPage: true });
});

test('모바일에서 BGM 토글이 화면 안에 고정되고 대기 UI를 가리지 않는다', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?name=BgmMobile');
  const layout = await page.evaluate(() => {
    const toggle = document.querySelector('#btn-bgm-toggle').getBoundingClientRect();
    const card = document.querySelector('.waiting-card').getBoundingClientRect();
    return {
      toggle: { left: toggle.left, right: toggle.right, top: toggle.top, bottom: toggle.bottom },
      card: { left: card.left, right: card.right, top: card.top, bottom: card.bottom },
    };
  });
  expect(layout.toggle.left).toBeGreaterThanOrEqual(0);
  expect(layout.toggle.right).toBeLessThanOrEqual(390);
  const overlapWidth = Math.max(0, Math.min(layout.toggle.right, layout.card.right) - Math.max(layout.toggle.left, layout.card.left));
  const overlapHeight = Math.max(0, Math.min(layout.toggle.bottom, layout.card.bottom) - Math.max(layout.toggle.top, layout.card.top));
  expect(overlapWidth * overlapHeight).toBe(0);
  await page.screenshot({ path: 'tests/screenshots/matgo-bgm-mobile.png', fullPage: true });
});
