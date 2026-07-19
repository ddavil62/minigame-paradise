/**
 * @fileoverview 별빛 우편탑 Phase 1 독립 실행 Playwright 설정을 제공한다.
 */

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: ['**/*.e2e.spec.js', '**/starlight-tower-qa.spec.js', '**/world-expansion.spec.js'],
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:3017', headless: true, viewport: { width: 1280, height: 720 } },
  webServer: { command: 'node server.js --port 3017', url: 'http://127.0.0.1:3017', reuseExistingServer: false, timeout: 15_000, env: { ...process.env, STARLIGHT_TESTING: '1' } },
});
