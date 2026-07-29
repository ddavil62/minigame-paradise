/**
 * @fileoverview Phase B 폭탄 staging과 손 조커 더미→손 보충 fly를 Chromium에서 검증한다.
 */

import { test, expect, chromium } from '@playwright/test';
import { buildDeck } from '../cards.js';

const BASE_URL = process.env.MATGO_BASE_URL || 'http://localhost:3013';
const BY_ID = Object.fromEntries(buildDeck().map((card) => [card.id, card]));

/** @param {object} state @returns {Promise<void>} 테스트 상태를 주입한다. */
async function inject(state) {
  const response = await fetch(`${BASE_URL}/test/inject`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state),
  });
  expect(response.ok).toBeTruthy();
}

/** @returns {Promise<{browser:object,p1:object,p2:object}>} 독립 1920×1080 매치를 연다. */
async function openMatch() {
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
  await p1.goto(`${BASE_URL}/?name=PhaseBP1`);
  await p2.goto(`${BASE_URL}/?name=PhaseBP2`);
  await Promise.all([p1.waitForSelector('#my-hand-cards .card'), p2.waitForSelector('#my-hand-cards .card')]);
  return { browser, p1, p2 };
}

test('#45 폭탄은 staging 뒤 단일 settlement로 끝난다', async () => {
  const { browser, p1, p2 } = await openMatch();
  try {
    await inject({
      turn: 'p1', phase: 'awaiting_play',
      p1Hand: [BY_ID.m01_gwang, BY_ID.m01_tti_hong, BY_ID.m01_pi_a],
      p2Hand: [BY_ID.m09_pi_a], floor: [BY_ID.m01_pi_b, BY_ID.m02_pi_a],
      deck: [BY_ID.m05_pi_a, BY_ID.m04_pi_a, BY_ID.m03_pi_a],
      captured: { p1: [], p2: [] }, shaking: { p1: false, p2: false },
    });
    await Promise.all([p1, p2].map((page) => page.waitForFunction(
      () => document.querySelectorAll('#fly-overlay .flying-card').length === 0,
    )));
    await p1.evaluate(() => {
      window.__matgoFlies = [];
      window.__matgoTimelineEvents = [];
      document.querySelector('.action-toast')?.classList.remove('show');
    });
    await p1.click('#my-hand-cards [data-card-id="m01_gwang"]');
    await p1.click('#btn-bomb-confirm');
    await p1.waitForFunction(() => window.__matgoTimelineEvents.some(
      (event) => event.name === 'HAND_LAND',
    ));
    expect(await p1.locator(
      '#my-captured-zone [data-card-id^="m01_"]',
    ).count()).toBe(0);
    await expect(p1.locator('.action-toast.show')).toHaveCount(0);
    await p1.screenshot({
      path: 'tests/screenshots/reports-44-50-phaseB-45-bomb-staging.png',
      fullPage: true,
    });
    await p1.waitForFunction(() => window.__matgoTimelineEvents.some(
      (event) => event.name === 'DECK_FLIP',
    ));
    await p1.screenshot({
      path: 'tests/screenshots/reports-44-50-phaseB-45-deck-flip.png',
      fullPage: true,
    });
    await expect.poll(async () => (await (await fetch(`${BASE_URL}/test/status`)).json()).settlementBatch)
      .not.toBeNull();
    const status = await (await fetch(`${BASE_URL}/test/status`)).json();
    const bombIds = new Set(['m01_gwang', 'm01_tti_hong', 'm01_pi_a', 'm01_pi_b']);
    expect(status.settlementBatch.moves.filter((move) => bombIds.has(move.cardId))).toHaveLength(4);
    expect(new Set(status.settlementBatch.moves.map((move) => move.cardId)).size)
      .toBe(status.settlementBatch.moves.length);
    await p1.waitForFunction(() => document.querySelectorAll('#fly-overlay .flying-card').length === 0);
    await expect(p1.locator('#fly-overlay .flying-card')).toHaveCount(0);
    await expect(p1.locator('.action-toast')).toHaveCount(1);
  } finally {
    await browser.close();
  }
});

