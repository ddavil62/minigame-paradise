/**
 * @fileoverview AI 봇 버튼 시각 검증 -- 스크롤하여 AI 버튼이 보이는 상태를 캡처한다.
 */
import { test, expect } from '@playwright/test';

test('AI 버튼이 보이는 상태에서 스크린샷 캡처', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('#ready-overlay');

  // AI 버튼으로 스크롤
  const aiBtn = page.locator('#ai-start-button');
  await aiBtn.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);

  // ready-overlay 내부를 캡처 (전체 페이지 아님)
  const overlay = page.locator('#ready-overlay');
  await overlay.screenshot({ path: 'tests/screenshots/ai-button-scrolled-desktop.png' });
});

test('AI 버튼 영역만 클로즈업 캡처', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('#ready-overlay');

  const aiBtn = page.locator('#ai-start-button');
  await aiBtn.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);

  // AI 버튼 자체를 캡처
  await aiBtn.screenshot({ path: 'tests/screenshots/ai-button-closeup.png' });
});

test('AI 모드 접속 후 게임 진행 중 스크린샷', async ({ page }) => {
  await page.goto('/?mode=ai&fresh=1');

  // 게임 시작 대기 (ready overlay 숨김)
  try {
    await page.waitForSelector('#ready-overlay[hidden]', { timeout: 15000 });
    // 게임이 시작되었으면 2초 대기 후 캡처
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'tests/screenshots/ai-mode-gameplay.png' });
  } catch {
    // 타임아웃 시 현재 상태 캡처
    await page.screenshot({ path: 'tests/screenshots/ai-mode-waiting.png' });
  }
});
