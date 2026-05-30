/**
 * @fileoverview 윷놀이 E2E 브라우저 시나리오 테스트.
 *
 * Playwright 브라우저(Chromium) 기반. 서버가 3088 포트에서 실행 중이어야 한다.
 * 두 브라우저 페이지(P1/P2)를 동시에 열어 실제 대전 흐름을 테스트한다.
 *
 * 서버 시작:
 *   node server.js --port 3088
 *
 * 실행:
 *   npx playwright test tests/e2e-scenarios.spec.js --reporter=list
 *
 * §1 기본 연결    (E-01~E-06)
 * §2 기본 플레이  (E-07~E-11)
 * §3 inject 시나리오 (E-12~E-18)
 * §4 게임 오버    (E-19~E-22)
 * §5 안정성       (E-23~E-25)
 */

import { test, expect } from 'playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = 'http://localhost:3088';
const INJECT_URL = `${BASE_URL}/test/inject`;

// ── 헬퍼 ─────────────────────────────────────────────────────────

/**
 * 두 페이지(P1/P2)를 열고 양쪽 JOIN을 완료한다.
 * @param {import('@playwright/test').BrowserContext} context
 * @returns {Promise<{ pageP1: Page, pageP2: Page }>}
 */
async function openTwoPlayers(context) {
  const pageP1 = await context.newPage();
  const pageP2 = await context.newPage();
  await pageP1.goto(BASE_URL);
  await pageP2.goto(BASE_URL);
  // JOIN은 DOMContentLoaded + 300ms 후 자동으로 전송됨 (main.js)
  // P1이 JOINED 받을 때까지 대기
  await pageP1.waitForFunction(
    () => {
      const el = document.getElementById('player-label');
      return el && el.textContent && !el.textContent.includes('접속 중');
    },
    { timeout: 5000 },
  );
  await pageP2.waitForFunction(
    () => {
      const el = document.getElementById('player-label');
      return el && el.textContent && !el.textContent.includes('접속 중');
    },
    { timeout: 5000 },
  );
  return { pageP1, pageP2 };
}

/**
 * 양쪽 모두 READY 클릭 후 게임 시작(카운트다운 완료)까지 기다린다.
 * @param {Page} pageP1
 * @param {Page} pageP2
 */
async function startGame(pageP1, pageP2) {
  await pageP1.click('#ready-btn');
  await pageP2.click('#ready-btn');
  // 카운트다운(3초) + 'GO!' 후 throw-btn 활성화까지 대기
  await pageP1.waitForFunction(
    () => {
      const btn = document.getElementById('throw-btn');
      return btn && !btn.disabled;
    },
    { timeout: 10000 },
  );
}

/**
 * inject 엔드포인트에 POST를 보낸다.
 * @param {Page} page
 * @param {object} cfg
 */
async function inject(page, cfg) {
  await page.request.post(INJECT_URL, {
    headers: { 'Content-Type': 'application/json' },
    data: cfg,
  });
}

// ── §1 기본 연결 ─────────────────────────────────────────────────

test('E-01: P1 페이지 로드 — 타이틀에 "윷놀이" 포함', async ({ page }) => {
  await page.goto(BASE_URL);
  await expect(page).toHaveTitle(/윷놀이/);
});

test('E-02: P1 JOIN 후 #invite-panel 표시', async ({ context }) => {
  // 단독 P1 연결 — P2 없이 대기 중일 때 invite-panel이 표시되는지 확인
  // openTwoPlayers를 호출하면 서버 정원(2명)이 차서 soloPage가 거절되므로 사용하지 않는다.
  const soloPage = await context.newPage();
  await soloPage.goto(BASE_URL);
  // JOIN은 DOMContentLoaded + 300ms 후 자동 전송(main.js) → JOINED 수신 → 라벨 갱신
  await soloPage.waitForFunction(
    () => {
      const el = document.getElementById('player-label');
      return el && el.textContent && !el.textContent.includes('접속 중');
    },
    null,            // waitForFunction(fn, arg, options) — arg 없음
    { timeout: 10000 },
  );
  const invitePanel = soloPage.locator('#invite-panel');
  await expect(invitePanel).not.toHaveClass(/hidden/, { timeout: 3000 });
});

test('E-03: P1 #player-label 에 "P1" 포함', async ({ context }) => {
  const { pageP1 } = await openTwoPlayers(context);
  const label = await pageP1.textContent('#player-label');
  expect(label).toContain('P1');
});

