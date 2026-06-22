/**
 * @fileoverview 요트 다이스 smoke 테스트 — ad-hoc 노드 러너.
 *
 * 실행:
 *   node tests/smoke.test.js
 *
 * 회귀 시나리오:
 *   YACHT-001~005: 각 카테고리 점수 계산 정확성
 *   YACHT-006: 상단 63점 도달 → +35 보너스
 *   YACHT-007: 야츠 보너스 +100점 (첫 야츠 50점 후 추가 야츠)
 *   YACHT-008: 전체 게임 흐름 (JOIN → 26턴 → GAME_OVER)
 *   YACHT-009: 1턴 최대 3회 굴림 제한
 *   YACHT-010: 카테고리 중복 선택 차단
 */

import http from 'node:http';
import { WebSocket } from 'ws';
import {
  createGame,
  rollDice,
  scoreCategory,
  toggleKeep,
  calcCategoryScore,
  upperSum,
  upperBonus,
  totalScore,
  snapshot,
  ALL_CATEGORIES,
  TURNS_PER_PLAYER,
} from '../game.js';
import { createApp } from '../server.js';

// ── 미니 테스트 러너 ───────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures = [];

function assertEq(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    const msg = `  FAIL  ${label}\n        expected: ${JSON.stringify(expected)}\n        actual:   ${JSON.stringify(actual)}`;
    console.log(msg);
    failures.push(msg);
  }
}

function assertTrue(cond, label) {
  if (cond) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    const msg = `  FAIL  ${label}`;
    console.log(msg);
    failures.push(msg);
  }
}

function section(name) {
  console.log(`\n[${name}]`);
}

// ── YACHT-001: 상단 카테고리 점수 ─────────────────────────────
section('YACHT-001: 상단 카테고리 점수 계산');
// Aces: 1이 3개 → 3
assertEq(calcCategoryScore([1, 1, 1, 4, 5], 'aces'), 3, '1×3 → aces=3');
assertEq(calcCategoryScore([2, 2, 2, 2, 2], 'twos'), 10, '2×5 → twos=10');
assertEq(calcCategoryScore([3, 3, 6, 6, 6], 'threes'), 6, '3×2 → threes=6');
assertEq(calcCategoryScore([4, 4, 4, 4, 5], 'fours'), 16, '4×4 → fours=16');
assertEq(calcCategoryScore([5, 5, 5, 5, 5], 'fives'), 25, '5×5 → fives=25');
assertEq(calcCategoryScore([6, 6, 6, 1, 2], 'sixes'), 18, '6×3 → sixes=18');
assertEq(calcCategoryScore([2, 3, 4, 5, 6], 'aces'), 0, '1 없음 → aces=0');

// ── YACHT-002: Triple / Quad ─────────────────────────────────
section('YACHT-002: Three/Four of a Kind');
assertEq(calcCategoryScore([3, 3, 3, 4, 5], 'threeOfAKind'), 18, '3+3+3+4+5 → 18');
assertEq(calcCategoryScore([2, 2, 3, 4, 5], 'threeOfAKind'), 0, '3개 미달 → 0');
assertEq(calcCategoryScore([6, 6, 6, 6, 6], 'threeOfAKind'), 30, '야츠는 3 이상 조건 만족 → 30');
assertEq(calcCategoryScore([4, 4, 4, 4, 1], 'fourOfAKind'), 17, '4×4 + 1 → 17');
assertEq(calcCategoryScore([4, 4, 4, 5, 5], 'fourOfAKind'), 0, '3+2는 quad 아님 → 0');
assertEq(calcCategoryScore([5, 5, 5, 5, 5], 'fourOfAKind'), 25, '야츠는 4 이상 조건 만족 → 25');

// ── YACHT-003: Full House ────────────────────────────────────
section('YACHT-003: Full House');
assertEq(calcCategoryScore([3, 3, 3, 5, 5], 'fullHouse'), 25, '3+2 → 25');
assertEq(calcCategoryScore([2, 2, 4, 4, 4], 'fullHouse'), 25, '2+3 → 25');
assertEq(calcCategoryScore([3, 3, 3, 3, 5], 'fullHouse'), 0, '4+1 → 0');
assertEq(calcCategoryScore([5, 5, 5, 5, 5], 'fullHouse'), 0, '야츠는 풀하우스 아님 → 0 (사용자 스펙)');
assertEq(calcCategoryScore([1, 2, 3, 4, 5], 'fullHouse'), 0, '스트레이트 → 0');

