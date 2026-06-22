/**
 * @fileoverview 테트리스 배틀 E2E Playwright config.
 *   ai-mode-e2e.spec.js는 beforeAll에서 격리 포트 3111에 자체 서버를 띄우므로
 *   외부 webServer 기동 불필요(self-contained). baseURL은 spec 내부 상수를 사용한다.
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
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
