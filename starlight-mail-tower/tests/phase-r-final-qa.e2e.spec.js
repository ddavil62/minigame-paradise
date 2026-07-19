/**
 * @fileoverview 보완 페이즈 R의 5레벨 실로드, 비기본 레벨 재접속, 기준 해상도 경계를 독립 검증한다.
 */

import { expect, test } from '@playwright/test';

/**
 * 두 브라우저로 게임에 참가하고 호스트/게스트를 구분한다.
 * @param {import('@playwright/test').Browser} browser 브라우저
 * @param {string} suffix 테스트 이름 접미사
 * @returns {Promise<object>}
 */
async function connectPair(browser, suffix) {
  const contextA = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const contextB = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  await Promise.all([pageA.goto(`/?name=PhaseR${suffix}A`), pageB.goto(`/?name=PhaseR${suffix}B`)]);
  const roleA = await pageA.locator('body').getAttribute('data-player-id');
  return { contextA, contextB, pageA, pageB, host: roleA === 'p1' ? pageA : pageB, guest: roleA === 'p1' ? pageB : pageA };
}

test('두 브라우저가 다섯 레벨을 순서대로 실로드하고 결과 통계와 SELECT 복귀를 공유한다', async ({ browser, request }) => {
  const pair = await connectPair(browser, 'Cycle');
  const levelIds = ['starlight-tower', 'cloud-cargo', 'moon-clock', 'storm-station', 'orbital-post'];
  try {
    for (const levelId of levelIds) {
      await pair.host.locator(`.level-card[data-level-id="${levelId}"]`).click();
      await expect(pair.guest.locator(`.level-card[data-level-id="${levelId}"]`)).toHaveAttribute('aria-selected', 'true');
      await Promise.all([pair.pageA.locator('#ready-button').click(), pair.pageB.locator('#ready-button').click()]);
      await Promise.all([
        expect(pair.pageA.locator('body')).toHaveAttribute('data-level-id', levelId),
        expect(pair.pageB.locator('body')).toHaveAttribute('data-level-id', levelId),
      ]);
      for (let index = 0; index < 8; index += 1) await request.post('/__test/advance');
      await expect(pair.pageA.locator('body')).toHaveAttribute('data-checkpoint', '8');
      await request.post('/__test/finish');
      await Promise.all([expect(pair.pageA.locator('#result-overlay')).toBeVisible(), expect(pair.pageB.locator('#result-overlay')).toBeVisible()]);
      for (const selector of ['#result-time', '#result-best', '#result-falls', '#result-swaps']) await expect(pair.pageA.locator(selector)).toBeVisible();
      await Promise.all([pair.pageA.locator('#lobby-button').click(), pair.pageB.locator('#lobby-button').click()]);
      await Promise.all([expect(pair.pageA.locator('#ready-overlay')).toBeVisible(), expect(pair.pageB.locator('#ready-overlay')).toBeVisible()]);
    }
  } finally {
    await pair.contextA.close();
    await pair.contextB.close();
  }
});

test('비기본 궤도 레벨 재접속이 역할·레벨·5번 체크포인트를 함께 복구한다', async ({ browser, request }) => {
  const pair = await connectPair(browser, 'Resume');
  let replacement;
  try {
    await pair.host.locator('.level-card[data-level-id="orbital-post"]').click();
    await Promise.all([pair.pageA.locator('#ready-button').click(), pair.pageB.locator('#ready-button').click()]);
    for (let index = 0; index < 5; index += 1) await request.post('/__test/advance');
    await expect(pair.pageA.locator('body')).toHaveAttribute('data-checkpoint', '5');
    const role = await pair.pageB.locator('body').getAttribute('data-player-id');
    await pair.pageB.close();
    await expect(pair.pageA.locator('#reconnect-overlay')).toBeVisible();
    replacement = await pair.contextB.newPage();
    await replacement.goto('/?name=PhaseRResumeB');
    await expect(replacement.locator('body')).toHaveAttribute('data-player-id', role);
    await expect(replacement.locator('body')).toHaveAttribute('data-level-id', 'orbital-post');
    await expect(replacement.locator('body')).toHaveAttribute('data-checkpoint', '5');
  } finally {
    await pair.contextA.close();
    await pair.contextB.close();
  }
});

test('1280×720·1024×768·390×844 선택/결과 화면은 경계를 넘지 않고 콘솔 오류가 없다', async ({ browser, request }) => {
  const pair = await connectPair(browser, 'Viewport');
  const errors = [];
  for (const page of [pair.pageA, pair.pageB]) {
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  }
  try {
    for (const [width, height] of [[1280, 720], [1024, 768], [390, 844]]) {
      await pair.pageA.setViewportSize({ width, height });
      const card = await pair.pageA.locator('.ready-card').boundingBox();
      expect(card.x).toBeGreaterThanOrEqual(0);
      expect(card.x + card.width).toBeLessThanOrEqual(width);
      await pair.pageA.screenshot({ path: `tests/screenshots/qa-phase-r-select-${width}x${height}.png` });
    }
    await pair.pageA.setViewportSize({ width: 1280, height: 720 });
    await Promise.all([pair.pageA.locator('#ready-button').click(), pair.pageB.locator('#ready-button').click()]);
    for (let index = 0; index < 8; index += 1) await request.post('/__test/advance');
    await request.post('/__test/finish');
    await expect(pair.pageA.locator('#result-overlay')).toBeVisible();
    for (const [width, height] of [[1280, 720], [1024, 768], [390, 844]]) {
      await pair.pageA.setViewportSize({ width, height });
      const card = await pair.pageA.locator('.result-card').boundingBox();
      expect(card.x).toBeGreaterThanOrEqual(0);
      expect(card.x + card.width).toBeLessThanOrEqual(width);
      expect(card.y).toBeGreaterThanOrEqual(0);
      expect(card.y + card.height).toBeLessThanOrEqual(height);
      await pair.pageA.screenshot({ path: `tests/screenshots/qa-phase-r-result-${width}x${height}.png` });
    }
    expect(errors).toEqual([]);
  } finally {
    await pair.contextA.close();
    await pair.contextB.close();
  }
});