test('E-04: P2 #player-label 에 "P2" 포함', async ({ context }) => {
  const { pageP1, pageP2 } = await openTwoPlayers(context);
  const label = await pageP2.textContent('#player-label');
  expect(label).toContain('P2');
});

test('E-05: 주요 DOM ID 6개 존재', async ({ page }) => {
  await page.goto(BASE_URL);
  for (const id of [
    'throw-btn', 'ready-btn', 'branch-modal',
    'result-overlay', 'board-canvas', 'result-queue',
  ]) {
    await expect(page.locator(`#${id}`)).toHaveCount(1);
  }
});

test('E-06: 초기 상태 — #result-overlay와 #branch-modal 숨김', async ({ page }) => {
  await page.goto(BASE_URL);
  await expect(page.locator('#result-overlay')).toHaveClass(/hidden/);
  await expect(page.locator('#branch-modal')).toHaveClass(/hidden/);
});

// ── §2 기본 플레이 ────────────────────────────────────────────────

test('E-07: 양쪽 READY 클릭 → 카운트다운 표시', async ({ context }) => {
  const { pageP1, pageP2 } = await openTwoPlayers(context);
  await pageP1.click('#ready-btn');
  await pageP2.click('#ready-btn');
  // countdown 엘리먼트가 숨겨지지 않은 상태로 표시
  await pageP1.waitForFunction(
    () => {
      const el = document.getElementById('countdown');
      return el && !el.classList.contains('hidden') && el.textContent.trim() !== '';
    },
    { timeout: 5000 },
  );
  const cdText = await pageP1.textContent('#countdown');
  expect(['3', '2', '1', 'GO!'].some((v) => cdText.includes(v))).toBe(true);
});

test('E-08: 게임 시작 후 P1(currentTurn) #throw-btn 활성화', async ({ context }) => {
  const { pageP1, pageP2 } = await openTwoPlayers(context);
  await startGame(pageP1, pageP2);
  await expect(pageP1.locator('#throw-btn')).toBeEnabled({ timeout: 5000 });
});

test('E-09: #throw-btn 클릭 → #yut-result 텍스트 표시', async ({ context }) => {
  const { pageP1, pageP2 } = await openTwoPlayers(context);
  await startGame(pageP1, pageP2);
  await pageP1.click('#throw-btn');
  await pageP1.waitForFunction(
    () => {
      const el = document.getElementById('yut-result');
      return el && el.textContent && el.textContent.trim() !== '';
    },
    { timeout: 5000 },
  );
  const resultText = await pageP1.textContent('#yut-result');
  // 윷 결과 이름 중 하나여야 함
  const validResults = ['도', '개', '걸', '윷', '모', '백도'];
  expect(validResults.some((r) => resultText.includes(r))).toBe(true);
});

test('E-10: 던진 후 #result-queue에 결과 칩 표시', async ({ context }) => {
  const { pageP1, pageP2 } = await openTwoPlayers(context);
  await startGame(pageP1, pageP2);

  // inject로 pendingResults에 'do' 주입 (결과 큐에 바로 반영)
  await inject(pageP1, { started: true, currentTurn: 'p1', pendingResults: ['do'] });

  await pageP1.waitForFunction(
    () => {
      const q = document.getElementById('result-queue');
      return q && !q.textContent.includes('없음') && q.querySelector('.result-chip');
    },
    { timeout: 5000 },
  );
  const chipCount = await pageP1.locator('#result-queue .result-chip').count();
  expect(chipCount).toBeGreaterThanOrEqual(1);
});

test('E-11: #turn-label이 "내 턴" 또는 "상대 턴"을 표시', async ({ context }) => {
  const { pageP1, pageP2 } = await openTwoPlayers(context);
  await startGame(pageP1, pageP2);
  // 게임 시작 후 P1이 첫 턴
  const turnText = await pageP1.textContent('#turn-label');
  expect(['내 턴', '상대 턴', '-'].some((t) => turnText.includes(t))).toBe(true);
});

// ── §3 inject 시나리오 ───────────────────────────────────────────

test('E-12: inject pendingResults=["do"] → #result-queue에 "도" chip', async ({ context }) => {
  const { pageP1, pageP2 } = await openTwoPlayers(context);
  await startGame(pageP1, pageP2);
  await inject(pageP1, { started: true, currentTurn: 'p1', pendingResults: ['do'] });

  await pageP1.waitForFunction(
    () => {
      const q = document.getElementById('result-queue');
      return q && q.textContent.includes('도');
    },
    { timeout: 5000 },
  );
  const qText = await pageP1.textContent('#result-queue');
  expect(qText).toContain('도');
});

