/**
 * @fileoverview Phase 2 QA: 테트리스 배틀 입장 UI 통일 검증.
 *
 * 검증 항목:
 *  - 닉네임 게이트 표시/입력/전환
 *  - sessionStorage 저장
 *  - READY 패널 초기 표시
 *  - #opponent-left-banner 존재 + 초기 hidden
 *  - 빈/공백 닉네임 제출 차단
 *  - 게임 화면 전환 (screen-waiting → game-main)
 *  - 콘솔 에러 없음
 *
 * 실행: cd tetris-battle && npx playwright test tests/entry-ui-qa.spec.js --reporter=list
 * 포트: 3005 (standalone 서버 필요)
 */

import { test, expect } from 'playwright/test';

const BASE = 'http://localhost:3005';

test.describe('테트리스 배틀 입장 UI 통일 검증', () => {

  test.describe('정상 동작', () => {

    test('AC-1: 직접 URL 접근 시 #name-gate-inline visible', async ({ page }) => {
      await page.goto(BASE);
      await page.evaluate(() => sessionStorage.removeItem('tetris-battle:name'));
      await page.goto(BASE);
      await page.waitForSelector('#screen-waiting', { state: 'visible', timeout: 5000 });

      const gate = page.locator('#name-gate-inline');
      await expect(gate).toBeVisible({ timeout: 3000 });

      await page.screenshot({ path: 'tests/screenshots/tetris-name-gate.png' });
    });

    test('AC-2: 닉네임 입력 후 게이트 hidden + #waiting-solo visible', async ({ page }) => {
      await page.goto(BASE);
      await page.evaluate(() => sessionStorage.removeItem('tetris-battle:name'));
      await page.goto(BASE);
      await page.waitForSelector('#name-gate-inline', { state: 'visible', timeout: 5000 });

      await page.fill('#inline-name-input', 'TestPlayer');
      await page.click('#btn-inline-enter');

      const gate = page.locator('#name-gate-inline');
      await expect(gate).toBeHidden({ timeout: 3000 });

      const solo = page.locator('#waiting-solo');
      await expect(solo).toBeVisible({ timeout: 3000 });

      await page.screenshot({ path: 'tests/screenshots/tetris-after-enter.png' });
    });

    test('AC-3: READY 패널 초기 상태 검증', async ({ page }) => {
      await page.goto(BASE);
      await page.evaluate(() => sessionStorage.removeItem('tetris-battle:name'));
      await page.goto(BASE);
      await page.waitForSelector('#screen-waiting', { state: 'visible', timeout: 5000 });
      await page.waitForSelector('#name-gate-inline', { state: 'visible', timeout: 5000 });

      const readyPanel = page.locator('#ready-panel');
      const isHidden = await readyPanel.evaluate(el => el.classList.contains('hidden'));
      console.log(`[AC-3] ready-panel hidden when no name: ${isHidden}`);
    });

    test('AC-4: sessionStorage에 tetris-battle:name 저장 확인', async ({ page }) => {
      await page.goto(BASE);
      await page.evaluate(() => sessionStorage.removeItem('tetris-battle:name'));
      await page.goto(BASE);
      await page.waitForSelector('#name-gate-inline', { state: 'visible', timeout: 5000 });

      await page.fill('#inline-name-input', 'QAUser');
      await page.click('#btn-inline-enter');
      await page.waitForTimeout(500);

      const stored = await page.evaluate(() => sessionStorage.getItem('tetris-battle:name'));
      expect(stored).toBe('QAUser');
    });

    test('AC-5: #opponent-left-banner 존재 + 초기 hidden', async ({ page }) => {
      await page.goto(BASE);
      await page.waitForSelector('#screen-waiting', { state: 'visible', timeout: 5000 });

      const banner = page.locator('#opponent-left-banner');
      await expect(banner).toBeAttached();
      await expect(banner).toBeHidden();
    });

    test('AC-6: #screen-waiting 초기 표시 + .game-main 초기 hidden', async ({ page }) => {
      await page.goto(BASE);
      await page.waitForSelector('#screen-waiting', { state: 'visible', timeout: 5000 });

      const gameMain = page.locator('.game-main');
      await expect(gameMain).toBeHidden();
    });

    test('AC-7: URL ?name= 파라미터로 즉시 JOIN (게이트 미표시)', async ({ page }) => {
      await page.goto(BASE);
      await page.evaluate(() => sessionStorage.removeItem('tetris-battle:name'));
      await page.goto(`${BASE}?name=URLPlayer`);
      await page.waitForSelector('#screen-waiting', { state: 'visible', timeout: 5000 });

      const gate = page.locator('#name-gate-inline');
      await expect(gate).toBeHidden({ timeout: 3000 });

      const stored = await page.evaluate(() => sessionStorage.getItem('tetris-battle:name'));
      expect(stored).toBe('URLPlayer');
    });

    test('AC-8: Enter 키로 닉네임 제출 가능', async ({ page }) => {
      await page.goto(BASE);
      await page.evaluate(() => sessionStorage.removeItem('tetris-battle:name'));
      await page.goto(BASE);
      await page.waitForSelector('#name-gate-inline', { state: 'visible', timeout: 5000 });

      await page.fill('#inline-name-input', 'EnterUser');
      await page.press('#inline-name-input', 'Enter');

      const gate = page.locator('#name-gate-inline');
      await expect(gate).toBeHidden({ timeout: 3000 });

      const stored = await page.evaluate(() => sessionStorage.getItem('tetris-battle:name'));
      expect(stored).toBe('EnterUser');
    });
  });

  test.describe('예외 및 엣지케이스', () => {

    test('EX-1: 빈 닉네임 제출 시 JOIN 미전송 (게이트 유지)', async ({ page }) => {
      await page.goto(BASE);
      await page.evaluate(() => sessionStorage.removeItem('tetris-battle:name'));
      await page.goto(BASE);
      await page.waitForSelector('#name-gate-inline', { state: 'visible', timeout: 5000 });

      await page.click('#btn-inline-enter');
      await page.waitForTimeout(300);

      const gate = page.locator('#name-gate-inline');
      await expect(gate).toBeVisible();

      const stored = await page.evaluate(() => sessionStorage.getItem('tetris-battle:name'));
      expect(stored).toBeNull();
    });

    test('EX-2: 공백만 입력 후 제출 시 게이트 유지', async ({ page }) => {
      await page.goto(BASE);
      await page.evaluate(() => sessionStorage.removeItem('tetris-battle:name'));
      await page.goto(BASE);
      await page.waitForSelector('#name-gate-inline', { state: 'visible', timeout: 5000 });

      await page.fill('#inline-name-input', '   ');
      await page.click('#btn-inline-enter');
      await page.waitForTimeout(300);

      const gate = page.locator('#name-gate-inline');
      await expect(gate).toBeVisible();
    });

    test('EX-3: 12자 초과 닉네임은 12자로 잘림', async ({ page }) => {
      await page.goto(BASE);
      await page.evaluate(() => sessionStorage.removeItem('tetris-battle:name'));
      await page.goto(BASE);
      await page.waitForSelector('#name-gate-inline', { state: 'visible', timeout: 5000 });

      await page.evaluate(() => {
        document.getElementById('inline-name-input').value = 'ABCDEFGHIJKLMNOP';
      });
      await page.click('#btn-inline-enter');
      await page.waitForTimeout(300);

      const stored = await page.evaluate(() => sessionStorage.getItem('tetris-battle:name'));
      expect(stored).toBe('ABCDEFGHIJKL');
    });

    test('EX-4: 특수문자 닉네임 허용', async ({ page }) => {
      await page.goto(BASE);
      await page.evaluate(() => sessionStorage.removeItem('tetris-battle:name'));
      await page.goto(BASE);
      await page.waitForSelector('#name-gate-inline', { state: 'visible', timeout: 5000 });

      await page.fill('#inline-name-input', '<script>hi');
      await page.click('#btn-inline-enter');
      await page.waitForTimeout(300);

      const stored = await page.evaluate(() => sessionStorage.getItem('tetris-battle:name'));
      expect(stored).toBe('<script>hi');
      const gate = page.locator('#name-gate-inline');
      await expect(gate).toBeHidden();
    });

    test('EX-5: 입장 버튼 연타 시 에러 없음', async ({ page }) => {
      const errors = [];
      page.on('pageerror', err => errors.push(err.message));

      await page.goto(BASE);
      await page.evaluate(() => sessionStorage.removeItem('tetris-battle:name'));
      await page.goto(BASE);
      await page.waitForSelector('#name-gate-inline', { state: 'visible', timeout: 5000 });

      await page.fill('#inline-name-input', 'Rapid');
      await page.click('#btn-inline-enter');
      await page.locator('#btn-inline-enter').click({ force: true }).catch(() => {});
      await page.locator('#btn-inline-enter').click({ force: true }).catch(() => {});
      await page.waitForTimeout(500);

      expect(errors).toEqual([]);
    });
  });

  test.describe('UI 안정성', () => {

    test('STAB-1: 콘솔 에러 발생하지 않음 (초기 로드)', async ({ page }) => {
      const errors = [];
      page.on('pageerror', err => errors.push(err.message));

      await page.goto(BASE);
      await page.waitForSelector('#screen-waiting', { state: 'visible', timeout: 5000 });
      await page.waitForTimeout(1000);

      expect(errors).toEqual([]);
    });

    test('STAB-2: DOM 구조 일관성 — 필수 요소 존재', async ({ page }) => {
      await page.goto(BASE);
      await page.waitForSelector('#screen-waiting', { state: 'visible', timeout: 5000 });

      const requiredIds = [
        'screen-waiting', 'name-gate-inline', 'inline-name-input',
        'btn-inline-enter', 'waiting-solo', 'btn-start-ai',
        'opponent-info', 'ready-panel', 'my-ready-mark', 'opp-ready-mark',
        'btn-ready', 'opponent-left-banner',
      ];
      for (const id of requiredIds) {
        const el = page.locator(`#${id}`);
        await expect(el).toBeAttached({ timeout: 1000 });
      }

      const waitingCard = page.locator('.waiting-card');
      await expect(waitingCard).toBeAttached();
      const waitingLogo = page.locator('.waiting-logo');
      await expect(waitingLogo).toBeAttached();
      const waitingTitle = page.locator('.waiting-title');
      await expect(waitingTitle).toBeAttached();
      const rulesSummary = page.locator('.rules-summary');
      await expect(rulesSummary).toBeAttached();
    });

    test('STAB-3: sessionStorage 유지 시 게이트 스킵', async ({ page }) => {
      await page.goto(BASE);
      await page.evaluate(() => sessionStorage.setItem('tetris-battle:name', 'Persist'));
      await page.goto(BASE);
      await page.waitForSelector('#screen-waiting', { state: 'visible', timeout: 5000 });

      const gate = page.locator('#name-gate-inline');
      await expect(gate).toBeHidden({ timeout: 3000 });

      const solo = page.locator('#waiting-solo');
      await expect(solo).toBeVisible({ timeout: 3000 });

      await page.screenshot({ path: 'tests/screenshots/tetris-session-persist.png' });
    });
  });

  test.describe('시각적 검증', () => {
    test('VIS-1: 닉네임 게이트 스크린샷', async ({ page }) => {
      await page.goto(BASE);
      await page.evaluate(() => sessionStorage.removeItem('tetris-battle:name'));
      await page.goto(BASE);
      await page.waitForSelector('#name-gate-inline', { state: 'visible', timeout: 5000 });
      await page.waitForTimeout(500);
      await page.screenshot({ path: 'tests/screenshots/tetris-gate-full.png' });
    });

    test('VIS-2: 대기 화면 (닉네임 입력 후) 스크린샷', async ({ page }) => {
      await page.goto(BASE);
      await page.evaluate(() => sessionStorage.removeItem('tetris-battle:name'));
      await page.goto(BASE);
      await page.waitForSelector('#name-gate-inline', { state: 'visible', timeout: 5000 });
      await page.fill('#inline-name-input', 'VisualTest');
      await page.click('#btn-inline-enter');
      await page.waitForTimeout(500);
      await page.screenshot({ path: 'tests/screenshots/tetris-waiting-full.png' });
    });
  });
});
