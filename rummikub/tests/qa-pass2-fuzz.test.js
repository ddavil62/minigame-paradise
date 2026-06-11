/**
 * @fileoverview QA 2차 패스 — WS 페이로드 fuzz testing.
 *
 * 목적:
 *   잘못된/극단적/악의적 WebSocket 페이로드를 100건 이상 송신하여
 *   서버가 크래시하지 않고 ERROR 응답 또는 silent ignore로 안전 처리하는지 검증.
 *
 * 중요: 서버는 child_process로 분리 실행한다.
 *   동일 프로세스에서 createApp으로 띄우면 server.js 내 unhandled throw가
 *   본 테스트 프로세스를 같이 죽이기 때문이다.
 *   spawn된 서버가 죽으면 본 테스트는 isServerAlive()로 즉시 감지하고
 *   해당 케이스를 HIGH 버그로 기록 + 나머지 카테고리는 새 서버로 재시작.
 *
 * 실행:
 *   node tests/qa-pass2-fuzz.test.js
 */

import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── 미니 러너 ────────────────────────────────────────────────────
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

// ── 서버 spawn 헬퍼 ──────────────────────────────────────────────
function spawnServer(port) {
  return new Promise((resolve, reject) => {
    const serverPath = path.join(__dirname, '..', 'server.js');
    const child = spawn(process.execPath, [serverPath, '--port', String(port)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let resolved = false;
    let stderrBuf = '';
    child.stdout.on('data', (data) => {
      const s = data.toString();
      if (!resolved && /listen|RUMMIKUB|호스트/.test(s)) {
        resolved = true;
        // 서버 listen 후 약간 대기.
        setTimeout(() => resolve(child), 300);
      }
    });
    child.stderr.on('data', (data) => {
      stderrBuf += data.toString();
    });
    child.on('exit', (code) => {
      if (!resolved) {
        reject(new Error(`server exit before ready: ${stderrBuf}`));
      }
    });
    child.exitInfo = () => stderrBuf;
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        // listen 메시지 못 잡았어도 일단 진행 (배너 형식 변경 가능성).
        resolve(child);
      }
    }, 1500);
  });
}

function killServer(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null) return resolve();
    child.on('exit', () => resolve());
    child.kill();
    setTimeout(() => resolve(), 500);
  });
}

