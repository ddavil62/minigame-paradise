/**
 * @fileoverview 교착 선택 UI, 5초 카운트다운, 재접속과 즉시 셔플을 실제 브라우저에서 검증한다.
 */
import { test, expect } from '@playwright/test';

test('교착에서 5초 대기와 즉시 셔플을 선택하고 재접속해도 상태를 복구한다', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('sichuan:locale', 'ko'));
  await page.goto('/?name=DeadlockQA&e2e=1');
  await page.locator('#ai-battle-button').click();
  await expect(page.locator('#board .tile')).toHaveCount(96, { timeout: 8_000 });
  await expect.poll(() => page.evaluate(() => window.__sichuanTestSnapshot()?.phase), { timeout: 6_000 }).toBe('playing');

  await page.evaluate(() => window.__sichuanTestSend({ type: 'TEST_TRIGGER_DEADLOCK' }));
  await expect(page.locator('#deadlock-panel')).toBeVisible();
  await expect(page.locator('#deadlock-title')).toHaveText('연결 가능한 짝이 없습니다');
  await expect(page.locator('#deadlock-shuffle-button')).toBeEnabled();
  await expect(page.locator('#deadlock-wait-button')).toBeEnabled();
  await expect(page.locator('#board .tile:enabled')).toHaveCount(0);
  await page.screenshot({ path: 'tests/screenshots/phase-f-deadlock-choice-1366x768-ko.png', fullPage: false });

  const timerBefore = await page.locator('#timer').textContent();
  await page.locator('#deadlock-wait-button').click();
  await expect(page.locator('#deadlock-actions')).toBeHidden();
  await expect(page.locator('#deadlock-countdown')).toBeVisible();
  await expect.poll(async () => Number(await page.locator('#deadlock-countdown').textContent())).toBeLessThanOrEqual(5);
  await page.waitForTimeout(1_100);
  expect(await page.locator('#timer').textContent()).not.toBe(timerBefore);
  await page.screenshot({ path: 'tests/screenshots/phase-f-deadlock-wait-1366x768-ko.png', fullPage: false });

  await page.reload();
  await expect(page.locator('#deadlock-panel')).toBeVisible({ timeout: 4_000 });
  await expect(page.locator('#deadlock-countdown')).toBeVisible();
  await expect.poll(async () => Number(await page.locator('#deadlock-countdown').textContent())).toBeLessThan(4.5);
  await expect(page.locator('#board .tile:enabled')).toHaveCount(0);
  await expect(page.locator('#deadlock-panel')).toBeHidden({ timeout: 6_000 });
  await expect.poll(() => page.evaluate(() => window.__sichuanBoardState().interactionEnabled), { timeout: 2_000 }).toBe(true);

  const revision = await page.evaluate(() => window.__sichuanTestSnapshot().me.board.revision);
  await page.evaluate(() => window.__sichuanTestSend({ type: 'TEST_TRIGGER_DEADLOCK' }));
  await expect(page.locator('#deadlock-panel')).toBeVisible();
  await page.locator('#deadlock-shuffle-button').click();
  await expect(page.locator('#deadlock-panel')).toBeHidden({ timeout: 2_000 });
  await expect.poll(() => page.evaluate(() => window.__sichuanTestSnapshot().me.board.revision)).toBe(revision + 1);

  await page.locator('#language-button').click();
  await page.evaluate(() => window.__sichuanTestSend({ type: 'TEST_TRIGGER_DEADLOCK' }));
  await expect(page.locator('#deadlock-title')).toHaveText('No legal pairs remain');
  await expect(page.locator('#deadlock-wait-button')).toHaveText('Wait 5 seconds');
  await page.evaluate(() => window.__sichuanTestSend({ type: 'LEAVE_MATCH' }));
});
