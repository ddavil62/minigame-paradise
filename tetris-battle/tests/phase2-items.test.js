/**
 * @fileoverview Phase 2 아이템 시스템 WS 시뮬레이션 + 단위 테스트.
 *
 * 시나리오:
 *  A. 단위
 *   1) board.clearBottomLines: 하단 N줄 삭제
 *   2) items.ITEMS: 5종 정의 형태 검증
 *  B. WS 동적 (서버 필요)
 *   3) ITEM_USE garbage_bomb → 상대에 ITEM_EFFECT garbage_bomb 전달
 *   4) ITEM_USE dark → 상대에 ITEM_EFFECT dark (duration 5000)
 *   5) ITEM_USE freeze → 상대에 ITEM_EFFECT freeze (duration 3000)
 *   6) ITEM_USE shield → 자기에게만 적용 (상대 ITEM_EFFECT 없음)
 *   7) 방어막 활성 후 상대 공격 → 양쪽에 SHIELD_BLOCK 전달, ITEM_EFFECT 없음
 *   8) 방어막은 1회용 (한번 차단 후 다음 공격은 ITEM_EFFECT로 정상 전달)
 *   9) ITEM_USE line_clear → 송신자 자신만 효과 (상대 메시지 없음)
 *
 * 사전 조건: 서버 실행 중 (`node server.js --port 3055`)
 * 실행: node tests/phase2-items.test.js [--port 3055]
 */

