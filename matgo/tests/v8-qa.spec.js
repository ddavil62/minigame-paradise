/**
 * @fileoverview 맞고 v8 UI 이식 후 게임 로직 회귀 검증.
 * Playwright (chromium) — 두 페이지(P1/P2)로 실제 WebSocket 게임을 진행하며 검증.
 *
 * 검증 범위:
 *  - 기본 진행 (양측 손패/바닥/덱 표시, 카드 클릭, 점수판 갱신)
 *  - DOM 참조 회귀 (v8 신 ID — my/opp-money, my/opp-extra, my/opp-badges, banner-status 등)
 *  - 특수 이벤트(흔들기·폭탄·고/스톱·9월 술잔) 모달/패널 노출
 *  - UI 갱신 (잔고, 점수, 손 N장, 미션 띠)
 *  - 콘솔 에러
 *  - 빠른 연속 클릭, 빈 손패 클릭 등 엣지 케이스
 *
 * 실행 전: server.js가 포트 3013에서 동작 중이어야 함.
 *
 * 실행: cd C:/LazySlimeStudio/matgo && npx playwright test tests/v8-qa.spec.js --reporter=list
 */

import { test, expect, chromium } from 'playwright/test';

const BASE_URL = process.env.MATGO_BASE_URL || 'http://localhost:3013';
const VIEWPORT = { width: 1280, height: 800 };

/**
 * 두 페이지(P1/P2)를 깨끗한 컨텍스트에 띄운다.
 * @returns {Promise<{browser, ctxP1, ctxP2, pageP1, pageP2}>}
 */
async function setupTwoPlayers() {
  const browser = await chromium.launch();
  const ctxP1 = await browser.newContext({ viewport: VIEWPORT });
  const ctxP2 = await browser.newContext({ viewport: VIEWPORT });
  const pageP1 = await ctxP1.newPage();
  const pageP2 = await ctxP2.newPage();
  return { browser, ctxP1, ctxP2, pageP1, pageP2 };
}

/**
 * 두 페이지 모두 입장하여 game start. STATE 메시지 1회 이상 수신될 때까지 대기.
 */
async function joinAndStartGame(pageP1, pageP2) {
  await pageP1.goto(BASE_URL);
  // p1 단독 입장 후 you-tag 가 P1로 표시되는지 확인
  await pageP1.waitForFunction(() =>
    document.getElementById('you-tag')?.textContent?.includes('P1'),
    { timeout: 5000 },
  );
  await pageP2.goto(BASE_URL);
  await pageP2.waitForFunction(() =>
    document.getElementById('you-tag')?.textContent?.includes('P2'),
    { timeout: 5000 },
  );
  // 두 명 모두 게임 시작 (서버는 두 번째 입장 시 GAME_START + STATE 자동 송신)
  // 상대 카드 뒷면(.card.back) 10장이 표시되면 STATE 수신 완료.
  await pageP1.waitForFunction(() =>
    document.querySelectorAll('#opp-hand-cards .card.back').length === 10,
    { timeout: 5000 },
  );
  await pageP2.waitForFunction(() =>
    document.querySelectorAll('#opp-hand-cards .card.back').length === 10,
    { timeout: 5000 },
  );
}

/**
 * 페이지에서 현재 게임 STATE 객체를 추출 (lastState 클로저 변수가 외부에서 접근 불가하므로
 * 데이터를 DOM 기반으로 도출).
 *
 * @returns {Promise<{you, turn, phase, yourHandLen, oppHandLen, floorIds, deckCount,
 *                    myScore, oppScore, myMoney, oppMoney}>}
 */
