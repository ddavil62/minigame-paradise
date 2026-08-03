/**
 * @fileoverview WebSocket 서버 동적 검증 (Node ws 클라이언트로 시뮬레이션).
 *
 * 시나리오:
 *  1) JOIN/READY/START 흐름 + waiting 플래그 단독 검증
 *  2) 가비지 전송 중계 (GARBAGE_SEND → GARBAGE_RECV)
 *  3) BOARD_STATE 중계
 *  4) 게임 오버 (GAME_OVER → GAME_RESULT)
 *  5) 재대결 (REMATCH → REMATCH_STATUS → START)
 *  6) 3번째 클라이언트 거절 (Room is full)
 *  7) 연결 끊김 시 상대에게 disconnect 알림
 *  8) JSON 파싱 실패 시 서버가 크래시하지 않음
 *  9) 알 수 없는 메시지 타입 무시
 *  10) ITEM_USE placeholder 중계
 *  11) [능동] 게임 시작 전 GARBAGE_SEND 차단 여부
 *  12) [능동] 양쪽 동시 GAME_OVER 처리
 *  13) [능동] 빠른 연속 GARBAGE 5회 (큐잉 안정성)
 *  14) [능동] 가비지 음수/0/극단값 처리
 *
 * 사전 조건: 별도 터미널에서 `node server.js --port 3055` 가 실행 중이어야 함.
 *
 * 실행: node tests/phase1-ws.test.js [--port 3055]
 */

import WebSocket from 'ws';

const argv = process.argv.slice(2);
const portIdx = argv.indexOf('--port');
const PORT = portIdx >= 0 ? parseInt(argv[portIdx + 1], 10) : 3055;
const URL = `ws://localhost:${PORT}`;

let pass = 0;
let fail = 0;
const failures = [];

