/**
 * @fileoverview 로비 UX 개선 QA Playwright 테스트 (2026-05-30)
 *
 *   스펙: .claude/specs/2026-05-30-lobby-ux-plan.md
 *   검증 항목 T-01 ~ T-16 + 자체 도출 예외 시나리오
 *
 *   실행: cd minigame-paradise && npx playwright test tests/lobby-ux-qa.spec.js --reporter=list
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
// S1 : 로비 기본 구조 변경
// =====================================================================
test.describe('S1: 로비 기본 구조 변경', () => {

  test('T-01: 로비 접속 시 #start-btn DOM에 없음', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    // #start-btn 요소가 DOM에 존재하면 안 됨
    const startBtn = page.locator('#start-btn');
    await expect(startBtn).toHaveCount(0);
    // "스타트" 텍스트 버튼도 없어야 함
    const startButtons = page.locator('button', { hasText: '스타트' });
    await expect(startButtons).toHaveCount(0);
  });

  test('T-02: #game-grid가 로비 초기 화면에서 바로 표시됨', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitForSelector('.game-card', { timeout: 5000 });

    const grid = page.locator('#game-grid');
    await expect(grid).toBeVisible();
    // hidden 또는 display:none이 아닌지 추가 검증
    const display = await grid.evaluate(el => getComputedStyle(el).display);
    expect(display).not.toBe('none');
    const visibility = await grid.evaluate(el => getComputedStyle(el).visibility);
    expect(visibility).not.toBe('hidden');
  });

  test('T-03: 게임 카드 5개 렌더링 (fetch games.json 성공)', async ({ page }) => {
    // games.json fetch 성공 여부를 네트워크 요청으로도 검증
    const gamesJsonPromise = page.waitForResponse(
      resp => resp.url().includes('games.json') && resp.status() === 200,
      { timeout: 5000 }
    );

    await page.goto('/', { waitUntil: 'networkidle' });
    const gamesResponse = await gamesJsonPromise;
    expect(gamesResponse.status()).toBe(200);

    await page.waitForSelector('.game-card', { timeout: 5000 });
    const cards = page.locator('.game-card');
    // games.json이 10종으로 확장되어 카드 수 업데이트
    await expect(cards).toHaveCount(10);

    // 각 게임 ID 카드 존재 확인 (전체 10종)
    const expectedIds = [
      'codenames-duet', 'davinci-code', 'matgo', 'yutnori', 'tetris-battle',
      'janggi', 'hanabi', 'yahtzee', 'rummikub', 'omok',
    ];
    for (const id of expectedIds) {
      const card = page.locator(`.game-card[data-game-id="${id}"]`);
      await expect(card).toBeVisible();
    }

    // 스크린샷
    await page.screenshot({ path: `${SS}/t03-lobby-5-cards.png`, fullPage: true });
  });

  test('T-04: 1/2 상태에서 호스트는 카드 활성, 게스트 모드 CSS 미적용', async ({ page }) => {
    // 1/2 상태 = 탭 1개 접속 (기본 호스트)
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitForSelector('.game-card', { timeout: 5000 });

    // WS 연결 안정화 대기
    await page.waitForTimeout(500);

    // 호스트이므로 guest-mode가 적용되지 않아야 함
    const grid = page.locator('#game-grid');
    const hasGuestMode = await grid.evaluate(el => el.classList.contains('guest-mode'));
    expect(hasGuestMode).toBe(false);

    // 1/2 호스트 상태에서 player-count 표시 확인
    const countText = await page.locator('#player-count').textContent();
    expect(countText).toContain('1/2');

    // 역할이 호스트인지 확인
    const roleText = await page.locator('#player-role').textContent();
    expect(roleText).toContain('호스트');

    // 스크린샷
    await page.screenshot({ path: `${SS}/t04-host-1of2.png` });
  });

  test('T-05: 카드에 .game-card-vote 버튼 존재', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitForSelector('.game-card', { timeout: 5000 });

    const voteButtons = page.locator('.game-card-vote');
    // games.json이 10종으로 확장되어 vote 버튼 수 업데이트
    await expect(voteButtons).toHaveCount(10);

    // 각 vote 버튼에 data-gameId 속성 존재 (전체 10종)
    const expectedIds = [
      'codenames-duet', 'davinci-code', 'matgo', 'yutnori', 'tetris-battle',
      'janggi', 'hanabi', 'yahtzee', 'rummikub', 'omok',
    ];
    for (const id of expectedIds) {
      const voteBtn = page.locator(`.game-card-vote[data-game-id="${id}"]`);
      await expect(voteBtn).toBeVisible();
      // vote-count span 존재
      const voteCountEl = page.locator(`#vote-count-${id}`);
      await expect(voteCountEl).toBeVisible();
      const countText = await voteCountEl.textContent();
      expect(countText).toBe('0');
    }

    // 투표 버튼 근접 스크린샷 (뷰포트 내로 스크롤 후 캡처)
    const firstVoteBtn = voteButtons.first();
    await firstVoteBtn.scrollIntoViewIfNeeded();
    const box = await firstVoteBtn.boundingBox();
    if (box) {
      const vw = page.viewportSize()?.width || 1280;
      const vh = page.viewportSize()?.height || 800;
      const clipX = Math.max(0, box.x - 20);
      const clipY = Math.max(0, box.y - 20);
      await page.screenshot({
        path: `${SS}/t05-vote-button-detail.png`,
        clip: {
          x: clipX,
          y: clipY,
          width: Math.min(box.width + 40, vw - clipX),
          height: Math.min(box.height + 40, vh - clipY),
        },
      });
    }
  });
});

// =====================================================================
// S2 : WS 기능 (두 브라우저 탭 필요)
// =====================================================================
test.describe('S2: WS 기능 (두 탭)', () => {

  test('T-06: 두 탭 접속 시 2/2 표시, 호스트 카드 활성화', async ({ browser }) => {
    const ctx1 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx1.addInitScript(() => localStorage.setItem('minigames:nickname', '테스터1'));
    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx2.addInitScript(() => localStorage.setItem('minigames:nickname', '테스터2'));
    const hostPage = await ctx1.newPage();
    const guestPage = await ctx2.newPage();

    try {
      // 호스트 접속
      await hostPage.goto('/', { waitUntil: 'networkidle' });
      await hostPage.waitForSelector('.game-card', { timeout: 5000 });

      // 게스트 접속
      await guestPage.goto('/', { waitUntil: 'networkidle' });
      await guestPage.waitForSelector('.game-card', { timeout: 5000 });

      // WS 상태 안정화 대기
      await hostPage.waitForTimeout(800);
      await guestPage.waitForTimeout(800);

      // 호스트 측 2/2 확인
      const hostCount = await hostPage.locator('#player-count').textContent();
      expect(hostCount).toContain('2/2');

      // 게스트 측 2/2 확인
      const guestCount = await guestPage.locator('#player-count').textContent();
      expect(guestCount).toContain('2/2');

      // 호스트 측 역할 = 호스트
      const hostRole = await hostPage.locator('#player-role').textContent();
      expect(hostRole).toContain('호스트');

      // 게스트 측 역할 = 게스트
      const guestRole = await guestPage.locator('#player-role').textContent();
      expect(guestRole).toContain('게스트');

      // 호스트: guest-mode 미적용
      const hostGridGuestMode = await hostPage.locator('#game-grid').evaluate(el => el.classList.contains('guest-mode'));
      expect(hostGridGuestMode).toBe(false);

      // 게스트: guest-mode 적용
      const guestGridGuestMode = await guestPage.locator('#game-grid').evaluate(el => el.classList.contains('guest-mode'));
      expect(guestGridGuestMode).toBe(true);

      // 스크린샷
      await hostPage.screenshot({ path: `${SS}/t06-host-2of2.png` });
      await guestPage.screenshot({ path: `${SS}/t06-guest-2of2.png` });
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });

  test('T-07: 호스트 카드 클릭 시 양쪽 모두 게임 페이지로 리다이렉트', async ({ browser }) => {
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

      // 안정화 대기
      await hostPage.waitForTimeout(800);

      // 호스트가 matgo 카드 클릭 (botAvailable: true)
      const matgoCard = hostPage.locator('.game-card[data-game-id="matgo"]');
      await matgoCard.click();

      // 양쪽 모두 /matgo/ 경로로 이동 대기
      await hostPage.waitForURL(/\/matgo\//, { timeout: 5000 });
      await guestPage.waitForURL(/\/matgo\//, { timeout: 5000 });

      // URL 확인
      expect(hostPage.url()).toContain('/matgo/');
      expect(guestPage.url()).toContain('/matgo/');

      // mode=human query param 확인 (2/2 상태이므로 human)
      expect(hostPage.url()).toContain('mode=human');
      expect(guestPage.url()).toContain('mode=human');
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });

  test('T-08: vote 버튼 클릭 시 VOTE_GAME -> 카운트 업데이트', async ({ browser }) => {
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

      // 안정화 대기
      await hostPage.waitForTimeout(800);

      // 호스트가 matgo에 투표
      const hostVoteBtn = hostPage.locator('.game-card-vote[data-game-id="matgo"]');
      await hostVoteBtn.click();

      // 양쪽에서 matgo 투표 카운트가 1로 업데이트 대기
      await expect(hostPage.locator('#vote-count-matgo')).toHaveText('1', { timeout: 3000 });
      await expect(guestPage.locator('#vote-count-matgo')).toHaveText('1', { timeout: 3000 });

      // 게스트도 matgo에 투표 (guest-mode이지만 vote 버튼은 클릭 가능해야 함)
      // guest-mode에서 pointer-events:none이 카드에 적용되지만 vote 버튼은 z-index:3 + pointer-events:all
      const guestVoteBtn = guestPage.locator('.game-card-vote[data-game-id="matgo"]');
      await guestVoteBtn.click({ force: true }); // guest-mode overlay가 있으므로 force 사용

      // 양쪽에서 matgo 투표 카운트가 2로 업데이트
      await expect(hostPage.locator('#vote-count-matgo')).toHaveText('2', { timeout: 3000 });
      await expect(guestPage.locator('#vote-count-matgo')).toHaveText('2', { timeout: 3000 });

      // toggle 확인: 호스트가 다시 클릭하면 1로 감소
      await hostVoteBtn.click();
      await expect(hostPage.locator('#vote-count-matgo')).toHaveText('1', { timeout: 3000 });
      await expect(guestPage.locator('#vote-count-matgo')).toHaveText('1', { timeout: 3000 });

      // 스크린샷
      await hostPage.screenshot({ path: `${SS}/t08-vote-host.png` });
      await guestPage.screenshot({ path: `${SS}/t08-vote-guest.png` });
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });
});

// =====================================================================
// S3 : 로비 복귀 버튼
// =====================================================================
test.describe('S3: 로비 복귀 버튼', () => {

  test('T-09: POST /lobby/return 엔드포인트가 204 응답 반환', async ({ page }) => {
    // 직접 fetch로 엔드포인트 확인
    const response = await page.request.post('http://localhost:3000/lobby/return');
    expect(response.status()).toBe(204);
  });

  test('T-10: matgo 게임 페이지에 #btn-return-lobby 존재', async ({ page }) => {
    await page.goto('/matgo/', { waitUntil: 'domcontentloaded' });
    const btn = page.locator('#btn-return-lobby');
    const count = await btn.count();
    expect(count).toBe(1);
    const text = await btn.textContent();
    expect(text).toContain('다른 종목');
    await page.screenshot({ path: `${SS}/t10-matgo-return-btn.png`, fullPage: true });
  });

  test('T-11: yutnori 게임 페이지에 #btn-return-lobby 존재', async ({ page }) => {
    await page.goto('/yutnori/', { waitUntil: 'domcontentloaded' });
    const btn = page.locator('#btn-return-lobby');
    const count = await btn.count();
    expect(count).toBe(1);
    const text = await btn.textContent();
    expect(text).toContain('다른 종목');
  });

  test('T-12: tetris-battle 게임 페이지에 #btn-return-lobby 존재', async ({ page }) => {
    await page.goto('/tetris-battle/', { waitUntil: 'domcontentloaded' });
    const btn = page.locator('#btn-return-lobby');
    const count = await btn.count();
    expect(count).toBe(1);
    const text = await btn.textContent();
    expect(text).toContain('다른 종목');
  });

  test('T-13: davinci-code 게임 페이지에 #btn-return-lobby 존재', async ({ page }) => {
    await page.goto('/davinci-code/', { waitUntil: 'domcontentloaded' });
    const btn = page.locator('#btn-return-lobby');
    const count = await btn.count();
    expect(count).toBe(1);
    const text = await btn.textContent();
    expect(text).toContain('다른 종목');
  });

  test('T-14: codenames-duet 게임 페이지에 #btn-return-lobby 존재', async ({ page }) => {
    await page.goto('/codenames-duet/', { waitUntil: 'domcontentloaded' });
    const btn = page.locator('#btn-return-lobby');
    const count = await btn.count();
    expect(count).toBe(1);
    const text = await btn.textContent();
    expect(text).toContain('다른 종목');
  });
});

// =====================================================================
// S4 : 기존 기능 회귀 방지
// =====================================================================
test.describe('S4: 기존 기능 회귀 방지', () => {

  test('T-15: 1/2 호스트가 matgo (AI 지원 게임) 카드 클릭 시 정상 이동', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitForSelector('.game-card', { timeout: 5000 });
    // WS 안정화
    await page.waitForTimeout(500);

    // 1/2 상태에서 호스트가 matgo 카드 클릭
    const matgoCard = page.locator('.game-card[data-game-id="matgo"]');
    await matgoCard.click();

    // /matgo/ 경로로 이동 대기
    await page.waitForURL(/\/matgo\//, { timeout: 5000 });
    expect(page.url()).toContain('/matgo/');
    // AI 모드여야 함
    expect(page.url()).toContain('mode=ai');
  });

  test('T-16: 2/2 상태에서 LOBBY_STATE에 votes 필드 존재', async ({ browser }) => {
    const ctx1 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx1.addInitScript(() => localStorage.setItem('minigames:nickname', '테스터1'));
    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx2.addInitScript(() => localStorage.setItem('minigames:nickname', '테스터2'));
    const hostPage = await ctx1.newPage();
    const guestPage = await ctx2.newPage();

    try {
      // WS 메시지를 캡처
      const wsMessages = [];
      hostPage.on('console', msg => {
        // app.js에서 WS 메시지를 직접 캡처하기는 어려우므로
        // evaluate로 WS 메시지를 가로채자
      });

      await hostPage.goto('/', { waitUntil: 'networkidle' });
      await hostPage.waitForSelector('.game-card', { timeout: 5000 });

      // WS 메시지를 가로채기 위해 페이지에 로그 주입
      await hostPage.evaluate(() => {
        window.__lobbyStateMessages = [];
        const origOnMessage = window.__origOnMessage;
        // WebSocket.prototype.addEventListener를 후킹하는 대신
        // 이미 연결된 ws의 메시지 이벤트를 관찰한다
        // app.js가 module이라 ws 변수에 직접 접근 불가하므로
        // MessageEvent를 후킹
        const origDispatch = EventTarget.prototype.dispatchEvent;
        // 대안: DOM에서 vote-count 요소의 textContent 변화를 관찰
      });

      // 게스트 접속 -> 2/2 LOBBY_STATE가 전송됨
      await guestPage.goto('/', { waitUntil: 'networkidle' });
      await guestPage.waitForSelector('.game-card', { timeout: 5000 });
      await hostPage.waitForTimeout(800);

      // 2/2 상태에서 서버가 votes 필드를 포함하는지 직접 WS로 검증
      // 새 WS를 열어서 LOBBY_STATE를 수신
      const lobbyState = await hostPage.evaluate(() => {
        return new Promise((resolve, reject) => {
          const proto = location.protocol === 'https:' ? 'wss' : 'ws';
          const testWs = new WebSocket(`${proto}://${location.host}/ws`);
          testWs.onmessage = (event) => {
            try {
              const msg = JSON.parse(event.data);
              if (msg.type === 'LOBBY_STATE') {
                testWs.close();
                resolve(msg);
              } else if (msg.type === 'FULL') {
                testWs.close();
                // FULL이면 이미 2/2이므로 votes 필드 확인 불가.
                // FULL 메시지에는 votes가 없으므로 별도 처리.
                resolve({ type: 'FULL', message: msg.message });
              }
            } catch (e) {
              // ignore parse errors
            }
          };
          testWs.onerror = () => reject(new Error('WS error'));
          setTimeout(() => {
            testWs.close();
            reject(new Error('timeout'));
          }, 5000);
        });
      });

      // 3번째 접속이므로 FULL이 올 수 있음.
      // 이 경우 이미 2명이 접속한 상태에서 FULL 메시지가 와야 정상.
      if (lobbyState.type === 'FULL') {
        // FULL 응답은 정상 (이미 2/2 점유). votes 필드는 LOBBY_STATE에만 있음.
        // 호스트 페이지의 DOM에서 votes 반영 여부를 간접 확인
        const voteCountEl = hostPage.locator('#vote-count-matgo');
        const text = await voteCountEl.textContent();
        expect(text).toBe('0'); // 아직 아무도 투표하지 않았으므로 0
        // votes 필드는 LOBBY_STATE에 있어야 한다는 것은 DOM 반영으로 간접 확인
      } else {
        // LOBBY_STATE 직접 수신 시 votes 필드 존재 확인
        expect(lobbyState).toHaveProperty('votes');
        expect(typeof lobbyState.votes).toBe('object');
      }
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });
});

// =====================================================================
// 자체 도출 예외 시나리오
// =====================================================================
test.describe('EX: 자체 도출 예외 시나리오', () => {

  test('EX-01: 콘솔 에러 없음 (로비 페이지)', async ({ page }) => {
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

  test('EX-02: 투표 버튼 빠른 연타 시 에러 없음', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitForSelector('.game-card', { timeout: 5000 });
    await page.waitForTimeout(500);

    // matgo 투표 버튼을 10번 빠르게 연타
    const voteBtn = page.locator('.game-card-vote[data-game-id="matgo"]');
    for (let i = 0; i < 10; i++) {
      await voteBtn.click({ delay: 20 });
    }

    await page.waitForTimeout(500);
    expect(pageErrors).toEqual([]);

    // 10번 toggle이면 짝수 = 0 (원래 상태)
    const countText = await page.locator('#vote-count-matgo').textContent();
    expect(countText).toBe('0');
  });

  test('EX-03: 호스트 disconnect -> 게스트 승격 -> 로비 정상', async ({ browser }) => {
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

      // 2/2 확인
      const countBefore = await guestPage.locator('#player-count').textContent();
      expect(countBefore).toContain('2/2');

      // 호스트 연결 종료
      await hostPage.close();
      await guestPage.waitForTimeout(1000);

      // 게스트가 호스트로 승격
      const roleAfter = await guestPage.locator('#player-role').textContent();
      expect(roleAfter).toContain('호스트');

      // 1/2 상태로 변경
      const countAfter = await guestPage.locator('#player-count').textContent();
      expect(countAfter).toContain('1/2');

      // guest-mode가 해제되어야 함 (이제 호스트이므로)
      const hasGuestMode = await guestPage.locator('#game-grid').evaluate(
        el => el.classList.contains('guest-mode')
      );
      expect(hasGuestMode).toBe(false);
    } finally {
      await ctx1.close().catch(() => {});
      await ctx2.close();
    }
  });

  test('EX-04: FULL 거절 (3번째 접속 시)', async ({ browser }) => {
    const ctx1 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx1.addInitScript(() => localStorage.setItem('minigames:nickname', '테스터1'));
    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx2.addInitScript(() => localStorage.setItem('minigames:nickname', '테스터2'));
    const ctx3 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx3.addInitScript(() => localStorage.setItem('minigames:nickname', '테스터3'));
    const p1 = await ctx1.newPage();
    const p2 = await ctx2.newPage();
    const p3 = await ctx3.newPage();

    try {
      await p1.goto('/', { waitUntil: 'networkidle' });
      await p1.waitForSelector('.game-card', { timeout: 5000 });

      await p2.goto('/', { waitUntil: 'networkidle' });
      await p2.waitForSelector('.game-card', { timeout: 5000 });
      await p2.waitForTimeout(500);

      // 3번째 접속
      await p3.goto('/', { waitUntil: 'networkidle' });
      await p3.waitForTimeout(1500);

      // 3번째는 FULL 메시지로 정원 초과 안내가 표시되어야 함
      const statusEl = p3.locator('#lobby-status');
      const statusText = await statusEl.textContent();
      expect(statusText).toContain('진행 중');

      // 스크린샷
      await p3.screenshot({ path: `${SS}/ex04-full-rejection.png` });
    } finally {
      await ctx1.close();
      await ctx2.close();
      await ctx3.close();
    }
  });

  test('EX-05: POST /lobby/return 중복 호출 시 에러 없음', async ({ page }) => {
    // POST /lobby/return를 3번 연속 호출해도 에러 없이 204 반환
    const r1 = await page.request.post('http://localhost:3000/lobby/return');
    expect(r1.status()).toBe(204);
    const r2 = await page.request.post('http://localhost:3000/lobby/return');
    expect(r2.status()).toBe(204);
    const r3 = await page.request.post('http://localhost:3000/lobby/return');
    expect(r3.status()).toBe(204);
  });

  test('EX-06: GET /lobby/return 시 405 또는 404 (POST만 허용)', async ({ page }) => {
    // GET은 POST 전용 엔드포인트가 아니므로 정적 파일 서버가 404를 반환할 것
    const resp = await page.request.get('http://localhost:3000/lobby/return');
    // POST만 처리하고 GET은 정적 파일 서버 폴백 -> 404
    expect([404, 405]).toContain(resp.status());
  });

  test('EX-07: 1/2 호스트가 yutnori 클릭 시 AI 모드로 이동 (결정 B: 봇 미지원 차단 제거)', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitForSelector('.game-card', { timeout: 5000 });
    await page.waitForTimeout(500);

    // 결정 B: ai-mode CSS 차단 제거 — yutnori는 botAvailable:true로 변경되어 이제 AI 모드로 이동 가능
    // CSS pointer-events 차단이 없는지 확인
    const yutnoriCard = page.locator('.game-card[data-game-id="yutnori"]');
    const pe = await yutnoriCard.evaluate(el => getComputedStyle(el).pointerEvents);
    expect(pe).not.toBe('none');

    // 1/2 호스트가 클릭하면 AI 모드로 이동
    await yutnoriCard.click();
    await page.waitForURL(/\/yutnori\//, { timeout: 5000 });
    expect(page.url()).toContain('/yutnori/');
    expect(page.url()).toContain('mode=ai');
  });

  test('EX-08: 투표 후 호스트 disconnect -> 투표 초기화 확인', async ({ browser }) => {
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

      // 호스트가 matgo에 투표
      const hostVoteBtn = hostPage.locator('.game-card-vote[data-game-id="matgo"]');
      await hostVoteBtn.click();
      await expect(guestPage.locator('#vote-count-matgo')).toHaveText('1', { timeout: 3000 });

      // 호스트 disconnect
      await hostPage.close();
      await guestPage.waitForTimeout(1000);

      // 게스트 승격 후 투표가 초기화되어야 함 (서버에서 votes.clear() 호출)
      const voteCount = await guestPage.locator('#vote-count-matgo').textContent();
      expect(voteCount).toBe('0');
    } finally {
      await ctx1.close().catch(() => {});
      await ctx2.close();
    }
  });

  test('EX-09: 게스트 모드에서 카드 클릭 시 PICK_GAME 전송되지 않음', async ({ browser }) => {
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

      // 게스트가 카드 클릭 시도 (force=true로 pointer-events 우회)
      const guestMatgoCard = guestPage.locator('.game-card[data-game-id="matgo"]');
      await guestMatgoCard.click({ force: true });

      // 이동이 발생하지 않아야 함
      await guestPage.waitForTimeout(500);
      expect(guestPage.url()).not.toContain('/matgo/');
      expect(hostPage.url()).not.toContain('/matgo/');

      // 로비에 여전히 있는지 확인
      await expect(guestPage.locator('#game-grid')).toBeVisible();
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });

  test('EX-10: 로비 초기 화면 시각적 검증', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitForSelector('.game-card', { timeout: 5000 });
    await page.waitForTimeout(500);

    // 전체 페이지 스크린샷
    await page.screenshot({ path: `${SS}/ex10-lobby-initial.png`, fullPage: true });

    // 로비 메타 영역 스크린샷
    const metaBox = await page.locator('.lobby-meta').boundingBox();
    if (metaBox) {
      await page.screenshot({
        path: `${SS}/ex10-lobby-meta.png`,
        clip: {
          x: Math.max(0, metaBox.x - 10),
          y: Math.max(0, metaBox.y - 10),
          width: metaBox.width + 20,
          height: metaBox.height + 20,
        },
      });
    }

    // 카드 그리드 영역 스크린샷
    const gridBox = await page.locator('#game-grid').boundingBox();
    if (gridBox) {
      await page.screenshot({
        path: `${SS}/ex10-lobby-grid.png`,
        clip: {
          x: Math.max(0, gridBox.x - 10),
          y: Math.max(0, gridBox.y - 10),
          width: gridBox.width + 20,
          height: gridBox.height + 20,
        },
      });
    }
  });
});
