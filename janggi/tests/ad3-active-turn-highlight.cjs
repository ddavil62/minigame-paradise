const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx1 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page1 = await ctx1.newPage();
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page2 = await ctx2.newPage();

  await Promise.all([
    page1.goto('http://localhost:3006/?side=han'),
    page2.goto('http://localhost:3006/?side=cho'),
  ]);
  await page1.waitForTimeout(2000);
  await page2.click('button[data-setup="MSMS"]');
  await page1.waitForTimeout(600);
  await page1.click('button[data-setup="MSMS"]');
  await page1.waitForTimeout(2500);

  // active-turn 클래스 확인
  const activeTurn = await page1.evaluate(function() {
    const hanPanel = document.getElementById('panel-han');
    const choPanel = document.getElementById('panel-cho');
    return {
      hanActive: hanPanel ? hanPanel.classList.contains('active-turn') : null,
      choActive: choPanel ? choPanel.classList.contains('active-turn') : null,
    };
  });
  console.log('active-turn 클래스:');
  console.log('  한 패널:', activeTurn.hanActive, '(han 차례이면 true 예상)');
  console.log('  초 패널:', activeTurn.choActive, '(false 예상)');

  // 한 시간 패널 글로우 box-shadow 확인
  const panelGlow = await page1.evaluate(function() {
    const timeHan = document.getElementById('time-han');
    const timeCho = document.getElementById('time-cho');
    return {
      hanGlow: timeHan ? window.getComputedStyle(timeHan).boxShadow : null,
      choGlow: timeCho ? window.getComputedStyle(timeCho).boxShadow : null,
    };
  });
  console.log('\n시간 패널 box-shadow:');
  console.log('  한:', panelGlow.hanGlow);
  console.log('  초:', panelGlow.choGlow);

  // 기물 클릭 후 하이라이트 상세 (piecesLayer 이벤트 경유)
  // 첫 번째 클릭 가능 기물에 직접 dispatch
  const result = await page1.evaluate(function() {
    const clickable = document.querySelector('.janggi-piece.clickable');
    if (!clickable) return { error: 'no clickable piece' };
    clickable.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    return {
      file: clickable.dataset.file,
      rank: clickable.dataset.rank,
      text: clickable.textContent,
    };
  });
  console.log('\n기물 클릭 dispatch:', JSON.stringify(result));
  await page1.waitForTimeout(1500);

  // 하이라이트 다시 확인
  const hl2 = await page1.evaluate(function() {
    return {
      move: document.querySelectorAll('.highlight-move').length,
      capture: document.querySelectorAll('.highlight-capture').length,
      self: document.querySelectorAll('.highlight-self').length,
      hlLayer: document.getElementById('janggi-highlights-layer').children.length,
    };
  });
  console.log('하이라이트 (dispatch 후):', JSON.stringify(hl2));

  // 스크린샷
  await page1.screenshot({
    path: 'minigame-paradise/janggi/tests/screenshots/ad3-shot3-highlight-dispatch.png',
    fullPage: false,
  });
  console.log('SHOT-3-dispatch 완료');

  await browser.close();
})().catch(function(e) {
  console.error('ERROR:', e.message);
  process.exit(1);
});
