/**
 * @fileoverview 실제 Chromium 이벤트 시스템에서 프리즈 아이템 입력과 5회 재대결을 검증한다.
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.TETRIS_TEST_URL || 'http://127.0.0.1:3066';

test('프리즈 중 아이템 사용과 5회 재대결 후 키 입력이 정상 동작한다', async ({ page }) => {
  await page.goto(BASE_URL);

  const result = await page.evaluate(async () => {
    const { createInput } = await import('/js/input.js');
    const { createItems } = await import('/js/items.js');
    const calls = { left: 0, rotate: 0, sent: [], frozen: [], feedback: [] };
    let items;
    const input = createInput({
      moveLeft: () => { calls.left++; },
      moveRight() {},
      softDrop() {},
      rotateCW: () => { calls.rotate++; },
      rotateCCW() {},
      hardDrop() {},
      hold() {},
      useItem: (slot) => items.useItem(slot),
    });
    items = createItems({
      input,
      game: {
        setFrozenByItem: (value) => calls.frozen.push(value),
        clearBottomLines() {},
        receiveGarbageImmediate() {},
      },
      net: { sendItemUse: (itemId, slotIndex) => calls.sent.push({ itemId, slotIndex }) },
      ui: {
        renderItemSlots() {},
        setDarkOverlay() {},
        setFreezeFeedback: (value) => calls.feedback.push(value),
        setShieldFrameActive() {},
        clearShieldFrame() {},
        flashShieldBlock() {},
        showBoardNotice() {},
        setOppShieldBadge() {},
        setStatus() {},
        shakeBoard() {},
      },
    });

    input.enable();
    items.grantItem('dark', 0);
    items.grantItem('shield', 1);
    items.applyEffect('freeze', 10_000);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', cancelable: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', repeat: true, cancelable: true }));
    items.useItem(1); // 실제 슬롯 클릭과 동일한 공개 경로

    const rematches = [];
    for (let round = 1; round <= 5; round++) {
      input.disable();
      items.reset();
      items.reset();
      input.enable();
      const before = calls.rotate;
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', cancelable: true }));
      rematches.push({ round, delta: calls.rotate - before, frozen: input.isFrozen() });
      if (round < 5) items.applyEffect('freeze', 10_000);
    }
    input.disable();
    items.reset();

    return {
      leftWhileFrozen: calls.left,
      sent: calls.sent,
      rematches,
      finalInputFrozen: input.isFrozen(),
      finalGameFrozen: calls.frozen.at(-1),
      finalFeedback: calls.feedback.at(-1),
    };
  });

  expect(result.leftWhileFrozen).toBe(0);
  expect(result.sent).toEqual([
    { itemId: 'dark', slotIndex: 0 },
    { itemId: 'shield', slotIndex: 1 },
  ]);
  expect(result.rematches).toEqual([
    { round: 1, delta: 1, frozen: false },
    { round: 2, delta: 1, frozen: false },
    { round: 3, delta: 1, frozen: false },
    { round: 4, delta: 1, frozen: false },
    { round: 5, delta: 1, frozen: false },
  ]);
  expect(result.finalInputFrozen).toBe(false);
  expect(result.finalGameFrozen).toBe(false);
  expect(result.finalFeedback).toBe(false);
});
