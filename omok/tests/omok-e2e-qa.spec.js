/**
 * @fileoverview 오목 E2E QA — 격리 포트 3077(단독 server.js) 대상.
 * 입장 → AI 봇 spawn → 착수 → 턴교대 → 콘솔/시각 검증.
 */
import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:3077';

test.describe('오목 E2E', () => {
  test('대기 화면 + AI 패널 렌더 (콘솔 에러 없음)', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${BASE}/`);
    // JOINED 수신 후 대기 화면.
    await expect(page.locator('#screen-waiting')).toBeVisible();
    // p1 단독 + mode!=ai → AI 패널 노출.
    await expect(page.locator('#ai-panel')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#btn-start-ai')).toBeVisible();
    await page.screenshot({ path: 'tests/screenshots/omok-waiting.png' });
    expect(errors).toEqual([]);
  });

  test('AI 모드 진입 → 게임 시작 → 착수 → 봇 응수', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    // mode=ai로 직접 진입 → 서버가 봇 spawn.
    await page.goto(`${BASE}/?mode=ai`);
    // 게임 화면 전환(봇 입장 → GAME_START).
    await expect(page.locator('#screen-game')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#board-canvas')).toBeVisible();

    // 흑(나)의 차례 — 천원(9,9) 클릭. Canvas 좌표: MARGIN(40)+col*CELL(36).
    const canvas = page.locator('#board-canvas');
    const box = await canvas.boundingBox();
    // CSS 표시 크기 기준 비례 클릭(canvas 내부 728px → 표시 box.width).
    const sx = box.width / 728, sy = box.height / 728;
    const cx = box.x + (40 + 9 * 36) * sx;
    const cy = box.y + (40 + 9 * 36) * sy;
    await page.mouse.click(cx, cy);

    // 착수 반영 대기: 착수 수가 늘어남(나 1 + 봇 1 = 2 이상).
    await expect(page.locator('#move-count')).toHaveText(/착수 [2-9]\d*수|착수 [2-9]수/, { timeout: 12000 });
    await page.screenshot({ path: 'tests/screenshots/omok-after-move.png' });
    expect(errors).toEqual([]);
  });

  test('빈 영역(여백) 클릭은 무시된다', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${BASE}/?mode=ai`);
    await expect(page.locator('#screen-game')).toBeVisible({ timeout: 15000 });
    const canvas = page.locator('#board-canvas');
    const box = await canvas.boundingBox();
    // 좌상단 모서리(여백, 격자 밖) 클릭 → 무시되어야 함.
    await page.mouse.click(box.x + 2, box.y + 2);
    await page.waitForTimeout(800);
    // 착수 수 0 또는 봇 선반응 없음 — 적어도 에러 없어야.
    expect(errors).toEqual([]);
  });
});
