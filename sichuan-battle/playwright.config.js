/**
 * @fileoverview 사천성 배틀 독립 서버의 2브라우저 Playwright 설정.
 */
import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./tests',testMatch:'*.spec.js',timeout:30000,use:{baseURL:'http://127.0.0.1:3028',viewport:{width:1366,height:768}},webServer:{command:'node server.js',port:3028,env:{PORT:'3028',SICHUAN_E2E:'1'},reuseExistingServer:false},reporter:'line'});
