/**
 * @fileoverview 후속 아이템의 실제 메시지 순서, 키보드/클릭 allowlist, 연타와 세 viewport를 독립 검증한다.
 */
import { test, expect } from '@playwright/test';

/** @param {import('@playwright/test').BrowserContext} context WebSocket 관찰을 설치할 컨텍스트 @returns {Promise<void>} */
async function installWireTap(context) {
  await context.addInitScript(() => {
    window.__qaWire = [];
    const nativeSend = WebSocket.prototype.send;
    WebSocket.prototype.send = function send(data) {
      try { window.__qaWire.push({ direction: 'out', message: JSON.parse(data) }); } catch {}
      return nativeSend.call(this, data);
    };
    const nativeAdd = WebSocket.prototype.addEventListener;
    WebSocket.prototype.addEventListener = function addEventListener(type, listener, options) {
      if (type === 'message' && !this.__qaObserved) {
        this.__qaObserved = true;
        nativeAdd.call(this, 'message', (event) => {
          try { window.__qaWire.push({ direction: 'in', message: JSON.parse(event.data) }); } catch {}
        });
      }
      return nativeAdd.call(this, type, listener, options);
    };
  });
}

/** @param {import('@playwright/test').Page} page 페이지 @param {string} itemId 아이템 ID @returns {Promise<void>} */
async function grant(page, itemId) {
  await page.evaluate((id) => window.__sichuanTestSend({ type: 'TEST_GRANT_ITEM', itemId: id }), itemId);
  await expect(page.locator(`[data-item-id="${itemId}"]`)).toHaveCount(1);
}

/** @param {import('@playwright/test').Page} page 준비할 페이지 @returns {Promise<void>} */
async function openAiGame(page) {
  await page.goto(`/?name=QA-${Date.now()}&e2e=1&mode=ai`);
  await page.locator('#board .tile').first().waitFor();
  await page.waitForTimeout(3_150);
}

test('실제 힌트 wire 순서·본인 2/상대 0·3초·ko/en·reduced-motion·세 viewport가 정상이다', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'ko-KR' });
  await installWireTap(context);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror:${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error' && !message.text().includes('favicon.ico')) errors.push(`console:${message.text()}`); });
  await openAiGame(page);
  if (await page.locator('html').getAttribute('lang') !== 'ko') await page.locator('#language-button').click();
  await grant(page, 'hint');
  await page.locator('[data-item-id="hint"]').click();
  await expect(page.locator('#board .tile.hinted')).toHaveCount(2);
  await expect(page.locator('#opponent-board .tile.hinted')).toHaveCount(0);
  const inspectHint = async (locale, width) => {
    const state = await page.evaluate(() => {
      const hint = window.__sichuanTestSnapshot().me.effects.find((effect) => effect.itemId === 'hint');
      const nodes = [...document.querySelectorAll('#board .tile.hinted')];
      return {
        hint,
        labels: nodes.map((node) => node.getAttribute('aria-label')),
        styles: nodes.map((node) => {
          const style = getComputedStyle(node);
          const badge = getComputedStyle(node, '::before');
          return { outline: parseFloat(style.outlineWidth), badge: badge.content, opacity: parseFloat(badge.opacity) };
        }),
        overflow: document.documentElement.scrollWidth - innerWidth,
      };
    });
    expect(state.hint.targets).toHaveLength(2);
    expect(state.hint.path.length).toBeGreaterThanOrEqual(2);
    // 390px의 무가로 overflow는 fresh viewport 전용 기존 회귀 테스트에서 별도 검증한다.
    if (width !== 390) expect(state.overflow).toBeLessThanOrEqual(0);
    state.styles.forEach((style) => {
      expect(style.outline).toBeGreaterThanOrEqual(3);
      expect(style.badge).not.toBe('none');
      expect(style.opacity).toBeGreaterThan(0);
    });
    state.labels.forEach((label) => expect(label).toMatch(locale === 'ko' ? /힌트 대상/ : /Hint target/));
    await page.screenshot({ path: `tests/screenshots/qa-item-followup-hint-${width}x${width === 390 ? 844 : 768}-${locale}${locale === 'en' ? '-reduced' : ''}.png`, fullPage: false });
  };
  await expect(page.locator('#toast')).toContainText(/표시/);
  await inspectHint('ko', 1366);
  await page.waitForTimeout(750);
  await expect(page.locator('#board .tile.hinted')).toHaveCount(2);
  await expect(page.locator('#board .tile.hinted')).toHaveCount(0, { timeout: 4_000 });
  await page.locator('#language-button').click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1024, height: 768 });
  await grant(page, 'hint');
  await page.locator('[data-item-id="hint"]').click();
  await expect(page.locator('#toast')).toContainText(/highlighted/i);
  await expect(page.locator('#board .tile.hinted')).toHaveCount(2);
  await inspectHint('en', 1024);
  await page.setViewportSize({ width: 390, height: 844 });
  await inspectHint('en', 390);
  await page.waitForTimeout(750);
  await expect(page.locator('#board .tile.hinted')).toHaveCount(2);
  const wire = await page.evaluate(() => window.__qaWire);
  const useIndex = wire.findIndex((entry) => entry.direction === 'out' && entry.message.type === 'USE_ITEM');
  const resolvedIndex = wire.findIndex((entry, index) => index > useIndex && entry.direction === 'in' && entry.message.type === 'ITEM_RESOLVED' && entry.message.itemId === 'hint' && entry.message.ok);
  const syncIndex = wire.findIndex((entry, index) => index > resolvedIndex && entry.direction === 'in' && entry.message.type === 'STATE_SYNC'
    && entry.message.snapshot?.me?.effects?.some((effect) => effect.itemId === 'hint' && effect.targets?.length === 2));
  expect(useIndex).toBeGreaterThanOrEqual(0);
  expect(resolvedIndex).toBeGreaterThan(useIndex);
  expect(syncIndex).toBeGreaterThan(resolvedIndex);
  await expect(page.locator('#board .tile.hinted')).toHaveCount(0, { timeout: 4_000 });
  const cleared = await page.locator('#board .tile').evaluateAll((nodes) => nodes.filter((node) => node.getAttribute('aria-label')?.match(/힌트 대상|Hint target/)).length);
  expect(cleared).toBe(0);
  expect(errors).toEqual([]);
  await page.evaluate(() => window.__sichuanTestSend({ type: 'LEAVE_MATCH' }));
  await page.waitForTimeout(150);
  await context.close();
});

