/**
 * @fileoverview 끝말잇기 AI 모드의 세션 소유권과 반응 시간 공격 QA.
 * 제품 코드는 변경하지 않고 실제 WebSocket 경계에서 비정상 mode 요청을 검증한다.
 */

import { expect, test } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import http from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { createAiChooser } from '../ai.js';
import { createApp } from '../server.js';

/** @returns {Promise<number>} 사용 가능한 로컬 포트 */
async function reservePort() {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/**
 * WebSocket 메시지를 누적하며 조건 메시지를 기다리는 클라이언트를 연다.
 * @param {string} url 접속 URL
 * @returns {Promise<{ws:WebSocket,messages:object[],wait:(predicate:(message:object)=>boolean, timeoutMs?:number)=>Promise<object>,send:(payload:object)=>void}>}
 */
async function openClient(url) {
  const ws = new WebSocket(url);
  const messages = [];
  const listeners = new Set();
  ws.on('message', (data) => {
    const message = JSON.parse(data.toString());
    messages.push(message);
    for (const listener of [...listeners]) listener(message);
  });
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  return {
    ws,
    messages,
    send: (payload) => ws.send(JSON.stringify(payload)),
    wait(predicate, timeoutMs = 8_000) {
      const prior = messages.find(predicate);
      if (prior) return Promise.resolve(prior);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          listeners.delete(onMessage);
          reject(new Error('메시지 대기 시간 초과'));
        }, timeoutMs);
        function onMessage(message) {
          if (!predicate(message)) return;
          clearTimeout(timer);
          listeners.delete(onMessage);
          resolve(message);
        }
        listeners.add(onMessage);
      });
    },
  };
}

/** @param {WebSocket|undefined} ws */
function terminate(ws) {
  if (ws && ws.readyState !== WebSocket.CLOSED) ws.terminate();
}

test('선택기는 두음·공용 중복을 지키며 막다른 후보를 피한다', () => {
  const chooser = createAiChooser(['가힣', '가나', '나라', '나비', '라디오']);
  const usedWords = new Set(['라디오']);
  const selected = chooser.chooseAiWord({
    player: { lastSyllable: '가' },
    usedWords,
    rng: () => 0,
  });
  expect(selected).toBe('가나');
  expect(usedWords).toEqual(new Set(['라디오']));

  const dueum = chooser.chooseAiWord({
    player: { lastSyllable: '라' },
    usedWords,
    rng: () => 0,
  });
  expect(dueum).toBe('나라');
});

test('실제 AI 첫 제출은 AI 턴 시작 후 1.2~2.0초 범위이며 한 봇만 참가한다', async () => {
  let port = 0;
  const app = createApp({
    getBotUrl: () => `ws://127.0.0.1:${port}/ws?mode=bot`,
    random: () => 0.99,
  });
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
  const human = await openClient(`ws://127.0.0.1:${port}/ws?mode=ai`);
  try {
    human.send({ type: 'JOIN', name: '반응시간QA' });
    await human.wait((message) => message.type === 'GAME_START');
    await human.wait((message) => message.type === 'PLAYING', 5_000);
    const initialState = await human.wait((message) => message.type === 'STATE', 5_000);
    expect(initialState.turn).toBe('p2');
    expect(initialState.chain.lastSyllable).toBeNull();
    const startedAt = performance.now();
    const accepted = await human.wait(
      (message) => message.type === 'WORD_ACCEPTED' && message.playerId === 'p2',
      3_000,
    );
    const elapsed = performance.now() - startedAt;
    expect(elapsed).toBeGreaterThanOrEqual(1_150);
    expect(elapsed).toBeLessThanOrEqual(2_300);
    expect(accepted.word).toMatch(/^[가-힣]{2,}$/);
    expect(human.messages.filter((message) => message.type === 'GAME_START')).toHaveLength(1);
    expect(human.messages.filter((message) => message.type === 'PLAYING')).toHaveLength(1);
  } finally {
    terminate(human.ws);
    await new Promise((resolve) => server.close(resolve));
  }
});

test('mode 없는 사람 2인에서는 봇 URL을 조회하거나 봇 슬롯을 만들지 않는다', async () => {
  let botUrlCalls = 0;
  const app = createApp({ getBotUrl: () => { botUrlCalls += 1; return null; } });
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const p1 = await openClient(`ws://127.0.0.1:${port}/ws`);
  const p2 = await openClient(`ws://127.0.0.1:${port}/ws?mode=unexpected`);
  try {
    p1.send({ type: 'JOIN', name: '사람1' });
    p2.send({ type: 'JOIN', name: '사람2' });
    const start = await p1.wait((message) => message.type === 'GAME_START');
    expect(start.players.map((player) => player.name)).toEqual(['사람1', '사람2']);
    expect(botUrlCalls).toBe(0);
  } finally {
    terminate(p1.ws);
    terminate(p2.ws);
    await new Promise((resolve) => server.close(resolve));
  }
});

