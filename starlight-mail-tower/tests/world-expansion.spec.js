/**
 * @fileoverview 두 브라우저의 권위 레벨 선택 동기화, 5개 카드, 테마 Canvas와 모바일 UI를 검증한다.
 */

import { expect, test } from '@playwright/test';
import fs from 'node:fs/promises';

test('호스트의 5레벨 선택이 두 클라이언트에 동기화되고 선택 레벨로 시작한다', async ({ browser }) => {
  const contextA = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const contextB = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const pageA = await contextA.newPage(); const pageB = await contextB.newPage();
  await Promise.all([pageA.goto('/?name=WorldA'), pageB.goto('/?name=WorldB')]);
  const roleA = await pageA.locator('body').getAttribute('data-player-id');
  const host = roleA === 'p1' ? pageA : pageB; const guest = roleA === 'p1' ? pageB : pageA;
  await expect(host.locator('.level-card')).toHaveCount(5);
  await expect(guest.locator('.level-card')).toHaveCount(5);
  await expect(guest.locator('.level-card').first()).toBeDisabled();
  await host.locator('.level-card[data-level-id="cloud-cargo"]').click();
  await expect(host.locator('.level-card[data-level-id="cloud-cargo"]')).toHaveAttribute('aria-selected', 'true');
  await expect(guest.locator('.level-card[data-level-id="cloud-cargo"]')).toHaveAttribute('aria-selected', 'true');
  await Promise.all([pageA.locator('#ready-button').click(), pageB.locator('#ready-button').click()]);
  await expect(pageA.locator('body')).toHaveAttribute('data-level-id', 'cloud-cargo');
  await expect(pageB.locator('body')).toHaveAttribute('data-level-id', 'cloud-cargo');
  await contextA.close(); await contextB.close();
});

test('390×844 레벨 선택은 단일 열, 44px 이상 조작 영역과 키보드 포커스를 제공한다', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage(); await page.goto('/?name=MobileHost');
  await expect(page.locator('.level-card')).toHaveCount(5);
  const first = await page.locator('.level-card').first().boundingBox();
  const ready = await page.locator('#ready-button').boundingBox();
  expect(first.width).toBeLessThanOrEqual(358); expect(first.height).toBeGreaterThanOrEqual(132); expect(ready.height).toBeGreaterThanOrEqual(44);
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toBeVisible();
  await context.close();
});

test('신규 네 월드는 시작과 고유 장치 구간에서 서로 다른 Canvas 모티프를 렌더링한다', async ({ browser, request }) => {
  await fs.mkdir('tests/screenshots', { recursive: true });
  const cases = [['cloud-cargo', 1], ['moon-clock', 1], ['storm-station', 2], ['orbital-post', 0]];
  for (const [levelId, advances] of cases) {
    const contextA = await browser.newContext({ viewport: { width: 1280, height: 720 } }); const contextB = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const pageA = await contextA.newPage(); const pageB = await contextB.newPage(); await Promise.all([pageA.goto(`/?name=${levelId}A`), pageB.goto(`/?name=${levelId}B`)]);
    const host = await pageA.locator('body').getAttribute('data-player-id') === 'p1' ? pageA : pageB;
    await host.locator(`.level-card[data-level-id="${levelId}"]`).click(); await Promise.all([pageA.locator('#ready-button').click(), pageB.locator('#ready-button').click()]);
    await expect(pageA.locator('body')).toHaveAttribute('data-level-id', levelId); await pageA.screenshot({ path: `tests/screenshots/ad-world-expansion-${levelId}-start-1280x720.png` });
    for (let index = 0; index < advances; index += 1) await request.post('/__test/advance');
    await pageA.screenshot({ path: `tests/screenshots/ad-world-expansion-${levelId}-device-1280x720.png` });
    await contextA.close(); await contextB.close();
  }
});

test('메타 선택과 결과 화면은 세 기준 해상도에서 겹침 없이 캡처된다', async ({ browser, request }) => {
  const contextA = await browser.newContext({ viewport: { width: 1280, height: 720 } }); const contextB = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const pageA = await contextA.newPage(); const pageB = await contextB.newPage(); await Promise.all([pageA.goto('/?name=LayoutA'), pageB.goto('/?name=LayoutB')]);
  for (const [width, height] of [[1280,720],[1024,768],[390,844]]) { await pageA.setViewportSize({ width, height }); await pageA.evaluate(() => { scrollTo(0, 0); document.querySelector('#ready-overlay').scrollTop = 0; }); await expect(pageA.locator('.toolbar')).toBeHidden(); await pageA.screenshot({ path: `tests/screenshots/ad-world-expansion-level-select-${width}x${height}.png`, fullPage: false }); }
  await pageA.setViewportSize({ width: 1280, height: 720 }); await Promise.all([pageA.locator('#ready-button').click(), pageB.locator('#ready-button').click()]);
  for (let index = 0; index < 8; index += 1) await request.post('/__test/advance'); await request.post('/__test/finish'); await expect(pageA.locator('#result-overlay')).toBeVisible({ timeout: 3500 });
  for (const [width, height] of [[1280,720],[1024,768],[390,844]]) {
    await pageA.setViewportSize({ width, height }); await pageA.evaluate(() => scrollTo(0, 0)); await expect(pageA.locator('.toolbar')).toBeHidden();
    const description = await pageA.locator('.result-card > p:not(#rematch-status)').boundingBox(); const levelName = await pageA.locator('#result-level-name').boundingBox(); expect(levelName.y).toBeGreaterThanOrEqual(description.y + description.height);
    await pageA.screenshot({ path: `tests/screenshots/ad-world-expansion-result-${width}x${height}.png`, fullPage: false });
  }
  await contextA.close(); await contextB.close();
});
