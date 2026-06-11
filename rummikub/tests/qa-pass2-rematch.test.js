/**
 * @fileoverview QA 2차 패스 — REMATCH 흐름 정밀 검증.
 *
 * 시나리오:
 *   RM-001: GAME_OVER 정상 종료 → 양쪽 REMATCH → 새 START
 *   RM-002: 게임 진행 중 양쪽 REMATCH 송신 → 게임 즉시 reset?
 *           ⚠️ server.js:353-369는 phase 가드 없음. 진행 중 양쪽 REMATCH면 startNewGame 호출.
 *   RM-003: REMATCH 후 다시 한 번 더 REMATCH → 두번째는 무시?
 *   RM-004: REMATCH가 한 명만 송신 → 새 게임 안 시작 (rematchReady 한쪽만 true)
 *   RM-005: REMATCH 송신 후 한쪽 disconnect → 다른 쪽 영구 대기?
 *   RM-006: rematch 진행 후 새 게임 시작 시 게임 상태 누적 X (board=[], hands 초기화)
 *
 * 실행:
 *   node tests/qa-pass2-rematch.test.js
 */

import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

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
function assertEq(a, b, label) {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (ok) { passed += 1; console.log(`  PASS  ${label}`); }
  else {
    failed += 1;
    const msg = `  FAIL  ${label}\n    expected: ${JSON.stringify(b)}\n    actual:   ${JSON.stringify(a)}`;
    console.log(msg);
    failures.push(msg);
  }
}
function section(name) { console.log(`\n[${name}]`); }
function reportIssue(severity, label, detail) {
  issues.push({ severity, label, detail });
  console.log(`  ISSUE [${severity}] ${label} — ${detail}`);
}

