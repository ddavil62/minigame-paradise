/** @fileoverview 테트리스 배틀 오디오 컨트롤 브라우저 회귀 테스트. */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.TETRIS_AUDIO_QA_URL || 'http://127.0.0.1:3188';

test('소리 버튼이 음소거를 전환하고 새로고침 뒤에도 설정을 유지한다', async ({ page }) => {
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto(`${BASE_URL}/?name=AudioQA`, { waitUntil: 'domcontentloaded' });
  const toggle = page.locator('#btn-audio-toggle');
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(toggle).toHaveAccessibleName('게임 소리 끄기');

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(toggle).toHaveAccessibleName('게임 소리 켜기');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('tetris-battle:muted'))).toBe('true');

  // standalone 멀티룸은 주소에 자동 추가된 이전 roomId를 소켓 종료 시 정리하므로,
  // 음소거 영속성만 검증하는 재진입에서는 room 없는 URL로 새 방을 배정받는다.
  await page.evaluate(() => sessionStorage.removeItem('tetris:room'));
  await page.goto(`${BASE_URL}/?name=AudioQA`, { waitUntil: 'domcontentloaded' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('tetris-battle:muted'))).toBe('false');

  await page.screenshot({ path: 'tests/screenshots/audio-controls-desktop.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('모바일 헤더에서 소리 버튼과 로비 버튼이 겹치지 않는다', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE_URL}/?name=AudioMobile`, { waitUntil: 'domcontentloaded' });

  const boxes = await page.evaluate(() => {
    const rect = (selector) => {
      const value = document.querySelector(selector).getBoundingClientRect();
      return { left: value.left, right: value.right, top: value.top, bottom: value.bottom };
    };
    return {
      audio: rect('#btn-audio-toggle'),
      lobby: rect('#btn-back-to-lobby'),
      header: rect('.game-header'),
    };
  });
  expect(boxes.audio.right).toBeLessThanOrEqual(boxes.lobby.left);
  expect(boxes.audio.left).toBeGreaterThanOrEqual(boxes.header.left);
  expect(boxes.lobby.right).toBeLessThanOrEqual(boxes.header.right);

  await page.screenshot({ path: 'tests/screenshots/audio-controls-mobile.png', fullPage: true });
});
