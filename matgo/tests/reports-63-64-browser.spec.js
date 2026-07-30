/**
 * @fileoverview 리포트 #63 / #64 브라우저 검증 테스트.
 *
 * T-63-sseul-toast:    실제 게임 흐름(바닥 2장 선택 + 덱 매칭)으로 '쓸!' 토스트 확인
 * T-64-opp-choice-fly: inject로 상대 차례 awaiting_floor_choice -> fly가 oppCardsEl에서 출발
 * T-64-my-choice-fly:  내 차례 awaiting_floor_choice -> fly가 myCardsEl에서 출발 (R5 회귀 방지)
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
  await p1.goto(`${BASE_URL}/?name=R63-P1`);
  await p1.waitForFunction(
    () => document.getElementById('you-tag')?.textContent?.includes('P1'),
    { timeout: 8000 },
  );
  await p2.goto(`${BASE_URL}/?name=R63-P2`);
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

// ── T-63: 쓸 토스트 표시 ──────────────────────────────────────────
test('T-63-sseul-toast: 바닥 2장 선택 + 덱 매칭 후 쓸! 토스트가 표시된다', async () => {
  const { browser, p1 } = await openMatch();
  try {
    // 쓸 시나리오: 바닥에 3월 2장 + 손에 3월 1장 + 덱에 3월 1장
    // -> 3월 광 클릭 -> awaiting_floor_choice 모달 -> 바닥 카드 선택
    // -> 덱에서 3월 피가 나와 나머지 1장과 매칭 -> 바닥 비움 + 상대 피 강탈 -> sseul!
    await inject({
      turn: 'p1',
      phase: 'awaiting_play',
      p1Hand: [BY_ID.m03_gwang, BY_ID.m07_pi_a],
      p2Hand: [BY_ID.m08_pi_a],
      floor: [BY_ID.m03_tti_hong, BY_ID.m03_pi_a],
      deck: [BY_ID.m03_pi_b],
      captured: { p1: [], p2: [BY_ID.m06_pi_a] },
    });

    // fly 안정화 대기
    await p1.waitForFunction(
      () => (document.getElementById('fly-overlay')?.childElementCount ?? 0) === 0,
      { timeout: 8000 },
    );

    // 기존 toast 제거
    await p1.evaluate(() => {
      document.querySelector('.action-toast')?.classList.remove('show');
    });

    // 3월 광 클릭 -> awaiting_floor_choice 발동
    await p1.click('#my-hand-cards [data-card-id="m03_gwang"]');
    await p1.waitForSelector('#floor-choice-modal:not(.hidden)', { timeout: 8000 });

    // 바닥 카드 선택(m03_tti_hong) -> 덱 뒤집기 -> 3월 피b가 나머지 3월 피a와 매칭 -> 바닥 비움 -> sseul
    await p1.click('#floor-choice-cards [data-card-id="m03_tti_hong"]');

    // 쓸! 토스트가 표시될 때까지 대기 (AC-63-1, AC-63-2)
    await p1.waitForFunction(
      () => {
        const toast = document.querySelector('.action-toast.show');
        return toast && toast.textContent.includes('쓸');
      },
      { timeout: 15000 },
    );

    // 토스트 텍스트 확인
    const toastText = await p1.evaluate(
      () => document.querySelector('.action-toast.show')?.textContent
    );
    expect(toastText).toContain('쓸!');
    console.log('[T-63] toast text:', toastText);

    // 같은 턴 내 중복 표시 없음 확인 (AC-63-3)
    const toastCount = await p1.evaluate(
      () => document.querySelectorAll('.action-toast.show').length
    );
    expect(toastCount).toBe(1);
  } finally {
    await browser.close();
  }
});

// ── T-64: 상대 차례 choice fly가 oppCardsEl에서 출발 ─────────────
test('T-64-opp-choice-fly: 상대 차례 choice fly가 상대 손 영역에서 출발한다', async () => {
  const { browser, p1 } = await openMatch();
  try {
    // fly origin 계측 초기화
    await p1.evaluate(() => { window.__matgoFlies = []; });

    // #64 fix가 대상으로 삼는 실제 코드 경로는 chooseFloorSteps 완료 "이후"에만
    // 세팅되는 g.pendingChoiceSrcCardId(STATE의 choiceFloorSrcCardId 필드) +
    // client.js의 _choiceSrcFlyId 발사 블록(1370행대)이다. 이 필드는 실제 서버에서
    // g.phase !== 'awaiting_floor_choice' 시점 이후에만 존재하며, srcCard(m03_gwang)와
    // 선택된 후보(m03_tti_hong)는 이미 captured로 이동한 상태다.
    // (choice_pending 단계에서 병합되는 pendingChoiceSourceCard 필드는 /test/inject가
    // 지원하지 않고, 이 테스트가 검증하려는 _choiceSrcFlyId 경로와도 무관하다.)
    await inject({
      phase: 'awaiting_play',
      turn: 'p1',
      lastAction: {
        kind: 'pair_from_flip',
        player: 'p2',
        month: 3,
      },
      choiceFloorSrcCardId: 'm03_gwang',
      floor: [],
      p1Hand: [BY_ID.m07_pi_a],
      p2Hand: [BY_ID.m08_pi_a],
      deck: [BY_ID.m10_pi_a],
      captured: { p1: [], p2: [BY_ID.m03_gwang, BY_ID.m03_tti_hong] },
    });

    // fly 등록 대기: fly 계측 배열에 항목이 1개 이상 추가될 때까지 대기
    await p1.waitForFunction(
      () => (window.__matgoFlies || []).length > 0,
      { timeout: 8000 },
    );

    // fly origin 확인 (AC-64-1, AC-64-2)
    const flies = await p1.evaluate(() => window.__matgoFlies || []);
    console.log('[T-64-opp] fly log:', flies.map((f) => `${f.cardId}:${f.origin}`).join(', '));

    const choiceFly = flies.find((f) => f.cardId === 'm03_gwang');
    // 상대 차례이므로 fly가 'opp-hand'(startFlyFromOppHand)에서 출발해야 한다
    expect(choiceFly).toBeTruthy();
    expect(choiceFly.origin).toBe('opp-hand');
    // 'hand'(startFlyFromHand, myCardsEl)에서 출발하면 안 된다
    const wrongFly = flies.find((f) => f.cardId === 'm03_gwang' && f.origin === 'hand');
    expect(wrongFly).toBeUndefined();
  } finally {
    await browser.close();
  }
});

// ── T-64: 내 차례 choice fly가 myCardsEl에서 출발 (R5 회귀 방지) ──
test('T-64-my-choice-fly: 내 차례 choice fly가 내 손에서 출발한다 (R5 회귀 방지)', async () => {
  const { browser, p1 } = await openMatch();
  try {
    // 바닥에 3월 2장 + 손에 3월 1장 + 덱에 관련 없는 카드
    await inject({
      turn: 'p1',
      phase: 'awaiting_play',
      p1Hand: [BY_ID.m03_gwang, BY_ID.m07_pi_a],
      p2Hand: [BY_ID.m08_pi_a],
      floor: [BY_ID.m03_tti_hong, BY_ID.m03_pi_a],
      deck: [BY_ID.m10_pi_a],
      captured: { p1: [], p2: [BY_ID.m06_pi_a] },
    });

    // fly 안정화 대기
    await p1.waitForFunction(
      () => (document.getElementById('fly-overlay')?.childElementCount ?? 0) === 0,
      { timeout: 8000 },
    );

    // fly origin 계측 초기화
    await p1.evaluate(() => { window.__matgoFlies = []; });

    // 3월 광 카드를 클릭 -> awaiting_floor_choice 발생
    await p1.click('#my-hand-cards [data-card-id="m03_gwang"]');
    // 바닥 선택 모달 대기
    await p1.waitForSelector('#floor-choice-modal:not(.hidden)', { timeout: 8000 });
    // 첫 번째 바닥 카드(m03_tti_hong) 선택
    await p1.click('#floor-choice-cards [data-card-id="m03_tti_hong"]');

    // 모든 fly가 완료될 때까지 대기
    await p1.waitForFunction(
      () => (document.getElementById('fly-overlay')?.childElementCount ?? 0) === 0,
      { timeout: 15000 },
    );

    // fly origin 확인 (AC-64-3: R5 회귀 방지)
    const flies = await p1.evaluate(() => window.__matgoFlies || []);
    console.log('[T-64-my] fly log:', flies.map((f) => `${f.cardId}:${f.origin}`).join(', '));

    // 내 차례이므로 m03_gwang fly가 'hand'(startFlyFromHand, myCardsEl)에서 출발해야 한다
    const handFlies = flies.filter((f) => f.cardId === 'm03_gwang' && f.origin === 'hand');
    expect(handFlies.length).toBeGreaterThanOrEqual(1);

    // 'opp-hand'에서 출발하면 안 된다
    const oppFly = flies.find((f) => f.cardId === 'm03_gwang' && f.origin === 'opp-hand');
    expect(oppFly).toBeUndefined();
  } finally {
    await browser.close();
  }
});
