/**
 * @fileoverview 하나비 "안 보이는 카드 분포 카운터" 모달 E2E (HR-C12).
 *
 * 헤더의 🃏 분포 버튼으로 호출되는 카운터 모달을 검증한다.
 * 안 보이는 영역(덱 + 본인 손패)의 색×숫자별 잔여 카드 수를 표시한다.
 *
 * 정보 공정성 검증 (최중요):
 *  - 본인 손패의 색·숫자는 직접 표시하지 않는다(§1, §13 손패 가림 원칙 유지).
 *  - 표준 분포(50장)에서 보이는 카드(상대 손패 + 불꽃 + 버림)만 차감한다.
 *
 * 사전 요건: hanabi 서버가 http://localhost:3097 에서 실행 중이어야 한다.
 *   node server.js --port 3097
 *
 * 실행:
 *   npx playwright test tests/rulebook-c12-counter.spec.js --reporter=list
 */

import { test, expect } from 'playwright/test';

const BASE = 'http://localhost:3097';
const COLORS = ['white', 'red', 'blue', 'green', 'yellow'];
const INITIAL_COUNTS = { 1: 3, 2: 2, 3: 2, 4: 2, 5: 1 };
const COLOR_TOTAL = 10;                // 색당 10장
const DECK_TOTAL = COLORS.length * COLOR_TOTAL; // 50장

/**
 * 두 플레이어 입장 + 게임 시작 + 첫 STATE 렌더 완료까지 대기.
 * @returns {{ctx1, ctx2, p1, p2, errs}}
 */
async function joinTwo(browser) {
  const ctx1 = await browser.newContext({ viewport: { width: 1000, height: 900 } });
  const ctx2 = await browser.newContext({ viewport: { width: 1000, height: 900 } });
  const p1 = await ctx1.newPage();
  const p2 = await ctx2.newPage();
  const errs = [];
  p1.on('pageerror', (e) => errs.push('p1:' + e.message));
  p2.on('pageerror', (e) => errs.push('p2:' + e.message));
  await p1.goto(BASE);
  await p2.goto(BASE);
  await p1.waitForSelector('#my-hand .card', { timeout: 15000 });
  await p2.waitForSelector('#my-hand .card', { timeout: 15000 });
  return { ctx1, ctx2, p1, p2, errs };
}

/**
 * 카운터 모달의 (color, number) 셀의 현재 카운트(dataset.count)를 읽어 정수로 반환.
 */
async function cellCount(page, color, number) {
  const sel = `#counter-grid .counter-cell[data-color="${color}"][data-number="${number}"]`;
  const v = await page.locator(sel).getAttribute('data-count');
  return parseInt(v, 10);
}

/**
 * 본인 시점에서 보이는 카드(상대 손패 + 불꽃 + 버림 더미)의 색·숫자별 카운트를 클라이언트 DOM에서 직접 수집.
 * 테스트가 서버 STATE에 직접 접근하지 않고도 "보이는 카드 N장"을 독립 검증할 수 있게 해준다.
 *
 * 반환: { visible: {color: {n: count}}, totalVisible: number }
 */
