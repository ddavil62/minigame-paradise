/**
 * @fileoverview 사용자 리포트 27·28·30의 맞고 브라우저 UI 회귀 테스트.
 */

import { test, expect, chromium } from '@playwright/test';
import { buildDeck } from '../cards.js';

const BASE_URL = 'http://localhost:3013';
const BY_ID = Object.fromEntries(buildDeck().map((card) => [card.id, card]));

/**
 * 테스트 서버 상태를 초기화한다.
 *
 * @returns {Promise<void>}
 */
async function resetServer() {
  await fetch(`${BASE_URL}/test/reset`, { method: 'POST' });
}

/**
 * 결정적 게임 상태를 주입한다.
 *
 * @param {object} state
 * @returns {Promise<void>}
 */
async function inject(state) {
  const response = await fetch(`${BASE_URL}/test/inject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state),
  });
  expect(response.ok).toBe(true);
}

/**
 * 두 플레이어 페이지를 접속시킨다.
 *
 * @param {import('@playwright/test').Browser} browser
 * @returns {Promise<{p1:import('@playwright/test').Page,p2:import('@playwright/test').Page}>}
 */
async function joinPair(browser) {
  const p1 = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const p2 = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await p1.goto(`${BASE_URL}/?name=리포트P1`);
  await p2.goto(`${BASE_URL}/?name=리포트P2`);
  await p1.waitForSelector('#my-hand-cards .card');
  await p1.waitForFunction(
    () => (document.getElementById('fly-overlay')?.childElementCount || 0) === 0,
    { timeout: 8000 },
  );
  await p2.waitForFunction(
    () => (document.getElementById('fly-overlay')?.childElementCount || 0) === 0,
    { timeout: 8000 },
  );
  return { p1, p2 };
}

test('R27/R28: 매칭 카드는 비스듬히 부착되고 손패 호버는 잘리지 않는다', async () => {
  await resetServer();
  const browser = await chromium.launch();
  try {
    const { p1 } = await joinPair(browser);
    await inject({
      turn: 'p1',
      phase: 'awaiting_play',
      p1Hand: [BY_ID.m01_gwang, BY_ID.m05_kkeut],
      p2Hand: [BY_ID.m06_kkeut],
      floor: [BY_ID.m01_tti_hong, BY_ID.m07_pi_a],
      deck: [BY_ID.m08_kkeut_godori],
      captured: { p1: [], p2: [] },
    });
    await p1.waitForFunction(
      () => (document.getElementById('fly-overlay')?.childElementCount || 0) === 0,
      { timeout: 8000 },
    );

    const handCard = p1.locator('#my-hand-cards [data-card-id="m01_gwang"]');
    await handCard.hover();
    const clipping = await p1.evaluate(() => ({
      zone: getComputedStyle(document.querySelector('.my-hand-zone')).overflow,
      cards: getComputedStyle(document.querySelector('#my-hand-cards')).overflow,
    }));
    expect(clipping).toEqual({ zone: 'visible', cards: 'visible' });

    await handCard.click();
    await p1.waitForFunction(() => {
      const thrown = document.querySelector('#fly-overlay [data-card-id="m01_gwang"]');
      const pair = document.querySelector('#fly-overlay [data-card-id="m01_tti_hong"]');
      if (!thrown || !pair) return false;
      const a = thrown.getBoundingClientRect();
      const b = pair.getBoundingClientRect();
      const distance = Math.hypot(a.left - b.left, a.top - b.top);
      return distance >= 6 && distance <= 24
        && getComputedStyle(thrown).transform !== 'none';
    }, { timeout: 5000 });
    await p1.screenshot({ path: 'tests/screenshots/reports-27-28-matgo-ui.png' });
  } finally {
    await browser.close();
  }
});

test('R30: 상대가 먼저 소진해도 내 마지막 9월 패를 직접 선택한다', async () => {
  await resetServer();
  const browser = await chromium.launch();
  try {
    const { p1, p2 } = await joinPair(browser);
    await inject({
      turn: 'p2',
      phase: 'awaiting_play',
      p1Hand: [BY_ID.m09_kkeut],
      p2Hand: [BY_ID.m09_pi_a],
      floor: [],
      deck: [BY_ID.m07_kkeut, BY_ID.m08_kkeut_godori],
      captured: { p1: [], p2: [] },
    });
    await p1.waitForFunction(
      () => (document.getElementById('fly-overlay')?.childElementCount || 0) === 0,
      { timeout: 8000 },
    );
    await p2.waitForFunction(
      () => (document.getElementById('fly-overlay')?.childElementCount || 0) === 0,
      { timeout: 8000 },
    );

    await p2.click('#my-hand-cards [data-card-id="m09_pi_a"]');
    await expect(p1.locator('#my-hand-cards [data-card-id="m09_kkeut"]')).toBeVisible({ timeout: 8000 });
    await expect(p1.locator('#action-display')).toContainText('손에서 카드 1장을');

    await p1.click('#my-hand-cards [data-card-id="m09_kkeut"]');
    await expect(p1.locator('#kkeut-modal')).not.toHaveClass(/hidden/, { timeout: 8000 });
    await expect(p1.locator('#my-captured-zone [data-card-id="m09_kkeut"]')).toBeVisible();
    await expect(p1.locator('#floor-cards [data-card-id="m07_kkeut"]')).toBeVisible();
  } finally {
    await browser.close();
  }
});
