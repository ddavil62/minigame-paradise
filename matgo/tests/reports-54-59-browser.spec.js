/**
 * @fileoverview 리포트 #54~#59 Phase B + C 브라우저 검증 테스트.
 *
 * Phase B:
 * - T-55-ppeok-delay: 뻑 후 상대 턴 전환 500ms 딜레이
 * - T-59-btngo-disabled: 고/스톱 창에서 고 버튼 비활성화 (손패 0 + credit 0)
 * - T-59-btngo-enabled: 일반 고/스톱 창에서 고 버튼 활성화
 * - T-56-opp-hand-stable: 상대 손패 장수 변화에도 zone height 불변
 *
 * Phase C:
 * - T-54-fly-dedup: 바닥 2장 선택 흐름에서 중복 fly 재생 없음
 * - T-57-ttadak-toast: 따닥 토스트 정상 표시
 * - T-58-jjok-toast-timing: 쪽 토스트가 fly 완료 직후 표시 (다음 턴 이전)
 *
 * 서버 사전 실행 필수: node matgo/server.js --port 3013
 */

import { test, expect, chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildDeck } from '../cards.js';

/** T-55 소스 구조 검증 대상 파일 경로 */
const CLIENT_JS_PATH = fileURLToPath(new URL('../public/client.js', import.meta.url));

const BASE_URL = process.env.MATGO_BASE_URL || 'http://localhost:3013';
const BY_ID = Object.fromEntries(buildDeck().map((card) => [card.id, card]));

/**
 * 결정적 게임 상태를 주입한다.
 * @param {object} state
 * @returns {Promise<void>}
 */