function connectWs(port, mode = 'human') {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?mode=${mode}`);
    const timer = setTimeout(() => reject(new Error('connect timeout')), 3000);
    ws.on('open', () => { clearTimeout(timer); resolve(ws); });
    ws.on('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

function waitMsg(ws, predicate, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const t = setTimeout(() => { ws.off('message', onMsg); resolve(null); }, timeoutMs);
    function onMsg(data) {
      let m;
      try { m = JSON.parse(data.toString()); } catch (e) { return; }
      if (predicate(m)) { clearTimeout(t); ws.off('message', onMsg); resolve(m); }
    }
    ws.on('message', onMsg);
  });
}

function sendRaw(ws, raw) {
  try { ws.send(raw); return true; } catch (e) { return false; }
}

function collectErrors(ws, ms = 200) {
  return new Promise((resolve) => {
    const errs = [];
    function onMsg(data) {
      let m;
      try { m = JSON.parse(data.toString()); } catch (e) { return; }
      if (m && m.type === 'ERROR') errs.push(m.message);
    }
    ws.on('message', onMsg);
    setTimeout(() => { ws.off('message', onMsg); resolve(errs); }, ms);
  });
}

function isServerAlive(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 1000 }, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 600);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

// ── 게임 시작 헬퍼 ───────────────────────────────────────────────
async function setupGame(port) {
  const ws1 = await connectWs(port, 'human');
  const ws2 = await connectWs(port, 'human');
  const joined1 = waitMsg(ws1, (m) => m.type === 'JOINED');
  const joined2 = waitMsg(ws2, (m) => m.type === 'JOINED');
  ws1.send(JSON.stringify({ type: 'JOIN' }));
  ws2.send(JSON.stringify({ type: 'JOIN' }));
  await Promise.all([joined1, joined2]);
  const startWait = waitMsg(ws2, (m) => m.type === 'START', 2000);
  ws1.send(JSON.stringify({ type: 'READY' }));
  ws2.send(JSON.stringify({ type: 'READY' }));
  await startWait;
  await waitMsg(ws1, (m) => m.type === 'STATE', 2000);
  await waitMsg(ws2, (m) => m.type === 'STATE', 2000);
  return { ws1, ws2 };
}

async function checkAliveOrRestart(child, port, label) {
  const alive = await isServerAlive(port);
  if (alive) return { child, restarted: false };
  // 서버 크래시 — 재시작.
  console.log(`  >>>>> 서버 크래시 감지 (${label}) — 재시작 <<<<<`);
  reportIssue('HIGH', label, '서버 프로세스 크래시 발생 — 위 카테고리 페이로드가 트리거');
  await killServer(child);
  await new Promise((r) => setTimeout(r, 500));
  const newChild = await spawnServer(port);
  return { child: newChild, restarted: true };
}

// ═══════════════════════════════════════════════════════════════════
async function main() {
  const PORT = 3120;
  let child = await spawnServer(PORT);
  console.log(`[fuzz] server (child) listening on :${PORT}`);

  let ws1, ws2;
  ({ ws1, ws2 } = await setupGame(PORT));

  let totalFuzzSent = 0;

  // ── FUZZ-A: JSON parse 통과 비객체 페이로드 ──────────────────────
  section('FUZZ-A: JSON parse 통과 비객체 페이로드 (HIGH 후보)');
  // 'null'은 JSON.parse 성공해서 msg=null. switch(msg.type) → TypeError 크래시.
  sendRaw(ws1, 'null');
  totalFuzzSent += 1;
  await new Promise((r) => setTimeout(r, 600));
  let nullCrash = !(await isServerAlive(PORT));
  assertTrue(!nullCrash, 'FUZZ-A1: "null" 페이로드 후 서버 살아있음');
  if (nullCrash) {
    ({ child } = await checkAliveOrRestart(child, PORT,
      '"null" raw 페이로드로 서버 크래시 (server.js:247 msg null 가드 누락)'));
    try { ws1.close(); ws2.close(); } catch (e) { /* noop */ }
    await new Promise((r) => setTimeout(r, 300));
    ({ ws1, ws2 } = await setupGame(PORT));
  }

  // 다른 비객체 페이로드 — 한 번에 하나씩 격리 송신 + 살아있는지 검증.
  const scalars = ['true', 'false', '0', '123', '-1', '"hello"', '[]', '[1,2,3]'];
  for (const s of scalars) {
    sendRaw(ws1, s);
    totalFuzzSent += 1;
    await new Promise((r) => setTimeout(r, 150));
    const alive = await isServerAlive(PORT);
    if (!alive) {
      ({ child } = await checkAliveOrRestart(child, PORT,
        `비객체 페이로드 "${s}" 후 서버 크래시`));
      try { ws1.close(); ws2.close(); } catch (e) { /* noop */ }
      await new Promise((r) => setTimeout(r, 300));
      ({ ws1, ws2 } = await setupGame(PORT));
    }
  }
  assertTrue(await isServerAlive(PORT), 'FUZZ-A2: 비객체 스칼라 8건 전체 안전');

  // ── FUZZ-B: JSON parse 실패 garbage ──────────────────────────────
  section('FUZZ-B: JSON parse 실패 garbage');
  const garbage = ['not json', '', 'undefined', '{', '{"type":', 'NaN',
    '{ "type": "READY" } extra junk', '{type:1}'];
  for (const p of garbage) {
    sendRaw(ws1, p);
    totalFuzzSent += 1;
  }
  await new Promise((r) => setTimeout(r, 300));
  assertTrue(await isServerAlive(PORT), 'FUZZ-B: 서버 살아있음');

  // ── FUZZ-C: 알 수 없는 type ──────────────────────────────────────
  section('FUZZ-C: 알 수 없는 type');
  const unknownTypes = ['UNKNOWN', 'HACK', 'ADMIN', 'DROP_TABLE', 'foo',
    'JOIN_AS_ROOT', '', null, 0, false, [], {}, ' NEW_SET'];
  for (const t of unknownTypes) {
    sendRaw(ws1, JSON.stringify({ type: t }));
    totalFuzzSent += 1;
  }
  await new Promise((r) => setTimeout(r, 300));
  // 추가로 매우 긴 type — JSON.stringify 통과.
  sendRaw(ws1, JSON.stringify({ type: 'NEW_SET '.repeat(100) }));
  totalFuzzSent += 1;
  await new Promise((r) => setTimeout(r, 200));
  assertTrue(await isServerAlive(PORT), 'FUZZ-C: 서버 살아있음');

  // ── FUZZ-D: 필수 필드 누락 ───────────────────────────────────────
  section('FUZZ-D: 필수 필드 누락');
  const missingFields = [
    { type: 'MOVE_TILE' },
    { type: 'MOVE_TILE', from: null, to: null },
    { type: 'MOVE_TILE', from: undefined, to: undefined },
    { type: 'MOVE_TILE', from: {}, to: {} },
    { type: 'MOVE_TILE', from: { kind: 'hand' }, to: { kind: 'set' } },
    { type: 'SWAP_JOKER' },
    { type: 'SWAP_JOKER', setId: 'x' },
    { type: 'SWAP_JOKER', setId: 'x', jokerIndex: 0 },
    { type: 'NEW_SET', extra: 'ignored' },
    { type: 'JOIN' },
  ];
  for (const m of missingFields) {
    sendRaw(ws1, JSON.stringify(m));
    totalFuzzSent += 1;
    await new Promise((r) => setTimeout(r, 30));
    if (!(await isServerAlive(PORT))) {
      ({ child } = await checkAliveOrRestart(child, PORT,
        `FUZZ-D 페이로드로 서버 크래시: ${JSON.stringify(m)}`));
      try { ws1.close(); ws2.close(); } catch (e) { /* noop */ }
      await new Promise((r) => setTimeout(r, 300));
      ({ ws1, ws2 } = await setupGame(PORT));
    }
  }
  assertTrue(await isServerAlive(PORT), 'FUZZ-D: 서버 살아있음');

  // ── FUZZ-E: 타입 mismatch ────────────────────────────────────────
  section('FUZZ-E: 잘못된 타입(mismatch)');
  const wrongTypes = [
    { type: 'MOVE_TILE', from: 123, to: 'string' },
    { type: 'MOVE_TILE', from: { kind: 999 }, to: { kind: true } },
    { type: 'MOVE_TILE', from: { kind: 'hand', tileId: 12345 }, to: { kind: 'set', setId: false } },
    { type: 'MOVE_TILE', from: [], to: [] },
    { type: 'MOVE_TILE', from: 'literal', to: { kind: 'set', setId: { nested: true } } },
    { type: 'MOVE_TILE', from: { kind: 'hand', tileId: { obj: 1 } }, to: { kind: 'hand' } },
    { type: 'SWAP_JOKER', setId: 99, jokerIndex: 'zero', handTileId: null },
    { type: 'SWAP_JOKER', setId: 'x', jokerIndex: 0.5, handTileId: 'y' },
  ];
  for (const m of wrongTypes) {
    sendRaw(ws1, JSON.stringify(m));
    totalFuzzSent += 1;
    await new Promise((r) => setTimeout(r, 30));
    if (!(await isServerAlive(PORT))) {
      ({ child } = await checkAliveOrRestart(child, PORT,
        `FUZZ-E 페이로드로 서버 크래시: ${JSON.stringify(m)}`));
      try { ws1.close(); ws2.close(); } catch (e) { /* noop */ }
      await new Promise((r) => setTimeout(r, 300));
      ({ ws1, ws2 } = await setupGame(PORT));
    }
  }
  assertTrue(await isServerAlive(PORT), 'FUZZ-E: 서버 살아있음');

  // ── FUZZ-F: 극단 숫자 ────────────────────────────────────────────
  section('FUZZ-F: 음수/극단/NaN/Infinity 인덱스');
  const extremeNumbers = [
    { type: 'MOVE_TILE', from: { kind: 'hand', tileId: 'red_5_1' },
      to: { kind: 'set', setId: 'set_999999', index: -1 } },
    { type: 'MOVE_TILE', from: { kind: 'hand', tileId: 'red_5_1' },
      to: { kind: 'set', setId: 'set_1', index: 9999999 } },
    { type: 'MOVE_TILE', from: { kind: 'hand', tileId: 'red_5_1' },
      to: { kind: 'set', setId: 'set_1', index: Number.MAX_SAFE_INTEGER } },
    { type: 'MOVE_TILE', from: { kind: 'hand', tileId: 'red_5_1' },
      to: { kind: 'set', setId: 'set_1', index: Number.MIN_SAFE_INTEGER } },
    { type: 'SWAP_JOKER', setId: 'set_1', jokerIndex: -1, handTileId: 'x' },
    { type: 'SWAP_JOKER', setId: 'set_1', jokerIndex: 99999, handTileId: 'x' },
  ];
  for (const m of extremeNumbers) {
    sendRaw(ws1, JSON.stringify(m));
    totalFuzzSent += 1;
  }
  await new Promise((r) => setTimeout(r, 300));
  assertTrue(await isServerAlive(PORT), 'FUZZ-F: 서버 살아있음');

  // ── FUZZ-G: 상대 턴에 액션 ────────────────────────────────────────
  section('FUZZ-G: 상대 턴에 액션');
  const opponentActions = [
    { type: 'NEW_SET' },
    { type: 'MOVE_TILE', from: { kind: 'hand', tileId: 'red_5_1' }, to: { kind: 'hand' } },
    { type: 'END_TURN' },
    { type: 'SWAP_JOKER', setId: 'set_1', jokerIndex: 0, handTileId: 'x' },
  ];
  for (const m of opponentActions) {
    sendRaw(ws2, JSON.stringify(m));
    totalFuzzSent += 1;
  }
  const errs = await collectErrors(ws2, 300);
  console.log(`  FUZZ-G: ws2(p2)가 받은 ERROR 개수=${errs.length}`);
  assertTrue(errs.length >= 1, 'FUZZ-G: 최소 1건 이상 ERROR 응답');

  // ── FUZZ-H: ghost tileId/setId ───────────────────────────────────
  section('FUZZ-H: ghost tileId/setId');
  const ghostIds = [
    { type: 'MOVE_TILE', from: { kind: 'hand', tileId: 'ghost_tile' }, to: { kind: 'hand' } },
    { type: 'MOVE_TILE', from: { kind: 'set', setId: 'ghost_set', tileId: 'x' }, to: { kind: 'hand' } },
    { type: 'MOVE_TILE', from: { kind: 'hand', tileId: '' }, to: { kind: 'set', setId: '', index: 0 } },
    { type: 'MOVE_TILE', from: { kind: 'hand', tileId: 'red_5_1'.repeat(100) }, to: { kind: 'hand' } },
    { type: 'SWAP_JOKER', setId: 'ghost', jokerIndex: 0, handTileId: 'ghost' },
  ];
  for (const m of ghostIds) {
    sendRaw(ws1, JSON.stringify(m));
    totalFuzzSent += 1;
  }
  await new Promise((r) => setTimeout(r, 300));
  assertTrue(await isServerAlive(PORT), 'FUZZ-H: 서버 살아있음');

  // ── FUZZ-I: SWAP_JOKER 광범위 ────────────────────────────────────
  section('FUZZ-I: SWAP_JOKER 광범위 인자 fuzz');
  const swapVariants = [
    { type: 'SWAP_JOKER', setId: '', jokerIndex: 0, handTileId: '' },
    { type: 'SWAP_JOKER', setId: 'set_1', jokerIndex: 0, handTileId: ' ' },
    { type: 'SWAP_JOKER', setId: 'set_1', jokerIndex: '0', handTileId: 'x' },
    { type: 'SWAP_JOKER', setId: null, jokerIndex: 0, handTileId: 'x' },
    { type: 'SWAP_JOKER', setId: { obj: 1 }, jokerIndex: 0, handTileId: 'x' },
    { type: 'SWAP_JOKER', setId: 'set_1', jokerIndex: 0, handTileId: ['array'] },
    { type: 'SWAP_JOKER', setId: 'set_1', jokerIndex: 0, handTileId: undefined },
    { type: 'SWAP_JOKER', setId: 'set_1', jokerIndex: 0, handTileId: null },
  ];
  for (const m of swapVariants) {
    sendRaw(ws1, JSON.stringify(m));
    totalFuzzSent += 1;
  }
  await new Promise((r) => setTimeout(r, 300));
  assertTrue(await isServerAlive(PORT), 'FUZZ-I: 서버 살아있음');

  // ── FUZZ-J: 메시지 폭풍 ──────────────────────────────────────────
  section('FUZZ-J: 메시지 폭풍 (1000건 burst NEW_SET)');
  const burstStart = Date.now();
  for (let i = 0; i < 1000; i++) {
    sendRaw(ws1, JSON.stringify({ type: 'NEW_SET' }));
    totalFuzzSent += 1;
  }
  await new Promise((r) => setTimeout(r, 1500));
  const burstDur = Date.now() - burstStart;
  console.log(`  FUZZ-J: 1000건 burst 소요=${burstDur}ms`);
  assertTrue(await isServerAlive(PORT), 'FUZZ-J: burst 후 서버 살아있음');

  // ── FUZZ-K: 5MB 페이로드 ─────────────────────────────────────────
  section('FUZZ-K: 매우 큰 페이로드 (5MB)');
  const bigStr = 'A'.repeat(5 * 1024 * 1024);
  sendRaw(ws1, JSON.stringify({ type: 'JOIN', playerName: bigStr }));
  totalFuzzSent += 1;
  try { ws1.send(bigStr); totalFuzzSent += 1; } catch (e) {
    console.log('  send 실패(WS 한도 초과):', e.message);
  }
  await new Promise((r) => setTimeout(r, 1500));
  assertTrue(await isServerAlive(PORT), 'FUZZ-K: 5MB 페이로드 후 서버 살아있음');

  // ── FUZZ-Z: 정상 게임 진행 가능 여부 ─────────────────────────────
  section('FUZZ-Z: fuzz 후 정상 게임 진행 가능');
  // 서버 살아있고 ws 연결도 살아있다면 END_TURN 진행 가능해야 함.
  if (ws1.readyState === WebSocket.OPEN) {
    const turnResult = waitMsg(ws1, (m) => m.type === 'TURN_RESULT', 3000);
    ws1.send(JSON.stringify({ type: 'END_TURN' }));
    const tr = await turnResult;
    assertTrue(tr !== null, 'FUZZ-Z: 정상 END_TURN 응답 도착');
  } else {
    console.log('  ws1 연결 끊김 — 새 연결로 재시도');
    try {
      const { ws1: nws1 } = await setupGame(PORT);
      const turnResult = waitMsg(nws1, (m) => m.type === 'TURN_RESULT', 3000);
      nws1.send(JSON.stringify({ type: 'END_TURN' }));
      const tr = await turnResult;
      assertTrue(tr !== null, 'FUZZ-Z: 새 연결에서 END_TURN 응답');
      nws1.close();
    } catch (e) {
      assertTrue(false, `FUZZ-Z: 새 연결 실패: ${e.message}`);
    }
  }

  console.log(`\n[fuzz] 총 송신 페이로드 수: ${totalFuzzSent}`);
  assertTrue(totalFuzzSent >= 100, `총 fuzz 페이로드 ≥ 100건 (실제=${totalFuzzSent})`);

  try { ws1.close(); ws2.close(); } catch (e) { /* noop */ }
  await new Promise((r) => setTimeout(r, 200));
  await killServer(child);

  if (issues.length > 0) {
    console.log('\n발견된 버그 (HIGH/MED/LOW):');
    for (const i of issues) {
      console.log(`  [${i.severity}] ${i.label} — ${i.detail}`);
    }
  }
}

main().then(() => {
  console.log('\n════════════════════════════════════════');
  console.log(`테스트: ${passed + failed}건 / PASS=${passed} / FAIL=${failed}`);
  console.log(`발견된 이슈: ${issues.length}건`);
  if (failures.length > 0) {
    console.log('\n실패 목록:');
    failures.forEach((f) => console.log(f));
  }
  process.exit(failed > 0 ? 1 : 0);
}).catch((e) => {
  console.error('테스트 실행 오류:', e);
  process.exit(1);
});
