/**
 * @fileoverview 실제 WebSocket과 통합 런처 HTTP를 사용해 재접속 수명 주기와 포탈 복귀를 검증한다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import { createApp, DISCONNECT_GRACE_MS } from '../server.js';
import { findAnyLegalPair } from '../lib/pathfinder.js';

/** @param {number} [duration=60_000] 경기 시간 @returns {Promise<{app:object,server:http.Server,url:string}>} 격리 서버 */
async function startGameServer(duration = 60_000, disconnectGraceMs = 250) {
  const app = createApp({ testing: true, seed: 4242, duration, disconnectGraceMs });
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { app, server, url: `ws://127.0.0.1:${server.address().port}/sichuan-battle/ws` };
}

/** @param {WebSocket} socket 소켓 @param {string} type 메시지 종류 @param {number} [timeout=3_000] 제한 @returns {Promise<object>} */
function waitFor(socket, type, timeout = 3_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', listener);
      reject(new Error(`timeout ${type}`));
    }, timeout);
    const listener = (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type !== type) return;
      clearTimeout(timer);
      socket.off('message', listener);
      resolve(message);
    };
    socket.on('message', listener);
  });
}

/** @param {WebSocket} socket 소켓 @returns {Promise<void>} 닫힘 완료 */
function closeSocket(socket) {
  if (socket.readyState === WebSocket.CLOSED) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 1_000);
    socket.once('close', () => { clearTimeout(timer); resolve(); });
    socket.close();
  });
}

/** @param {{app:object,server:http.Server}} fixture 서버 @param {WebSocket[]} sockets 소켓 목록 @returns {Promise<void>} */
async function stopGameServer(fixture, sockets) {
  await Promise.all(sockets.map(closeSocket));
  fixture.app.close();
  await new Promise((resolve) => fixture.server.close(resolve));
}

/** @param {string} url 접속 URL @returns {Promise<{socket:WebSocket,joined:object}>} 연결과 입장 정보 */
async function connect(url) {
  const socket = new WebSocket(url);
  const joined = await waitFor(socket, 'JOINED');
  return { socket, joined };
}

/** @param {string} url 서버 URL @returns {Promise<{a:WebSocket,b:WebSocket,startA:object,startB:object,joinedA:object,joinedB:object}>} 시작된 경기 */
async function startMatch(url) {
  const first = await connect(`${url}?name=ReconnectA`);
  const second = await connect(`${url}?name=ReconnectB`);
  const startA = waitFor(first.socket, 'START');
  const startB = waitFor(second.socket, 'START');
  first.socket.send(JSON.stringify({ type: 'READY' }));
  second.socket.send(JSON.stringify({ type: 'READY' }));
  const [messageA, messageB] = await Promise.all([startA, startB]);
  return { a: first.socket, b: second.socket, startA: messageA, startB: messageB, joinedA: first.joined, joinedB: second.joined };
}