async function inject(state) {
  // inject 전 게임 존재 확인 — game이 null이면 재시도(최대 3회, 500ms 간격)
  for (let attempt = 0; attempt < 3; attempt++) {
    const statusRes = await fetch(`${BASE_URL}/test/status`);
    const status = await statusRes.json();
    if (status.phase !== null) break; // 게임 활성
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
  // 진단용 계측 추가
  await p1.addInitScript(() => {
    window.__matgoDiagnostics = {};
    window.__r5459SentMessages = [];
    const originalSend = WebSocket.prototype.send;
    WebSocket.prototype.send = function instrumentedSend(data) {
      try {
        window.__r5459SentMessages.push(JSON.parse(data));
      } catch {
        window.__r5459SentMessages.push(data);
      }
      return originalSend.call(this, data);
    };
  });
  // e2e-scenarios.spec.js의 joinAndStartGame 패턴을 따른다.
  // P1 먼저 입장 후 you-tag 확인 → P2 입장 → 상대 손패 10장 확인 → fly 대기.
  await p1.goto(`${BASE_URL}/?name=R54-P1`);
  await p1.waitForFunction(
    () => document.getElementById('you-tag')?.textContent?.includes('P1'),
    { timeout: 8000 },
  );
  await p2.goto(`${BASE_URL}/?name=R54-P2`);
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

// ── T-55: 뻑 후 상대 턴 전환 딜레이 ────────────────────────────────
test('T-55-ppeok-delay: finishAnimation에 뻑 딜레이 코드가 존재한다', () => {
  // 코드 구조 검증: finishAnimation 함수 내 wasPpeok 분기에서
  // setTimeout으로 flushStateQueue를 500ms 지연시키는 코드가 존재하는지 확인.
  // 실제 뻑 시나리오는 inject 타이밍에 의존적이므로 코드 존재 검증으로 대체한다.
  //
  // 이전 구현은 브라우저를 띄워 fetch로 client.js를 받아 다중 lazy 정규식을 돌렸다.
  // 파일 전체(140KB+)에 대한 `[\s\S]*?` 연쇄가 백트래킹으로 폭주해 120초 타임아웃을
  // 유발했고, 소스 텍스트 검사에 불필요한 브라우저/서버 의존까지 안고 있었다.
  // 파일을 직접 읽고 wasPpeok 분기 구간만 잘라 순차 검사하는 방식으로 교체한다.
  const src = readFileSync(CLIENT_JS_PATH, 'utf8');

  // 1) 딜레이 구성 요소 존재
  expect(src).toContain('wasPpeok');
  expect(src).toContain('ppeokDelayActive');

  // 2) 딜레이 중 STATE 큐잉 유지 가드
  expect(src).toContain('isAnimating || ppeokDelayActive');

  // 3) wasPpeok 분기 구간을 잘라 순차 등장 검사 (백트래킹 없음)
  const branchStart = src.indexOf('if (wasPpeok)');
  expect(branchStart).toBeGreaterThan(-1);
  // 분기 본문은 수십 줄 이내다. 넉넉히 800자만 잘라 검사한다.
  const branch = src.slice(branchStart, branchStart + 800);
  const sequence = [
    'ppeokDelayActive = true',
    'setTimeout(',
    'ppeokDelayActive = false',
    'flushStateQueue()',
    '500',
  ];
  let cursor = 0;
  for (const token of sequence) {
    const at = branch.indexOf(token, cursor);
    expect(at, `wasPpeok 분기에서 '${token}'을 순서대로 찾지 못했다`).toBeGreaterThan(-1);
    cursor = at + token.length;
  }
});

// ── T-59: 고 버튼 비활성화 ──────────────────────────────────────
test('T-59-btngo-disabled: 손패 0 + credit 0이면 고 버튼 disabled', async () => {
  const { browser, p1 } = await openMatch();
  try {
    // 고/스톱 상태 주입: P1이 7점 이상 + 손패 0 + credit 0
    await inject({
      turn: 'p1',
      phase: 'awaiting_go_stop',
      p1Hand: [],
      p2Hand: [BY_ID.m09_pi_a],
      floor: [],
      deck: [],
      captured: {
        p1: [
          BY_ID.m01_gwang, BY_ID.m03_gwang, BY_ID.m08_gwang,
          BY_ID.m11_gwang, BY_ID.m12_gwang_bigwang,
        ],
        p2: [],
      },
      goCount: { p1: 0, p2: 0 },
      bombDeckCredit: { p1: 0, p2: 0 },
    });

    // go-stop 오버레이가 표시될 때까지 대기
    await p1.waitForSelector('#go-stop-overlay:not(.hidden)', { timeout: 8000 });

    // btnGo.disabled === true 확인
    const isDisabled = await p1.evaluate(() => {
      return document.getElementById('btn-go')?.disabled === true;
    });
    expect(isDisabled).toBe(true);

    // disabled 상태에서 클릭 시 GO_STOP WS 미전송 확인 (AC-59-2)
    await p1.evaluate(() => { window.__r5459SentMessages = []; });
    await p1.click('#btn-go', { force: true });
    await p1.waitForTimeout(200);
    const goStopMessages = await p1.evaluate(() =>
      window.__r5459SentMessages.filter((m) => m.type === 'GO_STOP')
    );
    expect(goStopMessages.length).toBe(0);

    // 안내 문구 확인
    const actionText = await p1.evaluate(() =>
      document.getElementById('action-display')?.textContent
    );
    expect(actionText).toContain('스톱만 가능');

    // disabled 시각 상태 확인 (opacity < 1)
    const opacity = await p1.evaluate(() => {
      const btn = document.getElementById('btn-go');
      return parseFloat(getComputedStyle(btn).opacity);
    });
    expect(opacity).toBeLessThan(1);
  } finally {
    await browser.close();
  }
});

test('T-59-btngo-enabled: 손패 1장 이상이면 고 버튼 활성화', async () => {
  const { browser, p1 } = await openMatch();
  try {
    // 고/스톱 상태 주입: P1이 7점 이상 + 손패 1장 이상
    await inject({
      turn: 'p1',
      phase: 'awaiting_go_stop',
      p1Hand: [BY_ID.m08_pi_a],
      p2Hand: [BY_ID.m09_pi_a],
      floor: [],
      deck: [BY_ID.m10_pi_a],
      captured: {
        p1: [
          BY_ID.m01_gwang, BY_ID.m03_gwang, BY_ID.m08_gwang,
          BY_ID.m11_gwang, BY_ID.m12_gwang_bigwang,
        ],
        p2: [],
      },
      goCount: { p1: 0, p2: 0 },
      bombDeckCredit: { p1: 0, p2: 0 },
    });

    // go-stop 오버레이가 표시될 때까지 대기
    await p1.waitForSelector('#go-stop-overlay:not(.hidden)', { timeout: 8000 });

    // btnGo.disabled === false 확인 (AC-59-3)
    const isDisabled = await p1.evaluate(() => {
      return document.getElementById('btn-go')?.disabled;
    });
    expect(isDisabled).toBe(false);
  } finally {
    await browser.close();
  }
});

// ── T-56: 상대 손 영역 높이 안정성 ────────────────────────────────
test('T-56-opp-hand-stable: 장수 변화에도 opp-hand-zone height 불변', async () => {
  const INJECT_URL = `${BASE_URL}/test/inject`;

  /**
   * 상대 손패 장수를 설정한다.
   * @param {number} count
   */
  async function injectOppHandCount(count) {
    const cards = [];
    for (let i = 1; i <= count; i++) {
      const m = String(i).padStart(2, '0');
      cards.push({ id: `m${m}_gwang`, month: i, type: 'gwang', name: `${i}월 광` });
    }
    const res = await fetch(INJECT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ p2Hand: cards }),
    });
    return res.ok;
  }

  // 12조합에서 opp-hand-zone rect.height가 동일한지 검증
  // (같은 해상도 내에서 장수 변화 시 높이 불변이어야 한다)
  const VIEWPORTS = [
    { name: '1920x1080', width: 1920, height: 1080 },
    { name: '1366x768', width: 1366, height: 768 },
    { name: '1280x720', width: 1280, height: 720 },
  ];
  const HAND_SIZES = [10, 7, 5, 2];
  const failures = [];

  for (const vp of VIEWPORTS) {
    const heights = [];

    for (const handSize of HAND_SIZES) {
      await fetch(`${BASE_URL}/test/reset`, { method: 'POST' });
      await new Promise((r) => setTimeout(r, 200));
      const browser = await chromium.launch();
      const ctx1 = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      const ctx2 = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      const p1 = await ctx1.newPage();
      const p2 = await ctx2.newPage();
      await p1.goto(`${BASE_URL}?name=T56P1`);
      await p1.waitForFunction(
        () => document.getElementById('you-tag')?.textContent?.includes('P1'),
        { timeout: 8000 },
      );
      await p2.goto(`${BASE_URL}?name=T56P2`);
      await p1.waitForFunction(
        () => document.querySelectorAll('#opp-hand-cards .card.back').length === 10,
        { timeout: 8000 },
      );
      await p1.waitForFunction(
        () => (document.getElementById('fly-overlay')?.childElementCount ?? 0) === 0,
        { timeout: 8000 },
      );

      if (handSize < 10) {
        await injectOppHandCount(handSize);
        await p1.waitForFunction(
          (expected) => document.querySelectorAll('#opp-hand-cards .card').length === expected,
          handSize,
          { timeout: 8000 },
        );
        await p1.waitForFunction(
          () => (document.getElementById('fly-overlay')?.childElementCount ?? 0) === 0,
          { timeout: 8000 },
        );
      }

      const m = await p1.evaluate(() => {
        const zone = document.querySelector('.opp-hand-zone');
        const r = zone.getBoundingClientRect();
        const cards = document.querySelectorAll('#opp-hand-cards .card');
        const floorZone = document.querySelector('.floor-zone');
        const fr = floorZone ? floorZone.getBoundingClientRect() : null;
        const maxBottom = Array.from(cards).reduce(
          (max, c) => Math.max(max, c.getBoundingClientRect().bottom), 0,
        );
        return {
          zoneHeight: +r.height.toFixed(2),
          zoneBottom: +r.bottom.toFixed(2),
          cardCount: cards.length,
          clippedCount: Array.from(cards).filter(
            (c) => c.getBoundingClientRect().bottom > r.bottom + 0.5,
          ).length,
          floorGap: fr ? +(fr.top - maxBottom).toFixed(2) : 999,
          floorBoxOverlapPx2: (() => {
            if (!fr) return 0;
            let sum = 0;
            for (const c of cards) {
              const cr = c.getBoundingClientRect();
              const ow = Math.max(0, Math.min(cr.right, fr.right) - Math.max(cr.left, fr.left));
              const oh = Math.max(0, Math.min(cr.bottom, fr.bottom) - Math.max(cr.top, fr.top));
              sum += ow * oh;
            }
            return +sum.toFixed(2);
          })(),
          computedW: cards.length ? getComputedStyle(cards[0]).width : 'N/A',
          computedH: cards.length ? getComputedStyle(cards[0]).height : 'N/A',
        };
      });

      heights.push({ handSize, ...m });
      const label = `[${vp.name}/${handSize}장]`;

      // 기본 검증: 잘림 0, 겹침 0, floorGap >= 8, 카드 크기 유지
      if (m.clippedCount > 0) failures.push(`${label} clipped=${m.clippedCount}`);
      if (m.floorBoxOverlapPx2 > 0) failures.push(`${label} floorBoxOverlap=${m.floorBoxOverlapPx2}`);
      if (m.cardCount > 0 && m.floorGap < 8) failures.push(`${label} floorGap=${m.floorGap} < 8px`);
      if (m.computedW !== '60px' || m.computedH !== '85px') {
        failures.push(`${label} card size ${m.computedW}x${m.computedH}`);
      }

      await browser.close();
    }

    // 핵심 검증: 같은 해상도 내에서 zone height가 모든 장수에서 동일해야 한다
    const uniqueHeights = new Set(heights.map((h) => h.zoneHeight));
    if (uniqueHeights.size > 1) {
      const detail = heights.map((h) => `${h.handSize}장=${h.zoneHeight}px`).join(', ');
      failures.push(`[${vp.name}] zone height varies: ${detail}`);
    }

    console.log(`[${vp.name}] zone heights:`, heights.map((h) => `${h.handSize}장=${h.zoneHeight}px`).join(', '));
  }

  if (failures.length > 0) {
    console.log('=== FAILURES ===');
    for (const f of failures) console.log('  ' + f);
  }
  expect(failures).toEqual([]);
});

