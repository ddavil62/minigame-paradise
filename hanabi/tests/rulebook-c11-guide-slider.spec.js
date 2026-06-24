/**
 * @fileoverview 하나비 대기 화면 룰 가이드 슬라이더 E2E (HR-C11).
 *
 * #screen-waiting에 추가된 7장 인포그래픽(assets/guide/1.png~7.png) 슬라이더의
 * 렌더·탐색·경계·인디케이터·이미지 로드·키보드/게임중 비활성·모바일 가로스크롤을 검증한다.
 *
 * 사전 요건: 없음 — createApp()으로 동적 포트에서 자체 서버를 생성한다.
 *
 * 실행:
 *   npx playwright test tests/rulebook-c11-guide-slider.spec.js --reporter=list
 *
 * 관련 스펙: .claude/specs/2026-06-01-hanabi-guide-menu-plan.md (Phase 3)
 * 성공 기준: scope §1(렌더+첫 패널) §2(탐색/인디케이터/양끝 비활성) §3(HTTP 200) §4(모바일).
 */

import { test, expect } from 'playwright/test';
import http from 'http';
import { createApp } from '../server.js';

// ── 서버 헬퍼 ──────────────────────────────────────────────────────
function startServer() {
  return new Promise((resolve, reject) => {
    const app = createApp();
    const server = http.createServer(app.handleHttp);
    server.on('upgrade', app.handleUpgrade);
    server.listen(0, () => resolve({ server, port: server.address().port }));
    server.once('error', reject);
  });
}
function stopServer(server) {
  return new Promise((resolve) => {
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    server.close(() => resolve());
    setTimeout(resolve, 300);
  });
}

let _server;
let BASE = '';

test.beforeAll(async () => {
  const { server, port } = await startServer();
  _server = server;
  BASE = `http://localhost:${port}`;
});
test.afterAll(async () => {
  await stopServer(_server);
});

const TOTAL = 7;

/**
 * 대기 화면이 노출되고 가이드 슬라이더가 렌더될 때까지 단일 페이지를 연다.
 * (1명만 입장하면 waiting=true로 대기 화면에 머문다.)
 */
async function openWaiting(browser, viewport = { width: 900, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`${BASE}?name=P1`);
  // READY 게이트: 준비 버튼 클릭(1인이면 대기 화면에 머문다).
  await page.waitForSelector('#btn-ready:not([hidden])', { timeout: 10000 });
  await page.click('#btn-ready');
  await page.waitForSelector('#guide-slider', { timeout: 15000 });
  // 대기 화면이 실제로 보이는 상태인지 확인(게임 진입 전).
  await page.waitForSelector('#screen-waiting:not(.hidden)', { timeout: 15000 });
  return { ctx, page, errs };
}

