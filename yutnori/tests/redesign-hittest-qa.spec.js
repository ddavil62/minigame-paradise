/**
 * @fileoverview 재디자인 QA — 2단 레이아웃 + resizeBoard 후 보드 클릭 hit-test 좌표 정확성 검증.
 *
 * 핵심 의심: ui.js resizeBoard()가 canvas.width를 BOARD_SIZE(560)이 아닌
 * 내부 해상도(avail*dpr)로 설정한다. main.js 클릭 핸들러는
 *   x = (clientX-rect.left) * (canvas.width/rect.width)
 * 로 매핑하므로 결과 좌표가 내부 픽셀 공간(0~avail*dpr)이 된다.
 * 반면 board.js hitTestCell/cellToCoord는 BOARD_SIZE(560) 좌표를 기대한다.
 * 두 공간이 다르면 말 클릭 hit-test가 어긋난다.
 *
 * 서버 필요 (3088) — http로 열어야 ES 모듈(board.js) import 가능.
 */
import { test, expect } from 'playwright/test';

const VIEWPORTS = [
  { w: 1440, h: 900, name: '1440x900' },
  { w: 1280, h: 800, name: '1280x800' },
  { w: 1100, h: 800, name: '1100x800' },
];

for (const vp of VIEWPORTS) {
  test(`HT: 보드 클릭 hit-test 좌표계 정확성 (${vp.name})`, async ({ page }) => {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await page.goto('/');
    await page.waitForTimeout(400); // resizeBoard rAF settle

    const result = await page.evaluate(async () => {
      const board = await import('./js/board.js');
      const BOARD_SIZE = board.BOARD_SIZE; // 560 — main.js 클릭 핸들러가 쓰는 좌표계
      const cv = document.getElementById('board-canvas');
      const rect = cv.getBoundingClientRect();
      // main.js 보드 클릭 핸들러와 동일한 매핑: CSS 표시 좌표 → BOARD_SIZE(560) 좌표계.
      // (이전 버그: cv.width/rect.width — resizeBoard가 canvas.width를 dpr 내부 해상도로
      //  키운 뒤로는 ≈1.0이 되어 화면 픽셀이 그대로 hitTest로 들어가 어긋났다.)
      const scaleX = BOARD_SIZE / rect.width;
      const scaleY = BOARD_SIZE / rect.height;

      const targets = [0, 5, 10, 15, 23];
      const out = [];
      for (const cell of targets) {
        const coord = board.cellToCoord(cell);
        // 이 셀이 화면(viewport)상 어디에 그려지는가 (렌더는 BOARD_SIZE 560 좌표를 표시폭으로 스케일)
        const screenX = rect.left + coord.x * (rect.width / 560);
        const screenY = rect.top + coord.y * (rect.height / 560);
        // 사용자가 그 위치를 클릭하면 main.js가 계산하는 hit-test 좌표
        const mappedX = (screenX - rect.left) * scaleX;
        const mappedY = (screenY - rect.top) * scaleY;
        const hit = board.hitTestCell(mappedX, mappedY, 30);
        out.push({
          cell,
          coord: { x: Math.round(coord.x), y: Math.round(coord.y) },
          mapped: { x: Math.round(mappedX), y: Math.round(mappedY) },
          hitCell: hit ? hit.cell : null,
          correct: hit ? hit.cell === cell : false,
        });
      }
      return { scaleX, internalW: cv.width, displayW: Math.round(rect.width), dpr: window.devicePixelRatio || 1, out };
    });

    console.log(`[${result.displayW}px disp / ${result.internalW}px int / dpr=${result.dpr} / scaleX=${result.scaleX.toFixed(3)}]`);
    for (const r of result.out) {
      console.log(`  cell ${r.cell}: coord(${r.coord.x},${r.coord.y}) -> mapped(${r.mapped.x},${r.mapped.y}) -> hit=${r.hitCell} ${r.correct ? 'OK' : 'MISS'}`);
    }

    const allCorrect = result.out.every((r) => r.correct);
    expect(allCorrect, '모든 모서리/중앙 셀 클릭이 올바른 셀로 hit-test되어야 함').toBe(true);
  });
}

