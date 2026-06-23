/**
 * @fileoverview 접속 플로우 페이즈2 E2E — 사람/봇 흐름 Playwright 테스트.
 *
 * 검증 대상(스펙 2026-06-22-connection-flow-redesign §포크 D, 결정 B):
 *  CFE-01: /omok/?name=X 진입 → "친구를 기다리는 중" + "🤖 AI랑 시작" 노출,
 *          카드만으로는 AI 미시작(게임 화면 미전환).
 *  CFE-02: "🤖 AI랑 시작" 클릭 → mode=ai 재접속 → 봇 입장 + 봇 자동 READY +
 *          내 READY → GAME_START.
 *  CFE-03: 2컨텍스트 사람 — 양쪽 READY 상호 ✅/⌛ → GAME_START.
 *  CFE-04: 상대 이탈 → 자동 튕김 0 + "나갔어요" 배너 + "로비로 돌아가기" 버튼.
 *
 * 격리 포트 3079(단독 server.js를 beforeAll에서 spawn). 사용자 launcher(3000)·
 * MCP node 무접촉. afterAll에서 서버 종료.
 */
import { test, expect } from '@playwright/test';
import http from 'node:http';
import { createApp } from '../server.js';

const PORT = 3079;
const BASE = `http://127.0.0.1:${PORT}`;
let server = null;

test.beforeAll(async () => {
  const app = createApp({
    hostUrl: '',
    // 단독 server.js 패턴: mode=ai 진입 시 봇이 접속할 WS URL.
    getBotUrl: () => `ws://127.0.0.1:${PORT}/ws?mode=bot`,
  });
  server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', resolve);
  });
});

test.afterAll(async () => {
  if (server) await new Promise((res) => server.close(res));
});

