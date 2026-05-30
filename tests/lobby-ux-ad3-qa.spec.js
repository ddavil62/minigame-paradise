/**
 * @fileoverview 로비 UI Playwright QA 검증 (2026-05-30)
 *
 *   1. 로비 페이지 접속 후 스크린샷
 *   2. 게임 카드 5개 표시 확인 + 스타트 버튼 없음
 *   3. 카드에 투표(thumbsup) 버튼 존재 확인
 *   4. 콘솔 에러 없음 확인
 *   5. matgo 게임 페이지(/matgo/) "다른 종목" 버튼 존재 확인
 */

import { test, expect } from '@playwright/test';

const SCREENSHOTS_DIR = 'tests/screenshots';

test.describe('로비 UI 검증', () => {

  test('TC-01: 로비 페이지 접속 + 전체 스크린샷', async ({ page }) => {
    // 콘솔 에러 수집
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('/', { waitUntil: 'networkidle' });

    // 게임 카드 로딩 대기 (동적 렌더링)
    await page.waitForSelector('.game-card', { timeout: 5000 });

    // 전체 페이지 스크린샷
    await page.screenshot({
      path: `${SCREENSHOTS_DIR}/lobby-full-page.png`,
      fullPage: true,
    });

    // 타이틀 확인
    const title = await page.locator('.hero-title').textContent();
    expect(title).toContain('미니게임 천국');

    console.log('[TC-01] 로비 접속 성공, 스크린샷 저장 완료');
  });

  test('TC-02: 게임 카드 5개 표시 + "스타트" 버튼 없음', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitForSelector('.game-card', { timeout: 5000 });

    // 카드 5개 존재 확인
    const cards = page.locator('.game-card');
    await expect(cards).toHaveCount(5);

    // 각 카드의 게임 ID 확인
    const expectedIds = ['codenames-duet', 'davinci-code', 'matgo', 'yutnori', 'tetris-battle'];
    for (const id of expectedIds) {
      const card = page.locator(`.game-card[data-game-id="${id}"]`);
      await expect(card).toBeVisible();
    }

    // "스타트" 버튼이 없어야 함 (이전에는 "스타트"라는 버튼이 있었으나 제거됨)
    // "선택" 버튼은 있을 수 있지만, "스타트"는 안 됨
    const startButtons = page.locator('button', { hasText: '스타트' });
    await expect(startButtons).toHaveCount(0);

    // 카드 영역 스크린샷
    await page.screenshot({
      path: `${SCREENSHOTS_DIR}/lobby-game-cards.png`,
      fullPage: false,
    });

    console.log('[TC-02] 게임 카드 5개 확인, 스타트 버튼 없음 확인');
  });

  test('TC-03: 각 카드에 투표(thumbsup) 버튼 존재', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitForSelector('.game-card', { timeout: 5000 });

    // 투표 버튼 5개 존재
    const voteButtons = page.locator('.game-card-vote');
    await expect(voteButtons).toHaveCount(5);

    // 각 투표 버튼에 thumbsup 이모지가 포함되어 있는지 확인
    const expectedIds = ['codenames-duet', 'davinci-code', 'matgo', 'yutnori', 'tetris-battle'];
    for (const id of expectedIds) {
      const voteBtn = page.locator(`.game-card-vote[data-game-id="${id}"]`);
      await expect(voteBtn).toBeVisible();

      const text = await voteBtn.textContent();
      // thumbsup Unicode: U+1F44D
      expect(text).toContain('\uD83D\uDC4D');
    }

    // 투표 버튼 영역 포커스 스크린샷 (첫 번째 카드 근처)
    const firstCard = page.locator('.game-card').first();
    const firstCardBox = await firstCard.boundingBox();
    if (firstCardBox) {
      await page.screenshot({
        path: `${SCREENSHOTS_DIR}/lobby-vote-button-detail.png`,
        clip: {
          x: firstCardBox.x,
          y: firstCardBox.y,
          width: firstCardBox.width,
          height: firstCardBox.height,
        },
      });
    }

    console.log('[TC-03] 투표 버튼 5개 확인, thumbsup 이모지 포함');
  });

  test('TC-04: 콘솔 에러 없음', async ({ page }) => {
    const pageErrors = [];
    const consoleErrors = [];

    page.on('pageerror', err => pageErrors.push(err.message));
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitForSelector('.game-card', { timeout: 5000 });

    // 약간의 인터랙션 대기
    await page.waitForTimeout(1000);

    // JavaScript 예외 없어야 함
    expect(pageErrors).toEqual([]);

    // 콘솔 에러 메시지 없어야 함 (WS 에러는 예외적으로 허용 가능하므로 필터링)
    const criticalErrors = consoleErrors.filter(
      e => !e.includes('WS') && !e.includes('WebSocket')
    );
    expect(criticalErrors).toEqual([]);

    console.log('[TC-04] 콘솔 에러 없음 확인');
    if (consoleErrors.length > 0) {
      console.log('  (WS 관련 경고 무시됨:', consoleErrors.join(', '), ')');
    }
  });

  test('TC-05: matgo 페이지에 "다른 종목" 버튼 존재', async ({ page }) => {
    // matgo 페이지에 직접 접속
    await page.goto('/matgo/', { waitUntil: 'domcontentloaded' });

    // "다른 종목" 텍스트가 포함된 버튼 확인
    const returnBtn = page.locator('#btn-return-lobby');
    // 이 버튼은 round-modal 안에 있으므로 hidden일 수 있음
    // HTML에 존재하기만 하면 OK (visibility와 무관하게 DOM에 있는지)
    const count = await returnBtn.count();
    expect(count).toBe(1);

    // 버튼 텍스트 확인
    const btnText = await returnBtn.textContent();
    expect(btnText).toContain('다른 종목');

    // matgo 페이지 스크린샷
    await page.screenshot({
      path: `${SCREENSHOTS_DIR}/matgo-page-overview.png`,
      fullPage: true,
    });

    console.log('[TC-05] matgo 페이지 "다른 종목" 버튼 존재 확인');
    console.log(`  버튼 텍스트: "${btnText}"`);
  });

  test('TC-06: 로비 메타 정보 표시 확인 (인원, 역할, 힌트)', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitForSelector('.game-card', { timeout: 5000 });

    // player-count 존재
    const countEl = page.locator('#player-count');
    await expect(countEl).toBeVisible();

    // player-role 존재
    const roleEl = page.locator('#player-role');
    await expect(roleEl).toBeVisible();

    // lobby-hint 존재
    const hintEl = page.locator('#lobby-hint');
    await expect(hintEl).toBeVisible();

    // lobby-status 존재
    const statusEl = page.locator('#lobby-status');
    const statusCount = await statusEl.count();
    expect(statusCount).toBe(1);

    // 메타 영역 스크린샷
    const metaBox = await page.locator('.lobby-meta').boundingBox();
    if (metaBox) {
      await page.screenshot({
        path: `${SCREENSHOTS_DIR}/lobby-meta-info.png`,
        clip: {
          x: Math.max(0, metaBox.x - 10),
          y: Math.max(0, metaBox.y - 10),
          width: metaBox.width + 20,
          height: metaBox.height + 20,
        },
      });
    }

    console.log('[TC-06] 로비 메타 정보 표시 확인 완료');
  });

  test('TC-07: 각 카드에 "선택" 버튼과 경로 표시 확인', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitForSelector('.game-card', { timeout: 5000 });

    // "선택" 버튼이 5개 있어야 함
    const playButtons = page.locator('.game-card-play');
    await expect(playButtons).toHaveCount(5);

    // 각 카드의 경로 표시 확인
    const expectedPaths = ['/codenames-duet/', '/davinci-code/', '/matgo/', '/yutnori/', '/tetris-battle/'];
    for (const path of expectedPaths) {
      const portEl = page.locator('.game-card-port', { hasText: path });
      await expect(portEl).toBeVisible();
    }

    console.log('[TC-07] 선택 버튼 5개 + 경로 표시 확인');
  });

  test('TC-08: 카드 호버 시 시각적 변화 확인', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitForSelector('.game-card', { timeout: 5000 });

    // 호버 전 스크린샷
    const matgoCard = page.locator('.game-card[data-game-id="matgo"]');
    await page.screenshot({
      path: `${SCREENSHOTS_DIR}/lobby-card-before-hover.png`,
    });

    // 호버
    await matgoCard.hover();
    await page.waitForTimeout(300);

    // 호버 후 스크린샷
    await page.screenshot({
      path: `${SCREENSHOTS_DIR}/lobby-card-after-hover.png`,
    });

    console.log('[TC-08] 호버 시각적 변화 스크린샷 저장');
  });

  test('TC-09: 푸터 텍스트 표시 확인', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });

    const footer = page.locator('.site-footer');
    await expect(footer).toBeVisible();

    const footerText = await footer.textContent();
    expect(footerText).toContain('게임 서버');

    console.log('[TC-09] 푸터 확인 완료');
  });
});
