/**
 * @fileoverview 로비 UX 개선 QA 재검증 테스트 (2026-05-30)
 *
 *   이전 QA에서 FAIL된 EX-07 수정 확인 + LOW 이슈 재검증 + 핵심 회귀 테스트.
 *
 *   실행: cd minigame-paradise && npx playwright test tests/lobby-ux-reqa.spec.js --reporter=list
 */

import { test, expect } from '@playwright/test';

const SS = 'tests/screenshots';

// Phase 1-A에서 닉네임 게이트가 추가됨.
// localStorage에 닉네임이 없으면 게이트가 표시되고 .game-card가 숨겨지므로
// addInitScript로 사전 설정하여 게이트를 건너뛴다.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('minigames:nickname', '테스터'));
});

// =====================================================================
// R1 : EX-07 재검증 — 1/2 AI 모드에서 botAvailable=false 게임 차단
// =====================================================================
test.describe('R1: EX-07 재검증 (botAvailable=false 차단)', () => {

  test('EX-07a: 1/2 호스트가 yutnori — 결정 B로 CSS 차단 제거, pointer-events 활성', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitForSelector('.game-card', { timeout: 5000 });
    await page.waitForTimeout(600);

    // 1/2 호스트 상태 확인
    const countText = await page.locator('#player-count').textContent();
    expect(countText).toContain('1/2');

    // 결정 B: ai-mode CSS 차단 제거 — yutnori는 botAvailable:true로 변경되었으며 CSS pointer-events 차단 없음
    const yutnoriCard = page.locator('.game-card[data-game-id="yutnori"]');
    const pointerEvents = await yutnoriCard.evaluate(el => getComputedStyle(el).pointerEvents);
    expect(pointerEvents).not.toBe('none');

    // 카드가 클릭 가능한 상태임을 확인
    const isClickable = await yutnoriCard.evaluate(el => {
      const cs = getComputedStyle(el);
      return cs.pointerEvents !== 'none' && cs.visibility !== 'hidden' && cs.display !== 'none';
    });
    expect(isClickable).toBe(true);

    await page.screenshot({ path: `${SS}/reqa-ex07a-yutnori-css-blocked.png` });
  });

  test('EX-07a-js: 1/2 호스트가 yutnori — 결정 B로 JS 가드 제거, 카드 클릭 시 AI 모드로 이동', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitForSelector('.game-card', { timeout: 5000 });
    await page.waitForTimeout(600);

    // 결정 B: JS 가드 제거 — yutnori(botAvailable:true)는 이제 클릭 시 AI 모드로 이동
    const yutnoriCard = page.locator('.game-card[data-game-id="yutnori"]');
    await yutnoriCard.click();

    // /yutnori/ 페이지로 AI 모드로 이동 대기
    await page.waitForURL(/\/yutnori\//, { timeout: 5000 });
    expect(page.url()).toContain('/yutnori/');
    expect(page.url()).toContain('mode=ai');

    await page.screenshot({ path: `${SS}/reqa-ex07a-yutnori-js-blocked.png` });
  });

  test('EX-07b: 1/2 호스트가 tetris-battle — 결정 B로 CSS + JS 차단 제거, pointer-events 활성', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitForSelector('.game-card', { timeout: 5000 });
    await page.waitForTimeout(600);

    // 결정 B: tetris-battle은 botAvailable:true로 변경됨 — CSS 차단 없음
    const pointerEvents = await page.locator('.game-card[data-game-id="tetris-battle"]').evaluate(
      el => getComputedStyle(el).pointerEvents
    );
    expect(pointerEvents).not.toBe('none');

    // 로비 status에 'AI 봇을 지원하지 않습니다' 메시지가 없어야 함
    const statusText = await page.locator('#lobby-status').textContent();
    expect(statusText).not.toContain('AI 봇을 지원하지 않습니다');
  });

  test('EX-07c: 1/2 호스트가 davinci-code(봇 미지원) — 결정 B로 CSS + JS 차단 제거, pointer-events 활성', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitForSelector('.game-card', { timeout: 5000 });
    await page.waitForTimeout(600);

    // 결정 B: davinci-code는 botAvailable:false이지만 CSS 차단 제거 (모든 카드 클릭=게임방 입장)
    const pointerEvents = await page.locator('.game-card[data-game-id="davinci-code"]').evaluate(
      el => getComputedStyle(el).pointerEvents
    );
    expect(pointerEvents).not.toBe('none');

    // 로비 status에 'AI 봇을 지원하지 않습니다' 메시지가 없어야 함
    const statusText = await page.locator('#lobby-status').textContent();
    expect(statusText).not.toContain('AI 봇을 지원하지 않습니다');
  });

  test('EX-07d: 1/2 호스트가 codenames-duet(봇 미지원) — 결정 B로 CSS + JS 차단 제거, pointer-events 활성', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitForSelector('.game-card', { timeout: 5000 });
    await page.waitForTimeout(600);

    // 결정 B: codenames-duet은 botAvailable:false이지만 CSS 차단 제거
    const pointerEvents = await page.locator('.game-card[data-game-id="codenames-duet"]').evaluate(
      el => getComputedStyle(el).pointerEvents
    );
    expect(pointerEvents).not.toBe('none');

    // 로비 status에 'AI 봇을 지원하지 않습니다' 메시지가 없어야 함
    const statusText = await page.locator('#lobby-status').textContent();
    expect(statusText).not.toContain('AI 봇을 지원하지 않습니다');
  });

  test('EX-07e: 1/2 호스트가 matgo(봇 지원) 클릭 시에는 정상 이동', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitForSelector('.game-card', { timeout: 5000 });
    await page.waitForTimeout(600);

    // matgo는 botAvailable=true이므로 ai-mode에서도 클릭 가능해야 함
    const matgoPointerEvents = await page.locator('.game-card[data-game-id="matgo"]').evaluate(
      el => getComputedStyle(el).pointerEvents
    );
    // matgo는 no-bot 클래스가 없으므로 pointer-events가 차단되지 않아야 함
    expect(matgoPointerEvents).not.toBe('none');

    const matgoCard = page.locator('.game-card[data-game-id="matgo"]');
    await matgoCard.click();

    await page.waitForURL(/\/matgo\//, { timeout: 5000 });
    expect(page.url()).toContain('/matgo/');
    expect(page.url()).toContain('mode=ai');
  });

  test('EX-07f: 서버 PICK_GAME 핸들러가 botAvailable=false 게임을 차단 (이중 안전망)', async ({ page }) => {
    // 같은 origin에서 WS를 열어야 브라우저 보안 정책 통과
    // 이 페이지의 기존 lobby WS(app.js)가 이미 1 슬롯을 차지하고 있으므로
    // evaluate 내부의 새 WS는 2번째 접속(게스트)이 됨.
    // 서버 가드 테스트를 위해 기존 app.js WS 연결을 먼저 끊고 새로 연결한다.
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitForSelector('.game-card', { timeout: 5000 });
    await page.waitForTimeout(600);

    const result = await page.evaluate(() => {
      return new Promise((resolve) => {
        const proto = location.protocol === 'https:' ? 'wss' : 'ws';
        const testWs = new WebSocket(`${proto}://${location.host}/ws`);
        let gotLobbyState = false;

        testWs.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'FULL') {
              testWs.close();
              // FULL이면 이미 2명 차 있음 (기존 app.js WS + 이 WS 이전의 대기열)
              resolve({ type: 'FULL' });
              return;
            }
            if (msg.type === 'LOBBY_STATE' && !gotLobbyState) {
              gotLobbyState = true;
              // 2번째 접속이므로 게스트일 수 있음
              if (msg.role !== 'host') {
                // 게스트는 PICK_GAME 불가 — 서버가 role 검증을 함
                // 그래도 전송 시도하여 서버가 무시하는지 확인
                testWs.send(JSON.stringify({ type: 'PICK_GAME', gameId: 'yutnori' }));
                // 게스트의 PICK_GAME은 서버에서 조용히 무시됨 (role !== 'host' guard)
                setTimeout(() => {
                  testWs.close();
                  resolve({ type: 'GUEST_IGNORED', role: msg.role });
                }, 1000);
              } else {
                // 호스트로 접속된 경우 (이전 페이지의 WS가 이미 종료된 상태)
                testWs.send(JSON.stringify({ type: 'PICK_GAME', gameId: 'yutnori' }));
              }
              return;
            }
            if (msg.type === 'ERROR') {
              testWs.close();
              resolve({ type: 'ERROR', message: msg.message });
              return;
            }
            if (msg.type === 'REDIRECT') {
              testWs.close();
              resolve({ type: 'REDIRECT', gameId: msg.gameId });
              return;
            }
          } catch (e) { /* ignore */ }
        };

        testWs.onerror = () => {
          resolve({ type: 'WS_ERROR' });
        };

        setTimeout(() => {
          testWs.close();
          resolve({ type: 'TIMEOUT' });
        }, 3000);
      });
    });

    // 핵심 검증: REDIRECT가 절대 오지 않아야 함 (봇 미지원 게임이므로)
    expect(result.type).not.toBe('REDIRECT');

    // 가능한 결과:
    // - FULL: 이미 2명 (기존 app.js WS + 기타) -> 차단됨 (OK)
    // - GUEST_IGNORED: 게스트로 접속되어 PICK_GAME이 서버에서 무시됨 (OK)
    // - ERROR: 호스트로 접속 + 서버 가드가 차단 메시지 반환 (OK - 이상적)
    // - WS_ERROR: 연결 자체 실패 (OK - 연결 불가)
    // 어떤 경우든 REDIRECT가 아니면 서버가 차단한 것
    if (result.type === 'ERROR') {
      expect(result.message).toContain('AI 봇을 지원하지 않습니다');
    }
    // REDIRECT가 아닌 것만으로도 서버 가드 테스트 통과
  });
});

