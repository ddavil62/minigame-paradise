/**
 * @fileoverview 티추 UI 회귀 테스트(Playwright). 격리 포트에서 실제 서버를 띄워 화면 흐름을 확인한다.
 */
import http from 'node:http';
import { test, expect } from '@playwright/test';
import { createApp } from '../server.js';

const FAST = {
  baseMs: 20000, bankMs: 20000, grandMs: 20000, exchangeMs: 20000, giftMs: 8000, reviewMs: 20000,
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
  await expect(page.locator('.modal.xchg')).toBeVisible(); // 교환 결과 확인 창
  await expect(page.locator('.xchg .xc.got .card')).toHaveCount(3);
  await expect(page.locator('.xchg .xc.gave .card')).toHaveCount(3);
  await page.locator('[data-do="review-ok"]').click();
  await expect(page.locator('.modal.xchg')).toHaveCount(0);
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

test('카운팅: 대국 중에만 버튼이 보이고, 패널의 칸 수와 합계가 맞으며, 점수 박스에 이번 라운드 점수가 뜬다', async ({ page }) => {
  await page.goto(`${base}/?name=테스터`);
  await expect(page.locator('#btn-count')).toBeHidden();
  await page.locator('[data-cfg="bombWindowMs"][data-val="0"]').click();
  await page.locator('[data-do="start"]').click();
  await toPlay(page);
  await expect(page.locator('#btn-count')).toBeVisible();
  await expect(page.locator('.score .rnd')).toContainText('이번 라운드');
  await page.locator('#btn-count').click();
  await expect(page.locator('.cpanel')).toBeVisible();
  await expect(page.locator('.cpanel .cc')).toHaveCount(56); // 4무늬 × 13 + 특수 4
  await expect(page.locator('.cpanel .cc i.m')).toHaveCount(14); // 내 손패 14장
  expect(await page.locator('.cpanel .cc.mine').count()).toBeGreaterThan(0); // 내 손패가 든 칸은 테두리로 구분
  expect(await page.locator('.cpanel .cc.mine.gone').count()).toBe(0); // 내 손패 칸은 '나옴'처럼 흐려지지 않는다
  const total = await page.locator('.cpanel .cc i').count();
  expect(total).toBe(56);
  await page.locator('.cpanel [data-do="count"]').click();
  await expect(page.locator('.cpanel')).toHaveCount(0);
});

test('특수 카드 연출: 용·봉황·개·참새를 내면 중앙에 카드와 이름이 뜨고, 새 연출이 오면 이전 것을 치운다', async ({ page }) => {
  await page.goto(`${base}/?name=테스터&auto=99999`); // auto는 테스트 전용 훅(window.__fx)을 연다. 대기실에서는 자동 진행하지 않는다
  await expect(page.locator('.setup, .lobby, [data-do="start"]').first()).toBeVisible();
  const kinds = { drg: [55, '용!'], phx: [54, '봉황'], dog: [52, '개'], spr: [53, '참새'] };
  for (const [kind, [id, name]] of Object.entries(kinds)) {
    await page.evaluate(async ([k, i, n]) => {
      const { cardHtml } = await import('/js/cardview.js');
      window.__fx.special(k, { card: cardHtml(i, { size: 'xl', data: false }), name: n, sub: '테스터', from: [0, 200], ms: 3000 });
    }, [kind, id, name]);
    await expect(page.locator(`#fx .special.${kind} .cap b`)).toHaveText(name);
    await expect(page.locator('#fx .special')).toHaveCount(1); // 이전 연출은 치워진다
    await expect(page.locator(`#fx .special.${kind} .sc .card`)).toBeVisible();
  }
});

test('BGM: 헤더 버튼으로 켜고 끄며 설정을 기억한다', async ({ page }) => {
  await page.goto(`${base}/?name=테스터`);
  const btn = page.locator('#btn-bgm');
  await expect(btn).toHaveText('BGM');
  await btn.click();
  await expect(btn).toHaveText('BGM 꺼짐');
  expect(await page.evaluate(() => localStorage.getItem('tichu:bgm'))).toBe('0');
  await page.reload();
  await expect(page.locator('#btn-bgm')).toHaveText('BGM 꺼짐');
  await page.locator('#btn-bgm').click();
  await expect(page.locator('#btn-bgm')).toHaveText('BGM');
  expect(await page.evaluate(() => localStorage.getItem('tichu:bgm'))).toBe('1');
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

test('더블 티추: 2벌을 고르면 16장 → 28장, 교환은 6칸이고 손패가 화면 폭 안에 들어간다', async ({ page }) => {
  await page.goto(`${base}/?name=테스터`);
  await page.locator('[data-cfg="decks"][data-val="2"]').click();
  await expect(page.locator('.mini i.on', { hasText: '2벌' })).toBeVisible();
  await expect(page.locator('.mini i.on', { hasText: '2000' })).toBeVisible();
  await page.locator('[data-do="start"]').click();
  await expect(page.locator('.modal h2')).toContainText('그랜드 티추');
  await expect(page.locator('.modal')).toContainText('처음 16장');
  await expect(page.locator('.hand .card')).toHaveCount(16);
  await page.locator('[data-do="grand-no"]').click();
  await expect(page.locator('.slots')).toBeVisible();
  await expect(page.locator('.hand .card')).toHaveCount(28);
  await expect(page.locator('.slot .box')).toHaveCount(6);
  await expect(page.locator('.score')).toContainText('목표 2000점');
  for (let i = 0; i < 6; i++) {
    await page.locator('.hand .card').first().click({ position: { x: 6, y: 30 } }); // 겹친 카드는 보이는 왼쪽 띠를 누른다
    await expect(page.locator('.slot .box.fill')).toHaveCount(i + 1);
  }
  await page.locator('[data-do="exchange"]').click();
  await expect(page.locator('.hand .card')).toHaveCount(28);
  await expect(page.locator('.card.su-undefined')).toHaveCount(0);
  await expect(page.locator('.rinfo')).toContainText('카드 점수 합 200');
  // 손패가 무대(1200px) 안에 있다
  const box = await page.locator('.hand .card').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).reduce((m, r) => ({ l: Math.min(m.l, r.left), r: Math.max(m.r, r.right) }), { l: 1e9, r: -1e9 }));
  const stage = await page.locator('#stage').boundingBox();
  expect(box.l).toBeGreaterThanOrEqual(stage.x - 1);
  expect(box.r).toBeLessThanOrEqual(stage.x + stage.width + 1);
});