async function collectVisibleFromDom(page) {
  const result = await page.evaluate(() => {
    const COLORS = ['white', 'red', 'blue', 'green', 'yellow'];
    const visible = {};
    for (const c of COLORS) {
      visible[c] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    }
    // 상대 손패 — 카드 클래스에서 색, .card-number에서 숫자 추출.
    const oppCards = document.querySelectorAll('#opponent-hand .card');
    for (const el of oppCards) {
      const m = el.className.match(/card--(white|red|blue|green|yellow)/);
      const numEl = el.querySelector('.card-number');
      if (m && numEl) {
        const n = parseInt(numEl.textContent, 10);
        if (n >= 1 && n <= 5) visible[m[1]][n] += 1;
      }
    }
    // 버림 더미 — .discard-chip의 클래스(색) + 텍스트 마지막 글자(숫자) 또는 텍스트 끝 숫자.
    const dis = document.querySelectorAll('#discard-pile .discard-chip');
    for (const el of dis) {
      const m = el.className.match(/card--(white|red|blue|green|yellow)/);
      const text = (el.textContent || '').trim();
      const num = parseInt(text.replace(/[^0-9]/g, ''), 10);
      if (m && num >= 1 && num <= 5) visible[m[1]][num] += 1;
    }
    // 불꽃 — firework-slot--<color>에 lit 클래스가 있으면 .firework-number에 max값. 1..max 모두 보이는 카드.
    const slots = document.querySelectorAll('#fireworks-area .firework-slot');
    for (const el of slots) {
      const m = el.className.match(/firework-slot--(white|red|blue|green|yellow)/);
      const numEl = el.querySelector('.firework-number');
      if (m && numEl) {
        const max = parseInt(numEl.textContent, 10);
        if (max >= 1 && max <= 5) {
          for (let k = 1; k <= max; k++) visible[m[1]][k] += 1;
        }
      }
    }
    let total = 0;
    for (const c of COLORS) for (let n = 1; n <= 5; n++) total += visible[c][n];
    return { visible, totalVisible: total };
  });
  return result;
}

// ─────────────────────────────────────────────────────────────────

test('HR-C12-001 헤더 🃏 분포 버튼 표시 + 클릭 시 카운터 모달 열림', async ({ browser }) => {
  const { ctx1, ctx2, p1, errs } = await joinTwo(browser);
  try {
    // 버튼이 헤더에 표시되어야 한다.
    await expect(p1.locator('#btn-open-counter')).toBeVisible();
    // 초기 상태: 모달은 hidden.
    await expect(p1.locator('#counter-modal')).toHaveClass(/hidden/);

    await p1.click('#btn-open-counter');
    await expect(p1.locator('#counter-modal')).not.toHaveClass(/hidden/);
    await expect(p1.locator('#counter-grid')).toBeVisible();

    // 5색 × 5숫자 = 25개 셀이 렌더링되어야 한다.
    const cells = await p1.locator('#counter-grid .counter-cell').count();
    expect(cells).toBe(25);

    await p1.screenshot({ path: 'tests/screenshots/c12-counter-initial.png', fullPage: true });
    expect(errs).toEqual([]);
  } finally {
    await ctx1.close(); await ctx2.close();
  }
});

test('HR-C12-002 초기 상태 — 안 보이는 합계 = 50 - opponentHand(5) = 45', async ({ browser }) => {
  const { ctx1, ctx2, p1, errs } = await joinTwo(browser);
  try {
    await p1.click('#btn-open-counter');
    await expect(p1.locator('#counter-modal')).not.toHaveClass(/hidden/);

    // 초기 상태: fireworks 0, discardPile 0, opponentHand 5장.
    const total = parseInt(await p1.locator('#counter-hidden-total').textContent(), 10);
    expect(total).toBe(DECK_TOTAL - 5); // 50 - 5 = 45

    // 덱 카운트는 40 (50 - opponentHand 5 - myHand 5).
    const deck = parseInt(await p1.locator('#counter-deck-count').textContent(), 10);
    expect(deck).toBe(40);

    // 본인 손패(myHand)가 가려져 있으므로 카운터에서 myHand를 차감하지 않는다 →
    // 합계(45)는 "덱(40) + 내 손패(5)"의 합과 정확히 일치해야 한다.
    expect(total).toBe(deck + 5);
    expect(errs).toEqual([]);
  } finally {
    await ctx1.close(); await ctx2.close();
  }
});

