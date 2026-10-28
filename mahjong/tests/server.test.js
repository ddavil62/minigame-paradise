/**
 * @fileoverview 서버 통합 테스트: 실제 WebSocket으로 접속해 방 설정 → AI 채우기 → 대국 진행을 검증한다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocket } from 'ws';
import { createApp } from '../server.js';
import { decide } from '../lib/ai.js';
import { seededRng } from '../lib/tiles.js';

const FAST = {
  baseMs: 400, bankMs: 400, reactionMs: 400, ackMs: 300,
  aiTurnMs: [0, 3], aiReactionMs: [0, 3], aiAckMs: [0, 3], awayMs: 5,
  lobbyGraceMs: 150, emptyResetMs: 150,
};

async function boot(timing = FAST) {
  const app = createApp({ timing, rng: seededRng(11) });
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return {
    app,
    port,
    close: () => { app.close(); server.close(); },
  };
}

/** 사람 대신 AI 로직으로 행동하는 테스트 클라이언트 */
function client(port, { key, name, play = true, level = 'normal' }, t) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/mahjong/ws?key=${key}&name=${encodeURIComponent(name)}`);
  const c = { ws, room: null, state: null, joined: null, errors: [], states: 0, hints: null, events: [] };
  let lastSig = '';
  c.send = (m) => ws.send(JSON.stringify(m));
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type === 'JOINED') c.joined = msg;
    else if (msg.type === 'ROOM') c.room = msg;
    else if (msg.type === 'ERROR') c.errors.push(msg);
    else if (msg.type === 'STATE') {
      c.state = msg;
      c.states++;
      if (msg.hints) c.hints = msg.hints;
      c.events.push(...msg.events);
      const v = msg.view;
      const sig = `${v.handNo}|${v.phase}|${v.turn}|${v.myHand.join()}|${v.myDrawn}|${v.players.map((p) => p.discards.length + p.melds.length).join()}|${v.legal?.kind}`;
      if (play && v.legal && sig !== lastSig) {
        lastSig = sig;
        const action = decide(v, { level });
        if (action) c.send({ type: 'ACT', action });
      }
    }
  });
  c.opened = new Promise((r) => ws.on('open', r));
  if (t) t.after(() => ws.terminate());
  return c;
}

const until = async (fn, ms = 20000) => {
  const t = Date.now();
  while (Date.now() - t < ms) {
    const v = fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error('timeout');
};

test('혼자 + AI 3명: 시작하면 AI가 채워지고 대국이 끝까지 진행된다', async (t) => {
  const srv = await boot();
  t.after(srv.close);
  const a = client(srv.port, { key: 'ka', name: '나' }, t);
  t.after(() => a.ws.terminate());
  await until(() => a.room);
  assert.equal(a.joined.seat, 0);
  assert.equal(a.room.isHost, true);
  assert.deepEqual(a.room.seats.map((s) => s.type), ['human', 'empty', 'empty', 'empty']);
  a.send({ type: 'CONFIG', settings: { length: 'east', aiLevel: 'hard', aka: false } });
  await until(() => a.room.settings.aiLevel === 'hard' && a.room.settings.aka === false);
  a.send({ type: 'START' });
  await until(() => a.state);
  assert.deepEqual(a.state.seats.map((s) => s.type), ['human', 'ai', 'ai', 'ai']);
  assert.ok(a.state.seats[1].name);
  await until(() => a.state.view.final, 60000);
  assert.ok(a.state.view.final.ranking.length === 4);
  assert.equal(a.state.view.scores.reduce((x, y) => x + y, 0) + a.state.view.kyotaku * 1000, 100000);
  assert.deepEqual(a.errors, []);
  a.ws.close();
  srv.close();
});

test('친구와 + AI 2명: 두 사람은 마주 보는 자리(동·서)에 앉는다', async (t) => {
  const srv = await boot();
  t.after(srv.close);
  const a = client(srv.port, { key: 'k1', name: '나' }, t);
  const b = client(srv.port, { key: 'k2', name: '도윤' }, t);
  t.after(() => { a.ws.terminate(); b.ws.terminate(); });
  await until(() => a.room && b.room && a.room.seats[2].type === 'human');
  assert.equal(a.joined.seat, 0);
  assert.equal(b.joined.seat, 2);
  assert.equal(b.room.isHost, false);
  b.send({ type: 'START' });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(a.state, null, '호스트만 시작할 수 있다');
  a.send({ type: 'START' });
  await until(() => a.state && b.state);
  assert.deepEqual(a.state.seats.map((s) => s.type), ['human', 'ai', 'human', 'ai']);
  await until(() => a.state.view.final && b.state.view.final, 90000);
  assert.deepEqual(a.errors, []);
  assert.deepEqual(b.errors, []);
  a.ws.close();
  b.ws.close();
  srv.close();
});

test('상대 손패는 STATE에 담기지 않는다', async (t) => {
  const srv = await boot();
  t.after(srv.close);
  const a = client(srv.port, { key: 'kx', name: '나', play: false }, t);
  await until(() => a.room);
  a.send({ type: 'START' });
  await until(() => a.state);
  const text = JSON.stringify(a.state);
  assert.equal(text.includes('"hands"'), false);
  assert.equal(a.state.view.players[1].handCount, 13);
  assert.equal(a.state.view.myHand.length + (a.state.view.myDrawn != null ? 1 : 0) >= 13, true);
  a.ws.close();
  srv.close();
});

test('도우미: 켜면 향청수와 추천 버림이 오고 끄면 오지 않는다', async (t) => {
  const srv = await boot({ ...FAST, aiTurnMs: [150, 200], baseMs: 5000 });
  t.after(srv.close);
  const a = client(srv.port, { key: 'kh', name: '나', play: false }, t);
  await until(() => a.room);
  a.send({ type: 'START' });
  await until(() => a.state?.view?.legal?.kind === 'turn');
  assert.equal(a.state.hints, null);
  a.send({ type: 'ASSIST', on: true });
  await until(() => a.state.hints && a.state.hints.best.length > 0);
  assert.ok(Number.isInteger(a.state.hints.shanten));
  a.send({ type: 'ASSIST', on: false });
  await until(() => a.state.hints === null);
  a.ws.close();
  srv.close();
});

test('불법 행동은 거절되고 ERROR가 오며 상태는 유지된다', async (t) => {
  const srv = await boot({ ...FAST, aiTurnMs: [150, 200], baseMs: 5000 });
  t.after(srv.close);
  const a = client(srv.port, { key: 'ke', name: '나', play: false }, t);
  await until(() => a.room);
  a.send({ type: 'START' });
  await until(() => a.state?.view?.legal?.kind === 'turn');
  a.send({ type: 'ACT', action: { type: 'discard', id: 9999 } });
  a.send({ type: 'ACT', action: { type: 'tsumo' } });
  await until(() => a.errors.length >= 2);
  assert.equal(a.state.view.legal.kind, 'turn');
  a.ws.close();
  srv.close();
});

test('타임아웃이면 자동으로 쯔모기리하고 연속 타임아웃 시 자동 진행으로 전환된다', async (t) => {
  const srv = await boot({ ...FAST, baseMs: 80, bankMs: 0, reactionMs: 80 });
  t.after(srv.close);
  const a = client(srv.port, { key: 'kt', name: '나', play: false }, t);
  await until(() => a.room);
  a.send({ type: 'START' });
  await until(() => a.state);
  await until(() => a.state.view.handNo >= 1 && a.state.view.players[0].discards.length >= 3, 15000);
  const slot = srv.app._room.slots[0];
  assert.ok(slot.autoPlay, '2회 연속 시간 초과 후 자동 진행');
  a.ws.close();
  srv.close();
});

test('끊겼다가 같은 키로 재접속하면 같은 자리와 상태를 이어받는다', async (t) => {
  const srv = await boot({ ...FAST, aiTurnMs: [100, 150], baseMs: 5000 });
  t.after(srv.close);
  const a = client(srv.port, { key: 'kr', name: '나', play: false }, t);
  await until(() => a.room);
  a.send({ type: 'START' });
  await until(() => a.state?.view?.legal?.kind === 'turn');
  const hand = a.state.view.myHand.slice();
  a.ws.close();
  await new Promise((r) => setTimeout(r, 40));
  const b = client(srv.port, { key: 'kr', name: '나', play: false }, t);
  await until(() => b.state);
  assert.equal(b.joined.seat, 0);
  assert.deepEqual(b.state.view.myHand, hand);
  b.ws.close();
  srv.close();
});

test('대국 중 다른 사람은 입장할 수 없다', async (t) => {
  const srv = await boot({ ...FAST, aiTurnMs: [100, 150], baseMs: 5000 });
  t.after(srv.close);
  const a = client(srv.port, { key: 'k1', name: '나', play: false }, t);
  await until(() => a.room);
  a.send({ type: 'START' });
  await until(() => a.state);
  const b = client(srv.port, { key: 'k2', name: '손님', play: false }, t);
  await until(() => b.errors.length > 0);
  assert.equal(b.errors[0].code, 'in_progress');
  a.ws.close();
  srv.close();
});

test('정적 파일과 경로 탈출 방어', async (t) => {
  const srv = await boot();
  t.after(srv.close);
  const get = (p) => new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port: srv.port, path: p }, (res) => { res.resume(); resolve(res.statusCode); });
  });
  assert.ok([403, 404].includes(await get('/../server.js')));
  assert.ok([403, 404].includes(await get('/%2e%2e/server.js')));
  assert.equal(await get('/nope.html'), 404);
  srv.close();
});
