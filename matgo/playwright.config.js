/**
 * @fileoverview Playwright 설정 — 맞고 v8 UI QA용.
 *
 * - 외부 서버(`node server.js --port 3013`)가 미리 실행 중이어야 한다.
 * - reporter는 list 기본, screenshots는 항상 캡처.
 */

import { defineConfig } from 'playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 120000,
  expect: { timeout: 10000 },
  use: {
    baseURL: 'http://localhost:3013',
    headless: true,
    viewport: { width: 1280, height: 800 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  // 외부 서버를 직접 띄움 (수동 관리). webServer 설정 생략.
  reporter: [['list']],
  workers: 1, // 동시 실행 시 룸 정원(2명) 충돌 방지 — 순차 실행
});
