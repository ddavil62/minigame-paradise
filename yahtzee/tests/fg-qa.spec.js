/**
 * @fileoverview QA 검증 — 요트 점수판 F(구분선 정렬) + G(3상태 색·보조단서) 시각/기하 검증.
 *
 * 실행 전: node server.js --port 3099
 * 실행: node tests/fg-qa.spec.js
 *
 * 검증:
 *   F: tbody td 텍스트 bounding box가 행의 border-bottom 선 위에 걸치지 않는지 기하 측정
 *   G: preview/scored-persistent/recorded 3상태가 색 + 비색 단서(점선/좌측바/배경)로 구분되는지
 *   콘솔 에러 0 / 760px 반응형 / scored-flash 무변경
 */
import { chromium } from 'playwright';

const PORT = 3099;
const BASE = `http://localhost:${PORT}/`;
const OUT = 'tests/screenshots';

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

async function myId(page) {
  const txt = await page.locator('#player-label').textContent();
  return txt.includes('P1') ? 'p1' : 'p2';
}
async function rollAndScore(page, category) {
  await page.click('#btn-roll');
  await page.waitForTimeout(1700);
  await page.locator(`.score-cell[data-pid="${await myId(page)}"][data-category="${category}"]`).click();
  await page.waitForTimeout(300);
}
async function rollOnly(page) {
  await page.click('#btn-roll');
  await page.waitForTimeout(1700);
}