// ── YACHT-004: Straights / Yahtzee ───────────────────────────
section('YACHT-004: Straights / Yahtzee');
assertEq(calcCategoryScore([1, 2, 3, 4, 6], 'smallStraight'), 30, '1234 포함 → 30');
assertEq(calcCategoryScore([2, 3, 4, 5, 5], 'smallStraight'), 30, '2345 포함 → 30');
assertEq(calcCategoryScore([3, 4, 5, 6, 1], 'smallStraight'), 30, '3456 포함 → 30');
assertEq(calcCategoryScore([1, 2, 3, 5, 6], 'smallStraight'), 0, '연속 3개만 → 0');
assertEq(calcCategoryScore([1, 2, 3, 4, 5], 'largeStraight'), 40, '12345 → 40');
assertEq(calcCategoryScore([2, 3, 4, 5, 6], 'largeStraight'), 40, '23456 → 40');
assertEq(calcCategoryScore([1, 2, 3, 4, 6], 'largeStraight'), 0, '5 빠짐 → 0');
assertEq(calcCategoryScore([1, 1, 1, 1, 1], 'yahtzee'), 50, '5개 같음 → 50');
assertEq(calcCategoryScore([6, 6, 6, 6, 6], 'yahtzee'), 50, '6×5 → 50');
assertEq(calcCategoryScore([5, 5, 5, 5, 4], 'yahtzee'), 0, '4개만 같음 → 0');

// ── YACHT-005: Chance ────────────────────────────────────────
section('YACHT-005: Chance');
assertEq(calcCategoryScore([1, 2, 3, 4, 5], 'chance'), 15, '합산 → 15');
assertEq(calcCategoryScore([6, 6, 6, 6, 6], 'chance'), 30, '합산 → 30');
assertEq(calcCategoryScore([1, 1, 1, 1, 1], 'chance'), 5, '합산 → 5');

// ── YACHT-006: 상단 보너스 ───────────────────────────────────
section('YACHT-006: 상단 보너스 (≥63 → +35)');
// 1×3 + 2×6 + 3×9 + 4×12 + 5×15 + 6×18 = 3+12+18+24+25+18 = 63 정확.
{
  // 가장 단순한 케이스: 모두 만점(1×5=5, 2×10=10, 3×15=15, 4×20=20, 5×25=25, 6×30=30) → 합 105
  // 보너스 경계 테스트는 정확히 63인 패턴으로:
  // aces=3(1×3), twos=10(2×5), threes=15(3×5), fours=20(4×5), fives=10(5×2), sixes=5(6 정도 X) — 너무 복잡.
  // 단순화: 모두 만점 케이스 + 모두 0 케이스만 검증.
  const sheetFull = {
    aces: 5, twos: 10, threes: 15, fours: 20, fives: 25, sixes: 30,
  };
  for (const cat of ['threeOfAKind', 'fourOfAKind', 'fullHouse', 'smallStraight', 'largeStraight', 'yahtzee', 'chance']) {
    sheetFull[cat] = null;
  }
  assertEq(upperSum(sheetFull), 105, 'upperSum 만점 = 105');
  assertEq(upperBonus(sheetFull), 35, '105 ≥ 63 → 보너스 35');

  const sheetLow = {
    aces: 1, twos: 2, threes: 3, fours: 4, fives: 5, sixes: 6,
  };
  for (const cat of ['threeOfAKind', 'fourOfAKind', 'fullHouse', 'smallStraight', 'largeStraight', 'yahtzee', 'chance']) {
    sheetLow[cat] = null;
  }
  assertEq(upperSum(sheetLow), 21, 'upperSum 21');
  assertEq(upperBonus(sheetLow), 0, '21 < 63 → 보너스 0');

  // 경계 정확히 63: aces=3, twos=10, threes=15, fours=20, fives=15(5×3), sixes=0
  const sheetBoundary = {
    aces: 3, twos: 10, threes: 15, fours: 20, fives: 15, sixes: 0,
  };
  for (const cat of ['threeOfAKind', 'fourOfAKind', 'fullHouse', 'smallStraight', 'largeStraight', 'yahtzee', 'chance']) {
    sheetBoundary[cat] = null;
  }
  assertEq(upperSum(sheetBoundary), 63, 'upperSum 정확히 63');
  assertEq(upperBonus(sheetBoundary), 35, '63 정확 → 보너스 35');
}

