/**
 * @fileoverview QA 후속 검증 — 1차 슈트(qa-edge)에서 발견된 HIGH 이슈의
 * 다른 경로 확장 검증 + 봇 vs 봇 장시간 시뮬레이션.
 *
 * 1) HIGH-1: moveTile 트랜잭션 누락 — 다양한 from/to 조합에서 유실 발생하는지.
 * 2) HIGH-2: 봇 vs 봇 무한 게임 — 더 긴 시간 + 패턴 분석.
 * 3) 추가: 사용자 우회 케이스(STATIC-008)가 실제 봇 동작에서 발생 빈도 측정.
 */

import http from 'node:http';
import { WebSocket } from 'ws';
import {
  createGame,
  addNewSet,
  moveTile,
} from '../game.js';
import { createApp } from '../server.js';

let passed = 0, failed = 0;
const failures = [];
const issues = [];
function assertEq(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed += 1; console.log(`  PASS  ${label}`); }
  else { failed += 1; const m = `  FAIL  ${label}\n        expected: ${JSON.stringify(expected)}\n        actual:   ${JSON.stringify(actual)}`; failures.push(m); console.log(m); }
}
function assertTrue(cond, label) {
  if (cond) { passed += 1; console.log(`  PASS  ${label}`); }
  else { failed += 1; const m = `  FAIL  ${label}`; failures.push(m); console.log(m); }
}
function section(name) { console.log(`\n[${name}]`); }
function reportIssue(severity, label, detail) {
  issues.push({ severity, label, detail });
  console.log(`  ISSUE [${severity}] ${label} — ${detail}`);
}

// ── HIGH-1 확장: 다른 from/to 조합 ────────────────────────────────
section('HIGH-1 확장: moveTile from=set → to=잘못된 kind → 보드 타일 유실 확인');
{
  const g = createGame();
  const D = {
    a1: { id: 'a1', kind: 'num', color: 'red', number: 5 },
    a2: { id: 'a2', kind: 'num', color: 'blue', number: 5 },
    a3: { id: 'a3', kind: 'num', color: 'black', number: 5 },
  };
  Object.assign(g.tiles, D);
  g.played.p1 = true;
  g.board = [{ id: 'set_a', type: 'group', tiles: ['a1', 'a2', 'a3'] }];
  g.hands.p1 = [];
  g.turnSnapshot = {
    board: [{ id: 'set_a', type: 'group', tiles: ['a1', 'a2', 'a3'] }],
    hands: { p1: [], p2: g.hands.p2.slice() },
    nextSetSeq: g.nextSetSeq,
    jokerReturnedThisTurn: {},
  };
  // from=set_a tile=a1 → to.kind='bad_kind'.
  const r = moveTile(g, 'p1', { kind: 'set', setId: 'set_a', tileId: 'a1' }, { kind: 'bad_kind' });
  assertEq(r.ok, false, '잘못된 to.kind → 거부');
  // a1이 보드에 남아있어야 함.
  if (!g.board[0].tiles.includes('a1')) {
    reportIssue('HIGH', 'moveTile set→bad_kind 보드 타일 유실',
      'from.kind=set에서 tileId 제거 후 to.kind 라우터에서 잘못된 kind를 만나면 보드 타일이 유실됨. game.js:419-432. 손에도 없고 보드에도 없어 영원히 사라짐.');
  }
  assertTrue(g.board[0].tiles.includes('a1'), '보드 a1 복구되어야 함');
}

section('HIGH-1 확장 2: moveTile from=set → to=set(없는 setId) → 유실 확인');
{
  const g = createGame();
  const D = {
    a1: { id: 'a1', kind: 'num', color: 'red', number: 5 },
    a2: { id: 'a2', kind: 'num', color: 'blue', number: 5 },
    a3: { id: 'a3', kind: 'num', color: 'black', number: 5 },
  };
  Object.assign(g.tiles, D);
  g.played.p1 = true;
  g.board = [{ id: 'set_a', type: 'group', tiles: ['a1', 'a2', 'a3'] }];
  g.hands.p1 = [];
  g.turnSnapshot = {
    board: [{ id: 'set_a', type: 'group', tiles: ['a1', 'a2', 'a3'] }],
    hands: { p1: [], p2: g.hands.p2.slice() },
    nextSetSeq: g.nextSetSeq,
    jokerReturnedThisTurn: {},
  };
  // from=set_a tile=a1 → to=set nonexistent.
  const r = moveTile(g, 'p1', { kind: 'set', setId: 'set_a', tileId: 'a1' }, { kind: 'set', setId: 'nonexistent' });
  assertEq(r.ok, false, '없는 to.setId → 거부');
  if (!g.board[0].tiles.includes('a1')) {
    reportIssue('HIGH', 'moveTile set→없는 setId 보드 타일 유실',
      'from.kind=set에서 tileId 제거 후 to=set이지만 setId가 없을 때 보드 타일 유실. game.js:422-424.');
  }
  assertTrue(g.board[0].tiles.includes('a1'), '보드 a1 복구되어야 함');
}

