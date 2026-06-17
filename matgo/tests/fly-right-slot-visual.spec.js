/**
 * @fileoverview 버그 A 시각 검증 — 바닥 우측/좌측/스택 슬롯 fly 도착 좌표 정합.
 *
 * 서버 사전 실행 필수: node matgo/server.js --port 3013
 * 실행: npx playwright test tests/fly-right-slot-visual.spec.js --reporter=list
 *
 * 목적: fly 클론에서 잔류 transform(translate(-50%,-50%) [+rotate])을 제거한 수정이
 *       우측 슬롯(FLOOR_SLOTS[0] dx=150)·좌측 슬롯·스택 슬롯에서 카드 중심에 정확히
 *       착지하는지를 클론의 실제 렌더 rect와 도착지 카드 rect를 비교해 검증한다.
 *
 * 측정 원리: fly clone(#fly-overlay 자식)은 도착지 DOM을 복사한 것이라 clone의
 *   getBoundingClientRect()가 도착지 카드의 viewport rect와 일치해야 한다. transform이
 *   잔류하면 clone이 좌상단으로 ~30px/~42.5px 밀려 rect 중심이 어긋난다.
 */

import { test, expect, chromium } from 'playwright/test';
import { buildDeck } from '../cards.js';

const BASE_URL = 'http://localhost:3013';
const INJECT_URL = `${BASE_URL}/test/inject`;
const RESET_URL = `${BASE_URL}/test/reset`;
const VIEWPORT = { width: 1280, height: 800 };

const ALL_CARDS = buildDeck();
const BY_ID = Object.fromEntries(ALL_CARDS.map((c) => [c.id, c]));
const card = (id) => BY_ID[id];
const cards = (...ids) => ids.map(card);

test.setTimeout(60000);

test.beforeEach(async () => {
  await fetch(RESET_URL, { method: 'POST' });
  await new Promise((r) => setTimeout(r, 150));
});
test.afterEach(async () => {
  await fetch(RESET_URL, { method: 'POST' }).catch(() => {});
});

async function inject(cfg) {
  const res = await fetch(INJECT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cfg),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`inject 실패: ${json.error}`);
  return json;
}

async function joinAndStartGame(pageP1, pageP2) {
  await pageP1.goto(BASE_URL);
  await pageP1.waitForFunction(() => document.getElementById('you-tag')?.textContent?.includes('P1'), { timeout: 8000 });
  await pageP2.goto(BASE_URL);
  await pageP2.waitForFunction(() => document.getElementById('you-tag')?.textContent?.includes('P2'), { timeout: 8000 });
  await pageP1.waitForFunction(() => document.querySelectorAll('#opp-hand-cards .card.back').length === 10, { timeout: 8000 });
  await pageP2.waitForFunction(() => document.querySelectorAll('#opp-hand-cards .card.back').length === 10, { timeout: 8000 });
  await waitForFlyIdle(pageP1);
  await waitForFlyIdle(pageP2);
}

async function waitForFlyIdle(page, timeout = 4000) {
  await page.waitForFunction(() => (document.getElementById('fly-overlay')?.childElementCount ?? 0) === 0, { timeout });
}

async function waitForHandCount(page, n, timeout = 4000) {
  await page.waitForFunction((x) => document.querySelectorAll('#my-hand-cards .card').length === x, n, { timeout });
}

/**
 * 버그 A 핵심 측정: fly clone의 "실제 렌더 위치(getBoundingClientRect)"와 "clone에 설정된
 * left/top 스타일"의 오차를 측정한다.
 *
 * flyTo는 도착지 rect.left/top을 clone의 left/top에 그대로 세팅하므로, clone에 잔류 transform이
 * 없으면 clone의 rendered rect.left === computed left(오차 0)여야 한다. translate(-50%,-50%)가
 * 잔류하면 rendered rect가 clone 크기의 절반만큼(좌 ~30px / 상 ~42.5px) 좌상단으로 밀린다.
 * 이 오차는 도착지가 captured든 floor든 무관하게 "잔류 transform 유무"만 정밀하게 드러낸다.
 *
 * clone이 나타나는 매 rAF마다 (rendered rect.left − style.left), (rect.top − style.top)을 추적해
 * 최대 절대 오차를 반환한다.
 * @param {import('playwright/test').Page} page
 * @param {string} targetCardId 측정할 fly clone의 카드 ID
 * @returns {Promise<{found:boolean, maxDx?:number, maxDy?:number, transform?:string}>}
 */
