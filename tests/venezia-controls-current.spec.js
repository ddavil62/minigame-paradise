/**
 * @fileoverview 베네치아 숫자키·급류 UI·정답 무피해 규칙의 현재 E2E 회귀 테스트.
 */

import { test, expect } from '@playwright/test';

/**
 * AI 대전을 시작한다.
 * @param {import('@playwright/test').Page} page 테스트 페이지
 */
async function startAiGame(page) {
  await page.goto('http://localhost:3000/venezia/?mode=ai');
  await page.fill('#input-name', 'CurrentQA');
  await page.click('#btn-ai');
  await page.waitForSelector('#screen-game.active', { timeout: 15000 });
}

test.describe.serial('베네치아 현재 아이템 조작', () => {
  test('Digit/Numpad는 단어 입력창에서 우선되고 IME·수정키·편집 요소는 보호한다', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await startAiGame(page);

    await expect(page.locator('.item-slot-key')).toHaveText(['1', '2', '3']);
    await expect(page.locator('body')).not.toContainText('Alt+');
    await expect(page.locator('body')).not.toContainText('빙결');
    await expect(page.locator('#input-word')).toBeFocused();

    const policy = await page.evaluate(() => {
      const wordInput = document.getElementById('input-word');
      const dispatch = (target, init) => {
        const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
        return !target.dispatchEvent(event);
      };
      const edit = document.createElement('input');
      edit.id = 'temporary-editor';
      document.body.appendChild(edit);
      const result = {
        digit: dispatch(wordInput, { code: 'Digit1', key: '1' }),
        numpad: dispatch(wordInput, { code: 'Numpad3', key: '3' }),
        alt: dispatch(wordInput, { code: 'Digit1', key: '1', altKey: true }),
        shift: dispatch(wordInput, { code: 'Digit1', key: '!', shiftKey: true }),
        composing: dispatch(wordInput, { code: 'Digit1', key: '1', isComposing: true }),
        process: dispatch(wordInput, { code: 'Digit1', key: 'Process' }),
        editable: dispatch(edit, { code: 'Digit1', key: '1' }),
      };
      edit.remove();
      return result;
    });
    expect(policy).toEqual({
      digit: true,
      numpad: true,
      alt: false,
      shift: false,
      composing: false,
      process: false,
      editable: false,
    });

    await page.locator('#input-word').fill('');
    await page.keyboard.press('Digit1');
    await page.keyboard.press('Numpad2');
    await expect(page.locator('#input-word')).toHaveValue('');

    await expect(page.locator('#fast-fall-overlay-my')).toHaveClass(/hidden/);
    await expect(page.locator('#fast-fall-overlay-opp')).toHaveClass(/hidden/);
    await expect(page.locator('#input-word')).toBeEnabled();

    await page.waitForTimeout(5000);
    await expect(page.locator('#my-hp-value')).toHaveText('100');
    await expect(page.locator('#opp-hp-value')).toHaveText('100');
    await expect(page.locator('.shaking')).toHaveCount(0);

    // 시각 회귀 캡처에서는 급류 슬롯과 비차단 상태 배지를 고정 fixture로 표시한다.
    await page.evaluate(() => {
      const slot = document.getElementById('item-slot-1');
      slot.classList.add('filled');
      slot.querySelector('.item-slot-emoji').textContent = '🌊';
      slot.querySelector('.item-slot-name').textContent = '급류';
      slot.setAttribute('aria-label', '2, 급류');
      const overlay = document.getElementById('fast-fall-overlay-opp');
      overlay.textContent = '🌊 급류! 낙하 속도 2배';
      overlay.classList.remove('hidden');
    });
    await page.waitForTimeout(350);

    const viewports = [
      { width: 1280, height: 720, file: 'venezia-controls-1280x720.png' },
      { width: 1024, height: 768, file: 'venezia-controls-1024x768.png' },
      { width: 390, height: 844, file: 'venezia-controls-390x844.png' },
    ];
    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      if (viewport.width === 390) {
        await page.locator('#input-area').scrollIntoViewIfNeeded();
        const slotsBox = await page.locator('#item-slots').boundingBox();
        const inputBox = await page.locator('#input-area').boundingBox();
        const submitBox = await page.locator('#btn-submit').boundingBox();
        const bugButtonBox = await page.locator('#bw-fab').boundingBox();
        expect(submitBox.width).toBeGreaterThanOrEqual(44);
        expect(submitBox.height).toBeGreaterThanOrEqual(44);
        expect(bugButtonBox.width).toBeGreaterThanOrEqual(44);
        expect(bugButtonBox.height).toBeGreaterThanOrEqual(44);
        expect(slotsBox.y).toBeGreaterThanOrEqual(0);
        expect(slotsBox.y + slotsBox.height).toBeLessThanOrEqual(viewport.height);
        expect(inputBox.y + inputBox.height).toBeLessThanOrEqual(viewport.height);
        const overlapsInput = !(
          bugButtonBox.x + bugButtonBox.width <= inputBox.x
          || bugButtonBox.x >= inputBox.x + inputBox.width
          || bugButtonBox.y + bugButtonBox.height <= inputBox.y
          || bugButtonBox.y >= inputBox.y + inputBox.height
        );
        expect(overlapsInput).toBe(false);
        const overlapsSlots = !(
          bugButtonBox.x + bugButtonBox.width <= slotsBox.x
          || bugButtonBox.x >= slotsBox.x + slotsBox.width
          || bugButtonBox.y + bugButtonBox.height <= slotsBox.y
          || bugButtonBox.y >= slotsBox.y + slotsBox.height
        );
        const overlapsSubmit = !(
          bugButtonBox.x + bugButtonBox.width <= submitBox.x
          || bugButtonBox.x >= submitBox.x + submitBox.width
          || bugButtonBox.y + bugButtonBox.height <= submitBox.y
          || bugButtonBox.y >= submitBox.y + submitBox.height
        );
        expect(overlapsSlots).toBe(false);
        expect(overlapsSubmit).toBe(false);
        const hitTargets = await page.evaluate(() => {
          const ids = ['input-word', 'btn-submit', 'item-slot-0', 'item-slot-1', 'item-slot-2', 'bw-fab'];
          return ids.map((id) => {
            const element = document.getElementById(id);
            const rect = element.getBoundingClientRect();
            const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
            return { id, hitId: hit?.closest?.('[id]')?.id || hit?.id || '' };
          });
        });
        expect(hitTargets).toEqual([
          { id: 'input-word', hitId: 'input-word' },
          { id: 'btn-submit', hitId: 'btn-submit' },
          { id: 'item-slot-0', hitId: 'item-slot-0' },
          { id: 'item-slot-1', hitId: 'item-slot-1' },
          { id: 'item-slot-2', hitId: 'item-slot-2' },
          { id: 'bw-fab', hitId: 'bw-fab' },
        ]);
      }
      await page.screenshot({ path: `tests/screenshots/${viewport.file}` });
    }
    expect(errors).toEqual([]);
  });
});
