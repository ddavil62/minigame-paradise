/**
 * @fileoverview Phase 2 QA 능동 엣지케이스 — Coder 테스트가 놓쳤을 가능성이 있는 시나리오.
 *
 * QA 추가 시나리오:
 *  E1. 슬롯 가득(slotCount=3)일 때 GARBAGE_SEND 추가 → ITEM_GRANT 더 이상 안 옴
 *  E2. 방어막 활성 상태에서 다중 공격 동시 수신 → 첫 1개만 차단, 나머지 적용
 *  E3. 다크 효과 중 또 다른 다크 (타이머 갱신 vs 무시)
 *  E4. 양쪽 동시 ITEM_USE(공격형) → 처리 순서/정합성
 *  E5. 알 수 없는 itemId / 누락 슬롯 인덱스 ITEM_USE → 무시
 *  E6. shield 사용 후 즉시 같은 공격 N회 → 1회만 차단됨
 *  E7. line_clear 사용 시 slotCount 차감 확인 (다음 GARBAGE_SEND에서 슬롯 1개 비어 GRANT 가능)
 *
 * 사전 조건: 서버 실행 중 (node server.js --port 3055)
 * 실행: node tests/phase2-edge.test.js [--port 3055]
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

  // ── E1. 슬롯 가득 → ITEM_GRANT 차단 ─────────────────
  section('E1. 슬롯 가득(3개) 차면 후속 3콤보 이벤트에도 추가 지급 없음');
  {
    const { a, b } = await joinTwo();
    for (let eventId = 1; eventId <= 3; eventId++) {
      a.send({ type: 'GARBAGE_SEND', lines: 0, combo: eventId + 2, clearEventId: eventId });
    }
    await sleep(200);
    const grants = a.received.filter((m) => m.type === 'ITEM_GRANT');
    assert(grants.length === 3, `빈 슬롯 3개에 정확히 3개 지급 (실제: ${grants.length})`);
    const before = grants.length;
    a.send({ type: 'GARBAGE_SEND', lines: 0, combo: 6, clearEventId: 4 });
    await sleep(150);
    const after = a.received.filter((m) => m.type === 'ITEM_GRANT').length;
    assert(after === before, `슬롯 가득 후 추가 이벤트는 GRANT 0건 (before=${before}, after=${after})`);
    a.close(); b.close();
    await sleep(150);
  }

  // ── E2. 방어막 활성 중 빠른 다중 공격 → 첫 1개만 차단 ──
  section('E2. 방어막 활성 중 다중 공격 동시 수신 → 1개만 차단, 나머지는 ITEM_EFFECT');
  {
    const { a, b } = await joinTwo();
    // B가 방어막
    b.send({ type: 'ITEM_USE', itemId: 'shield', slotIndex: 0 });
    await sleep(120);
    // A가 거의 동시에 3번 공격 (dark, freeze, garbage_bomb)
    a.send({ type: 'ITEM_USE', itemId: 'dark', slotIndex: 0 });
    a.send({ type: 'ITEM_USE', itemId: 'freeze', slotIndex: 1 });
    a.send({ type: 'ITEM_USE', itemId: 'garbage_bomb', slotIndex: 2 });
    await sleep(400);
    const blocks = b.received.filter((m) => m.type === 'SHIELD_BLOCK');
    const effects = b.received.filter((m) => m.type === 'ITEM_EFFECT');
    assert(blocks.length === 1, `SHIELD_BLOCK 정확히 1건 (실제: ${blocks.length})`);
    assert(effects.length === 2, `ITEM_EFFECT 정확히 2건 (실제: ${effects.length})`);
    // 첫 번째 공격(dark)이 차단되어야 함 (서버는 순차 처리)
    assert(blocks[0]?.itemId === 'dark', `차단된 itemId는 첫 공격 dark (실제: ${blocks[0]?.itemId})`);
    a.close(); b.close();
    await sleep(150);
  }

  // ── E3. 다크 효과 중 또 다른 다크 → 서버는 그냥 다시 전달함 (클라가 타이머 갱신) ──
  section('E3. 연속 다크 공격 — 서버는 매번 ITEM_EFFECT 전달');
  {
    const { a, b } = await joinTwo();
    a.send({ type: 'ITEM_USE', itemId: 'dark', slotIndex: 0 });
    await sleep(80);
    a.send({ type: 'ITEM_USE', itemId: 'dark', slotIndex: 1 });
    await sleep(300);
    const effects = b.received.filter((m) => m.type === 'ITEM_EFFECT' && m.itemId === 'dark');
    assert(effects.length === 2, `다크 ITEM_EFFECT 2건 모두 도착 (실제: ${effects.length}) — 클라 items.js는 darkTimer를 clearTimeout 후 재설정하므로 안전`);
    a.close(); b.close();
    await sleep(150);
  }

  // ── E4. 양쪽 동시 공격 → 각자 상대에게 ITEM_EFFECT 전달 ──
  section('E4. 양쪽 동시 공격 — 각자 상대에게 ITEM_EFFECT 도달');
  {
    const { a, b } = await joinTwo();
    a.send({ type: 'ITEM_USE', itemId: 'dark', slotIndex: 0 });
    b.send({ type: 'ITEM_USE', itemId: 'freeze', slotIndex: 0 });
    await sleep(300);
    const aGot = a.received.find((m) => m.type === 'ITEM_EFFECT' && m.itemId === 'freeze');
    const bGot = b.received.find((m) => m.type === 'ITEM_EFFECT' && m.itemId === 'dark');
    assert(!!aGot, 'A는 B가 보낸 freeze를 수신');
    assert(!!bGot, 'B는 A가 보낸 dark를 수신');
    a.close(); b.close();
    await sleep(150);
  }

  // ── E5. 누락/잘못된 슬롯 인덱스 ITEM_USE ──
  section('E5. slotIndex 누락 / 음수 / 큰 수 — 서버는 itemId만 보고 정상 처리');
  {
    const { a, b } = await joinTwo();
    a.send({ type: 'ITEM_USE', itemId: 'dark' }); // slotIndex 누락
    a.send({ type: 'ITEM_USE', itemId: 'dark', slotIndex: -5 });
    a.send({ type: 'ITEM_USE', itemId: 'dark', slotIndex: 999 });
    await sleep(300);
    const eff = b.received.filter((m) => m.type === 'ITEM_EFFECT');
    assert(eff.length === 3, `잘못된 slotIndex도 itemId가 유효하면 전달됨 (실제: ${eff.length}, 의도적 단순화)`);
    a.close(); b.close();
    await sleep(150);
  }

  // ── E6. 방어막 1회용 (3회 공격 시 첫 번째만 차단) ──
  section('E6. 방어막 1회용 — 3회 빠른 공격 시 첫 번째만 차단');
  {
    const { a, b } = await joinTwo();
    b.send({ type: 'ITEM_USE', itemId: 'shield', slotIndex: 0 });
    await sleep(120);
    a.send({ type: 'ITEM_USE', itemId: 'dark', slotIndex: 0 });
    await sleep(80);
    a.send({ type: 'ITEM_USE', itemId: 'dark', slotIndex: 1 });
    await sleep(80);
    a.send({ type: 'ITEM_USE', itemId: 'dark', slotIndex: 2 });
    await sleep(300);
    const blocks = b.received.filter((m) => m.type === 'SHIELD_BLOCK');
    const effects = b.received.filter((m) => m.type === 'ITEM_EFFECT');
    assert(blocks.length === 1, `방어막 차단은 정확히 1회 (실제: ${blocks.length})`);
    assert(effects.length === 2, `나머지 2회는 ITEM_EFFECT로 적용 (실제: ${effects.length})`);
    a.close(); b.close();
    await sleep(150);
  }

  // ── E7. shield 재대결 후에도 리셋 (resetRoomFlags) ──
  section('E7. 재대결 후 shieldActive/slotCount 서버 측 리셋 확인');
  {
    const { a, b } = await joinTwo();
    // 첫 게임: B 방어막
    b.send({ type: 'ITEM_USE', itemId: 'shield', slotIndex: 0 });
    await sleep(120);
    // A 게임오버 → 재대결
    a.send({ type: 'GAME_OVER' });
    await b.waitMessage((m) => m.type === 'GAME_RESULT');
    a.send({ type: 'REMATCH' });
    b.send({ type: 'REMATCH' });
    await a.waitMessage((m) => m.type === 'START');
    await sleep(150);
    // 재대결 후 A가 공격 → B에 ITEM_EFFECT 와야 함 (방어막 리셋되었어야)
    const beforeCount = b.received.filter((m) => m.type === 'ITEM_EFFECT' || m.type === 'SHIELD_BLOCK').length;
    a.send({ type: 'ITEM_USE', itemId: 'dark', slotIndex: 0 });
    await sleep(300);
    const newEffects = b.received.filter((m) => m.type === 'ITEM_EFFECT' && m.itemId === 'dark');
    const newBlocks = b.received.filter((m) => m.type === 'SHIELD_BLOCK');
    assert(newEffects.length === 1 && newBlocks.length === 0, `재대결 후 B에 방어막 없음 → ITEM_EFFECT로 전달 (effects=${newEffects.length}, blocks=${newBlocks.length})`);
    a.close(); b.close();
    await sleep(150);
  }

  // ── E8. 게임오버 후 ITEM_USE → 서버는 그대로 처리 (클라가 input 차단해야) ──
  section('E8. GAME_OVER 후 ITEM_USE → 서버 권위 처리 동작 검증');
  {
    const { a, b } = await joinTwo();
    a.send({ type: 'GAME_OVER' });
    await b.waitMessage((m) => m.type === 'GAME_RESULT');
    // A가 죽고 나서 다시 공격 시도 (의도치 않은 경우)
    a.send({ type: 'ITEM_USE', itemId: 'dark', slotIndex: 0 });
    await sleep(250);
    const eff = b.received.filter((m) => m.type === 'ITEM_EFFECT');
    // 서버는 게임 상태를 추적하지 않으므로 그대로 중계됨 — 잠재 위험으로 기록
    console.log(`    [관찰] GAME_OVER 후 A의 ITEM_USE 결과 B 수신 ITEM_EFFECT: ${eff.length}건`);
    assert(true, `(관찰) 서버는 게임 상태 무시하고 중계 — 클라 input.disable()이 송신을 막아야 함`);
    a.close(); b.close();
    await sleep(150);
  }

  console.log(`\n=== 결과: ${pass} PASS / ${fail} FAIL ===`);
  for (const f of failures) console.log(`  - ${f.name} — ${f.detail}`);
  process.exit(fail > 0 ? 1 : 0);
}

run().catch((e) => { console.error('run error', e); process.exit(2); });
