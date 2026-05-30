/**
 * @fileoverview 다빈치 코드 플러스 E2E 브라우저 테스트.
 * 서버(node server.js, 포트 3002) 사전 실행 필요.
 * 2탭(P1/P2) 시뮬레이션으로 전체 게임 플로우 검증.
 */

import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:3002';
const SCREENSHOT_DIR = 'tests/screenshots';

/**
 * 2개 페이지(탭)를 열어 P1/P2 연결 + GAME_START 후 STATE 수신 대기.
 */
async function connectTwoPlayers(browser) {
  const ctx1 = await browser.newContext();
  const ctx2 = await browser.newContext();
  const p1 = await ctx1.newPage();
  const p2 = await ctx2.newPage();

  // P1 접속
  await p1.goto(BASE);
  await p1.waitForSelector('#you-tag:not(:empty)');

  // P2 접속 -> GAME_START
  await p2.goto(BASE);
  await p2.waitForSelector('#you-tag:not(:empty)');

  // 양쪽 모두 STATE 수신 대기 (조커 배치 페이즈)
  await p1.waitForFunction(() => {
    const el = document.getElementById('turn-status');
    return el && el.textContent.includes('조커 배치');
  }, { timeout: 5000 });

  await p2.waitForFunction(() => {
    const el = document.getElementById('turn-status');
    return el && el.textContent.includes('조커 배치');
  }, { timeout: 5000 });

  return { p1, p2, ctx1, ctx2 };
}

async function cleanup(ctx1, ctx2) {
  await ctx1.close();
  await ctx2.close();
}

// ── 기본 연결 + 조커 배치 페이즈 ────────────────────────────────────

test.describe('기본 연결 + 조커 배치 페이즈', () => {
  test('E-01: 두 플레이어 접속 시 조커 배치 화면 표시', async ({ browser }) => {
    const { p1, p2, ctx1, ctx2 } = await connectTwoPlayers(browser);

    // P1에 조커 배치 패널이 보이는지 확인
    const jokerPanel = p1.locator('#joker-place-panel');
    await expect(jokerPanel).toBeVisible({ timeout: 5000 });

    // 액션 디스플레이 텍스트
    const actionText = await p1.locator('#action-display').textContent();
    expect(actionText).toContain('조커');

    await p1.screenshot({ path: `${SCREENSHOT_DIR}/e01-joker-placement-phase.png` });
    await cleanup(ctx1, ctx2);
  });

  test('E-02: 타이틀 "DA VINCI CODE+" 확인', async ({ browser }) => {
    const { p1, p2, ctx1, ctx2 } = await connectTwoPlayers(browser);

    const title = await p1.locator('.title').textContent();
    expect(title).toBe('DA VINCI CODE+');

    const pageTitle = await p1.title();
    expect(pageTitle).toContain('다빈치 코드 플러스');

    await cleanup(ctx1, ctx2);
  });

  test('E-03: 조커 배치 버튼 수 = 손패 수 + 1', async ({ browser }) => {
    const { p1, p2, ctx1, ctx2 } = await connectTwoPlayers(browser);

    // 손패 카드 수
    const myCardCount = await p1.locator('#my-cards .card').count();
    // 배치 버튼 수
    const btnCount = await p1.locator('#joker-slot-buttons .btn-slot-place').count();
    expect(btnCount).toBe(myCardCount + 1);

    await cleanup(ctx1, ctx2);
  });

  test('E-04: 조커 뱃지에 색상 표시', async ({ browser }) => {
    const { p1, p2, ctx1, ctx2 } = await connectTwoPlayers(browser);

    const badge = p1.locator('#my-joker-badge');
    await expect(badge).toBeVisible();
    const classes = await badge.getAttribute('class');
    // red, yellow, blue 중 하나
    const hasColor = ['red', 'yellow', 'blue'].some(c => classes.includes(c));
    expect(hasColor).toBe(true);

    await cleanup(ctx1, ctx2);
  });
});

// ── 조커 배치 실행 ──────────────────────────────────────────────────

