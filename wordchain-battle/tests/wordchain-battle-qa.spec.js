import { test, expect } from '@playwright/test';
import http from 'node:http';
import { createApp } from '../server.js';

async function startServer() {
  const app = createApp({ hostUrl: '', random: () => 0 });
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { port: server.address().port, server };
}

async function stopServer(server) {
  await new Promise((resolve) => server.close(resolve));
}

test('2인 실제 화면에서 단어 제출 → 보상 선택 → 전투 적용 흐름이 동작한다', async ({ browser }) => {
  const server = await startServer();
  const contextA = await browser.newContext({ viewport: { width: 800, height: 640 } });
  const contextB = await browser.newContext({ viewport: { width: 800, height: 640 } });
  const a = await contextA.newPage();
  const b = await contextB.newPage();
  const errors = [];
  a.on('pageerror', (error) => errors.push(error.message));
  b.on('pageerror', (error) => errors.push(error.message));
  try {
    await Promise.all([
      a.goto(`http://127.0.0.1:${server.port}/?name=QA-A`),
      b.goto(`http://127.0.0.1:${server.port}/?name=QA-B`),
    ]);
    await expect(a.locator('#game-screen')).toHaveClass(/active/, { timeout: 8_000 });
    await expect(b.locator('#game-screen')).toHaveClass(/active/, { timeout: 8_000 });
    await expect(a.locator('#start-char')).toHaveText('???');
    await expect(b.locator('#start-char')).toHaveText('???');
    const countdownTurns = await Promise.all([
      a.locator('#countdown-first-turn').innerText(),
      b.locator('#countdown-first-turn').innerText(),
    ]);
    expect(countdownTurns.sort()).toEqual(['내가 선공!', '상대가 선공!'].sort());
    await expect(a.locator('.word-effect-item')).toHaveCount(4);
    await expect(a.locator('.menu-damage b')).toHaveText(['4', '8', '12', '16']);
    expect(await a.locator('.action-area').evaluate((element) => (
      element.compareDocumentPosition(document.querySelector('.word-effect-panel')) & Node.DOCUMENT_POSITION_FOLLOWING
    ))).toBeTruthy();
    const timerBox = await a.locator('.answer-timer').boundingBox();
    const charBox = await a.locator('#input-char-preview').boundingBox();
    expect(timerBox.x + timerBox.width).toBeLessThanOrEqual(charBox.x);
    await expect(a.locator('.reward-card')).toHaveCount(0);
    await expect(a.locator('#attack-me')).toHaveText('0');
    await expect(a.locator('#defense-opp')).toHaveText('0');

    await expect.poll(async () => (
      await a.locator('#word-input').isEnabled() || await b.locator('#word-input').isEnabled()
    ), { timeout: 8_000 }).toBe(true);
    const actor = await a.locator('#word-input').isEnabled() ? a : b;
    const observer = actor === a ? b : a;
    await actor.locator('#word-input').fill('가게');
    await actor.locator('#submit-btn').click();
    await expect(actor.locator('#reward-action')).toBeVisible();
    expect(await actor.locator('#reward-action').evaluate((element) => getComputedStyle(element).position)).toBe('fixed');
    await expect(actor.locator('#state-label')).toHaveText('보상 선택');
    await expect(observer.locator('#reward-prompt')).toContainText('상대가 보상을 선택');
    await expect(actor.locator('.reward-card')).toHaveCount(3);
    await expect(actor.locator('.reward-card .reward-icon')).toHaveCount(3);
    await expect(actor.locator('#reward-list')).not.toContainText('추가 공격');
    // 결정적 후보의 3번(Defense +1)을 선택하면 다음 공격자의 족보가 방어력만큼 즉시 감소한다.
    await actor.keyboard.press('3');
    await expect(actor.locator('#combat-popup')).toContainText(/\d+ Damage/);
    await expect(actor.locator('#reward-action')).toBeHidden();
    await expect(actor.locator('.menu-damage b')).toHaveText(['3', '7', '11', '15']);
    expect(errors).toEqual([]);
  } finally {
    await contextA.close(); await contextB.close(); await stopServer(server.server);
  }
});

