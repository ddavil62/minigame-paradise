/**
 * @fileoverview 리포트 #54~#59 Phase C — Art Director 모드3 UI 검수용 측정 스펙.
 *
 * Phase C 변경분('따닥!' 토스트 신규, '쪽!' 토스트 타이밍, choice srcCard fly 중복 제거)의
 * 시각 정합을 육안 추정이 아닌 수치로 계측한다.
 *
 * - AD-C-01: '따닥!' 토스트 geometry / 타이포 / 색상 (3 viewport)
 * - AD-C-02: '쪽!' 토스트 geometry / 타이포 / 색상 (3 viewport)
 * - AD-C-03: 따닥 / 쪽 / 쓸 토스트가 동일 요소·동일 스타일 계열인지
 * - AD-C-04: 토스트가 바닥·상대 손·고스톱 오버레이를 가리지 않는지 (겹침 px²)
 * - AD-C-05: fly 순서 — 손 출발 fly 1회 + 덱 fly 순서
 * - AD-C-06: Phase A/B CSS 회귀 (opp-hand-zone / .big-go:disabled)
 *
 * 계측 결과는 `tests/screenshots/ad-phaseC-results.json`에 누적 저장한다.
 * 서버 사전 실행 필수: node matgo/server.js --port 3013
 */

import { test, expect, chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildDeck } from '../cards.js';

const BASE_URL = process.env.MATGO_BASE_URL || 'http://localhost:3013';
const BY_ID = Object.fromEntries(buildDeck().map((card) => [card.id, card]));
const SHOT_DIR = fileURLToPath(new URL('./screenshots/', import.meta.url));

/** 검수 해상도 3종 */
const VIEWPORTS = [
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '1366x768', width: 1366, height: 768 },
  { name: '1280x720', width: 1280, height: 720 },
];

/** 계측 결과 누적 버퍼 */
const results = {};

test.describe.configure({ mode: 'serial' });

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
 * 두 플레이어 매치를 지정 viewport로 연다.
 * @param {{width:number, height:number}} viewport
 * @returns {Promise<{browser:object, p1:object, p2:object}>}
 */
async function openMatch(viewport) {
  await fetch(`${BASE_URL}/test/reset`, { method: 'POST' });
  await new Promise((resolve) => setTimeout(resolve, 200));
  const browser = await chromium.launch();
  const p1 = await (await browser.newContext({ viewport })).newPage();
  const p2 = await (await browser.newContext({ viewport })).newPage();
  await p1.goto(`${BASE_URL}/?name=ADC-P1`);
  await p2.goto(`${BASE_URL}/?name=ADC-P2`);
  await p1.waitForSelector('#my-hand-cards .card', { timeout: 15000 });
  await p2.waitForSelector('#my-hand-cards .card', { timeout: 15000 });
  return { browser, p1, p2 };
}

/** fly 오버레이가 빌 때까지 대기 */
async function waitFlyIdle(page) {
  await page.waitForFunction(
    () => (document.getElementById('fly-overlay')?.childElementCount ?? 0) === 0,
    { timeout: 10000 },
  );
}

/**
 * 현재 표시 중인 액션 토스트의 geometry·타이포·색상을 계측한다.
 * @param {object} page
 * @returns {Promise<object>}
 */