test('HR-C12-003 초기 상태 — 각 셀 = INITIAL_COUNTS - opponentHand 카운트 (정보 공정성)', async ({ browser }) => {
  const { ctx1, ctx2, p1, errs } = await joinTwo(browser);
  try {
    // 1) DOM에서 본인 시점 "보이는 카드"를 수집 (모달 열기 전).
    const { visible, totalVisible } = await collectVisibleFromDom(p1);
    // 초기 상태에서 보이는 카드는 opponentHand 5장만.
    expect(totalVisible).toBe(5);

    // 2) 카운터 모달을 열고 각 셀 = INITIAL_COUNTS[n] - visible[c][n] 인지 모든 색·숫자 비교.
    await p1.click('#btn-open-counter');
    await expect(p1.locator('#counter-modal')).not.toHaveClass(/hidden/);

    for (const c of COLORS) {
      for (let n = 1; n <= 5; n++) {
        const expected = INITIAL_COUNTS[n] - visible[c][n];
        const actual = await cellCount(p1, c, n);
        expect(actual, `${c}/${n} 셀: expected=${expected} actual=${actual}`).toBe(expected);
      }
    }

    // 3) 정보 공정성 검증 — myHand 5장은 차감되지 않아야 한다.
    //    합계 = 50 - 5(opponentHand만) = 45.
    const total = parseInt(await p1.locator('#counter-hidden-total').textContent(), 10);
    expect(total).toBe(DECK_TOTAL - totalVisible);
    expect(errs).toEqual([]);
  } finally {
    await ctx1.close(); await ctx2.close();
  }
});

test('HR-C12-004 카드 버리기 → 그 색·숫자 셀 카운트 -1, 합계 -1, 덱 -1 (덱 보충)', async ({ browser }) => {
  const { ctx1, ctx2, p1, p2, errs } = await joinTwo(browser);
  try {
    // 토큰 8이면 버리기 불가 → 먼저 p1이 힌트를 줘서 토큰 7로 만든 뒤 p2가 버리기.
    const firstOppClass = await p1.locator('#opponent-hand .card').first().getAttribute('class');
    const color = (firstOppClass.match(/card--(white|red|blue|green|yellow)/) || [, 'red'])[1];
    await p1.click('#btn-clue');
    await p1.waitForSelector('#clue-panel:not(.hidden)', { timeout: 5000 });
    await p1.click(`#clue-panel [data-clue-type="color"][data-clue-value="${color}"]`);
    await p2.waitForTimeout(700);

    // p2가 첫 카드를 버린다 → 버린 카드 색·숫자는 p1 시점에서 discardPile로 공개됨.
    await p2.waitForSelector('#btn-discard:not([disabled])', { timeout: 5000 });
    await p2.click('#btn-discard');
    await p2.waitForSelector('#my-hand.selectable', { timeout: 5000 });
    await p2.locator('#my-hand .card').first().click();
    await p2.waitForTimeout(800);

    // p1 화면에서 버림 더미가 1장 누적되었는지.
    const discardCount = parseInt(await p1.locator('#discard-count').textContent(), 10);
    expect(discardCount).toBe(1);

    // 버려진 카드의 색·숫자를 p1 화면 discard-chip에서 직접 읽는다.
    const chipClass = await p1.locator('#discard-pile .discard-chip').first().getAttribute('class');
    const chipText = (await p1.locator('#discard-pile .discard-chip').first().textContent()).trim();
    const dColor = (chipClass.match(/card--(white|red|blue|green|yellow)/) || [, null])[1];
    const dNumber = parseInt(chipText.replace(/[^0-9]/g, ''), 10);
    expect(dColor).not.toBeNull();
    expect(dNumber).toBeGreaterThanOrEqual(1);
    expect(dNumber).toBeLessThanOrEqual(5);

    // 카운터 모달 열어 검증 (p1 시점).
    await p1.click('#btn-open-counter');
    await expect(p1.locator('#counter-modal')).not.toHaveClass(/hidden/);

    // 보이는 카드를 DOM에서 수집 → 셀 = INITIAL - visible 인지 전체 비교.
    const { visible, totalVisible } = await collectVisibleFromDom(p1);
    for (const c of COLORS) {
      for (let n = 1; n <= 5; n++) {
        const expected = INITIAL_COUNTS[n] - visible[c][n];
        const actual = await cellCount(p1, c, n);
        expect(actual, `${c}/${n}`).toBe(expected);
      }
    }
    // 합계 = 50 - totalVisible.
    const total = parseInt(await p1.locator('#counter-hidden-total').textContent(), 10);
    expect(total).toBe(DECK_TOTAL - totalVisible);

    // 덱 보충됨 → deck = 39 (50 - 5 opponentHand - 5 myHand - 1 burned + 1 drawn? 실제는 -1).
    // 더 단순하게: 게임 시작 시 deck=40, p2 버리고 1장 보충 → deck=39.
    const deck = parseInt(await p1.locator('#counter-deck-count').textContent(), 10);
    expect(deck).toBe(39);
    expect(errs).toEqual([]);
  } finally {
    await ctx1.close(); await ctx2.close();
  }
});

