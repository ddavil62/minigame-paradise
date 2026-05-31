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

  // 강 띠 위치 픽셀 분석
  // rank 4: y = 48 + 4*64 = 304, rank 5: y = 48 + 5*64 = 368
  // 강 띠: y=304 ~ y=368 (64px)
  const riverAnalysis = await page1.evaluate(function() {
    const canvas = document.getElementById('janggi-board');
    const ctx = canvas.getContext('2d');
    
    // 강 상단 경계 바로 위 (rank4 위: y=303)
    const aboveRiver = ctx.getImageData(200, 303, 1, 1).data;
    // 강 내부 중앙 (y=336)
    const insideRiver = ctx.getImageData(200, 336, 1, 1).data;
    // 강 하단 경계 바로 아래 (rank5 아래: y=369)
    const belowRiver = ctx.getImageData(200, 369, 1, 1).data;
    // 보드 배경 (rank2 중앙)
    const boardBg = ctx.getImageData(200, 150, 1, 1).data;
    
    return {
      aboveRiver: Array.from(aboveRiver),   // rank4 위 (일반 격자)
      insideRiver: Array.from(insideRiver), // 강 내부 (파란 틴트)
      belowRiver: Array.from(belowRiver),   // rank5 아래 (일반 격자)
      boardBg: Array.from(boardBg),         // 일반 배경
      // rank 경계 확인
      rank4y: 48 + 4 * 64,
      rank5y: 48 + 5 * 64,
    };
  });
  
  console.log('강 띠 분석:');
  console.log('  rank4 y:', riverAnalysis.rank4y, '(=304)');
  console.log('  rank5 y:', riverAnalysis.rank5y, '(=368)');
  console.log('  강 위(303) RGBA:', riverAnalysis.aboveRiver);
  console.log('  강 내부(336) RGBA:', riverAnalysis.insideRiver);
  console.log('  강 아래(369) RGBA:', riverAnalysis.belowRiver);
  console.log('  보드 배경 RGBA:', riverAnalysis.boardBg);

  // 강 색상이 보드 배경과 다른지 확인
  const riverR = riverAnalysis.insideRiver[0];
  const boardR = riverAnalysis.boardBg[0];
  console.log('  강 R vs 보드 R:', riverR, 'vs', boardR, '→', riverR !== boardR ? '색상 다름(PASS)' : '동일(FAIL)');

  // 궁성 대각선 상세 확인
  // 한 궁성: file3(x=40+3*64=232), rank0(y=48) → file5(x=40+5*64=360), rank2(y=48+128=176)
  // 대각선 중간점: x=296, y=112
  // 초 궁성: file3(x=232), rank7(y=48+448=496) → file5(x=360), rank9(y=48+576=624)
  // 대각선 중간점: x=296, y=560
  const palaceAnalysis = await page1.evaluate(function() {
    const canvas = document.getElementById('janggi-board');
    const ctx = canvas.getContext('2d');
    
    // 한 궁성 대각선 중간
    const hanDiag = ctx.getImageData(296, 112, 1, 1).data;
    // 한 궁성 주변 보드
    const hanBoard = ctx.getImageData(300, 120, 1, 1).data;
    // 초 궁성 대각선 중간
    const choDiag = ctx.getImageData(296, 560, 1, 1).data;
    // 초 궁성 주변 보드
    const choBoard = ctx.getImageData(300, 570, 1, 1).data;
    
    return {
      hanDiag: Array.from(hanDiag),
      hanBoard: Array.from(hanBoard),
      choDiag: Array.from(choDiag),
      choBoard: Array.from(choBoard),
    };
  });
  
  console.log('\n궁성 대각선 분석:');
  console.log('  한 궁성 대각선(296,112) RGBA:', palaceAnalysis.hanDiag, '→ #3A2418 예상');
  console.log('  한 궁성 주변보드(300,120) RGBA:', palaceAnalysis.hanBoard);
  console.log('  초 궁성 대각선(296,560) RGBA:', palaceAnalysis.choDiag, '→ #3A2418 예상');
  console.log('  초 궁성 주변보드(300,570) RGBA:', palaceAnalysis.choBoard);

  // 기물 색상 실측
  const pieceColors = await page1.evaluate(function() {
    const hanPieces = document.querySelectorAll('.janggi-piece.han');
    const choPieces = document.querySelectorAll('.janggi-piece.cho');
    if (!hanPieces.length || !choPieces.length) return null;
    const hanStyle = window.getComputedStyle(hanPieces[0]);
    const choStyle = window.getComputedStyle(choPieces[0]);
    return {
      hanColor: hanStyle.color,
      hanBorderColor: hanStyle.borderColor,
      choColor: choStyle.color,
      choBorderColor: choStyle.borderColor,
      hanBg: hanStyle.backgroundColor,
      hanClipPath: hanStyle.clipPath,
    };
  });
  console.log('\n기물 색상:');
  console.log('  한 color:', pieceColors.hanColor);
  console.log('  한 border:', pieceColors.hanBorderColor);
  console.log('  초 color:', pieceColors.choColor);
  console.log('  초 border:', pieceColors.choBorderColor);
  console.log('  한 bg:', pieceColors.hanBg);
  console.log('  clip-path:', pieceColors.hanClipPath);

  // 기물 배치 상세 확인 (한 쪽 rank=0 기물들)
  const rank0Pieces = await page1.evaluate(function() {
    const pieces = document.querySelectorAll('.janggi-piece');
    var rank0 = [];
    pieces.forEach(function(p) {
      if (p.dataset.rank === '0') {
        rank0.push({
          file: p.dataset.file,
          rank: p.dataset.rank,
          side: p.dataset.side,
          text: p.textContent,
          left: p.style.left,
          top: p.style.top,
        });
      }
    });
    return rank0;
  });
  console.log('\nrank=0 기물들 (한 1열):');
  rank0Pieces.forEach(function(p) {
    console.log(' ', p.side, p.text, 'file:', p.file, '@', p.left, p.top);
  });

  // 초 rank=9 기물들
  const rank9Pieces = await page1.evaluate(function() {
    const pieces = document.querySelectorAll('.janggi-piece');
    var rank9 = [];
    pieces.forEach(function(p) {
      if (p.dataset.rank === '9') {
        rank9.push({
          file: p.dataset.file,
          text: p.textContent,
          side: p.dataset.side,
        });
      }
    });
    return rank9;
  });
  console.log('\nrank=9 기물들 (초 10열):');
  rank9Pieces.forEach(function(p) {
    console.log(' ', p.side, p.text, 'file:', p.file);
  });

  // check-pulse @keyframes 실제 적용 여부 (장군 펄스 - 직접 테스트 불가, CSS 분석)
  const checkPulseExists = await page1.evaluate(function() {
    var sheets = document.styleSheets;
    for (var i = 0; i < sheets.length; i++) {
      var rules = sheets[i].cssRules || sheets[i].rules;
      if (!rules) continue;
      for (var j = 0; j < rules.length; j++) {
        if (rules[j] instanceof CSSKeyframesRule && rules[j].name === 'check-pulse') {
          return true;
        }
      }
    }
    return false;
  });
  console.log('\ncheck-pulse @keyframes 존재:', checkPulseExists);

  // 배경 그라디언트 확인
  const bodyBg = await page1.evaluate(function() {
    return window.getComputedStyle(document.body).backgroundImage;
  });
  console.log('\n배경 gradient:', bodyBg.substring(0, 100));

  await browser.close();
  console.log('\n분석 완료');
})().catch(function(e) {
  console.error('ERROR:', e.message);
  process.exit(1);
});
