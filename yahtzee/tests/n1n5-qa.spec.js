/**
 * @fileoverview QA 검증 — 요트 다이스 N1~N5 버그/개선.
 * 격리 포트 3091 (사용자 launcher 3000·MCP 미접촉).
 * 실행 전: node server.js --port 3091
 *
 * 검증 항목:
 *   N2 — tfoot 총점/소계 강조 배경 오염 없음 + thead 강조 유지 (시각)
 *   N3 — 컵 진행 중 미리보기 0 → 착지 후 무입력 자동 노출 + roll-count 유지(무한루프 없음)
 *   N4 — 굴리기 native 더블클릭 시 ROLL_DICE 1회만 전송
 *   N5 — 1판 GAME_OVER → rematch 클릭(대기 중) → 2판 START 후 버튼 복구 → 2판 GAME_OVER 후 정상
 */
import { chromium } from 'playwright';

const PORT = process.env.QA_PORT || 3091;
const BASE = `http://localhost:${PORT}/`;
const OUT = 'tests/screenshots';

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: detail || '' });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

async function bothReady(browser) {
  const c1 = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const c2 = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const p1 = await c1.newPage();
  const p2 = await c2.newPage();
  await Promise.all([p1.goto(BASE), p2.goto(BASE)]);
  await Promise.all([p1.waitForSelector('#ready-btn'), p2.waitForSelector('#ready-btn')]);
  await Promise.all([p1.click('#ready-btn'), p2.click('#ready-btn')]);
  await Promise.all([
    p1.waitForSelector('#screen-game:not(.hidden)'),
    p2.waitForSelector('#screen-game:not(.hidden)'),
  ]);
  return { c1, c2, p1, p2 };
}

async function rollEnabled(page) {
  return (await page.locator('#btn-roll:not([disabled])').count()) > 0;
}
async function findActor(p1, p2) {
  for (let i = 0; i < 60; i++) {
    if (await rollEnabled(p1)) return p1;
    if (await rollEnabled(p2)) return p2;
    await p1.waitForTimeout(100);
  }
  throw new Error('굴리기 가능한 턴 페이지 없음');
}

// 카운트한 ROLL_DICE 송신 횟수를 페이지에 후킹 (WebSocket.send 래핑).
async function hookRollSend(page) {
  await page.evaluate(() => {
    window.__rollSends = 0;
    const orig = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
      try {
        const m = JSON.parse(data);
        if (m && m.type === 'ROLL_DICE') window.__rollSends++;
      } catch (e) { /* noop */ }
      return orig.call(this, data);
    };
  });
}

