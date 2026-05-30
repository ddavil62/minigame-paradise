/**
 * @fileoverview Playwright 설정 — 윷놀이 테스트.
 *
 * 단위/WS 테스트: 서버 불필요 (tests/yut.unit.spec.js, tests/ws.scenarios.spec.js)
 * E2E 테스트: 서버 3088 포트 사전 실행 필요 (tests/e2e-scenarios.spec.js)
 *
 * 단위 + WS 실행 (서버 불필요):
 *   npx playwright test tests/yut.unit.spec.js tests/ws.scenarios.spec.js --reporter=list
 *
 * E2E 실행 (서버 필요):
 *   node server.js --port 3088
 *   npx playwright test tests/e2e-scenarios.spec.js --reporter=list
 *
 * 전체 실행:
 *   node server.js --port 3088
 *   npx playwright test tests/yut.unit.spec.js tests/ws.scenarios.spec.js tests/e2e-scenarios.spec.js --reporter=list
 */

import { defineConfig } from 'playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3088',
    headless: true,
  },
});