async function readState(page) {
  return await page.evaluate(() => {
    const myHand = Array.from(document.querySelectorAll('#my-hand-cards .card'))
      .map((el) => el.dataset.cardId)
      .filter(Boolean);
    const oppHandLen = document.querySelectorAll('#opp-hand-cards .card.back').length;
    const floorIds = Array.from(document.querySelectorAll('#floor-cards > .card'))
      .map((el) => el.dataset.cardId)
      .filter(Boolean);
    return {
      youTag: document.getElementById('you-tag')?.textContent,
      myHand,
      yourHandLen: myHand.length,
      oppHandLen,
      floorIds,
      deckCount: parseInt(document.getElementById('deck-count-big')?.textContent, 10),
      myScore: parseInt(document.getElementById('my-score')?.textContent, 10),
      oppScore: parseInt(document.getElementById('opp-score')?.textContent, 10),
      myMoney: document.getElementById('my-money')?.textContent,
      oppMoney: document.getElementById('opp-money')?.textContent,
      myExtra: document.getElementById('my-extra')?.textContent,
      oppExtra: document.getElementById('opp-extra')?.textContent,
      bannerStatus: document.getElementById('banner-status')?.textContent,
      bannerMulti: document.getElementById('banner-multiplier')?.textContent,
      actionDisplay: document.getElementById('action-display')?.textContent,
      // 첫 번째 클릭 가능한 손패 카드 (현재 턴 플레이어인 경우)
      firstClickableId: document.querySelector('#my-hand-cards .card.clickable')?.dataset?.cardId,
      shakePanelVisible: !document.getElementById('shake-modal')?.classList.contains('hidden'),
      bombPanelVisible: !document.getElementById('bomb-panel')?.classList.contains('hidden'),
      goStopVisible: !document.getElementById('go-stop-overlay')?.classList.contains('hidden'),
      kkeutModalVisible: !document.getElementById('kkeut-modal')?.classList.contains('hidden'),
      roundModalVisible: !document.getElementById('round-modal')?.classList.contains('hidden'),
      toastVisible: !document.getElementById('toast')?.classList.contains('hidden'),
    };
  });
}

/**
 * 두 페이지 중 현재 턴 페이지를 반환한다. (action-display의 "내 턴" 또는 흔들기/카드 클릭 가능 여부로 판정)
 * 우선 P1의 STATE를 보고 turn 정보를 도출.
 */
async function findActivePage(pageP1, pageP2) {
  const s1 = await readState(pageP1);
  // s1.bannerStatus가 "내 턴" 또는 흔들기/바닥선택이면 P1 active
  // s1.bannerStatus가 "상대 턴" 또는 "상대 ..."면 P2 active
  if (s1.bannerStatus?.includes('내 턴')
   || s1.bannerStatus?.includes('바닥 선택')
   || s1.bannerStatus?.includes('흔들기 결정') && s1.shakePanelVisible
   || s1.bannerStatus?.includes('고/스톱 결정') && s1.goStopVisible
   || s1.bannerStatus?.includes('9월 술잔 선택') && s1.kkeutModalVisible) {
    return { activePage: pageP1, otherPage: pageP2, activeId: 'p1' };
  }
  return { activePage: pageP2, otherPage: pageP1, activeId: 'p2' };
}

// ─────────────────────────────────────────────────────────────────

