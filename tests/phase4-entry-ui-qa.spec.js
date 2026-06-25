/**
 * @fileoverview Phase 4 입장 UI 통일 QA -- hanabi / davinci-code / codenames-duet.
 *
 * AC-1: URL ?name=P1 파라미터로 접속 시 닉네임 게이트 없이 대기 화면 진입
 * AC-2: #btn-ready 클릭 후 대기 -> 상대도 클릭하면 게임 시작 (START + STATE)
 * AC-3: 2인 미만 상태에서 #btn-ready 클릭해도 게임 시작 안 됨
 * AC-4: 게임 중 상대 연결 끊어지면 #opponent-left-banner 표시
 * AC-5: 세션 스토리지에 이름 저장 시 다음 접속에서 자동 로그인 (닉네임 게이트 skip)
 *
 * 추가 능동 탐색:
 * - 닉네임 없이 접속 시 인라인 닉네임 게이트 표시
 * - 빈 닉네임 입력 시 에러 없이 거부
 * - READY 버튼 더블클릭 시 안전
 * - 콘솔 에러 없음
 * - 상대 이름 표시 확인
 *
 * 각 게임의 createApp()으로 격리된 서버를 사용한다 (standalone 포트 공유 문제 회피).
 *
 * 실행: cd minigame-paradise && npx playwright test tests/phase4-entry-ui-qa.spec.js --reporter=list
 */

import { test, expect } from '@playwright/test';
import http from 'http';

// ── 서버 헬퍼 ──────────────────────────────────────────────────────
function startServer(createApp) {
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
    setTimeout(resolve, 500);
  });
}

// ── 각 게임의 createApp import ──────────────────────────────────────
const GAMES = [
  {
    name: 'hanabi',
    importPath: '../hanabi/server.js',
    storageKey: 'hanabi:name',
    waitSelector: '#my-hand .card',   // 게임 시작 확인 셀렉터
    waitingId: '#screen-waiting',
  },
  {
    name: 'davinci-code',
    importPath: '../davinci-code/server.js',
    storageKey: 'davinci-code:name',
    waitSelector: '.play-area:not(.hidden)',
    waitingId: '#screen-waiting',
  },
  {
    name: 'codenames-duet',
    importPath: '../codenames-duet/server.js',
    storageKey: 'codenames-duet:name',
    waitSelector: '.board-wrap:not(.hidden)',
    waitingId: '#screen-waiting',
  },
];

// 동적 import 후 createApp 추출
async function loadCreateApp(gameName) {
  if (gameName === 'hanabi') {
    const mod = await import('../hanabi/server.js');
    return mod.createApp;
  } else if (gameName === 'davinci-code') {
    const mod = await import('../davinci-code/server.js');
    return mod.createApp;
  } else if (gameName === 'codenames-duet') {
    const mod = await import('../codenames-duet/server.js');
    return mod.createApp;
  }
}

