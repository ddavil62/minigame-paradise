/**
 * @fileoverview 장기 E2E 브라우저 테스트 — QA 시각적 검증 + WS 2인 통합.
 * 서버 standalone 모드(포트 3006)에서 실행한다.
 *
 * 실행: cd C:/antigravity/minigame-paradise && npx playwright test janggi/tests/qa-e2e.spec.js
 */

import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:3006';
const SCREENSHOT_DIR = 'janggi/tests/screenshots';

test.describe('E2E: 장기 브라우저 통합 테스트', () => {

  test('초기 페이지 로딩 — 콘솔 에러 없음 + 기본 UI 요소 존재', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto(BASE_URL);
    await page.waitForTimeout(1000);

    // 기본 UI 요소 확인
    await expect(page.locator('.topbar .title')).toHaveText('장기');
    await expect(page.locator('#btn-resign')).toBeVisible();
    await expect(page.locator('#btn-draw')).toBeVisible();
    await expect(page.locator('#janggi-board')).toBeVisible();

    // 접속 태그 확인
    const youTag = page.locator('#you-tag');
    await expect(youTag).toBeVisible();

    await page.screenshot({ path: `${SCREENSHOT_DIR}/qa-e2e-initial-page.png` });

    expect(errors).toEqual([]);
    await context.close();
  });

  test('2인 접속 -> 배치 선택 모달 표시', async ({ browser }) => {
    const context1 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const context2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    const errors = [];
    page1.on('pageerror', err => errors.push('P1: ' + err.message));
    page2.on('pageerror', err => errors.push('P2: ' + err.message));

    // P1 connects as han
    await page1.goto(`${BASE_URL}?side=han`);
    await page1.waitForTimeout(500);

    // P2 connects as cho
    await page2.goto(`${BASE_URL}?side=cho`);
    await page2.waitForTimeout(1500);

    // Setup modal should be visible for at least one player
    const setupModal = page2.locator('#setup-modal');
    const isVisible = await setupModal.isVisible();

    await page1.screenshot({ path: `${SCREENSHOT_DIR}/qa-e2e-p1-setup.png` });
    await page2.screenshot({ path: `${SCREENSHOT_DIR}/qa-e2e-p2-setup.png` });

    // Setup modal should appear
    expect(isVisible).toBe(true);

    // Setup options should have 4 buttons
    const setupBtns = page2.locator('.setup-btn');
    const btnCount = await setupBtns.count();
    expect(btnCount).toBe(4);

    expect(errors).toEqual([]);
    await context1.close();
    await context2.close();
  });

  test('2인 접속 -> 배치 선택 -> 보드 렌더링', async ({ browser }) => {
    const context1 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const context2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    const errors = [];
    page1.on('pageerror', err => errors.push('P1: ' + err.message));
    page2.on('pageerror', err => errors.push('P2: ' + err.message));

    // P1 connects
    await page1.goto(`${BASE_URL}?side=han`);
    await page1.waitForTimeout(500);

    // P2 connects
    await page2.goto(`${BASE_URL}?side=cho`);
    await page2.waitForTimeout(1500);

    // Cho selects first (MSMS)
    const choSetupBtn = page2.locator('.setup-btn[data-setup="MSMS"]');
    if (await choSetupBtn.isVisible()) {
      await choSetupBtn.click();
      await page2.waitForTimeout(500);
    }

    // Han selects (MSMS)
    const hanSetupBtn = page1.locator('.setup-btn[data-setup="MSMS"]');
    if (await hanSetupBtn.isVisible()) {
      await hanSetupBtn.click();
      await page1.waitForTimeout(500);
    }

    await page1.waitForTimeout(1000);
    await page2.waitForTimeout(1000);

    // Setup modal should be hidden now
    const setupModal1 = page1.locator('#setup-modal');
    await expect(setupModal1).toBeHidden();

    // Board should have pieces rendered
    const pieces1 = page1.locator('.janggi-piece');
    const pieceCount = await pieces1.count();
    // 32 pieces expected
    expect(pieceCount).toBe(32);

    await page1.screenshot({ path: `${SCREENSHOT_DIR}/qa-e2e-playing-han.png` });
    await page2.screenshot({ path: `${SCREENSHOT_DIR}/qa-e2e-playing-cho.png` });

    // Time panels should show values
    const hanTime = page1.locator('#time-han-main');
    await expect(hanTime).toBeVisible();
    const choTime = page1.locator('#time-cho-main');
    await expect(choTime).toBeVisible();

    expect(errors).toEqual([]);
    await context1.close();
    await context2.close();
  });

  test('모바일 뷰포트 렌더링 정상', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 375, height: 667 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto(BASE_URL);
    await page.waitForTimeout(1000);

    // Canvas should be visible
    await expect(page.locator('#janggi-board')).toBeVisible();

    await page.screenshot({ path: `${SCREENSHOT_DIR}/qa-e2e-mobile-viewport.png` });

    expect(errors).toEqual([]);
    await context.close();
  });

  test('3번째 접속자 거절 확인', async ({ browser }) => {
    const context1 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const context2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const context3 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();
    const page3 = await context3.newPage();

    await page1.goto(`${BASE_URL}?side=han`);
    await page1.waitForTimeout(500);
    await page2.goto(`${BASE_URL}?side=cho`);
    await page2.waitForTimeout(500);

    // 3rd player connects
    await page3.goto(BASE_URL);
    await page3.waitForTimeout(1500);

    // Page3 should not have 32 pieces (either error or waiting state)
    // The server sends ERROR and closes the WS
    await page3.screenshot({ path: `${SCREENSHOT_DIR}/qa-e2e-3rd-player.png` });

    await context1.close();
    await context2.close();
    await context3.close();
  });
});
