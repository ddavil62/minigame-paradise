/**
 * @fileoverview 리포트 #47·#48의 손패 출처와 fly 단일 재생을 결정론·Chromium으로 검증한다.
 */

import { test, expect, chromium } from '@playwright/test';
import { buildDeck } from '../cards.js';
import { playCard, snapshotForPlayer } from '../game.js';

const BASE_URL = process.env.MATGO_BASE_URL || 'http://localhost:3013';
const BY_ID = Object.fromEntries(buildDeck().map((card) => [card.id, card]));

/** @returns {object} 규칙 테스트용 최소 게임 상태를 만든다. */
function makeGame() {
  return {
    deck: [BY_ID.m03_pi_a],
    floor: [BY_ID.m02_pi_a],
    hands: { p1: [BY_ID.m09_pi_a], p2: [BY_ID.m08_gwang] },
    captured: { p1: [], p2: [] },
    ppeokFlags: {},
    ppeokCount: { p1: 0, p2: 0 },
    pendingFloorChoice: null,
    turn: 'p2',
    phase: 'awaiting_play',
    goCount: { p1: 0, p2: 0 },
    shaking: { p1: false, p2: true },
    money: { p1: 10000, p2: 10000 },
    perPoint: 100,
    roundWinner: null,
    stoppedBy: null,
    lastAction: null,
    roundResult: null,
    lastGoScore: { p1: null, p2: null },
    kkeutAsSsangpi: { p1: false, p2: false },
    kkeutChoiceMade: { p1: false, p2: false },
    pendingKkeutChoice: null,
    pendingSangtong: null,
    shakeAsked: { p1: false, p2: true },
    bombDeckCredit: { p1: 0, p2: 0 },
    pendingBombFlips: { p1: 0, p2: 0 },
    bombResolvingPlayer: null,
    firstPpeokBy: null,
  };
}

test('#47·#48 결정론적: 제출·더미 이동은 actor/source와 단조 seq를 보존한다', () => {
  const game = makeGame();
  expect(playCard(game, 'p2', 'm08_gwang')).toEqual({ ok: true });
  const timeline = snapshotForPlayer(game, 'p1').turnAction;
  const moves = timeline.steps.flatMap((step) => step.moves || []);
  const handMove = moves.find((move) => move.cardId === 'm08_gwang' && move.sourceZone === 'hand');
  const deckMove = moves.find((move) => move.cardId === 'm03_pi_a' && move.sourceZone === 'deck');
  expect(handMove).toMatchObject({ actor: 'p2', ownerBefore: 'p2', destinationZone: 'staging' });
  expect(deckMove).toMatchObject({ actor: 'p2', ownerBefore: null, destinationZone: 'staging' });
  const seqs = timeline.steps.flatMap((step) => [step.seq, ...(step.moves || []).map((move) => move.seq)]);
  expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
  expect(new Set(seqs).size).toBe(seqs.length);
});

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

/**
 * 독립 브라우저 매치를 열어 테스트 간 방·STATE·fly 배열을 격리한다.
 *
 * @param {string} prefix 닉네임 접두어
 * @returns {Promise<{browser:import('@playwright/test').Browser,p1:import('@playwright/test').Page,p2:import('@playwright/test').Page}>}
 */
async function openMatch(prefix) {
  await fetch(`${BASE_URL}/test/reset`, { method: 'POST' });
  const browser = await chromium.launch();
  const c1 = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const c2 = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const p1 = await c1.newPage();
  const p2 = await c2.newPage();
  for (const page of [p1, p2]) {
    await page.addInitScript(() => {
      window.__matgoFlies = [];
      window.__matgoDiagnostics = {};
    });
  }
  await p1.goto(`${BASE_URL}/?name=${prefix}P1`);
  await p2.goto(`${BASE_URL}/?name=${prefix}P2`);
  await Promise.all([
    p1.waitForSelector('#my-hand-cards .card'),
    p2.waitForSelector('#my-hand-cards .card'),
  ]);
  return { browser, p1, p2 };
}

/**
 * fly 대기 실패 시 현재 상태·계측·clone 수를 오류에 포함한다.
 *
 * @param {import('@playwright/test').Page} page 관측 페이지
 * @param {string} cardId 카드 ID
 * @param {string} origin 기대 출처
 * @returns {Promise<void>}
 */
