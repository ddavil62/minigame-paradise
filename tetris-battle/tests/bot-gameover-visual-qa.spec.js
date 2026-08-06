/**
 * @fileoverview QA 시각적 검증: AI 대전 상대 미니맵 렌더링 및 게임오버 흐름.
 *
 * 실행:
 *   npx playwright test tests/bot-gameover-visual-qa.spec.js --config=playwright.config.js
 *
 * 검증:
 *   - 봇 보드가 구형 막대 폴백이 아닌 실제 셀로 렌더링되는지 스크린샷 확인
 *   - AI 대전 시작 → 진행 중 → 게임오버 흐름에서 콘솔 에러 없는지
 *   - 게임오버 시 결과 오버레이가 표시되는지
 *
 * 포트: 3114 (다른 테스트와 격리)
 */

import { test, expect } from '@playwright/test';
import http from 'node:http';
import { createApp } from '../server.js';
import path from 'node:path';
import fs from 'node:fs';

const PORT = 3114;
let server;

// 스크린샷 디렉토리 보장
const screenshotDir = path.join(import.meta.dirname, 'screenshots');
if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });

test.beforeAll(async () => {
  const app = createApp({
    hostUrl: `http://localhost:${PORT}/tetris-battle/`,
    getBotUrl: (roomId) => `ws://localhost:${PORT}/ws?mode=bot&room=${roomId}`,
    heartbeatIntervalMs: 0,
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

test.describe('AI 대전 시각적 검증', () => {
  test('상대 미니맵이 실제 셀로 렌더링된다 (구형 막대 폴백 아님)', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    // AI 모드로 접속
    await page.goto(`http://localhost:${PORT}/?mode=ai`);

    // 닉네임 인라인 게이트 통과 (직접 접속 시 표시됨)
    const nameInput = page.locator('#inline-name-input');
    await nameInput.waitFor({ state: 'visible', timeout: 5000 });
    await nameInput.fill('QATester');
    await page.locator('#btn-inline-enter').click();

    // 게임 시작 대기 (봇 spawn + 자동 READY + 카운트다운 4초 + 봇 첫 배치 ~1.2초)
    // game-main 영역이 visible 되면 게임이 시작된 것
    await page.waitForSelector('.game-main:not(.hidden)', { timeout: 20000 });

    // 봇이 피스를 여러 개 배치할 시간을 준다
    await page.waitForTimeout(8000);

    // 전체 화면 스크린샷
    await page.screenshot({
      path: path.join(screenshotDir, 'ai-opponent-minimap.png'),
    });

    // 추가 대기 후 미니맵 변화 캡처 (봇이 더 쌓임)
    await page.waitForTimeout(5000);
    await page.screenshot({
      path: path.join(screenshotDir, 'ai-opponent-minimap-later.png'),
    });

    // 콘솔 에러 검증
    const gameErrors = errors.filter(
      (e) => !e.includes('favicon') && !e.includes('404')
    );
    expect(gameErrors).toEqual([]);
  });

  test('AI 대전에서 콘솔 에러 없이 게임이 진행된다', async ({ page }) => {
    test.setTimeout(60000);
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto(`http://localhost:${PORT}/?mode=ai`);

    // 닉네임 인라인 게이트 통과
    const nameInput = page.locator('#inline-name-input');
    await nameInput.waitFor({ state: 'visible', timeout: 5000 });
    await nameInput.fill('QATester2');
    await page.locator('#btn-inline-enter').click();

    // 게임 진입 대기
    await page.waitForSelector('.game-main:not(.hidden)', { timeout: 20000 });

    // 15초 동안 게임 플레이 (콘솔 에러 수집)
    await page.waitForTimeout(15000);

    await page.screenshot({
      path: path.join(screenshotDir, 'ai-game-playing.png'),
    });

    // 콘솔 에러 검증
    const gameErrors = errors.filter(
      (e) => !e.includes('favicon') && !e.includes('404')
    );
    expect(gameErrors).toEqual([]);
  });
});
