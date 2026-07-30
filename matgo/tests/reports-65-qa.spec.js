/**
 * @fileoverview QA #65 - 상대 손 fly 중복 재생 수정 시각 검증.
 *
 * 상대 차례 바닥 2장 선택 흐름에서:
 * 1. fly 진행 중 스크린샷 (fly clone이 1개인지 확인)
 * 2. fly 완료 후 스크린샷 (captured 안착 확인)
 * 3. 내 차례 choice fly 회귀 없음 확인
 * 4. 콘솔 에러 없음 확인
 *
 * 서버 사전 실행 필수: node matgo/server.js --port 3013
 */

import { test, expect, chromium } from '@playwright/test';
import { buildDeck } from '../cards.js';

const BASE_URL = process.env.MATGO_BASE_URL || 'http://localhost:3013';
const BY_ID = Object.fromEntries(buildDeck().map((card) => [card.id, card]));

/** @param {object} state */
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

  await p1.addInitScript(() => { window.__matgoFlies = []; });

  await p1.goto(`${BASE_URL}/?name=QA65-P1`);
  await p1.waitForFunction(
    () => document.getElementById('you-tag')?.textContent?.includes('P1'),
    { timeout: 8000 },
  );
  await p2.goto(`${BASE_URL}/?name=QA65-P2`);
  await p2.waitForFunction(
    () => document.getElementById('you-tag')?.textContent?.includes('P2'),
    { timeout: 8000 },
  );
  await p1.waitForFunction(
    () => document.querySelectorAll('#opp-hand-cards .card.back').length === 10,
    { timeout: 8000 },
  );
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

// ── QA-65-1: 상대 선택 fly 시각 검증 ──────────────────────────
test('QA-65-1: 상대 차례 choice fly 시각 검증 (중복 없음 + captured 안착)', async () => {
  const { browser, p1 } = await openMatch();
  const consoleErrors = [];
  p1.on('pageerror', (err) => consoleErrors.push(err.message));

  try {
    await p1.evaluate(() => { window.__matgoFlies = []; });

    // inject 전 초기 상태 캡처
    await p1.screenshot({ path: 'tests/screenshots/qa65-01-before-inject.png' });

    // 상대(p2)가 바닥 2장 선택 + 쓸 완료 후 상태
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

    // fly 시작 대기
    await p1.waitForFunction(
      () => (window.__matgoFlies || []).length > 0,
      { timeout: 8000 },
    );

    // fly 진행 중 캡처 (fly-overlay에 클론이 존재하는 시점)
    const flyOverlayCount = await p1.evaluate(
      () => document.getElementById('fly-overlay')?.childElementCount ?? 0,
    );
    if (flyOverlayCount > 0) {
      await p1.screenshot({ path: 'tests/screenshots/qa65-02-fly-in-progress.png' });
    }

    // fly 완료 대기
    await p1.waitForFunction(
      () => (document.getElementById('fly-overlay')?.childElementCount ?? 0) === 0,
      { timeout: 15000 },
    );

    // fly 완료 후 캡처
    await p1.screenshot({ path: 'tests/screenshots/qa65-03-fly-complete.png' });

    // fly 기록 수집
    const flies = await p1.evaluate(() => window.__matgoFlies || []);
    console.log('[QA-65-1] fly log:', flies.map((f) => `${f.cardId}:${f.origin}`).join(', '));

    // 핵심 검증: opp-hand fly가 정확히 1회
    const oppHandFlies = flies.filter((f) => f.cardId === 'm03_gwang' && f.origin === 'opp-hand');
    expect(oppHandFlies.length).toBe(1);

    // hand fly가 0회
    const handFlies = flies.filter((f) => f.cardId === 'm03_gwang' && f.origin === 'hand');
    expect(handFlies.length).toBe(0);

    // 콘솔 에러 없음
    expect(consoleErrors).toEqual([]);
  } finally {
    await browser.close();
  }
});

