/**
 * @fileoverview 리포트 32의 아이템 규칙과 모바일 전투 화면 배치를 회귀 검증한다.
 */

import { test, expect } from '@playwright/test';

/**
 * 대기 화면을 숨기고 전투 화면을 표시한다.
 * @param {import('@playwright/test').Page} page Playwright 페이지
 * @returns {Promise<void>}
 */
async function showGame(page) {
  await page.goto('/');
  await page.evaluate(() => {
    document.querySelector('.screen-waiting')?.classList.add('hidden');
    document.querySelector('.game-main')?.classList.remove('hidden');
  });
}

/**
 * 두 사각형의 겹치는 면적을 계산한다.
 * @param {DOMRect} first 첫 번째 영역
 * @param {DOMRect} second 두 번째 영역
 * @returns {number} 겹치는 면적
 */
function overlapArea(first, second) {
  const firstRight = first.x + first.width;
  const secondRight = second.x + second.width;
  const firstBottom = first.y + first.height;
  const secondBottom = second.y + second.height;
  const width = Math.max(0, Math.min(firstRight, secondRight) - Math.max(first.x, second.x));
  const height = Math.max(0, Math.min(firstBottom, secondBottom) - Math.max(first.y, second.y));
  return width * height;
}

test('390x844에서 아이템과 상대 미니맵이 화면 안에서 보드 조작 영역을 가리지 않는다', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await showGame(page);

  const selectors = {
    board: '#board-canvas',
    items: '.items-block',
    next: '.side-panel.narrow',
    opponent: '.player-area.opponent',
  };
  const boxes = {};
  for (const [name, selector] of Object.entries(selectors)) {
    boxes[name] = await page.locator(selector).boundingBox();
    expect(boxes[name], `${name} 영역이 표시되어야 한다`).not.toBeNull();
    expect(boxes[name].x, `${name} 왼쪽 경계`).toBeGreaterThanOrEqual(0);
    expect(boxes[name].x + boxes[name].width, `${name} 오른쪽 경계`).toBeLessThanOrEqual(390);
    expect(boxes[name].y, `${name} 위쪽 경계`).toBeGreaterThanOrEqual(0);
    expect(boxes[name].y + boxes[name].height, `${name} 아래쪽 경계`).toBeLessThanOrEqual(844);
  }

  expect(overlapArea(boxes.board, boxes.items)).toBe(0);
  expect(overlapArea(boxes.board, boxes.next)).toBe(0);
  expect(overlapArea(boxes.board, boxes.opponent)).toBe(0);

  const rule = await page.locator('.item-rule').evaluate((element) => ({
    text: element.textContent.trim(),
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(rule.text).toBe('LINE CLEAR · 80%');
  expect(rule.scrollWidth).toBeLessThanOrEqual(rule.clientWidth);
});

test('1280x720 데스크톱의 기존 가로 배치를 유지한다', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await showGame(page);

  const layout = await page.evaluate(() => {
    const rectangle = (selector) => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width };
    };
    return {
      gameDirection: getComputedStyle(document.querySelector('.game-main')).flexDirection,
      sideWidth: rectangle('.player-area.me > .side-panel').width,
      board: rectangle('#board-canvas'),
      opponent: rectangle('.player-area.opponent'),
    };
  });

  expect(layout.gameDirection).toBe('row');
  expect(layout.sideWidth).toBe(120);
  expect(layout.board.right).toBeLessThan(layout.opponent.left);
});
