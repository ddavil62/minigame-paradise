/**
 * @fileoverview 런처 대기실 → REDIRECT(matchId) → 게임 WS 입장 통합 검증.
 * prepareMatch를 가진 모든 게임에 대해 (1) 첫 대기실의 두 사람이 게임에 들어가 대기 화면에 남고,
 * (2) 같은 게임의 새 대기실이 시작되면 옛 접속자가 4001로 정리되고, (3) 새 두 사람이 서로 입장하는지 확인한다.
 * 실행: node tests/launcher-match-prepare.integration.mjs [gameId ...]
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import WebSocket from 'ws';
import fs from 'node:fs';

const games = JSON.parse(fs.readFileSync(new URL('../launcher/public/games.json', import.meta.url), 'utf8'));
const only = process.argv.slice(2);
const targets = games.filter((g) => !['tetris-battle', 'mahjong'].includes(g.id) && (!only.length || only.includes(g.id)));

const reservePort = async () => {
  const s = http.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
};
const port = await reservePort();
const child = spawn(process.execPath, ['launcher/server.js', '--port', String(port)], {
  cwd: new URL('..', import.meta.url), stdio: 'ignore',
});
for (let i = 0; i < 200; i++) {
  try { if ((await fetch(`http://127.0.0.1:${port}/`)).ok) break; } catch { /* retry */ }
  await new Promise((r) => setTimeout(r, 50));
}

function open(url) {
  const ws = new WebSocket(url);
  const c = { ws, msgs: [], closeCode: null };
  ws.on('message', (d) => { try { c.msgs.push(JSON.parse(d.toString())); } catch { /* ignore */ } });
  ws.on('close', (code) => { c.closeCode = code; });
  return new Promise((res, rej) => { ws.once('open', () => res(c)); ws.once('error', rej); });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = fn(); if (v) return v; await wait(25); }
  return null;
}

/** 대기실에서 n명이 준비해 REDIRECT를 받는다. */
async function lobby(game, n, tag) {
  const clients = [];
  for (let i = 0; i < n; i++) {
    const c = await open(`ws://127.0.0.1:${port}/lobby/ws?gameId=${game.id}`);
    c.ws.send(JSON.stringify({ type: 'JOIN', name: `${tag}${i}` }));
    clients.push(c);
  }
  await wait(100);
  for (const c of clients) c.ws.send(JSON.stringify({ type: 'READY' }));
  const redirects = [];
  for (const c of clients) {
    const r = await until(() => c.msgs.find((m) => m.type === 'REDIRECT' || (m.type === 'ERROR' && m.code === 'game_busy')));
    redirects.push(r);
  }
  clients.forEach((c) => c.ws.close());
  return redirects;
}

async function enter(game, redirect, name) {
  const page = new URL(redirect.path, 'http://x');
  const q = new URLSearchParams();
  q.set('mode', 'human');
  const matchId = page.searchParams.get('matchId');
  if (matchId) q.set('matchId', matchId);
  if (redirect.role) q.set('role', redirect.role);
  q.set('name', name);
  return open(`ws://127.0.0.1:${port}${game.wsPath}?${q}`);
}

let failed = 0;
for (const game of targets) {
  const n = Math.max(2, game.minPlayers || 2);
  const label = `${game.id}(${n}p)`;
  try {
    const r1 = await lobby(game, n, 'old');
    if (r1.some((r) => !r || r.type !== 'REDIRECT')) throw new Error('첫 대기실 REDIRECT 실패');
    const ghosts = [];
    for (const [i, r] of r1.entries()) ghosts.push(await enter(game, r, `old${i}`));
    await wait(300);
    if (ghosts.some((g) => g.closeCode !== null)) throw new Error(`첫 매치 접속자가 입장 직후 거절됨: ${ghosts.map((g) => g.closeCode)}`);

    const r2 = await lobby(game, n, 'new');
    if (r2.some((r) => !r || r.type !== 'REDIRECT')) throw new Error(`두 번째 대기실이 막힘: ${JSON.stringify(r2.map((r) => r && (r.code || r.type)))}`);
    const id1 = new URL(r1[0].path, 'http://x').searchParams.get('matchId');
    const id2 = new URL(r2[0].path, 'http://x').searchParams.get('matchId');
    if (!id1 || !id2 || id1 === id2) throw new Error('matchId가 REDIRECT에 없거나 재사용됨');
    const fresh = [];
    for (const [i, r] of r2.entries()) fresh.push(await enter(game, r, `new${i}`));
    await wait(500);

    const ghostCodes = ghosts.map((g) => g.closeCode);
    if (ghostCodes.some((c) => c !== 4001)) throw new Error(`옛 접속자가 4001로 정리되지 않음: ${ghostCodes}`);
    const bad = fresh.filter((f) => f.closeCode !== null || f.msgs.some((m) => m.code === 'invalid_match' || m.code === 'room_full' || m.code === 'ROOM_FULL'));
    if (bad.length) throw new Error(`새 접속자가 거절됨: ${JSON.stringify(bad.map((f) => [f.closeCode, f.msgs.filter((m) => m.type === 'ERROR')]))}`);
    fresh.forEach((f) => f.ws.close());
    console.log(`PASS ${label}`);
  } catch (err) {
    failed++;
    console.log(`FAIL ${label}: ${err.message}`);
  }
}
child.kill();
console.log(failed ? `\n실패 ${failed}건` : '\n모두 통과');
process.exit(failed ? 1 : 0);