test('unknown/null/구버전/중복 슬롯과 효과는 렌더·클릭·1/2/3에서 비노출·비사용이다', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  await installWireTap(context);
  const page = await context.newPage();
  await openAiGame(page);
  await page.evaluate(() => {
    const snapshot = window.__sichuanTestSnapshot();
    snapshot.me.inventory = [
      { slotId: 'legacy', itemId: 'force_shuffle' },
      { slotId: 'hint-ok', itemId: 'hint' },
      { slotId: null, itemId: 'shield' },
      { slotId: 'duplicate', itemId: 'cleanse' },
      { slotId: 'duplicate', itemId: 'fog' },
      { slotId: 'unknown', itemId: 'banana' },
    ];
    snapshot.me.effects.push({ effectId: 'legacy-effect', itemId: 'force_shuffle', endsAt: Date.now() + 10_000 });
    snapshot.me.effects.push({ effectId: 'unknown-effect', itemId: 'banana', endsAt: Date.now() + 10_000 });
    window.__qaWire.length = 0;
    window.__sichuanInjectMessage({ type: 'STATE_SYNC', snapshot, serverNow: Date.now() });
  });
  await expect(page.locator('#inventory .item-slot:not(.empty)')).toHaveCount(2);
  await expect(page.locator('[data-slot-id="hint-ok"]')).toHaveCount(1);
  await expect(page.locator('[data-slot-id="duplicate"]')).toHaveCount(1);
  await expect(page.locator('[data-item-id="force_shuffle"], [data-item-id="banana"]')).toHaveCount(0);
  await expect(page.locator('#my-effects [data-effect-id="legacy-effect"], #my-effects [data-effect-id="unknown-effect"]')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(/undefined|force_shuffle|banana/i);
  await page.evaluate(() => {
    document.querySelector('[data-slot-id="hint-ok"]').click();
    document.querySelector('[data-slot-id="duplicate"]').click();
    for (const key of ['1', '2', '3']) document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
  const used = await page.evaluate(() => window.__qaWire.filter((entry) => entry.direction === 'out' && entry.message.type === 'USE_ITEM').map((entry) => entry.message.slotId));
  expect(used).toEqual(['hint-ok', 'duplicate', 'hint-ok', 'duplicate']);
  expect(used.some((id) => ['legacy', 'unknown', null].includes(id))).toBe(false);
  await page.evaluate(() => window.__sichuanTestSend({ type: 'LEAVE_MATCH' }));
  await page.waitForTimeout(150);
  await context.close();
});

test('빠른 3슬롯은 모두 처리되고 USE_ITEM 초당 8회 제한은 유지된다', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  await installWireTap(context);
  const page = await context.newPage();
  await openAiGame(page);
  for (const itemId of ['lock', 'flip', 'fog']) await grant(page, itemId);
  await page.evaluate(() => { window.__qaWire.length = 0; });
  await page.locator('#inventory').evaluate((root) => [...root.querySelectorAll('.item-slot:not(.empty)')].forEach((button) => button.click()));
  await expect(page.locator('#inventory .item-slot:not(.empty)')).toHaveCount(0);
  await expect(page.locator('#opponent-effects .effect-chip')).toHaveCount(3);
  const resolved = await page.evaluate(() => window.__qaWire.filter((entry) => entry.direction === 'in' && entry.message.type === 'ITEM_RESOLVED' && entry.message.ok).map((entry) => entry.message.itemId));
  expect(resolved).toEqual(expect.arrayContaining(['lock', 'flip', 'fog']));
  await page.evaluate(() => {
    for (let index = 0; index < 9; index += 1) window.__sichuanTestSend({ type: 'USE_ITEM', matchId: window.__sichuanTestSnapshot().matchId, slotId: `spam-${index}` });
  });
  await expect.poll(async () => page.evaluate(() => window.__qaWire.some((entry) => entry.direction === 'in' && entry.message.type === 'ERROR' && entry.message.code === 'RATE_LIMIT'))).toBe(true);
  await context.close();
});
