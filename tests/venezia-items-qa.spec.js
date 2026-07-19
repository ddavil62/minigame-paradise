/**
 * @fileoverview 베네치아 타이핑 배틀 아이템 시스템 QA 검증.
 *
 * 서버가 단일 룸을 운영하므로 각 테스트 간 룸 점유 충돌을 방지하기 위해
 * serial 모드로 실행하며, 각 테스트 종료 시 페이지를 닫아 WS를 해제한다.
 */

import { test, expect } from '@playwright/test';

/**
 * AI 게임을 시작하고 게임 화면이 활성화될 때까지 대기한다.
 * 방이 비어있어야 한다. 실패 시 에러를 던진다.
 */
async function startAiGame(page, name = 'QA') {
  // sessionStorage 초기화 + 직접 mode=ai URL 접속
  await page.goto('http://localhost:3000/venezia/?mode=ai');
  await page.waitForTimeout(300);

  // 닉네임 입력
  await page.fill('#input-name', name);

  // btn-ai 클릭 — mode=ai URL에서 btn-ai가 ws reconnect + bot spawn 트리거
  await page.click('#btn-ai');

  // GAME_START 수신으로 screen-game.active 전환 대기
  await page.waitForSelector('#screen-game.active', { timeout: 20000 });
}

test.describe.serial('베네치아 아이템 시스템 QA', () => {
  test.beforeEach(async ({ page }) => {
    // 각 테스트 시작 전 룸이 비어있는지 확인 (직접 WS 프로브)
    const roomFree = await page.evaluate(async () => {
      return new Promise((resolve) => {
        const ws = new WebSocket('ws://localhost:3000/venezia/ws?mode=human');
        let result = false;
        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            if (msg.type === 'JOINED' && msg.waiting === true) {
              result = true; // Room has space, we're p1 waiting
            } else if (msg.type === 'JOINED' && msg.waiting === false) {
              result = true; // Room had p1, we joined as p2
            } else if (msg.type === 'ERROR') {
              result = false; // Room full
            }
          } catch {}
          ws.close();
        };
        ws.onerror = () => { resolve(false); };
        ws.onclose = () => { resolve(result); };
        setTimeout(() => { try { ws.close(); } catch {} resolve(false); }, 3000);
      });
    });
    // WS probe disconnects which triggers server cleanup of our slot + any orphan
    // Give server time to clean up
    await page.waitForTimeout(2000);
  });

  test('AC-9: 3개 아이템 슬롯 표시 + AC-11: 위치 검증', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    await startAiGame(page, 'SlotTest');

    // 3개 슬롯 존재 확인
    await expect(page.locator('#item-slot-0')).toBeVisible();
    await expect(page.locator('#item-slot-1')).toBeVisible();
    await expect(page.locator('#item-slot-2')).toBeVisible();

    // 단독 숫자키 레이블
    await expect(page.locator('#item-slot-0 .item-slot-key')).toHaveText('1');
    await expect(page.locator('#item-slot-1 .item-slot-key')).toHaveText('2');
    await expect(page.locator('#item-slot-2 .item-slot-key')).toHaveText('3');

    // 위치: boards-row 아래, input-area 위
    const boardsRowBox = await page.locator('.boards-row').boundingBox();
    const itemSlotsBox = await page.locator('#item-slots').boundingBox();
    const inputAreaBox = await page.locator('#input-area').boundingBox();
    expect(itemSlotsBox.y).toBeGreaterThanOrEqual(boardsRowBox.y + boardsRowBox.height - 5);
    expect(itemSlotsBox.y + itemSlotsBox.height).toBeLessThanOrEqual(inputAreaBox.y + 5);

    // 스크린샷
    await page.screenshot({ path: 'tests/screenshots/venezia-slots-layout.png' });

    expect(errors).toEqual([]);
  });

  test('AC-10: AI 대전이 에러 없이 시작된다', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    await startAiGame(page, 'StartTest');

    // Canvas 표시
    await expect(page.locator('#game-canvas')).toBeVisible();

    // HP 초기값
    await expect(page.locator('#my-hp-value')).toHaveText('100');
    await expect(page.locator('#opp-hp-value')).toHaveText('100');

    // effect-overlay 초기 hidden
    await expect(page.locator('#effect-overlay')).toHaveClass(/hidden/);

    // 타이머 동작 (2초 후 00:00이 아님)
    await page.waitForTimeout(2000);
    const timer = await page.locator('#timer-display').textContent();
    expect(timer).not.toBe('00:00');

    expect(errors).toEqual([]);
  });

  test('AC-12: 서버 안정성 — 25초 플레이 중 크래시 없음', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    await startAiGame(page, 'Stability');

    // 25초 대기
    await page.waitForTimeout(25000);

    // 서버 alive
    const resp = await page.request.get('http://localhost:3000/venezia/');
    expect(resp.status()).toBe(200);

    // 게임 or 결과 화면 (크래시 아님)
    const gameActive = await page.locator('#screen-game.active').count();
    const resultActive = await page.locator('#screen-result.active').count();
    expect(gameActive + resultActive).toBeGreaterThanOrEqual(1);

    // 스크린샷
    await page.screenshot({ path: 'tests/screenshots/venezia-25s-stable.png' });

    expect(errors).toEqual([]);
  });

  test('예외: 빈 슬롯 1/2/3 연타 시 에러 없음', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    await startAiGame(page, 'AltTest');

    // 빈 슬롯 연타
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('1');
      await page.keyboard.press('2');
      await page.keyboard.press('3');
      await page.waitForTimeout(50);
    }
    await page.waitForTimeout(1000);
    expect(errors).toEqual([]);
  });

  test('예외: 모바일 뷰포트(375x667) 슬롯 렌더링', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    await startAiGame(page, 'Mobile');

    // 슬롯이 뷰포트 내에 렌더링
    const slotsBox = await page.locator('#item-slots').boundingBox();
    expect(slotsBox).not.toBeNull();
    expect(slotsBox.x).toBeGreaterThanOrEqual(0);
    expect(slotsBox.x + slotsBox.width).toBeLessThanOrEqual(376);

    await page.screenshot({ path: 'tests/screenshots/venezia-mobile.png' });
    expect(errors).toEqual([]);
  });

  test('아이템 드랍 및 이펙트 관찰 (35초)', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    await startAiGame(page, 'ItemWatch');

    // 35초 동안 게임 진행 관찰
    // 봇이 이펙트를 사용하거나, 플레이어가 콤보를 못 쌓아 아이템 미획득일 수도
    const observations = await page.evaluate(() => {
      return new Promise((resolve) => {
        const obs = { items: [], effects: [], errors: [] };

        // 슬롯 변화 감시
        const slotsObserver = new MutationObserver(() => {
          for (let i = 0; i < 3; i++) {
            const slot = document.getElementById(`item-slot-${i}`);
            if (slot && slot.classList.contains('filled')) {
              const emoji = slot.querySelector('.item-slot-emoji')?.textContent;
              const name = slot.querySelector('.item-slot-name')?.textContent;
              obs.items.push({ slot: i, emoji, name, time: Date.now() });
            }
          }
        });
        slotsObserver.observe(document.getElementById('item-slots'), {
          subtree: true, attributes: true, childList: true, characterData: true,
        });

        // 암흑 overlay 변화 감시
        const effectObserver = new MutationObserver(() => {
          const overlay = document.getElementById('effect-overlay');
          if (!overlay.classList.contains('hidden')) {
            obs.effects.push({
              dark: overlay.classList.contains('dark-active'),
              text: overlay.textContent,
              time: Date.now(),
            });
          }
        });
        effectObserver.observe(document.getElementById('effect-overlay'), {
          attributes: true, attributeFilter: ['class'],
        });

        const rapidsObserver = new MutationObserver(() => {
          const overlay = document.getElementById('fast-fall-overlay-my');
          if (!overlay.classList.contains('hidden')) {
            obs.effects.push({ fastFall: true, text: overlay.textContent, time: Date.now() });
          }
        });
        rapidsObserver.observe(document.getElementById('fast-fall-overlay-my'), {
          attributes: true, attributeFilter: ['class'],
        });

        setTimeout(() => {
          slotsObserver.disconnect();
          effectObserver.disconnect();
          rapidsObserver.disconnect();
          resolve(obs);
        }, 33000);
      });
    });

    console.log('Items observed:', JSON.stringify(observations.items));
    console.log('Effects observed:', JSON.stringify(observations.effects));

    await page.screenshot({ path: 'tests/screenshots/venezia-observation-35s.png' });

    expect(errors).toEqual([]);
  });

  test('콘솔 에러 없이 로딩 + 대기 화면', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto('http://localhost:3000/venezia/');
    await page.waitForTimeout(2000);

    // 대기 화면 요소 확인
    await expect(page.locator('#screen-waiting')).toHaveClass(/active/);
    await expect(page.locator('#btn-join')).toBeVisible();
    await expect(page.locator('#btn-ai')).toBeVisible();

    expect(errors).toEqual([]);
  });
});
