/**
 * @fileoverview 대기 화면에서 AI 게임 진행까지 검증하는 브라우저 E2E 테스트.
 *
 * 실행 전 `node server.js --port 3007`로 서버를 구동한다.
 */

import { test, expect } from 'playwright/test';

/**
 * 저장된 닉네임으로 페이지에 입장한다.
 * @param {import('playwright/test').Page} page 페이지
 */
async function enter(page) {
  await page.addInitScript(() => sessionStorage.setItem('hanabi:name', 'AI 테스터'));
  await page.goto('/');
  await expect(page.locator('#btn-start-ai')).toBeVisible();
}

test('AI CTA에서 게임을 시작하고 AI 행동 뒤 내 턴으로 돌아온다', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await enter(page);

  const button = page.locator('#btn-start-ai');
  await expect(button).toHaveAccessibleName('AI와 시작');
  await button.click();
  await expect(button).toHaveAttribute('aria-busy', 'true');

  await expect(page.locator('#screen-game')).toBeVisible();
  await expect(page.locator('#opponent-name-label')).toHaveText('별빛 AI');
  await expect(page.locator('#game-opponent-ai-badge')).toBeVisible();

  await page.locator('#btn-play').click();
  await page.locator('#my-hand .card').first().click();
  await expect(page.locator('#turn-label')).toHaveText('내 차례', { timeout: 2500 });
  expect(errors).toEqual([]);
});

for (const viewport of [
  { name: 'mobile-360', width: 360, height: 800 },
  { name: 'mobile-520', width: 520, height: 900 },
  { name: 'desktop', width: 1024, height: 768 },
]) {
  test(`${viewport.name}에서 CTA와 가이드가 겹치거나 가로 넘침이 없다`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await enter(page);
    const geometry = await page.evaluate(() => {
      const cta = document.querySelector('#btn-start-ai').getBoundingClientRect();
      const guide = document.querySelector('#guide-slider').getBoundingClientRect();
      return {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        cta: { left: cta.left, right: cta.right, bottom: cta.bottom },
        guide: { left: guide.left, right: guide.right, top: guide.top },
      };
    });
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
    expect(geometry.cta.left).toBeGreaterThanOrEqual(0);
    expect(geometry.cta.right).toBeLessThanOrEqual(viewport.width);
    expect(geometry.guide.left).toBeGreaterThanOrEqual(0);
    expect(geometry.guide.right).toBeLessThanOrEqual(viewport.width);
    expect(geometry.cta.bottom).toBeLessThanOrEqual(geometry.guide.top);
  });
}
