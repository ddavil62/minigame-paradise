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

  // 한 궁 (king) 위치와 한자 확인
  const kingCheck = await page1.evaluate(function() {
    const pieces = document.querySelectorAll('.janggi-piece');
    var kings = [];
    pieces.forEach(function(p) {
      if (p.dataset.piece === 'king') {
        kings.push({
          side: p.dataset.side,
          text: p.textContent,
          file: p.dataset.file,
          rank: p.dataset.rank,
        });
      }
    });
    return kings;
  });
  console.log('궁(king) 기물:');
  kingCheck.forEach(function(k) {
    console.log(' ', k.side, '=', k.text, '(file:', k.file, 'rank:', k.rank + ')');
    console.log('  → 예상:', k.side === 'han' ? '漢' : '楚', '/', k.text === (k.side === 'han' ? '漢' : '楚') ? 'PASS' : 'FAIL');
  });

  // 졸(soldier) 한자 확인
  const soldierCheck = await page1.evaluate(function() {
    const pieces = document.querySelectorAll('.janggi-piece');
    var soldiers = [];
    pieces.forEach(function(p) {
      if (p.dataset.piece === 'soldier') {
        soldiers.push({
          side: p.dataset.side,
          text: p.textContent,
          file: p.dataset.file,
          rank: p.dataset.rank,
        });
      }
    });
    return soldiers.slice(0, 4);
  });
  console.log('\n졸(soldier) 기물:');
  soldierCheck.forEach(function(s) {
    var expected = s.side === 'han' ? '兵' : '卒';
    console.log(' ', s.side, '=', s.text, '(file:', s.file + ')', '→', s.text === expected ? 'PASS' : 'FAIL (기대: ' + expected + ')');
  });

  // 포(cannon) 확인
  const cannonCheck = await page1.evaluate(function() {
    const pieces = document.querySelectorAll('.janggi-piece[data-piece="cannon"]');
    var cannons = [];
    pieces.forEach(function(p) {
      cannons.push({ side: p.dataset.side, text: p.textContent, rank: p.dataset.rank });
    });
    return cannons.slice(0, 4);
  });
  console.log('\n포(cannon) 기물 (한자=包 양쪽 동일):');
  cannonCheck.forEach(function(c) {
    console.log(' ', c.side, '=', c.text, '→', c.text === '包' ? 'PASS' : 'FAIL');
  });

  // 차, 마, 상, 사 확인
  const otherCheck = await page1.evaluate(function() {
    var result = {};
    ['chariot', 'horse', 'elephant', 'advisor'].forEach(function(type) {
      var pieces = document.querySelectorAll('.janggi-piece[data-piece="' + type + '"]');
      if (pieces.length > 0) {
        result[type] = { text: pieces[0].textContent, count: pieces.length };
      }
    });
    return result;
  });
  console.log('\n기타 기물 한자:');
  var expected = { chariot: '車', horse: '馬', elephant: '象', advisor: '士' };
  Object.keys(otherCheck).forEach(function(type) {
    var p = otherCheck[type];
    console.log(' ', type, '=', p.text, '(총', p.count + '개)', '→', p.text === expected[type] ? 'PASS' : 'FAIL');
  });

  // 레이아웃: 총 기물 수 및 rank별 분포
  const distribution = await page1.evaluate(function() {
    var dist = {};
    var total = 0;
    document.querySelectorAll('.janggi-piece').forEach(function(p) {
      var rank = p.dataset.rank;
      dist[rank] = (dist[rank] || 0) + 1;
      total++;
    });
    return { total: total, byRank: dist };
  });
  console.log('\n기물 분포:');
  console.log(' 총계:', distribution.total, '(32 예상:', distribution.total === 32 ? 'PASS' : 'FAIL)');
  console.log(' rank별:', JSON.stringify(distribution.byRank));

  // font-family 실제 적용 기물에서 확인
  const fontCheck = await page1.evaluate(function() {
    const piece = document.querySelector('.janggi-piece');
    if (!piece) return null;
    const style = window.getComputedStyle(piece);
    return {
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
    };
  });
  console.log('\n기물 폰트:');
  console.log(' fontFamily:', fontCheck.fontFamily);
  console.log(' fontSize:', fontCheck.fontSize, '(28px 예상:', fontCheck.fontSize === '28px' ? 'PASS' : 'FAIL)');
  console.log(' fontWeight:', fontCheck.fontWeight, '(700 예상)');

  await browser.close();
})().catch(function(e) {
  console.error('ERROR:', e.message);
  process.exit(1);
});
