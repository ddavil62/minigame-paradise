/**
 * @fileoverview QA -- Entry UI Unify Phase 1: rummikub 닉네임 게이트 + 대기 화면 통일 검증.
 *
 * 포트 3011 (rummikub 단독 서버) 사전 구동 필요.
 *
 * 검증 항목:
 *   1. 닉네임 게이트 표시 (직접 URL 접근 시)
 *   2. 닉네임 입력 후 게이트 → 대기 화면 전환
 *   3. READY 패널 항상 visible (나/상대 마크)
 *   4. sessionStorage 저장 확인
 *   5. #opponent-left-banner 존재 + 초기 hidden
 *   6. 빈 닉네임 제출 차단
 *   7. 콘솔/JS 에러 없음
 */
import { test, expect } from '@playwright/test';

test.describe('Rummikub Entry UI 통일 검증', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      sessionStorage.removeItem('rummikub:name');
      sessionStorage.removeItem('rummikub:mode');
    });
    await page.goto('/');
    await page.waitForTimeout(500);
  });

  test('AC-1: 직접 URL 접근 시 #name-gate-inline 표시', async ({ page }) => {
    const gate = page.locator('#name-gate-inline');
    await expect(gate).toBeVisible();

    const solo = page.locator('#waiting-solo');
    await expect(solo).toBeHidden();
  });

  test('AC-2: 닉네임 입력 후 게이트 hidden + #waiting-solo visible', async ({ page }) => {
    const gate = page.locator('#name-gate-inline');
    await expect(gate).toBeVisible();

    await page.fill('#inline-name-input', 'RummiUser');
    await page.click('#btn-inline-enter');

    await expect(gate).toBeHidden();

    const solo = page.locator('#waiting-solo');
    await expect(solo).toBeVisible();
  });

  test('AC-3: READY 패널(나/상대) 항상 visible', async ({ page }) => {
    const readyPanel = page.locator('#ready-panel');
    await expect(readyPanel).toBeVisible();

    const myMark = page.locator('#my-ready-mark');
    const oppMark = page.locator('#opp-ready-mark');
    await expect(myMark).toHaveText('⌛');
    await expect(oppMark).toHaveText('⌛');
  });

  test('AC-4: 닉네임 입력 후 sessionStorage에 rummikub:name 저장', async ({ page }) => {
    await page.fill('#inline-name-input', 'SaveTest');
    await page.click('#btn-inline-enter');

    const stored = await page.evaluate(() => sessionStorage.getItem('rummikub:name'));
    expect(stored).toBe('SaveTest');
  });

  test('AC-5: #opponent-left-banner 존재 + 초기 hidden', async ({ page }) => {
    const banner = page.locator('#opponent-left-banner');
    await expect(banner).toHaveCount(1);
    await expect(banner).toBeHidden();
  });

  test('AC-6: 빈 닉네임 제출 시 게이트 유지', async ({ page }) => {
    const gate = page.locator('#name-gate-inline');
    await expect(gate).toBeVisible();

    await page.fill('#inline-name-input', '');
    await page.click('#btn-inline-enter');

    await expect(gate).toBeVisible();
  });

  test('AC-6b: 공백만 입력 시 게이트 유지', async ({ page }) => {
    const gate = page.locator('#name-gate-inline');
    await expect(gate).toBeVisible();

    await page.fill('#inline-name-input', '   ');
    await page.click('#btn-inline-enter');

    await expect(gate).toBeVisible();
  });

  test('AC-7: Enter 키로 닉네임 제출', async ({ page }) => {
    const gate = page.locator('#name-gate-inline');
    await expect(gate).toBeVisible();

    await page.fill('#inline-name-input', 'EnterTest');
    await page.press('#inline-name-input', 'Enter');

    await expect(gate).toBeHidden();

    const stored = await page.evaluate(() => sessionStorage.getItem('rummikub:name'));
    expect(stored).toBe('EnterTest');
  });

  test('AC-8: 콘솔/페이지 JS 에러 없음', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.waitForTimeout(1500);

    expect(errors).toEqual([]);
  });

  test('시각 검증: 닉네임 게이트 상태 스크린샷', async ({ page }) => {
    await page.screenshot({ path: 'tests/screenshots/rummikub-name-gate.png' });
  });

  test('시각 검증: 닉네임 입력 후 대기 상태 스크린샷', async ({ page }) => {
    await page.fill('#inline-name-input', 'ScreenUser');
    await page.click('#btn-inline-enter');
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'tests/screenshots/rummikub-waiting.png' });
  });
});
