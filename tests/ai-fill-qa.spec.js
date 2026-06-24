/**
 * @fileoverview 다인 로비 AI 슬롯 채우기 기능 QA 테스트.
 *   launcher/server.js의 FILL_WITH_AI / CANCEL_AI_FILL 핸들러,
 *   PICK_GAME 정원 체크, REDIRECT 봇 spawn, 클라이언트 UI를 검증한다.
 *
 *   사전 조건: `node launcher/server.js` 실행 중 (포트 3000).
 */
import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:3000';

/**
 * 닉네임 게이트를 통과하여 로비에 진입한다.
 * localStorage에 닉네임을 설정한 뒤 페이지를 로드하면 자동 진입.
 * @param {import('@playwright/test').Page} page
 * @param {string} name
 */
async function enterLobby(page, name) {
  // localStorage 설정 후 네비게이션
  await page.goto(BASE);
  await page.evaluate((n) => localStorage.setItem('minigames:nickname', n), name);
  await page.goto(BASE);
  // 로비 뷰가 보일 때까지 대기
  await page.waitForSelector('#lobby-view:not(.hidden)', { timeout: 5000 });
  // LOBBY_STATE 수신 대기 (player-count 갱신)
  await page.waitForFunction(
    () => document.getElementById('player-count')?.textContent?.includes('/'),
    { timeout: 5000 }
  );
}

/**
 * 호스트가 목표 인원을 설정한다.
 * @param {import('@playwright/test').Page} page
 * @param {number} target 2~5
 */
async function setTarget(page, target) {
  const btn = page.locator(`.pcs-btn[data-target="${target}"]`);
  await btn.click();
  // LOBBY_STATE 재수신 대기
  await page.waitForFunction(
    (t) => document.getElementById('player-count')?.textContent?.startsWith(``) || true,
    target,
    { timeout: 3000 }
  );
  // 짧은 안정화 대기
  await page.waitForTimeout(300);
}

/**
 * WS 연결 후 LOBBY_STATE가 도착할 때까지 대기 (콘솔 에러 수집과 함께).
 */
async function waitForLobbyState(page) {
  await page.waitForFunction(
    () => {
      const el = document.getElementById('player-role');
      return el && (el.textContent === '호스트' || el.textContent === '게스트');
    },
    { timeout: 5000 }
  );
}

