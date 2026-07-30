/**
 * @fileoverview 하나비 AI 모드 WebSocket 프로토콜과 서버 권위 실행 테스트.
 */

import { test, expect } from 'playwright/test';
import http from 'http';
import { WebSocket } from 'ws';
import { createApp } from '../server.js';

/** 메시지 큐를 제공하는 최소 WebSocket 클라이언트다. */
class Client {
  /** @param {WebSocket} ws 소켓 */
  constructor(ws) {
    this.ws = ws;
    this.queue = [];
    this.waiters = [];
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      const index = this.waiters.findIndex((waiter) => waiter.type === msg.type);
      if (index >= 0) this.waiters.splice(index, 1)[0].resolve(msg);
      else this.queue.push(msg);
    });
  }

  /** @param {string} type 기다릴 메시지 종류 @returns {Promise<object>} 메시지 */
  next(type) {
    const index = this.queue.findIndex((msg) => msg.type === type);
    if (index >= 0) return Promise.resolve(this.queue.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${type} timeout`)), 3000);
      this.waiters.push({ type, resolve: (msg) => { clearTimeout(timer); resolve(msg); } });
    });
  }

  /** @param {object} value 전송할 값 */
  send(value) { this.ws.send(JSON.stringify(value)); }
  /** 연결을 즉시 종료한다. */
  close() { this.ws.terminate(); }
}

/**
 * 테스트 서버를 연다.
 * @param {object} opts createApp 옵션
 * @returns {Promise<{server:http.Server,port:number}>} 서버 정보
 */
async function openServer(opts = {}) {
  const app = createApp(opts);
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve) => server.listen(0, resolve));
  return { server, port: server.address().port };
}

/**
 * 서버에 접속한다.
 * @param {number} port 포트
 * @returns {Promise<Client>} 클라이언트
 */
async function connect(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  return new Client(ws);
}

/** @param {http.Server} server 서버 @param {Client[]} clients 클라이언트 */
async function closeAll(server, clients) {
  clients.forEach((client) => client.close());
  await new Promise((resolve) => server.close(resolve));
}

test('p1 START_AI 한 번으로 AI START와 마스킹 STATE를 받는다', async () => {
  let observed = null;
  const { server, port } = await openServer({
    botDelayMs: 0,
    chooseBotAction: (snapshot) => {
      observed = snapshot;
      return { type: 'GIVE_CLUE', clueType: 'number', value: snapshot.opponentHand[0].number };
    },
  });
  const p1 = await connect(port);
  try {
    p1.send({ type: 'JOIN', name: '사람' });
    await p1.next('JOINED');
    p1.send({ type: 'START_AI' });
    const joined = await p1.next('JOINED');
    const start = await p1.next('START');
    const state = await p1.next('STATE');
    expect(joined.opponentIsBot).toBe(true);
    expect(start.mode).toBe('ai');
    expect(start.opponent).toEqual({ name: '별빛 AI', isBot: true });
    expect(state.myHand.every((card) => card.color === null && card.number === null)).toBe(true);

    p1.send({ type: 'PLAY_CARD', handIndex: 0 });
    await p1.next('STATE');
    const afterBot = await p1.next('STATE');
    expect(afterBot.currentTurn).toBe('p1');
    expect(observed.myHand.every((card) => card.color === null && card.number === null)).toBe(true);
  } finally {
    await closeAll(server, [p1]);
  }
});

test('중복 START_AI와 진행 중 REMATCH를 거부한다', async () => {
  const { server, port } = await openServer({ botDelayMs: 0 });
  const p1 = await connect(port);
  try {
    p1.send({ type: 'JOIN', name: '사람' });
    await p1.next('JOINED');
    p1.send({ type: 'START_AI' });
    await p1.next('START');
    await p1.next('STATE');
    p1.send({ type: 'START_AI' });
    expect((await p1.next('ERROR')).message).toContain('진행 중');
    p1.send({ type: 'REMATCH' });
    expect((await p1.next('ERROR')).message).toContain('끝난 뒤');
  } finally {
    await closeAll(server, [p1]);
  }
});

test('사람 p2가 참가한 방에서는 START_AI를 거부한다', async () => {
  const { server, port } = await openServer();
  const p1 = await connect(port);
  const p2 = await connect(port);
  try {
    p1.send({ type: 'JOIN', name: 'P1' });
    await p1.next('JOINED');
    p2.send({ type: 'JOIN', name: 'P2' });
    await p2.next('JOINED');
    p1.send({ type: 'START_AI' });
    expect((await p1.next('ERROR')).message).toContain('다른 플레이어');
  } finally {
    await closeAll(server, [p1, p2]);
  }
});

test('JOIN 전 또는 p2의 START_AI를 거부한다', async () => {
  const { server, port } = await openServer();
  const p1 = await connect(port);
  const p2 = await connect(port);
  try {
    p1.send({ type: 'START_AI' });
    expect((await p1.next('ERROR')).message).toContain('참가자');
    p1.send({ type: 'JOIN', name: 'P1' });
    await p1.next('JOINED');
    p2.send({ type: 'JOIN', name: 'P2' });
    await p2.next('JOINED');
    p2.send({ type: 'START_AI' });
    expect((await p2.next('ERROR')).message).toContain('참가자');
  } finally {
    await closeAll(server, [p1, p2]);
  }
});
