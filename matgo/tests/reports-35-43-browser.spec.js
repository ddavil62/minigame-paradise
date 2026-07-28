/**
 * @fileoverview 리포트 35~42의 카드 출처·입력·원자 정산을 결정론적 상태와 Chromium에서 검증한다.
 */

import { test, expect, chromium } from '@playwright/test';
import { buildDeck } from '../cards.js';
import { playCard, snapshotForPlayer } from '../game.js';

const BASE_URL = process.env.MATGO_BASE_URL || 'http://localhost:3013';
const BY_ID = Object.fromEntries(buildDeck().map((card) => [card.id, card]));

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
 * 권위 게임 상태를 테스트 서버에 주입한다.
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
 * 서로 다른 해상도의 두 플레이어 브라우저를 준비한다.
 *
 * @param {{width:number,height:number}} [p1Viewport]
 * @param {{width:number,height:number}} [p2Viewport]
 * @returns {Promise<{browser:import('@playwright/test').Browser,p1:import('@playwright/test').Page,p2:import('@playwright/test').Page}>}
 */
async function openMatch(
  p1Viewport = { width: 1920, height: 1080 },
  p2Viewport = { width: 1920, height: 1080 },
) {
  await resetServer();
  const browser = await chromium.launch();
  const p1Context = await browser.newContext({ viewport: p1Viewport });
  const p2Context = await browser.newContext({ viewport: p2Viewport });
  const p1 = await p1Context.newPage();
  const p2 = await p2Context.newPage();
  for (const page of [p1, p2]) {
    await page.addInitScript(() => {
      window.__matgoFlies = [];
      window.__matgoTimelineEvents = [];
      window.__matgoDiagnostics = {};
    });
  }
  await p1.goto(`${BASE_URL}/?name=출처검증P1`);
  await p2.goto(`${BASE_URL}/?name=출처검증P2`);
  await Promise.all([
    p1.waitForSelector('#my-hand-cards .card', { timeout: 10000 }),
    p2.waitForSelector('#my-hand-cards .card', { timeout: 10000 }),
  ]);
  return { browser, p1, p2 };
}

/**
 * 초기 상태 주입에서 생긴 애니메이션을 모두 비우고 fly 계측을 초기화한다.
 *
 * @param {import('@playwright/test').Page[]} pages
 * @returns {Promise<void>}
 */
async function resetFlyMeasurements(pages) {
  await Promise.all(pages.map((page) => page.waitForFunction(
    () => document.querySelectorAll('#fly-overlay .flying-card').length === 0,
    { timeout: 10000 },
  )));
  await Promise.all(pages.map((page) => page.evaluate(() => {
    window.__matgoFlies = [];
    window.__matgoTimelineEvents = [];
  })));
}

/**
 * 특정 카드·출처의 fly가 기록될 때까지 기다린다.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} cardId
 * @param {string} origin
 * @returns {Promise<void>}
 */
async function waitForFly(page, cardId, origin) {
  await page.waitForFunction(
    ({ expectedCardId, expectedOrigin }) => window.__matgoFlies?.some(
      (fly) => fly.cardId === expectedCardId && fly.origin === expectedOrigin,
    ),
    { expectedCardId: cardId, expectedOrigin: origin },
    { timeout: 12000 },
  );
}

/**
 * 최소 필드만 갖춘 결정론적 게임 상태를 만든다.
 *
 * @param {object} overrides
 * @returns {object}
 */
function makeGame(overrides = {}) {
  return {
    deck: [],
    floor: [],
    hands: { p1: [], p2: [] },
    captured: { p1: [], p2: [] },
    ppeokFlags: {},
    ppeokCount: { p1: 0, p2: 0 },
    pendingFloorChoice: null,
    pendingChoiceSrcCardId: null,
    turn: 'p1',
    phase: 'awaiting_play',
    goCount: { p1: 0, p2: 0 },
    shaking: { p1: false, p2: false },
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
    shakeAsked: { p1: false, p2: false },
    bombDeckCredit: { p1: 0, p2: 0 },
    pendingBombFlips: { p1: 0, p2: 0 },
    bombResolvingPlayer: null,
    firstPpeokBy: null,
    ...overrides,
  };
}

