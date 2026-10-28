import { test, expect } from '@playwright/test';
import http from 'node:http';
import { createApp } from '../server.js';

test('판정 누락 위치와 스테이지 정보를 게임 안에서 신고한다', async ({ page }) => {
  const app = createApp();
  app.prepareMatch('stage-report-test');
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let submittedPayload = null;

  await page.route('**/bug-report', async (route) => {
    submittedPayload = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });

  try {
    const { port } = server.address();
    await page.goto(`http://127.0.0.1:${port}/?matchId=stage-report-test&role=p1&name=QA`);
    await page.locator('.stage-card[data-stage-id="night-market-01"]').click();
    await expect(page.locator('#board')).toBeVisible();

    await page.locator('#stage-report-button').click();
    await expect(page.locator('#stage-report-guide')).toBeVisible();
    await expect(page.locator('#board')).toHaveClass(/report-selecting/);

    const imageStage = page.locator('.picture[data-image="b"] .image-stage');
    const box = await imageStage.boundingBox();
    await page.mouse.click(box.x + box.width * 0.73, box.y + box.height * 0.41);

    await expect(page.locator('#stage-report-dialog')).toBeVisible();
    await expect(page.locator('#stage-report-location')).toContainText('그림 B');
    await expect(page.locator('.stage-report-marker')).toHaveCount(1);
    await page.locator('#stage-report-note').fill('등록된 다섯 곳 외에 장식 색도 다릅니다.');
    await page.screenshot({ path: 'tests/screenshots/stage-report-dialog-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('#stage-report-dialog')).toBeVisible();
    await page.screenshot({ path: 'tests/screenshots/stage-report-dialog-mobile.png' });
    await page.locator('#stage-report-submit').click();

    await expect(page.locator('#stage-report-dialog')).toBeHidden();
    await expect(page.locator('#toast')).toContainText('위치와 스테이지 정보가 함께 신고됐어요.');
    expect(submittedPayload.gameId).toBe('spot-the-difference');
    expect(submittedPayload.text).toContain('night-market-01');
    expect(submittedPayload.text).toContain('그림 B / x=0.7300, y=0.4100');
    expect(submittedPayload.text).toContain('등록된 정답 수: 5');
    expect(submittedPayload.text).toContain('장식 색도 다릅니다.');
  } finally {
    await page.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
