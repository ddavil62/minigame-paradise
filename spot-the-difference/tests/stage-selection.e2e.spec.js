import { test, expect } from '@playwright/test';
import http from 'node:http';
import { createApp } from '../server.js';

test('도깨비 야식 포장마차를 선택해 플레이 화면으로 진입한다', async ({ page }) => {
  const app = createApp();
  app.prepareMatch('goblin-snack-stall-test');
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const { port } = server.address();
    await page.goto(`http://127.0.0.1:${port}/?matchId=goblin-snack-stall-test&role=p1&name=방장`);
    await expect(page.locator('.stage-collection[data-collection-id="goblin-night-village"]')).toContainText('도깨비 마을의 밤');
  await expect(page.locator('.stage-collection[data-collection-id="goblin-night-village"] .stage-card')).toHaveCount(5);
    await page.locator('.stage-card[data-stage-id="goblin-night-snack-stall-02"]').click();
    await expect(page.locator('#board')).toHaveAttribute('data-stage-id', 'goblin-night-snack-stall-02');
    await expect(page.locator('#image-a')).toHaveAttribute('src', 'assets/puzzles/goblin-night-snack-stall-02-a.png');
    await expect(page.locator('#image-b')).toHaveAttribute('src', 'assets/puzzles/goblin-night-snack-stall-02-b.png');
    await expect(page.locator('.progress-dot')).toHaveCount(5);
    await page.screenshot({ path: 'tests/screenshots/stage2-goblin-snack-stall-board.png', fullPage: true });
  } finally {
    await page.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('별빛 원더파크 회전목마 정원을 선택해 플레이 화면으로 진입한다', async ({ page }) => {
  const app = createApp();
  app.prepareMatch('wonder-park-stage-test');
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const { port } = server.address();
    await page.goto(`http://127.0.0.1:${port}/?matchId=wonder-park-stage-test&role=p1&name=방장`);
    await expect(page.locator('.stage-collection[data-collection-id="wonder-park"]')).toContainText('별빛 원더파크');
    await page.locator('.stage-card[data-stage-id="wonder-park-carousel-garden-02"]').click();
    await expect(page.locator('#board')).toHaveAttribute('data-stage-id', 'wonder-park-carousel-garden-02');
    await expect(page.locator('#image-a')).toHaveAttribute('src', 'assets/puzzles/wonder-park-carousel-garden-02-a.png');
    await expect(page.locator('#image-b')).toHaveAttribute('src', 'assets/puzzles/wonder-park-carousel-garden-02-b.png');
    await expect(page.locator('.progress-dot')).toHaveCount(5);
    await page.screenshot({ path: 'tests/screenshots/wonder-park-carousel-garden-02-desktop.png', fullPage: true });
  } finally {
    await page.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('방장이 고른 스테이지가 두 브라우저에서 동시에 시작된다', async ({ browser }) => {
  const app = createApp();
  app.prepareMatch('stage-select-test');
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const hostContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const guestContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  try {
    const { port } = server.address();
    await Promise.all([
      host.goto(`http://127.0.0.1:${port}/?matchId=stage-select-test&role=p1&name=방장`),
      guest.goto(`http://127.0.0.1:${port}/?matchId=stage-select-test&role=p2&name=친구`),
    ]);

    await expect(host.locator('.stage-card')).toHaveCount(65);
    await expect(host.locator('.stage-collection')).toHaveCount(13);
    await expect(host.locator('.stage-collection[data-collection-id="japanese-comics"] .stage-card')).toHaveCount(5);
    await expect(host.locator('.stage-collection[data-collection-id="wonder-park"] .stage-card')).toHaveCount(5);
    await expect(host.locator('.stage-collection[data-collection-id="goblin-night-village"] .stage-card')).toHaveCount(5);
    await expect(host.locator('.stage-collection[data-collection-id="tiny-things-city"] .stage-card')).toHaveCount(5);
    await expect(host.locator('.stage-collection[data-collection-id="animal-detectives"] .stage-card')).toHaveCount(5);
    await expect(host.locator('.stage-collection[data-collection-id="cat-detective-agency"] .stage-card')).toHaveCount(5);
    await expect(host.locator('.stage-collection[data-collection-id="magic-delivery-office"] .stage-card')).toHaveCount(5);
    await expect(host.locator('.stage-collection[data-collection-id="toy-kingdom"] .stage-card')).toHaveCount(5);
    await expect(host.locator('.stage-collection[data-collection-id="dragon-academy"] .stage-card')).toHaveCount(5);
    await expect(host.locator('#audio-toggle')).toBeVisible();
    await expect(host.locator('#audio-toggle')).toHaveAttribute('aria-pressed', 'false');
    await host.locator('#audio-toggle').click();
    await expect(host.locator('#audio-toggle')).toHaveAttribute('aria-pressed', 'true');
    await expect(host.locator('#audio-toggle')).toHaveText('🔇 음소거');
    await host.locator('#audio-toggle').click();
    await expect(host.locator('#audio-toggle')).toHaveAttribute('aria-pressed', 'false');
    await expect(host.locator('#stage-lobby-button')).toBeVisible();
    await expect(host.locator('#stage-lobby-button')).toHaveAttribute('href', '/');
    await expect(host.locator('.difficulty-option')).toHaveCount(3);
    await expect(host.locator('.difficulty-option[data-difficulty="normal"]')).toHaveAttribute('aria-pressed', 'true');
    await host.locator('.difficulty-option[data-difficulty="easy"]').click();
    await expect(host.locator('.difficulty-option[data-difficulty="easy"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(guest.locator('.difficulty-option[data-difficulty="easy"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(host.locator('.stage-card')).toHaveCount(65);
    await expect(host.locator('.stage-card-meta:has-text("쉬움")')).toHaveCount(0);
    await expect(host.locator('.stage-card-meta:has-text("보통")')).toHaveCount(0);
    await expect(host.locator('.stage-card-meta:has-text("어려움")')).toHaveCount(0);
    await expect(host.locator('.rule-option')).toHaveCount(0);
    await expect(guest.locator('.difficulty-option:enabled')).toHaveCount(0);
    await expect(host.locator('.stage-collection[data-collection-id="world-adventure"] .stage-card')).toHaveCount(5);
    await expect(host.locator('.stage-collection[data-collection-id="style-lab"] .stage-card')).toHaveCount(5);
    await expect(host.locator('.stage-card[data-stage-id="retro-comic-space-diner-02"]')).toBeEnabled();
    await expect(host.locator('.stage-card[data-stage-id="retro-comic-monster-tv-studio-03"]')).toBeEnabled();
    await expect(host.locator('.stage-card[data-stage-id="retro-comic-alien-laundromat-04"]')).toBeEnabled();
    await expect(host.locator('.stage-card[data-stage-id="retro-comic-moon-barbershop-05"]')).toBeEnabled();
    await expect(host.locator('.stage-card[data-stage-id="wonder-park-dream-gate-01"]')).toBeEnabled();
    await expect(host.locator('.stage-card[data-stage-id="wonder-park-carousel-garden-02"]')).toBeEnabled();
    await expect(host.locator('.stage-card[data-stage-id="wonder-park-candy-parade-03"]')).toBeEnabled();
    await expect(host.locator('.stage-card[data-stage-id="wonder-park-moonboat-lagoon-04"]')).toBeEnabled();
    await expect(guest.locator('.stage-card[data-stage-id="retro-comic-space-diner-02"]')).toBeDisabled();
    await expect(guest.locator('#stage-wait')).toContainText('방장이 스테이지를 고르고 있어요');
    await host.screenshot({ path: 'tests/screenshots/stage-selection-with-lobby-desktop.png', fullPage: true });

    await host.locator('.stage-card[data-stage-id="retro-comic-moon-barbershop-05"]').click();
    await expect(host.locator('#board')).toBeVisible();
    await expect(guest.locator('#board')).toBeVisible();
    await expect(host.locator('#board')).toHaveAttribute('data-stage-id', 'retro-comic-moon-barbershop-05');
    await expect(guest.locator('#board')).toHaveAttribute('data-stage-id', 'retro-comic-moon-barbershop-05');
    await expect(host.locator('#image-a')).toHaveAttribute('src', 'assets/puzzles/retro-comic-moon-barbershop-05-a.png');
    await expect(host.locator('#image-b')).toHaveAttribute('src', 'assets/puzzles/retro-comic-moon-barbershop-05-b.png');
    await expect(host.locator('.progress-dot')).toHaveCount(5);
    await expect(host.locator('#active-rule')).toHaveText('🌱 쉬움');
    await expect(host.locator('#hint-count')).toHaveText('3');
    await expect(host.locator('#stage-button')).toBeEnabled();
    await expect(guest.locator('#stage-button')).toBeDisabled();
    await expect(host.locator('#players')).toContainText('친구');
    await expect(guest.locator('#players')).toContainText('방장');
    await host.screenshot({ path: 'tests/screenshots/retro-comic-stage-05-desktop.png', fullPage: true });
  } finally {
    await Promise.all([hostContext.close(), guestContext.close()]);
    await new Promise((resolve) => server.close(resolve));
  }
});

test('모바일 스테이지 선택 화면에서 로비 버튼을 바로 사용할 수 있다', async ({ browser }) => {
  const app = createApp();
  app.prepareMatch('stage-select-mobile');
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();

  try {
    const { port } = server.address();
    await page.goto(`http://127.0.0.1:${port}/?matchId=stage-select-mobile&role=p1&name=모바일`);
    await expect(page.locator('#stage-lobby-button')).toBeVisible();
    await expect(page.locator('#stage-lobby-button')).toHaveAttribute('href', '/');
    await expect(page.locator('.difficulty-option')).toHaveCount(3);
    await expect(page.locator('.difficulty-option[data-difficulty="normal"]')).toBeVisible();
    await page.screenshot({ path: 'tests/screenshots/stage-selection-with-lobby-mobile.png' });
  } finally {
    await context.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