test('#35 결정론적: 조커 강탈은 피해자 captured에서 actor captured로 기록된다', () => {
  const game = makeGame({
    hands: { p1: [BY_ID.m00_joker_a], p2: [BY_ID.m08_pi_a] },
    captured: { p1: [], p2: [BY_ID.m06_pi_a] },
    deck: [BY_ID.m07_pi_a],
  });

  expect(playCard(game, 'p1', 'm00_joker_a')).toEqual({ ok: true });
  const snapshot = snapshotForPlayer(game, 'p2');
  const settle = snapshot.turnAction.steps.find((step) => step.type === 'SETTLE_CAPTURE_BATCH');
  expect(settle.moves).toContainEqual(expect.objectContaining({
    cardId: 'm06_pi_a',
    sourceZone: 'captured',
    destinationZone: 'captured',
    actor: 'p1',
    ownerBefore: 'p2',
    ownerAfter: 'p1',
  }));
});

test('#38·#42 결정론적: 손 제출과 더미 뒤집기는 절대 actor·sourceZone을 유지한다', () => {
  const game = makeGame({
    turn: 'p2',
    hands: { p1: [BY_ID.m08_pi_a], p2: [BY_ID.m01_gwang] },
    floor: [BY_ID.m07_pi_a],
    deck: [BY_ID.m03_pi_a],
  });

  expect(playCard(game, 'p2', 'm01_gwang')).toEqual({ ok: true });
  const snapshot = snapshotForPlayer(game, 'p1');
  const playMove = snapshot.turnAction.steps
    .find((step) => step.type === 'PLAY_MATCH').moves[0];
  const drawMove = snapshot.turnAction.steps
    .find((step) => step.type === 'DRAW_MATCH').moves[0];
  expect(playMove).toEqual(expect.objectContaining({
    cardId: 'm01_gwang',
    sourceZone: 'hand',
    actor: 'p2',
    ownerBefore: 'p2',
  }));
  expect(drawMove).toEqual(expect.objectContaining({
    cardId: 'm03_pi_a',
    sourceZone: 'deck',
    actor: 'p2',
    ownerBefore: null,
  }));
});

test('#35 Chromium 1707×1067: 피해자 시점 강탈 피는 자기 captured 카드 좌표에서 출발한다', async () => {
  const { browser, p1, p2 } = await openMatch(
    { width: 1920, height: 1080 },
    { width: 1707, height: 1067 },
  );
  try {
    await inject({
      turn: 'p1',
      phase: 'awaiting_play',
      p1Hand: [BY_ID.m00_joker_a, BY_ID.m07_pi_a],
      p2Hand: [BY_ID.m08_pi_a],
      floor: [BY_ID.m02_pi_a],
      deck: [BY_ID.m03_pi_a],
      captured: { p1: [], p2: [BY_ID.m06_pi_a] },
    });
    await resetFlyMeasurements([p1, p2]);
    const sourceRect = await p2.locator('#my-captured-zone [data-card-id="m06_pi_a"]').boundingBox();

    await p1.click('#my-hand-cards [data-card-id="m00_joker_a"]');
    await Promise.all([
      waitForFly(p1, 'm06_pi_a', 'opp-captured'),
      waitForFly(p2, 'm06_pi_a', 'my-captured'),
    ]);

    const victimFly = await p2.evaluate(() => window.__matgoFlies.find(
      (fly) => fly.cardId === 'm06_pi_a' && fly.origin === 'my-captured',
    ));
    expect(sourceRect).not.toBeNull();
    expect(victimFly.startLeft).toBeCloseTo(sourceRect.x, 0);
    expect(victimFly.startTop).toBeCloseTo(sourceRect.y, 0);
    const duplicateCount = await p2.evaluate(() => window.__matgoFlies.filter(
      (fly) => fly.cardId === 'm06_pi_a',
    ).length);
    expect(duplicateCount).toBe(1);
  } finally {
    await browser.close();
  }
});

