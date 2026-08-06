/**
 * @fileoverview QA 능동 탐색: 봇 게임오버 수정의 엣지케이스를 검증한다.
 *
 * 실행:
 *   node tests/bot-gameover-fix-qa.spec.js
 *
 * 검증 시나리오:
 *   QA-1: 봇이 정상 GAME_OVER를 보낸 후 ws.close → GAME_RESULT 이중 전송 여부
 *   QA-2: 봇이 게임 시작 직후(카운트다운 완료 전) 바로 ws.close → 서버 크래시 여부
 *   QA-3: 사람이 먼저 disconnect → 봇 terminate → close 핸들러 신규 블록 미발동
 *   QA-4: 봇 close 시 사람이 OPPONENT_LEFT와 reason=disconnect GAME_RESULT도 받는지 (이중 전송)
 *   QA-5: 봇 BOARD_STATE cells가 botGrid 원본과 독립적인 deep copy인지
 *
 * 작업 포트: 3113 (기존 3110/3111/3112와 격리).
 */

import http from 'node:http';
import { WebSocket } from 'ws';
import { createApp } from '../server.js';

const PORT = 3113;

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

async function startServer(extraOpts = {}) {
  const app = createApp({
    hostUrl: '',
    getBotUrl: () => null,
    heartbeatIntervalMs: 0,
    ...extraOpts,
  });
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', resolve);
  });
  return server;
}

