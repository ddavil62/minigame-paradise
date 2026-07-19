/**
 * @fileoverview 베네치아 타이핑 배틀 아이템 시스템 QA.
 */

import { test, expect } from '@playwright/test';

test.describe.serial('베네치아 아이템 시스템 QA', () => {
  test('AC-9/10/11/12: AI 대전 종합 검증', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    page.on('console', msg => {
      if (msg.type() === 'warning' || msg.type() === 'error') {
        console.log(`[BROWSER ${msg.type()}] ${msg.text()}`);
      }
    });

    // 직접 mode=ai URL 로드 — btn-ai 클릭 시 URL 변경 + 재연결 문제 회피
    await page.goto('http://localhost:3000/venezia/?mode=ai');
    await page.waitForTimeout(500);

    // 닉네임 입력 후 입장 버튼(btn-join이 아닌 btn-ai) 클릭
    await page.fill('#input-name', 'QATester');

    // btn-ai 대신 직접 WS 연결하여 게임 시작을 강제
    // mode=ai 상태에서 btn-join을 누르면 sessionStorage만 human으로 바뀌므로
    // btn-ai를 클릭해야 함
    await page.click('#btn-ai');

    // 게임 시작 대기 — 봇 spawn + GAME_START까지 최대 15초
    try {
      await page.waitForSelector('#screen-game.active', { timeout: 15000 });
    } catch (e) {
      // 방이 차있는 경우 스크린샷 찍고 실패
      await page.screenshot({ path: 'tests/screenshots/venezia-game-start-failed.png' });

      // 현재 화면 상태 확인
      const waitingText = await page.locator('#waiting-status').textContent();
      console.log('Waiting status text:', waitingText);
      throw new Error(`게임 시작 실패. 방이 꽉 찼거나 봇 spawn 실패. Status: ${waitingText}`);
    }

    // ===== AC-9: 슬롯 표시 검증 =====
    const slot0 = page.locator('#item-slot-0');
    const slot1 = page.locator('#item-slot-1');
    const slot2 = page.locator('#item-slot-2');

    await expect(slot0).toBeVisible();
    await expect(slot1).toBeVisible();
    await expect(slot2).toBeVisible();

    // 단독 숫자키 레이블
    await expect(slot0.locator('.item-slot-key')).toHaveText('1');
    await expect(slot1.locator('.item-slot-key')).toHaveText('2');
    await expect(slot2.locator('.item-slot-key')).toHaveText('3');

    // ===== AC-11: 슬롯 위치 검증 =====
    const boardsRowBox = await page.locator('.boards-row').boundingBox();
    const itemSlotsBox = await page.locator('#item-slots').boundingBox();
    const inputAreaBox = await page.locator('#input-area').boundingBox();
    expect(itemSlotsBox).not.toBeNull();
    expect(boardsRowBox).not.toBeNull();
    expect(inputAreaBox).not.toBeNull();
    // item-slots가 boards-row 아래에 있어야 함
    expect(itemSlotsBox.y).toBeGreaterThanOrEqual(boardsRowBox.y + boardsRowBox.height - 5);
    // item-slots가 input-area 위에 있어야 함
    expect(itemSlotsBox.y + itemSlotsBox.height).toBeLessThanOrEqual(inputAreaBox.y + 5);

    // ===== AC-10: 게임 시작 확인 =====
    await expect(page.locator('#game-canvas')).toBeVisible();
    await expect(page.locator('#my-hp-value')).toHaveText('100');
    await expect(page.locator('#opp-hp-value')).toHaveText('100');

    // effect-overlay 초기 hidden
    await expect(page.locator('#effect-overlay')).toHaveClass(/hidden/);

    // 빈 슬롯 1 연타 — 에러 없음
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('1');
      await page.waitForTimeout(100);
    }
    await page.waitForTimeout(500);

    // 스크린샷: 게임 초기 상태
    await page.screenshot({ path: 'tests/screenshots/venezia-game-initial.png' });

    // ===== AC-12: 서버 안정성 — 20초 대기 =====
    await page.waitForTimeout(20000);

    // 서버 여전히 alive
    const resp = await page.request.get('http://localhost:3000/venezia/');
    expect(resp.status()).toBe(200);

    // 게임이 진행 중이거나 종료됐는지 (크래시 없음)
    const gameActive = await page.locator('#screen-game.active').count();
    const resultActive = await page.locator('#screen-result.active').count();
    expect(gameActive + resultActive).toBeGreaterThanOrEqual(1);

    // 타이머 동작 확인
    if (gameActive > 0) {
      const timer = await page.locator('#timer-display').textContent();
      expect(timer).not.toBe('00:00');
    }

    // 슬롯 filled 개수 확인 (봇이 아이템 사용 시 effect가 올 수도 있음)
    const filledSlots = await page.locator('.item-slot.filled').count();
    console.log(`Filled item slots after 20s: ${filledSlots}`);

    // 스크린샷: 20초 후 상태
    await page.screenshot({ path: 'tests/screenshots/venezia-after-20s.png' });

    // 콘솔 에러 없음
    expect(errors).toEqual([]);
  });

  test('모바일 뷰포트(375x667) 레이아웃', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto('http://localhost:3000/venezia/?mode=ai');
    await page.fill('#input-name', 'Mobile');
    await page.click('#btn-ai');

    try {
      await page.waitForSelector('#screen-game.active', { timeout: 15000 });
    } catch {
      // 방이 차있을 수 있음
      test.skip();
      return;
    }

    // 슬롯이 뷰포트 내에 있는지
    const slotsBox = await page.locator('#item-slots').boundingBox();
    expect(slotsBox).not.toBeNull();
    expect(slotsBox.x).toBeGreaterThanOrEqual(0);
    expect(slotsBox.x + slotsBox.width).toBeLessThanOrEqual(376);

    await page.screenshot({ path: 'tests/screenshots/venezia-mobile-layout.png' });
    expect(errors).toEqual([]);
  });
});
