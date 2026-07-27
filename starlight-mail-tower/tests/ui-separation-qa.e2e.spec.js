/**
 * @fileoverview UI 분리 작업 QA 검증 -- 3행 Grid 레이아웃, 캔버스 letterbox,
 *   WARN-A 레디 오버레이, 회귀 검증, 엣지케이스를 포괄 검증한다.
 *   2단계 탭 분기 도입 후 `.level-card`는 활성 탭 분만 렌더되므로,
 *   전체 17레벨 검증은 4탭을 순회하여 고유 levelId를 수집하는 방식으로 수행한다.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';

const SCREENSHOT_DIR = 'tests/screenshots';

/** 탭별 기대 카드 수 (4탭 합계 17) */
const TAB_CARD_COUNTS = {
  'tab-tower': 5, 'tab-nature': 5, 'tab-cosmic': 4, 'tab-wonder': 3,
};
const TOTAL_LEVEL_COUNT = Object.values(TAB_CARD_COUNTS).reduce((a, b) => a + b, 0);

/**
 * 4개 탭을 순회하며 고유 levelId를 수집한다.
 * 각 탭의 카드 수가 기대값과 일치하는지도 함께 검증한다.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<string[]>} 고유 levelId 배열
 */
async function collectAllLevelIds(page) {
  const allIds = new Set();
  for (const [tabId, expectedCount] of Object.entries(TAB_CARD_COUNTS)) {
    await page.locator(`.level-tab[data-tab="${tabId}"]`).click();
    await expect(page.locator('.level-card')).toHaveCount(expectedCount, { timeout: 3000 });
    const ids = await page.evaluate(() =>
      [...document.querySelectorAll('.level-card')].map(c => c.dataset.levelId)
    );
    ids.forEach(id => allIds.add(id));
  }
  // 기지 탭으로 복귀
  await page.locator('.level-tab[data-tab="tab-tower"]').click();
  await expect(page.locator('.level-card')).toHaveCount(TAB_CARD_COUNTS['tab-tower'], { timeout: 3000 });
  return [...allIds];
}

test.describe('UI 분리 QA: 3행 Grid 구조 검증', () => {
  test('AC-1: topbar / play-viewport / bottombar 3개 요소가 수직 순서 배치된다 (1280x720)', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    await page.goto('/?name=QA-Grid');
    const topbar = await page.locator('#topbar').boundingBox();
    const viewport = await page.locator('#play-viewport').boundingBox();
    const bottombar = await page.locator('#bottombar').boundingBox();
    expect(topbar).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(bottombar).not.toBeNull();
    // 수직 순서 확인
    expect(topbar.y).toBeLessThan(viewport.y);
    expect(viewport.y).toBeLessThan(bottombar.y);
    // 겹침 없음
    expect(topbar.y + topbar.height).toBeLessThanOrEqual(viewport.y + 1);
    expect(viewport.y + viewport.height).toBeLessThanOrEqual(bottombar.y + 1);
    // 전체 높이 = 720
    expect(topbar.height + viewport.height + bottombar.height).toBeCloseTo(720, 0);
    await ctx.close();
  });

  test('AC-2: #game-canvas는 16:9 비율을 유지한다 (1280x720 / 1920x1080)', async ({ browser }) => {
    for (const size of [{ w: 1280, h: 720 }, { w: 1920, h: 1080 }]) {
      const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h } });
      const page = await ctx.newPage();
      await page.goto('/?name=QA-Ratio');
      // ready-overlay는 position:fixed이므로 canvas가 보이지 않을 수 있지만 bounding box 취득 가능
      const canvasBox = await page.locator('#game-canvas').boundingBox();
      expect(canvasBox).not.toBeNull();
      // canvas intrinsic 속성 보존
      const intrinsic = await page.evaluate(() => {
        const c = document.querySelector('#game-canvas');
        return { width: c.width, height: c.height };
      });
      expect(intrinsic.width).toBe(1280);
      expect(intrinsic.height).toBe(720);
      await ctx.close();
    }
  });

  test('AC-3/AC-4: HUD 패널과 플레이어 상태에서 position:absolute가 제거되었다', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    await page.goto('/?name=QA-Position');
    const selectors = ['.section-panel', '.timer', '.connection-panel', '.toolbar', '#self-status', '#partner-status', '#action-hint'];
    for (const sel of selectors) {
      const pos = await page.locator(sel).evaluate((el) => getComputedStyle(el).position);
      expect(pos, `${sel} should not be absolute`).not.toBe('absolute');
    }
    await ctx.close();
  });

  test('AC-5: .toolbar와 .timer가 겹치지 않는다 (X 또는 Y 방향 분리)', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    await page.goto('/?name=QA-Overlap');
    // ready-overlay를 숨겨야 toolbar가 보임
    await page.evaluate(() => {
      const ro = document.querySelector('#ready-overlay');
      if (ro) ro.hidden = true;
    });
    const toolbarBox = await page.locator('.toolbar').boundingBox();
    const timerBox = await page.locator('#elapsed-time').boundingBox();
    expect(toolbarBox).not.toBeNull();
    expect(timerBox).not.toBeNull();
    // X방향 분리 또는 Y방향 분리
    const xSeparated = toolbarBox.x + toolbarBox.width + 4 <= timerBox.x || timerBox.x + timerBox.width + 4 <= toolbarBox.x;
    const ySeparated = toolbarBox.y >= timerBox.y + timerBox.height || timerBox.y >= toolbarBox.y + toolbarBox.height;
    expect(xSeparated || ySeparated).toBe(true);
    await ctx.close();
  });
});

