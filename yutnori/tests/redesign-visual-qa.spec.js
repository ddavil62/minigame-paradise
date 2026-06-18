/**
 * @fileoverview 재디자인 시각 검증 — 콘솔 에러 / 폰트 / 렌더 / 반응형 스크린샷.
 * 서버 3088 필요.
 */
import { test, expect } from 'playwright/test';

test('VIS-1: 게임 화면 렌더 + 콘솔 에러 없음 (1440x900)', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p1 = await context.newPage();
  const p2 = await context.newPage();
  const errors = [];
  p1.on('pageerror', (e) => errors.push(e.message));
  p1.on('console', (m) => { if (m.type() === 'error') errors.push('console:' + m.text()); });

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
  await p1.waitForFunction(
    () => document.getElementById('ready-status')?.classList.contains('hidden'),
    { timeout: 8000 },
  );
  await p1.waitForTimeout(400);

  // 말 배치해서 보드에 piece 렌더
  await p1.request.post('/test/inject', {
    data: {
      started: true, currentTurn: 'p1', pendingResults: ['gae', 'do'],
      pieces: {
        p1: [{ cell: 0 }, { cell: 5 }, { cell: 23 }, { cell: -1 }],
        p2: [{ cell: 10 }, { cell: 15 }, { cell: -1 }, { cell: -1 }],
      },
    },
  });
  await p1.waitForTimeout(500);
  await p1.screenshot({ path: 'tests/screenshots/redesign-qa-game-1440.png' });

  // 폰트 로드 확인 (Jua, Gowun Dodum)
  const fonts = await p1.evaluate(() => ({
    jua: document.fonts.check('16px "Jua"'),
    gowun: document.fonts.check('16px "Gowun Dodum"'),
  }));
  console.log('fonts:', JSON.stringify(fonts), 'errors:', JSON.stringify(errors));

  await context.close();
  expect(errors, '콘솔/페이지 에러 없어야 함').toEqual([]);
});

test('VIS-2: 좁은 화면 반응형 (900px) 렌더 깨짐 없음', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 880, height: 760 } });
  const p1 = await context.newPage();
  const errors = [];
  p1.on('pageerror', (e) => errors.push(e.message));
  await p1.goto('/');
  await p1.waitForTimeout(600);
  await p1.screenshot({ path: 'tests/screenshots/redesign-qa-narrow-880.png' });
  await context.close();
  expect(errors).toEqual([]);
});

test('VIS-3: 모바일 뷰포트 (375px) 렌더', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 667 } });
  const p1 = await context.newPage();
  const errors = [];
  p1.on('pageerror', (e) => errors.push(e.message));
  await p1.goto('/');
  await p1.waitForTimeout(600);
  await p1.screenshot({ path: 'tests/screenshots/redesign-qa-mobile-375.png' });
  await context.close();
  expect(errors).toEqual([]);
});
