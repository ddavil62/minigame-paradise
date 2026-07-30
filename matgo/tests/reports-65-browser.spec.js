/**
 * @fileoverview 리포트 #65 브라우저 검증 테스트.
 *
 * T-65-opp-choice-fly-no-dup:
 *   바닥 2장 + 상대 차례 선택 흐름에서 상대 손 fly가 정확히 1회만 재생된다.
 *   window.__matgoFlies 배열로 opp-hand origin fly 개수를 검증한다.
 *
 * 서버 사전 실행 필수: node matgo/server.js --port 3013
 */

import { test, expect, chromium } from '@playwright/test';
import { buildDeck } from '../cards.js';

const BASE_URL = process.env.MATGO_BASE_URL || 'http://localhost:3013';
const BY_ID = Object.fromEntries(buildDeck().map((card) => [card.id, card]));

/**
 * 결정적 게임 상태를 주입한다.
 * @param {object} state
 * @returns {Promise<void>}
 */
async function inject(state) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const statusRes = await fetch(`${BASE_URL}/test/status`);
    const status = await statusRes.json();
    if (status.phase !== null) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const response = await fetch(`${BASE_URL}/test/inject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`inject 실패 (${response.status}): ${err.error || 'unknown'}`);
  }
}

/**
 * 두 플레이어 매치를 연다.
 * @returns {Promise<{browser:object, p1:object, p2:object}>}
 */
async function openMatch() {
  await fetch(`${BASE_URL}/test/reset`, { method: 'POST' });
  await new Promise((resolve) => setTimeout(resolve, 200));
  const browser = await chromium.launch();
  const p1 = await (await browser.newContext({
    viewport: { width: 1920, height: 1080 },
  })).newPage();
  const p2 = await (await browser.newContext({
    viewport: { width: 1920, height: 1080 },
  })).newPage();

  // fly origin 계측 초기화
  await p1.addInitScript(() => {
    window.__matgoFlies = [];
  });

  // e2e-scenarios.spec.js의 joinAndStartGame 패턴
  await p1.goto(`${BASE_URL}/?name=R65-P1`);
  await p1.waitForFunction(
    () => document.getElementById('you-tag')?.textContent?.includes('P1'),
    { timeout: 8000 },
  );
  await p2.goto(`${BASE_URL}/?name=R65-P2`);
  await p2.waitForFunction(
    () => document.getElementById('you-tag')?.textContent?.includes('P2'),
    { timeout: 8000 },
  );
  // 양쪽 STATE 수신 완료 확인: 상대 손패 뒷면 10장
  await p1.waitForFunction(
    () => document.querySelectorAll('#opp-hand-cards .card.back').length === 10,
    { timeout: 8000 },
  );
  // fly 대기
  await p1.waitForFunction(
    () => (document.getElementById('fly-overlay')?.childElementCount ?? 0) === 0,
    { timeout: 8000 },
  );
  await p2.waitForFunction(
    () => (document.getElementById('fly-overlay')?.childElementCount ?? 0) === 0,
    { timeout: 8000 },
  );
  return { browser, p1, p2 };
}

test.describe.configure({ mode: 'serial' });

// ── T-65: 상대 손 fly 중복 방지 ──────────────────────────────────────
test('T-65-opp-choice-fly-no-dup: 바닥 2장 + 상대 차례 선택 흐름에서 상대 손 fly가 정확히 1회만 재생된다', async () => {
  const { browser, p1 } = await openMatch();
  try {
    // fly origin 계측 초기화
    await p1.evaluate(() => { window.__matgoFlies = []; });

    // 통합 STATE 완료 이후를 시뮬레이션:
    // 상대(p2)가 바닥 2장 중 1장을 선택해 먹은 후의 상태.
    // choiceFloorSrcCardId가 설정되고, lastAction.player = 'p2'(상대)이므로
    // 경로 A에서 startFlyFromOppHand 시도가 일어난다.
    // 동시에 lastAction이 oppId의 HAND_ORIGIN_KINDS에 해당하는 kind이므로
    // 경로 B(oppHandOriginIds lastAction 폴백)에서도 동일 카드가 추가될 수 있다.
    await inject({
      phase: 'awaiting_play',
      turn: 'p1',
      lastAction: {
        kind: 'sseul',
        player: 'p2',
        month: 3,
        stoleFromOpp: 1,
      },
      choiceFloorSrcCardId: 'm03_gwang',
      floor: [],
      p1Hand: [BY_ID.m07_pi_a],
      p2Hand: [BY_ID.m08_pi_a],
      deck: [BY_ID.m10_pi_a],
      captured: {
        p1: [],
        p2: [BY_ID.m03_gwang, BY_ID.m03_tti_hong, BY_ID.m03_pi_a, BY_ID.m03_pi_b],
      },
    });

    // fly 발생 대기
    await p1.waitForFunction(
      () => (window.__matgoFlies || []).length > 0,
      { timeout: 8000 },
    );

    // fly 완료 대기 (모든 fly가 끝나야 중복 여부 확인 가능)
    await p1.waitForFunction(
      () => (document.getElementById('fly-overlay')?.childElementCount ?? 0) === 0,
      { timeout: 15000 },
    );

    // fly 기록 수집
    const flies = await p1.evaluate(() => window.__matgoFlies || []);
    console.log('[T-65] fly log:', flies.map((f) => `${f.cardId}:${f.origin}`).join(', '));

    // AC-65-1: opp-hand origin fly가 정확히 1회
    const oppHandFlies = flies.filter((f) => f.cardId === 'm03_gwang' && f.origin === 'opp-hand');
    expect(oppHandFlies.length).toBe(1);

    // AC-65-2: hand(내 손) origin fly가 0회
    const handFlies = flies.filter((f) => f.cardId === 'm03_gwang' && f.origin === 'hand');
    expect(handFlies.length).toBe(0);
  } finally {
    await browser.close();
  }
});
