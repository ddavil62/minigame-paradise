/**
 * @fileoverview 후속 아이템 수정의 실제 PvP 힌트, 무기한 방어막, unknown 슬롯 UI를 검증한다.
 */
import { test, expect } from '@playwright/test';

/** @param {import('@playwright/test').Page} page 페이지 @param {string} itemId 아이템 ID @returns {Promise<void>} */
async function grant(page, itemId) {
  await page.evaluate((id) => window.__sichuanTestSend({ type: 'TEST_GRANT_ITEM', itemId: id }), itemId);
}

test('실제 인증 AI 경기 힌트는 본인 두 타일만 강하게 표시하고 3초 뒤 완전히 정리한다', async ({ browser }) => {
  const aContext = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const a = await aContext.newPage();
  await a.goto('/?name=FollowupA&e2e=1&mode=ai');
  await a.locator('#board .tile').first().waitFor(); await a.waitForTimeout(3_100);
  await grant(a, 'hint'); await a.locator('[data-item-id="hint"]').click();
  await expect(a.locator('#toast')).toContainText(/표시|highlight/i);
  await expect(a.locator('#board .tile.hinted')).toHaveCount(2);
  await expect(a.locator('#opponent-board .tile.hinted')).toHaveCount(0);
  const hint = await a.evaluate(() => window.__sichuanTestSnapshot().me.effects.find((effect) => effect.itemId === 'hint'));
  expect(hint.targets).toHaveLength(2); expect(hint.path.length).toBeGreaterThanOrEqual(2);
  const visual = await a.locator('#board .tile.hinted').first().evaluate((node) => {
    const style = getComputedStyle(node); const badge = getComputedStyle(node, '::before');
    return { outlineWidth: parseFloat(style.outlineWidth), badge: badge.content, opacity: badge.opacity };
  });
  expect(visual.outlineWidth).toBeGreaterThanOrEqual(3);
  expect(visual.badge).not.toBe('none'); expect(visual.opacity).not.toBe('0');
  await a.screenshot({ path: 'tests/screenshots/item-followup-hint-1024x768-en.png', fullPage: true });
  await a.waitForTimeout(750);
  await expect(a.locator('#board .tile.hinted')).toHaveCount(2);
  await expect(a.locator('#board .tile.hinted')).toHaveCount(0, { timeout: 4_000 });
  await aContext.close();
});

test('unknown 슬롯은 숨기고 방어막은 타이머 없는 1회 칩으로 표시한다', async ({ page }) => {
  await page.goto('/?name=FollowupShield&e2e=1&mode=ai');
  await page.locator('#board .tile').first().waitFor(); await page.waitForTimeout(3_100);
  await grant(page, 'shield'); await page.locator('[data-item-id="shield"]').click();
  await expect(page.locator('#my-effects .shield-chip')).toHaveCount(1);
  await expect(page.locator('#my-effects .shield-chip')).toContainText(/1회|1 hit/i);
  await expect(page.locator('#my-effects .shield-chip time')).toHaveCount(0);
  await page.evaluate(() => {
    const snapshot = window.__sichuanTestSnapshot();
    snapshot.me.inventory = [
      { slotId: 'legacy', itemId: 'force_shuffle' }, { slotId: 'banana', itemId: 'banana' },
      { slotId: 'valid', itemId: 'hint' },
    ];
    snapshot.me.effects.push({ effectId: 'bad', itemId: 'banana', endsAt: Date.now() + 10000 });
    window.__sichuanInjectMessage({ type: 'STATE_SYNC', snapshot, serverNow: Date.now() });
  });
  await expect(page.locator('#inventory .item-slot:not(.empty)')).toHaveCount(1);
  await expect(page.locator('[data-item-id="hint"]')).toHaveCount(1);
  await expect(page.locator('body')).not.toContainText(/undefined|force_shuffle|banana/i);
  await expect(page.locator('#my-effects [data-effect-id="bad"]')).toHaveCount(0);
});
