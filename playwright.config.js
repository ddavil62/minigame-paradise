/**
 * @fileoverview 미니게임 천국 통합 QA Playwright config.
 *   외부 서버 자동 기동 X — `npm start`로 6개 서버를 미리 띄운 상태에서 실행.
 */

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'off',
    headless: true,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
});