function measureToast(page) {
  return page.evaluate(() => {
    const toast = document.querySelector('.action-toast.show');
    if (!toast) return null;
    const r = toast.getBoundingClientRect();
    const cs = getComputedStyle(toast);
    /** 두 사각형의 겹침 면적(px²) */
    const overlapArea = (a, b) => {
      if (!a || !b) return 0;
      const w = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
      const h = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      return Math.round(w * h);
    };
    const rectOf = (sel) => {
      const el = document.querySelector(sel);
      return el ? el.getBoundingClientRect() : null;
    };
    return {
      text: toast.textContent.trim(),
      rect: {
        left: +r.left.toFixed(2), top: +r.top.toFixed(2),
        width: +r.width.toFixed(2), height: +r.height.toFixed(2),
        centerX: +(r.left + r.width / 2).toFixed(2),
        centerY: +(r.top + r.height / 2).toFixed(2),
      },
      viewport: { w: window.innerWidth, h: window.innerHeight },
      // 뷰포트 중앙 대비 편차 — 좌우 대칭 배치 여부 판정용
      centerOffsetX: +((r.left + r.width / 2) - window.innerWidth / 2).toFixed(2),
      style: {
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        fontFamily: cs.fontFamily.split(',')[0].trim(),
        color: cs.color,
        background: cs.backgroundColor,
        borderRadius: cs.borderRadius,
        padding: cs.padding,
        zIndex: cs.zIndex,
        opacity: cs.opacity,
        textShadow: cs.textShadow,
      },
      // 가림 검사: 토스트가 주요 존을 덮는 면적
      overlap: {
        floorZone: overlapArea(r, rectOf('.floor-zone')),
        oppHandZone: overlapArea(r, rectOf('.opp-hand-zone')),
        myHandZone: overlapArea(r, rectOf('.my-hand-zone')),
        goStopOverlay: overlapArea(r, rectOf('#go-stop-overlay:not(.hidden)')),
      },
      // 동시 표시 토스트 개수 (중복 표시 검출)
      shownCount: document.querySelectorAll('.action-toast.show').length,
    };
  });
}

/** 따닥 시나리오 주입 상태 */
const TTADAK_STATE = {
  turn: 'p1',
  phase: 'awaiting_play',
  p1Hand: [BY_ID.m01_gwang, BY_ID.m07_pi_a],
  p2Hand: [BY_ID.m08_pi_a],
  floor: [BY_ID.m01_tti_hong, BY_ID.m01_pi_a],
  deck: [BY_ID.m01_pi_b],
  captured: { p1: [], p2: [BY_ID.m06_pi_a] },
};

/** 쪽 시나리오 주입 상태 */
const JJOK_STATE = {
  turn: 'p1',
  phase: 'awaiting_play',
  p1Hand: [BY_ID.m05_kkeut, BY_ID.m01_pi_a],
  p2Hand: [BY_ID.m06_kkeut],
  floor: [BY_ID.m07_tti_cho],
  deck: [BY_ID.m05_pi_a],
  captured: { p1: [], p2: [BY_ID.m07_pi_a] },
};

// ── AD-C-01: '따닥!' 토스트 계측 ────────────────────────────────────
for (const vp of VIEWPORTS) {
  test(`[AD-C-01] 따닥! 토스트 geometry/타이포/색상 @ ${vp.name}`, async () => {
    const { browser, p1 } = await openMatch(vp);
    try {
      await inject(TTADAK_STATE);
      await waitFlyIdle(p1);
      await p1.evaluate(() => document.querySelector('.action-toast')?.classList.remove('show'));

      await p1.click('#my-hand-cards [data-card-id="m01_gwang"]');
      await p1.waitForSelector('#floor-choice-modal:not(.hidden)', { timeout: 8000 });
      await p1.click('#floor-choice-cards [data-card-id="m01_tti_hong"]');

      await p1.waitForFunction(
        () => document.querySelector('.action-toast.show')?.textContent.includes('따닥'),
        { timeout: 15000 },
      );
      // action-toast-show(1.2s)의 30~78% 구간이 scale(1)/opacity(1) 평탄부다.
      // 등장 직후(0% 키프레임, scale 0.5·opacity 0)에서 재면 실제 표시 크기를 놓치므로
      // 평탄부에 진입한 뒤 계측한다.
      await p1.waitForTimeout(420);

      const m = await measureToast(p1);
      results[`ttadak@${vp.name}`] = m;
      console.log(`[AD-C-01 ${vp.name}]`, JSON.stringify(m));

      await p1.screenshot({ path: `${SHOT_DIR}ad-phaseC-ttadak-${vp.name}.png` });

      expect(m).not.toBeNull();
      expect(m.text).toContain('따닥!');
      // 중복 표시 없음
      expect(m.shownCount).toBe(1);
      // 뷰포트 안에 완전히 들어와야 한다
      expect(m.rect.left).toBeGreaterThanOrEqual(0);
      expect(m.rect.top).toBeGreaterThanOrEqual(0);
      expect(m.rect.left + m.rect.width).toBeLessThanOrEqual(m.viewport.w);
      expect(m.rect.top + m.rect.height).toBeLessThanOrEqual(m.viewport.h);
      // 좌우 중앙 정렬(오차 2px 이내)
      expect(Math.abs(m.centerOffsetX)).toBeLessThanOrEqual(2);
    } finally {
      await browser.close();
    }
  });
}

