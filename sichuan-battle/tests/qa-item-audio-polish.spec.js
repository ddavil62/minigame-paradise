/**
 * @fileoverview 아이템·오디오 폴리시를 최신 3018 실제 서버에서 독립 검증한다.
 */
import { test, expect } from '@playwright/test';

const BASE = process.env.QA_BASE_URL || 'http://127.0.0.1:3028';
const cleanupPages = new Set();

/** @param {import('@playwright/test').Page} page 테스트 방을 안전하게 떠난다. @returns {Promise<void>} */
async function leave(page) {
  if (!page || page.isClosed() || !page.url().startsWith(BASE)) return;
  await page.evaluate(() => window.__sichuanTestSend?.({ type: 'LEAVE_MATCH' })).catch(() => {});
}

test.afterEach(async () => {
  await Promise.all([...cleanupPages].map((page) => leave(page)));
  cleanupPages.clear();
});

/** @param {import('@playwright/test').Page} page AI 경기를 연다. @returns {Promise<void>} */
async function openAi(page) {
  cleanupPages.add(page);
  await page.goto(`${BASE}/sichuan-battle/?name=AudioQA-${Date.now()}&e2e=1&mode=ai`);
  await page.locator('#board .tile').first().waitFor();
}

/** @param {import('@playwright/test').Page} page 아이템을 지급한다. @param {string} itemId 아이템 ID @returns {Promise<void>} */
async function grant(page, itemId) {
  await page.evaluate((id) => window.__sichuanTestSend({ type: 'TEST_GRANT_ITEM', itemId: id }), itemId);
  await expect(page.locator(`[data-item-id="${itemId}"]`)).toHaveCount(1);
}

test('힌트는 4초 뒤 유지되고 번호·경로·안내가 보이며 매칭하면 제거된다', async ({ page }) => {
  await openAi(page);
  await grant(page, 'hint');
  await page.waitForTimeout(3_150);
  const boardBeforeHint = await page.locator('#board-frame').boundingBox();
  await page.locator('[data-item-id="hint"]').click();
  await expect(page.locator('#board .tile.hinted')).toHaveCount(2);
  const boardDuringHint = await page.locator('#board-frame').boundingBox();
  const hintBanner = await page.locator('#hint-banner').boundingBox();
  expect(Math.abs(boardDuringHint.y - boardBeforeHint.y)).toBeLessThanOrEqual(1);
  expect(hintBanner.y).toBeGreaterThanOrEqual(boardDuringHint.y + boardDuringHint.height);
  await expect(page.locator('#board [data-hint-number="1"]')).toHaveCount(1);
  await expect(page.locator('#board [data-hint-number="2"]')).toHaveCount(1);
  await expect(page.locator('#path-layer [data-layer="hint"]')).toHaveCount(1);
  await expect(page.locator('#board-feedback')).toContainText(/①.*②/);
  const privacy = await page.evaluate(() => {
    const snapshot = window.__sichuanTestSnapshot();
    const own = snapshot.me.effects.find((effect) => effect.itemId === 'hint');
    const rival = snapshot.opponent.effects.find((effect) => effect.itemId === 'hint');
    return { ownTargets: own?.targets?.length, ownPath: own?.path?.length, rivalTargets: rival?.targets, rivalPath: rival?.path };
  });
  expect(privacy.ownTargets).toBe(2);
  expect(privacy.ownPath).toBeGreaterThanOrEqual(2);
  expect(privacy.rivalTargets).toBeUndefined();
  expect(privacy.rivalPath).toBeUndefined();
  await page.waitForTimeout(4_100);
  await expect(page.locator('#board .tile.hinted')).toHaveCount(2);
  await page.screenshot({ path: 'tests/screenshots/qa-item-audio-polish-hint-persistent.png', fullPage: false });
  const ids = await page.locator('#board .tile.hinted').evaluateAll((nodes) => nodes.map((node) => node.dataset.tileId));
  await page.locator(`#board [data-tile-id="${ids[0]}"]`).click();
  await page.locator(`#board [data-tile-id="${ids[1]}"]`).click();
  await expect(page.locator('#board .tile.hinted')).toHaveCount(0);
  await expect(page.locator('#path-layer [data-layer="hint"]')).toHaveCount(0);
  await page.evaluate(() => window.__sichuanTestSend({ type: 'LEAVE_MATCH' }));
});

