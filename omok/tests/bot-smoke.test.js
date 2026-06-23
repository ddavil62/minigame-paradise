/**
 * @fileoverview 오목 봇 시나리오 smoke 테스트 — ad-hoc 노드 러너.
 *
 * 실행:
 *   node tests/bot-smoke.test.js
 *
 * 검증 시나리오 (OMOK-BOT-001~003):
 *   OMOK-BOT-001: mode=ai 진입 → 서버가 봇 자동 spawn → GAME_START 수신
 *   OMOK-BOT-002: 봇이 전체 게임 완주 → GAME_OVER 수신 (reason 'five' 또는 'draw')
 *   OMOK-BOT-003: 봇이 즉각 위협(사람 4목) 차단 착수 (완화된 검증)
 *   OMOK-BOT-004: 봇 대전 종료 후 사람 REMATCH → 봇 자동 동의 → 새 판 STATE 도착
 *
 * 작업 포트: 3106 (사용자 launcher 3000과 다른 게임 서버 무영향).
 */

import http from 'node:http';
import { WebSocket } from 'ws';
import { createApp } from '../server.js';
import { BOARD_SIZE } from '../game.js';

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

function idx(row, col) { return row * BOARD_SIZE + col; }

/** 단일 클라이언트 헬퍼. */
function makeClient(url) {
  const ws = new WebSocket(url);
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

// ── OMOK-BOT-001 & 002: 봇 spawn + 완주 ───────────────────────
section('OMOK-BOT-001~002: mode=ai → 봇 spawn → GAME_START → 완주 → GAME_OVER');

async function runBotScenario() {
  const PORT = 3106;
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

  // 사람 클라이언트 — mode=ai로 접속(흑/p1).
  const me = makeClient(`ws://127.0.0.1:${PORT}/ws?mode=ai`);
  await me.open();
  const joined = await me.waitFor('JOINED');
  assertEq(joined.playerId, 'p1', '사람이 p1 자리 점유');
  assertEq(joined.color, 'black', '사람 color = black (선공)');

  // READY 게이트(2026-06-22): 사람이 READY 송신(봇은 자동 READY). 양쪽 READY 시 GAME_START.
  me.send({ type: 'READY' });
  // 봇 spawn(200ms) + 연결 + JOINED + 봇 자동 READY 후 GAME_START.
  await me.waitFor('GAME_START', 15000);
  assertTrue(true, 'OMOK-BOT-001: GAME_START 수신 (봇 자동 spawn)');

  // 사람은 빠르게 이기는 전략: 가로 5목을 향해 둔다.
  // 봇이 차단해도 사람이든 봇이든 누군가 5목/무승부로 종료되면 통과.
  // 사람 턴마다 (0,k)에 두며 5목 시도 — 봇이 막으면 다른 열로.
  let lastState = await me.waitFor('STATE', 5000);

  // 사람 착수 좌표 선택: 0번째 행을 따라 가로로 두되, 이미 점유/봇 차단 칸은 건너뛴다.
  let humanCol = 0;
  const MAX_MOVES = 400; // 무한루프 방어 (최대 361칸).
  let movesPlayed = 0;
  let gameOver = null;

  // GAME_OVER 감시는 별도로 await 하되, 루프 안에서 STATE를 받아 사람 턴이면 둔다.
  while (movesPlayed < MAX_MOVES) {
    // 종료 체크: result가 채워졌으면 루프 탈출.
    if (lastState.phase === 'ended') break;

    if (lastState.currentTurn === 'black') {
      // 사람 턴 — 빈 칸을 찾아 둔다(0행 우선, 없으면 전체 스캔).
      let placed = false;
      for (let c = 0; c < BOARD_SIZE && !placed; c++) {
        if (lastState.board[idx(0, c)] === null) {
          me.send({ type: 'PLACE', row: 0, col: c });
          placed = true;
        }
      }
      if (!placed) {
        // 0행이 가득 → 전체에서 빈 칸 탐색.
        for (let i = 0; i < lastState.board.length && !placed; i++) {
          if (lastState.board[i] === null) {
            me.send({ type: 'PLACE', row: Math.floor(i / BOARD_SIZE), col: i % BOARD_SIZE });
            placed = true;
          }
        }
      }
      movesPlayed += 1;
      // 다음 STATE 대기.
      lastState = await me.waitFor('STATE', 10000);
    } else {
      // 봇 턴 — 봇이 둘 때까지 STATE 대기.
      lastState = await me.waitFor('STATE', 15000);
    }
  }

  // GAME_OVER 수신.
  gameOver = await me.waitFor('GAME_OVER', 15000);
  assertTrue(['black', 'white', 'draw'].includes(gameOver.winner), 'OMOK-BOT-002: GAME_OVER winner 유효');
  assertTrue(['five', 'draw'].includes(gameOver.reason), `OMOK-BOT-002: reason ∈ {five, draw} (실제=${gameOver.reason})`);

  await me.close();
  await new Promise((res) => server.close(res));
}

try {
  await runBotScenario();
} catch (err) {
  failed += 1;
  failures.push(`BOT-001/002 예외: ${err.message}\n${err.stack}`);
  console.log(`  FAIL  BOT-001/002 예외: ${err.message}`);
}

// ── OMOK-BOT-003: 봇이 즉각 위협(4목) 차단 ────────────────────
section('OMOK-BOT-003: 봇이 사람 4목 위협을 차단 착수 (완화된 검증)');

async function runBlockScenario() {
  const PORT = 3106;
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

  // 사람(흑/p1) + 봇(백/p2).
  const me = makeClient(`ws://127.0.0.1:${PORT}/ws?mode=ai`);
  await me.open();
  await me.waitFor('JOINED');
  me.send({ type: 'READY' }); // READY 게이트(2026-06-22).
  await me.waitFor('GAME_START', 15000);
  let st = await me.waitFor('STATE', 5000);

  // 사람은 9행을 따라 가로로 위협을 키운다.
  // 봇은 휴리스틱(수비 가중치 0.9 × CHAIN_WEIGHT)상 사람의 연속이 길어질수록
  // 그 라인을 차단해야 한다(open-three/four 위협). 봇이 선제 차단하더라도
  // "봇이 사람의 9행 클러스터에 인접해 차단 착수했다"를 검증한다.
  //
  // 절차: 사람 턴마다 9행에서 기존 흑 돌에 인접한 빈 칸을 골라 둔다(없으면 9,9부터).
  //       봇이 9행 또는 그 인접(8행/10행 + 9행 양끝)에서 차단했는지 누적 관찰.
  let botBlockedNear = false;
  let humanRunReached = 0;
  const HUMAN_PLAYS = 5;

  for (let turn = 0; turn < HUMAN_PLAYS; turn++) {
    // 사람 턴 대기.
    while (st.phase === 'playing' && st.currentTurn !== 'black') {
      st = await me.waitFor('STATE', 12000);
    }
    if (st.phase !== 'playing') break;

    // 9행에서 흑 클러스터에 인접한 빈 칸 탐색(좌→우). 없으면 첫 빈 칸.
    let target = null;
    const rowBase = 9 * BOARD_SIZE;
    // 기존 흑 돌 위치 수집.
    const blackCols = [];
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (st.board[rowBase + c] === 'black') blackCols.push(c);
    }
    if (blackCols.length === 0) {
      target = { row: 9, col: 9 };
    } else {
      // 클러스터 오른쪽 끝 +1 또는 왼쪽 끝 -1 중 빈 칸.
      const maxC = Math.max(...blackCols);
      const minC = Math.min(...blackCols);
      const candidates = [maxC + 1, minC - 1];
      for (const c of candidates) {
        if (c >= 0 && c < BOARD_SIZE && st.board[rowBase + c] === null) {
          target = { row: 9, col: c };
          break;
        }
      }
      // 양끝이 막혔으면(봇이 이미 차단) → 봇이 차단한 것이므로 통과 표시.
      if (!target) {
        botBlockedNear = true;
        break;
      }
    }

    me.send({ type: 'PLACE', row: target.row, col: target.col });
    st = await me.waitFor('STATE', 12000);
    // 현재 흑 연속 길이 갱신.
    const curBlackCols = [];
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (st.board[9 * BOARD_SIZE + c] === 'black') curBlackCols.push(c);
    }
    humanRunReached = curBlackCols.length;

    if (st.phase !== 'playing') break;

    // 봇 턴 → 봇 착수 관찰.
    if (st.currentTurn === 'white') {
      const beforeBot = st.board.slice();
      st = await me.waitFor('STATE', 15000);
      for (let k = 0; k < st.board.length; k++) {
        if (st.board[k] === 'white' && beforeBot[k] === null) {
          const r = Math.floor(k / BOARD_SIZE);
          const c = k % BOARD_SIZE;
          // 9행에 두었거나, 흑 클러스터 col 범위 ±1 안의 인접 차단이면 "근접 차단"으로 인정.
          if (r === 9 && curBlackCols.length > 0) {
            const minC = Math.min(...curBlackCols) - 1;
            const maxC = Math.max(...curBlackCols) + 1;
            if (c >= minC && c <= maxC) botBlockedNear = true;
          }
        }
      }
    }
  }

  assertTrue(humanRunReached >= 3, `사람이 3목 이상 형성(위협 발생, 실제 연속=${humanRunReached})`);
  assertTrue(botBlockedNear, '봇이 사람 가로 위협을 9행에서 인접 차단 착수');

  await me.close();
  await new Promise((res) => server.close(res));
}

