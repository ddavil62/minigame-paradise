/**
 * @fileoverview 방어막 글로우의 경쟁 상태, 양측 동시 방어막, reset 및 콘솔 안정성을 독립 검증한다.
 */

import { test, expect } from 'playwright/test';

const BASE_URL = 'http://localhost:3055';

/**
 * 실제 DOM에 독립 UI/아이템 컨트롤러를 연결한다.
 *
 * @param {import('playwright/test').Page} page 검증 페이지
 * @returns {Promise<void>}
 */
async function prepare(page) {
  await page.goto(BASE_URL);
  await page.locator('#screen-waiting').evaluate((element) => element.classList.add('hidden'));
  await page.locator('.game-main').evaluate((element) => element.classList.remove('hidden'));
  await page.evaluate(async () => {
    const [{ createUI }, { createItems }] = await Promise.all([
      import('/js/ui.js'),
      import('/js/items.js'),
    ]);
    const byId = (id) => document.getElementById(id);
    const ui = createUI({
      boardCanvas: byId('board-canvas'),
      nextCanvas: byId('next-canvas'),
      holdCanvas: byId('hold-canvas'),
      opponentCanvas: byId('opponent-canvas'),
      scoreEl: byId('score'),
      levelEl: byId('level'),
      linesEl: byId('lines'),
      comboEl: byId('combo'),
      statusEl: byId('status-msg'),
      resultOverlay: byId('result-overlay'),
      resultText: byId('result-text'),
    });
    window.__qaUI = ui;
    window.__qaItems = createItems({
      ui,
      game: { clearBottomLines() {}, receiveGarbageImmediate() {}, setFrozenByItem() {} },
      input: { setFrozen() {} },
      net: { sendItemUse() {} },
    });
  });
}

test.describe('방어막 글로우 독립 QA', () => {
  test('빠른 활성→차단→reset과 반복 reset은 완전한 idle로 끝난다', async ({ page }) => {
    await prepare(page);
    await page.evaluate(() => {
      window.__qaItems.triggerShield();
      window.__qaItems.onShieldBlocked('dark', true);
      window.__qaItems.reset();
      window.__qaItems.reset();
      window.__qaItems.reset();
    });
    const frame = page.locator('#shield-frame');
    await expect(frame).not.toHaveClass(/active|breaking/);
    await page.waitForTimeout(1000);
    await expect(frame).not.toHaveClass(/active|breaking/);
  });

  test('차단 도중 재활성화하면 이전 정리 타이머가 새 방어막을 제거하지 않는다', async ({ page }) => {
    await prepare(page);
    await page.evaluate(() => {
      window.__qaItems.triggerShield();
      window.__qaItems.onShieldBlocked('freeze', true);
      window.__qaItems.triggerShield();
    });
    const frame = page.locator('#shield-frame');
    await expect(frame).toHaveClass(/active/);
    await expect(frame).not.toHaveClass(/breaking/);
    await page.waitForTimeout(1000);
    await expect(frame).toHaveClass(/active/);
  });

  test('양측이 모두 방어막일 때 공격자 알림은 자기 방어막을 소모하지 않는다', async ({ page }) => {
    await prepare(page);
    await page.evaluate(() => {
      // 공격자도 자신의 방어막이 활성인 상태에서 상대 방어막에 공격이 막힌 상황이다.
      window.__qaItems.triggerShield();
      window.__qaUI.setOppShieldBadge(true);
      window.__qaItems.onShieldBlocked('garbage_bomb', false);
    });
    await page.screenshot({ path: 'tests/screenshots/shield-glow-simultaneous-shields-qa.png' });
    await expect(page.locator('#shield-frame')).toHaveClass(/active/);
    await expect(page.locator('#shield-frame')).not.toHaveClass(/breaking/);
    await expect(page.locator('#opp-shield-badge')).not.toHaveClass(/active/);
    expect(await page.evaluate(() => window.__qaItems.isShieldActive())).toBe(true);
  });

  test('reduced-motion 차단은 무한 애니메이션 없이 idle로 정리된다', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await prepare(page);
    await page.evaluate(() => {
      window.__qaItems.triggerShield();
      window.__qaItems.onShieldBlocked('dark', true);
    });
    const frame = page.locator('#shield-frame');
    await expect(frame).toHaveClass(/breaking/);
    await expect(frame).not.toHaveClass(/breaking/, { timeout: 500 });
  });

  test('900x650에서 프레임은 캔버스와 정렬되고 레이아웃을 이동시키지 않는다', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 650 });
    await prepare(page);
    const before = await page.locator('#board-canvas').boundingBox();
    await page.evaluate(() => window.__qaItems.triggerShield());
    const after = await page.locator('#board-canvas').boundingBox();
    const frame = await page.locator('#shield-frame').boundingBox();
    expect(after).toEqual(before);
    expect(frame).not.toBeNull();
    expect(Math.abs(frame.x - after.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(frame.y - after.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(frame.width - after.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(frame.height - after.height)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: 'tests/screenshots/shield-glow-small-qa.png' });
  });

  test('활성·차단·reset 전환에서 pageerror와 console error가 없다', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });
    await prepare(page);
    await page.evaluate(() => {
      window.__qaItems.triggerShield();
      window.__qaItems.onShieldBlocked('dark', true);
      window.__qaItems.reset();
      window.__qaItems.triggerShield();
    });
    await page.waitForTimeout(1000);
    expect(errors).toEqual([]);
  });
});
