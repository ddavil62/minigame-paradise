/**
 * @fileoverview 맞고 입장 UI 통일 Phase 3 QA 테스트.
 *
 * 검증 항목:
 *   - 직접 URL 접근 시 #screen-waiting 먼저 표시, READY 후 게임 전환
 *   - #name-gate-inline — 닉네임 없으면 표시, 입력 후 hidden
 *   - #btn-start-ai (AI랑 시작) 대기 화면 존재
 *   - sessionStorage matgo:name 저장
 *   - #opponent-left-banner 존재 + 초기 hidden
 *   - 빈/공백 닉네임 제출 차단
 *   - Enter 키 닉네임 제출
 *   - AI봇 READY 자동 응답 (scheduleReady)
 *   - broadcastReadyState() 정적 분석 → 다른 테스트에서 검증
 *   - 콘솔 에러 없음
 *
 * 서버: node matgo/server.js --port 3013
 */

import { test, expect, chromium } from 'playwright/test';

const BASE_URL = process.env.MATGO_BASE_URL || 'http://localhost:3013';
const VIEWPORT = { width: 1280, height: 800 };

// ── 유틸 ──────────────────────────────────────────────

/** 서버 룸 초기화 + stale close 이벤트 대기. */
async function resetRoom() {
  await fetch(`${BASE_URL}/test/reset`, { method: 'POST' }).catch(() => {});
  // stale WS close 이벤트가 비동기로 처리되어 새 연결의 player를 제거하는 레이스 방지.
  await new Promise((r) => setTimeout(r, 500));
}

/** 두 독립 컨텍스트로 P1/P2 페이지를 생성. */
async function setupTwoPlayers() {
  const browser = await chromium.launch();
  const ctxP1 = await browser.newContext({ viewport: VIEWPORT });
  const ctxP2 = await browser.newContext({ viewport: VIEWPORT });
  const pageP1 = await ctxP1.newPage();
  const pageP2 = await ctxP2.newPage();
  return { browser, ctxP1, ctxP2, pageP1, pageP2 };
}

test.beforeEach(async () => {
  await resetRoom();
});

test.afterEach(async () => {
  await resetRoom();
});

// ── 정상 동작 ─────────────────────────────────────────────

