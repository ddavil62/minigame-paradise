/**
 * @fileoverview 마작 UI 회귀 테스트용 Playwright 설정. 서버는 각 테스트가 격리 포트로 직접 띄운다.
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js',
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: { headless: true, viewport: { width: 1280, height: 860 } },
});