// ── 실제 브라우저 클릭으로 말 이동 검증 (end-to-end) ──
test('HT-E2E: 보드 위 말을 실제 클릭하면 이동한다 (cell 7에 말 배치 후 화면 위치 클릭)', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p1 = await context.newPage();
  const p2 = await context.newPage();
  await p1.goto('/');
  await p2.goto('/');
  for (const pg of [p1, p2]) {
    await pg.waitForFunction(() => {
      const el = document.getElementById('player-label');
      return el && el.textContent && !el.textContent.includes('접속 중');
    }, { timeout: 5000 });
  }
  await p1.click('#ready-btn');
  await p2.click('#ready-btn');
  await p1.waitForFunction(() => {
    const b = document.getElementById('throw-btn');
    return b && document.getElementById('ready-status')?.classList.contains('hidden');
  }, { timeout: 8000 });
  await p1.waitForTimeout(300);

  // P1 차례 + 결과 큐에 '도' + P1 말 하나를 cell 7(상단 외곽, 비-모서리)에 배치.
  // 모서리(5/10)·중앙(23)은 이동 시 분기 모달(BRANCH_REQUEST)이 떠 '도'가 즉시 소비되지
  // 않으므로(분기 대기), hit-test 정확성만 격리 검증하려면 분기 없는 일반 칸을 써야 한다.
  // 나머지 3개는 done=true → HOME 폴백이 없어, 클릭이 cell 7을 빗나가면
  // 이동할 말이 전혀 없어 '도'가 큐에 남는다(폴백 구제 차단).
  await p1.request.post('/test/inject', {
    data: {
      started: true,
      currentTurn: 'p1',
      pendingResults: ['do'],
      awaitingBranchAt: null,
      pieces: {
        p1: [{ cell: 7 }, { cell: 1, done: true }, { cell: 2, done: true }, { cell: 3, done: true }],
        p2: [{ cell: -1 }, { cell: -1 }, { cell: -1 }, { cell: -1 }],
      },
    },
  });
  await p1.waitForTimeout(400);

  // P1 페이지에서 '도' 칩 선택
  await p1.click('.result-chip');
  await p1.waitForTimeout(150);

  // cell 7의 화면 위치를 계산해 실제 마우스 클릭
  const click = await p1.evaluate(async () => {
    const board = await import('./js/board.js');
    const cv = document.getElementById('board-canvas');
    const rect = cv.getBoundingClientRect();
    const coord = board.cellToCoord(7); // BOARD_SIZE 좌표
    const screenX = rect.left + coord.x * (rect.width / 560);
    const screenY = rect.top + coord.y * (rect.height / 560);
    return { x: screenX, y: screenY };
  });
  // 토스트 캡처 (이동 실패 시 "이동할 말을 클릭하세요" 표시)
  let toastText = '';
  await p1.evaluate(() => {
    window.__qaToasts = [];
    const t = document.getElementById('toast');
    const obs = new MutationObserver(() => {
      if (t.classList.contains('show')) window.__qaToasts.push(t.textContent);
    });
    obs.observe(t, { attributes: true, childList: true, subtree: true });
  });
  await p1.mouse.click(click.x, click.y);
  await p1.waitForTimeout(600);
  toastText = (await p1.evaluate(() => (window.__qaToasts || []).join(' | '))) || '';
  console.log('토스트:', JSON.stringify(toastText));

  // 말이 cell 7에서 이동했는지 확인 (도=1칸 → 8)
  const moved = await p1.evaluate(async () => {
    // game 상태는 window에 노출 안 됨 → 다시 inject 조회 대신 STATE는 net 통해 갱신.
    // 보드 위 piece 위치는 game.js 캐시에 있으나 비공개. 대신 toast/큐로 판정.
    const queue = document.getElementById('result-queue')?.textContent || '';
    return { queueText: queue.trim() };
  });
  console.log('클릭 후 결과 큐:', JSON.stringify(moved.queueText));

  // 이동 성공 시 '도'가 소비되어 큐가 '없음'이 된다.
  // hit-test 버그로 클릭이 빗나가면 '도'가 그대로 남거나 "이동할 말을 클릭" 토스트가 뜬다.
  await context.close();
  expect(moved.queueText, "cell 7 말 클릭 후 '도'가 소비되어 큐가 비어야 함(이동 성공)").toContain('없음');
});
