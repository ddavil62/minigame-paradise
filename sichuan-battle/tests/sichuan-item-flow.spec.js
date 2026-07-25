/**
 * @fileoverview 연속 아이템 사용, 힌트 시각 효과와 반응형 패널 순서를 실제 브라우저에서 검증한다.
 */
import { test, expect } from '@playwright/test';

/** @param {import('@playwright/test').Page} page 아이템을 받을 페이지 @param {string} itemId 아이템 ID @returns {Promise<void>} */
async function grant(page, itemId) {
  await page.evaluate((id) => window.__sichuanTestSend({ type: 'TEST_GRANT_ITEM', itemId: id }), itemId);
}

test('서로 다른 세 아이템을 다음 동기화 전에 연속 입력해 모두 한 번씩 사용한다', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await context.newPage(); await page.goto('/?name=FlowA&e2e=1&mode=ai');
  await page.locator('#board .tile').first().waitFor(); await page.waitForTimeout(3200);
  for (const itemId of ['lock', 'flip', 'fog']) await grant(page, itemId);
  await expect(page.locator('#inventory .item-slot:not(.empty)')).toHaveCount(3);
  await page.locator('#inventory').evaluate((root) => [...root.querySelectorAll('.item-slot:not(.empty)')].forEach((button) => button.click()));
  await expect(page.locator('#inventory .item-slot:not(.empty)')).toHaveCount(0);
  await expect(page.locator('#opponent-effects .effect-chip')).toHaveCount(3);
  await expect(page.locator('#opponent-board .tile.locked')).toHaveCount(6);
  await expect(page.locator('#opponent-board .tile.flipped')).toHaveCount(16);
  await expect(page.locator('#opponent-board .tile.fogged')).toHaveCount(18);
  await context.close();
});

test('힌트 사용 시 본인 보드의 연결 가능한 같은 문양 두 타일만 강조한다', async ({ browser }) => {
  const aContext = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const bContext = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const a = await aContext.newPage(); const b = await bContext.newPage();
  await Promise.all([a.goto('/?name=HintA&e2e=1'), b.goto('/?name=HintB&e2e=1')]);
  await a.locator('#board .tile').first().waitFor(); await a.waitForTimeout(3200);
  await grant(a, 'hint'); await a.locator('[data-item-id="hint"]').click();
  await expect(a.locator('#board .tile.hinted')).toHaveCount(2);
  const faces = await a.locator('#board .tile.hinted').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')));
  expect(faces[0]).toBe(faces[1]);
  await expect(b.locator('#opponent-board .tile.hinted')).toHaveCount(0);
  await aContext.close(); await bContext.close();
});

for (const width of [1366, 1024]) {
  test(`${width}×768에서 아이템·내 보드·상대 보드 순서를 유지한다`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height: 768 } });
    const page = await context.newPage(); await page.goto('/?name=Layout&e2e=1&mode=ai');
    await page.locator('#board .tile').first().waitFor();
    const boxes = await page.evaluate(() => ({ items: document.querySelector('.item-panel').getBoundingClientRect(), board: document.querySelector('.board-column').getBoundingClientRect(), opponent: document.querySelector('.opponent-panel').getBoundingClientRect(), scrollWidth: document.documentElement.scrollWidth }));
    expect(boxes.items.right).toBeLessThanOrEqual(boxes.board.left + 1);
    expect(boxes.board.right).toBeLessThanOrEqual(boxes.opponent.left + 1);
    expect(boxes.scrollWidth).toBeLessThanOrEqual(width);
    await context.close();
  });
}

test('390×844에서 내 보드·아이템·상대 보드 순서와 가로 폭을 유지한다', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage(); await page.goto('/?name=MobileFlow&e2e=1&mode=ai');
  await page.locator('#board .tile').first().waitFor();
  const boxes = await page.evaluate(() => ({ board: document.querySelector('.board-column').getBoundingClientRect(), items: document.querySelector('.item-panel').getBoundingClientRect(), opponent: document.querySelector('.opponent-panel').getBoundingClientRect(), scrollWidth: document.documentElement.scrollWidth }));
  expect(boxes.board.bottom).toBeLessThanOrEqual(boxes.items.top + 1);
  expect(boxes.items.bottom).toBeLessThanOrEqual(boxes.opponent.top + 1);
  expect(boxes.scrollWidth).toBeLessThanOrEqual(390);
  await context.close();
});