// ── YACHT-007: 야츠 보너스 +100 ───────────────────────────────
section('YACHT-007: Yahtzee 보너스 (첫 야츠 50점 후 추가 야츠 +100)');
{
  const g = createGame();
  // 시나리오: p1이 첫 턴 야츠(1×5) 굴려서 yahtzee=50 기록.
  // game.js의 rollDice는 랜덤이므로 dice를 직접 조작한다 (내부 상태 접근).
  g.dice = [1, 1, 1, 1, 1];
  g.rollCount = 1;
  let r = scoreCategory(g, 'p1', 'yahtzee');
  assertTrue(r.ok, '첫 야츠 yahtzee 기록 ok');
  assertEq(r.scored, 50, '첫 야츠 = 50점');
  assertEq(r.yahtzeeBonusAwarded, 0, '첫 야츠는 보너스 없음');
  assertEq(g.yahtzeeBonus.p1, 0, 'yahtzeeBonus.p1 = 0');

  // 다음 턴 p2 야츠는 본인 시트의 yahtzee가 null이므로 보너스 없음 — 단순 기록.
  g.dice = [2, 2, 2, 2, 2];
  g.rollCount = 1;
  r = scoreCategory(g, 'p2', 'yahtzee');
  assertEq(r.scored, 50, 'p2 첫 야츠 = 50점');
  assertEq(r.yahtzeeBonusAwarded, 0, 'p2 첫 야츠는 보너스 없음');

  // 이제 p1 차례. p1은 yahtzee 50점 기록 상태. 다시 야츠(3×5) 굴리고 chance에 기록 → +100 보너스.
  g.dice = [3, 3, 3, 3, 3];
  g.rollCount = 1;
  r = scoreCategory(g, 'p1', 'chance');
  assertTrue(r.ok, 'p1 chance 기록 ok');
  assertEq(r.scored, 15, 'chance 점수 = 15');
  assertEq(r.yahtzeeBonusAwarded, 100, '추가 야츠 보너스 +100');
  assertEq(g.yahtzeeBonus.p1, 100, 'yahtzeeBonus.p1 누적 = 100');

  // p2: 0점도 OK 케이스. yahtzee 0점 기록 상태에서 추가 야츠는 보너스 없어야 함.
  // 우선 p2 야츠를 0점으로 만들기 위해 다른 다이스로 yahtzee를 강제 기록...
  // 위에서 p2가 이미 yahtzee=50 기록했으므로, 본 케이스는 별도 게임으로 재현한다.
  const g2 = createGame();
  // 시나리오: p1이 yahtzee 슬롯을 0점으로 기록한 뒤, 나중에 추가 야츠 굴려도 보너스 없음.
  // 턴 진행 순서: p1 aces → p2 aces → p1 yahtzee(0점) → p2 twos → p1 chance(야츠 보너스 X)

  // p1 aces.
  g2.dice = [1, 1, 1, 1, 1];
  g2.rollCount = 1;
  scoreCategory(g2, 'p1', 'aces'); // 5점.
  // p2 aces.
  g2.dice = [1, 2, 3, 4, 5];
  g2.rollCount = 1;
  scoreCategory(g2, 'p2', 'aces');
  // p1: 야츠 안 나온 다이스로 yahtzee 슬롯에 0점 강제 기록.
  g2.dice = [1, 2, 3, 4, 5];
  g2.rollCount = 1;
  let r2 = scoreCategory(g2, 'p1', 'yahtzee');
  assertEq(r2.scored, 0, '야츠 안 나옴 → yahtzee 슬롯 0점 기록');
  assertEq(g2.sheets.p1.yahtzee, 0, 'sheet.yahtzee = 0');

  // p2 twos (더미).
  g2.dice = [2, 3, 4, 5, 6];
  g2.rollCount = 1;
  scoreCategory(g2, 'p2', 'twos');

  // p1: 야츠(6×5) 굴리고 chance에 기록 → 보너스 없음(sheet.yahtzee가 0).
  g2.dice = [6, 6, 6, 6, 6];
  g2.rollCount = 1;
  r2 = scoreCategory(g2, 'p1', 'chance');
  assertTrue(r2.ok, 'p1 chance 기록 ok');
  assertEq(r2.yahtzeeBonusAwarded, 0, 'yahtzee 0점 기록 상태 → 추가 야츠 보너스 없음');
  assertEq(g2.yahtzeeBonus.p1, 0, 'yahtzeeBonus.p1 = 0');
}

// ── YACHT-009: 1턴 최대 3회 굴림 ──────────────────────────────
section('YACHT-009: 1턴 최대 3회 굴림 제한');
{
  const g = createGame();
  // p1 1차 굴림(랜덤 OK).
  let r = rollDice(g, 'p1');
  assertTrue(r.ok, '1차 굴림 ok');
  assertEq(r.rollCount, 1, 'rollCount = 1');
  // 2차 — keep 입력 필요.
  r = rollDice(g, 'p1', [false, false, false, false, false]);
  assertTrue(r.ok, '2차 굴림 ok');
  assertEq(r.rollCount, 2, 'rollCount = 2');
  // 3차.
  r = rollDice(g, 'p1', [false, false, false, false, false]);
  assertTrue(r.ok, '3차 굴림 ok');
  assertEq(r.rollCount, 3, 'rollCount = 3');
  // 4차 → 거절.
  r = rollDice(g, 'p1', [false, false, false, false, false]);
  assertTrue(!r.ok, '4차 굴림 거절');
  assertTrue(/3번/.test(r.error || ''), 'error 메시지에 "3번"');

  // 상대 턴 굴림 시도 → 거절.
  const g2 = createGame();
  const r2 = rollDice(g2, 'p2');
  assertTrue(!r2.ok, '상대 턴 굴림 거절');
}

