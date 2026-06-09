/**
 * @fileoverview 대기 화면 AI 버튼 시각 검수용 스크립트.
 *
 * 실행 전 사전 요건: `node server.js --port 3098` 가 떠 있어야 함.
 * 산출물: tests/screenshots/ai-button-waiting.png
 */

import { chromium } from 'playwright';

const URL = 'http://localhost:3098/';
const OUT = './tests/screenshots/ai-button-waiting.png';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 720, height: 900 } });
await page.goto(URL, { waitUntil: 'domcontentloaded' });

// READY 패널 노출 대기 (JOINED 응답 후 hidden 제거됨).
await page.waitForSelector('#ready-panel:not(.hidden)', { timeout: 5000 });
await page.waitForSelector('#ai-panel:not(.hidden)', { timeout: 5000 });

// 대기 카드 영역만 캡처 (전체 화면 대비 검수 효율).
const card = await page.$('.waiting-card');
await card.screenshot({ path: OUT });
console.log('[screenshot] saved:', OUT);

await browser.close();
process.exit(0);
