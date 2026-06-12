/**
 * @fileoverview QA — 손패 정렬 버튼 2종 브라우저 검증.
 * AI 모드(?mode=ai)로 게임 시작 → 손패 영역 정렬 버튼 렌더/토글/localStorage/콘솔에러 확인.
 * 서버는 포트 3097(외부 사전 구동). 포트 3000 미사용.
 */
import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:3097';

test.describe('루미큐브 손패 정렬 버튼', () => {
  test('버튼 렌더 + 초기 active(색상순) + 토글 + localStorage 영속 + 콘솔에러 0', async ({ page }) => {
    const consoleErrors = [];
    const pageErrors = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', (e) => pageErrors.push(e.message));

    await page.goto(`${BASE}/?mode=ai`);

    // AI 모드: p1(인간)이 준비 완료를 눌러야 START. 봇은 자동 READY.
    await page.waitForSelector('#ready-btn', { state: 'visible', timeout: 15000 });
    await page.click('#ready-btn');

    // 게임 시작 대기 — 손패 영역에 타일이 렌더될 때까지.
    await page.waitForSelector('#screen-game:not(.hidden)', { timeout: 15000 });
    await page.waitForFunction(() => {
      const ha = document.getElementById('hand-area');
      return ha && ha.children.length >= 10;
    }, { timeout: 15000 });

    // 버튼 2개 존재.
    const btnColor = page.locator('#btn-sort-color');
    const btnNumber = page.locator('#btn-sort-number');
    await expect(btnColor).toBeVisible();
    await expect(btnNumber).toBeVisible();
    await expect(btnColor).toHaveText('색상순');
    await expect(btnNumber).toHaveText('숫자순');

    // 초기 active = 색상순.
    await expect(btnColor).toHaveClass(/active/);
    await expect(btnNumber).not.toHaveClass(/active/);
    await page.screenshot({ path: 'tests/screenshots/sort-initial-color.png', clip: { x: 0, y: 80, width: 1280, height: 420 } });

    // 손패 타일 순서 캡처(색상순).
    const colorOrder = await page.$$eval('#hand-area .tile', (els) =>
      els.map((e) => e.getAttribute('data-tile-id') || e.textContent.trim()));

    // 숫자순 클릭 → active 전환 + 재렌더.
    await btnNumber.click();
    await expect(btnNumber).toHaveClass(/active/);
    await expect(btnColor).not.toHaveClass(/active/);
    await page.waitForTimeout(150);
    const numberOrder = await page.$$eval('#hand-area .tile', (els) =>
      els.map((e) => e.getAttribute('data-tile-id') || e.textContent.trim()));
    await page.screenshot({ path: 'tests/screenshots/sort-number-active.png', clip: { x: 0, y: 80, width: 1280, height: 420 } });

    // 두 모드 정렬 결과가 동일 타일 집합(개수)이어야 함.
    expect(numberOrder.length).toBe(colorOrder.length);

    // localStorage 영속 확인.
    const stored = await page.evaluate(() => localStorage.getItem('rummikub.sortMode'));
    expect(stored).toBe('number');

    // 새로고침 후에도 숫자순 유지 — syncSortButtons()가 localStorage 값으로 active 복원.
    // (reload 시 게임 화면은 waiting으로 돌아가 버튼이 숨겨지지만, class는 즉시 복원됨)
    await page.reload();
    await page.waitForSelector('#btn-sort-number', { state: 'attached', timeout: 15000 });
    await expect(page.locator('#btn-sort-number')).toHaveClass(/active/);
    await expect(page.locator('#btn-sort-color')).not.toHaveClass(/active/);
    const storedAfterReload = await page.evaluate(() => localStorage.getItem('rummikub.sortMode'));
    expect(storedAfterReload).toBe('number');

    // 콘솔/페이지 에러 0 (favicon 404류는 무시).
    const realErrors = consoleErrors.filter((t) => !/favicon|404/.test(t));
    expect(pageErrors).toEqual([]);
    expect(realErrors).toEqual([]);
  });
});
