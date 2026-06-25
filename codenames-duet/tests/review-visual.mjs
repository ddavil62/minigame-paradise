/**
 * @fileoverview 복기 모드 UI 시각 검증 (Playwright).
 *
 * 검증:
 *   - 결과 모달에 "복기 보기" 버튼이 표시된다.
 *   - 버튼 클릭 시 모달이 닫히고 복기 배너가 노출된다.
 *   - 보드 25칸 모두에 my/op 점 2개씩 그려진다.
 *   - 복기 모드에서 카드를 클릭해도 게임 액션이 발생하지 않는다 (서버 비공개 카드가 그대로 유지됨).
 *   - "결과 다시 보기" 클릭 → 모달 재오픈 + 배너 사라짐.
 *
 * 실행: node minigames/codenames-duet/tests/review-visual.mjs
 *       (3098 포트로 서버 inline 부팅, launcher와 격리)
 */

import http from 'http';
import { chromium } from 'playwright';
import { createApp } from '../server.js';

const PORT = 3098;
const URL  = `http://127.0.0.1:${PORT}/`;
const SHOT_DIR = 'C:/LazySlimeStudio/minigames/codenames-duet/tests/screenshots';

let passed = 0, failed = 0;
const failures = [];
function assert(cond, label) {
  if (cond) { passed += 1; console.log(`  PASS  ${label}`); }
  else      { failed += 1; failures.push(label); console.log(`  FAIL  ${label}`); }
}

// ── 서버 부팅 ────────────────────────────────────────────────
const app = createApp();
const server = http.createServer(app.handleHttp);
server.on('upgrade', app.handleUpgrade);
await new Promise((res) => server.listen(PORT, '127.0.0.1', res));
console.log(`[visual] server up on ${PORT}`);

// 스크린샷 디렉토리 보장
import { mkdirSync } from 'fs';
mkdirSync(SHOT_DIR, { recursive: true });

const browser = await chromium.launch({ headless: true });
const ctxA = await browser.newContext();
const ctxB = await browser.newContext();
const pageA = await ctxA.newPage();
const pageB = await ctxB.newPage();

// 두 페이지 동시 접속 (URL ?name= 파라미터로 닉네임 자동 처리 → 즉시 JOIN)
await Promise.all([
  pageA.goto(URL + '?name=ReviewA'),
  pageB.goto(URL + '?name=ReviewB'),
]);
// 양쪽 READY 버튼 표시 대기 후 동시 클릭
await Promise.all([
  pageA.waitForSelector('#btn-ready', { state: 'visible', timeout: 8000 }),
  pageB.waitForSelector('#btn-ready', { state: 'visible', timeout: 8000 }),
]);
await Promise.all([
  pageA.click('#btn-ready'),
  pageB.click('#btn-ready'),
]);
// 게임 시작 후 보드 표시 + 턴 상태 도달 대기
await pageA.waitForFunction(() => {
  const t = document.getElementById('turn-status');
  return t && (t.textContent.includes('단서') || t.textContent.includes('시작') || t.textContent.includes('추측'));
}, { timeout: 10000 });

// 게임 종료까지 빠르게: 양쪽이 PASS 9회 → lost/tokens
async function whoseTurn(page) {
  return await page.evaluate(() => document.getElementById('turn-status').textContent);
}

// 페이지를 통해 ws 메시지를 직접 보내는 게 가장 빠름 → window.ws는 closure에 갇혀있으므로
// 대신 화면 버튼을 사용한다. p1이 단서 입력 → p2가 패스 반복.
async function submitClueIfMine(page, word) {
  // 단서 입력 패널이 활성화돼 있으면 입력
  const can = await page.evaluate(() => !document.getElementById('btn-clue').disabled);
  if (!can) return false;
  await page.fill('#clue-word', word);
  await page.fill('#clue-number', '1');
  await page.click('#btn-clue');
  return true;
}
async function passIfMine(page) {
  const can = await page.evaluate(() => !document.getElementById('btn-pass').disabled);
  if (!can) return false;
  // confirm 다이얼로그 자동 수락
  page.once('dialog', (d) => d.accept());
  await page.click('#btn-pass');
  return true;
}