// ── YACHT-010: 카테고리 중복 선택 차단 ───────────────────────
section('YACHT-010: 카테고리 중복 선택 차단 + 미굴림 차단');
{
  const g = createGame();
  g.dice = [1, 1, 1, 1, 1];
  g.rollCount = 1;
  let r = scoreCategory(g, 'p1', 'aces');
  assertTrue(r.ok, 'aces 첫 기록 ok');
  assertEq(g.sheets.p1.aces, 5, 'aces = 5');
  // 다시 같은 카테고리.
  // 이번엔 p1 차례 다시 와야 하므로 p2가 한 번 둔다.
  g.dice = [2, 3, 4, 5, 6];
  g.rollCount = 1;
  scoreCategory(g, 'p2', 'chance');
  // p1 차례.
  g.dice = [1, 1, 1, 2, 3];
  g.rollCount = 1;
  r = scoreCategory(g, 'p1', 'aces');
  assertTrue(!r.ok, '이미 기록된 aces 재선택 거절');
  assertTrue(/이미 기록/.test(r.error || ''), 'error 메시지에 "이미 기록"');

  // 미굴림(rollCount=0) 상태에서 카테고리 선택 → 거절.
  const g2 = createGame();
  r = scoreCategory(g2, 'p1', 'aces');
  assertTrue(!r.ok, '미굴림 상태 카테고리 거절');
  assertTrue(/1회 이상 굴려/.test(r.error || ''), 'error 메시지에 "1회 이상"');

  // 알 수 없는 카테고리.
  const g3 = createGame();
  g3.dice = [1, 2, 3, 4, 5];
  g3.rollCount = 1;
  r = scoreCategory(g3, 'p1', 'bogus');
  assertTrue(!r.ok, '알 수 없는 카테고리 거절');
}

// ── YACHT-LIVE-001: TOGGLE_KEEP 단위 검증 ────────────────────
section('YACHT-LIVE-001: toggleKeep 단위 검증 (본인 턴/rollCount/index 가드)');
{
  const g = createGame();
  // 1차 굴림 전(rollCount=0) → 거부.
  let r = toggleKeep(g, 'p1', 0, true);
  assertTrue(!r.ok, '1차 굴림 전 toggleKeep 거부');
  assertTrue(/1차 굴림/.test(r.error || ''), 'error 메시지에 "1차 굴림"');

  // 1차 굴림 후 (rollCount=1) p1 토글 정상.
  g.dice = [2, 3, 4, 5, 6];
  g.rollCount = 1;
  r = toggleKeep(g, 'p1', 0, true);
  assertTrue(r.ok, 'p1 본인 턴 + rollCount=1 → ok');
  assertEq(g.keep[0], true, 'keep[0] = true');
  // 같은 인덱스 false 재토글.
  r = toggleKeep(g, 'p1', 0, false);
  assertTrue(r.ok, 'false 재토글 ok');
  assertEq(g.keep[0], false, 'keep[0] = false');
  // 다른 인덱스 누적.
  toggleKeep(g, 'p1', 2, true);
  toggleKeep(g, 'p1', 4, true);
  assertEq(g.keep, [false, false, true, false, true], 'keep 누적 = [F,F,T,F,T]');

  // 상대 턴 시도(p2가 p1 턴에 토글) → 거부.
  r = toggleKeep(g, 'p2', 0, true);
  assertTrue(!r.ok, '상대 턴 toggleKeep 거부');

  // index 범위 벗어남 → 거부.
  r = toggleKeep(g, 'p1', -1, true);
  assertTrue(!r.ok, 'index=-1 거부');
  r = toggleKeep(g, 'p1', 5, true);
  assertTrue(!r.ok, 'index=5 거부');
  r = toggleKeep(g, 'p1', 'x', true);
  assertTrue(!r.ok, 'index=문자열 거부');

  // phase=ended 거부.
  const g2 = createGame();
  g2.phase = 'ended';
  r = toggleKeep(g2, 'p1', 0, true);
  assertTrue(!r.ok, 'phase=ended 거부');
}

// ── YACHT-008: 전체 26턴 게임 흐름 (WS 시나리오) ─────────────
section('YACHT-008: WS 게임 흐름 (JOIN → READY → 26턴 → GAME_OVER)');

/**
 * 임시 HTTP 서버를 띄우고 createApp을 마운트한 뒤,
 * 두 WS 클라이언트로 26턴 전체를 진행하고 GAME_OVER까지 수신하는지 검증한다.
 * 포트는 3098 고정(작업 서버 전용).
 */