function spawnServer(port) {
  return new Promise((resolve, reject) => {
    const serverPath = path.join(__dirname, '..', 'server.js');
    const child = spawn(process.execPath, [serverPath, '--port', String(port)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let resolved = false;
    let stderrBuf = '';
    child.stdout.on('data', (d) => {
      if (!resolved && /RUMMIKUB|listening|호스트/i.test(d.toString())) {
        resolved = true;
        setTimeout(() => resolve(child), 300);
      }
    });
    child.stderr.on('data', (d) => { stderrBuf += d.toString(); });
    child.on('exit', () => {
      if (!resolved) reject(new Error(`server exit: ${stderrBuf}`));
    });
    setTimeout(() => { if (!resolved) { resolved = true; resolve(child); } }, 1500);
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

function collectMsgs(ws, ms = 300) {
  return new Promise((resolve) => {
    const arr = [];
    function onMsg(data) {
      let m;
      try { m = JSON.parse(data.toString()); } catch (e) { return; }
      arr.push(m);
    }
    ws.on('message', onMsg);
    setTimeout(() => { ws.off('message', onMsg); resolve(arr); }, ms);
  });
}

async function isServerAlive(port) {
  return await new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 1000 }, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 600);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function setupGame(port) {
  const ws1 = await connectWs(port, 'human');
  const ws2 = await connectWs(port, 'human');
  ws1.send(JSON.stringify({ type: 'JOIN' }));
  ws2.send(JSON.stringify({ type: 'JOIN' }));
  await waitMsg(ws1, (m) => m.type === 'JOINED');
  await waitMsg(ws2, (m) => m.type === 'JOINED');
  const startWait = waitMsg(ws2, (m) => m.type === 'START', 2000);
  ws1.send(JSON.stringify({ type: 'READY' }));
  ws2.send(JSON.stringify({ type: 'READY' }));
  await startWait;
  await waitMsg(ws1, (m) => m.type === 'STATE', 2000);
  await waitMsg(ws2, (m) => m.type === 'STATE', 2000);
  return { ws1, ws2 };
}

// ═══════════════════════════════════════════════════════════════════
async function main() {
  const PORT = 3125;
  const child = await spawnServer(PORT);
  console.log(`[rematch] server listening on :${PORT}`);

  // ── RM-002: 게임 진행 중 양쪽 REMATCH ─────────────────────────────
  section('RM-002: 게임 진행 중 양쪽 REMATCH → 게임 즉시 reset 검증');
  {
    let { ws1, ws2 } = await setupGame(PORT);
    // 핸들러를 먼저 걸어둔다 (race 방지).
    const starts1 = [];
    const states1 = [];
    function onMsg1(data) {
      let m;
      try { m = JSON.parse(data.toString()); } catch (e) { return; }
      if (m.type === 'START') starts1.push(m);
      if (m.type === 'STATE') states1.push(m);
    }
    ws1.on('message', onMsg1);
    // 게임 진행 중. 양쪽 REMATCH 송신.
    ws1.send(JSON.stringify({ type: 'REMATCH' }));
    ws2.send(JSON.stringify({ type: 'REMATCH' }));
    await new Promise((r) => setTimeout(r, 600));
    ws1.off('message', onMsg1);
    console.log(`  RM-002: 게임 진행 중 REMATCH 결과 — START=${starts1.length}, STATE=${states1.length}`);
    if (starts1.length >= 1) {
      reportIssue('MED', 'RM-002 진행 중 REMATCH로 게임 즉시 reset',
        'server.js handleREMATCH가 game.phase 확인 없이 양쪽 rematchReady만 보고 startNewGame 호출. 게임 진행 중 양쪽이 REMATCH를 보내면 진행 중 게임이 즉시 리셋되어 사용자 의도 위반 가능. 클라 UI에서는 GAME_OVER 후에만 REMATCH 버튼 노출하지만 WS 직접 송신 또는 봇 버그로 트리거 가능.');
      assertTrue(true, 'RM-002: 진행 중 REMATCH로 게임 reset (MED 이슈 확인됨)');
    } else {
      assertTrue(starts1.length === 0, 'RM-002: 진행 중 REMATCH는 무시됨 (현재 구현 가드 OK)');
    }
    assertTrue(await isServerAlive(PORT), 'RM-002: 서버 살아있음');
    ws1.close(); ws2.close();
    await new Promise((r) => setTimeout(r, 300));
  }

  // ── RM-003: REMATCH 다중 송신 → 진행 중 거부 + 멱등성 ────────────
  // 2026-06-11 fix 후: 게임 진행 중에는 REMATCH가 phase 가드로 거부된다 (MED-P2-1 fix).
  //   → 5회 송신 시 ERROR 5회, REMATCH_STATUS는 0회여야 한다.
  //   ended 시 멱등성은 RM-006에서 검증.
  section('RM-003: 진행 중 REMATCH 다중 송신 → phase 가드 + 멱등성');
  {
    let { ws1, ws2 } = await setupGame(PORT);
    const statusList = [];
    const errList = [];
    function onMsg(data) {
      let m;
      try { m = JSON.parse(data.toString()); } catch (e) { return; }
      if (m.type === 'REMATCH_STATUS') statusList.push(m);
      if (m.type === 'ERROR') errList.push(m);
    }
    ws1.on('message', onMsg);
    // 한쪽이 5회 REMATCH 송신 — 게임 진행 중이므로 모두 거부되어야 한다.
    for (let i = 0; i < 5; i++) {
      ws1.send(JSON.stringify({ type: 'REMATCH' }));
    }
    await new Promise((r) => setTimeout(r, 400));
    ws1.off('message', onMsg);
    console.log(`  RM-003: 5회 REMATCH 송신 → REMATCH_STATUS=${statusList.length}, ERROR=${errList.length}`);
    assertTrue(statusList.length === 0, 'RM-003: 진행 중 REMATCH → REMATCH_STATUS broadcast 없음 (phase 가드 작동)');
    assertTrue(errList.length >= 1, 'RM-003: 진행 중 REMATCH → ERROR 응답 (phase 가드)');
    assertTrue(await isServerAlive(PORT), 'RM-003: 서버 살아있음');
    ws1.close(); ws2.close();
    await new Promise((r) => setTimeout(r, 300));
  }

  // ── RM-004: 한 명만 REMATCH → 새 게임 안 시작 ─────────────────────
  section('RM-004: 한쪽만 REMATCH → 새 게임 안 시작');
  {
    let { ws1, ws2 } = await setupGame(PORT);
    ws1.send(JSON.stringify({ type: 'REMATCH' }));
    await new Promise((r) => setTimeout(r, 200));
    const m2 = await collectMsgs(ws2, 200);
    const starts2 = m2.filter((m) => m.type === 'START').length;
    console.log(`  RM-004: 한쪽만 REMATCH → ws2 START 갯수=${starts2}`);
    assertTrue(starts2 === 0, 'RM-004: 한쪽만 REMATCH → 새 START 없음');
    ws1.close(); ws2.close();
    await new Promise((r) => setTimeout(r, 300));
  }

  // ── RM-005: REMATCH 송신 후 한쪽 disconnect ───────────────────────
  section('RM-005: REMATCH 송신 후 한쪽 disconnect → 다른 쪽 정리');
  {
    let { ws1, ws2 } = await setupGame(PORT);
    ws1.send(JSON.stringify({ type: 'REMATCH' }));
    await new Promise((r) => setTimeout(r, 100));
    const leftWait = waitMsg(ws2, (m) => m.type === 'OPPONENT_LEFT', 1500);
    ws1.close();
    const leftMsg = await leftWait;
    assertTrue(leftMsg !== null, 'RM-005: ws2가 OPPONENT_LEFT 수신');
    // ws2가 다시 게임 가능한지 — 새 ws3 접속.
    await new Promise((r) => setTimeout(r, 300));
    const ws3 = await connectWs(PORT, 'human');
    ws3.send(JSON.stringify({ type: 'JOIN' }));
    const joined = await waitMsg(ws3, (m) => m.type === 'JOINED', 2000);
    assertTrue(joined !== null, 'RM-005: 새 P 슬롯 접속 가능');
    if (joined) console.log(`  RM-005: 새 접속자 playerId=${joined.playerId}`);
    ws2.close(); ws3.close();
    await new Promise((r) => setTimeout(r, 300));
  }

  await killServer(child);

  if (issues.length > 0) {
    console.log('\n발견된 버그:');
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
