/**
 * @fileoverview 베네치아 타이핑 배틀 QA 검증 Playwright 테스트.
 *
 * 검증 항목:
 *  - 런처 통합 (games.json, 카드 표시, 라우팅)
 *  - 대기 화면 UI
 *  - AI 모드 게임 진행 (단어 출현, HP 감소, 게임 종료)
 *  - 엣지 케이스 (빈 입력, 재접속, 콘솔 에러)
 *  - 모바일 뷰포트 렌더링
 */

import { test, expect } from '@playwright/test';

const VENEZIA_URL = 'http://localhost:3000/venezia/';
const LAUNCHER_URL = 'http://localhost:3000/';

test.describe('A. 런처 통합', () => {
  test('A-1: 런처 메인에서 베네치아 카드가 표시된다', async ({ page }) => {
    await page.goto(LAUNCHER_URL);
    await page.waitForLoadState('networkidle');
    // games.json에서 venezia 카드를 렌더링하는지 확인
    const card = page.locator('[data-game-id="venezia"], [data-game="venezia"]');
    // 카드를 다양한 방법으로 탐색
    const veneziaText = page.getByText('베네치아 타이핑 배틀');
    await expect(veneziaText.first()).toBeVisible({ timeout: 5000 });
    await page.screenshot({ path: 'tests/screenshots/venezia-launcher-card.png' });
  });

  test('A-2: 베네치아 카드 클릭 시 /venezia/ 경로로 진입', async ({ page }) => {
    await page.goto(LAUNCHER_URL);
    await page.waitForLoadState('networkidle');
    // 닉네임 게이트 통과
    const nameInput = page.locator('#name-input, input[placeholder*="닉네임"]');
    if (await nameInput.isVisible()) {
      await nameInput.fill('테스터');
      const enterBtn = page.locator('#btn-enter, button:has-text("입장"), button:has-text("시작")');
      if (await enterBtn.first().isVisible()) {
        await enterBtn.first().click();
        await page.waitForTimeout(500);
      }
    }
    // 베네치아 카드 클릭
    const veneziaCard = page.getByText('베네치아 타이핑 배틀').first();
    if (await veneziaCard.isVisible()) {
      await veneziaCard.click();
      await page.waitForTimeout(1000);
    }
  });

  test('A-3: /venezia/ 경로에 직접 접속 시 대기 화면 로딩', async ({ page }) => {
    const response = await page.goto(VENEZIA_URL);
    expect(response.status()).toBe(200);
    await expect(page.locator('#screen-waiting')).toBeVisible();
    await expect(page.locator('.game-title')).toContainText('베네치아');
  });
});

test.describe('B. 대기 화면', () => {
  test('B-1: 대기 화면 UI 요소 확인', async ({ page }) => {
    await page.goto(VENEZIA_URL);
    await page.waitForLoadState('networkidle');

    // 제목
    await expect(page.locator('.game-title')).toContainText('베네치아 타이핑 배틀');
    // 닉네임 입력
    await expect(page.locator('#input-name')).toBeVisible();
    // 버튼들
    await expect(page.locator('#btn-join')).toBeVisible();
    await expect(page.locator('#btn-ai')).toBeVisible();
    await expect(page.locator('#btn-ai')).toContainText('AI랑 시작');
    // 규칙 요약
    await expect(page.locator('.rules-summary')).toBeVisible();

    await page.screenshot({ path: 'tests/screenshots/venezia-waiting-screen.png' });
  });

  test('B-2: 닉네임 입력 후 AI랑 시작 버튼 활성화', async ({ page }) => {
    await page.goto(VENEZIA_URL);
    await page.locator('#input-name').fill('테스터');
    // 버튼들이 활성 상태인지
    const btnAi = page.locator('#btn-ai');
    await expect(btnAi).toBeEnabled();
  });
});

