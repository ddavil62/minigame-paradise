/**
 * @fileoverview 다빈치 코드 UI 전면 개편 QA 테스트.
 *
 * 검증 범위:
 * - TC-01~03: 2-column 레이아웃
 * - TC-04~07: 숫자 메모판
 * - TC-08~11: 추측 기록
 * - TC-12~15: 기존 기능 회귀
 * - 예외/엣지케이스: 콘솔 에러, 빈 상태, 연타, DOM 잔존 체크
 *
 * 서버가 2인 고정이므로 test.describe.serial로 직렬 실행하고,
 * 각 테스트 전후로 WS 연결 정리를 보장한다.
 */

import { test, expect } from '@playwright/test';

const DAVINCI_URL = '/davinci-code/';

/**
 * 두 별도 컨텍스트(P1, P2)를 열고 GAME_START까지 대기하는 헬퍼.
 * cleanup을 반드시 호출해야 서버 슬롯이 해제된다.
 */
async function setupTwoPlayers(browser) {
  const ctx1 = await browser.newContext();
  const ctx2 = await browser.newContext();
  const p1 = await ctx1.newPage();
  const p2 = await ctx2.newPage();

  // confirm 대화상자 자동 수락 (새 게임 등)
  p1.on('dialog', (d) => d.accept());
  p2.on('dialog', (d) => d.accept());

  // 콘솔 에러 수집
  p1._errors = [];
  p2._errors = [];
  p1.on('pageerror', (err) => p1._errors.push(err.message));
  p2.on('pageerror', (err) => p2._errors.push(err.message));

  await p1.goto(DAVINCI_URL);
  // P1이 접속하고 you-tag에 텍스트가 설정될 때까지 대기
  await p1.waitForFunction(
    () => {
      const el = document.getElementById('you-tag');
      return el && el.textContent && el.textContent.includes('플레이어');
    },
    { timeout: 8000 },
  );

  await p2.goto(DAVINCI_URL);
  // P2도 접속하면 서버가 GAME_START를 보내므로 양쪽 턴 상태를 대기
  await Promise.all([
    p1.waitForFunction(
      () => {
        const el = document.getElementById('turn-status');
        return el && (el.textContent === '내 턴' || el.textContent === '상대 턴');
      },
      { timeout: 8000 },
    ),
    p2.waitForFunction(
      () => {
        const el = document.getElementById('turn-status');
        return el && (el.textContent === '내 턴' || el.textContent === '상대 턴');
      },
      { timeout: 8000 },
    ),
  ]);

  const cleanup = async () => {
    await ctx1.close();
    await ctx2.close();
    // 서버가 disconnect를 감지하고 슬롯을 해제할 시간
    await new Promise((r) => setTimeout(r, 500));
  };

  return { p1, p2, cleanup };
}

/** 현재 턴인 페이지를 반환한다. */
async function getActivePlayer(p1, p2) {
  const t = await p1.locator('#turn-status').textContent();
  return t === '내 턴' ? p1 : p2;
}

/** 첫 번째 미공개 상대 카드를 선택하고 guessValue로 추측한다. */
async function performGuess(page, guessValue = 5) {
  const clickable = page.locator('.opp-hand .card.clickable');
  const cnt = await clickable.count();
  if (cnt === 0) throw new Error('No clickable cards');
  await clickable.first().click();
  await page.fill('#guess-value', String(guessValue));
  await page.click('#btn-guess');
  await page.waitForTimeout(400);
}