test.describe('접속 플로우 페이즈2', () => {
  // ── CFE-01: 카드 진입(이름 전달) → 대기 화면 + AI 버튼, AI 미자동 ──
  test('CFE-01: ?name= 진입 → "친구를 기다리는 중" + AI 버튼, 카드만으로 AI 미시작', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${BASE}/?name=${encodeURIComponent('철수')}`);

    // 대기 화면 노출.
    await expect(page.locator('#screen-waiting')).toBeVisible();
    // 혼자 대기 패널: "친구를 기다리는 중..." + "🤖 AI랑 시작".
    await expect(page.locator('#waiting-solo')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#waiting-solo .waiting-message')).toHaveText(/친구를 기다리는 중/);
    await expect(page.locator('#btn-start-ai')).toBeVisible();

    // 카드만으로는 게임이 시작되지 않는다 — 1.5초 대기 후에도 게임 화면 미전환.
    await page.waitForTimeout(1500);
    await expect(page.locator('#screen-game')).toBeHidden();
    await expect(page.locator('#screen-waiting')).toBeVisible();

    await page.screenshot({ path: 'tests/screenshots/cfe-01-waiting-solo.png' });
    expect(errors).toEqual([]);
  });

  // ── CFE-02: "🤖 AI랑 시작" 클릭 → 봇 입장+자동 READY → 내 READY → GAME_START ──
  test('CFE-02: AI 버튼 클릭 → 봇 자동 READY + 내 READY → GAME_START', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${BASE}/?name=${encodeURIComponent('영희')}`);
    await expect(page.locator('#btn-start-ai')).toBeVisible({ timeout: 5000 });

    // AI 버튼 클릭 → mode=ai&name=... 로 재접속(유일한 AI 진입 경로).
    await page.locator('#btn-start-ai').click();
    await page.waitForURL(/[?&]mode=ai/, { timeout: 5000 });

    // 봇이 자동 spawn → 봇 JOIN → 봇 자동 READY. 사람은 준비 버튼이 노출되면 클릭.
    await expect(page.locator('#btn-ready')).toBeVisible({ timeout: 10000 });
    await page.locator('#btn-ready').click();

    // 양쪽 READY → GAME_START → 게임 화면 전환.
    await expect(page.locator('#screen-game')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#board-canvas')).toBeVisible();

    await page.screenshot({ path: 'tests/screenshots/cfe-02-ai-game-start.png' });
    expect(errors).toEqual([]);
  });

  // ── CFE-03: 2컨텍스트 사람 — 양쪽 READY 상호 마크 → GAME_START ──
  test('CFE-03: 사람 2명 양쪽 READY 상호 ✅/⌛ → GAME_START', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    const errors = [];
    pageA.on('pageerror', (e) => errors.push(`A:${e.message}`));
    pageB.on('pageerror', (e) => errors.push(`B:${e.message}`));

    // A 먼저 입장(이름 가가). 혼자 대기.
    await pageA.goto(`${BASE}/?name=${encodeURIComponent('가가')}`);
    await expect(pageA.locator('#waiting-solo')).toBeVisible({ timeout: 5000 });

    // B 입장(이름 나나) → A 화면에서 AI 버튼 소멸 + "나나님과 대전" 표시.
    await pageB.goto(`${BASE}/?name=${encodeURIComponent('나나')}`);
    await expect(pageA.locator('#opponent-info')).toBeVisible({ timeout: 5000 });
    await expect(pageA.locator('#opponent-name-label')).toHaveText('나나');
    await expect(pageA.locator('#btn-start-ai')).toBeHidden();
    // WARN-3: 상대 합류 후 대기 제목이 "상대방을 기다리는 중"으로 남지 않는다.
    await expect(pageA.locator('#screen-waiting .waiting-title')).not.toHaveText(/상대방을 기다리는 중/);
    await expect(pageA.locator('#screen-waiting .waiting-title')).toHaveText('대전 준비 중');
    // B 화면에도 상대 이름.
    await expect(pageB.locator('#opponent-name-label')).toHaveText('가가', { timeout: 5000 });

    // A가 먼저 READY → A 마크 ✅, B 화면의 상대 마크 ✅.
    await pageA.locator('#btn-ready').click();
    await expect(pageA.locator('#my-ready-mark')).toHaveText('✅', { timeout: 5000 });
    await expect(pageB.locator('#opp-ready-mark')).toHaveText('✅', { timeout: 5000 });
    // 아직 B는 준비 전 → 게임 미시작.
    await expect(pageA.locator('#screen-game')).toBeHidden();

    // B도 READY → 양쪽 GAME_START.
    await pageB.locator('#btn-ready').click();
    await expect(pageA.locator('#screen-game')).toBeVisible({ timeout: 5000 });
    await expect(pageB.locator('#screen-game')).toBeVisible({ timeout: 5000 });

    await pageA.screenshot({ path: 'tests/screenshots/cfe-03-human-game-start.png' });
    expect(errors).toEqual([]);
    await ctxA.close();
    await ctxB.close();
  });

  // ── CFE-04: 상대 이탈 → 자동 튕김 0 + 배너 + 로비 버튼 ──
  test('CFE-04: 상대 이탈 → 자동 redirect 없음 + 이탈 배너 + 로비 버튼', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    const errors = [];
    pageA.on('pageerror', (e) => errors.push(`A:${e.message}`));

    await pageA.goto(`${BASE}/?name=${encodeURIComponent('호스트')}`);
    await expect(pageA.locator('#waiting-solo')).toBeVisible({ timeout: 5000 });
    await pageB.goto(`${BASE}/?name=${encodeURIComponent('게스트')}`);
    await expect(pageA.locator('#opponent-name-label')).toHaveText('게스트', { timeout: 5000 });

    const urlBefore = pageA.url();

    // B 컨텍스트를 닫아 이탈 유발.
    await ctxB.close();

    // A에 이탈 배너 표시(사라지지 않음).
    await expect(pageA.locator('#opponent-left-banner')).toBeVisible({ timeout: 5000 });
    await expect(pageA.locator('#opponent-left-msg')).toHaveText(/게스트님이 나갔어요/);
    await expect(pageA.locator('#btn-banner-return-lobby')).toBeVisible();

    // 자동 튕김 0: 3초 대기 후에도 URL 변동 없음(setTimeout redirect 제거 확인).
    await pageA.waitForTimeout(3000);
    expect(pageA.url()).toBe(urlBefore);
    await expect(pageA.locator('#opponent-left-banner')).toBeVisible();

    await pageA.screenshot({ path: 'tests/screenshots/cfe-04-opponent-left-banner.png' });

    // 버튼 클릭 → 로비('/')로 이동.
    await pageA.locator('#btn-banner-return-lobby').click();
    await pageA.waitForURL(`${BASE}/`, { timeout: 5000 });

    expect(errors).toEqual([]);
    await ctxA.close();
  });
});