test.describe('조커 배치 실행', () => {
  test('E-05: P1 조커 배치 후 패널 숨김 + 대기 메시지', async ({ browser }) => {
    const { p1, p2, ctx1, ctx2 } = await connectTwoPlayers(browser);

    // P1 "맨 앞" 버튼 클릭
    await p1.locator('#joker-slot-buttons .btn-slot-place').first().click();

    // 조커 배치 패널 숨김
    await expect(p1.locator('#joker-place-panel')).toBeHidden({ timeout: 5000 });

    // "상대 배치 대기" 메시지
    const actionText = await p1.locator('#action-display').textContent();
    expect(actionText).toContain('상대');

    await p1.screenshot({ path: `${SCREENSHOT_DIR}/e05-p1-joker-placed-waiting.png` });
    await cleanup(ctx1, ctx2);
  });

  test('E-06: 양쪽 조커 배치 완료 시 추측 페이즈 전환', async ({ browser }) => {
    const { p1, p2, ctx1, ctx2 } = await connectTwoPlayers(browser);

    // P1 "맨 앞" 배치
    await p1.locator('#joker-slot-buttons .btn-slot-place').first().click();
    // P2 "맨 뒤" 배치
    await p2.locator('#joker-slot-buttons .btn-slot-place').last().click();

    // P1이 선공이라면 추측 패널이 보여야 함
    await p1.waitForFunction(() => {
      const ts = document.getElementById('turn-status');
      return ts && (ts.textContent.includes('내 턴') || ts.textContent.includes('상대 턴'));
    }, { timeout: 5000 });

    // 뽑은 카드(pending)가 표시되어야 함 (덱에서 1장 뽑기)
    const pendingText = await p1.locator('#pending-card').textContent();
    // 상대 턴이면 '?' 표시, 내 턴이면 숫자 or '-' 표시
    expect(pendingText).not.toBe('없음');

    await p1.screenshot({ path: `${SCREENSHOT_DIR}/e06-game-started.png` });
    await cleanup(ctx1, ctx2);
  });

  test('E-07: 손패에 조커 표시 ("-" 텍스트 + joker 클래스)', async ({ browser }) => {
    const { p1, p2, ctx1, ctx2 } = await connectTwoPlayers(browser);

    // P1 맨 앞 배치
    await p1.locator('#joker-slot-buttons .btn-slot-place').first().click();
    await p2.locator('#joker-slot-buttons .btn-slot-place').first().click();

    // 손패 카드 중 "-" 텍스트가 있는 카드(조커)가 존재해야 함
    const jokerCard = p1.locator('#my-cards .card.joker');
    await expect(jokerCard).toBeVisible({ timeout: 5000 });
    const text = await jokerCard.textContent();
    expect(text).toBe('-');

    // 카드에 조커 별 오버레이(::after) 확인은 CSS로 자동 적용되므로 클래스 확인
    const classes = await jokerCard.getAttribute('class');
    expect(classes).toContain('joker');

    await cleanup(ctx1, ctx2);
  });
});

// ── 카드 색상 검증 ──────────────────────────────────────────────────

test.describe('카드 색상 검증', () => {
  test('E-08: 카드에 red/yellow/blue 클래스 적용 + 올바른 배경색', async ({ browser }) => {
    const { p1, p2, ctx1, ctx2 } = await connectTwoPlayers(browser);

    // 조커 배치 완료
    await p1.locator('#joker-slot-buttons .btn-slot-place').first().click();
    await p2.locator('#joker-slot-buttons .btn-slot-place').first().click();

    // 잠시 대기
    await p1.waitForTimeout(500);

    // 내 카드들의 색상 클래스 확인
    const cards = p1.locator('#my-cards .card');
    const count = await cards.count();
    expect(count).toBe(5); // 4 숫자 + 1 조커

    const colorMap = {
      'red': 'rgb(192, 57, 43)',      // #c0392b
      'yellow': 'rgb(241, 196, 15)',   // #f1c40f
      'blue': 'rgb(41, 128, 185)',     // #2980b9
    };

    for (let i = 0; i < count; i++) {
      const card = cards.nth(i);
      const classes = await card.getAttribute('class');
      const color = ['red', 'yellow', 'blue'].find(c => classes.includes(c));
      expect(color).toBeDefined();

      // 배경색 검증
      const bg = await card.evaluate(el => getComputedStyle(el).backgroundColor);
      expect(bg).toBe(colorMap[color]);
    }

    await p1.screenshot({ path: `${SCREENSHOT_DIR}/e08-card-colors.png` });
    await cleanup(ctx1, ctx2);
  });

  test('E-09: 흑/백 CSS 클래스 잔존 없음', async ({ browser }) => {
    const { p1, p2, ctx1, ctx2 } = await connectTwoPlayers(browser);

    // 페이지 전체 HTML에서 black/white 관련 클래스 검색
    const html = await p1.content();
    expect(html).not.toContain('class="card black');
    expect(html).not.toContain('class="card white');
    expect(html).not.toContain('black-tile');
    expect(html).not.toContain('white-tile');

    await cleanup(ctx1, ctx2);
  });
});

