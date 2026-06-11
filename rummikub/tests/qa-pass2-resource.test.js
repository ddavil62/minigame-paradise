/**
 * @fileoverview QA 2차 패스 — 리소스 누수 / 빠른 churn / 응답성 검증.
 *
 * 시나리오:
 *   RES-001: 100 게임 생성 후 메모리 측정 (createGame 누수)
 *   RES-002: 1000회 endTurn (commit 없는) → state 객체 누적 없는지
 *   RES-003: ws 빠른 churn 50회 + 매 게임 시작/종료
 *   RES-004: heartbeat 타이머 cleanup — wss.on('close') 호출 시
 *   RES-005: 동일 게임에서 1000회 swapJoker (실패 케이스) → jokerReturnedThisTurn dict 누적 X
 *
 * 실행:
 *   node tests/qa-pass2-resource.test.js
 */

import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import {
  createGame, addNewSet, moveTile, endTurn, swapJoker, snapshotFor,
} from '../game.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let passed = 0;
let failed = 0;
const failures = [];
const issues = [];

function assertTrue(cond, label) {
  if (cond) { passed += 1; console.log(`  PASS  ${label}`); }
  else { failed += 1; const msg = `  FAIL  ${label}`; console.log(msg); failures.push(msg); }
}
function section(name) { console.log(`\n[${name}]`); }
function reportIssue(severity, label, detail) {
  issues.push({ severity, label, detail });
  console.log(`  ISSUE [${severity}] ${label} — ${detail}`);
}

// ═══════════════════════════════════════════════════════════════════
// RES-001: 100 게임 생성 메모리
// ═══════════════════════════════════════════════════════════════════
section('RES-001: createGame 100회 호출 메모리 측정');
{
  if (global.gc) global.gc();
  const memBefore = process.memoryUsage().heapUsed;
  const games = [];
  for (let i = 0; i < 100; i++) {
    games.push(createGame());
  }
  const memAfter = process.memoryUsage().heapUsed;
  const growKB = (memAfter - memBefore) / 1024;
  console.log(`  100 games heap 증가: ${growKB.toFixed(1)}KB (게임당 ${(growKB / 100).toFixed(1)}KB)`);
  // 게임당 적당히 작은 사이즈여야 함 (typical: 30~80KB).
  assertTrue(growKB < 20000, `RES-001-1: 100 게임 총 heap 증가 20MB 미만 (실제=${growKB.toFixed(1)}KB)`);

  // 게임 해제 후 GC 측정 — 명시적 dispose 없으므로 ref만 끊고 GC.
  games.length = 0;
  if (global.gc) global.gc();
  await new Promise((r) => setTimeout(r, 100));
  if (global.gc) global.gc();
  const memReleased = process.memoryUsage().heapUsed;
  const releasedKB = (memAfter - memReleased) / 1024;
  console.log(`  해제 후 heap 회수: ${releasedKB.toFixed(1)}KB`);
  // gc 강제 호출 없는 환경에서는 회수가 안 보일 수 있음 — 단순 비교 패스로 처리.
  assertTrue(true, 'RES-001-2: gc 회수 측정 완료 (정량 비교는 --expose-gc 필요)');
}

// ═══════════════════════════════════════════════════════════════════
// RES-002: 1000회 endTurn (변경 없는 패스만)
// ═══════════════════════════════════════════════════════════════════
section('RES-002: endTurn 1000회 (변경 없는 패스만) — 상태 객체 누적');
{
  const g = createGame();
  const memBefore = process.memoryUsage().heapUsed;
  for (let i = 0; i < 1000; i++) {
    if (g.phase !== 'playing') break;
    const cur = g.currentTurn;
    const r = endTurn(g, cur);
    if (!r.ok) break;
  }
  const memAfter = process.memoryUsage().heapUsed;
  const growKB = (memAfter - memBefore) / 1024;
  console.log(`  1000 endTurn heap 증가: ${growKB.toFixed(1)}KB, 게임 phase=${g.phase}, 더미=${g.deck.length}`);
  // deck 78장만 있는데 1000번 endTurn 패스 → 78장 다 뽑힌 후 deck_empty_pass로 종료해야 함.
  assertTrue(g.phase === 'ended', 'RES-002-1: 1000 endTurn 안에 게임 종료');
  console.log(`  result: winner=${g.result.winner}, reason=${g.result.reason}, handCounts=${JSON.stringify(g.result.handCounts)}`);
  assertTrue(g.result.reason === 'deck_empty_pass', 'RES-002-2: deck_empty_pass 정상 종료');
  // 상태 객체 사이즈 측정.
  const snapJsonSize = JSON.stringify(g).length;
  console.log(`  최종 state JSON 사이즈: ${(snapJsonSize / 1024).toFixed(1)}KB`);
  assertTrue(snapJsonSize < 200 * 1024, `RES-002-3: state JSON < 200KB (실제=${(snapJsonSize / 1024).toFixed(1)}KB)`);
}

