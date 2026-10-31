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
  baseMs: 400, bankMs: 400, reactionMs: 400,
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
function client(port, { key, name, play = true, level = 'normal', role = '', holdAck = false, room = '' }, t) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/mahjong/ws?key=${key}&name=${encodeURIComponent(name)}${role ? `&role=${role}` : ''}${room ? `&room=${room}` : ''}`);
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
      if (play && v.legal && !(holdAck && v.legal.kind === 'ack') && sig !== lastSig) {
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

test('런처 대기실 호스트(role=p1)가 늦게 접속해도 방장이 된다', async (t) => {
  const srv = await boot();
  t.after(srv.close);
  const guest = client(srv.port, { key: 'g1', name: '도윤', role: 'p2', play: false }, t);
  await until(() => guest.room && guest.room.isHost);
  const host = client(srv.port, { key: 'h1', name: '서윤', role: 'p1', play: false }, t);
  await until(() => host.room && guest.room.seats[2]?.type === 'human' && host.room.isHost);
  assert.equal(host.joined.host, true);
  assert.equal(guest.room.isHost, false);
  const third = client(srv.port, { key: 'x1', name: '끼어듦', role: 'p1', play: false }, t);
  await until(() => third.room);
  assert.equal(third.room.isHost, false, '방장 가져가기는 최초 1회만 인정한다');
  assert.equal(host.room.isHost, true);
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

test('국 결과 확인은 시간이 지나도 넘어가지 않고 사람이 직접 눌러야 넘어간다', async (t) => {
  const srv = await boot();
  t.after(srv.close);
  const a = client(srv.port, { key: 'kack', name: '나', holdAck: true }, t);
  await until(() => a.room);
  a.send({ type: 'START' });
  await until(() => a.state?.view.phase === 'ack' && a.state.view.result, 60000);
  const handNo = a.state.view.handNo;
  // 접속 중인 사람의 확인 타이머는 만들지 않으므로 여러 타이머 주기가 지나도 그대로여야 한다.
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(a.state.view.phase, 'ack');
  assert.equal(a.state.view.handNo, handNo);
  assert.equal(a.state.timers.length, 0, '결과 확인에는 카운트다운이 없다');
  a.send({ type: 'ACT', action: { type: 'next' } });
  await until(() => a.state.view.handNo !== handNo || a.state.view.phase === 'over', 10000);
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

test('다시 하기: 방장이 누르면 게스트도 연결과 자리를 유지한 채 방 설정으로 돌아온다', async (t) => {
  const srv = await boot();
  t.after(srv.close);
  const a = client(srv.port, { key: 'rm-a', name: '방장', role: 'p1' }, t);
  await until(() => a.room);
  const b = client(srv.port, { key: 'rm-b', name: '손님' }, t);
  await until(() => b.room && b.room.seats.filter((s) => s.type === 'human').length === 2);
  let closed = null;
  b.ws.on('close', (code, reason) => { closed = { code, reason: reason.toString() }; });
  a.send({ type: 'CONFIG', settings: { length: 'east' } });
  a.send({ type: 'START' });
  await until(() => a.state && b.state);
  await until(() => a.state.view.final && b.state.view.final, 90000);
  a.send({ type: 'REMATCH' });
  await until(() => a.room.phase === 'lobby' && b.room.phase === 'lobby');
  assert.equal(closed, null, '게스트 연결이 끊기면 안 된다');
  assert.equal(b.ws.readyState, WebSocket.OPEN);
  assert.equal(b.room.seats.filter((s) => s.type === 'human').length, 2);
  assert.equal(b.room.isHost, false);
  assert.deepEqual(b.errors, []);
});

test('일시정지: 타이머와 행동이 멈추고, 아무나 재개하면 남은 시간부터 이어진다', async (t) => {
  const srv = await boot({ ...FAST, baseMs: 600, bankMs: 0, aiTurnMs: [0, 3] });
  t.after(srv.close);
  const a = client(srv.port, { key: 'kp1', name: '가', play: false }, t);
  const b = client(srv.port, { key: 'kp2', name: '나', play: false }, t);
  await until(() => a.room && b.room && a.room.seats[2].type === 'human');
  a.send({ type: 'START' });
  await until(() => a.state && b.state);
  // 동(좌석 0) 차례: 시간 제한이 돌고 있다.
  await until(() => a.state.view.legal?.kind === 'turn');
  a.send({ type: 'PAUSE' });
  await until(() => a.state.pause && b.state.pause);
  assert.equal(a.state.pause.name, '가');
  const handBefore = a.state.view.myHand.join();
  const discardsBefore = a.state.view.players[0].discards.length;
  const id = a.state.view.legal.discard[0];
  a.send({ type: 'ACT', action: { type: 'discard', id } });
  await until(() => a.errors.some((e) => e.code === 'paused'));
  // 제한 시간(600ms)보다 오래 기다려도 자동 버림이 일어나지 않는다.
  await new Promise((r) => setTimeout(r, 900));
  assert.equal(a.state.view.players[0].discards.length, discardsBefore);
  assert.equal(a.state.view.myHand.join(), handBefore);
  // 상대가 재개할 수 있다.
  b.send({ type: 'RESUME' });
  await until(() => !a.state.pause && !b.state.pause);
  assert.ok(a.events.some((e) => e.t === 'resume' && e.name === '나'));
  // 재개 뒤에는 남은 시간이 지나면 다시 자동 진행한다.
  await until(() => a.state.view.players[0].discards.length > discardsBefore, 3000);
  a.ws.close();
  b.ws.close();
  srv.close();
});

test('일시정지: 시간·횟수 제한 없이 재개할 때까지 멈춰 있고 몇 번이든 다시 멈출 수 있다', async (t) => {
  const srv = await boot({ ...FAST, baseMs: 5000, bankMs: 0 });
  t.after(srv.close);
  const a = client(srv.port, { key: 'kq1', name: '가', play: false }, t);
  await until(() => a.room);
  a.send({ type: 'START' });
  await until(() => a.state?.view.legal?.kind === 'turn');
  a.send({ type: 'PAUSE' });
  await until(() => a.state.pause);
  // 오래 지나도(여기서는 1.2초) 자동으로 풀리지 않는다.
  await new Promise((r) => setTimeout(r, 1200));
  assert.ok(a.state.pause, '자동 재개 없음');
  assert.ok(!a.events.some((e) => e.t === 'resume'));
  a.send({ type: 'RESUME' });
  await until(() => !a.state.pause);
  assert.ok(a.events.some((e) => e.t === 'resume' && e.name === '가'));
  // 횟수 제한이 없으니 여러 번 멈췄다 풀어도 거절되지 않는다.
  for (let i = 0; i < 5; i++) {
    a.send({ type: 'PAUSE' });
    await until(() => a.state.pause);
    a.send({ type: 'RESUME' });
    await until(() => !a.state.pause);
  }
  assert.deepEqual(a.errors, []);
  a.ws.close();
  srv.close();
});

test('방 번호(room)가 다르면 방 설정 화면에 남은 사람과 섞이지 않고 각자 방장이 된다', async (t) => {
  const srv = await boot({ ...FAST, emptyResetMs: 120, lobbyGraceMs: 60 });
  t.after(srv.close);
  // 김몽구는 이전 대기실에서 만든 방의 방 설정 화면에 멈춰 있다.
  const old = client(srv.port, { key: 'kmg', name: '김몽구', play: false, role: 'p1', room: 'old-session' }, t);
  await until(() => old.joined);
  assert.equal(old.joined.host, true);
  // 새 대기실에서 온 나는 다른 방 번호를 받는다.
  const me = client(srv.port, { key: 'me', name: '나', play: false, role: 'p1', room: 'new-session' }, t);
  await until(() => me.joined);
  assert.equal(me.joined.host, true, '새 방에서는 내가 방장이다');
  assert.equal(me.joined.seat, 0);
  await until(() => me.room);
  assert.equal(me.room.seats.filter((s) => s.type === 'human').length, 1, '새 방에는 나 혼자다');
  assert.equal(old.room.seats.filter((s) => s.type === 'human').length, 1, '옛 방도 그대로 김몽구 혼자다');
  assert.equal(srv.app._rooms.size, 2);
});

test('같은 방 번호로 들어오면 같은 방에 모이고, 방 번호가 없으면 기본 방으로 간다', async (t) => {
  const srv = await boot();
  t.after(srv.close);
  const a = client(srv.port, { key: 'a', name: 'A', play: false, role: 'p1', room: 'same' }, t);
  await until(() => a.joined);
  const b = client(srv.port, { key: 'b', name: 'B', play: false, role: 'p2', room: 'same' }, t);
  await until(() => b.joined);
  assert.equal(b.joined.host, false);
  assert.equal(b.joined.seat, 2, '둘째 사람은 마주 보는 자리');
  const d = client(srv.port, { key: 'd', name: 'D', play: false, room: 'bad id!' }, t); // 허용되지 않는 번호
  await until(() => d.joined);
  assert.equal(d.joined.host, true);
  assert.ok(srv.app._rooms.has('default'));
  assert.equal(srv.app._room.slots.filter((s) => s && s.type === 'human').length, 1);
});

test('발급된 방은 모두 나가 초기화되면 목록에서 치워진다', async (t) => {
  const srv = await boot({ ...FAST, emptyResetMs: 80, lobbyGraceMs: 40 });
  t.after(srv.close);
  const a = client(srv.port, { key: 'a', name: 'A', play: false, room: 'temp' }, t);
  await until(() => a.joined);
  assert.ok(srv.app._rooms.has('temp'));
  a.ws.close();
  await until(() => !srv.app._rooms.has('temp'), 3000);
});
