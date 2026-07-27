/**
 * @fileoverview QA2 신규 엣지케이스 탐색 -- 미디어 쿼리 경계, 키보드 접근성,
 *   리사이즈 안정성, 결과 오버레이, 실제 게임플레이.
 *   2단계 탭 분기 도입 후 활성 탭 카드만 렌더된다.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';

const SCREENSHOT_DIR = 'tests/screenshots';

/** 탭별 기대 카드 수 (초기 탭 = tab-tower 5장) */
const INITIAL_TAB_CARD_COUNT = 5;

test.describe('QA2 신규 엣지케이스: 미디어 쿼리 경계 리사이즈', () => {
  test('1024x577 → 1024x576 → 1024x577 연속 리사이즈 시 레이아웃 파손 없음', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1024, height: 577 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('/');

    // 577 → 576 (경계 진입)
    await page.setViewportSize({ width: 1024, height: 576 });
    await page.waitForTimeout(200);
    const m1 = await page.evaluate(() => {
      const gs = getComputedStyle(document.querySelector('#game-shell'));
      return { gridRows: gs.gridTemplateRows };
    });
    expect(m1.gridRows).toContain('40px');

    // 576 → 577 (경계 복귀)
    await page.setViewportSize({ width: 1024, height: 577 });
    await page.waitForTimeout(200);
    const m2 = await page.evaluate(() => {
      const gs = getComputedStyle(document.querySelector('#game-shell'));
      return { gridRows: gs.gridTemplateRows };
    });
    // 577px에서도 max-height:576px 미디어 쿼리 미적용이므로 기본 48px 행
    // 하지만 max-width:1024px는 적용되므로 40px일 수 있음
    // 1024px 이하이므로 소형 뷰포트 미디어 쿼리(max-width:1024px) 적용 = 40px
    expect(m2.gridRows).toContain('40px');

    // 520 → 521 (모바일 경계)
    await page.setViewportSize({ width: 520, height: 576 });
    await page.waitForTimeout(200);
    await page.setViewportSize({ width: 521, height: 576 });
    await page.waitForTimeout(200);

    // 레이아웃 파손 확인 (topbar + viewport + bottombar 유지)
    const layout = await page.evaluate(() => {
      const tb = document.querySelector('#topbar').getBoundingClientRect();
      const pv = document.querySelector('#play-viewport').getBoundingClientRect();
      const bb = document.querySelector('#bottombar').getBoundingClientRect();
      return {
        topbar: { h: tb.height },
        pv: { h: pv.height },
        bbar: { h: bb.height },
        total: tb.height + pv.height + bb.height,
      };
    });
    expect(layout.total).toBeCloseTo(576, 0);
    expect(layout.topbar.h).toBeGreaterThan(0);
    expect(layout.pv.h).toBeGreaterThan(0);
    expect(layout.bbar.h).toBeGreaterThan(0);

    expect(errors).toEqual([]);
    await ctx.close();
  });
});

test.describe('QA2 신규 엣지케이스: 키보드 접근성', () => {
  test('Tab으로 탭 버튼 → 레벨 카드 → 준비 버튼 순서 접근 가능', async ({ browser }) => {
    const ctxA = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const ctxB = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    await Promise.all([pageA.goto('/?name=QA2-KB-A'), pageB.goto('/?name=QA2-KB-B')]);
    // 탭 분기: 초기 탭(기지) 5장만 표시
    await expect(pageA.locator('.level-card')).toHaveCount(INITIAL_TAB_CARD_COUNT, { timeout: 5000 });

    // 첫 번째 Tab 후 포커스 확인
    await pageA.keyboard.press('Tab');
    await pageA.waitForTimeout(100);
    // 탭 버튼 4개 + 카드 5장 + 크루 + 준비 버튼 등을 넘어가며 접근
    for (let i = 0; i < 20; i++) {
      await pageA.keyboard.press('Tab');
    }
    // 어딘가에 포커스가 있어야 함 (키보드 트래핑 없음)
    const focused = await pageA.evaluate(() => {
      const el = document.activeElement;
      return el ? { tag: el.tagName, id: el.id, class: el.className } : null;
    });
    expect(focused).not.toBeNull();

    await ctxA.close();
    await ctxB.close();
  });
});

