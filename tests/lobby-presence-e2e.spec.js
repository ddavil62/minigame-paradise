/**
 * @fileoverview 로비 접속 플로우 재설계 페이즈1 E2E — 닉네임 게이트 + presence + 토스트.
 *   격리 포트(3091)에 런처를 spec 내부에서 spawn해 검증한다(사용자 3000/MCP node 미접촉).
 *   2개 브라우저 컨텍스트로 실시간 presence 갱신·입퇴장 토스트·localStorage pre-fill을 확인한다.
 *
 *   시나리오:
 *     (a) ctx1 입장 → ctx2 입장 시 ctx1 목록에 ctx2 이름이 새로고침 없이 추가 + 입장 토스트
 *     (b) ctx2 종료 시 ctx1에 퇴장 토스트
 *     (c) 닉네임 localStorage 재방문 시 자동 pre-fill
 */
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
const PORT = 3091;
const BASE = `http://localhost:${PORT}`;

/** @type {import('node:child_process').ChildProcess|null} */
let launcher = null;

/**
 * 지정 URL이 200을 응답할 때까지 폴링한다.
 * @param {string} url
 * @param {number} timeoutMs
 * @returns {Promise<void>}
 */
function waitForServer(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() > deadline) reject(new Error('launcher 기동 타임아웃'));
        else setTimeout(tick, 250);
      });
    };
    tick();
  });
}

test.beforeAll(async () => {
  launcher = spawn(process.execPath, ['launcher/server.js', '--port', String(PORT)], {
    cwd: REPO_ROOT,
    stdio: 'ignore',
  });
  await waitForServer(BASE);
});

test.afterAll(async () => {
  if (launcher && !launcher.killed) {
    launcher.kill();
  }
});

test.describe.serial('로비 페이즈1 — 닉네임 게이트 + presence + 토스트', () => {
  test('CF-01: 닉네임 게이트 표시 + 빈 입력 차단 + 입장 후 로비 전환', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(BASE);

    // 게이트 표시 + 로비 숨김
    await expect(page.locator('#nickname-gate')).toBeVisible();
    await expect(page.locator('#lobby-view')).toBeHidden();

    // 빈 입력 제출 차단
    await page.locator('#btn-enter-lobby').click();
    await expect(page.locator('#nickname-gate')).toBeVisible();
    await expect(page.locator('#nickname-error')).toHaveText('닉네임을 입력하세요.');

    // 닉네임 입력 후 입장 → 로비 전환
    await page.locator('#nickname-input').fill('알파');
    await page.locator('#btn-enter-lobby').click();
    await expect(page.locator('#lobby-view')).toBeVisible();
    await expect(page.locator('#nickname-gate')).toBeHidden();

    // 내 이름이 presence 목록에 나타남 + 본인 항목에 '(나)' 표시 + .self 강조
    await expect(page.locator('#presence-list')).toContainText('알파');
    await expect(page.locator('.presence-item.self')).toContainText('알파');
    await expect(page.locator('.presence-item.self')).toContainText('(나)');

    await ctx.close();
  });

  test('CF-02/CF-04: 친구 입장 → presence 실시간 갱신 + 입장/퇴장 토스트', async ({ browser }) => {
    // 컨텍스트1: '알파' 입장
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    await page1.goto(BASE);
    await page1.locator('#nickname-input').fill('알파');
    await page1.locator('#btn-enter-lobby').click();
    await expect(page1.locator('#presence-list')).toContainText('알파');
    // 아직 베타는 없음
    await expect(page1.locator('#presence-list')).not.toContainText('베타');

    // 컨텍스트2: '베타' 입장
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await page2.goto(BASE);
    await page2.locator('#nickname-input').fill('베타');
    await page2.locator('#btn-enter-lobby').click();

    // (a) ctx1 목록에 새로고침 없이 베타 추가
    await expect(page1.locator('#presence-list')).toContainText('베타', { timeout: 5000 });
    // 입장 토스트 표시
    await expect(page1.locator('#lobby-toast')).toHaveClass(/show/, { timeout: 5000 });
    await expect(page1.locator('#lobby-toast')).toContainText('베타');
    await expect(page1.locator('#lobby-toast')).toContainText('입장');

    // 본인 표시: 2인 상태에서 각자 본인에게만 '(나)' (상대에겐 안 붙음)
    // page1(알파) 시점: .self는 정확히 1개이고 '알파' (나), 베타는 .self 아님
    await expect(page1.locator('.presence-item.self')).toHaveCount(1);
    await expect(page1.locator('.presence-item.self')).toContainText('알파');
    await expect(page1.locator('.presence-item.self')).toContainText('(나)');
    await expect(page1.locator('.presence-item.self')).not.toContainText('베타');
    // page2(베타) 시점: .self는 정확히 1개이고 '베타' (나), 알파는 .self 아님
    await expect(page2.locator('.presence-item.self')).toHaveCount(1);
    await expect(page2.locator('.presence-item.self')).toContainText('베타');
    await expect(page2.locator('.presence-item.self')).toContainText('(나)');
    await expect(page2.locator('.presence-item.self')).not.toContainText('알파');

    // 스크린샷 (presence 2명 + 토스트)
    await page1.screenshot({ path: 'tests/screenshots/lobby-presence-join.png', fullPage: false });

    // (b) ctx2 종료 → ctx1 퇴장 토스트
    await ctx2.close();
    await expect(page1.locator('#lobby-toast')).toContainText('베타', { timeout: 5000 });
    await expect(page1.locator('#lobby-toast')).toContainText('나갔', { timeout: 5000 });
    // 목록에서 베타 제거
    await expect(page1.locator('#presence-list')).not.toContainText('베타', { timeout: 5000 });

    await ctx1.close();
  });

  test('CF-03: 닉네임 localStorage 재방문 자동 입장 (게이트 건너뜀)', async ({ browser }) => {
    // Phase 1-A에서 동작 변경: pre-fill → 자동입장.
    // localStorage에 닉네임이 있으면 게이트 없이 로비로 바로 진입한다.
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(BASE);

    // 최초 입장 → 저장
    await page.locator('#nickname-input').fill('감마');
    await page.locator('#btn-enter-lobby').click();
    await expect(page.locator('#lobby-view')).toBeVisible();

    // 같은 컨텍스트(localStorage 유지)에서 재방문 → 게이트 건너뛰고 로비 바로 표시
    await page.goto(BASE);
    await expect(page.locator('#lobby-view')).toBeVisible();
    await expect(page.locator('#nickname-gate')).toHaveClass(/hidden/);

    await ctx.close();
  });

  test('CF-10: 닉네임 12자 초과 trim — 12자만 저장/표시', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(BASE);
    // maxlength=12 + 서버 slice(0,12) — 13자 입력 시 12자만
    await page.locator('#nickname-input').fill('123456789012345');
    const val = await page.locator('#nickname-input').inputValue();
    expect(val.length).toBeLessThanOrEqual(12);
    await page.locator('#btn-enter-lobby').click();
    await expect(page.locator('#presence-list')).toContainText('123456789012');
    await ctx.close();
  });
});

