/**
 * @fileoverview 베네치아 조작·현지화·런처 게이트 독립 QA.
 */

import { test, expect } from '@playwright/test';

test('런처 닉네임 게이트를 통과하면 베네치아 카드가 표시된다', async ({ page }) => {
  await page.goto('http://localhost:3000/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.locator('#nickname-input').fill('독립QA');
  await page.locator('#btn-enter-lobby').click();
  const card = page.locator('[data-game-id="venezia"]');
  await expect(card).toBeVisible();
  await expect(card).toContainText('베네치아 타이핑 배틀');
  await expect(card).toContainText('/venezia/');
});

test('수정키·IME·편집 요소 정책과 ko/en 급류 문구가 일치한다', async ({ page }) => {
  await page.goto('http://localhost:3000/venezia/');
  const result = await page.evaluate(async () => {
    const controls = await import('/venezia/js/item-controls.js');
    const i18n = await import('/venezia/js/i18n.js');
    const input = document.getElementById('input-word');
    const editor = document.createElement('div');
    editor.contentEditable = 'true';
    document.body.appendChild(editor);
    const event = (overrides = {}) => ({
      code: 'Digit1', key: '1', keyCode: 0,
      isComposing: false, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false,
      target: input, ...overrides,
    });
    const policy = {
      digit1: controls.getItemSlotIndex(event()),
      digit2: controls.getItemSlotIndex(event({ code: 'Digit2', key: '2' })),
      digit3: controls.getItemSlotIndex(event({ code: 'Digit3', key: '3' })),
      numpad1: controls.getItemSlotIndex(event({ code: 'Numpad1', key: '1' })),
      numpad2: controls.getItemSlotIndex(event({ code: 'Numpad2', key: '2' })),
      numpad3: controls.getItemSlotIndex(event({ code: 'Numpad3', key: '3' })),
      alt: controls.getItemSlotIndex(event({ altKey: true })),
      ctrl: controls.getItemSlotIndex(event({ ctrlKey: true })),
      meta: controls.getItemSlotIndex(event({ metaKey: true })),
      shift: controls.getItemSlotIndex(event({ shiftKey: true })),
      composing: controls.getItemSlotIndex(event({ isComposing: true })),
      process: controls.getItemSlotIndex(event({ key: 'Process' })),
      keyCode229: controls.getItemSlotIndex(event({ keyCode: 229 })),
      editable: controls.getItemSlotIndex(event({ target: editor })),
    };
    const ko = {
      item: i18n.getItemPresentation('item_freeze'),
      overlay: i18n.t('fastFallStart'),
    };
    document.documentElement.lang = 'en';
    const en = {
      item: i18n.getItemPresentation('item_freeze'),
      overlay: i18n.t('fastFallStart'),
    };
    editor.remove();
    return { policy, ko, en };
  });

  expect(result.policy).toEqual({
    digit1: 0, digit2: 1, digit3: 2,
    numpad1: 0, numpad2: 1, numpad3: 2,
    alt: null, ctrl: null, meta: null, shift: null,
    composing: null, process: null, keyCode229: null, editable: null,
  });
  expect(result.ko).toEqual({ item: { emoji: '🌊', name: '급류' }, overlay: '🌊 급류! 낙하 속도 2배' });
  expect(result.en).toEqual({ item: { emoji: '🌊', name: 'Rapids' }, overlay: '🌊 Rapids! Fall speed ×2' });
});