test('HR-C12-005 카드 내기 → 그 색·숫자 셀 카운트 -1, 합계 -1', async ({ browser }) => {
  const { ctx1, ctx2, p1, p2, errs } = await joinTwo(browser);
  try {
    // p1이 첫 카드를 낸다. 성공/실패 무관 — 그 카드의 색·숫자는 공개됨(불꽃 +1 또는 discardPile +1).
    await p1.click('#btn-play');
    await p1.waitForSelector('#my-hand.selectable', { timeout: 5000 });
    await p1.locator('#my-hand .card').first().click();
    await p1.waitForTimeout(800);

    // 카운터를 p2 시점에서 열어 검증한다 (p1이 낸 카드는 p2도 공개로 본다).
    await p2.click('#btn-open-counter');
    await expect(p2.locator('#counter-modal')).not.toHaveClass(/hidden/);

    const { visible, totalVisible } = await collectVisibleFromDom(p2);
    // 보이는 카드 = opponentHand(p1) 5장 + 새로 발생한 1장 (불꽃 +1 or discard +1) = 6장.
    expect(totalVisible).toBe(6);

    // 각 셀 = INITIAL - visible 인지 모든 색·숫자 검증.
    for (const c of COLORS) {
      for (let n = 1; n <= 5; n++) {
        const expected = INITIAL_COUNTS[n] - visible[c][n];
        const actual = await cellCount(p2, c, n);
        expect(actual, `${c}/${n}`).toBe(expected);
      }
    }
    const total = parseInt(await p2.locator('#counter-hidden-total').textContent(), 10);
    expect(total).toBe(DECK_TOTAL - totalVisible); // 44
    expect(errs).toEqual([]);
  } finally {
    await ctx1.close(); await ctx2.close();
  }
});

test('HR-C12-006 0인 셀 — 시각적으로 흐릿 + 줄긋기(counter-cell--zero 클래스)', async ({ browser }) => {
  const { ctx1, ctx2, p1, errs } = await joinTwo(browser);
  try {
    // 직접 5완성을 만들지 않고도 검증 가능 — 게임 초기 상태에서 opponentHand에 같은 (color, number)가
    // INITIAL_COUNTS[number] 만큼 모두 분포할 확률은 매우 낮으므로 결정론적 테스트가 어렵다.
    // 대신: window.__hanabiRefreshCounter 직전 STATE를 조작할 수 없으므로,
    // 0이 발생하는 셀이 만약 있다면 .counter-cell--zero 클래스가 정확히 그 셀에만 붙는지 검증한다.
    await p1.click('#btn-open-counter');
    await expect(p1.locator('#counter-modal')).not.toHaveClass(/hidden/);

    // DOM 검사: data-count="0" 셀은 반드시 counter-cell--zero 클래스를, count>0 셀은 반드시 그 클래스를 갖지 않아야 한다.
    const inconsistent = await p1.evaluate(() => {
      const cells = document.querySelectorAll('#counter-grid .counter-cell');
      const bad = [];
      for (const el of cells) {
        const c = parseInt(el.dataset.count, 10);
        const isZero = el.classList.contains('counter-cell--zero');
        if (c === 0 && !isZero) bad.push(`${el.dataset.color}/${el.dataset.number}: count=0 but no zero class`);
        if (c > 0 && isZero) bad.push(`${el.dataset.color}/${el.dataset.number}: count=${c} but has zero class`);
      }
      return bad;
    });
    expect(inconsistent).toEqual([]);
    expect(errs).toEqual([]);
  } finally {
    await ctx1.close(); await ctx2.close();
  }
});

