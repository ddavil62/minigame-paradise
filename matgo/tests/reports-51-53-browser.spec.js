/**
 * @fileoverview 리포트 #51의 ko/en 쪽 toast 시점과 중복 방지를 브라우저에서 검증한다.
 */

import { test, expect, chromium } from '@playwright/test';
import { buildDeck } from '../cards.js';

const BASE_URL = process.env.MATGO_BASE_URL || 'http://localhost:3013';
const BY_ID = Object.fromEntries(buildDeck().map((card) => [card.id, card]));

/** @param {object} state @returns {Promise<void>} 결정적 게임 상태를 주입한다. */
async function inject(state) {
  const response = await fetch(`${BASE_URL}/test/inject`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state),
  });
  expect(response.ok).toBe(true);
}

/** @param {string} lang @returns {Promise<{browser:object,p1:object,p2:object}>} 두 플레이어 매치를 연다. */
async function openMatch(lang) {
  await fetch(`${BASE_URL}/test/reset`, { method: 'POST' });
  // reset이 닫은 이전 WebSocket의 close 콜백이 새 플레이어 슬롯에 간섭하지 않게 안정화한다.
  await new Promise((resolve) => setTimeout(resolve, 300));
  const browser = await chromium.launch();
  const p1 = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const p2 = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await p1.addInitScript(() => {
    window.__matgoDiagnostics = {};
    window.__r53SentMessages = [];
    const originalSend = WebSocket.prototype.send;
    WebSocket.prototype.send = function instrumentedSend(data) {
      try {
        window.__r53SentMessages.push(JSON.parse(data));
      } catch {
        window.__r53SentMessages.push(data);
      }
      return originalSend.call(this, data);
    };
  });
  await p1.goto(`${BASE_URL}/?name=R51-P1&lang=${lang}`);
  await p2.goto(`${BASE_URL}/?name=R51-P2&lang=${lang}`);
  await Promise.all([p1.waitForSelector('#my-hand-cards .card'), p2.waitForSelector('#my-hand-cards .card')]);
  return { browser, p1, p2 };
}

test.describe.configure({ mode: 'serial' });

for (const [lang, expected] of [['ko', '쪽!'], ['en', 'Jjok!']]) {
  test(`#51 ${lang} 쪽 toast는 최종 fly 뒤 한 번만 표시된다`, async () => {
    const { browser, p1 } = await openMatch(lang);
    try {
      await inject({
        turn: 'p1', phase: 'awaiting_play',
        p1Hand: [BY_ID.m01_gwang, BY_ID.m08_pi_a], p2Hand: [BY_ID.m09_pi_a],
        floor: [BY_ID.m02_pi_a], deck: [BY_ID.m01_pi_a],
        captured: { p1: [], p2: [BY_ID.m06_pi_a] },
      });
      await p1.waitForFunction(() => document.querySelectorAll('#fly-overlay .flying-card').length === 0);
      await p1.evaluate(() => {
        document.querySelector('.action-toast')?.classList.remove('show');
        window.__r51ToastShowCount = 0;
        window.__r51ToastObserver = new MutationObserver(() => {
          if (document.querySelector('.action-toast.show')) window.__r51ToastShowCount += 1;
        });
        window.__r51ToastObserver.observe(document.body, {
          subtree: true, childList: true, attributes: true, attributeFilter: ['class'],
        });
      });
      await p1.click('#my-hand-cards [data-card-id="m01_gwang"]');
      await p1.waitForFunction(() => document.querySelectorAll('#fly-overlay .flying-card').length > 0);
      await expect(p1.locator('.action-toast.show')).toHaveCount(0);
      await p1.waitForFunction(() => document.querySelectorAll('#fly-overlay .flying-card').length === 0);
      await expect(p1.locator('.action-toast.show')).toHaveText(expected);
      await p1.waitForTimeout(500);
      expect(await p1.evaluate(() => window.__r51ToastShowCount)).toBe(1);
      expect(await p1.locator('.action-toast').getAttribute('data-toast-key'))
        .toContain('|action.jjok|');
    } finally {
      await browser.close();
    }
  });
}

test('#53 손패 0장 GO 뒤 보너스 더미 안내가 나오고 중복 클릭은 한 번만 처리된다', async () => {
  const { browser, p1 } = await openMatch('ko');
  try {
    const before = await fetch(`${BASE_URL}/test/status`).then((response) => response.json());
    await inject({
      turn: 'p1', phase: 'awaiting_go_stop',
      p1Hand: [], p2Hand: [], floor: [BY_ID.m02_pi_a],
      deck: [BY_ID.m04_pi_a, BY_ID.m03_pi_a],
      captured: { p1: [], p2: [] },
      bombDeckCredit: { p1: 1, p2: 0 },
      pendingBombFlips: { p1: 0, p2: 0 },
      bombResolvingPlayer: null,
    });
    await expect(p1.locator('#btn-go')).toBeVisible({ timeout: 10000 });
    // 초기 랜덤 배분 clone은 #53 대상이 아니므로 상태 적용 뒤 관측 영역에서 제거한다.
    await p1.evaluate(() => {
      document.querySelectorAll('#fly-overlay .flying-card').forEach((element) => element.remove());
    });
    const beforeClick = await p1.evaluate(() => ({
      goVisible: !document.querySelector('#go-stop-overlay')?.classList.contains('hidden'),
      sentGoStop: window.__r53SentMessages.filter((message) => message?.type === 'GO_STOP').length,
    }));
    expect(beforeClick).toEqual({ goVisible: true, sentGoStop: 0 });
    await p1.evaluate(() => document.querySelector('#btn-go').click());
    await expect.poll(
      async () => fetch(`${BASE_URL}/test/status`).then((response) => response.json()),
      { timeout: 5000 },
    ).toMatchObject({
      phase: 'awaiting_play',
      turn: 'p1',
      bombDeckCredit: { p1: 1, p2: 0 },
      stepInProgress: false,
    });
    expect(await p1.evaluate(
      () => window.__r53SentMessages.filter((message) => message?.type === 'GO_STOP').length,
    )).toBe(1);
    await expect(p1.locator('#go-stop-overlay')).toHaveClass(/hidden/);
    await expect(p1.locator('.deck-card.bonus-available')).toBeVisible();
    await expect(p1.locator('#action-display')).toContainText('보너스');
    await expect(p1.locator('#toast')).toHaveClass(/hidden/);
    await p1.screenshot({
      path: 'tests/screenshots/reports-51-53-phaseB-53-go-bonus-ready.png',
      fullPage: true,
    });

    await p1.locator('.deck-card.bonus-available').evaluate((deck) => {
      deck.click();
      deck.click();
    });
    await p1.waitForFunction(
      () => window.__matgoDiagnostics?.lastState?.bombDeckCredit?.p1 === 0
        && window.__matgoDiagnostics?.inputLocked === false,
    );
    const after = await fetch(`${BASE_URL}/test/status`).then((response) => response.json());
    expect(after.bonusFlipRequestCount - before.bonusFlipRequestCount).toBe(1);
    await expect(p1.locator('#toast')).toHaveClass(/hidden/);
    await p1.screenshot({
      path: 'tests/screenshots/reports-51-53-phaseB-53-bonus-consumed.png',
      fullPage: true,
    });
  } finally {
    await browser.close();
  }
});
