/**
 * @fileoverview 장기 입장 UI 통일 Phase 3 QA 테스트.
 *
 * 검증 항목:
 *   - 직접 URL 접근 시 #screen-waiting 먼저 표시
 *   - #name-gate-inline — 닉네임 없으면 표시, 입력 후 hidden
 *   - #btn-start-ai 존재 (botAvailable=true in games.json)
 *   - sessionStorage janggi:name 저장
 *   - #opponent-left-banner 존재 + 초기 hidden
 *   - 빈/공백 닉네임 제출 차단
 *   - Enter 키 닉네임 제출
 *   - AI봇 READY 자동 응답
 *   - broadcastReadyState() 정적 분석 → 서버 코드 리뷰
 *   - 콘솔 에러 없음
 *
 * 서버: node janggi/server.js --port 3006
 */

import { test, expect, chromium } from '@playwright/test';

const BASE_URL = 'http://localhost:3006';
const VIEWPORT = { width: 1280, height: 800 };

// ── 유틸 ──────────────────────────────────────────────

/** 두 독립 컨텍스트로 P1/P2 페이지를 생성. */
async function setupTwoPlayers() {
  const browser = await chromium.launch();
  const ctxP1 = await browser.newContext({ viewport: VIEWPORT });
  const ctxP2 = await browser.newContext({ viewport: VIEWPORT });
  const pageP1 = await ctxP1.newPage();
  const pageP2 = await ctxP2.newPage();
  return { browser, ctxP1, ctxP2, pageP1, pageP2 };
}

// ── 정상 동작 ─────────────────────────────────────────────

test.describe('janggi 입장 UI 통일 — 정상 동작', () => {
  test('AC-01: 직접 URL 접근 시 #screen-waiting 먼저 표시', async () => {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: VIEWPORT });
    const page = await ctx.newPage();
    try {
      await page.goto(BASE_URL);
      await page.waitForTimeout(1000);
      // screen-waiting 표시
      const waitingVisible = await page.locator('#screen-waiting').isVisible();
      expect(waitingVisible).toBe(true);
      // screen-game 숨김
      const gameHidden = await page.locator('#screen-game').isHidden();
      expect(gameHidden).toBe(true);
    } finally {
      await browser.close();
    }
  });

  test('AC-02: #name-gate-inline — 닉네임 없으면 표시, 입력 후 hidden', async () => {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: VIEWPORT });
    const page = await ctx.newPage();
    try {
      await page.goto(BASE_URL);
      await page.waitForTimeout(1000);
      // 게이트 표시
      const gateVisible = await page.locator('#name-gate-inline').isVisible();
      expect(gateVisible).toBe(true);
      // 닉네임 입력 + 입장
      await page.fill('#inline-name-input', '장기테스터');
      await page.click('#btn-inline-enter');
      await page.waitForTimeout(500);
      // 게이트 숨김
      const gateHidden = await page.locator('#name-gate-inline').isHidden();
      expect(gateHidden).toBe(true);
    } finally {
      await browser.close();
    }
  });

  test('AC-03: #btn-start-ai 존재 (AI 진입 버튼)', async () => {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: VIEWPORT });
    const page = await ctx.newPage();
    try {
      await page.goto(BASE_URL);
      const btnCount = await page.locator('#btn-start-ai').count();
      expect(btnCount).toBe(1);
      const text = await page.locator('#btn-start-ai').textContent();
      expect(text).toContain('AI랑 시작');
    } finally {
      await browser.close();
    }
  });

  test('AC-04: sessionStorage janggi:name 저장', async () => {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: VIEWPORT });
    const page = await ctx.newPage();
    try {
      await page.goto(BASE_URL);
      await page.waitForTimeout(1000);
      await page.fill('#inline-name-input', '세션장기');
      await page.click('#btn-inline-enter');
      await page.waitForTimeout(500);
      const storedName = await page.evaluate(() => sessionStorage.getItem('janggi:name'));
      expect(storedName).toBe('세션장기');
    } finally {
      await browser.close();
    }
  });

  test('AC-05: #opponent-left-banner 존재 + 초기 hidden', async () => {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: VIEWPORT });
    const page = await ctx.newPage();
    try {
      await page.goto(BASE_URL);
      await page.waitForTimeout(500);
      const bannerCount = await page.locator('#opponent-left-banner').count();
      expect(bannerCount).toBe(1);
      const hasHidden = await page.locator('#opponent-left-banner').evaluate(
        (el) => el.classList.contains('hidden'),
      );
      expect(hasHidden).toBe(true);
    } finally {
      await browser.close();
    }
  });

  test('AC-06: Enter 키 닉네임 제출', async () => {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: VIEWPORT });
    const page = await ctx.newPage();
    try {
      await page.goto(BASE_URL);
      await page.waitForTimeout(1000);
      await expect(page.locator('#name-gate-inline')).toBeVisible();
      await page.fill('#inline-name-input', '엔터장기');
      await page.press('#inline-name-input', 'Enter');
      await page.waitForTimeout(500);
      await expect(page.locator('#name-gate-inline')).toBeHidden();
      const stored = await page.evaluate(() => sessionStorage.getItem('janggi:name'));
      expect(stored).toBe('엔터장기');
    } finally {
      await browser.close();
    }
  });

  test('AC-07: AI봇 READY 자동 응답 → 게임 시작', async () => {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: VIEWPORT });
    const page = await ctx.newPage();
    try {
      // 닉네임 미리 설정
      await page.goto(BASE_URL);
      await page.evaluate(() => sessionStorage.setItem('janggi:name', 'AI장기'));
      // AI 모드로 접속
      await page.goto(`${BASE_URL}?mode=ai`);
      await page.waitForTimeout(2000);
      // READY 버튼 클릭
      const btnReady = page.locator('#btn-ready');
      if (await btnReady.isVisible()) {
        await btnReady.click();
      }
      // 게임 시작 대기 (screen-game이 표시)
      await page.waitForFunction(
        () => {
          const sg = document.getElementById('screen-game');
          return sg && !sg.classList.contains('hidden');
        },
        { timeout: 15000 },
      );
      const gameVisible = await page.locator('#screen-game').isVisible();
      expect(gameVisible).toBe(true);
    } finally {
      await browser.close();
    }
  });
});

