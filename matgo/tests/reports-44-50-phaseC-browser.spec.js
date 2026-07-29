/**
 * @fileoverview Phase C 뻑 풀이 메시지와 7장 동시 RESOLVE를 Chromium에서 검증한다.
 */

import { test, expect, chromium } from '@playwright/test';
import { buildDeck } from '../cards.js';

const BASE_URL = process.env.MATGO_BASE_URL || 'http://localhost:3013';
const BY_ID = Object.fromEntries(buildDeck().map((card) => [card.id, card]));

/** @param {object} state @returns {Promise<void>} 상태를 주입한다. */
async function inject(state) {
  await fetch(`${BASE_URL}/test/inject`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state),
  });
}

/** @param {string} lang @returns {Promise<{browser:object,p1:object,p2:object}>} 독립 매치를 연다. */
async function openMatch(lang = 'ko') {
  await fetch(`${BASE_URL}/test/reset`, { method: 'POST' });
  const browser = await chromium.launch();
  const p1 = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const p2 = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  for (const page of [p1, p2]) {
    await page.addInitScript(() => {
      window.__matgoFlies = [];
      window.__matgoTimelineEvents = [];
      window.__matgoDiagnostics = {};
    });
  }
  await p1.goto(`${BASE_URL}/?name=C-P1&lang=${lang}`);
  await p2.goto(`${BASE_URL}/?name=C-P2&lang=${lang}`);
  await Promise.all([p1.waitForSelector('#my-hand-cards .card'), p2.waitForSelector('#my-hand-cards .card')]);
  return { browser, p1, p2 };
}

test('#46 쪽 정산 완료 뒤 ko/en 뻑 풀이 메시지를 1회 표시한다', async () => {
  for (const [lang, expected] of [['ko', '뻑 풀이!'], ['en', 'Ppeok cleared!']]) {
    const { browser, p1, p2 } = await openMatch(lang);
    try {
      await inject({
        turn: 'p1', phase: 'awaiting_play',
        p1Hand: [BY_ID.m01_gwang, BY_ID.m08_pi_a], p2Hand: [BY_ID.m09_pi_a],
        floor: [BY_ID.m02_pi_a], deck: [BY_ID.m01_pi_a],
        captured: { p1: [], p2: [BY_ID.m06_pi_a] },
      });
      await Promise.all([p1, p2].map((page) => page.waitForFunction(
        () => document.querySelectorAll('#fly-overlay .flying-card').length === 0,
      )));
      await p1.evaluate(() => document.querySelector('.action-toast')?.classList.remove('show'));
      await p1.click('#my-hand-cards [data-card-id="m01_gwang"]');
      await p1.waitForFunction(() => document.querySelectorAll('#fly-overlay .flying-card').length > 0);
      await expect(p1.locator('.action-toast.show')).toHaveCount(0);
      if (lang === 'ko') {
        await p1.screenshot({
          path: 'tests/screenshots/reports-44-50-phaseC-46-fly-toast0.png',
          fullPage: true,
        });
      }
      await p1.waitForFunction(() => document.querySelectorAll('#fly-overlay .flying-card').length === 0);
      await expect(p1.locator('.action-toast.show')).toHaveText(expected);
      await expect(p1.locator('.action-toast')).toHaveCount(1);
      const offscreen = await p1.locator('[data-card-id]').evaluateAll((cards) => cards.filter((card) => {
        const rect = card.getBoundingClientRect();
        return rect.right < 0 || rect.bottom < 0 || rect.left > innerWidth || rect.top > innerHeight;
      }).length);
      expect(offscreen).toBe(0);
      if (lang === 'ko') {
        await p1.screenshot({
          path: 'tests/screenshots/reports-44-50-phaseC-46-final-ko.png',
          fullPage: true,
        });
      }
    } finally {
      await browser.close();
    }
  }
});

test('#50 강탈 피 선행 없이 7장이 동일 batch RESOLVE에서 이동한다', async () => {
  const { browser, p1, p2 } = await openMatch();
  try {
    await inject({
      turn: 'p1', phase: 'awaiting_play',
      p1Hand: [BY_ID.m01_gwang, BY_ID.m08_pi_a], p2Hand: [BY_ID.m09_pi_a],
      floor: [BY_ID.m01_tti_hong, BY_ID.m01_pi_a, BY_ID.m01_pi_b, BY_ID.m02_tti_hong],
      deck: [BY_ID.m02_kkeut_godori], captured: { p1: [], p2: [BY_ID.m06_pi_a] },
      ppeokFlags: { 1: 'p2' },
    });
    await Promise.all([p1, p2].map((page) => page.waitForFunction(
      () => document.querySelectorAll('#fly-overlay .flying-card').length === 0,
    )));
    await p1.evaluate(() => {
      window.__matgoFlies = [];
      window.__matgoTimelineEvents = [];
      window.__matgoDiagnostics = {};
      const oldToast = document.querySelector('.action-toast');
      if (oldToast) {
        oldToast.classList.remove('show');
        delete oldToast.dataset.toastKey;
      }
    });
    await p1.click('#my-hand-cards [data-card-id="m01_gwang"]');
    await p1.waitForFunction(() => window.__matgoTimelineEvents.some(
      (event) => event.name === 'HAND_LAND',
    ));
    expect((await p1.evaluate(() => window.__matgoFlies)).some(
      (fly) => fly.cardId === 'm06_pi_a',
    )).toBe(false);
    await p1.waitForFunction(() => window.__matgoTimelineEvents.some(
      (event) => event.name === 'RESOLVE' && event.activeCardIds.length === 7,
    ));
    const resolveEvent = await p1.evaluate(() => window.__matgoTimelineEvents.find(
      (event) => event.name === 'RESOLVE' && event.activeCardIds.length === 7,
    ));
    expect(resolveEvent.batchIds).toHaveLength(1);
    const targetTurnId = await p1.evaluate(
      () => window.__matgoDiagnostics.lastState.turnAction.turnId,
    );
    const targetToastKey =
      `${targetTurnId}|${resolveEvent.batchIds[0]}|sweep_from_hand|m01_gwang`;
    await expect(p1.locator(
      `.action-toast.show[data-toast-key="${targetToastKey}"]`,
    )).toHaveCount(0);
    await p1.screenshot({
      path: 'tests/screenshots/reports-44-50-phaseC-50-resolve-7.png',
      fullPage: true,
    });
    const settlement = await p1.evaluate(() => window.__matgoDiagnostics.lastState.turnAction.steps.find(
      (step) => step.type === 'SETTLE_CAPTURE_BATCH',
    ));
    expect(settlement.moves).toHaveLength(7);
    expect(new Set(settlement.moves.map((move) => move.cardId)).size).toBe(7);
    await p1.waitForFunction(() => document.querySelectorAll('#fly-overlay .flying-card').length === 0);
    await expect(p1.locator('#fly-overlay .flying-card')).toHaveCount(0);
    await expect(p1.locator(
      `.action-toast.show[data-toast-key="${targetToastKey}"]`,
    )).toHaveText('뻑 풀이!');
    await expect(p1.locator('.action-toast')).toHaveCount(1);
    const offscreen = await p1.locator('[data-card-id]').evaluateAll((cards) => cards.filter((card) => {
      const rect = card.getBoundingClientRect();
      return rect.right < 0 || rect.bottom < 0 || rect.left > innerWidth || rect.top > innerHeight;
    }).length);
    expect(offscreen).toBe(0);
    await p1.screenshot({
      path: 'tests/screenshots/reports-44-50-phaseC-50-final-7.png',
      fullPage: true,
    });
  } finally {
    await browser.close();
  }
});