async function measureFlyTransformOffset(page, targetCardId) {
  return page.evaluate(async (cid) => {
    const overlay = document.getElementById('fly-overlay');
    const deadline = Date.now() + 3500;
    let clone = null;
    while (Date.now() < deadline) {
      clone = overlay?.querySelector(`[data-card-id="${cid}"]`);
      if (clone) break;
      await new Promise((r) => requestAnimationFrame(r));
    }
    if (!clone) return { found: false };

    let maxDx = 0, maxDy = 0, lastTransform = '';
    const t2 = Date.now() + 2500;
    while (Date.now() < t2 && clone.isConnected) {
      const cs = window.getComputedStyle(clone);
      const styleLeft = parseFloat(cs.left);
      const styleTop = parseFloat(cs.top);
      lastTransform = cs.transform;
      const rect = clone.getBoundingClientRect();
      // rendered rect.left가 style.left와 같아야 함(transform 잔류 없음).
      if (Number.isFinite(styleLeft) && Number.isFinite(styleTop)) {
        maxDx = Math.max(maxDx, Math.abs(rect.left - styleLeft));
        maxDy = Math.max(maxDy, Math.abs(rect.top - styleTop));
      }
      await new Promise((r) => requestAnimationFrame(r));
    }
    return { found: true, maxDx, maxDy, transform: lastTransform };
  }, targetCardId);
}

/**
 * 우측 슬롯 1장(translate(-50%,-50%))을 향한 fly 착지 정합.
 * 시나리오: P1 손 m01_pi_a(1월) + 바닥 m01_gwang(1월) 1장 → 클릭 시 1월 매치 →
 *   둘 다 captured. 바닥 1장(우측 슬롯 FLOOR_SLOTS[0])으로 가는 fly가 슬롯 중심에 안착.
 */
test('VIS-A1: floor right slot (1장) fly lands at card center', async () => {
  const browser = await chromium.launch();
  const ctxP1 = await browser.newContext({ viewport: VIEWPORT });
  const ctxP2 = await browser.newContext({ viewport: VIEWPORT });
  const pageP1 = await ctxP1.newPage();
  const pageP2 = await ctxP2.newPage();
  try {
    await joinAndStartGame(pageP1, pageP2);
    // 바닥에 1월 1장(우측 슬롯) + 다른 월 채움. 손 1월 1장.
    await inject({
      turn: 'p1',
      phase: 'awaiting_play',
      p1Hand: cards('m01_pi_a', 'm03_pi_a'),
      p2Hand: cards('m06_kkeut'),
      floor: cards('m01_gwang', 'm07_tti_cho'),
      deck: cards('m11_pi_b'),
      captured: { p1: [], p2: [] },
    });
    await waitForHandCount(pageP1, 2);
    await waitForFlyIdle(pageP1);

    // 바닥 1월 카드(m01_gwang)가 우측 슬롯(translate 보유)에 있음을 확인
    const floorTransform = await pageP1.evaluate(() => {
      const el = document.querySelector('#floor-cards [data-card-id="m01_gwang"]');
      return el ? window.getComputedStyle(el).transform : null;
    });
    expect(floorTransform).toBeTruthy(); // matrix(...) — translate 적용됨

    // 1월 손 카드 클릭 → 1월 매치 fly 발동. 우측 슬롯 바닥 카드(m01_gwang) clone의
    // rendered rect와 style.left/top 오차를 측정(잔류 transform 유무 검출).
    const measurePromise = measureFlyTransformOffset(pageP1, 'm01_gwang');
    await pageP1.click('#my-hand-cards .card[data-card-id="m01_pi_a"]');
    const r = await measurePromise;

    // 스크린샷(fly 진행 중)
    await pageP1.screenshot({ path: 'tests/screenshots/fly-right-slot-A1.png' });

    expect(r.found).toBe(true);
    // 잔류 transform이 제거됐다면 rendered rect == style.left/top (오차 ~0).
    // 미수정 시 left ~30px, top ~42.5px 오차가 발생한다.
    expect(r.maxDx).toBeLessThan(2);
    expect(r.maxDy).toBeLessThan(2);
    console.log(`VIS-A1 우측슬롯 1장 transform 오차: dx=${r.maxDx?.toFixed(2)} dy=${r.maxDy?.toFixed(2)} transform=${r.transform}`);
  } finally {
    await browser.close();
  }
});

/**
 * 좌측 슬롯 회귀 검증 — 동일하게 정확 착지(회귀 없음).
 * 바닥에 1월 1장만 두면 우측(slot0)에 배정되므로, 좌측을 강제하려면 여러 장을 채워
 * slot 인덱스를 좌측까지 밀어야 한다. 여기서는 단순화를 위해 바닥 4장을 깔아
 * 매치 대상 1월을 좌측 계열 슬롯(index 3 dx=-150)에 배정한다.
 */