async function waitForMeasuredFly(page, cardId, origin) {
  try {
    await page.waitForFunction(
      ({ id, expectedOrigin }) => window.__matgoFlies.some(
        (fly) => fly.cardId === id && fly.origin === expectedOrigin,
      ),
      { id: cardId, expectedOrigin: origin },
      { timeout: 5000 },
    );
  } catch (error) {
    const diagnostics = await page.evaluate(() => ({
      flies: window.__matgoFlies,
      diagnostics: window.__matgoDiagnostics,
      clones: document.querySelectorAll('#fly-overlay .flying-card').length,
    }));
    throw new Error(`${error.message}\n${JSON.stringify(diagnostics)}`);
  }
}

test('#47 흔들기 8월 패는 실제 actor 손에서 1회 fly한다', async () => {
  const { browser, p1, p2 } = await openMatch('47');
  try {
    await inject({
      turn: 'p1',
      phase: 'awaiting_play',
      p1Hand: [BY_ID.m08_gwang, BY_ID.m08_kkeut_godori, BY_ID.m08_pi_a],
      p2Hand: [BY_ID.m09_pi_a],
      floor: [BY_ID.m02_pi_a],
      deck: [BY_ID.m03_pi_a],
      captured: { p1: [], p2: [] },
      shaking: { p1: false, p2: false },
    });
    await Promise.all([p1, p2].map((page) => page.waitForFunction(
      () => document.querySelectorAll('#fly-overlay .flying-card').length === 0,
    )));
    await p1.evaluate(() => { window.__matgoFlies = []; });
    await p1.click('#my-hand-cards [data-card-id="m08_gwang"]');
    await expect(p1.locator('#shake-modal')).not.toHaveClass(/hidden/);
    await p1.click('#btn-shake');
    await waitForMeasuredFly(p1, 'm08_gwang', 'hand');
    await p1.screenshot({
      path: 'tests/screenshots/reports-44-50-phaseA-47-shake-fly.png',
      fullPage: true,
    });
    await p1.waitForFunction(() => document.querySelectorAll('#fly-overlay .flying-card').length === 0);
    const shakeFlies = await p1.evaluate(() => window.__matgoFlies.filter(
      (fly) => fly.cardId === 'm08_gwang',
    ));
    expect(shakeFlies).toHaveLength(1);
    expect(shakeFlies[0].origin).toBe('hand');
    expect(shakeFlies[0].startLeft).toBeGreaterThanOrEqual(0);
    expect(shakeFlies[0].startTop).toBeGreaterThanOrEqual(0);
    expect(shakeFlies[0].startLeft).toBeLessThan(1920);
    expect(shakeFlies[0].startTop).toBeLessThan(1080);
  } finally {
    await browser.close();
  }
});

test('#48 상대/AI 제출 패는 관전자 opp-hand에서 1회 fly한다', async () => {
  const { browser, p1, p2 } = await openMatch('48');
  try {
    await inject({
      turn: 'p2',
      phase: 'awaiting_play',
      p1Hand: [BY_ID.m07_pi_a],
      p2Hand: [BY_ID.m08_pi_b],
      floor: [BY_ID.m02_pi_a],
      deck: [BY_ID.m04_pi_a],
      captured: { p1: [], p2: [] },
      shaking: { p1: false, p2: false },
    });
    await Promise.all([p1, p2].map((page) => page.waitForFunction(
      () => document.querySelectorAll('#fly-overlay .flying-card').length === 0,
    )));
    await Promise.all([p1, p2].map((page) => page.evaluate(() => { window.__matgoFlies = []; })));
    await p2.click('#my-hand-cards [data-card-id="m08_pi_b"]');
    await waitForMeasuredFly(p1, 'm08_pi_b', 'opp-hand');
    await p1.screenshot({
      path: 'tests/screenshots/reports-44-50-phaseA-48-opp-fly.png',
      fullPage: true,
    });
    await p1.waitForFunction(() => document.querySelectorAll('#fly-overlay .flying-card').length === 0);
    const observerFlies = await p1.evaluate(() => window.__matgoFlies.filter(
      (fly) => fly.cardId === 'm08_pi_b',
    ));
    expect(observerFlies).toHaveLength(1);
    expect(observerFlies[0].origin).toBe('opp-hand');
    expect(observerFlies.filter((fly) => fly.origin === 'hand')).toHaveLength(0);
    expect(observerFlies[0].startLeft).toBeGreaterThanOrEqual(0);
    expect(observerFlies[0].startTop).toBeGreaterThanOrEqual(0);
    expect(observerFlies[0].startLeft).toBeLessThan(1920);
    expect(observerFlies[0].startTop).toBeLessThan(1080);
    await expect(p1.locator('#my-hand-cards [data-card-id="m08_pi_b"]')).toHaveCount(0);
  } finally {
    await browser.close();
  }
});
