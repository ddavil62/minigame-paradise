/**
 * @fileoverview 특수 포획 효과가 해당 turn/batch의 최종 fly 뒤 한 번만 표시되는지 검증한다.
 */

import { test, expect, chromium } from '@playwright/test';
import { buildDeck } from '../cards.js';

const BASE_URL = process.env.MATGO_BASE_URL || 'http://localhost:3013';
const BY_ID = Object.fromEntries(buildDeck().map((card) => [card.id, card]));

/**
 * 카드 ID 배열을 서버 주입용 카드 객체 배열로 변환한다.
 *
 * @param {...string} ids
 * @returns {object[]}
 */
function cards(...ids) {
  return ids.map((id) => BY_ID[id]);
}

/**
 * 테스트 서버의 공유 방을 초기화한다.
 *
 * @returns {Promise<void>}
 */
async function resetServer() {
  const response = await fetch(`${BASE_URL}/test/reset`, { method: 'POST' });
  if (!response.ok) throw new Error(`테스트 서버 초기화 실패: ${response.status}`);
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
  const result = await response.json();
  if (!result.ok) throw new Error(result.error);
}

/**
 * READY가 끝난 두 플레이어 브라우저를 연다.
 *
 * @returns {Promise<{browser:import('@playwright/test').Browser,p1:import('@playwright/test').Page,p2:import('@playwright/test').Page}>}
 */
async function openMatch() {
  await resetServer();
  const browser = await chromium.launch();
  const first = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const second = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const p1 = await first.newPage();
  const p2 = await second.newPage();
  await p1.addInitScript(() => { window.__matgoFlies = []; });
  await p1.goto(`${BASE_URL}/?name=토스트P1`);
  await p2.goto(`${BASE_URL}/?name=토스트P2`);
  await Promise.all([
    p1.waitForSelector('#my-hand-cards .card', { timeout: 10000 }),
    p2.waitForSelector('#my-hand-cards .card', { timeout: 10000 }),
  ]);
  return { browser, p1, p2 };
}

/**
 * fly 진행 중 toast 0개, 최종 clone 제거 뒤 toast 1개를 확인한다.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} expectedText
 * @param {string} finalFlyCardId 최종 정산에 포함되는 대표 카드 ID
 * @returns {Promise<void>}
 */
async function expectToastAfterFinalFly(page, expectedText, finalFlyCardId) {
  await page.waitForFunction(
    (cardId) => window.__matgoFlies?.some((fly) => fly.cardId === cardId),
    finalFlyCardId,
    { timeout: 8000 },
  );
  await page.waitForSelector(
    `#fly-overlay .flying-card[data-card-id="${finalFlyCardId}"]`,
    { state: 'visible', timeout: 8000 },
  );
  const overlapDuringFly = await page.evaluate(() => ({
    observed: window.__toastOverlapObserved,
    events: window.__toastOverlapEvents,
  }));
  expect(overlapDuringFly.events, JSON.stringify(overlapDuringFly.events)).toEqual([]);
  await page.waitForFunction(
    () => document.querySelectorAll('#fly-overlay .flying-card').length === 0,
    { timeout: 15000 },
  );
  await expect(page.locator('.action-toast.show')).toHaveCount(1);
  await expect(page.locator('.action-toast.show')).toContainText(expectedText);
  const overlapAfterFly = await page.evaluate(() => ({
    observed: window.__toastOverlapObserved,
    events: window.__toastOverlapEvents,
  }));
  expect(overlapAfterFly.events, JSON.stringify(overlapAfterFly.events)).toEqual([]);
}

/**
 * 상태 주입에서 생긴 fly를 비우고 액션 계측을 초기화한다.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
async function prepareAction(page) {
  await page.waitForFunction(
    () => document.querySelectorAll('#fly-overlay .flying-card').length === 0,
    { timeout: 10000 },
  );
  await page.evaluate(() => {
    window.__matgoFlies = [];
    document.querySelector('.action-toast')?.classList.remove('show');
    window.__toastOverlapObserved = false;
    window.__toastOverlapEvents = [];
    if (window.__toastOverlapObserver) window.__toastOverlapObserver.disconnect();
    /**
     * fly와 전면 toast가 한 프레임이라도 겹쳤는지 기록한다.
     *
     * @returns {void}
     */
    const recordOverlap = () => {
      const hasFly = document.querySelector('#fly-overlay .flying-card') !== null;
      const hasToast = document.querySelector('.action-toast.show') !== null;
      if (hasFly && hasToast) {
        window.__toastOverlapObserved = true;
        window.__toastOverlapEvents.push({
          t: performance.now(),
          toast: document.querySelector('.action-toast.show')?.textContent || '',
          flyIds: [...document.querySelectorAll('#fly-overlay .flying-card')]
            .map((element) => element.dataset.cardId),
        });
      }
    };
    window.__toastOverlapObserver = new MutationObserver(recordOverlap);
    window.__toastOverlapObserver.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class'],
    });
    recordOverlap();
  });
}