test('3개 아이템 100ms 이하 연타와 행 분산·빈 정화·동일 공격 갱신이 정상이다', async ({ browser }) => {
  const attackerContext = await browser.newContext();
  const defenderContext = await browser.newContext();
  const page = await attackerContext.newPage();
  const defender = await defenderContext.newPage();
  cleanupPages.add(page); cleanupPages.add(defender);
  await Promise.all([
    page.goto(`${BASE}/sichuan-battle/?name=RapidA-${Date.now()}&e2e=1`),
    defender.goto(`${BASE}/sichuan-battle/?name=RapidB-${Date.now()}&e2e=1`),
  ]);
  await Promise.all([page.locator('#board .tile').first().waitFor(), defender.locator('#board .tile').first().waitFor()]);
  for (const itemId of ['lock', 'flip', 'fog']) await grant(page, itemId);
  await page.waitForTimeout(3_150);
  const elapsed = await page.locator('#inventory').evaluate((root) => {
    const buttons = [...root.querySelectorAll('.item-slot:not(.empty)')];
    const started = performance.now();
    buttons.forEach((button) => button.click());
    return performance.now() - started;
  });
  expect(elapsed).toBeLessThan(100);
  await expect(page.locator('#inventory .item-slot:not(.empty)')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__sichuanItemQueue().length)).toBe(0);
  await expect(page.locator('body')).not.toContainText('undefined');
  const distribution = await page.locator('#opponent-board').evaluate((root) => {
    const classByItem = { lock: 'locked', flip: 'flipped', fog: 'fogged' };
    const nodes = [...root.querySelectorAll('.tile')];
    return ['lock', 'flip', 'fog'].map((itemId) => {
      const counts = Array.from({ length: 8 }, () => 0);
      nodes.forEach((node, index) => {
        if (node.classList.contains(classByItem[itemId])) counts[Math.floor(index / 12)] += 1;
      });
      return { itemId, counts };
    });
  });
  expect(distribution.map((entry) => entry.itemId).sort()).toEqual(['flip', 'fog', 'lock']);
  distribution.forEach(({ counts }) => expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1));
  await page.screenshot({ path: 'tests/screenshots/qa-item-audio-polish-rapid-distribution.png', fullPage: false });

  const before = await page.evaluate(() => structuredClone(window.__sichuanTestSnapshot().opponent.effects.find((effect) => effect.itemId === 'flip')));
  await expect.poll(() => page.evaluate(() => window.__sichuanItemQueue().length)).toBe(0);
  await grant(page, 'flip');
  await page.locator('[data-item-id="flip"]').click();
  await expect.poll(() => page.evaluate(() => window.__sichuanTestSnapshot().opponent.effects.find((effect) => effect.itemId === 'flip')?.effectId)).toBe(before.effectId);
  const refreshed = await page.evaluate(() => structuredClone(window.__sichuanTestSnapshot().opponent.effects.find((effect) => effect.itemId === 'flip')));
  expect(refreshed.endsAt).toBeGreaterThan(before.endsAt);

  await grant(page, 'cleanse');
  await page.locator('[data-item-id="cleanse"]').click();
  await expect(page.locator('[data-item-id="cleanse"]')).toHaveCount(0);
  await page.evaluate(() => window.__sichuanTestSend({ type: 'LEAVE_MATCH' }));
  await defender.evaluate(() => window.__sichuanTestSend({ type: 'LEAVE_MATCH' }));
  await attackerContext.close(); await defenderContext.close();
});

