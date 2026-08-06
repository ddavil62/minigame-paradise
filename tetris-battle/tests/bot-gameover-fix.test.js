/**
 * @fileoverview AI 대전 게임오버 미판정 및 아이템 미지급 버그 수정 회귀 테스트 슈트.
 *
 * 실행:
 *   node tests/bot-gameover-fix.test.js
 *
 * 검증 시나리오 (TBFIX-001~004):
 *   TBFIX-001: 봇 BOARD_STATE에 cells 22x10 배열이 포함됨
 *   TBFIX-002: 봇이 실제로 쌓였을 때 cells에 0이 아닌 값이 존재함
 *   TBFIX-003: 봇 WS 비정상 종료(ws.close) 시 사람이 GAME_RESULT를 수신
 *   TBFIX-004: 봇 토프아웃 -> GAME_RESULT 후 리매치 -> 사람 라인 클리어 -> 아이템 지급 정상
 *
 * 작업 포트: 3112 (bot-smoke 3110, ai-mode-e2e 3111과 격리).
 */

import http from 'node:http';
import { WebSocket } from 'ws';
import { createApp } from '../server.js';

const PORT = 3112;

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
 * 테스트 전용 서버를 생성한다. opts를 createApp에 머지한다.
 * @param {object} [extraOpts] createApp에 전달할 추가 옵션
 * @returns {Promise<http.Server>}
 */