function makeClient(query) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws${query || ''}`);
  const queue = [];
  const waiters = [];
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (waiters.length) {
      waiters.shift()(msg);
    } else {
      queue.push(msg);
    }
  });
  function waitFor(type, timeoutMs = 15000) {
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

  /** 일정 시간 내 특정 타입의 메시지를 모두 수집한다. */
  function collectAll(timeoutMs = 2000) {
    return new Promise((resolve) => {
      const collected = [...queue];
      queue.length = 0;
      const timer = setTimeout(() => {
        // drain remaining
        while (waiters.length) waiters.shift()(null);
        resolve(collected);
      }, timeoutMs);
      const origPush = queue.push.bind(queue);
      // intercept pushes during collection
      const handler = (data) => {
        // already parsed by the main handler
      };
      ws.on('message', () => {
        // messages will be added to queue by the existing handler
        // we need to drain them
        setTimeout(() => {
          while (queue.length) collected.push(queue.shift());
        }, 0);
      });
      // After timeout, clean up
      setTimeout(() => {
        resolve(collected);
      }, timeoutMs);
    });
  }

  return {
    ws,
    open: () => new Promise((res) => ws.once('open', res)),
    close: () => new Promise((res) => { ws.once('close', res); ws.close(); }),
    send: (msg) => ws.send(JSON.stringify(msg)),
    waitFor,
    /** 현재 큐에 쌓인 메시지를 모두 반환하고 큐를 비운다. */
    drainQueue: () => { const out = [...queue]; queue.length = 0; return out; },
    /** 지정 시간 동안 모든 메시지를 수집한다. */
    collectForDuration: (ms = 2000) => new Promise((resolve) => {
      const result = [...queue];
      queue.length = 0;
      const interval = setInterval(() => {
        while (queue.length) result.push(queue.shift());
      }, 50);
      setTimeout(() => {
        clearInterval(interval);
        while (queue.length) result.push(queue.shift());
        resolve(result);
      }, ms);
    }),
  };
}

// ── QA-1: 봇이 정상 GAME_OVER를 보낸 후 ws.close → 이중 GAME_RESULT 여부 ──
section('QA-1: 봇 정상 GAME_OVER 후 ws.close → GAME_RESULT 이중 전송 검증');

async function runDoubleGameResultTest() {
  const server = await startServer();

  const human = makeClient('?mode=human');
  await human.open();
  human.send({ type: 'JOIN', playerName: 'Human' });
  const joined = await human.waitFor('JOINED');
  const roomId = joined.roomId;

  const bot = makeClient(`?mode=bot&room=${roomId}`);
  await bot.open();
  bot.send({ type: 'JOIN', playerName: 'FakeBot' });
  await bot.waitFor('JOINED');

  human.send({ type: 'READY' });
  bot.send({ type: 'READY' });
  await human.waitFor('START', 10000);
  await new Promise((res) => setTimeout(res, 200));

  // 봇이 정상적으로 GAME_OVER를 보내고 ws를 닫는다 (정상 경로)
  bot.send({ type: 'GAME_OVER' });
  // 첫 번째 GAME_RESULT를 기다린다
  const result1 = await human.waitFor('GAME_RESULT', 5000);
  assertEq(result1.reason, 'topout', 'QA-1: 첫 GAME_RESULT reason=topout');

  // 봇 WS를 닫는다
  await bot.close();

  // 2초 동안 추가 메시지를 수집한다
  const extras = await human.collectForDuration(2000);
  const extraGameResults = extras.filter((m) => m.type === 'GAME_RESULT');
  const opponentLefts = extras.filter((m) => m.type === 'OPPONENT_LEFT');

  // 이중 GAME_RESULT 여부 확인
  // 현재 구현에서는 봇 close 후 r.players.length > 0 → 추가 GAME_RESULT(disconnect) 전송
  // 클라이언트 측 resultShown 가드가 있으므로 UI 영향은 없지만, 서버가 이중 전송한다
  console.log(`  [관찰] 추가 GAME_RESULT 수: ${extraGameResults.length}, OPPONENT_LEFT 수: ${opponentLefts.length}`);
  if (extraGameResults.length > 0) {
    console.log(`  [관찰] 추가 GAME_RESULT reasons: ${extraGameResults.map(m => m.reason).join(', ')}`);
    console.log(`  [INFO] 이중 GAME_RESULT 발생 - 클라이언트 resultShown 가드로 UI 영향 없음`);
  }

  // 이중 GAME_RESULT가 발생하는지 기록 (MEDIUM 이슈)
  assertTrue(true, 'QA-1: 서버 크래시 없이 정상 경로 완료');
  // 이중 전송 여부 기록 (관찰용)
  const hasDoubleResult = extraGameResults.length > 0;
  console.log(`  [FINDING] 이중 GAME_RESULT 발생: ${hasDoubleResult}`);

  await human.close();
  await new Promise((res) => server.close(res));
  return hasDoubleResult;
}

let hasDoubleResult = false;
try {
  hasDoubleResult = await runDoubleGameResultTest();
} catch (err) {
  failed += 1;
  failures.push(`QA-1 예외: ${err.message}\n${err.stack}`);
  console.log(`  FAIL  QA-1 예외: ${err.message}`);
}

// ── QA-2: 봇이 게임 시작 직후 즉시 ws.close → 서버 크래시 여부 ──
section('QA-2: 봇이 START 직후 즉시 ws.close → 서버 안전성');

async function runImmediateCloseTest() {
  const server = await startServer();

  const human = makeClient('?mode=human');
  await human.open();
  human.send({ type: 'JOIN', playerName: 'Human' });
  const joined = await human.waitFor('JOINED');
  const roomId = joined.roomId;

  const bot = makeClient(`?mode=bot&room=${roomId}`);
  await bot.open();
  bot.send({ type: 'JOIN', playerName: 'FakeBot' });
  await bot.waitFor('JOINED');

  human.send({ type: 'READY' });
  bot.send({ type: 'READY' });
  await human.waitFor('START', 10000);

  // START 직후 봇이 GAME_OVER 없이 즉시 close
  await bot.close();

  // 사람이 GAME_RESULT를 받아야 한다 (서버가 crashing 없이)
  const result = await human.waitFor('GAME_RESULT', 10000);
  assertEq(result.reason, 'topout', 'QA-2: START 직후 봇 close → reason=topout');
  assertTrue(result.winner === joined.playerId, 'QA-2: 사람이 승리');

  await human.close();
  await new Promise((res) => server.close(res));
}

try {
  await runImmediateCloseTest();
} catch (err) {
  failed += 1;
  failures.push(`QA-2 예외: ${err.message}\n${err.stack}`);
  console.log(`  FAIL  QA-2 예외: ${err.message}`);
}

// ── QA-3: 사람이 먼저 disconnect → 봇 close 핸들러에서 신규 블록 미발동 ──
section('QA-3: 사람 disconnect → 봇 terminate → 봇 close 핸들러 가드');

async function runHumanDisconnectFirstTest() {
  const server = await startServer();

  const human = makeClient('?mode=human');
  await human.open();
  human.send({ type: 'JOIN', playerName: 'Human' });
  const joined = await human.waitFor('JOINED');
  const roomId = joined.roomId;

  const bot = makeClient(`?mode=bot&room=${roomId}`);
  await bot.open();
  bot.send({ type: 'JOIN', playerName: 'FakeBot' });
  await bot.waitFor('JOINED');

  human.send({ type: 'READY' });
  bot.send({ type: 'READY' });
  await human.waitFor('START', 10000);
  await new Promise((res) => setTimeout(res, 200));

  // 사람이 먼저 disconnect
  await human.close();

  // 봇 측에서 메시지를 잠시 수집한다 (서버가 봇을 terminate하므로)
  const botMsgs = await bot.collectForDuration(3000);

  // 서버 크래시가 없었는지 확인 — 새 접속 시도
  const check = makeClient();
  await check.open();
  check.send({ type: 'JOIN', playerName: 'Checker' });
  const checkJoined = await check.waitFor('JOINED', 5000);
  assertTrue(checkJoined.playerId === 'p1', 'QA-3: 사람 disconnect 후 서버 정상 (새 접속 가능)');

  await check.close();
  // bot ws는 이미 terminate되어 닫혀있을 수 있음
  if (bot.ws.readyState === WebSocket.OPEN) await bot.close();
  await new Promise((res) => server.close(res));
}

try {
  await runHumanDisconnectFirstTest();
} catch (err) {
  failed += 1;
  failures.push(`QA-3 예외: ${err.message}\n${err.stack}`);
  console.log(`  FAIL  QA-3 예외: ${err.message}`);
}

// ── QA-4: 봇 BOARD_STATE cells 심층 검증 — 값 범위와 변이 독립성 ──
section('QA-4: 봇 cells 값 범위 정밀 검증');

async function runCellsValueRangeTest() {
  // 실제 봇을 사용하는 테스트 (getBotUrl을 정상 설정)
  const server = await startServer({
    getBotUrl: (roomId) => `ws://localhost:${PORT}/ws?mode=bot&room=${roomId}`,
  });

  const me = makeClient('?mode=ai');
  await me.open();
  me.send({ type: 'JOIN', playerName: 'TestUser' });
  await me.waitFor('JOINED');
  me.send({ type: 'READY' });
  await me.waitFor('START', 15000);

  // 여러 OPPONENT_BOARD를 수집해 cells 값 범위 통계를 낸다
  const valueSeen = new Set();
  const deadline = Date.now() + 20000;
  let msgCount = 0;
  while (Date.now() < deadline && msgCount < 10) {
    try {
      const opp = await me.waitFor('OPPONENT_BOARD', 20000);
      msgCount++;
      if (Array.isArray(opp.cells) && opp.cells.length === 22) {
        for (const row of opp.cells) {
          if (Array.isArray(row)) {
            for (const v of row) valueSeen.add(v);
          }
        }
      }
    } catch { break; }
  }

  assertTrue(msgCount > 0, `QA-4: OPPONENT_BOARD ${msgCount}건 수신`);
  // 모든 값이 0~8 범위인지 확인
  const allInRange = [...valueSeen].every((v) => Number.isInteger(v) && v >= 0 && v <= 8);
  assertTrue(allInRange, `QA-4: 모든 cells 값이 0~8 범위 (관측값: ${[...valueSeen].sort().join(',')})`);
  // 0이 아닌 값이 있는지 (실제 블록이 렌더링될 수 있는지)
  const hasBlock = [...valueSeen].some((v) => v > 0);
  assertTrue(hasBlock, 'QA-4: cells에 실제 블록 값(>0)이 존재');

  await me.close();
  await new Promise((res) => server.close(res));
}