// ── AD-C-02: '쪽!' 토스트 계측 ──────────────────────────────────────
for (const vp of VIEWPORTS) {
  test(`[AD-C-02] 쪽! 토스트 geometry/타이포/색상 @ ${vp.name}`, async () => {
    const { browser, p1 } = await openMatch(vp);
    try {
      await inject(JJOK_STATE);
      await waitFlyIdle(p1);
      await p1.evaluate(() => document.querySelector('.action-toast')?.classList.remove('show'));

      await p1.click('#my-hand-cards [data-card-id="m05_kkeut"]');

      await p1.waitForFunction(
        () => document.querySelector('.action-toast.show')?.textContent.includes('쪽'),
        { timeout: 15000 },
      );
      // AD-C-01과 동일 이유로 애니메이션 평탄부에서 계측한다.
      await p1.waitForTimeout(420);

      const m = await measureToast(p1);
      results[`jjok@${vp.name}`] = m;
      console.log(`[AD-C-02 ${vp.name}]`, JSON.stringify(m));

      await p1.screenshot({ path: `${SHOT_DIR}ad-phaseC-jjok-${vp.name}.png` });

      expect(m).not.toBeNull();
      expect(m.text).toContain('쪽');
      expect(m.shownCount).toBe(1);
      expect(m.rect.left).toBeGreaterThanOrEqual(0);
      expect(m.rect.top).toBeGreaterThanOrEqual(0);
      expect(m.rect.left + m.rect.width).toBeLessThanOrEqual(m.viewport.w);
      expect(m.rect.top + m.rect.height).toBeLessThanOrEqual(m.viewport.h);
      expect(Math.abs(m.centerOffsetX)).toBeLessThanOrEqual(2);
    } finally {
      await browser.close();
    }
  });
}

// ── AD-C-03: 따닥/쪽 스타일 동일 계열 판정 ──────────────────────────
test('[AD-C-03] 따닥!/쪽! 토스트가 동일 요소·동일 스타일 계열이다', () => {
  for (const vp of VIEWPORTS) {
    const t = results[`ttadak@${vp.name}`];
    const j = results[`jjok@${vp.name}`];
    expect(t, `따닥 계측 누락 @${vp.name}`).toBeTruthy();
    expect(j, `쪽 계측 누락 @${vp.name}`).toBeTruthy();

    // 신규 텍스트가 기존 토스트와 다른 스타일로 튀지 않아야 한다.
    for (const key of ['fontSize', 'fontWeight', 'fontFamily', 'color', 'background',
      'borderRadius', 'padding', 'zIndex', 'textShadow']) {
      expect(t.style[key], `${key} 불일치 @${vp.name}`).toBe(j.style[key]);
    }
    // 세로 위치도 동일해야 한다 (같은 오버레이 슬롯).
    expect(Math.abs(t.rect.centerY - j.rect.centerY), `centerY 불일치 @${vp.name}`)
      .toBeLessThanOrEqual(1);
  }
});

// ── AD-C-04: 토스트 가림 검사 ───────────────────────────────────────
test('[AD-C-04] 토스트가 고/스톱 오버레이와 상대 손 영역을 가리지 않는다', () => {
  for (const vp of VIEWPORTS) {
    for (const kind of ['ttadak', 'jjok']) {
      const m = results[`${kind}@${vp.name}`];
      expect(m, `${kind} 계측 누락 @${vp.name}`).toBeTruthy();
      // 고/스톱 오버레이와 동시 표시되지 않아야 한다(hasBlockingDecision 가드).
      expect(m.overlap.goStopOverlay, `${kind} × goStopOverlay 겹침 @${vp.name}`).toBe(0);
      // 상대 손 영역을 덮지 않아야 한다.
      expect(m.overlap.oppHandZone, `${kind} × oppHandZone 겹침 @${vp.name}`).toBe(0);
      // 내 손 영역을 덮지 않아야 한다.
      expect(m.overlap.myHandZone, `${kind} × myHandZone 겹침 @${vp.name}`).toBe(0);
    }
  }
});

