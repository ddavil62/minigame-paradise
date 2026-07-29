/**
 * @fileoverview 맞고 클라이언트의 사용자 제스처 unlock과 fly/특수 효과음 연동을 검증한다.
 */

import { test, expect, chromium } from '@playwright/test';
import { buildDeck } from '../cards.js';

const BASE_URL = process.env.MATGO_BASE_URL || 'http://localhost:3013';
const BY_ID = Object.fromEntries(buildDeck().map((card) => [card.id, card]));

/** 결정적 게임 상태를 서버 테스트 훅에 주입한다. */
async function inject(state) {
  const response = await fetch(`${BASE_URL}/test/inject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state),
  });
  expect(response.ok).toBe(true);
}

/** 페이지 로드 전에 호출 기록형 오디오 엔진을 주입한다. */
async function installFakeAudio(page) {
  await page.addInitScript(() => {
    window.__matgoFakeAudio = {
      unlocks: 0,
      calls: [],
      visibility: [],
      destroyed: 0,
    };
    window.__MATGO_AUDIO_ENGINE_FACTORY__ = () => ({
      unlock() {
        window.__matgoFakeAudio.unlocks += 1;
        return Promise.resolve(true);
      },
      playSfx(key, metadata) {
        window.__matgoFakeAudio.calls.push({ key, eventKey: metadata?.eventKey || '' });
        return true;
      },
      handleVisibility(hidden) {
        window.__matgoFakeAudio.visibility.push(hidden);
      },
      destroy() {
        window.__matgoFakeAudio.destroyed += 1;
      },
      getDiagnostics() {
        return { fake: true };
      },
    });
  });
}

/** 독립된 두 플레이어 게임을 연다. */
async function openMatch() {
  await fetch(`${BASE_URL}/test/reset`, { method: 'POST' });
  await new Promise((resolve) => setTimeout(resolve, 300));
  const browser = await chromium.launch();
  const p1 = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const p2 = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await installFakeAudio(p1);
  await p1.goto(`${BASE_URL}/?name=SFX-P1`);
  await p2.goto(`${BASE_URL}/?name=SFX-P2`);
  await Promise.all([
    p1.waitForSelector('#my-hand-cards .card'),
    p2.waitForSelector('#my-hand-cards .card'),
  ]);
  await p1.waitForFunction(() => document.querySelectorAll('#fly-overlay .flying-card').length === 0);
  return { browser, p1 };
}

test.describe.configure({ mode: 'serial' });

test('첫 pointer/keyboard 제스처 전체에서 unlock은 한 번만 호출된다', async () => {
  const { browser, p1 } = await openMatch();
  try {
    expect(await p1.evaluate(() => window.__matgoFakeAudio.unlocks)).toBe(0);
    await p1.mouse.click(10, 10);
    await p1.keyboard.press('Space');
    await p1.mouse.click(20, 20);
    expect(await p1.evaluate(() => window.__matgoFakeAudio.unlocks)).toBe(1);
    expect(await p1.evaluate(() => window.__matgoAudioDiagnostics.unlockAttempts)).toBe(1);
  } finally {
    await browser.close();
  }
});

test('쪽 턴에서 fly 단계와 특수 효과음이 eventKey별 한 번씩 재생된다', async () => {
  const { browser, p1 } = await openMatch();
  try {
    await inject({
      turn: 'p1',
      phase: 'awaiting_play',
      p1Hand: [BY_ID.m01_gwang, BY_ID.m08_pi_a],
      p2Hand: [BY_ID.m09_pi_a],
      floor: [BY_ID.m02_pi_a],
      deck: [BY_ID.m01_pi_a],
      captured: { p1: [], p2: [BY_ID.m06_pi_a] },
    });
    await p1.waitForFunction(() => document.querySelectorAll('#fly-overlay .flying-card').length === 0);
    await p1.evaluate(() => { window.__matgoFakeAudio.calls = []; });
    await p1.click('#my-hand-cards [data-card-id="m01_gwang"]');
    await p1.waitForFunction(
      () => window.__matgoFakeAudio.calls.some((call) => call.key === 'special.jjok')
        && document.querySelectorAll('#fly-overlay .flying-card').length === 0,
      null,
      { timeout: 5000 },
    );

    const calls = await p1.evaluate(() => window.__matgoFakeAudio.calls);
    const keys = calls.map((call) => call.key);
    expect(keys).toContain('card.throw');
    expect(keys).toContain('card.land');
    expect(keys).toContain('deck.flip');
    expect(keys).toContain('capture');
    expect(keys).toContain('special.jjok');

    const uniqueEventKeys = new Set(calls.map((call) => call.eventKey));
    expect(uniqueEventKeys.size).toBe(calls.length);
    expect(calls.filter((call) => call.key === 'special.jjok')).toHaveLength(1);
  } finally {
    await browser.close();
  }
});

test('pagehide에서 오디오 엔진을 한 번 정리한다', async () => {
  const { browser, p1 } = await openMatch();
  try {
    await p1.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
    expect(await p1.evaluate(() => window.__matgoFakeAudio.destroyed)).toBe(1);
  } finally {
    await browser.close();
  }
});