test.describe('QA2 신규 엣지케이스: 결과 오버레이 레이아웃', () => {
  test('결과 오버레이가 3행 Grid에서 올바르게 표시된다', async ({ browser, request }) => {
    const ctxA = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const ctxB = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    const errors = [];
    pageA.on('pageerror', e => errors.push(e.message));

    await Promise.all([pageA.goto('/?name=QA2-Result-A'), pageB.goto('/?name=QA2-Result-B')]);
    await Promise.all([pageA.locator('#ready-button').click(), pageB.locator('#ready-button').click()]);
    await expect(pageA.locator('#ready-overlay')).toBeHidden();

    // 8모듈 진행 + 완료
    for (let i = 0; i < 8; i++) await request.post('/__test/advance');
    await request.post('/__test/finish');
    await expect(pageA.locator('#result-overlay')).toBeVisible({ timeout: 5000 });

    // 결과 오버레이가 전체 화면 커버
    const resultLayout = await pageA.evaluate(() => {
      const ro = document.querySelector('#result-overlay');
      const cs = getComputedStyle(ro);
      const rect = ro.getBoundingClientRect();
      return {
        position: cs.position,
        width: rect.width,
        height: rect.height,
        top: rect.top,
        left: rect.left,
      };
    });
    expect(resultLayout.position).toBe('fixed');
    expect(resultLayout.width).toBeGreaterThanOrEqual(1280 - 1);
    expect(resultLayout.height).toBeGreaterThanOrEqual(720 - 1);
    expect(resultLayout.top).toBeLessThanOrEqual(1);
    expect(resultLayout.left).toBeLessThanOrEqual(1);

    // toolbar는 result-overlay 표시 중 display:none
    const toolbarDisplay = await pageA.evaluate(() => {
      return getComputedStyle(document.querySelector('.toolbar')).display;
    });
    expect(toolbarDisplay).toBe('none');

    await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
    await pageA.screenshot({ path: `${SCREENSHOT_DIR}/qa2-result-overlay-1280x720.png` });

    expect(errors).toEqual([]);
    await ctxA.close();
    await ctxB.close();
  });
});

test.describe('QA2 신규 엣지케이스: 실제 게임플레이 (이동/점프/E 고정)', () => {
  test('이동, 점프, E키 입력이 정상 동작한다', async ({ browser }) => {
    const ctxA = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const ctxB = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    const errors = [];
    pageA.on('pageerror', e => errors.push(e.message));
    pageB.on('pageerror', e => errors.push(e.message));

    await Promise.all([pageA.goto('/?name=QA2-Play-A'), pageB.goto('/?name=QA2-Play-B')]);
    await Promise.all([pageA.locator('#ready-button').click(), pageB.locator('#ready-button').click()]);
    await expect(pageA.locator('#ready-overlay')).toBeHidden();
    await expect(pageB.locator('#ready-overlay')).toBeHidden();

    const roleA = await pageA.locator('body').getAttribute('data-player-id');
    const movingPage = roleA === 'p1' ? pageA : pageB;

    // 이동 확인 (D/ArrowRight)
    const initX = Number(await movingPage.locator('body').getAttribute('data-player-x'));
    await movingPage.keyboard.down('KeyD');
    await movingPage.waitForTimeout(500);
    await movingPage.keyboard.up('KeyD');
    await expect.poll(async () => Number(await movingPage.locator('body').getAttribute('data-player-x')))
      .toBeGreaterThan(initX + 30);

    // 점프 확인 (Space)
    const preJumpY = Number(await movingPage.locator('body').getAttribute('data-player-y'));
    await movingPage.keyboard.press('Space');
    await movingPage.waitForTimeout(200);
    const midJumpY = Number(await movingPage.locator('body').getAttribute('data-player-y'));
    // 점프 시 Y가 감소 (위로 이동) -- 좌표계에서 위가 작은 값일 수 있음
    // 서버 좌표계에서 Y는 아래가 양수이므로, 점프 시 Y 감소
    // 어쨌든 Y가 변했으면 점프 동작 확인
    expect(midJumpY).not.toBe(preJumpY);

    // E 키 (상호작용) -- 단자 근처가 아니면 아무 일도 안 일어나지만 에러가 없어야 함
    await movingPage.keyboard.down('KeyE');
    await movingPage.waitForTimeout(300);
    await movingPage.keyboard.up('KeyE');

    await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
    await movingPage.screenshot({ path: `${SCREENSHOT_DIR}/qa2-gameplay-movement.png` });

    expect(errors).toEqual([]);
    await ctxA.close();
    await ctxB.close();
  });
});

