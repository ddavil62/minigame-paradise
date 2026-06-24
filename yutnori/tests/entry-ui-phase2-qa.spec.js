/**
 * @fileoverview Entry UI Unify Phase 2 QA - yutnori
 *
 * 수용 기준 검증 + 예외 시나리오 테스트.
 * 서버: port 3008
 */
import { test, expect } from 'playwright/test';

const BASE = 'http://localhost:3008';

test.describe('yutnori - Entry UI Phase 2 QA', () => {
  test.describe('AC-1: 직접 URL 접근 시 #screen-waiting 먼저 표시', () => {
    test('screen-waiting이 표시되고 game-main이 숨겨져 있다', async ({ page }) => {
      await page.goto(BASE);
      await page.waitForSelector('#screen-waiting', { state: 'visible', timeout: 5000 });
      const sw = page.locator('#screen-waiting');
      await expect(sw).toBeVisible();
      const gm = page.locator('.game-main');
      await expect(gm).toBeHidden();
    });

    test('screen-waiting 초기 상태 스크린샷', async ({ page }) => {
      await page.goto(BASE);
      await page.waitForSelector('#screen-waiting', { state: 'visible', timeout: 5000 });
      await page.screenshot({ path: 'tests/screenshots/yutnori-screen-waiting-initial.png' });
    });
  });

  test.describe('AC-2: #name-gate-inline - 닉네임 없이 진입', () => {
    test('닉네임 없이 진입하면 name-gate-inline이 표시된다', async ({ page }) => {
      // sessionStorage 초기화
      await page.goto(BASE);
      await page.evaluate(() => sessionStorage.removeItem('yutnori:name'));
      await page.goto(BASE);
      await page.waitForSelector('#screen-waiting', { state: 'visible', timeout: 5000 });
      // onOpen({ hasName: false }) -> name-gate-inline visible
      const gate = page.locator('#name-gate-inline');
      await expect(gate).toBeVisible({ timeout: 5000 });
    });

    test('닉네임 입력 후 게이트가 숨겨진다', async ({ page }) => {
      await page.goto(BASE);
      await page.evaluate(() => sessionStorage.removeItem('yutnori:name'));
      await page.goto(BASE);
      await page.waitForSelector('#name-gate-inline', { state: 'visible', timeout: 5000 });
      await page.fill('#inline-name-input', 'TestUser');
      await page.click('#btn-inline-enter');
      const gate = page.locator('#name-gate-inline');
      await expect(gate).toBeHidden({ timeout: 3000 });
    });

    test('닉네임 게이트 표시 중 스크린샷', async ({ page }) => {
      await page.goto(BASE);
      await page.evaluate(() => sessionStorage.removeItem('yutnori:name'));
      await page.goto(BASE);
      await page.waitForSelector('#name-gate-inline', { state: 'visible', timeout: 5000 });
      await page.screenshot({ path: 'tests/screenshots/yutnori-name-gate-visible.png' });
    });
  });

  test.describe('AC-3: P1~P4 준비 마크 DOM 존재', () => {
    test('ready-panel에 나/상대 준비 마크가 존재한다', async ({ page }) => {
      await page.goto(BASE);
      await page.waitForSelector('#screen-waiting', { state: 'visible', timeout: 5000 });
      await expect(page.locator('#my-ready-mark')).toBeAttached();
      await expect(page.locator('#opp-ready-mark')).toBeAttached();
      await expect(page.locator('#ready-panel')).toBeAttached();
    });
  });

  test.describe('AC-4: #btn-start-ai 대기 화면에서 존재', () => {
    test('AI 시작 버튼이 DOM에 존재한다', async ({ page }) => {
      await page.goto(BASE);
      await page.waitForSelector('#screen-waiting', { state: 'visible', timeout: 5000 });
      const btn = page.locator('#btn-start-ai');
      await expect(btn).toBeAttached();
      // 텍스트 확인
      const text = await btn.textContent();
      expect(text).toContain('AI');
    });
  });

  test.describe('AC-5: sessionStorage yutnori:name 저장', () => {
    test('닉네임 입력 시 sessionStorage에 저장된다', async ({ page }) => {
      await page.goto(BASE);
      await page.evaluate(() => sessionStorage.removeItem('yutnori:name'));
      await page.goto(BASE);
      await page.waitForSelector('#name-gate-inline', { state: 'visible', timeout: 5000 });
      await page.fill('#inline-name-input', 'QAUser');
      await page.click('#btn-inline-enter');
      const saved = await page.evaluate(() => sessionStorage.getItem('yutnori:name'));
      expect(saved).toBe('QAUser');
    });

    test('URL ?name= 파라미터로 sessionStorage에 저장된다', async ({ page }) => {
      await page.goto(BASE);
      await page.evaluate(() => sessionStorage.removeItem('yutnori:name'));
      await page.goto(`${BASE}/?name=URLUser`);
      await page.waitForSelector('#screen-waiting', { state: 'visible', timeout: 5000 });
      const saved = await page.evaluate(() => sessionStorage.getItem('yutnori:name'));
      expect(saved).toBe('URLUser');
    });
  });

  test.describe('AC-6: #opponent-left-banner 존재 + 초기 hidden', () => {
    test('opponent-left-banner가 DOM에 존재하고 초기에 hidden이다', async ({ page }) => {
      await page.goto(BASE);
      await page.waitForSelector('#screen-waiting', { state: 'visible', timeout: 5000 });
      const banner = page.locator('#opponent-left-banner');
      await expect(banner).toBeAttached();
      await expect(banner).toBeHidden();
    });
  });

  test.describe('AC-7: 빈/공백 닉네임 제출 차단', () => {
    test('빈 닉네임 입력 시 제출이 되지 않는다 (게이트 유지)', async ({ page }) => {
      await page.goto(BASE);
      await page.evaluate(() => sessionStorage.removeItem('yutnori:name'));
      await page.goto(BASE);
      await page.waitForSelector('#name-gate-inline', { state: 'visible', timeout: 5000 });
      // 빈 입력으로 제출
      await page.fill('#inline-name-input', '');
      await page.click('#btn-inline-enter');
      // 게이트가 여전히 표시되어야 한다
      const gate = page.locator('#name-gate-inline');
      await expect(gate).toBeVisible();
    });

    test('공백만 입력 시 제출이 되지 않는다', async ({ page }) => {
      await page.goto(BASE);
      await page.evaluate(() => sessionStorage.removeItem('yutnori:name'));
      await page.goto(BASE);
      await page.waitForSelector('#name-gate-inline', { state: 'visible', timeout: 5000 });
      await page.fill('#inline-name-input', '   ');
      await page.click('#btn-inline-enter');
      const gate = page.locator('#name-gate-inline');
      await expect(gate).toBeVisible();
    });
  });

  test.describe('AC-8: Enter 키 닉네임 제출', () => {
    test('Enter 키로 닉네임을 제출할 수 있다', async ({ page }) => {
      await page.goto(BASE);
      await page.evaluate(() => sessionStorage.removeItem('yutnori:name'));
      await page.goto(BASE);
      await page.waitForSelector('#name-gate-inline', { state: 'visible', timeout: 5000 });
      await page.fill('#inline-name-input', 'EnterUser');
      await page.press('#inline-name-input', 'Enter');
      const gate = page.locator('#name-gate-inline');
      await expect(gate).toBeHidden({ timeout: 3000 });
      const saved = await page.evaluate(() => sessionStorage.getItem('yutnori:name'));
      expect(saved).toBe('EnterUser');
    });
  });

  test.describe('AC-9: 콘솔 에러 없음', () => {
    test('초기 로드 시 콘솔 에러가 발생하지 않는다', async ({ page }) => {
      const errors = [];
      page.on('pageerror', (err) => errors.push(err.message));
      await page.goto(BASE);
      await page.waitForSelector('#screen-waiting', { state: 'visible', timeout: 5000 });
      // 1초 대기 (비동기 에러 검출)
      await page.waitForTimeout(1000);
      expect(errors).toEqual([]);
    });

    test('닉네임 입력 후 콘솔 에러가 발생하지 않는다', async ({ page }) => {
      const errors = [];
      page.on('pageerror', (err) => errors.push(err.message));
      await page.goto(BASE);
      await page.evaluate(() => sessionStorage.removeItem('yutnori:name'));
      await page.goto(BASE);
      await page.waitForSelector('#name-gate-inline', { state: 'visible', timeout: 5000 });
      await page.fill('#inline-name-input', 'NoError');
      await page.click('#btn-inline-enter');
      await page.waitForTimeout(1000);
      expect(errors).toEqual([]);
    });
  });

  test.describe('예외 시나리오', () => {
    test('12자 최대 닉네임이 정상 처리된다', async ({ page }) => {
      await page.goto(BASE);
      await page.evaluate(() => sessionStorage.removeItem('yutnori:name'));
      await page.goto(BASE);
      await page.waitForSelector('#name-gate-inline', { state: 'visible', timeout: 5000 });
      const longName = 'ABCDEFGHIJKL'; // 12자
      await page.fill('#inline-name-input', longName);
      await page.click('#btn-inline-enter');
      const saved = await page.evaluate(() => sessionStorage.getItem('yutnori:name'));
      expect(saved).toBe(longName);
    });

    test('12자 초과 닉네임이 12자로 잘린다', async ({ page }) => {
      await page.goto(BASE);
      await page.evaluate(() => sessionStorage.removeItem('yutnori:name'));
      await page.goto(BASE);
      await page.waitForSelector('#name-gate-inline', { state: 'visible', timeout: 5000 });
      // maxlength=12이지만 JS로 직접 설정
      await page.evaluate(() => {
        document.getElementById('inline-name-input').value = 'ABCDEFGHIJKLMNOP';
      });
      await page.click('#btn-inline-enter');
      const saved = await page.evaluate(() => sessionStorage.getItem('yutnori:name'));
      // submitInlineName에서 .slice(0, 12)
      expect(saved.length).toBeLessThanOrEqual(12);
    });

    test('특수문자 닉네임이 에러 없이 처리된다', async ({ page }) => {
      const errors = [];
      page.on('pageerror', (err) => errors.push(err.message));
      await page.goto(BASE);
      await page.evaluate(() => sessionStorage.removeItem('yutnori:name'));
      await page.goto(BASE);
      await page.waitForSelector('#name-gate-inline', { state: 'visible', timeout: 5000 });
      await page.fill('#inline-name-input', '<script>alert');
      await page.click('#btn-inline-enter');
      await page.waitForTimeout(500);
      expect(errors).toEqual([]);
    });

    test('닉네임 입력 버튼 연타 시 에러가 발생하지 않는다', async ({ page }) => {
      const errors = [];
      page.on('pageerror', (err) => errors.push(err.message));
      await page.goto(BASE);
      await page.evaluate(() => sessionStorage.removeItem('yutnori:name'));
      await page.goto(BASE);
      await page.waitForSelector('#name-gate-inline', { state: 'visible', timeout: 5000 });
      await page.fill('#inline-name-input', 'RapidFire');
      // 첫 클릭 후 게이트가 hidden이 되므로, evaluate로 직접 클릭 이벤트를 발생시켜 연타 시뮬레이션
      await page.evaluate(() => {
        const btn = document.getElementById('btn-inline-enter');
        for (let i = 0; i < 5; i++) {
          btn.click();
        }
      });
      await page.waitForTimeout(500);
      expect(errors).toEqual([]);
    });

    test('sessionStorage에 이름이 있으면 게이트 없이 즉시 JOIN', async ({ page }) => {
      await page.goto(BASE);
      await page.evaluate(() => sessionStorage.setItem('yutnori:name', 'ReturningUser'));
      await page.goto(BASE);
      await page.waitForSelector('#screen-waiting', { state: 'visible', timeout: 5000 });
      // name-gate-inline은 hidden 상태여야 한다
      const gate = page.locator('#name-gate-inline');
      await expect(gate).toBeHidden();
    });

    test('.waiting-card 내부 구조가 오목 패턴과 일치한다', async ({ page }) => {
      await page.goto(BASE);
      await page.waitForSelector('#screen-waiting', { state: 'visible', timeout: 5000 });
      // 필수 구조 요소 확인
      await expect(page.locator('#screen-waiting .waiting-card')).toBeAttached();
      await expect(page.locator('#screen-waiting .waiting-logo')).toBeAttached();
      await expect(page.locator('#screen-waiting .waiting-title')).toBeAttached();
      await expect(page.locator('#screen-waiting .rules-summary')).toBeAttached();
      await expect(page.locator('#screen-waiting #waiting-solo')).toBeAttached();
      await expect(page.locator('#screen-waiting #ready-panel')).toBeAttached();
    });
  });
});
