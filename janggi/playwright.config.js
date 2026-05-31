/**
 * @fileoverview 장기 QA Playwright config.
 * 서버 lib 직접 호출형 테스트가 대부분이므로 서버 기동 불필요.
 * `npx playwright test --config janggi/playwright.config.js` 로 실행.
 */

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    trace: 'off',
    headless: true,
  },
});
