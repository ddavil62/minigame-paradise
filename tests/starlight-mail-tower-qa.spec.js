/**
 * @fileoverview 별빛 우편탑 런처 카드부터 공용 READY와 단일 포트 게임 진입까지 회귀 검증한다.
 */

import { expect, test } from '@playwright/test';

test('게임 메타와 160×96 키아트가 단일 포트에서 제공된다', async ({ page, request }) => {
  const response = await request.get('/games.json');
  expect(response.ok()).toBe(true);
  const games = await response.json();
  const game = games.find((entry) => entry.id === 'starlight-mail-tower');
  expect(game).toMatchObject({ port: 3015, botAvailable: false, minPlayers: 2, maxPlayers: 2, httpPath: '/starlight-mail-tower/', wsPath: '/starlight-mail-tower/ws' });
  await page.addInitScript(() => localStorage.setItem('minigames:nickname', 'LauncherSolo'));
  await page.goto('/');
  const card = page.locator('[data-game-id="starlight-mail-tower"]');
  await expect(card).toBeVisible();
  await card.scrollIntoViewIfNeeded();
  await expect(card.locator('.game-card-keyart')).toHaveAttribute('src', '/starlight-mail-tower/assets/key-art.svg');
  await expect(card.locator('.game-card-meta')).toContainText('2인 전용');
  await card.focus();
  await page.screenshot({ path: 'starlight-mail-tower/tests/screenshots/phase3-launcher-card-1280x800.png' });
});

test('두 런처 사용자가 READY하면 역할을 유지해 동시에 게임에 진입한다', async ({ browser }) => {
  const contextA = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const contextB = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  await contextA.addInitScript(() => localStorage.setItem('minigames:nickname', 'LauncherA'));
  await contextB.addInitScript(() => { localStorage.setItem('minigames:nickname', 'LauncherB'); localStorage.setItem('starlight-locale', 'en'); });
  const pageA = await contextA.newPage(); const pageB = await contextB.newPage();
  await Promise.all([pageA.goto('/'), pageB.goto('/')]);
  await pageA.locator('[data-game-id="starlight-mail-tower"]').click();
  await expect(pageA.locator('#wr-players .player-ready-card')).toHaveCount(2);
  await pageB.locator('[data-game-id="starlight-mail-tower"]').click();
  await expect(pageA.locator('#waiting-room-view')).toBeVisible();
  await expect(pageA.locator('#btn-wr-fill-ai')).toBeHidden();
  await expect(pageA.locator('#wr-players .player-ready-card')).toHaveCount(2);
  await expect(pageA.locator('#wr-status')).toHaveAttribute('aria-live', 'polite');
  await expect(pageB.locator('#btn-ready')).toHaveText('READY');
  await pageA.screenshot({ path: 'starlight-mail-tower/tests/screenshots/phase3-launcher-ready-1280x800.png' });
  await pageB.screenshot({ path: 'starlight-mail-tower/tests/screenshots/phase3-launcher-ready-1024x768.png' });
  await pageA.locator('#btn-ready').click();
  await expect(pageA.locator('.player-ready-card.role-a')).toHaveClass(/(^|\s)ready(\s|$)/);
  await pageA.screenshot({ path: 'starlight-mail-tower/tests/screenshots/phase3-launcher-p1-ready-1280x800.png' });
  await pageA.locator('#btn-ready').click();
  await expect(pageA.locator('.player-ready-card.ready')).toHaveCount(0);
  await pageB.locator('#btn-ready').click();
  await expect(pageA.locator('.player-ready-card.role-b')).toHaveClass(/(^|\s)ready(\s|$)/);
  await pageA.screenshot({ path: 'starlight-mail-tower/tests/screenshots/phase3-launcher-p2-ready-1280x800.png' });
  await pageA.locator('#btn-ready').click();
  await pageA.waitForTimeout(80);
  await expect(pageA.locator('#wr-players')).toHaveClass(/both-ready/);
  await pageA.screenshot({ path: 'starlight-mail-tower/tests/screenshots/phase3-launcher-both-ready-1280x800.png' });
  await Promise.all([pageA.waitForURL(/\/starlight-mail-tower\//), pageB.waitForURL(/\/starlight-mail-tower\//)]);
  await Promise.all([expect(pageA.locator('#ready-overlay')).toBeHidden(), expect(pageB.locator('#ready-overlay')).toBeHidden()]);
  const roles = await Promise.all([pageA.locator('body').getAttribute('data-player-id'), pageB.locator('body').getAttribute('data-player-id')]);
  expect(new Set(roles)).toEqual(new Set(['p1', 'p2']));
  await pageA.locator('#toolbar-lobby-button').click();
  await expect(pageA.locator('#lobby-confirm-overlay')).toBeVisible();
  await pageA.locator('#confirm-lobby-button').click();
  await expect(pageB.locator('#session-ended-overlay')).toBeVisible();
  await pageB.locator('#session-lobby-button').click();
  await Promise.all([pageA.waitForURL('http://localhost:3000/'), pageB.waitForURL('http://localhost:3000/')]);
  await contextA.close(); await contextB.close();
});
