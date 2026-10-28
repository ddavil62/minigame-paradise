/**
 * @fileoverview 마작 시연 영상 녹화. 가상 플레이어 2명이 런처 입장 → 대기실 준비 → 게임 방 → 첫 국 결과까지 진행한다.
 *   사용: 런처를 격리 포트로 띄운 뒤 `node mahjong/tests/record-demo.mjs [baseUrl] [outDir]`
 *   (기본 http://127.0.0.1:3055, mahjong/tests/screenshots/demo-video). 나머지 두 자리는 서버 AI가 채운다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const base = process.argv[2] || 'http://127.0.0.1:3055';
const outDir = path.resolve(process.argv[3] || 'mahjong/tests/screenshots/demo-video');
const SIZE = { width: 1280, height: 800 };
const HUMAN_THINK_MS = 1100; // 가상 플레이어의 "생각" 시간(main.js의 ?auto=N). 결과 확인 대기는 이 값의 5배

fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true });

async function newPlayer(tag) {
  const context = await browser.newContext({
    viewport: SIZE,
    recordVideo: { dir: path.join(outDir, tag), size: SIZE },
  });
  // 런처 리디렉션 URL에는 auto가 없으므로 문서 시작 시점에 붙여 가상 플레이어를 켠다.
  await context.addInitScript((think) => {
    if (location.pathname.startsWith('/mahjong/') && !location.search.includes('auto=')) {
      history.replaceState(null, '', `${location.pathname}${location.search}&auto=${think}`);
    }
  }, HUMAN_THINK_MS);
  const page = await context.newPage();
  return { context, page };
}

async function enterLobby(page, name) {
  await page.goto(base);
  await page.fill('#nickname-input', name);
  await page.click('#btn-enter-lobby');
  await page.waitForSelector('#portal-view:not(.hidden)');
  await page.locator('.game-card', { hasText: '마작' }).first().click();
  await page.waitForSelector('#waiting-room-view:not(.hidden)');
}

const host = await newPlayer('host');
const guest = await newPlayer('guest');
const t0 = Date.now();
const log = (msg) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`);

try {
  await enterLobby(host.page, '서윤');
  log('host in waiting room');
  await host.page.waitForTimeout(1200);
  await enterLobby(guest.page, '도윤');
  log('guest in waiting room');
  await host.page.waitForTimeout(1500);
  await host.page.screenshot({ path: path.join(outDir, '1-waiting-room.png') });

  await host.page.click('#btn-ready');
  await host.page.waitForTimeout(800);
  await guest.page.click('#btn-ready');
  log('both ready');

  await Promise.all([
    host.page.waitForURL(/\/mahjong\//, { timeout: 20000 }),
    guest.page.waitForURL(/\/mahjong\//, { timeout: 20000 }),
  ]);
  await host.page.waitForSelector('.setup h2');
  await guest.page.waitForSelector('.setup h2');
  log('in game room setup');
  await host.page.waitForTimeout(2500);
  await host.page.screenshot({ path: path.join(outDir, '2-room-setup.png') });

  // 방장은 리디렉션 후 먼저 접속한 사람이라 대기실 호스트와 다를 수 있다. 시작 버튼이 보이는 쪽이 방장이다.
  const owner = await Promise.race([
    host.page.waitForSelector('[data-do="start"]', { timeout: 15000 }).then(() => host),
    guest.page.waitForSelector('[data-do="start"]', { timeout: 15000 }).then(() => guest),
  ]);
  await owner.page.click('[data-do="start"]');
  log(`room owner ${owner === host ? 'host' : 'guest'} started match`);
  await host.page.waitForSelector('.board', { timeout: 15000 });
  await host.page.waitForTimeout(4000);
  await host.page.screenshot({ path: path.join(outDir, '3-play-start.png') });

  // 첫 국 결과 화면이 뜰 때까지 진행한다.
  await host.page.waitForSelector('.overlay .result', { timeout: 8 * 60 * 1000 });
  log('hand result shown');
  await host.page.waitForTimeout(4500);
  await host.page.screenshot({ path: path.join(outDir, '4-hand-result.png') });
  await guest.page.screenshot({ path: path.join(outDir, '4-hand-result-guest.png') });
  await host.page.waitForTimeout(2500);
} finally {
  const hostVideo = host.page.video();
  const guestVideo = guest.page.video();
  await host.context.close();
  await guest.context.close();
  console.log('HOST_VIDEO', await hostVideo.path());
  console.log('GUEST_VIDEO', await guestVideo.path());
  await browser.close();
}
