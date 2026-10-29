/**
 * @fileoverview 마작 UI 회귀 테스트(Playwright). 격리 포트에서 실제 서버를 띄워 화면 흐름을 확인한다.
 */
import http from 'node:http';
import { test, expect } from '@playwright/test';
import { createApp } from '../server.js';

const FAST = {
  baseMs: 8000, bankMs: 8000, reactionMs: 4000, ackMs: 4000,
  aiTurnMs: [20, 60], aiReactionMs: [10, 40], aiAckMs: [20, 60], awayMs: 5, riichiAutoMs: 50,
};

let app;
let server;
let base;

test.beforeEach(async () => {
  app = createApp({ timing: FAST });
  server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.afterEach(async () => {
  app.close();
  await new Promise((r) => server.close(r));
});

test('방 설정 → 시작 → 손패 13장 + 쯔모패, 상대 손패는 뒷면', async ({ page }) => {
  await page.goto(`${base}/?name=테스터`);
  await expect(page.locator('.setup h2')).toContainText('마작 방 설정');
  await expect(page.locator('.seat')).toHaveCount(4);
  await page.locator('[data-cfg="length"][data-val="half"]').click();
  await expect(page.locator('.mini-table')).toContainText('반장전');
  await page.locator('[data-do="start"]').click();
  await expect(page.locator('.board')).toBeVisible();
  await expect(page.locator('.plate')).toHaveCount(4);
  // 호스트는 좌석 0(첫 친)이라 13장 + 쯔모패 1장으로 시작한다.
  await expect(page.locator('.my-hand .tile.hand')).toHaveCount(14);
  expect(await page.locator('.top-hand .tile.back').count()).toBeGreaterThanOrEqual(13);
});

test('패를 한 번 누르면 선택, 두 번 누르면 버려진다', async ({ page }) => {
  await page.goto(`${base}/?name=테스터`);
  await page.locator('[data-do="start"]').click();
  const hand = page.locator('.my-hand.can .tile.hand');
  await expect(hand.first()).toBeVisible();
  const before = await page.locator('.pond').first().locator('.tile, .rot').count();
  const tile = page.locator('.my-hand .tile.hand').nth(2);
  await tile.click();
  await expect(page.locator('.my-hand .tile.lift')).toHaveCount(1);
  await page.locator('.my-hand .tile.lift').click();
  await expect(page.locator('.my-hand .tile.lift')).toHaveCount(0);
  await expect.poll(async () => page.locator('.layer.s0 .pond').locator('.tile, .rot').count()).toBeGreaterThan(before);
});

test('도우미와 한글 패 이름 토글', async ({ page }) => {
  await page.goto(`${base}/?name=테스터`);
  await page.locator('[data-do="start"]').click();
  await expect(page.locator('.my-hand .tile.hand').first()).toBeVisible();
  await expect(page.locator('.my-hand .cap')).toHaveCount(0);
  await page.locator('#btn-names').click();
  await expect(page.locator('.my-hand .cap').first()).toBeVisible();
  await page.locator('#btn-assist').click();
  await expect(page.locator('#btn-assist')).toHaveClass(/on/);
});

test('자동 진행으로 대국 종료 화면까지 도달한다', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto(`${base}/?name=테스터&auto=1`);
  await page.locator('[data-do="start"]').click();
  await expect(page.locator('.rank-list')).toBeVisible({ timeout: 110000 });
  await expect(page.locator('.rank-row')).toHaveCount(4);
  await expect(page.locator('[data-do="rematch"]')).toBeVisible();
  await page.locator('[data-do="rematch"]').click();
  await expect(page.locator('.setup h2')).toContainText('마작 방 설정');
});

test('두 번째 사람이 들어오면 마주 보는 자리에 앉는다', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  await a.goto(`${base}/?name=나`);
  await b.goto(`${base}/?name=도윤`);
  await expect(a.locator('.seat.s-t')).toContainText('도윤');
  await expect(b.locator('.seat.s-b')).toContainText('도윤');
  await expect(b.locator('.seat.s-t')).toContainText('나');
  await expect(b.locator('.waiting-note')).toContainText('방장');
  await a.locator('[data-do="start"]').click();
  await expect(b.locator('.board')).toBeVisible();
  await expect(a.locator('.plate.p-top')).toContainText('도윤');
});

test('룰 가이드: 헤더 버튼으로 열고 탭 전환, Esc로 닫는다. 대국 중 재렌더에도 유지된다', async ({ page }) => {
  await page.goto(`${base}/?name=테스터`);
  const guide = page.locator('.guide');
  await expect(guide).toHaveCount(0);
  await page.locator('#btn-guide').click();
  await expect(guide).toBeVisible();
  await expect(page.locator('#btn-guide')).toHaveClass(/on/);
  await expect(page.locator('.g-pane.on')).toHaveAttribute('data-pane', 'flow');
  // 패 그림이 실제 렌더러로 그려진다.
  expect(await page.locator('.guide .goal .tile').count()).toBe(14);
  await page.locator('.g-tab[data-tab="score"]').click();
  await expect(page.locator('.g-pane.on')).toHaveAttribute('data-pane', 'score');
  await page.locator('.g-tab[data-tab="flow"]').click();
  await page.locator('.g-link[data-goto="yaku"]').click();
  await expect(page.locator('.g-pane.on')).toHaveAttribute('data-pane', 'yaku');
  await expect(page.locator('.guide .yk')).toHaveCount(8);

  await page.keyboard.press('Escape');
  await expect(guide).toHaveCount(0);

  // 대국 중에 열면 STATE 재렌더가 여러 번 일어나도 열린 상태와 탭이 유지된다.
  await page.locator('[data-do="start"]').click();
  await expect(page.locator('.board')).toBeVisible();
  await page.locator('#btn-guide').click();
  await page.locator('.g-tab[data-tab="yaku"]').click();
  await page.waitForTimeout(1200);
  await expect(guide).toBeVisible();
  await expect(page.locator('.g-pane.on')).toHaveAttribute('data-pane', 'yaku');

  await page.keyboard.press('Escape');
  await expect(guide).toHaveCount(0);
  await expect(page.locator('#btn-guide')).not.toHaveClass(/on/);
  // 다시 열고 배경을 눌러 닫는다.
  await page.locator('#btn-guide').click();
  await expect(guide).toBeVisible();
  await page.locator('#guide-layer').click({ position: { x: 5, y: 5 } });
  await expect(guide).toHaveCount(0);
});