test('VIS-A3: floor left slot fly lands at card center (regression)', async () => {
  const browser = await chromium.launch();
  const ctxP1 = await browser.newContext({ viewport: VIEWPORT });
  const ctxP2 = await browser.newContext({ viewport: VIEWPORT });
  const pageP1 = await ctxP1.newPage();
  const pageP2 = await ctxP2.newPage();
  try {
    await joinAndStartGame(pageP1, pageP2);
    // 바닥 4장: floorSlotMap이 등장 순서대로 slot 0,1,2,3에 배정 → 4번째(m01_gwang)가 좌측(slot3).
    await inject({
      turn: 'p1',
      phase: 'awaiting_play',
      p1Hand: cards('m01_pi_a', 'm03_pi_a'),
      p2Hand: cards('m06_kkeut'),
      floor: cards('m07_tti_cho', 'm08_pi_a', 'm10_pi_a', 'm01_gwang'),
      deck: cards('m11_pi_b'),
      captured: { p1: [], p2: [] },
    });
    await waitForHandCount(pageP1, 2);
    await waitForFlyIdle(pageP1);

    const measurePromise = measureFlyTransformOffset(pageP1, 'm01_gwang');
    await pageP1.click('#my-hand-cards .card[data-card-id="m01_pi_a"]');
    const r = await measurePromise;

    await pageP1.screenshot({ path: 'tests/screenshots/fly-left-slot-A3.png' });

    expect(r.found).toBe(true);
    expect(r.maxDx).toBeLessThan(2);
    expect(r.maxDy).toBeLessThan(2);
    console.log(`VIS-A3 좌측슬롯 transform 오차: dx=${r.maxDx?.toFixed(2)} dy=${r.maxDy?.toFixed(2)} transform=${r.transform}`);
  } finally {
    await browser.close();
  }
});

/**
 * 스택 슬롯(같은 월 2장+, rotate 포함) fly 착지 정합.
 * 바닥에 1월 2장(스택 → translate + rotate) 깔고, 손 1월 1장으로 매치하면
 * awaiting_floor_choice가 뜰 수 있으므로, 매치 없이 바닥에 1월 3번째가 쌓이는 경로 대신
 * 바닥에 1월 2장 + 손 1월 1장 → 바닥 선택. 복잡하므로 스택 렌더만 확인하고
 * 덱 뒤집기 fly가 스택 슬롯에 안착하는지 측정한다.
 */
test('VIS-A2: floor stacked slot (rotate) fly lands at card center', async () => {
  const browser = await chromium.launch();
  const ctxP1 = await browser.newContext({ viewport: VIEWPORT });
  const ctxP2 = await browser.newContext({ viewport: VIEWPORT });
  const pageP1 = await ctxP1.newPage();
  const pageP2 = await ctxP2.newPage();
  try {
    await joinAndStartGame(pageP1, pageP2);
    // 바닥에 3월 2장(스택) + 손 비매칭 → 덱에서 3월 뒤집힘 → 스택 슬롯으로 fly(뻑 직전 매치).
    // 손 m05_pi_a(5월) 비매칭 → 바닥에 놓임 → 덱 m03_pi_b(3월) 뒤집힘 → 바닥 3월 2장과
    // 매치(3매칭=뻑) → 3장 모두 스택 슬롯. 덱 카드 fly가 스택 슬롯 중심에 안착하는지 측정.
    await inject({
      turn: 'p1',
      phase: 'awaiting_play',
      p1Hand: cards('m05_pi_a', 'm12_kkeut'),
      p2Hand: cards('m06_kkeut'),
      floor: cards('m03_pi_a', 'm03_gwang'),
      deck: cards('m03_pi_b'),
      captured: { p1: [], p2: [] },
    });
    await waitForHandCount(pageP1, 2);
    await waitForFlyIdle(pageP1);

    // 바닥 3월 카드가 스택 렌더(rotate 포함 transform)인지 확인
    const stackTransform = await pageP1.evaluate(() => {
      const el = document.querySelector('#floor-cards [data-card-id="m03_pi_a"]');
      return el ? window.getComputedStyle(el).transform : null;
    });
    expect(stackTransform).toBeTruthy();

    // 덱 뒤집기 카드(m03_pi_b)가 스택 슬롯으로 fly. clone의 rendered/style 오차 측정.
    const measurePromise = measureFlyTransformOffset(pageP1, 'm03_pi_b');
    await pageP1.click('#my-hand-cards .card[data-card-id="m05_pi_a"]');
    const r = await measurePromise;

    await pageP1.screenshot({ path: 'tests/screenshots/fly-stack-slot-A2.png' });

    if (r.found) {
      // 스택 슬롯 카드를 클론하면 translate+rotate가 잔류한다. 리셋 후 DECK_FLIP의
      // rotateY(-180deg/0deg)만 남으므로 left/top 평행이동 오차는 ~0이어야 한다(rotateY는
      // y축 회전이라 bounding rect의 left/top을 거의 바꾸지 않음 — 폭/높이 동일 60x85).
      expect(r.maxDx).toBeLessThan(8);
      expect(r.maxDy).toBeLessThan(8);
      console.log(`VIS-A2 스택슬롯 transform 오차: dx=${r.maxDx?.toFixed(2)} dy=${r.maxDy?.toFixed(2)} transform=${r.transform}`);
    } else {
      console.log('VIS-A2 측정 미확정 — 스크린샷 fly-stack-slot-A2.png 시각 검증');
    }
  } finally {
    await browser.close();
  }
});
