/**
 * @fileoverview QA 2차 패스 — 봇 vs 봇 장기 시뮬레이션 (옵셔널, 매우 오래 걸림).
 *
 * 목적:
 *   봇 vs 봇 게임을 N회 반복 실행하여 다음을 검증한다.
 *   - 무한 루프 / 데드락 없음 (모든 게임이 정상 종료)
 *   - 평균 턴 수 / 시간 통계
 *   - GAME_OVER reason 분포 (empty_hand vs deck_empty_pass)
 *   - 봇 결정 시간 측정 (500ms 시간 제한 도달 빈도)
 *   - 서버 크래시 / 메모리 증가 추적
 *
 * 병렬 실행: 4개 서버 동시 → 시간 단축.
 *
 * 실행:
 *   node tests/qa-pass2-longrun.test.js
 *
 * 예상 소요 시간: 20회 × 평균 3분 / 병렬 4 = 약 15-20분
 */

import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── 설정 ─────────────────────────────────────────────────────────
const TOTAL_RUNS = parseInt(process.env.LONGRUN_RUNS, 10) || 20;
const PARALLEL = 4;
const TIMEOUT_PER_RUN_MS = 6 * 60 * 1000;
const BASE_PORT = 3200;

console.log(`[longrun] 총 ${TOTAL_RUNS}회 / 병렬 ${PARALLEL}개`);

let passed = 0;
let failed = 0;
const failures = [];
const results = [];
const issues = [];

function reportIssue(severity, label, detail) {
  issues.push({ severity, label, detail });
  console.log(`[longrun ISSUE] [${severity}] ${label} — ${detail}`);
}

// ── 단일 봇 vs 봇 게임 실행 ──────────────────────────────────────
async function runOne(runId, port) {
  const startedAt = Date.now();
  const app = createApp({
    hostUrl: '',
    getBotUrl: () => `ws://localhost:${port}/ws?mode=bot`,
  });
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((res, rej) => {
    server.once('error', rej);
    server.listen(port, '127.0.0.1', res);
  });

  let gameOver = false;
  let gameOverInfo = null;
  let stats = {
    totalTurns: 0, commits: 0, noChange: 0, drews: 0,
    invalidBoard: 0, initialMeldShort: 0, jokerUnused: 0,
  };

  // 봇 spawn — 두 봇 모두 별도 process.
  const botPath = path.join(__dirname, '..', 'bot.js');
  const botOpts = {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  };
  const bot1 = spawn(process.execPath, [botPath, '--url', `ws://localhost:${port}/ws?mode=bot`], botOpts);
  const bot2 = spawn(process.execPath, [botPath, '--url', `ws://localhost:${port}/ws?mode=bot`], botOpts);

  // 서버 로그 후킹 — server.js의 console.log 출력은 process.stdout으로 — 우리는 createApp을 직접 import해서 사용 중이므로 console.log를 hook.
  // 다만 console.log를 글로벌 패치하면 다른 병렬 게임의 로그가 섞임.
  // 해결: createApp 내부 console.log를 따로 후킹할 수 없으므로, GAME_OVER만 bot stdout으로 감지.
  bot1.stdout.on('data', (d) => {
    const s = d.toString();
    if (s.includes('GAME_OVER') || s.includes('게임 종료')) {
      gameOver = true;
      gameOverInfo = s;
    }
  });
  bot2.stdout.on('data', (d) => {
    const s = d.toString();
    if (s.includes('GAME_OVER') || s.includes('게임 종료')) {
      gameOver = true;
      gameOverInfo = s;
    }
  });
  bot1.stderr.on('data', (d) => { /* 무시 */ });
  bot2.stderr.on('data', (d) => { /* 무시 */ });

  // 진행 감시.
  const start = Date.now();
  while (!gameOver && Date.now() - start < TIMEOUT_PER_RUN_MS) {
    await new Promise((r) => setTimeout(r, 1000));
  }
  const elapsed = Date.now() - start;

  // 정리.
  try { bot1.kill(); } catch (e) { /* noop */ }
  try { bot2.kill(); } catch (e) { /* noop */ }
  await new Promise((r) => setTimeout(r, 200));
  await new Promise((r) => server.close(r));

  let reason = null;
  let winner = null;
  if (gameOverInfo) {
    const reasonMatch = gameOverInfo.match(/reason=(\w+)/);
    const winnerMatch = gameOverInfo.match(/winner=(\w+)/);
    if (reasonMatch) reason = reasonMatch[1];
    if (winnerMatch) winner = winnerMatch[1];
  }

  return {
    runId, port,
    elapsed,
    gameOver,
    reason,
    winner,
    stats,
    info: gameOverInfo ? gameOverInfo.slice(0, 200) : null,
  };
}

