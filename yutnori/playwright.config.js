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
  // server.js의 createApp이 module-level game/players 상태를 공유하므로
  // 동시 실행 시 inject가 다른 워커에 영향을 미친다. 단일 워커 강제 + 직렬 실행으로 race 차단.
  workers: 1,
  fullyParallel: false,
  // Windows에서 startServer/stopServer 빠른 반복 시 가끔 fetch가 "bad port"로 실패하는
  // OS 레벨 race가 관측됨 (undici keep-alive 재사용 + close 타이밍). 1회 retry로 안정화.
  // 본 작업의 안정성 목표(5회 안정, flaky 0건)를 위해 도입.
  retries: 1,
  use: {
    baseURL: 'http://localhost:3088',
    headless: true,
  },
});
