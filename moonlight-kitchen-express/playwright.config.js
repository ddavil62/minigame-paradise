/** @fileoverview 달빛 주방열차 독립 서버 기반 Playwright 설정을 제공한다. */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: /.*\.e2e\.spec\.js/,
  testIgnore: [/launcher\.e2e\.spec\.js/, /final-ui-qa\.e2e\.spec\.js/],
  timeout: 70_000,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:3016', viewport: { width: 1280, height: 720 } },
  webServer: { command: 'node server.js --port 3016', port: 3016, reuseExistingServer: false, timeout: 10_000 }
});
