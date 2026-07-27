/**
 * @fileoverview Phase 3 폴리시 회귀 테스트 — MED-1 + LOW 4건의 회귀 방지.
 *
 * 시나리오 (WS 동적):
 *  P1. MED-1: Single 클리어(lines=0)도 GARBAGE_SEND 전송 시 ITEM_GRANT 시도
 *  P2. LOW-1: 서버 lines 클램프
 *      a) 음수 → broadcast 안 됨 (lines==0 동급)
 *      b) 9999 → 20으로 클램프된 GARBAGE_RECV 전달
 *  P3. LOW-2-a: 게임 시작 전 (READY 미발송) ITEM_USE → 상대에 전달 안 됨
 *  P4. LOW-2-b: GAME_OVER 후 ITEM_USE → 상대에 전달 안 됨
 *  P5. LOW-2-c: GAME_OVER 후 GARBAGE_SEND → 상대 미수신, GRANT 시도도 안 됨
 *  P6. LOW-2-d: GAME_OVER 두 번 중복 처리 시 GAME_RESULT는 1건만
 *
 * 사전 조건: 서버 실행 중 (`node server.js --port 3055`)
 * 실행: node tests/phase3-polish.test.js [--port 3055]
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

function section(t) { console.log(`\n── ${t} ─────────────────`); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function makeClient(label = '') {
  const ws = new WebSocket(URL);
  const received = [];
  let waiters = [];
  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { msg = { type: 'PARSE_ERROR' }; }
    received.push(msg);
    const still = [];
    for (const w of waiters) {
      if (w.predicate(msg)) w.resolve(msg);
      else still.push(w);
    }
    waiters = still;
  });
  ws.on('error', () => {});
  return {
    ws, received, label,
    waitOpen() {
      return new Promise((resolve, reject) => {
        if (ws.readyState === 1) return resolve();
        ws.once('open', resolve);
        ws.once('error', reject);
      });
    },
    waitMessage(predicate, timeoutMs = 1500) {
      return new Promise((resolve, reject) => {
        const found = received.find(predicate);
        if (found) return resolve(found);
        const timer = setTimeout(() => reject(new Error(`waitMessage timeout (${label})`)), timeoutMs);
        waiters.push({ predicate, resolve: (m) => { clearTimeout(timer); resolve(m); } });
      });
    },
    send(p) { ws.send(JSON.stringify(p)); },
    close() { try { ws.close(); } catch {} },
  };
}

/**
 * 두 클라이언트가 JOIN/READY/START까지 완료한 페어를 반환.
 */
async function joinTwo() {
  const a = makeClient('A');
  const b = makeClient('B');
  await a.waitOpen();
  await b.waitOpen();
  a.send({ type: 'JOIN', playerName: 'A' });
  await a.waitMessage((m) => m.type === 'JOINED');
  b.send({ type: 'JOIN', playerName: 'B' });
  await b.waitMessage((m) => m.type === 'JOINED');
  a.send({ type: 'READY' });
  b.send({ type: 'READY' });
  await a.waitMessage((m) => m.type === 'START');
  await b.waitMessage((m) => m.type === 'START');
  return { a, b };
}

/**
 * READY 보내지 않고 두 클라가 JOIN만 완료한 페어 (게임 시작 전 상태).
 */
async function joinTwoNoReady() {
  const a = makeClient('A');
  const b = makeClient('B');
  await a.waitOpen();
  await b.waitOpen();
  a.send({ type: 'JOIN', playerName: 'A' });
  await a.waitMessage((m) => m.type === 'JOINED');
  b.send({ type: 'JOIN', playerName: 'B' });
  await b.waitMessage((m) => m.type === 'JOINED');
  return { a, b };
}

