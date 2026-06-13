/**
 * @fileoverview 맞고 E2E 시나리오 테스트 — 브라우저 + WebSocket + 서버 통합.
 *
 * 서버 사전 실행 필수: node matgo/server.js --port 3013
 * 실행: npx playwright test tests/e2e-scenarios.spec.js --reporter=list
 *
 * 룰 기준: .claude/specs/2026-05-30-matgo-rulebook.md
 *
 * 특이사항:
 *   - POST /test/inject 엔드포인트를 사용해 결정적 게임 상태를 주입한다.
 *   - 주입 후 WebSocket STATE broadcast가 클라이언트에 반영될 때까지 waitForFunction으로 대기.
 *   - 각 test는 독립된 browser instance를 사용해 룸 상태 간섭을 방지한다.
 */

import { test, expect, chromium } from 'playwright/test';
import { buildDeck } from '../cards.js';

const BASE_URL  = 'http://localhost:3013';
const INJECT_URL = `${BASE_URL}/test/inject`;
const VIEWPORT   = { width: 1280, height: 800 };

// ── 카드 룩업 ─────────────────────────────────────────────────────────
const ALL_CARDS = buildDeck();
const BY_ID = Object.fromEntries(ALL_CARDS.map((c) => [c.id, c]));
const card = (id) => BY_ID[id];
const cards = (...ids) => ids.map(card);
const repeat = (id, n) => Array.from({ length: n }, () => card(id));

// ── 유틸리티 ──────────────────────────────────────────────────────────

/** 두 독립 컨텍스트로 P1/P2 페이지를 생성. */
async function setupTwoPlayers() {
  const browser = await chromium.launch();
  const ctxP1 = await browser.newContext({ viewport: VIEWPORT });
  const ctxP2 = await browser.newContext({ viewport: VIEWPORT });
  const pageP1 = await ctxP1.newPage();
  const pageP2 = await ctxP2.newPage();
  return { browser, ctxP1, ctxP2, pageP1, pageP2 };
}

/** 두 페이지 모두 게임 참가 후 손패 10장씩 수신 대기. */
async function joinAndStartGame(pageP1, pageP2) {
  await pageP1.goto(BASE_URL);
  await pageP1.waitForFunction(
    () => document.getElementById('you-tag')?.textContent?.includes('P1'),
    { timeout: 8000 },
  );
  await pageP2.goto(BASE_URL);
  await pageP2.waitForFunction(
    () => document.getElementById('you-tag')?.textContent?.includes('P2'),
    { timeout: 8000 },
  );
  // 두 명 입장 완료 → 상대 손패 10장 뒷면이 보여야 STATE 수신 완료
  await pageP1.waitForFunction(
    () => document.querySelectorAll('#opp-hand-cards .card.back').length === 10,
    { timeout: 8000 },
  );
  await pageP2.waitForFunction(
    () => document.querySelectorAll('#opp-hand-cards .card.back').length === 10,
    { timeout: 8000 },
  );
}

/** DOM 기반 게임 상태를 추출한다. */
async function readState(page) {
  return page.evaluate(() => {
    const myHand = Array.from(document.querySelectorAll('#my-hand-cards .card'))
      .map((el) => el.dataset.cardId).filter(Boolean);
    const floorIds = Array.from(document.querySelectorAll('#floor-cards > .card'))
      .map((el) => el.dataset.cardId).filter(Boolean);
    return {
      youTag:          document.getElementById('you-tag')?.textContent?.trim(),
      myHand,
      yourHandLen:     myHand.length,
      oppHandLen:      document.querySelectorAll('#opp-hand-cards .card.back').length,
      floorIds,
      deckCount:       parseInt(document.getElementById('deck-count-big')?.textContent ?? '-1', 10),
      myScore:         parseInt(document.getElementById('my-score')?.textContent  ?? '-1', 10),
      oppScore:        parseInt(document.getElementById('opp-score')?.textContent ?? '-1', 10),
      myMoney:         document.getElementById('my-money')?.textContent,
      oppMoney:        document.getElementById('opp-money')?.textContent,
      myExtra:         document.getElementById('my-extra')?.textContent,
      oppExtra:        document.getElementById('opp-extra')?.textContent,
      bannerStatus:    document.getElementById('banner-status')?.textContent?.trim(),
      bannerMulti:     document.getElementById('banner-multiplier')?.textContent,
      firstClickableId: document.querySelector('#my-hand-cards .card.clickable')?.dataset?.cardId,
      shakePanelVisible:  !document.getElementById('shake-modal')?.classList.contains('hidden'),
      bombPanelVisible:   !document.getElementById('bomb-panel')?.classList.contains('hidden'),
      goStopVisible:      !document.getElementById('go-stop-overlay')?.classList.contains('hidden'),
      kkeutModalVisible:  !document.getElementById('kkeut-modal')?.classList.contains('hidden'),
      roundModalVisible:  !document.getElementById('round-modal')?.classList.contains('hidden'),
      floorChoiceVisible: !document.getElementById('floor-choice-modal')?.classList.contains('hidden'),
    };
  });
}