async function startServer(extraOpts = {}) {
  const app = createApp({
    hostUrl: '',
    getBotUrl: (roomId) => `ws://localhost:${PORT}/ws?mode=bot&room=${roomId}`,
    heartbeatIntervalMs: 0, // 테스트에서 하트비트 비활성화 (hang 방지)
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

/**
 * 단일 WS 클라이언트 헬퍼 (bot-smoke 패턴).
 * @param {string} [query] URL 쿼리 문자열
 * @returns {{ ws: WebSocket, open: Function, close: Function, send: Function, waitFor: Function }}
 */
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
  return {
    ws,
    open: () => new Promise((res) => ws.once('open', res)),
    close: () => new Promise((res) => { ws.once('close', res); ws.close(); }),
    send: (msg) => ws.send(JSON.stringify(msg)),
    waitFor,
  };
}

// ── TBFIX-001: 봇 BOARD_STATE에 cells 22x10 배열이 포함됨 ──────
section('TBFIX-001: 봇 BOARD_STATE에 cells 22x10 배열이 포함됨');

async function runCellsPresenceTest() {
  const server = await startServer();

  const me = makeClient('?mode=ai');
  await me.open();
  me.send({ type: 'JOIN', playerName: 'TestUser' });
  await me.waitFor('JOINED');
  me.send({ type: 'READY' });
  await me.waitFor('START', 15000);

  // 봇이 피스 배치 후 BOARD_STATE를 보내면 서버가 OPPONENT_BOARD로 중계한다.
  const opp = await me.waitFor('OPPONENT_BOARD', 30000);

  // cells 존재 및 22x10 형태 검증
  assertTrue(Array.isArray(opp.cells), 'TBFIX-001: cells가 배열');
  assertEq(opp.cells.length, 22, 'TBFIX-001: cells 행 수 = 22');

  // 각 행이 10열이고 값이 0~8 범위인지 검증
  let allRowsValid = true;
  for (let r = 0; r < opp.cells.length; r++) {
    const row = opp.cells[r];
    if (!Array.isArray(row) || row.length !== 10) {
      allRowsValid = false;
      break;
    }
    for (const v of row) {
      if (!Number.isInteger(v) || v < 0 || v > 8) {
        allRowsValid = false;
        break;
      }
    }
  }
  assertTrue(allRowsValid, 'TBFIX-001: 모든 행이 10열이고 값 0~8 범위');

  await me.close();
  await new Promise((res) => server.close(res));
}

try {
  await runCellsPresenceTest();
} catch (err) {
  failed += 1;
  failures.push(`TBFIX-001 예외: ${err.message}\n${err.stack}`);
  console.log(`  FAIL  TBFIX-001 예외: ${err.message}`);
}

// ── TBFIX-002: 봇이 실제로 쌓였을 때 cells에 0이 아닌 값이 존재함 ──
section('TBFIX-002: 봇이 쌓았을 때 cells에 0이 아닌 값 존재');

async function runCellsNonZeroTest() {
  const server = await startServer();

  const me = makeClient('?mode=ai');
  await me.open();
  me.send({ type: 'JOIN', playerName: 'TestUser' });
  await me.waitFor('JOINED');
  me.send({ type: 'READY' });
  await me.waitFor('START', 15000);

  // 봇이 여러 피스를 쌓을 때까지 OPPONENT_BOARD를 반복 수신한다.
  let foundNonZero = false;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const opp = await me.waitFor('OPPONENT_BOARD', 30000);
    if (Array.isArray(opp.cells) && opp.cells.length === 22) {
      for (const row of opp.cells) {
        if (Array.isArray(row) && row.some((v) => v > 0)) {
          foundNonZero = true;
          break;
        }
      }
    }
    if (foundNonZero) break;
  }

  assertTrue(foundNonZero, 'TBFIX-002: cells에 0보다 큰 값이 1개 이상 존재 (봇 보드 렌더링 가능)');

  await me.close();
  await new Promise((res) => server.close(res));
}

try {
  await runCellsNonZeroTest();
} catch (err) {
  failed += 1;
  failures.push(`TBFIX-002 예외: ${err.message}\n${err.stack}`);
  console.log(`  FAIL  TBFIX-002 예외: ${err.message}`);
}

// ── TBFIX-003: 봇 WS 비정상 종료 시 사람이 GAME_RESULT를 수신 ──────
section('TBFIX-003: 봇 WS close(gameOver 미전송) 시 사람이 GAME_RESULT 수신');

async function runBotCloseGameOverTest() {
  // 실제 봇 프로세스 대신 두 번째 WS 클라이언트(mode=bot)가 봇 역할을 흉내.
  // getBotUrl을 null 반환으로 설정해 실제 봇 spawn을 방지한다.
  const server = await startServer({
    getBotUrl: () => null,
  });

  // 사람 클라이언트 (mode=human, room 파라미터 없음 → 자동 룸 생성)
  const human = makeClient('?mode=human');
  await human.open();
  human.send({ type: 'JOIN', playerName: 'Human' });
  const joined = await human.waitFor('JOINED');
  const roomId = joined.roomId;

  // 봇 역할 클라이언트 (mode=bot, 같은 룸에 입장)
  const bot = makeClient(`?mode=bot&room=${roomId}`);
  await bot.open();
  bot.send({ type: 'JOIN', playerName: 'FakeBot' });
  await bot.waitFor('JOINED');

  // 양쪽 READY → START
  human.send({ type: 'READY' });
  bot.send({ type: 'READY' });
  await human.waitFor('START', 10000);

  // 게임 진행 중임을 확인하기 위해 잠시 대기
  await new Promise((res) => setTimeout(res, 200));

  // 봇이 GAME_OVER를 전송하지 않고 WS를 닫는다 (비정상 종료 시뮬레이션)
  await bot.close();

  // 사람이 GAME_RESULT를 수신해야 한다 (서버 close 핸들러가 직접 처리)
  const result = await human.waitFor('GAME_RESULT', 10000);
  assertEq(result.winner, joined.playerId, 'TBFIX-003: 사람이 승리자 (봇 WS close → 서버 직접 gameOver)');
  assertEq(result.reason, 'topout', 'TBFIX-003: reason=topout');

  await human.close();
  await new Promise((res) => server.close(res));
}

try {
  await runBotCloseGameOverTest();
} catch (err) {
  failed += 1;
  failures.push(`TBFIX-003 예외: ${err.message}\n${err.stack}`);
  console.log(`  FAIL  TBFIX-003 예외: ${err.message}`);
}

// ── TBFIX-004: 리매치 후 아이템 지급 정상 동작 ──────────────────
section('TBFIX-004: 봇 토프아웃 → GAME_RESULT → 리매치 → 아이템 지급 정상');

async function runRematchItemGrantTest() {
  // random: () => 0 → 항상 당첨 (isWinningItemGrantRoll(0) === true)
  const server = await startServer({
    getBotUrl: () => null,
    random: () => 0,
  });

  // 사람 클라이언트
  const human = makeClient('?mode=human');
  await human.open();
  human.send({ type: 'JOIN', playerName: 'Human' });
  const joined = await human.waitFor('JOINED');
  const roomId = joined.roomId;

  // 봇 역할 클라이언트
  const bot = makeClient(`?mode=bot&room=${roomId}`);
  await bot.open();
  bot.send({ type: 'JOIN', playerName: 'FakeBot' });
  await bot.waitFor('JOINED');

  // 양쪽 READY → START
  human.send({ type: 'READY' });
  bot.send({ type: 'READY' });
  await human.waitFor('START', 10000);

  // 봇이 GAME_OVER 없이 ws.close → 서버가 직접 gameOver 처리
  await bot.close();
  await human.waitFor('GAME_RESULT', 10000);

  // 새 봇으로 리매치
  const bot2 = makeClient(`?mode=bot&room=${roomId}`);
  await bot2.open();
  bot2.send({ type: 'JOIN', playerName: 'FakeBot2' });
  await bot2.waitFor('JOINED');

  // 양쪽 REMATCH → START
  human.send({ type: 'REMATCH' });
  bot2.send({ type: 'REMATCH' });
  await human.waitFor('START', 10000);

  // 사람이 GARBAGE_SEND(clearEventId=1)를 전송 → 서버가 아이템 지급
  human.send({ type: 'GARBAGE_SEND', lines: 1, combo: 0, clearEventId: 1 });

  // ITEM_GRANT를 수신해야 한다 (random() => 0이므로 항상 당첨)
  const grant = await human.waitFor('ITEM_GRANT', 10000);
  assertTrue(grant !== undefined, 'TBFIX-004: 리매치 후 ITEM_GRANT 수신');
  assertTrue(typeof grant.itemId === 'string', 'TBFIX-004: ITEM_GRANT에 itemId 존재');
  assertEq(grant.slotIndex, 0, 'TBFIX-004: 첫 빈 슬롯(0)에 지급');

  await bot2.close();
  await human.close();
  await new Promise((res) => server.close(res));
}

try {
  await runRematchItemGrantTest();
} catch (err) {
  failed += 1;
  failures.push(`TBFIX-004 예외: ${err.message}\n${err.stack}`);
  console.log(`  FAIL  TBFIX-004 예외: ${err.message}`);
}

// ── 요약 ────────────────────────────────────────────────────
console.log('\n────────────────────────────────────────');
console.log(`총 ${passed + failed}건, PASS=${passed}, FAIL=${failed}`);
if (failed > 0) {
  console.log('\n실패 목록:');
  for (const f of failures) console.log(f);
  process.exit(1);
} else {
  console.log('모든 봇 게임오버 수정 테스트 통과.');
  process.exit(0);
}
