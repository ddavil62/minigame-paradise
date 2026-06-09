/**
 * @fileoverview UX 개선 시각 검증 — 지속형 카테고리 강조(.scored-persistent).
 *
 * 시나리오:
 *   1) 두 페이지 동시 진입 → READY → 게임 시작
 *   2) p1이 1차 굴리기 → 어떤 카테고리 1개 선택 (예: aces)
 *   3) 1.6초 대기(애니메이션 종료 후) → 양쪽 시점 캡처 — 셀에 빨강 지속 강조가 남아있어야 함
 *   4) p2가 1차 굴리기 → 카테고리 1개 선택 (예: twos)
 *   5) 1.6초 대기 → 양쪽 시점 캡처 — p2의 twos에 지속 강조, p1의 aces도 여전히 지속 강조 유지
 *   6) p1이 다시 1차 굴리기 → 다른 카테고리(threes) 선택
 *   7) 1.6초 대기 → 캡처 — p1의 aces 강조는 사라지고 p1의 threes에 강조 (본인 직전 선택 갱신)
 *
 * 실행 전: node server.js --port 3097
 */
import { chromium } from 'playwright';

const PORT = 3097;
const BASE = `http://localhost:${PORT}/`;
const OUT = 'tests/screenshots';

async function rollAndScore(page, category) {
  // 1차 굴리기
  await page.click('#btn-roll');
  await page.waitForTimeout(1700); // 컵 애니메이션 + 착지 대기
  // 카테고리 셀 클릭 (preview 상태일 때만 클릭 가능)
  await page.locator(`.score-cell[data-pid="${await myId(page)}"][data-category="${category}"]`).click();
  await page.waitForTimeout(200); // STATE 브로드캐스트 대기
}

async function myId(page) {
  // #player-label 텍스트로 p1/p2 판정 (예: "P1 (호스트)" / "P2 (게스트)")
  const txt = await page.locator('#player-label').textContent();
  return txt.includes('P1') ? 'p1' : 'p2';
}

async function main() {
  const browser = await chromium.launch();
  const ctx1 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const p1 = await ctx1.newPage();
  const p2 = await ctx2.newPage();

  await Promise.all([p1.goto(BASE), p2.goto(BASE)]);
  await Promise.all([p1.waitForSelector('#ready-btn'), p2.waitForSelector('#ready-btn')]);
  await Promise.all([p1.click('#ready-btn'), p2.click('#ready-btn')]);
  await Promise.all([
    p1.waitForSelector('#screen-game:not(.hidden)'),
    p2.waitForSelector('#screen-game:not(.hidden)'),
  ]);

  // 누가 선공인지 확인 (서버가 랜덤 결정 가능). 이번 스크립트는 p1 선공 가정.
  // 만약 p2 선공이면 첫 굴리기는 p2부터 진행해야 함.
  const id1 = await myId(p1);
  console.log(`[info] p1 page id=${id1}`);

  // ── 1단계: p1이 aces 선택 ──
  await rollAndScore(p1, 'aces');
  // 애니메이션 종료(1.5초 + 여유) 후 캡처 — 이때 .scored-flash는 제거되고 .scored-persistent만 남아야 함
  await p1.waitForTimeout(1800);
  await p1.screenshot({ path: `${OUT}/persistent-step1-p1view.png`, fullPage: false });
  await p2.screenshot({ path: `${OUT}/persistent-step1-p2view.png`, fullPage: false });
  console.log('[shot] step1: p1이 aces 선택 → 1.8초 후 양쪽 시점 캡처 (지속 강조 확인)');

  // ── 2단계: p2가 twos 선택 ──
  await rollAndScore(p2, 'twos');
  await p2.waitForTimeout(1800);
  await p1.screenshot({ path: `${OUT}/persistent-step2-p1view.png`, fullPage: false });
  await p2.screenshot({ path: `${OUT}/persistent-step2-p2view.png`, fullPage: false });
  console.log('[shot] step2: p2가 twos 선택 → p1.aces와 p2.twos 둘 다 지속 강조 유지');

  // ── 3단계: p1이 threes 선택 ──
  await rollAndScore(p1, 'threes');
  await p1.waitForTimeout(1800);
  await p1.screenshot({ path: `${OUT}/persistent-step3-p1view.png`, fullPage: false });
  await p2.screenshot({ path: `${OUT}/persistent-step3-p2view.png`, fullPage: false });
  console.log('[shot] step3: p1이 threes 선택 → p1.aces 강조 사라지고 p1.threes에 강조 갱신');

  // ── 검증: DOM에서 .scored-persistent 클래스 셀 카운트 ──
  const persistentCount = async (page) => await page.evaluate(() => {
    return document.querySelectorAll('.score-cell.scored-persistent').length;
  });
  const c1 = await persistentCount(p1);
  const c2 = await persistentCount(p2);
  console.log(`[check] p1 페이지 .scored-persistent 셀 수: ${c1} (기대: 2 — p1.threes + p2.twos)`);
  console.log(`[check] p2 페이지 .scored-persistent 셀 수: ${c2} (기대: 2 — p1.threes + p2.twos)`);

  const persistentCats = async (page) => await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.score-cell.scored-persistent'))
      .map((el) => `${el.dataset.pid}:${el.dataset.category}`)
      .sort();
  });
  const cats1 = await persistentCats(p1);
  const cats2 = await persistentCats(p2);
  console.log(`[check] p1 페이지 강조 셀: ${JSON.stringify(cats1)}`);
  console.log(`[check] p2 페이지 강조 셀: ${JSON.stringify(cats2)}`);

  const expected = ['p1:threes', 'p2:twos'];
  const ok1 = JSON.stringify(cats1) === JSON.stringify(expected);
  const ok2 = JSON.stringify(cats2) === JSON.stringify(expected);
  console.log(`[result] p1 시점 ${ok1 ? 'PASS' : 'FAIL'}, p2 시점 ${ok2 ? 'PASS' : 'FAIL'}`);

  await browser.close();
  if (!ok1 || !ok2) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
