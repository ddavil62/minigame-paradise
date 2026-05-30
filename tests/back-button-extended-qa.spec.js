/**
 * @fileoverview 상시 뒤로가기 버튼 확장 QA 테스트.
 *
 *   CSS 특이도 버그, 좁은 뷰포트, 콘솔 에러 등 엣지케이스 검증.
 *   실행: cd minigame-paradise && npx playwright test tests/back-button-extended-qa.spec.js --reporter=list
 *   사전 조건: node launcher/server.js (포트 3000) 실행 중
 */

import { test, expect } from '@playwright/test';
import { mkdirSync } from 'fs';

const SS = 'tests/screenshots';
try { mkdirSync(SS, { recursive: true }); } catch {}

const GAMES = [
  { id: 'matgo', path: '/matgo/' },
  { id: 'tetris-battle', path: '/tetris-battle/' },
  { id: 'davinci-code', path: '/davinci-code/' },
  { id: 'yutnori', path: '/yutnori/' },
  { id: 'codenames-duet', path: '/codenames-duet/' },
];

// =====================================================================
// EQ-1: matgo CSS 특이도 검증 — .meta-panel button vs .btn-back-to-lobby
// =====================================================================
test.describe('EQ-1: matgo CSS 특이도', () => {
  test('matgo #btn-back-to-lobby 배경이 transparent여야 한다 (gradient가 아닌)', async ({ page }) => {
    await page.goto('/matgo/', { waitUntil: 'domcontentloaded' });
    const btn = page.locator('#btn-back-to-lobby');
    const bg = await btn.evaluate(el => window.getComputedStyle(el).background);
    const bgColor = await btn.evaluate(el => window.getComputedStyle(el).backgroundColor);
    const bgImage = await btn.evaluate(el => window.getComputedStyle(el).backgroundImage);
    // btn-back-to-lobby should have transparent background, NOT the gold gradient
    // .meta-panel button has: background: linear-gradient(180deg, #b08040, #804020)
    // .btn-back-to-lobby has: background: transparent
    // If specificity bug exists, bgImage will contain 'gradient'
    console.log(`matgo btn background: ${bg}`);
    console.log(`matgo btn backgroundColor: ${bgColor}`);
    console.log(`matgo btn backgroundImage: ${bgImage}`);
    expect(bgImage).not.toContain('gradient');
  });

  test('matgo #btn-back-to-lobby 색상이 gold-soft 60% 투명이어야 한다', async ({ page }) => {
    await page.goto('/matgo/', { waitUntil: 'domcontentloaded' });
    const btn = page.locator('#btn-back-to-lobby');
    const color = await btn.evaluate(el => window.getComputedStyle(el).color);
    console.log(`matgo btn color: ${color}`);
    // Should be rgba(245, 222, 179, 0.6), NOT rgb(255, 255, 255) which is .meta-panel button color
    expect(color).not.toBe('rgb(255, 255, 255)');
  });
});

// =====================================================================
// EQ-2: 5개 게임 스크린샷 캡처 (시각적 검증용)
// =====================================================================
test.describe('EQ-2: 시각적 검증 스크린샷', () => {
  for (const game of GAMES) {
    test(`${game.id} 게임 전체 화면 스크린샷`, async ({ page }) => {
      await page.goto(game.path, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(500); // CSS render 안정화
      await page.screenshot({ path: `${SS}/back-btn-${game.id}-full.png`, fullPage: true });
    });
  }
});

// =====================================================================
// EQ-3: 좁은 뷰포트(360px) 헤더 overflow 검증
// =====================================================================
test.describe('EQ-3: 좁은 뷰포트(360px) overflow', () => {
  for (const game of GAMES) {
    test(`${game.id} 360px 뷰포트에서 헤더 overflow 없음`, async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 640 });
      await page.goto(game.path, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(300);

      // 스크린샷 캡처
      await page.screenshot({ path: `${SS}/back-btn-${game.id}-narrow.png`, fullPage: true });

      // #btn-back-to-lobby가 화면 내에 있는지 (잘리지 않는지) 확인
      const btn = page.locator('#btn-back-to-lobby');
      const box = await btn.boundingBox();
      if (box) {
        // 버튼의 우측 끝이 뷰포트 너비(360) 이내인지
        expect(box.x + box.width).toBeLessThanOrEqual(360);
        // 버튼이 잘리지 않고 완전히 보이는지
        expect(box.x).toBeGreaterThanOrEqual(0);
      }
    });
  }
});