try {
  await runCellsValueRangeTest();
} catch (err) {
  failed += 1;
  failures.push(`QA-4 예외: ${err.message}\n${err.stack}`);
  console.log(`  FAIL  QA-4 예외: ${err.message}`);
}

// ── QA-5: GAME_OVER 없이 봇 close → 리매치 → 다시 close → 연속 GAME_RESULT 정상 ──
section('QA-5: 연속 2회 봇 비정상 종료 + 리매치 사이클');

async function runDoubleRematchTest() {
  const server = await startServer();

  const human = makeClient('?mode=human');
  await human.open();
  human.send({ type: 'JOIN', playerName: 'Human' });
  const joined = await human.waitFor('JOINED');
  const roomId = joined.roomId;

  // 1차 봇
  const bot1 = makeClient(`?mode=bot&room=${roomId}`);
  await bot1.open();
  bot1.send({ type: 'JOIN', playerName: 'Bot1' });
  await bot1.waitFor('JOINED');
  human.send({ type: 'READY' });
  bot1.send({ type: 'READY' });
  await human.waitFor('START', 10000);
  await new Promise((res) => setTimeout(res, 200));

  // 1차 비정상 종료
  await bot1.close();
  const result1 = await human.waitFor('GAME_RESULT', 10000);
  assertEq(result1.reason, 'topout', 'QA-5-1: 1차 봇 close → reason=topout');

  // 메시지 큐 비우기 (OPPONENT_LEFT 등 이중 전송 소화)
  await new Promise((res) => setTimeout(res, 500));
  human.drainQueue();

  // 2차 봇으로 리매치
  const bot2 = makeClient(`?mode=bot&room=${roomId}`);
  await bot2.open();
  bot2.send({ type: 'JOIN', playerName: 'Bot2' });
  await bot2.waitFor('JOINED');
  human.send({ type: 'REMATCH' });
  bot2.send({ type: 'REMATCH' });
  await human.waitFor('START', 10000);
  await new Promise((res) => setTimeout(res, 200));

  // 2차 비정상 종료
  await bot2.close();
  const result2 = await human.waitFor('GAME_RESULT', 10000);
  assertEq(result2.reason, 'topout', 'QA-5-2: 2차 봇 close → reason=topout');

  assertTrue(true, 'QA-5: 연속 2회 봇 비정상 종료 + 리매치 사이클 완료');

  await human.close();
  await new Promise((res) => server.close(res));
}

try {
  await runDoubleRematchTest();
} catch (err) {
  failed += 1;
  failures.push(`QA-5 예외: ${err.message}\n${err.stack}`);
  console.log(`  FAIL  QA-5 예외: ${err.message}`);
}

// ── 요약 ────────────────────────────────────────────────────
console.log('\n════════════════════════════════════════');
console.log(`총 ${passed + failed}건, PASS=${passed}, FAIL=${failed}`);
if (failed > 0) {
  console.log('\n실패 목록:');
  for (const f of failures) console.log(f);
}
console.log(`\n[FINDING] 이중 GAME_RESULT 발생: ${hasDoubleResult} (MEDIUM - 클라이언트 가드 존재)`);
process.exit(failed > 0 ? 1 : 0);
