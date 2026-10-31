/**
 * @fileoverview 서버 통합 테스트: 실제 WebSocket으로 접속해 방 설정 → AI 채우기 → 대국 진행을 검증한다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocket } from 'ws';
import { createApp } from '../server.js';
import { decide } from '../lib/ai.js';
import { seededRng } from '../lib/cards.js';

const FAST = {
  baseMs: 600, bankMs: 600, grandMs: 600, exchangeMs: 600, giftMs: 600,
  aiTurnMs: [0, 3], aiPickMs: [0, 3], aiAckMs: [0, 3], awayMs: 5,
  lobbyGraceMs: 150, emptyResetMs: 150,
};
const QUICK = { target: 500, bombWindowMs: 0 };
// 에러가 없어야 하는 테스트용: 사람 제한 시간이 봇의 응답보다 먼저 끝나 서버가 대신 진행하는 경쟁(→ 늦은 요청 거절)을 피한다.
const RELAXED = { ...FAST, baseMs: 8000, bankMs: 8000, grandMs: 8000, exchangeMs: 8000, giftMs: 8000 };

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
  const ws = new WebSocket(`ws://127.0.0.1:${port}/tichu/ws?key=${key}&name=${encodeURIComponent(name)}${role ? `&role=${role}` : ''}${room ? `&room=${room}` : ''}`);
  const c = { ws, room: null, state: null, joined: null, errors: [], states: 0, events: [] };
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
      c.events.push(...msg.events);
      const v = msg.view;
      const sig = `${v.round}|${v.phase}|${v.pending?.seat}|${v.hand.join()}|${v.trick.plays.length}|${v.trick.passed.length}|${v.legal?.kind}|${v.calls[v.seat]}`; // 남의 티추 콜은 서명에 넣지 않는다(내 행동이 처리되기 전에 STATE가 바뀌어 같은 행동을 또 보내는 것을 막는다)
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
  const srv = await boot(RELAXED);
  t.after(srv.close);
  const a = client(srv.port, { key: 'ka', name: '나' }, t);
  await until(() => a.room);
  assert.equal(a.joined.seat, 0);
  assert.equal(a.room.isHost, true);
  assert.deepEqual(a.room.seats.map((s) => s.type), ['human', 'empty', 'empty', 'empty']);
  a.send({ type: 'CONFIG', settings: { ...QUICK, aiLevel: 'hard' } });
  await until(() => a.room.settings.aiLevel === 'hard' && a.room.settings.target === 500);
  a.send({ type: 'START' });
  await until(() => a.state);
  assert.deepEqual(a.state.seats.map((s) => s.type), ['human', 'ai', 'ai', 'ai']);
  assert.ok(a.state.seats[1].name);
  await until(() => a.state.view.final, 60000);
  const { scores, winner } = a.state.view.final;
  assert.ok(scores[winner] >= 500 && scores[winner] > scores[1 - winner]);
  assert.deepEqual(a.errors, []);
});

test('친구와 + AI 2명: 두 사람은 마주 보는 자리(파트너)에 앉는다', async (t) => {
  const srv = await boot(RELAXED);
  t.after(srv.close);
  const a = client(srv.port, { key: 'k1', name: '나' }, t);
  const b = client(srv.port, { key: 'k2', name: '도윤' }, t);
  await until(() => a.room && b.room && a.room.seats[2].type === 'human');
  assert.equal(a.joined.seat, 0);
  assert.equal(b.joined.seat, 2);
  assert.equal(b.room.isHost, false);
  b.send({ type: 'START' });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(a.state, null, '호스트만 시작할 수 있다');
  a.send({ type: 'CONFIG', settings: QUICK });
  await until(() => a.room.settings.target === 500 && b.room.settings.target === 500);
  a.send({ type: 'START' });
  await until(() => a.state && b.state);
  assert.deepEqual(a.state.seats.map((s) => s.type), ['human', 'ai', 'human', 'ai']);
  await until(() => a.state.view.final && b.state.view.final, 90000);
  assert.deepEqual(a.errors, []);
  assert.deepEqual(b.errors, []);
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

test('상대 손패는 STATE에 담기지 않고, 그랜드 선택 중에는 남의 선택도 숨겨진다', async (t) => {
  const srv = await boot({ ...FAST, grandMs: 5000 });
  t.after(srv.close);
  const a = client(srv.port, { key: 'kh', name: '나', play: false }, t);
  await until(() => a.room);
  a.send({ type: 'START' });
  await until(() => a.state);
  const g = srv.app._room.game;
  const raw = JSON.stringify(a.state.view);
  assert.equal(a.state.view.hand.length, 8);
  assert.deepEqual(a.state.view.counts, [8, 8, 8, 8]);
  assert.ok(!raw.includes('"rest"') && !raw.includes('"hands"'));
  assert.deepEqual(a.state.view.hand, g.h.hands[0]);
});

test('불법 행동은 거절되고 ERROR가 오며 상태는 유지된다', async (t) => {
  const srv = await boot({ ...FAST, grandMs: 5000, exchangeMs: 5000, baseMs: 5000 });
  t.after(srv.close);
  const a = client(srv.port, { key: 'ke', name: '나', play: false }, t);
  await until(() => a.room);
  a.send({ type: 'START' });
  await until(() => a.state?.view?.legal?.kind === 'grand');
  a.send({ type: 'ACT', action: { type: 'pass' } });
  a.send({ type: 'ACT', action: { type: 'play', ids: [9999] } });
  a.send({ type: 'ACT', action: { type: 'nonsense' } });
  await until(() => a.errors.length >= 3);
  assert.equal(a.state.view.legal.kind, 'grand');
});

test('타임아웃이면 자동 진행하고 연속 타임아웃 시 자리 비움으로 전환된다', async (t) => {
  const srv = await boot({ ...FAST, grandMs: 60, exchangeMs: 60, baseMs: 60, bankMs: 0, giftMs: 60 });
  t.after(srv.close);
  const a = client(srv.port, { key: 'kt', name: '나', play: false }, t);
  await until(() => a.room);
  a.send({ type: 'CONFIG', settings: QUICK });
  a.send({ type: 'START' });
  await until(() => a.state);
  await until(() => srv.app._room.slots[0].autoPlay && a.state.view.round >= 1 && a.state.view.phase !== 'grand', 15000);
  assert.ok(a.state.view.phase === 'play' || a.state.view.phase === 'roundEnd' || a.state.view.phase === 'over' || a.state.view.phase === 'exchange');
});

test('라운드 결과 확인은 시간이 지나도 넘어가지 않고 사람이 직접 눌러야 넘어간다', async (t) => {
  const srv = await boot();
  t.after(srv.close);
  const a = client(srv.port, { key: 'kack', name: '나', holdAck: true }, t);
  await until(() => a.room);
  a.send({ type: 'CONFIG', settings: QUICK });
  a.send({ type: 'START' });
  await until(() => a.state?.view.phase === 'roundEnd' && a.state.view.result, 60000);
  const round = a.state.view.round;
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(a.state.view.phase, 'roundEnd');
  assert.equal(a.state.view.round, round);
  assert.equal(a.state.timers.length, 0, '결과 확인에는 카운트다운이 없다');
  a.send({ type: 'ACT', action: { type: 'next' } });
  await until(() => a.state.view.round !== round || a.state.view.phase === 'over', 10000);
});

test('끊겼다가 같은 키로 재접속하면 같은 자리와 상태를 이어받는다', async (t) => {
  const srv = await boot({ ...FAST, grandMs: 5000, awayMs: 5000 });
  t.after(srv.close);
  const a = client(srv.port, { key: 'kr', name: '나', play: false }, t);
  await until(() => a.room);
  a.send({ type: 'START' });
  await until(() => a.state?.view?.legal?.kind === 'grand');
  const hand = a.state.view.hand.slice();
  a.ws.close();
  await new Promise((r) => setTimeout(r, 40));
  const b = client(srv.port, { key: 'kr', name: '나', play: false }, t);
  await until(() => b.state);
  assert.equal(b.joined.seat, 0);
  assert.deepEqual(b.state.view.hand, hand);
});

test('대국 중 다른 사람은 입장할 수 없다', async (t) => {
  const srv = await boot({ ...FAST, grandMs: 5000 });
  t.after(srv.close);
  const a = client(srv.port, { key: 'k1', name: '나', play: false }, t);
  await until(() => a.room);
  a.send({ type: 'START' });
  await until(() => a.state);
  const b = client(srv.port, { key: 'k2', name: '손님', play: false }, t);
  await until(() => b.errors.length > 0);
  assert.equal(b.errors[0].code, 'in_progress');
});

test('정적 파일, 공유 모듈(/lib), 경로 탈출 방어', async (t) => {
  const srv = await boot();
  t.after(srv.close);
  const get = (p) => new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port: srv.port, path: p }, (res) => { res.resume(); resolve(res.statusCode); });
  });
  assert.equal(await get('/lib/cards.js'), 200);
  assert.equal(await get('/lib/combos.js'), 200);
  assert.equal(await get('/lib/game.js'), 404, '서버 규칙 엔진은 내보내지 않는다');
  assert.equal(await get('/lib/ai.js'), 404);
  assert.ok([403, 404].includes(await get('/../server.js')));
  assert.ok([403, 404].includes(await get('/%2e%2e/server.js')));
  assert.ok([403, 404].includes(await get('/lib/%2e%2e/server.js')));
  assert.equal(await get('/nope.html'), 404);
});

test('다시 하기: 방장이 누르면 게스트도 연결과 자리를 유지한 채 방 설정으로 돌아온다', async (t) => {
  const srv = await boot();
  t.after(srv.close);
  const a = client(srv.port, { key: 'rm-a', name: '방장', role: 'p1' }, t);
  const b = client(srv.port, { key: 'rm-b', name: '게스트', role: 'p2' }, t);
  await until(() => a.room?.seats[2]?.type === 'human' && b.room);
  a.send({ type: 'CONFIG', settings: QUICK });
  await until(() => a.room.settings.target === 500);
  a.send({ type: 'START' });
  await until(() => a.state?.view.final && b.state?.view.final, 90000);
  b.send({ type: 'REMATCH' });
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(a.room.phase, 'over', '게스트는 다시 하기를 시작할 수 없다');
  a.send({ type: 'REMATCH' });
  await until(() => a.room.phase === 'lobby' && b.room.phase === 'lobby');
  assert.deepEqual(a.room.seats.map((s) => s.type), ['human', 'empty', 'human', 'empty']);
  assert.ok(b.ws.readyState === WebSocket.OPEN);
});

test('일시정지: 타이머와 행동이 멈추고, 아무나 재개하면 남은 시간부터 이어진다', async (t) => {
  const srv = await boot({ ...FAST, grandMs: 700 });
  t.after(srv.close);
  const a = client(srv.port, { key: 'kp1', name: '가', play: false }, t);
  const b = client(srv.port, { key: 'kp2', name: '나', play: false }, t);
  await until(() => a.room && b.room && a.room.seats[2].type === 'human');
  a.send({ type: 'START' });
  await until(() => a.state && b.state);
  await until(() => a.state.view.legal?.kind === 'grand');
  a.send({ type: 'PAUSE' });
  await until(() => a.state.pause && b.state.pause);
  assert.equal(a.state.pause.name, '가');
  a.send({ type: 'ACT', action: { type: 'grand', on: false } });
  await until(() => a.errors.some((e) => e.code === 'paused'));
  // 제한 시간(700ms)보다 오래 기다려도 자동 선택이 일어나지 않는다.
  await new Promise((r) => setTimeout(r, 1000));
  assert.equal(a.state.view.legal?.kind, 'grand');
  b.send({ type: 'RESUME' });
  await until(() => !a.state.pause && !b.state.pause);
  assert.ok(a.events.some((e) => e.t === 'resume' && e.name === '나'));
  // 재개 뒤에는 남은 시간이 지나면 다시 자동 진행한다.
  await until(() => a.state.view.legal?.kind !== 'grand', 3000);
});

test('일시정지: 시간·횟수 제한 없이 재개할 때까지 멈춰 있고 몇 번이든 다시 멈출 수 있다', async (t) => {
  const srv = await boot({ ...FAST, grandMs: 5000 });
  t.after(srv.close);
  const a = client(srv.port, { key: 'kq1', name: '가', play: false }, t);
  await until(() => a.room);
  a.send({ type: 'START' });
  await until(() => a.state?.view.legal?.kind === 'grand');
  a.send({ type: 'PAUSE' });
  await until(() => a.state.pause);
  await new Promise((r) => setTimeout(r, 1000));
  assert.ok(a.state.pause, '자동 재개 없음');
  a.send({ type: 'RESUME' });
  await until(() => !a.state.pause);
  for (let i = 0; i < 5; i++) {
    a.send({ type: 'PAUSE' });
    await until(() => a.state.pause);
    a.send({ type: 'RESUME' });
    await until(() => !a.state.pause);
  }
  assert.deepEqual(a.errors, []);
});

test('폭탄 끼어들기 대기 시간은 STATE에 실리고, 방 설정으로 바꿀 수 있다', async (t) => {
  const srv = await boot();
  t.after(srv.close);
  const a = client(srv.port, { key: 'kw', name: '나', play: false }, t);
  await until(() => a.room);
  assert.equal(a.room.settings.bombWindowMs, 2000);
  assert.equal(a.room.settings.target, 1000);
  assert.equal(a.room.settings.grand, true);
  a.send({ type: 'CONFIG', settings: { bombWindowMs: 3000, target: 123, grand: false } });
  await until(() => a.room.settings.bombWindowMs === 3000);
  assert.equal(a.room.settings.target, 1000, '허용된 값만 받는다');
  assert.equal(a.room.settings.grand, false);
  a.send({ type: 'START' });
  await until(() => a.state);
  assert.equal(a.state.view.phase, 'exchange', '그랜드를 끄면 바로 교환 단계');
  assert.equal(a.state.view.settings.bombWindowMs, 3000);
});

test('방 번호(room)가 다르면 방 설정 화면에 남은 사람과 섞이지 않고 각자 방장이 된다', async (t) => {
  const srv = await boot({ ...FAST, emptyResetMs: 120, lobbyGraceMs: 60 });
  t.after(srv.close);
  const old = client(srv.port, { key: 'kmg', name: '김몽구', play: false, role: 'p1', room: 'old-session' }, t);
  await until(() => old.joined);
  assert.equal(old.joined.host, true);
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