async function main() {
  const browser = await chromium.launch();
  const ctx1 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const p1 = await ctx1.newPage();
  const p2 = await ctx2.newPage();

  const errors = [];
  p1.on('pageerror', (e) => errors.push('p1: ' + e.message));
  p2.on('pageerror', (e) => errors.push('p2: ' + e.message));
  p1.on('console', (m) => { if (m.type() === 'error') errors.push('p1 console: ' + m.text()); });

  await Promise.all([p1.goto(BASE), p2.goto(BASE)]);
  await Promise.all([p1.waitForSelector('#ready-btn'), p2.waitForSelector('#ready-btn')]);
  await Promise.all([p1.click('#ready-btn'), p2.click('#ready-btn')]);
  await Promise.all([
    p1.waitForSelector('#screen-game:not(.hidden)'),
    p2.waitForSelector('#screen-game:not(.hidden)'),
  ]);
  await p1.waitForTimeout(300);

  // 선공 판정: btn-roll이 활성인 쪽이 선공
  const p1First = await p1.evaluate(() => !document.getElementById('btn-roll').disabled);
  const first = p1First ? p1 : p2;
  const second = p1First ? p2 : p1;
  console.log(`[info] 선공 = ${p1First ? 'p1' : 'p2'}`);

  // 3상태 동시 노출 시나리오: 선공 aces 기록(→이후 pure recorded), 후공 twos 기록,
  // 선공 threes 기록(→persistent), 후공 굴림만(미기록 preview).
  // 이렇게 해야 한 화면에 recorded(aces)·scored-persistent(threes,twos)·preview가 모두 노출된다.
  await rollAndScore(first, 'aces');
  await first.waitForTimeout(1700);
  await rollAndScore(second, 'twos');
  await second.waitForTimeout(1700);
  await rollAndScore(first, 'threes'); // 선공 직전확정 갱신 → aces는 pure recorded로 전환
  await first.waitForTimeout(1700);
  await rollOnly(second); // 후공 1차 굴림 → preview 노출 (기록 X)
  await second.waitForTimeout(400);
  // 측정 시점을 후공 화면으로 (preview가 후공 본인 행에 노출됨)
  const view = second;

  // ── F: 행 텍스트가 구분선(border-bottom)에 안 걸치는지 기하 측정 ──
  const fGeom = await view.evaluate(() => {
    const rows = [...document.querySelectorAll('.scoreboard tbody tr:not(.section-divider)')];
    const results = [];
    for (const tr of rows) {
      const tds = [...tr.querySelectorAll('td')];
      for (const td of tds) {
        const trRect = tr.getBoundingClientRect();
        // border-bottom 선의 y 위치 ≈ 행 하단
        const lineY = trRect.bottom;
        // 셀 내 텍스트 요소들의 bounding box
        const texts = td.querySelectorAll('.cat-label, .cat-rule, .score-cell, *');
        for (const t of [td, ...texts]) {
          if (!t.textContent || !t.textContent.trim()) continue;
          const r = t.getBoundingClientRect();
          if (r.height === 0) continue;
          // 텍스트 하단이 선보다 1px 이상 아래로 내려가면 걸침
          const overlap = r.bottom - lineY;
          results.push({ overlap });
        }
      }
    }
    const maxOverlap = results.length ? Math.max(...results.map((x) => x.overlap)) : null;
    return { count: results.length, maxOverlap };
  });
  check('F-1: 텍스트가 행 구분선 아래로 걸치지 않음', fGeom.maxOverlap !== null && fGeom.maxOverlap <= 1.5,
    `최대 초과 ${fGeom.maxOverlap?.toFixed(2)}px (행 ${fGeom.count}개 측정)`);

  // border-bottom이 실제 적용됐는지
  const borderApplied = await view.evaluate(() => {
    const td = document.querySelector('.scoreboard tbody tr:not(.section-divider) td');
    const cs = getComputedStyle(td);
    return { bw: cs.borderBottomWidth, bs: cs.borderBottomStyle };
  });
  check('F: tbody td border-bottom 적용', borderApplied.bw === '1px' && borderApplied.bs === 'solid',
    `${borderApplied.bw} ${borderApplied.bs}`);

  // section-divider는 border-bottom 없음
  const divNoBorder = await view.evaluate(() => {
    const div = document.querySelector('.scoreboard tr.section-divider td');
    if (!div) return null;
    return getComputedStyle(div).borderBottomStyle;
  });
  check('F-2: section-divider border-bottom none', divNoBorder === 'none' || divNoBorder === null,
    `${divNoBorder}`);

  // 배경 repeating-linear-gradient 제거 확인
  const sbBg = await view.evaluate(() => getComputedStyle(document.querySelector('.zone-scoreboard')).backgroundImage);
  check('F: zone-scoreboard 줄무늬 제거 (repeating-linear-gradient 없음)',
    !/repeating-linear-gradient/.test(sbBg), sbBg.slice(0, 60));

  // ── G: 3상태 색·보조단서 구분 ──
  const gStates = await view.evaluate(() => {
    const sample = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      const after = getComputedStyle(el, '::after');
      const before = getComputedStyle(el, '::before');
      return {
        color: cs.color, fontWeight: cs.fontWeight,
        afterBorder: after.borderStyle, afterBg: after.backgroundColor, afterContent: after.content,
        beforeBorderLeft: before.borderLeftWidth, beforeBg: before.backgroundColor, beforeContent: before.content,
      };
    };
    return {
      preview: sample('.score-cell.preview:not(.preview-zero)'),
      persistent: sample('.score-cell.scored-persistent'),
      recorded: sample('.score-cell.recorded:not(.scored-persistent)'),
    };
  });
  console.log('[G states]', JSON.stringify(gStates, null, 0));

  // preview: 초록 + 점선 ::after
  check('G-1: preview 초록색', gStates.preview && /rgb\(63, 110, 34\)/.test(gStates.preview.color),
    gStates.preview?.color);
  check('G-3a: preview 점선 테두리 비색단서', gStates.preview && /dashed/.test(gStates.preview.afterBorder),
    gStates.preview?.afterBorder);
  // persistent: 토마토 + 좌측 바(::before border-left 3px) + 배경
  check('G-2: scored-persistent 토마토색', gStates.persistent && /rgb\(184, 67, 31\)/.test(gStates.persistent.color),
    gStates.persistent?.color);
  check('G-3b: scored-persistent 좌측 액센트 바', gStates.persistent && gStates.persistent.beforeBorderLeft === '3px',
    gStates.persistent?.beforeBorderLeft);
  check('G-3b2: scored-persistent 채운 배경', gStates.persistent && gStates.persistent.beforeBg !== 'rgba(0, 0, 0, 0)',
    gStates.persistent?.beforeBg);
  // recorded: 먹색, 장식 없음
  check('G: recorded 먹색', gStates.recorded && /rgb\(74, 58, 40\)/.test(gStates.recorded.color),
    gStates.recorded?.color);
  // 세 색이 서로 다름
  const distinct = gStates.preview && gStates.persistent && gStates.recorded &&
    new Set([gStates.preview.color, gStates.persistent.color, gStates.recorded.color]).size === 3;
  check('G: 3상태 색 모두 상이', distinct);

  // scored-flash keyframe 무변경 (클래스 존재 + animation 정의)
  const flashOk = await view.evaluate(() => {
    const el = document.createElement('div');
    el.className = 'score-cell scored-flash';
    document.body.appendChild(el);
    const anim = getComputedStyle(el).animationName;
    const dur = getComputedStyle(el).animationDuration;
    el.remove();
    return { anim, dur };
  });
  check('G-5: scored-flash 애니메이션 무변경(1.4s)', flashOk.anim === 'scored-flash' && flashOk.dur === '1.4s',
    `${flashOk.anim} ${flashOk.dur}`);

  // 스크린샷 (1280 데스크톱)
  await view.locator('.zone-scoreboard').screenshot({ path: `${OUT}/qa-fg-1280.png` });

  // ── 760px 반응형 ──
  await view.setViewportSize({ width: 760, height: 900 });
  await first.waitForTimeout(300);
  const f760 = await view.evaluate(() => {
    const rows = [...document.querySelectorAll('.scoreboard tbody tr:not(.section-divider)')];
    let maxOverlap = -Infinity;
    for (const tr of rows) {
      const lineY = tr.getBoundingClientRect().bottom;
      for (const t of tr.querySelectorAll('td, .cat-label, .cat-rule, .score-cell')) {
        if (!t.textContent.trim()) continue;
        const r = t.getBoundingClientRect();
        if (r.height === 0) continue;
        maxOverlap = Math.max(maxOverlap, r.bottom - lineY);
      }
    }
    return maxOverlap;
  });
  check('F-3: 760px 반응형 정렬 유지', f760 <= 1.5, `최대 초과 ${f760.toFixed(2)}px`);
  await view.locator('.zone-scoreboard').screenshot({ path: `${OUT}/qa-fg-760.png` });

  // 콘솔/페이지 에러
  check('콘솔/페이지 에러 0', errors.length === 0, errors.join(' | ') || 'none');

  await browser.close();
  console.log(`\n────────────────────────────────\n총 ${pass + fail}건, PASS=${pass}, FAIL=${fail}`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
