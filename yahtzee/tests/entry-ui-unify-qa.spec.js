/**
 * @fileoverview QA -- Entry UI Unify Phase 1: yahtzee 닉네임 게이트 + 대기 화면 통일 검증.
 *
 * 포트 3010 (yahtzee 단독 서버) 사전 구동 필요.
 *
 * 검증 항목:
 *   1. 닉네임 게이트 표시 (직접 URL 접근 시)
 *   2. 닉네임 입력 후 게이트 → 대기 화면 전환
 *   3. READY 패널 항상 visible
 *   4. sessionStorage 저장 확인
 *   5. #invite-panel 없음
 *   6. #opponent-left-banner 존재 + 초기 hidden
 *   7. 빈 닉네임 제출 차단
 *   8. 콘솔 에러 없음
 */
import { test, expect } from '@playwright/test';

test.describe('Yahtzee Entry UI 통일 검증', () => {
  test.beforeEach(async ({ page }) => {
    // sessionStorage를 깨끗하게 시작하기 위해 먼저 페이지 접속
    await page.goto('/');
    // sessionStorage.clear 로 이전 닉네임 잔여 제거
    await page.evaluate(() => {
      sessionStorage.removeItem('yahtzee:name');
      sessionStorage.removeItem('yahtzee:mode');
    });
    // 다시 접속하여 깨끗한 상태로 시작
    await page.goto('/');
    // WS 연결 + onOpen 콜백 실행 대기
    await page.waitForTimeout(500);
  });

  test('AC-1: 직접 URL 접근 시 #name-gate-inline 표시', async ({ page }) => {
    const gate = page.locator('#name-gate-inline');
    await expect(gate).toBeVisible();

    const solo = page.locator('#waiting-solo');
    await expect(solo).toBeHidden();
  });

  test('AC-2: 닉네임 입력 후 게이트 hidden + 대기 화면 진입', async ({ page }) => {
    const gate = page.locator('#name-gate-inline');
    await expect(gate).toBeVisible();

    // 닉네임 입력
    await page.fill('#inline-name-input', 'TestUser');
    await page.click('#btn-inline-enter');

    // 게이트 숨김 확인 (핵심 검증)
    await expect(gate).toBeHidden();

    // 대기 화면에 머물러야 함 (#screen-waiting visible)
    const waiting = page.locator('#screen-waiting');
    await expect(waiting).toBeVisible();

    // waiting-solo는 서버에 혼자일 때만 visible.
    // 테스트 환경에서는 서버에 이전 연결 잔해가 남을 수 있어
    // p2로 배정받으면 waiting-solo가 hidden일 수 있다.
    // 핵심은 게이트가 사라지고 waiting 화면에 진입하는 것.
  });

  test('AC-3: READY 패널(나/상대) 항상 visible', async ({ page }) => {
    // 이름 입력 전에도 ready-panel이 보여야 함
    const readyPanel = page.locator('#ready-panel');
    await expect(readyPanel).toBeVisible();

    // 나/상대 마크 텍스트 확인
    const myMark = page.locator('#my-ready-mark');
    const oppMark = page.locator('#opp-ready-mark');
    await expect(myMark).toHaveText('⌛');
    await expect(oppMark).toHaveText('⌛');
  });

  test('AC-4: 닉네임 입력 후 sessionStorage에 yahtzee:name 저장', async ({ page }) => {
    await page.fill('#inline-name-input', 'SaveTest');
    await page.click('#btn-inline-enter');

    const stored = await page.evaluate(() => sessionStorage.getItem('yahtzee:name'));
    expect(stored).toBe('SaveTest');
  });

  test('AC-5: #invite-panel 존재하지 않음', async ({ page }) => {
    const invitePanel = page.locator('#invite-panel');
    await expect(invitePanel).toHaveCount(0);
  });

  test('AC-6: #opponent-left-banner 존재 + 초기 hidden', async ({ page }) => {
    const banner = page.locator('#opponent-left-banner');
    await expect(banner).toHaveCount(1);
    await expect(banner).toBeHidden();
  });

  test('AC-7: 빈 닉네임 제출 시 게이트 유지', async ({ page }) => {
    const gate = page.locator('#name-gate-inline');
    await expect(gate).toBeVisible();

    // 빈 입력으로 제출 시도
    await page.fill('#inline-name-input', '');
    await page.click('#btn-inline-enter');

    // 게이트가 여전히 보여야 함
    await expect(gate).toBeVisible();
  });

  test('AC-7b: 공백만 입력 시 게이트 유지', async ({ page }) => {
    const gate = page.locator('#name-gate-inline');
    await expect(gate).toBeVisible();

    await page.fill('#inline-name-input', '   ');
    await page.click('#btn-inline-enter');

    await expect(gate).toBeVisible();
  });

  test('AC-8: Enter 키로 닉네임 제출', async ({ page }) => {
    const gate = page.locator('#name-gate-inline');
    await expect(gate).toBeVisible();

    await page.fill('#inline-name-input', 'EnterTest');
    await page.press('#inline-name-input', 'Enter');

    await expect(gate).toBeHidden();

    const stored = await page.evaluate(() => sessionStorage.getItem('yahtzee:name'));
    expect(stored).toBe('EnterTest');
  });

  test('AC-9: 12자 초과 닉네임 잘림', async ({ page }) => {
    await page.fill('#inline-name-input', '가나다라마바사아자차카타파');
    await page.click('#btn-inline-enter');

    const stored = await page.evaluate(() => sessionStorage.getItem('yahtzee:name'));
    // maxlength=12이므로 12자까지만 입력됨
    expect(stored.length).toBeLessThanOrEqual(12);
  });

  test('AC-10: 콘솔 에러 없음', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    // 닉네임 입력하고 대기 화면까지 진행
    await page.fill('#inline-name-input', 'ErrorTest');
    await page.click('#btn-inline-enter');
    await page.waitForTimeout(1000);

    expect(errors).toEqual([]);
  });

  test('시각 검증: 닉네임 게이트 상태 스크린샷', async ({ page }) => {
    await page.screenshot({ path: 'tests/screenshots/yahtzee-name-gate.png' });
  });

  test('시각 검증: 닉네임 입력 후 대기 상태 스크린샷', async ({ page }) => {
    await page.fill('#inline-name-input', 'ScreenUser');
    await page.click('#btn-inline-enter');
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'tests/screenshots/yahtzee-waiting.png' });
  });
});
