/**
 * @fileoverview 봇 vs 봇 3회 반복 시뮬레이션 — 게임 종료 보장 + 데드락 X 검증.
 *
 * 각 게임 최대 6분. 3회 모두 정상 종료(deck_empty_pass 또는 empty_hand)면 PASS.
 */

import http from 'node:http';
import { createApp } from '../server.js';

const RUNS = 3;
const TIMEOUT_PER_RUN_MS = 360000; // 6분

let allOk = true;
const results = [];

for (let run = 1; run <= RUNS; run++) {
  console.log(`\n════════ RUN ${run}/${RUNS} ════════`);
  const PORT = 3140 + run;
  const app = createApp({
    hostUrl: '',
    getBotUrl: () => `ws://localhost:${PORT}/ws?mode=bot`,
  });
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((res, rej) => { server.once('error', rej); server.listen(PORT, '127.0.0.1', res); });

  let gameOver = false;
  let gameOverInfo = '';
  let stats = { totalTurns: 0, commits: 0, noChange: 0, drews: 0 };

  const origLog = console.log;
  console.log = (...args) => {
    const line = args.map((a) => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
    origLog(...args);
    const m = line.match(/END_TURN: (p1|p2) committed=(true|false) reason=(\w+)/);
    if (m) {
      stats.totalTurns += 1;
      if (m[2] === 'true') stats.commits += 1;
      else if (m[3] === 'no_change') stats.noChange += 1;
    }
    if (line.includes('drew=')) stats.drews += 1;
    if (line.includes('GAME_OVER') || line.includes('게임 종료')) {
      gameOver = true;
      gameOverInfo = line;
    }
  };

  const { spawn } = await import('node:child_process');
  const path = await import('node:path');
  const url = await import('node:url');
  const __filename = url.fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const botPath = path.join(__dirname, '..', 'bot.js');
  const bot1 = spawn(process.execPath, [botPath, '--url', `ws://localhost:${PORT}/ws?mode=bot`], { stdio: 'pipe' });
  const bot2 = spawn(process.execPath, [botPath, '--url', `ws://localhost:${PORT}/ws?mode=bot`], { stdio: 'pipe' });
  bot1.stdout.on('data', (d) => {
    const s = d.toString();
    if (s.includes('GAME_OVER') || s.includes('게임 종료')) { gameOver = true; gameOverInfo = s; }
  });
  bot2.stdout.on('data', (d) => {
    const s = d.toString();
    if (s.includes('GAME_OVER') || s.includes('게임 종료')) { gameOver = true; gameOverInfo = s; }
  });

  const startMs = Date.now();
  while (!gameOver && Date.now() - startMs < TIMEOUT_PER_RUN_MS) {
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log = origLog;
  const elapsed = Date.now() - startMs;
  results.push({ run, elapsed, gameOver, stats: { ...stats }, info: gameOverInfo.slice(0, 200) });
  if (!gameOver) allOk = false;

  bot1.kill();
  bot2.kill();
  await new Promise((r) => setTimeout(r, 500));
  await new Promise((r) => server.close(r));
  await new Promise((r) => setTimeout(r, 300));
}

console.log('\n════════ 전체 결과 ════════');
for (const r of results) {
  console.log(`RUN ${r.run}: ${r.gameOver ? 'OK' : 'TIMEOUT'} — ${(r.elapsed / 1000).toFixed(1)}s, turns=${r.stats.totalTurns}, commits=${r.stats.commits}, drews=${r.stats.drews}, reason=${r.info.replace(/\n.*/g, '').slice(0, 100)}`);
}
console.log(`\n전체 PASS=${allOk ? 'PASS' : 'FAIL'}`);
process.exit(allOk ? 0 : 1);