test.describe('로비 페이즈1 — 후방호환 (JOIN 없이 LOBBY_STATE)', () => {
  test('CF-REG: 기존 PICK_GAME/REDIRECT 메시지 흐름 보존 — name 쿼리 포함', async ({ browser }) => {
    // 단독 입장 → AI 봇 미지원이 아닌 게임(omok) 선택 → REDIRECT 시 ?name= 포함 확인
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.locator('#nickname-input').fill('호스트짱');
    await page.locator('#btn-enter-lobby').click();
    await expect(page.locator('#lobby-view')).toBeVisible();
    // presence 목록에 내 이름이 뜰 때까지 대기 → JOIN/LOBBY_STATE 왕복 완료 보장
    // (#player-count 초기 HTML이 "1/2"로 하드코딩돼 있어 텍스트 폴링은 신뢰 불가)
    await expect(page.locator('#presence-list')).toContainText('호스트짱', { timeout: 5000 });

    // omok 카드 클릭 (AI 모드, 봇 지원) → PICK_GAME → REDIRECT → location.href 이동.
    // page.evaluate로 직접 카드 핸들러를 트리거(1280 뷰포트 클릭 reach 이슈 회피).
    await page.evaluate(() => {
      const card = document.querySelector('.game-card[data-game-id="omok"]');
      if (card) card.click();
    });
    // location이 omok으로 바뀔 때까지 대기 (commit 단계 — omok 풀 load 불필요)
    await page.waitForURL(/\/omok\//, { timeout: 8000, waitUntil: 'commit' });
    const url = page.url();
    expect(url).toContain('mode=ai');
    expect(url).toContain('name=');
    expect(decodeURIComponent(url)).toContain('호스트짱');

    await ctx.close();
  });
});