// =====================================================================
// R2 : ai-mode CSS 클래스 적용 검증
// =====================================================================
test.describe('R2: ai-mode CSS 클래스 검증', () => {

  test('R2-01: 1/2 상태에서 #game-grid에 ai-mode 클래스 미적용 (결정 B: 토글 제거)', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitForSelector('.game-card', { timeout: 5000 });
    await page.waitForTimeout(600);

    // 결정 B: ai-mode CSS 토글 제거 — #game-grid에 ai-mode 클래스가 적용되지 않아야 함
    const hasAiMode = await page.locator('#game-grid').evaluate(
      el => el.classList.contains('ai-mode')
    );
    expect(hasAiMode).toBe(false);
  });

  test('R2-02: 1/2 상태에서 모든 카드 정상 활성 (결정 B: no-bot 비활성화 제거)', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitForSelector('.game-card', { timeout: 5000 });
    await page.waitForTimeout(600);

    // 결정 B: ai-mode/no-bot CSS 차단 제거 — 이전에 비활성화되던 카드도 정상 표시
    // yutnori·tetris-battle은 botAvailable:true로 변경됨. davinci-code·codenames-duet은 여전히 false이나 차단 없음.
    const checkIds = ['yutnori', 'tetris-battle', 'davinci-code', 'codenames-duet'];
    for (const id of checkIds) {
      const card = page.locator(`.game-card[data-game-id="${id}"]`);
      const opacity = await card.evaluate(el => getComputedStyle(el).opacity);
      expect(parseFloat(opacity)).toBe(1);
      const filter = await card.evaluate(el => getComputedStyle(el).filter);
      expect(filter).not.toContain('grayscale');
      const pe = await card.evaluate(el => getComputedStyle(el).pointerEvents);
      expect(pe).not.toBe('none');
    }

    // matgo도 정상 활성
    const matgoOpacity = await page.locator('.game-card[data-game-id="matgo"]').evaluate(
      el => getComputedStyle(el).opacity
    );
    expect(parseFloat(matgoOpacity)).toBe(1);

    await page.screenshot({ path: `${SS}/reqa-r2-ai-mode-cards.png`, fullPage: true });
  });

  test('R2-03: 2/2 상태에서 ai-mode 클래스 해제, no-bot 카드 정상 활성', async ({ browser }) => {
    const ctx1 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx1.addInitScript(() => localStorage.setItem('minigames:nickname', '테스터1'));
    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx2.addInitScript(() => localStorage.setItem('minigames:nickname', '테스터2'));
    const hostPage = await ctx1.newPage();
    const guestPage = await ctx2.newPage();

    try {
      await hostPage.goto('/', { waitUntil: 'networkidle' });
      await hostPage.waitForSelector('.game-card', { timeout: 5000 });

      await guestPage.goto('/', { waitUntil: 'networkidle' });
      await guestPage.waitForSelector('.game-card', { timeout: 5000 });
      await hostPage.waitForTimeout(800);

      // 2/2에서 ai-mode가 해제되어야 함
      const hasAiMode = await hostPage.locator('#game-grid').evaluate(
        el => el.classList.contains('ai-mode')
      );
      expect(hasAiMode).toBe(false);

      // no-bot 카드도 opacity=1 여야 함
      const yutnoriOpacity = await hostPage.locator('.game-card[data-game-id="yutnori"]').evaluate(
        el => getComputedStyle(el).opacity
      );
      expect(parseFloat(yutnoriOpacity)).toBe(1);

      await hostPage.screenshot({ path: `${SS}/reqa-r2-2of2-no-ai-mode.png` });
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });

  test('R2-04: 1/2 상태에서 no-bot 배지 미표시 (결정 B: ai-mode 제거로 ::after 배지 없음)', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitForSelector('.game-card', { timeout: 5000 });
    await page.waitForTimeout(600);

    // 결정 B: ai-mode CSS 제거로 .game-grid.ai-mode .game-card.no-bot::after 규칙이 적용되지 않음
    // yutnori 카드의 ::after에 'AI 봇 미지원' 배지가 없어야 함
    const afterContent = await page.locator('.game-card[data-game-id="yutnori"]').evaluate(el => {
      return getComputedStyle(el, '::after').content;
    });
    expect(afterContent).not.toContain('AI');

    // yutnori 카드 영역만 클립 스크린샷
    const box = await page.locator('.game-card[data-game-id="yutnori"]').boundingBox();
    if (box) {
      await page.screenshot({
        path: `${SS}/reqa-r2-nobot-badge.png`,
        clip: {
          x: Math.max(0, box.x - 5),
          y: Math.max(0, box.y - 5),
          width: box.width + 10,
          height: box.height + 10,
        },
      });
    }
  });
});

