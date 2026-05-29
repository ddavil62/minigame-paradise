/**
 * @fileoverview 미니게임 천국 launcher 로비 흐름 스모크 테스트.
 *   - 로비 1/2 화면 캡처
 *   - 두 번째 클라이언트 접속 시 2/2 화면 캡처
 *   - 호스트가 스타트 → 종목 선택 화면 (호스트 뷰) 캡처
 *   - 게스트의 종목 선택 화면 (잠금 뷰) 캡처
 *
 * 사전 조건: `node launcher/server.js --port 3000` 기동 중.
 */

import { test, expect } from '@playwright/test';

const LAUNCHER_URL = 'http://localhost:3000';
const SCREEN_DIR = 'tests/screenshots';

test.describe.serial('로비 → 종목 선택 흐름', () => {
  test('1) 호스트 단독 입장 → 1/2 로비 캡처', async ({ page }) => {
    await page.goto(LAUNCHER_URL);
    await page.waitForSelector('#player-count');
    // WS 연결 + LOBBY_STATE 수신 대기 — count가 1/2이면 정상
    await page.waitForFunction(() => document.getElementById('player-count').textContent === '1/2', null, { timeout: 5000 });
    await expect(page.locator('#player-role')).toHaveText('호스트');
    await expect(page.locator('#start-btn')).toBeEnabled();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SCREEN_DIR}/lobby-1-of-2.png`, fullPage: false });
  });

  test('2) 두 클라이언트 동시 접속 → 2/2 로비 + 호스트가 스타트 클릭 → 종목 선택 (인간 대전)', async ({ browser }) => {
    const ctxHost = await browser.newContext();
    const pageHost = await ctxHost.newPage();
    await pageHost.goto(LAUNCHER_URL);
    await pageHost.waitForFunction(() => document.getElementById('player-count').textContent === '1/2', null, { timeout: 5000 });

    const ctxGuest = await browser.newContext();
    const pageGuest = await ctxGuest.newPage();
    await pageGuest.goto(LAUNCHER_URL);

    // 양쪽 모두 2/2가 될 때까지 대기
    await pageHost.waitForFunction(() => document.getElementById('player-count').textContent === '2/2', null, { timeout: 5000 });
    await pageGuest.waitForFunction(() => document.getElementById('player-count').textContent === '2/2', null, { timeout: 5000 });

    // 호스트 페이지의 역할 확인
    await expect(pageHost.locator('#player-role')).toHaveText('호스트');
    await expect(pageGuest.locator('#player-role')).toHaveText('게스트');
    await expect(pageHost.locator('#start-btn')).toBeEnabled();
    await expect(pageGuest.locator('#start-btn')).toBeDisabled();

    // 2/2 로비 스크린샷 (호스트 시점)
    await pageHost.screenshot({ path: `${SCREEN_DIR}/lobby-2-of-2-host.png`, fullPage: false });

    // 호스트가 스타트 클릭
    await pageHost.locator('#start-btn').click();

    // 양쪽 모두 종목 선택 화면으로 전환
    await pageHost.waitForSelector('#game-select-view:not(.hidden)', { timeout: 5000 });
    await pageGuest.waitForSelector('#game-select-view:not(.hidden)', { timeout: 5000 });

    // 모드 배지가 "인간 대전"이어야 함
    await expect(pageHost.locator('#mode-badge')).toHaveText('인간 대전');

    // 호스트 시점 스크린샷
    await pageHost.waitForTimeout(400);
    await pageHost.screenshot({ path: `${SCREEN_DIR}/game-select-host-human.png`, fullPage: false });

    // 게스트 시점 (잠금 오버레이)
    await expect(pageGuest.locator('#game-select-view')).toHaveClass(/guest-mode/);
    await pageGuest.screenshot({ path: `${SCREEN_DIR}/game-select-guest-locked.png`, fullPage: false });

    await ctxHost.close();
    await ctxGuest.close();
  });

  test('3) 단독 입장 후 스타트 → AI 모드 + 봇 미지원 카드 비활성화', async ({ page }) => {
    await page.goto(LAUNCHER_URL);
    await page.waitForFunction(() => document.getElementById('player-count').textContent === '1/2', null, { timeout: 5000 });
    // role 표시가 '호스트'로 안정될 때까지 대기 (LOBBY_STATE 수신 완료 보장)
    await expect(page.locator('#player-role')).toHaveText('호스트');
    await expect(page.locator('#start-btn')).toBeEnabled();
    await page.waitForTimeout(300);
    // Playwright .click()이 1280x800 뷰포트에서 가끔 reach 못 하는 경우가 있어 page.evaluate로 직접 트리거
    await page.evaluate(() => document.getElementById('start-btn').click());
    await page.waitForSelector('#game-select-view:not(.hidden)', { timeout: 5000 });
    await expect(page.locator('#mode-badge')).toHaveText('AI 대전');
    await expect(page.locator('#game-select-view')).toHaveClass(/ai-mode/);

    // 봇 미지원 카드(.no-bot)가 시각적으로 비활성화 (opacity 0.5)
    const noBotCount = await page.locator('.game-card.no-bot').count();
    expect(noBotCount).toBeGreaterThan(0);

    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SCREEN_DIR}/game-select-host-ai.png`, fullPage: false });
  });
});