test('#45 6장 변형도 하나의 고유 settlement batch로 끝난다', async () => {
  const { browser, p1, p2 } = await openMatch();
  try {
    await inject({
      turn: 'p1', phase: 'awaiting_play',
      p1Hand: [BY_ID.m01_gwang, BY_ID.m01_tti_hong, BY_ID.m01_pi_a],
      p2Hand: [BY_ID.m09_pi_a], floor: [BY_ID.m01_pi_b, BY_ID.m02_pi_a],
      deck: [BY_ID.m05_pi_a, BY_ID.m04_pi_a, BY_ID.m02_pi_b],
      captured: { p1: [], p2: [] }, shaking: { p1: false, p2: false },
    });
    await Promise.all([p1, p2].map((page) => page.waitForFunction(
      () => document.querySelectorAll('#fly-overlay .flying-card').length === 0,
    )));
    await p1.click('#my-hand-cards [data-card-id="m01_gwang"]');
    await p1.click('#btn-bomb-confirm');
    await expect.poll(async () => (await (await fetch(`${BASE_URL}/test/status`)).json()).settlementBatch)
      .not.toBeNull();
    const status = await (await fetch(`${BASE_URL}/test/status`)).json();
    const settlement = status.settlementBatch;
    expect(settlement.moves.filter((move) => move.sourceZone !== 'captured')).toHaveLength(6);
    expect(new Set(settlement.moves.map((move) => move.cardId)).size).toBe(settlement.moves.length);
    await p1.waitForFunction(() => document.querySelectorAll('#fly-overlay .flying-card').length === 0);
    await expect(p1.locator('#fly-overlay .flying-card')).toHaveCount(0);
  } finally {
    await browser.close();
  }
});

test('#49 손 조커 보충 카드는 deck에서 hand로 fly하고 조커 뒤에 공개된다', async () => {
  const { browser, p1, p2 } = await openMatch();
  try {
    await inject({
      turn: 'p1', phase: 'awaiting_play',
      p1Hand: [BY_ID.m00_joker_a], p2Hand: [BY_ID.m09_pi_a],
      floor: [BY_ID.m02_pi_a], deck: [BY_ID.m08_pi_a],
      captured: { p1: [], p2: [BY_ID.m06_pi_a] },
    });
    await Promise.all([p1, p2].map((page) => page.waitForFunction(
      () => document.querySelectorAll('#fly-overlay .flying-card').length === 0,
    )));
    await p1.evaluate(() => {
      window.__matgoFlies = [];
      window.__matgoTimelineEvents = [];
      document.querySelector('.action-toast')?.classList.remove('show');
    });
    await p1.click('#my-hand-cards [data-card-id="m00_joker_a"]');
    await p1.waitForFunction(() => window.__matgoFlies.some(
      (fly) => fly.cardId === 'm00_joker_a' && fly.origin === 'hand',
    ));
    await expect(p1.locator('#my-hand-cards [data-card-id="m08_pi_a"]')).toHaveCount(0);
    await expect(p1.locator('.action-toast.show')).toHaveCount(0);
    await p1.screenshot({
      path: 'tests/screenshots/reports-44-50-phaseB-49-joker-steal.png',
      fullPage: true,
    });
    await p1.waitForFunction(() => window.__matgoFlies.some(
      (fly) => fly.cardId === 'm08_pi_a' && fly.origin === 'deck',
    ));
    await p1.screenshot({
      path: 'tests/screenshots/reports-44-50-phaseB-49-refill-fly.png',
      fullPage: true,
    });
    const evidence = await p1.evaluate(() => ({
      flies: window.__matgoFlies,
      events: window.__matgoTimelineEvents,
    }));
    expect(evidence.flies.filter((fly) => fly.cardId === 'm00_joker_a' && fly.origin === 'hand'))
      .toHaveLength(1);
    expect(evidence.flies.filter((fly) => fly.cardId === 'm08_pi_a' && fly.origin === 'deck'))
      .toHaveLength(1);
    const handLand = evidence.events.findIndex((event) => event.name === 'HAND_LAND');
    const deckFlip = evidence.events.findIndex((event) => event.name === 'DECK_FLIP');
    expect(handLand).toBeGreaterThanOrEqual(0);
    expect(deckFlip).toBeGreaterThan(handLand);
    const settlement = await p1.evaluate(() => window.__matgoDiagnostics.lastState.turnAction.steps.find(
      (step) => step.type === 'SETTLE_CAPTURE_BATCH',
    ));
    expect(settlement.moves.map((move) => move.cardId)).toEqual(
      expect.arrayContaining(['m00_joker_a', 'm06_pi_a']),
    );
    await p1.waitForFunction(() => document.querySelectorAll('#fly-overlay .flying-card').length === 0);
    await expect(p1.locator('#fly-overlay .flying-card')).toHaveCount(0);
    await expect(p1.locator('.action-toast')).toHaveCount(1);
    const offscreen = await p1.locator('[data-card-id]').evaluateAll((cards) => cards.filter((card) => {
      const rect = card.getBoundingClientRect();
      return rect.right < 0 || rect.bottom < 0 || rect.left > innerWidth || rect.top > innerHeight;
    }).length);
    expect(offscreen).toBe(0);
  } finally {
    await browser.close();
  }
});
