/**
 * @fileoverview 런처 대기실과 테트리스 종료 방의 지연 close가 새 세션을 훼손하지 않는지 검증한다.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import WebSocket from 'ws';

/** @returns {Promise<number>} 사용 가능한 로컬 포트 */
async function reservePort() {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/**
 * 격리된 통합 런처를 시작한다.
 * @returns {Promise<{port:number, child:import('node:child_process').ChildProcess}>} 서버 픽스처
 */
async function startLauncher() {
  const port = await reservePort();
  const child = spawn(process.execPath, ['launcher/server.js', '--port', String(port)], {
    cwd: new URL('..', import.meta.url),
    stdio: 'ignore',
  });
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/`)).ok) return { port, child };
    } catch {
      // HTTP 리스너가 열릴 때까지 재시도한다.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  child.kill();
  throw new Error('launcher startup timeout');
}

/**
 * 지정 URL에 연결하고 메시지 대기 도우미를 부착한다.
 * @param {string} url WebSocket URL
 * @returns {Promise<{ws:WebSocket, waitFor:(type:string, predicate?:(message:object)=>boolean)=>Promise<object>}>} 연결 하네스
 */
async function connect(url) {
  const ws = new WebSocket(url);
  const messages = [];
  const waiters = [];
  ws.on('message', (data) => {
    const message = JSON.parse(data.toString());
    messages.push(message);
    for (const waiter of [...waiters]) {
      if (waiter.type !== message.type || !waiter.predicate(message)) continue;
      waiters.splice(waiters.indexOf(waiter), 1);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    }
  });
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });

  /**
   * 조건에 맞는 서버 메시지를 기다린다.
   * @param {string} type 메시지 타입
   * @param {(message:object)=>boolean} [predicate] 추가 조건
   * @returns {Promise<object>} 수신 메시지
   */
  function waitFor(type, predicate = () => true) {
    const existing = messages.find((message) => message.type === type && predicate(message));
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const waiter = { type, predicate, resolve, timer: null };
      waiter.timer = setTimeout(() => {
        waiters.splice(waiters.indexOf(waiter), 1);
        reject(new Error(`${type} message timeout`));
      }, 5_000);
      waiters.push(waiter);
    });
  }

  return { ws, waitFor };
}

/**
 * 테스트 케이스를 실행한다.
 * @param {string} name 이름
 * @param {()=>Promise<void>} body 본문
 * @returns {Promise<void>}
 */
async function run(name, body) {
  await body();
  console.log(`PASS ${name}`);
}

const launcher = await startLauncher();
try {
  await run('구 런처 소켓의 지연 close가 같은 게임의 새 대기실을 삭제하지 않음', async () => {
    const url = `ws://127.0.0.1:${launcher.port}/lobby/ws?gameId=moonlight-kitchen-express`;
    const oldA = await connect(url);
    const oldB = await connect(url);
    oldA.ws.send(JSON.stringify({ type: 'JOIN', name: 'old-a' }));
    oldB.ws.send(JSON.stringify({ type: 'JOIN', name: 'old-b' }));
    oldA.ws.send(JSON.stringify({ type: 'READY' }));
    oldB.ws.send(JSON.stringify({ type: 'READY' }));
    await Promise.all([oldA.waitFor('REDIRECT'), oldB.waitFor('REDIRECT')]);

    const nextA = await connect(url);
    nextA.ws.send(JSON.stringify({ type: 'JOIN', name: 'next-a' }));
    oldA.ws.close();
    oldB.ws.close();
    await new Promise((resolve) => setTimeout(resolve, 30));

    const nextB = await connect(url);
    nextB.ws.send(JSON.stringify({ type: 'JOIN', name: 'next-b' }));
    const state = await nextA.waitFor('ROOM_STATE', (message) => message.totalCount === 2);
    assert.equal(state.players.length, 2);
    nextA.ws.close();
    nextB.ws.close();
  });

  await run('종료된 테트리스 방의 지연 close 뒤 새 2인이 Room is full 없이 시작', async () => {
    const url = `ws://127.0.0.1:${launcher.port}/tetris-battle/ws`;
    const oldA = await connect(url);
    const oldB = await connect(url);
    oldA.ws.send(JSON.stringify({ type: 'JOIN', playerName: 'old-a' }));
    oldB.ws.send(JSON.stringify({ type: 'JOIN', playerName: 'old-b' }));
    await Promise.all([oldA.waitFor('JOINED'), oldB.waitFor('JOINED')]);
    oldA.ws.send(JSON.stringify({ type: 'READY' }));
    oldB.ws.send(JSON.stringify({ type: 'READY' }));
    await oldA.waitFor('START');
    oldA.ws.send(JSON.stringify({ type: 'GAME_OVER' }));
    await oldA.waitFor('GAME_RESULT');

    const nextA = await connect(url);
    nextA.ws.send(JSON.stringify({ type: 'JOIN', playerName: 'next-a' }));
    await nextA.waitFor('JOINED');
    const nextB = await connect(url);
    nextB.ws.send(JSON.stringify({ type: 'JOIN', playerName: 'next-b' }));
    await nextB.waitFor('JOINED');
    nextA.ws.send(JSON.stringify({ type: 'READY' }));
    nextB.ws.send(JSON.stringify({ type: 'READY' }));
    await Promise.all([nextA.waitFor('START'), nextB.waitFor('START')]);
    nextA.ws.close();
    nextB.ws.close();
  });
} finally {
  launcher.child.kill();
}

console.log('phase-a-session-lifecycle: all tests passed');