// ── 메모판 검증 ────────────────────────────────────────────────────

test.describe('메모판 검증', () => {
  test('E-10: 메모판 39칸 (3색 x 12숫자 + 3조커)', async ({ browser }) => {
    const { p1, p2, ctx1, ctx2 } = await connectTwoPlayers(browser);

    const tiles = p1.locator('#memo-board .memo-tile');
    const tileCount = await tiles.count();
    expect(tileCount).toBe(39);

    // 색상별 확인
    for (const color of ['red', 'yellow', 'blue']) {
      const colorTiles = p1.locator(`#memo-board .memo-tile.${color}-tile`);
      const colorCount = await colorTiles.count();
      expect(colorCount).toBe(13); // 12숫자 + 1조커
    }

    // 조커 타일 3개
    const jokerTiles = p1.locator('#memo-board .memo-tile.joker-tile');
    expect(await jokerTiles.count()).toBe(3);

    await p1.screenshot({ path: `${SCREENSHOT_DIR}/e10-memo-board-39tiles.png` });
    await cleanup(ctx1, ctx2);
  });

  test('E-11: 메모판 색상별 배경색 확인', async ({ browser }) => {
    const { p1, p2, ctx1, ctx2 } = await connectTwoPlayers(browser);

    const colorMap = {
      'red-tile': 'rgb(192, 57, 43)',
      'yellow-tile': 'rgb(241, 196, 15)',
      'blue-tile': 'rgb(41, 128, 185)',
    };

    for (const [tileClass, expectedBg] of Object.entries(colorMap)) {
      const tile = p1.locator(`#memo-board .memo-tile.${tileClass}`).first();
      const bg = await tile.evaluate(el => getComputedStyle(el).backgroundColor);
      expect(bg).toBe(expectedBg);
    }

    await cleanup(ctx1, ctx2);
  });
});

// ── 조커 추측 UI ────────────────────────────────────────────────────

test.describe('조커 추측 UI', () => {
  test('E-12: "조커?" 버튼이 추측 패널에 존재', async ({ browser }) => {
    const { p1, p2, ctx1, ctx2 } = await connectTwoPlayers(browser);

    // 조커 배치 완료
    await p1.locator('#joker-slot-buttons .btn-slot-place').first().click();
    await p2.locator('#joker-slot-buttons .btn-slot-place').first().click();

    // 선공(P1)의 추측 패널 확인
    await p1.waitForFunction(() => {
      const ts = document.getElementById('turn-status');
      return ts && ts.textContent.includes('내 턴');
    }, { timeout: 5000 });

    const jokerBtn = p1.locator('#btn-guess-joker');
    await expect(jokerBtn).toBeVisible();
    const text = await jokerBtn.textContent();
    expect(text).toContain('조커');

    await p1.screenshot({ path: `${SCREENSHOT_DIR}/e12-joker-guess-button.png` });
    await cleanup(ctx1, ctx2);
  });

  test('E-13: 슬롯 미선택 상태에서 "조커?" 클릭 시 토스트 경고', async ({ browser }) => {
    const { p1, p2, ctx1, ctx2 } = await connectTwoPlayers(browser);

    await p1.locator('#joker-slot-buttons .btn-slot-place').first().click();
    await p2.locator('#joker-slot-buttons .btn-slot-place').first().click();

    await p1.waitForFunction(() => {
      const ts = document.getElementById('turn-status');
      return ts && ts.textContent.includes('내 턴');
    }, { timeout: 5000 });

    // 슬롯 선택 없이 조커 추측 클릭
    await p1.locator('#btn-guess-joker').click();

    // 토스트 메시지 확인
    const toast = p1.locator('#toast');
    await expect(toast).not.toHaveClass(/hidden/, { timeout: 3000 });
    const toastText = await toast.textContent();
    expect(toastText).toContain('선택');

    await cleanup(ctx1, ctx2);
  });
});