// ── QA-65-2: 내 차례 choice fly 회귀 없음 (E-31/T-64-my 교차 검증) ──
test('QA-65-2: 내 차례 choice fly가 내 손에서 정상 출발 (회귀 없음)', async () => {
  const { browser, p1 } = await openMatch();
  try {
    await inject({
      turn: 'p1',
      phase: 'awaiting_play',
      p1Hand: [BY_ID.m03_gwang, BY_ID.m07_pi_a],
      p2Hand: [BY_ID.m08_pi_a],
      floor: [BY_ID.m03_tti_hong, BY_ID.m03_pi_a],
      deck: [BY_ID.m10_pi_a],
      captured: { p1: [], p2: [BY_ID.m06_pi_a] },
    });

    await p1.waitForFunction(
      () => (document.getElementById('fly-overlay')?.childElementCount ?? 0) === 0,
      { timeout: 8000 },
    );

    await p1.evaluate(() => { window.__matgoFlies = []; });

    // 3월 광 클릭 -> awaiting_floor_choice
    await p1.click('#my-hand-cards [data-card-id="m03_gwang"]');
    await p1.waitForSelector('#floor-choice-modal:not(.hidden)', { timeout: 8000 });

    // 바닥 카드 선택
    await p1.click('#floor-choice-cards [data-card-id="m03_tti_hong"]');

    // 모든 fly 완료 대기
    await p1.waitForFunction(
      () => (document.getElementById('fly-overlay')?.childElementCount ?? 0) === 0,
      { timeout: 15000 },
    );

    // 내 차례 fly 스크린샷
    await p1.screenshot({ path: 'tests/screenshots/qa65-04-my-choice-fly-complete.png' });

    const flies = await p1.evaluate(() => window.__matgoFlies || []);
    console.log('[QA-65-2] fly log:', flies.map((f) => `${f.cardId}:${f.origin}`).join(', '));

    // 내 손에서 출발해야 함
    const handFlies = flies.filter((f) => f.cardId === 'm03_gwang' && f.origin === 'hand');
    expect(handFlies.length).toBeGreaterThanOrEqual(1);

    // opp-hand에서 출발하면 안 됨
    const oppFly = flies.find((f) => f.cardId === 'm03_gwang' && f.origin === 'opp-hand');
    expect(oppFly).toBeUndefined();
  } finally {
    await browser.close();
  }
});

// ── QA-65-3: 연속 choice 시나리오 (내 차례 -> 상대 차례 연속 선택) ──
test('QA-65-3: 연속 choice - 내 차례 choice 후 상대 차례 choice에서 fly 중복 없음', async () => {
  const { browser, p1 } = await openMatch();
  try {
    // 먼저 내 차례 choice 흐름으로 lastChoiceSrcFlyActionKey 설정
    await inject({
      turn: 'p1',
      phase: 'awaiting_play',
      lastAction: {
        kind: 'pair_from_flip',
        player: 'p1',
        month: 1,
      },
      choiceFloorSrcCardId: 'm01_gwang',
      floor: [BY_ID.m03_tti_hong],
      p1Hand: [BY_ID.m07_pi_a],
      p2Hand: [BY_ID.m08_pi_a, BY_ID.m03_gwang],
      deck: [BY_ID.m10_pi_a],
      captured: { p1: [BY_ID.m01_gwang, BY_ID.m01_tti_hong], p2: [] },
    });

    await p1.waitForFunction(
      () => (document.getElementById('fly-overlay')?.childElementCount ?? 0) === 0,
      { timeout: 15000 },
    );

    // 이제 lastChoiceSrcFlyActionKey가 'choice|m01_gwang|p1'로 설정됨
    // 이어서 상대(p2) 차례 choice 흐름 inject
    await p1.evaluate(() => { window.__matgoFlies = []; });

    await inject({
      turn: 'p1',
      phase: 'awaiting_play',
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
        p1: [BY_ID.m01_gwang, BY_ID.m01_tti_hong],
        p2: [BY_ID.m03_gwang, BY_ID.m03_tti_hong, BY_ID.m03_pi_a, BY_ID.m03_pi_b],
      },
    });

    // fly 완료 대기
    await p1.waitForFunction(
      () => (window.__matgoFlies || []).length > 0,
      { timeout: 8000 },
    );
    await p1.waitForFunction(
      () => (document.getElementById('fly-overlay')?.childElementCount ?? 0) === 0,
      { timeout: 15000 },
    );

    const flies = await p1.evaluate(() => window.__matgoFlies || []);
    console.log('[QA-65-3] fly log:', flies.map((f) => `${f.cardId}:${f.origin}`).join(', '));

    // 상대 차례 choice fly는 정확히 1회
    const oppHandFlies = flies.filter((f) => f.cardId === 'm03_gwang' && f.origin === 'opp-hand');
    expect(oppHandFlies.length).toBe(1);

    // 스크린샷
    await p1.screenshot({ path: 'tests/screenshots/qa65-05-sequential-choice-complete.png' });
  } finally {
    await browser.close();
  }
});