/** @returns {Promise<number>} 사용 가능한 로컬 포트 */
async function reservePort() {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/** @param {number} port 포트 @returns {Promise<import('node:child_process').ChildProcess>} 준비된 런처 프로세스 */
async function startLauncher(port) {
  const child = spawn(process.execPath, ['launcher/server.js', '--port', String(port)], {
    cwd: new URL('../..', import.meta.url),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`launcher exited ${child.exitCode}: ${stderr}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      if (response.ok) return child;
    } catch {
      // 포트가 열릴 때까지 짧게 재시도한다.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill();
  throw new Error(`launcher startup timeout: ${stderr}`);
}

/** @param {import('node:child_process').ChildProcess} child 프로세스 @returns {Promise<void>} 종료 완료 */
function stopLauncher(child) {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 2_000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    child.kill();
  });
}

test('같은 세션 토큰으로 15초 안에 playerId와 개인 경기 상태를 복구한다', async (context) => {
  assert.equal(DISCONNECT_GRACE_MS, 15_000);
  const fixture = await startGameServer(60_000, 1_000);
  const match = await startMatch(fixture.url);
  const sockets = [match.a, match.b];
  context.after(() => stopGameServer(fixture, sockets));
  await new Promise((resolve) => setTimeout(resolve, 3_100));
  const legalPair = findAnyLegalPair(match.startA.snapshot.me.board.tiles);
  assert.ok(legalPair);
  const pair = [legalPair.a, legalPair.b];
  const accepted = waitFor(match.a, 'PAIR_ACCEPTED');
  match.a.send(JSON.stringify({
    type: 'MATCH_PAIR',
    requestId: 'before-reconnect',
    matchId: match.startA.snapshot.matchId,
    tileAId: pair[0].tileId,
    tileBId: pair[1].tileId,
    boardRevision: match.startA.snapshot.me.board.revision,
  }));
  assert.equal((await accepted).ok, true);
  const scored = await waitFor(match.a, 'STATE_SYNC');
  assert.equal(scored.snapshot.me.removedPairs, 1);
  const disconnected = waitFor(match.b, 'CONNECTION_STATE');
  await closeSocket(match.a);
  const grace = await disconnected;
  assert.ok(grace.graceEndsAt - Date.now() <= 1_000);
  assert.ok(grace.graceEndsAt > Date.now());

  const restored = await connect(`${fixture.url}?name=Ignored&sessionToken=${encodeURIComponent(match.joinedA.sessionToken)}`);
  sockets.push(restored.socket);
  const state = await waitFor(restored.socket, 'STATE_SYNC');
  assert.equal(restored.joined.reconnected, true);
  assert.equal(restored.joined.playerId, match.joinedA.playerId);
  assert.equal(state.snapshot.matchId, match.startA.snapshot.matchId);
  assert.equal(state.snapshot.me.removedPairs, 1);
  assert.equal(state.snapshot.me.board.revision, scored.snapshot.me.board.revision);
});

test('15초 유예가 만료되면 연결된 상대의 disconnect 승리를 한 번 확정한다', async (context) => {
  assert.equal(DISCONNECT_GRACE_MS, 15_000);
  const fixture = await startGameServer();
  const match = await startMatch(fixture.url);
  context.after(() => stopGameServer(fixture, [match.a, match.b]));
  const disconnected = waitFor(match.b, 'CONNECTION_STATE');
  await closeSocket(match.a);
  const grace = await disconnected;
  assert.ok(grace.graceEndsAt > Date.now());
  const first = await waitFor(match.b, 'STATE_SYNC', 2_000);
  let resultState = first;
  while (!resultState.snapshot.result) resultState = await waitFor(match.b, 'STATE_SYNC', 2_000);
  assert.equal(resultState.snapshot.result.winnerId, match.joinedB.playerId);
  assert.equal(resultState.snapshot.result.reason, 'disconnect');
  const repeated = await waitFor(match.b, 'STATE_SYNC');
  assert.deepEqual(repeated.snapshot.result, resultState.snapshot.result);
});

test('양쪽 이탈은 룸과 유예 작업을 정리하고 새 p1·p2 경기를 허용한다', async (context) => {
  const fixture = await startGameServer();
  const match = await startMatch(fixture.url);
  const sockets = [match.a, match.b];
  context.after(() => stopGameServer(fixture, sockets));
  await Promise.all([closeSocket(match.a), closeSocket(match.b)]);
  const freshA = await connect(`${fixture.url}?name=FreshA`);
  const freshB = await connect(`${fixture.url}?name=FreshB`);
  sockets.push(freshA.socket, freshB.socket);
  assert.deepEqual([freshA.joined.playerId, freshB.joined.playerId], ['p1', 'p2']);
  assert.equal(freshA.joined.reconnected, false);
  assert.equal(freshB.joined.reconnected, false);
  const startA = waitFor(freshA.socket, 'START');
  const startB = waitFor(freshB.socket, 'START');
  freshA.socket.send(JSON.stringify({ type: 'READY' }));
  freshB.socket.send(JSON.stringify({ type: 'READY' }));
  const [nextA, nextB] = await Promise.all([startA, startB]);
  assert.equal(nextA.snapshot.matchId, nextB.snapshot.matchId);
  assert.notEqual(nextA.snapshot.matchId, match.startA.snapshot.matchId);
});

test('플레이·결과의 게임 선택 링크가 실제 통합 런처 포탈로 복귀한다', async () => {
  const port = await reservePort();
  const launcher = await startLauncher(port);
  try {
    const gameResponse = await fetch(`http://127.0.0.1:${port}/sichuan-battle/`);
    assert.equal(gameResponse.status, 200);
    const gameHtml = await gameResponse.text();
    assert.equal((gameHtml.match(/href="\/"/g) || []).length, 2);

    const portalResponse = await fetch(`http://127.0.0.1:${port}/`, { redirect: 'manual' });
    assert.equal(portalResponse.status, 200);
    const portalHtml = await portalResponse.text();
    assert.match(portalHtml, /id="game-grid"|class="game-grid"/);
    assert.match(portalHtml, /미니게임 천국/);
  } finally {
    await stopLauncher(launcher);
  }
});
