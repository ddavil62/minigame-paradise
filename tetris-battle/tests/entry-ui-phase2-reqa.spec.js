/**
 * @fileoverview Entry UI Unify Phase 2 재검증 QA - tetris-battle
 *
 * coder 수정 후 HIGH-1(닉네임 게이트 미동작) 해소 확인 + 능동 엣지 케이스.
 * 서버: port 3007
 */
import { test, expect } from 'playwright/test';

const BASE = 'http://localhost:3007';

test.describe('tetris-battle - Entry UI Phase 2 재검증', () => {
  // ── AC-2 재검증: 닉네임 게이트 동작 (HIGH-1 핵심 수정 영역) ──
  test.describe('HIGH-1 해소: 닉네임 게이트 onOpen 콜백', () => {
    test('닉네임 없이 진입하면 name-gate-inline이 visible이다', async ({ page }) => {
      await page.goto(BASE);
      await page.evaluate(() => sessionStorage.removeItem('tetris-battle:name'));
      await page.goto(BASE);
      await page.waitForSelector('#screen-waiting', { state: 'visible', timeout: 5000 });
      const gate = page.locator('#name-gate-inline');
      await expect(gate).toBeVisible({ timeout: 5000 });
    });

    test('닉네임 게이트 표시 시 waiting-solo가 hidden이다', async ({ page }) => {
      await page.goto(BASE);
      await page.evaluate(() => sessionStorage.removeItem('tetris-battle:name'));
      await page.goto(BASE);
      await page.waitForSelector('#name-gate-inline', { state: 'visible', timeout: 5000 });
      const solo = page.locator('#waiting-solo');
      await expect(solo).toBeHidden();
    });

    test('닉네임 게이트 표시 시 ready-panel이 hidden이다', async ({ page }) => {
      await page.goto(BASE);
      await page.evaluate(() => sessionStorage.removeItem('tetris-battle:name'));
      await page.goto(BASE);
      await page.waitForSelector('#name-gate-inline', { state: 'visible', timeout: 5000 });
      const rp = page.locator('#ready-panel');
      await expect(rp).toBeHidden();
    });

    test('닉네임 입력 후 게이트 hidden + waiting-solo visible', async ({ page }) => {
      await page.goto(BASE);
      await page.evaluate(() => sessionStorage.removeItem('tetris-battle:name'));
      await page.goto(BASE);
      await page.waitForSelector('#name-gate-inline', { state: 'visible', timeout: 5000 });
      await page.fill('#inline-name-input', 'TestUser');
      await page.click('#btn-inline-enter');
      const gate = page.locator('#name-gate-inline');
      await expect(gate).toBeHidden({ timeout: 3000 });
      // 닉네임 입력 후 waiting-solo가 보여야 한다 (submitInlineName에서 remove hidden)
      const solo = page.locator('#waiting-solo');
      await expect(solo).toBeVisible({ timeout: 3000 });
    });

    test('닉네임 입력 후 ready-panel이 visible이다', async ({ page }) => {
      await page.goto(BASE);
      await page.evaluate(() => sessionStorage.removeItem('tetris-battle:name'));
      await page.goto(BASE);
      await page.waitForSelector('#name-gate-inline', { state: 'visible', timeout: 5000 });
      await page.fill('#inline-name-input', 'TestUser2');
      await page.click('#btn-inline-enter');
      const rp = page.locator('#ready-panel');
      await expect(rp).toBeVisible({ timeout: 3000 });
    });

    test('닉네임 입력 후 sessionStorage에 올바르게 저장된다', async ({ page }) => {
      await page.goto(BASE);
      await page.evaluate(() => sessionStorage.removeItem('tetris-battle:name'));
      await page.goto(BASE);
      await page.waitForSelector('#name-gate-inline', { state: 'visible', timeout: 5000 });
      await page.fill('#inline-name-input', 'StorageCheck');
      await page.click('#btn-inline-enter');
      const saved = await page.evaluate(() => sessionStorage.getItem('tetris-battle:name'));
      expect(saved).toBe('StorageCheck');
    });

    test('닉네임 입력 후 JOIN이 서버로 전송된다 (JOINED 수신 확인)', async ({ page }) => {
      await page.goto(BASE);
      await page.evaluate(() => sessionStorage.removeItem('tetris-battle:name'));
      await page.goto(BASE);
      await page.waitForSelector('#name-gate-inline', { state: 'visible', timeout: 5000 });
      await page.fill('#inline-name-input', 'JoinTest');
      await page.click('#btn-inline-enter');
      // JOIN 전송 후 JOINED 수신 → player-label이 "나 (P1)" 또는 "나 (P2)"로 변경
      await page.waitForFunction(
        () => {
          const lbl = document.getElementById('player-label');
          return lbl && (lbl.textContent.includes('P1') || lbl.textContent.includes('P2'));
        },
        { timeout: 5000 },
      );
      const label = await page.locator('#player-label').textContent();
      expect(label).toMatch(/나 \(P[12]\)/);
    });
  });

  // ── 빈/공백 닉네임 심화 ──
  test.describe('빈/공백 닉네임 심화 테스트', () => {
    test('탭 문자만 입력 시 제출되지 않는다', async ({ page }) => {
      await page.goto(BASE);
      await page.evaluate(() => sessionStorage.removeItem('tetris-battle:name'));
      await page.goto(BASE);
      await page.waitForSelector('#name-gate-inline', { state: 'visible', timeout: 5000 });
      await page.evaluate(() => {
        document.getElementById('inline-name-input').value = '\t\t';
      });
      await page.click('#btn-inline-enter');
      const gate = page.locator('#name-gate-inline');
      await expect(gate).toBeVisible();
    });

    test('줄바꿈 문자만 입력 시 제출되지 않는다', async ({ page }) => {
      await page.goto(BASE);
      await page.evaluate(() => sessionStorage.removeItem('tetris-battle:name'));
      await page.goto(BASE);
      await page.waitForSelector('#name-gate-inline', { state: 'visible', timeout: 5000 });
      await page.evaluate(() => {
        document.getElementById('inline-name-input').value = '\n\n';
      });
      await page.click('#btn-inline-enter');
      const gate = page.locator('#name-gate-inline');
      await expect(gate).toBeVisible();
    });
  });

  // ── Enter 키 제출 심화 ──
  test.describe('Enter 키 제출 심화', () => {
    test('빈 상태에서 Enter 키 입력 시 게이트가 유지된다', async ({ page }) => {
      await page.goto(BASE);
      await page.evaluate(() => sessionStorage.removeItem('tetris-battle:name'));
      await page.goto(BASE);
      await page.waitForSelector('#name-gate-inline', { state: 'visible', timeout: 5000 });
      // 빈 입력 상태에서 Enter
      await page.press('#inline-name-input', 'Enter');
      const gate = page.locator('#name-gate-inline');
      await expect(gate).toBeVisible();
    });

    test('Enter 키로 제출 후 sessionStorage에 정상 저장된다', async ({ page }) => {
      await page.goto(BASE);
      await page.evaluate(() => sessionStorage.removeItem('tetris-battle:name'));
      await page.goto(BASE);
      await page.waitForSelector('#name-gate-inline', { state: 'visible', timeout: 5000 });
      await page.fill('#inline-name-input', 'EnterUser2');
      await page.press('#inline-name-input', 'Enter');
      const saved = await page.evaluate(() => sessionStorage.getItem('tetris-battle:name'));
      expect(saved).toBe('EnterUser2');
    });
  });

  // ── sessionStorage 이미 있는 경우 (onOpen hasName=true 경로) ──
  test.describe('sessionStorage 보유 시 게이트 건너뛰기', () => {
    test('이름이 있으면 게이트가 표시되지 않는다', async ({ page }) => {
      await page.goto(BASE);
      await page.evaluate(() => sessionStorage.setItem('tetris-battle:name', 'ExistingUser'));
      await page.goto(BASE);
      await page.waitForSelector('#screen-waiting', { state: 'visible', timeout: 5000 });
      const gate = page.locator('#name-gate-inline');
      await expect(gate).toBeHidden();
    });

    test('이름이 있으면 자동 JOIN이 전송된다 (JOINED 수신 확인)', async ({ page }) => {
      await page.goto(BASE);
      await page.evaluate(() => sessionStorage.setItem('tetris-battle:name', 'AutoJoiner'));
      await page.goto(BASE);
      await page.waitForFunction(
        () => {
          const lbl = document.getElementById('player-label');
          return lbl && (lbl.textContent.includes('P1') || lbl.textContent.includes('P2'));
        },
        { timeout: 5000 },
      );
      const label = await page.locator('#player-label').textContent();
      expect(label).toMatch(/나 \(P[12]\)/);
    });
  });

  // ── URL ?name= 경로 ──
  test.describe('URL ?name= 파라미터 경로', () => {
    test('?name= 파라미터로 sessionStorage에 저장되고 게이트 건너뛴다', async ({ page }) => {
      await page.goto(BASE);
      await page.evaluate(() => sessionStorage.removeItem('tetris-battle:name'));
      await page.goto(`${BASE}/?name=URLParamUser`);
      await page.waitForSelector('#screen-waiting', { state: 'visible', timeout: 5000 });
      const gate = page.locator('#name-gate-inline');
      await expect(gate).toBeHidden();
      const saved = await page.evaluate(() => sessionStorage.getItem('tetris-battle:name'));
      expect(saved).toBe('URLParamUser');
    });

    test('?name= 파라미터가 12자 초과 시 잘린다', async ({ page }) => {
      await page.goto(BASE);
      await page.evaluate(() => sessionStorage.removeItem('tetris-battle:name'));
      await page.goto(`${BASE}/?name=ABCDEFGHIJKLMNOP`);
      await page.waitForSelector('#screen-waiting', { state: 'visible', timeout: 5000 });
      const saved = await page.evaluate(() => sessionStorage.getItem('tetris-battle:name'));
      expect(saved).toBe('ABCDEFGHIJKL');
    });
  });

  // ── 정적 분석 보완: READY_STATE / OPPONENT_LEFT 라우팅 확인 ──
  test.describe('정적 분석: READY_STATE 라우팅 확인', () => {
    test('network.js에 READY_STATE case가 존재한다', async ({ page }) => {
      // 정적 분석이므로 페이지 로드 후 network 모듈의 route 함수에 READY_STATE가 있는지
      // 소스를 가져와서 확인
      const resp = await page.goto(`${BASE}/js/network.js`);
      const src = await resp.text();
      expect(src).toContain("case 'READY_STATE':");
    });

    test('network.js에 OPPONENT_LEFT case가 존재한다', async ({ page }) => {
      const resp = await page.goto(`${BASE}/js/network.js`);
      const src = await resp.text();
      expect(src).toContain("case 'OPPONENT_LEFT':");
    });
  });

  // ── 콘솔 에러 재검증 ──
  test.describe('콘솔 에러 재검증', () => {
    test('닉네임 게이트 표시 → 입력 → 제출 전체 흐름에서 에러 없음', async ({ page }) => {
      const errors = [];
      page.on('pageerror', (err) => errors.push(err.message));
      await page.goto(BASE);
      await page.evaluate(() => sessionStorage.removeItem('tetris-battle:name'));
      await page.goto(BASE);
      await page.waitForSelector('#name-gate-inline', { state: 'visible', timeout: 5000 });
      await page.fill('#inline-name-input', 'FullFlowUser');
      await page.click('#btn-inline-enter');
      // JOIN 전송 → JOINED 수신 대기
      await page.waitForFunction(
        () => {
          const lbl = document.getElementById('player-label');
          return lbl && lbl.textContent.includes('P');
        },
        { timeout: 5000 },
      );
      await page.waitForTimeout(500);
      expect(errors).toEqual([]);
    });

    test('?name= 경로에서도 에러 없음', async ({ page }) => {
      const errors = [];
      page.on('pageerror', (err) => errors.push(err.message));
      await page.goto(BASE);
      await page.evaluate(() => sessionStorage.removeItem('tetris-battle:name'));
      await page.goto(`${BASE}/?name=NoErrorURL`);
      await page.waitForSelector('#screen-waiting', { state: 'visible', timeout: 5000 });
      await page.waitForTimeout(1000);
      expect(errors).toEqual([]);
    });
  });

  // ── 시각적 검증 ──
  test.describe('시각적 검증', () => {
    test('닉네임 게이트 표시 중 스크린샷 (수정 후)', async ({ page }) => {
      await page.goto(BASE);
      await page.evaluate(() => sessionStorage.removeItem('tetris-battle:name'));
      await page.goto(BASE);
      await page.waitForSelector('#name-gate-inline', { state: 'visible', timeout: 5000 });
      await page.screenshot({
        path: 'tests/screenshots/tetris-name-gate-fixed.png',
      });
    });

    test('닉네임 입력 후 대기 화면 스크린샷 (수정 후)', async ({ page }) => {
      await page.goto(BASE);
      await page.evaluate(() => sessionStorage.removeItem('tetris-battle:name'));
      await page.goto(BASE);
      await page.waitForSelector('#name-gate-inline', { state: 'visible', timeout: 5000 });
      await page.fill('#inline-name-input', 'ScreenshotUser');
      await page.click('#btn-inline-enter');
      await page.waitForSelector('#name-gate-inline', { state: 'hidden', timeout: 3000 });
      // JOIN 수신까지 대기
      await page.waitForFunction(
        () => {
          const lbl = document.getElementById('player-label');
          return lbl && lbl.textContent.includes('P');
        },
        { timeout: 5000 },
      );
      await page.waitForTimeout(500);
      await page.screenshot({
        path: 'tests/screenshots/tetris-after-name-entry.png',
      });
    });

    test('모바일 뷰포트(375x667)에서 닉네임 게이트 표시', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto(BASE);
      await page.evaluate(() => sessionStorage.removeItem('tetris-battle:name'));
      await page.goto(BASE);
      await page.waitForSelector('#name-gate-inline', { state: 'visible', timeout: 5000 });
      await page.screenshot({
        path: 'tests/screenshots/tetris-mobile-gate.png',
      });
    });
  });
});
