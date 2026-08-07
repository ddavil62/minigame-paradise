/**
 * @fileoverview 런처 AI 채우기부터 끝말잇기 보통 AI 표시까지의 브라우저 통합 테스트.
 */

import { expect, test } from '@playwright/test';
import { spawn } from 'node:child_process';
import http from 'node:http';

/** @returns {Promise<number>} 사용 가능한 로컬 포트 */
async function reservePort() {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/**
 * 격리된 통합 런처를 실행한다.
 * @returns {Promise<{port:number, child:import('node:child_process').ChildProcess}>}
 */
async function startLauncher() {
  const port = await reservePort();
  const child = spawn(process.execPath, ['launcher/server.js', '--port', String(port)], {
    cwd: new URL('../..', import.meta.url),
    stdio: 'ignore',
  });
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/`)).ok) return { port, child };
    } catch (_) {
      // 런처가 HTTP 요청을 받을 때까지 짧게 재시도한다.
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  child.kill();
  throw new Error('통합 런처 시작 시간 초과');
}

/**
 * 런처와 서버가 소유한 봇 자식 프로세스를 종료한다.
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

test('런처 AI 채우기로 mode=ai 경기에 진입하고 AI (보통)을 표시한다', async ({ page }) => {
  const launcher = await startLauncher();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  try {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.addInitScript(() => {
      localStorage.setItem('minigames:nickname', 'AI모드QA');
      localStorage.setItem('starlight-locale', 'ko');
    });
    await page.goto(`http://127.0.0.1:${launcher.port}/`, { waitUntil: 'domcontentloaded' });
    const card = page.locator('[data-game-id="wordchain-battle"]');
    await expect(card.locator('.game-card-meta')).toContainText('1인 AI · 2인 대전');
    await expect(card.locator('.game-card-meta')).toContainText('보통 AI 지원');

    // 넓은 데스크톱과 AD FAIL 해상도 모두에서 공용 카드 그리드가 문서 폭을 넘지 않아야 한다.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1280);
    await page.setViewportSize({ width: 800, height: 640 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(800);
    const cardBounds = await page.locator('.game-card').evaluateAll((cards) => cards.map((item) => {
      const rect = item.getBoundingClientRect();
      return { left: rect.left, right: rect.right };
    }));
    expect(new Set(cardBounds.map((bounds) => Math.round(bounds.left))).size).toBe(3);
    for (const bounds of cardBounds) {
      expect(bounds.left).toBeGreaterThanOrEqual(0);
      expect(bounds.right).toBeLessThanOrEqual(800);
    }

    await card.click();
    await expect(page.locator('#btn-wr-fill-ai')).toBeVisible();
    await page.locator('#btn-wr-fill-ai').click();
    await expect(page.locator('#wr-players .ai-slot')).toHaveCount(1);
    await page.locator('#btn-ready').click();
    await page.waitForURL(/wordchain-battle\/\?.*mode=ai/, { timeout: 10_000 });
    await expect(page.locator('#name-opp')).toHaveText('AI (보통)', { timeout: 10_000 });
    await expect(page.locator('#hp-opp')).toBeVisible();
    await expect(page.locator('#gauge-opp')).toBeVisible();
    expect(pageErrors).toEqual([]);
  } finally {
    await stopLauncher(launcher.child);
  }
});

test('360x640 AI 경기에서 상대 이름·HP·게이지가 뷰포트 안에 유지된다', async ({ page }) => {
  const launcher = await startLauncher();
  try {
    await page.setViewportSize({ width: 360, height: 640 });
    await page.goto(`http://127.0.0.1:${launcher.port}/wordchain-battle/?mode=ai&name=모바일QA`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.locator('#name-opp')).toHaveText('AI (보통)', { timeout: 10_000 });
    for (const selector of ['#name-opp', '#hp-opp', '#gauge-opp']) {
      const box = await page.locator(selector).boundingBox();
      expect(box).not.toBeNull();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(360);
      expect(box.y + box.height).toBeLessThanOrEqual(640);
    }
  } finally {
    await stopLauncher(launcher.child);
  }
});