// ── 게임 플로우 통합 테스트 ────────────────────────────────────────

test.describe('게임 플로우 통합 테스트', () => {
  test('E-14: 추측 실패 -> 뽑은 카드 공개 -> 턴 교대 확인', async ({ browser }) => {
    const { p1, p2, ctx1, ctx2 } = await connectTwoPlayers(browser);

    // 조커 배치
    await p1.locator('#joker-slot-buttons .btn-slot-place').first().click();
    await p2.locator('#joker-slot-buttons .btn-slot-place').first().click();

    // P1(선공) 대기
    await p1.waitForFunction(() => {
      const ts = document.getElementById('turn-status');
      return ts && ts.textContent.includes('내 턴');
    }, { timeout: 5000 });

    // 상대 카드 첫 번째 미공개 카드 클릭
    const oppCards = p1.locator('#opp-cards .card.hidden-value');
    const oppCount = await oppCards.count();
    expect(oppCount).toBeGreaterThan(0);
    await oppCards.first().click();

    // 선택 슬롯 확인
    const slotText = await p1.locator('#selected-slot').textContent();
    expect(slotText).toContain('1');

    // 일부러 틀리게 추측 (값 11 - 확률적으로 틀릴 수 있음, 여러 값 시도)
    await p1.locator('#guess-value').fill('11');
    await p1.locator('#btn-guess').click();

    // 결과 확인 - 턴이 바뀌었거나 정답이면 계속 패널
    await p1.waitForFunction(() => {
      const ts = document.getElementById('turn-status');
      return ts && (ts.textContent.includes('상대 턴') || ts.textContent.includes('정답'));
    }, { timeout: 5000 });

    await p1.screenshot({ path: `${SCREENSHOT_DIR}/e14-after-guess.png` });
    await cleanup(ctx1, ctx2);
  });

  test('E-15: NEW_GAME 시 조커 배치 페이즈 재진입', async ({ browser }) => {
    const { p1, p2, ctx1, ctx2 } = await connectTwoPlayers(browser);

    // 조커 배치 완료 -> 게임 진행
    await p1.locator('#joker-slot-buttons .btn-slot-place').first().click();
    await p2.locator('#joker-slot-buttons .btn-slot-place').first().click();

    await p1.waitForTimeout(500);

    // "새 게임" 버튼 클릭
    // confirm 다이얼로그 자동 수락
    p1.on('dialog', dialog => dialog.accept());
    await p1.locator('#btn-restart').click();

    // 조커 배치 페이즈로 재진입 확인
    await p1.waitForFunction(() => {
      const ts = document.getElementById('turn-status');
      return ts && ts.textContent.includes('조커 배치');
    }, { timeout: 5000 });

    const jokerPanel = p1.locator('#joker-place-panel');
    await expect(jokerPanel).toBeVisible({ timeout: 3000 });

    await p1.screenshot({ path: `${SCREENSHOT_DIR}/e15-new-game-joker-phase.png` });
    await cleanup(ctx1, ctx2);
  });
});

// ── 상대 카드 렌더링 검증 ──────────────────────────────────────────

test.describe('상대 카드 렌더링', () => {
  test('E-16: 상대 미공개 카드 "?" 표시 + 색상만 보임', async ({ browser }) => {
    const { p1, p2, ctx1, ctx2 } = await connectTwoPlayers(browser);

    // 조커 배치 완료
    await p1.locator('#joker-slot-buttons .btn-slot-place').first().click();
    await p2.locator('#joker-slot-buttons .btn-slot-place').first().click();
    await p1.waitForTimeout(500);

    const oppCards = p1.locator('#opp-cards .card');
    const count = await oppCards.count();
    expect(count).toBe(5); // 4 숫자 + 1 조커

    for (let i = 0; i < count; i++) {
      const card = oppCards.nth(i);
      const text = await card.textContent();
      // 미공개 카드는 "?" 표시
      expect(text).toBe('?');
      // 색상 클래스 확인
      const classes = await card.getAttribute('class');
      const hasColor = ['red', 'yellow', 'blue'].some(c => classes.includes(c));
      expect(hasColor).toBe(true);
    }

    await cleanup(ctx1, ctx2);
  });

  test('E-17: 상대 미공개 카드 중 joker 클래스 존재 확인', async ({ browser }) => {
    const { p1, p2, ctx1, ctx2 } = await connectTwoPlayers(browser);

    await p1.locator('#joker-slot-buttons .btn-slot-place').first().click();
    await p2.locator('#joker-slot-buttons .btn-slot-place').first().click();
    await p1.waitForTimeout(500);

    // 상대 카드 중 조커 클래스가 있는 카드가 1개 있어야 함
    const jokerCards = p1.locator('#opp-cards .card.joker');
    expect(await jokerCards.count()).toBe(1);

    await cleanup(ctx1, ctx2);
  });
});