test('#38 Chromium: 흔들기 손패 1장 뒤 실제 더미 1장만 각 출처에서 순서대로 이동한다', async () => {
  const { browser, p1, p2 } = await openMatch();
  try {
    await inject({
      turn: 'p1',
      phase: 'awaiting_play',
      p1Hand: [BY_ID.m01_gwang, BY_ID.m01_tti_hong, BY_ID.m01_pi_a, BY_ID.m07_pi_a],
      p2Hand: [BY_ID.m08_pi_a],
      floor: [BY_ID.m02_pi_a],
      deck: [BY_ID.m03_pi_a],
      captured: { p1: [], p2: [] },
      shaking: { p1: false, p2: false },
    });
    await resetFlyMeasurements([p1, p2]);

    await p1.click('#my-hand-cards [data-card-id="m01_gwang"]');
    await p1.waitForSelector('#shake-modal:not(.hidden)');
    await p1.click('#btn-shake');
    await Promise.all([
      waitForFly(p1, 'm01_gwang', 'hand'),
      waitForFly(p1, 'm03_pi_a', 'deck'),
    ]);

    const relevant = await p1.evaluate(() => window.__matgoFlies.filter(
      (fly) => fly.cardId === 'm01_gwang' || fly.cardId === 'm03_pi_a',
    ));
    expect(relevant.filter((fly) => fly.cardId === 'm01_gwang' && fly.origin === 'hand')).toHaveLength(1);
    expect(relevant.filter((fly) => fly.cardId === 'm01_gwang' && fly.origin === 'deck')).toHaveLength(0);
    expect(relevant.filter((fly) => fly.cardId === 'm03_pi_a' && fly.origin === 'deck')).toHaveLength(1);
    expect(relevant.filter((fly) => fly.cardId === 'm01_gwang')).toHaveLength(1);
    expect(relevant.filter((fly) => fly.cardId === 'm03_pi_a')).toHaveLength(1);
    expect(relevant).toHaveLength(2);
    expect(new Set(relevant.map((fly) => fly.cardId)).size).toBe(2);
    expect(relevant.find((fly) => fly.cardId === 'm01_gwang').t)
      .toBeLessThanOrEqual(relevant.find((fly) => fly.cardId === 'm03_pi_a').t);
    expect(await p1.locator('#deck-count-big').textContent()).toBe('0');
  } finally {
    await browser.close();
  }
});

test('#42 Chromium 1920×1080: 상대 제출은 상대 손에서 출발하고 내 손 DOM은 보존된다', async () => {
  const { browser, p1, p2 } = await openMatch();
  try {
    await inject({
      turn: 'p2',
      phase: 'awaiting_play',
      p1Hand: [BY_ID.m07_pi_a, BY_ID.m08_pi_a],
      p2Hand: [BY_ID.m01_gwang, BY_ID.m09_pi_a],
      floor: [BY_ID.m02_pi_a],
      deck: [BY_ID.m03_pi_a],
      captured: { p1: [], p2: [] },
    });
    await resetFlyMeasurements([p1, p2]);
    const beforeIds = await p1.locator('#my-hand-cards [data-card-id]').evaluateAll(
      (cards) => cards.map((card) => card.dataset.cardId).sort(),
    );

    await p2.click('#my-hand-cards [data-card-id="m01_gwang"]');
    await waitForFly(p1, 'm01_gwang', 'opp-hand');

    const actorFlyCount = await p1.evaluate(() => window.__matgoFlies.filter(
      (fly) => fly.cardId === 'm01_gwang' && fly.origin === 'opp-hand',
    ).length);
    expect(actorFlyCount).toBe(1);
    await expect(p1.locator('#my-hand-cards [data-card-id="m01_gwang"]')).toHaveCount(0);
    const afterIds = await p1.locator('#my-hand-cards [data-card-id]').evaluateAll(
      (cards) => cards.map((card) => card.dataset.cardId).sort(),
    );
    expect(afterIds).toEqual(beforeIds);
  } finally {
    await browser.close();
  }
});

