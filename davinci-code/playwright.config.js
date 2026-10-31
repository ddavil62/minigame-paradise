/**
 * @fileoverview Playwright 설정 -- 다빈치 코드 플러스 QA용.
 * 외부 서버(`node server.js`)가 포트 3002에서 미리 실행 중이어야 한다.
 */

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  // tests/*.test.js는 node로 직접 실행하는 스크립트(match-prepare 등)이므로 playwright 대상에서 제외한다.
  testMatch: '**/*.spec.js',
  timeout: 60000,
  expect: { timeout: 10000 },
  use: {
    baseURL: 'http://localhost:3002',
    headless: true,
    viewport: { width: 1280, height: 800 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  reporter: [['list']],
  workers: 1,
});