test.describe.configure({ mode: 'serial' });

test('조커 효과는 강탈 포함 최종 fly 뒤 한 번만 표시된다', async () => {
  const { browser, p1 } = await openMatch();
  try {
    await inject({
      turn: 'p1',
      phase: 'awaiting_play',
      p1Hand: cards('m00_joker_a', 'm07_pi_a'),
      p2Hand: cards('m06_kkeut'),
      floor: cards('m08_pi_b'),
      deck: cards('m11_pi_b'),
      captured: { p1: [], p2: cards('m05_pi_a') },
    });
    await prepareAction(p1);
    await p1.click('#my-hand-cards [data-card-id="m00_joker_a"]');
    await expectToastAfterFinalFly(p1, '조커', 'm05_pi_a');
  } finally {
    await browser.close();
  }
});

test('쪽 효과는 강탈 포함 최종 fly 뒤 한 번만 표시된다', async () => {
  const { browser, p1 } = await openMatch();
  try {
    await inject({
      turn: 'p1',
      phase: 'awaiting_play',
      p1Hand: cards('m05_kkeut', 'm01_pi_a'),
      p2Hand: cards('m06_kkeut'),
      floor: cards('m07_tti_cho'),
      deck: cards('m05_pi_a'),
      captured: { p1: [], p2: cards('m07_pi_a') },
    });
    await prepareAction(p1);
    await p1.click('#my-hand-cards [data-card-id="m05_kkeut"]');
    await expectToastAfterFinalFly(p1, '쪽', 'm07_pi_a');
  } finally {
    await browser.close();
  }
});

test('쓸 효과는 네 장과 강탈 피의 최종 fly 뒤 한 번만 표시된다', async () => {
  const { browser, p1 } = await openMatch();
  try {
    await inject({
      turn: 'p1',
      phase: 'awaiting_play',
      p1Hand: cards('m01_gwang', 'm05_kkeut'),
      p2Hand: cards('m06_kkeut'),
      floor: cards('m01_tti_hong', 'm02_tti_hong'),
      deck: cards('m02_kkeut_godori'),
      captured: { p1: [], p2: cards('m06_pi_a') },
    });
    await prepareAction(p1);
    await p1.click('#my-hand-cards [data-card-id="m01_gwang"]');
    await expectToastAfterFinalFly(p1, '쓸', 'm06_pi_a');
  } finally {
    await browser.close();
  }
});

test('따닥 효과는 선택 정산과 강탈 피의 최종 fly 뒤 한 번만 표시된다', async () => {
  const { browser, p1 } = await openMatch();
  try {
    await inject({
      turn: 'p1',
      phase: 'awaiting_play',
      p1Hand: cards('m01_gwang', 'm07_pi_a'),
      p2Hand: cards('m08_pi_a'),
      floor: cards('m01_tti_hong', 'm01_pi_a'),
      deck: cards('m01_pi_b'),
      captured: { p1: [], p2: cards('m06_pi_a') },
    });
    await prepareAction(p1);
    await p1.click('#my-hand-cards [data-card-id="m01_gwang"]');
    await p1.waitForSelector('#floor-choice-modal:not(.hidden)', { timeout: 8000 });
    await p1.click('#floor-choice-cards [data-card-id="m01_tti_hong"]');
    await expectToastAfterFinalFly(p1, '따닥', 'm06_pi_a');
  } finally {
    await browser.close();
  }
});

test('폭탄 효과는 추가 뒤집기 전체의 최종 fly 뒤 한 번만 표시된다', async () => {
  const { browser, p1 } = await openMatch();
  try {
    await inject({
      turn: 'p1',
      phase: 'awaiting_play',
      p1Hand: cards('m05_kkeut', 'm05_tti_cho', 'm05_pi_a', 'm01_pi_a'),
      p2Hand: cards('m06_kkeut'),
      floor: cards('m05_pi_b', 'm07_tti_cho'),
      deck: cards('m02_pi_a', 'm03_pi_a', 'm04_pi_a'),
      captured: { p1: [], p2: cards('m08_pi_a') },
    });
    await prepareAction(p1);
    await p1.click('#my-hand-cards [data-card-id="m05_kkeut"]');
    await p1.waitForSelector('#bomb-confirm-modal:not(.hidden)', { timeout: 5000 });
    await p1.click('#btn-bomb-confirm');
    await expectToastAfterFinalFly(p1, '폭탄', 'm08_pi_a');
  } finally {
    await browser.close();
  }
});