test.describe('AI 슬롯 채우기 - 정상 동작', () => {
  /** @type {import('@playwright/test').Page} */
  let p1;

  test.beforeEach(async ({ browser }) => {
    // 호스트(p1) 입장
    const ctx1 = await browser.newContext();
    p1 = await ctx1.newPage();
    await enterLobby(p1, 'Host');
    await waitForLobbyState(p1);
  });

  test.afterEach(async () => {
    // 모든 페이지 닫기 (서버 상태 리셋 유도)
    await p1.close().catch(() => {});
    await new Promise((r) => setTimeout(r, 300));
  });

  test('TC-AI-01: targetPlayers=3, 1인 -> AI로 채우기 -> 슬롯 2개 채워짐', async () => {
    // 3인 목표 설정
    await setTarget(p1, 3);

    // AI 채우기 컨트롤이 표시되는지 확인
    const aiControls = p1.locator('#ai-fill-controls');
    await expect(aiControls).not.toHaveAttribute('hidden', '');

    // AI로 채우기 버튼 클릭
    const btnFill = p1.locator('#btn-fill-ai');
    await expect(btnFill).toBeVisible();
    await btnFill.click();

    // 잠시 대기 후 상태 확인
    await p1.waitForTimeout(500);

    // AI 슬롯 힌트 확인
    const aiFillHint = p1.locator('#ai-fill-hint');
    await expect(aiFillHint).toHaveText('AI 2명 대기 중');

    // AI 취소 버튼이 보이는지 확인
    const btnCancel = p1.locator('#btn-cancel-ai');
    await expect(btnCancel).toBeVisible();

    // presence 목록에 AI 슬롯 표시 확인
    const aiSlots = p1.locator('.presence-item.ai-slot');
    await expect(aiSlots).toHaveCount(2);

    // 힌트 텍스트 확인
    const hintEl = p1.locator('#lobby-hint');
    await expect(hintEl).toHaveText('AI로 채웠습니다! 종목을 선택하세요');

    // 스크린샷
    await p1.screenshot({ path: 'tests/screenshots/ai-fill-01-filled.png' });
  });

  test('TC-AI-02: AI 채운 후 게임 카드 클릭 -> REDIRECT 수신', async () => {
    await setTarget(p1, 3);

    // AI 채우기
    await p1.locator('#btn-fill-ai').click();
    await p1.waitForTimeout(500);

    // 윷놀이 카드 클릭 (botAvailable=true, maxPlayers=4 >= 3)
    const yutnoriCard = p1.locator('.game-card[data-game-id="yutnori"]');

    // 리다이렉트 감지를 위해 navigation 대기
    const [response] = await Promise.all([
      p1.waitForURL(/\/yutnori\//, { timeout: 10000 }),
      yutnoriCard.click(),
    ]);

    // 윷놀이 페이지로 이동 확인
    expect(p1.url()).toContain('/yutnori/');
    expect(p1.url()).toContain('players=3');
  });

  test('TC-AI-03: AI 취소 -> aiSlotCount=0 -> 카드 클릭 불가 (3인 목표에서)', async () => {
    await setTarget(p1, 3);

    // AI 채우기
    await p1.locator('#btn-fill-ai').click();
    await p1.waitForTimeout(500);

    // AI 취소
    await p1.locator('#btn-cancel-ai').click();
    await p1.waitForTimeout(500);

    // AI 슬롯이 사라졌는지 확인
    const aiSlots = p1.locator('.presence-item.ai-slot');
    await expect(aiSlots).toHaveCount(0);

    // AI 힌트 비워졌는지 확인
    const aiFillHint = p1.locator('#ai-fill-hint');
    await expect(aiFillHint).toHaveText('');

    // 힌트 텍스트가 목표 미달로 돌아갔는지 확인
    const hintEl = p1.locator('#lobby-hint');
    const hintText = await hintEl.textContent();
    expect(hintText).toContain('3명이 모이면');

    // 스크린샷
    await p1.screenshot({ path: 'tests/screenshots/ai-fill-03-cancelled.png' });
  });

  test('TC-AI-04: targetPlayers=2에서 AI 채우기 버튼 미표시', async () => {
    // 기본값이 2이므로 추가 설정 불필요
    const aiControls = p1.locator('#ai-fill-controls');
    // hidden 속성이 있거나 display:none이어야 함
    await expect(aiControls).toBeHidden();

    // 스크린샷
    await p1.screenshot({ path: 'tests/screenshots/ai-fill-04-target2.png' });
  });

  test('TC-AI-07: AI 채운 후 REDIRECT -> aiSlotCount 리셋 확인 (URL playerCount)', async () => {
    await setTarget(p1, 4);

    // AI 채우기
    await p1.locator('#btn-fill-ai').click();
    await p1.waitForTimeout(500);

    // 힌트가 AI 3명 대기 중인지 확인
    const aiFillHint = p1.locator('#ai-fill-hint');
    await expect(aiFillHint).toHaveText('AI 3명 대기 중');

    // 윷놀이 카드 클릭
    const yutnoriCard = p1.locator('.game-card[data-game-id="yutnori"]');
    await Promise.all([
      p1.waitForURL(/\/yutnori\//, { timeout: 10000 }),
      yutnoriCard.click(),
    ]);

    // players=4 (1 human + 3 AI) 확인
    expect(p1.url()).toContain('players=4');
  });
});

test.describe('AI 슬롯 채우기 - 다인 시나리오', () => {
  test('TC-AI-05: AI 슬롯 채운 후 실제 플레이어 입장 -> AI 슬롯 감소', async ({ browser }) => {
    // 호스트(p1) 입장
    const ctx1 = await browser.newContext();
    const p1 = await ctx1.newPage();
    await enterLobby(p1, 'Host');
    await waitForLobbyState(p1);

    // 3인 목표 설정
    await setTarget(p1, 3);

    // AI 채우기 (슬롯 2개)
    await p1.locator('#btn-fill-ai').click();
    await p1.waitForTimeout(500);

    // AI 2명 확인
    let aiSlots = p1.locator('.presence-item.ai-slot');
    await expect(aiSlots).toHaveCount(2);

    // 게스트(p2) 입장
    const ctx2 = await browser.newContext();
    const p2 = await ctx2.newPage();
    await enterLobby(p2, 'Guest1');
    await waitForLobbyState(p2);

    // 호스트 측에서 AI 슬롯이 1개로 줄었는지 확인
    await p1.waitForTimeout(500);
    aiSlots = p1.locator('.presence-item.ai-slot');
    await expect(aiSlots).toHaveCount(1);

    // 힌트가 여전히 AI 채움 상태인지 확인
    const aiFillHint = p1.locator('#ai-fill-hint');
    await expect(aiFillHint).toHaveText('AI 1명 대기 중');

    // 게스트(p3) 입장 -> AI 슬롯 0
    const ctx3 = await browser.newContext();
    const p3 = await ctx3.newPage();
    await enterLobby(p3, 'Guest2');
    await waitForLobbyState(p3);

    await p1.waitForTimeout(500);
    aiSlots = p1.locator('.presence-item.ai-slot');
    await expect(aiSlots).toHaveCount(0);

    // 스크린샷
    await p1.screenshot({ path: 'tests/screenshots/ai-fill-05-players-replaced-ai.png' });

    // 정리
    await p3.close().catch(() => {});
    await p2.close().catch(() => {});
    await p1.close().catch(() => {});
    await new Promise((r) => setTimeout(r, 300));
  });

  test('TC-AI-06: 정원 충족(3인 인간) -> AI 채우기 버튼 미표시', async ({ browser }) => {
    // 3명 입장
    const ctx1 = await browser.newContext();
    const p1 = await ctx1.newPage();
    await enterLobby(p1, 'Host');
    await waitForLobbyState(p1);
    await setTarget(p1, 3);

    const ctx2 = await browser.newContext();
    const p2 = await ctx2.newPage();
    await enterLobby(p2, 'G1');

    const ctx3 = await browser.newContext();
    const p3 = await ctx3.newPage();
    await enterLobby(p3, 'G2');

    await p1.waitForTimeout(800);

    // AI 채우기 버튼 영역 확인 — 빈 슬롯 없으므로 숨겨야 함 또는 비활성
    // canShowAiFill = role === 'host' && target >= 3 && (count < target || currentAiSlotCount > 0)
    // count=3, target=3, currentAiSlotCount=0 → count < target = false, aiSlotCount > 0 = false → hidden
    const aiControls = p1.locator('#ai-fill-controls');
    await expect(aiControls).toBeHidden();

    await p3.close().catch(() => {});
    await p2.close().catch(() => {});
    await p1.close().catch(() => {});
    await new Promise((r) => setTimeout(r, 300));
  });
});

test.describe('AI 슬롯 채우기 - 엣지케이스', () => {
  test('TC-AI-08: 모든 클라이언트 퇴장 -> aiSlotCount 리셋', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const p1 = await ctx1.newPage();
    await enterLobby(p1, 'Host');
    await waitForLobbyState(p1);

    await setTarget(p1, 3);
    await p1.locator('#btn-fill-ai').click();
    await p1.waitForTimeout(500);

    // AI 2명 확인
    let aiSlots = p1.locator('.presence-item.ai-slot');
    await expect(aiSlots).toHaveCount(2);

    // 호스트 퇴장 -> 서버 상태 리셋
    await p1.close();
    await new Promise((r) => setTimeout(r, 500));

    // 새 클라이언트 입장 -> aiSlotCount=0이어야 함
    const ctx2 = await browser.newContext();
    const p2 = await ctx2.newPage();
    await enterLobby(p2, 'NewHost');
    await waitForLobbyState(p2);

    // AI 슬롯 없어야 함
    aiSlots = p2.locator('.presence-item.ai-slot');
    await expect(aiSlots).toHaveCount(0);

    // targetPlayers도 2로 리셋되었으므로 AI 채우기 컨트롤 숨김
    const aiControls = p2.locator('#ai-fill-controls');
    await expect(aiControls).toBeHidden();

    await p2.close().catch(() => {});
    await new Promise((r) => setTimeout(r, 300));
  });

  test('TC-AI-09: AI 채우기 더블클릭 시 에러 없이 처리', async ({ browser }) => {
    const errors = [];
    const ctx1 = await browser.newContext();
    const p1 = await ctx1.newPage();
    p1.on('pageerror', (err) => errors.push(err.message));

    await enterLobby(p1, 'Host');
    await waitForLobbyState(p1);

    await setTarget(p1, 3);
    await p1.waitForTimeout(300);

    // 채우기 버튼 빠른 더블클릭
    const btnFill = p1.locator('#btn-fill-ai');
    await btnFill.dblclick();
    await p1.waitForTimeout(500);

    // 에러 없어야 함
    expect(errors.filter(e => !e.includes('ResizeObserver'))).toEqual([]);

    // AI 슬롯 수가 정상 (2개, 중복 생성 없음)
    const aiSlots = p1.locator('.presence-item.ai-slot');
    await expect(aiSlots).toHaveCount(2);

    await p1.close().catch(() => {});
    await new Promise((r) => setTimeout(r, 300));
  });

  test('TC-AI-10: targetPlayers 변경 시 aiSlotCount 리셋', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const p1 = await ctx1.newPage();
    await enterLobby(p1, 'Host');
    await waitForLobbyState(p1);

    // 3인 -> AI 채우기
    await setTarget(p1, 3);
    await p1.locator('#btn-fill-ai').click();
    await p1.waitForTimeout(500);
    let aiSlots = p1.locator('.presence-item.ai-slot');
    await expect(aiSlots).toHaveCount(2);

    // 목표를 4인으로 변경 -> AI 리셋
    await setTarget(p1, 4);
    await p1.waitForTimeout(500);
    aiSlots = p1.locator('.presence-item.ai-slot');
    await expect(aiSlots).toHaveCount(0);

    // AI 힌트 비워졌는지
    const aiFillHint = p1.locator('#ai-fill-hint');
    await expect(aiFillHint).toHaveText('');

    await p1.close().catch(() => {});
    await new Promise((r) => setTimeout(r, 300));
  });

  test('TC-AI-11: 게스트는 AI 채우기 버튼 미표시', async ({ browser }) => {
    // 호스트 입장
    const ctx1 = await browser.newContext();
    const p1 = await ctx1.newPage();
    await enterLobby(p1, 'Host');
    await waitForLobbyState(p1);
    await setTarget(p1, 3);

    // 게스트 입장
    const ctx2 = await browser.newContext();
    const p2 = await ctx2.newPage();
    await enterLobby(p2, 'Guest');
    await waitForLobbyState(p2);

    await p2.waitForTimeout(300);

    // 게스트에게 AI 채우기 컨트롤 숨겨야 함
    const aiControls = p2.locator('#ai-fill-controls');
    await expect(aiControls).toBeHidden();

    // 스크린샷
    await p2.screenshot({ path: 'tests/screenshots/ai-fill-11-guest-no-button.png' });

    await p2.close().catch(() => {});
    await p1.close().catch(() => {});
    await new Promise((r) => setTimeout(r, 300));
  });

  test('TC-AI-12: AI 채운 상태에서 채우기 버튼 숨김, 취소만 표시', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const p1 = await ctx1.newPage();
    await enterLobby(p1, 'Host');
    await waitForLobbyState(p1);
    await setTarget(p1, 3);

    // AI 채우기
    await p1.locator('#btn-fill-ai').click();
    await p1.waitForTimeout(500);

    // 채우기 버튼 숨김 확인
    const btnFill = p1.locator('#btn-fill-ai');
    await expect(btnFill).toBeHidden();

    // 취소 버튼 표시 확인
    const btnCancel = p1.locator('#btn-cancel-ai');
    await expect(btnCancel).toBeVisible();

    await p1.close().catch(() => {});
    await new Promise((r) => setTimeout(r, 300));
  });
});