test('중복 AI 요청과 빠른 이탈 뒤 새 AI 세션은 단일 경기만 시작한다', async () => {
  let port = 0;
  const app = createApp({ getBotUrl: () => `ws://127.0.0.1:${port}/ws?mode=bot` });
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
  const first = await openClient(`ws://127.0.0.1:${port}/ws?mode=ai`);
  let duplicate;
  let replacement;
  try {
    first.send({ type: 'JOIN', name: '첫세션' });
    duplicate = await openClient(`ws://127.0.0.1:${port}/ws?mode=ai`);
    expect((await duplicate.wait(() => true)).type).toBe('ERROR');
    terminate(first.ws);
    await new Promise((resolve) => first.ws.once('close', resolve));

    replacement = await openClient(`ws://127.0.0.1:${port}/ws?mode=ai`);
    replacement.send({ type: 'JOIN', name: '교체세션' });
    const start = await replacement.wait((message) => message.type === 'GAME_START');
    expect(start.players.map((player) => player.name)).toEqual(['교체세션', 'AI (보통)']);
    await replacement.wait((message) => message.type === 'PLAYING', 5_000);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(replacement.messages.filter((message) => message.type === 'GAME_START')).toHaveLength(1);
    expect(replacement.messages.filter((message) => message.type === 'PLAYING')).toHaveLength(1);
  } finally {
    terminate(duplicate?.ws);
    terminate(replacement?.ws);
    terminate(first.ws);
    await new Promise((resolve) => server.close(resolve));
  }
});

test('독립 서버 종료 후 해당 포트의 bot.js 프로세스가 남지 않는다', async () => {
  test.skip(process.platform !== 'win32', 'Windows 프로세스 생명주기 전용 검증');
  const port = await reservePort();
  const serverChild = spawn(process.execPath, ['server.js', '--port', String(port)], {
    cwd: new URL('..', import.meta.url),
    stdio: 'ignore',
  });
  let human;
  try {
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      try {
        human = await openClient(`ws://127.0.0.1:${port}/ws?mode=ai`);
        break;
      } catch (_) {
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
    }
    expect(human).toBeTruthy();
    human.send({ type: 'JOIN', name: '종료QA' });
    await human.wait((message) => message.type === 'GAME_START', 8_000);
    serverChild.kill();
    await Promise.race([
      new Promise((resolve) => serverChild.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 800));
    const escapedPort = String(port);
    const output = execFileSync('powershell.exe', ['-NoProfile', '-Command',
      `Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*bot.js*' -and $_.CommandLine -like '*${escapedPort}*' } | Select-Object -ExpandProperty ProcessId`,
    ], { encoding: 'utf8' }).trim();
    expect(output).toBe('');
  } finally {
    terminate(human?.ws);
    if (serverChild.exitCode === null) serverChild.kill();
  }
});

test('서버가 실행하지 않은 mode=bot 연결은 자식 프로세스가 살아 있어도 슬롯을 탈취하지 못한다', async () => {
  const sinkPort = await reservePort();
  const sinkServer = http.createServer();
  const sinkWss = new WebSocketServer({ server: sinkServer });
  let resolveSinkConnection;
  const sinkConnected = new Promise((resolve) => { resolveSinkConnection = resolve; });
  sinkWss.on('connection', () => resolveSinkConnection());
  await new Promise((resolve) => sinkServer.listen(sinkPort, '127.0.0.1', resolve));

  const app = createApp({ getBotUrl: () => `ws://127.0.0.1:${sinkPort}/held-open` });
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const human = await openClient(`ws://127.0.0.1:${port}/ws?mode=ai`);
  let impostor;
  try {
    human.send({ type: 'JOIN', name: '소유권QA' });
    await sinkConnected;
    impostor = await openClient(`ws://127.0.0.1:${port}/ws?mode=bot`);
    const first = await impostor.wait(() => true, 2_000);
    expect(first.type).toBe('ERROR');
    expect(human.messages.some((message) => message.type === 'GAME_START')).toBe(false);
  } finally {
    terminate(impostor?.ws);
    terminate(human.ws);
    for (const client of sinkWss.clients) terminate(client);
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => sinkServer.close(resolve));
  }
});
