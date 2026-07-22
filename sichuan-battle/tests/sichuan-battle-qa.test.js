/**
 * @fileoverview 사천성 배틀 스펙의 권위성, 아이템 수명, 프로토콜 악용 방어를 독립 검증한다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocket } from 'ws';
import { SichuanGame } from '../lib/game.js';
import { findAnyLegalPair } from '../lib/pathfinder.js';
import { createApp } from '../server.js';

/** @param {number} seed 시드 @returns {{game:SichuanGame,now:{value:number}}} 플레이 중 경기 */
function playingGame(seed = 101) {
  const now = { value: 1_000 };
  const game = new SichuanGame({ seed, now: () => now.value });
  game.addPlayer('p1', 'A');
  game.addPlayer('p2', 'B');
  game.start();
  now.value = 4_001;
  game.tick();
  return { game, now };
}

/** @param {WebSocket} socket 소켓 @param {string} type 메시지 종류 @param {number} [timeout=2000] 제한 @returns {Promise<object>} */
function waitFor(socket, type, timeout = 2_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off('message', listener); reject(new Error(`timeout ${type}`)); }, timeout);
    const listener = (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type !== type) return;
      clearTimeout(timer); socket.off('message', listener); resolve(message);
    };
    socket.on('message', listener);
  });
}

/** @returns {Promise<{app:object,server:http.Server,url:string}>} 격리 서버 */
async function startServer() {
  const app = createApp({ testing: true, seed: 777, duration: 30_000 });
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { app, server, url: `ws://127.0.0.1:${server.address().port}/sichuan-battle/ws` };
}

/** @param {{app:object,server:http.Server}} fixture 서버 @param {WebSocket[]} sockets 소켓 @returns {Promise<void>} */
async function stopServer(fixture, sockets = []) {
  sockets.forEach((socket) => socket.close());
  fixture.app.close();
  await new Promise((resolve) => fixture.server.close(resolve));
}

test('3분 종료는 점수 승패와 동점을 서버에서 한 번만 확정한다', () => {
  const { game, now } = playingGame();
  game.players[0].removedPairs = 7;
  game.players[1].removedPairs = 6;
  now.value = game.deadlineAt + 1;
  game.tick();
  assert.equal(game.result.winnerId, 'p1');
  assert.equal(game.result.reason, 'time_score');
  game.finish('p2', 'tamper');
  assert.equal(game.result.winnerId, 'p1');

  const draw = playingGame(102);
  draw.game.players.forEach((player) => { player.removedPairs = 4; });
  draw.now.value = draw.game.deadlineAt + 1;
  draw.game.tick();
  assert.equal(draw.game.result.winnerId, null);
  assert.equal(draw.game.result.reason, 'time_draw');
});

test('정화는 잠금·뒤집기·안개·실행 전 강제 셔플을 해제하고 3초 면역을 준다', () => {
  for (const itemId of ['lock', 'flip', 'fog', 'force_shuffle']) {
    const { game, now } = playingGame(200 + itemId.length);
    const [attacker, defender] = game.players;
    attacker.inventory = [{ slotId: 'attack', itemId }]; attacker.inventoryRevision = 1;
    assert.equal(game.useItem('p1', { requestId: 'attack', matchId: game.matchId, slotId: 'attack', inventoryRevision: 1 }).ok, true);
    defender.inventory = [{ slotId: 'clean', itemId: 'cleanse' }]; defender.inventoryRevision = 1;
    assert.equal(game.useItem('p2', { requestId: 'clean', matchId: game.matchId, slotId: 'clean', inventoryRevision: 1 }).ok, true);
    assert.equal(Object.keys(defender.effects).length, 0);
    assert.ok(defender.immuneUntil >= now.value + 3_000);
    assert.equal(defender.board.tiles.some((tile) => tile.locked || tile.flipped || tile.fogged), false);
  }
});

test('방어막은 다음 공격 한 번만 막고 즉시 소멸한다', () => {
  const { game, now } = playingGame();
  const [attacker, defender] = game.players;
  defender.inventory = [{ slotId: 'shield', itemId: 'shield' }]; defender.inventoryRevision = 1;
  assert.equal(game.useItem('p2', { requestId: 'shield', matchId: game.matchId, slotId: 'shield', inventoryRevision: 1 }).ok, true);
  assert.ok(defender.shieldUntil > now.value);
  attacker.inventory = [{ slotId: 'lock', itemId: 'lock' }]; attacker.inventoryRevision = 1;
  const blocked = game.useItem('p1', { requestId: 'lock', matchId: game.matchId, slotId: 'lock', inventoryRevision: 1 });
  assert.equal(blocked.blocked, true);
  assert.equal(defender.shieldUntil, 0);
  assert.equal(defender.board.tiles.some((tile) => tile.locked), false);
});

test('힌트는 안내한 짝을 제거하면 즉시 종료된다', () => {
  const { game } = playingGame();
  const player = game.players[0];
  player.inventory = [{ slotId: 'hint', itemId: 'hint' }]; player.inventoryRevision = 1;
  assert.equal(game.useItem('p1', { requestId: 'hint', matchId: game.matchId, slotId: 'hint', inventoryRevision: 1 }).ok, true);
  const hint = Object.values(player.effects).find((effect) => effect.itemId === 'hint');
  assert.ok(hint);
  const accepted = game.matchPair('p1', { requestId: 'pair', matchId: game.matchId, tileAId: hint.targets[0], tileBId: hint.targets[1], boardRevision: player.board.revision });
  assert.equal(accepted.ok, true);
  assert.equal(Object.values(player.effects).some((effect) => effect.itemId === 'hint'), false);
});

