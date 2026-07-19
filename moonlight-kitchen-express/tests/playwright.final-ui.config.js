/** @fileoverview 최종 QA 전용 UI 테스트 설정이다. */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: /final-ui-qa\.e2e\.spec\.js/,
  timeout: 70_000,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:3016', viewport: { width: 1280, height: 720 } },
  webServer: { command: 'node ../server.js --port 3016', port: 3016, reuseExistingServer: false, timeout: 10_000 }
});
