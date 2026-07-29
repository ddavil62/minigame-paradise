/**
 * @fileoverview AD Phase A 측정 스펙 — 상대 손 영역 레이아웃 검증.
 *
 * 3개 해상도(1920x1080, 1366x768, 1280x720) x 4개 손패 장수(10, 7, 5, 2) = 12조합 측정.
 * 각 조합에서 카드 잘림, 카드 크기, zone-floor 교차, zone 위치를 수치로 검증한다.
 *
 * 서버 사전 실행 필수: node matgo/server.js --port 3013
 */
import { test, chromium } from 'playwright/test';

const BASE_URL = 'http://localhost:3013';
const INJECT_URL = `${BASE_URL}/test/inject`;
const RESET_URL = `${BASE_URL}/test/reset`;

const VIEWPORTS = [
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '1366x768',  width: 1366, height: 768  },
  { name: '1280x720',  width: 1280, height: 720  },
];

const HAND_SIZES = [10, 7, 5, 2];

async function resetServer() {
  await fetch(RESET_URL, { method: 'POST' });
  await new Promise((r) => setTimeout(r, 200));
}

async function setupGame(vw, vh) {
  await resetServer();
  const browser = await chromium.launch();
  const vp = { width: vw, height: vh };
  const ctx1 = await browser.newContext({ viewport: vp });
  const ctx2 = await browser.newContext({ viewport: vp });
  const p1 = await ctx1.newPage();
  const p2 = await ctx2.newPage();
  // name gate 우회: ?name= 파라미터로 닉네임을 전달해 JOIN 즉시 송신.
  await p1.goto(`${BASE_URL}?name=TestP1`);
  await p1.waitForFunction(
    () => document.getElementById('you-tag')?.textContent?.includes('P1'),
    { timeout: 8000 }
  );
  await p2.goto(`${BASE_URL}?name=TestP2`);
  await p2.waitForFunction(
    () => document.getElementById('you-tag')?.textContent?.includes('P2'),
    { timeout: 8000 }
  );
  await p1.waitForFunction(
    () => document.querySelectorAll('#opp-hand-cards .card.back').length === 10,
    { timeout: 8000 }
  );
  await p1.waitForFunction(
    () => (document.getElementById('fly-overlay')?.childElementCount ?? 0) === 0,
    { timeout: 8000 }
  );
  return { browser, p1 };
}

/**
 * inject로 상대(P2)의 손패 장수를 변경한다.
 * P1 시점에서 상대 카드 수 = oppHand 개수.
 * 서버 inject API는 p2Hand 필드로 P2 손패를 직접 설정한다.
 * @param {number} count - 상대 손패 장수
 */
async function injectOppHandCount(count) {
  const cards = [];
  for (let i = 1; i <= count; i++) {
    const m = String(i).padStart(2, '0');
    cards.push({ id: `m${m}_gwang`, month: i, type: 'gwang', name: `${i}월 광` });
  }
  const res = await fetch(INJECT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ p2Hand: cards }),
  });
  return res.ok;
}