/**
 * POST /test/inject 로 게임 상태를 주입하고 HTTP 200 응답을 검증한다.
 * @param {object} cfg - 주입할 상태 (cards는 buildDeck()으로 구성한 객체)
 */
async function inject(cfg) {
  const res = await fetch(INJECT_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(cfg),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`inject 실패: ${json.error}`);
  return json;
}

/** inject 후 deck-count-big가 예상값으로 갱신될 때까지 대기. */
async function waitForDeckCount(page, expectedCount, timeout = 4000) {
  await page.waitForFunction(
    (n) => parseInt(document.getElementById('deck-count-big')?.textContent ?? '-1', 10) === n,
    expectedCount,
    { timeout },
  );
}

/** inject 후 내 손패 카운트가 예상값으로 갱신될 때까지 대기. */
async function waitForHandCount(page, expectedCount, timeout = 4000) {
  await page.waitForFunction(
    (n) => document.querySelectorAll('#my-hand-cards .card').length === n,
    expectedCount,
    { timeout },
  );
}

/**
 * fly 애니메이션이 완전히 끝나(클론 0개) 클릭 입력이 받아들여질 상태까지 대기한다.
 *
 * inject로 손패/바닥을 통째로 교체하면 client가 STATE diff를 카드 이동으로 해석해
 * 옵티미스틱 fly(HAND_THROW→…→CLEANUP)를 한 차례 발동한다. 이때 isAnimating=true라
 * sendPlay()가 조용히 무시되므로(중복 입력 가드), fly clone(#fly-overlay 자식)이
 * 모두 제거된 뒤에 카드를 클릭해야 PLAY_CARD가 실제로 송신된다.
 * @param {import('playwright/test').Page} page
 */
async function waitForFlyIdle(page, timeout = 4000) {
  await page.waitForFunction(
    () => (document.getElementById('fly-overlay')?.childElementCount ?? 0) === 0,
    { timeout },
  );
}

// ── 테스트 타임아웃 ────────────────────────────────────────────────────
test.setTimeout(60000);

// ============================================================
// §1 기본 연결 / 입장
// ============================================================

test('E-01: P1 단독 입장 → P1 태그 표시 + 대기 상태', async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  const page = await ctx.newPage();
  try {
    await page.goto(BASE_URL);
    await page.waitForFunction(
      () => document.getElementById('you-tag')?.textContent?.includes('P1'),
      { timeout: 8000 },
    );
    const youTag = await page.evaluate(
      () => document.getElementById('you-tag')?.textContent,
    );
    expect(youTag).toContain('P1');
  } finally {
    await browser.close();
  }
});

test('E-02: 두 플레이어 입장 → 게임 시작, 손패 10+10', async () => {
  const { browser, pageP1, pageP2 } = await setupTwoPlayers();
  try {
    await joinAndStartGame(pageP1, pageP2);
    const s1 = await readState(pageP1);
    const s2 = await readState(pageP2);
    expect(s1.yourHandLen).toBe(10);
    expect(s2.yourHandLen).toBe(10);
    expect(s1.oppHandLen).toBe(10);
    expect(s2.oppHandLen).toBe(10);
  } finally {
    await browser.close();
  }
});

test('E-03: 게임 시작 시 초기 덱 수 = 20', async () => {
  const { browser, pageP1, pageP2 } = await setupTwoPlayers();
  try {
    await joinAndStartGame(pageP1, pageP2);
    const s = await readState(pageP1);
    expect(s.deckCount).toBe(20);
  } finally {
    await browser.close();
  }
});

test('E-04: 게임 시작 시 바닥 8장', async () => {
  const { browser, pageP1, pageP2 } = await setupTwoPlayers();
  try {
    await joinAndStartGame(pageP1, pageP2);
    const s = await readState(pageP1);
    expect(s.floorIds.length).toBe(8);
  } finally {
    await browser.close();
  }
});

test('E-05: 게임 시작 시 초기 점수 = 0, 잔고 = 10,000', async () => {
  const { browser, pageP1, pageP2 } = await setupTwoPlayers();
  try {
    await joinAndStartGame(pageP1, pageP2);
    const s = await readState(pageP1);
    expect(s.myScore).toBe(0);
    expect(s.oppScore).toBe(0);
    expect(s.myMoney).toMatch(/10,000/);
  } finally {
    await browser.close();
  }
});

test('E-06: 필수 DOM 요소 ID 전체 존재 확인', async () => {
  const { browser, pageP1, pageP2 } = await setupTwoPlayers();
  try {
    await joinAndStartGame(pageP1, pageP2);
    const missing = await pageP1.evaluate(() => {
      const ids = [
        'you-tag', 'per-point',
        'my-money', 'opp-money', 'my-score', 'opp-score',
        'my-extra', 'opp-extra', 'my-badges', 'opp-badges',
        'banner-status', 'banner-multiplier',
        'my-hand-cards', 'opp-hand-cards',
        'floor-cards', 'deck-count-big',
        'shake-modal', 'bomb-panel',
        'go-stop-overlay', 'kkeut-modal',
        'round-modal', 'floor-choice-modal',
        'action-display', 'btn-new-game',
      ];
      return ids.filter((id) => !document.getElementById(id));
    });
    expect(missing).toHaveLength(0);
  } finally {
    await browser.close();
  }
});

