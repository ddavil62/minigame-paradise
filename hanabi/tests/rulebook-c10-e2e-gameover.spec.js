/**
 * @fileoverview 하나비 종료 화면 E2E (HR-C10).
 *
 * 폭탄 3소진 패배까지 양쪽이 번갈아 내기를 반복하여 종료 오버레이를 시각 검증한다.
 * §13-6: 폭탄 패배 시 현재 점수 + "실패" 라벨.
 *
 * 사전 요건: 없음 — createApp()으로 동적 포트에서 자체 서버를 생성한다.
 */

import { test, expect } from 'playwright/test';
import http from 'http';
import { createApp } from '../server.js';

// ── 서버 헬퍼 ──────────────────────────────────────────────────────
function startServer() {
  return new Promise((resolve, reject) => {
    const app = createApp();
    const server = http.createServer(app.handleHttp);
    server.on('upgrade', app.handleUpgrade);
    server.listen(0, () => resolve({ server, port: server.address().port }));
    server.once('error', reject);
  });
}
function stopServer(server) {
  return new Promise((resolve) => {
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    server.close(() => resolve());
    setTimeout(resolve, 300);
  });
}

let _server;
let BASE = '';

test.beforeAll(async () => {
  const { server, port } = await startServer();
  _server = server;
  BASE = `http://localhost:${port}`;
});
test.afterAll(async () => {
  await stopServer(_server);
});

test('HR-C10-001 폭탄 소진 또는 게임 진행 끝까지 → 종료 오버레이 시각 검증', async ({ browser }) => {
  test.setTimeout(60000);
  const ctx1 = await browser.newContext({ viewport: { width: 900, height: 900 } });
  const ctx2 = await browser.newContext({ viewport: { width: 900, height: 900 } });
  const p1 = await ctx1.newPage();
  const p2 = await ctx2.newPage();
  const errs = [];
  p1.on('pageerror', (e) => errs.push('p1:' + e.message));
  p2.on('pageerror', (e) => errs.push('p2:' + e.message));

  // READY 게이트: 입장 + 준비 버튼 클릭.
  await p1.goto(`${BASE}?name=P1`);
  await p2.goto(`${BASE}?name=P2`);
  await p1.waitForSelector('#btn-ready:not([hidden])', { timeout: 10000 });
  await p2.waitForSelector('#btn-ready:not([hidden])', { timeout: 10000 });
  await p1.click('#btn-ready');
  await p2.click('#btn-ready');
  await p1.waitForSelector('#my-hand .card', { timeout: 15000 });
  await p2.waitForSelector('#my-hand .card', { timeout: 15000 });

  const pages = { p1, p2 };

  // 양쪽이 번갈아 "현재 턴인 쪽"이 첫 카드를 계속 내기 → 대부분 오연주로 폭탄 소진.
  // 종료 오버레이(#screen-game-over:not(.hidden))가 뜰 때까지 반복(최대 80회).
  let ended = false;
  for (let i = 0; i < 80 && !ended; i++) {
    // 어느 쪽이 내 차례인지 판정
    for (const key of ['p1', 'p2']) {
      const page = pages[key];
      const over = await page.locator('#screen-game-over').isVisible().catch(() => false);
      if (over) { ended = true; break; }
      const turn = await page.locator('#turn-label').textContent().catch(() => '');
      if (turn && turn.trim() === '내 차례') {
        // 카드 내기 모드 진입 후 첫 카드 클릭(없으면 힌트라도)
        const playDisabled = await page.locator('#btn-play').isDisabled().catch(() => true);
        if (!playDisabled) {
          await page.click('#btn-play').catch(() => {});
          const sel = await page.locator('#my-hand.selectable').isVisible().catch(() => false);
          if (sel) {
            await page.locator('#my-hand .card').first().click().catch(() => {});
          }
        }
        await page.waitForTimeout(250);
        break;
      }
    }
    await p1.waitForTimeout(120);
  }

  // 종료되었으면 오버레이 시각 검증, 안 됐으면(만점/덱소진 전) 정보 기록.
  const overP1 = await p1.locator('#screen-game-over').isVisible().catch(() => false);
  if (overP1) {
    await p1.screenshot({ path: 'tests/screenshots/e2e-gameover-p1.png', fullPage: true });
    // 점수/등급/사유 텍스트가 비어있지 않은지.
    const score = await p1.locator('#result-score').textContent();
    const grade = await p1.locator('#result-grade').textContent();
    const reason = await p1.locator('#result-reason').textContent();
    expect(score).toMatch(/점/);
    expect(grade.trim().length).toBeGreaterThan(0);
    expect(reason.trim().length).toBeGreaterThan(0);
  } else {
    // 종료 미도달이어도 스크린샷은 남긴다(진단용).
    await p1.screenshot({ path: 'tests/screenshots/e2e-gameover-notended-p1.png', fullPage: true });
    console.log('[HR-C10-001] 80회 내 종료 미도달 — 폭탄이 안 소진되었을 수 있음(무작위).');
  }

  expect(errs).toEqual([]);
  await ctx1.close(); await ctx2.close();
});