section('HIGH-1 확장 3: moveTile from=hand → to=set(없는 setId) → 손 타일 유실');
{
  const g = createGame();
  const D = { a1: { id: 'a1', kind: 'num', color: 'red', number: 5 } };
  Object.assign(g.tiles, D);
  g.hands.p1 = ['a1'];
  g.turnSnapshot = {
    board: [],
    hands: { p1: ['a1'], p2: g.hands.p2.slice() },
    nextSetSeq: g.nextSetSeq,
    jokerReturnedThisTurn: {},
  };
  const r = moveTile(g, 'p1', { kind: 'hand', tileId: 'a1' }, { kind: 'set', setId: 'nonexistent' });
  assertEq(r.ok, false, '없는 to.setId → 거부');
  if (!g.hands.p1.includes('a1')) {
    reportIssue('HIGH', 'moveTile hand→없는 setId 손 타일 유실',
      'from.kind=hand에서 tileId 제거 후 to=set이지만 setId가 없을 때 손 타일 유실. game.js:422-424.');
  }
  assertTrue(g.hands.p1.includes('a1'), '손 a1 복구되어야 함');
}

// ── HIGH-2 (정정): 봇 vs 봇 데드락 X — 별도 longrun 슈트로 검증 ─────
//   bot-vs-bot-repeat.test.js에서 5분 × 3회 시뮬: 모두 189s 전후 deck_empty_pass 정상 종료.
//   본 슈트의 180s timeout은 너무 짧아 false positive 발생. 정정해서 30초 진행 검증만 수행.
section('HIGH-2: 봇 vs 봇 — 데드락 없음 (30초 내 ≥5턴 진행) — 장시간 종료는 bot-vs-bot-repeat.test.js');
{
  // 단순 모니터링이 아니라 통계: 각 턴 reason, deck size 추이.
  const PORT = 3110;
  const app = createApp({
    hostUrl: '',
    getBotUrl: () => `ws://localhost:${PORT}/ws?mode=bot`,
  });
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((res, rej) => { server.once('error', rej); server.listen(PORT, '127.0.0.1', res); });

  // bot 2개 spawn — 단, stdio=pipe로 잡아서 deck/commit 진행 분석.
  const { spawn } = await import('node:child_process');
  const path = await import('node:path');
  const url = await import('node:url');
  const __filename = url.fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const botPath = path.join(__dirname, '..', 'bot.js');
  const bot1 = spawn(process.execPath, [botPath, '--url', `ws://localhost:${PORT}/ws?mode=bot`], { stdio: 'pipe' });
  const bot2 = spawn(process.execPath, [botPath, '--url', `ws://localhost:${PORT}/ws?mode=bot`], { stdio: 'pipe' });

  let turnCount = 0;
  const origLog = console.log;
  console.log = (...args) => {
    const line = args.map((a) => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
    origLog(...args);
    if (line.match(/END_TURN: (p1|p2) committed=/)) turnCount += 1;
  };

  // 30초 동안 진행 확인.
  await new Promise((r) => setTimeout(r, 30000));
  console.log = origLog;

  if (turnCount >= 5) {
    assertTrue(true, `봇 vs 봇 진행 정상 (30초 내 ${turnCount}턴 발생)`);
  } else {
    assertTrue(false, `봇 vs 봇 데드락 의심 (${turnCount}턴만 발생)`);
    reportIssue('HIGH', '봇 vs 봇 데드락', `30초 동안 ${turnCount}턴만 발생 — 봇이 STATE 수신 후 행동을 안 하거나 무한 대기 상태.`);
  }

  bot1.kill();
  bot2.kill();
  await new Promise((r) => setTimeout(r, 500));
  await new Promise((r) => server.close(r));
}

console.log('\n════════════════════════════════════════');
console.log(`테스트: ${passed + failed}건 / PASS=${passed} / FAIL=${failed}`);
console.log(`발견된 이슈: ${issues.length}건`);
if (issues.length > 0) {
  console.log('\n[이슈 목록]');
  for (const i of issues) {
    console.log(`  [${i.severity}] ${i.label}`);
    console.log(`    ${i.detail}`);
  }
}
if (failed > 0) process.exit(1);
else { console.log('\n모든 후속 검증 통과 (이슈는 별도 보고).'); process.exit(0); }
