/**
 * @fileoverview 맞고 효과음의 결과 의미 구분, 라운드 중복 방지와 무음 폴백을 QA 검증한다.
 */

import { test, expect, chromium } from '@playwright/test';

const BASE_URL = process.env.MATGO_BASE_URL || 'http://localhost:3013';

/** 결정적 게임 상태를 테스트 서버에 주입한다. */
async function inject(state) {
  const response = await fetch(`${BASE_URL}/test/inject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state),
  });
  expect(response.ok).toBe(true);
}

/** 호출 기록형 오디오 엔진을 페이지 로드 전에 설치한다. */
async function installFakeAudio(page) {
  await page.addInitScript(() => {
    window.__matgoFakeAudio = { calls: [], visibility: [], destroyed: 0 };
    window.__MATGO_AUDIO_ENGINE_FACTORY__ = () => ({
      unlock: () => Promise.resolve(true),
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
      getDiagnostics: () => ({ fake: true }),
    });
  });
}

/** 독립된 두 플레이어 매치를 연다. */
async function openMatch({ unsupported = false } = {}) {
  await fetch(`${BASE_URL}/test/reset`, { method: 'POST' });
  await new Promise((resolve) => setTimeout(resolve, 250));
  const browser = await chromium.launch();
  const p1 = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const p2 = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  if (unsupported) {
    await p1.addInitScript(() => {
      window.__MATGO_AUDIO_ENGINE_FACTORY__ = () => null;
    });
  } else {
    await installFakeAudio(p1);
  }
  await p1.goto(`${BASE_URL}/?name=SFX-QA-P1`);
  await p2.goto(`${BASE_URL}/?name=SFX-QA-P2`);
  await Promise.all([
    p1.waitForSelector('#my-hand-cards .card'),
    p2.waitForSelector('#my-hand-cards .card'),
  ]);
  await p1.waitForFunction(() => document.querySelectorAll('#fly-overlay .flying-card').length === 0);
  return { browser, p1, p2 };
}

/** 결과 모달에 필요한 공통 정산 객체를 만든다. */
function resultFor(winner, settlementType = 'normal') {
  return {
    winner,
    loser: winner === 'p1' ? 'p2' : winner === 'p2' ? 'p1' : null,
    settlementType,
    winnerBreakdown: { score: 7, gwang: 3, tti: 0, kkeut: 0, piCount: 10 },
    loserBreakdown: { score: 0, gwang: 0, tti: 0, kkeut: 0, piCount: 5 },
    finalScore: winner == null ? 0 : 7,
    multiplier: 1,
    reasons: winner == null ? ['무승부'] : [],
    money: winner == null ? 0 : 700,
    goCount: { p1: 0, p2: 0 },
    shaking: { p1: false, p2: false },
    gobakApplies: false,
  };
}

/** 현재 라운드를 직접 종료한다. */
async function endRound(result) {
  await inject({
    phase: 'round_end',
    turn: 'p1',
    p1Hand: [],
    p2Hand: [],
    floor: [],
    deck: [],
    roundResult: result,
  });
}

test.describe.configure({ mode: 'serial' });

test('스톱·사통·무승부 결과음이 구분되고 라운드 serial이 eventKey를 분리한다', async () => {
  const { browser, p1 } = await openMatch();
  try {
    await p1.evaluate(() => { window.__matgoFakeAudio.calls = []; });
    await endRound(resultFor('p1'));
    await p1.waitForFunction(() => window.__matgoFakeAudio.calls.some((call) => call.key === 'round.win'));
    await p1.screenshot({ path: 'tests/screenshots/matgo-sfx-qa-game.png' });

    await p1.click('#btn-new-round-modal');
    await p1.waitForFunction(() => document.getElementById('round-modal')?.classList.contains('hidden'));
    await endRound(resultFor('p1'));
    await p1.waitForFunction(
      () => window.__matgoFakeAudio.calls.filter((call) => call.key === 'round.win').length === 2,
    );

    await p1.click('#btn-new-round-modal');
    await p1.waitForFunction(() => document.getElementById('round-modal')?.classList.contains('hidden'));
    await endRound(resultFor('p1', 'sangtong'));
    await p1.waitForFunction(
      () => window.__matgoFakeAudio.calls.filter((call) => call.key === 'round.win').length === 3,
    );

    await p1.click('#btn-new-round-modal');
    await p1.waitForFunction(() => document.getElementById('round-modal')?.classList.contains('hidden'));
    await endRound(resultFor(null));
    await p1.waitForFunction(() => window.__matgoFakeAudio.calls.some((call) => call.key === 'round.draw'));

    const calls = await p1.evaluate(() => window.__matgoFakeAudio.calls);
    const wins = calls.filter((call) => call.key === 'round.win');
    const stops = calls.filter((call) => call.key === 'decision.stop');
    expect(wins).toHaveLength(3);
    expect(new Set(wins.map((call) => call.eventKey)).size).toBe(3);
    expect(stops).toHaveLength(2);
    expect(calls.filter((call) => call.key === 'round.draw')).toHaveLength(1);
  } finally {
    await browser.close();
  }
});

test('visibilitychange와 pagehide가 엔진 수명주기에 전달된다', async () => {
  const { browser, p1 } = await openMatch();
  try {
    await p1.evaluate(() => {
      Object.defineProperty(document, 'hidden', {
        configurable: true,
        get: () => true,
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(await p1.evaluate(() => window.__matgoFakeAudio.visibility)).toEqual([true]);
    await p1.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
    expect(await p1.evaluate(() => window.__matgoFakeAudio.destroyed)).toBe(1);
  } finally {
    await browser.close();
  }
});

test('Web Audio 미지원 폴백에서도 게임 입력과 렌더링이 계속된다', async () => {
  const { browser, p1 } = await openMatch({ unsupported: true });
  const errors = [];
  p1.on('pageerror', (error) => errors.push(error.message));
  try {
    await p1.mouse.click(10, 10);
    const card = p1.locator('#my-hand-cards .card').first();
    await expect(card).toBeVisible();
    await card.click();
    await expect(p1.locator('#screen-game')).toBeVisible();
    expect(await p1.evaluate(() => window.__matgoAudioDiagnostics.unlockAttempts)).toBe(1);
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
  }
});