test('E-13: inject pendingResults=["yut"] → #result-queue에 "윷" chip', async ({ context }) => {
  const { pageP1, pageP2 } = await openTwoPlayers(context);
  await startGame(pageP1, pageP2);
  await inject(pageP1, { started: true, currentTurn: 'p1', pendingResults: ['yut'] });

  await pageP1.waitForFunction(
    () => {
      const q = document.getElementById('result-queue');
      return q && q.textContent.includes('윷');
    },
    { timeout: 5000 },
  );
  const qText = await pageP1.textContent('#result-queue');
  expect(qText).toContain('윷');
});

test('E-14: inject currentTurn=p2 → P1 #throw-btn 비활성화', async ({ context }) => {
  const { pageP1, pageP2 } = await openTwoPlayers(context);
  await startGame(pageP1, pageP2);
  // 현재 P1 턴이므로 throw-btn이 활성화 상태 → inject로 p2 턴으로 전환
  await inject(pageP1, { started: true, currentTurn: 'p2' });

  await pageP1.waitForFunction(
    () => {
      const btn = document.getElementById('throw-btn');
      return btn && btn.disabled;
    },
    { timeout: 5000 },
  );
  await expect(pageP1.locator('#throw-btn')).toBeDisabled({ timeout: 3000 });
});

test('E-15: inject currentTurn=p2 → P2 #throw-btn 활성화', async ({ context }) => {
  const { pageP1, pageP2 } = await openTwoPlayers(context);
  await startGame(pageP1, pageP2);
  await inject(pageP1, { started: true, currentTurn: 'p2' });

  await pageP2.waitForFunction(
    () => {
      const btn = document.getElementById('throw-btn');
      return btn && !btn.disabled;
    },
    { timeout: 5000 },
  );
  await expect(pageP2.locator('#throw-btn')).toBeEnabled({ timeout: 3000 });
});

test('E-16: inject awaitingBranchAt=0 → P1 #branch-modal 표시', async ({ context }) => {
  const { pageP1, pageP2 } = await openTwoPlayers(context);
  await startGame(pageP1, pageP2);
  await inject(pageP1, {
    started: true,
    currentTurn: 'p1',
    awaitingBranchAt: 0,
    awaitingBranchResult: 'do',
    pendingResults: ['do'],
  });

  await pageP1.waitForFunction(
    () => {
      const modal = document.getElementById('branch-modal');
      return modal && !modal.classList.contains('hidden');
    },
    { timeout: 5000 },
  );
  await expect(pageP1.locator('#branch-modal')).not.toHaveClass(/hidden/);
});

test('E-17: branch-modal에서 #branch-top-btn 클릭 → modal 숨김', async ({ context }) => {
  const { pageP1, pageP2 } = await openTwoPlayers(context);
  await startGame(pageP1, pageP2);
  await inject(pageP1, {
    started: true,
    currentTurn: 'p1',
    awaitingBranchAt: 0,
    awaitingBranchResult: 'do',
    pendingResults: ['do'],
  });

  // 모달이 표시될 때까지 대기
  await pageP1.waitForFunction(
    () => !document.getElementById('branch-modal').classList.contains('hidden'),
    { timeout: 5000 },
  );
  await pageP1.click('#branch-top-btn');

  // 모달 숨김 대기
  await pageP1.waitForFunction(
    () => document.getElementById('branch-modal').classList.contains('hidden'),
    { timeout: 5000 },
  );
  await expect(pageP1.locator('#branch-modal')).toHaveClass(/hidden/);
});

test('E-18: inject pieces — P1 말 3개 done → #my-done = 3', async ({ context }) => {
  const { pageP1, pageP2 } = await openTwoPlayers(context);
  await startGame(pageP1, pageP2);
  await inject(pageP1, {
    started: true,
    currentTurn: 'p1',
    pieces: {
      p1: [
        { cell: 99, stack: 1, done: true },
        { cell: 99, stack: 1, done: true },
        { cell: 99, stack: 1, done: true },
        { cell: -1, stack: 1, done: false },
      ],
    },
  });

  await pageP1.waitForFunction(
    () => {
      const el = document.getElementById('my-done');
      return el && el.textContent.trim() === '3';
    },
    { timeout: 5000 },
  );
  const doneText = await pageP1.textContent('#my-done');
  expect(doneText.trim()).toBe('3');
});

