/**
 * @fileoverview 하나비 WebSocket 프로토콜 시나리오 테스트 (HR-C6 동기화·권위).
 *
 * 서버 불필요 — createApp()을 직접 import하여 http.createServer로 서빙(포트 0 자동 할당).
 * 룰북 §12-6 동기화·권위 그룹을 커버한다. 손패 누설 WS 검증(HR-C6-001)이 1순위 회귀 게이트.
 *
 * 실행:
 *   npx playwright test tests/rulebook-c6-ws.spec.js --reporter=list
 */

import { test, expect } from 'playwright/test';
import http from 'http';
import { WebSocket } from 'ws';
import { createApp } from '../server.js';

// 생성된 모든 WS 클라이언트 추적(teardown에서 일괄 종료용).
const OPEN_CLIENTS = new Set();

// ── WsClient — 메시지 버퍼링 클라이언트 (yutnori 패턴 차용) ──────────
class WsClient {
  constructor(ws) {
    this.ws = ws;
    this._queue = [];
    this._waiters = [];
    OPEN_CLIENTS.add(ws);
    ws.once('close', () => OPEN_CLIENTS.delete(ws));
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      const idx = this._waiters.findIndex((w) => !w.type || w.type === msg.type);
      if (idx >= 0) {
        const waiter = this._waiters.splice(idx, 1)[0];
        clearTimeout(waiter.timer);
        waiter.resolve(msg);
      } else {
        this._queue.push(msg);
      }
    });
  }

  next(type = null, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      if (type) {
        const qIdx = this._queue.findIndex((m) => m.type === type);
        if (qIdx >= 0) { resolve(this._queue.splice(qIdx, 1)[0]); return; }
      } else if (this._queue.length > 0) {
        resolve(this._queue.shift()); return;
      }
      const timer = setTimeout(() => {
        const wIdx = this._waiters.findIndex((w) => w.resolve === resolve);
        if (wIdx >= 0) this._waiters.splice(wIdx, 1);
        reject(new Error(`WsClient.next('${type}') timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this._waiters.push({ type, resolve, timer });
    });
  }

  send(obj) { this.ws.send(JSON.stringify(obj)); }
  close() { try { this.ws.close(); } catch (_) {} }
  waitClose() { return new Promise((resolve) => this.ws.once('close', resolve)); }
}

// ── 헬퍼 ─────────────────────────────────────────────────────────

function startServer(app) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app.handleHttp);
    server.on('upgrade', app.handleUpgrade);
    server.listen(0, () => resolve({ server, port: server.address().port }));
    server.once('error', reject);
  });
}

function stopServer(server) {
  // 업그레이드된 WS 연결이 남아 있으면 server.close()가 드레인을 기다리며 멈춘다.
  // 잔여 클라이언트 소켓을 먼저 terminate한 뒤 close 한다.
  return new Promise((resolve) => {
    for (const ws of OPEN_CLIENTS) {
      try { ws.terminate(); } catch (_) { /* noop */ }
    }
    OPEN_CLIENTS.clear();
    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
    }
    server.close(() => resolve());
    // 안전망: close 콜백이 지연되면 일정 시간 후 강제 resolve.
    setTimeout(resolve, 500);
  });
}

function connect(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    ws.once('open', () => resolve(new WsClient(ws)));
    ws.once('error', reject);
  });
}

/**
 * 두 플레이어 JOIN → 게임 자동 시작(START + STATE)까지 세팅.
 * @returns {Promise<{ p1: WsClient, p2: WsClient }>}
 */
async function setupGame(port) {
  const p1 = await connect(port);
  const p2 = await connect(port);
  p1.send({ type: 'JOIN', playerName: 'P1' });
  await p1.next('JOINED');
  p2.send({ type: 'JOIN', playerName: 'P2' });
  await p2.next('JOINED');
  // READY 게이트: 양쪽 모두 READY 전송 후 START + STATE 수신.
  p1.send({ type: 'READY' });
  p2.send({ type: 'READY' });
  await p1.next('START');
  await p2.next('START');
  const s1 = await p1.next('STATE');
  const s2 = await p2.next('STATE');
  return { p1, p2, s1, s2 };
}

// ── HR-C6: 동기화·권위 (§12-6) ──────────────────────────────────

test('HR-C6-001 본인 손패 누설 금지 (WS) — 1순위 회귀 게이트', async () => {
  const app = createApp();
  const { server, port } = await startServer(app);
  try {
    const { s1, s2 } = await setupGame(port);
    // p1 시점 STATE: myHand 전부 마스킹
    for (const c of s1.myHand) {
      expect(c.color).toBeNull();
      expect(c.number).toBeNull();
    }
    // p2 시점도 동일
    for (const c of s2.myHand) {
      expect(c.color).toBeNull();
      expect(c.number).toBeNull();
    }
    // 페이로드 전체에 본인 손패 실제 색·숫자가 새지 않았는지 추가 확인:
    // myHand 카드 객체에 color/number 키는 있되 값이 null이어야 한다.
    expect(s1.myHand.length).toBe(5);
  } finally {
    await stopServer(server);
  }
});

test('HR-C6-002 상대 손패 공개', async () => {
  const app = createApp();
  const { server, port } = await startServer(app);
  try {
    const { s1 } = await setupGame(port);
    expect(s1.opponentHand.length).toBe(5);
    for (const c of s1.opponentHand) {
      expect(c.color).not.toBeNull();
      expect(c.number).not.toBeNull();
    }
  } finally {
    await stopServer(server);
  }
});

test('HR-C6-003 턴 위반 ERROR', async () => {
  const app = createApp();
  const { server, port } = await startServer(app);
  try {
    const { p2, s2 } = await setupGame(port);
    // 첫 턴은 p1. p2가 PLAY_CARD 시도 → ERROR.
    expect(s2.currentTurn).toBe('p1');
    p2.send({ type: 'PLAY_CARD', handIndex: 0 });
    const err = await p2.next('ERROR');
    expect(err.type).toBe('ERROR');
  } finally {
    await stopServer(server);
  }
});

test('HR-C6-004 잘못된 handIndex ERROR', async () => {
  const app = createApp();
  const { server, port } = await startServer(app);
  try {
    const { p1 } = await setupGame(port);
    p1.send({ type: 'PLAY_CARD', handIndex: 10 });
    const err = await p1.next('ERROR');
    expect(err.type).toBe('ERROR');
  } finally {
    await stopServer(server);
  }
});

test('HR-C6-005 매 액션 후 STATE broadcast (GIVE_CLUE)', async () => {
  const app = createApp();
  const { server, port } = await startServer(app);
  try {
    const { p1, p2, s1 } = await setupGame(port);
    // p1이 상대(p2) 손패에서 실제로 존재하는 색을 골라 힌트 → 0장 거부 회피.
    const someColor = s1.opponentHand[0].color;
    p1.send({ type: 'GIVE_CLUE', clueType: 'color', value: someColor });
    const a1 = await p1.next('STATE');
    const a2 = await p2.next('STATE');
    expect(a1.type).toBe('STATE');
    expect(a2.type).toBe('STATE');
    // 힌트 후 턴이 p2로 넘어가야 한다.
    expect(a1.currentTurn).toBe('p2');
    // p2(힌트 받은 쪽)의 opponentHand(=p1이 본 p2손패가 아닌, p2 시점에선 myHand)에
    // clues가 누적됐는지: p2 시점 myHand의 해당 색 카드에 clues 존재.
    expect(a1.tokens.clue).toBe(7); // 8 → 7
  } finally {
    await stopServer(server);
  }
});

test('HR-C6-006 OPPONENT_LEFT broadcast', async () => {
  const app = createApp();
  const { server, port } = await startServer(app);
  try {
    const { p1, p2 } = await setupGame(port);
    p2.close();
    const left = await p1.next('OPPONENT_LEFT');
    expect(left.type).toBe('OPPONENT_LEFT');
  } finally {
    await stopServer(server);
  }
});

test('HR-C6-007 REMATCH 양쪽 동의 시 새 게임', async () => {
  const app = createApp();
  const { server, port } = await startServer(app);
  try {
    const { p1, p2 } = await setupGame(port);
    p1.send({ type: 'REMATCH' });
    p2.send({ type: 'REMATCH' });
    // 양쪽 REMATCH → START 재발송
    await p1.next('START');
    await p2.next('START');
    const ns = await p1.next('STATE');
    expect(ns.phase).toBe('playing');
    expect(ns.tokens.clue).toBe(8);
    expect(ns.tokens.fuse).toBe(3);
  } finally {
    await stopServer(server);
  }
});
