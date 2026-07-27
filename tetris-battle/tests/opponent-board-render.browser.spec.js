/**
 * @fileoverview 상대 보드가 실제 셀 종류와 가비지 구멍을 렌더하는지 검증한다.
 */

import { test, expect } from '@playwright/test';

const RULE_VIEWPORTS = [
  { width: 1280, height: 720 },
  { width: 1024, height: 576 },
];

test('상대 미니맵이 가비지 구멍과 일반 블록을 실제 셀대로 그린다', async ({ page }) => {
  await page.goto('/');

  const pixels = await page.evaluate(async () => {
    const { createUI, MINIMAP_CELL } = await import('/js/ui.js');
    const { BOARD_HEIGHT, BOARD_WIDTH } = await import('/js/board.js');
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
      statusEl: byId('status'),
      resultOverlay: byId('result-overlay'),
      resultText: byId('result-text'),
    });
    const cells = Array.from({ length: BOARD_HEIGHT }, () => Array(BOARD_WIDTH).fill(0));
    cells[BOARD_HEIGHT - 1] = Array(BOARD_WIDTH).fill(8);
    cells[BOARD_HEIGHT - 1][4] = 0;
    cells[BOARD_HEIGHT - 2][2] = 3;
    ui.renderOpponent({ height: 2, stack: [], cells });

    const ctx = byId('opponent-canvas').getContext('2d');
    const sample = (column, visibleRow) => Array.from(ctx.getImageData(
      column * MINIMAP_CELL + Math.floor(MINIMAP_CELL / 2),
      visibleRow * MINIMAP_CELL + Math.floor(MINIMAP_CELL / 2),
      1,
      1,
    ).data);
    return {
      hole: sample(4, 19),
      garbage: sample(3, 19),
      normal: sample(2, 18),
    };
  });

  expect(pixels.hole).not.toEqual(pixels.garbage);
  expect(pixels.normal).not.toEqual(pixels.garbage);
  expect(pixels.hole).not.toEqual(pixels.normal);
});

test('아이템 지급 규칙이 데스크톱과 작은 화면의 102px 가용 폭을 넘지 않는다', async ({ page }) => {
  for (const viewport of RULE_VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await page.evaluate(() => {
      document.querySelector('.screen-waiting')?.classList.add('hidden');
      document.querySelector('.game-main')?.classList.remove('hidden');
    });

    const layout = await page.locator('.item-rule').evaluate((rule) => {
      const panel = rule.closest('.items-block');
      const ruleRect = rule.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
      return {
        text: rule.textContent.trim(),
        clientWidth: rule.clientWidth,
        scrollWidth: rule.scrollWidth,
        rightOverflow: Math.max(0, ruleRect.right - panelRect.right),
        color: getComputedStyle(rule).color,
        accent,
      };
    });

    expect(layout.text).toBe('LINE CLEAR · 80%');
    expect(layout.clientWidth).toBe(102);
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
    expect(layout.rightOverflow).toBe(0);
    expect(layout.color).toBe('rgb(0, 240, 240)');
    expect(layout.accent).toBe('#00f0f0');
  }
});