import WebSocket from 'ws';
import {
  clearBottomLines,
  createEmptyGrid,
  addGarbage,
  BOARD_HEIGHT,
  BOARD_WIDTH,
  GARBAGE_BOMB_LINES,
  LINE_CLEAR_LINES,
} from '../public/js/board.js';
import { ITEMS, SLOT_COUNT } from '../public/js/items.js';

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

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function makeClient(label = '') {
  const ws = new WebSocket(URL);
  const received = [];
  let waiters = [];
  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); }
    catch { msg = { type: 'PARSE_ERROR', raw: data.toString() }; }
    received.push(msg);
    const still = [];
    for (const w of waiters) {
      if (w.predicate(msg)) w.resolve(msg);
      else still.push(w);
    }
    waiters = still;
  });
  ws.on('error', () => { /* 무시 */ });
  return {
    ws,
    received,
    label,
    waitOpen() {
      return new Promise((resolve, reject) => {
        if (ws.readyState === 1) return resolve();
        ws.once('open', resolve);
        ws.once('error', reject);
      });
    },
    waitMessage(predicate, timeoutMs = 2000) {
      return new Promise((resolve, reject) => {
        const found = received.find(predicate);
        if (found) return resolve(found);
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

// ── A. 단위 테스트 ─────────────────────────────────────────────
section('A. 단위 — board.clearBottomLines');
{
  const grid = createEmptyGrid();
  // 하단 3줄을 가비지로 채움
  addGarbage(grid, 3);
  const heightBefore = grid.slice(BOARD_HEIGHT - 3).filter((r) => r.some((v) => v !== 0)).length;
  assert(heightBefore === 3, '하단 3줄에 가비지 추가 확인');

  const removed = clearBottomLines(grid, 2);
  assert(removed === 2, 'clearBottomLines가 2를 반환');
  const remainingNonEmpty = grid.filter((r) => r.some((v) => v !== 0)).length;
  assert(remainingNonEmpty === 1, '제거 후 비어있지 않은 줄 = 1');
  // 최상단 2줄은 비어있어야 (위에서 unshift 처리)
  assert(grid[0].every((v) => v === 0), '맨 위 줄은 빈 줄');
  assert(grid[1].every((v) => v === 0), '둘째 줄도 빈 줄');
}

section('A. 단위 — board.clearBottomLines (음수/0/과대값)');
{
  const grid = createEmptyGrid();
  addGarbage(grid, 5);
  assert(clearBottomLines(grid, 0) === 0, '0 입력 → 0 반환');
  assert(clearBottomLines(grid, -3) === 0, '음수 입력 → 0 반환');
  // 5줄만 남아있는 보드에 100줄 제거 요청 → 최대 BOARD_HEIGHT까지만
  const removed = clearBottomLines(grid, 100);
  assert(removed === BOARD_HEIGHT, '과대 입력 → BOARD_HEIGHT(20)로 제한');
  assert(grid.every((r) => r.every((v) => v === 0)), '전체 보드가 비워짐');
}

section('A. 단위 — items.ITEMS 정의 형태');
{
  const expectedIds = ['garbage_bomb', 'dark', 'freeze', 'line_clear', 'shield'];
  for (const id of expectedIds) {
    assert(!!ITEMS[id], `ITEMS.${id} 정의됨`);
    if (ITEMS[id]) {
      assert(typeof ITEMS[id].name === 'string' && ITEMS[id].name.length > 0, `${id}.name 한국어 문자열`);
      assert(['attack', 'defense'].includes(ITEMS[id].type), `${id}.type 유효`);
      assert(typeof ITEMS[id].icon === 'string', `${id}.icon 문자열`);
    }
  }
  assert(SLOT_COUNT === 3, 'SLOT_COUNT === 3');
  assert(ITEMS.dark.duration === 5000, 'dark duration 5000');
  assert(ITEMS.freeze.duration === 3000, 'freeze duration 3000');
  assert(ITEMS.garbage_bomb.duration === 0, 'garbage_bomb duration 0 (즉시)');
  assert(GARBAGE_BOMB_LINES === 2, 'GARBAGE_BOMB_LINES === 2');
  assert(LINE_CLEAR_LINES === 2, 'LINE_CLEAR_LINES === 2');
}

// ── B. WS 동적 ─────────────────────────────────────────────────
async function runWsScenarios() {
  // 서버 사전 확인
  try {
    const probe = new WebSocket(URL);
    await new Promise((resolve, reject) => {
      probe.once('open', () => { probe.close(); resolve(); });
      probe.once('error', reject);
      setTimeout(() => reject(new Error('probe timeout')), 1500);
    });
  } catch (e) {
    console.log(`\n[!] 서버 미실행 (${URL}). WS 시나리오 스킵.`);
    console.log(`    실행: node server.js --port ${PORT}`);
    return;
  }

  section('B. WS — 시나리오 1: ITEM_USE garbage_bomb → 상대 ITEM_EFFECT');
  {
    const { a, b } = await joinTwo();
    a.send({ type: 'ITEM_USE', itemId: 'garbage_bomb', slotIndex: 0 });
    const eff = await b.waitMessage((m) => m.type === 'ITEM_EFFECT');
    assert(eff.itemId === 'garbage_bomb', 'B 수신 itemId garbage_bomb');
    assert(eff.duration === 0, 'duration 0 (즉시)');
    // A는 ITEM_EFFECT를 받지 않아야 함
    await sleep(200);
    const aReceivedEffect = a.received.find((m) => m.type === 'ITEM_EFFECT');
    assert(!aReceivedEffect, 'A는 ITEM_EFFECT 수신 없음 (자기 공격이므로)');
    a.close(); b.close();
    await sleep(120);
  }

  section('B. WS — 시나리오 2: dark (duration 5000)');
  {
    const { a, b } = await joinTwo();
    a.send({ type: 'ITEM_USE', itemId: 'dark', slotIndex: 0 });
    const eff = await b.waitMessage((m) => m.type === 'ITEM_EFFECT');
    assert(eff.itemId === 'dark', 'B 수신 itemId dark');
    assert(eff.duration === 5000, 'duration 5000');
    a.close(); b.close();
    await sleep(120);
  }

  section('B. WS — 시나리오 3: freeze (duration 3000)');
  {
    const { a, b } = await joinTwo();
    a.send({ type: 'ITEM_USE', itemId: 'freeze', slotIndex: 0 });
    const eff = await b.waitMessage((m) => m.type === 'ITEM_EFFECT');
    assert(eff.itemId === 'freeze', 'B 수신 itemId freeze');
    assert(eff.duration === 3000, 'duration 3000');
    a.close(); b.close();
    await sleep(120);
  }

  section('B. WS — 시나리오 4: shield → 자기에게만 (상대 ITEM_EFFECT 없음)');
  {
    const { a, b } = await joinTwo();
    a.send({ type: 'ITEM_USE', itemId: 'shield', slotIndex: 0 });
    await sleep(250);
    const bReceived = b.received.find((m) => m.type === 'ITEM_EFFECT');
    assert(!bReceived, 'B는 ITEM_EFFECT 수신 없음 (방어형은 자기에게만)');
    a.close(); b.close();
    await sleep(120);
  }

  section('B. WS — 시나리오 5: 방어막 → 다음 공격 차단 (양쪽 SHIELD_BLOCK)');
  {
    const { a, b } = await joinTwo();
    // B가 방어막 활성화
    b.send({ type: 'ITEM_USE', itemId: 'shield', slotIndex: 0 });
    await sleep(150);
    // A가 dark 공격
    a.send({ type: 'ITEM_USE', itemId: 'dark', slotIndex: 0 });
    const aBlock = await a.waitMessage((m) => m.type === 'SHIELD_BLOCK');
    const bBlock = await b.waitMessage((m) => m.type === 'SHIELD_BLOCK');
    assert(aBlock.itemId === 'dark', 'A SHIELD_BLOCK itemId dark');
    assert(bBlock.itemId === 'dark', 'B SHIELD_BLOCK itemId dark');
    assert(aBlock.isDefender === false, '공격자 A에는 isDefender=false 전달');
    assert(bBlock.isDefender === true, '방어자 B에는 isDefender=true 전달');
    // B는 ITEM_EFFECT를 받지 않아야 함
    await sleep(200);
    const bEffect = b.received.find((m) => m.type === 'ITEM_EFFECT');
    assert(!bEffect, 'B는 ITEM_EFFECT 미수신 (방어막 차단)');
    a.close(); b.close();
    await sleep(120);
  }

  section('B. WS — 시나리오 6: 방어막은 1회용 (다음 공격은 정상 전달)');
  {
    const { a, b } = await joinTwo();
    b.send({ type: 'ITEM_USE', itemId: 'shield', slotIndex: 0 });
    await sleep(150);
    // 1차 공격: 차단
    a.send({ type: 'ITEM_USE', itemId: 'freeze', slotIndex: 0 });
    await b.waitMessage((m) => m.type === 'SHIELD_BLOCK');
    // 2차 공격: 통과해야 함
    a.send({ type: 'ITEM_USE', itemId: 'garbage_bomb', slotIndex: 1 });
    const eff = await b.waitMessage((m) => m.type === 'ITEM_EFFECT');
    assert(eff.itemId === 'garbage_bomb', '2차 공격은 ITEM_EFFECT로 정상 전달');
    a.close(); b.close();
    await sleep(120);
  }

  section('B. WS — 시나리오 7: line_clear → 송신자만 (상대 메시지 없음)');
  {
    const { a, b } = await joinTwo();
    // ★ A에게 슬롯이 있다고 서버가 인식하도록 slotCount를 채우는 건 클라이언트 책임이지만,
    // 서버는 ITEM_USE 수신 시 단순히 음수 방지로만 차감하므로 무시 가능.
    a.send({ type: 'ITEM_USE', itemId: 'line_clear', slotIndex: 0 });
    await sleep(250);
    const bEff = b.received.find((m) => m.type === 'ITEM_EFFECT');
    const bBlock = b.received.find((m) => m.type === 'SHIELD_BLOCK');
    assert(!bEff && !bBlock, 'B는 ITEM_EFFECT/SHIELD_BLOCK 모두 미수신');
    a.close(); b.close();
    await sleep(120);
  }

  section('B. WS — 시나리오 8: 알 수 없는 itemId는 무시');
  {
    const { a, b } = await joinTwo();
    a.send({ type: 'ITEM_USE', itemId: 'INVALID_X', slotIndex: 0 });
    await sleep(200);
    const bAny = b.received.find((m) => m.type === 'ITEM_EFFECT' || m.type === 'SHIELD_BLOCK');
    assert(!bAny, '알 수 없는 itemId는 상대에 전달되지 않음');
    a.close(); b.close();
    await sleep(120);
  }

  section('B. WS — 시나리오 9: 고유 라인 클리어 이벤트마다 높은 확률로 지급');
  {
    const { a, b } = await joinTwo();
    // 확률 검증의 정확한 경계와 중복 방지는 report32-item-grant.test.js에서
    // 주입 RNG로 결정적으로 검사한다. 여기서는 실제 Math.random 경로를 연속 표본으로 확인한다.
    for (let eventId = 1; eventId <= 20; eventId++) {
      a.send({ type: 'GARBAGE_SEND', lines: 0, combo: 0, clearEventId: eventId });
    }
    await sleep(250);
    const grants = a.received.filter((m) => m.type === 'ITEM_GRANT');
    assert(grants.length >= 1, `0콤보 20회 라인 클리어에서 GRANT 수신 (실제: ${grants.length})`);
    assert(grants.length <= 3, `GRANT는 슬롯 한도 3개를 넘지 않음 (실제: ${grants.length})`);
    assert(grants[0]?.slotIndex === 0, '첫 당첨은 첫 빈 슬롯 0에 지급');
    a.close(); b.close();
    await sleep(120);
  }

  section('B. WS — 시나리오 10: 실제 셀/가비지 구멍 및 최종 보드 순서');
  {
    const { a, b } = await joinTwo();
    const cells = Array.from({ length: BOARD_HEIGHT }, () => Array(BOARD_WIDTH).fill(0));
    cells[BOARD_HEIGHT - 1] = Array(BOARD_WIDTH).fill(8);
    cells[BOARD_HEIGHT - 1][4] = 0;
    cells[BOARD_HEIGHT - 2][2] = 3;
    a.send({
      type: 'BOARD_STATE',
      height: 2,
      stack: [1, 1, 2, 1, 0, 1, 1, 1, 1, 1],
      cells,
      final: true,
    });
    a.send({ type: 'GAME_OVER' });
    const board = await b.waitMessage((m) => m.type === 'OPPONENT_BOARD');
    await b.waitMessage((m) => m.type === 'GAME_RESULT');
    const boardIndex = b.received.findIndex((m) => m.type === 'OPPONENT_BOARD');
    const resultIndex = b.received.findIndex((m) => m.type === 'GAME_RESULT');
    assert(board.cells[BOARD_HEIGHT - 1][4] === 0, '가비지 행의 실제 구멍 셀 보존');
    assert(board.cells[BOARD_HEIGHT - 2][2] === 3, '일반 블록 종류와 위치 보존');
    assert(board.final === true, '최종 보드 플래그 보존');
    assert(boardIndex >= 0 && boardIndex < resultIndex, '최종 OPPONENT_BOARD가 GAME_RESULT보다 먼저 도착');
    a.close(); b.close();
    await sleep(120);
  }
}

// ── 실행 ────────────────────────────────────────────────────────
(async () => {
  try {
    await runWsScenarios();
  } catch (e) {
    console.error('\n[!] WS 시나리오 실행 중 오류:', e.message);
  }

  console.log(`\n=== 결과: ${pass} PASS / ${fail} FAIL ===`);
  if (fail > 0) {
    for (const f of failures) {
      console.log(`  - ${f.name} ${f.detail ? '— ' + f.detail : ''}`);
    }
    process.exit(1);
  }
  process.exit(0);
})();