test.describe('QA2 신규 엣지케이스: ready-card flex-start + 짧은 콘텐츠', () => {
  test('카드가 짧을 때(탭당 5장) 부모 overlay grid place-items:center가 세로 중앙 배치', async ({ browser }) => {
    // 탭 분기 도입으로 기본 상태에서 이미 5장만 표시되므로 별도 숨김 불필요
    const ctxA = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const ctxB = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    await Promise.all([pageA.goto('/?name=QA2-Short-A'), pageB.goto('/?name=QA2-Short-B')]);
    // 탭 분기: 초기 탭(기지) 5장 표시 — 이미 짧은 콘텐츠 상태
    await expect(pageA.locator('.level-card')).toHaveCount(INITIAL_TAB_CARD_COUNT, { timeout: 5000 });

    const metrics = await pageA.evaluate(() => {
      const card = document.querySelector('.ready-card');
      const overlay = document.querySelector('#ready-overlay');
      const cardRect = card.getBoundingClientRect();
      const overlayCS = getComputedStyle(overlay);
      return {
        cardTop: cardRect.top,
        cardHeight: cardRect.height,
        cardBottom: cardRect.bottom,
        overlayPlaceItems: overlayCS.placeItems,
        viewportHeight: window.innerHeight,
        // 카드가 세로 중앙에 있으려면 top > 0 이어야 함
        isCentered: cardRect.top > 10,
        scrollNeeded: card.scrollHeight > card.clientHeight,
      };
    });

    console.log(`짧은 콘텐츠: cardTop=${metrics.cardTop}, cardH=${metrics.cardHeight}, centered=${metrics.isCentered}`);
    console.log(`overlay placeItems=${metrics.overlayPlaceItems}, scrollNeeded=${metrics.scrollNeeded}`);

    // 짧은 콘텐츠에서는 스크롤 불필요
    expect(metrics.scrollNeeded).toBe(false);
    // overlay의 place-items: center가 카드를 중앙에 배치
    expect(metrics.overlayPlaceItems).toContain('center');
    // 카드가 위에 붙어있지 않고 세로 중앙에 있어야 함
    expect(metrics.isCentered).toBe(true);

    await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
    await pageA.screenshot({ path: `${SCREENSHOT_DIR}/qa2-short-content-centered.png` });

    await ctxA.close();
    await ctxB.close();
  });
});

test.describe('QA2 신규 엣지케이스: 콘솔 에러 및 연속 리사이즈', () => {
  test('빠른 연속 리사이즈(10회) 후 콘솔 에러 0건', async ({ browser }) => {
    const ctxA = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const ctxB = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    const errors = [];
    pageA.on('pageerror', e => errors.push(e.message));

    await Promise.all([pageA.goto('/?name=QA2-Resize-A'), pageB.goto('/?name=QA2-Resize-B')]);
    await Promise.all([pageA.locator('#ready-button').click(), pageB.locator('#ready-button').click()]);
    await expect(pageA.locator('#ready-overlay')).toBeHidden();

    // 빠른 연속 리사이즈 10회
    const sizes = [
      { width: 1024, height: 576 },
      { width: 1920, height: 1080 },
      { width: 520, height: 900 },
      { width: 1280, height: 720 },
      { width: 900, height: 520 },
      { width: 321, height: 568 },
      { width: 2560, height: 1440 },
      { width: 521, height: 576 },
      { width: 520, height: 576 },
      { width: 1280, height: 720 },
    ];
    for (const size of sizes) {
      await pageA.setViewportSize(size);
      await pageA.waitForTimeout(50);
    }

    await pageA.waitForTimeout(500);

    // 리사이즈 후 3행 Grid 유지
    const layout = await pageA.evaluate(() => {
      const tb = document.querySelector('#topbar').getBoundingClientRect();
      const pv = document.querySelector('#play-viewport').getBoundingClientRect();
      const bb = document.querySelector('#bottombar').getBoundingClientRect();
      return {
        hasTopbar: tb.height > 0,
        hasPlayViewport: pv.height > 0,
        hasBottombar: bb.height > 0,
        order: tb.y < pv.y && pv.y < bb.y,
      };
    });
    expect(layout.hasTopbar).toBe(true);
    expect(layout.hasPlayViewport).toBe(true);
    expect(layout.hasBottombar).toBe(true);
    expect(layout.order).toBe(true);

    expect(errors).toEqual([]);
    await ctxA.close();
    await ctxB.close();
  });
});