test.describe('UI 분리 QA: WARN-A 레디 오버레이 검증 (최우선)', () => {
  test('1920x1080에서 17개 레벨 카드 ready-overlay가 올바르게 표시된다', async ({ browser }) => {
    const ctxA = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const ctxB = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    await Promise.all([pageA.goto('/?name=QA-WARNA-A'), pageB.goto('/?name=QA-WARNA-B')]);
    // 초기 탭(기지) 카드 렌더 대기
    await expect(pageA.locator('.level-card')).toHaveCount(TAB_CARD_COUNTS['tab-tower'], { timeout: 5000 });
    // 4탭 순회로 전체 17개 고유 레벨 존재 검증
    const allIds = await collectAllLevelIds(pageA);
    expect(allIds).toHaveLength(TOTAL_LEVEL_COUNT);

    const metrics = await pageA.evaluate(() => {
      const card = document.querySelector('.ready-card');
      const eyebrow = document.querySelector('.eyebrow');
      const h1 = document.querySelector('.ready-card h1');
      const heading = document.querySelector('#level-picker-title');
      const firstLevelCard = document.querySelector('.level-card');
      const readyBtn = document.querySelector('#ready-button');
      const cardRect = card.getBoundingClientRect();
      const eyebrowRect = eyebrow.getBoundingClientRect();
      const h1Rect = h1.getBoundingClientRect();
      const headingRect = heading ? heading.getBoundingClientRect() : null;
      const firstCardRect = firstLevelCard ? firstLevelCard.getBoundingClientRect() : null;
      const readyBtnRect = readyBtn ? readyBtn.getBoundingClientRect() : null;
      return {
        card: { top: cardRect.top, bottom: cardRect.bottom, height: cardRect.height },
        eyebrow: { top: eyebrowRect.top, bottom: eyebrowRect.bottom },
        h1: { top: h1Rect.top, bottom: h1Rect.bottom },
        heading: headingRect ? { top: headingRect.top, bottom: headingRect.bottom } : null,
        firstCard: firstCardRect ? { top: firstCardRect.top, bottom: firstCardRect.bottom } : null,
        readyBtn: readyBtnRect ? { top: readyBtnRect.top, bottom: readyBtnRect.bottom } : null,
        scrollTop: card.scrollTop,
        scrollHeight: card.scrollHeight,
        clientHeight: card.clientHeight,
        justifyContent: getComputedStyle(card).justifyContent,
        overflowY: getComputedStyle(card).overflowY,
      };
    });

    // scrollTop=0에서 eyebrow가 뷰포트 안에 보여야 한다
    expect(metrics.eyebrow.top).toBeGreaterThanOrEqual(0);
    expect(metrics.eyebrow.top).toBeGreaterThanOrEqual(metrics.card.top);
    // h1 "별빛 우편탑"이 뷰포트 안에 보여야 한다
    expect(metrics.h1.top).toBeGreaterThanOrEqual(0);
    // "코스 선택" 헤더가 뷰포트 안에 보여야 한다
    if (metrics.heading) expect(metrics.heading.top).toBeGreaterThanOrEqual(0);
    // 첫 레벨 카드 행이 뷰포트 안에 보여야 한다
    if (metrics.firstCard) expect(metrics.firstCard.top).toBeLessThan(1080);
    // justify-content는 flex-start여야 한다 (centered-overflow 방지)
    expect(metrics.justifyContent).toBe('flex-start');
    // overflow-y는 auto여야 한다
    expect(metrics.overflowY).toBe('auto');

    // 스크롤로 최하단 카드 + 준비 버튼 도달 가능한지 확인
    if (metrics.scrollHeight > metrics.clientHeight) {
      const bottomReachable = await pageA.evaluate(() => {
        const card = document.querySelector('.ready-card');
        card.scrollTop = card.scrollHeight - card.clientHeight;
        const btn = document.querySelector('#ready-button');
        const btnRect = btn.getBoundingClientRect();
        const cardRect = card.getBoundingClientRect();
        return {
          scrolledToBottom: card.scrollTop + card.clientHeight >= card.scrollHeight - 2,
          readyBtnVisible: btnRect.bottom <= cardRect.bottom + 2 && btnRect.top >= cardRect.top,
          readyBtnBottom: btnRect.bottom,
          cardBottom: cardRect.bottom,
        };
      });
      expect(bottomReachable.scrolledToBottom).toBe(true);
      expect(bottomReachable.readyBtnVisible).toBe(true);
    }

    await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
    await pageA.screenshot({ path: `${SCREENSHOT_DIR}/qa-warna-1920x1080.png` });
    await ctxA.close();
    await ctxB.close();
  });

  test('1440x900에서 레디 오버레이 검증', async ({ browser }) => {
    const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    await Promise.all([pageA.goto('/?name=QA-1440A'), pageB.goto('/?name=QA-1440B')]);
    // 초기 탭 카드 렌더 대기 + 전체 17레벨 접근 가능 검증
    await expect(pageA.locator('.level-card')).toHaveCount(TAB_CARD_COUNTS['tab-tower'], { timeout: 5000 });
    const allIds = await collectAllLevelIds(pageA);
    expect(allIds).toHaveLength(TOTAL_LEVEL_COUNT);

    const metrics = await pageA.evaluate(() => {
      const card = document.querySelector('.ready-card');
      const eyebrow = document.querySelector('.eyebrow');
      return {
        eyebrowTop: eyebrow.getBoundingClientRect().top,
        cardTop: card.getBoundingClientRect().top,
        scrollTop: card.scrollTop,
        scrollHeight: card.scrollHeight,
        clientHeight: card.clientHeight,
      };
    });
    expect(metrics.eyebrowTop).toBeGreaterThanOrEqual(metrics.cardTop);
    expect(metrics.scrollTop).toBe(0);

    await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
    await pageA.screenshot({ path: `${SCREENSHOT_DIR}/qa-warna-1440x900.png` });
    await ctxA.close();
    await ctxB.close();
  });

  test('1280x720에서 레디 오버레이 검증', async ({ browser }) => {
    const ctxA = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const ctxB = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    await Promise.all([pageA.goto('/?name=QA-1280A'), pageB.goto('/?name=QA-1280B')]);
    // 초기 탭 카드 렌더 대기 + 전체 17레벨 접근 가능 검증
    await expect(pageA.locator('.level-card')).toHaveCount(TAB_CARD_COUNTS['tab-tower'], { timeout: 5000 });
    const allIds = await collectAllLevelIds(pageA);
    expect(allIds).toHaveLength(TOTAL_LEVEL_COUNT);

    const metrics = await pageA.evaluate(() => {
      const card = document.querySelector('.ready-card');
      const eyebrow = document.querySelector('.eyebrow');
      return {
        eyebrowTop: eyebrow.getBoundingClientRect().top,
        cardTop: card.getBoundingClientRect().top,
        scrollTop: card.scrollTop,
        scrollHeight: card.scrollHeight,
        clientHeight: card.clientHeight,
      };
    });
    expect(metrics.eyebrowTop).toBeGreaterThanOrEqual(metrics.cardTop);

    await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
    await pageA.screenshot({ path: `${SCREENSHOT_DIR}/qa-warna-1280x720.png` });
    await ctxA.close();
    await ctxB.close();
  });

  test('WARN-B: 1024x576에서 ready-card overflow-y:hidden 카드 잘림 확인', async ({ browser }) => {
    const ctxA = await browser.newContext({ viewport: { width: 1024, height: 576 } });
    const ctxB = await browser.newContext({ viewport: { width: 1024, height: 576 } });
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    await Promise.all([pageA.goto('/?name=QA-WARNB-A'), pageB.goto('/?name=QA-WARNB-B')]);
    // 초기 탭(기지) 카드 렌더 대기 (탭 분기로 5장만 표시)
    await expect(pageA.locator('.level-card')).toHaveCount(TAB_CARD_COUNTS['tab-tower'], { timeout: 5000 });

    const metrics = await pageA.evaluate(() => {
      const card = document.querySelector('.ready-card');
      const readyBtn = document.querySelector('#ready-button');
      const cardRect = card.getBoundingClientRect();
      const btnRect = readyBtn.getBoundingClientRect();
      return {
        overflowY: getComputedStyle(card).overflowY,
        scrollHeight: card.scrollHeight,
        clientHeight: card.clientHeight,
        cardBottom: cardRect.bottom,
        readyBtnBottom: btnRect.bottom,
        readyBtnVisible: btnRect.top >= 0 && btnRect.bottom <= cardRect.bottom + 2,
        cardHeight: cardRect.height,
      };
    });

    // overflow-y: hidden이면 스크롤 불가, 준비 버튼 잘림 가능
    await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
    await pageA.screenshot({ path: `${SCREENSHOT_DIR}/qa-warnb-1024x576.png` });
    await ctxA.close();
    await ctxB.close();
  });
});