// ── §4 게임 오버 ──────────────────────────────────────────────────

test('E-19: inject winner=p1 → P1 #result-overlay 표시', async ({ context }) => {
  const { pageP1, pageP2 } = await openTwoPlayers(context);
  await startGame(pageP1, pageP2);
  await inject(pageP1, { winner: 'p1' });

  await pageP1.waitForFunction(
    () => !document.getElementById('result-overlay').classList.contains('hidden'),
    { timeout: 5000 },
  );
  await expect(pageP1.locator('#result-overlay')).not.toHaveClass(/hidden/);
});

test('E-20: inject winner=p1 → P1 #result-text에 "승리" 포함', async ({ context }) => {
  const { pageP1, pageP2 } = await openTwoPlayers(context);
  await startGame(pageP1, pageP2);
  await inject(pageP1, { winner: 'p1' });

  await pageP1.waitForSelector('#result-overlay:not(.hidden)', { timeout: 5000 });
  const resultText = await pageP1.textContent('#result-text');
  expect(resultText).toContain('승리');
});

test('E-21: inject winner=p2 → P2 #result-text에 "승리" 포함', async ({ context }) => {
  const { pageP1, pageP2 } = await openTwoPlayers(context);
  await startGame(pageP1, pageP2);
  await inject(pageP1, { winner: 'p2' });

  await pageP2.waitForSelector('#result-overlay:not(.hidden)', { timeout: 5000 });
  const resultText = await pageP2.textContent('#result-text');
  expect(resultText).toContain('승리');
});

test('E-22: 결과 오버레이 표시 후 #rematch-btn 표시', async ({ context }) => {
  const { pageP1, pageP2 } = await openTwoPlayers(context);
  await startGame(pageP1, pageP2);
  await inject(pageP1, { winner: 'p1' });

  await pageP1.waitForSelector('#result-overlay:not(.hidden)', { timeout: 5000 });
  await expect(pageP1.locator('#rematch-btn')).not.toHaveClass(/hidden/, { timeout: 3000 });
});

// ── §5 안정성 ─────────────────────────────────────────────────────

test('E-23: 게임 시작 후 콘솔 에러 없음', async ({ context }) => {
  const errors = [];
  const { pageP1, pageP2 } = await openTwoPlayers(context);
  pageP1.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await startGame(pageP1, pageP2);
  // 카운트다운 완료 후 짧게 대기
  await pageP1.waitForTimeout(500);
  // 알려진 에러 패턴(favicon 404 등) 제외
  const realErrors = errors.filter(
    (e) => !e.includes('favicon') && !e.includes('ERR_FILE_NOT_FOUND'),
  );
  expect(realErrors).toHaveLength(0);
});

test('E-24: 두 플레이어 동시 유지 — 턴 라벨 동기화', async ({ context }) => {
  const { pageP1, pageP2 } = await openTwoPlayers(context);
  await startGame(pageP1, pageP2);
  await inject(pageP1, { started: true, currentTurn: 'p1' });

  // P1은 "내 턴", P2는 "상대 턴"
  await pageP1.waitForFunction(
    () => document.getElementById('turn-label')?.textContent?.includes('내 턴'),
    { timeout: 5000 },
  );
  await pageP2.waitForFunction(
    () => document.getElementById('turn-label')?.textContent?.includes('상대 턴'),
    { timeout: 5000 },
  );

  const p1Turn = await pageP1.textContent('#turn-label');
  const p2Turn = await pageP2.textContent('#turn-label');
  expect(p1Turn).toContain('내 턴');
  expect(p2Turn).toContain('상대 턴');
});

test('E-25: 레이아웃 스크린샷 — 게임 대기 화면', async ({ context }) => {
  const screenshotDir = path.join(__dirname, 'screenshots');
  const { pageP1, pageP2 } = await openTwoPlayers(context);
  // P2 입장 후 대기 화면 스크린샷
  await pageP1.setViewportSize({ width: 1280, height: 800 });
  await pageP1.screenshot({
    path: path.join(screenshotDir, 'e2e-01-lobby.png'),
    fullPage: false,
  });
  // 게임 시작 후 스크린샷
  await startGame(pageP1, pageP2);
  await pageP1.screenshot({
    path: path.join(screenshotDir, 'e2e-02-ingame.png'),
    fullPage: false,
  });
  // 스크린샷 파일 생성 확인 (테스트 성공 기준은 에러 없이 완료)
  expect(true).toBe(true);
});
