/** @fileoverview 최종 QA에서 다국어, 콘솔, 포커스와 세 뷰포트 렌더링을 독립 검증한다. */
import { test, expect } from '@playwright/test';

test('ko/en 두 브라우저에서 내부 ID 노출·콘솔 오류·레이아웃 교차 없이 포커스가 유지된다', async ({ browser }) => {
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const pages = await Promise.all(contexts.map(context => context.newPage()));
  const errors = [[], []]; pages.forEach((page, index) => { page.on('pageerror', error => errors[index].push(error.message)); page.on('console', message => { if (message.type() === 'error') errors[index].push(message.text()); }); });
  await pages[0].goto('/?name=한국검수&role=p1&locale=ko'); await pages[1].goto('/?name=EnglishQA&role=p2&locale=en');
  await Promise.all(pages.map(page => page.locator('#ready').click()));
  await expect(pages[0].locator('#game')).toBeFocused(); await expect(pages[1].locator('#game')).toBeFocused();
  for (const viewport of [{ width: 1280, height: 720 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
    await pages[0].setViewportSize(viewport); await pages[0].waitForTimeout(80);
    const metrics = await pages[0].evaluate(() => ({ body: document.body.getBoundingClientRect().toJSON(), scrollWidth: document.documentElement.scrollWidth, width: document.documentElement.clientWidth }));
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.width);
    await pages[0].screenshot({ path: `tests/screenshots/final-qa-play-${viewport.width}x${viewport.height}.png` });
  }
  await pages[0].locator('#launcher-button').click(); await expect(pages[0].locator('#keep-playing')).toBeFocused();
  await pages[0].keyboard.press('Shift+Tab'); await expect(pages[0].locator('#confirm-exit')).toBeFocused();
  await pages[0].keyboard.press('Tab'); await expect(pages[0].locator('#keep-playing')).toBeFocused();
  const koText = await pages[0].locator('body').innerText(); const enText = await pages[1].locator('body').innerText();
  for (const internal of ['mushroom_skewer', 'lantern_dumpling', 'comet_noodle', 'moon_mushroom']) { expect(koText).not.toContain(internal); expect(enText).not.toContain(internal); }
  expect(koText).toContain('런처로'); expect(enText).toContain('Launcher'); expect(errors).toEqual([[], []]);
  await Promise.all(contexts.map(context => context.close()));
});