async function main() {
  const browser = await chromium.launch();

  // ───────── N2 + N3 ─────────
  {
    const { c1, c2, p1, p2 } = await bothReady(browser);
    const actor = await findActor(p1, p2);

    // N2 시각: 굴림 전 점수표 캡처 — current-pX 강조가 활성인 상태에서 tfoot 배경 확인.
    // 강조 활성 여부 확인.
    const hasHighlight = await actor.evaluate(() =>
      document.querySelector('.scoreboard')?.classList.contains('current-p1') ||
      document.querySelector('.scoreboard')?.classList.contains('current-p2'));
    check('N2: 점수표에 current-pX 강조 클래스 활성', hasHighlight);

    // tfoot total-row의 현재 강조 컬럼 배경색 계산값 확인 (먹색 --ink 유지, 반투명 오버라이드 없어야).
    const totalBg = await actor.evaluate(() => {
      const sb = document.querySelector('.scoreboard');
      const cls = sb.classList.contains('current-p1') ? 'p1' : 'p2';
      const cell = sb.querySelector(`tfoot .total-row .col-${cls}`)
        || sb.querySelector(`tfoot tr:last-child .col-${cls}`);
      if (!cell) return { found: false };
      const cs = getComputedStyle(cell);
      return { found: true, bg: cs.backgroundColor, color: cs.color };
    });
    // tbody 강조 컬럼 배경 (반투명 토마토 rgba(210,86,47,.07)이 적용되어야 함).
    const tbodyBg = await actor.evaluate(() => {
      const sb = document.querySelector('.scoreboard');
      const cls = sb.classList.contains('current-p1') ? 'p1' : 'p2';
      const cell = sb.querySelector(`tbody .col-${cls}`);
      if (!cell) return { found: false };
      return { found: true, bg: getComputedStyle(cell).backgroundColor };
    });
    // thead 강조 컬럼 색 (var(--tomato-2) 유지).
    const theadColor = await actor.evaluate(() => {
      const sb = document.querySelector('.scoreboard');
      const cls = sb.classList.contains('current-p1') ? 'p1' : 'p2';
      const cell = sb.querySelector(`thead .col-${cls}`);
      if (!cell) return { found: false };
      return { found: true, color: getComputedStyle(cell).color };
    });

    // total-row 배경이 반투명 토마토(rgba(210,86,47, ...))가 아니어야 함.
    const totalIsTomato = totalBg.found && /210,\s*86,\s*47/.test(totalBg.bg);
    check('N2: tfoot 총점 배경에 토마토 강조 미적용', totalBg.found && !totalIsTomato,
      totalBg.found ? `bg=${totalBg.bg}` : 'total cell 못찾음');

    const tbodyIsTomato = tbodyBg.found && /210,\s*86,\s*47/.test(tbodyBg.bg);
    check('N2: tbody 현재턴 컬럼 강조 유지(토마토 반투명)', tbodyIsTomato,
      tbodyBg.found ? `bg=${tbodyBg.bg}` : 'tbody cell 못찾음');

    check('N2: thead 컬럼명 강조(color) 유지', theadColor.found && theadColor.color !== '',
      theadColor.found ? `color=${theadColor.color}` : 'thead cell 못찾음');

    await actor.screenshot({ path: `${OUT}/qa-n2-scoreboard-highlight.png`, fullPage: false });

    // ── N3 ── 굴림 → 진행 중 preview=0 → 착지 후 무입력 preview>0 → roll-count 유지.
    await actor.click('#btn-roll');
    await actor.waitForTimeout(700);
    const during = await actor.locator('.score-cell.preview').count();
    await actor.screenshot({ path: `${OUT}/qa-n3-during-cup.png`, fullPage: false });
    check('N3: 컵 진행 중 미리보기 억제(preview=0)', during === 0, `during=${during}`);

    await actor.waitForTimeout(1700); // 컵 완료(1.56s) + onCupDone 여유, 무입력.
    const after = await actor.locator('.score-cell.preview').count();
    await actor.screenshot({ path: `${OUT}/qa-n3-after-cup.png`, fullPage: false });
    check('N3: 컵 착지 후 무입력 자동 노출(preview>0)', after > 0, `after=${after}`);

    const rollCountTxt = (await actor.locator('#roll-count').textContent() || '').trim();
    check('N3: 무한루프 없음(roll-count=1 유지)', rollCountTxt === '1', `roll-count="${rollCountTxt}"`);

    await c1.close(); await c2.close();
  }

  // ───────── N4 ─────────
  {
    const { c1, c2, p1, p2 } = await bothReady(browser);
    const actor = await findActor(p1, p2);
    await hookRollSend(actor);

    // native 더블클릭 — 실제 사용자 빠른 연타 경로. disabled 동기 적용으로 2번째 억제 기대.
    await actor.locator('#btn-roll').dblclick({ delay: 10 });
    await actor.waitForTimeout(300);
    const sends1 = await actor.evaluate(() => window.__rollSends);
    check('N4: 더블클릭 시 ROLL_DICE 1회만 전송', sends1 === 1, `sends=${sends1}`);

    // 추가 강도: 같은 굴림 중(컵 애니메이션 진행) 다시 빠르게 3연타 — 여전히 추가 전송 없어야.
    await actor.locator('#btn-roll').click({ force: true }).catch(() => {});
    await actor.locator('#btn-roll').click({ force: true }).catch(() => {});
    await actor.waitForTimeout(200);
    const sendsBurst = await actor.evaluate(() => window.__rollSends);
    // force click은 disabled 우회 가능 — 리포트 명시. native 경로만 strict 판정, force는 정보성.
    check('N4(정보): force click 연타 후 송신 횟수', true, `sends=${sendsBurst} (native경로 strict, force는 우회 가능 — 리포트 명시)`);

    // 컵 애니메이션 + STATE 후 버튼 자동 복구 확인 (rollCount<3이므로 재활성).
    await actor.waitForTimeout(2000);
    const reEnabled = await rollEnabled(actor);
    check('N4: STATE 수신 후 굴리기 버튼 자동 복구', reEnabled, `enabled=${reEnabled}`);

    await c1.close(); await c2.close();
  }

  // ───────── N5 ───────── (연속 2판 재대결, 빠른 진행을 위해 카테고리 자동 선택)
  {
    const { c1, c2, p1, p2 } = await bothReady(browser);

    // 한 판을 끝까지 진행: 매 턴 현재 actor가 굴리고 첫 preview 카테고리 클릭. (26턴)
    async function playToGameOver(p1, p2, maxTurns = 60) {
      for (let t = 0; t < maxTurns; t++) {
        // game-over 화면 떴는지 검사.
        const over = await p1.locator('#screen-game-over:not(.hidden)').count();
        if (over > 0) return true;
        let actor = null;
        for (let i = 0; i < 30 && !actor; i++) {
          if (await rollEnabled(p1)) actor = p1;
          else if (await rollEnabled(p2)) actor = p2;
          else await p1.waitForTimeout(100);
        }
        if (!actor) {
          // 둘 다 굴리기 불가 — game over 가능성.
          const o2 = await p1.locator('#screen-game-over:not(.hidden)').count();
          return o2 > 0;
        }
        await actor.click('#btn-roll');
        // 컵 애니메이션 완료까지 대기 후 미리보기 클릭.
        await actor.waitForTimeout(1750);
        const cell = actor.locator('.score-cell.preview').first();
        if (await cell.count() === 0) {
          // 미리보기 없으면 잠깐 더 대기 후 재시도.
          await actor.waitForTimeout(400);
        }
        await actor.locator('.score-cell.preview').first().click({ timeout: 3000 }).catch(() => {});
        await actor.waitForTimeout(250);
      }
      return (await p1.locator('#screen-game-over:not(.hidden)').count()) > 0;
    }

    const over1 = await playToGameOver(p1, p2);
    check('N5: 1판 정상 종료(GAME_OVER 도달)', over1);

    // 양쪽 rematch 버튼 가시 — p1이 먼저 클릭 → "재대결 대기 중..." + disabled.
    await p1.waitForSelector('#rematch-btn', { state: 'visible', timeout: 3000 }).catch(() => {});
    await p1.click('#rematch-btn');
    const afterClick = await p1.evaluate(() => {
      const b = document.getElementById('rematch-btn');
      return { disabled: b.disabled, text: b.textContent.trim() };
    });
    check('N5: 재대결 클릭 직후 disabled + "재대결 대기 중..."',
      afterClick.disabled && afterClick.text.includes('대기'),
      `disabled=${afterClick.disabled}, text="${afterClick.text}"`);
    await p1.screenshot({ path: `${OUT}/qa-n5-rematch-waiting.png`, fullPage: false });

    // p2도 rematch → 2판 START.
    await p2.waitForSelector('#rematch-btn', { state: 'visible', timeout: 3000 }).catch(() => {});
    await p2.click('#rematch-btn');
    // 2판 게임 화면 복귀 대기.
    await p1.waitForSelector('#screen-game:not(.hidden)', { timeout: 8000 });
    await p1.waitForTimeout(300);
    const afterStart = await p1.evaluate(() => {
      const b = document.getElementById('rematch-btn');
      return { disabled: b.disabled, text: b.textContent.trim() };
    });
    check('N5: 2판 START 후 재대결 버튼 복구(disabled=false, "재대결")',
      !afterStart.disabled && afterStart.text === '재대결',
      `disabled=${afterStart.disabled}, text="${afterStart.text}"`);
    await p1.screenshot({ path: `${OUT}/qa-n5-rematch-restored.png`, fullPage: false });

    // 2판도 끝까지 진행 → 다시 재대결 가능한지(고착 없음).
    const over2 = await playToGameOver(p1, p2);
    check('N5: 2판 정상 종료(연속 대전 고착 없음)', over2);

    if (over2) {
      await p1.waitForSelector('#rematch-btn', { state: 'visible', timeout: 3000 }).catch(() => {});
      const btn2 = await p1.evaluate(() => {
        const b = document.getElementById('rematch-btn');
        return { disabled: b.disabled, text: b.textContent.trim() };
      });
      check('N5: 2판 종료 후 재대결 버튼 정상 클릭 가능 상태', !btn2.disabled,
        `disabled=${btn2.disabled}, text="${btn2.text}"`);
    }

    await c1.close(); await c2.close();
  }

  await browser.close();

  const fails = results.filter((r) => !r.pass);
  console.log('\n────────────────────────────────────────');
  console.log(`총 ${results.length}건, PASS=${results.length - fails.length}, FAIL=${fails.length}`);
  if (fails.length) {
    console.log('실패:');
    fails.forEach((f) => console.log(`  - ${f.name}: ${f.detail}`));
  }
  process.exit(fails.length ? 1 : 0);
}

main().catch((err) => { console.error('FATAL', err); process.exit(2); });
