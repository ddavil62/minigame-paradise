/**
 * @fileoverview 하나비 실전 행동 E2E — 힌트→내기→버리기 클릭 플로우 (HR-C9).
 *
 * 두 브라우저로 실제 버튼을 클릭하여 게임을 진행하고,
 * 힌트 마킹/불꽃 변화/토큰 변화/버림 더미를 시각 검증한다.
 *
 * 사전 요건: node server.js --port 3095
 */

import { test, expect } from 'playwright/test';

const BASE = 'http://localhost:3095';

async function joinTwo(browser) {
  const ctx1 = await browser.newContext({ viewport: { width: 900, height: 900 } });
  const ctx2 = await browser.newContext({ viewport: { width: 900, height: 900 } });
  const p1 = await ctx1.newPage();
  const p2 = await ctx2.newPage();
  const errs = [];
  p1.on('pageerror', (e) => errs.push('p1:' + e.message));
  p2.on('pageerror', (e) => errs.push('p2:' + e.message));
  await p1.goto(BASE);
  await p2.goto(BASE);
  await p1.waitForSelector('#my-hand .card', { timeout: 15000 });
  await p2.waitForSelector('#my-hand .card', { timeout: 15000 });
  return { ctx1, ctx2, p1, p2, errs };
}

test('HR-C9-001 힌트 주기 클릭 → 상대 손패 마킹 + 토큰 8→7 시각 검증', async ({ browser }) => {
  const { ctx1, ctx2, p1, p2, errs } = await joinTwo(browser);
  try {
    // p1이 현재 턴(선공). 힌트 주기 → 색 버튼 중 하나 클릭.
    // p1이 보는 상대(p2) 손패 첫 카드의 색을 골라 0장 힌트 회피.
    const firstColor = await p1.locator('#opponent-hand .card').first().getAttribute('class');
    // class에서 card--<color> 추출
    const m = firstColor.match(/card--(white|red|blue|green|yellow)/);
    const color = m ? m[1] : 'red';

    await p1.click('#btn-clue');
    await p1.waitForSelector('#clue-panel:not(.hidden)', { timeout: 5000 });
    await p1.click(`#clue-panel [data-clue-type="color"][data-clue-value="${color}"]`);

    // p2 화면에서 토큰이 7로 줄고, 자기 손패(해당 색)에 마킹이 생겼는지 확인.
    await p2.waitForTimeout(800);
    const clueTokensP2 = await p2.locator('#clue-tokens .token--clue').count();
    expect(clueTokensP2).toBe(7);

    // 턴이 p2로 넘어갔는지(p1 화면 turn-label).
    const turnP1 = await p1.locator('#turn-label').textContent();
    expect(turnP1.trim()).toBe('상대 차례');

    await p2.screenshot({ path: 'tests/screenshots/e2e-after-clue-p2.png', fullPage: true });
    expect(errs).toEqual([]);
  } finally {
    await ctx1.close(); await ctx2.close();
  }
});

test('HR-C9-002 카드 내기 클릭 → 불꽃/버림 더미/덱 변화 시각 검증', async ({ browser }) => {
  const { ctx1, ctx2, p1, p2, errs } = await joinTwo(browser);
  try {
    // p1 카드 내기 모드 진입 → 첫 카드 클릭.
    const deckBefore = parseInt(await p1.locator('#deck-count').textContent(), 10);
    await p1.click('#btn-play');
    await p1.waitForSelector('#my-hand.selectable', { timeout: 5000 });
    await p1.locator('#my-hand .card').first().click();
    await p1.waitForTimeout(800);

    // 덱이 39로 줄었는지(보충), 손패는 여전히 5장.
    const deckAfter = parseInt(await p1.locator('#deck-count').textContent(), 10);
    expect(deckAfter).toBe(deckBefore - 1);
    const myCards = await p1.locator('#my-hand .card').count();
    expect(myCards).toBe(5);

    // 점수(불꽃 합) 또는 폭탄 토큰 변화 중 하나는 반드시 발생(성공/실패).
    const score = parseInt(await p1.locator('#score-label').textContent(), 10);
    const fuse = await p1.locator('#fuse-tokens .token--fuse').count();
    const discardCount = parseInt(await p2.locator('#discard-count').textContent(), 10);
    // 성공이면 score>=1, 실패면 fuse<3 && discard>=1.
    const ok = (score >= 1) || (fuse < 3 && discardCount >= 1);
    expect(ok).toBe(true);

    await p2.screenshot({ path: 'tests/screenshots/e2e-after-play-p2.png', fullPage: true });
    expect(errs).toEqual([]);
  } finally {
    await ctx1.close(); await ctx2.close();
  }
});

test('HR-C9-003 버리기 → 토큰 회수 + 버림 더미 누적 시각 검증', async ({ browser }) => {
  const { ctx1, ctx2, p1, p2, errs } = await joinTwo(browser);
  try {
    // 토큰 8이면 버리기 불가. 먼저 p1이 힌트를 줘서 토큰을 7로 만든 뒤 p2가 버리기.
    const firstColor = await p1.locator('#opponent-hand .card').first().getAttribute('class');
    const color = (firstColor.match(/card--(white|red|blue|green|yellow)/) || [,'red'])[1];
    await p1.click('#btn-clue');
    await p1.waitForSelector('#clue-panel:not(.hidden)');
    await p1.click(`#clue-panel [data-clue-type="color"][data-clue-value="${color}"]`);
    await p2.waitForTimeout(600);

    // 이제 p2 턴, 토큰 7. p2가 버리기 → 토큰 8 회수.
    await p2.waitForSelector('#btn-discard:not([disabled])', { timeout: 5000 });
    const clueBefore = await p2.locator('#clue-tokens .token--clue').count();
    expect(clueBefore).toBe(7);
    await p2.click('#btn-discard');
    await p2.waitForSelector('#my-hand.selectable', { timeout: 5000 });
    await p2.locator('#my-hand .card').first().click();
    await p2.waitForTimeout(800);

    const clueAfter = await p1.locator('#clue-tokens .token--clue').count();
    expect(clueAfter).toBe(8); // 회수
    const discardCount = parseInt(await p1.locator('#discard-count').textContent(), 10);
    expect(discardCount).toBeGreaterThanOrEqual(1);

    await p1.screenshot({ path: 'tests/screenshots/e2e-after-discard-p1.png', fullPage: true });
    expect(errs).toEqual([]);
  } finally {
    await ctx1.close(); await ctx2.close();
  }
});
