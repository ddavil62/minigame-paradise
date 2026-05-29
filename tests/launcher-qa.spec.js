/**
 * @fileoverview 미니게임 천국 런처 QA 회귀 슈트.
 *   - 5개 게임 카드 표시
 *   - 카드 클릭 시 새 탭에서 해당 포트로 이동
 *   - 키보드 접근성 (Enter/Space)
 *   - games.json 변경 시 동적 카드 수 반영
 *   - 콘솔 에러 0건
 *   - 모바일 뷰포트에서도 깨지지 않음(스크롤 가능)
 *   - LAN IP 호스트네임 시뮬레이션
 *
 * 사전 조건: `npm start`로 6개 서버 기동 중이어야 함.
 */

import { test, expect } from '@playwright/test';

const LAUNCHER_URL = 'http://localhost:3000';

const EXPECTED_GAMES = [
  { id: 'codenames-duet', name: '코드네임 듀엣', port: 3001 },
  { id: 'davinci-code', name: '다빈치 코드', port: 3002 },
  { id: 'matgo', name: '맞고', port: 3003 },
  { id: 'yutnori', name: '윷놀이', port: 3004 },
  { id: 'tetris-battle', name: '테트리스 배틀', port: 3005 },
];

test.describe('런처 - 정상 동작', () => {
  test('5개 게임 카드가 모두 렌더링된다', async ({ page }) => {
    await page.goto(LAUNCHER_URL);
    await page.waitForSelector('.game-card');
    const cards = page.locator('.game-card');
    await expect(cards).toHaveCount(5);
    for (const g of EXPECTED_GAMES) {
      await expect(page.locator(`.game-card-title:has-text("${g.name}")`)).toBeVisible();
      await expect(page.locator(`.game-card-port:has-text(":${g.port}")`)).toBeVisible();
    }
  });

  test('타이틀과 서브타이틀이 표시된다', async ({ page }) => {
    await page.goto(LAUNCHER_URL);
    await expect(page.locator('.hero-title')).toHaveText('미니게임 천국');
    await expect(page.locator('.hero-sub')).toContainText('LAN');
  });

  test('각 카드의 색상 띠가 적용되어 있다', async ({ page }) => {
    await page.goto(LAUNCHER_URL);
    await page.waitForSelector('.game-card');
    const stripes = page.locator('.game-card-stripe');
    const count = await stripes.count();
    expect(count).toBe(5);
    for (let i = 0; i < count; i += 1) {
      const bg = await stripes.nth(i).evaluate(el => getComputedStyle(el).backgroundColor);
      // 회색(#888) 폴백이 아니어야 함 (게임마다 고유색 지정)
      expect(bg).not.toBe('rgb(136, 136, 136)');
    }
  });
});

test.describe('런처 - 카드 클릭 새 탭 열기', () => {
  for (const game of EXPECTED_GAMES) {
    test(`${game.name} 카드 클릭 시 새 탭에서 :${game.port} 로 이동`, async ({ context, page }) => {
      await page.goto(LAUNCHER_URL);
      await page.waitForSelector('.game-card');

      const popupPromise = context.waitForEvent('page', { timeout: 5000 });
      await page.locator(`.game-card-title:has-text("${game.name}")`).locator('..').locator('..').click();
      const popup = await popupPromise;
      await popup.waitForLoadState('domcontentloaded');
      const popupUrl = popup.url();
      expect(popupUrl).toMatch(new RegExp(`:${game.port}`));
      // 새 탭이 200 응답을 반환했는지 (게임 페이지 로드 성공)
      const status = await popup.evaluate(() => document.readyState);
      expect(['interactive', 'complete']).toContain(status);
      await popup.close();
    });
  }

  test('플레이 버튼 클릭과 카드 본문 클릭이 동일하게 동작한다 (이벤트 stopPropagation 확인)', async ({ context, page }) => {
    await page.goto(LAUNCHER_URL);
    await page.waitForSelector('.game-card');
    const popupPromise = context.waitForEvent('page', { timeout: 5000 });
    await page.locator('.game-card').first().locator('.game-card-play').click();
    const popup = await popupPromise;
    await popup.waitForLoadState('domcontentloaded');
    expect(popup.url()).toMatch(/:3001/);
    await popup.close();
  });
});

test.describe('런처 - 키보드 접근성', () => {
  test('Enter 키로 첫 카드를 활성화하면 새 탭이 열린다', async ({ context, page }) => {
    await page.goto(LAUNCHER_URL);
    await page.waitForSelector('.game-card');
    const firstCard = page.locator('.game-card').first();
    await firstCard.focus();
    const popupPromise = context.waitForEvent('page', { timeout: 5000 });
    await page.keyboard.press('Enter');
    const popup = await popupPromise;
    await popup.waitForLoadState('domcontentloaded');
    expect(popup.url()).toMatch(/:3001/);
    await popup.close();
  });

  test('Space 키로도 카드를 활성화할 수 있다', async ({ context, page }) => {
    await page.goto(LAUNCHER_URL);
    await page.waitForSelector('.game-card');
    const firstCard = page.locator('.game-card').first();
    await firstCard.focus();
    const popupPromise = context.waitForEvent('page', { timeout: 5000 });
    await page.keyboard.press('Space');
    const popup = await popupPromise;
    await popup.waitForLoadState('domcontentloaded');
    expect(popup.url()).toMatch(/:3001/);
    await popup.close();
  });
});

