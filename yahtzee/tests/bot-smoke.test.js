/**
 * @fileoverview 요트 다이스 봇 시나리오 smoke 테스트 — ad-hoc 노드 러너.
 *
 * 실행:
 *   node tests/bot-smoke.test.js
 *
 * 검증 시나리오 (YACHT-BOT-001~005):
 *   - 사람 1명(mode=ai) → 서버가 봇 자동 spawn → 양쪽 JOIN+READY → 새 게임
 *   - 봇이 자기 턴마다 자동 ROLL_DICE + SCORE_CATEGORY 진행
 *   - 총 26턴(p1 13 + p2 13) 완주
 *   - GAME_OVER 수신 + breakdown 양쪽 13 카테고리 전부 채워짐
 *   - winner 결과 일관성 (양쪽 동일)
 *
 * 작업 포트: 3099 (사용자 launcher 3000과 다른 게임 서버 무영향).
 */

import http from 'node:http';
import { WebSocket } from 'ws';
import { createApp } from '../server.js';
import { ALL_CATEGORIES, TURNS_PER_PLAYER } from '../game.js';

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

/**
 * 단일 클라이언트 헬퍼: WS 연결 + 메시지 큐 + 대기 유틸.
 * @param {string} url
 * @returns {object}
 */
function makeClient(url) {
  const ws = new WebSocket(url);
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
  function waitFor(type, timeoutMs = 30000) {
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
  function send(msg) { ws.send(JSON.stringify(msg)); }
  return {
    ws,
    open: () => new Promise((res) => ws.once('open', res)),
    close: () => new Promise((res) => { ws.once('close', res); ws.close(); }),
    send,
    waitFor,
  };
}

// ── YACHT-BOT-001~005: 사람 1명 + 봇 1명 게임 흐름 ─────────────
section('YACHT-BOT-001~005: 봇 게임 흐름 (mode=ai → 봇 spawn → 26턴 → GAME_OVER)');

/**
 * 임시 HTTP 서버를 띄우고 createApp을 마운트한 뒤,
 * 사람 1명이 mode=ai로 접속 → 서버가 봇 spawn → 26턴 진행 → GAME_OVER까지 검증.
 */
async function runBotScenario() {
  const PORT = 3099;
  // standalone 모드와 동일하게 getBotUrl 자동 구성.
  const app = createApp({
    hostUrl: '',
    getBotUrl: () => `ws://localhost:${PORT}/ws?mode=bot`,
  });
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', resolve);
  });

  // 사람 클라이언트 — mode=ai로 접속.
  const me = makeClient(`ws://127.0.0.1:${PORT}/ws?mode=ai`);
  await me.open();

  me.send({ type: 'JOIN', playerName: '나' });
  const joined = await me.waitFor('JOINED');
  assertEq(joined.playerId, 'p1', '사람이 p1 자리 점유');

  me.send({ type: 'READY' });

  // 봇이 spawn되어 READY까지 보내면 서버가 START + 초기 STATE 송신.
  // 봇 spawn 200ms 지연 + 봇 WS 연결 + JOIN/READY 처리 시간을 고려해 10초 타임아웃.
  await me.waitFor('START', 15000);

  // 초기 STATE.
  const sInit = await me.waitFor('STATE', 5000);
  assertEq(sInit.currentTurn, 'p1', '선공 p1 (사람)');
  assertEq(sInit.turnNumber, 1, '초기 turnNumber=1');

  // 사람이 자기 턴 13회 진행 + 봇이 자기 턴 13회 자동 진행.
  // 사람 턴: ROLL → SCORE_CATEGORY 차례대로.
  // 봇 턴: 봇이 알아서 진행하므로 사람은 STATE 메시지만 흘려보내며 대기.
  let currentTurn = sInit.currentTurn;
  // 사람의 카테고리 인덱스.
  let humanCatIdx = 0;
  let botTurnsObserved = 0;
  let humanTurnsObserved = 0;

  const TOTAL_TURNS = TURNS_PER_PLAYER * 2; // 26
  for (let turn = 0; turn < TOTAL_TURNS; turn++) {
    if (currentTurn === 'p1') {
      // 사람 턴.
      me.send({ type: 'ROLL_DICE', keep: [false, false, false, false, false] });
      await me.waitFor('DICE_ROLLED', 5000);
      // ROLL 결과 STATE 1건.
      await me.waitFor('STATE', 5000);
      // 카테고리 선택.
      const cat = ALL_CATEGORIES[humanCatIdx];
      humanCatIdx += 1;
      me.send({ type: 'SCORE_CATEGORY', category: cat });
      await me.waitFor('CATEGORY_SCORED', 5000);
      const stAfter = await me.waitFor('STATE', 5000);
      humanTurnsObserved += 1;
      if (turn < TOTAL_TURNS - 1) {
        assertEq(stAfter.currentTurn, 'p2', `사람 턴 후 → 봇(p2) 턴 (turn ${turn + 1})`);
      }
      currentTurn = stAfter.currentTurn;
    } else {
      // 봇 턴 — 사람은 봇의 ROLL/SCORE 결과 STATE를 흘려보내며 turn 교대를 기다린다.
      // 봇은 600~1200ms 지연 후 행동, 1턴당 1~3회 ROLL + 1회 SCORE → STATE 2~4회 도착.
      // STATE의 currentTurn이 p1이 되거나 phase='ended'면 봇 턴 종료.
      let botTurnDone = false;
      const botTurnStart = Date.now();
      while (!botTurnDone) {
        if (Date.now() - botTurnStart > 30000) {
          throw new Error(`bot turn timeout (turn=${turn})`);
        }
        const stMaybe = await me.waitFor('STATE', 30000);
        if (stMaybe.currentTurn === 'p1' || stMaybe.phase === 'ended') {
          botTurnDone = true;
          botTurnsObserved += 1;
          currentTurn = stMaybe.currentTurn;
          if (stMaybe.phase === 'ended') break;
        }
      }
    }
    if (turn === TOTAL_TURNS - 1) break;
  }

  // GAME_OVER 수신.
  const go = await me.waitFor('GAME_OVER', 10000);
  assertTrue(['p1', 'p2', 'draw'].includes(go.winner), 'GAME_OVER winner 유효');
  assertTrue(typeof go.p1Total === 'number', 'p1Total 숫자');
  assertTrue(typeof go.p2Total === 'number', 'p2Total 숫자');
  assertTrue(go.breakdown && go.breakdown.p1 && go.breakdown.p2, 'breakdown 존재');

  // 양쪽 13 카테고리 전부 채워짐.
  let allFilled = true;
  for (const cat of ALL_CATEGORIES) {
    if (go.breakdown.p1.sheet[cat] === null) allFilled = false;
    if (go.breakdown.p2.sheet[cat] === null) allFilled = false;
  }
  assertTrue(allFilled, '양쪽 13 카테고리 전부 채워짐 (봇 정상 진행 완료)');

  // 점수 합 정합성 (upperSum + upperBonus + lower + yahtzeeBonus = total).
  function lowerSum(sheet) {
    const LOWER = ['threeOfAKind', 'fourOfAKind', 'fullHouse', 'smallStraight', 'largeStraight', 'yahtzee', 'chance'];
    return LOWER.reduce((s, c) => s + (typeof sheet[c] === 'number' ? sheet[c] : 0), 0);
  }
  const p1Computed = go.breakdown.p1.upperSum + go.breakdown.p1.upperBonus
    + lowerSum(go.breakdown.p1.sheet) + go.breakdown.p1.yahtzeeBonus;
  const p2Computed = go.breakdown.p2.upperSum + go.breakdown.p2.upperBonus
    + lowerSum(go.breakdown.p2.sheet) + go.breakdown.p2.yahtzeeBonus;
  assertEq(p1Computed, go.p1Total, 'p1 점수 합 정합성');
  assertEq(p2Computed, go.p2Total, 'p2 점수 합 정합성');

  assertEq(humanTurnsObserved, TURNS_PER_PLAYER, `사람이 ${TURNS_PER_PLAYER}턴 진행`);
  assertEq(botTurnsObserved, TURNS_PER_PLAYER, `봇이 ${TURNS_PER_PLAYER}턴 진행`);

  // 정리.
  await me.close();
  await new Promise((res) => server.close(res));
  // 봇 자식 프로세스도 close 핸들러에서 killBotChild로 정리됨.
}

try {
  await runBotScenario();
} catch (err) {
  failed += 1;
  failures.push(`scenario 예외: ${err.message}\n${err.stack}`);
  console.log(`  FAIL  scenario 예외: ${err.message}`);
}

// ── 요약 ────────────────────────────────────────────────────
console.log('\n────────────────────────────────────────');
console.log(`총 ${passed + failed}건, PASS=${passed}, FAIL=${failed}`);
if (failed > 0) {
  console.log('\n실패 목록:');
  for (const f of failures) console.log(f);
  process.exit(1);
} else {
  console.log('모든 봇 smoke 테스트 통과.');
  process.exit(0);
}
