/**
 * @fileoverview Phase E 윷놀이의 런처 AI 1:1 인계와 반응형 보드 크기를 검증한다.
 */
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import http from 'node:http';

/**
 * 사용 가능한 로컬 포트를 예약한다.
 * @returns {Promise<number>} 임시 포트
 */
async function reservePort() {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/**
 * 격리된 통합 런처를 시작한다.
 * @returns {Promise<{port:number,child:import('node:child_process').ChildProcess}>} 서버 픽스처
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
      // HTTP 리스너가 준비될 때까지 재시도한다.
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  child.kill();
  throw new Error('launcher startup timeout');
}

/**
 * 런처와 윷놀이 봇을 정리한다.
 * @param {import('node:child_process').ChildProcess} child 런처 프로세스
 * @returns {Promise<void>}
 */
async function stopLauncher(child) {
  if (child.exitCode !== null) return;
  child.kill();
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
}

test('윷놀이 AI 채우기는 READY 1회 뒤 1 human + 1 AI로 시작하고 보드를 크게 유지한다', async ({ browser }) => {
  const launcher = await startLauncher();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  try {
    await page.addInitScript(() => localStorage.setItem('minigames:nickname', 'YutPhaseE'));
    await page.goto(`http://127.0.0.1:${launcher.port}/`, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-game-id="yutnori"]').click();
    await expect(page.locator('#waiting-room-view')).toBeVisible();
    await expect(page.locator('#btn-ready')).toBeVisible();
    await expect(page.locator('#btn-wr-fill-ai')).toBeVisible();

    // 사용자가 런처에서 누르는 READY는 이 한 번뿐이며, 이후 게임 내부 READY는 자동 인계된다.
    await page.locator('#btn-ready').click();
    await expect(page.locator('#btn-ready')).toHaveText(/준비 ✓|READY ✓/);

    await Promise.all([
      page.waitForURL(/\/yutnori\/.*mode=ai/, { timeout: 10_000 }),
      page.locator('#btn-wr-fill-ai').click(),
    ]);
    expect(page.url()).toContain('players=2');
    expect(page.url()).toContain('lobbyReady=1');

    await expect(page.locator('.game-main')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#ready-panel')).toBeHidden();
    await expect(page.locator('#btn-ready')).toBeHidden();

    const mobileLayout = await page.evaluate(() => {
      const board = document.getElementById('board-canvas').getBoundingClientRect();
      const main = document.querySelector('.game-main');
      return {
        boardWidth: board.width,
        boardHeight: board.height,
        mainScrollWidth: main.scrollWidth,
        mainClientWidth: main.clientWidth,
      };
    });
    expect(mobileLayout.boardWidth).toBeGreaterThanOrEqual(350);
    expect(mobileLayout.boardHeight).toBe(mobileLayout.boardWidth);
    expect(mobileLayout.mainScrollWidth).toBeLessThanOrEqual(mobileLayout.mainClientWidth);
    await page.screenshot({
      path: 'yutnori/tests/screenshots/phase-e-board-mobile-390x844.png',
      fullPage: false,
    });

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect.poll(async () => {
      const box = await page.locator('#board-canvas').boundingBox();
      return box?.width || 0;
    }).toBeGreaterThanOrEqual(600);
    const desktopBox = await page.locator('#board-canvas').boundingBox();
    expect(desktopBox.height).toBe(desktopBox.width);
    expect(desktopBox.x + desktopBox.width).toBeLessThanOrEqual(1280);
    await page.screenshot({
      path: 'yutnori/tests/screenshots/phase-e-board-desktop-1280x800.png',
      fullPage: false,
    });

    expect(pageErrors).toEqual([]);
  } finally {
    await context.close();
    await stopLauncher(launcher.child);
  }
});