test('#36 Chromium 1707×1067: 손패 없는 폭탄 권리는 더미 클릭 한 번으로 진행되고 잠금이 해제된다', async () => {
  const { browser, p1, p2 } = await openMatch(
    { width: 1707, height: 1067 },
    { width: 1920, height: 1080 },
  );
  try {
    const beforeStatus = await fetch(`${BASE_URL}/test/status`).then((response) => response.json());
    await inject({
      turn: 'p1',
      phase: 'awaiting_play',
      p1Hand: [],
      p2Hand: [BY_ID.m08_pi_a],
      floor: [BY_ID.m02_pi_a],
      deck: [BY_ID.m03_pi_a, BY_ID.m04_pi_a],
      captured: { p1: [], p2: [] },
      bombDeckCredit: { p1: 1, p2: 1 },
      pendingBombFlips: { p1: 0, p2: 0 },
      bombResolvingPlayer: null,
      roundResult: null,
    });
    await resetFlyMeasurements([p1, p2]);
    await p1.waitForSelector('.deck-card.bonus-available');
    await expect(p1.locator('#action-display')).toHaveText('더미를 눌러 보너스 패를 뒤집어라.');

    await p1.locator('.deck-card.bonus-available').evaluate((deck) => {
      deck.click();
      deck.click();
    });
    await expect(p1.locator('#action-display')).toHaveText('더미 패를 뒤집는 중…');
    await p1.waitForFunction(
      () => window.__matgoDiagnostics?.completionCount >= 1
        && window.__matgoDiagnostics?.inputLocked === false,
      null,
      { timeout: 5000 },
    );
    await expect(p1.locator('#fly-overlay .flying-card')).toHaveCount(0);
    await expect(p1.locator('#deck-count-big')).toHaveText('1');

    const status = await fetch(`${BASE_URL}/test/status`).then((response) => response.json());
    expect(status.phase).toBe('awaiting_play');
    expect(status.turn).toBe('p2');
    expect(status.stepInProgress).toBe(false);
    expect(status.activeStepTimerCount).toBe(0);
    expect(status.stepRecoveryCount).toBe(beforeStatus.stepRecoveryCount);
    expect(status.bonusFlipRequestCount - beforeStatus.bonusFlipRequestCount).toBe(1);

    const diagnostics = await p1.evaluate(() => window.__matgoDiagnostics);
    expect(diagnostics.completionReason).toBe('complete');
    expect(diagnostics.activeTimers).toBe(0);
    expect(diagnostics.pendingFlyCount).toBe(0);
    expect(diagnostics.remainingClones).toBe(0);
    expect(diagnostics.duplicateCompletionAttempts).toBe(0);
    expect(diagnostics.lastDurationMs).toBeLessThanOrEqual(3000);
    await expect(p1.locator('#action-display')).toHaveText('상대 차례 — 기다리는 중');

    await inject({
      turn: 'p1',
      phase: 'awaiting_play',
      p1Hand: [BY_ID.m08_pi_a],
      p2Hand: [BY_ID.m09_pi_a],
      floor: [BY_ID.m02_pi_a],
      deck: [BY_ID.m03_pi_a],
      captured: { p1: [], p2: [] },
      bombDeckCredit: { p1: 0, p2: 0 },
      pendingBombFlips: { p1: 0, p2: 0 },
      bombResolvingPlayer: null,
      roundResult: null,
    });
    await expect(p1.locator('#action-display')).toHaveText('손에서 카드 1장을 클릭해라.');
  } finally {
    await browser.close();
  }
});

