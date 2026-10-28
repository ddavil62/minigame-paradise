import { test, expect } from '@playwright/test';
import http from 'node:http';
import { createApp } from '../server.js';

test('조건부 보상 카드와 양측 공개 상태가 모바일 화면에 표시된다', async ({ browser }) => {
  const randomValues = [0, 0, 0.999999, 0, 0, 0];
  const app = createApp({ hostUrl: '', random: () => randomValues.shift() ?? 0 });
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const contextA = await browser.newContext({ viewport: { width: 360, height: 640 } });
  const contextB = await browser.newContext({ viewport: { width: 360, height: 640 } });
  const a = await contextA.newPage();
  const b = await contextB.newPage();
  const errors = [];
  a.on('pageerror', (error) => errors.push(error.message));
  b.on('pageerror', (error) => errors.push(error.message));
  try {
    await Promise.all([
      a.goto(`http://127.0.0.1:${server.address().port}/?name=조건QA-A`),
      b.goto(`http://127.0.0.1:${server.address().port}/?name=조건QA-B`),
    ]);
    await expect.poll(async () => (
      await a.locator('#word-input').isEnabled() || await b.locator('#word-input').isEnabled()
    ), { timeout: 8_000 }).toBe(true);
    const actor = await a.locator('#word-input').isEnabled() ? a : b;
    const observer = actor === a ? b : a;
    await actor.locator('#word-input').fill('가게');
    await actor.locator('#submit-btn').click();

    await expect(actor.locator('.reward-card')).toHaveCount(3);
    await expect(actor.locator('.reward-card.conditional')).toHaveCount(1);
    const conditionalCard = actor.locator('.reward-card.conditional');
    await expect(conditionalCard).toContainText('정밀타');
    await expect(conditionalCard).toContainText(/으로 끝내기/);
    await expect(conditionalCard).toContainText('+10 DAMAGE');
    const cardBox = await conditionalCard.boundingBox();
    expect(cardBox.x).toBeGreaterThanOrEqual(0);
    expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(360);

    await conditionalCard.click();
    await expect(actor.locator('#conditional-me')).toBeVisible();
    await expect(observer.locator('#conditional-opp')).toBeVisible();
    await expect(actor.locator('#conditional-me')).toContainText('정밀타');
    await expect(observer.locator('#conditional-opp')).toHaveText(await actor.locator('#conditional-me').innerText());
    expect(errors).toEqual([]);
  } finally {
    await contextA.close();
    await contextB.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('만료된 매치 접속은 무한 대기 대신 재입장 오류를 표시한다', async ({ page }) => {
  const app = createApp({ hostUrl: '' });
  app.prepareMatch('active-match-12345678');
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/?name=만료QA`);
    await expect(page.locator('#waiting-msg')).toContainText('로비에서 다시 입장', { timeout: 5_000 });
    await expect(page.locator('#waiting-msg')).toHaveClass(/error/);
    await expect(page.locator('#game-screen')).not.toHaveClass(/active/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