test.describe('matgo 입장 UI 통일 — 정상 동작', () => {
  test('AC-01: 직접 URL 접근 시 #screen-waiting 먼저 표시', async () => {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: VIEWPORT });
    const page = await ctx.newPage();
    try {
      await page.goto(BASE_URL);
      // screen-waiting이 보이고 screen-game은 숨겨져 있어야 한다.
      const waitingVisible = await page.locator('#screen-waiting').isVisible();
      const gameHidden = await page.locator('#screen-game').isHidden();
      expect(waitingVisible).toBe(true);
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
      // sessionStorage에 matgo:name이 없는 상태로 접속
      await page.goto(BASE_URL);
      // JOINED 수신 후 name-gate-inline이 보여야 한다 (hasName: false)
      // waitForFunction으로 JOINED 수신 후 gate 노출 대기
      await page.waitForFunction(
        () => {
          const gate = document.getElementById('name-gate-inline');
          return gate && !gate.classList.contains('hidden');
        },
        { timeout: 8000 },
      );
      const gateVisible = await page.locator('#name-gate-inline').isVisible();
      expect(gateVisible).toBe(true);

      // 닉네임 입력 후 입장 버튼 클릭
      await page.fill('#inline-name-input', '테스터');
      await page.click('#btn-inline-enter');
      await page.waitForTimeout(500);
      // name-gate-inline이 숨겨져야 한다
      const gateHidden = await page.locator('#name-gate-inline').isHidden();
      expect(gateHidden).toBe(true);
    } finally {
      await browser.close();
    }
  });

  test('AC-03: #btn-start-ai (AI랑 시작) 대기 화면에서 존재', async () => {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: VIEWPORT });
    const page = await ctx.newPage();
    try {
      await page.goto(BASE_URL);
      const btnExists = await page.locator('#btn-start-ai').count();
      expect(btnExists).toBe(1);
      // 텍스트 확인
      const text = await page.locator('#btn-start-ai').textContent();
      expect(text).toContain('AI랑 시작');
    } finally {
      await browser.close();
    }
  });

  test('AC-04: sessionStorage matgo:name 저장', async () => {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: VIEWPORT });
    const page = await ctx.newPage();
    try {
      await page.goto(BASE_URL);
      // JOINED 수신 대기 (name gate가 보여야 닉네임 입력 가능)
      await page.waitForFunction(
        () => {
          const gate = document.getElementById('name-gate-inline');
          return gate && !gate.classList.contains('hidden');
        },
        { timeout: 8000 },
      );
      // 닉네임 입력 + 입장
      await page.fill('#inline-name-input', '세션테스트');
      await page.click('#btn-inline-enter');
      await page.waitForTimeout(500);
      // sessionStorage에 matgo:name이 저장되어야 한다
      const storedName = await page.evaluate(() => sessionStorage.getItem('matgo:name'));
      expect(storedName).toBe('세션테스트');
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
      // 배너 존재 확인
      const bannerExists = await page.locator('#opponent-left-banner').count();
      expect(bannerExists).toBe(1);
      // 초기에는 hidden 클래스 적용
      const hasHidden = await page.locator('#opponent-left-banner').evaluate(
        (el) => el.classList.contains('hidden')
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
      // name-gate-inline 표시 확인
      await expect(page.locator('#name-gate-inline')).toBeVisible();
      // 닉네임 입력 후 Enter
      await page.fill('#inline-name-input', '엔터테스트');
      await page.press('#inline-name-input', 'Enter');
      await page.waitForTimeout(500);
      // 게이트 숨김 확인
      await expect(page.locator('#name-gate-inline')).toBeHidden();
      // sessionStorage 확인
      const storedName = await page.evaluate(() => sessionStorage.getItem('matgo:name'));
      expect(storedName).toBe('엔터테스트');
    } finally {
      await browser.close();
    }
  });

  test('AC-07: AI봇 READY 자동 응답 → 게임 시작', async () => {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: VIEWPORT });
    const page = await ctx.newPage();
    try {
      // 닉네임을 미리 설정
      await page.goto(BASE_URL);
      await page.evaluate(() => sessionStorage.setItem('matgo:name', 'AI테스터'));
      // AI 모드로 접속
      await page.goto(`${BASE_URL}?mode=ai`);
      await page.waitForTimeout(2000);
      // READY 버튼 클릭(사용자 수동 READY)
      const btnReady = page.locator('#btn-ready');
      if (await btnReady.isVisible()) {
        await btnReady.click();
      }
      // AI봇의 자동 READY + 게임 시작 대기
      // screen-game이 표시되면 게임 시작 성공
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

  test('AC-08: READY 완료 후 게임 화면 전환 + 자동 라운드 시작', async () => {
    const { browser, pageP1, pageP2 } = await setupTwoPlayers();
    try {
      // P1 접속 + 닉네임 입력
      await pageP1.goto(BASE_URL);
      await pageP1.waitForTimeout(1000);
      await pageP1.fill('#inline-name-input', 'P1플레이어');
      await pageP1.click('#btn-inline-enter');
      await pageP1.waitForTimeout(500);

      // P2 접속 + 닉네임 입력
      await pageP2.goto(BASE_URL);
      await pageP2.waitForTimeout(1000);
      await pageP2.fill('#inline-name-input', 'P2플레이어');
      await pageP2.click('#btn-inline-enter');
      await pageP2.waitForTimeout(500);

      // 양쪽 READY 클릭
      const readyP1 = pageP1.locator('#btn-ready');
      if (await readyP1.isVisible()) await readyP1.click();
      const readyP2 = pageP2.locator('#btn-ready');
      if (await readyP2.isVisible()) await readyP2.click();

      // 양쪽 모두 게임 화면 전환 대기
      await pageP1.waitForFunction(
        () => {
          const sg = document.getElementById('screen-game');
          return sg && !sg.classList.contains('hidden');
        },
        { timeout: 10000 },
      );
      await pageP2.waitForFunction(
        () => {
          const sg = document.getElementById('screen-game');
          return sg && !sg.classList.contains('hidden');
        },
        { timeout: 10000 },
      );
      // 손패 10장씩 확인 (자동 라운드 시작)
      await pageP1.waitForFunction(
        () => document.querySelectorAll('#my-hand-cards .card').length === 10,
        { timeout: 8000 },
      );
      const p1Hand = await pageP1.evaluate(
        () => document.querySelectorAll('#my-hand-cards .card').length,
      );
      expect(p1Hand).toBe(10);
    } finally {
      await browser.close();
    }
  });
});