async function runWsScenario() {
  const PORT = 3098;
  const app = createApp({ hostUrl: '' });
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', resolve);
  });

  /** 단일 클라이언트 헬퍼: WS 연결 + 메시지 큐 + 대기 유틸. */
  function makeClient() {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    const queue = [];
    const waiters = [];
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (waiters.length) {
        const w = waiters.shift();
        w(msg);
      } else {
        queue.push(msg);
      }
    });
    function waitFor(type, timeoutMs = 3000) {
      return new Promise((resolve, reject) => {
        const t0 = Date.now();
        function tryNext() {
          // 먼저 큐 확인.
          while (queue.length) {
            const m = queue.shift();
            if (m.type === type) { resolve(m); return; }
          }
          if (Date.now() - t0 > timeoutMs) { reject(new Error(`timeout waiting for ${type}`)); return; }
          // waiter 등록 후 다음 메시지 받으면 비교.
          waiters.push((m) => {
            if (m.type === type) resolve(m);
            else { queue.unshift(m); setTimeout(tryNext, 5); }
          });
        }
        tryNext();
      });
    }
    function send(msg) { ws.send(JSON.stringify(msg)); }
    return {
      ws,
      open: () => new Promise((res) => ws.once('open', res)),
      close: () => new Promise((res) => { ws.once('close', res); ws.close(); }),
      send,
      waitFor,
    };
  }

  const c1 = makeClient();
  const c2 = makeClient();
  await Promise.all([c1.open(), c2.open()]);

  // JOIN.
  c1.send({ type: 'JOIN', playerName: 'A' });
  c2.send({ type: 'JOIN', playerName: 'B' });
  const j1 = await c1.waitFor('JOINED');
  const j2 = await c2.waitFor('JOINED');
  assertEq(j1.playerId, 'p1', 'c1 = p1');
  assertEq(j2.playerId, 'p2', 'c2 = p2');

  // READY 양쪽.
  c1.send({ type: 'READY' });
  c2.send({ type: 'READY' });
  await c1.waitFor('START');
  await c2.waitFor('START');

  // 초기 STATE 수신.
  const s1Init = await c1.waitFor('STATE');
  assertEq(s1Init.currentTurn, 'p1', '선공 p1');
  assertEq(s1Init.rollCount, 0, '초기 rollCount 0');
  assertEq(s1Init.turnNumber, 1, '초기 turnNumber 1');

  // 26턴 진행: 각 턴마다 ROLL_DICE 1회 + SCORE_CATEGORY 1회.
  // 매 턴 카테고리는 순서대로 채운다.
  let currentTurn = 'p1';
  // 각 플레이어의 카테고리 인덱스(0~12).
  const catIdx = { p1: 0, p2: 0 };

  for (let turn = 0; turn < TURNS_PER_PLAYER * 2; turn++) {
    const me = currentTurn === 'p1' ? c1 : c2;
    const other = currentTurn === 'p1' ? c2 : c1;

    // ROLL_DICE 1회.
    me.send({ type: 'ROLL_DICE', keep: [false, false, false, false, false] });
    // 양쪽이 DICE_ROLLED + STATE 수신.
    await me.waitFor('DICE_ROLLED');
    await other.waitFor('DICE_ROLLED');
    const stMe = await me.waitFor('STATE');
    await other.waitFor('STATE');
    if (turn === 0) {
      assertEq(stMe.rollCount, 1, '첫 턴 ROLL 후 rollCount=1');
    }

    // SCORE_CATEGORY: 차례대로 ALL_CATEGORIES[idx] 사용.
    const cat = ALL_CATEGORIES[catIdx[currentTurn]];
    catIdx[currentTurn] += 1;
    me.send({ type: 'SCORE_CATEGORY', category: cat });
    await me.waitFor('CATEGORY_SCORED');
    await other.waitFor('CATEGORY_SCORED');
    const stAfter = await me.waitFor('STATE');
    await other.waitFor('STATE');
    assertEq(stAfter.sheets[currentTurn][cat] !== null, true, `턴 ${turn + 1}: ${currentTurn} ${cat} 기록`);

    // 다음 턴 검증 (마지막 턴 제외).
    if (turn < TURNS_PER_PLAYER * 2 - 1) {
      const nextTurn = currentTurn === 'p1' ? 'p2' : 'p1';
      assertEq(stAfter.currentTurn, nextTurn, `턴 교대 → ${nextTurn}`);
    }
    currentTurn = currentTurn === 'p1' ? 'p2' : 'p1';
  }

  // GAME_OVER 수신.
  const goMe1 = await c1.waitFor('GAME_OVER');
  const goMe2 = await c2.waitFor('GAME_OVER');
  assertTrue(['p1', 'p2', 'draw'].includes(goMe1.winner), 'GAME_OVER winner 유효');
  assertEq(goMe1.winner, goMe2.winner, '양쪽 winner 동일');
  assertTrue(typeof goMe1.p1Total === 'number', 'p1Total 숫자');
  assertTrue(typeof goMe1.p2Total === 'number', 'p2Total 숫자');
  assertTrue(goMe1.breakdown && goMe1.breakdown.p1 && goMe1.breakdown.p2, 'breakdown 존재');
  // 모든 카테고리가 채워졌는지 확인.
  let allFilled = true;
  for (const cat of ALL_CATEGORIES) {
    if (goMe1.breakdown.p1.sheet[cat] === null) allFilled = false;
    if (goMe1.breakdown.p2.sheet[cat] === null) allFilled = false;
  }
  assertTrue(allFilled, '양쪽 13 카테고리 전부 채워짐');

  await c1.close();
  await c2.close();
  await new Promise((res) => server.close(res));
}

await runWsScenario();

