/**
 * @fileoverview 사천성 AI 모드의 런처 통합 진입과 운영 템포 계약을 독립 검증한다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import { chooseAiDelay } from '../lib/ai.js';

/** @param {number} ms 대기 시간 @returns {Promise<void>} 완료 약속 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** @returns {Promise<number>} 사용 가능한 포트 */
async function reservePort() {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/** @param {WebSocket} socket 소켓 @param {string} type 메시지 종류 @param {number} [timeout=5000] 제한 @returns {Promise<object>} 메시지 */
function waitFor(socket, type, timeout = 5_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', listener);
      reject(new Error(`${type} timeout`));
    }, timeout);
    function listener(raw) {
      const message = JSON.parse(raw.toString());
      if (message.type !== type) return;
      clearTimeout(timer);
      socket.off('message', listener);
      resolve(message);
    }
    socket.on('message', listener);
  });
}

/** @param {WebSocket} socket 소켓 @param {string} type 종류 @param {(message:object)=>boolean} predicate 조건 @param {number} [timeout=12000] 제한 @returns {Promise<object>} 메시지 */
function waitForMatching(socket, type, predicate, timeout = 12_000) { return new Promise((resolve, reject) => { const timer = setTimeout(() => { socket.off('message', listener); reject(new Error(`${type} matching timeout`)); }, timeout); function listener(raw) { const message = JSON.parse(raw.toString()); if (message.type !== type || !predicate(message)) return; clearTimeout(timer); socket.off('message', listener); resolve(message); } socket.on('message', listener); }); }

/** @param {import('node:child_process').ChildProcess} child 자식 프로세스 @returns {Promise<void>} 종료 완료 */
async function stopChild(child) {
  if (child.exitCode !== null) return;
  child.kill();
  await Promise.race([new Promise((resolve) => child.once('exit', resolve)), sleep(2_000)]);
}

test('운영 AI 지연은 상세 스펙의 첫 행동·일반·아이템 범위를 따른다', () => {
  const snapshot = { me: { effects: [] } };
  assert.equal(chooseAiDelay('first', snapshot, () => 0), 900);
  assert.equal(chooseAiDelay('first', snapshot, () => 1), 1_700);
  assert.equal(chooseAiDelay('pair', snapshot, () => 0), 850);
  assert.equal(chooseAiDelay('pair', snapshot, () => 1), 1_550);
  assert.equal(chooseAiDelay('item', snapshot, () => 0), 550);
  assert.equal(chooseAiDelay('item', snapshot, () => 1), 1_200);
});

test('런처 FILL_WITH_AI는 사람 한 명을 실제 AI 경기 START까지 연결한다', async (context) => {
  const port = await reservePort();
  const launcher = spawn(process.execPath, ['launcher/server.js', '--port', String(port)], {
    cwd: new URL('../..', import.meta.url),
    stdio: process.env.SICHUAN_AI_DEBUG === '1' ? 'inherit' : 'ignore',
  });
  const sockets = [];
  context.after(async () => {
    for (const socket of sockets) socket.close();
    await stopChild(launcher);
  });

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/`)).ok) break;
    } catch {
      await sleep(100);
    }
  }

  const lobby = new WebSocket(`ws://127.0.0.1:${port}/lobby/ws?gameId=sichuan-battle`);
  sockets.push(lobby);
  await new Promise((resolve, reject) => { lobby.once('open', resolve); lobby.once('error', reject); });
  lobby.send(JSON.stringify({ type: 'JOIN', name: 'IndependentQA' }));
  lobby.send(JSON.stringify({ type: 'READY' }));
  const redirectPromise = waitFor(lobby, 'REDIRECT');
  lobby.send(JSON.stringify({ type: 'FILL_WITH_AI' }));
  const redirect = await redirectPromise;
  assert.equal(redirect.mode, 'ai', 'AI 채우기인데 런처가 human 모드로 리다이렉트했다');

  const gamePath = `${redirect.path.replace(/\/$/, '')}/ws`;
  const game = new WebSocket(`ws://127.0.0.1:${port}${gamePath}?name=IndependentQA`);
  sockets.push(game);
  await waitFor(game, 'JOINED');
  const startPromise = waitFor(game, 'START', 8_000);
  game.send(JSON.stringify({ type: 'READY' }));
  game.send(JSON.stringify({ type: 'REQUEST_AI' }));
  const start = await startPromise;
  assert.equal(start.snapshot.opponent?.isBot, true);
  const progressed = await waitForMatching(game, 'STATE_SYNC', (message) => message.snapshot.opponent?.removedPairs > 0);
  assert.ok(progressed.snapshot.opponent.removedPairs > 0, '런처 진입 AI가 실제 합법 짝을 제거하지 않았다');
});
