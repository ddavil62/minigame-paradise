/**
 * @fileoverview 실제 Canvas 루프가 15Hz 권위 좌표 사이의 중간 렌더 좌표를 만드는지 검증한다.
 */

import { expect, test } from '@playwright/test';

test('60Hz 렌더 좌표는 권위 스냅샷 좌표보다 촘촘하게 진행한다', async ({ browser }) => {
  const firstContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const secondContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const first = await firstContext.newPage();
  const second = await secondContext.newPage();
  await Promise.all([first.goto('/?name=InterpolationA'), second.goto('/?name=InterpolationB')]);
  await Promise.all([first.locator('#ready-button').click(), second.locator('#ready-button').click()]);
  await expect(first.locator('#ready-overlay')).toBeHidden();
  await expect(first.locator('body')).toHaveAttribute('data-server-tick', /[1-9]\d*/);

  await first.keyboard.down('KeyD');
  const samples = await first.evaluate(async () => {
    const canvas = document.querySelector('#game-canvas');
    const authority = new Set();
    const rendered = new Set();
    const frames = [];
    const startedAt = performance.now();
    await new Promise((resolve) => {
      /** @param {number} now rAF 시각 @returns {void} */
      function collect(now) {
        authority.add(document.body.dataset.playerX);
        rendered.add(Number(canvas.dataset.renderPlayerX).toFixed(3));
        frames.push(now);
        if (now - startedAt < 700) requestAnimationFrame(collect);
        else resolve();
      }
      requestAnimationFrame(collect);
    });
    return { authorityCount: authority.size, renderedCount: rendered.size, frameCount: frames.length, duration: frames.at(-1) - frames[0] };
  });
  await first.keyboard.up('KeyD');

  expect(samples.frameCount).toBeGreaterThan(20);
  expect(samples.duration).toBeGreaterThan(500);
  expect(samples.renderedCount).toBeGreaterThan(samples.authorityCount);
  await firstContext.close();
  await secondContext.close();
});