// ── YACHT-LIVE-002: WS TOGGLE_KEEP 양쪽 동기화 ─────────────
section('YACHT-LIVE-002: TOGGLE_KEEP → 양쪽 STATE.keep 일치');

async function runToggleKeepScenario() {
  const PORT = 3098;
  const app = createApp({ hostUrl: '' });
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', resolve);
  });

  function makeClient() {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    const queue = [];
    const waiters = [];
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (waiters.length) { waiters.shift()(msg); } else { queue.push(msg); }
    });
    function waitFor(type, timeoutMs = 3000) {
      return new Promise((resolve, reject) => {
        const t0 = Date.now();
        function tryNext() {
          while (queue.length) {
            const m = queue.shift();
            if (m.type === type) { resolve(m); return; }
          }
          if (Date.now() - t0 > timeoutMs) { reject(new Error(`timeout waiting for ${type}`)); return; }
          waiters.push((m) => {
            if (m.type === type) resolve(m);
            else { queue.unshift(m); setTimeout(tryNext, 5); }
          });
        }
        tryNext();
      });
    }
    return {
      ws,
      open: () => new Promise((res) => ws.once('open', res)),
      close: () => new Promise((res) => { ws.once('close', res); ws.close(); }),
      send: (msg) => ws.send(JSON.stringify(msg)),
      waitFor,
    };
  }

  const c1 = makeClient();
  const c2 = makeClient();
  await Promise.all([c1.open(), c2.open()]);
  c1.send({ type: 'JOIN', playerName: 'A' });
  c2.send({ type: 'JOIN', playerName: 'B' });
  await c1.waitFor('JOINED');
  await c2.waitFor('JOINED');
  c1.send({ type: 'READY' });
  c2.send({ type: 'READY' });
  await c1.waitFor('START');
  await c2.waitFor('START');
  await c1.waitFor('STATE');
  await c2.waitFor('STATE');

  // p1 1차 굴림.
  c1.send({ type: 'ROLL_DICE', keep: [false, false, false, false, false] });
  await c1.waitFor('DICE_ROLLED');
  await c2.waitFor('DICE_ROLLED');
  const st1Me = await c1.waitFor('STATE');
  const st1Other = await c2.waitFor('STATE');
  assertEq(st1Me.keep, [false, false, false, false, false], '1차 굴림 직후 keep 전부 false (p1)');
  assertEq(st1Other.keep, [false, false, false, false, false], '1차 굴림 직후 keep 전부 false (p2 시점)');

  // p1이 idx=2를 keep → 양쪽 STATE에 동일 반영.
  c1.send({ type: 'TOGGLE_KEEP', index: 2, value: true });
  const st2Me = await c1.waitFor('STATE');
  const st2Other = await c2.waitFor('STATE');
  assertEq(st2Me.keep[2], true, 'p1: keep[2]=true 반영');
  assertEq(st2Other.keep[2], true, 'p2(상대): keep[2]=true 동기화');
  assertEq(st2Me.keep, st2Other.keep, '양쪽 keep 완전 일치');

  // p1이 idx=0, idx=4 추가 keep.
  c1.send({ type: 'TOGGLE_KEEP', index: 0, value: true });
  await c1.waitFor('STATE');
  await c2.waitFor('STATE');
  c1.send({ type: 'TOGGLE_KEEP', index: 4, value: true });
  const st3Me = await c1.waitFor('STATE');
  const st3Other = await c2.waitFor('STATE');
  assertEq(st3Me.keep, [true, false, true, false, true], 'p1 누적 = [T,F,T,F,T]');
  assertEq(st3Other.keep, st3Me.keep, '상대 동기화 일치');

  // p1이 idx=0 해제.
  c1.send({ type: 'TOGGLE_KEEP', index: 0, value: false });
  const st4Me = await c1.waitFor('STATE');
  const st4Other = await c2.waitFor('STATE');
  assertEq(st4Me.keep, [false, false, true, false, true], 'idx=0 해제 = [F,F,T,F,T]');
  assertEq(st4Other.keep, st4Me.keep, '상대 동기화 일치');

  // 상대(p2)가 본인 턴 아닌데 TOGGLE_KEEP 시도 → 서버가 무시(STATE 변화 없음).
  // 검증 패턴: c2의 잘못된 토글 송신 + 곧이어 p1의 정상 토글 → 다음 STATE에서 keep[1]은 여전히 false,
  // c2의 시도가 반영되지 않았음을 확인한다. (별도 timeout 대기 없이 결정적으로 검증.)
  c2.send({ type: 'TOGGLE_KEEP', index: 1, value: true });
  // 즉시 p1이 idx=3 토글(true) → 이 토글에 대해 STATE가 도착.
  // 만약 c2의 토글이 처리됐다면 keep[1]도 true가 되었어야 한다 → false 확인 = 정상 거부.
  c1.send({ type: 'TOGGLE_KEEP', index: 3, value: true });
  const st5Me = await c1.waitFor('STATE');
  const st5Other = await c2.waitFor('STATE');
  assertEq(st5Me.keep[1], false, '상대 턴 아닌 p2 TOGGLE_KEEP 무시 → keep[1] 여전히 false');
  assertEq(st5Me.keep[3], true, 'p1의 idx=3 토글은 정상 반영');
  assertEq(st5Other.keep, st5Me.keep, '양쪽 동기화 일치');

  await c1.close();
  await c2.close();
  await new Promise((res) => server.close(res));
}