test('#39 Chromium 1920×1080: 선택 전 2장은 바닥에 대기하고 선택 후 4장이 한 배치로 정산된다', async () => {
  const { browser, p1, p2 } = await openMatch();
  try {
    await inject({
      turn: 'p1',
      phase: 'awaiting_play',
      p1Hand: [BY_ID.m01_gwang],
      p2Hand: [BY_ID.m08_pi_a],
      floor: [BY_ID.m01_tti_hong, BY_ID.m02_tti_hong, BY_ID.m02_pi_a],
      deck: [BY_ID.m02_kkeut_godori],
      captured: { p1: [], p2: [] },
      ppeokFlags: {},
      bombDeckCredit: { p1: 0, p2: 0 },
      pendingBombFlips: { p1: 0, p2: 0 },
      bombResolvingPlayer: null,
      roundResult: null,
    });
    await resetFlyMeasurements([p1, p2]);
    await p1.click('#my-hand-cards [data-card-id="m01_gwang"]');
    await p1.waitForSelector('#floor-choice-modal:not(.hidden)', { timeout: 5000 });

    const waitingStatus = await fetch(`${BASE_URL}/test/status`).then((response) => response.json());
    expect(waitingStatus.phase).toBe('awaiting_floor_choice');
    expect(waitingStatus.capturedCount.p1).toBe(0);
    expect(waitingStatus.pendingCaptureCount).toBe(2);
    expect(waitingStatus.settlementBatch).toBeNull();
    await expect(p1.locator('#my-captured-zone [data-card-id]')).toHaveCount(0);
    for (const cardId of [
      'm01_gwang',
      'm01_tti_hong',
      'm02_kkeut_godori',
      'm02_tti_hong',
      'm02_pi_a',
    ]) {
      await expect(p1.locator(`#floor-cards [data-card-id="${cardId}"]`)).toHaveCount(1);
    }

    await p1.click('#floor-choice-cards [data-card-id="m02_tti_hong"]');
    await expect.poll(
      async () => fetch(`${BASE_URL}/test/status`).then((response) => response.json()),
      { timeout: 5000 },
    ).toMatchObject({
      phase: 'awaiting_play',
      turn: 'p2',
      capturedCount: { p1: 4, p2: 0 },
      pendingCaptureCount: 0,
    });
    await expect(p1.locator('#fly-overlay .flying-card')).toHaveCount(0, { timeout: 5000 });
    const finalStatus = await fetch(`${BASE_URL}/test/status`).then((response) => response.json());
    const moves = finalStatus.settlementBatch.moves;
    expect(moves).toHaveLength(4);
    expect(new Set(moves.map((move) => move.cardId)).size).toBe(4);
    expect(new Set(moves.map((move) => move.cardId))).toEqual(new Set([
      'm01_gwang',
      'm01_tti_hong',
      'm02_kkeut_godori',
      'm02_tti_hong',
    ]));
    const settleEvents = await p1.evaluate(() => window.__matgoTimelineEvents.filter(
      (event) => event.name === 'RESOLVE' && event.batchIds.length === 1,
    ));
    expect(settleEvents.at(-1).activeCardIds).toHaveLength(4);
    expect(new Set(settleEvents.at(-1).activeCardIds).size).toBe(4);
  } finally {
    await browser.close();
  }
});

test('#40 Chromium 1707×1067: 타인 뻑 회수 4장과 후속 더미 2장이 한 배치로 정산된다', async () => {
  const { browser, p1, p2 } = await openMatch(
    { width: 1707, height: 1067 },
    { width: 1920, height: 1080 },
  );
  try {
    await inject({
      turn: 'p1',
      phase: 'awaiting_play',
      p1Hand: [BY_ID.m01_gwang],
      p2Hand: [BY_ID.m08_pi_a],
      floor: [
        BY_ID.m01_tti_hong,
        BY_ID.m01_pi_a,
        BY_ID.m01_pi_b,
        BY_ID.m02_tti_hong,
      ],
      deck: [BY_ID.m02_kkeut_godori],
      captured: { p1: [], p2: [] },
      ppeokFlags: { 1: 'p2' },
      bombDeckCredit: { p1: 0, p2: 0 },
      pendingBombFlips: { p1: 0, p2: 0 },
      bombResolvingPlayer: null,
      roundResult: null,
    });
    await resetFlyMeasurements([p1, p2]);
    await p1.click('#my-hand-cards [data-card-id="m01_gwang"]');

    await expect.poll(
      async () => fetch(`${BASE_URL}/test/status`).then((response) => response.json()),
      { timeout: 1000, intervals: [20, 30, 50] },
    ).toMatchObject({
      capturedCount: { p1: 0, p2: 0 },
      pendingCaptureCount: 4,
    });
    await expect(p1.locator('#my-captured-zone [data-card-id]')).toHaveCount(0);
    for (const cardId of ['m01_gwang', 'm01_tti_hong', 'm01_pi_a', 'm01_pi_b']) {
      await expect(p1.locator(`#floor-cards [data-card-id="${cardId}"]`)).toHaveCount(1);
    }

    await expect.poll(
      async () => fetch(`${BASE_URL}/test/status`).then((response) => response.json()),
      { timeout: 5000 },
    ).toMatchObject({
      phase: 'awaiting_play',
      turn: 'p2',
      capturedCount: { p1: 6, p2: 0 },
      pendingCaptureCount: 0,
    });
    await expect(p1.locator('#fly-overlay .flying-card')).toHaveCount(0, { timeout: 5000 });
    const finalStatus = await fetch(`${BASE_URL}/test/status`).then((response) => response.json());
    const moves = finalStatus.settlementBatch.moves;
    expect(moves).toHaveLength(6);
    expect(new Set(moves.map((move) => move.cardId)).size).toBe(6);
    const settleEvents = await p1.evaluate(() => window.__matgoTimelineEvents.filter(
      (event) => event.name === 'RESOLVE' && event.batchIds.length === 1,
    ));
    expect(settleEvents.at(-1).activeCardIds).toHaveLength(6);
    expect(new Set(settleEvents.at(-1).activeCardIds).size).toBe(6);
    await expect(p1.locator('#my-captured-zone [data-card-id]')).toHaveCount(6);
  } finally {
    await browser.close();
  }
});

