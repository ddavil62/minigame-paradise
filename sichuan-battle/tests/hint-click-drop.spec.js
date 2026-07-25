/**
 * @fileoverview 250ms 상태 동기화 사이에서도 자연형 힌트 슬롯 클릭이 유실되지 않는지 검증한다.
 */
import { expect, test } from '@playwright/test';

test('힌트 슬롯은 pointerdown과 STATE_SYNC 사이에도 같은 노드로 클릭된다', async ({ browser }) => {
  const firstContext = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const secondContext = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const first = await firstContext.newPage();
  const second = await secondContext.newPage();
  await Promise.all([
    first.goto('/?name=HintClickA&e2e=1'),
    second.goto('/?name=HintClickB&e2e=1'),
  ]);
  await first.locator('#board .tile').first().waitFor();
  await first.waitForTimeout(3150);
  await first.evaluate(() => window.__sichuanTestSend({
    type: 'TEST_GRANT_ITEM',
    itemId: 'hint',
    slotId: 's-natural-hint',
  }));
  const slot = first.locator('[data-slot-id="s-natural-hint"]');
  await expect(slot).toHaveCount(1);
  const box = await slot.boundingBox();
  expect(box).not.toBeNull();
  await first.evaluate(() => {
    window.__heldHintSlot = document.querySelector('[data-slot-id="s-natural-hint"]');
  });

  await first.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await first.mouse.down();
  // 실제 서버 주기보다 길게 눌러 STATE_SYNC가 pointerup 전에 도착하게 한다.
  await first.waitForTimeout(350);
  expect(await first.evaluate(() => (
    window.__heldHintSlot === document.querySelector('[data-slot-id="s-natural-hint"]')
    && window.__heldHintSlot?.isConnected
  ))).toBe(true);
  await first.mouse.up();

  await expect(first.locator('[data-slot-id="s-natural-hint"]')).toHaveCount(0);
  await expect(first.locator('#hint-banner')).toBeVisible();
  await expect(first.locator('#board .tile.hinted')).toHaveCount(2);
  await expect(first.locator('#inventory')).not.toContainText('사용 중');

  await first.evaluate(() => window.__sichuanTestSend({ type: 'LEAVE_MATCH' }));
  await second.waitForTimeout(250);
  await second.evaluate(() => window.__sichuanTestSend({ type: 'LEAVE_MATCH' }));
  await Promise.all([firstContext.close(), secondContext.close()]);
});