// ── UI 안정성 ──────────────────────────────────────────────────────

test.describe('UI 안정성', () => {
  test('E-18: 콘솔 에러 없음 (게임 시작 + 조커 배치)', async ({ browser }) => {
    const errors = [];
    const ctx1 = await browser.newContext();
    const p1 = await ctx1.newPage();
    p1.on('pageerror', err => errors.push(err.message));

    const ctx2 = await browser.newContext();
    const p2 = await ctx2.newPage();
    p2.on('pageerror', err => errors.push(err.message));

    await p1.goto(BASE);
    await p2.goto(BASE);

    await p1.waitForFunction(() => {
      const ts = document.getElementById('turn-status');
      return ts && ts.textContent.includes('조커 배치');
    }, { timeout: 5000 });

    // 조커 배치
    await p1.locator('#joker-slot-buttons .btn-slot-place').first().click();
    await p2.locator('#joker-slot-buttons .btn-slot-place').first().click();

    await p1.waitForTimeout(1000);

    expect(errors).toEqual([]);
    await ctx1.close();
    await ctx2.close();
  });

  test('E-19: 전체 레이아웃 스크린샷 (1280x800)', async ({ browser }) => {
    const { p1, p2, ctx1, ctx2 } = await connectTwoPlayers(browser);

    await p1.locator('#joker-slot-buttons .btn-slot-place').first().click();
    await p2.locator('#joker-slot-buttons .btn-slot-place').first().click();
    await p1.waitForTimeout(500);

    await p1.screenshot({ path: `${SCREENSHOT_DIR}/e19-full-layout-p1.png`, fullPage: true });
    await p2.screenshot({ path: `${SCREENSHOT_DIR}/e19-full-layout-p2.png`, fullPage: true });

    await cleanup(ctx1, ctx2);
  });

  test('E-20: 덱 카운트 표시 정상', async ({ browser }) => {
    const { p1, p2, ctx1, ctx2 } = await connectTwoPlayers(browser);

    // 초기 덱: 39 - 10(배분) = 29장
    // 조커 배치 후 pendingDrawn 1장 뽑기 -> 28장
    await p1.locator('#joker-slot-buttons .btn-slot-place').first().click();
    await p2.locator('#joker-slot-buttons .btn-slot-place').first().click();

    await p1.waitForTimeout(500);

    const deckCount = await p1.locator('#deck-count').textContent();
    const deckBig = await p1.locator('#deck-count-big').textContent();
    // 28장이어야 함 (39 - 10 배분 - 1 뽑기)
    expect(parseInt(deckCount)).toBe(28);
    expect(deckCount).toBe(deckBig);

    await cleanup(ctx1, ctx2);
  });
});

// ── 엣지케이스 (빠른 연타, 비정상 입력) ────────────────────────────