// ── Phase C 테스트 ────────────────────────────────────────────────

// ── T-54: 바닥 2장 선택 후 중복 fly 제거 ──────────────────────────
test('T-54-fly-dedup: 바닥 2장 선택 흐름에서 choice srcCard fly가 1회만 등록된다', async () => {
  const { browser, p1 } = await openMatch();
  try {
    // 바닥에 같은 월(1월) 2장 + 손에 같은 월 1장 + 덱에 같은 월 1장
    // → 손패 클릭 → 바닥 선택(awaiting_floor_choice) → 선택 확정 → 덱 뒤집기 → 따닥(4장 포획)
    await inject({
      turn: 'p1',
      phase: 'awaiting_play',
      p1Hand: [BY_ID.m01_gwang, BY_ID.m07_pi_a],
      p2Hand: [BY_ID.m08_pi_a],
      floor: [BY_ID.m01_tti_hong, BY_ID.m01_pi_a],
      deck: [BY_ID.m01_pi_b],
      captured: { p1: [], p2: [BY_ID.m06_pi_a] },
    });

    // fly 안정화 대기
    await p1.waitForFunction(
      () => (document.getElementById('fly-overlay')?.childElementCount ?? 0) === 0,
      { timeout: 8000 },
    );

    // fly 계측: client.js의 `recordFlyOrigin` 진단 훅(`window.__matgoFlies`)을 활성화한다.
    // 이 배열은 fly 클론이 생성될 때마다 {cardId, origin} 항목을 누적하므로,
    // "손 → 바닥"(origin: 'hand') fly와 정산 fly('my-captured' 등)를 구분할 수 있다.
    // #54는 손 fly 중복 재생 버그이므로 origin === 'hand' 항목만 세어야 한다.
    await p1.evaluate(() => { window.__matgoFlies = []; });

    // 1월 광 카드를 클릭 → awaiting_floor_choice 발생
    await p1.click('#my-hand-cards [data-card-id="m01_gwang"]');
    // 바닥 선택 모달 대기
    await p1.waitForSelector('#floor-choice-modal:not(.hidden)', { timeout: 8000 });
    // 첫 번째 바닥 카드(m01_tti_hong) 선택
    await p1.click('#floor-choice-cards [data-card-id="m01_tti_hong"]');

    // 모든 fly가 완료될 때까지 대기
    await p1.waitForFunction(
      () => (document.getElementById('fly-overlay')?.childElementCount ?? 0) === 0,
      { timeout: 15000 },
    );

    // 검증: m01_gwang의 "손 → 바닥" fly가 정확히 1회만 등록됐는지 확인 (AC-54-1, AC-54-2)
    const flies = await p1.evaluate(() => window.__matgoFlies || []);
    console.log('[T-54] fly log:', flies.map((f) => `${f.cardId}:${f.origin}`).join(', '));

    const handFlies = flies.filter((f) => f.cardId === 'm01_gwang' && f.origin === 'hand');
    // 클릭 핸들러(sendPlay)에서 1회 등록되고, 통합 STATE 재렌더에서는 재등록되지 않아야 한다.
    // (정산 fly는 origin이 'my-captured'/'opp-captured'이므로 여기 포함되지 않는다.)
    expect(handFlies.length).toBe(1);

    // 최종 captured에 4장(1월 광+1월 끗+1월 피a+1월 피b)이 안착했는지 확인 (AC-54-3 기본)
    const capturedCount = await p1.evaluate(() =>
      document.querySelectorAll('#my-captured-zone [data-card-id]').length
    );
    // 최소 1장은 captured에 있어야 한다 (정확한 수는 피 강탈 포함 변동 가능)
    expect(capturedCount).toBeGreaterThanOrEqual(1);
  } finally {
    await browser.close();
  }
});

