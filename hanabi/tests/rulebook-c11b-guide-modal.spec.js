/**
 * @fileoverview 하나비 가이드 모달 E2E (HR-C11B).
 *
 * 헤더에 추가된 📖 가이드 버튼으로 호출되는 모달 슬라이더 검증.
 * 게임 시작 후에도 대기 화면 인라인 슬라이더와 독립적으로 룰 가이드를 재열람할 수 있어야 한다.
 *
 * 사전 요건: hanabi 서버가 http://localhost:3096 에서 실행 중이어야 한다.
 *   node server.js --port 3096
 *
 * 실행:
 *   npx playwright test tests/rulebook-c11b-guide-modal.spec.js --reporter=list
 *
 * 관련 스펙: 가이드 모달 즉시 수정 (2026-06-03)
 * 성공 기준:
 *  - 트리거 버튼 클릭 → 모달 표시 + 첫 패널(1/7)
 *  - 닫기/백드롭/ESC로 모달 닫힘
 *  - 모달 열린 상태에서만 ←/→ 키 동작 + 모달 닫힘 시 키 누수 없음
 *  - 인라인 슬라이더와 모달이 독립 인덱스 유지
 */

import { test, expect } from 'playwright/test';

const BASE = 'http://localhost:3096';
const TOTAL = 7;

/**
 * 단일 페이지를 열고 대기 화면이 노출될 때까지 대기한다.
 * (1명만 입장하면 waiting=true로 대기 화면에 머무므로 헤더 가이드 버튼도 표시된다.)
 */
