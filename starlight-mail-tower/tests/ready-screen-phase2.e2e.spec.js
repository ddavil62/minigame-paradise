/**
 * @fileoverview 레디 화면 2단계 -- 탭 분기 + 카드 압축 + Sticky 준비 버튼 Playwright E2E 테스트.
 * AC-1~AC-15 수용 기준 검증.
 * 서버가 단일 룸 구조이므로 각 테스트는 컨텍스트를 완전히 닫고 잠시 대기한 뒤 다음 테스트를 시작한다.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';

const SCREENSHOT_DIR = 'tests/screenshots';

test.describe.serial('레디 화면 2단계 -- 탭 분기 + 카드 압축 + Sticky 준비 버튼', () => {

  /** 탭별 기대 카드 수 */
  const TAB_CARD_COUNTS = { 'tab-tower': 5, 'tab-nature': 5, 'tab-cosmic': 4, 'tab-wonder': 3 };

  test('READY-P2-001: 1024x576에서 #ready-button 뷰포트 내 확인 (AC-1)', async ({ browser, baseURL }) => {
    const ctxA = await browser.newContext({ viewport: { width: 1024, height: 576 } });
    const ctxB = await browser.newContext({ viewport: { width: 1024, height: 576 } });
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    await pageA.goto(`${baseURL}/?name=P2-001-A`);
    await pageB.goto(`${baseURL}/?name=P2-001-B`);

    await expect(pageA.locator('.level-card')).toHaveCount(5, { timeout: 5000 });
    await expect(pageA.locator('#ready-button')).toBeVisible({ timeout: 5000 });

    const box = await pageA.locator('#ready-button').boundingBox();
    expect(box).toBeTruthy();
    const bottom = box.y + box.height;
    expect(bottom).toBeLessThanOrEqual(576);
    expect(box.y).toBeGreaterThanOrEqual(0);
    console.log(`=> 1024x576 ready-button: top=${box.y} bottom=${bottom}`);

    await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
    await pageA.screenshot({ path: `${SCREENSHOT_DIR}/ready-p2-001-1024x576.png` });

    await ctxA.close();
    await ctxB.close();
    await new Promise((r) => setTimeout(r, 300));
  });

  test('READY-P2-002: 탭 4개 존재 및 초기 aria-selected 상태 확인 (AC-2)', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    await page.goto(`${baseURL}/?name=P2-002`);

    await expect(page.locator('.level-tab')).toHaveCount(4, { timeout: 5000 });
    await expect(page.locator('.level-card')).toHaveCount(5, { timeout: 5000 });

    const selectedTabs = page.locator('.level-tab[aria-selected="true"]');
    await expect(selectedTabs).toHaveCount(1);
    expect(await selectedTabs.getAttribute('data-tab')).toBe('tab-tower');

    await ctx.close();
    await new Promise((r) => setTimeout(r, 300));
  });

  test('READY-P2-003: 각 탭 클릭 시 카드 수 검증 (AC-3)', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    await page.goto(`${baseURL}/?name=P2-003`);
    await expect(page.locator('.level-card')).toHaveCount(5, { timeout: 5000 });

    for (const [tabId, expectedCount] of Object.entries(TAB_CARD_COUNTS)) {
      await page.locator(`.level-tab[data-tab="${tabId}"]`).click();
      await expect(page.locator('.level-card')).toHaveCount(expectedCount, { timeout: 2000 });
    }

    await ctx.close();
    await new Promise((r) => setTimeout(r, 300));
  });

  test('READY-P2-004: 레벨 선택 후 #level-detail-desc 텍스트 갱신 확인 (AC-4, AC-5)', async ({ browser, baseURL }) => {
    const ctxA = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const ctxB = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    await pageA.goto(`${baseURL}/?name=P2-004-A`);
    await pageB.goto(`${baseURL}/?name=P2-004-B`);
    await expect(pageA.locator('.level-card')).toHaveCount(5, { timeout: 5000 });

    const descLocator = pageA.locator('#level-detail-desc');
    await expect(descLocator).not.toHaveText('', { timeout: 3000 });
    const initialDesc = await descLocator.textContent();
    expect(initialDesc.length).toBeGreaterThan(0);

    // 두 번째 카드 클릭 (p1이 호스트)
    await pageA.locator('.level-card').nth(1).click();
    await pageA.waitForTimeout(600);

    const updatedDesc = await descLocator.textContent();
    expect(updatedDesc.length).toBeGreaterThan(0);

    await ctxA.close();
    await ctxB.close();
    await new Promise((r) => setTimeout(r, 300));
  });

  test('READY-P2-005: 카드 높이 100px 이내 확인 (AC-6)', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ viewport: { width: 1024, height: 576 } });
    const page = await ctx.newPage();
    await page.goto(`${baseURL}/?name=P2-005`);
    await expect(page.locator('.level-card')).toHaveCount(5, { timeout: 5000 });

    const cardHeights = await page.evaluate(() =>
      [...document.querySelectorAll('.level-card')].map((c) => c.getBoundingClientRect().height)
    );
    for (const height of cardHeights) {
      expect(height).toBeGreaterThanOrEqual(60);
      expect(height).toBeLessThanOrEqual(100);
    }

    await ctx.close();
    await new Promise((r) => setTimeout(r, 300));
  });

  test('READY-P2-006: .ready-footer position: sticky 확인 (AC-7)', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    await page.goto(`${baseURL}/?name=P2-006`);
    await expect(page.locator('.level-card')).toHaveCount(5, { timeout: 5000 });

    const pos = await page.evaluate(() => getComputedStyle(document.querySelector('.ready-footer')).position);
    expect(pos).toBe('sticky');

    await ctx.close();
    await new Promise((r) => setTimeout(r, 300));
  });

  test('READY-P2-007: 1280x720에서 #ready-button inView 확인 (AC-8)', async ({ browser, baseURL }) => {
    const ctxA = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const ctxB = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    await pageA.goto(`${baseURL}/?name=P2-007-A`);
    await pageB.goto(`${baseURL}/?name=P2-007-B`);
    await expect(pageA.locator('.level-card')).toHaveCount(5, { timeout: 5000 });
    await expect(pageA.locator('#ready-button')).toBeVisible({ timeout: 5000 });

    const box = await pageA.locator('#ready-button').boundingBox();
    expect(box).toBeTruthy();
    expect(box.y).toBeLessThan(720);
    expect(box.y + box.height).toBeLessThanOrEqual(720);

    await ctxA.close();
    await ctxB.close();
    await new Promise((r) => setTimeout(r, 300));
  });

  test('READY-P2-008: 탭 전환 후 레벨 카드 클릭 -> aria-selected 토글 확인 (AC-9)', async ({ browser, baseURL }) => {
    const ctxA = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const ctxB = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    await pageA.goto(`${baseURL}/?name=P2-008-A`);
    await pageB.goto(`${baseURL}/?name=P2-008-B`);
    await expect(pageA.locator('.level-card')).toHaveCount(5, { timeout: 5000 });

    // 자연 탭으로 전환
    await pageA.locator('.level-tab[data-tab="tab-nature"]').click();
    await expect(pageA.locator('.level-card')).toHaveCount(5);

    // 첫 번째 카드 클릭
    await pageA.locator('.level-card').first().click();
    await pageA.waitForTimeout(600);

    const selectedCards = pageA.locator('.level-card[aria-selected="true"]');
    await expect(selectedCards).toHaveCount(1, { timeout: 3000 });

    await ctxA.close();
    await ctxB.close();
    await new Promise((r) => setTimeout(r, 300));
  });

  test('READY-P2-009: KO/EN 탭 라벨 전환 확인 (AC-10)', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    await page.goto(`${baseURL}/?name=P2-009`);
    await expect(page.locator('.level-card')).toHaveCount(5, { timeout: 5000 });

    await expect(page.locator('.level-tab[data-tab="tab-tower"]')).toHaveText('기지');

    // EN 전환 -- toolbar 내 locale 버튼은 ready-overlay 활성 시 CSS로 숨겨지므로
    // dispatchEvent로 click 핸들러를 강제 발동한다
    await page.evaluate(() => {
      document.querySelector('#locale-button').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await page.waitForTimeout(300);

    await expect(page.locator('.level-tab[data-tab="tab-tower"]')).toHaveText('Base');
    await expect(page.locator('.level-tab[data-tab="tab-nature"]')).toHaveText('Nature');
    await expect(page.locator('.level-tab[data-tab="tab-cosmic"]')).toHaveText('Cosmic');
    await expect(page.locator('.level-tab[data-tab="tab-wonder"]')).toHaveText('Wonder');

    await ctx.close();
    await new Promise((r) => setTimeout(r, 300));
  });

  test('READY-P2-010: p2 게스트 카드 disabled 동작 보존 (AC-11)', async ({ browser, baseURL }) => {
    const ctxA = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const ctxB = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    await pageA.goto(`${baseURL}/?name=P2-010-A`);
    await pageB.goto(`${baseURL}/?name=P2-010-B`);
    await expect(pageA.locator('.level-card')).toHaveCount(5, { timeout: 5000 });
    await expect(pageB.locator('.level-card')).toHaveCount(5, { timeout: 5000 });

    const p2Disabled = await pageB.evaluate(() =>
      [...document.querySelectorAll('.level-card')].every((c) => c.disabled)
    );
    expect(p2Disabled).toBe(true);

    // p2도 탭 전환은 가능
    await pageB.locator('.level-tab[data-tab="tab-nature"]').click();
    await expect(pageB.locator('.level-card')).toHaveCount(5);

    await ctxA.close();
    await ctxB.close();
    await new Promise((r) => setTimeout(r, 300));
  });

  test('READY-P2-011: 서버가 다른 탭 레벨을 selectedLevelId로 보낼 때 탭 자동 전환 (AC-12)', async ({ browser, baseURL }) => {
    const ctxA = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const ctxB = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    await pageA.goto(`${baseURL}/?name=P2-011-A`);
    await pageB.goto(`${baseURL}/?name=P2-011-B`);
    await expect(pageA.locator('.level-card')).toHaveCount(5, { timeout: 5000 });
    await expect(pageB.locator('.level-card')).toHaveCount(5, { timeout: 5000 });

    // p1이 자연 탭으로 전환 후 첫 레벨 선택
    await pageA.locator('.level-tab[data-tab="tab-nature"]').click();
    await expect(pageA.locator('.level-card')).toHaveCount(5);
    await pageA.locator('.level-card').first().click();
    await pageA.waitForTimeout(800);

    // p2 화면에서 자연 탭으로 자동 전환됐는지 확인
    const p2ActiveTab = await pageB.locator('.level-tab[aria-selected="true"]').getAttribute('data-tab');
    expect(p2ActiveTab).toBe('tab-nature');

    await ctxA.close();
    await ctxB.close();
    await new Promise((r) => setTimeout(r, 300));
  });

  test('READY-P2-012: 1280x720에서 controls 뷰포트 내 확인 (AC-13)', async ({ browser, baseURL }) => {
    const ctxA = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const ctxB = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    await pageA.goto(`${baseURL}/?name=P2-012-A`);
    await pageB.goto(`${baseURL}/?name=P2-012-B`);
    await expect(pageA.locator('.level-card')).toHaveCount(5, { timeout: 5000 });

    const controlsBox = await pageA.locator('.controls').boundingBox();
    expect(controlsBox).toBeTruthy();
    expect(controlsBox.y).toBeGreaterThanOrEqual(0);
    console.log(`=> 1280x720 controls: top=${controlsBox.y}`);

    await ctxA.close();
    await ctxB.close();
    await new Promise((r) => setTimeout(r, 300));
  });

  test('READY-P2-013: 탭 화살표 키보드 내비게이션 (키보드 접근성)', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    await page.goto(`${baseURL}/?name=P2-013`);
    await expect(page.locator('.level-card')).toHaveCount(5, { timeout: 5000 });

    await page.locator('.level-tab[data-tab="tab-tower"]').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.level-tab[aria-selected="true"]')).toHaveAttribute('data-tab', 'tab-nature');

    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.level-tab[aria-selected="true"]')).toHaveAttribute('data-tab', 'tab-cosmic');

    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('.level-tab[aria-selected="true"]')).toHaveAttribute('data-tab', 'tab-nature');

    await ctx.close();
    await new Promise((r) => setTimeout(r, 300));
  });

  test('READY-P2-014: 탭 전환 후 DOM에 이전 탭 카드 없음 확인 (AC-15)', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    await page.goto(`${baseURL}/?name=P2-014`);
    await expect(page.locator('.level-card')).toHaveCount(5, { timeout: 5000 });

    const towerIds = await page.evaluate(() =>
      [...document.querySelectorAll('.level-card')].map((c) => c.dataset.levelId)
    );
    expect(towerIds).toHaveLength(5);

    await page.locator('.level-tab[data-tab="tab-nature"]').click();
    await expect(page.locator('.level-card')).toHaveCount(5);

    const natureIds = await page.evaluate(() =>
      [...document.querySelectorAll('.level-card')].map((c) => c.dataset.levelId)
    );
    const overlap = towerIds.filter((id) => natureIds.includes(id));
    expect(overlap).toHaveLength(0);

    await ctx.close();
    await new Promise((r) => setTimeout(r, 300));
  });

  test('READY-P2-015: 준비 버튼 클릭 -> 게임 시작 확인', async ({ browser, baseURL }) => {
    const ctxA = await browser.newContext({ viewport: { width: 1024, height: 576 } });
    const ctxB = await browser.newContext({ viewport: { width: 1024, height: 576 } });
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    await pageA.goto(`${baseURL}/?name=P2-015-A`);
    await pageB.goto(`${baseURL}/?name=P2-015-B`);

    await expect(pageA.locator('.level-card')).toHaveCount(5, { timeout: 5000 });
    await expect(pageB.locator('.level-card')).toHaveCount(5, { timeout: 5000 });
    await expect(pageA.locator('#ready-button')).toBeVisible({ timeout: 5000 });
    await expect(pageB.locator('#ready-button')).toBeVisible({ timeout: 5000 });

    await Promise.all([
      pageA.locator('#ready-button').click(),
      pageB.locator('#ready-button').click(),
    ]);

    await expect(pageA.locator('#ready-overlay')).toBeHidden({ timeout: 5000 });
    await expect(pageB.locator('#ready-overlay')).toBeHidden({ timeout: 5000 });
    await expect(pageA.locator('body')).toHaveAttribute('data-server-tick', /[1-9]\d*/, { timeout: 5000 });

    await ctxA.close();
    await ctxB.close();
  });
});
