/**
 * @fileoverview 런처 준비 인계와 직접 진입의 두 게임 READY UI 분기를 브라우저에서 검증한다.
 */
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import http from 'node:http';

/** @returns {Promise<number>} 사용 가능한 포트 */
async function reservePort() {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/**
 * 격리된 통합 런처를 시작한다.
 * @returns {Promise<{port:number,child:import('node:child_process').ChildProcess}>} 런처 픽스처
 */
async function startLauncher() {
  const port = await reservePort();
  const child = spawn(process.execPath, ['launcher/server.js', '--port', String(port)], {
    cwd: new URL('..', import.meta.url),
    stdio: 'ignore',
  });
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/`)).ok) return { port, child };
    } catch {
      // HTTP 라우터가 준비될 때까지 짧게 재시도한다.
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  child.kill();
  throw new Error('launcher startup timeout');
}

/** @param {import('node:child_process').ChildProcess} child 런처 프로세스 @returns {Promise<void>} */
async function stopLauncher(child) {
  if (child.exitCode !== null) return;
  child.kill();
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
}

test('선택 메타가 없는 별빛 우편탑 카드에 undefined를 표시하지 않는다', async ({ page }) => {
  const launcher = await startLauncher();
  try {
    await page.addInitScript(() => {
      localStorage.setItem('minigames:nickname', 'CardMetaQA');
      localStorage.setItem('starlight-locale', 'ko');
    });
    await page.goto(`http://127.0.0.1:${launcher.port}/`, { waitUntil: 'domcontentloaded' });
    const card = page.locator('[data-game-id="starlight-mail-tower"]');
    await expect(card.locator('.game-card-meta')).toHaveText('2인 전용');
    await expect(card).not.toContainText('undefined');
  } finally {
    await stopLauncher(launcher.child);
  }
});

test('요트 다이스 카드는 2인 대전 메타를 한국어와 영어로 표시한다', async ({ page }) => {
  const launcher = await startLauncher();
  try {
    await page.addInitScript(() => {
      localStorage.setItem('minigames:nickname', 'YahtzeeMetaQA');
      localStorage.setItem('starlight-locale', 'ko');
    });
    await page.goto(`http://127.0.0.1:${launcher.port}/`, { waitUntil: 'domcontentloaded' });
    const card = page.locator('[data-game-id="yahtzee"]');
    await expect(card.locator('.game-card-meta')).toHaveText('2인 대전');

    const englishPage = await page.context().newPage();
    await englishPage.addInitScript(() => {
      localStorage.setItem('minigames:nickname', 'YahtzeeMetaQA');
      localStorage.setItem('starlight-locale', 'en');
    });
    await englishPage.goto(`http://127.0.0.1:${launcher.port}/`, { waitUntil: 'domcontentloaded' });
    await expect(englishPage.locator('[data-game-id="yahtzee"] .game-card-meta')).toHaveText('2-player battle');
    await englishPage.close();
  } finally {
    await stopLauncher(launcher.child);
  }
});

test('요트 다이스 AI 채우기는 사람과 AI를 합쳐 정확히 두 카드만 표시한다', async ({ page }) => {
  const launcher = await startLauncher();
  try {
    await page.addInitScript(() => {
      localStorage.setItem('minigames:nickname', 'YahtzeeSlotQA');
      localStorage.setItem('starlight-locale', 'ko');
    });
    await page.goto(`http://127.0.0.1:${launcher.port}/`, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-game-id="yahtzee"]').click();
    await expect(page.locator('#waiting-room-view')).toBeVisible();
    await expect(page.locator('#wr-players .player-ready-card')).toHaveCount(2);
    await expect(page.locator('#wr-players .empty-slot')).toHaveCount(1);

    await page.locator('#btn-wr-fill-ai').click();
    await expect(page.locator('#wr-players .player-ready-card')).toHaveCount(2);
    await expect(page.locator('#wr-players .player-ready-card:not(.ai-slot):not(.empty-slot)')).toHaveCount(1);
    await expect(page.locator('#wr-players .ai-slot')).toHaveCount(1);
    await expect(page.locator('#wr-players .empty-slot')).toHaveCount(0);
  } finally {
    await stopLauncher(launcher.child);
  }
});