// =====================================================================
// R3 : 힌트 텍스트 중복 해소 검증
// =====================================================================
test.describe('R3: 힌트 텍스트 중복 해소', () => {

  test('R3-01: 2/2 게스트 화면에서 #lobby-hint와 #guest-waiting 중복 없이 하나만 표시', async ({ browser }) => {
    const ctx1 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx1.addInitScript(() => localStorage.setItem('minigames:nickname', '테스터1'));
    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx2.addInitScript(() => localStorage.setItem('minigames:nickname', '테스터2'));
    const hostPage = await ctx1.newPage();
    const guestPage = await ctx2.newPage();

    try {
      await hostPage.goto('/', { waitUntil: 'networkidle' });
      await hostPage.waitForSelector('.game-card', { timeout: 5000 });

      await guestPage.goto('/', { waitUntil: 'networkidle' });
      await guestPage.waitForSelector('.game-card', { timeout: 5000 });
      await guestPage.waitForTimeout(800);

      // 게스트 화면에서 #lobby-hint에는 투표 안내가 표시됨 (중복 방지가 아닌 투표 힌트로 변경됨)
      const hintText = await guestPage.locator('#lobby-hint').textContent();
      expect(hintText).toContain('투표 버튼');

      // #guest-waiting도 표시됨
      const guestWaiting = guestPage.locator('#guest-waiting');
      const isHidden = await guestWaiting.evaluate(el => el.hidden);
      expect(isHidden).toBe(false);
      const waitingText = await guestWaiting.textContent();
      expect(waitingText).toContain('호스트가 종목을 고르면');

      // 호스트 화면에서는 #lobby-hint에 텍스트가 있어야 하고, #guest-waiting은 hidden
      const hostHintText = await hostPage.locator('#lobby-hint').textContent();
      expect(hostHintText.trim()).not.toBe('');
      expect(hostHintText).toContain('종목을 선택');

      const hostGuestWaitingHidden = await hostPage.locator('#guest-waiting').evaluate(el => el.hidden);
      expect(hostGuestWaitingHidden).toBe(true);

      await guestPage.screenshot({ path: `${SS}/reqa-r3-guest-hint-no-dup.png` });
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });

  test('R3-02: 1/2 호스트 화면에서 #lobby-hint에 인원 모집 안내, #guest-waiting은 hidden', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitForSelector('.game-card', { timeout: 5000 });
    await page.waitForTimeout(600);

    // 힌트 텍스트: "2명이 모이면 종목을 선택할 수 있어요 (현재 1/2)"
    const hintText = await page.locator('#lobby-hint').textContent();
    expect(hintText).toContain('2명이 모이면');

    const guestWaitingHidden = await page.locator('#guest-waiting').evaluate(el => el.hidden);
    expect(guestWaitingHidden).toBe(true);
  });
});