async function measureLayout(page) {
  return await page.evaluate(() => {
    const oppZone = document.querySelector('.opp-hand-zone');
    const floorZone = document.querySelector('.floor-zone');
    const oppCards = document.querySelectorAll('#opp-hand-cards .card');
    if (!oppZone) return { error: 'opp-hand-zone not found' };
    const zr = oppZone.getBoundingClientRect();
    const cs = getComputedStyle(oppZone);
    const hc = oppZone.querySelector('.hand-cards');
    const hcOv = hc ? getComputedStyle(hc).overflow : 'N/A';
    const hcCs = hc ? getComputedStyle(hc) : null;
    const cards = Array.from(oppCards).map((c, i) => {
      const r = c.getBoundingClientRect();
      const ccs = getComputedStyle(c);
      return {
        idx: i,
        top: +r.top.toFixed(2), bottom: +r.bottom.toFixed(2),
        left: +r.left.toFixed(2), right: +r.right.toFixed(2),
        width: +r.width.toFixed(2), height: +r.height.toFixed(2),
        computedW: ccs.width, computedH: ccs.height,
        clippedByZone: r.bottom > zr.bottom + 0.5,
      };
    });
    const floorR = floorZone ? floorZone.getBoundingClientRect() : null;
    const fcEl = floorZone ? floorZone.querySelector('.floor-cards') : null;
    const fcR = fcEl ? fcEl.getBoundingClientRect() : null;
    let floorBox = 0, floorContent = 0;
    for (const c of cards) {
      if (floorR) { const ow=Math.max(0,Math.min(c.right,floorR.right)-Math.max(c.left,floorR.left)); const oh=Math.max(0,Math.min(c.bottom,floorR.bottom)-Math.max(c.top,floorR.top)); floorBox+=ow*oh; }
      if (fcR) { const ow=Math.max(0,Math.min(c.right,fcR.right)-Math.max(c.left,fcR.left)); const oh=Math.max(0,Math.min(c.bottom,fcR.bottom)-Math.max(c.top,fcR.top)); floorContent+=ow*oh; }
    }
    const selMap = {
      oppCap: '.opp-captured-zone', oppHand: '.opp-hand-zone',
      floor: '.floor-zone', myHand: '.my-hand-zone', myCap: '.my-captured-zone',
    };
    const zones = {};
    for (const [k, s] of Object.entries(selMap)) {
      const el = document.querySelector(s);
      if (el) { const r=el.getBoundingClientRect(); zones[k]={top:+r.top.toFixed(2),bottom:+r.bottom.toFixed(2),left:+r.left.toFixed(2),right:+r.right.toFixed(2)}; }
    }
    const maxCardBottom = cards.length ? Math.max(...cards.map(c => c.bottom)) : 0;
    const floorGap = floorR ? floorR.top - maxCardBottom : 999;
    return {
      zone: { top:+zr.top.toFixed(2), bottom:+zr.bottom.toFixed(2), left:+zr.left.toFixed(2), right:+zr.right.toFixed(2), overflow:cs.overflow, handCardsOverflow:hcOv },
      cardCount: cards.length, cards,
      clippedCount: cards.filter(c=>c.clippedByZone).length,
      allCardsInsideZone: cards.every(c => c.bottom <= zr.bottom + 0.5),
      allInViewport: cards.every(c=>c.bottom>0&&c.top<window.innerHeight),
      floorBoxOverlapPx2: +floorBox.toFixed(2),
      floorContentOverlapPx2: +floorContent.toFixed(2),
      floorZone: floorR?{top:+floorR.top.toFixed(2),bottom:+floorR.bottom.toFixed(2),left:+floorR.left.toFixed(2),right:+floorR.right.toFixed(2)}:null,
      floorCardsTop: fcR?+fcR.top.toFixed(2):null,
      maxCardBottom: +maxCardBottom.toFixed(2),
      floorGap: +floorGap.toFixed(2),
      zones,
    };
  });
}

