/** @fileoverview 통합 런처 프록시 경로 전용 E2E 설정이다. */
import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests', testMatch: /launcher\.e2e\.spec\.js/, timeout: 60000, use: { baseURL: 'http://127.0.0.1:3099', viewport: { width: 1280, height: 800 } }, webServer: { command: 'set KITCHEN_E2E=1&& node ../launcher/server.js --port 3099', port: 3099, reuseExistingServer: false, timeout: 10000 } });