// ── 예외 및 엣지케이스 ───────────────────────────────────────

test.describe('matgo 입장 UI 통일 — 예외 케이스', () => {
  test('EX-01: 빈 닉네임 제출 차단', async () => {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: VIEWPORT });
    const page = await ctx.newPage();
    try {
      await page.goto(BASE_URL);
      await page.waitForTimeout(1000);
      // 빈 상태에서 입장 클릭
      await page.click('#btn-inline-enter');
      await page.waitForTimeout(300);
      // 게이트가 여전히 보여야 한다
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
      // 공백만 입력
      await page.fill('#inline-name-input', '   ');
      await page.click('#btn-inline-enter');
      await page.waitForTimeout(300);
      // 게이트가 여전히 보여야 한다
      const gateVisible = await page.locator('#name-gate-inline').isVisible();
      expect(gateVisible).toBe(true);
      // sessionStorage에 저장되지 않아야 한다
      const stored = await page.evaluate(() => sessionStorage.getItem('matgo:name'));
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
      // 닉네임 입력 → READY 패널 노출
      await page.fill('#inline-name-input', '마크테스트');
      await page.click('#btn-inline-enter');
      await page.waitForTimeout(500);
      // 양쪽 마크 확인
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
      await page.fill('#inline-name-input', '레디테스트');
      await page.click('#btn-inline-enter');
      await page.waitForTimeout(500);
      // READY 버튼 클릭
      const btnReady = page.locator('#btn-ready');
      await btnReady.click();
      await page.waitForTimeout(500);
      // my-ready-mark가 ✅로 변경
      const myMark = await page.locator('#my-ready-mark').textContent();
      expect(myMark).toContain('✅');
      // 버튼 숨김
      const btnHidden = await page.locator('#btn-ready').isHidden();
      expect(btnHidden).toBe(true);
    } finally {
      await browser.close();
    }
  });

  test('EX-06: 닉네임 URL 파라미터(?name=) 직접 주입 시 sessionStorage 저장 확인', async () => {
    // 참고: ?name= URL로 접속하면 onopen에서 sessionStorage에 저장 후 JOIN 송신한다.
    // 그러나 서버 JOINED는 hasName:false로 먼저 도착하고, JOIN 응답은 상대에게만 전송되므로
    // name-gate-inline이 일시적으로 표시될 수 있다. 핵심은 sessionStorage 저장과 JOIN 전송.
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: VIEWPORT });
    const page = await ctx.newPage();
    try {
      await page.goto(`${BASE_URL}?name=${encodeURIComponent('URL닉네임')}`);
      await page.waitForTimeout(2000);
      // sessionStorage에 저장됨
      const stored = await page.evaluate(() => sessionStorage.getItem('matgo:name'));
      expect(stored).toBe('URL닉네임');
      // 주의: 게이트가 표시되는 것은 서버가 hasName:false를 먼저 보내기 때문.
      // 이것은 현재 구현의 한계(서버 JOINED가 JOIN 응답보다 먼저 도착).
      // 런처 경유 시에는 ?name= 파라미터로 이 경로를 타므로 gate가 보이는 것은 낮은 심각도 이슈.
    } finally {
      await browser.close();
    }
  });
});

// ── 시각적 검증 ───────────────────────────────────────────────

test.describe('matgo 입장 UI — 시각적 검증', () => {
  test('VIS-01: 대기 화면 초기 레이아웃', async () => {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: VIEWPORT });
    const page = await ctx.newPage();
    try {
      await page.goto(BASE_URL);
      await page.waitForTimeout(1500);
      await page.screenshot({ path: 'tests/screenshots/matgo-waiting-initial.png' });
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
      await page.fill('#inline-name-input', '화면테스트');
      await page.click('#btn-inline-enter');
      await page.waitForTimeout(1000);
      await page.screenshot({ path: 'tests/screenshots/matgo-waiting-after-name.png' });
    } finally {
      await browser.close();
    }
  });
});
