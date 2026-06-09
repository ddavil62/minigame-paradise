/**
 * @fileoverview UX 개선 시각 검증 스크린샷 — 실시간 keep 동기화 + 카테고리 강조.
 *
 * 시나리오:
 *   1) 두 페이지(p1, p2) 동시 열고 READY → 게임 시작
 *   2) p1이 굴리기 → keep 토글 2개
 *   3) p2 페이지에서 "상대 KEEP" 시각이 보이는지 캡처
 *   4) p1이 카테고리 선택 → p2 페이지에서 강조 애니메이션 진행 중 캡처
 *
 * 실행 전: node server.js --port 3097
 *   (사용자 launcher 3000과 충돌 없음, 작업용 포트.)
 */
import { chromium } from 'playwright';

const PORT = 3097;
const BASE = `http://localhost:${PORT}/`;
const OUT = 'tests/screenshots';

async function main() {
  const browser = await chromium.launch();
  const ctx1 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const p1 = await ctx1.newPage();
  const p2 = await ctx2.newPage();

  // 동시 진입.
  await Promise.all([p1.goto(BASE), p2.goto(BASE)]);
  await Promise.all([
    p1.waitForSelector('#ready-btn'),
    p2.waitForSelector('#ready-btn'),
  ]);
  await Promise.all([
    p1.click('#ready-btn'),
    p2.click('#ready-btn'),
  ]);
  // 게임 화면 전환 대기.
  await Promise.all([
    p1.waitForSelector('#screen-game:not(.hidden)'),
    p2.waitForSelector('#screen-game:not(.hidden)'),
  ]);

  // p1이 1차 굴리기.
  await p1.click('#btn-roll');
  // 다이스 컵 애니메이션 + 착지(약 1.6초) 대기.
  await p1.waitForTimeout(1800);

  // p1이 idx=0, idx=2 keep 토글.
  const dice0 = await p1.locator('#dice-area .die').nth(0);
  const dice2 = await p1.locator('#dice-area .die').nth(2);
  await dice0.click();
  await p1.waitForTimeout(150);
  await dice2.click();
  await p1.waitForTimeout(400); // 서버 STATE 브로드캐스트 대기.

  // p2 페이지에서 "상대 KEEP" 시각이 보이는지 캡처.
  await p2.screenshot({ path: `${OUT}/live-keep-opponent-view.png`, fullPage: false });
  console.log('[shot] live-keep-opponent-view.png — p2 시점에서 상대 KEEP 시각');

  // p1 페이지도 캡처(기존 본인 KEEP 시각 — 회귀 확인용).
  await p1.screenshot({ path: `${OUT}/live-keep-my-view.png`, fullPage: false });
  console.log('[shot] live-keep-my-view.png — p1 시점에서 본인 KEEP 시각');

  // 카테고리 강조 — p1이 chance(맨 아래) 선택.
  // scoreboard에서 p1의 chance 셀 클릭.
  const p1ChanceCell = p1.locator('.score-cell[data-pid="p1"][data-category="chance"]');
  await p1ChanceCell.click();
  // 강조 애니메이션 0~1.4초. 0.25초 시점에 캡처(피크 부근).
  await p2.waitForTimeout(250);
  await p2.screenshot({ path: `${OUT}/live-flash-opponent-view.png`, fullPage: false });
  console.log('[shot] live-flash-opponent-view.png — p2 시점에서 카테고리 강조 진행 중');
  await p1.waitForTimeout(50);
  await p1.screenshot({ path: `${OUT}/live-flash-my-view.png`, fullPage: false });
  console.log('[shot] live-flash-my-view.png — p1 시점에서 자기 카테고리 강조');

  await browser.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
