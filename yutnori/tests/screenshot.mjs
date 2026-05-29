// 빠른 시각 검증 — 보드 + 대기 화면 캡처
import { chromium } from 'playwright';

const URL = 'http://localhost:3088/';

const browser = await chromium.launch();
const ctx1 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });

const page1 = await ctx1.newPage();
const page2 = await ctx2.newPage();

page1.on('pageerror', (e) => console.error('page1 error:', e.message));
page2.on('pageerror', (e) => console.error('page2 error:', e.message));

await page1.goto(URL);
await page1.waitForTimeout(800);
await page1.screenshot({ path: 'tests/screenshots/01-p1-waiting.png' });

await page2.goto(URL);
await page2.waitForTimeout(800);
await page2.screenshot({ path: 'tests/screenshots/02-p2-joined.png' });

// 양쪽 READY
await page1.click('#ready-btn');
await page1.waitForTimeout(200);
await page2.click('#ready-btn');
await page2.waitForTimeout(4500); // 카운트다운 3초 + 여유

await page1.screenshot({ path: 'tests/screenshots/03-p1-board.png' });

// p1이 윷 던지기
await page1.click('#throw-btn').catch((e) => console.log('throw1 err:', e.message));
await page1.waitForTimeout(800);
await page1.screenshot({ path: 'tests/screenshots/04-p1-after-throw.png' });

// 결과 칩 클릭
const chips = await page1.locator('.result-chip').all();
if (chips.length > 0) {
  await chips[0].click();
  await page1.waitForTimeout(300);
}
await page1.screenshot({ path: 'tests/screenshots/05-p1-chip-selected.png' });

// 보드 클릭 (HOME 영역 자동 선택을 위해 좌하 영역 클릭)
const boardBox = await page1.locator('#board-canvas').boundingBox();
if (boardBox) {
  // 좌하 코너 안쪽 (HOME 영역)
  await page1.mouse.click(boardBox.x + 30, boardBox.y + boardBox.height - 30);
  await page1.waitForTimeout(500);
}
await page1.screenshot({ path: 'tests/screenshots/06-p1-after-move.png' });

await browser.close();
console.log('스크린샷 6개 저장 완료');