test('HR-C11-001 대기 화면 노출 시 슬라이더 렌더 + 즉시 첫 패널(1/7)', async ({ browser }) => {
  const { ctx, page, errs } = await openWaiting(browser);
  try {
    // 슬라이더·이미지·버튼·인디케이터 존재.
    await expect(page.locator('#guide-slider')).toBeVisible();
    await expect(page.locator('#guide-img')).toBeVisible();

    // 첫 패널: src=1.png, alt 1/7, 인디케이터 "1 / 7".
    const src = await page.locator('#guide-img').getAttribute('src');
    expect(src).toContain('assets/guide/1.png');
    const alt = await page.locator('#guide-img').getAttribute('alt');
    expect(alt).toContain('1/7');
    const indicator = (await page.locator('#guide-indicator').textContent()).trim();
    expect(indicator).toBe('1 / 7');

    // 이미지가 실제로 로드됐는지(naturalWidth>0 → 404/깨짐 아님).
    const naturalW = await page.locator('#guide-img').evaluate((el) => el.naturalWidth);
    expect(naturalW).toBeGreaterThan(0);

    await page.screenshot({ path: 'tests/screenshots/c11-slider-initial.png', fullPage: true });
    expect(errs).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('HR-C11-002 첫 패널에서 prev 비활성, next 활성 (하단 경계)', async ({ browser }) => {
  const { ctx, page, errs } = await openWaiting(browser);
  try {
    await expect(page.locator('#guide-prev')).toBeDisabled();
    await expect(page.locator('#guide-next')).toBeEnabled();
    expect(errs).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('HR-C11-003 next 클릭으로 1→7 끝까지 탐색, 인디케이터·src 정확, 마지막 next 비활성', async ({ browser }) => {
  const { ctx, page, errs } = await openWaiting(browser);
  try {
    for (let n = 2; n <= TOTAL; n++) {
      await page.click('#guide-next');
      const indicator = (await page.locator('#guide-indicator').textContent()).trim();
      expect(indicator).toBe(`${n} / ${TOTAL}`);
      const src = await page.locator('#guide-img').getAttribute('src');
      expect(src).toContain(`assets/guide/${n}.png`);
      // 매 패널 실제 이미지 로드 확인(7장 전부 404 아님). src 변경 직후 디코드 완료를 대기.
      await page.locator('#guide-img').evaluate((el) => el.complete && el.naturalWidth > 0
        ? true
        : new Promise((r) => { el.onload = () => r(true); el.onerror = () => r(false); }));
      const naturalW = await page.locator('#guide-img').evaluate((el) => el.naturalWidth);
      expect(naturalW, `panel ${n} image loaded`).toBeGreaterThan(0);
    }
    // 마지막(7/7): next 비활성, prev 활성.
    await expect(page.locator('#guide-next')).toBeDisabled();
    await expect(page.locator('#guide-prev')).toBeEnabled();

    await page.screenshot({ path: 'tests/screenshots/c11-slider-last.png', fullPage: true });
    expect(errs).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('HR-C11-004 마지막에서 prev로 1까지 복귀 + 인디케이터 정확히 감소', async ({ browser }) => {
  const { ctx, page, errs } = await openWaiting(browser);
  try {
    // 7/7로 이동.
    for (let i = 0; i < TOTAL - 1; i++) await page.click('#guide-next');
    expect((await page.locator('#guide-indicator').textContent()).trim()).toBe(`${TOTAL} / ${TOTAL}`);
    // prev로 1까지 복귀.
    for (let n = TOTAL - 1; n >= 1; n--) {
      await page.click('#guide-prev');
      expect((await page.locator('#guide-indicator').textContent()).trim()).toBe(`${n} / ${TOTAL}`);
    }
    await expect(page.locator('#guide-prev')).toBeDisabled();
    expect(errs).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('HR-C11-005 경계 언더/오버플로우 방지 — 첫 패널 연타 prev / 마지막 연타 next가 범위 이탈 없음', async ({ browser }) => {
  const { ctx, page, errs } = await openWaiting(browser);
  try {
    // 첫 패널에서 prev 5연타(버튼 비활성이지만 강제 dispatch로 핸들러 누수 검증).
    for (let i = 0; i < 5; i++) {
      await page.locator('#guide-prev').dispatchEvent('click');
    }
    expect((await page.locator('#guide-indicator').textContent()).trim()).toBe(`1 / ${TOTAL}`);
    let src = await page.locator('#guide-img').getAttribute('src');
    expect(src).toContain('assets/guide/1.png');

    // 마지막으로 이동 후 next 5연타.
    for (let i = 0; i < TOTAL - 1; i++) await page.click('#guide-next');
    for (let i = 0; i < 5; i++) {
      await page.locator('#guide-next').dispatchEvent('click');
    }
    expect((await page.locator('#guide-indicator').textContent()).trim()).toBe(`${TOTAL} / ${TOTAL}`);
    src = await page.locator('#guide-img').getAttribute('src');
    expect(src).toContain(`assets/guide/${TOTAL}.png`);
    // src에 0.png나 8.png가 나타나면 오버/언더플로우.
    expect(src).not.toContain('0.png');
    expect(src).not.toContain('8.png');
    expect(errs).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('HR-C11-006 키보드 ←/→ 탐색이 대기 화면에서 동작', async ({ browser }) => {
  const { ctx, page, errs } = await openWaiting(browser);
  try {
    await page.locator('body').focus();
    // → 2회.
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    expect((await page.locator('#guide-indicator').textContent()).trim()).toBe(`3 / ${TOTAL}`);
    // ← 1회.
    await page.keyboard.press('ArrowLeft');
    expect((await page.locator('#guide-indicator').textContent()).trim()).toBe(`2 / ${TOTAL}`);
    // 첫 패널에서 ← 추가는 1 아래로 안 내려감.
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    expect((await page.locator('#guide-indicator').textContent()).trim()).toBe(`1 / ${TOTAL}`);
    expect(errs).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('HR-C11-007 게임 진입 후 키보드 ←/→가 슬라이더를 움직이지 않음 (대기 화면 한정)', async ({ browser }) => {
  // 2명 입장 → 게임 화면 진입 → screenWaiting hidden → 키보드 누수 없어야 함.
  const ctx1 = await browser.newContext({ viewport: { width: 900, height: 900 } });
  const ctx2 = await browser.newContext({ viewport: { width: 900, height: 900 } });
  const p1 = await ctx1.newPage();
  const p2 = await ctx2.newPage();
  const errs = [];
  p1.on('pageerror', (e) => errs.push('p1:' + e.message));
  try {
    await p1.goto(`${BASE}?name=P1`);
    // p1 준비 버튼 클릭 후 대기 화면에서 슬라이더를 조작.
    await p1.waitForSelector('#btn-ready:not([hidden])', { timeout: 10000 });
    await p1.click('#btn-ready');
    await p1.waitForSelector('#guide-slider', { timeout: 15000 });
    await p1.click('#guide-next');
    await p1.click('#guide-next');
    expect((await p1.locator('#guide-indicator').textContent()).trim()).toBe(`3 / ${TOTAL}`);

    // p2 입장 + READY → 양쪽 게임 화면 진입.
    await p2.goto(`${BASE}?name=P2`);
    await p2.waitForSelector('#btn-ready:not([hidden])', { timeout: 10000 });
    await p2.click('#btn-ready');
    await p1.waitForSelector('#my-hand .card', { timeout: 15000 });
    await p2.waitForSelector('#my-hand .card', { timeout: 15000 });
    // 대기 화면이 hidden인지 확인.
    await expect(p1.locator('#screen-waiting')).toHaveClass(/hidden/);

    // 게임 화면에서 방향키 연타 — 슬라이더 인덱스가 변하면 누수(FAIL).
    await p1.locator('body').focus();
    await p1.keyboard.press('ArrowRight');
    await p1.keyboard.press('ArrowRight');
    await p1.keyboard.press('ArrowLeft');
    // 인디케이터는 게임 진입 전 값(3/7) 그대로여야 한다.
    expect((await p1.locator('#guide-indicator').textContent()).trim()).toBe(`3 / ${TOTAL}`);
    expect(errs).toEqual([]);
  } finally {
    await ctx1.close();
    await ctx2.close();
  }
});

test('HR-C11-008 이미지 7장 + 범위 밖 404 — HTTP 상태/Content-Type 검증', async ({ request }) => {
  // 7장 모두 200 image/png.
  for (let n = 1; n <= TOTAL; n++) {
    const res = await request.get(`${BASE}/assets/guide/${n}.png`);
    expect(res.status(), `${n}.png status`).toBe(200);
    expect(res.headers()['content-type'], `${n}.png ct`).toContain('image/png');
  }
  // 범위 밖 8.png는 존재하지 않아야 함(파일이 정확히 7장).
  const res8 = await request.get(`${BASE}/assets/guide/8.png`);
  expect(res8.status()).toBe(404);
});

test('HR-C11-009 모바일 뷰포트(375×812)에서 가로 스크롤 없음 + 이미지 로드', async ({ browser }) => {
  const { ctx, page, errs } = await openWaiting(browser, { width: 375, height: 812 });
  try {
    // 가로 스크롤 미발생: scrollWidth <= clientWidth.
    const overflow = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollW).toBeLessThanOrEqual(overflow.clientW);

    // 모바일에서도 이미지 정상 로드.
    const naturalW = await page.locator('#guide-img').evaluate((el) => el.naturalWidth);
    expect(naturalW).toBeGreaterThan(0);

    await page.screenshot({ path: 'tests/screenshots/c11-slider-mobile.png', fullPage: true });
    expect(errs).toEqual([]);
  } finally {
    await ctx.close();
  }
});