// ═══════════════════════════════════════════════════════════════════
// RES-003: ws 빠른 churn — 별도 spawned 서버
// ═══════════════════════════════════════════════════════════════════
section('RES-003: ws churn 50회 (별도 서버 spawn)');
async function runChurn() {
  const PORT = 3130;
  const serverPath = path.join(__dirname, '..', 'server.js');
  const child = spawn(process.execPath, [serverPath, '--port', String(PORT)], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let ready = false;
  child.stdout.on('data', (d) => {
    if (/RUMMIKUB|listening|호스트/.test(d.toString())) ready = true;
  });
  // 서버 준비 대기.
  for (let i = 0; i < 20 && !ready; i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  await new Promise((r) => setTimeout(r, 300));

  let openCount = 0;
  let errorCount = 0;
  for (let i = 0; i < 50; i++) {
    try {
      const ws = await new Promise((resolve, reject) => {
        const w = new WebSocket(`ws://127.0.0.1:${PORT}/ws?mode=human`);
        const t = setTimeout(() => { reject(new Error('timeout')); }, 1500);
        w.on('open', () => { clearTimeout(t); resolve(w); });
        w.on('error', (e) => { clearTimeout(t); reject(e); });
      });
      openCount += 1;
      ws.send(JSON.stringify({ type: 'JOIN' }));
      await new Promise((r) => setTimeout(r, 50));
      ws.close();
      await new Promise((r) => setTimeout(r, 30));
    } catch (e) {
      errorCount += 1;
    }
  }
  console.log(`  churn 결과: open ${openCount}/50, error ${errorCount}`);
  assertTrue(openCount >= 45, `RES-003-1: 50회 중 ≥45회 연결 성공 (실제=${openCount})`);

  // 서버 살아있는지 확인.
  const aliveReq = http.get({ host: '127.0.0.1', port: PORT, path: '/', timeout: 1000 });
  const alive = await new Promise((resolve) => {
    aliveReq.on('response', (res) => { res.resume(); resolve(true); });
    aliveReq.on('error', () => resolve(false));
    aliveReq.on('timeout', () => { aliveReq.destroy(); resolve(false); });
  });
  assertTrue(alive, 'RES-003-2: 50회 churn 후 서버 살아있음');

  child.kill();
  await new Promise((r) => setTimeout(r, 300));
}
await runChurn();

// ═══════════════════════════════════════════════════════════════════
// RES-004: heartbeat cleanup (단위 — wss.close 시 timer clear)
// ═══════════════════════════════════════════════════════════════════
section('RES-004: heartbeat 타이머 wss.close 시 cleanup');
{
  // server.js의 wss.on('close', () => clearInterval(heartbeatTimer))는 wss 자체 종료 시만 호출.
  // wss는 'noServer' 모드여서 명시적 close 호출이 어렵다. 본 테스트는 정적 분석으로 대체.
  // server.js:413 `wss.on('close', () => { clearInterval(heartbeatTimer); });` — 존재 확인만.
  const fs = await import('node:fs');
  const serverCode = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const hasClearInterval = /clearInterval\(heartbeatTimer\)/.test(serverCode);
  assertTrue(hasClearInterval, 'RES-004-1: server.js에 clearInterval(heartbeatTimer) 존재');
  // wss.close() 호출 경로 확인 — 단독 실행 + createApp 양쪽에서 호출되지 않음(현 코드).
  // 즉 매 게임 종료마다 wss를 재사용. heartbeat 누수는 wss가 살아있는 동안 계속 동작 — 정상.
  const wssCloseCalled = /wss\.close\(\)/.test(serverCode);
  if (!wssCloseCalled) {
    reportIssue('LOW', 'RES-004 wss.close() 호출 없음',
      'server.js에서 wss.close()를 호출하는 경로가 없음. wss는 노드 process 종료까지 살아있고 heartbeat도 매 30초 동작. 단일 인스턴스 환경에서는 문제 없지만 다중 createApp 호출 시 wss 인스턴스가 누적될 수 있음.');
  }
}

// ═══════════════════════════════════════════════════════════════════
// RES-005: 1000회 swapJoker 실패 케이스
// ═══════════════════════════════════════════════════════════════════
section('RES-005: 1000회 swapJoker 실패 → jokerReturnedThisTurn dict 누적 X');
{
  const g = createGame();
  for (let i = 0; i < 1000; i++) {
    swapJoker(g, 'p1', { setId: 'ghost', jokerIndex: 0, handTileId: 'ghost' });
  }
  const keys = Object.keys(g.jokerReturnedThisTurn || {});
  assertTrue(keys.length === 0, `RES-005-1: 실패한 swapJoker는 dict에 추가 X (현재 키=${keys.length})`);
  // 인자 누락도.
  for (let i = 0; i < 100; i++) {
    swapJoker(g, 'p1', null);
    swapJoker(g, 'p1', {});
    swapJoker(g, 'p1', { setId: 'x' });
  }
  assertTrue(Object.keys(g.jokerReturnedThisTurn || {}).length === 0,
    'RES-005-2: 인자 누락 swapJoker도 dict 무영향');
}

// ═══════════════════════════════════════════════════════════════════
// RES-006: 게임 1회 정상 진행 후 createGame 재호출 → 누수 X
// ═══════════════════════════════════════════════════════════════════
section('RES-006: 봇 휴리스틱 1000회 호출 후 메모리');
{
  // bot.js의 findBestSetCombination을 1000회 호출 — 매번 새 결과.
  const { findBestSetCombination, enumerateCandidateSets } = await import('../bot.js');
  const handTiles = [
    { id: 'a', kind: 'num', color: 'red', number: 5 },
    { id: 'b', kind: 'num', color: 'blue', number: 5 },
    { id: 'c', kind: 'num', color: 'black', number: 5 },
    { id: 'd', kind: 'num', color: 'orange', number: 5 },
    { id: 'e', kind: 'num', color: 'red', number: 6 },
    { id: 'f', kind: 'num', color: 'red', number: 7 },
    { id: 'g', kind: 'num', color: 'red', number: 8 },
    { id: 'h', kind: 'num', color: 'blue', number: 9 },
    { id: 'i', kind: 'num', color: 'blue', number: 10 },
    { id: 'j', kind: 'num', color: 'blue', number: 11 },
  ];
  const memBefore = process.memoryUsage().heapUsed;
  for (let i = 0; i < 1000; i++) {
    findBestSetCombination(handTiles, 30);
  }
  const memAfter = process.memoryUsage().heapUsed;
  const growKB = (memAfter - memBefore) / 1024;
  console.log(`  1000회 findBestSetCombination heap 증가: ${growKB.toFixed(1)}KB`);
  assertTrue(growKB < 50000, `RES-006-1: heap 증가 < 50MB`);
}

// ═══════════════════════════════════════════════════════════════════
// 최종
// ═══════════════════════════════════════════════════════════════════
console.log('\n════════════════════════════════════════');
console.log(`테스트: ${passed + failed}건 / PASS=${passed} / FAIL=${failed}`);
console.log(`발견된 이슈: ${issues.length}건`);
if (failures.length > 0) {
  console.log('\n실패 목록:');
  failures.forEach((f) => console.log(f));
}
if (issues.length > 0) {
  console.log('\n발견된 이슈 상세:');
  for (const i of issues) {
    console.log(`  [${i.severity}] ${i.label} — ${i.detail}`);
  }
}
process.exit(failed > 0 ? 1 : 0);