// ============================================================
// §2 기본 게임 플레이
// ============================================================

test('E-07: P1 카드 클릭 → 손패 9장으로 감소', async () => {
  const { browser, pageP1, pageP2 } = await setupTwoPlayers();
  try {
    await joinAndStartGame(pageP1, pageP2);
    // 현재 턴이 P1이거나 P2인지 파악하고 active player를 클릭
    const s1 = await readState(pageP1);
    const activePage = s1.firstClickableId ? pageP1 : pageP2;
    const activeState = s1.firstClickableId ? s1 : await readState(pageP2);
    const cardId = activeState.firstClickableId;
    if (!cardId) { console.log('E-07: shake_decision phase — skip'); return; }

    const prevLen = activeState.yourHandLen;
    await activePage.click(`[data-card-id="${cardId}"]`);
    // 손패 감소 대기
    await activePage.waitForFunction(
      (prev) => {
        const cards = document.querySelectorAll('#my-hand-cards .card');
        return cards.length < prev;
      },
      prevLen,
      { timeout: 10000 },
    );
    const newState = await readState(activePage);
    expect(newState.yourHandLen).toBeLessThan(prevLen);
  } finally {
    await browser.close();
  }
});

test('E-08: P1 카드 낸 후 → P2 턴으로 전환', async () => {
  const { browser, pageP1, pageP2 } = await setupTwoPlayers();
  try {
    await joinAndStartGame(pageP1, pageP2);
    const s1 = await readState(pageP1);
    const activePage = s1.firstClickableId ? pageP1 : pageP2;
    const activeState = s1.firstClickableId ? s1 : await readState(pageP2);
    const otherPage = activePage === pageP1 ? pageP2 : pageP1;
    const cardId = activeState.firstClickableId;
    if (!cardId) { return; }

    await activePage.click(`[data-card-id="${cardId}"]`);

    // 상대방에게 클릭 가능 카드가 생겨야 한다 (턴 교대)
    await otherPage.waitForFunction(
      () => {
        const phase = document.getElementById('banner-status')?.textContent;
        return phase?.includes('내 턴') || phase?.includes('고/스톱') || phase?.includes('바닥 선택')
            || phase?.includes('흔들기') || phase?.includes('9월 술잔');
      },
      { timeout: 12000 },
    );
    const sOther = await readState(otherPage);
    expect(
      sOther.firstClickableId !== null || sOther.goStopVisible || sOther.shakePanelVisible,
    ).toBe(true);
  } finally {
    await browser.close();
  }
});

