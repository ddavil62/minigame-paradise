/**
 * @fileoverview AI 모드 JOIN 레이스 컨디션 회귀 E2E (Playwright) — 2026-06-21.
 *
 * 박제 대상 버그: main.js가 WS open 이전(setTimeout 기반)에 net.join()을 호출하면
 *   send()가 ws.readyState !== OPEN이라 JOIN을 드롭("[net] 연결되지 않은 상태에서 전송 시도: JOIN")
 *   → 서버가 플레이어 JOIN을 못 받아 JOINED 미응답 → 클라가 "서버 연결 중"에 멈춤
 *   + (mode=ai 시) 봇 spawn이 JOIN 핸들러에서 트리거되므로 봇도 안 뜸. (레이스라 간헐적)
 *
 * 수정: network.js가 pendingJoinName을 보관하고 WS open 핸들러에서 JOIN을 확실히 전송.
 *
 * 회귀 게이트:
 *   - "연결되지 않은 상태에서 전송 시도: JOIN" 경고가 콘솔에 떠선 안 된다(레이스 재발 시 즉시 검출).
 *   - JOINED 처리 증거: 상태 텍스트가 "서버 연결 중"이 아니라 "나 (P1)"로 갱신.
 *   - 봇 입장 후 양쪽 READY → 카운트다운(GO!) 시작까지 단언.
 *
 * 이 슈트는 자체적으로 격리 포트 3111에 봇 spawn(getBotUrl 주입)을 켠 standalone
 *   tetris 서버를 띄운다(사용자 launcher 3000 및 phase 슈트(3055)/bot-smoke(3110)와 격리).
 */
import { test, expect } from '@playwright/test';
import http from 'node:http';
import { createApp } from '../server.js';

const PORT = 3111;
const BASE = `http://localhost:${PORT}`;

/** @type {import('http').Server} */
let server;

// 봇 spawn을 켠 standalone 서버를 띄운다(bot-smoke와 동일 getBotUrl 주입 패턴).
// 룸 상태(players)가 createApp closure에 누적되므로 테스트마다 fresh 서버로 재기동해
// 사람이 항상 p1 자리를 점유하도록 보장한다(bot-smoke의 시나리오별 서버 패턴).
test.beforeEach(async () => {
  const app = createApp({
    hostUrl: '',
    getBotUrl: () => `ws://localhost:${PORT}/ws?mode=bot`,
  });
  server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', resolve);
  });
});

test.afterEach(async ({ page }) => {
  // 먼저 페이지를 닫아 클라 WS를 끊는다(server.close 드레인 대기 단축).
  try { await page.close(); } catch { /* 이미 닫힘 */ }
  if (server) {
    // 페이지 WS/봇 연결이 살아있어 server.close()가 드레인 대기로 멈추는 것을 막기 위해
    // 열린 소켓을 강제로 끊는다(Node 18.2+ closeAllConnections).
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    // close 콜백이 늦어도(업그레이드 소켓 잔존) 다음 테스트를 막지 않도록 타임아웃 레이스.
    await Promise.race([
      new Promise((res) => server.close(res)),
      new Promise((res) => setTimeout(res, 2000)),
    ]);
    server = null;
  }
  // 봇 child 종료 + 포트 해제 대기(다음 테스트가 같은 포트를 잡을 수 있도록).
  await new Promise((res) => setTimeout(res, 800));
});

test.describe('AI 모드 JOIN 레이스 회귀', () => {
  test('mode=ai 진입 → JOINED 처리 + JOIN 드롭 경고 부재', async ({ page }) => {
    // 콘솔/페이지 에러 수집. JOIN 드롭 경고가 핵심 회귀 신호다.
    const consoleMsgs = [];
    const pageErrors = [];
    page.on('console', (msg) => consoleMsgs.push(msg.text()));
    page.on('pageerror', (e) => pageErrors.push(e.message));

    await page.goto(`${BASE}/?mode=ai`);

    // JOINED 처리 증거: 헤더 player-label이 "접속 중..."에서 "나 (P1)"로 갱신.
    // (JOIN이 드롭되면 JOINED 미수신 → 라벨이 갱신되지 않아 타임아웃으로 실패한다.)
    await expect(page.locator('#player-label')).toHaveText('나 (P1)', { timeout: 10000 });

    // 상태 텍스트가 더 이상 초기값("서버 연결 중")이 아니어야 한다.
    await expect(page.locator('#status-msg')).not.toHaveText('서버 연결 중');

    // 핵심 회귀 단언: JOIN 드롭 경고가 콘솔에 없어야 한다.
    const joinDropWarn = consoleMsgs.filter((t) =>
      t.includes('연결되지 않은 상태에서 전송 시도') && t.includes('JOIN'));
    expect(joinDropWarn, `JOIN 드롭 경고 발생: ${JSON.stringify(joinDropWarn)}`).toEqual([]);

    expect(pageErrors).toEqual([]);
  });

  test('봇 입장 → 양쪽 READY → 카운트다운(GO!) 시작', async ({ page }) => {
    const consoleMsgs = [];
    page.on('console', (msg) => consoleMsgs.push(msg.text()));

    await page.goto(`${BASE}/?mode=ai`);

    // JOINED 처리 후 준비 버튼 노출.
    await expect(page.locator('#player-label')).toHaveText('나 (P1)', { timeout: 10000 });
    const readyBtn = page.locator('#ready-btn');
    await expect(readyBtn).toBeVisible();

    // 사람 준비 클릭 → READY 전송. 봇은 JOINED 후 자동 READY → 양쪽 READY → START.
    await readyBtn.click();

    // 카운트다운 시작 증거: #countdown이 hidden 해제되고 GO!까지 진행.
    // (봇이 spawn되지 않았다면 START가 오지 않아 카운트다운이 시작되지 않는다.)
    await expect(page.locator('#countdown')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#countdown')).toHaveText('GO!', { timeout: 6000 });

    await page.screenshot({ path: 'tests/screenshots/ai-mode-countdown.png' });

    // 이 흐름에서도 JOIN 드롭 경고가 없어야 한다.
    const joinDropWarn = consoleMsgs.filter((t) =>
      t.includes('연결되지 않은 상태에서 전송 시도') && t.includes('JOIN'));
    expect(joinDropWarn).toEqual([]);
  });
});
