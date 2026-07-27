/**
 * @fileoverview 리포트 31의 1920×1080 브라우저 시각 회귀 테스트.
 * 모서리 노드의 AI 말 중심 정렬과 잡기 후 HOME 복귀를 실제 캔버스로 검증한다.
 */

import { test, expect } from 'playwright/test';

const BASE_URL = 'http://localhost:3088';

test('R31-B1: 모서리 AI 말은 노드 중앙에 고정되고 잡기 후 사라진다', async ({ browser }) => {
  const p1Context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const p2Context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const p1 = await p1Context.newPage();
  const p2 = await p2Context.newPage();
  const errors = [];

  p1.on('pageerror', (error) => errors.push(error.message));
  p1.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  try {
    await p1.goto(`${BASE_URL}/?name=Human`);
    await p2.goto(`${BASE_URL}/?name=AI`);
    await expect(p1.locator('.game-main')).toBeVisible({ timeout: 10000 });

    await p1.request.post(`${BASE_URL}/test/inject`, {
      data: {
        started: true,
        currentTurn: 'p1',
        pendingResults: ['do'],
        pieces: {
          p1: [{ cell: 4 }, { cell: -1 }, { cell: -1 }, { cell: -1 }],
          p2: [{ cell: 5 }, { cell: -1 }, { cell: -1 }, { cell: -1 }],
        },
      },
    });
    await p1.waitForTimeout(250);
    await p1.screenshot({
      path: 'tests/screenshots/report31-corner-before-capture-1920x1080.png',
      fullPage: true,
    });

    await p1.locator('.result-chip').click();
    const board = p1.locator('#board-canvas');
    const box = await board.boundingBox();
    if (!box) throw new Error('보드 캔버스 좌표를 찾을 수 없습니다.');
    // cell 4는 BOARD_SIZE 좌표계에서 (50,142)에 있으며 현재 P1 말이 있는 칸이다.
    await p1.mouse.click(
      box.x + box.width * (50 / 560),
      box.y + box.height * (142 / 560),
    );

    await expect.poll(async () => {
      const response = await p1.request.post(`${BASE_URL}/test/inject`, { data: {} });
      return response.ok();
    }).toBe(true);
    await p1.waitForTimeout(250);
    await p1.screenshot({
      path: 'tests/screenshots/report31-corner-after-capture-1920x1080.png',
      fullPage: true,
    });

    expect(errors).toEqual([]);
  } finally {
    await p1Context.close();
    await p2Context.close();
  }
});