try {
  await runBlockScenario();
} catch (err) {
  failed += 1;
  failures.push(`BOT-003 예외: ${err.message}\n${err.stack}`);
  console.log(`  FAIL  BOT-003 예외: ${err.message}`);
}

// ── OMOK-BOT-004: 봇 리매치 자동 동의 ─────────────────────────
section('OMOK-BOT-004: 봇 대전 종료 후 사람 REMATCH → 봇 자동 동의 → 새 판');

async function runBotRematchScenario() {
  const PORT = 3106;
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

  // 사람(흑/p1) — 빠르게 5목으로 이긴다(가로 9행). 봇이 막으면 다른 칸으로.
  const me = makeClient(`ws://127.0.0.1:${PORT}/ws?mode=ai`);
  await me.open();
  await me.waitFor('JOINED');
  me.send({ type: 'READY' }); // READY 게이트(2026-06-22).
  await me.waitFor('GAME_START', 15000);
  let st = await me.waitFor('STATE', 5000);

  // 첫 게임을 종료까지 진행(사람이 빈 칸을 순서대로 둠 — 승/패/무 무관, 종료만 시킴).
  let movesPlayed = 0;
  while (movesPlayed < 400 && st.phase === 'playing') {
    if (st.currentTurn === 'black') {
      let placed = false;
      // 가로 9행을 따라 5목 시도.
      for (let c = 0; c < BOARD_SIZE && !placed; c++) {
        if (st.board[idx(9, c)] === null) {
          me.send({ type: 'PLACE', row: 9, col: c });
          placed = true;
        }
      }
      if (!placed) {
        for (let i = 0; i < st.board.length && !placed; i++) {
          if (st.board[i] === null) {
            me.send({ type: 'PLACE', row: Math.floor(i / BOARD_SIZE), col: i % BOARD_SIZE });
            placed = true;
          }
        }
      }
      movesPlayed += 1;
      st = await me.waitFor('STATE', 12000);
    } else {
      st = await me.waitFor('STATE', 15000);
    }
  }
  const go = await me.waitFor('GAME_OVER', 15000);
  assertTrue(['black', 'white', 'draw'].includes(go.winner), '첫 게임 GAME_OVER 수신');

  // 사람이 REMATCH 전송 → 봇이 GAME_OVER 시 자동 REMATCH 송신했으므로 REMATCH_START 도착.
  me.send({ type: 'REMATCH' });
  const rs = await me.waitFor('REMATCH_START', 15000);
  assertTrue(rs.type === 'REMATCH_START', 'OMOK-BOT-004: 봇 자동 동의 → REMATCH_START 수신');
  assertTrue(rs.nextBlack === 'p1' || rs.nextBlack === 'p2', `nextBlack 유효(${rs.nextBlack})`);

  // 갱신 color JOINED 재전송.
  const j = await me.waitFor('JOINED', 5000);
  assertTrue(j.color === 'black' || j.color === 'white', 'OMOK-BOT-004: 사람 color 갱신');

  // READY 게이트(2026-06-22): 리매치도 사람 READY 필요(봇은 JOINED 후 자동 READY).
  me.send({ type: 'READY' });
  // 새 판 STATE 도착(빈 보드).
  await me.waitFor('GAME_START', 5000);
  const st2 = await me.waitFor('STATE', 5000);
  assertEq(st2.moveCount, 0, 'OMOK-BOT-004: 새 판 moveCount=0');
  assertTrue(st2.board.every((c) => c === null), 'OMOK-BOT-004: 새 판 빈 보드');

  // 봇이 종료하지 않고 계속 참여하는지: 봇이 흑이면 봇이, 사람이 흑이면 사람이 둔다.
  // 한 수만 진행해 새 판이 살아있음을 확인.
  if (st2.currentTurn === j.color) {
    // 사람 차례 → 한 수 둔다.
    me.send({ type: 'PLACE', row: 9, col: 9 });
  }
  const st3 = await me.waitFor('STATE', 15000);
  assertTrue(st3.moveCount >= 1, 'OMOK-BOT-004: 새 판에서 착수 반영(봇 계속 참여)');

  await me.close();
  await new Promise((res) => server.close(res));
}

try {
  await runBotRematchScenario();
} catch (err) {
  failed += 1;
  failures.push(`BOT-004 예외: ${err.message}\n${err.stack}`);
  console.log(`  FAIL  BOT-004 예외: ${err.message}`);
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