// ── QA-65-4: lastAction.kind가 HAND_ORIGIN_KINDS에 해당하는 경우 (choice_made) ──
test('QA-65-4: lastAction.kind=choice_made일 때 oppHandOriginIds에서 srcCard 제거 정상 동작', async () => {
  const { browser, p1 } = await openMatch();
  try {
    await p1.evaluate(() => { window.__matgoFlies = []; });

    // choice_made는 HAND_ORIGIN_KINDS에 포함됨 -> 경로 B(lastAction fallback)이
    // la.card를 oppHandOriginIds에 추가할 수 있는 케이스
    await inject({
      phase: 'awaiting_play',
      turn: 'p1',
      lastAction: {
        kind: 'choice_made',
        player: 'p2',
        month: 3,
        card: BY_ID.m03_gwang,
      },
      choiceFloorSrcCardId: 'm03_gwang',
      floor: [],
      p1Hand: [BY_ID.m07_pi_a],
      p2Hand: [BY_ID.m08_pi_a],
      deck: [BY_ID.m10_pi_a],
      captured: {
        p1: [],
        p2: [BY_ID.m03_gwang, BY_ID.m03_tti_hong],
      },
    });

    await p1.waitForFunction(
      () => (window.__matgoFlies || []).length > 0,
      { timeout: 8000 },
    );
    await p1.waitForFunction(
      () => (document.getElementById('fly-overlay')?.childElementCount ?? 0) === 0,
      { timeout: 15000 },
    );

    const flies = await p1.evaluate(() => window.__matgoFlies || []);
    console.log('[QA-65-4] fly log:', flies.map((f) => `${f.cardId}:${f.origin}`).join(', '));

    // opp-hand fly 정확히 1회 (중복 없음)
    const oppHandFlies = flies.filter((f) => f.cardId === 'm03_gwang' && f.origin === 'opp-hand');
    expect(oppHandFlies.length).toBe(1);

    await p1.screenshot({ path: 'tests/screenshots/qa65-06-choice-made-no-dup.png' });
  } finally {
    await browser.close();
  }
});

// ── QA-65-5: choiceFloorSrcCardId 없는 일반 턴에서 oppHandOriginIds 정상 동작 ──
test('QA-65-5: choiceFloorSrcCardId 없는 일반 상대 턴에서 fly 정상 1회', async () => {
  const { browser, p1 } = await openMatch();
  try {
    await p1.evaluate(() => { window.__matgoFlies = []; });

    // choiceFloorSrcCardId가 없는 일반 상대 턴
    await inject({
      phase: 'awaiting_play',
      turn: 'p1',
      lastAction: {
        kind: 'pair_from_hand',
        player: 'p2',
        month: 5,
        card: BY_ID.m05_tti_cho,
      },
      floor: [BY_ID.m03_tti_hong],
      p1Hand: [BY_ID.m07_pi_a],
      p2Hand: [BY_ID.m08_pi_a],
      deck: [BY_ID.m10_pi_a],
      captured: {
        p1: [],
        p2: [BY_ID.m05_tti_cho, BY_ID.m05_pi_a],
      },
    });

    await p1.waitForFunction(
      () => (window.__matgoFlies || []).length > 0,
      { timeout: 8000 },
    );
    await p1.waitForFunction(
      () => (document.getElementById('fly-overlay')?.childElementCount ?? 0) === 0,
      { timeout: 15000 },
    );

    const flies = await p1.evaluate(() => window.__matgoFlies || []);
    console.log('[QA-65-5] fly log:', flies.map((f) => `${f.cardId}:${f.origin}`).join(', '));

    // 상대 손 fly가 정상적으로 1회 존재해야 함 (가드가 이 경우를 차단하면 안 됨)
    const oppHandFlies = flies.filter((f) => f.origin === 'opp-hand');
    expect(oppHandFlies.length).toBeGreaterThanOrEqual(1);
  } finally {
    await browser.close();
  }
});