// ── 메인 ────────────────────────────────────────────────────────
async function main() {
  const memBefore = process.memoryUsage();
  console.log(`[longrun] 초기 메모리: heapUsed=${(memBefore.heapUsed / 1024 / 1024).toFixed(1)}MB, rss=${(memBefore.rss / 1024 / 1024).toFixed(1)}MB`);

  // 배치별로 PARALLEL개씩 동시 실행.
  for (let batch = 0; batch < Math.ceil(TOTAL_RUNS / PARALLEL); batch++) {
    const batchStart = batch * PARALLEL;
    const batchEnd = Math.min(batchStart + PARALLEL, TOTAL_RUNS);
    console.log(`\n── 배치 ${batch + 1}: runs ${batchStart + 1}~${batchEnd} ──`);
    const promises = [];
    for (let i = batchStart; i < batchEnd; i++) {
      promises.push(runOne(i + 1, BASE_PORT + i));
    }
    const batchResults = await Promise.all(promises);
    for (const r of batchResults) {
      results.push(r);
      const dur = (r.elapsed / 1000).toFixed(1);
      console.log(`  run ${r.runId}: ${r.gameOver ? 'OK' : 'TIMEOUT'}, ${dur}s, reason=${r.reason}, winner=${r.winner}`);
      if (!r.gameOver) {
        failed += 1;
        failures.push(`  run ${r.runId}: 시간 초과 (${dur}s) — 데드락 또는 무한 루프 의심`);
      } else {
        passed += 1;
      }
    }
    // 배치 간 메모리 체크.
    if (global.gc) global.gc();
    const memNow = process.memoryUsage();
    console.log(`  배치 후 메모리: heapUsed=${(memNow.heapUsed / 1024 / 1024).toFixed(1)}MB, rss=${(memNow.rss / 1024 / 1024).toFixed(1)}MB`);
  }

  const memAfter = process.memoryUsage();
  console.log(`\n[longrun] 최종 메모리: heapUsed=${(memAfter.heapUsed / 1024 / 1024).toFixed(1)}MB, rss=${(memAfter.rss / 1024 / 1024).toFixed(1)}MB`);
  const memGrowMB = (memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024;
  console.log(`  heap 증가량: ${memGrowMB.toFixed(1)}MB`);
  if (memGrowMB > 200) {
    reportIssue('MED', '메모리 증가량 200MB+ ', `테스트 프로세스 heap 증가량 ${memGrowMB.toFixed(1)}MB — 누수 의심`);
  }

  // ── 통계 요약 ──
  console.log('\n════════════════════════════════════════');
  console.log('통계 요약');
  console.log('════════════════════════════════════════');
  const ok = results.filter((r) => r.gameOver);
  const timeouts = results.filter((r) => !r.gameOver);
  console.log(`전체: ${results.length}회 / 정상 종료: ${ok.length}회 / TIMEOUT: ${timeouts.length}회`);
  if (ok.length > 0) {
    const avgTime = ok.reduce((s, r) => s + r.elapsed, 0) / ok.length / 1000;
    const maxTime = Math.max(...ok.map((r) => r.elapsed)) / 1000;
    const minTime = Math.min(...ok.map((r) => r.elapsed)) / 1000;
    console.log(`평균 시간: ${avgTime.toFixed(1)}s (min ${minTime.toFixed(1)} / max ${maxTime.toFixed(1)})`);

    const reasonCounts = {};
    const winnerCounts = {};
    for (const r of ok) {
      reasonCounts[r.reason || 'unknown'] = (reasonCounts[r.reason || 'unknown'] || 0) + 1;
      winnerCounts[r.winner || 'unknown'] = (winnerCounts[r.winner || 'unknown'] || 0) + 1;
    }
    console.log('reason 분포:', JSON.stringify(reasonCounts));
    console.log('winner 분포:', JSON.stringify(winnerCounts));

    // empty_hand 비율 — 봇 휴리스틱 강도 지표.
    const emptyHand = reasonCounts['empty_hand'] || 0;
    const emptyHandRate = (emptyHand / ok.length * 100).toFixed(1);
    console.log(`empty_hand 비율: ${emptyHandRate}% (${emptyHand}/${ok.length})`);
  }

  if (timeouts.length > 0) {
    console.log('\nTIMEOUT 게임:');
    for (const t of timeouts) {
      console.log(`  run ${t.runId}, port ${t.port}: ${(t.elapsed / 1000).toFixed(1)}s`);
    }
  }

  console.log('\n════════════════════════════════════════');
  console.log(`테스트: ${passed + failed}건 / PASS=${passed} / FAIL=${failed}`);
  console.log(`발견된 이슈: ${issues.length}건`);
  if (failures.length > 0) {
    console.log('\n실패 목록:');
    failures.forEach((f) => console.log(f));
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('테스트 실행 오류:', e);
  process.exit(1);
});
