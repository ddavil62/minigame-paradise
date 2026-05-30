/**
 * @fileoverview 상시 뒤로가기 버튼(#btn-back-to-lobby) QA 테스트.
 *
 *   스펙: .claude/specs/2026-05-31-minigame-back-button-plan.md
 *   검증 항목 BB-01 ~ BB-10
 *
 *   실행: cd minigame-paradise && npx playwright test tests/back-button-qa.spec.js --reporter=list
 *   사전 조건: node launcher/server.js (포트 3000) 실행 중
 */

import { test, expect } from '@playwright/test';

// 5개 게임 경로 목록
const GAMES = [
  { id: 'matgo', path: '/matgo/', label: 'matgo' },
  { id: 'tetris-battle', path: '/tetris-battle/', label: 'tetris-battle' },
  { id: 'davinci-code', path: '/davinci-code/', label: 'davinci-code' },
  { id: 'yutnori', path: '/yutnori/', label: 'yutnori' },
  { id: 'codenames-duet', path: '/codenames-duet/', label: 'codenames-duet' },
];

// =====================================================================
// S1 : 각 게임에 #btn-back-to-lobby 버튼 존재 검증
// =====================================================================
test.describe('S1: 상시 뒤로가기 버튼 존재 (BB-01~BB-05)', () => {

  for (const game of GAMES) {
    test(`BB-${String(GAMES.indexOf(game) + 1).padStart(2, '0')}: ${game.label}에 #btn-back-to-lobby 존재`, async ({ page }) => {
      await page.goto(game.path, { waitUntil: 'domcontentloaded' });

      const btn = page.locator('#btn-back-to-lobby');
      // 정확히 1개만 존재
      await expect(btn).toHaveCount(1);
      // 텍스트에 '게임 선택' 포함
      const text = await btn.textContent();
      expect(text).toContain('게임 선택');
      // 화면에 표시됨 (visible)
      await expect(btn).toBeVisible();
    });
  }
});

// =====================================================================
// S2 : confirm 다이얼로그 동작 검증 (matgo 기준)
// =====================================================================
test.describe('S2: confirm 다이얼로그 동작 (BB-06~BB-08)', () => {

  test('BB-06: matgo 버튼 클릭 시 confirm 다이얼로그 표시', async ({ page }) => {
    await page.goto('/matgo/', { waitUntil: 'domcontentloaded' });

    let dialogMessage = '';
    page.on('dialog', async (dialog) => {
      dialogMessage = dialog.message();
      await dialog.dismiss();
    });

    await page.click('#btn-back-to-lobby');
    // 다이얼로그 메시지에 '상대방도' 포함
    expect(dialogMessage).toContain('상대방도');
  });

  test('BB-07: matgo 버튼 confirm 취소 시 페이지 이동 없음', async ({ page }) => {
    await page.goto('/matgo/', { waitUntil: 'domcontentloaded' });
    const originalUrl = page.url();

    page.on('dialog', async (dialog) => {
      await dialog.dismiss();
    });

    await page.click('#btn-back-to-lobby');
    // 짧은 대기 후 URL 변경 없음 확인
    await page.waitForTimeout(500);
    expect(page.url()).toBe(originalUrl);
  });

  test('BB-08: matgo 버튼 confirm 확인 시 POST /lobby/return 호출', async ({ page }) => {
    await page.goto('/matgo/', { waitUntil: 'domcontentloaded' });

    let lobbyReturnCalled = false;

    // /lobby/return 경로 인터셉트
    await page.route('**/lobby/return', async (route) => {
      lobbyReturnCalled = true;
      await route.fulfill({ status: 204 });
    });

    // 루트 이동도 인터셉트 (실제 네비게이션 방지)
    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });

    await page.click('#btn-back-to-lobby');

    // POST /lobby/return 호출 확인 (네비게이션 전에 fetch가 발생)
    // 네비게이션이 빠르게 일어나므로 짧은 대기
    await page.waitForTimeout(300);
    expect(lobbyReturnCalled).toBe(true);
  });
});

// =====================================================================
// S3 : 기존 #btn-return-lobby 유지 확인 (BB-09)
// =====================================================================
test.describe('S3: 기존 결과 화면 #btn-return-lobby 유지 (BB-09)', () => {

  for (const game of GAMES) {
    test(`BB-09-${game.label}: ${game.label} 결과 화면에 #btn-return-lobby 존재`, async ({ page }) => {
      await page.goto(game.path, { waitUntil: 'domcontentloaded' });

      // DOM에 #btn-return-lobby가 정확히 1개 존재 (결과 모달/오버레이 내)
      const returnBtn = page.locator('#btn-return-lobby');
      await expect(returnBtn).toHaveCount(1);
    });
  }
});

// =====================================================================
// S4 : 양쪽 클라이언트 동시 복귀 검증 (BB-10) — 서버 실행 필요
// =====================================================================
test.describe('S4: 양쪽 클라이언트 동시 복귀 (BB-10)', () => {

  test('BB-10: P1이 btn-back-to-lobby 클릭 시 P2도 로비로 이동', async ({ browser }) => {
    const p1 = await browser.newPage();
    const p2 = await browser.newPage();

    // 양쪽 모두 matgo에 접속
    await p1.goto('/matgo/', { waitUntil: 'domcontentloaded' });
    await p2.goto('/matgo/', { waitUntil: 'domcontentloaded' });

    // WS 연결이 양쪽 모두 안정화되기를 기다린다 (CI 타이밍 안정성)
    await p2.waitForTimeout(500);

    // P1이 navigate하면 게임 WS가 끊기고 서버가 P2에 OPPONENT_LEFT를 보낸다.
    // P2 클라이언트가 런처 모드 감지 후 1.2초 뒤 로비로 자동 복귀한다.
    const p2UrlPromise = p2.waitForURL('http://localhost:3000/', { timeout: 8000 }).catch(() => null);

    // P1에서 confirm 자동 수락 설정
    p1.on('dialog', async (dialog) => {
      await dialog.accept();
    });

    // P1이 뒤로가기 버튼 클릭
    await p1.click('#btn-back-to-lobby');

    // P1은 location.href='/'로 직접 이동
    await p1.waitForURL('http://localhost:3000/', { timeout: 5000 });
    expect(p1.url()).toBe('http://localhost:3000/');

    // P2도 OPPONENT_LEFT 수신 → 런처 모드 감지 → 로비로 자동 복귀
    await p2UrlPromise;
    expect(p2.url()).toBe('http://localhost:3000/');

    await p1.close();
    await p2.close();
  });
});
