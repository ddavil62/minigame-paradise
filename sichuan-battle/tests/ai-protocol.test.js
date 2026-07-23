/**
 * @fileoverview 실제 WebSocket 자식 봇의 인증, 합법 제거와 재대결 수명주기를 검증한다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocket } from 'ws';
import { createApp } from '../server.js';

/** @param {WebSocket} ws 소켓 @param {string} type 종류 @param {(message:object)=>boolean} [predicate] 조건 @param {number} [timeout=10000] 제한 @returns {Promise<object>} 메시지 */
function waitFor(ws, type, predicate = () => true, timeout = 10000) { return new Promise((resolve, reject) => { const timer = setTimeout(() => { ws.off('message', listener); reject(new Error(`${type} timeout`)); }, timeout); function listener(raw) { let message; try { message = JSON.parse(raw.toString()); } catch { return; } if (message.type === type && predicate(message)) { clearTimeout(timer); ws.off('message', listener); resolve(message); } } ws.on('message', listener); }); }

test('REQUEST_AI가 인증 봇 한 명을 채우고 실제 합법 짝을 제거하며 재대결한다', async (t) => {
  let port = 0; const app = createApp({ testing: true, seed: 31337, duration: 30000, aiConfig: { stdio: 'inherit' }, getBotUrl: () => `ws://127.0.0.1:${port}/sichuan-battle/ws?mode=bot` });
  const server = http.createServer(app.handleHttp); server.on('upgrade', app.handleUpgrade); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); port = server.address().port;
  const human = new WebSocket(`ws://127.0.0.1:${port}/sichuan-battle/ws?name=Tester`); await waitFor(human, 'JOINED');
  t.after(async () => { human.close(); app.close(); if (server.listening) await new Promise((resolve) => server.close(resolve)); });
  const startPromise = waitFor(human, 'START', (message) => message.snapshot.opponent?.isBot === true); human.send(JSON.stringify({ type: 'READY' })); human.send(JSON.stringify({ type: 'REQUEST_AI' }));
  const start = await startPromise; assert.equal(start.snapshot.opponent.name, '사천 현자 AI');
  const progressed = await waitFor(human, 'STATE_SYNC', (message) => message.snapshot.opponent.removedPairs > 0, 12000); assert.ok(progressed.snapshot.opponent.removedPairs > 0);
  const resultPromise = waitFor(human, 'STATE_SYNC', (message) => message.snapshot.phase === 'result'); human.send(JSON.stringify({ type: 'TEST_FINISH_MATCH' })); const result = await resultPromise;
  const nextStart = waitFor(human, 'START', (message) => message.snapshot.matchId !== result.snapshot.matchId); human.send(JSON.stringify({ type: 'REMATCH', matchId: result.snapshot.matchId })); assert.ok((await nextStart).snapshot.opponent.isBot);
  human.send(JSON.stringify({ type: 'LEAVE_MATCH' }));
});

test('임의 mode=bot 연결은 서버 발급 토큰 없이는 거부된다', async (t) => {
  const app = createApp({ testing: true, getBotUrl: () => 'ws://127.0.0.1:1/sichuan-battle/ws?mode=bot' }); const server = http.createServer(app.handleHttp); server.on('upgrade', app.handleUpgrade); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/sichuan-battle/ws?mode=bot`); t.after(async () => { ws.close(); app.close(); if (server.listening) await new Promise((resolve) => server.close(resolve)); }); assert.equal((await waitFor(ws, 'ERROR')).code, 'BOT_UNAUTHORIZED');
});
