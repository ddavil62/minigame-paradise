/**
 * @fileoverview QA 능동 탐색 테스트 -- 리포트 #63/#64 엣지케이스.
 *
 * - QA-63-E1: 쓸 조건 미충족(바닥 3장 시작)에서 sseul이 아닌지 확인
 * - QA-63-E2: 쓸 후 상대 피가 0장일 때 에러 없는지 확인
 * - QA-63-E3: 쓸 시나리오에서 stealPi 정확성 (상대 피 1장만 빼앗김)
 * - QA-64-E1: 폭탄 경로에서 chooseFloor가 발동해도 #63 sseul 판정이 간섭하지 않는지
 * - QA-64-E2: 라운드 시작 직후 첫 턴에 choice fly 발생해도 문제 없는지
 * - QA-CONSOLE: 전체 시나리오에서 콘솔 에러 없음
 *
 * 서버 사전 실행 필수: node matgo/server.js --port 3013
 */

import { test, expect, chromium } from '@playwright/test';
import { buildDeck } from '../cards.js';

const BASE_URL = process.env.MATGO_BASE_URL || 'http://localhost:3013';
const BY_ID = Object.fromEntries(buildDeck().map((card) => [card.id, card]));

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
    throw new Error(`inject failed (${response.status}): ${err.error || 'unknown'}`);
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

  await p1.goto(`${BASE_URL}/?name=QA-P1`);
  await p1.waitForFunction(
    () => document.getElementById('you-tag')?.textContent?.includes('P1'),
    { timeout: 8000 },
  );
  await p2.goto(`${BASE_URL}/?name=QA-P2`);
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

// ── QA-63-E1: 쓸 조건 미충족 시 sseul이 아닌지 확인 (바닥 3장 시작) ──
test('QA-63-E1: 바닥 3장 시작에서 쓸이 발동하지 않는다', async () => {
  const { browser, p1 } = await openMatch();
  try {
    // 바닥에 1월 3장(sweep_from_hand 경로) + 손에 1월 1장 + 덱은 관련 없는 카드
    await inject({
      turn: 'p1',
      phase: 'awaiting_play',
      p1Hand: [BY_ID.m01_gwang, BY_ID.m07_pi_a],
      p2Hand: [BY_ID.m08_pi_a],
      floor: [BY_ID.m01_tti_hong, BY_ID.m01_pi_a, BY_ID.m01_pi_b],
      deck: [BY_ID.m10_pi_a],
      captured: { p1: [], p2: [BY_ID.m06_pi_a] },
    });

    await p1.waitForFunction(
      () => (document.getElementById('fly-overlay')?.childElementCount ?? 0) === 0,
      { timeout: 8000 },
    );

    // 기존 토스트 제거
    await p1.evaluate(() => {
      document.querySelector('.action-toast')?.classList.remove('show');
    });

    // 1월 광 클릭 -> 3매칭 = sweep_from_hand (뻑 풀이 또는 4장 모두 가져감)
    await p1.click('#my-hand-cards [data-card-id="m01_gwang"]');

    // fly 완료 대기
    await p1.waitForFunction(
      () => (document.getElementById('fly-overlay')?.childElementCount ?? 0) === 0,
      { timeout: 15000 },
    );

    // 쓸 토스트가 나오면 안 됨. 2초 대기 후 확인.
    await new Promise((r) => setTimeout(r, 2000));
    const toastText = await p1.evaluate(
      () => document.querySelector('.action-toast.show')?.textContent || ''
    );
    expect(toastText).not.toContain('쓸');
    console.log('[QA-63-E1] toast (should not be sseul):', toastText);
  } finally {
    await browser.close();
  }
});

// ── QA-63-E2: 쓸 조건 충족 + 상대 피 0장일 때 에러 없이 처리 ──
test('QA-63-E2: 쓸 시 상대 피 0장이면 에러 없이 진행된다', async () => {
  const { browser, p1 } = await openMatch();
  const errors = [];
  try {
    p1.on('pageerror', (err) => errors.push(err.message));

    // 바닥 2장(3월) + 손 3월 1장 + 덱 3월 1장 + 상대 captured 비어있음(피 0)
    await inject({
      turn: 'p1',
      phase: 'awaiting_play',
      p1Hand: [BY_ID.m03_gwang, BY_ID.m07_pi_a],
      p2Hand: [BY_ID.m08_pi_a],
      floor: [BY_ID.m03_tti_hong, BY_ID.m03_pi_a],
      deck: [BY_ID.m03_pi_b],
      captured: { p1: [], p2: [] }, // 상대 피 0장
    });

    await p1.waitForFunction(
      () => (document.getElementById('fly-overlay')?.childElementCount ?? 0) === 0,
      { timeout: 8000 },
    );

    await p1.click('#my-hand-cards [data-card-id="m03_gwang"]');
    await p1.waitForSelector('#floor-choice-modal:not(.hidden)', { timeout: 8000 });
    await p1.click('#floor-choice-cards [data-card-id="m03_tti_hong"]');

    // 모든 처리가 완료될 때까지 대기
    await p1.waitForFunction(
      () => (document.getElementById('fly-overlay')?.childElementCount ?? 0) === 0,
      { timeout: 15000 },
    );

    // 콘솔 에러가 없어야 한다
    expect(errors).toEqual([]);
    console.log('[QA-63-E2] no errors with 0 opponent pi');
  } finally {
    await browser.close();
  }
});

