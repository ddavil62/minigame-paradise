/**
 * @fileoverview Phase B 의미 오디오 연결과 자동 재생 정책을 브라우저에서 검증한다.
 */

import { expect, test } from '@playwright/test';

test('첫 제스처 unlock과 준비 UI 의미 효과음을 fake engine에 전달한다', async ({ page }) => {
  await page.addInitScript(() => {
    const calls = [];
    window.__audioSpy = calls;
    window.__STARLIGHT_AUDIO_FACTORY__ = () => ({
      unlock: async () => { calls.push(['unlock']); return true; },
      setMuted: (value) => calls.push(['setMuted', value]),
      setVolume: (value) => calls.push(['setVolume', value]),
      setScene: (value) => calls.push(['setScene', value]),
      playSfx: (key, metadata) => { calls.push(['playSfx', key, metadata]); return true; },
      observeSnapshot: (_snapshot, id) => calls.push(['observeSnapshot', id]),
      suspendForVisibility: async () => true,
      getDiagnostics: () => ({ calls: [...calls] }),
      destroy: async () => calls.push(['destroy'])
    });
  });

  await page.goto('/?mode=ai&fresh=1');
  await expect(page.locator('#ready-button')).toBeVisible();
  expect(await page.evaluate(() => window.__audioSpy.filter(([kind]) => kind === 'unlock').length)).toBe(0);

  await page.locator('#ready-button').click();
  await expect.poll(() => page.evaluate(() => window.__audioSpy.some(
    ([kind, key]) => kind === 'playSfx' && key === 'ui.confirm'
  ))).toBe(true);
  expect(await page.evaluate(() => window.__audioSpy.filter(([kind]) => kind === 'unlock').length)).toBe(1);
  expect(await page.evaluate(() => window.__audioSpy.some(
    ([kind, scene]) => kind === 'setScene' && scene === 'menu'
  ))).toBe(true);
});

test('서버 스냅샷과 시작 상태를 semantic API에 연결한다', async ({ page }) => {
  await page.addInitScript(() => {
    const calls = [];
    window.__audioSpy = calls;
    window.__STARLIGHT_AUDIO_FACTORY__ = () => ({
      unlock: async () => true,
      setMuted() {},
      setVolume() {},
      setScene: (scene) => calls.push(['scene', scene]),
      playSfx: (key, metadata) => { calls.push(['sfx', key, metadata]); return true; },
      observeSnapshot: (_snapshot, id) => calls.push(['snapshot', id]),
      suspendForVisibility: async () => true,
      getDiagnostics: () => ({ calls: [...calls] }),
      destroy: async () => {}
    });
  });

  await page.goto('/?mode=ai&fresh=1');
  await page.locator('#ready-button').click();
  await expect.poll(() => page.evaluate(() => window.__audioSpy.some(
    ([kind, scene]) => kind === 'scene' && scene === 'play'
  )), { timeout: 5_000 }).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__audioSpy.some(
    ([kind]) => kind === 'snapshot'
  )), { timeout: 5_000 }).toBe(true);
});
