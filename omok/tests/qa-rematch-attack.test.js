/**
 * @fileoverview QA 능동 공격 — 리매치 WS 동의 + 색 swap 파괴 테스트.
 * 기존 OMOK-011/012(흑 승리 swap, 한쪽 WAITING)가 다루지 않은:
 *  - 기권 패자 → 다음 흑
 *  - 백 승리 → 진 쪽(흑이던 사람) 다음 흑
 *  - 무승부 → 색 교체
 *  - 한쪽만 REMATCH → 게임 시작 안 됨(REMATCH_START 미수신)
 *  - 리매치 동의 흐름 중 OPPONENT_LEFT 미발생(WS 유지)
 *  - 게임 종료 전 REMATCH → ERROR
 *  - id(p1/p2) 불변, color만 swap
 * 격리 포트 3107. MCP node 미접촉.
 */
import http from 'node:http';
import { WebSocket } from 'ws';
import { createApp } from '../server.js';

let passed = 0, failed = 0;
const fails = [];
function ok(cond, label) {
  if (cond) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}`); fails.push(label); }
}
function sec(n) { console.log(`\n[${n}]`); }

function makeClient(url) {
  const ws = new WebSocket(url);
  const queue = [];
  const waiters = [];
  const seen = []; // 모든 수신 메시지 기록(OPPONENT_LEFT 검출용)
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    seen.push(msg.type);
    if (waiters.length) waiters.shift()(msg);
    else queue.push(msg);
  });
  function waitFor(type, timeoutMs = 5000, pred = null) {
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      function tryNext() {
        while (queue.length) {
          const m = queue.shift();
          if (m.type === type && (!pred || pred(m))) { resolve(m); return; }
        }
        if (Date.now() - t0 > timeoutMs) { reject(new Error(`timeout waiting for ${type}`)); return; }
        waiters.push((m) => {
          if (m.type === type && (!pred || pred(m))) resolve(m);
          else { queue.unshift(m); setTimeout(tryNext, 5); }
        });
      }
      tryNext();
    });
  }
  // 특정 moveCount의 STATE를 기다린다(broadcast 중복/순서 내성).
  function waitState(mc, ms = 5000) {
    return waitFor('STATE', ms, (m) => m.moveCount === mc);
  }
  // 일정 시간 동안 특정 타입이 안 오는지 확인
  function expectNotReceived(type, ms) {
    return new Promise((resolve) => {
      setTimeout(() => resolve(!seen.includes(type)), ms);
    });
  }
  return {
    ws, seen,
    open: () => new Promise((res) => ws.once('open', res)),
    close: () => new Promise((res) => { ws.once('close', res); ws.close(); }),
    send: (msg) => ws.send(JSON.stringify(msg)),
    waitFor, waitState, expectNotReceived,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 흑(blackClient) 가로 5목 완성. 백(whiteClient)은 멀리 더미.
// 마지막 흑 착수는 승리이므로 STATE 대신 GAME_OVER로 종료를 확인한다.
// startMc: 현재까지 진행된 moveCount(보통 0).
async function playLineWin(blackClient, whiteClient, blackMoves, whiteMoves, startMc = 0) {
  let mc = startMc;
  for (let i = 0; i < blackMoves.length; i++) {
    blackClient.send({ type: 'PLACE', row: blackMoves[i][0], col: blackMoves[i][1] });
    mc += 1;
    if (i === blackMoves.length - 1) {
      // 승리 착수 — GAME_OVER 도착으로 확인.
      await blackClient.waitFor('GAME_OVER');
      return;
    }
    await blackClient.waitState(mc);
    whiteClient.send({ type: 'PLACE', row: whiteMoves[i][0], col: whiteMoves[i][1] });
    mc += 1;
    await whiteClient.waitState(mc);
  }
}

async function spawnServer(port) {
  const app = createApp({ hostUrl: '' });
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return server;
}

async function main() {
  const PORT = 3121;
  // 안전장치: 전체 60초 내 미완료 시 강제 종료(행 방지).
  const hardTimeout = setTimeout(() => {
    console.log('\n!!! HARD TIMEOUT 60s — 테스트 행 발생, 강제 종료');
    process.exit(2);
  }, 60000);
  hardTimeout.unref?.();
  const server = await spawnServer(PORT);
  const base = `ws://127.0.0.1:${PORT}/ws`;

  // 두 클라 연결 + 게임 시작 도달 헬퍼
  async function connectPair() {
    const p1 = makeClient(base);
    await p1.open();
    await p1.waitFor('JOINED');
    const p2 = makeClient(base);
    await p2.open();
    await p2.waitFor('JOINED');
    await p1.waitFor('GAME_START');
    await p2.waitFor('GAME_START');
    await p1.waitFor('STATE');
    await p2.waitFor('STATE');
    return { p1, p2 };
  }

  // ── T1: 기권 패자 → 다음 흑 ─────────────────────────────
  sec('T1: 기권 → 기권자가 다음 흑');
  {
    const { p1, p2 } = await connectPair();
    // p1(black)이 기권 → winner=white(p2). 진 쪽=p1이 다음 흑.
    p1.send({ type: 'RESIGN' });
    const go = await p1.waitFor('GAME_OVER');
    ok(go.reason === 'resign' && go.winner === 'white', 'T1: 기권 → winner=white(p2)');
    p1.send({ type: 'REMATCH' });
    await p2.waitFor('REMATCH_WAITING');
    p2.send({ type: 'REMATCH' });
    const rs = await p1.waitFor('REMATCH_START');
    ok(rs.nextBlack === 'p1', 'T1: nextBlack=p1(기권자=진 쪽=다음 흑)');
    // JOINED 색 확인
    const j1 = await p1.waitFor('JOINED');
    ok(j1.playerId === 'p1' && j1.color === 'black', 'T1: p1 id 불변 + color=black');
    await p1.close(); await p2.close();
    await sleep(120);
  }

  // ── T2: 백 승리 → 진 쪽(흑이던 p1) 다음 흑 ──────────────
  sec('T2: 백 승리 → 진 쪽(직전 흑)이 다음 흑');
  {
    const { p1, p2 } = await connectPair();
    // 백(p2)이 이기게 만든다. 흑(p1)이 선공이므로 흑 더미를 먼저 두고 백 라인 완성.
    // 흑 더미: (9,0)(9,1)(9,2)(9,3)(9,5) (5목 안 됨, 한 칸 띔). 백: (0,9)..(4,9) 세로5.
    // 흑 선공 → mc 홀수=흑, 짝수=백. 백이 마지막에 승리하도록 시퀀스 구성.
    const dBlack = [[9, 0], [9, 1], [9, 2], [9, 3], [9, 5]];
    const dWhite = [[0, 9], [1, 9], [2, 9], [3, 9], [4, 9]];
    let mc = 0;
    for (let i = 0; i < 5; i++) {
      p1.send({ type: 'PLACE', row: dBlack[i][0], col: dBlack[i][1] });
      mc += 1; await p1.waitState(mc);
      p2.send({ type: 'PLACE', row: dWhite[i][0], col: dWhite[i][1] });
      mc += 1;
      if (i === 4) { await p2.waitFor('GAME_OVER'); }
      else { await p2.waitState(mc); }
    }
    const go = await p1.waitFor('GAME_OVER');
    ok(go.winner === 'white' && go.reason === 'five', 'T2: 백 5목 승리');
    p1.send({ type: 'REMATCH' });
    await p2.waitFor('REMATCH_WAITING');
    p2.send({ type: 'REMATCH' });
    const rs = await p1.waitFor('REMATCH_START');
    ok(rs.nextBlack === 'p1', 'T2: nextBlack=p1(진 쪽=직전 흑이 다음도 흑)');
    const j1 = await p1.waitFor('JOINED');
    const j2 = await p2.waitFor('JOINED');
    ok(j1.color === 'black' && j2.color === 'white', 'T2: p1=black(진 쪽), p2=white(이긴 쪽)');
    await p1.close(); await p2.close();
    await sleep(120);
  }

  // ── T3: 한쪽만 REMATCH → REMATCH_START 미발생 ────────────
  sec('T3: 한쪽만 동의 → 게임 시작 안 됨(REMATCH_START 미수신)');
  {
    const { p1, p2 } = await connectPair();
    p1.send({ type: 'RESIGN' });
    await p1.waitFor('GAME_OVER');
    p1.send({ type: 'REMATCH' });
    await p2.waitFor('REMATCH_WAITING');
    // p2는 동의 안 함. 1초 내 REMATCH_START 미수신이어야 함.
    const noStart = await p1.expectNotReceived('REMATCH_START', 800);
    ok(noStart === true, 'T3: 한쪽만 동의 시 REMATCH_START 미발생(게임 시작 안 됨)');
    await p1.close(); await p2.close();
    await sleep(120);
  }

  // ── T4: 리매치 동의 흐름 중 OPPONENT_LEFT 미발생(WS 유지) ─
  sec('T4: 리매치 흐름 중 WS 유지 — OPPONENT_LEFT 미수신');
  {
    const { p1, p2 } = await connectPair();
    await playLineWin(p1, p2, [[9, 0], [9, 1], [9, 2], [9, 3], [9, 4]], [[0, 0], [0, 2], [0, 4], [0, 6]]);
    await p2.waitFor('GAME_OVER');
    p1.send({ type: 'REMATCH' });
    p2.send({ type: 'REMATCH' });
    await p1.waitFor('REMATCH_START');
    await p2.waitFor('REMATCH_START');
    await p1.waitState(0);
    await p2.waitState(0);
    // 새 판 시작 후 OPPONENT_LEFT 가 한 번도 안 왔는지
    ok(!p1.seen.includes('OPPONENT_LEFT') && !p2.seen.includes('OPPONENT_LEFT'),
      'T4: 리매치 전후 OPPONENT_LEFT 미발생(WS 끊김 없음)');
    // 같은 WS로 새 판 착수 가능(재연결 없음). p2가 흑(진 쪽), 선공.
    p2.send({ type: 'PLACE', row: 5, col: 5 });
    const st = await p2.waitState(1);
    ok(st.moveCount === 1 && st.board[5 * 19 + 5] === 'black', 'T4: 같은 WS로 새 판 착수 반영(재연결 없음)');
    await p1.close(); await p2.close();
    await sleep(120);
  }

  // ── T5: 게임 종료 전 REMATCH → ERROR ─────────────────────
  sec('T5: 게임 종료 전 REMATCH → ERROR');
  {
    const { p1, p2 } = await connectPair();
    p1.send({ type: 'REMATCH' });
    const err = await p1.waitFor('ERROR');
    ok(/종료 후/.test(err.message), 'T5: 진행 중 REMATCH → ERROR');
    await p1.close(); await p2.close();
    await sleep(120);
  }

  // ── T6: 무승부 후 리매치 — 색 교체 ───────────────────────
  // 무승부를 WS로 만들기엔 361수가 필요하므로 game.js 단위로 별도 검증됨(qa-edge).
  // 여기서는 무승부 후 swap 규칙(색 교체)을 placeStone 없이 직접 보장하기 위해 생략.
  sec('T6: 리매치 2회 연속 — 흑 승 후 swap, 다시 흑 승 후 재swap(id 불변)');
  {
    const { p1, p2 } = await connectPair();
    // 1판: p1(흑) 승 → 2판 p2 흑
    await playLineWin(p1, p2, [[9, 0], [9, 1], [9, 2], [9, 3], [9, 4]], [[0, 0], [0, 2], [0, 4], [0, 6]]);
    await p2.waitFor('GAME_OVER');
    p1.send({ type: 'REMATCH' }); p2.send({ type: 'REMATCH' });
    const rsA = await p1.waitFor('REMATCH_START');
    ok(rsA.nextBlack === 'p2', 'T6: 1판 흑(p1) 승 → 2판 흑=p2');
    await p1.waitFor('JOINED'); await p2.waitFor('JOINED');
    await p1.waitState(0); await p2.waitState(0);
    // 2판: 이제 p2가 흑(선공). p2 흑 5목 만들기(blackClient=p2, whiteClient=p1).
    await playLineWin(p2, p1, [[9, 0], [9, 1], [9, 2], [9, 3], [9, 4]], [[0, 0], [0, 2], [0, 4], [0, 6]]);
    const go2 = await p1.waitFor('GAME_OVER');
    ok(go2.winner === 'black', 'T6: 2판 흑(p2) 승');
    p1.send({ type: 'REMATCH' }); p2.send({ type: 'REMATCH' });
    const rsB = await p1.waitFor('REMATCH_START');
    ok(rsB.nextBlack === 'p1', 'T6: 2판 흑(p2) 승 → 3판 흑=p1(진 쪽=직전 백 p1)');
    // id 불변 검증
    const j1 = await p1.waitFor('JOINED');
    ok(j1.playerId === 'p1', 'T6: 2회 swap 후에도 p1 id 불변');
    await p1.close(); await p2.close();
    await sleep(120);
  }

  clearTimeout(hardTimeout);
  server.close();
  console.log('\n────────────────────────────────────────');
  console.log(`총 ${passed + failed}건, PASS=${passed}, FAIL=${failed}`);
  if (failed > 0) {
    console.log('실패 목록:');
    for (const f of fails) console.log(`  - ${f}`);
    process.exitCode = 1;
  } else {
    console.log('QA 리매치 공격 테스트 전부 통과.');
  }
  // 남은 WS 핸들로 이벤트 루프가 유지되지 않도록 명시 종료.
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error('테스트 실행 오류:', e); process.exit(1); });