// 최대 30회까지 시도하여 GAME_END 발생시키기
for (let i = 0; i < 30; i++) {
  // 양쪽 모두에 대해 가능한 액션 수행
  const aClued = await submitClueIfMine(pageA, `T${i}A`);
  const bClued = await submitClueIfMine(pageB, `T${i}B`);
  await pageA.waitForTimeout(80);
  const aPassed = await passIfMine(pageA);
  const bPassed = await passIfMine(pageB);
  await pageA.waitForTimeout(120);
  // 결과 모달이 떴는지 확인
  const opened = await pageA.evaluate(() => {
    const m = document.getElementById('modal');
    return m && !m.classList.contains('hidden');
  });
  if (opened) break;
}

const modalOpen = await pageA.evaluate(() => !document.getElementById('modal').classList.contains('hidden'));
assert(modalOpen, '결과 모달이 표시됨');

const reviewBtnVisible = await pageA.evaluate(() => {
  const btn = document.getElementById('btn-review');
  return btn && getComputedStyle(btn).display !== 'none';
});
assert(reviewBtnVisible, '결과 모달에 "복기 보기" 버튼이 표시됨');

// 모달 스크린샷 (스펙 검증용)
await pageA.screenshot({ path: `${SHOT_DIR}/01-result-modal.png`, fullPage: false });

// "복기 보기" 클릭
await pageA.click('#btn-review');
await pageA.waitForTimeout(200);

const modalClosed = await pageA.evaluate(() => document.getElementById('modal').classList.contains('hidden'));
assert(modalClosed, '복기 버튼 클릭 후 모달이 닫힘');

const bannerVisible = await pageA.evaluate(() => {
  const b = document.getElementById('review-banner');
  return b && !b.classList.contains('hidden');
});
assert(bannerVisible, '복기 배너가 표시됨');

// 25칸 모두에 review-dot 2개 (my + op)
const dotCount = await pageA.evaluate(() => {
  const cards = document.querySelectorAll('#board .card');
  let total = 0;
  let cellsWithBothDots = 0;
  for (const c of cards) {
    const my = c.querySelector('.review-dot.my');
    const op = c.querySelector('.review-dot.op');
    if (my && op) cellsWithBothDots += 1;
    total += (my ? 1 : 0) + (op ? 1 : 0);
  }
  return { total, cellsWithBothDots, cardCount: cards.length };
});
assert(dotCount.cardCount === 25, '보드 카드 25개');
assert(dotCount.cellsWithBothDots === 25, '모든 카드에 my+op 점 2개 그려짐');

// 모든 점에 정상 색상 클래스
const colorOk = await pageA.evaluate(() => {
  const valid = new Set(['green', 'neutral', 'assassin']);
  for (const dot of document.querySelectorAll('#board .card .review-dot')) {
    const cls = [...dot.classList];
    if (!cls.some((c) => valid.has(c))) return false;
  }
  return true;
});
assert(colorOk, '모든 점에 색상 클래스(green/neutral/assassin) 부여');

// 복기 모드 보드 스크린샷
await pageA.screenshot({ path: `${SHOT_DIR}/02-review-board.png`, fullPage: false });

// 복기 모드에서 카드 클릭 → 게임 입력 안 됨 (revealed 변화 없어야 함)
const before = await pageA.evaluate(() => {
  return Array.from(document.querySelectorAll('#board .card')).map((c) => c.className).join('|');
});
await pageA.click('#board .card:nth-child(1)');
await pageA.waitForTimeout(150);
const after = await pageA.evaluate(() => {
  return Array.from(document.querySelectorAll('#board .card')).map((c) => c.className).join('|');
});
assert(before === after, '복기 모드에서 카드 클릭이 게임 액션을 트리거하지 않음');

// "결과 다시 보기" 클릭 → 배너 사라지고 모달 재오픈
await pageA.click('#btn-review-close');
await pageA.waitForTimeout(200);
const bannerHiddenAgain = await pageA.evaluate(() => document.getElementById('review-banner').classList.contains('hidden'));
assert(bannerHiddenAgain, '"결과 다시 보기" 클릭 시 배너 숨김');
const modalReopen = await pageA.evaluate(() => !document.getElementById('modal').classList.contains('hidden'));
assert(modalReopen, '"결과 다시 보기" 클릭 시 모달 재오픈');

// review-grid가 정리됐는지 확인 (다음 STATE/GAME_START 이후 깔끔)
const gridLeft = await pageA.evaluate(() => document.querySelectorAll('#board .card .review-grid').length);
assert(gridLeft === 0, '복기 종료 후 review-grid DOM 청소됨');

await browser.close();
server.close();

console.log(`\n총: ${passed + failed}건  PASS: ${passed}  FAIL: ${failed}`);
if (failed > 0) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('ALL PASS');
process.exit(0);
