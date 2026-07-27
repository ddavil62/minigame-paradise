/**
 * @fileoverview 리포트 33·34 카드 연출 순서를 실제 Chromium에서 검증한다.
 */

import { test, expect, chromium } from '@playwright/test';
import { buildDeck } from '../cards.js';

const BASE_URL = 'http://localhost:3013';
const BY_ID = Object.fromEntries(buildDeck().map((card) => [card.id, card]));

/**
 * 테스트 서버의 방을 초기화한다.
 *
 * @returns {Promise<void>}
 */
async function resetServer() {
  const response = await fetch(`${BASE_URL}/test/reset`, { method: 'POST' });
  if (!response.ok) throw new Error(`테스트 서버 초기화 실패: ${response.status}`);
}

/**
 * 권위 게임 상태를 결정적으로 주입한다.
 *
 * @param {object} state
 * @returns {Promise<void>}
 */
async function inject(state) {
  const response = await fetch(`${BASE_URL}/test/inject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state),
  });
  const result = await response.json();
  if (!result.ok) throw new Error(result.error);
}

/**
 * 두 플레이어가 준비된 브라우저 대전을 연다.
 *
 * @returns {Promise<{browser:import('@playwright/test').Browser,p1:import('@playwright/test').Page}>}
 */
async function openMatch() {
  await resetServer();
  const browser = await chromium.launch();
  const first = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const second = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const p1 = await first.newPage();
  const p2 = await second.newPage();
  await p1.addInitScript(() => {
    window.__matgoTimelineEvents = [];
    window.__matgoFlies = [];
  });
  await p1.goto(`${BASE_URL}/?name=타임라인P1`);
  await p2.goto(`${BASE_URL}/?name=타임라인P2`);
  await p1.waitForSelector('#my-hand-cards .card', { timeout: 10000 });
  return { browser, p1 };
}

test('#33 Chromium: 조커 스테이징 뒤 추가 뒤집기, 마지막에 여섯 장 동시 정산', async () => {
  const { browser, p1 } = await openMatch();
  try {
    await inject({
      turn: 'p1',
      phase: 'awaiting_play',
      p1Hand: [BY_ID.m01_gwang, BY_ID.m07_pi_a],
      p2Hand: [BY_ID.m08_pi_a],
      floor: [BY_ID.m01_tti_hong, BY_ID.m02_tti_hong],
      deck: [BY_ID.m02_kkeut_godori, BY_ID.m00_joker_a],
      captured: { p1: [], p2: [BY_ID.m06_pi_a] },
    });
    await p1.waitForFunction(
      () => document.querySelectorAll('#fly-overlay .flying-card').length === 0,
      { timeout: 10000 },
    );
    await p1.evaluate(() => {
      window.__matgoTimelineEvents = [];
      window.__matgoFlies = [];
    });

    await p1.click('#my-hand-cards [data-card-id="m01_gwang"]');
    await p1.waitForFunction(
      () => window.__matgoTimelineEvents?.some((event) => event.name === 'RESOLVE'),
      { timeout: 12000 },
    );
    const events = await p1.evaluate(() => window.__matgoTimelineEvents);
    const names = events.map((event) => event.name);
    const ordered = ['HAND_THROW', 'HAND_LAND', 'JOKER_FLIP', 'JOKER_STAGE', 'DECK_FLIP', 'DECK_THROW', 'DECK_LAND', 'RESOLVE'];
    expect(ordered.map((name) => names.indexOf(name))).toEqual(
      [...ordered.map((name) => names.indexOf(name))].sort((a, b) => a - b),
    );

    const jokerStage = events.find((event) => event.name === 'JOKER_STAGE');
    expect(jokerStage.activeCardIds).toEqual(['m00_joker_a']);
    const deckThrow = events.find((event) => event.name === 'DECK_THROW');
    expect(deckThrow.activeCardIds).toContain('m02_kkeut_godori');
    expect(deckThrow.activeCardIds).not.toContain('m00_joker_a');
    const resolve = events.find((event) => event.name === 'RESOLVE');
    expect(resolve.activeCardIds.sort()).toEqual([
      'm00_joker_a',
      'm01_gwang',
      'm01_tti_hong',
      'm02_kkeut_godori',
      'm02_tti_hong',
      'm06_pi_a',
    ].sort());
    expect(resolve.batchIds).toHaveLength(1);
  } finally {
    await browser.close();
  }
});

test('#34 Chromium: 따닥 강탈 피는 네 장보다 먼저 움직이지 않고 RESOLVE에서 합류한다', async () => {
  const { browser, p1 } = await openMatch();
  try {
    await inject({
      turn: 'p1',
      phase: 'awaiting_play',
      p1Hand: [BY_ID.m01_gwang, BY_ID.m07_pi_a],
      p2Hand: [BY_ID.m08_pi_a],
      floor: [BY_ID.m01_tti_hong, BY_ID.m01_pi_a],
      deck: [BY_ID.m01_pi_b],
      captured: { p1: [], p2: [BY_ID.m06_pi_a] },
    });
    await p1.waitForFunction(
      () => document.querySelectorAll('#fly-overlay .flying-card').length === 0,
      { timeout: 10000 },
    );
    await p1.evaluate(() => { window.__matgoTimelineEvents = []; });

    await p1.click('#my-hand-cards [data-card-id="m01_gwang"]');
    await p1.waitForSelector('#floor-choice-modal:not(.hidden)', { timeout: 8000 });
    await p1.click('#floor-choice-cards [data-card-id="m01_tti_hong"]');
    await p1.waitForFunction(
      () => window.__matgoTimelineEvents?.some((event) => event.name === 'RESOLVE'),
      { timeout: 12000 },
    );

    const events = await p1.evaluate(() => window.__matgoTimelineEvents);
    const beforeResolve = events.filter((event) => event.name !== 'RESOLVE');
    expect(beforeResolve.every((event) => !event.activeCardIds.includes('m06_pi_a'))).toBe(true);
    const resolve = events.find((event) => event.name === 'RESOLVE');
    expect(resolve.activeCardIds.sort()).toEqual([
      'm01_gwang',
      'm01_pi_a',
      'm01_pi_b',
      'm01_tti_hong',
      'm06_pi_a',
    ].sort());
    expect(resolve.batchIds).toHaveLength(1);
  } finally {
    await browser.close();
  }
});