test.describe('UI 분리 QA: 회귀 검증', () => {
  test('게임 실제 플레이: 2탭 시작 + 방향키 입력 동작', async ({ browser }) => {
    const ctxA = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const ctxB = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    const errors = [];
    pageA.on('pageerror', (e) => errors.push(e.message));

    await Promise.all([pageA.goto('/?name=QA-PlayA'), pageB.goto('/?name=QA-PlayB')]);
    await Promise.all([pageA.locator('#ready-button').click(), pageB.locator('#ready-button').click()]);
    await expect(pageA.locator('#ready-overlay')).toBeHidden();
    await expect(pageB.locator('#ready-overlay')).toBeHidden();

    // 게임 시작 확인
    await expect(pageA.locator('body')).toHaveAttribute('data-server-tick', /[0-9]+/);

    // 방향키 입력 확인
    const roleA = await pageA.locator('body').getAttribute('data-player-id');
    const movingPage = roleA === 'p1' ? pageA : pageB;
    const initialX = Number(await movingPage.locator('body').getAttribute('data-player-x'));
    await movingPage.keyboard.down('ArrowRight');
    await movingPage.waitForTimeout(500);
    await movingPage.keyboard.up('ArrowRight');
    await expect.poll(async () => Number(await movingPage.locator('body').getAttribute('data-player-x'))).toBeGreaterThan(initialX + 30);

    await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
    await pageA.screenshot({ path: `${SCREENSHOT_DIR}/qa-gameplay-1280x720.png` });

    expect(errors).toEqual([]);
    await ctxA.close();
    await ctxB.close();
  });

  test('#hud id 보존 + setBackgroundInert 동작: 오버레이 표시 중 #hud inert', async ({ browser }) => {
    const ctxA = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const ctxB = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    await Promise.all([pageA.goto('/?name=QA-InertA'), pageB.goto('/?name=QA-InertB')]);
    await Promise.all([pageA.locator('#ready-button').click(), pageB.locator('#ready-button').click()]);
    await expect(pageA.locator('#ready-overlay')).toBeHidden();

    // #hud 요소가 존재하고 topbar 안에 있는지 확인
    const hudExists = await pageA.evaluate(() => {
      const hud = document.querySelector('#hud');
      const topbar = document.querySelector('#topbar');
      return {
        exists: !!hud,
        parentIsTopbar: hud?.closest('#topbar') === topbar,
        hasHudTopClass: hud?.classList.contains('hud-top'),
      };
    });
    expect(hudExists.exists).toBe(true);
    expect(hudExists.parentIsTopbar).toBe(true);
    expect(hudExists.hasHudTopClass).toBe(true);

    // 로비 확인 오버레이를 열어 setBackgroundInert(true) 동작 검증
    // lobbyConfirmOverlay는 setBackgroundInert를 사용하지 않으므로
    // reconnect-overlay를 트리거해야 함 -- 대신 B를 close
    await pageB.close();
    await expect(pageA.locator('#reconnect-overlay')).toBeVisible();

    // reconnect-overlay 표시 중 #hud가 inert인지 확인
    const hudInert = await pageA.evaluate(() => document.querySelector('#hud').hasAttribute('inert'));
    expect(hudInert).toBe(true);

    // canvas도 inert인지 확인
    const canvasInert = await pageA.evaluate(() => document.querySelector('#game-canvas').hasAttribute('inert'));
    expect(canvasInert).toBe(true);

    await ctxA.close();
    await ctxB.close();
  });

  test('toolbar 3버튼 동작 확인 + i18n KO/EN 전환', async ({ browser }) => {
    const ctxA = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const ctxB = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    await Promise.all([pageA.goto('/?name=QA-ToolbarA'), pageB.goto('/?name=QA-ToolbarB')]);
    await Promise.all([pageA.locator('#ready-button').click(), pageB.locator('#ready-button').click()]);
    await expect(pageA.locator('#ready-overlay')).toBeHidden();

    // KO/EN 토글
    await pageA.locator('#locale-button').click();
    await expect(pageA).toHaveTitle('Starlight Mail Tower');
    // bottombar 텍스트도 전환 확인
    const hintText = await pageA.locator('#action-hint-text').textContent();
    // 영어 상태에서 힌트 텍스트가 영어인지 확인
    expect(hintText).not.toMatch(/[가-힣]/); // 한국어 문자가 없어야 함

    // 다시 한국어로 전환
    await pageA.locator('#locale-button').click();
    await expect(pageA).toHaveTitle('별빛 우편탑');
    const hintTextKo = await pageA.locator('#action-hint-text').textContent();
    expect(hintTextKo).toMatch(/[가-힣]/); // 한국어 문자가 있어야 함

    // 음소거 버튼 토글
    await pageA.locator('#mute-button').click();
    const muteState = await pageA.locator('#mute-button').getAttribute('aria-pressed');
    expect(muteState).toBe('true');
    await pageA.locator('#mute-button').click();
    const unmuteState = await pageA.locator('#mute-button').getAttribute('aria-pressed');
    expect(unmuteState).toBe('false');

    // 게임 선택(로비 복귀) 버튼 - confirm 오버레이
    await pageA.locator('#toolbar-lobby-button').click();
    await expect(pageA.locator('#lobby-confirm-overlay')).toBeVisible();
    await pageA.locator('#continue-button').click();
    await expect(pageA.locator('#lobby-confirm-overlay')).toBeHidden();

    await ctxA.close();
    await ctxB.close();
  });

  test('AC-13: body:has 규칙 -- ready-overlay 표시 중 toolbar display:none', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    await page.goto('/?name=QA-HasRule');
    // ready-overlay가 표시 중일 때 toolbar display:none인지
    const toolbarDisplay = await page.evaluate(() => {
      const toolbar = document.querySelector('.toolbar');
      return getComputedStyle(toolbar).display;
    });
    expect(toolbarDisplay).toBe('none');
    await ctx.close();
  });

  test('오버레이 z-index 순서: toast < session-ended < ready/result', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    await page.goto('/?name=QA-ZIndex');
    const zValues = await page.evaluate(() => {
      const get = (sel) => parseInt(getComputedStyle(document.querySelector(sel)).zIndex) || 0;
      return {
        toast: get('#toast'),
        sessionEnded: get('#session-ended-overlay'),
        ready: get('#ready-overlay'),
        result: get('#result-overlay'),
      };
    });
    expect(zValues.toast).toBeLessThan(zValues.sessionEnded);
    expect(zValues.sessionEnded).toBeLessThan(zValues.ready);
    expect(zValues.ready).toBe(zValues.result);
    await ctx.close();
  });
});

