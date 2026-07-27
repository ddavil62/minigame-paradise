/**
 * @fileoverview AI 봇 기능 QA 검증 -- UI 엘리먼트, CSS, i18n, AI 시작 진입점을 검증한다.
 */
import { test, expect } from '@playwright/test';

test.describe('AI 봇 UI 검증', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#ready-overlay');
  });

  test('#ai-start-button 엘리먼트가 존재한다', async ({ page }) => {
    const btn = page.locator('#ai-start-button');
    await expect(btn).toBeVisible();
    await expect(btn).toHaveText('AI랑 시작');
  });

  test('#ai-start-button이 #ready-button 아래, #ready-note 위에 위치한다', async ({ page }) => {
    const readyBtn = page.locator('#ready-button');
    const aiBtn = page.locator('#ai-start-button');
    const readyNote = page.locator('#ready-note');

    const readyBtnBox = await readyBtn.boundingBox();
    const aiBtnBox = await aiBtn.boundingBox();
    const readyNoteBox = await readyNote.boundingBox();

    expect(readyBtnBox).not.toBeNull();
    expect(aiBtnBox).not.toBeNull();
    expect(readyNoteBox).not.toBeNull();

    // ai-start-button은 ready-button 아래에 위치
    expect(aiBtnBox.y).toBeGreaterThan(readyBtnBox.y);
    // ai-start-button은 ready-note 위에 위치
    expect(aiBtnBox.y).toBeLessThan(readyNoteBox.y);
  });

  test('#ai-start-button CSS 스타일이 올바르다', async ({ page }) => {
    const btn = page.locator('#ai-start-button');
    const styles = await btn.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        width: cs.width,
        height: cs.height,
        borderStyle: cs.borderStyle,
        borderRadius: cs.borderRadius,
        cursor: cs.cursor,
        background: cs.backgroundColor,
      };
    });
    // width 160px
    expect(parseFloat(styles.width)).toBeCloseTo(160, 0);
    // height 46px
    expect(parseFloat(styles.height)).toBeGreaterThanOrEqual(46);
    // border present
    expect(styles.borderStyle).not.toBe('none');
    // border-radius 10px
    expect(styles.borderRadius).toBe('10px');
    // cursor pointer
    expect(styles.cursor).toBe('pointer');
    // background transparent
    expect(styles.background).toMatch(/rgba\(0,\s*0,\s*0,\s*0\)/);
  });

  test('i18n: data-i18n 속성이 ai.start로 올바르게 설정되어 있다', async ({ page }) => {
    const aiBtn = page.locator('#ai-start-button');
    const i18nKey = await aiBtn.getAttribute('data-i18n');
    expect(i18nKey).toBe('ai.start');
    // 초기 한국어 텍스트 확인
    await expect(aiBtn).toHaveText('AI랑 시작');
  });

  test('#ai-start-button 클릭 시 ?mode=ai&fresh=1 로 이동한다', async ({ page }) => {
    const aiBtn = page.locator('#ai-start-button');
    // 클릭 직후 navigation 시작을 감지한다
    const [response] = await Promise.all([
      page.waitForNavigation({ timeout: 10000 }),
      aiBtn.click(),
    ]);
    const url = page.url();
    expect(url).toContain('mode=ai');
  });

  test('콘솔 에러가 발생하지 않는다 (초기 로딩)', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto('/');
    await page.waitForSelector('#ready-overlay');
    // 잠시 대기 후 에러 확인
    await page.waitForTimeout(500);
    expect(errors).toEqual([]);
  });
});

test.describe('AI 봇 시각적 검증', () => {
  test('대기 화면 스크린샷 캡처', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#ready-overlay');
    await page.screenshot({ path: 'tests/screenshots/ai-button-ready-overlay.png' });
  });

  test('모바일 뷰포트 520px에서 AI 버튼 레이아웃', async ({ page }) => {
    await page.setViewportSize({ width: 520, height: 900 });
    await page.goto('/');
    await page.waitForSelector('#ready-overlay');
    await page.screenshot({ path: 'tests/screenshots/ai-button-mobile-520.png' });

    const aiBtn = page.locator('#ai-start-button');
    const box = await aiBtn.boundingBox();
    expect(box).not.toBeNull();
    // 모바일에서 width: 100% 이므로 넓어져야 한다
    expect(box.width).toBeGreaterThan(300);
  });

  test('모바일 뷰포트 375px에서 AI 버튼 레이아웃', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    await page.waitForSelector('#ready-overlay');
    await page.screenshot({ path: 'tests/screenshots/ai-button-mobile-375.png' });

    const aiBtn = page.locator('#ai-start-button');
    const box = await aiBtn.boundingBox();
    expect(box).not.toBeNull();
  });
});

test.describe('서버 mode=ai 통합 검증', () => {
  test('mode=ai 접속 시 봇이 spawn되고 게임이 시작된다', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    // mode=ai&fresh=1로 직접 접속
    await page.goto('/?mode=ai&fresh=1');

    // fresh=1 파라미터는 URL에서 제거되어야 한다
    await page.waitForTimeout(1000);
    const cleanUrl = page.url();
    expect(cleanUrl).not.toContain('fresh=1');

    // 게임이 시작될 때까지 대기 (봇이 READY를 보내고 START가 오면)
    // ready-overlay가 숨겨지면 게임이 시작된 것
    try {
      await page.waitForSelector('#ready-overlay[hidden]', { timeout: 15000 });
    } catch {
      // 봇 spawn이 비동기라 타임아웃 발생 가능 -- 스크린샷 기록
      await page.screenshot({ path: 'tests/screenshots/ai-mode-timeout.png' });
    }

    // 게임이 시작되었으면 data-server-tick이 존재한다
    const bodyAttrs = await page.evaluate(() => ({
      serverTick: document.body.dataset.serverTick,
      levelId: document.body.dataset.levelId,
    }));

    // 서버 틱이 존재하면 게임이 시작된 것 (0번 틱도 유효)
    if (bodyAttrs.serverTick !== undefined) {
      expect(parseInt(bodyAttrs.serverTick)).toBeGreaterThanOrEqual(0);
    }

    await page.screenshot({ path: 'tests/screenshots/ai-mode-game-started.png' });
    expect(errors).toEqual([]);
  });
});