test.describe('AD Phase A - opp-hand-zone layout measurement', () => {
  test.setTimeout(180000);

  test('1920x1080 AC-56-1/2/3 primary check', async () => {
    const { browser, p1 } = await setupGame(1920, 1080);
    try {
      const m = await measureLayout(p1);
      if (m.error) throw new Error(m.error);
      console.log('=== 1920x1080 10장 ===');
      console.log(JSON.stringify(m, null, 2));
      if (m.clippedCount !== 0) throw new Error('FAIL AC-56-1: clipped=' + m.clippedCount);
      if (!m.allCardsInsideZone) throw new Error('FAIL AC-56-1: cards extend beyond zone');
      if (m.floorBoxOverlapPx2 > 0) throw new Error('FAIL: floorBoxOverlap=' + m.floorBoxOverlapPx2);
      if (m.cards[0] && m.cards[0].width < 50) throw new Error('FAIL AC-56-2: width=' + m.cards[0].width);
      if (m.cards[0] && m.cards[0].height < 70) throw new Error('FAIL AC-56-2: height=' + m.cards[0].height);
      if (m.floorGap < 8) throw new Error('FAIL: floor gap too small: ' + m.floorGap + 'px');
      console.log('AC-56-1 PASS: clipped=0, allInsideZone=true');
      console.log('AC-56-2 PASS: card ' + m.cards[0].width + 'x' + m.cards[0].height);
      console.log('AC-56-3 PASS: floorBoxOverlap=0, floorGap=' + m.floorGap + 'px');
      await p1.screenshot({ path: 'tests/screenshots/opp-hand-1920x1080.png' });
    } finally { await browser.close(); }
  });

  test('12-combination matrix (3 viewports x 4 hand sizes)', async () => {
    const { createRequire } = await import('module');
    const req = createRequire(import.meta.url);
    const fs = req('fs');
    const path = req('path');
    const ssDir = 'tests/screenshots';
    if (!fs.existsSync(ssDir)) fs.mkdirSync(ssDir, { recursive: true });

    const matrix = {};
    const failures = [];

    for (const vp of VIEWPORTS) {
      matrix[vp.name] = {};

      // 10장: 자연 상태 (inject 불필요, 게임 시작 시 10장)
      {
        const { browser, p1 } = await setupGame(vp.width, vp.height);
        try {
          const m = await measureLayout(p1);
          matrix[vp.name]['10'] = m;
          if (m.error) { failures.push(`${vp.name}/10: ${m.error}`); continue; }
          const label = `[${vp.name} / 10장]`;
          console.log(`${label} cards=${m.cardCount} clipped=${m.clippedCount} insideZone=${m.allCardsInsideZone} floorBox=${m.floorBoxOverlapPx2} floorGap=${m.floorGap}`);
          if (m.clippedCount > 0) failures.push(`${label} clipped=${m.clippedCount}`);
          if (!m.allCardsInsideZone) failures.push(`${label} cards outside zone`);
          if (m.floorBoxOverlapPx2 > 0) failures.push(`${label} floorBoxOverlap=${m.floorBoxOverlapPx2}`);
          if (m.floorGap < 8) failures.push(`${label} floorGap=${m.floorGap} < 8px`);
          // 카드 크기 검증
          for (const c of m.cards) {
            if (c.computedW !== '60px' || c.computedH !== '85px') {
              failures.push(`${label} card[${c.idx}] size=${c.computedW}x${c.computedH}, expected 60px x 85px`);
              break;
            }
          }
          await p1.screenshot({ path: path.join(ssDir, `opp-hand-${vp.name}.png`) });
        } finally { await browser.close(); }
      }

      // 7, 5, 2장: inject로 상대 손 카드 수 변경
      for (const handSize of [7, 5, 2]) {
        const { browser, p1 } = await setupGame(vp.width, vp.height);
        try {
          // inject로 P2 손패를 handSize장으로 줄인다.
          await injectOppHandCount(handSize);
          // inject 후 P1이 상대 카드 수가 업데이트될 때까지 대기
          await p1.waitForFunction(
            (expected) => document.querySelectorAll('#opp-hand-cards .card').length === expected,
            handSize,
            { timeout: 8000 }
          );
          // fly 대기
          await p1.waitForFunction(
            () => (document.getElementById('fly-overlay')?.childElementCount ?? 0) === 0,
            { timeout: 8000 }
          );
          const m = await measureLayout(p1);
          matrix[vp.name][String(handSize)] = m;
          if (m.error) { failures.push(`${vp.name}/${handSize}: ${m.error}`); continue; }
          const label = `[${vp.name} / ${handSize}장]`;
          console.log(`${label} cards=${m.cardCount} clipped=${m.clippedCount} insideZone=${m.allCardsInsideZone} floorBox=${m.floorBoxOverlapPx2} floorGap=${m.floorGap}`);
          if (m.clippedCount > 0) failures.push(`${label} clipped=${m.clippedCount}`);
          if (!m.allCardsInsideZone) failures.push(`${label} cards outside zone`);
          if (m.floorBoxOverlapPx2 > 0) failures.push(`${label} floorBoxOverlap=${m.floorBoxOverlapPx2}`);
          // 소장수에서는 2행이 없으므로 floorGap 검증은 카드가 있을 때만
          if (m.cards.length > 0 && m.floorGap < 8) failures.push(`${label} floorGap=${m.floorGap} < 8px`);
          for (const c of m.cards) {
            if (c.computedW !== '60px' || c.computedH !== '85px') {
              failures.push(`${label} card[${c.idx}] size=${c.computedW}x${c.computedH}, expected 60px x 85px`);
              break;
            }
          }
          await p1.screenshot({ path: path.join(ssDir, `opp-hand-${vp.name}-${handSize}cards.png`) });
        } finally { await browser.close(); }
      }
    }

    // JSON 출력
    fs.writeFileSync(path.join(ssDir, 'ad-phaseA-matrix.json'), JSON.stringify(matrix, null, 2));
    console.log('Saved: tests/screenshots/ad-phaseA-matrix.json');

    // 최종 판정
    if (failures.length > 0) {
      console.log('=== FAILURES ===');
      for (const f of failures) console.log('  ' + f);
      throw new Error(`${failures.length} failures: ${failures.join('; ')}`);
    }
    console.log('=== ALL 12 COMBINATIONS PASS ===');
  });
});