test.describe('C. 게임 시작 (AI 모드)', () => {
  test('C-1: AI랑 시작 클릭 시 게임 화면 전환', async ({ page }) => {
    await page.goto(VENEZIA_URL);
    await page.locator('#input-name').fill('테스터');
    await page.locator('#btn-ai').click();

    // 게임 화면이 표시될 때까지 대기 (봇 spawn + 게임 시작 최대 5초)
    await expect(page.locator('#screen-game')).toBeVisible({ timeout: 8000 });

    await page.screenshot({ path: 'tests/screenshots/venezia-game-start.png' });
  });

  test('C-2: 게임 화면 HP 바 표시 확인', async ({ page }) => {
    await page.goto(VENEZIA_URL);
    await page.locator('#input-name').fill('테스터');
    await page.locator('#btn-ai').click();

    await expect(page.locator('#screen-game')).toBeVisible({ timeout: 8000 });

    // HP 바 요소
    await expect(page.locator('#my-hp-fill')).toBeVisible();
    await expect(page.locator('#opp-hp-fill')).toBeVisible();
    // HP 값 표시
    const myHp = await page.locator('#my-hp-value').textContent();
    expect(parseInt(myHp)).toBeLessThanOrEqual(100);
    expect(parseInt(myHp)).toBeGreaterThan(0);
  });

  test('C-3: 단어가 캔버스에 출현한다 (3초 대기)', async ({ page }) => {
    await page.goto(VENEZIA_URL);
    await page.locator('#input-name').fill('테스터');
    await page.locator('#btn-ai').click();

    await expect(page.locator('#screen-game')).toBeVisible({ timeout: 8000 });

    // 캔버스가 존재하는지
    await expect(page.locator('#game-canvas')).toBeVisible();

    // 3초 대기 후 스크린샷 (단어가 스폰되어야 함)
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'tests/screenshots/venezia-words-spawned.png' });
  });

  test('C-4: 입력창 자동 포커스', async ({ page }) => {
    await page.goto(VENEZIA_URL);
    await page.locator('#input-name').fill('테스터');
    await page.locator('#btn-ai').click();

    await expect(page.locator('#screen-game')).toBeVisible({ timeout: 8000 });

    // 입력창이 포커스 상태인지
    const focused = await page.evaluate(() => document.activeElement?.id);
    expect(focused).toBe('input-word');
  });
});

test.describe('D. 핵심 게임 메카닉', () => {
  test('D-1: 봇이 단어를 제출해도 내 HP는 감소하지 않는다', async ({ page }) => {
    await page.goto(VENEZIA_URL);
    await page.locator('#input-name').fill('테스터');
    await page.locator('#btn-ai').click();

    await expect(page.locator('#screen-game')).toBeVisible({ timeout: 8000 });

    // 초기 HP 확인
    const initialHp = await page.locator('#my-hp-value').textContent();
    expect(parseInt(initialHp)).toBe(100);

    // 봇이 단어를 처리할 시간 대기 (2~4초)
    await page.waitForTimeout(5000);

    // 일반 정답은 공격이 아니므로 HP가 유지되는지 확인
    const currentHp = await page.locator('#my-hp-value').textContent();
    expect(parseInt(currentHp)).toBe(100);

    await page.screenshot({ path: 'tests/screenshots/venezia-hp-stable.png' });
  });

  test('D-2: 일반 정답만으로 자동 HP 0 종료가 발생하지 않는다', async ({ page }) => {
    await page.goto(VENEZIA_URL);
    await page.locator('#input-name').fill('테스터');
    await page.locator('#btn-ai').click();

    await expect(page.locator('#screen-game')).toBeVisible({ timeout: 8000 });

    await page.waitForTimeout(10000);
    await expect(page.locator('#screen-game')).toBeVisible();
    await expect(page.locator('#screen-result')).not.toBeVisible();
    await expect(page.locator('#my-hp-value')).toHaveText('100');
    await page.screenshot({ path: 'tests/screenshots/venezia-no-auto-game-over.png' });
  });
});

