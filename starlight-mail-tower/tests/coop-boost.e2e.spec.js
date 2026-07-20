/**
 * @fileoverview 두 실제 브라우저 키 입력으로 협동 부스트의 동기 이벤트와 접근성·모션 피드백을 검증한다.
 */

import fs from 'node:fs/promises';
import { expect, test } from '@playwright/test';

/**
 * 로컬 스냅샷 X를 보며 짧은 실제 키 입력으로 목표 위치에 정렬한다.
 * @param {import('@playwright/test').Page} page 페이지
 * @param {number} targetX 목표 X
 * @returns {Promise<void>}
 */
async function alignAt(page, targetX) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const x = Number(await page.locator('body').getAttribute('data-player-x'));
    if (Math.abs(targetX - x) <= 8) return;
    const key = x < targetX ? 'KeyD' : 'KeyA';
    await page.keyboard.down(key); await page.waitForTimeout(42); await page.keyboard.up(key);
  }
  throw new Error(`실제 키 입력 정렬 실패: ${await page.locator('body').getAttribute('data-player-x')}`);
}

/**
 * 모션 환경 하나에서 양쪽 클라이언트의 동일 부스트 이벤트를 검증한다.
 * @param {import('@playwright/test').Browser} browser 브라우저
 * @param {boolean} reduced 감소 모션 여부
 * @param {{width:number,height:number}} viewport 뷰포트
 * @returns {Promise<void>}
 */
async function runBoostCase(browser, reduced, viewport) {
  const contextA = await browser.newContext({ viewport, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const contextB = await browser.newContext({ viewport, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const pageA = await contextA.newPage(); const pageB = await contextB.newPage();
  await Promise.all([pageA.goto('/?name=BoostA'), pageB.goto('/?name=BoostB')]);
  await fs.mkdir('tests/screenshots', { recursive: true });
  const sizeLabel = `${viewport.width}x${viewport.height}`;
  const readyCard = pageA.locator('.ready-card');
  const cardBox = await readyCard.boundingBox();
  for (const selector of ['.controls', '#ready-button', '#ready-note']) {
    const box = await pageA.locator(selector).boundingBox();
    expect(box.y + box.height).toBeLessThanOrEqual(cardBox.y + cardBox.height + 0.5);
  }
  expect(await readyCard.evaluate((element) => element.scrollHeight <= element.clientHeight)).toBe(true);
  await pageA.screenshot({ path: `tests/screenshots/coop-boost-ready-ko-${sizeLabel}.png` });
  await pageA.locator('#locale-button').dispatchEvent('click');
  await expect(pageA.locator('.controls')).toContainText('airborne partner');
  await pageA.screenshot({ path: `tests/screenshots/coop-boost-ready-en-${sizeLabel}.png` });
  await pageA.locator('#locale-button').dispatchEvent('click');
  await Promise.all([pageA.locator('#ready-button').click(), pageB.locator('#ready-button').click()]);
  await expect(pageA.locator('#action-hint-text')).toContainText('협동 부스트');
  const roleA = await pageA.locator('body').getAttribute('data-player-id');
  const p1 = roleA === 'p1' ? pageA : pageB; const p2 = roleA === 'p2' ? pageA : pageB;
  await alignAt(p1, 245); await alignAt(p2, 245);
  await p1.keyboard.down('Space'); await p1.waitForTimeout(50); await p1.keyboard.up('Space');
  await p1.waitForTimeout(115);
  await p2.keyboard.down('Space'); await p2.waitForTimeout(50); await p2.keyboard.up('Space');
  await expect(pageA.locator('#game-canvas')).toHaveAttribute('data-boost-event-id', /\d+/, { timeout: 2000 });
  await expect(pageB.locator('#game-canvas')).toHaveAttribute('data-boost-event-id', await pageA.locator('#game-canvas').getAttribute('data-boost-event-id'));
  await expect(pageA.locator('#toast')).toContainText('협동 부스트 성공');
  await expect(pageA.locator('#game-canvas')).toHaveAttribute('data-boost-effect', reduced ? 'reduced' : 'active');
  const toastBox = await pageA.locator('#toast').boundingBox();
  const hintBox = await pageA.locator('#action-hint').boundingBox();
  expect(hintBox.y - (toastBox.y + toastBox.height)).toBeGreaterThanOrEqual(4);
  await pageA.screenshot({ path: `tests/screenshots/coop-boost-${reduced ? 'reduced-1024x576' : 'normal-1280x720'}.png` });
  await Promise.all([contextA.close(), contextB.close()]);
}

test('두 브라우저의 실제 Space 입력이 일반·감소 모션 부스트를 동일하게 재생한다', async ({ browser }) => {
  await runBoostCase(browser, false, { width: 1280, height: 720 });
  await runBoostCase(browser, true, { width: 1024, height: 576 });
});