async function openPage(browser, viewport = { width: 1000, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(BASE);
  await page.waitForSelector('#btn-open-guide', { timeout: 15000 });
  await page.waitForSelector('#screen-waiting:not(.hidden)', { timeout: 15000 });
  return { ctx, page, errs };
}

test('HR-C11B-001 헤더 가이드 버튼 표시 + 클릭 시 모달 열림(첫 패널 1/7)', async ({ browser }) => {
  const { ctx, page, errs } = await openPage(browser);
  try {
    // 헤더 버튼이 표시되어야 한다.
    await expect(page.locator('#btn-open-guide')).toBeVisible();

    // 초기 상태: 모달은 hidden.
    await expect(page.locator('#guide-modal')).toHaveClass(/hidden/);

    // 클릭으로 모달 열림.
    await page.click('#btn-open-guide');
    await expect(page.locator('#guide-modal')).not.toHaveClass(/hidden/);
    await expect(page.locator('#guide-modal-img')).toBeVisible();

    // 첫 패널: src=1.png, alt 1/7, 인디케이터 "1 / 7", prev disabled / next enabled.
    const src = await page.locator('#guide-modal-img').getAttribute('src');
    expect(src).toContain('assets/guide/1.png');
    const indicator = (await page.locator('#guide-modal-indicator').textContent()).trim();
    expect(indicator).toBe(`1 / ${TOTAL}`);
    await expect(page.locator('#guide-modal-prev')).toBeDisabled();
    await expect(page.locator('#guide-modal-next')).toBeEnabled();

    // 이미지가 실제로 로드됐는지.
    const naturalW = await page.locator('#guide-modal-img').evaluate((el) => el.naturalWidth);
    expect(naturalW).toBeGreaterThan(0);

    await page.screenshot({ path: 'tests/screenshots/c11b-modal-initial.png', fullPage: true });
    expect(errs).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('HR-C11B-002 닫기 버튼(✕) 클릭 → 모달 닫힘', async ({ browser }) => {
  const { ctx, page, errs } = await openPage(browser);
  try {
    await page.click('#btn-open-guide');
    await expect(page.locator('#guide-modal')).not.toHaveClass(/hidden/);

    await page.click('#guide-modal-close');
    await expect(page.locator('#guide-modal')).toHaveClass(/hidden/);
    expect(errs).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('HR-C11B-003 ESC 키 → 모달 닫힘', async ({ browser }) => {
  const { ctx, page, errs } = await openPage(browser);
  try {
    await page.click('#btn-open-guide');
    await expect(page.locator('#guide-modal')).not.toHaveClass(/hidden/);

    await page.keyboard.press('Escape');
    await expect(page.locator('#guide-modal')).toHaveClass(/hidden/);
    expect(errs).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('HR-C11B-004 백드롭 클릭 → 모달 닫힘 (카드 내부 클릭은 닫지 않음)', async ({ browser }) => {
  const { ctx, page, errs } = await openPage(browser);
  try {
    await page.click('#btn-open-guide');
    await expect(page.locator('#guide-modal')).not.toHaveClass(/hidden/);

    // 카드 내부(이미지) 클릭은 모달을 닫지 않아야 한다.
    await page.click('#guide-modal-img');
    await expect(page.locator('#guide-modal')).not.toHaveClass(/hidden/);

    // 백드롭(좌상단 모서리)을 클릭. modalEl 자기 자신이 target일 때만 닫힌다.
    // 모달 카드의 박스를 피해 모서리 좌표를 직접 클릭.
    const box = await page.locator('#guide-modal').boundingBox();
    await page.mouse.click(box.x + 4, box.y + 4);
    await expect(page.locator('#guide-modal')).toHaveClass(/hidden/);
    expect(errs).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('HR-C11B-005 모달 열린 상태에서 ←/→ 키 → 인덱스/이미지 src 변경', async ({ browser }) => {
  const { ctx, page, errs } = await openPage(browser);
  try {
    await page.click('#btn-open-guide');

    // →키 2회 → 3 / 7.
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    expect((await page.locator('#guide-modal-indicator').textContent()).trim()).toBe(`3 / ${TOTAL}`);
    let src = await page.locator('#guide-modal-img').getAttribute('src');
    expect(src).toContain('assets/guide/3.png');

    // ←키 1회 → 2 / 7.
    await page.keyboard.press('ArrowLeft');
    expect((await page.locator('#guide-modal-indicator').textContent()).trim()).toBe(`2 / ${TOTAL}`);
    src = await page.locator('#guide-modal-img').getAttribute('src');
    expect(src).toContain('assets/guide/2.png');

    // 경계: 1까지 내려가 ← 추가 → 1 유지.
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    expect((await page.locator('#guide-modal-indicator').textContent()).trim()).toBe(`1 / ${TOTAL}`);

    // 경계: TOTAL까지 올라가 → 추가 → TOTAL 유지.
    for (let i = 0; i < TOTAL + 3; i++) await page.keyboard.press('ArrowRight');
    expect((await page.locator('#guide-modal-indicator').textContent()).trim()).toBe(`${TOTAL} / ${TOTAL}`);
    src = await page.locator('#guide-modal-img').getAttribute('src');
    expect(src).toContain(`assets/guide/${TOTAL}.png`);
    expect(src).not.toContain('8.png');
    expect(src).not.toContain('0.png');
    expect(errs).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('HR-C11B-006 모달 닫힌 상태에서 ←/→ 키 → 모달 미동작 + 인라인 슬라이더만 반응 (키 누수 방지)', async ({ browser }) => {
  const { ctx, page, errs } = await openPage(browser);
  try {
    // 모달은 닫혀 있는 상태.
    await expect(page.locator('#guide-modal')).toHaveClass(/hidden/);

    // 모달 인디케이터 초기값 확인.
    expect((await page.locator('#guide-modal-indicator').textContent()).trim()).toBe(`1 / ${TOTAL}`);
    // 인라인 슬라이더 초기값.
    expect((await page.locator('#guide-indicator').textContent()).trim()).toBe(`1 / ${TOTAL}`);

    // → 2회: 대기 화면 인라인은 진행되어야 함, 모달은 변동 없어야 함.
    await page.locator('body').focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    expect((await page.locator('#guide-indicator').textContent()).trim()).toBe(`3 / ${TOTAL}`);
    // 모달은 여전히 닫혀 있고 모달 자체 인덱스는 그대로.
    await expect(page.locator('#guide-modal')).toHaveClass(/hidden/);
    expect((await page.locator('#guide-modal-indicator').textContent()).trim()).toBe(`1 / ${TOTAL}`);
    expect(errs).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('HR-C11B-007 모달 열림 시 인라인 슬라이더 키 가드 — 모달만 반응 (중복 이동 방지)', async ({ browser }) => {
  const { ctx, page, errs } = await openPage(browser);
  try {
    // 인라인 슬라이더 인덱스를 미리 2로 만들어 비교 기준 설정.
    await page.click('#guide-next');
    expect((await page.locator('#guide-indicator').textContent()).trim()).toBe(`2 / ${TOTAL}`);

    // 모달 열기.
    await page.click('#btn-open-guide');
    await expect(page.locator('#guide-modal')).not.toHaveClass(/hidden/);

    // 모달이 열린 상태에서 →키 → 모달만 1→2로 진행, 인라인은 2 유지.
    await page.keyboard.press('ArrowRight');
    expect((await page.locator('#guide-modal-indicator').textContent()).trim()).toBe(`2 / ${TOTAL}`);
    expect((await page.locator('#guide-indicator').textContent()).trim()).toBe(`2 / ${TOTAL}`);
    expect(errs).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('HR-C11B-008 재오픈 시 인덱스 1로 리셋', async ({ browser }) => {
  const { ctx, page, errs } = await openPage(browser);
  try {
    await page.click('#btn-open-guide');
    // 3페이지로 이동.
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    expect((await page.locator('#guide-modal-indicator').textContent()).trim()).toBe(`3 / ${TOTAL}`);

    // 닫고.
    await page.click('#guide-modal-close');
    await expect(page.locator('#guide-modal')).toHaveClass(/hidden/);

    // 다시 열기 → 1 / 7로 리셋.
    await page.click('#btn-open-guide');
    expect((await page.locator('#guide-modal-indicator').textContent()).trim()).toBe(`1 / ${TOTAL}`);
    const src = await page.locator('#guide-modal-img').getAttribute('src');
    expect(src).toContain('assets/guide/1.png');
    expect(errs).toEqual([]);
  } finally {
    await ctx.close();
  }
});
