/**
 * @fileoverview Phase C 상대 보드와 입력 회귀 전용 Playwright 설정.
 */

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: ['**/*.browser.spec.js'],
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:3066',
    headless: true,
  },
  webServer: {
    command: 'node server.js --port 3066',
    cwd: '.',
    url: 'http://127.0.0.1:3066',
    reuseExistingServer: true,
  },
});