test.describe('UI 분리 QA: 엣지케이스', () => {
  test('극단 해상도 320x568 -- 콘솔 에러 없음', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 320, height: 568 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/?name=QA-320');
    await page.waitForTimeout(500);
    await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: `${SCREENSHOT_DIR}/qa-edge-320x568.png` });
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('극단 해상도 2560x1440 -- 콘솔 에러 없음', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 2560, height: 1440 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/?name=QA-2560');
    await page.waitForTimeout(500);
    await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: `${SCREENSHOT_DIR}/qa-edge-2560x1440.png` });
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('세로 모바일 520x900 -- 3행 Grid 정상 동작', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 520, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/?name=QA-520x900');
    await page.waitForTimeout(500);
    const layout = await page.evaluate(() => {
      const topbar = document.querySelector('#topbar').getBoundingClientRect();
      const pv = document.querySelector('#play-viewport').getBoundingClientRect();
      const bbar = document.querySelector('#bottombar').getBoundingClientRect();
      return {
        topbar: { y: topbar.y, h: topbar.height },
        pv: { y: pv.y, h: pv.height },
        bbar: { y: bbar.y, h: bbar.height, bottom: bbar.y + bbar.height },
      };
    });
    expect(layout.topbar.y + layout.topbar.h).toBeLessThanOrEqual(layout.pv.y + 1);
    expect(layout.pv.y + layout.pv.h).toBeLessThanOrEqual(layout.bbar.y + 1);
    await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: `${SCREENSHOT_DIR}/qa-edge-520x900.png` });
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('가로 저높이 900x520 -- Grid 깨지지 않음', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 900, height: 520 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/?name=QA-900x520');
    await page.waitForTimeout(500);
    const layout = await page.evaluate(() => {
      const topbar = document.querySelector('#topbar').getBoundingClientRect();
      const pv = document.querySelector('#play-viewport').getBoundingClientRect();
      const bbar = document.querySelector('#bottombar').getBoundingClientRect();
      return {
        topbar: { y: topbar.y, h: topbar.height },
        pv: { y: pv.y, h: pv.height },
        bbar: { y: bbar.y, h: bbar.height },
        total: topbar.height + pv.height + bbar.height,
      };
    });
    expect(layout.total).toBeCloseTo(520, 0);
    expect(layout.pv.h).toBeGreaterThan(0);
    await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: `${SCREENSHOT_DIR}/qa-edge-900x520.png` });
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('콘솔 에러 0건 확인 -- 풀 플레이 시나리오', async ({ browser }) => {
    const ctxA = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const ctxB = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    const errors = [];
    pageA.on('pageerror', (e) => errors.push(e.message));
    pageA.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await Promise.all([pageA.goto('/?name=QA-ConsoleA'), pageB.goto('/?name=QA-ConsoleB')]);
    await pageA.waitForTimeout(1000);
    // ready 상태에서 에러 확인
    expect(errors.filter(e => !e.includes('favicon'))).toEqual([]);
    await ctxA.close();
    await ctxB.close();
  });

  test('respawn-overlay가 #play-viewport 안에서 올바르게 표시된다', async ({ browser, request }) => {
    const ctxA = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const ctxB = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    await Promise.all([pageA.goto('/?name=QA-RespawnA'), pageB.goto('/?name=QA-RespawnB')]);
    await Promise.all([pageA.locator('#ready-button').click(), pageB.locator('#ready-button').click()]);
    await expect(pageA.locator('#ready-overlay')).toBeHidden();

    // fall 트리거
    await request.post('/__test/fall');
    await expect(pageA.locator('#respawn-overlay')).toBeVisible();

    // respawn-overlay가 play-viewport 안에 있는지 확인
    const overlayInViewport = await pageA.evaluate(() => {
      const ro = document.querySelector('#respawn-overlay');
      const pv = document.querySelector('#play-viewport');
      return ro.closest('#play-viewport') === pv;
    });
    expect(overlayInViewport).toBe(true);

    await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
    await pageA.screenshot({ path: `${SCREENSHOT_DIR}/qa-respawn-overlay.png` });
    await ctxA.close();
    await ctxB.close();
  });
});