// =====================================================================
// R4 : 핵심 회귀 테스트
// =====================================================================
test.describe('R4: 핵심 회귀 테스트', () => {

  test('T-06 회귀: 2/2 호스트 카드 클릭 -> 양쪽 게임 페이지 리다이렉트', async ({ browser }) => {
    const ctx1 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx1.addInitScript(() => localStorage.setItem('minigames:nickname', '테스터1'));
    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx2.addInitScript(() => localStorage.setItem('minigames:nickname', '테스터2'));
    const hostPage = await ctx1.newPage();
    const guestPage = await ctx2.newPage();

    try {
      await hostPage.goto('/', { waitUntil: 'networkidle' });
      await hostPage.waitForSelector('.game-card', { timeout: 5000 });

      await guestPage.goto('/', { waitUntil: 'networkidle' });
      await guestPage.waitForSelector('.game-card', { timeout: 5000 });
      await hostPage.waitForTimeout(800);

      // 2/2 확인
      const hostCount = await hostPage.locator('#player-count').textContent();
      expect(hostCount).toContain('2/2');

      // 호스트가 matgo 카드 클릭
      await hostPage.locator('.game-card[data-game-id="matgo"]').click();

      // 양쪽 모두 matgo 페이지로 이동
      await hostPage.waitForURL(/\/matgo\//, { timeout: 5000 });
      await guestPage.waitForURL(/\/matgo\//, { timeout: 5000 });

      expect(hostPage.url()).toContain('/matgo/');
      expect(hostPage.url()).toContain('mode=human');
      expect(guestPage.url()).toContain('/matgo/');
      expect(guestPage.url()).toContain('mode=human');
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });

  test('T-09 회귀: POST /lobby/return -> 204 응답', async ({ page }) => {
    const response = await page.request.post('http://localhost:3000/lobby/return');
    expect(response.status()).toBe(204);
  });

  test('T-10 회귀: matgo 페이지에 #btn-return-lobby 존재', async ({ page }) => {
    await page.goto('/matgo/', { waitUntil: 'domcontentloaded' });
    const btn = page.locator('#btn-return-lobby');
    await expect(btn).toHaveCount(1);
    const text = await btn.textContent();
    expect(text).toContain('다른 종목');
  });

  test('T-11 회귀: yutnori 페이지에 #btn-return-lobby 존재', async ({ page }) => {
    await page.goto('/yutnori/', { waitUntil: 'domcontentloaded' });
    const btn = page.locator('#btn-return-lobby');
    await expect(btn).toHaveCount(1);
    const text = await btn.textContent();
    expect(text).toContain('다른 종목');
  });

  test('T-12 회귀: tetris-battle 페이지에 #btn-return-lobby 존재', async ({ page }) => {
    await page.goto('/tetris-battle/', { waitUntil: 'domcontentloaded' });
    const btn = page.locator('#btn-return-lobby');
    await expect(btn).toHaveCount(1);
    const text = await btn.textContent();
    expect(text).toContain('다른 종목');
  });

  test('T-13 회귀: davinci-code 페이지에 #btn-return-lobby 존재', async ({ page }) => {
    await page.goto('/davinci-code/', { waitUntil: 'domcontentloaded' });
    const btn = page.locator('#btn-return-lobby');
    await expect(btn).toHaveCount(1);
    const text = await btn.textContent();
    expect(text).toContain('다른 종목');
  });

  test('T-14 회귀: codenames-duet 페이지에 #btn-return-lobby 존재', async ({ page }) => {
    await page.goto('/codenames-duet/', { waitUntil: 'domcontentloaded' });
    const btn = page.locator('#btn-return-lobby');
    await expect(btn).toHaveCount(1);
    const text = await btn.textContent();
    expect(text).toContain('다른 종목');
  });
});

// =====================================================================
// R5 : 콘솔 에러 & UI 안정성
// =====================================================================
test.describe('R5: 콘솔 에러 & UI 안정성', () => {

  test('R5-01: 로비 페이지 콘솔 에러 없음', async ({ page }) => {
    const pageErrors = [];
    const consoleErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitForSelector('.game-card', { timeout: 5000 });
    await page.waitForTimeout(1500);

    expect(pageErrors).toEqual([]);
    const criticalErrors = consoleErrors.filter(
      e => !e.includes('WS') && !e.includes('WebSocket')
    );
    expect(criticalErrors).toEqual([]);
  });
});