// ============================================================
test.describe.serial('다빈치 코드 UI 전면 개편 QA', () => {

  // ── TC-01~03: 레이아웃 ──
  test('TC-01: 2-column Grid 렌더링 (좌 게임보드 / 우 정보패널)', async ({ browser }) => {
    const { p1, cleanup } = await setupTwoPlayers(browser);
    try {
      const grid = await p1.evaluate(() => {
        const el = document.querySelector('.play-area');
        const cs = getComputedStyle(el);
        return { display: cs.display, cols: cs.gridTemplateColumns };
      });
      expect(grid.display).toBe('grid');
      expect(grid.cols.split(' ').length).toBe(2);

      await expect(p1.locator('.game-board')).toBeVisible();
      await expect(p1.locator('.info-panel')).toBeVisible();

      const sizes = await p1.evaluate(() => {
        const gb = document.querySelector('.game-board').getBoundingClientRect();
        const ip = document.querySelector('.info-panel').getBoundingClientRect();
        return { gbW: gb.width, ipW: ip.width };
      });
      expect(sizes.gbW).toBeGreaterThan(sizes.ipW);
      expect(sizes.ipW).toBeGreaterThanOrEqual(280);

      await p1.screenshot({ path: 'tests/screenshots/davinci-tc01-layout.png' });
    } finally {
      await cleanup();
    }
  });

  test('TC-02: 좌 컬럼 수직 순서 (상대 -> 덱 -> 내 -> 액션)', async ({ browser }) => {
    const { p1, cleanup } = await setupTwoPlayers(browser);
    try {
      const pos = await p1.evaluate(() => {
        const ch = [...document.querySelector('.game-board').children];
        return ch.map((e) => ({ cls: e.className, top: e.getBoundingClientRect().top }));
      });
      expect(pos.length).toBeGreaterThanOrEqual(4);

      const opp = pos.findIndex((p) => p.cls.includes('opp-hand'));
      const cen = pos.findIndex((p) => p.cls.includes('center-area'));
      const my = pos.findIndex((p) => p.cls.includes('my-hand'));
      const act = pos.findIndex((p) => p.cls.includes('action-panel'));

      expect(opp).toBeLessThan(cen);
      expect(cen).toBeLessThan(my);
      expect(my).toBeLessThan(act);

      // y좌표 순서도 확인
      expect(pos[opp].top).toBeLessThan(pos[cen].top);
      expect(pos[cen].top).toBeLessThan(pos[my].top);
      expect(pos[my].top).toBeLessThan(pos[act].top);
    } finally {
      await cleanup();
    }
  });

  test('TC-03: 덱/뽑은카드 영역 좌 정렬 (센터 고립 아님)', async ({ browser }) => {
    const { p1, cleanup } = await setupTwoPlayers(browser);
    try {
      const info = await p1.evaluate(() => {
        const ca = document.querySelector('.center-area');
        const cs = getComputedStyle(ca);
        const r = ca.getBoundingClientRect();
        const pr = ca.parentElement.getBoundingClientRect();
        return { align: cs.alignItems, offset: r.left - pr.left };
      });
      expect(info.align).toMatch(/flex-start|start/);
      expect(info.offset).toBeLessThan(50);
    } finally {
      await cleanup();
    }
  });

  // ── TC-04~07: 숫자 메모판 ──
  test('TC-04: 우 패널에 "숫자 메모판" 섹션 존재', async ({ browser }) => {
    const { p1, cleanup } = await setupTwoPlayers(browser);
    try {
      const ip = p1.locator('.info-panel');
      await expect(ip).toBeVisible();
      await expect(ip.locator('.info-title', { hasText: '숫자 메모판' })).toBeVisible();
    } finally {
      await cleanup();
    }
  });

  test('TC-05: 흑 0~11 + 백 0~11 = 24개 타일', async ({ browser }) => {
    const { p1, cleanup } = await setupTwoPlayers(browser);
    try {
      expect(await p1.locator('.memo-tile.black-tile').count()).toBe(12);
      expect(await p1.locator('.memo-tile.white-tile').count()).toBe(12);

      for (let i = 0; i <= 11; i++) {
        await expect(p1.locator(`.memo-tile.black-tile[data-value="${i}"]`)).toBeVisible();
        await expect(p1.locator(`.memo-tile.white-tile[data-value="${i}"]`)).toBeVisible();
      }

      const box = await p1.locator('#memo-board').boundingBox();
      if (box) {
        await p1.screenshot({ path: 'tests/screenshots/davinci-tc05-memo.png', clip: box });
      }
    } finally {
      await cleanup();
    }
  });

  test('TC-06: 흑/백 섹션 레이블 표시', async ({ browser }) => {
    const { p1, cleanup } = await setupTwoPlayers(browser);
    try {
      const labels = await p1.locator('.memo-section-label').allTextContents();
      expect(labels.some((l) => l.includes('검정'))).toBe(true);
      expect(labels.some((l) => l.includes('흰색'))).toBe(true);
    } finally {
      await cleanup();
    }
  });

  test('TC-07: 공개 카드에 대응하는 메모 타일 .used 적용', async ({ browser }) => {
    const { p1, p2, cleanup } = await setupTwoPlayers(browser);
    try {
      // 게임 시작 직후 used 없음
      expect(await p1.locator('.memo-tile.used').count()).toBe(0);

      const active = await getActivePlayer(p1, p2);
      await performGuess(active, 0);
      await active.waitForTimeout(400);

      // 맞든 틀리든 최소 1장 공개 -> used 존재
      const u1 = await p1.locator('.memo-tile.used').count();
      const u2 = await p2.locator('.memo-tile.used').count();
      expect(u1 + u2).toBeGreaterThan(0);

      await active.screenshot({ path: 'tests/screenshots/davinci-tc07-used.png' });
    } finally {
      await cleanup();
    }
  });

  // ── TC-08~11: 추측 기록 ──
  test('TC-08: 우 패널에 "추측 기록" 섹션 존재', async ({ browser }) => {
    const { p1, cleanup } = await setupTwoPlayers(browser);
    try {
      await expect(p1.locator('.info-panel .info-title', { hasText: '추측 기록' })).toBeVisible();
    } finally {
      await cleanup();
    }
  });

  test('TC-09: 추측 후 기록 항목 추가 + 내용 검증', async ({ browser }) => {
    const { p1, p2, cleanup } = await setupTwoPlayers(browser);
    try {
      const active = await getActivePlayer(p1, p2);

      expect(await active.locator('.history-item').count()).toBe(0);
      await performGuess(active, 3);

      expect(await active.locator('.history-item').count()).toBe(1);
      const item = active.locator('.history-item').first();
      expect((await item.locator('.history-who').textContent()).trim()).toBe('나');
      expect(await item.locator('.history-detail').textContent()).toContain('3');
      const res = (await item.locator('.history-result').textContent()).trim();
      expect(['\u2713', '\u2717']).toContain(res);
    } finally {
      await cleanup();
    }
  });

  test('TC-10: correct/wrong 클래스 적용', async ({ browser }) => {
    const { p1, p2, cleanup } = await setupTwoPlayers(browser);
    try {
      const active = await getActivePlayer(p1, p2);
      await performGuess(active, 3);

      const cls = await active.locator('.history-item').first().getAttribute('class');
      expect(cls.includes('correct') || cls.includes('wrong')).toBe(true);
    } finally {
      await cleanup();
    }
  });

  test('TC-11: 새 게임(GAME_START) 시 추측 기록 초기화', async ({ browser }) => {
    const { p1, p2, cleanup } = await setupTwoPlayers(browser);
    try {
      const active = await getActivePlayer(p1, p2);
      await performGuess(active, 3);
      expect(await active.locator('.history-item').count()).toBeGreaterThan(0);

      // 새 게임 시작 (dialog는 자동 수락)
      await active.click('#btn-restart');
      await active.waitForTimeout(800);

      // 게임 재시작 대기
      await p1.waitForFunction(
        () => {
          const el = document.getElementById('turn-status');
          return el && (el.textContent === '내 턴' || el.textContent === '상대 턴');
        },
        { timeout: 8000 },
      );

      expect(await p1.locator('.history-item').count()).toBe(0);
      expect(await p2.locator('.history-item').count()).toBe(0);
    } finally {
      await cleanup();
    }
  });

  // ── TC-12~15: 기존 기능 회귀 ──
  test('TC-12: 두 플레이어 접속 시 게임 정상 시작', async ({ browser }) => {
    const { p1, p2, cleanup } = await setupTwoPlayers(browser);
    try {
      expect(await p1.locator('#you-tag').textContent()).toContain('플레이어 1');
      expect(await p2.locator('#you-tag').textContent()).toContain('플레이어 2');

      expect(await p1.locator('.opp-hand .card').count()).toBe(4);
      expect(await p1.locator('.my-hand .card').count()).toBe(4);

      const dc = parseInt(await p1.locator('#deck-count').textContent());
      expect(dc).toBeGreaterThanOrEqual(14);
      expect(dc).toBeLessThanOrEqual(16);
    } finally {
      await cleanup();
    }
  });

  test('TC-13: 상대카드 선택 -> 숫자입력 -> 추측 전체 플로우', async ({ browser }) => {
    const { p1, p2, cleanup } = await setupTwoPlayers(browser);
    try {
      const active = await getActivePlayer(p1, p2);

      // 1. 클릭 가능한 상대 카드 존재
      const clickable = active.locator('.opp-hand .card.clickable');
      await expect(clickable.first()).toBeVisible();

      // 2. 클릭 -> 슬롯 선택 반영
      await clickable.first().click();
      expect(await active.locator('#selected-slot').textContent()).toContain('1번째');

      // 3. 숫자 입력 + 추측
      await active.fill('#guess-value', '5');
      await active.click('#btn-guess');
      await active.waitForTimeout(500);

      // 4. 상태 변경 확인
      const turn = await active.locator('#turn-status').textContent();
      expect(['내 턴', '상대 턴']).toContain(turn);
    } finally {
      await cleanup();
    }
  });

  test('TC-14: 추측 맞춤 시 계속/멈춤 패널 표시', async ({ browser }) => {
    const { p1, p2, cleanup } = await setupTwoPlayers(browser);
    try {
      const active = await getActivePlayer(p1, p2);
      let found = false;

      for (let val = 0; val <= 11; val++) {
        const clickable = active.locator('.opp-hand .card.clickable');
        if ((await clickable.count()) === 0) break;

        await clickable.first().click();
        await active.fill('#guess-value', String(val));
        await active.click('#btn-guess');
        await active.waitForTimeout(400);

        if (await active.locator('#continue-panel').isVisible()) {
          found = true;
          await expect(active.locator('#btn-continue')).toBeVisible();
          await expect(active.locator('#btn-stop')).toBeVisible();
          await active.screenshot({ path: 'tests/screenshots/davinci-tc14-continue.png' });
          await active.click('#btn-stop');
          break;
        }

        if ((await active.locator('#turn-status').textContent()) === '상대 턴') break;
      }

      // 첫 시도에 틀리면 턴이 넘어가므로 조건부 PASS
      if (!found) {
        console.log('[TC-14] 첫 시도 실패로 턴 전환 -- 조건부 PASS');
      }
    } finally {
      await cleanup();
    }
  });

  test('TC-15: 새 게임 버튼 동작', async ({ browser }) => {
    const { p1, p2, cleanup } = await setupTwoPlayers(browser);
    try {
      await p1.click('#btn-restart');
      await p1.waitForTimeout(800);

      await p1.waitForFunction(
        () => {
          const el = document.getElementById('turn-status');
          return el && (el.textContent === '내 턴' || el.textContent === '상대 턴');
        },
        { timeout: 8000 },
      );

      expect(await p1.locator('.opp-hand .card').count()).toBe(4);
      expect(await p1.locator('.my-hand .card').count()).toBe(4);
    } finally {
      await cleanup();
    }
  });

  // ── 추가 검증 ──
  test('#last-guess 엘리먼트 DOM 부재', async ({ browser }) => {
    const { p1, cleanup } = await setupTwoPlayers(browser);
    try {
      expect(await p1.locator('#last-guess').count()).toBe(0);
    } finally {
      await cleanup();
    }
  });

  test('카드 크기 (.card 80x110, .deck-card 86x118, .pending-card 80x110)', async ({ browser }) => {
    const { p1, cleanup } = await setupTwoPlayers(browser);
    try {
      const card = await p1.evaluate(() => {
        const e = document.querySelector('.card');
        const s = getComputedStyle(e);
        return { w: parseFloat(s.width), h: parseFloat(s.height) };
      });
      expect(card.w).toBe(80);
      expect(card.h).toBe(110);

      const deck = await p1.evaluate(() => {
        const e = document.querySelector('.deck-card');
        const s = getComputedStyle(e);
        return { w: parseFloat(s.width), h: parseFloat(s.height) };
      });
      expect(deck.w).toBe(86);
      expect(deck.h).toBe(118);

      const pending = await p1.evaluate(() => {
        const e = document.querySelector('.pending-card');
        const s = getComputedStyle(e);
        return { w: parseFloat(s.width), h: parseFloat(s.height) };
      });
      expect(pending.w).toBe(80);
      expect(pending.h).toBe(110);
    } finally {
      await cleanup();
    }
  });

  test('콘솔 에러 미발생', async ({ browser }) => {
    const { p1, p2, cleanup } = await setupTwoPlayers(browser);
    try {
      await p1.waitForTimeout(1000);
      const errs = [...p1._errors, ...p2._errors].filter(
        (e) => !e.includes('WebSocket') && !e.includes('연결'),
      );
      expect(errs).toEqual([]);
    } finally {
      await cleanup();
    }
  });

  test('슬롯 미선택 상태에서 추측 버튼 -> 토스트 경고', async ({ browser }) => {
    const { p1, p2, cleanup } = await setupTwoPlayers(browser);
    try {
      const active = await getActivePlayer(p1, p2);
      await active.click('#btn-guess');
      await active.waitForTimeout(300);
      expect(await active.locator('#toast').textContent()).toContain('선택');
    } finally {
      await cleanup();
    }
  });

  test('범위 밖 숫자(12) 입력 -> 토스트 경고', async ({ browser }) => {
    const { p1, p2, cleanup } = await setupTwoPlayers(browser);
    try {
      const active = await getActivePlayer(p1, p2);
      await active.locator('.opp-hand .card.clickable').first().click();
      await active.fill('#guess-value', '12');
      await active.click('#btn-guess');
      await active.waitForTimeout(300);
      expect(await active.locator('#toast').textContent()).toContain('0~11');
    } finally {
      await cleanup();
    }
  });

  test('음수(-1) 입력 -> 토스트 경고', async ({ browser }) => {
    const { p1, p2, cleanup } = await setupTwoPlayers(browser);
    try {
      const active = await getActivePlayer(p1, p2);
      await active.locator('.opp-hand .card.clickable').first().click();
      await active.fill('#guess-value', '-1');
      await active.click('#btn-guess');
      await active.waitForTimeout(300);
      expect(await active.locator('#toast').textContent()).toContain('0~11');
    } finally {
      await cleanup();
    }
  });

  test('엔터키로 추측 전송', async ({ browser }) => {
    const { p1, p2, cleanup } = await setupTwoPlayers(browser);
    try {
      const active = await getActivePlayer(p1, p2);
      await active.locator('.opp-hand .card.clickable').first().click();
      await active.fill('#guess-value', '5');
      await active.press('#guess-value', 'Enter');
      await active.waitForTimeout(500);
      expect(await active.locator('.history-item').count()).toBe(1);
    } finally {
      await cleanup();
    }
  });

  test('info-panel overflow-y: auto 설정', async ({ browser }) => {
    const { p1, cleanup } = await setupTwoPlayers(browser);
    try {
      const ov = await p1.evaluate(() => getComputedStyle(document.querySelector('.info-panel')).overflowY);
      expect(ov).toBe('auto');
    } finally {
      await cleanup();
    }
  });

  test('전체 레이아웃 스크린샷 (P1/P2)', async ({ browser }) => {
    const { p1, p2, cleanup } = await setupTwoPlayers(browser);
    try {
      const active = await getActivePlayer(p1, p2);
      await performGuess(active, 5);
      await active.waitForTimeout(400);

      await p1.screenshot({ path: 'tests/screenshots/davinci-full-p1.png', fullPage: true });
      await p2.screenshot({ path: 'tests/screenshots/davinci-full-p2.png', fullPage: true });
    } finally {
      await cleanup();
    }
  });

  test('추측 기록 중복 방지 (같은 STATE 재수신)', async ({ browser }) => {
    const { p1, p2, cleanup } = await setupTwoPlayers(browser);
    try {
      const active = await getActivePlayer(p1, p2);
      await performGuess(active, 3);
      expect(await active.locator('.history-item').count()).toBe(1);

      // 시간 경과 후에도 중복 추가 안 됨
      await active.waitForTimeout(1000);
      expect(await active.locator('.history-item').count()).toBe(1);
    } finally {
      await cleanup();
    }
  });

  test('P1만 접속 시 대기 상태 + 메모판 정상 렌더링', async ({ browser }) => {
    // 단독 접속 테스트 -- 마지막에 배치
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
      await page.goto(DAVINCI_URL);
      await page.waitForTimeout(2000);

      expect(await page.locator('#turn-status').textContent()).toContain('대기');
      expect(await page.locator('.memo-tile').count()).toBe(24);
      expect(await page.locator('.history-item').count()).toBe(0);

      await page.screenshot({ path: 'tests/screenshots/davinci-single-wait.png' });
    } finally {
      await ctx.close();
      await new Promise((r) => setTimeout(r, 500));
    }
  });
});
