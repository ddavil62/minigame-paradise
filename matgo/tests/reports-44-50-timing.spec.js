/**
 * @fileoverview 리포트 #44의 손패 안착→더미 출발 간격과 runner 정리를 반복 검증한다.
 */

import { test, expect, chromium } from '@playwright/test';
import { buildDeck } from '../cards.js';

const BASE_URL = process.env.MATGO_BASE_URL || 'http://localhost:3013';
const BY_ID = Object.fromEntries(buildDeck().map((card) => [card.id, card]));

/** @returns {Promise<void>} 공유 테스트 방을 초기화한다. */
async function resetServer() {
  await fetch(`${BASE_URL}/test/reset`, { method: 'POST' });
}

/**
 * @param {object} state 주입할 권위 상태
 * @returns {Promise<void>}
 */
async function inject(state) {
  const response = await fetch(`${BASE_URL}/test/inject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state),
  });
  expect(response.ok).toBeTruthy();
}

/** @returns {Promise<object>} runner 진단 상태를 반환한다. */
async function status() {
  return (await fetch(`${BASE_URL}/test/status`)).json();
}

const ITERATIONS = Number(process.env.MATGO_TIMING_ITERATIONS || 5);

test(`#44 ${ITERATIONS}회: 상대 손 안착 뒤 더미 출발은 최대 500ms이고 runner 타이머가 남지 않는다`, async () => {
  await resetServer();
  const browser = await chromium.launch();
  const context1 = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const context2 = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const p1 = await context1.newPage();
  const p2 = await context2.newPage();
  for (const page of [p1, p2]) {
    await page.addInitScript(() => {
      window.__matgoFlies = [];
      window.__matgoTimelineEvents = [];
      window.__matgoDiagnostics = {};
    });
  }
  try {
    await p1.goto(`${BASE_URL}/?name=44관전자`);
    await p2.goto(`${BASE_URL}/?name=44상대`);
    await Promise.all([
      p1.waitForSelector('#my-hand-cards .card'),
      p2.waitForSelector('#my-hand-cards .card'),
    ]);

    const gaps = [];
    const recoveryBaseline = (await status()).stepRecoveryCount;
    for (let iteration = 0; iteration < ITERATIONS; iteration++) {
      await inject({
        turn: 'p2',
        phase: 'awaiting_play',
        p1Hand: [BY_ID.m09_pi_a],
        p2Hand: [BY_ID.m08_pi_a],
        floor: [BY_ID.m02_pi_a],
        deck: [BY_ID.m03_pi_a],
        captured: { p1: [], p2: [] },
        bombDeckCredit: { p1: 0, p2: 0 },
        pendingBombFlips: { p1: 0, p2: 0 },
        bombResolvingPlayer: null,
        roundResult: null,
      });
      await p1.waitForFunction(() => document.querySelectorAll('#fly-overlay .flying-card').length === 0);
      await p1.evaluate(() => {
        window.__matgoFlies = [];
        window.__matgoTimelineEvents = [];
      });
      await p2.click('#my-hand-cards [data-card-id="m08_pi_a"]');
      await p1.waitForFunction(() => {
        const events = window.__matgoTimelineEvents || [];
        return events.some((event) => event.name === 'HAND_LAND')
          && events.some((event) => event.name === 'DECK_FLIP')
          && document.querySelectorAll('#fly-overlay .flying-card').length === 0;
      });
      const gap = await p1.evaluate(() => {
        const events = window.__matgoTimelineEvents;
        const handEnd = events.find((event) => event.name === 'HAND_LAND');
        const deckStart = events.find((event) => event.name === 'DECK_FLIP' && event.t >= handEnd.t);
        return deckStart.t - handEnd.t;
      });
      gaps.push(gap);
      expect(gap).toBeLessThanOrEqual(500);
      await expect.poll(status).toMatchObject({
        stepInProgress: false,
        activeStepTimerCount: 0,
      });
    }
    const sorted = [...gaps].sort((a, b) => a - b);
    expect(sorted[Math.ceil(sorted.length * 0.95) - 1]).toBeLessThanOrEqual(250);
    const finalStatus = await status();
    expect(finalStatus.stepRecoveryCount).toBe(recoveryBaseline);
    console.log(JSON.stringify({
      iterations: ITERATIONS,
      gaps,
      p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
      max: Math.max(...gaps),
      recoveryDelta: finalStatus.stepRecoveryCount - recoveryBaseline,
      activeStepTimerCount: finalStatus.activeStepTimerCount,
    }));
  } finally {
    await browser.close();
  }
});