test('#41 Chromium 양쪽 결과 UI: 사통은 일반 박·고·흔들기 없이 고정 7점으로 정산된다', async () => {
  const { browser, p1, p2 } = await openMatch();
  try {
    await inject({
      turn: 'p1',
      phase: 'awaiting_sangtong',
      p1Hand: [
        BY_ID.m01_gwang,
        BY_ID.m01_tti_hong,
        BY_ID.m01_pi_a,
        BY_ID.m01_pi_b,
        BY_ID.m05_kkeut,
      ],
      p2Hand: [BY_ID.m06_kkeut],
      floor: [],
      deck: [],
      captured: { p1: [], p2: [] },
      pendingSangtong: { player: 'p1', month: 1 },
      goCount: { p1: 4, p2: 3 },
      shaking: { p1: true, p2: true },
      ppeokCount: { p1: 2, p2: 1 },
      firstPpeokBy: 'p1',
      ppeokFlags: {},
      bombDeckCredit: { p1: 0, p2: 0 },
      pendingBombFlips: { p1: 0, p2: 0 },
      bombResolvingPlayer: null,
      roundResult: null,
    });
    await p1.waitForSelector('#sangtong-modal:not(.hidden)');
    await p1.click('#btn-sangtong-declare');
    await Promise.all([
      p1.waitForSelector('#round-modal:not(.hidden)', { timeout: 5000 }),
      p2.waitForSelector('#round-modal:not(.hidden)', { timeout: 5000 }),
    ]);

    const status = await fetch(`${BASE_URL}/test/status`).then((response) => response.json());
    expect(status.phase).toBe('round_end');
    expect(status.roundResult).toMatchObject({
      winner: 'p1',
      loser: 'p2',
      settlementType: 'sangtong',
      finalScore: 7,
      multiplier: 1,
      reasons: ['사통 +7'],
      gobakApplies: false,
      sangtongBonusApplied: true,
      settlementBreakdown: {
        cardScore: 0,
        baseScore: 0,
        bonusScore: 7,
        multiplier: 1,
        finalScore: 7,
        reasons: ['사통 +7'],
      },
    });

    await expect(p1.locator('#round-modal-title')).toHaveText('사통 승리!');
    await expect(p2.locator('#round-modal-title')).toHaveText('사통 패배');
    for (const page of [p1, p2]) {
      const body = page.locator('#round-modal-body');
      await expect(body).toContainText('정산 유형');
      await expect(body).toContainText('사통');
      await expect(body).toContainText('사통 기본 점수');
      await expect(body).toContainText('7점');
      await expect(body).toContainText('최종 점수');
      await expect(body).toContainText('7점 (×1)');
      await expect(body).toContainText('사통 +7');
      await expect(body).not.toContainText(/피박|광박|멍박|고박|흔들기|뻑|고 ×/);
    }
  } finally {
    await browser.close();
  }
});