test('오디오는 제스처로 풀리고 mute가 복원되며 shield 차단 즉시 glow와 함께 해제된다', async ({ browser }) => {
  const aContext = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const bContext = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const a = await aContext.newPage(); const b = await bContext.newPage();
  cleanupPages.add(a); cleanupPages.add(b);
  await Promise.all([
    a.goto(`${BASE}/sichuan-battle/?name=ShieldA-${Date.now()}&e2e=1`),
    b.goto(`${BASE}/sichuan-battle/?name=ShieldB-${Date.now()}&e2e=1`),
  ]);
  await Promise.all([a.locator('#board .tile').first().waitFor(), b.locator('#board .tile').first().waitFor()]);
  await a.waitForTimeout(3_150);
  await a.locator('#board .tile:not(.removed)').first().click();
  await expect.poll(() => a.evaluate(() => window.__sichuanAudio.context?.state)).toBe('running');
  await expect.poll(() => a.evaluate(() => Boolean(window.__sichuanAudio.bgmTimer))).toBe(true);
  await a.evaluate(() => {
    window.__qaSounds = [];
    const original = window.__sichuanAudio.play.bind(window.__sichuanAudio);
    window.__sichuanAudio.play = (name) => { window.__qaSounds.push(name); original(name); };
  });
  await b.evaluate(() => {
    window.__qaSounds = [];
    const original = window.__sichuanAudio.play.bind(window.__sichuanAudio);
    window.__sichuanAudio.play = (name) => { window.__qaSounds.push(name); original(name); };
  });
  const selected = await a.locator('#board .tile.selected').getAttribute('data-tile-id');
  const mismatch = await a.evaluate((selectedId) => {
    const snapshot = window.__sichuanTestSnapshot();
    const selected = snapshot.me.board.tiles.find((tile) => tile.tileId === selectedId);
    return snapshot.me.board.tiles.find((tile) => !tile.removed && tile.tileId !== selectedId && tile.faceId !== selected.faceId).tileId;
  }, selected);
  await a.locator(`#board [data-tile-id="${mismatch}"]`).click();
  await expect.poll(() => a.evaluate(() => window.__qaSounds.includes('invalid'))).toBe(true);
  await grant(a, 'hint');
  await a.locator('[data-item-id="hint"]').click();
  const hinted = await a.locator('#board .tile.hinted').evaluateAll((nodes) => nodes.map((node) => node.dataset.tileId));
  await a.locator(`#board [data-tile-id="${hinted[0]}"]`).click();
  await a.locator(`#board [data-tile-id="${hinted[1]}"]`).click();
  await expect.poll(() => a.evaluate(() => ['select', 'hint', 'match', 'invalid'].every((name) => window.__qaSounds.includes(name)))).toBe(true);

  await grant(b, 'shield');
  await b.locator('[data-item-id="shield"]').click();
  await expect(b.locator('#board-frame')).toHaveClass(/shield/);
  await b.screenshot({ path: 'tests/screenshots/qa-item-audio-polish-shield-glow.png', fullPage: false });
  await grant(a, 'lock');
  await a.locator('[data-item-id="lock"]').click();
  await expect(b.locator('#board-frame')).not.toHaveClass(/(?:^|\s)shield(?:\s|$)/);
  await expect.poll(() => b.evaluate(() => ['item', 'blocked'].every((name) => window.__qaSounds.includes(name)))).toBe(true);
  await expect.poll(() => a.evaluate(() => ['attack', 'hint', 'select', 'match', 'invalid'].every((name) => window.__qaSounds.includes(name)))).toBe(true);
  await expect.poll(() => a.evaluate(() => window.__sichuanTestSnapshot().opponent.shieldActive)).toBe(false);

  await a.locator('#audio-button').click();
  await expect(a.locator('#audio-button')).toHaveAttribute('aria-pressed', 'true');
  expect(await a.evaluate(() => localStorage.getItem('sichuan:muted'))).toBe('1');
  const restored = await aContext.newPage();
  await restored.goto(`${BASE}/sichuan-battle/?name=MuteRestore&e2e=1`);
  await expect(restored.locator('#audio-button')).toHaveAttribute('aria-pressed', 'true');
  await aContext.close(); await bContext.close();
});