async function run() {
  // 서버 사전 확인
  try {
    const probe = new WebSocket(URL);
    await new Promise((resolve, reject) => {
      probe.once('open', () => { probe.close(); resolve(); });
      probe.once('error', reject);
      setTimeout(() => reject(new Error('probe timeout')), 1500);
    });
  } catch (e) {
    console.log(`\n[!] 서버 미실행 (${URL}). 실행: node server.js --port ${PORT}`);
    process.exit(1);
  }

  // ── P1. Single 클리어도 80% 지급 추첨 대상 ───────────────
  section('P1 — lines=0·0콤보 고유 이벤트도 ITEM_GRANT 추첨');
  {
    const { a, b } = await joinTwo();
    for (let eventId = 1; eventId <= 20; eventId++) {
      a.send({ type: 'GARBAGE_SEND', lines: 0, combo: 0, clearEventId: eventId });
    }
    await sleep(250);
    const grants = a.received.filter((m) => m.type === 'ITEM_GRANT');
    const garbages = b.received.filter((m) => m.type === 'GARBAGE_RECV');
    assert(grants.length >= 1 && grants.length <= 3,
      `lines=0 + 0콤보도 확률 지급 대상 (GRANT 실제: ${grants.length})`);
    assert(garbages.length === 0, `lines=0이므로 GARBAGE_RECV는 0건 (실제: ${garbages.length})`);
    a.close(); b.close();
    await sleep(150);
  }

  // ── P2. LOW-1: lines 클램프 ────────────────────────────────
  section('P2. LOW-1 — 서버 lines 클램프');
  {
    const { a, b } = await joinTwo();

    // 음수: broadcast 안 됨
    a.send({ type: 'GARBAGE_SEND', lines: -10, combo: 0 });
    await sleep(200);
    const negCount = b.received.filter((m) => m.type === 'GARBAGE_RECV').length;
    assert(negCount === 0, `음수 lines는 클램프 0 → GARBAGE_RECV 미발송 (실제: ${negCount})`);

    // 큰 수: 20으로 클램프
    a.send({ type: 'GARBAGE_SEND', lines: 9999, combo: 0 });
    const recv = await b.waitMessage((m) => m.type === 'GARBAGE_RECV');
    assert(recv.lines === 20, `9999 → 20으로 클램프 (실제: ${recv.lines})`);

    // NaN/누락 → 0 (broadcast 안 됨)
    a.send({ type: 'GARBAGE_SEND', combo: 0 }); // lines 누락
    await sleep(200);
    const finalCount = b.received.filter((m) => m.type === 'GARBAGE_RECV').length;
    // recv 1개 + 추가 0개 = 1개
    assert(finalCount === 1, `lines 누락은 클램프 0 → 추가 발송 없음 (총 ${finalCount}건)`);

    a.close(); b.close();
    await sleep(150);
  }

  // ── P3. LOW-2-a: 게임 시작 전 ITEM_USE 차단 ─────────────
  section('P3. LOW-2-a — 게임 시작 전 (READY 미발송) ITEM_USE → 상대 미전달');
  {
    const { a, b } = await joinTwoNoReady();
    a.send({ type: 'ITEM_USE', itemId: 'dark', slotIndex: 0 });
    await sleep(300);
    const bEffects = b.received.filter((m) => m.type === 'ITEM_EFFECT');
    const bBlocks = b.received.filter((m) => m.type === 'SHIELD_BLOCK');
    assert(bEffects.length === 0 && bBlocks.length === 0,
      `게임 시작 전 ITEM_USE는 차단됨 (effects=${bEffects.length}, blocks=${bBlocks.length})`);
    a.close(); b.close();
    await sleep(150);
  }

  // ── P4. LOW-2-b: GAME_OVER 후 ITEM_USE 차단 ──────────────
  section('P4. LOW-2-b — GAME_OVER 후 ITEM_USE → 상대 미전달');
  {
    const { a, b } = await joinTwo();
    a.send({ type: 'GAME_OVER' });
    await b.waitMessage((m) => m.type === 'GAME_RESULT');
    // A가 죽고 나서 ITEM_USE 시도 (잘못된 클라 동작 시뮬레이션)
    a.send({ type: 'ITEM_USE', itemId: 'dark', slotIndex: 0 });
    await sleep(300);
    const bEffects = b.received.filter((m) => m.type === 'ITEM_EFFECT');
    const bBlocks = b.received.filter((m) => m.type === 'SHIELD_BLOCK');
    assert(bEffects.length === 0 && bBlocks.length === 0,
      `GAME_OVER 후 ITEM_USE는 서버에서 차단 (effects=${bEffects.length}, blocks=${bBlocks.length})`);
    a.close(); b.close();
    await sleep(150);
  }

  // ── P5. LOW-2-c: GAME_OVER 후 GARBAGE_SEND 차단 ──────────
  section('P5. LOW-2-c — GAME_OVER 후 GARBAGE_SEND → 상대 미수신 + GRANT 미시도');
  {
    const { a, b } = await joinTwo();
    a.send({ type: 'GAME_OVER' });
    await b.waitMessage((m) => m.type === 'GAME_RESULT');
    // A가 죽고 나서 가비지/그랜트 spam
    for (let i = 0; i < 50; i++) {
      a.send({ type: 'GARBAGE_SEND', lines: 1, combo: 0 });
    }
    await sleep(400);
    const bGarbage = b.received.filter((m) => m.type === 'GARBAGE_RECV').length;
    const aGrants = a.received.filter((m) => m.type === 'ITEM_GRANT').length;
    assert(bGarbage === 0, `GAME_OVER 후 GARBAGE_RECV 미발송 (실제: ${bGarbage})`);
    assert(aGrants === 0, `GAME_OVER 후 ITEM_GRANT 미시도 (실제: ${aGrants})`);
    a.close(); b.close();
    await sleep(150);
  }

  // ── P6. LOW-2-d: GAME_OVER 중복 처리 방지 ─────────────────
  section('P6. LOW-2-d — GAME_OVER 두 번 보내도 GAME_RESULT는 1건');
  {
    const { a, b } = await joinTwo();
    a.send({ type: 'GAME_OVER' });
    a.send({ type: 'GAME_OVER' });
    a.send({ type: 'GAME_OVER' });
    await sleep(400);
    const aResults = a.received.filter((m) => m.type === 'GAME_RESULT').length;
    const bResults = b.received.filter((m) => m.type === 'GAME_RESULT').length;
    assert(aResults === 1, `A: GAME_RESULT 1건 (실제: ${aResults})`);
    assert(bResults === 1, `B: GAME_RESULT 1건 (실제: ${bResults})`);
    a.close(); b.close();
    await sleep(150);
  }

  // ── P7. 재대결 후 이벤트 식별자와 슬롯 상태 초기화 ──────────
  section('P7. 재대결 후에도 80% 확률 지급이 정상 동작');
  {
    const { a, b } = await joinTwo();
    // 첫 게임: A가 GAME_OVER
    a.send({ type: 'GAME_OVER' });
    await b.waitMessage((m) => m.type === 'GAME_RESULT');
    // 재대결
    a.send({ type: 'REMATCH' });
    b.send({ type: 'REMATCH' });
    await a.waitMessage((m) => m.type === 'START');
    await b.waitMessage((m) => m.type === 'START');
    await sleep(100);
    // 재대결 후 A의 GRANT 카운트를 별도로 측정하기 위해 그동안 받은 GRANT를 무시
    const grantsBefore = a.received.filter((m) => m.type === 'ITEM_GRANT').length;
    // 새 라운드의 clearEventId가 1부터 다시 시작해도 정상 수락해야 한다.
    for (let eventId = 1; eventId <= 20; eventId++) {
      a.send({ type: 'GARBAGE_SEND', lines: 0, combo: 0, clearEventId: eventId });
    }
    await sleep(250);
    const grantsAfter = a.received.filter((m) => m.type === 'ITEM_GRANT').length;
    const newGrants = grantsAfter - grantsBefore;
    assert(newGrants >= 1 && newGrants <= 3,
      `재대결 후 새 확률 GRANT가 슬롯 한도 안에서 도착 (신규: ${newGrants})`);
    a.close(); b.close();
    await sleep(150);
  }

  console.log(`\n=== 결과: ${pass} PASS / ${fail} FAIL ===`);
  for (const f of failures) console.log(`  - ${f.name} — ${f.detail}`);
  process.exit(fail > 0 ? 1 : 0);
}

run().catch((e) => { console.error('run error', e); process.exit(2); });
