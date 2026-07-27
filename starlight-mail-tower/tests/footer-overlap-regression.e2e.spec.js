/**
 * @fileoverview Footer 겹침 회귀 테스트 -- 5개 해상도에서 .ready-footer와
 * .crew-row / .level-list의 교차 면적이 0인지 검증한다.
 * ISS-01~03 수정 이후 회귀 방지 목적.
 */

import { test, expect } from '@playwright/test';

/** 교차 면적 계산: 두 rect가 겹치면 양수, 아니면 0 */
function overlapArea(a, b) {
  const x = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const y = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return x * y;
}

const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
  { width: 1024, height: 576 },
  { width: 520, height: 900 },
];

for (const vp of VIEWPORTS) {
  test(`footer 겹침 0 검증: ${vp.width}x${vp.height}`, async ({ browser, baseURL }) => {
    const ctxA = await browser.newContext({ viewport: vp });
    const ctxB = await browser.newContext({ viewport: vp });
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    await pageA.goto(`${baseURL}/?name=FO-${vp.width}x${vp.height}-A`);
    await pageB.goto(`${baseURL}/?name=FO-${vp.width}x${vp.height}-B`);

    // 레벨 카드가 렌더될 때까지 대기
    await expect(pageA.locator('.level-card')).toHaveCount(5, { timeout: 8000 });

    // 측정
    const metrics = await pageA.evaluate(() => {
      const footer = document.querySelector('.ready-footer');
      const crew = document.querySelector('.crew-row');
      const list = document.querySelector('.level-list');
      if (!footer || !crew || !list) return null;
      const fR = footer.getBoundingClientRect();
      const cR = crew.getBoundingClientRect();
      const lR = list.getBoundingClientRect();
      return {
        footer: { top: fR.top, bottom: fR.bottom, left: fR.left, right: fR.right },
        crew: { top: cR.top, bottom: cR.bottom, left: cR.left, right: cR.right },
        list: { top: lR.top, bottom: lR.bottom, left: lR.left, right: lR.right },
      };
    });

    expect(metrics).toBeTruthy();

    const footerCrewOverlap = overlapArea(metrics.footer, metrics.crew);
    const footerListOverlap = overlapArea(metrics.footer, metrics.list);

    console.log(`=> ${vp.width}x${vp.height}: footer(${metrics.footer.top.toFixed(1)}~${metrics.footer.bottom.toFixed(1)}) crew(${metrics.crew.top.toFixed(1)}~${metrics.crew.bottom.toFixed(1)}) list(${metrics.list.top.toFixed(1)}~${metrics.list.bottom.toFixed(1)})`);
    console.log(`   footerCrewOverlap=${footerCrewOverlap.toFixed(1)}px^2, footerListOverlap=${footerListOverlap.toFixed(1)}px^2`);

    expect(footerCrewOverlap).toBe(0);
    expect(footerListOverlap).toBe(0);

    await ctxA.close();
    await ctxB.close();
    // 서버 싱글 룸 리셋 대기
    await new Promise((r) => setTimeout(r, 400));
  });
}