// ── AD-C-05: fly 순서 계측 ──────────────────────────────────────────
test('[AD-C-05] fly 순서 — 손 출발 1회 후 덱 fly', async () => {
  const vp = VIEWPORTS[0];
  const { browser, p1 } = await openMatch(vp);
  try {
    await inject(TTADAK_STATE);
    await waitFlyIdle(p1);
    await p1.evaluate(() => { window.__matgoFlies = []; });

    await p1.click('#my-hand-cards [data-card-id="m01_gwang"]');
    await p1.waitForSelector('#floor-choice-modal:not(.hidden)', { timeout: 8000 });
    await p1.click('#floor-choice-cards [data-card-id="m01_tti_hong"]');
    await waitFlyIdle(p1);

    const flies = await p1.evaluate(() => window.__matgoFlies.slice());
    const seq = flies.map((f) => `${f.cardId}:${f.origin}`);
    results.flySequence = seq;
    console.log('[AD-C-05] fly 시퀀스:', seq.join(' -> '));

    // 손 출발 fly는 1회만 (#54)
    const handFlies = flies.filter((f) => f.cardId === 'm01_gwang' && f.origin === 'hand');
    expect(handFlies.length).toBe(1);
    // 덱 fly는 손 fly 이후에 등록돼야 한다 (연출 순서 정합)
    const handIdx = flies.findIndex((f) => f.origin === 'hand');
    const deckIdx = flies.findIndex((f) => f.origin === 'deck');
    expect(handIdx).toBeGreaterThanOrEqual(0);
    expect(deckIdx).toBeGreaterThan(handIdx);
  } finally {
    await browser.close();
  }
});

// ── AD-C-06: Phase A/B CSS 회귀 ─────────────────────────────────────
test('[AD-C-06] Phase A/B CSS 회귀 — opp-hand-zone / big-go:disabled 유지', async () => {
  const vp = VIEWPORTS[0];
  const { browser, p1 } = await openMatch(vp);
  try {
    const css = await p1.evaluate(() => {
      const zone = document.querySelector('.opp-hand-zone');
      const cards = document.querySelector('.opp-hand-zone .hand-cards');
      const btnGo = document.getElementById('btn-go');
      const prev = btnGo?.disabled;
      if (btnGo) btnGo.disabled = true;
      const goStyle = btnGo ? getComputedStyle(btnGo) : null;
      const out = {
        oppZoneOverflow: zone ? getComputedStyle(zone).overflowY : null,
        oppCardsOverflow: cards ? getComputedStyle(cards).overflowY : null,
        oppCardsMinHeight: cards ? getComputedStyle(cards).minHeight : null,
        bigGoDisabledOpacity: goStyle ? goStyle.opacity : null,
        bigGoDisabledCursor: goStyle ? goStyle.cursor : null,
        bigGoDisabledFilter: goStyle ? goStyle.filter : null,
      };
      if (btnGo) btnGo.disabled = prev;
      return out;
    });
    results.phaseABCss = css;
    console.log('[AD-C-06] Phase A/B CSS:', JSON.stringify(css));

    expect(css.oppZoneOverflow).toBe('visible');
    expect(css.oppCardsOverflow).toBe('visible');
    expect(css.oppCardsMinHeight).toBe('176px');
    expect(css.bigGoDisabledOpacity).toBe('0.4');
  } finally {
    await browser.close();
  }
});

// ── 계측 결과 저장 ──────────────────────────────────────────────────
test.afterAll(() => {
  writeFileSync(`${SHOT_DIR}ad-phaseC-results.json`, JSON.stringify(results, null, 2), 'utf8');
});
