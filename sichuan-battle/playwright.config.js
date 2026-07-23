/**
 * @fileoverview 사천성 배틀 독립 서버의 2브라우저 Playwright 설정.
 */
import {defineConfig} from '@playwright/test';
// 통합 서버가 단일 2인 room을 제공하므로 spec 간 교차 매칭을 막기 위해 직렬 실행한다.
export default defineConfig({testDir:'./tests',testMatch:'*.spec.js',timeout:30000,workers:1,use:{baseURL:'http://127.0.0.1:3028',viewport:{width:1366,height:768}},webServer:{command:'node server.js',port:3028,env:{PORT:'3028',SICHUAN_E2E:'1'},reuseExistingServer:false},reporter:'line'});
