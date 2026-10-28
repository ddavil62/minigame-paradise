import { test, expect } from '@playwright/test';
import http from 'node:http';
import { createApp } from '../server.js';
import { getStage } from '../stages.js';

test('일본 코믹스 스테이지 1을 선택하고 다섯 차이를 모두 판정한다', async ({ page }) => {
  const app = createApp();
  app.prepareMatch('japanese-comics-stage-01');
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const { port } = server.address();
    await page.goto(`http://127.0.0.1:${port}/?matchId=japanese-comics-stage-01&role=p1&name=QA`);
    const card = page.locator('.stage-collection[data-collection-id="japanese-comics"] .stage-card[data-stage-id="japanese-comics-manga-studio-01"]');
    await expect(card).toBeVisible();
    await card.click();
    await expect(page.locator('#board')).toHaveAttribute('data-stage-id', 'japanese-comics-manga-studio-01');
    await expect(page.locator('#image-a')).toHaveAttribute('src', 'assets/puzzles/japanese-comics-manga-studio-01-a.png');
    await expect(page.locator('#image-b')).toHaveAttribute('src', 'assets/puzzles/japanese-comics-manga-studio-01-b.png');
    await page.screenshot({ path: 'tests/screenshots/japanese-comics-stage-01-gameplay.png', fullPage: true });

    const stage = getStage('japanese-comics-manga-studio-01');
    const imageStage = page.locator('.picture[data-image="a"] .image-stage');
    const box = await imageStage.boundingBox();
    for (const difference of stage.differences) {
      const zone = difference.zones.a;
      await page.mouse.click(
        box.x + box.width * (zone.x + zone.w / 2),
        box.y + box.height * (zone.y + zone.h / 2),
      );
    }

    await expect(page.locator('#progress-label')).toHaveText('5 / 5');
    await expect(page.locator('#result')).toBeHidden();
    await page.screenshot({ path: 'tests/screenshots/japanese-comics-stage-01-complete.png', fullPage: true });
  } finally {
    await page.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('새 일본 코믹스 스테이지 5를 선택하고 다섯 차이를 모두 판정한다', async ({ page }) => {
  const app = createApp();
  app.prepareMatch('japanese-comics-new-stage-05');
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const { port } = server.address();
    await page.goto(`http://127.0.0.1:${port}/?matchId=japanese-comics-new-stage-05&role=p1&name=QA`);
    const card = page.locator('.stage-collection[data-collection-id="japanese-comics"] .stage-card[data-stage-id="japanese-comics-glasshouse-atelier-05"]');
    await expect(card).toBeVisible();
    await card.click();
    await expect(page.locator('#board')).toHaveAttribute('data-stage-id', 'japanese-comics-glasshouse-atelier-05');
    await expect(page.locator('#image-a')).toHaveAttribute('src', 'assets/puzzles/japanese-comics-glasshouse-atelier-05-a.png');
    await expect(page.locator('#image-b')).toHaveAttribute('src', 'assets/puzzles/japanese-comics-glasshouse-atelier-05-b.png');
    await page.waitForFunction(() => [...document.querySelectorAll('#image-a, #image-b')]
      .every((image) => image.complete && image.naturalWidth > 0));
    await page.screenshot({ path: 'tests/screenshots/japanese-comics-glasshouse-atelier-05-gameplay.png', fullPage: true });

    const stage = getStage('japanese-comics-glasshouse-atelier-05');
    const imageStage = page.locator('.picture[data-image="a"] .image-stage');
    const box = await imageStage.boundingBox();
    for (const difference of stage.differences) {
      const zone = difference.zones.a;
      await page.mouse.click(
        box.x + box.width * (zone.x + zone.w / 2),
        box.y + box.height * (zone.y + zone.h / 2),
      );
    }

    await expect(page.locator('#progress-label')).toHaveText('5 / 5');
    await expect(page.locator('#result')).toBeHidden();
    await page.screenshot({ path: 'tests/screenshots/japanese-comics-glasshouse-atelier-05-complete.png', fullPage: true });
  } finally {
    await page.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('일본 코믹스 스테이지 2를 선택하고 다섯 차이를 모두 판정한다', async ({ page }) => {
  const app = createApp();
  app.prepareMatch('japanese-comics-stage-02');
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const { port } = server.address();
    await page.goto(`http://127.0.0.1:${port}/?matchId=japanese-comics-stage-02&role=p1&name=QA`);
    const card = page.locator('.stage-collection[data-collection-id="japanese-comics"] .stage-card[data-stage-id="japanese-comics-seaside-platform-02"]');
    await expect(card).toBeVisible();
    await card.click();
    await expect(page.locator('#board')).toHaveAttribute('data-stage-id', 'japanese-comics-seaside-platform-02');
    await expect(page.locator('#image-a')).toHaveAttribute('src', 'assets/puzzles/japanese-comics-seaside-platform-02-a.png');
    await expect(page.locator('#image-b')).toHaveAttribute('src', 'assets/puzzles/japanese-comics-seaside-platform-02-b.png');
    await page.screenshot({ path: 'tests/screenshots/japanese-comics-stage-02-gameplay.png', fullPage: true });

    const stage = getStage('japanese-comics-seaside-platform-02');
    const imageStage = page.locator('.picture[data-image="a"] .image-stage');
    const box = await imageStage.boundingBox();
    for (const difference of stage.differences) {
      const zone = difference.zones.a;
      await page.mouse.click(
        box.x + box.width * (zone.x + zone.w / 2),
        box.y + box.height * (zone.y + zone.h / 2),
      );
    }

    await expect(page.locator('#progress-label')).toHaveText('5 / 5');
    await expect(page.locator('#result')).toBeHidden();
    await page.screenshot({ path: 'tests/screenshots/japanese-comics-stage-02-complete.png', fullPage: true });
  } finally {
    await page.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('일본 코믹스 스테이지 3을 선택하고 다섯 차이를 모두 판정한다', async ({ page }) => {
  const app = createApp();
  app.prepareMatch('japanese-comics-stage-03');
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const { port } = server.address();
    await page.goto(`http://127.0.0.1:${port}/?matchId=japanese-comics-stage-03&role=p1&name=QA`);
    const card = page.locator('.stage-collection[data-collection-id="japanese-comics"] .stage-card[data-stage-id="japanese-comics-rooftop-observatory-03"]');
    await expect(card).toBeVisible();
    await card.click();
    await expect(page.locator('#board')).toHaveAttribute('data-stage-id', 'japanese-comics-rooftop-observatory-03');
    await expect(page.locator('#image-a')).toHaveAttribute('src', 'assets/puzzles/japanese-comics-rooftop-observatory-03-a.png');
    await expect(page.locator('#image-b')).toHaveAttribute('src', 'assets/puzzles/japanese-comics-rooftop-observatory-03-b.png');
    await page.screenshot({ path: 'tests/screenshots/japanese-comics-stage-03-gameplay.png', fullPage: true });

    const stage = getStage('japanese-comics-rooftop-observatory-03');
    const imageStage = page.locator('.picture[data-image="a"] .image-stage');
    const box = await imageStage.boundingBox();
    for (const difference of stage.differences) {
      const zone = difference.zones.a;
      await page.mouse.click(
        box.x + box.width * (zone.x + zone.w / 2),
        box.y + box.height * (zone.y + zone.h / 2),
      );
    }

    await expect(page.locator('#progress-label')).toHaveText('5 / 5');
    await expect(page.locator('#result')).toBeHidden();
    await page.screenshot({ path: 'tests/screenshots/japanese-comics-stage-03-complete.png', fullPage: true });
  } finally {
    await page.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('일본 코믹스 스테이지 4를 선택하고 다섯 차이를 모두 판정한다', async ({ page }) => {
  const app = createApp();
  app.prepareMatch('japanese-comics-stage-04');
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const { port } = server.address();
    await page.goto(`http://127.0.0.1:${port}/?matchId=japanese-comics-stage-04&role=p1&name=QA`);
    const card = page.locator('.stage-collection[data-collection-id="japanese-comics"] .stage-card[data-stage-id="japanese-comics-summer-festival-04"]');
    await expect(card).toBeVisible();
    await card.click();
    await expect(page.locator('#board')).toHaveAttribute('data-stage-id', 'japanese-comics-summer-festival-04');
    await expect(page.locator('#image-a')).toHaveAttribute('src', 'assets/puzzles/japanese-comics-summer-festival-04-a.png');
    await expect(page.locator('#image-b')).toHaveAttribute('src', 'assets/puzzles/japanese-comics-summer-festival-04-b.png');
    await page.waitForFunction(() => [...document.querySelectorAll('#image-a, #image-b')]
      .every((image) => image.complete && image.naturalWidth > 0));
    await page.screenshot({ path: 'tests/screenshots/japanese-comics-stage-04-gameplay.png', fullPage: true });

    const stage = getStage('japanese-comics-summer-festival-04');
    const imageStage = page.locator('.picture[data-image="a"] .image-stage');
    const box = await imageStage.boundingBox();
    for (const difference of stage.differences) {
      const zone = difference.zones.a;
      await page.mouse.click(
        box.x + box.width * (zone.x + zone.w / 2),
        box.y + box.height * (zone.y + zone.h / 2),
      );
    }

    await expect(page.locator('#progress-label')).toHaveText('5 / 5');
    await expect(page.locator('#result')).toBeHidden();
    await page.screenshot({ path: 'tests/screenshots/japanese-comics-stage-04-complete.png', fullPage: true });
  } finally {
    await page.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
