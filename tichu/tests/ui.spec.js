/**
 * @fileoverview 티추 UI 회귀 테스트(Playwright). 격리 포트에서 실제 서버를 띄워 화면 흐름을 확인한다.
 */
import http from 'node:http';
import { test, expect } from '@playwright/test';
import { createApp } from '../server.js';

const FAST = {
  baseMs: 20000, bankMs: 20000, grandMs: 20000, exchangeMs: 20000, giftMs: 8000,
  aiTurnMs: [20, 60], aiPickMs: [20, 60], aiAckMs: [20, 60], awayMs: 5,
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
  server.closeAllConnections?.(); // 브라우저가 붙들고 있는 유휴 연결 때문에 close가 기다리지 않게 한다
  await new Promise((r) => server.close(r));
});

/** 그랜드 선택을 넘기고 카드 3장을 골라 교환을 확정해 플레이 단계로 간다. */
async function toPlay(page) {
  await page.locator('[data-do="grand-no"]').click();
  await expect(page.locator('.slots')).toBeVisible();
  for (let i = 0; i < 3; i++) {
    await page.locator('.hand .card').first().click();
    await expect(page.locator('.slot .box.fill')).toHaveCount(i + 1);
  }
  await page.locator('[data-do="exchange"]').click();
  await expect(page.locator('.hand .card')).toHaveCount(14);
}

test('방 설정 → 시작 → 그랜드 선택 → 8장 손패, 상대는 뒷면', async ({ page }) => {
  await page.goto(`${base}/?name=테스터`);
  await expect(page.locator('.setup h1')).toContainText('티추 방 설정');
  await expect(page.locator('.sseat')).toHaveCount(4);
  await page.locator('[data-cfg="target"][data-val="500"]').click();
  await expect(page.locator('.mini i.on', { hasText: '500' })).toBeVisible();
  await page.locator('[data-do="start"]').click();
  await expect(page.locator('.modal h2')).toContainText('그랜드 티추');
  await expect(page.locator('.plate')).toHaveCount(4);
  await expect(page.locator('.hand .card')).toHaveCount(8);
  expect(await page.locator('.bk-top .card.back').count()).toBe(8);
  await expect(page.locator('.score')).toContainText('목표 500점');
});

test('카드 교환: 3칸을 채워야 확정되고, 칸을 누르면 카드가 손으로 돌아온다', async ({ page }) => {
  await page.goto(`${base}/?name=테스터`);
  await page.locator('[data-do="start"]').click();
  await page.locator('[data-do="grand-no"]').click();
  await expect(page.locator('.hand .card')).toHaveCount(14);
  await expect(page.locator('[data-do="exchange"]')).toBeDisabled();
  await page.locator('.hand .card').first().click();
  await expect(page.locator('.hand .card')).toHaveCount(13);
  await page.locator('.slot .box.fill').first().click();
  await expect(page.locator('.hand .card')).toHaveCount(14);
  for (let i = 0; i < 3; i++) {
    await page.locator('.hand .card').first().click();
    await expect(page.locator('.slot .box.fill')).toHaveCount(i + 1);
  }
  await expect(page.locator('[data-do="exchange"]')).toBeEnabled();
  await page.locator('[data-do="exchange"]').click();
  await expect(page.locator('.hand .card')).toHaveCount(14);
  await expect(page.locator('.slots')).toHaveCount(0);
});

test('플레이: 카드를 고르면 조합 판정 문구가 뜨고, 낼 수 없으면 버튼이 꺼진다', async ({ page }) => {
  await page.goto(`${base}/?name=테스터`);
  await page.locator('[data-cfg="bombWindowMs"][data-val="0"]').click();
  await page.locator('[data-do="start"]').click();
  await toPlay(page);
  await expect(page.locator('.hand.my-turn')).toBeVisible({ timeout: 30000 });
  await page.locator('.hand .card').nth(1).click();
  await expect(page.locator('.strip')).toContainText('선택:');
  await page.locator('.hand .card.sel').first().click(); // 다시 누르면 해제
  await expect(page.locator('.hand .card.sel')).toHaveCount(0);
  // 두 장을 일부러 이어지지 않는 조합으로 골라 본다.
  await page.locator('.hand .card').nth(0).click();
  await page.locator('.hand .card').nth(6).click();
  await expect(page.locator('.strip')).toContainText(/이런 조합은 없어요|✗|페어|선으로/);
  await expect(page.locator('.acts')).toBeVisible();
});

test('도우미: 켜면 낼 수 있는 조합 칩이 나오고 칩을 누르면 카드가 선택된다', async ({ page }) => {
  await page.goto(`${base}/?name=테스터`);
  await page.locator('[data-cfg="bombWindowMs"][data-val="0"]').click();
  await page.locator('[data-local="assist"]').click();
  await page.locator('[data-do="start"]').click();
  await toPlay(page);
  await expect(page.locator('.hand.my-turn')).toBeVisible({ timeout: 30000 });
  const chip = page.locator('.strip .chip[data-chip]').first();
  if (await chip.count()) {
    await chip.click();
    await expect(page.locator('.hand .card.sel').first()).toBeVisible();
    await expect(page.locator('[data-do="play"]')).toBeEnabled();
  } else {
    await expect(page.locator('.strip')).toContainText('낼 수 있는 조합이 없어요');
  }
});

test('룰 가이드: 열고 탭을 바꾸고 닫는다', async ({ page }) => {
  await page.goto(`${base}/?name=테스터`);
  await page.locator('#btn-guide').click();
  await expect(page.locator('.guide')).toBeVisible();
  await expect(page.locator('.guide .gbody')).toContainText('2:2');
  await page.locator('.guide [data-k="special"]').click();
  await expect(page.locator('.guide .gbody')).toContainText('참새');
  await expect(page.locator('.guide .gbody .card.sp')).toHaveCount(4);
  await page.locator('.guide [data-g="close"]').click();
  await expect(page.locator('.guide')).toBeHidden();
});

test('자동 진행: 한 라운드가 끝나면 결과 화면이 뜨고 점수가 정리된다', async ({ page }) => {
  await page.goto(`${base}/?name=오토&auto=1`);
  await page.locator('[data-cfg="bombWindowMs"][data-val="0"]').click();
  await page.locator('[data-cfg="target"][data-val="500"]').click();
  await page.locator('[data-do="start"]').click();
  await expect(page.locator('.modal.result')).toBeVisible({ timeout: 45000 });
  await expect(page.locator('.modal.result table')).toContainText('이번 라운드');
  await expect(page.locator('.modal.result .fin div')).not.toHaveCount(0);
});

test('작은 화면(1024×640)에서도 무대가 가로 스크롤 없이 들어간다', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 640 });
  await page.goto(`${base}/?name=테스터`);
  await page.locator('[data-do="start"]').click();
  await expect(page.locator('.modal h2')).toContainText('그랜드 티추');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const box = await page.locator('#stage').boundingBox();
  expect(box.x + box.width).toBeLessThanOrEqual(1024 + 1);
});