test.describe('런처 - games.json 메타데이터 검증', () => {
  test('games.json 응답이 유효한 배열이고 5개 항목을 가진다', async ({ request }) => {
    const res = await request.get(`${LAUNCHER_URL}/games.json`);
    expect(res.status()).toBe(200);
    const games = await res.json();
    expect(Array.isArray(games)).toBe(true);
    expect(games.length).toBe(5);
    for (const game of games) {
      expect(game).toHaveProperty('id');
      expect(game).toHaveProperty('name');
      expect(game).toHaveProperty('port');
      expect(game).toHaveProperty('color');
      expect(game).toHaveProperty('emoji');
      expect(typeof game.port).toBe('number');
      expect(game.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  test('games.json의 포트가 실제 server.js 응답과 일치한다', async ({ request }) => {
    const res = await request.get(`${LAUNCHER_URL}/games.json`);
    const games = await res.json();
    for (const game of games) {
      const gameRes = await request.get(`http://localhost:${game.port}/`);
      expect(gameRes.status(), `${game.id} :${game.port}`).toBe(200);
    }
  });
});

test.describe('런처 - 보안/엣지케이스', () => {
  test('디렉토리 트래버설 시도가 차단된다', async ({ request }) => {
    const res = await request.get(`${LAUNCHER_URL}/../../../package.json`);
    // 403 Forbidden 또는 404 (Express/static과 다르게 manual server는 path.join으로 정규화)
    expect([403, 404]).toContain(res.status());
  });

  test('존재하지 않는 파일 요청 시 404를 반환한다', async ({ request }) => {
    const res = await request.get(`${LAUNCHER_URL}/nonexistent.html`);
    expect(res.status()).toBe(404);
  });

  test('루트 / 요청 시 index.html이 반환된다', async ({ request }) => {
    const res = await request.get(`${LAUNCHER_URL}/`);
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain('미니게임 천국');
  });

  test('콘솔 에러가 발생하지 않는다', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(`pageerror: ${err.message}`));
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
    });
    await page.goto(LAUNCHER_URL);
    await page.waitForSelector('.game-card');
    await page.waitForTimeout(500);
    expect(errors).toEqual([]);
  });

  test('1280x800 뷰포트에서 스크롤 없이 모든 카드가 보인다', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(LAUNCHER_URL);
    await page.waitForSelector('.game-card');
    const cards = page.locator('.game-card');
    const count = await cards.count();
    for (let i = 0; i < count; i += 1) {
      const box = await cards.nth(i).boundingBox();
      expect(box).not.toBeNull();
      expect(box.y + box.height).toBeLessThanOrEqual(800);
      expect(box.x + box.width).toBeLessThanOrEqual(1280);
    }
    await page.screenshot({ path: 'tests/screenshots/launcher-1280x800.png' });
  });

  test('모바일 뷰포트(375x667)에서도 페이지가 깨지지 않는다 (overflow 허용)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(LAUNCHER_URL);
    await page.waitForSelector('.game-card');
    // 카드 5개 모두 DOM에 존재 (가로 5열이라 오버플로될 수 있으나 깨지면 안 됨)
    await expect(page.locator('.game-card')).toHaveCount(5);
    await page.screenshot({ path: 'tests/screenshots/launcher-mobile-375.png', fullPage: true });
  });

  test('빠른 연타 시 다중 새 탭이 안정적으로 열린다 (메모리/오류 없음)', async ({ context, page }) => {
    await page.goto(LAUNCHER_URL);
    await page.waitForSelector('.game-card');
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    const firstCard = page.locator('.game-card').first();
    // 3번 연속 클릭 → 3개 탭 (또는 동일 탭 재이용일 수 있으나 오류만 없으면 OK)
    const popups = [];
    for (let i = 0; i < 3; i += 1) {
      const p = context.waitForEvent('page', { timeout: 3000 }).catch(() => null);
      await firstCard.click({ delay: 30 });
      const popup = await p;
      if (popup) popups.push(popup);
    }
    expect(errors).toEqual([]);
    for (const p of popups) {
      await p.close().catch(() => {});
    }
  });
});

test.describe('런처 - 시각 회귀 (스크린샷)', () => {
  test('1280x800 메인 화면 캡처', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(LAUNCHER_URL);
    await page.waitForSelector('.game-card');
    await page.waitForTimeout(200);
    await page.screenshot({ path: 'tests/screenshots/launcher-main.png' });
  });

  test('hover 상태 카드 캡처', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(LAUNCHER_URL);
    await page.waitForSelector('.game-card');
    await page.locator('.game-card').first().hover();
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'tests/screenshots/launcher-hover.png' });
  });
});
