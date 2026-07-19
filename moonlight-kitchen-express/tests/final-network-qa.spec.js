/** @fileoverview 최종 QA에서 결과 합의, 종료 정리와 새 방 수명주기를 실제 WebSocket으로 검증한다. */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocket } from 'ws';
import { createApp } from '../server.js';

/** @param {WebSocket} ws 소켓 @param {(message:object)=>boolean} predicate 조건 @param {number} [timeout] 제한 @returns {Promise<object>} */
function waitMessage(ws, predicate, timeout = 2500) { return new Promise((resolve, reject) => { const timer = setTimeout(() => { ws.off('message', listener); reject(new Error('message timeout')); }, timeout); const listener = raw => { const message = JSON.parse(raw.toString()); if (predicate(message)) { clearTimeout(timer); ws.off('message', listener); resolve(message); } }; ws.on('message', listener); }); }

/** @param {number} port 포트 @param {string} name 이름 @param {string} [role] 역할 @returns {Promise<{ws:WebSocket,welcome:object}>} */
async function connect(port, name, role) { const ws = new WebSocket(`ws://127.0.0.1:${port}`); await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); }); const welcome = waitMessage(ws, message => message.type === 'WELCOME'); ws.send(JSON.stringify({ type: 'JOIN', name, locale: 'ko', requestedRole: role })); return { ws, welcome: await welcome }; }

/** @returns {Promise<object>} */
async function fixture() { const app = createApp({ testing: true, reconnectGraceMs: 80 }); const server = http.createServer(app.handleHttp); server.on('upgrade', app.handleUpgrade); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); return { app, server, port: server.address().port }; }

/** @param {object} fx 픽스처 @returns {Promise<void>} */
async function closeFixture(fx) { fx.app.close(); await new Promise(resolve => fx.server.close(resolve)); }

/** @param {object} a 연결1 @param {object} b 연결2 @returns {Promise<void>} */
async function startRound(a, b) { const startA = waitMessage(a.ws, m => m.type === 'START'); const startB = waitMessage(b.ws, m => m.type === 'START'); a.ws.send(JSON.stringify({ type: 'READY' })); b.ws.send(JSON.stringify({ type: 'READY' })); await Promise.all([startA, startB]); await Promise.all([waitMessage(a.ws, m => m.type === 'GAME_OVER'), waitMessage(b.ws, m => m.type === 'GAME_OVER')]); }

test('RETRY/LOBBY 불일치는 대기하고 양쪽 RETRY 합의만 새 라운드를 한 번 시작한다', async () => {
  const fx = await fixture(); try { const a = await connect(fx.port, 'VoteA', 'p1'); const b = await connect(fx.port, 'VoteB', 'p2'); await startRound(a, b);
    const splitA = waitMessage(a.ws, m => m.type === 'RESULT_VOTE_STATE' && m.status === 'split');
    a.ws.send(JSON.stringify({ type: 'RESULT_VOTE', action: 'RETRY' })); b.ws.send(JSON.stringify({ type: 'RESULT_VOTE', action: 'LOBBY' })); await splitA; assert.equal(fx.app.getSimulation().phase, 'result');
    const retryA = waitMessage(a.ws, m => m.type === 'START'); const retryB = waitMessage(b.ws, m => m.type === 'START'); b.ws.send(JSON.stringify({ type: 'RESULT_VOTE', action: 'RETRY' })); await Promise.all([retryA, retryB]); assert.equal(fx.app.getSimulation().phase, 'playing');
    a.ws.close(); b.ws.close();
  } finally { await closeFixture(fx); }
});

test('양쪽 LOBBY 합의 뒤 종료·연결 정리가 끝나면 같은 서버에서 완전히 새 방이 열린다', async () => {
  const fx = await fixture(); try { let a = await connect(fx.port, 'OldA', 'p1'); let b = await connect(fx.port, 'OldB', 'p2'); await startRound(a, b);
    const lobbyA = waitMessage(a.ws, m => m.type === 'RESULT_VOTE_STATE' && m.status === 'lobby'); const lobbyB = waitMessage(b.ws, m => m.type === 'RESULT_VOTE_STATE' && m.status === 'lobby');
    a.ws.send(JSON.stringify({ type: 'RESULT_VOTE', action: 'LOBBY' })); b.ws.send(JSON.stringify({ type: 'RESULT_VOTE', action: 'LOBBY' })); await Promise.all([lobbyA, lobbyB]); a.ws.close(); b.ws.close(); await new Promise(resolve => setTimeout(resolve, 60));
    a = await connect(fx.port, 'NewA', 'p1'); b = await connect(fx.port, 'NewB', 'p2'); assert.equal(a.welcome.playerId, 'p1'); assert.equal(b.welcome.playerId, 'p2'); await startRound(a, b); a.ws.close(); b.ws.close();
  } finally { await closeFixture(fx); }
});