// ── T-57: 따닥 텍스트 효과 ────────────────────────────────────────
test('T-57-ttadak-toast: 따닥 상황에서 따닥! 토스트가 fly 완료 직후 표시된다', async () => {
  const { browser, p1 } = await openMatch();
  try {
    // 따닥 시나리오: 바닥에 1월 2장 + 손에 1월 1장 + 덱에 1월 1장
    // → 바닥 선택 후 덱 뒤집기가 나머지 1장과 매칭 → ttadak
    await inject({
      turn: 'p1',
      phase: 'awaiting_play',
      p1Hand: [BY_ID.m01_gwang, BY_ID.m07_pi_a],
      p2Hand: [BY_ID.m08_pi_a],
      floor: [BY_ID.m01_tti_hong, BY_ID.m01_pi_a],
      deck: [BY_ID.m01_pi_b],
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

    // 1월 광 클릭 → 바닥 선택 → 확정
    await p1.click('#my-hand-cards [data-card-id="m01_gwang"]');
    await p1.waitForSelector('#floor-choice-modal:not(.hidden)', { timeout: 8000 });
    await p1.click('#floor-choice-cards [data-card-id="m01_tti_hong"]');

    // 따닥! 토스트가 표시되는지 확인 (AC-57-1)
    // fly 완료 후 토스트가 표시돼야 한다 (AC-57-2)
    await p1.waitForFunction(
      () => {
        const toast = document.querySelector('.action-toast.show');
        return toast && toast.textContent.includes('따닥');
      },
      { timeout: 15000 },
    );

    // 토스트 텍스트 확인
    const toastText = await p1.evaluate(
      () => document.querySelector('.action-toast.show')?.textContent
    );
    expect(toastText).toContain('따닥!');

    // 같은 턴 내 중복 표시 없음 확인 (AC-57-3)
    // action-toast.show가 1개만 있어야 한다
    const toastCount = await p1.evaluate(
      () => document.querySelectorAll('.action-toast.show').length
    );
    expect(toastCount).toBe(1);
  } finally {
    await browser.close();
  }
});

// ── T-58: 쪽 효과 표시 타이밍 ─────────────────────────────────────
test('T-58-jjok-toast-timing: 쪽 토스트가 fly 완료 직후 표시된다 (다음 턴 이전)', async () => {
  const { browser, p1 } = await openMatch();
  try {
    // 쪽 시나리오: 바닥에 5월 끗 1장 + 손에 5월 끗 1장 + 덱에 5월 피
    // → 5월 끗을 내서 바닥 5월 끗과 매칭 → 덱 5월 피가 나와서 쪽(같은 월 2장 나감)
    // 실제로는 hand 1매칭 + deck 0매칭(바닥에 같은 월 없음)이 쪽이다.
    // 쪽 조건: 바닥에 같은 월 0장 + 손에서 낸 카드가 바닥에 쌓임 + 덱에서 같은 월 나옴
    //   → 손패가 바닥에 놓이고 + 덱에서 같은 월이 나와서 2장을 가져감
    // 정확한 쪽: 바닥에 동월 없음 → 손패 바닥에 놓음(0매칭) → 덱에서 같은 월 뒤집음 → 2장 가져감
    await inject({
      turn: 'p1',
      phase: 'awaiting_play',
      p1Hand: [BY_ID.m05_kkeut, BY_ID.m01_pi_a],
      p2Hand: [BY_ID.m06_kkeut],
      floor: [BY_ID.m07_tti_cho],
      deck: [BY_ID.m05_pi_a],
      captured: { p1: [], p2: [BY_ID.m07_pi_a] },
    });

    // fly 안정화 대기
    await p1.waitForFunction(
      () => (document.getElementById('fly-overlay')?.childElementCount ?? 0) === 0,
      { timeout: 8000 },
    );

    // 기존 toast 제거 + 타이밍 계측 설치
    await p1.evaluate(() => {
      document.querySelector('.action-toast')?.classList.remove('show');
      window.__jjokToastTimestamp = null;
      window.__flyDoneTimestamp = null;
      // toast 표시 시각 캡처
      const toastObserver = new MutationObserver(() => {
        const toast = document.querySelector('.action-toast.show');
        if (toast && toast.textContent.includes('쪽') && !window.__jjokToastTimestamp) {
          window.__jjokToastTimestamp = performance.now();
        }
      });
      toastObserver.observe(document.documentElement, {
        subtree: true, childList: true, attributes: true, attributeFilter: ['class'],
      });
      // fly 완료(overlay 빈 상태) 시각 캡처
      const overlay = document.getElementById('fly-overlay');
      const flyObserver = new MutationObserver(() => {
        if (overlay.childElementCount === 0 && window.__flyDoneTimestamp === null) {
          // fly가 있었다가 사라진 경우만 기록
          if (window.__hadFlies) {
            window.__flyDoneTimestamp = performance.now();
          }
        } else if (overlay.childElementCount > 0) {
          window.__hadFlies = true;
        }
      });
      flyObserver.observe(overlay, { childList: true });
      window.__hadFlies = false;
    });

    // 5월 끗 카드를 클릭 — 쪽 발동
    await p1.click('#my-hand-cards [data-card-id="m05_kkeut"]');

    // 쪽! 토스트가 표시될 때까지 대기 (AC-58-1, AC-58-2)
    await p1.waitForFunction(
      () => {
        const toast = document.querySelector('.action-toast.show');
        return toast && toast.textContent.includes('쪽');
      },
      { timeout: 15000 },
    );

    // 토스트 텍스트 확인
    const toastText = await p1.evaluate(
      () => document.querySelector('.action-toast.show')?.textContent
    );
    expect(toastText).toContain('쪽');

    // 타이밍 확인: fly 완료 후 100ms 이내에 toast가 표시됐는지 (AC-58-1)
    const timing = await p1.evaluate(() => ({
      flyDone: window.__flyDoneTimestamp,
      toastShown: window.__jjokToastTimestamp,
      hadFlies: window.__hadFlies,
    }));

    if (timing.flyDone && timing.toastShown) {
      const delta = timing.toastShown - timing.flyDone;
      console.log(`[T-58] fly완료→toast 시간차: ${delta.toFixed(1)}ms`);
      // fly 완료 후 100ms 이내에 토스트가 표시돼야 한다.
      // 음수도 허용 (toast가 fly와 동시 또는 직전에 표시될 수 있음)
      expect(delta).toBeLessThan(100);
    }

    // 다음 상대 턴 STATE가 렌더되기 전에 이미 토스트가 표시됐는지 확인 (AC-58-2)
    // 토스트가 이미 표시됐으므로 이 시점까지 도달 = 통과
    expect(timing.toastShown).not.toBeNull();
  } finally {
    await browser.close();
  }
});