test('lobbyReady 인계에서는 두 게임의 READY 조작을 다시 노출하지 않는다', async ({ browser }) => {
  const launcher = await startLauncher();
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const starlight = await context.newPage();
    const pageErrors = [];
    starlight.on('pageerror', (error) => pageErrors.push(error.message));
    await starlight.goto(`http://127.0.0.1:${launcher.port}/starlight-mail-tower/?name=HandoffA&lobbyReady=1&fresh=1`, { waitUntil: 'domcontentloaded' });
    await expect(starlight.locator('#ready-overlay')).toBeHidden();
    await expect(starlight.locator('#ready-button')).toBeHidden();
    await expect(starlight.locator('#ai-start-button')).toBeHidden();
    await starlight.screenshot({ path: 'starlight-mail-tower/tests/screenshots/qa-ready-handoff-390x844.png' });

    const sichuan = await context.newPage();
    sichuan.on('pageerror', (error) => pageErrors.push(error.message));
    await sichuan.goto(`http://127.0.0.1:${launcher.port}/sichuan-battle/?name=HandoffB&lobbyReady=1&fresh=1`, { waitUntil: 'domcontentloaded' });
    await expect(sichuan.locator('#ready-button')).toBeHidden();
    await expect(sichuan.locator('#ai-battle-button')).toBeHidden();
    await sichuan.screenshot({ path: 'sichuan-battle/tests/screenshots/qa-ready-handoff-390x844.png' });
    expect(pageErrors).toEqual([]);
    await expect(sichuan.locator('#waiting-view h2')).toHaveText(/게임 시작을 준비하는 중|Preparing the match/);
    await context.close();
  } finally {
    await stopLauncher(launcher.child);
  }
});

test('직접 진입에서는 두 게임의 수동 READY 조작을 유지한다', async ({ browser }) => {
  const launcher = await startLauncher();
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const starlight = await context.newPage();
    const pageErrors = [];
    starlight.on('pageerror', (error) => pageErrors.push(error.message));
    await starlight.goto(`http://127.0.0.1:${launcher.port}/starlight-mail-tower/?name=DirectA&fresh=1`, { waitUntil: 'domcontentloaded' });
    await expect(starlight.locator('#ready-overlay')).toBeVisible();
    await expect(starlight.locator('#ready-button')).toBeVisible();
    await starlight.screenshot({ path: 'starlight-mail-tower/tests/screenshots/qa-ready-direct-390x844.png' });

    const sichuan = await context.newPage();
    sichuan.on('pageerror', (error) => pageErrors.push(error.message));
    await sichuan.goto(`http://127.0.0.1:${launcher.port}/sichuan-battle/?name=DirectB`, { waitUntil: 'domcontentloaded' });
    await expect(sichuan.locator('#ready-button')).toBeVisible();
    await sichuan.screenshot({ path: 'sichuan-battle/tests/screenshots/qa-ready-direct-390x844.png' });
    expect(pageErrors).toEqual([]);
    await expect(sichuan.locator('#waiting-view h2')).toHaveText(/상대를 기다리는 중|Waiting for opponent/);
    await context.close();
  } finally {
    await stopLauncher(launcher.child);
  }
});

test('사천성 AI 런처 인계는 오래된 세션 토큰을 버리고 실제 플레이를 시작한다', async ({ browser }) => {
  const launcher = await startLauncher();
  try {
    const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.addInitScript(() => sessionStorage.setItem('sichuan:token', 'expired-launcher-session-token'));

    await page.goto(`http://127.0.0.1:${launcher.port}/sichuan-battle/?mode=ai&name=HandoffAI&players=2&role=p1&lobbyReady=1&fresh=1`, { waitUntil: 'domcontentloaded' });

    await expect(page.locator('#board .tile')).toHaveCount(96, { timeout: 10_000 });
    await expect(page.locator('#waiting-view')).toBeHidden();
    await expect(page.locator('#game-view')).toBeVisible();
    expect(pageErrors).toEqual([]);

    const result = await page.evaluate(() => ({
      token: sessionStorage.getItem('sichuan:token'),
      search: location.search,
    }));
    expect(result.token).toBeTruthy();
    expect(result.token).not.toBe('expired-launcher-session-token');
    expect(result.search).not.toContain('fresh=');
    expect(result.search).toContain('mode=ai');
    expect(result.search).toContain('lobbyReady=1');

    await page.evaluate(() => window.__sichuanTestSend?.({ type: 'LEAVE_MATCH' }));
    await context.close();
  } finally {
    await stopLauncher(launcher.child);
  }
});
