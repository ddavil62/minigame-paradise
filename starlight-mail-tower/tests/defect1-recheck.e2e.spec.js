/**
 * @fileoverview DEFECT-1 재검증 — 1024x576에서 ready-card overflow-y:hidden → auto 수정 확인
 * QA 1차 리포트의 실측값(scrollHeight 1253, clientHeight 540, 713px 잘림)과 정량 대조
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';

const SCREENSHOT_DIR = 'tests/screenshots';
const BASE = 'http://localhost:3015';

test.describe('DEFECT-1 재검증: 1024x576 ready-card 스크롤 및 준비 버튼 접근', () => {

  test('1024x576에서 17카드 + 준비 버튼/AI 버튼 도달 가능성 검증', async ({ browser }) => {
    // 캐시 무효화를 위해 cache-bust 파라미터 사용
    const ctxA = await browser.newContext({
      viewport: { width: 1024, height: 576 },
      bypassCSP: true,
    });
    const ctxB = await browser.newContext({
      viewport: { width: 1024, height: 576 },
    });
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    // localStorage clear + 캐시 버스터로 CSS 갱신 강제
    await pageA.goto(`${BASE}/?name=D1-Recheck-A&_cb=${Date.now()}`);
    await pageA.evaluate(() => localStorage.clear());
    await pageA.reload();
    await pageB.goto(`${BASE}/?name=D1-Recheck-B&_cb=${Date.now()}`);
    await pageB.evaluate(() => localStorage.clear());
    await pageB.reload();

    // CSS 캐시 무효화: link[rel=stylesheet] href에 타임스탬프 쿼리 추가
    await pageA.evaluate(() => {
      document.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
        const url = new URL(link.href);
        url.searchParams.set('_nocache', Date.now().toString());
        link.href = url.href;
      });
    });

    // 17개 레벨 카드 렌더 대기
    await expect(pageA.locator('.level-card')).toHaveCount(17, { timeout: 5000 });

    // 핵심 실측
    const metrics = await pageA.evaluate(() => {
      const card = document.querySelector('.ready-card');
      const cs = getComputedStyle(card);
      const cardRect = card.getBoundingClientRect();
      const eyebrow = document.querySelector('.eyebrow');
      const h1 = document.querySelector('.ready-card h1');
      const readyBtn = document.querySelector('#ready-button');
      const aiBtn = document.querySelector('#ai-start-button');
      const readyNote = document.querySelector('#ready-note');
      const eyebrowRect = eyebrow?.getBoundingClientRect();
      const h1Rect = h1?.getBoundingClientRect();
      const readyBtnRect = readyBtn?.getBoundingClientRect();
      const aiBtnRect = aiBtn?.getBoundingClientRect();
      const readyNoteRect = readyNote?.getBoundingClientRect();

      // level-list 그리드 정보
      const levelList = document.querySelector('.level-list');
      const levelListCS = getComputedStyle(levelList);

      return {
        overflowY: cs.overflowY,
        justifyContent: cs.justifyContent,
        scrollHeight: card.scrollHeight,
        clientHeight: card.clientHeight,
        maxScroll: card.scrollHeight - card.clientHeight,
        card: { top: cardRect.top, bottom: cardRect.bottom, height: cardRect.height, width: cardRect.width },
        eyebrow: eyebrowRect ? { top: eyebrowRect.top, bottom: eyebrowRect.bottom } : null,
        h1: h1Rect ? { top: h1Rect.top, bottom: h1Rect.bottom } : null,
        readyBtn: readyBtnRect ? { top: readyBtnRect.top, bottom: readyBtnRect.bottom, y: readyBtnRect.y, height: readyBtnRect.height } : null,
        aiBtn: aiBtnRect ? { top: aiBtnRect.top, bottom: aiBtnRect.bottom } : null,
        readyNote: readyNoteRect ? { top: readyNoteRect.top, bottom: readyNoteRect.bottom } : null,
        levelCardCount: document.querySelectorAll('.level-card').length,
        gridColumns: levelListCS.gridTemplateColumns,
      };
    });

    console.log('=== DEFECT-1 재검증 실측값 ===');
    console.log(`overflow-y: ${metrics.overflowY}`);
    console.log(`justify-content: ${metrics.justifyContent}`);
    console.log(`scrollHeight: ${metrics.scrollHeight}`);
    console.log(`clientHeight: ${metrics.clientHeight}`);
    console.log(`maxScroll: ${metrics.maxScroll}`);
    console.log(`card: top=${metrics.card.top} bottom=${metrics.card.bottom} h=${metrics.card.height} w=${metrics.card.width}`);
    console.log(`eyebrow: top=${metrics.eyebrow?.top}`);
    console.log(`h1: top=${metrics.h1?.top}`);
    console.log(`readyBtn: top=${metrics.readyBtn?.top} bottom=${metrics.readyBtn?.bottom}`);
    console.log(`aiBtn: top=${metrics.aiBtn?.top} bottom=${metrics.aiBtn?.bottom}`);
    console.log(`levelCardCount: ${metrics.levelCardCount}`);
    console.log(`gridColumns: ${metrics.gridColumns}`);

    // QA1 수치 대조 (QA1: overflow-y=hidden, scrollHeight=1253, clientHeight=540, 잘림 713px)
    // 수정 후: overflow-y=auto, 스크롤 가능
    expect(metrics.overflowY).toBe('auto');
    expect(metrics.justifyContent).toBe('flex-start');
    expect(metrics.levelCardCount).toBe(17);

    // scrollTop=0에서 상단 콘텐츠 도달 가능
    expect(metrics.eyebrow.top).toBeGreaterThanOrEqual(metrics.card.top);
    expect(metrics.eyebrow.top).toBeGreaterThanOrEqual(0);
    expect(metrics.h1.top).toBeGreaterThanOrEqual(0);

    // maxScroll > 0이면 스크롤이 필요하며, 스크롤 가능
    if (metrics.maxScroll > 0) {
      console.log(`=> 스크롤 필요: maxScroll=${metrics.maxScroll}px (QA1에서는 접근 불가였음)`);
    }

    // scrollTop=max 시 준비 버튼/AI 버튼 도달
    const bottomMetrics = await pageA.evaluate(() => {
      const card = document.querySelector('.ready-card');
      card.scrollTop = card.scrollHeight - card.clientHeight;
      // requestAnimationFrame 대기
      return new Promise(resolve => {
        requestAnimationFrame(() => {
          const cardRect = card.getBoundingClientRect();
          const readyBtn = document.querySelector('#ready-button');
          const aiBtn = document.querySelector('#ai-start-button');
          const readyBtnRect = readyBtn.getBoundingClientRect();
          const aiBtnRect = aiBtn?.getBoundingClientRect();

          resolve({
            scrollTop: card.scrollTop,
            scrolledMax: card.scrollTop + card.clientHeight >= card.scrollHeight - 2,
            readyBtnInView: readyBtnRect.top >= cardRect.top && readyBtnRect.bottom <= cardRect.bottom + 2,
            readyBtnTop: readyBtnRect.top,
            readyBtnBottom: readyBtnRect.bottom,
            aiBtnInView: aiBtnRect ? (aiBtnRect.top >= cardRect.top && aiBtnRect.bottom <= cardRect.bottom + 2) : null,
            aiBtnBottom: aiBtnRect?.bottom,
            cardBottom: cardRect.bottom,
          });
        });
      });
    });

    console.log('=== scrollTop=max 시 하단 도달 ===');
    console.log(`scrollTop: ${bottomMetrics.scrollTop}`);
    console.log(`scrolledMax: ${bottomMetrics.scrolledMax}`);
    console.log(`readyBtn inView: ${bottomMetrics.readyBtnInView} (top=${bottomMetrics.readyBtnTop} bottom=${bottomMetrics.readyBtnBottom})`);
    console.log(`aiBtn inView: ${bottomMetrics.aiBtnInView} (bottom=${bottomMetrics.aiBtnBottom})`);
    console.log(`card bottom: ${bottomMetrics.cardBottom}`);

    expect(bottomMetrics.readyBtnInView).toBe(true);
    if (bottomMetrics.aiBtnInView !== null) {
      expect(bottomMetrics.aiBtnInView).toBe(true);
    }

    await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
    // scrollTop=0 스크린샷
    await pageA.evaluate(() => { document.querySelector('.ready-card').scrollTop = 0; });
    await pageA.waitForTimeout(100);
    await pageA.screenshot({ path: `${SCREENSHOT_DIR}/defect1-recheck-top-1024x576.png` });
    // scrollTop=max 스크린샷
    await pageA.evaluate(() => {
      const c = document.querySelector('.ready-card');
      c.scrollTop = c.scrollHeight - c.clientHeight;
    });
    await pageA.waitForTimeout(100);
    await pageA.screenshot({ path: `${SCREENSHOT_DIR}/defect1-recheck-bottom-1024x576.png` });

    await ctxA.close();
    await ctxB.close();
  });

  test('1024x576에서 실제 준비 버튼 클릭으로 게임 시작 확인', async ({ browser }) => {
    const ctxA = await browser.newContext({ viewport: { width: 1024, height: 576 } });
    const ctxB = await browser.newContext({ viewport: { width: 1024, height: 576 } });
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    await Promise.all([
      pageA.goto(`${BASE}/?name=D1-Click-A`),
      pageB.goto(`${BASE}/?name=D1-Click-B`),
    ]);
    await pageA.evaluate(() => localStorage.clear());
    await pageB.evaluate(() => localStorage.clear());

    // 17 카드 대기
    await expect(pageA.locator('.level-card')).toHaveCount(17, { timeout: 5000 });
    await expect(pageB.locator('.level-card')).toHaveCount(17, { timeout: 5000 });

    // scrollTop=max으로 준비 버튼 노출 (필요하다면)
    await pageA.evaluate(() => {
      const card = document.querySelector('.ready-card');
      card.scrollTop = card.scrollHeight;
    });
    await pageB.evaluate(() => {
      const card = document.querySelector('.ready-card');
      card.scrollTop = card.scrollHeight;
    });
    await pageA.waitForTimeout(200);

    // 실제 클릭으로 게임 시작
    await pageA.locator('#ready-button').scrollIntoViewIfNeeded();
    await pageB.locator('#ready-button').scrollIntoViewIfNeeded();
    await Promise.all([
      pageA.locator('#ready-button').click(),
      pageB.locator('#ready-button').click(),
    ]);

    // ready-overlay가 숨겨지면 게임이 시작된 것
    await expect(pageA.locator('#ready-overlay')).toBeHidden({ timeout: 5000 });
    await expect(pageB.locator('#ready-overlay')).toBeHidden({ timeout: 5000 });

    // data-server-tick이 증가하면 게임 루프가 동작하는 것
    await expect(pageA.locator('body')).toHaveAttribute('data-server-tick', /[1-9]\d*/, { timeout: 5000 });

    console.log('=> 1024x576에서 준비 버튼 클릭 → 게임 시작 확인 완료');

    await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
    await pageA.screenshot({ path: `${SCREENSHOT_DIR}/defect1-recheck-ingame-1024x576.png` });

    await ctxA.close();
    await ctxB.close();
  });

  test('미디어 쿼리 경계 521x576 vs 520x576 전환 검증', async ({ browser }) => {
    // 521x576 (min-width: 521px) and (max-height: 576px) -- 신규 분기
    const ctx521 = await browser.newContext({ viewport: { width: 521, height: 576 } });
    const page521 = await ctx521.newPage();
    await page521.goto(`${BASE}/?name=D1-MQ-521`);
    const m521 = await page521.evaluate(() => {
      const card = document.querySelector('.ready-card');
      const cs = getComputedStyle(card);
      return {
        overflowY: cs.overflowY,
        justifyContent: cs.justifyContent,
        width: card.getBoundingClientRect().width,
      };
    });
    console.log(`521x576: overflow-y=${m521.overflowY}, justify=${m521.justifyContent}, width=${m521.width}`);
    expect(m521.overflowY).toBe('auto');
    expect(m521.justifyContent).toBe('flex-start');
    await ctx521.close();

    // 520x576 (max-width: 520px) -- 모바일 분기
    const ctx520 = await browser.newContext({ viewport: { width: 520, height: 576 } });
    const page520 = await ctx520.newPage();
    await page520.goto(`${BASE}/?name=D1-MQ-520`);
    const m520 = await page520.evaluate(() => {
      const card = document.querySelector('.ready-card');
      const cs = getComputedStyle(card);
      const overlay = document.querySelector('#ready-overlay');
      const overlayCS = getComputedStyle(overlay);
      return {
        overflowY: cs.overflowY,
        maxHeight: cs.maxHeight,
        cardWidth: card.getBoundingClientRect().width,
        overlayOverflowY: overlayCS.overflowY,
      };
    });
    console.log(`520x576: overflow-y=${m520.overflowY}, maxHeight=${m520.maxHeight}, cardWidth=${m520.cardWidth}, overlay overflow-y=${m520.overlayOverflowY}`);
    // 520px 이하에서는 모바일 분기 — ready-card의 max-height: none, 오버레이가 스크롤 담당
    expect(m520.maxHeight).toBe('none');
    await ctx520.close();
  });

  test('height 경계 576 vs 577 전환 검증', async ({ browser }) => {
    // 1024x576 — max-height:576px 분기 적용
    const ctx576 = await browser.newContext({ viewport: { width: 1024, height: 576 } });
    const page576 = await ctx576.newPage();
    await page576.goto(`${BASE}/?name=D1-H576`);
    const m576 = await page576.evaluate(() => {
      const cs = getComputedStyle(document.querySelector('#game-shell'));
      const cardCS = getComputedStyle(document.querySelector('.ready-card'));
      return {
        gridRows: cs.gridTemplateRows,
        overflowY: cardCS.overflowY,
      };
    });
    console.log(`1024x576: gridRows=${m576.gridRows}, overflowY=${m576.overflowY}`);
    // 576px에서는 소형 뷰포트 미디어 쿼리 + DEFECT-1 수정 미디어 쿼리 양쪽 적용
    expect(m576.overflowY).toBe('auto');
    await ctx576.close();

    // 1024x577 — max-height:576px 미적용 (데스크톱 규칙)
    const ctx577 = await browser.newContext({ viewport: { width: 1024, height: 577 } });
    const page577 = await ctx577.newPage();
    await page577.goto(`${BASE}/?name=D1-H577`);
    const m577 = await page577.evaluate(() => {
      const cs = getComputedStyle(document.querySelector('#game-shell'));
      const cardCS = getComputedStyle(document.querySelector('.ready-card'));
      return {
        gridRows: cs.gridTemplateRows,
        overflowY: cardCS.overflowY,
      };
    });
    console.log(`1024x577: gridRows=${m577.gridRows}, overflowY=${m577.overflowY}`);
    // 577px에서는 기본 데스크톱 규칙 (overflow-y: auto from L274)
    expect(m577.overflowY).toBe('auto');
    await ctx577.close();
  });
});
