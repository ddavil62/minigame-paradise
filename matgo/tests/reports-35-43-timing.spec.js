/**
 * @fileoverview 리포트 36·37의 폭탄 보너스 입력, 단계 상한, 반복 진행과 정리 상태를 Chromium에서 검증한다.
 */

import { test, expect, chromium } from '@playwright/test';
import { buildDeck } from '../cards.js';

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
 * 테스트용 권위 상태를 주입한다.
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
 * 서버 runner 진단 상태를 읽는다.
 *
 * @returns {Promise<object>}
 */
async function getStatus() {
  const response = await fetch(`${BASE_URL}/test/status`);
  if (!response.ok) throw new Error(`테스트 상태 조회 실패: ${response.status}`);
  return response.json();
}

/**
 * 두 플레이어 브라우저 대전을 준비한다.
 *
 * @returns {Promise<{browser:import('@playwright/test').Browser,p1:import('@playwright/test').Page,p2:import('@playwright/test').Page}>}
 */
async function openMatch() {
  await resetServer();
  const browser = await chromium.launch();
  const p1Context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const p2Context = await browser.newContext({ viewport: { width: 1707, height: 1067 } });
  const p1 = await p1Context.newPage();
  const p2 = await p2Context.newPage();
  for (const page of [p1, p2]) {
    await page.addInitScript(() => {
      window.__matgoFlies = [];
      window.__matgoTimelineEvents = [];
      window.__matgoDiagnostics = {};
    });
  }
  await p1.goto(`${BASE_URL}/?name=타이밍P1`);
  await p2.goto(`${BASE_URL}/?name=타이밍P2`);
  await Promise.all([
    p1.waitForSelector('#my-hand-cards .card', { timeout: 10000 }),
    p2.waitForSelector('#my-hand-cards .card', { timeout: 10000 }),
  ]);
  return { browser, p1, p2 };
}

/**
 * 현재 fly를 모두 기다린 뒤 한 반복의 계측 배열을 초기화한다.
 *
 * @param {import('@playwright/test').Page[]} pages
 * @returns {Promise<void>}
 */
async function resetMeasurements(pages) {
  await Promise.all(pages.map((page) => page.waitForFunction(
    () => document.querySelectorAll('#fly-overlay .flying-card').length === 0,
    null,
    { timeout: 5000 },
  )));
  await Promise.all(pages.map((page) => page.evaluate(() => {
    window.__matgoFlies = [];
    window.__matgoTimelineEvents = [];
    window.__matgoDiagnostics = {};
  })));
}

test('#37 20회 반복: 서버 2초·turnAction 3초 상한 안에 단일 완료되고 잠금·타이머가 남지 않는다', async () => {
  const { browser, p1, p2 } = await openMatch();
  try {
    const initialStatus = await getStatus();
    for (let iteration = 0; iteration < 20; iteration++) {
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
      await resetMeasurements([p1, p2]);
      await p1.waitForSelector('.deck-card.bonus-available');
      await expect(p1.locator('#action-display')).toHaveText('더미를 눌러 보너스 패를 뒤집어라.');
      const beforeRequest = await getStatus();
      const startedAt = Date.now();

      await p1.locator('.deck-card.bonus-available').evaluate((deck) => {
        deck.click();
        deck.click();
      });
      await expect(p1.locator('#action-display')).toHaveText('더미 패를 뒤집는 중…');
      await p1.waitForFunction(
        () => window.__matgoDiagnostics?.completionCount === 1
          && window.__matgoDiagnostics?.inputLocked === false,
        null,
        { timeout: 5000 },
      );
      const elapsedMs = Date.now() - startedAt;
      const status = await getStatus();
      const diagnostics = await p1.evaluate(() => window.__matgoDiagnostics);
      const events = await p1.evaluate(() => window.__matgoTimelineEvents);

      expect(elapsedMs).toBeLessThanOrEqual(3000);
      expect(diagnostics.lastDurationMs).toBeLessThanOrEqual(3000);
      expect(diagnostics.completionReason).toBe('complete');
      expect(diagnostics.completionCount).toBe(1);
      expect(diagnostics.duplicateCompletionAttempts || 0).toBe(0);
      expect(diagnostics.activeTimers).toBe(0);
      expect(diagnostics.pendingFlyCount).toBe(0);
      expect(diagnostics.remainingClones).toBe(0);
      expect(status.stepInProgress).toBe(false);
      expect(status.activeStepTimerCount).toBe(0);
      expect(status.stepRecoveryCount).toBe(initialStatus.stepRecoveryCount);
      expect(status.bonusFlipRequestCount - beforeRequest.bonusFlipRequestCount).toBe(1);
      expect(status.phase).toBe('awaiting_play');
      expect(status.turn).toBe('p2');
      await expect(p1.locator('#action-display')).toHaveText('상대 차례 — 기다리는 중');
      for (let index = 1; index < events.length; index++) {
        expect(events[index].t - events[index - 1].t).toBeLessThanOrEqual(1000);
      }
      await expect(p1.locator('#fly-overlay .flying-card')).toHaveCount(0);
    }

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

test('#36 사용자 바닥 선택은 2초 서버 상한에서 제외되고 선택 후 정상 완료된다', async () => {
  const { browser, p1, p2 } = await openMatch();
  try {
    await inject({
      turn: 'p1',
      phase: 'awaiting_play',
      p1Hand: [],
      p2Hand: [BY_ID.m08_pi_a],
      floor: [BY_ID.m01_pi_a, BY_ID.m01_pi_b, BY_ID.m02_pi_a],
      deck: [BY_ID.m03_pi_a, BY_ID.m01_gwang],
      captured: { p1: [], p2: [] },
      bombDeckCredit: { p1: 1, p2: 1 },
      pendingBombFlips: { p1: 0, p2: 0 },
      bombResolvingPlayer: null,
      roundResult: null,
    });
    await resetMeasurements([p1, p2]);
    const beforeStatus = await getStatus();
    await p1.click('.deck-card.bonus-available');
    await p1.waitForSelector('#floor-choice-modal:not(.hidden)', { timeout: 5000 });

    const waitingStatus = await getStatus();
    expect(waitingStatus.phase).toBe('awaiting_floor_choice');
    expect(waitingStatus.stepInProgress).toBe(false);
    expect(waitingStatus.activeStepTimerCount).toBe(0);
    await p1.waitForTimeout(2200);
    const afterWaitStatus = await getStatus();
    expect(afterWaitStatus.phase).toBe('awaiting_floor_choice');
    expect(afterWaitStatus.stepRecoveryCount).toBe(beforeStatus.stepRecoveryCount);

    await p1.click('#floor-choice-cards [data-card-id="m01_pi_a"]');
    await p1.waitForFunction(
      () => window.__matgoDiagnostics?.inputLocked === false
        && document.querySelectorAll('#fly-overlay .flying-card').length === 0,
      null,
      { timeout: 5000 },
    );
    await expect.poll(getStatus, { timeout: 5000 }).toMatchObject({
      phase: 'awaiting_play',
      turn: 'p2',
      stepInProgress: false,
      activeStepTimerCount: 0,
    });
    const finalStatus = await getStatus();
    expect(finalStatus.phase).toBe('awaiting_play');
    expect(finalStatus.turn).toBe('p2');
    expect(finalStatus.stepInProgress).toBe(false);
    expect(finalStatus.activeStepTimerCount).toBe(0);
    expect(finalStatus.stepRecoveryCount).toBe(beforeStatus.stepRecoveryCount);
  } finally {
    await browser.close();
  }
});
