/**
 * @fileoverview Playwright 설정 스켈레톤 — 향후 브라우저 E2E 대비.
 * 현재는 사용하지 않으며, smoke 테스트(tests/smoke.test.js)는 ad-hoc 노드 러너로 실행.
 */

// @ts-check
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: /.*\.spec\.js$/,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3011',
    headless: true,
    viewport: { width: 1280, height: 800 },
  },
});