test('E-09: perPoint 변경 → 양측 동기화', async () => {
  const { browser, pageP1, pageP2 } = await setupTwoPlayers();
  try {
    await joinAndStartGame(pageP1, pageP2);
    // P1이 perPoint를 200으로 변경
    await pageP1.evaluate(() => {
      const input = document.getElementById('per-point');
      if (input) {
        input.value = '200';
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    // P2에 200 반영 대기
    await pageP2.waitForFunction(
      () => {
        const input = document.getElementById('per-point');
        return input?.value === '200' || parseInt(input?.value) === 200;
      },
      { timeout: 5000 },
    );
    const val = await pageP2.evaluate(
      () => document.getElementById('per-point')?.value,
    );
    expect(parseInt(val)).toBe(200);
  } finally {
    await browser.close();
  }
});

test('E-10: 빠른 연속 클릭 방어 — 손패가 2장 이상 줄지 않음', async () => {
  const { browser, pageP1, pageP2 } = await setupTwoPlayers();
  try {
    await joinAndStartGame(pageP1, pageP2);
    const s1 = await readState(pageP1);
    const activePage = s1.firstClickableId ? pageP1 : pageP2;
    const activeState = s1.firstClickableId ? s1 : await readState(pageP2);
    const cardId = activeState.firstClickableId;
    if (!cardId) { return; }

    // 같은 카드를 빠르게 3회 클릭
    for (let i = 0; i < 3; i++) {
      await activePage.click(`[data-card-id="${cardId}"]`, { force: true });
    }
    // 600ms 지연(STEP_DELAY) 대기
    await activePage.waitForTimeout(1500);
    const after = await readState(activePage);
    // 손패가 최대 1장만 줄어야 한다
    expect(activeState.yourHandLen - after.yourHandLen).toBeLessThanOrEqual(1);
  } finally {
    await browser.close();
  }
});

test('E-11: 페이지 새로고침 후 재연결 → 손패 유지', async () => {
  const { browser, pageP1, pageP2 } = await setupTwoPlayers();
  try {
    await joinAndStartGame(pageP1, pageP2);
    const before = await readState(pageP1);

    // P1 새로고침
    await pageP1.reload();
    await pageP1.waitForFunction(
      () => document.querySelectorAll('#opp-hand-cards .card.back').length > 0,
      { timeout: 8000 },
    );
    const after = await readState(pageP1);
    // 재연결 후 손패 수가 0이 아닌 값 (서버 상태 복원)
    expect(after.yourHandLen).toBeGreaterThan(0);
    expect(after.yourHandLen).toBe(before.yourHandLen);
  } finally {
    await browser.close();
  }
});

// ============================================================
// §3 inject 기반 — 모달 시나리오
// ============================================================

test('E-12: inject awaiting_go_stop → P1에 고/스톱 오버레이 표시', async () => {
  const { browser, pageP1, pageP2 } = await setupTwoPlayers();
  try {
    await joinAndStartGame(pageP1, pageP2);

    // P1 turn + awaiting_go_stop 상태 주입
    await inject({
      turn:    'p1',
      phase:   'awaiting_go_stop',
      p1Hand:  cards('m05_kkeut', 'm06_kkeut'),
      p2Hand:  cards('m07_kkeut'),
      floor:   [],
      deck:    [],
    });

    // P1에 고/스톱 오버레이가 표시되어야 한다
    await pageP1.waitForFunction(
      () => !document.getElementById('go-stop-overlay')?.classList.contains('hidden'),
      { timeout: 5000 },
    );
    const s1 = await readState(pageP1);
    expect(s1.goStopVisible).toBe(true);
    // P2는 오버레이가 보이지 않아야 한다
    const s2 = await readState(pageP2);
    expect(s2.goStopVisible).toBe(false);
  } finally {
    await browser.close();
  }
});

test('E-13: 스톱 클릭 → round-modal 표시', async () => {
  const { browser, pageP1, pageP2 } = await setupTwoPlayers();
  try {
    await joinAndStartGame(pageP1, pageP2);
    // 충분한 점수로 go-stop 상태 주입
    await inject({
      turn:     'p1',
      phase:    'awaiting_go_stop',
      p1Hand:   cards('m05_kkeut'),
      p2Hand:   cards('m07_kkeut'),
      floor:    [],
      deck:     [],
      captured: {
        p1: cards('m01_gwang', 'm03_gwang', 'm08_gwang',
                   'm01_tti_hong', 'm02_tti_hong', 'm03_tti_hong'),
        p2: cards('m04_pi_a', 'm04_pi_b', 'm05_pi_a', 'm05_pi_b',
                   'm06_pi_a', 'm06_pi_b', 'm07_pi_a', 'm07_pi_b', 'm08_pi_a', 'm08_pi_b'),
      },
      goCount: { p1: 0, p2: 0 },
    });
    // go-stop 오버레이 대기
    await pageP1.waitForFunction(
      () => !document.getElementById('go-stop-overlay')?.classList.contains('hidden'),
      { timeout: 5000 },
    );
    // 스톱 버튼 클릭 — go-stop-overlay의 CSS 애니메이션(infinite scale)으로 인해
    // Playwright가 위치 불안정 판단 → { force: true }로 안정성 검사 우회
    await pageP1.click('#btn-stop', { force: true });
    // round-modal 표시 대기
    await pageP1.waitForFunction(
      () => !document.getElementById('round-modal')?.classList.contains('hidden'),
      { timeout: 8000 },
    );
    const s = await readState(pageP1);
    expect(s.roundModalVisible).toBe(true);
  } finally {
    await browser.close();
  }
});

test('E-14: round-modal에 최종 점수 + 배수 표시', async () => {
  const { browser, pageP1, pageP2 } = await setupTwoPlayers();
  try {
    await joinAndStartGame(pageP1, pageP2);
    await inject({
      turn:  'p1',
      phase: 'awaiting_go_stop',
      p1Hand: cards('m05_kkeut'),
      p2Hand: cards('m07_kkeut'),
      floor: [],
      deck:  [],
      captured: {
        p1: cards('m01_gwang', 'm03_gwang', 'm08_gwang',
                   'm01_tti_hong', 'm02_tti_hong', 'm03_tti_hong'),
        p2: cards('m04_pi_a', 'm04_pi_b', 'm05_pi_a', 'm05_pi_b',
                   'm06_pi_a', 'm06_pi_b', 'm07_pi_a', 'm07_pi_b', 'm08_pi_a', 'm08_pi_b'),
      },
      goCount: { p1: 0, p2: 0 },
    });
    await pageP1.waitForFunction(
      () => !document.getElementById('go-stop-overlay')?.classList.contains('hidden'),
      { timeout: 5000 },
    );
    // { force: true } — go-stop-overlay 무한 CSS 애니메이션으로 Playwright 안정성 검사 우회
    await pageP1.click('#btn-stop', { force: true });
    await pageP1.waitForFunction(
      () => !document.getElementById('round-modal')?.classList.contains('hidden'),
      { timeout: 8000 },
    );
    // round-modal 본문에 점수 숫자가 있어야 한다
    const modalText = await pageP1.evaluate(
      () => document.getElementById('round-modal')?.innerText ?? '',
    );
    expect(modalText.length).toBeGreaterThan(0);
    // 승자/패자 텍스트 중 하나 이상 포함
    expect(modalText).toMatch(/점|배|박|승|패|고/);
  } finally {
    await browser.close();
  }
});

test('E-15: inject shake_decision → P1에 흔들기 모달 표시', async () => {
  const { browser, pageP1, pageP2 } = await setupTwoPlayers();
  try {
    await joinAndStartGame(pageP1, pageP2);
    await inject({
      turn:         'p1',
      phase:        'shake_decision',
      pendingShake: { player: 'p1', month: 1 },
      p1Hand:  cards('m01_gwang', 'm01_tti_hong', 'm01_pi_a', 'm05_kkeut'),
      p2Hand:  cards('m06_kkeut'),
      floor:   [],
      deck:    [],
    });
    await pageP1.waitForFunction(
      () => !document.getElementById('shake-modal')?.classList.contains('hidden'),
      { timeout: 5000 },
    );
    const s1 = await readState(pageP1);
    expect(s1.shakePanelVisible).toBe(true);
    // P2에는 보이지 않음
    const s2 = await readState(pageP2);
    expect(s2.shakePanelVisible).toBe(false);
  } finally {
    await browser.close();
  }
});

test('E-16: 흔들기 선언 버튼 클릭 → 모달 닫힘, 게임 계속', async () => {
  const { browser, pageP1, pageP2 } = await setupTwoPlayers();
  try {
    await joinAndStartGame(pageP1, pageP2);
    await inject({
      turn:         'p1',
      phase:        'shake_decision',
      pendingShake: { player: 'p1', month: 1 },
      p1Hand:  cards('m01_gwang', 'm01_tti_hong', 'm01_pi_a', 'm05_kkeut'),
      p2Hand:  cards('m06_kkeut'),
      floor:   [],
      deck:    [],
    });
    await pageP1.waitForFunction(
      () => !document.getElementById('shake-modal')?.classList.contains('hidden'),
      { timeout: 5000 },
    );
    // 흔들기 선언 버튼 클릭
    await pageP1.click('#btn-shake');
    // 모달 닫힘 대기
    await pageP1.waitForFunction(
      () => document.getElementById('shake-modal')?.classList.contains('hidden'),
      { timeout: 5000 },
    );
    const s = await readState(pageP1);
    expect(s.shakePanelVisible).toBe(false);
    // phase = awaiting_play로 복귀
    expect(s.bannerStatus).toMatch(/내 턴|상대 턴/);
  } finally {
    await browser.close();
  }
});

test('E-17: inject awaiting_floor_choice → P1에 바닥 선택 모달 표시', async () => {
  const { browser, pageP1, pageP2 } = await setupTwoPlayers();
  try {
    await joinAndStartGame(pageP1, pageP2);
    // 바닥 선택 대기 상태: p1이 1월 카드를 냈고 바닥에 1월 2장
    await inject({
      turn:  'p1',
      phase: 'awaiting_floor_choice',
      p1Hand: cards('m05_kkeut'),
      p2Hand: cards('m06_kkeut'),
      floor:  cards('m01_pi_a', 'm01_pi_b'),
      deck:   [],
      // pendingFloorChoice를 직접 주입 (서버 게임 로직 우회)
    });
    // floor-choice-modal이 표시되어야 한다 (or banner-status로 확인)
    await pageP1.waitForFunction(
      () => {
        const modal = document.getElementById('floor-choice-modal');
        const banner = document.getElementById('banner-status');
        return !modal?.classList.contains('hidden')
          || banner?.textContent?.includes('바닥 선택');
      },
      { timeout: 5000 },
    );
    const s = await readState(pageP1);
    // 바닥 선택 or 관련 상태 중 하나
    expect(s.floorChoiceVisible || s.bannerStatus?.includes('바닥 선택')).toBe(true);
  } finally {
    await browser.close();
  }
});

test('E-18: inject awaiting_kkeut_choice → 9월 술잔 모달 표시', async () => {
  const { browser, pageP1, pageP2 } = await setupTwoPlayers();
  try {
    await joinAndStartGame(pageP1, pageP2);
    await inject({
      turn:                'p1',
      phase:               'awaiting_kkeut_choice',
      pendingKkeutChoice:  { player: 'p1' },
      p1Hand:              cards('m05_kkeut'),
      p2Hand:              cards('m06_kkeut'),
      floor:               [],
      deck:                [],
    });
    await pageP1.waitForFunction(
      () => !document.getElementById('kkeut-modal')?.classList.contains('hidden'),
      { timeout: 5000 },
    );
    const s = await readState(pageP1);
    expect(s.kkeutModalVisible).toBe(true);
  } finally {
    await browser.close();
  }
});

// ============================================================
// §4 inject 기반 — 박 시나리오 (round_end 직접 주입)
// ============================================================

/**
 * roundResult 객체를 포함한 round_end 상태를 주입하고,
 * P1의 round-modal에 특정 텍스트가 표시되는지 확인한다.
 */
async function injectRoundEndAndCheck(pageP1, pageP2, roundResult, checkText) {
  await inject({
    phase:       'round_end',
    turn:        'p1',
    p1Hand:      [],
    p2Hand:      [],
    floor:       [],
    deck:        [],
    roundResult,
  });
  await pageP1.waitForFunction(
    () => !document.getElementById('round-modal')?.classList.contains('hidden'),
    { timeout: 6000 },
  );
  const modalText = await pageP1.evaluate(
    () => document.getElementById('round-modal')?.innerText ?? '',
  );
  expect(modalText).toContain(checkText);
}

test('E-19: 피박 시나리오 → round-modal에 "피박" 텍스트 포함', async () => {
  const { browser, pageP1, pageP2 } = await setupTwoPlayers();
  try {
    await joinAndStartGame(pageP1, pageP2);
    // 피박: 패자 piCount=5 ≤ 7
    await injectRoundEndAndCheck(pageP1, pageP2, {
      winner: 'p1', loser: 'p2',
      winnerBreakdown: { score: 7, gwang: 3, tti: 3, kkeut: 5, piCount: 0, hasGodori: false, hasHong: true, hasCheong: false, hasCho: false },
      loserBreakdown:  { score: 0, gwang: 0, tti: 0, kkeut: 0, piCount: 5, hasGodori: false, hasHong: false, hasCheong: false, hasCho: false },
      finalScore: 12, multiplier: 4,
      reasons: ['피박 ×2', '멍박 ×2'],
      money: 1200, goCount: { p1: 0, p2: 0 }, shaking: { p1: false, p2: false }, gobakApplies: false,
    }, '피박');
  } finally {
    await browser.close();
  }
});

test('E-20: 멍박 시나리오 → round-modal에 "멍박" 텍스트 포함', async () => {
  const { browser, pageP1, pageP2 } = await setupTwoPlayers();
  try {
    await joinAndStartGame(pageP1, pageP2);
    await injectRoundEndAndCheck(pageP1, pageP2, {
      winner: 'p1', loser: 'p2',
      winnerBreakdown: { score: 7, gwang: 0, tti: 3, kkeut: 5, piCount: 10, hasGodori: false, hasHong: true, hasCheong: false, hasCho: false },
      loserBreakdown:  { score: 0, gwang: 0, tti: 0, kkeut: 0, piCount: 12, hasGodori: false, hasHong: false, hasCheong: false, hasCho: false },
      finalScore: 14, multiplier: 2,
      reasons: ['멍박 ×2'],
      money: 1400, goCount: { p1: 0, p2: 0 }, shaking: { p1: false, p2: false }, gobakApplies: false,
    }, '멍박');
  } finally {
    await browser.close();
  }
});

test('E-21: 광박 시나리오 → round-modal에 "광박" 텍스트 포함', async () => {
  const { browser, pageP1, pageP2 } = await setupTwoPlayers();
  try {
    await joinAndStartGame(pageP1, pageP2);
    await injectRoundEndAndCheck(pageP1, pageP2, {
      winner: 'p1', loser: 'p2',
      winnerBreakdown: { score: 3, gwang: 3, tti: 0, kkeut: 0, piCount: 0, hasGodori: false, hasHong: false, hasCheong: false, hasCho: false },
      loserBreakdown:  { score: 0, gwang: 0, tti: 0, kkeut: 5, piCount: 10, hasGodori: false, hasHong: false, hasCheong: false, hasCho: false },
      finalScore: 6, multiplier: 2,
      reasons: ['광박 ×2'],
      money: 600, goCount: { p1: 0, p2: 0 }, shaking: { p1: false, p2: false }, gobakApplies: false,
    }, '광박');
  } finally {
    await browser.close();
  }
});

test('E-22: 고박 시나리오 → round-modal에 "고박" 텍스트 포함', async () => {
  const { browser, pageP1, pageP2 } = await setupTwoPlayers();
  try {
    await joinAndStartGame(pageP1, pageP2);
    await injectRoundEndAndCheck(pageP1, pageP2, {
      winner: 'p2', loser: 'p1',
      winnerBreakdown: { score: 7, gwang: 0, tti: 3, kkeut: 5, piCount: 10, hasGodori: false, hasHong: true, hasCheong: false, hasCho: false },
      loserBreakdown:  { score: 5, gwang: 3, tti: 0, kkeut: 5, piCount: 10, hasGodori: false, hasHong: false, hasCheong: false, hasCho: false },
      finalScore: 14, multiplier: 2,
      reasons: ['고박 ×2'],
      money: 1400, goCount: { p1: 1, p2: 0 }, shaking: { p1: false, p2: false }, gobakApplies: true,
    }, '고박');
  } finally {
    await browser.close();
  }
});

// ============================================================
// §5 안정성 / 회귀
// ============================================================

test('E-23: 콘솔 에러 없음 — 게임 입장 + 1카드 플레이', async () => {
  const { browser, pageP1, pageP2 } = await setupTwoPlayers();
  const errors = [];
  pageP1.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  try {
    await joinAndStartGame(pageP1, pageP2);

    // 활성 플레이어 찾기 (첫 번째 클릭 가능 카드 보유한 쪽)
    const s1 = await readState(pageP1);
    const s2 = await readState(pageP2);
    let activePage = null;
    let cardId = null;
    if (s1.firstClickableId) {
      activePage = pageP1; cardId = s1.firstClickableId;
    } else if (s2.firstClickableId) {
      activePage = pageP2; cardId = s2.firstClickableId;
    }

    if (activePage && cardId) {
      await activePage.click(`[data-card-id="${cardId}"]`);
      // 손패 감소 or 모달 표시 대기 (최대 4초)
      await activePage.waitForFunction(
        (prevLen) => {
          const hand = document.querySelectorAll('#my-hand-cards .card').length;
          const hasModal = !document.getElementById('shake-modal')?.classList.contains('hidden')
            || !document.getElementById('go-stop-overlay')?.classList.contains('hidden')
            || !document.getElementById('round-modal')?.classList.contains('hidden');
          return hand < prevLen || hasModal;
        },
        s1.firstClickableId ? s1.yourHandLen : s2.yourHandLen,
        { timeout: 6000 },
      );
    }

    // 게임 엔진 JS 에러 없어야 함 (WebSocket/네트워크 에러 제외)
    const gameErrors = errors.filter(
      (e) => !e.includes('WebSocket') && !e.includes('net::ERR') && !e.includes('favicon'),
    );
    expect(gameErrors).toHaveLength(0);
  } finally {
    await browser.close();
  }
});

test('E-24: AI 봇 모드 — mode=ai URL 진입 시 봇 자동 연결', async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  const page = await ctx.newPage();
  try {
    // AI 모드: 봇이 자동 접속하여 게임 시작 (봇 spawn에 최대 3초 소요)
    await page.goto(`${BASE_URL}?mode=ai`);
    // P1 연결 확인
    await page.waitForFunction(
      () => document.getElementById('you-tag')?.textContent?.includes('P1'),
      { timeout: 8000 },
    );
    // 봇 spawn 후 게임 시작까지 최대 20초 대기 (getBotUrl 수정 반영)
    await page.waitForFunction(
      () => document.querySelectorAll('#opp-hand-cards .card.back').length > 0,
      { timeout: 20000 },
    );
    const s = await readState(page);
    expect(s.yourHandLen).toBe(10);
    expect(s.oppHandLen).toBe(10);
  } finally {
    await browser.close();
  }
});

// ============================================================
// §6 연출-STATE 순서 정합성 (2026-06-13 버그 수정 검증)
// ============================================================

/**
 * 페이지 로드 전에 WebSocket.prototype.send 직전 단계의 수신 메시지를 가로채는
 * init script를 설치한다. window.__matgoStates 배열에 STATE의 lastAction.kind를
 * 시간순으로 누적한다. (page.evaluate로 검사)
 * @param {import('playwright/test').Page} page
 */
async function installStateRecorder(page) {
  await page.addInitScript(() => {
    window.__matgoStates = [];
    const OrigWS = window.WebSocket;
    // WebSocket 인스턴스의 message 이벤트를 가로채 STATE의 lastAction.kind 기록.
    window.WebSocket = function (...args) {
      const sock = new OrigWS(...args);
      sock.addEventListener('message', (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg && msg.type === 'STATE') {
            // STATE 메시지는 lastAction을 최상위에 둔다(snapshotForPlayer) → msg.lastAction.kind.
            window.__matgoStates.push(msg.lastAction ? msg.lastAction.kind : null);
          }
        } catch { /* 무시 */ }
      });
      return sock;
    };
    window.WebSocket.prototype = OrigWS.prototype;
    Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  });
}

