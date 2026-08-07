/**
 * @fileoverview 끝말잇기 배틀 QA용 Playwright 설정.
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    headless: true,
  },
});