test('셔플은 기존 힌트를 종료한다', () => {
  const { game, now } = playingGame();
  const [player, opponent] = game.players;
  player.inventory = [{ slotId: 'hint', itemId: 'hint' }]; player.inventoryRevision = 1;
  game.useItem('p1', { requestId: 'hint', matchId: game.matchId, slotId: 'hint', inventoryRevision: 1 });
  opponent.inventory = [{ slotId: 'shuffle', itemId: 'force_shuffle' }]; opponent.inventoryRevision = 1;
  game.useItem('p2', { requestId: 'shuffle', matchId: game.matchId, slotId: 'shuffle', inventoryRevision: 1 });
  now.value += 801; game.tick();
  assert.equal(Object.values(player.effects).some((effect) => effect.itemId === 'hint'), false);
  assert.ok(findAnyLegalPair(player.board.tiles));
});

test('stale matchId를 가진 제거 요청은 거부한다', () => {
  const { game } = playingGame();
  const player = game.players[0];
  const pair = findAnyLegalPair(player.board.tiles);
  const result = game.matchPair('p1', { requestId: 'stale-match', matchId: 'old-match', tileAId: pair.a.tileId, tileBId: pair.b.tileId, boardRevision: 0 });
  assert.equal(result.ok, false);
  assert.equal(player.removedPairs, 0);
});

test('ko/en 사전은 키가 같고 7종 아이템 이름·설명을 모두 가진다', async () => {
  globalThis.localStorage = { getItem: () => null, setItem: () => {} };
  const { COPY } = await import('../public/js/i18n.js');
  assert.deepEqual(Object.keys(COPY.ko).sort(), Object.keys(COPY.en).sort());
  for (const id of ['lock', 'flip', 'force_shuffle', 'fog', 'hint', 'cleanse', 'shield']) {
    assert.equal(typeof COPY.ko[`item_${id}`], 'string');
    assert.equal(typeof COPY.en[`item_${id}`], 'string');
    assert.equal(typeof COPY.ko[`item_${id}_description`], 'string');
    assert.equal(typeof COPY.en[`item_${id}_description`], 'string');
  }
});

test('플레이어별 초당 30회 상한이 PING 폭주를 제한한다', async () => {
  const fixture = await startServer();
  const socket = new WebSocket(`${fixture.url}?name=Rate`);
  await waitFor(socket, 'JOINED');
  let pongCount = 0;
  socket.on('message', (raw) => { if (JSON.parse(raw.toString()).type === 'PONG') pongCount += 1; });
  for (let index = 0; index < 50; index += 1) socket.send(JSON.stringify({ type: 'PING', clientTime: index }));
  await new Promise((resolve) => setTimeout(resolve, 300));
  await stopServer(fixture, [socket]);
  assert.ok(pongCount <= 30, `PONG ${pongCount}개가 반환됨`);
});

test('반복 8KB 초과 악용은 경고 뒤 연결을 종료한다', async () => {
  const fixture = await startServer();
  const socket = new WebSocket(`${fixture.url}?name=Oversize`);
  await waitFor(socket, 'JOINED');
  const closed = new Promise((resolve) => socket.once('close', resolve));
  for (let index = 0; index < 4; index += 1) socket.send(JSON.stringify({ type: 'PING', padding: 'x'.repeat(9_000) }));
  const outcome = await Promise.race([closed.then(() => 'closed'), new Promise((resolve) => setTimeout(() => resolve('open'), 500))]);
  await stopServer(fixture, [socket]);
  assert.equal(outcome, 'closed');
});

test('경기 중 REMATCH 두 표가 새 경기로 강제 초기화하지 않는다', async () => {
  const fixture = await startServer();
  const a = new WebSocket(`${fixture.url}?name=A`); const b = new WebSocket(`${fixture.url}?name=B`);
  await Promise.all([waitFor(a, 'JOINED'), waitFor(b, 'JOINED')]);
  const startA = waitFor(a, 'START'); const startB = waitFor(b, 'START');
  a.send(JSON.stringify({ type: 'READY' })); b.send(JSON.stringify({ type: 'READY' }));
  const [firstA] = await Promise.all([startA, startB]);
  const unexpected = waitFor(a, 'START', 500).then(() => true, () => false);
  a.send(JSON.stringify({ type: 'REMATCH' })); b.send(JSON.stringify({ type: 'REMATCH' }));
  const restarted = await unexpected;
  await stopServer(fixture, [a, b]);
  assert.equal(restarted, false, `경기 중 ${firstA.snapshot.matchId}가 재시작됨`);
});

test('결과 이후 한 표로는 재시작하지 않고 양측 동의에서만 START한다',async()=>{const fixture=await startServer();const a=new WebSocket(`${fixture.url}?name=A`);const b=new WebSocket(`${fixture.url}?name=B`);await Promise.all([waitFor(a,'JOINED'),waitFor(b,'JOINED')]);const startA=waitFor(a,'START');const startB=waitFor(b,'START');a.send(JSON.stringify({type:'READY'}));b.send(JSON.stringify({type:'READY'}));const [first]=await Promise.all([startA,startB]);a.send(JSON.stringify({type:'TEST_FINISH_MATCH'}));await new Promise((resolve)=>setTimeout(resolve,100));a.send(JSON.stringify({type:'REMATCH',matchId:first.snapshot.matchId}));const early=await waitFor(a,'START',250).then(()=>true,()=>false);assert.equal(early,false);const restarted=waitFor(a,'START');b.send(JSON.stringify({type:'REMATCH',matchId:first.snapshot.matchId}));const second=await restarted;assert.notEqual(second.snapshot.matchId,first.snapshot.matchId);await stopServer(fixture,[a,b]);});
