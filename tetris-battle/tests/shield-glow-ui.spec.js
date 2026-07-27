/**
 * @fileoverview 방어막 보드 외곽 글로우의 상태 수명, 정렬, 입력 투과 및 모션 감소 동작을 검증한다.
 */

import { test, expect } from 'playwright/test';

const BASE_URL = 'http://localhost:3055';

/**
 * 실제 페이지 DOM으로 UI 컨트롤러를 만들고 게임 화면을 검증 가능한 상태로 전환한다.
 *
 * @param {import('playwright/test').Page} page Playwright 페이지
 * @returns {Promise<void>}
 */
async function prepareShieldPreview(page) {
  await page.goto(BASE_URL);
  await page.locator('#screen-waiting').evaluate((element) => element.classList.add('hidden'));
  await page.locator('.game-main').evaluate((element) => element.classList.remove('hidden'));
  await page.evaluate(async () => {
    const [{ createUI }, { createItems }] = await Promise.all([
      import('/js/ui.js'),
      import('/js/items.js'),
    ]);
    const byId = (id) => document.getElementById(id);
    window.__shieldTestUI = createUI({
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
    window.__shieldTestItems = createItems({
      ui: window.__shieldTestUI,
      game: { clearBottomLines() {}, receiveGarbageImmediate() {}, setFrozenByItem() {} },
      input: { setFrozen() {} },
      net: { sendItemUse() {} },
    });
  });
}

/**
 * 보호 테두리와 캔버스의 화면 경계 차이를 반환한다.
 *
 * @param {import('playwright/test').Page} page Playwright 페이지
 * @returns {Promise<{left:number,top:number,right:number,bottom:number}>}
 */
async function getEdgeDelta(page) {
  return page.evaluate(() => {
    const frame = document.getElementById('shield-frame').getBoundingClientRect();
    const canvas = document.getElementById('board-canvas').getBoundingClientRect();
    return {
      left: Math.abs(frame.left - canvas.left),
      top: Math.abs(frame.top - canvas.top),
      right: Math.abs(frame.right - canvas.right),
      bottom: Math.abs(frame.bottom - canvas.bottom),
    };
  });
}

test.describe('방어막 외곽 글로우', () => {
  test('활성 글로우가 캔버스 경계와 정렬되고 입력을 가로막지 않는다', async ({ page }) => {
    await prepareShieldPreview(page);
    await page.evaluate(() => window.__shieldTestUI.setShieldFrameActive(true));

    const frame = page.locator('#shield-frame');
    await expect(frame).toHaveClass(/active/);
    await expect(frame).toHaveCSS('pointer-events', 'none');
    const delta = await getEdgeDelta(page);
    for (const value of Object.values(delta)) expect(value).toBeLessThanOrEqual(1);

    await page.screenshot({ path: 'tests/screenshots/shield-glow-active.png' });
  });

  test('차단 시 breaking으로 전환되고 1초 안에 idle로 정리된다', async ({ page }) => {
    await prepareShieldPreview(page);
    await page.evaluate(() => {
      window.__shieldTestItems.triggerShield();
      window.__shieldTestItems.onShieldBlocked('dark', true);
    });

    const frame = page.locator('#shield-frame');
    await expect(frame).not.toHaveClass(/active/);
    await expect(frame).toHaveClass(/breaking/);
    await page.screenshot({ path: 'tests/screenshots/shield-glow-breaking.png' });
    await expect(frame).not.toHaveClass(/breaking/, { timeout: 1100 });
  });

  test('차단 도중 reset과 연속 활성 호출이 멱등으로 동작한다', async ({ page }) => {
    await prepareShieldPreview(page);
    await page.evaluate(() => {
      window.__shieldTestItems.triggerShield();
      window.__shieldTestItems.onShieldBlocked('dark', true);
      window.__shieldTestItems.reset();
      window.__shieldTestItems.reset();
      window.__shieldTestItems.triggerShield();
      window.__shieldTestItems.triggerShield();
    });

    const frame = page.locator('#shield-frame');
    await expect(frame).toHaveClass(/active/);
    await expect(frame).not.toHaveClass(/breaking/);
    await page.waitForTimeout(1000);
    await expect(frame).toHaveClass(/active/);
  });

  test('공격자 SHIELD_BLOCK은 내 테두리를 깨지 않고 상대 아이콘만 해제한다', async ({ page }) => {
    await prepareShieldPreview(page);
    await page.evaluate(() => {
      window.__shieldTestUI.setShieldFrameActive(true);
      window.__shieldTestUI.setOppShieldBadge(true);
      // 로컬 shieldActive가 false인 공격자 분기로 진입한다.
      window.__shieldTestItems.onShieldBlocked('freeze', false);
    });

    await expect(page.locator('#shield-frame')).toHaveClass(/active/);
    await expect(page.locator('#shield-frame')).not.toHaveClass(/breaking/);
    await expect(page.locator('#opp-shield-badge')).not.toHaveClass(/active/);
  });

  test('누락 역할만 로컬 상태로 fallback하고 명시 false는 뒤집지 않는다', async ({ page }) => {
    await prepareShieldPreview(page);
    await page.evaluate(() => {
      window.__shieldTestItems.triggerShield();
      window.__shieldTestItems.onShieldBlocked('dark', false);
    });
    await expect(page.locator('#shield-frame')).toHaveClass(/active/);
    await expect(page.locator('#shield-frame')).not.toHaveClass(/breaking/);

    await page.evaluate(() => window.__shieldTestItems.onShieldBlocked('dark', undefined));
    await expect(page.locator('#shield-frame')).not.toHaveClass(/active/);
    await expect(page.locator('#shield-frame')).toHaveClass(/breaking/);
  });

  test('작은 높이에서도 캔버스 외곽에 정렬된다', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 650 });
    await prepareShieldPreview(page);
    await page.evaluate(() => window.__shieldTestUI.setShieldFrameActive(true));
    const delta = await getEdgeDelta(page);
    for (const value of Object.values(delta)) expect(value).toBeLessThanOrEqual(1);
  });

  test('reduced-motion에서는 지속 애니메이션 없이 상태와 정리가 유지된다', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await prepareShieldPreview(page);
    await page.evaluate(() => window.__shieldTestUI.setShieldFrameActive(true));

    const frame = page.locator('#shield-frame');
    await expect(frame).toHaveCSS('animation-name', 'none');
    await page.evaluate(() => window.__shieldTestUI.flashShieldBlock());
    await expect(frame).toHaveClass(/breaking/);
    await expect(frame).not.toHaveClass(/breaking/, { timeout: 500 });
  });
});
