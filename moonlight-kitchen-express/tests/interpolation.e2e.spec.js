import { test, expect } from '@playwright/test';

test('15Hz 권위 스냅샷 사이를 rAF 렌더 프레임으로 보간한다', async ({ page }) => {
  await page.goto('/?name=SmoothnessQA');
  await page.locator('#solo').click();
  await expect.poll(() => page.evaluate(() => window.__kitchenState.snapshot.phase)).toBe('playing');
  await expect.poll(() => page.evaluate(() => window.__kitchenState.rendererDiagnostics().fps), { timeout: 5_000 }).toBeGreaterThanOrEqual(40);

  const samples = await page.evaluate(async () => {
    const values = [];
    for (let index = 0; index < 36; index += 1) {
      await new Promise(requestAnimationFrame);
      const p2 = window.__kitchenState.rendererPresentation().playerRects.find((player) => player.id === 'p2');
      values.push(p2?.x ?? null);
    }
    return values.filter(Number.isFinite);
  });
  const distinct = new Set(samples.map((value) => value.toFixed(2))).size;
  expect(distinct).toBeGreaterThan(8);
  expect(await page.locator('#game').getAttribute('data-render-fps')).toMatch(/^([4-9]\d|1\d\d)$/);
});