// =====================================================================
// EQ-4: 콘솔 에러 검증
// =====================================================================
test.describe('EQ-4: 콘솔 에러 없음', () => {
  for (const game of GAMES) {
    test(`${game.id} 페이지 로드 시 JS 에러 없음`, async ({ page }) => {
      const errors = [];
      page.on('pageerror', err => errors.push(err.message));

      await page.goto(game.path, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);

      // WebSocket 연결 관련 에러는 서버 상태에 따라 발생할 수 있으므로 필터링
      const criticalErrors = errors.filter(e =>
        !e.includes('WebSocket') && !e.includes('ECONNREFUSED')
      );
      expect(criticalErrors).toEqual([]);
    });
  }
});

// =====================================================================
// EQ-5: confirm 다이얼로그 5개 게임 전부 검증 (matgo만이 아닌 전수)
// =====================================================================
test.describe('EQ-5: 5개 게임 모두 confirm 동작', () => {
  for (const game of GAMES) {
    test(`${game.id} confirm 다이얼로그 표시 + 취소 시 유지`, async ({ page }) => {
      await page.goto(game.path, { waitUntil: 'domcontentloaded' });
      const originalUrl = page.url();
      let dialogMsg = '';

      page.on('dialog', async (dialog) => {
        dialogMsg = dialog.message();
        await dialog.dismiss();
      });

      await page.click('#btn-back-to-lobby');
      await page.waitForTimeout(300);

      // confirm 메시지 확인
      expect(dialogMsg).toContain('상대방도 함께 로비로 이동합니다');
      // URL 변경 없음
      expect(page.url()).toBe(originalUrl);
    });
  }
});

// =====================================================================
// EQ-6: 기존 #btn-return-lobby에 confirm이 없는지 검증 (FR-6)
// =====================================================================
test.describe('EQ-6: 결과화면 btn-return-lobby에 confirm 없음', () => {
  test('matgo #btn-return-lobby 클릭 시 confirm 없이 즉시 이동 시도', async ({ page }) => {
    await page.goto('/matgo/', { waitUntil: 'domcontentloaded' });

    let dialogShown = false;
    page.on('dialog', async (dialog) => {
      dialogShown = true;
      await dialog.dismiss();
    });

    // 결과 모달이 hidden이므로 JS로 직접 클릭
    // 모달을 visible 상태로 만들어 클릭 테스트
    await page.evaluate(() => {
      const modal = document.getElementById('round-modal');
      if (modal) modal.classList.remove('hidden');
    });

    // route 인터셉트로 실제 네비게이션 방지
    await page.route('**/lobby/return', async (route) => {
      await route.fulfill({ status: 204 });
    });

    const btn = page.locator('#btn-return-lobby');
    if (await btn.isVisible()) {
      await btn.click({ timeout: 2000 });
      await page.waitForTimeout(300);
      // confirm 다이얼로그가 표시되지 않아야 함
      expect(dialogShown).toBe(false);
    }
  });
});

// =====================================================================
// EQ-7: 버튼 연타 (더블클릭) 안정성
// =====================================================================
test.describe('EQ-7: 버튼 연타 안정성', () => {
  test('matgo btn-back-to-lobby 빠른 더블클릭 시 에러 없음', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto('/matgo/', { waitUntil: 'domcontentloaded' });

    let dialogCount = 0;
    page.on('dialog', async (dialog) => {
      dialogCount++;
      await dialog.dismiss();
    });

    // 빠른 연속 클릭
    await page.click('#btn-back-to-lobby');
    await page.waitForTimeout(100);
    await page.click('#btn-back-to-lobby');
    await page.waitForTimeout(100);
    await page.click('#btn-back-to-lobby');

    await page.waitForTimeout(500);

    // JS 에러 없어야 함
    const criticalErrors = errors.filter(e => !e.includes('WebSocket'));
    expect(criticalErrors).toEqual([]);
  });
});
