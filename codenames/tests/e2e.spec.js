/**
 * @fileoverview 코드네임 클래식 최소 E2E (Playwright 자가구동, 격리 포트 3115).
 *
 * 실행: node codenames/tests/e2e.spec.js
 *   - codenames 서버를 inline 부팅(3115) — launcher 3000 미사용.
 *   - 4 브라우저 컨텍스트(red/spy, red/op, blue/spy, blue/op)로 role_select → START.
 *   - CN-E-003/004 핵심: 요원 화면 미공개 카드 색 마스킹 vs 스파이마스터 키 전체 시각 확인.
 *   - 스크린샷 → tests/screenshots/.
 *
 * @playwright/test 러너 대신 자가구동 스크립트(설정 파일 불필요).
 */

import http from 'http';
import { chromium } from 'playwright';
import { createApp } from '../server.js';

const PORT = 3115;
const BASE = `http://127.0.0.1:${PORT}`;
const SHOT = new URL('./screenshots/', import.meta.url).pathname.replace(/^\//, '');

let passed = 0, failed = 0;
const failures = [];
function check(cond, label) {
  if (cond) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; failures.push(label); console.log(`  FAIL  ${label}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 서버 부팅 ──
const app = createApp();
const server = http.createServer(app.handleHttp);
server.on('upgrade', app.handleUpgrade);
await new Promise((res) => server.listen(PORT, '127.0.0.1', res));
console.log(`[e2e] server up on ${PORT}`);

const browser = await chromium.launch();

/** 닉네임 prefill + 페이지 오픈. */
async function openPlayer(name) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 820 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { failed++; failures.push(`pageerror(${name}): ${e.message}`); });
  await page.addInitScript((n) => { sessionStorage.setItem('codenames:name', n); }, name);
  await page.goto(BASE);
  return { ctx, page };
}

const errors = [];
try {
  const redSpy = await openPlayer('레드마스터');
  const redOp  = await openPlayer('레드요원');
  const blueSpy = await openPlayer('블루마스터');
  const blueOp  = await openPlayer('블루요원');
  const all = [redSpy, redOp, blueSpy, blueOp];

  // role_select 등장 대기
  await redSpy.page.waitForSelector('#role-room:not(.hidden)', { timeout: 5000 });
  check(true, 'CN-E-001 role_select UI 렌더');
  await sleep(200);
  await redSpy.page.screenshot({ path: SHOT + 'role-select.png' });

  // 슬롯 선택
  const pick = (p, team, role) => p.page.click(`.slot[data-team="${team}"][data-role="${role}"]`);
  await pick(redSpy, 'red', 'spymaster');
  await pick(redOp, 'red', 'operative');
  await pick(blueSpy, 'blue', 'spymaster');
  await pick(blueOp, 'blue', 'operative');
  await sleep(400);

  // 호스트(redSpy=첫 입장) 시작 버튼 활성 확인 후 시작
  const startDisabled = await redSpy.page.getAttribute('#btn-start-game', 'disabled');
  check(startDisabled === null, 'CN-E-002a 4슬롯 충족 → 호스트 시작 버튼 활성');
  await redSpy.page.screenshot({ path: SHOT + 'role-filled.png' });
  await redSpy.page.click('#btn-start-game');

  // 게임 화면 전환
  await redSpy.page.waitForSelector('#screen-game:not(.hidden)', { timeout: 5000 });
  await Promise.all(all.map((p) => p.page.waitForSelector('.board .card', { timeout: 5000 })));
  await sleep(400);
  check(true, 'CN-E-002 START → 보드 렌더(25칸)');

  // 보드 25칸 확인
  const cardCount = await redSpy.page.locator('.board .card').count();
  check(cardCount === 25, `CN-E-002b 보드 25칸 렌더 (실제 ${cardCount})`);

  // ── 마스킹 시각 검증 ──
  // 스파이마스터 화면: 미공개 카드에 key-* 클래스(키 색 오버레이)가 25칸 존재
  const spyKeyCells = await redSpy.page.locator('.board .card.key').count();
  check(spyKeyCells === 25, `CN-E-004 스파이마스터: 전 카드 키 색 표시(.key ${spyKeyCells}/25)`);
  // 요원 화면: 미공개 카드에 key-* 클래스가 0칸 (색 누설 없음)
  const opKeyCells = await redOp.page.locator('.board .card.key').count();
  check(opKeyCells === 0, `CN-E-003 요원: 미공개 카드 키 색 미표시(.key ${opKeyCells}/25) — 시각 마스킹`);
  // DOM 클래스에 c-red/c-blue/c-assassin 미공개 누설 없음(요원)
  const opRevealedColorCells = await redOp.page.locator('.board .card.c-red, .board .card.c-blue, .board .card.c-assassin, .board .card.c-neutral').count();
  check(opRevealedColorCells === 0, `CN-E-003b 요원: 공개 색 클래스 0 (게임 시작 시점, 누설 ${opRevealedColorCells})`);

  await redSpy.page.screenshot({ path: SHOT + 'spymaster-view.png' });
  await redOp.page.screenshot({ path: SHOT + 'operative-view.png' });

  // ── 단서 → 추측 1회 (현재 선공팀이 행동) ──
  // 현재 턴 팀 파악: turn-status 클래스
  const turnRed = await redSpy.page.locator('#turn-status.turn-red').count();
  const firstTeam = turnRed > 0 ? 'red' : 'blue';
  const curSpy = firstTeam === 'red' ? redSpy : blueSpy;
  const curOp  = firstTeam === 'red' ? redOp  : blueOp;

  // 스파이마스터 단서 입력 가능 상태
  const clueDisabled = await curSpy.page.getAttribute('#btn-clue', 'disabled');
  check(clueDisabled === null, 'CN-E-005a 선공 스파이마스터 단서 입력 활성');
  await curSpy.page.fill('#clue-word', '스파이');
  await curSpy.page.fill('#clue-number', '2');
  await curSpy.page.click('#btn-clue');
  await sleep(400);

  // 요원 화면: 추측 가능(.guessable) 카드 등장
  const guessable = await curOp.page.locator('.board .card.guessable').count();
  check(guessable > 0, `CN-E-005b 단서 후 요원 추측 가능 카드(.guessable ${guessable})`);
  await curOp.page.screenshot({ path: SHOT + 'operative-clue.png' });

  // 자기팀 색 카드를 추측: 스파이마스터 화면에서 key-{firstTeam} 카드의 index 찾기
  const targetIdx = await curSpy.page.evaluate((ft) => {
    const cards = [...document.querySelectorAll('.board .card')];
    const i = cards.findIndex((c) => c.classList.contains(`key-${ft}`));
    return i;
  }, firstTeam);
  check(targetIdx >= 0, `CN-E-005c 스파이마스터 화면에서 자기팀 카드 식별(idx ${targetIdx})`);
  await curOp.page.locator('.board .card').nth(targetIdx).click();
  await sleep(400);

  // 추측 후 해당 카드가 공개(revealed) 됐는지 양쪽 확인
  const revealedOnOp = await curOp.page.locator('.board .card').nth(targetIdx).getAttribute('class');
  check(/revealed/.test(revealedOnOp) && new RegExp(`c-${firstTeam}`).test(revealedOnOp),
    `CN-E-005d 자기팀 카드 추측 → 공개(${firstTeam}) 반영`);
  await curOp.page.screenshot({ path: SHOT + 'after-guess.png' });

  check(failures.filter((f) => f.startsWith('pageerror')).length === 0, 'CN-E-콘솔: pageerror 없음');
} catch (e) {
  failed++;
  failures.push('EXCEPTION: ' + e.message);
  console.error(e);
} finally {
  await browser.close();
  server.close();
}

console.log(`\n총: ${passed + failed}건  PASS: ${passed}  FAIL: ${failed}`);
if (failed > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}
console.log('ALL PASS');
process.exit(0);
