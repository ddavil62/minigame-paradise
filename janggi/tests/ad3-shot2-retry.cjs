const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ssDir = 'minigame-paradise/janggi/tests/screenshots';
  
  const ctx1 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page1 = await ctx1.newPage();
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page2 = await ctx2.newPage();

  await Promise.all([
    page1.goto('http://localhost:3006/?side=han'),
    page2.goto('http://localhost:3006/?side=cho'),
  ]);
  await page1.waitForTimeout(2500);

  // cho가 MSMS 선택
  await page2.click('button[data-setup="MSMS"]');
  await page2.waitForTimeout(800);
  
  // han이 MSMS 선택
  await page1.click('button[data-setup="MSMS"]');
  await page1.waitForTimeout(2500);

  // 모달이 사라졌는지 확인
  const setupHidden = await page1.evaluate(function() {
    return document.getElementById('setup-modal').hidden;
  });
  console.log('setup modal hidden (playing):', setupHidden);

  // 기물 수 재확인
  const pieceCount = await page1.evaluate(function() {
    return document.querySelectorAll('.janggi-piece').length;
  });
  console.log('기물 수:', pieceCount);

  // SHOT-2-retry: playing 초기 보드
  await page1.screenshot({ path: ssDir + '/ad3-shot2-playing-board.png', fullPage: false });
  console.log('SHOT-2-retry 완료');

  // 기물 클릭 시도 — page1이 han이고 현재 턴 확인
  const turnInfo = await page1.evaluate(function() {
    // 클릭 가능한 기물 찾기
    const clickable = document.querySelectorAll('.janggi-piece.clickable');
    return { clickableCount: clickable.length };
  });
  console.log('클릭 가능 기물 수:', JSON.stringify(turnInfo));

  // 첫 번째 클릭 가능 기물 클릭
  const firstClickable = await page1.locator('.janggi-piece.clickable').first();
  const count = await firstClickable.count();
  if (count > 0) {
    await firstClickable.click();
    await page1.waitForTimeout(1000);
    console.log('기물 클릭 완료');
  }

  // SHOT-3-retry: 하이라이트
  await page1.screenshot({ path: ssDir + '/ad3-shot3-highlight-retry.png', fullPage: false });
  console.log('SHOT-3-retry 완료');

  const highlightCount = await page1.evaluate(function() {
    return {
      move: document.querySelectorAll('.highlight-move').length,
      capture: document.querySelectorAll('.highlight-capture').length,
      self: document.querySelectorAll('.highlight-self').length,
    };
  });
  console.log('하이라이트 수:', JSON.stringify(highlightCount));

  // 강 띠 영역 확인 (Canvas 픽셀로 검증)
  const riverCheck = await page1.evaluate(function() {
    // rank 4~5 사이: y = PAD_Y + 4 * CELL = 48 + 256 = 304 ~ 304 + 64 = 368
    // 강 중앙 y = 336
    // 강 띠 색 = rgba(70,110,160,0.18)
    const canvas = document.getElementById('janggi-board');
    const ctx = canvas.getContext('2d');
    // 강 중앙 픽셀 색 샘플 (x=100, y=336)
    const pxRiver = ctx.getImageData(100, 336, 1, 1).data;
    // 격자 영역 픽셀 (x=100, y=200)
    const pxGrid = ctx.getImageData(100, 200, 1, 1).data;
    return {
      riverPixel: [pxRiver[0], pxRiver[1], pxRiver[2], pxRiver[3]],
      gridPixel: [pxGrid[0], pxGrid[1], pxGrid[2], pxGrid[3]],
    };
  });
  console.log('강 픽셀 색 (r,g,b,a):', JSON.stringify(riverCheck.riverPixel));
  console.log('격자 픽셀 색 (r,g,b,a):', JSON.stringify(riverCheck.gridPixel));

  // 궁성 대각선 영역 픽셀 확인 (한 궁성 대각선: file3,rank0 → file5,rank2)
  // file3,rank0 → file5,rank2: (40+3*64, 48+0) → (40+5*64, 48+2*64) = (232,48) → (360,176)
  // 중간점 x=296, y=112
  const palaceCheck = await page1.evaluate(function() {
    const canvas = document.getElementById('janggi-board');
    const ctx = canvas.getContext('2d');
    // 궁성 대각선 중간점
    const pxDiag = ctx.getImageData(296, 112, 1, 1).data;
    // 주변 일반 보드 색
    const pxBoard = ctx.getImageData(296, 50, 1, 1).data;
    return {
      diagPixel: [pxDiag[0], pxDiag[1], pxDiag[2], pxDiag[3]],
      boardPixel: [pxBoard[0], pxBoard[1], pxBoard[2], pxBoard[3]],
    };
  });
  console.log('궁성 대각선 픽셀:', JSON.stringify(palaceCheck.diagPixel));
  console.log('보드 배경 픽셀:', JSON.stringify(palaceCheck.boardPixel));

  // SHOT-4-retry: 전체 레이아웃
  await page1.screenshot({ path: ssDir + '/ad3-shot4-full-layout.png', fullPage: false });
  console.log('SHOT-4-retry 완료');

  // cho(page2) 기물 클릭 → 하이라이트 확인
  await page2.waitForTimeout(1500);
  const cho_clickable = await page2.locator('.janggi-piece.clickable').count();
  console.log('cho 클릭 가능 기물 수:', cho_clickable);

  await browser.close();
  console.log('완료');
})().catch(function(e) {
  console.error('ERROR:', e.message);
  process.exit(1);
});