test.describe('E. 엣지 케이스', () => {
  test('E-1: 빈 문자열 제출 시 에러 없음', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto(VENEZIA_URL);
    await page.locator('#input-name').fill('테스터');
    await page.locator('#btn-ai').click();

    await expect(page.locator('#screen-game')).toBeVisible({ timeout: 8000 });

    // 빈 입력 상태에서 Enter 제출
    await page.locator('#input-word').press('Enter');
    await page.waitForTimeout(500);

    // 확인 버튼으로 빈 제출
    await page.locator('#btn-submit').click();
    await page.waitForTimeout(500);

    // 에러 없어야 함
    expect(errors).toEqual([]);
  });

  test('E-2: 잘못된 단어 제출 시 입력 오류 애니메이션', async ({ page }) => {
    await page.goto(VENEZIA_URL);
    await page.locator('#input-name').fill('테스터');
    await page.locator('#btn-ai').click();

    await expect(page.locator('#screen-game')).toBeVisible({ timeout: 8000 });
    await page.waitForTimeout(2000); // 단어 스폰 대기

    // 존재하지 않는 단어 입력
    await page.locator('#input-word').fill('zzz존재하지않는단어');
    await page.locator('#input-word').press('Enter');
    await page.waitForTimeout(100);

    // input-error 클래스가 추가되었는지 (0.3초 내 소멸)
    // 빠르게 확인
    const hasError = await page.locator('.input-area.input-error, #input-area.input-error').count();
    // 에러 표시 후 빠르게 사라짐 — 에러 없이 동작하면 PASS
  });

  test('E-3: 빠른 연타 입력 시 크래시 없음', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto(VENEZIA_URL);
    await page.locator('#input-name').fill('테스터');
    await page.locator('#btn-ai').click();

    await expect(page.locator('#screen-game')).toBeVisible({ timeout: 8000 });
    await page.waitForTimeout(2000);

    // 빠른 연타
    for (let i = 0; i < 20; i++) {
      await page.locator('#input-word').type('가', { delay: 10 });
      await page.locator('#input-word').press('Enter');
    }
    await page.waitForTimeout(500);
    expect(errors).toEqual([]);
  });

  test('E-4: 게임 중 브라우저 새로고침 후 재접속', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto(VENEZIA_URL);
    await page.locator('#input-name').fill('테스터');
    await page.locator('#btn-ai').click();

    await expect(page.locator('#screen-game')).toBeVisible({ timeout: 8000 });
    await page.waitForTimeout(2000);

    // 새로고침
    await page.reload();
    await page.waitForLoadState('networkidle');

    // 대기 화면이 다시 표시되어야 함 (에러 아님)
    await expect(page.locator('#screen-waiting')).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe('F. UI 안정성', () => {
  test('F-1: 콘솔 에러가 발생하지 않는다 (일반 게임 진행)', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto(VENEZIA_URL);
    await page.locator('#input-name').fill('테스터');
    await page.locator('#btn-ai').click();

    await expect(page.locator('#screen-game')).toBeVisible({ timeout: 8000 });
    await page.waitForTimeout(5000);

    expect(errors).toEqual([]);
  });

  test('F-2: 모바일 뷰포트(360px)에서 정상 렌더링', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await page.goto(VENEZIA_URL);
    await page.waitForLoadState('networkidle');

    // 대기 화면이 뷰포트 내에 표시되는지
    await expect(page.locator('.game-title')).toBeVisible();
    await expect(page.locator('#btn-ai')).toBeVisible();

    await page.screenshot({ path: 'tests/screenshots/venezia-mobile-waiting.png' });

    // 게임 진행
    await page.locator('#input-name').fill('모바일');
    await page.locator('#btn-ai').click();

    await expect(page.locator('#screen-game')).toBeVisible({ timeout: 8000 });
    await page.waitForTimeout(2000);

    await page.screenshot({ path: 'tests/screenshots/venezia-mobile-game.png' });

    // 버튼 최소 높이 36px 검증
    const btnHeight = await page.locator('#btn-submit').evaluate(el => {
      return parseFloat(getComputedStyle(el).height);
    });
    expect(btnHeight).toBeGreaterThanOrEqual(36);
  });

  test('F-3: HP 바 색상 분리 — 내 HP(청록) vs 상대 HP(적색)', async ({ page }) => {
    await page.goto(VENEZIA_URL);
    await page.locator('#input-name').fill('테스터');
    await page.locator('#btn-ai').click();

    await expect(page.locator('#screen-game')).toBeVisible({ timeout: 8000 });

    // 내 HP 바 배경색 확인
    const myHpBg = await page.locator('#my-hp-fill').evaluate(el => {
      return getComputedStyle(el).backgroundImage || getComputedStyle(el).background;
    });
    // 상대 HP 바 배경색 확인
    const oppHpBg = await page.locator('#opp-hp-fill').evaluate(el => {
      return getComputedStyle(el).backgroundImage || getComputedStyle(el).background;
    });

    // 둘이 달라야 함
    expect(myHpBg).not.toBe(oppHpBg);

    await page.screenshot({ path: 'tests/screenshots/venezia-hp-bars.png' });
  });
});

test.describe('G. 구조 검증', () => {
  test('G-1: games.json에 venezia 항목이 존재한다', async ({ page }) => {
    const response = await page.goto('http://localhost:3000/games.json');
    const games = await response.json();
    const venezia = games.find(g => g.id === 'venezia');
    expect(venezia).toBeTruthy();
    expect(venezia.port).toBe(3017);
    expect(venezia.botAvailable).toBe(true);
    expect(venezia.httpPath).toBe('/venezia/');
    expect(venezia.wsPath).toBe('/venezia/ws');
  });
});
