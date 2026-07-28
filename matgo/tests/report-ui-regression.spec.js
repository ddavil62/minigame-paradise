/**
 * @fileoverview 맞고 강탈 출발점과 효과 레이어/시점 브라우저 회귀 테스트.
 */

import { test, expect, chromium } from '@playwright/test';
import { buildDeck } from '../cards.js';

const BASE_URL = process.env.MATGO_BASE_URL || 'http://localhost:3013';
const BY_ID = Object.fromEntries(buildDeck().map((card) => [card.id, card]));

/**
 * 테스트 서버 상태를 초기화한다.
 *
 * @returns {Promise<void>}
 */
async function resetServer() {
  const response = await fetch(`${BASE_URL}/test/reset`, { method: 'POST' });
  if (!response.ok) throw new Error(`테스트 서버 초기화 실패: ${response.status}`);
}

/**
 * 결정적 게임 상태를 주입한다.
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

test('R16/R24 UI: 강탈 카드는 실제 상대 피 위치에서 출발하고 효과는 fly 뒤 전면 표시', async () => {
  await resetServer();
  const browser = await chromium.launch();
  const first = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const second = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const p1 = await first.newPage();
  const p2 = await second.newPage();

  try {
    await p1.addInitScript(() => { window.__matgoFlies = []; });
    await p1.goto(`${BASE_URL}/?name=리포트P1`);
    await p2.goto(`${BASE_URL}/?name=리포트P2`);
    await p1.waitForSelector('#my-hand-cards .card', { timeout: 10000 });

    await inject({
      turn: 'p1',
      phase: 'awaiting_play',
      p1Hand: [BY_ID.m00_joker_a, BY_ID.m07_pi_a],
      p2Hand: [BY_ID.m06_kkeut],
      floor: [BY_ID.m08_pi_b],
      deck: [BY_ID.m11_pi_b],
      captured: { p1: [], p2: [BY_ID.m05_pi_a] },
    });

    const source = p1.locator('#opp-captured-zone [data-card-id="m05_pi_a"]');
    await expect(source).toBeVisible();
    const sourceBox = await source.boundingBox();
    expect(sourceBox).toBeTruthy();
    // 초기 랜덤 분배의 바닥 조커 fly/toast가 대상 조커 액션 계측에 섞이지 않게 한다.
    await p1.waitForFunction(
      () => document.querySelectorAll('#fly-overlay .flying-card').length === 0,
      { timeout: 10000 },
    );
    await p1.evaluate(() => {
      window.__matgoFlies = [];
      document.querySelector('.action-toast')?.classList.remove('show');
    });

    await p1.click('#my-hand-cards [data-card-id="m00_joker_a"]');
    await p1.waitForFunction(
      () => window.__matgoFlies?.some((fly) => fly.cardId === 'm05_pi_a'),
      { timeout: 8000 },
    );
    const stolen = await p1.evaluate(
      () => window.__matgoFlies.find((fly) => fly.cardId === 'm05_pi_a'),
    );
    expect(stolen.origin).toBe('opp-captured');
    expect(Math.abs(stolen.startLeft - sourceBox.x)).toBeLessThan(2);
    expect(Math.abs(stolen.startTop - sourceBox.y)).toBeLessThan(2);

    // 카드가 이동 중인 동안에는 효과 문구를 먼저 띄우지 않는다.
    await expect(p1.locator('#fly-overlay .flying-card').first()).toBeVisible();
    await expect(p1.locator('.action-toast.show')).toHaveCount(0);

    await p1.waitForFunction(
      () => document.querySelectorAll('#fly-overlay .flying-card').length === 0,
      { timeout: 8000 },
    );
    const toast = p1.locator('.action-toast');
    await expect(toast).toHaveClass(/show/);
    expect(await toast.evaluate((element) => getComputedStyle(element).zIndex)).toBe('10001');

    // 필수 규칙 선택 UI가 열리면 남아 있던 효과를 닫아 제목과 버튼 hit-test를 보장한다.
    await inject({
      turn: 'p1',
      phase: 'awaiting_kkeut_choice',
      pendingKkeutChoice: { player: 'p1' },
      p1Hand: [BY_ID.m05_kkeut],
      p2Hand: [BY_ID.m06_kkeut],
      floor: [],
      deck: [],
    });
    const kkeutModal = p1.locator('#kkeut-modal');
    await expect(kkeutModal).not.toHaveClass(/hidden/);
    await expect(p1.locator('.action-toast.show')).toHaveCount(0);
    for (const selector of ['#btn-kkeut-choice-kkeut', '#btn-kkeut-choice-ssangpi']) {
      const button = p1.locator(selector);
      await expect(button).toBeVisible();
      expect(await button.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        return hit === element || element.contains(hit);
      })).toBe(true);
    }

    // 고/스톱 진입 직전 효과가 다시 남아 있어도 두 결정 버튼을 가리지 않는다.
    await toast.evaluate((element) => element.classList.add('show'));
    await inject({
      turn: 'p1',
      phase: 'awaiting_go_stop',
      p1Hand: [BY_ID.m05_kkeut, BY_ID.m06_kkeut],
      p2Hand: [BY_ID.m07_kkeut],
      floor: [],
      deck: [],
    });
    await expect(p1.locator('#go-stop-overlay')).not.toHaveClass(/hidden/);
    await expect(p1.locator('.action-toast.show')).toHaveCount(0);
    for (const selector of ['#btn-go', '#btn-stop']) {
      const button = p1.locator(selector);
      await expect(button).toBeVisible();
      expect(await button.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        return hit === element || element.contains(hit);
      })).toBe(true);
    }
  } finally {
    await browser.close();
  }
});