test('HR-C12-007 모달 닫기 (✕ / ESC / 백드롭) — HR-C11B 패턴 동일', async ({ browser }) => {
  const { ctx1, ctx2, p1, errs } = await joinTwo(browser);
  try {
    // ✕ 버튼.
    await p1.click('#btn-open-counter');
    await expect(p1.locator('#counter-modal')).not.toHaveClass(/hidden/);
    await p1.click('#counter-modal-close');
    await expect(p1.locator('#counter-modal')).toHaveClass(/hidden/);

    // ESC 키.
    await p1.click('#btn-open-counter');
    await expect(p1.locator('#counter-modal')).not.toHaveClass(/hidden/);
    await p1.keyboard.press('Escape');
    await expect(p1.locator('#counter-modal')).toHaveClass(/hidden/);

    // 백드롭 클릭 — 카드 내부 클릭은 닫지 않아야 한다.
    await p1.click('#btn-open-counter');
    await expect(p1.locator('#counter-modal')).not.toHaveClass(/hidden/);
    // 카드 내부(그리드 헤더) 클릭은 닫지 않는다.
    await p1.locator('#counter-modal .counter-modal-title').click();
    await expect(p1.locator('#counter-modal')).not.toHaveClass(/hidden/);
    // 모서리 좌표(백드롭)를 직접 클릭.
    const box = await p1.locator('#counter-modal').boundingBox();
    await p1.mouse.click(box.x + 4, box.y + 4);
    await expect(p1.locator('#counter-modal')).toHaveClass(/hidden/);
    expect(errs).toEqual([]);
  } finally {
    await ctx1.close(); await ctx2.close();
  }
});

test('HR-C12-008 STATE 갱신 시 모달이 열려있으면 자동 재렌더', async ({ browser }) => {
  const { ctx1, ctx2, p1, p2, errs } = await joinTwo(browser);
  try {
    // p1이 카운터를 열어둔다.
    await p1.click('#btn-open-counter');
    await expect(p1.locator('#counter-modal')).not.toHaveClass(/hidden/);
    const totalBefore = parseInt(await p1.locator('#counter-hidden-total').textContent(), 10);
    expect(totalBefore).toBe(45); // 초기 상태.

    // 이제 p1이 카드를 낸다 (PLAY_CARD) — STATE가 양쪽에 새로 전송된다.
    // 모달을 닫지 않고 행동 — 액션 버튼이 모달 뒤에 가려져 있을 수 있으므로, 모달을 잠시 닫고 다시 연다.
    // (실제 사용자 흐름: 카운터 닫고 → 행동 → 다시 카운터 열기)
    //
    // 하지만 본 테스트는 "모달이 열린 채로 STATE가 도착하면 자동 재렌더" 자체를 검증하므로,
    // p2가 행동을 수행하여 p1의 모달이 열린 채로 STATE가 도착하는 시나리오를 만든다.
    //
    // 시나리오:
    //  - p1 모달 열기 → p1은 자기 턴이지만 행동을 안 하고 모달 보는 중.
    //  - 그러나 p1이 행동하지 않으면 p2 STATE도 안 바뀐다.
    //  - 해결: p1이 모달 닫고 행동 → 다시 열기는 명시적 재렌더이므로 008의 의도가 아니다.
    //
    // → p1이 모달을 열고, p1이 모달 뒤에서 자기 행동을 수행하려면 모달 클릭 가능 영역 밖이어야 한다.
    //   가장 단순한 검증: 모달이 열린 상태에서 force click으로 #btn-play를 누르고, 카드를 선택한다.
    //   STATE 수신 후 모달의 합계가 45 → 44로 자동 갱신되어야 한다.

    // 모달은 풀스크린 백드롭이라 일반 클릭(좌표 기반)은 막힌다.
    // 본 테스트의 핵심은 "모달이 열린 채로 STATE가 도착하면 자동 재렌더"이므로,
    // 행동 트리거는 DOM의 .click()을 직접 호출하여 이벤트 핸들러를 발화시킨다.
    await p1.evaluate(() => {
      document.getElementById('btn-play').click();
    });
    // play 모드 진입 대기.
    await p1.waitForFunction(() => {
      return document.querySelector('#my-hand.selectable') !== null;
    }, null, { timeout: 5000 });
    // 첫 카드 클릭 (DOM 직접 호출).
    await p1.evaluate(() => {
      const card = document.querySelector('#my-hand .card');
      if (card) card.click();
    });

    // STATE 수신 + 자동 재렌더 대기.
    await p1.waitForFunction(() => {
      const el = document.getElementById('counter-hidden-total');
      return el && parseInt(el.textContent, 10) === 44;
    }, null, { timeout: 5000 });

    // 모달은 여전히 열려 있어야 한다.
    await expect(p1.locator('#counter-modal')).not.toHaveClass(/hidden/);
    const totalAfter = parseInt(await p1.locator('#counter-hidden-total').textContent(), 10);
    expect(totalAfter).toBe(44); // 카드 1장 공개됨 → 안 보이는 합계 -1.

    expect(errs).toEqual([]);
    void p2; // p2는 단순히 게임 입장만 담당.
  } finally {
    await ctx1.close(); await ctx2.close();
  }
});

