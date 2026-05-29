import { test, expect, chromium } from 'playwright/test';

test('등장 애니메이션 끝난 뒤 초기 화면 스크린샷', async () => {
  test.setTimeout(60000);
  const browser = await chromium.launch();
  const ctxP1 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const ctxP2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const pageP1 = await ctxP1.newPage();
  const pageP2 = await ctxP2.newPage();
  try {
    await pageP1.goto('http://localhost:3013');
    await pageP1.waitForFunction(() => document.getElementById('you-tag')?.textContent?.includes('P1'), { timeout: 5000 });
    await pageP2.goto('http://localhost:3013');
    await pageP2.waitForFunction(() => document.getElementById('you-tag')?.textContent?.includes('P2'), { timeout: 5000 });
    await pageP1.waitForFunction(() =>
      document.querySelectorAll('#opp-hand-cards .card.back').length === 10, { timeout: 5000 });
    // 카드 등장 애니메이션(card-appear) 완료를 위한 1초 대기
    await pageP1.waitForTimeout(1500);

    await pageP1.screenshot({ path: 'tests/screenshots/v8-qa-initial-settled-p1.png' });
    await pageP2.screenshot({ path: 'tests/screenshots/v8-qa-initial-settled-p2.png' });
  } finally {
    await browser.close();
  }
});
