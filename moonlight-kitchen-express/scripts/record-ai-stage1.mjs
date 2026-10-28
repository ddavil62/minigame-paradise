/** @fileoverview 실제 서버의 AI 대 AI 스테이지 1 운행을 1280×720 WebM으로 녹화한다. */
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { createApp } from '../server.js';

const projectRoot = path.resolve(import.meta.dirname, '..');
const outputDir = path.join(projectRoot, 'tests', 'videos');
const finalVideo = path.join(outputDir, 'moonlight-kitchen-ai-stage1-1280x720.webm');
const posterPath = path.join(outputDir, 'moonlight-kitchen-ai-stage1-poster.png');
await fs.mkdir(outputDir, { recursive: true });

const app = createApp();
const server = http.createServer(app.handleHttp);
server.on('upgrade', app.handleUpgrade);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: outputDir, size: { width: 1280, height: 720 } }
});
const page = await context.newPage();
const video = page.video();

try {
  await page.goto(`http://127.0.0.1:${port}/?name=Stage1Recorder&role=p1`, { waitUntil: 'networkidle' });
  await page.locator('#watch-ai').click();
  await page.waitForFunction(() => document.body.classList.contains('watch-mode') && window.__kitchenState?.snapshot?.aiPlayers?.length === 2);
  await page.waitForTimeout(80_000);
  await page.screenshot({ path: posterPath });
  await page.waitForTimeout(55_000);
} finally {
  await page.close();
  await context.close();
  await browser.close();
  app.close();
  await new Promise((resolve) => server.close(resolve));
}

const temporaryVideo = await video.path();
await fs.rm(finalVideo, { force: true });
await fs.rename(temporaryVideo, finalVideo);
process.stdout.write(`${finalVideo}\n${posterPath}\n`);
