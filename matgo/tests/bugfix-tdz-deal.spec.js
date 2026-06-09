/**
 * @fileoverview 회귀 테스트 — 분배 시작 시 client.js TDZ ReferenceError 재발 방지.
 *
 * 2026-06-03 버그: client.js renderState()에서 `const la = s.lastAction;` 선언이
 * `if (la && la.kind === 'choice_made' ...)` 분기 뒤에 위치해 TDZ 위반.
 * 첫 STATE 수신(분배 직후) 시점에 `ReferenceError: Cannot access 'la' before initialization`
 * 가 throw되어 카드 분배 애니메이션이 안 보이고 화면이 멈춤.
 *
 * 본 테스트: 두 클라이언트가 입장 → 분배 STATE 수신 후 손패 10장이 DOM에 그려지는지 확인.
 * 콘솔 에러도 감지.
 *
 * 별도 포트 3199 에서 미리 서버를 띄워야 한다 (`node server.js --port 3199`).
 */

// 주의: 다른 단위 테스트는 `@playwright/test`로 import 하지만, matgo/node_modules와
// minigames/node_modules 두 곳에 playwright가 중복 설치돼 두 인스턴스가 동시에 로드될
// 경우 "No tests found" 충돌이 발생한다. 본 회귀 테스트는 단일 인스턴스만 끌어오는
// `playwright/test`(matgo 패키지)를 사용한다.
import { test, expect } from 'playwright/test';

test.describe.configure({ mode: 'serial' });

test('TDZ-DEAL-001: 두 명 입장 후 손패 10장이 분배 화면에 렌더링된다', async ({ browser }) => {
  const consoleErrors = [];
  const ctx1 = await browser.newContext();
  const ctx2 = await browser.newContext();
  const page1 = await ctx1.newPage();
  const page2 = await ctx2.newPage();

  page1.on('pageerror', (err) => consoleErrors.push(`p1:pageerror:${err.message}`));
  page1.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`p1:console:${m.text()}`); });
  page2.on('pageerror', (err) => consoleErrors.push(`p2:pageerror:${err.message}`));
  page2.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`p2:console:${m.text()}`); });

  await page1.goto('http://localhost:3199/index.html');
  await page2.goto('http://localhost:3199/index.html');

  // 분배 후 각자 손에 10장이 그려진다 (#my-cards 자식 카드 노드).
  await expect.poll(
    async () => await page1.locator('#my-hand-cards [data-card-id]').count(),
    { timeout: 8000, message: 'p1 손패가 10장 그려지지 않음' },
  ).toBe(10);
  await expect.poll(
    async () => await page2.locator('#my-hand-cards [data-card-id]').count(),
    { timeout: 8000, message: 'p2 손패가 10장 그려지지 않음' },
  ).toBe(10);

  // 바닥 카드도 그려진다 (사통 모달로 가려진 경우 사통 닫기까지 가지 않음)
  const p1FloorCount = await page1.locator('#floor-cards [data-card-id]').count();
  expect(p1FloorCount).toBeGreaterThanOrEqual(8);

  // TDZ ReferenceError 같은 클라이언트 콘솔 에러가 없어야 한다.
  const tdzErrors = consoleErrors.filter((e) =>
    e.includes('Cannot access') || e.includes('before initialization') || e.includes('ReferenceError'),
  );
  expect(tdzErrors, `TDZ 에러 재발: ${tdzErrors.join('\n')}`).toHaveLength(0);

  await ctx1.close();
  await ctx2.close();
});
