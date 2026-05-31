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
  await page2.waitForTimeout(2500);

  // SHOT-1: 배치 선택 모달 (cho 탭 = page2)
  await page2.screenshot({ path: ssDir + '/ad3-shot1-setup-modal-cho.png', fullPage: false });
  console.log('SHOT-1 완료');

  // cho 쪽에서 MSMS 선택
  await page2.click('button[data-setup="MSMS"]');
  await page2.waitForTimeout(1000);

  // han 쪽 모달도 표시 확인 후 MSMS 선택
  const hanModalHidden = await page1.evaluate(function() {
    const m = document.getElementById('setup-modal');
    return m ? m.hidden : true;
  });
  console.log('han 모달 hidden after cho selection:', hanModalHidden);
  if (!hanModalHidden) {
    await page1.click('button[data-setup="MSMS"]');
    await page1.waitForTimeout(500);
  }

  await page1.waitForTimeout(2000);
  await page2.waitForTimeout(2000);

  // SHOT-2: playing 상태 초기 보드 (page1 한 진영)
  await page1.screenshot({ path: ssDir + '/ad3-shot2-playing-board-han.png', fullPage: false });
  console.log('SHOT-2 완료');

  // 캔버스 크기 측정
  const canvasSize = await page1.evaluate(function() {
    const c = document.getElementById('janggi-board');
    const container = document.querySelector('.janggi-board-container');
    return {
      canvasW: c ? c.width : null,
      canvasH: c ? c.height : null,
      containerW: container ? container.offsetWidth : null,
      containerH: container ? container.offsetHeight : null,
    };
  });
  console.log('캔버스 크기:', JSON.stringify(canvasSize));

  // 기물 수 확인
  const pieceCount = await page1.evaluate(function() {
    return document.querySelectorAll('.janggi-piece').length;
  });
  console.log('기물 수:', pieceCount);

  // btn-back-to-lobby 존재 확인
  const backBtn = await page1.evaluate(function() {
    return document.getElementById('btn-back-to-lobby') !== null;
  });
  console.log('btn-back-to-lobby:', backBtn);

  // 클릭 시도: file=0, rank=0 (차 위치)
  await page1.click('.janggi-board-container', {
    position: { x: 40, y: 48 }
  });
  await page1.waitForTimeout(1000);

  // SHOT-3: 기물 선택 후 합법 수 하이라이트
  await page1.screenshot({ path: ssDir + '/ad3-shot3-highlight.png', fullPage: false });
  console.log('SHOT-3 완료');

  // 하이라이트 존재 확인
  const highlightCount = await page1.evaluate(function() {
    return {
      move: document.querySelectorAll('.highlight-move').length,
      capture: document.querySelectorAll('.highlight-capture').length,
      self: document.querySelectorAll('.highlight-self').length,
    };
  });
  console.log('하이라이트 수:', JSON.stringify(highlightCount));

  // SHOT-4: 시간 패널 + 잡힌 기물 패널 (전체 레이아웃)
  await page1.screenshot({ path: ssDir + '/ad3-shot4-panels.png', fullPage: false });
  console.log('SHOT-4 완료');

  // 패널 레이아웃 측정
  const panelLayout = await page1.evaluate(function() {
    function getRect(el) {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        left: Math.round(r.left),
        top: Math.round(r.top),
        width: Math.round(r.width),
        height: Math.round(r.height),
        right: Math.round(r.right)
      };
    }
    return {
      hanPanel: getRect(document.getElementById('panel-han')),
      board: getRect(document.querySelector('.janggi-board-container')),
      choPanel: getRect(document.getElementById('panel-cho')),
    };
  });
  console.log('패널 레이아웃:');
  console.log(JSON.stringify(panelLayout, null, 2));

  // 헤더 버튼 확인
  const headerButtons = await page1.evaluate(function() {
    return {
      backToLobby: document.getElementById('btn-back-to-lobby') ? 
        document.getElementById('btn-back-to-lobby').textContent.trim() : null,
      resign: document.getElementById('btn-resign') ? 
        document.getElementById('btn-resign').textContent.trim() : null,
    };
  });
  console.log('헤더 버튼:', JSON.stringify(headerButtons));

  // 한·초 색상 CSS 변수 확인
  const cssVars = await page1.evaluate(function() {
    const style = getComputedStyle(document.documentElement);
    return {
      hanPrimary: style.getPropertyValue('--janggi-han-primary').trim(),
      choPrimary: style.getPropertyValue('--janggi-cho-primary').trim(),
      cellSize: style.getPropertyValue('--janggi-cell-size').trim(),
      pieceSize: style.getPropertyValue('--janggi-piece-size').trim(),
      pieceFontSize: style.getPropertyValue('--janggi-piece-font-size').trim(),
    };
  });
  console.log('CSS 변수:', JSON.stringify(cssVars));

  // clip-path 확인
  const clipPath = await page1.evaluate(function() {
    const piece = document.querySelector('.janggi-piece');
    if (!piece) return null;
    return window.getComputedStyle(piece).clipPath;
  });
  console.log('clip-path:', clipPath);

  // 시간 표시 확인
  const timeDisplay = await page1.evaluate(function() {
    return {
      hanMain: document.getElementById('time-han-main') ? 
        document.getElementById('time-han-main').textContent : null,
      choMain: document.getElementById('time-cho-main') ? 
        document.getElementById('time-cho-main').textContent : null,
    };
  });
  console.log('시간 표시:', JSON.stringify(timeDisplay));

  await browser.close();
  console.log('모든 작업 완료');
})().catch(function(e) {
  console.error('ERROR:', e.message);
  process.exit(1);
});
