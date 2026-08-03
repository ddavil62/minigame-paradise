/**
 * @fileoverview "Room is full" 근본원인(sessionStorage 'ai' 모드 잔존) 회귀 E2E.
 *
 * 박제 대상 버그: network.js의 connect()가 URL ?mode= 파라미터가 없을 때
 *   sessionStorage['tetris:mode']를 폴백으로 사용한다. 이 값은 한 번 'ai'로
 *   설정되면(AI랑 시작 클릭 또는 ?mode=ai 진입) 어디서도 지워지지 않아,
 *   하드 리프레시 후에도 같은 탭의 다음 접속이 자동으로 mode=ai를 재사용한다.
 *   서버는 mode=ai 단독 입장(JOIN) 시 200ms 후 자동으로 봇을 spawn해 슬롯 하나를
 *   선점하므로, 뒤이어 들어온 진짜 친구는 이미 (이전 유저 + 봇)으로 가득 찬 방에서
 *   "Room is full"을 받는다.
 *
 * 수정: main.js가 매치 종료(onResult) 및 모든 "로비 복귀" 경로(상시 뒤로가기,
 *   결과화면 로비 복귀, 상대이탈 배너 로비 복귀)에서 sessionStorage.removeItem
 *   ('tetris:mode')를 호출해 다음 접속이 항상 기본값(human)으로 돌아가도록 한다.
 *
 * 회귀 게이트:
 *   1) AI 모드로 입장 후 "← 게임 선택"(로비 복귀) 클릭 시 sessionStorage의
 *      'tetris:mode'가 제거된다.
 *   2) 그 결과 같은 탭에서 새로 접속(?mode= 없음)하면 WS 연결 URL에 ?mode=ai가
 *      붙지 않는다(콘솔 로그 '[net] 연결 시도: ...' 검사).
 *   3) 그 상태에서 실제 친구(2번째 탭)가 곧바로 들어와도 봇에게 슬롯을 뺏기지 않고
 *      정상적으로 p1/p2 두 사람이 JOINED된다(Room is full 없음).
 *
 * 격리 포트 3118 (다른 슈트와 충돌 방지).
 */
import { test, expect } from '@playwright/test';
import http from 'node:http';
import { createApp } from '../server.js';

const PORT = 3118;
const BASE = `http://localhost:${PORT}`;

/** @type {import('http').Server} */
let server;

test.beforeEach(async () => {
  const app = createApp({
    hostUrl: '',
    getBotUrl: (roomId) => `ws://localhost:${PORT}/ws?mode=bot&room=${roomId}`,
  });
  server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', resolve);
  });
});

test.afterEach(async ({ page }) => {
  try { await page.close(); } catch { /* 이미 닫힘 */ }
  if (server) {
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    await Promise.race([
      new Promise((res) => server.close(res)),
      new Promise((res) => setTimeout(res, 2000)),
    ]);
    server = null;
  }
  await new Promise((res) => setTimeout(res, 800));
});

test.describe('Room is full 근본원인(sessionStorage 잔존) 회귀', () => {
  test('로비 복귀 클릭 시 sessionStorage의 tetris:mode가 제거된다', async ({ page }) => {
    await page.goto(`${BASE}/?mode=ai&name=Player1`);
    await expect(page.locator('#player-label')).toHaveText('나 (P1)', { timeout: 10000 });

    // AI 모드로 접속했으므로 sessionStorage에 'ai'가 남아있어야 정상(진행 중 새로고침 복구용).
    const modeBeforeExit = await page.evaluate(() => sessionStorage.getItem('tetris:mode'));
    expect(modeBeforeExit).toBe('ai');

    // "← 게임 선택"(상시 뒤로가기) 클릭 → confirm 다이얼로그 수락 → 로비('/')로 복귀.
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#btn-back-to-lobby').click();
    await page.waitForURL(`${BASE}/`, { timeout: 10000 });

    // 회귀 단언: 로비 복귀 후 sessionStorage의 'ai' 모드가 제거되어야 한다.
    const modeAfterExit = await page.evaluate(() => sessionStorage.getItem('tetris:mode'));
    expect(modeAfterExit).toBeNull();
  });

  test('AI 모드 잔존 없이 새로 접속 시 진짜 친구가 Room is full을 받지 않는다', async ({ page, context }) => {
    // 1단계: 이전에 AI 모드를 써봤다가 로비로 복귀한 탭을 재현 — AI 진입 후 로비 복귀.
    await page.goto(`${BASE}/?mode=ai&name=Player1`);
    await expect(page.locator('#player-label')).toHaveText('나 (P1)', { timeout: 10000 });
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#btn-back-to-lobby').click();
    await page.waitForURL(`${BASE}/`, { timeout: 10000 });

    // 2단계: 같은 탭에서 ?mode= 없이(닉네임만 재사용) 다시 접속 — sessionStorage가
    // 정리됐으므로 human 모드로 접속해야 한다.
    const consoleMsgs = [];
    page.on('console', (msg) => consoleMsgs.push(msg.text()));
    await page.goto(`${BASE}/?name=Player1`);
    await expect(page.locator('#player-label')).toHaveText('나 (P1)', { timeout: 10000 });

    const connectLog = consoleMsgs.find((t) => t.includes('[net] 연결 시도:'));
    expect(connectLog, 'WS 연결 로그를 찾을 수 없음').toBeTruthy();
    expect(connectLog).not.toContain('mode=ai');

    // 3단계: 진짜 친구(2번째 탭)가 곧바로 입장 — Room is full 없이 p2로 정상 JOINED.
    const friendPage = await context.newPage();
    const friendConsole = [];
    friendPage.on('console', (msg) => friendConsole.push(msg.text()));
    await friendPage.goto(`${BASE}/?name=Friend2`);

    await expect(friendPage.locator('#player-label')).toHaveText('나 (P2)', { timeout: 10000 });

    const roomFullMsg = friendConsole.filter((t) => t.includes('Room is full'));
    expect(roomFullMsg, `Room is full 재현됨: ${JSON.stringify(roomFullMsg)}`).toEqual([]);

    await friendPage.close();
  });
});