test.describe('AI 슬롯 채우기 - 콘솔 에러 검증', () => {
  test('TC-AI-13: 전체 흐름에서 콘솔 에러 없음', async ({ browser }) => {
    const errors = [];
    const ctx1 = await browser.newContext();
    const p1 = await ctx1.newPage();
    p1.on('pageerror', (err) => errors.push(err.message));

    await enterLobby(p1, 'Host');
    await waitForLobbyState(p1);

    // 3인 설정
    await setTarget(p1, 3);
    await p1.waitForTimeout(200);

    // AI 채우기
    await p1.locator('#btn-fill-ai').click();
    await p1.waitForTimeout(300);

    // AI 취소
    await p1.locator('#btn-cancel-ai').click();
    await p1.waitForTimeout(300);

    // 다시 채우기
    await p1.locator('#btn-fill-ai').click();
    await p1.waitForTimeout(300);

    // 2인으로 변경 (리셋)
    await setTarget(p1, 2);
    await p1.waitForTimeout(300);

    // 다시 4인
    await setTarget(p1, 4);
    await p1.waitForTimeout(200);

    // 채우기
    await p1.locator('#btn-fill-ai').click();
    await p1.waitForTimeout(300);

    // ResizeObserver 무시
    const realErrors = errors.filter((e) => !e.includes('ResizeObserver'));
    expect(realErrors).toEqual([]);

    await p1.close().catch(() => {});
    await new Promise((r) => setTimeout(r, 300));
  });
});

