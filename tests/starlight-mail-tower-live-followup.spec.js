/**
 * @fileoverview 통합 런처에서 별빛 우편탑의 친구 2인·AI 채우기 준비 전달과 실제 tick 진행을 검증한다.
 * 기존 서버를 재사용하며 BASE_URL로 대상 런처 주소를 지정한다.
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3000';
const GAME_PATH = '/starlight-mail-tower/';

test.describe.configure({ mode: 'serial' });

/**
 * 페이지에서 별빛 우편탑 대기실까지 실제 UI를 클릭해 진입한다.
 * @param {import('@playwright/test').Page} page 런처 페이지
 * @param {string} nickname 테스트 닉네임
 * @returns {Promise<void>}
 */
async function enterTowerRoom(page, nickname) {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.locator('#nickname-input').fill(nickname);
  await page.locator('#btn-enter-lobby').click();
  const card = page.locator('[data-game-id="starlight-mail-tower"]');
  await expect(card).toBeVisible();
  await card.locator('.game-card-play').click();
  await expect(page.locator('#waiting-room-view')).not.toHaveClass(/hidden/);
}

/**
 * 게임 WebSocket의 JOIN·START 프레임을 수집한다.
 * @param {import('@playwright/test').Page} page 관찰할 페이지
 * @returns {{sent:Array<object>,received:Array<object>,urls:Array<string>}}
 */
function observeGameSocket(page) {
  const trace = { sent: [], received: [], urls: [] };
  page.on('websocket', (socket) => {
    if (!socket.url().includes(`${GAME_PATH}ws`)) return;
    trace.urls.push(socket.url());
    socket.on('framesent', (event) => {
      try {
        const message = JSON.parse(String(event.payload));
        if (message.type === 'JOIN') trace.sent.push(message);
      } catch { /* 바이너리/비 JSON 프레임은 대상이 아니다. */ }
    });
    socket.on('framereceived', (event) => {
      try {
        const message = JSON.parse(String(event.payload));
        if (message.type === 'SNAPSHOT') {
          trace.received.push({ type: message.type, tick: message.tick, phase: message.phase });
        } else if (message.type === 'WELCOME') {
          trace.received.push({
            type: message.type,
            playerId: message.playerId,
            sessionId: message.sessionId,
            resumed: message.resumed,
          });
        } else if (['READY_STATE', 'START', 'ERROR'].includes(message.type)) {
          trace.received.push(message);
        }
      } catch { /* 바이너리/비 JSON 프레임은 대상이 아니다. */ }
    });
  });
  return trace;
}

/**
 * START 이후 준비 오버레이가 숨겨지고 서버 tick이 실제 증가하는지 확인한다.
 * @param {import('@playwright/test').Page} page 게임 페이지
 * @param {{sent:Array<object>,received:Array<object>,urls:Array<string>}} trace WebSocket 추적 결과
 * @returns {Promise<{url:string,playerId:string,startTick:number,endTick:number,trace:object}>}
 */
async function expectRunningGame(page, trace) {
  await expect(page).toHaveURL(new RegExp(`${GAME_PATH.replaceAll('/', '\\/')}.*lobbyReady=1`), { timeout: 10_000 });
  await expect.poll(() => trace.sent.some((message) => message.type === 'JOIN' && message.readyFromLobby === true), {
    message: `readyFromLobby JOIN 미관찰: ${JSON.stringify(trace)}`,
    timeout: 10_000,
  }).toBe(true);
  await expect.poll(() => trace.received.some((message) => message.type === 'START'), {
    message: `START 미수신: ${JSON.stringify(trace)}`,
    timeout: 10_000,
  }).toBe(true);
  await expect(page.locator('#ready-overlay')).toBeHidden();
  await expect(page.locator('#ready-note')).not.toContainText('파트너 접속을 기다리는 중');
  await expect.poll(() => page.locator('body').getAttribute('data-server-tick'), { timeout: 10_000 }).not.toBeNull();
  const startTick = Number(await page.locator('body').getAttribute('data-server-tick'));
  await expect.poll(async () => Number(await page.locator('body').getAttribute('data-server-tick')), {
    message: `서버 tick이 증가하지 않음: start=${startTick}`,
    timeout: 5_000,
  }).toBeGreaterThan(startTick);
  const endTick = Number(await page.locator('body').getAttribute('data-server-tick'));
  return {
    url: page.url(),
    playerId: await page.locator('body').getAttribute('data-player-id'),
    startTick,
    endTick,
    trace,
  };
}

/**
 * 양쪽 클라이언트가 명시적으로 로비로 나가 다음 시나리오의 서버 세션을 정리한다.
 * @param {import('@playwright/test').Page[]} pages 게임 페이지 배열
 * @returns {Promise<void>}
 */
async function leaveGames(pages) {
  for (const page of pages) {
    if (page.isClosed()) continue;
    await page.locator('#toolbar-lobby-button').click().catch(() => {});
  }
  await Promise.all(pages.map(async (page) => {
    if (page.isClosed()) return;
    await page.locator('#confirm-lobby-button').click().catch(() => {});
  }));
}

test('친구 2인: 양쪽 준비 후 추가 준비 없이 START·overlay hidden·tick 증가', async ({ browser }) => {
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  const traces = pages.map(observeGameSocket);
  try {
    await Promise.all([
      enterTowerRoom(pages[0], `별빛A-${Date.now() % 10000}`),
      enterTowerRoom(pages[1], `별빛B-${Date.now() % 10000}`),
    ]);
    await expect(pages[0].locator('#wr-players .player-ready-card:not(.empty-slot)')).toHaveCount(2);
    await Promise.all(pages.map((page) => page.locator('#btn-ready').click()));
    const results = await Promise.all(pages.map((page, index) => expectRunningGame(page, traces[index])));
    expect(new Set(results.map((result) => result.playerId))).toEqual(new Set(['p1', 'p2']));
    console.log('[starlight-live][friend]', JSON.stringify(results));
    await leaveGames(pages);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test('AI 채우기: 런처 버튼 클릭 후 추가 준비 없이 START·overlay hidden·tick 증가', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const trace = observeGameSocket(page);
  try {
    await enterTowerRoom(page, `별빛AI-${Date.now() % 10000}`);
    await page.locator('#btn-wr-fill-ai').click();
    await page.locator('#btn-ready').click();
    const result = await expectRunningGame(page, trace);
    expect(new URL(result.url).searchParams.get('mode')).toBe('ai');
    console.log('[starlight-live][ai]', JSON.stringify(result));
  } finally {
    await context.close();
  }
});