for (const game of GAMES) {

  test.describe(`[${game.name}] Phase 4 입장 UI 통일`, () => {
    let _server;
    let BASE = '';

    test.beforeAll(async () => {
      const createApp = await loadCreateApp(game.name);
      const { server, port } = await startServer(createApp);
      _server = server;
      BASE = `http://localhost:${port}`;
    });

    test.afterAll(async () => {
      if (_server) await stopServer(_server);
    });

    // ── AC-1: URL ?name= 파라미터로 접속 시 닉네임 게이트 skip ──
    test(`AC-1: ?name=P1 접속 시 닉네임 게이트 hidden + READY 버튼 표시`, async ({ browser }) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));

      await page.goto(`${BASE}?name=QA_P1`);
      // JOINED 수신 후 READY 버튼이 un-hidden 되기를 대기
      await page.waitForFunction(() => {
        const btn = document.getElementById('btn-ready');
        return btn && !btn.hidden;
      }, {}, { timeout: 10000 });

      // 닉네임 게이트는 hidden이어야 한다
      const gateVisible = await page.locator('#name-gate-inline').isVisible();
      expect(gateVisible).toBe(false);

      // READY 버튼이 표시되어야 한다
      const readyVisible = await page.locator('#btn-ready').isVisible();
      expect(readyVisible).toBe(true);

      await page.screenshot({ path: `tests/screenshots/phase4-${game.name}-ac1-name-gate-hidden.png` });

      expect(errors).toEqual([]);
      await ctx.close();
    });

    // ── AC-2: 양쪽 READY -> 게임 시작 ──
    test(`AC-2: 양쪽 READY 후 게임 시작`, async ({ browser }) => {
      const ctx1 = await browser.newContext();
      const ctx2 = await browser.newContext();
      const p1 = await ctx1.newPage();
      const p2 = await ctx2.newPage();
      const errors1 = []; const errors2 = [];
      p1.on('pageerror', (e) => errors1.push(e.message));
      p2.on('pageerror', (e) => errors2.push(e.message));

      await p1.goto(`${BASE}?name=QA_P1`);
      await p2.goto(`${BASE}?name=QA_P2`);

      // 양쪽 READY 버튼 대기 (hidden attr 해제)
      await p1.waitForFunction(() => {
        const btn = document.getElementById('btn-ready');
        return btn && !btn.hidden;
      }, {}, { timeout: 10000 });
      await p2.waitForFunction(() => {
        const btn = document.getElementById('btn-ready');
        return btn && !btn.hidden;
      }, {}, { timeout: 10000 });

      // 양쪽 READY 클릭
      await p1.click('#btn-ready');
      await p2.click('#btn-ready');

      // 게임 시작 확인
      await p1.waitForSelector(game.waitSelector, { timeout: 15000 });

      // 대기 화면은 hidden이어야 함
      const waitingHidden = await p1.locator(game.waitingId).isHidden();
      expect(waitingHidden).toBe(true);

      await p1.screenshot({ path: `tests/screenshots/phase4-${game.name}-ac2-game-started-p1.png` });

      expect(errors1).toEqual([]);
      expect(errors2).toEqual([]);
      await ctx1.close();
      await ctx2.close();
    });

    // ── AC-3: 1인 상태에서 READY 클릭 -> 게임 시작 안 됨 ──
    test(`AC-3: 1인 READY -> 대기 유지`, async ({ browser }) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();

      await page.goto(`${BASE}?name=Solo`);
      await page.waitForFunction(() => {
        const btn = document.getElementById('btn-ready');
        return btn && !btn.hidden;
      }, {}, { timeout: 10000 });

      // READY 클릭
      await page.click('#btn-ready');
      // 대기 후에도 대기 화면이 유지되어야 함
      await page.waitForTimeout(1000);

      const waitingVisible = await page.locator(game.waitingId).isVisible();
      expect(waitingVisible).toBe(true);

      await page.screenshot({ path: `tests/screenshots/phase4-${game.name}-ac3-solo-ready.png` });
      await ctx.close();
    });

    // ── AC-4: 게임 중 상대 이탈 -> #opponent-left-banner 표시 ──
    test(`AC-4: 상대 이탈 -> 이탈 배너 표시`, async ({ browser }) => {
      const ctx1 = await browser.newContext();
      const ctx2 = await browser.newContext();
      const p1 = await ctx1.newPage();
      const p2 = await ctx2.newPage();

      await p1.goto(`${BASE}?name=Stay`);
      await p2.goto(`${BASE}?name=Leave`);

      await p1.waitForFunction(() => {
        const btn = document.getElementById('btn-ready');
        return btn && !btn.hidden;
      }, {}, { timeout: 10000 });
      await p2.waitForFunction(() => {
        const btn = document.getElementById('btn-ready');
        return btn && !btn.hidden;
      }, {}, { timeout: 10000 });

      await p1.click('#btn-ready');
      await p2.click('#btn-ready');

      // 게임 시작 대기
      await p1.waitForSelector(game.waitSelector, { timeout: 15000 });

      // p2 브라우저 닫기 (상대 이탈)
      await ctx2.close();

      // p1에서 이탈 배너 확인
      await p1.waitForSelector('#opponent-left-banner:not(.hidden)', { timeout: 10000 });
      const bannerVisible = await p1.locator('#opponent-left-banner').isVisible();
      expect(bannerVisible).toBe(true);

      // 배너 메시지가 비어있지 않은지 확인
      const bannerMsg = await p1.locator('#opponent-left-msg').textContent();
      expect(bannerMsg.length).toBeGreaterThan(0);

      // 로비 복귀 버튼 존재 확인
      const lobbyBtnVisible = await p1.locator('#btn-banner-return-lobby').isVisible();
      expect(lobbyBtnVisible).toBe(true);

      await p1.screenshot({ path: `tests/screenshots/phase4-${game.name}-ac4-opponent-left.png` });
      await ctx1.close();
    });

    // ── AC-5: 세션 스토리지 닉네임 저장 + 재접속 시 자동 로그인 ──
    test(`AC-5: sessionStorage 닉네임으로 자동 입장`, async ({ browser }) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();

      // 1차 접속: URL ?name= 으로 세션 스토리지에 저장
      await page.goto(`${BASE}?name=StoredUser`);
      await page.waitForFunction(() => {
        const btn = document.getElementById('btn-ready');
        return btn && !btn.hidden;
      }, {}, { timeout: 10000 });

      // 세션 스토리지에 저장되었는지 확인
      const storedName = await page.evaluate((key) => sessionStorage.getItem(key), game.storageKey);
      expect(storedName).toBe('StoredUser');

      // 2차 접속: ?name= 없이 접속 -> 세션 스토리지에서 자동 로그인
      await page.goto(BASE);
      await page.waitForFunction(() => {
        const btn = document.getElementById('btn-ready');
        return btn && !btn.hidden;
      }, {}, { timeout: 10000 });

      // 닉네임 게이트가 hidden이어야 함 (자동 JOIN)
      const gateVisible = await page.locator('#name-gate-inline').isVisible();
      expect(gateVisible).toBe(false);

      await ctx.close();
    });

    // ── 추가: 닉네임 없이 접속 시 게이트 표시 ──
    test(`EDGE-1: 닉네임 없이 접속 -> 인라인 게이트 표시`, async ({ browser }) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();

      // 세션 스토리지 깨끗한 상태(새 컨텍스트)에서 ?name= 없이 접속
      await page.goto(BASE);
      // WS open 이벤트 후 닉네임이 없으면 게이트 표시됨
      await page.waitForSelector('#name-gate-inline:not(.hidden)', { timeout: 10000 });

      const gateVisible = await page.locator('#name-gate-inline').isVisible();
      expect(gateVisible).toBe(true);

      // READY 버튼은 hidden이어야 함 (JOIN 전에는 표시 안 됨)
      const readyBtnHidden = await page.locator('#btn-ready').isHidden();
      expect(readyBtnHidden).toBe(true);

      await page.screenshot({ path: `tests/screenshots/phase4-${game.name}-edge1-name-gate.png` });
      await ctx.close();
    });

    // ── 추가: 빈 닉네임 입력 시 거부 ──
    test(`EDGE-2: 빈 닉네임 입력 -> 에러 없이 거부`, async ({ browser }) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));

      await page.goto(BASE);
      await page.waitForSelector('#name-gate-inline:not(.hidden)', { timeout: 10000 });

      // 빈 입력 상태에서 입장 버튼 클릭
      await page.fill('#inline-name-input', '');
      await page.click('#btn-inline-enter');

      // 잠시 후에도 닉네임 게이트가 여전히 표시되어야 함 (거부됨)
      await page.waitForTimeout(500);
      const gateStillVisible = await page.locator('#name-gate-inline').isVisible();
      expect(gateStillVisible).toBe(true);

      expect(errors).toEqual([]);
      await ctx.close();
    });

    // ── 추가: READY 버튼 더블클릭 안전성 ──
    test(`EDGE-3: READY 버튼 더블클릭 -> 에러 없음`, async ({ browser }) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));

      await page.goto(`${BASE}?name=DoubleClick`);
      await page.waitForFunction(() => {
        const btn = document.getElementById('btn-ready');
        return btn && !btn.hidden;
      }, {}, { timeout: 10000 });

      // 빠르게 더블클릭
      await page.click('#btn-ready');
      // 두번째 클릭: disabled 되어있을 수 있으므로 force 시도
      await page.waitForTimeout(50);
      const isDisabled = await page.locator('#btn-ready').isDisabled();
      if (!isDisabled) {
        await page.click('#btn-ready');
      }

      await page.waitForTimeout(500);
      expect(errors).toEqual([]);
      await ctx.close();
    });

    // ── 추가: 닉네임 입력 후 Enter 키로 입장 ──
    test(`EDGE-4: 닉네임 입력 후 Enter 키 -> 입장 성공`, async ({ browser }) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();

      await page.goto(BASE);
      await page.waitForSelector('#name-gate-inline:not(.hidden)', { timeout: 10000 });

      await page.fill('#inline-name-input', 'EnterUser');
      await page.press('#inline-name-input', 'Enter');

      // 닉네임 게이트가 숨겨지고 READY 버튼이 표시되어야 함
      await page.waitForFunction(() => {
        const btn = document.getElementById('btn-ready');
        return btn && !btn.hidden;
      }, {}, { timeout: 10000 });
      const gateHidden = await page.locator('#name-gate-inline').isHidden();
      expect(gateHidden).toBe(true);

      await ctx.close();
    });

    // ── 추가: 콘솔 에러 없음 (전체 플로우) ──
    test(`EDGE-5: 정상 플로우 중 콘솔 에러 없음`, async ({ browser }) => {
      const ctx1 = await browser.newContext();
      const ctx2 = await browser.newContext();
      const p1 = await ctx1.newPage();
      const p2 = await ctx2.newPage();
      const errors = [];
      p1.on('pageerror', (e) => errors.push(`p1: ${e.message}`));
      p2.on('pageerror', (e) => errors.push(`p2: ${e.message}`));

      await p1.goto(`${BASE}?name=E5_P1`);
      await p2.goto(`${BASE}?name=E5_P2`);

      await p1.waitForFunction(() => {
        const btn = document.getElementById('btn-ready');
        return btn && !btn.hidden;
      }, {}, { timeout: 10000 });
      await p2.waitForFunction(() => {
        const btn = document.getElementById('btn-ready');
        return btn && !btn.hidden;
      }, {}, { timeout: 10000 });

      await p1.click('#btn-ready');
      await p2.click('#btn-ready');

      // 게임 시작 대기
      await p1.waitForSelector(game.waitSelector, { timeout: 15000 });

      expect(errors).toEqual([]);
      await ctx1.close();
      await ctx2.close();
    });

    // ── 추가: 상대 이름 표시 확인 ──
    test(`EDGE-6: 상대 입장 시 이름 표시`, async ({ browser }) => {
      const ctx1 = await browser.newContext();
      const ctx2 = await browser.newContext();
      const p1 = await ctx1.newPage();
      const p2 = await ctx2.newPage();

      await p1.goto(`${BASE}?name=Alice`);
      await p2.goto(`${BASE}?name=Bob`);

      // p1에서 상대 이름이 표시되는지 확인 (JOINED 수신 후)
      await p1.waitForSelector('#opponent-info:not(.hidden)', { timeout: 10000 });
      const oppName = await p1.locator('#opponent-name-label').textContent();
      expect(oppName).toBe('Bob');

      // p2에서도 상대 이름 표시 확인
      await p2.waitForSelector('#opponent-info:not(.hidden)', { timeout: 10000 });
      const oppName2 = await p2.locator('#opponent-name-label').textContent();
      expect(oppName2).toBe('Alice');

      await p1.screenshot({ path: `tests/screenshots/phase4-${game.name}-edge6-opponent-name.png` });
      await ctx1.close();
      await ctx2.close();
    });

  });
}