// ── 예외 및 엣지케이스 ───────────────────────────────────────

test.describe('janggi 입장 UI 통일 — 예외 케이스', () => {
  test('EX-01: 빈 닉네임 제출 차단', async () => {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: VIEWPORT });
    const page = await ctx.newPage();
    try {
      await page.goto(BASE_URL);
      await page.waitForTimeout(1000);
      await page.click('#btn-inline-enter');
      await page.waitForTimeout(300);
      const gateVisible = await page.locator('#name-gate-inline').isVisible();
      expect(gateVisible).toBe(true);
    } finally {
      await browser.close();
    }
  });

  test('EX-02: 공백만 있는 닉네임 제출 차단', async () => {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: VIEWPORT });
    const page = await ctx.newPage();
    try {
      await page.goto(BASE_URL);
      await page.waitForTimeout(1000);
      await page.fill('#inline-name-input', '   ');
      await page.click('#btn-inline-enter');
      await page.waitForTimeout(300);
      const gateVisible = await page.locator('#name-gate-inline').isVisible();
      expect(gateVisible).toBe(true);
      const stored = await page.evaluate(() => sessionStorage.getItem('janggi:name'));
      expect(stored).toBeNull();
    } finally {
      await browser.close();
    }
  });

  test('EX-03: 콘솔 에러 없음', async () => {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: VIEWPORT });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    try {
      await page.goto(BASE_URL);
      await page.waitForTimeout(2000);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  });

  test('EX-04: READY 마크 초기 상태 (양쪽 ⌛)', async () => {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: VIEWPORT });
    const page = await ctx.newPage();
    try {
      await page.goto(BASE_URL);
      await page.waitForTimeout(1000);
      await page.fill('#inline-name-input', '마크장기');
      await page.click('#btn-inline-enter');
      await page.waitForTimeout(500);
      const myMark = await page.locator('#my-ready-mark').textContent();
      const oppMark = await page.locator('#opp-ready-mark').textContent();
      expect(myMark).toContain('⌛');
      expect(oppMark).toContain('⌛');
    } finally {
      await browser.close();
    }
  });

  test('EX-05: READY 버튼 클릭 후 my-ready-mark ✅ 변경', async () => {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: VIEWPORT });
    const page = await ctx.newPage();
    try {
      await page.goto(BASE_URL);
      await page.waitForTimeout(1000);
      await page.fill('#inline-name-input', '레디장기');
      await page.click('#btn-inline-enter');
      await page.waitForTimeout(500);
      const btnReady = page.locator('#btn-ready');
      await btnReady.click();
      await page.waitForTimeout(500);
      const myMark = await page.locator('#my-ready-mark').textContent();
      expect(myMark).toContain('✅');
      const btnHidden = await page.locator('#btn-ready').isHidden();
      expect(btnHidden).toBe(true);
    } finally {
      await browser.close();
    }
  });
});

// ── 시각적 검증 ───────────────────────────────────────────────

test.describe('janggi 입장 UI — 시각적 검증', () => {
  test('VIS-01: 대기 화면 초기 레이아웃', async () => {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: VIEWPORT });
    const page = await ctx.newPage();
    try {
      await page.goto(BASE_URL);
      await page.waitForTimeout(1500);
      await page.screenshot({ path: 'tests/screenshots/janggi-waiting-initial.png' });
    } finally {
      await browser.close();
    }
  });

  test('VIS-02: 닉네임 입력 후 대기 상태', async () => {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: VIEWPORT });
    const page = await ctx.newPage();
    try {
      await page.goto(BASE_URL);
      await page.waitForTimeout(1000);
      await page.fill('#inline-name-input', '장기화면');
      await page.click('#btn-inline-enter');
      await page.waitForTimeout(1000);
      await page.screenshot({ path: 'tests/screenshots/janggi-waiting-after-name.png' });
    } finally {
      await browser.close();
    }
  });
});