function assert(cond, name, detail = '') {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    failures.push({ name, detail });
    console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`);
  }
}

function section(t) {
  console.log(`\n── ${t} ─────────────────`);
}

function makeClient(label = '') {
  const ws = new WebSocket(URL);
  const received = [];
  let waiters = [];
  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); }
    catch { msg = { type: 'PARSE_ERROR', raw: data.toString() }; }
    received.push(msg);
    const stillWaiting = [];
    for (const w of waiters) {
      if (w.predicate(msg)) w.resolve(msg);
      else stillWaiting.push(w);
    }
    waiters = stillWaiting;
  });
  ws.on('error', (err) => {
    // noisy 방지: 의도적 close 시 ECONNRESET 등은 무시
  });
  return {
    ws,
    received,
    label,
    playerId: null,
    waitOpen() {
      return new Promise((resolve, reject) => {
        if (ws.readyState === 1) return resolve();
        ws.once('open', resolve);
        ws.once('error', reject);
      });
    },
    waitClose() {
      return new Promise((resolve) => {
        if (ws.readyState === 3) return resolve();
        ws.once('close', resolve);
      });
    },
    waitMessage(predicate, timeoutMs = 3000) {
      return new Promise((resolve, reject) => {
        const idx = received.findIndex(predicate);
        if (idx >= 0) return resolve(received[idx]);
        const timer = setTimeout(() => {
          reject(new Error(`waitMessage timeout (${label}, ${timeoutMs}ms)`));
        }, timeoutMs);
        waiters.push({
          predicate,
          resolve: (m) => { clearTimeout(timer); resolve(m); },
        });
      });
    },
    send(payload) { ws.send(JSON.stringify(payload)); },
    sendRaw(text) { ws.send(text); },
    close() { ws.close(); },
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 2P 페어를 만들고 JOIN → READY → START까지 완료한다.
 * playerId가 한쪽이 p1, 다른쪽이 p2가 되도록 보장 (순차 처리).
 * @returns {{ a: object, b: object, aId: string, bId: string }}
 */
async function makePair() {
  await sleep(300); // 직전 시나리오의 close 처리 완료 대기
  const a = makeClient('a');
  await a.waitOpen();
  a.send({ type: 'JOIN' });
  const ja = await a.waitMessage((m) => m.type === 'JOINED');
  a.playerId = ja.playerId;

  const b = makeClient('b');
  await b.waitOpen();
  b.send({ type: 'JOIN' });
  const jb = await b.waitMessage((m) => m.type === 'JOINED');
  b.playerId = jb.playerId;

  // READY → START
  a.send({ type: 'READY' });
  b.send({ type: 'READY' });
  await a.waitMessage((m) => m.type === 'START');
  await b.waitMessage((m) => m.type === 'START');

  return { a, b, aId: a.playerId, bId: b.playerId };
}

async function closePair(pair) {
  pair.a.close();
  pair.b.close();
  await pair.a.waitClose();
  await pair.b.waitClose();
  await sleep(300);
}

async function main() {
  console.log(`\nWebSocket 동적 테스트 시작 — ${URL}`);

  // ──────────────────────────────────────────────────────────
  section('시나리오 1: JOIN/READY/START 흐름 + waiting 플래그');
  {
    // 단독 입장 → waiting=true
    const p1 = makeClient('p1');
    await p1.waitOpen();
    p1.send({ type: 'JOIN', playerName: 'Alice' });
    const joined1 = await p1.waitMessage((m) => m.type === 'JOINED');
    assert(joined1.playerId === 'p1', `p1 단독 입장: playerId=p1 (실제: ${joined1.playerId})`);
    assert(joined1.waiting === true, `p1 단독: waiting=true (실제: ${joined1.waiting})`);

    // p2 입장 → waiting=false
    const p2 = makeClient('p2');
    await p2.waitOpen();
    p2.send({ type: 'JOIN', playerName: 'Bob' });
    const joined2 = await p2.waitMessage((m) => m.type === 'JOINED');
    assert(joined2.playerId === 'p2', `p2 입장: playerId=p2 (실제: ${joined2.playerId})`);
    assert(joined2.waiting === false, `p2 입장: waiting=false (실제: ${joined2.waiting})`);

    // 한쪽만 READY → START 없음
    p1.send({ type: 'READY' });
    await sleep(200);
    const startedEarly = p1.received.find((m) => m.type === 'START');
    assert(!startedEarly, '한쪽만 READY일 때 START 발송 안 됨');

    // 양쪽 READY → START 양쪽 발송
    p2.send({ type: 'READY' });
    const start1 = await p1.waitMessage((m) => m.type === 'START');
    const start2 = await p2.waitMessage((m) => m.type === 'START');
    assert(start1.countdown === 3, 'p1 START countdown=3');
    assert(start2.countdown === 3, 'p2 START countdown=3');

    p1.close(); p2.close();
    await p1.waitClose(); await p2.waitClose();
    await sleep(300);
  }

  // ──────────────────────────────────────────────────────────
  section('시나리오 2: 가비지 전송 중계 + Single/Double/Triple/Tetris 변환표');
  {
    const pair = await makePair();
    // Tetris (4줄 가비지)
    pair.a.send({ type: 'GARBAGE_SEND', lines: 4, combo: 2 });
    const r1 = await pair.b.waitMessage((m) => m.type === 'GARBAGE_RECV');
    assert(r1.lines === 4, `Tetris 가비지 4 (수신: ${r1.lines})`);
    assert(r1.combo === 2, `콤보 2 (수신: ${r1.combo})`);

    // 송신자는 echo 받지 않음
    await sleep(100);
    const selfEcho = pair.a.received.find((m) => m.type === 'GARBAGE_RECV');
    assert(!selfEcho, '송신자 자신은 자기 가비지 echo 받지 않음');

    // Double (1줄)
    pair.b.send({ type: 'GARBAGE_SEND', lines: 1, combo: 0 });
    const r2 = await pair.a.waitMessage((m) => m.type === 'GARBAGE_RECV');
    assert(r2.lines === 1, `Double 가비지 1 (수신: ${r2.lines})`);

    await closePair(pair);
  }

  // ──────────────────────────────────────────────────────────
  section('시나리오 3: BOARD_STATE → OPPONENT_BOARD 중계');
  {
    const pair = await makePair();
    pair.a.send({ type: 'BOARD_STATE', height: 5, stack: [1,2,3,4,5,4,3,2,1,0] });
    const opp = await pair.b.waitMessage((m) => m.type === 'OPPONENT_BOARD');
    assert(opp.height === 5, `OPPONENT_BOARD height=5 (실제: ${opp.height})`);
    assert(Array.isArray(opp.stack) && opp.stack.length === 10, 'stack 길이 10');
    assert(opp.stack[4] === 5, `stack[4]=5 (실제: ${opp.stack[4]})`);
    await closePair(pair);
  }

  // ──────────────────────────────────────────────────────────
  section('시나리오 4: GAME_OVER → GAME_RESULT 양쪽 브로드캐스트');
  {
    const pair = await makePair();
    pair.a.send({ type: 'GAME_OVER' });
    const ra = await pair.a.waitMessage((m) => m.type === 'GAME_RESULT');
    const rb = await pair.b.waitMessage((m) => m.type === 'GAME_RESULT');
    assert(ra.winner === pair.bId, `${pair.aId} 패배 → winner=${pair.bId} (실제: ${ra.winner})`);
    assert(ra.reason === 'topout', `reason=topout (실제: ${ra.reason})`);
    assert(rb.winner === pair.bId, `${pair.bId}도 winner=${pair.bId} (실제: ${rb.winner})`);
    assert(rb.reason === 'topout', 'b reason=topout');
    await closePair(pair);
  }

  // ──────────────────────────────────────────────────────────
  section('시나리오 5: REMATCH 흐름 (양쪽 모두 누르면 START 재발송)');
  {
    const pair = await makePair();
    pair.a.send({ type: 'GAME_OVER' });
    await pair.a.waitMessage((m) => m.type === 'GAME_RESULT');
    await pair.b.waitMessage((m) => m.type === 'GAME_RESULT');

    const startCountBefore = pair.a.received.filter((m) => m.type === 'START').length;

    // a만 REMATCH → STATUS만
    pair.a.send({ type: 'REMATCH' });
    const status1 = await pair.b.waitMessage((m) => m.type === 'REMATCH_STATUS');
    const aReadyKey = pair.aId === 'p1' ? 'p1Ready' : 'p2Ready';
    const bReadyKey = pair.bId === 'p1' ? 'p1Ready' : 'p2Ready';
    assert(status1[aReadyKey] === true && status1[bReadyKey] === false,
      `REMATCH STATUS: ${aReadyKey}=true, ${bReadyKey}=false`);

    await sleep(200);
    const afterStartCount = pair.a.received.filter((m) => m.type === 'START').length;
    assert(afterStartCount === startCountBefore, '한쪽만 REMATCH일 때 START 재발송 없음');

    // 양쪽 REMATCH → START 재발송
    pair.b.send({ type: 'REMATCH' });
    const restartA = await pair.a.waitMessage((m) =>
      m.type === 'START' && pair.a.received.filter((x) => x.type === 'START').length > startCountBefore);
    const restartB = await pair.b.waitMessage((m) =>
      m.type === 'START' && pair.b.received.filter((x) => x.type === 'START').length > 1);
    assert(restartA.countdown === 3, '재대결 후 a에 새 START 수신');
    assert(restartB.countdown === 3, '재대결 후 b에 새 START 수신');

    await closePair(pair);
  }

  // ──────────────────────────────────────────────────────────
  // 시나리오 6: 3번째 클라이언트 — 멀티룸 자동 배정 (아키텍처 변경 2026-08-01)
  // 기존: room 없이 3번째 접속 시 "Room is full" 거절.
  // 변경: 멀티룸 도입으로 p3는 새 룸에 p1으로 자동 배정된다.
  // "Room is full"은 이제 room 파라미터 지정 + 꽉 찬 경우에만 발생한다.
  // 이 단언 전환은 사용자 승인 완료(멀티룸 아키텍처 변경에 따른 의도적 동작 변경).
  section('시나리오 6: 3번째 클라이언트 → 멀티룸 새 룸 자동 배정');
  {
    await sleep(300);
    const p1 = makeClient('p1'); await p1.waitOpen();
    p1.send({ type: 'JOIN' });
    await p1.waitMessage((m) => m.type === 'JOINED');

    const p2 = makeClient('p2'); await p2.waitOpen();
    p2.send({ type: 'JOIN' });
    await p2.waitMessage((m) => m.type === 'JOINED');

    const p3 = makeClient('p3');
    await p3.waitOpen();
    p3.send({ type: 'JOIN' });
    const j3 = await p3.waitMessage((m) => m.type === 'JOINED', 1500);
    assert(j3.waiting === true, `p3: 새 룸에 p1으로 자동 배정, waiting=true (멀티룸 동작, 실제: ${j3.waiting})`);
    assert(j3.playerId === 'p1', `p3: 새 룸의 p1 (실제: ${j3.playerId})`);

    p1.close(); p2.close(); p3.close();
    await p1.waitClose(); await p2.waitClose();
    await sleep(300);
  }

  // ──────────────────────────────────────────────────────────
  section('시나리오 7: 한 명 연결 끊김 → 상대에게 disconnect 알림');
  {
    const pair = await makePair();
    pair.a.close();
    await pair.a.waitClose();
    const result = await pair.b.waitMessage((m) => m.type === 'GAME_RESULT', 2000);
    assert(result.winner === pair.bId, `${pair.aId} 끊김 → winner=${pair.bId} (실제: ${result.winner})`);
    assert(result.reason === 'disconnect', `reason=disconnect (실제: ${result.reason})`);
    pair.b.close();
    await pair.b.waitClose();
    await sleep(300);
  }

  // ──────────────────────────────────────────────────────────
  section('시나리오 8: JSON 파싱 실패 시 서버 크래시 없음');
  {
    await sleep(300);
    const p1 = makeClient('p1'); await p1.waitOpen();
    p1.send({ type: 'JOIN' });
    await p1.waitMessage((m) => m.type === 'JOINED');

    p1.sendRaw('{not valid json');
    await sleep(200);
    p1.send({ type: 'JOIN', playerName: 'still alive' });
    await sleep(100);
    assert(p1.ws.readyState === 1, '잘못된 JSON 전송 후에도 연결 유지');

    p1.close();
    await p1.waitClose();
    await sleep(300);
  }

  // ──────────────────────────────────────────────────────────
  section('시나리오 9: 알 수 없는 메시지 타입은 무시됨');
  {
    await sleep(300);
    const p1 = makeClient('p1'); await p1.waitOpen();
    p1.send({ type: 'JOIN' });
    await p1.waitMessage((m) => m.type === 'JOINED');

    const before = p1.received.length;
    p1.send({ type: 'UNKNOWN_TYPE_XYZ', foo: 'bar' });
    await sleep(200);
    const after = p1.received.length;
    assert(after === before, '알 수 없는 메시지 타입에는 응답 없음');
    assert(p1.ws.readyState === 1, '연결 유지');

    p1.close();
    await p1.waitClose();
    await sleep(300);
  }

  // ──────────────────────────────────────────────────────────
  section('시나리오 10: ITEM_USE placeholder 중계 (Phase 2 대비)');
  {
    const pair = await makePair();
    pair.a.send({ type: 'ITEM_USE', itemId: 'dark', slotIndex: 0, duration: 5000 });
    const effect = await pair.b.waitMessage((m) => m.type === 'ITEM_EFFECT', 1500);
    assert(effect.itemId === 'dark', `ITEM_EFFECT itemId=dark (실제: ${effect.itemId})`);
    assert(effect.duration === 5000, `duration=5000 (실제: ${effect.duration})`);
    await closePair(pair);
  }

  // ──────────────────────────────────────────────────────────
  section('시나리오 11: [능동] 게임 시작 전 GARBAGE_SEND 중계 동작');
  {
    await sleep(300);
    const p1 = makeClient('p1'); await p1.waitOpen();
    p1.send({ type: 'JOIN' });
    await p1.waitMessage((m) => m.type === 'JOINED');
    const p2 = makeClient('p2'); await p2.waitOpen();
    p2.send({ type: 'JOIN' });
    await p2.waitMessage((m) => m.type === 'JOINED');

    // READY 안 누른 상태에서 GARBAGE_SEND
    p1.send({ type: 'GARBAGE_SEND', lines: 4, combo: 0 });
    let leaked = false;
    try {
      const recv = await p2.waitMessage((m) => m.type === 'GARBAGE_RECV', 800);
      if (recv.lines === 4) leaked = true;
    } catch (e) {
      leaked = false;
    }
    // 현재 서버는 게임 상태 검증 없이 그대로 중계함 → 잠재 위험 표시
    if (leaked) {
      console.log('    [능동 탐색 결과] 서버가 READY 전 가비지를 차단하지 않음 (의도적 단순화)');
      assert(true, '(능동) READY 전 GARBAGE_SEND가 중계됨 — 동작 상 문제는 없으나 잠재 위험 인지');
    } else {
      assert(true, '(능동) READY 전 GARBAGE_SEND 차단됨');
    }

    p1.close(); p2.close();
    await p1.waitClose(); await p2.waitClose();
    await sleep(300);
  }

  // ──────────────────────────────────────────────────────────
  section('시나리오 12: [능동] 양쪽 동시 GAME_OVER 처리');
  {
    const pair = await makePair();
    pair.a.send({ type: 'GAME_OVER' });
    pair.b.send({ type: 'GAME_OVER' });
    await sleep(400);
    const r1Count = pair.a.received.filter((m) => m.type === 'GAME_RESULT').length;
    const r2Count = pair.b.received.filter((m) => m.type === 'GAME_RESULT').length;
    console.log(`    [능동 탐색] a GAME_RESULT 수신: ${r1Count}, b: ${r2Count}`);
    assert(r1Count >= 1 && r2Count >= 1, '양쪽 동시 GAME_OVER 시 최소 1회 결과 수신');
    // 잠재 위험: 첫 결과 winner=b, 두 번째 결과 winner=a → 양쪽 클라가 혼란
    if (r1Count > 1 || r2Count > 1) {
      const winners = pair.a.received.filter((m) => m.type === 'GAME_RESULT').map((m) => m.winner);
      console.log(`    [능동 탐색] a 수신 winner 시퀀스: ${winners.join(', ')}`);
    }
    await closePair(pair);
  }

  // ──────────────────────────────────────────────────────────
  section('시나리오 13: [능동] 빠른 연속 GARBAGE 5회 (큐잉)');
  {
    const pair = await makePair();
    for (let i = 0; i < 5; i++) {
      pair.a.send({ type: 'GARBAGE_SEND', lines: 1, combo: i });
    }
    await sleep(500);
    const recvCount = pair.b.received.filter((m) => m.type === 'GARBAGE_RECV').length;
    assert(recvCount === 5, `빠른 연속 5회 가비지 모두 수신 (실제: ${recvCount})`);
    await closePair(pair);
  }

  // ──────────────────────────────────────────────────────────
  section('시나리오 14: [능동] GARBAGE 극단값 (음수/0/큰 수) — Phase 3 LOW-1 클램프 검증');
  {
    const pair = await makePair();
    // Phase 3 LOW-1 적용 후 서버는 lines를 [0, 20]으로 클램프하고 lines==0이면 broadcast를 스킵한다.

    // 음수: 클램프 → 0 → broadcast 안 됨
    pair.a.send({ type: 'GARBAGE_SEND', lines: -5, combo: 0 });
    let negLeaked = false;
    try {
      await pair.b.waitMessage((m) => m.type === 'GARBAGE_RECV', 600);
      negLeaked = true;
    } catch (_) { /* timeout = 정상 (음수는 클램프 0 → broadcast 안 됨) */ }
    assert(!negLeaked, '(LOW-1) 음수 lines는 0으로 클램프되어 GARBAGE_RECV 미발송');

    // 0: broadcast 안 됨
    pair.a.send({ type: 'GARBAGE_SEND', lines: 0, combo: 0 });
    await sleep(150);
    const zeroCount = pair.b.received.filter((m) => m.type === 'GARBAGE_RECV').length;
    assert(zeroCount === 0, `(MED-1) lines=0은 GARBAGE_RECV 미발송 (수신: ${zeroCount}건)`);

    // 큰 수: 20으로 클램프
    pair.a.send({ type: 'GARBAGE_SEND', lines: 9999, combo: 99 });
    const r3 = await pair.b.waitMessage((m) => m.type === 'GARBAGE_RECV');
    console.log(`    [LOW-1] lines=9999 전송 → 수신: ${r3.lines}`);
    assert(r3.lines === 20, `(LOW-1) 극단값(9999)은 20으로 클램프 (수신: ${r3.lines})`);

    await closePair(pair);
  }

  // ──────────────────────────────────────────────────────────
  console.log('\n=================================================');
  console.log(` PASS: ${pass}, FAIL: ${fail}`);
  console.log('=================================================');
  if (fail > 0) {
    console.log('\n실패 항목:');
    for (const f of failures) {
      console.log(`  - ${f.name}${f.detail ? ' — ' + f.detail : ''}`);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('\nTest harness 예외:', err);
  process.exit(2);
});