test('HR-C12-009 [회귀] 카운터 계산은 myHand 색/숫자를 누설하지 않는다 (정보 공정성)', async ({ browser }) => {
  const { ctx1, ctx2, p1, errs } = await joinTwo(browser);
  try {
    // 본 회귀 게이트는 HR-C6-001 / HR-C7-001과 동일 정신:
    // 카운터 계산이 본인 손패 영역의 색·숫자를 표시하거나 셀 카운트에 차감해서는 안 된다.
    //
    // 검증 방식:
    //  1) STATE의 myHand는 색/숫자가 null임을 클라이언트가 받아본다는 사실은 HR-C6/C7이 보증한다.
    //  2) 여기서는 카운터 합계가 정확히 "50 - (opponentHand + fireworks + discardPile)"인지를 확인 →
    //     myHand가 차감되지 않았음을 간접 입증한다.
    //  3) 추가로 #my-hand의 모든 카드가 hidden 렌더(card--hidden 클래스, ? 마크)인지도 함께 확인 → 누설 0.

    // 모달 열기.
    await p1.click('#btn-open-counter');
    await expect(p1.locator('#counter-modal')).not.toHaveClass(/hidden/);

    // (1) myHand 5장은 모두 card--hidden + .card-back-mark 만 가져야 한다.
    const myHandHidden = await p1.evaluate(() => {
      const cards = document.querySelectorAll('#my-hand .card');
      for (const el of cards) {
        if (!el.classList.contains('card--hidden')) return false;
        // 색 클래스가 붙으면 누설.
        if (/card--(white|red|blue|green|yellow)/.test(el.className)) return false;
        // 숫자 표시가 있으면 누설.
        if (el.querySelector('.card-number')) return false;
      }
      return cards.length === 5;
    });
    expect(myHandHidden).toBe(true);

    // (2) DOM 기반 보이는 카운트 = 50 - 카운터 합계.
    const { totalVisible } = await collectVisibleFromDom(p1);
    const total = parseInt(await p1.locator('#counter-hidden-total').textContent(), 10);
    expect(total).toBe(DECK_TOTAL - totalVisible);
    // 즉 myHand(5)는 차감되지 않았다 → total = 50 - 5(opp) - 0(fw) - 0(dis) = 45.
    expect(totalVisible).toBe(5);
    expect(total).toBe(45);

    expect(errs).toEqual([]);
  } finally {
    await ctx1.close(); await ctx2.close();
  }
});
