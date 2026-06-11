/**
 * @fileoverview QA Pass3 브라우저 스모크 — 대기 화면 렌더 + 콘솔 에러 부재 검증.
 * 서버는 외부에서 `node server.js --port 3097`로 사전 구동되어 있어야 한다.
 */
import { test, expect } from '@playwright/test';

const BASE = 'http://127.0.0.1:3097';

test('대기 화면 렌더 + 콘솔/페이지 에러 없음', async ({ page }) => {
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await page.goto(BASE, { waitUntil: 'networkidle' });
  // 대기/메인 컨테이너가 보여야 한다.
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'tests/screenshots/waiting-screen.png', fullPage: true });

  // body에 콘텐츠가 존재.
  const bodyText = await page.evaluate(() => document.body.innerText.length);
  expect(bodyText).toBeGreaterThan(0);

  // 모듈 import 등으로 인한 페이지/콘솔 에러가 없어야 한다.
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