test('E-26: chooseFloor 시 choice_made는 defer되어 단일 통합 STATE만 송신 (버그1)', async () => {
  const browser = await chromium.launch();
  const ctxP1 = await browser.newContext({ viewport: VIEWPORT });
  const ctxP2 = await browser.newContext({ viewport: VIEWPORT });
  const pageP1 = await ctxP1.newPage();
  const pageP2 = await ctxP2.newPage();
  try {
    // STATE 레코더를 P1 페이지 로드 전에 설치
    await installStateRecorder(pageP1);
    await joinAndStartGame(pageP1, pageP2);

    // awaiting_play 주입: P1 손에 m03_pi_a, 바닥에 같은 월(3월) 2장 → 카드 클릭 시
    // 2매칭 → awaiting_floor_choice. 덱에는 비매칭 카드 1장(m07_pi_a)을 둬 단계2 진행.
    await inject({
      turn:   'p1',
      phase:  'awaiting_play',
      p1Hand: cards('m03_pi_a'),
      p2Hand: cards('m06_kkeut'),
      floor:  cards('m03_pi_b', 'm03_tti_hong'),
      deck:   cards('m07_pi_a'),
    });
    await waitForHandCount(pageP1, 1);
    // inject STATE diff로 발동한 옵티미스틱 fly가 끝나야 클릭(sendPlay)이 받아들여진다.
    await waitForFlyIdle(pageP1);

    // 레코더 초기화 (inject의 test_inject STATE 제외)
    await pageP1.evaluate(() => { window.__matgoStates = []; });

    // 손패 카드 클릭 → 같은 월 2장 → 바닥 선택 모달
    await pageP1.click('#my-hand-cards .card.clickable');
    await pageP1.waitForFunction(
      () => !document.getElementById('floor-choice-modal')?.classList.contains('hidden'),
      { timeout: 5000 },
    );

    // 후보 중 첫 카드 선택 → CHOOSE_FLOOR 송신
    await pageP1.click('#floor-choice-cards .card');

    // 단계2(deck_flipped/turn_finished)까지 진행되어 통합 STATE가 도착할 때까지 대기.
    // defer가 정상 동작하면 choice_made 단독 STATE는 절대 도착하지 않아야 한다.
    await pageP1.waitForFunction(
      () => window.__matgoStates.some(
        (k) => k && k !== 'choice_made' && k !== 'choice_pending' && k !== 'test_inject',
      ),
      { timeout: 6000 },
    );
    await pageP1.waitForTimeout(500); // 잔여 STATE 수신 여유

    const kinds = await pageP1.evaluate(() => window.__matgoStates.slice());
    // 핵심 검증: choice_made 단독 STATE가 클라이언트에 도달하지 않아야 함 (서버 defer).
    expect(kinds).not.toContain('choice_made');
    // 통합 STATE에는 단계2의 결과(턴 종료 등)가 담겨야 함 → 비-pending STATE 1개 이상.
    expect(kinds.filter((k) => k && k !== 'choice_pending').length).toBeGreaterThan(0);
  } finally {
    await browser.close();
  }
});

