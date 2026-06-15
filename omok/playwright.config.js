/**
 * @fileoverview Playwright 설정 — 오목 테스트.
 *
 * 본 프로젝트의 핵심 회귀(승리 판정·게임 흐름·봇)는 tests/smoke.test.js 및
 * tests/bot-smoke.test.js의 ad-hoc 노드 러너로 다룬다. Playwright 설정은 향후
 * 브라우저 E2E를 추가할 때를 대비한 스켈레톤이다.
 */

import { defineConfig } from 'playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  reporter: 'list',
  workers: 1,
  fullyParallel: false,
  retries: 1,
  use: {
    baseURL: 'http://localhost:3012',
    headless: true,
  },
});