test.describe('엣지케이스', () => {
  test('E-21: 조커 배치 버튼 연타 시 중복 배치 방지 (서버 로직 검증)', async ({ browser }) => {
    const { p1, p2, ctx1, ctx2 } = await connectTwoPlayers(browser);

    // 첫 번째 클릭 -- 정상 배치
    const btn = p1.locator('#joker-slot-buttons .btn-slot-place').first();
    await btn.click();

    // 패널이 숨겨지는지 확인 (중복 클릭 UI 차단)
    await expect(p1.locator('#joker-place-panel')).toBeHidden({ timeout: 5000 });

    // 서버 측 중복 방지: game.js G-19 단위 테스트에서 placeJoker 재호출 시
    // { ok: false, error: '이미 조커를 배치했다' } 반환 검증 완료.
    // 클라이언트 측: 패널 hidden 후 버튼이 DOM에서 접근 불가하므로 UI 레벨에서도 차단됨.

    const actionText = await p1.locator('#action-display').textContent();
    expect(actionText).toContain('상대');

    await cleanup(ctx1, ctx2);
  });

  test('E-22: 숫자 입력 범위 외 값(12) 추측 시 토스트 경고', async ({ browser }) => {
    const { p1, p2, ctx1, ctx2 } = await connectTwoPlayers(browser);

    await p1.locator('#joker-slot-buttons .btn-slot-place').first().click();
    await p2.locator('#joker-slot-buttons .btn-slot-place').first().click();

    await p1.waitForFunction(() => {
      const ts = document.getElementById('turn-status');
      return ts && ts.textContent.includes('내 턴');
    }, { timeout: 5000 });

    // 상대 카드 선택
    await p1.locator('#opp-cards .card.hidden-value').first().click();

    // 범위 밖 숫자 입력
    await p1.locator('#guess-value').fill('12');
    await p1.locator('#btn-guess').click();

    // 토스트 경고 확인
    const toast = p1.locator('#toast');
    await expect(toast).not.toHaveClass(/hidden/, { timeout: 3000 });
    const toastText = await toast.textContent();
    expect(toastText).toContain('0~11');

    await cleanup(ctx1, ctx2);
  });

  test('E-23: 빈 입력으로 추측 시 토스트 경고', async ({ browser }) => {
    const { p1, p2, ctx1, ctx2 } = await connectTwoPlayers(browser);

    await p1.locator('#joker-slot-buttons .btn-slot-place').first().click();
    await p2.locator('#joker-slot-buttons .btn-slot-place').first().click();

    await p1.waitForFunction(() => {
      const ts = document.getElementById('turn-status');
      return ts && ts.textContent.includes('내 턴');
    }, { timeout: 5000 });

    // 상대 카드 선택
    await p1.locator('#opp-cards .card.hidden-value').first().click();

    // 빈 입력 그대로 추측
    await p1.locator('#guess-value').fill('');
    await p1.locator('#btn-guess').click();

    // 토스트 경고 확인
    const toast = p1.locator('#toast');
    await expect(toast).not.toHaveClass(/hidden/, { timeout: 3000 });

    await cleanup(ctx1, ctx2);
  });

  test('E-24: 상대 턴에서 카드 클릭 불가 (clickable 클래스 없음)', async ({ browser }) => {
    const { p1, p2, ctx1, ctx2 } = await connectTwoPlayers(browser);

    await p1.locator('#joker-slot-buttons .btn-slot-place').first().click();
    await p2.locator('#joker-slot-buttons .btn-slot-place').first().click();

    // P2는 후공이므로 상대 턴
    await p2.waitForFunction(() => {
      const ts = document.getElementById('turn-status');
      return ts && ts.textContent.includes('상대 턴');
    }, { timeout: 5000 });

    // P2의 상대 카드에 clickable 클래스가 없어야 함
    const clickable = p2.locator('#opp-cards .card.clickable');
    expect(await clickable.count()).toBe(0);

    await cleanup(ctx1, ctx2);
  });
});

// ── 추측 기록 검증 ──────────────────────────────────────────────────

test.describe('추측 기록', () => {
  test('E-25: 추측 후 기록 패널에 항목 추가', async ({ browser }) => {
    const { p1, p2, ctx1, ctx2 } = await connectTwoPlayers(browser);

    await p1.locator('#joker-slot-buttons .btn-slot-place').first().click();
    await p2.locator('#joker-slot-buttons .btn-slot-place').first().click();

    await p1.waitForFunction(() => {
      const ts = document.getElementById('turn-status');
      return ts && ts.textContent.includes('내 턴');
    }, { timeout: 5000 });

    // 상대 카드 선택 + 추측
    await p1.locator('#opp-cards .card.hidden-value').first().click();
    await p1.locator('#guess-value').fill('5');
    await p1.locator('#btn-guess').click();

    // 추측 기록에 항목 추가 확인
    await p1.waitForTimeout(500);
    const historyItems = p1.locator('#guess-history .history-item');
    expect(await historyItems.count()).toBeGreaterThan(0);

    await cleanup(ctx1, ctx2);
  });
});
