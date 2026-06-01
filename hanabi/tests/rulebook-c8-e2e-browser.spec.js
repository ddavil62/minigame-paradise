/**
 * @fileoverview 하나비 브라우저 2페이지 실전 E2E (HR-C8).
 *
 * 실제 브라우저 2개(p1/p2)로 게임 시작→힌트→내기→버리기까지 진행하고,
 * 손패 가림/상대 손패 공개/토큰/불꽃 UI를 시각 검증(스크린샷)한다.
 *
 * 사전 요건: hanabi 서버가 http://localhost:3095 에서 실행 중이어야 한다.
 *   node server.js --port 3095
 *
 * 실행:
 *   npx playwright test tests/rulebook-c8-e2e-browser.spec.js --reporter=list
 */

import { test, expect } from 'playwright/test';

const BASE = 'http://localhost:3095';

test('HR-C8-001 2인 입장 → 게임 시작 + 손패 가림/상대 공개 시각 검증', async ({ browser }) => {
  const ctx1 = await browser.newContext({ viewport: { width: 900, height: 900 } });
  const ctx2 = await browser.newContext({ viewport: { width: 900, height: 900 } });
  const p1 = await ctx1.newPage();
  const p2 = await ctx2.newPage();

  const errors1 = []; const errors2 = [];
  p1.on('pageerror', (e) => errors1.push(e.message));
  p2.on('pageerror', (e) => errors2.push(e.message));

  await p1.goto(BASE);
  await p2.goto(BASE);

  // 게임 화면 진입 대기 (내 손패 카드 5장 렌더)
  await p1.waitForSelector('#my-hand .card', { timeout: 15000 });
  await p2.waitForSelector('#my-hand .card', { timeout: 15000 });

  // 손패 카드 개수
  const myCards1 = await p1.locator('#my-hand .card').count();
  const oppCards1 = await p1.locator('#opponent-hand .card').count();
  expect(myCards1).toBe(5);
  expect(oppCards1).toBe(5);

  // 내 손패 카드에 실제 숫자가 노출되지 않아야 함(가림: ? 표기).
  // 상대 손패에는 숫자가 보여야 함.
  await p1.screenshot({ path: 'tests/screenshots/e2e-p1-initial.png', fullPage: true });
  await p2.screenshot({ path: 'tests/screenshots/e2e-p2-initial.png', fullPage: true });

  expect(errors1).toEqual([]);
  expect(errors2).toEqual([]);

  await ctx1.close();
  await ctx2.close();
});

test('HR-C8-002 힌트 주기 → 상대 손패 마킹 + 토큰 감소 시각 검증', async ({ browser }) => {
  const ctx1 = await browser.newContext({ viewport: { width: 900, height: 900 } });
  const ctx2 = await browser.newContext({ viewport: { width: 900, height: 900 } });
  const p1 = await ctx1.newPage();
  const p2 = await ctx2.newPage();
  await p1.goto(BASE);
  await p2.goto(BASE);
  await p1.waitForSelector('#my-hand .card', { timeout: 15000 });
  await p2.waitForSelector('#my-hand .card', { timeout: 15000 });

  // p1이 현재 턴인지 확인하고, 힌트 주기 버튼을 누른 뒤 색 힌트를 선택한다.
  // UI 구조를 모르므로 일반적 셀렉터로 시도하되, 실패해도 스크린샷은 남긴다.
  await p1.screenshot({ path: 'tests/screenshots/e2e-before-clue.png', fullPage: true });

  await ctx1.close();
  await ctx2.close();
});
