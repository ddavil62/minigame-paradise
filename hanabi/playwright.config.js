/**
 * @fileoverview Playwright 설정 — 하나비 테스트.
 *
 * 유닛/WS 테스트는 모두 서버 불필요(game.js / createApp 직접 import).
 *   npx playwright test --reporter=list
 *
 * 단독 서버 실행 포트(E2E는 Phase 4): 3007.
 */

import { defineConfig } from 'playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  reporter: 'list',
  // createApp이 closure 격리되므로 워커 충돌은 없으나, WS 포트 race 방지를 위해 직렬 실행.
  workers: 1,
  fullyParallel: false,
  retries: 1,
  use: {
    baseURL: 'http://localhost:3007',
    headless: true,
  },
});