await runToggleKeepScenario();

// ── YACHT-011: 2판 연속 REMATCH 사이클 (N5 회귀 게이트) ─────────
section('YACHT-011: 2판 연속 GAME_OVER → REMATCH → START 정상 사이클');

/**
 * 1판 26턴 완주 → GAME_OVER → 양쪽 REMATCH → START(2판) → 26턴 완주 → GAME_OVER.
 * 서버 WS 레벨에서 연속 대전 사이클이 ERROR 없이 진행되는지 검증한다.
 * (클라 onStart의 rematchBtn 초기화는 DOM 영역이라 수동/Playwright로 별도 확인 — N5-T1.)
 */
async function runRematchCycleScenario() {
  const PORT = 3098;
  const app = createApp({ hostUrl: '' });
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', resolve);
  });

  function makeClient() {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    const queue = [];
    const waiters = [];
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (waiters.length) { waiters.shift()(msg); } else { queue.push(msg); }
    });
    function waitFor(type, timeoutMs = 3000) {
      return new Promise((resolve, reject) => {
        const t0 = Date.now();
        function tryNext() {
          while (queue.length) {
            const m = queue.shift();
            if (m.type === type) { resolve(m); return; }
          }
          if (Date.now() - t0 > timeoutMs) { reject(new Error(`timeout waiting for ${type}`)); return; }
          waiters.push((m) => {
            if (m.type === type) resolve(m);
            else { queue.unshift(m); setTimeout(tryNext, 5); }
          });
        }
        tryNext();
      });
    }
    return {
      ws,
      open: () => new Promise((res) => ws.once('open', res)),
      close: () => new Promise((res) => { ws.once('close', res); ws.close(); }),
      send: (msg) => ws.send(JSON.stringify(msg)),
      waitFor,
    };
  }

  // 한 판 전체(26턴)를 진행하고 GAME_OVER를 반환하는 헬퍼.
  async function playOneGame(c1, c2) {
    const catIdx = { p1: 0, p2: 0 };
    let currentTurn = 'p1';
    for (let turn = 0; turn < TURNS_PER_PLAYER * 2; turn++) {
      const me = currentTurn === 'p1' ? c1 : c2;
      const other = currentTurn === 'p1' ? c2 : c1;
      me.send({ type: 'ROLL_DICE', keep: [false, false, false, false, false] });
      await me.waitFor('DICE_ROLLED');
      await other.waitFor('DICE_ROLLED');
      await me.waitFor('STATE');
      await other.waitFor('STATE');
      const cat = ALL_CATEGORIES[catIdx[currentTurn]];
      catIdx[currentTurn] += 1;
      me.send({ type: 'SCORE_CATEGORY', category: cat });
      await me.waitFor('CATEGORY_SCORED');
      await other.waitFor('CATEGORY_SCORED');
      await me.waitFor('STATE');
      await other.waitFor('STATE');
      currentTurn = currentTurn === 'p1' ? 'p2' : 'p1';
    }
    const go1 = await c1.waitFor('GAME_OVER');
    const go2 = await c2.waitFor('GAME_OVER');
    return { go1, go2 };
  }

  const c1 = makeClient();
  const c2 = makeClient();
  await Promise.all([c1.open(), c2.open()]);
  c1.send({ type: 'JOIN', playerName: 'A' });
  c2.send({ type: 'JOIN', playerName: 'B' });
  await c1.waitFor('JOINED');
  await c2.waitFor('JOINED');
  c1.send({ type: 'READY' });
  c2.send({ type: 'READY' });
  await c1.waitFor('START');
  await c2.waitFor('START');
  await c1.waitFor('STATE');
  await c2.waitFor('STATE');

  // ── 1판 ──
  const g1 = await playOneGame(c1, c2);
  assertTrue(['p1', 'p2', 'draw'].includes(g1.go1.winner), '1판 GAME_OVER winner 유효');

  // ── 1판 → 2판 REMATCH ──
  c1.send({ type: 'REMATCH' });
  c2.send({ type: 'REMATCH' });
  // 양쪽 REMATCH → 서버가 새 게임 시작(START + 초기 STATE).
  await c1.waitFor('START');
  await c2.waitFor('START');
  const s2Init1 = await c1.waitFor('STATE');
  const s2Init2 = await c2.waitFor('STATE');
  assertEq(s2Init1.turnNumber, 1, '2판 초기 turnNumber=1 (새 게임)');
  assertEq(s2Init1.rollCount, 0, '2판 초기 rollCount=0');
  assertEq(s2Init1.currentTurn, 'p1', '2판 선공 p1');
  assertEq(s2Init2.turnNumber, 1, '2판 초기 turnNumber=1 (p2 시점)');

  // ── 2판 완주 → GAME_OVER ──
  const g2 = await playOneGame(c1, c2);
  assertTrue(['p1', 'p2', 'draw'].includes(g2.go1.winner), '2판 GAME_OVER winner 유효 (연속 대전 정상)');
  assertEq(g2.go1.winner, g2.go2.winner, '2판 양쪽 winner 동일');

  // ── 3판 REMATCH도 ERROR 없이 START 도달 ──
  c1.send({ type: 'REMATCH' });
  c2.send({ type: 'REMATCH' });
  await c1.waitFor('START');
  await c2.waitFor('START');
  const s3Init = await c1.waitFor('STATE');
  assertEq(s3Init.turnNumber, 1, '3판 초기 turnNumber=1 (연속 3판 사이클 정상)');

  await c1.close();
  await c2.close();
  await new Promise((res) => server.close(res));
}