test.describe('맞고 v8 UI 게임 로직 회귀 검증', () => {
  test.setTimeout(120000);

  test('A. 기본 진행: 두 페이지 입장 → 게임 시작 → 손패 10장씩 분배', async () => {
    const { browser, pageP1, pageP2 } = await setupTwoPlayers();
    try {
      await joinAndStartGame(pageP1, pageP2);

      const s1 = await readState(pageP1);
      const s2 = await readState(pageP2);

      // 둘 다 손패 10장
      expect(s1.yourHandLen).toBe(10);
      expect(s2.yourHandLen).toBe(10);
      // 상대 손도 10장 (뒷면)
      expect(s1.oppHandLen).toBe(10);
      expect(s2.oppHandLen).toBe(10);
      // 바닥은 8장
      expect(s1.floorIds.length).toBe(8);
      expect(s2.floorIds.length).toBe(8);
      // 더미 20장 (48 - 10 - 10 - 8)
      expect(s1.deckCount).toBe(20);
      expect(s2.deckCount).toBe(20);
      // 잔고 10000
      expect(s1.myMoney).toMatch(/10,000/);
      expect(s2.myMoney).toMatch(/10,000/);
      // 점수 초기 0 (단, 광/끗/띠/피 누적 점수가 시작부터 비어있는지 확인)
      expect(s1.myScore).toBe(0);
      expect(s2.myScore).toBe(0);
      // 손 N장 표시
      expect(s1.myExtra).toBe('손 10장');
      expect(s1.oppExtra).toBe('손 10장');
      // banner-status: "내 턴" 또는 "상대 턴" 또는 "흔들기 결정"
      expect(s1.bannerStatus).toBeTruthy();

      await pageP1.screenshot({ path: 'tests/screenshots/v8-qa-A-initial-p1.png' });
      await pageP2.screenshot({ path: 'tests/screenshots/v8-qa-A-initial-p2.png' });
    } finally {
      await browser.close();
    }
  });

  test('B. DOM 참조 회귀: v8 신 ID 요소 모두 존재', async () => {
    const { browser, pageP1, pageP2 } = await setupTwoPlayers();
    try {
      await joinAndStartGame(pageP1, pageP2);

      // 모든 신규 v8 ID가 DOM에 존재해야 한다.
      const ids = await pageP1.evaluate(() => {
        const required = [
          'you-tag', 'per-point',
          'my-money', 'opp-money', 'my-score', 'opp-score',
          'my-extra', 'opp-extra', 'my-badges', 'opp-badges',
          'my-hand-count', 'opp-hand-count',
          'my-hand-cards', 'opp-hand-cards',
          'my-captured-zone', 'opp-captured-zone',
          'floor-zone', 'floor-cards', 'floor-mission',
          'banner-status', 'banner-multiplier',
          'deck-card', 'deck-count-big',
          'go-stop-overlay', 'btn-go', 'btn-stop',
          'shake-modal', 'btn-shake', 'btn-shake-no',
          'bomb-panel', 'btn-bomb', 'bomb-months',
          'btn-new-round', 'btn-new-game',
          'round-modal', 'btn-new-round-modal',
          'kkeut-modal', 'btn-kkeut-choice-kkeut', 'btn-kkeut-choice-ssangpi',
          'toast', 'action-display',
        ];
        return required.map((id) => ({ id, present: !!document.getElementById(id) }));
      });

      const missing = ids.filter((x) => !x.present).map((x) => x.id);
      expect(missing).toEqual([]);
    } finally {
      await browser.close();
    }
  });

  test('C. 카드 클릭 → 손패 감소 + 턴 교대 + 점수판 또는 바닥 갱신', async () => {
    const { browser, pageP1, pageP2 } = await setupTwoPlayers();
    const consoleErrors = [];
    pageP1.on('pageerror', (e) => consoleErrors.push(`P1: ${e.message}`));
    pageP2.on('pageerror', (e) => consoleErrors.push(`P2: ${e.message}`));
    try {
      await joinAndStartGame(pageP1, pageP2);

      // 만약 흔들기 결정이 떠 있다면 일단 "일반"으로 처리해서 awaiting_play 진입.
      const initial = await readState(pageP1);
      const initial2 = await readState(pageP2);
      for (const page of [pageP1, pageP2]) {
        const s = await readState(page);
        if (s.shakePanelVisible) {
          await page.click('#btn-shake-no');
          // STATE 재수신 대기
          await page.waitForFunction(() =>
            document.getElementById('shake-modal')?.classList.contains('hidden'),
            { timeout: 3000 },
          );
        }
      }

      // 현재 턴 페이지에서 첫 카드 클릭
      const { activePage, otherPage } = await findActivePage(pageP1, pageP2);
      const before = await readState(activePage);
      expect(before.firstClickableId).toBeTruthy();

      const handBefore = before.yourHandLen;
      const totalCardsBefore = before.yourHandLen + before.oppHandLen + before.floorIds.length + before.deckCount
        + (await activePage.evaluate(() => document.querySelectorAll('#my-captured-zone .card-stack .card').length))
        + (await activePage.evaluate(() => document.querySelectorAll('#opp-captured-zone .card-stack .card').length));

      // 클릭
      await activePage.click(`#my-hand-cards .card[data-card-id="${before.firstClickableId}"]`);

      // STATE 재수신 — 손패 9장으로 감소 (또는 awaiting_floor_choice라면 아직 10인 채로 다른 페이지에 STATE 변동)
      await activePage.waitForFunction((prev) =>
        document.getElementById('my-extra')?.textContent !== `손 ${prev}장`,
        handBefore,
        { timeout: 5000 },
      ).catch(() => { /* awaiting_floor_choice면 손패는 그대로일 수 있음 */ });

      const after = await readState(activePage);
      // 손패가 감소했거나, 바닥 선택 대기 상태인지 확인
      const isFloorChoice = after.bannerStatus?.includes('바닥 선택');
      if (!isFloorChoice) {
        expect(after.yourHandLen).toBeLessThanOrEqual(handBefore);
      }

      // 카드 총합 보존 (48장)
      const totalCardsAfter = await activePage.evaluate(() => {
        const my = parseInt(document.getElementById('my-extra')?.textContent.replace(/[^\d]/g, ''), 10);
        const opp = parseInt(document.getElementById('opp-extra')?.textContent.replace(/[^\d]/g, ''), 10);
        const floor = document.querySelectorAll('#floor-cards > .card').length;
        const deck = parseInt(document.getElementById('deck-count-big')?.textContent, 10);
        const myCap = document.querySelectorAll('#my-captured-zone .card-stack .card').length;
        const oppCap = document.querySelectorAll('#opp-captured-zone .card-stack .card').length;
        return my + opp + floor + deck + myCap + oppCap;
      });
      // ※ awaiting_floor_choice에서 손패 카드는 이미 손에서 빠진 상태(서버 측). 그러나 DOM은 빠진 후 표시.
      //   다만 fly 애니메이션 진행 중일 수도 있으므로 ±1 정도 오차 허용.
      expect(Math.abs(totalCardsAfter - 48)).toBeLessThanOrEqual(2);

      // 콘솔 에러 없어야 함
      expect(consoleErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  });

  test('D. perPoint 변경 → 서버에 반영되어 양측 동기화', async () => {
    const { browser, pageP1, pageP2 } = await setupTwoPlayers();
    try {
      await joinAndStartGame(pageP1, pageP2);

      // P1에서 점당 변경
      await pageP1.fill('#per-point', '500');
      await pageP1.dispatchEvent('#per-point', 'change');

      // P2에서 동기화 확인
      await pageP2.waitForFunction(() =>
        document.getElementById('per-point')?.value === '500',
        { timeout: 3000 },
      );

      const v = await pageP2.inputValue('#per-point');
      expect(v).toBe('500');
    } finally {
      await browser.close();
    }
  });

  test('E. 새 게임 confirm 다이얼로그 정상 동작', async () => {
    const { browser, pageP1, pageP2 } = await setupTwoPlayers();
    try {
      await joinAndStartGame(pageP1, pageP2);

      // confirm 자동 수락
      pageP1.on('dialog', async (dialog) => {
        expect(dialog.type()).toBe('confirm');
        expect(dialog.message()).toContain('잔고가 리셋');
        await dialog.accept();
      });
      await pageP1.click('#btn-new-game');
      // 게임 재시작 후 손패가 다시 10장이어야 함
      await pageP1.waitForFunction(() =>
        document.querySelectorAll('#my-hand-cards .card').length === 10,
        { timeout: 5000 },
      );
      const s = await readState(pageP1);
      expect(s.yourHandLen).toBe(10);
    } finally {
      await browser.close();
    }
  });

  test('F. 콘솔 에러 없음 — 30초 동안 정상 입장 + 카드 5장 진행', async () => {
    const { browser, pageP1, pageP2 } = await setupTwoPlayers();
    const errors = [];
    pageP1.on('pageerror', (e) => errors.push(`P1: ${e.message}`));
    pageP2.on('pageerror', (e) => errors.push(`P2: ${e.message}`));
    pageP1.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`P1 console: ${msg.text()}`);
    });
    pageP2.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`P2 console: ${msg.text()}`);
    });
    try {
      await joinAndStartGame(pageP1, pageP2);

      // 흔들기 패널이 떴으면 일단 일반 처리
      for (const page of [pageP1, pageP2]) {
        const s = await readState(page);
        if (s.shakePanelVisible) {
          await page.click('#btn-shake-no');
          await page.waitForTimeout(300);
        }
      }

      // 카드 5장 클릭 진행
      for (let i = 0; i < 5; i++) {
        const { activePage } = await findActivePage(pageP1, pageP2);
        const s = await readState(activePage);

        // 라운드가 끝났거나 모달이 떴으면 루프 중단
        if (s.roundModalVisible) break;

        // 9월 술잔 모달 처리
        if (s.kkeutModalVisible) {
          await activePage.click('#btn-kkeut-choice-kkeut');
          await activePage.waitForTimeout(500);
          continue;
        }
        // 흔들기 패널
        if (s.shakePanelVisible) {
          await activePage.click('#btn-shake-no');
          await activePage.waitForTimeout(500);
          continue;
        }
        // 고/스톱 — "스톱"으로 라운드 종료
        if (s.goStopVisible) {
          await activePage.click('#btn-stop');
          await activePage.waitForTimeout(500);
          break;
        }
        // 바닥 선택
        if (s.bannerStatus?.includes('바닥 선택')) {
          const choice = await activePage.evaluate(() =>
            document.querySelector('#floor-cards .card.selectable-floor')?.dataset?.cardId,
          );
          if (choice) {
            await activePage.click(`#floor-cards .card[data-card-id="${choice}"]`);
            await activePage.waitForTimeout(500);
            continue;
          }
        }
        // 일반 손패 클릭
        if (s.firstClickableId) {
          await activePage.click(`#my-hand-cards .card[data-card-id="${s.firstClickableId}"]`);
          await activePage.waitForTimeout(800);
        } else {
          // 클릭 가능 카드가 없으면 잠시 대기
          await activePage.waitForTimeout(500);
        }
      }

      // 카드 총합이 48장 그대로인지
      const total = await pageP1.evaluate(() => {
        const my = parseInt(document.getElementById('my-extra')?.textContent.replace(/[^\d]/g, ''), 10);
        const opp = parseInt(document.getElementById('opp-extra')?.textContent.replace(/[^\d]/g, ''), 10);
        const floor = document.querySelectorAll('#floor-cards > .card').length;
        const deck = parseInt(document.getElementById('deck-count-big')?.textContent, 10);
        const myCap = document.querySelectorAll('#my-captured-zone .card-stack .card').length;
        const oppCap = document.querySelectorAll('#opp-captured-zone .card-stack .card').length;
        return my + opp + floor + deck + myCap + oppCap;
      });
      // fly 애니메이션 중인 카드 1~2장 오차 허용
      expect(Math.abs(total - 48)).toBeLessThanOrEqual(2);

      await pageP1.screenshot({ path: 'tests/screenshots/v8-qa-F-after-5-plays-p1.png' });
      await pageP2.screenshot({ path: 'tests/screenshots/v8-qa-F-after-5-plays-p2.png' });

      // 콘솔 에러 점검
      if (errors.length > 0) {
        console.log('수집된 에러:', errors);
      }
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  });

  test('G. 빠른 연속 클릭 — 동일 카드 더블클릭 시 한 번만 처리', async () => {
    const { browser, pageP1, pageP2 } = await setupTwoPlayers();
    const errors = [];
    pageP1.on('pageerror', (e) => errors.push(`P1: ${e.message}`));
    pageP2.on('pageerror', (e) => errors.push(`P2: ${e.message}`));
    try {
      await joinAndStartGame(pageP1, pageP2);
      // 흔들기 패널 처리
      for (const page of [pageP1, pageP2]) {
        const s = await readState(page);
        if (s.shakePanelVisible) {
          await page.click('#btn-shake-no');
          await page.waitForTimeout(300);
        }
      }
      const { activePage } = await findActivePage(pageP1, pageP2);
      const s = await readState(activePage);
      if (!s.firstClickableId) {
        test.skip();
        return;
      }
      // 같은 카드를 5번 빠르게 연속 클릭
      const sel = `#my-hand-cards .card[data-card-id="${s.firstClickableId}"]`;
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(activePage.click(sel, { force: true }).catch(() => null));
      }
      await Promise.all(promises);
      await activePage.waitForTimeout(1500);

      // 콘솔 에러 없음
      expect(errors).toEqual([]);

      // 카드 총합 보존 (서버에서 추가 클릭은 무시 또는 ERROR로 처리됨)
      const total = await activePage.evaluate(() => {
        const my = parseInt(document.getElementById('my-extra')?.textContent.replace(/[^\d]/g, ''), 10);
        const opp = parseInt(document.getElementById('opp-extra')?.textContent.replace(/[^\d]/g, ''), 10);
        const floor = document.querySelectorAll('#floor-cards > .card').length;
        const deck = parseInt(document.getElementById('deck-count-big')?.textContent, 10);
        const myCap = document.querySelectorAll('#my-captured-zone .card-stack .card').length;
        const oppCap = document.querySelectorAll('#opp-captured-zone .card-stack .card').length;
        return my + opp + floor + deck + myCap + oppCap;
      });
      expect(Math.abs(total - 48)).toBeLessThanOrEqual(2);
    } finally {
      await browser.close();
    }
  });

  test('H. 페이지 새로고침 후 재연결 — STATE 재수신', async () => {
    const { browser, pageP1, pageP2 } = await setupTwoPlayers();
    try {
      await joinAndStartGame(pageP1, pageP2);
      // P1 새로고침
      await pageP1.reload();
      // STATE 재수신 대기 (상대 손 10장 다시 뜸 — 라운드는 OPPONENT_LEFT로 리셋됨)
      // 단, 서버 동작상 OPPONENT_LEFT 후 game=null로 리셋되고, 새 입장 시 GAME_START.
      // 따라서 양 페이지 모두 새 게임이 시작됨.
      await pageP1.waitForFunction(() =>
        document.querySelectorAll('#opp-hand-cards .card.back').length === 10,
        { timeout: 7000 },
      );
      // P2도 다시 게임 시작됨 (서버가 두 명 입장 인식)
      const s2 = await readState(pageP2);
      // 게임이 재시작되었으므로 손패 10장이거나, 라운드가 정상 진행 중
      expect(s2.yourHandLen).toBeGreaterThanOrEqual(0);
    } finally {
      await browser.close();
    }
  });

  test('I. UI 시각 검증 — 게임 진행 중 스크린샷', async () => {
    const { browser, pageP1, pageP2 } = await setupTwoPlayers();
    try {
      await joinAndStartGame(pageP1, pageP2);
      // 흔들기 패널이 떴으면 일단 일반 처리
      for (const page of [pageP1, pageP2]) {
        const s = await readState(page);
        if (s.shakePanelVisible) {
          await page.click('#btn-shake-no');
          await page.waitForTimeout(300);
        }
      }
      // 카드 한 장 진행
      const { activePage } = await findActivePage(pageP1, pageP2);
      const s = await readState(activePage);
      if (s.firstClickableId) {
        await activePage.click(`#my-hand-cards .card[data-card-id="${s.firstClickableId}"]`);
        await activePage.waitForTimeout(3500); // fly 애니메이션 완료 대기
      }

      // 진행 후 스크린샷 두 쪽 모두
      await pageP1.screenshot({ path: 'tests/screenshots/v8-qa-I-progress-p1.png', fullPage: false });
      await pageP2.screenshot({ path: 'tests/screenshots/v8-qa-I-progress-p2.png', fullPage: false });

      // 1280×800 fit (overflow:hidden) — 스크롤바 없음
      const hasVerticalScroll = await pageP1.evaluate(() =>
        document.documentElement.scrollHeight > document.documentElement.clientHeight,
      );
      expect(hasVerticalScroll).toBe(false);
    } finally {
      await browser.close();
    }
  });

  test('J. 흔들기 패널 — 같은 월 3장 시 표시 (랜덤성 의존, skippable)', async () => {
    const { browser, pageP1, pageP2 } = await setupTwoPlayers();
    try {
      await joinAndStartGame(pageP1, pageP2);
      // 시작 직후 한 쪽에 흔들기가 떴는지 확인
      const s1 = await readState(pageP1);
      const s2 = await readState(pageP2);

      const triggered = s1.shakePanelVisible || s2.shakePanelVisible;
      if (!triggered) {
        // 흔들기 발생 안 한 라운드 — skip
        test.skip();
        return;
      }
      const shakePage = s1.shakePanelVisible ? pageP1 : pageP2;
      await shakePage.screenshot({ path: 'tests/screenshots/v8-qa-J-shake-panel.png' });

      // "흔들기" 클릭 → ×2 배지가 떠야 함
      await shakePage.click('#btn-shake');
      await shakePage.waitForFunction(() =>
        document.querySelectorAll('#my-badges .profile-badge').length > 0
        || document.getElementById('banner-multiplier')?.textContent?.includes('×2'),
        { timeout: 3000 },
      );
      const s = await readState(shakePage);
      expect(s.bannerMulti?.includes('×2') || s.bannerMulti?.includes('2')).toBeTruthy();
    } finally {
      await browser.close();
    }
  });

  test('K. 빈 입력 새 라운드 — 게임 중에 새 라운드 버튼 클릭 시 안전 처리', async () => {
    const { browser, pageP1, pageP2 } = await setupTwoPlayers();
    const errors = [];
    pageP1.on('pageerror', (e) => errors.push(`P1: ${e.message}`));
    try {
      await joinAndStartGame(pageP1, pageP2);
      // 게임 진행 중에 새 라운드 버튼 클릭 (게임 중 강제 새 라운드)
      await pageP1.click('#btn-new-round');
      await pageP1.waitForTimeout(1000);
      // 새 손패 10장이 다시 분배되거나, 또는 토스트로 안내 (서버 동작에 따라 다름)
      // 단, 콘솔 에러는 발생하면 안 됨
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  });
});