test('치명타 공격은 단어 비행 뒤 HP 0, 균열, K.O. 순서로 재생된다', async ({ page }) => {
  const server = await startServer();
  try {
    await page.goto(`http://127.0.0.1:${server.port}/?name=KO-QA`);
    await page.evaluate(async () => {
      const ui = await import('/js/ui.js');
      ui.showGame();
      ui.updatePlayer('opp', { hp: 14, maxHp: 100, attack: 0, defense: 0, baseAnswerTime: 10 });
      ui.playCombatSequence({ attackerWho: 'me', targetWho: 'opp', word: '라벤더빛', damage: 14, targetHp: 0, lethal: true });
    });

    await expect(page.locator('#word-projectile')).toHaveClass(/from-me/);
    await expect(page.locator('#word-projectile span')).toHaveText(['라', '벤', '더', '빛']);
    await expect(page.locator('#hp-text-opp')).toHaveText('14/100');
    await expect(page.locator('#hp-text-opp')).toHaveText('0/100', { timeout: 1_200 });
    await expect(page.locator('#defeat-opp')).toHaveClass(/active/);
    await expect(page.locator('#panel-opp')).toHaveClass(/defeated/);
    await expect(page.locator('#defeat-opp .ko-stamp')).toBeVisible();
    await page.waitForTimeout(700);
    await page.screenshot({ path: 'tests/screenshots/ko-finisher-desktop.png', fullPage: true });
  } finally {
    await page.close();
    await stopServer(server.server);
  }
});

test('시간초과는 타이머 폭발 뒤 해당 전장에 20 피해를 표시한다', async ({ page }) => {
  const server = await startServer();
  try {
    await page.goto(`http://127.0.0.1:${server.port}/?name=TIMEOUT-QA`);
    await page.evaluate(async () => {
      const ui = await import('/js/ui.js');
      ui.showGame();
      ui.updatePlayer('me', { hp: 92, maxHp: 100, attack: 0, defense: 0, baseAnswerTime: 10 });
      ui.playTimeoutSequence({ who: 'me', damage: 20, targetHp: 72, lethal: false });
    });

    await expect(page.locator('#timer-text')).toHaveText('0');
    await expect(page.locator('#timeout-banner')).toHaveClass(/active/);
    await expect(page.locator('#hp-text-me')).toHaveText('92/100');
    await expect(page.locator('#hp-text-me')).toHaveText('72/100', { timeout: 700 });
    await expect(page.locator('#panel-me')).toHaveClass(/timeout-hit/);
    await expect(page.locator('#damage-float')).toContainText('-20');
    await expect(page.locator('#damage-float')).toHaveClass(/timeout-damage/);
    await page.screenshot({ path: 'tests/screenshots/timeout-damage-desktop.png', fullPage: true });
  } finally {
    await page.close();
    await stopServer(server.server);
  }
});

test('360x640에서 전투 정보와 선택 UI가 가로로 넘치지 않는다', async ({ browser }) => {
  const server = await startServer();
  const contextA = await browser.newContext({ viewport: { width: 360, height: 640 } });
  const contextB = await browser.newContext({ viewport: { width: 360, height: 640 } });
  const a = await contextA.newPage(); const b = await contextB.newPage();
  try {
    await Promise.all([
      a.goto(`http://127.0.0.1:${server.port}/?name=모바일A`),
      b.goto(`http://127.0.0.1:${server.port}/?name=모바일B`),
    ]);
    await expect(a.locator('#game-screen')).toHaveClass(/active/, { timeout: 8_000 });
    expect(await a.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    for (const selector of ['#panel-me', '#panel-opp', '.word-effect-panel', '.action-area', '.answer-timer']) {
      const box = await a.locator(selector).boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(360);
    }
  } finally {
    await contextA.close(); await contextB.close(); await stopServer(server.server);
  }
});