test.describe('AI 슬롯 채우기 - 기존 2인 AI 흐름 회귀', () => {
  test('TC-AI-14: targetPlayers=2, 1인 단독 -> 게임 카드 클릭 가능 (기존 흐름)', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const p1 = await ctx1.newPage();
    await enterLobby(p1, 'Host');
    await waitForLobbyState(p1);

    // 기본값 targetPlayers=2, 1인 단독 상태에서 카드 클릭 가능해야 함
    // cardClickEnabled = role === 'host' && (target <= 2 || ...)  ->  true
    const cardClickEnabled = await p1.evaluate(() => {
      const card = document.querySelector('.game-card[data-game-id="matgo"]');
      if (!card) return false;
      // pointer-events가 none이 아니어야 클릭 가능
      const style = getComputedStyle(card);
      return style.pointerEvents !== 'none' && !card.classList.contains('player-disabled');
    });
    expect(cardClickEnabled).toBe(true);

    // AI 채우기 컨트롤은 숨겨야 함
    const aiControls = p1.locator('#ai-fill-controls');
    await expect(aiControls).toBeHidden();

    await p1.close().catch(() => {});
    await new Promise((r) => setTimeout(r, 300));
  });
});

test.describe('AI 슬롯 채우기 - 시각적 검증', () => {
  test('TC-AI-15: AI 채운 상태의 로비 전체 레이아웃', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const p1 = await ctx1.newPage();
    await enterLobby(p1, 'Host');
    await waitForLobbyState(p1);

    await setTarget(p1, 3);
    await p1.locator('#btn-fill-ai').click();
    await p1.waitForTimeout(500);

    // 전체 페이지 스크린샷
    await p1.screenshot({ path: 'tests/screenshots/ai-fill-15-full-layout.png', fullPage: true });

    // 메타 영역 상세 스크린샷
    const lobbyMeta = p1.locator('.lobby-meta');
    await lobbyMeta.screenshot({ path: 'tests/screenshots/ai-fill-15-meta-area.png' });

    await p1.close().catch(() => {});
    await new Promise((r) => setTimeout(r, 300));
  });
});