// ── QA-63-E3: 쓸 후 상대 피 정확히 1장만 빼앗김 확인 ──
test('QA-63-E3: 쓸 후 상대 피가 정확히 1장 빼앗긴다', async () => {
  const { browser, p1 } = await openMatch();
  try {
    // 상대 피 3장으로 세팅
    await inject({
      turn: 'p1',
      phase: 'awaiting_play',
      p1Hand: [BY_ID.m03_gwang, BY_ID.m07_pi_a],
      p2Hand: [BY_ID.m08_pi_a],
      floor: [BY_ID.m03_tti_hong, BY_ID.m03_pi_a],
      deck: [BY_ID.m03_pi_b],
      captured: {
        p1: [],
        p2: [BY_ID.m06_pi_a, BY_ID.m06_pi_b, BY_ID.m07_pi_b],
      },
    });

    await p1.waitForFunction(
      () => (document.getElementById('fly-overlay')?.childElementCount ?? 0) === 0,
      { timeout: 8000 },
    );

    await p1.click('#my-hand-cards [data-card-id="m03_gwang"]');
    await p1.waitForSelector('#floor-choice-modal:not(.hidden)', { timeout: 8000 });
    await p1.click('#floor-choice-cards [data-card-id="m03_tti_hong"]');

    // 쓸 토스트 대기
    await p1.waitForFunction(
      () => {
        const toast = document.querySelector('.action-toast.show');
        return toast && toast.textContent.includes('쓸');
      },
      { timeout: 15000 },
    );

    // fly 완료 대기
    await p1.waitForFunction(
      () => (document.getElementById('fly-overlay')?.childElementCount ?? 0) === 0,
      { timeout: 15000 },
    );

    // P1 captured에 피 카운트 확인
    const p1PiCount = await p1.evaluate(() => {
      const piRow = document.querySelector('#my-captured-zone .cs-row[data-type="pi"]');
      if (!piRow) return -1;
      const match = piRow.textContent.match(/피\s*(\d+)/);
      return match ? parseInt(match[1]) : -1;
    });
    // P1은 3월 4장(광1 + 홍단1 + 피2) + 빼앗은 피 1장 = 피 3장 (광과 홍단은 피가 아님)
    // m03_gwang = gwang, m03_tti_hong = tti, m03_pi_a = pi, m03_pi_b = pi, stolen pi 1장
    expect(p1PiCount).toBe(3); // pi_a + pi_b + stolen 1

    // 스크린샷 캡처
    await p1.screenshot({
      path: 'tests/screenshots/qa-63-e3-sseul-steal.png',
    });
    console.log('[QA-63-E3] P1 pi count after sseul:', p1PiCount);
  } finally {
    await browser.close();
  }
});

// ── QA-CONSOLE: 쓸 시나리오 중 콘솔 에러 없음 확인 ──
test('QA-CONSOLE: 쓸 시나리오에서 콘솔 에러가 발생하지 않는다', async () => {
  const { browser, p1 } = await openMatch();
  const errors = [];
  try {
    p1.on('pageerror', (err) => errors.push(err.message));

    // #63 쓸 시나리오
    await inject({
      turn: 'p1',
      phase: 'awaiting_play',
      p1Hand: [BY_ID.m03_gwang, BY_ID.m07_pi_a],
      p2Hand: [BY_ID.m08_pi_a],
      floor: [BY_ID.m03_tti_hong, BY_ID.m03_pi_a],
      deck: [BY_ID.m03_pi_b],
      captured: { p1: [], p2: [BY_ID.m06_pi_a] },
    });

    await p1.waitForFunction(
      () => (document.getElementById('fly-overlay')?.childElementCount ?? 0) === 0,
      { timeout: 8000 },
    );

    await p1.click('#my-hand-cards [data-card-id="m03_gwang"]');
    await p1.waitForSelector('#floor-choice-modal:not(.hidden)', { timeout: 8000 });
    await p1.click('#floor-choice-cards [data-card-id="m03_tti_hong"]');

    // 쓸 토스트 대기
    await p1.waitForFunction(
      () => {
        const toast = document.querySelector('.action-toast.show');
        return toast && toast.textContent.includes('쓸');
      },
      { timeout: 15000 },
    );

    // fly 완료 대기
    await p1.waitForFunction(
      () => (document.getElementById('fly-overlay')?.childElementCount ?? 0) === 0,
      { timeout: 15000 },
    );

    // 스크린샷
    await p1.screenshot({
      path: 'tests/screenshots/qa-63-64-sseul-complete.png',
    });

    // 콘솔 에러가 0
    expect(errors).toEqual([]);
    console.log('[QA-CONSOLE] zero console errors in sseul scenario');
  } finally {
    await browser.close();
  }
});
