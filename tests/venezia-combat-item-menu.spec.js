/**
 * @fileoverview 베네치아 전투 피해, 아이템 안내, 게임 선택 복귀 UI 회귀 테스트.
 */

import { test, expect } from '@playwright/test';

const GAME_URL = 'http://127.0.0.1:3019/venezia/?mode=ai';

/**
 * AI 대전을 시작한다.
 * @param {import('@playwright/test').Page} page 테스트 페이지
 */
async function startAiGame(page) {
  await page.goto(GAME_URL);
  await page.fill('#input-name', 'CombatQA');
  await page.click('#btn-ai');
  await page.waitForSelector('#screen-game.active', { timeout: 15000 });
}

test('게임 중 복귀 버튼과 아이템 획득 안내가 접근 가능하게 표시된다', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await startAiGame(page);

  const backButton = page.locator('#btn-back-to-lobby');
  await expect(backButton).toBeVisible();
  await expect(backButton).toHaveText('← 게임 선택');
  await expect(page.locator('#item-guide')).toContainText('연속 정답');
  await expect(page.locator('#item-guide')).toContainText('1·2·3');

  const buttonBox = await backButton.boundingBox();
  expect(buttonBox.width).toBeGreaterThanOrEqual(44);
  expect(buttonBox.height).toBeGreaterThanOrEqual(44);
  await backButton.focus();
  await expect(backButton).toBeFocused();

  page.once('dialog', async (dialog) => {
    expect(dialog.type()).toBe('confirm');
    expect(dialog.message()).toContain('게임을 중단');
    await dialog.dismiss();
  });
  await page.keyboard.press('Enter');
  await expect(page.locator('#screen-game')).toHaveClass(/active/);

  for (const viewport of [
    { width: 1280, height: 720, file: 'venezia-combat-menu-1280x720.png' },
    { width: 390, height: 844, file: 'venezia-combat-menu-390x844.png' },
  ]) {
    await page.setViewportSize(viewport);
    await page.locator('#input-word').focus();
    if (viewport.width === 390) {
      // 모바일 상단 실제 뷰포트에서 메뉴와 FAB가 함께 보이는 상태를 검증한다.
      await page.evaluate(() => window.scrollTo(0, 0));
    }
    const backBox = await backButton.boundingBox();
    expect(backBox.width).toBeGreaterThanOrEqual(44);
    expect(backBox.height).toBeGreaterThanOrEqual(44);
    expect(backBox.y).toBeGreaterThanOrEqual(0);
    expect(backBox.y + backBox.height).toBeLessThanOrEqual(viewport.height);
    const hitId = await backButton.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.id;
    });
    expect(hitId).toBe('btn-back-to-lobby');

    if (viewport.width === 1280) {
      await expect(page.locator('#input-word')).toBeFocused();
      const hpBox = await page.locator('.hp-area').boundingBox();
      expect(backBox.x + backBox.width).toBeLessThanOrEqual(hpBox.x);
    } else {
      const fab = page.locator('#bw-fab');
      const fabBox = await fab.boundingBox();
      expect(fabBox.width).toBeGreaterThanOrEqual(44);
      expect(fabBox.height).toBeGreaterThanOrEqual(44);
      const fabHitId = await fab.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.id;
      });
      expect(fabHitId).toBe('bw-fab');
      const targetBoxes = await Promise.all([
        backButton.boundingBox(),
        page.locator('.hp-area').boundingBox(),
        page.locator('#game-canvas').boundingBox(),
        page.locator('#opp-canvas').boundingBox(),
        page.locator('#item-guide').boundingBox(),
        page.locator('#item-slots').boundingBox(),
        page.locator('#input-area').boundingBox(),
      ]);
      for (const box of targetBoxes) {
        const overlaps = !(
          fabBox.x + fabBox.width <= box.x
          || fabBox.x >= box.x + box.width
          || fabBox.y + fabBox.height <= box.y
          || fabBox.y >= box.y + box.height
        );
        expect(overlaps).toBe(false);
      }
    }
    await page.screenshot({ path: `tests/screenshots/${viewport.file}` });
  }
  expect(errors).toEqual([]);
});

test('복귀 확인 시 재연결 없이 통합 게임 선택 화면으로 이동한다', async ({ page }) => {
  await startAiGame(page);
  page.once('dialog', (dialog) => dialog.accept());
  await page.click('#btn-back-to-lobby');
  await page.waitForURL('http://127.0.0.1:3019/', { timeout: 5000 });
  await expect(page.locator('body')).toBeVisible();
  await page.waitForTimeout(3200);
  expect(page.url()).toBe('http://127.0.0.1:3019/');
});