await runRematchCycleScenario();

// ── YACHT-012: rollDice keep 동결/재굴림 통계 회귀 (서버 권위) ──
// (2026-06-20 reroll-animation 버그 관련 서버 회귀 방어: 클라 렌더 버그였고 game.js는 무결이지만,
//  "keep=true 인덱스는 값 동결, keep=false 인덱스는 재굴림 대상"이라는 서버 계약을 다회 통계로 박제한다.)
section('YACHT-012: rollDice — keep=true 동결 + keep=false 재굴림 (다회 통계)');
{
  const TRIALS = 400;       // 통계 시행 횟수
  const keep = [true, false, true, false, false];   // 인덱스 0,2 고정 / 1,3,4 재굴림 대상
  let frozenViolations = 0; // keep 인덱스가 굴림 후 값이 바뀐 위반 횟수
  const rerollChanged = [0, 0, 0, 0, 0]; // 인덱스별 "재굴림으로 값이 바뀐" 횟수 집계

  for (let t = 0; t < TRIALS; t++) {
    const g = createGame();
    // 1차 굴림(5개 전부 새로). 값을 결정적으로 고정해 비교 기준을 만든다.
    rollDice(g, 'p1');
    g.dice = [1, 2, 3, 4, 5];   // 비교 기준 dice (1차 결과를 결정값으로 대체)
    const before = g.dice.slice();
    // 2차 굴림: keep 적용.
    const r = rollDice(g, 'p1', keep);
    if (!r.ok) { frozenViolations += 999; break; } // 굴림 실패 자체가 위반
    for (let i = 0; i < 5; i++) {
      if (keep[i]) {
        // keep=true → 값이 동결되어야 한다.
        if (g.dice[i] !== before[i]) frozenViolations += 1;
      } else {
        // keep=false → 재굴림 대상. 값이 바뀐 경우 집계(우연히 같을 수 있어 100% 변화는 비강제).
        if (g.dice[i] !== before[i]) rerollChanged[i] += 1;
      }
    }
  }

  assertEq(frozenViolations, 0, `keep=true 인덱스(0,2) ${TRIALS}회 모두 값 동결 (위반 0)`);
  // keep=false 인덱스(1,3,4)는 재굴림 대상이므로 다회 시행 중 최소 1회는 값이 바뀌어야 한다.
  // (전 시행 동일값일 확률 = (1/6)^400 ≈ 0 — 사실상 불가능. 재굴림이 실제로 일어남을 입증.)
  assertTrue(rerollChanged[1] > 0, `인덱스 1(keep=false) 재굴림으로 값 변화 발생 (${rerollChanged[1]}/${TRIALS})`);
  assertTrue(rerollChanged[3] > 0, `인덱스 3(keep=false) 재굴림으로 값 변화 발생 (${rerollChanged[3]}/${TRIALS})`);
  assertTrue(rerollChanged[4] > 0, `인덱스 4(keep=false) 재굴림으로 값 변화 발생 (${rerollChanged[4]}/${TRIALS})`);
  // rollCount는 2차 굴림으로 정확히 2가 되어야 한다(굴림 이벤트 권위값 — 클라 애니메이션 트리거의 근거).
  {
    const g = createGame();
    rollDice(g, 'p1');
    assertEq(g.rollCount, 1, '1차 굴림 후 rollCount=1');
    rollDice(g, 'p1', keep);
    assertEq(g.rollCount, 2, '2차 굴림 후 rollCount=2 (애니메이션 트리거 권위값)');
  }
}

// ── 요약 ────────────────────────────────────────────────────
console.log('\n────────────────────────────────────────');
console.log(`총 ${passed + failed}건, PASS=${passed}, FAIL=${failed}`);
if (failed > 0) {
  console.log('\n실패 목록:');
  for (const f of failures) console.log(f);
  process.exit(1);
} else {
  console.log('모든 smoke 테스트 통과.');
  process.exit(0);
}
