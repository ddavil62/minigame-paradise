/**
 * @fileoverview ?mode=ai 진입 시 봇이 자동 spawn되어 게임 화면으로 넘어가는지 확인.
 * 실행: 사전에 `node server.js --port 3098` 떠 있어야 함.
 */
import { chromium } from 'playwright';

const URL = 'http://localhost:3098/?mode=ai';
const OUT_GAME = './tests/screenshots/ai-mode-game-start.png';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(URL, { waitUntil: 'domcontentloaded' });

// 봇이 connect + JOIN + READY까지 마칠 시간을 약간 확보 후 사람도 READY 클릭.
await page.waitForSelector('#ready-btn', { timeout: 5000 });
await page.waitForTimeout(1500);
await page.click('#ready-btn');

// 봇 spawn 후 양쪽 READY → START. 게임 화면(#screen-game) 표시 대기.
try {
  await page.waitForSelector('#screen-game:not(.hidden)', { timeout: 10000 });
  console.log('[ai-mode] 게임 화면 진입 확인');
} catch (e) {
  console.error('[ai-mode] 게임 진입 실패:', e.message);
  await page.screenshot({ path: './tests/screenshots/ai-mode-failed.png', fullPage: true });
  await browser.close();
  process.exit(1);
}

await page.screenshot({ path: OUT_GAME, fullPage: false });
console.log('[screenshot] saved:', OUT_GAME);

await browser.close();
process.exit(0);