test('빠른 61개 입력은 연결을 유지한 채 RATE_LIMIT으로 제한되고 좌표·점수 주입은 반영되지 않는다', async () => {
  const fx = await fixture(); try { const a = await connect(fx.port, 'RateA', 'p1'); const b = await connect(fx.port, 'RateB', 'p2'); const start = waitMessage(a.ws, m => m.type === 'START'); a.ws.send(JSON.stringify({ type: 'READY' })); b.ws.send(JSON.stringify({ type: 'READY' })); await start;
    const before = fx.app.getSimulation().players[0].x; const limited = waitMessage(a.ws, m => m.type === 'ERROR' && m.code === 'RATE_LIMIT');
    for (let seq = 0; seq < 61; seq += 1) a.ws.send(JSON.stringify({ type: 'INPUT', seq, up: false, down: false, left: false, right: false, interact: false, work: false, drop: false, x: 9999, score: 9999 }));
    await limited; assert.equal(fx.app.getSimulation().players[0].x, before); assert.notEqual(fx.app.getSimulation().orderState.score, 9999); assert.equal(a.ws.readyState, WebSocket.OPEN); a.ws.close(); b.ws.close();
  } finally { await closeFixture(fx); }
});

test('두 슬롯의 reconnect timeout이 동시에 도착해도 stale slot 없이 새 waiting 세션이 열린다', async () => {
  const fx = await fixture(); try { let a = await connect(fx.port, 'TimeoutA', 'p1'); let b = await connect(fx.port, 'TimeoutB', 'p2'); const started = waitMessage(a.ws, m => m.type === 'START'); a.ws.send(JSON.stringify({ type: 'READY' })); b.ws.send(JSON.stringify({ type: 'READY' })); await started; a.ws.close(); b.ws.close(); await new Promise(resolve => setTimeout(resolve, 140)); assert.equal(fx.app.getSimulation().phase, 'waiting'); a = await connect(fx.port, 'FreshA', 'p1'); b = await connect(fx.port, 'FreshB', 'p2'); assert.equal(a.welcome.playerId, 'p1'); assert.equal(b.welcome.playerId, 'p2'); a.ws.close(); b.ws.close();
  } finally { await closeFixture(fx); }
});

test('ended 상태의 중복 close 뒤 즉시 신규 JOIN해도 p1/p2를 새로 배정한다', async () => {
  const fx = await fixture(); try { let a = await connect(fx.port, 'EndA', 'p1'); let b = await connect(fx.port, 'EndB', 'p2'); const ended = waitMessage(b.ws, m => m.type === 'SESSION_ENDED'); a.ws.send(JSON.stringify({ type: 'LEAVE_GAME' })); await ended; a.ws.close(); a.ws.close(); b.ws.close(); b.ws.close(); await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(fx.app.getSimulation().phase, 'waiting'); a = await connect(fx.port, 'AgainA', 'p1'); b = await connect(fx.port, 'AgainB', 'p2'); assert.equal(a.welcome.playerId, 'p1'); assert.equal(b.welcome.playerId, 'p2'); a.ws.close(); b.ws.close();
  } finally { await closeFixture(fx); }
});

test('서로 다른 createApp 인스턴스는 종료·슬롯·새 JOIN 상태를 공유하지 않는다', async () => {
  const left = await fixture(); const right = await fixture();
  try {
    let leftA = await connect(left.port, 'LeftA', 'p1'); const leftB = await connect(left.port, 'LeftB', 'p2');
    const rightA = await connect(right.port, 'RightA', 'p1'); const rightB = await connect(right.port, 'RightB', 'p2');
    const ended = waitMessage(leftB.ws, message => message.type === 'SESSION_ENDED'); leftA.ws.send(JSON.stringify({ type: 'LEAVE_GAME' })); await ended;
    assert.equal(left.app.getSimulation().phase, 'ended'); assert.equal(right.app.getSimulation().phase, 'waiting');
    leftA.ws.close(); leftB.ws.close(); await new Promise(resolve => setTimeout(resolve, 30));
    leftA = await connect(left.port, 'LeftFresh', 'p1'); assert.equal(leftA.welcome.playerId, 'p1');
    assert.equal(rightA.welcome.playerId, 'p1'); assert.equal(rightB.welcome.playerId, 'p2'); assert.equal(right.app.getSimulation().phase, 'waiting');
    leftA.ws.close(); rightA.ws.close(); rightB.ws.close();
  } finally { await closeFixture(left); await closeFixture(right); }
});