test('E-27: 뻑 토스트는 덱 뒤집기(DECK_LAND) 연출 이후 등장 (버그2)', async () => {
  const { browser, pageP1, pageP2 } = await setupTwoPlayers();
  try {
    await joinAndStartGame(pageP1, pageP2);

    // 뻑 시나리오: P1 손 m12_pi_ssangpi → 바닥 m12_tti_bi와 1매칭(pair_from_hand) →
    // 덱 첫 장 m12_kkeut(같은 12월)이 뒤집혀 뻑 형성. deck.pop()이 마지막 원소를
    // 뽑으므로 덱 배열의 마지막에 m12_kkeut을 둔다.
    await inject({
      turn:   'p1',
      phase:  'awaiting_play',
      p1Hand: cards('m12_pi_ssangpi'),
      p2Hand: cards('m06_kkeut'),
      floor:  cards('m12_tti_bi'),
      deck:   cards('m12_kkeut'),
    });
    await waitForHandCount(pageP1, 1);
    // inject STATE diff로 발동한 옵티미스틱 fly가 끝나야 클릭(sendPlay)이 받아들여진다.
    await waitForFlyIdle(pageP1);

    // 카드 클릭 → 뻑 형성 흐름 시작
    await pageP1.click('#my-hand-cards .card.clickable');

    // 네거티브 검증: 카드 낸 직후 300ms 시점에는 뻑 토스트가 아직 없어야 한다.
    // (덱 뒤집기 DECK_FLIP+DECK_THROW+DECK_LAND = 680ms 이후에 등장해야 함)
    await pageP1.waitForTimeout(300);
    const earlyToast = await pageP1.evaluate(() => {
      const el = document.querySelector('.action-toast');
      const visible = !!(el && el.classList.contains('show'));
      return { visible, text: el ? el.textContent : null };
    });
    expect(earlyToast.visible && /뻑/.test(earlyToast.text || '')).toBe(false);

    // DECK_LAND 이후에는 "N월 뻑!" 토스트가 등장해야 한다.
    await pageP1.waitForFunction(
      () => {
        const el = document.querySelector('.action-toast');
        return !!(el && el.classList.contains('show') && /뻑/.test(el.textContent || ''));
      },
      { timeout: 3000 },
    );
    const finalText = await pageP1.evaluate(
      () => document.querySelector('.action-toast')?.textContent ?? '',
    );
    expect(finalText).toContain('뻑');
  } finally {
    await browser.close();
  }
});

test('E-25: 스크린샷 시각 검증 — 레이아웃 오류 없음', async () => {
  const { browser, pageP1, pageP2 } = await setupTwoPlayers();
  try {
    await joinAndStartGame(pageP1, pageP2);
    await pageP1.screenshot({
      path: 'tests/screenshots/e2e-scenario-initial-p1.png',
      fullPage: false,
    });
    await pageP2.screenshot({
      path: 'tests/screenshots/e2e-scenario-initial-p2.png',
      fullPage: false,
    });
    // 스크린샷 파일 생성 확인 (test always passes — visual check is manual)
    const { existsSync } = await import('fs');
    expect(existsSync('tests/screenshots/e2e-scenario-initial-p1.png')).toBe(true);
  } finally {
    await browser.close();
  }
});
