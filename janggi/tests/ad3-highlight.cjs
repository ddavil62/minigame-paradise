const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ssDir = 'minigame-paradise/janggi/tests/screenshots';
  
  const ctx1 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page1 = await ctx1.newPage();
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page2 = await ctx2.newPage();

  // WS 메시지 로깅
  const wsMessages = [];
  page1.on('websocket', ws => {
    ws.on('framereceived', f => wsMessages.push('RECV: ' + f.payload.substring(0, 100)));
    ws.on('framesent', f => wsMessages.push('SENT: ' + f.payload.substring(0, 100)));
  });

  await Promise.all([
    page1.goto('http://localhost:3006/?side=han'),
    page2.goto('http://localhost:3006/?side=cho'),
  ]);
  await page1.waitForTimeout(2000);
  await page2.click('button[data-setup="MSMS"]');
  await page1.waitForTimeout(600);
  await page1.click('button[data-setup="MSMS"]');
  await page1.waitForTimeout(2000);

  console.log('WS 메시지 (첫 10개):', wsMessages.slice(0, 10).join('\n'));

  // clickable 기물들의 위치 수집
  const clickableInfo = await page1.evaluate(function() {
    const pieces = document.querySelectorAll('.janggi-piece.clickable');
    const info = [];
    pieces.forEach(function(p) {
      info.push({
        side: p.dataset.side,
        piece: p.dataset.piece,
        file: p.dataset.file,
        rank: p.dataset.rank,
        left: p.style.left,
        top: p.style.top,
        text: p.textContent,
      });
    });
    return info;
  });
  console.log('클릭 가능 기물들:');
  clickableInfo.slice(0, 5).forEach(function(p) {
    console.log(' ', p.side, p.piece, p.text, 'file:', p.file, 'rank:', p.rank, '@', p.left, p.top);
  });

  // 직접 좌표로 기물 클릭 (file=0, rank=0 차)
  if (clickableInfo.length > 0) {
    const p = clickableInfo[0];
    const left = parseInt(p.left);
    const top = parseInt(p.top);
    console.log('클릭할 기물:', p.text, 'at', left, top);
    
    // 보드 컨테이너 offset 고려
    await page1.click('.janggi-board-container', {
      position: { x: left, y: top }
    });
    await page1.waitForTimeout(1500); // WS 응답 대기
    
    const hl = await page1.evaluate(function() {
      return {
        move: document.querySelectorAll('.highlight-move').length,
        capture: document.querySelectorAll('.highlight-capture').length,
        self: document.querySelectorAll('.highlight-self').length,
        allDots: document.querySelectorAll('.highlight-dot').length,
        hlLayer: document.getElementById('janggi-highlights-layer') ?
          document.getElementById('janggi-highlights-layer').innerHTML.substring(0, 200) : 'NOT FOUND',
      };
    });
    console.log('하이라이트 수:', JSON.stringify(hl));
    console.log('하이라이트 레이어 내용:', hl.hlLayer);
  }

  // WS 메시지 전체 (LEGAL_MOVES 포함 여부)
  console.log('\nWS 메시지 전체:');
  wsMessages.forEach(function(m) { console.log(' ', m); });

  // 스크린샷
  await page1.screenshot({ path: ssDir + '/ad3-shot3-highlight-final.png', fullPage: false });
  console.log('\nSHOT-3 완료');

  await browser.close();
})().catch(function(e) {
  console.error('ERROR:', e.message);
  process.exit(1);
});
