/**
 * @fileoverview Phase 1-B 윷놀이 N인(2~4) 확장 QA 테스트.
 *
 * 검증 대상:
 *   AC-Y1: 3인 게임 진입 시 p1/p2/p3 각자 4개 말(총 12말) 초기화
 *   AC-Y2: 턴 순서 p1->p2->p3->p1 순환
 *   AC-Y3: p1 말이 p2 또는 p3 말 위 착지 시 잡기 발생 (p1 말끼리는 잡기 없음)
 *   AC-Y4: 4인 게임에서 어느 플레이어든 4말 완주 시 GAME_OVER
 *   AC-Y5: 2인(N=2) 게임은 기존 회귀 테스트 342/342 전부 PASS (별도 실행)
 *
 * 신규 시나리오:
 *   YM-001 ~ YM-005: 3인/4인 WS 직접 연결 검증
 *
 * 추가 엣지케이스:
 *   YM-006 ~ YM-012: QA 자체 도출 예외 시나리오
 *
 * 실행:
 *   cd yutnori && npx playwright test tests/multiplayer-1b-qa.spec.js --reporter=list
 */
import { test, expect } from 'playwright/test';
import http from 'http';
import { WebSocket } from 'ws';
import { createApp } from '../server.js';

// ── 헬퍼 ──────────────────────────────────────────────────────────

class WsClient {
  constructor(ws) {
    this.ws = ws;
    this._queue = [];
    this._waiters = [];
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      const idx = this._waiters.findIndex(
        (w) => !w.type || w.type === msg.type,
      );
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
      } else if (this._queue.length > 0) { resolve(this._queue.shift()); return; }
      const timer = setTimeout(() => {
        const wIdx = this._waiters.findIndex((w) => w.resolve === resolve);
        if (wIdx >= 0) this._waiters.splice(wIdx, 1);
        reject(new Error(`WsClient.next('${type}') timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this._waiters.push({ type, resolve, timer });
    });
  }

  drain(type) {
    let cnt = 0;
    while (true) {
      const idx = this._queue.findIndex((m) => m.type === type);
      if (idx < 0) break;
      this._queue.splice(idx, 1);
      cnt++;
    }
    return cnt;
  }

  send(obj) { this.ws.send(JSON.stringify(obj)); }
  close() { try { this.ws.close(); } catch (_) { /* noop */ } }
}

function startServer(app) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app.handleHttp);
    server.on('upgrade', app.handleUpgrade);
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string' || typeof addr.port !== 'number') {
        reject(new Error('startServer: invalid address'));
        return;
      }
      resolve({ server, port: addr.port });
    });
  });
}

function stopServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

function connectWs(port, query = '') {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}${query}`);
    ws.once('open', () => resolve(new WsClient(ws)));
    ws.once('error', reject);
  });
}

async function inject(port, cfg) {
  let lastErr;
  for (let i = 0; i < 5; i++) {
    try {
      const res = await fetch(`http://localhost:${port}/test/inject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Connection: 'close' },
        body: JSON.stringify(cfg),
      });
      return res.json();
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 20 * Math.pow(2, i)));
    }
  }
  throw lastErr;
}

/**
 * N인 게임을 설정한다. 첫 접속자가 ?players=N 쿼리를 전달한다.
 * @param {number} port
 * @param {number} n 플레이어 수 (2~4)
 * @returns {Promise<WsClient[]>} 플레이어 배열 [p1, p2, ...]
 */
async function setupNPlayerGame(port, n) {
  const clients = [];

  // 첫 번째 접속자가 정원을 결정 (?players=N)
  for (let i = 0; i < n; i++) {
    const query = i === 0 ? `?players=${n}` : '';
    const c = await connectWs(port, query);
    clients.push(c);
  }

  // JOIN
  for (let i = 0; i < n; i++) {
    clients[i].send({ type: 'JOIN', playerName: `TestP${i + 1}` });
  }

  // JOINED 수신
  for (let i = 0; i < n; i++) {
    await clients[i].next('JOINED');
  }

  // STATE가 broadcastState에서 발생: 마지막 JOIN 시 전원 모이면 broadcast
  // N명의 JOIN 중 마지막 JOIN이 roomMaxPlayers를 채우면 broadcastState 호출
  // 드레인: 각 클라이언트에 STATE 메시지가 1~N개 쌓일 수 있음
  for (const c of clients) {
    c.drain('STATE');
  }
  // 짧은 대기 후 남은 STATE 추가 드레인
  await new Promise(r => setTimeout(r, 100));
  for (const c of clients) {
    c.drain('STATE');
  }

  // READY
  for (const c of clients) {
    c.send({ type: 'READY' });
  }

  // START + STATE 수신
  for (const c of clients) {
    await c.next('START');
  }
  for (const c of clients) {
    await c.next('STATE');
  }

  return clients;
}

/**
 * N인 inject 후 모든 클라이언트의 STATE를 드레인한다.
 */
async function injectAndDrainN(port, clients, cfg) {
  await inject(port, cfg);
  for (const c of clients) {
    await c.next('STATE');
  }
  if (cfg.winner) {
    for (const c of clients) {
      await c.next('GAME_OVER');
    }
  }
}

// ── 테스트 ──────────────────────────────────────────────────────────

let server, port;

test.beforeEach(async () => {
  const app = createApp();
  const s = await startServer(app);
  server = s.server;
  port = s.port;
});

test.afterEach(async () => {
  if (server) await stopServer(server);
});

// =====================================================================
// AC-Y1: 3인 게임 진입 시 p1/p2/p3 각자 4개 말(총 12말) 초기화
// =====================================================================
test.describe('AC-Y1: 3인 초기화', () => {

  test('YM-001: 3인 접속 후 STATE에 p1/p2/p3 각 4개 말 존재', async () => {
    const clients = await setupNPlayerGame(port, 3);
    try {
      // inject로 STATE 재요청 (현재 상태 확인)
      await inject(port, {});
      const state = await clients[0].next('STATE');

      // players 배열에 3명 존재
      expect(state.players.length).toBe(3);

      // 각 플레이어 ID 확인
      const ids = state.players.map(p => p.id);
      expect(ids).toContain('p1');
      expect(ids).toContain('p2');
      expect(ids).toContain('p3');

      // 각 플레이어 4개 말 확인
      for (const p of state.players) {
        expect(p.pieces.length).toBe(4);
        // 모든 말이 HOME(-1)에 있는지 확인
        for (const piece of p.pieces) {
          expect(piece.cell).toBe(-1);
          expect(piece.done).toBe(false);
          expect(piece.stack).toBe(1);
        }
      }

      // 총 말 수 12개
      const totalPieces = state.players.reduce((sum, p) => sum + p.pieces.length, 0);
      expect(totalPieces).toBe(12);
    } finally {
      clients.forEach(c => c.close());
    }
  });

  test('YM-001b: 4인 접속 후 STATE에 p1/p2/p3/p4 각 4개 말(총 16말) 존재', async () => {
    const clients = await setupNPlayerGame(port, 4);
    try {
      await inject(port, {});
      const state = await clients[0].next('STATE');

      expect(state.players.length).toBe(4);
      const ids = state.players.map(p => p.id);
      expect(ids).toContain('p1');
      expect(ids).toContain('p2');
      expect(ids).toContain('p3');
      expect(ids).toContain('p4');

      for (const p of state.players) {
        expect(p.pieces.length).toBe(4);
      }
      const totalPieces = state.players.reduce((sum, p) => sum + p.pieces.length, 0);
      expect(totalPieces).toBe(16);
    } finally {
      clients.forEach(c => c.close());
    }
  });
});

// =====================================================================
// AC-Y2: 턴 순서 p1->p2->p3->p1 순환
// =====================================================================
test.describe('AC-Y2: 턴 순환', () => {

  test('YM-002: 3인 게임에서 p1->p2->p3->p1 턴 순환', async () => {
    const clients = await setupNPlayerGame(port, 3);
    try {
      // 비모서리·비중앙 셀만 사용, 결과도 비보너스(do)
      // 전체 상태를 한번에 주입 후, 각 플레이어가 순서대로 이동하여 턴 전환 검증.
      // 단, 각 단계에서 inject로 결과 큐만 채운 뒤 MOVE 수행.
      // inject는 broadcastState를 호출하므로 모든 클라이언트에 STATE 1개씩.

      // Step 1: p1 턴
      await injectAndDrainN(port, clients, {
        started: true,
        currentTurn: 'p1',
        pendingResults: ['do'],
        capturedBonus: false,
        pendingThrows: 0,
        pieces: {
          p1: [{ cell: 2, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }],
          p2: [{ cell: 7, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }],
          p3: [{ cell: 12, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }],
        },
      });
      clients[0].send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
      // MOVE_PIECE 후 broadcastState -> 모든 클라이언트에 STATE 1개
      const state1 = await clients[0].next('STATE');
      expect(state1.currentTurn).toBe('p2');
      // 나머지 클라이언트의 STATE 드레인
      for (const c of clients) c.drain('STATE');
      await new Promise(r => setTimeout(r, 50));
      for (const c of clients) c.drain('STATE');

      // Step 2: p2 턴 -- inject로 pendingResults만 추가
      // 주의: inject가 broadcastState를 호출하므로 drain 필요
      await inject(port, { pendingResults: ['do'] });
      for (const c of clients) await c.next('STATE');

      clients[1].send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
      const state2 = await clients[1].next('STATE');
      expect(state2.currentTurn).toBe('p3');
      for (const c of clients) c.drain('STATE');
      await new Promise(r => setTimeout(r, 50));
      for (const c of clients) c.drain('STATE');

      // Step 3: p3 턴
      await inject(port, { pendingResults: ['do'] });
      for (const c of clients) await c.next('STATE');

      clients[2].send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
      const state3 = await clients[2].next('STATE');
      expect(state3.currentTurn).toBe('p1');
    } finally {
      clients.forEach(c => c.close());
    }
  });

  test('YM-002b: 4인 게임에서 p1->p2->p3->p4->p1 턴 순환', async () => {
    const clients = await setupNPlayerGame(port, 4);
    try {
      // Step 1: 전체 상태 주입 (비모서리 셀)
      await injectAndDrainN(port, clients, {
        started: true,
        currentTurn: 'p1',
        pendingResults: ['gae'],
        capturedBonus: false,
        pendingThrows: 0,
        pieces: {
          p1: [{ cell: 1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }],
          p2: [{ cell: 6, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }],
          p3: [{ cell: 11, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }],
          p4: [{ cell: 16, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }],
        },
      });

      const expectedOrder = ['p1', 'p2', 'p3', 'p4', 'p1'];

      for (let i = 0; i < 4; i++) {
        const nextId = expectedOrder[i + 1];
        const playerIdx = i;

        // i>0이면 inject로 pendingResults 채움
        if (i > 0) {
          await inject(port, { pendingResults: ['gae'] });
          for (const c of clients) await c.next('STATE');
        }

        clients[playerIdx].send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'gae' });
        const state = await clients[playerIdx].next('STATE');
        expect(state.currentTurn).toBe(nextId);
        // 드레인
        for (const c of clients) c.drain('STATE');
        await new Promise(r => setTimeout(r, 50));
        for (const c of clients) c.drain('STATE');
      }
    } finally {
      clients.forEach(c => c.close());
    }
  });
});

// =====================================================================
// AC-Y3: 잡기 검증 (p1이 p2/p3를 잡을 수 있고, p1끼리는 잡기 없음)
// =====================================================================
test.describe('AC-Y3: N인 잡기', () => {

  test('YM-003: p1 말이 p2 말 위 착지 시 capture 발생, p2 말 HOME으로 복귀', async () => {
    const clients = await setupNPlayerGame(port, 3);
    try {
      // p1의 말 0이 cell 2에, p2의 말 0이 cell 3에 위치
      // p1이 'do'(1칸)로 cell 2->3, p2 말 위 착지 -> capture
      await injectAndDrainN(port, clients, {
        started: true,
        currentTurn: 'p1',
        pendingResults: ['do'],
        capturedBonus: false,
        pendingThrows: 0,
        pieces: {
          p1: [{ cell: 2, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }],
          p2: [{ cell: 3, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }],
          p3: [{ cell: 15, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }],
        },
      });

      clients[0].send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
      const state = await clients[0].next('STATE');

      // p1 말이 cell 3에 도착
      const p1 = state.players.find(p => p.id === 'p1');
      expect(p1.pieces[0].cell).toBe(3);

      // p2 말이 HOME(-1)으로 복귀
      const p2 = state.players.find(p => p.id === 'p2');
      expect(p2.pieces[0].cell).toBe(-1);

      // 잡기 보너스 발생(capturedBonus=true) -> p1 턴 유지
      expect(state.capturedBonus).toBe(true);
      expect(state.currentTurn).toBe('p1');
    } finally {
      clients.forEach(c => c.close());
    }
  });

  test('YM-004: p1 말이 p3 말 위 착지 시 capture 발생, p3 말 HOME으로 복귀', async () => {
    const clients = await setupNPlayerGame(port, 3);
    try {
      await injectAndDrainN(port, clients, {
        started: true,
        currentTurn: 'p1',
        pendingResults: ['gae'],
        capturedBonus: false,
        pendingThrows: 0,
        pieces: {
          p1: [{ cell: 7, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }],
          p2: [{ cell: 15, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }],
          p3: [{ cell: 9, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }],
        },
      });

      // p1 말 0을 gae(2칸)로 cell 7->9 (p3의 말 위)
      clients[0].send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'gae' });
      const state = await clients[0].next('STATE');

      const p1 = state.players.find(p => p.id === 'p1');
      expect(p1.pieces[0].cell).toBe(9);

      const p3 = state.players.find(p => p.id === 'p3');
      expect(p3.pieces[0].cell).toBe(-1); // HOME으로 복귀

      expect(state.capturedBonus).toBe(true);
      expect(state.currentTurn).toBe('p1');
    } finally {
      clients.forEach(c => c.close());
    }
  });

  test('YM-005: p1 말끼리 같은 칸 착지 시 stack 발생, 잡기 없음', async () => {
    const clients = await setupNPlayerGame(port, 3);
    try {
      await injectAndDrainN(port, clients, {
        started: true,
        currentTurn: 'p1',
        pendingResults: ['do'],
        capturedBonus: false,
        pendingThrows: 0,
        pieces: {
          p1: [{ cell: 2, stack: 1, done: false }, { cell: 3, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }],
          p2: [{ cell: 15, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }],
          p3: [{ cell: 11, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }],
        },
      });

      // p1 말 0을 do(1칸)로 cell 2->3, p1 말 1도 cell 3에 -> 업기
      clients[0].send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
      const state = await clients[0].next('STATE');

      const p1 = state.players.find(p => p.id === 'p1');
      // 둘 다 cell 3에 있어야 함
      expect(p1.pieces[0].cell).toBe(3);
      expect(p1.pieces[1].cell).toBe(3);

      // 잡기 보너스 없음
      expect(state.capturedBonus).toBe(false);
      // do는 보너스 없으므로 턴 넘어감
      expect(state.currentTurn).toBe('p2');
    } finally {
      clients.forEach(c => c.close());
    }
  });
});

// =====================================================================
// AC-Y4: 4인 게임에서 어느 플레이어든 4말 완주 시 GAME_OVER
// =====================================================================
test.describe('AC-Y4: N인 승리', () => {

  test('YM-004a: 4인 게임에서 p3가 4말 완주 시 GAME_OVER(winner=p3)', async () => {
    const clients = await setupNPlayerGame(port, 4);
    try {
      // p3의 말 3개 완주, 1개 cell 19에 위치 (do 1칸이면 0=시작점 통과 = 완주)
      await injectAndDrainN(port, clients, {
        started: true,
        currentTurn: 'p3',
        pendingResults: ['do'],
        capturedBonus: false,
        pendingThrows: 0,
        pieces: {
          p1: [{ cell: 5, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }],
          p2: [{ cell: 10, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }],
          p3: [
            { cell: 99, stack: 1, done: true },
            { cell: 99, stack: 1, done: true },
            { cell: 99, stack: 1, done: true },
            { cell: 19, stack: 1, done: false },
          ],
          p4: [{ cell: 15, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }],
        },
      });

      // p3가 마지막 말을 이동하여 완주
      clients[2].send({ type: 'MOVE_PIECE', pieceIndex: 3, useResult: 'do' });

      // GAME_OVER 수신
      const gameOver = await clients[2].next('GAME_OVER');
      expect(gameOver.winner).toBe('p3');

      // 모든 클라이언트가 GAME_OVER 수신
      const go1 = await clients[0].next('GAME_OVER');
      expect(go1.winner).toBe('p3');
      const go2 = await clients[1].next('GAME_OVER');
      expect(go2.winner).toBe('p3');
      const go3 = await clients[3].next('GAME_OVER');
      expect(go3.winner).toBe('p3');
    } finally {
      clients.forEach(c => c.close());
    }
  });

  test('YM-004b: 4인 게임에서 p1이 4말 완주 시 GAME_OVER(winner=p1)', async () => {
    const clients = await setupNPlayerGame(port, 4);
    try {
      await injectAndDrainN(port, clients, {
        started: true,
        currentTurn: 'p1',
        pendingResults: ['do'],
        capturedBonus: false,
        pendingThrows: 0,
        pieces: {
          p1: [
            { cell: 99, stack: 1, done: true },
            { cell: 99, stack: 1, done: true },
            { cell: 99, stack: 1, done: true },
            { cell: 19, stack: 1, done: false },
          ],
          p2: [{ cell: 10, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }],
          p3: [{ cell: 15, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }],
          p4: [{ cell: 1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }],
        },
      });

      clients[0].send({ type: 'MOVE_PIECE', pieceIndex: 3, useResult: 'do' });
      const gameOver = await clients[0].next('GAME_OVER');
      expect(gameOver.winner).toBe('p1');
    } finally {
      clients.forEach(c => c.close());
    }
  });

  test('YM-004c: 4인 게임에서 p4가 4말 완주 시 GAME_OVER(winner=p4)', async () => {
    const clients = await setupNPlayerGame(port, 4);
    try {
      await injectAndDrainN(port, clients, {
        started: true,
        currentTurn: 'p4',
        pendingResults: ['do'],
        capturedBonus: false,
        pendingThrows: 0,
        pieces: {
          p1: [{ cell: 1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }],
          p2: [{ cell: 6, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }],
          p3: [{ cell: 11, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }],
          p4: [
            { cell: 99, stack: 1, done: true },
            { cell: 99, stack: 1, done: true },
            { cell: 99, stack: 1, done: true },
            { cell: 19, stack: 1, done: false },
          ],
        },
      });

      clients[3].send({ type: 'MOVE_PIECE', pieceIndex: 3, useResult: 'do' });
      const gameOver = await clients[3].next('GAME_OVER');
      expect(gameOver.winner).toBe('p4');
    } finally {
      clients.forEach(c => c.close());
    }
  });
});

// =====================================================================
// QA 도출 추가 엣지케이스
// =====================================================================
test.describe('YM-EDGE: 추가 엣지케이스', () => {

  test('YM-006: 정원 초과 접속 거절 (3인 방에 4번째 접속)', async () => {
    // 3인 방 생성
    const c1 = await connectWs(port, '?players=3');
    const c2 = await connectWs(port);
    const c3 = await connectWs(port);
    // 4번째 접속 시도
    const c4ws = new WebSocket(`ws://localhost:${port}`);
    const errorReceived = await new Promise((resolve) => {
      c4ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'ERROR') resolve(msg);
      });
      c4ws.on('close', () => resolve({ type: 'CLOSE' }));
      setTimeout(() => resolve(null), 3000);
    });
    expect(errorReceived).not.toBeNull();
    expect(errorReceived.type === 'ERROR' || errorReceived.type === 'CLOSE').toBe(true);
    c1.close();
    c2.close();
    c3.close();
    try { c4ws.close(); } catch (_) {}
  });

  test('YM-007: 다른 플레이어 턴에 THROW_YUT 시도 시 ERROR', async () => {
    const clients = await setupNPlayerGame(port, 3);
    try {
      await injectAndDrainN(port, clients, {
        started: true,
        currentTurn: 'p1',
        pendingResults: [],
      });

      // p2가 p1 턴에 THROW_YUT 시도
      clients[1].send({ type: 'THROW_YUT' });
      const err = await clients[1].next('ERROR');
      expect(err.message).toContain('턴이 아닙니다');
    } finally {
      clients.forEach(c => c.close());
    }
  });

  test('YM-008: 다른 플레이어 턴에 MOVE_PIECE 시도 시 ERROR', async () => {
    const clients = await setupNPlayerGame(port, 3);
    try {
      await injectAndDrainN(port, clients, {
        started: true,
        currentTurn: 'p2',
        pendingResults: ['do'],
        pieces: {
          p1: [{ cell: 3, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }],
          p2: [{ cell: 8, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }],
          p3: [{ cell: 13, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }],
        },
      });

      // p3가 p2 턴에 MOVE_PIECE 시도
      clients[2].send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
      const err = await clients[2].next('ERROR');
      expect(err.message).toContain('턴이 아닙니다');
    } finally {
      clients.forEach(c => c.close());
    }
  });

  test('YM-009: 3인 게임에서 p2가 p3 말을 잡을 수 있다', async () => {
    const clients = await setupNPlayerGame(port, 3);
    try {
      await injectAndDrainN(port, clients, {
        started: true,
        currentTurn: 'p2',
        pendingResults: ['do'],
        capturedBonus: false,
        pendingThrows: 0,
        pieces: {
          p1: [{ cell: 15, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }],
          p2: [{ cell: 7, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }],
          p3: [{ cell: 8, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }],
        },
      });

      // p2 말 0을 do(1)로 cell 7->8 (p3 말 위)
      clients[1].send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
      const state = await clients[1].next('STATE');

      const p2 = state.players.find(p => p.id === 'p2');
      expect(p2.pieces[0].cell).toBe(8);

      const p3 = state.players.find(p => p.id === 'p3');
      expect(p3.pieces[0].cell).toBe(-1); // HOME

      expect(state.capturedBonus).toBe(true);
      expect(state.currentTurn).toBe('p2'); // 잡기 보너스로 턴 유지
    } finally {
      clients.forEach(c => c.close());
    }
  });

  test('YM-010: 3인 게임에서 한 칸에 p2, p3 말이 동시에 있을 때 p1이 착지하면 둘 다 잡기', async () => {
    const clients = await setupNPlayerGame(port, 3);
    try {
      // p2 말과 p3 말이 같은 칸(cell 4)에 있음
      await injectAndDrainN(port, clients, {
        started: true,
        currentTurn: 'p1',
        pendingResults: ['do'],
        capturedBonus: false,
        pendingThrows: 0,
        pieces: {
          p1: [{ cell: 3, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }],
          p2: [{ cell: 4, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }],
          p3: [{ cell: 4, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }],
        },
      });

      // p1이 do(1)로 cell 3->4, p2와 p3 말 동시 잡기
      clients[0].send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
      const state = await clients[0].next('STATE');

      const p1 = state.players.find(p => p.id === 'p1');
      expect(p1.pieces[0].cell).toBe(4);

      const p2 = state.players.find(p => p.id === 'p2');
      expect(p2.pieces[0].cell).toBe(-1); // HOME

      const p3 = state.players.find(p => p.id === 'p3');
      expect(p3.pieces[0].cell).toBe(-1); // HOME

      expect(state.capturedBonus).toBe(true);
    } finally {
      clients.forEach(c => c.close());
    }
  });

  test('YM-011: 전원 퇴장 후 roomMaxPlayers=2 리셋 확인', async () => {
    // 3인 방 생성 및 전원 퇴장
    const c1 = await connectWs(port, '?players=3');
    const c2 = await connectWs(port);
    const c3 = await connectWs(port);
    c1.close();
    c2.close();
    c3.close();
    await new Promise(r => setTimeout(r, 500));

    // 새로 접속 (기본 2인)
    const c4 = await connectWs(port);
    c4.send({ type: 'JOIN', playerName: 'Reset1' });
    const joined = await c4.next('JOINED');
    expect(joined.playerId).toBe('p1');
    // 5번째 접속(3번째가 아닌 2번째)에서 정원 초과가 발생해야 함
    const c5 = await connectWs(port);
    c5.send({ type: 'JOIN', playerName: 'Reset2' });
    const joined2 = await c5.next('JOINED');
    expect(joined2.playerId).toBe('p2');
    expect(joined2.waiting).toBe(false); // 2인 충족

    c4.close();
    c5.close();
  });

  test('YM-012: N>2 방에서 AI 봇 spawn 차단', async () => {
    // 3인 방에서 mode=ai 접속 시 봇이 spawn되지 않아야 함
    const c1 = await connectWs(port, '?players=3&mode=ai');
    c1.send({ type: 'JOIN', playerName: 'AIHost' });
    const joined = await c1.next('JOINED');
    expect(joined.playerId).toBe('p1');
    expect(joined.waiting).toBe(true); // 3인 방이므로 대기

    // 봇이 자동 접속하지 않는지 확인 (2초 대기)
    await new Promise(r => setTimeout(r, 2000));

    // 2번째 접속 시도 (수동) — 가능해야 함
    const c2 = await connectWs(port);
    c2.send({ type: 'JOIN', playerName: 'Manual2' });
    const joined2 = await c2.next('JOINED');
    expect(joined2.playerId).toBe('p2');
    expect(joined2.waiting).toBe(true); // 아직 3명 미달

    c1.close();
    c2.close();
  });

  test('YM-013: REMATCH 시 N인 전원 동의 필요', async () => {
    const clients = await setupNPlayerGame(port, 3);
    try {
      // 게임 종료 상태 주입
      await injectAndDrainN(port, clients, {
        started: false,
        winner: 'p1',
        pieces: {
          p1: [
            { cell: 99, stack: 1, done: true },
            { cell: 99, stack: 1, done: true },
            { cell: 99, stack: 1, done: true },
            { cell: 99, stack: 1, done: true },
          ],
          p2: [{ cell: 6, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }],
          p3: [{ cell: 11, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }, { cell: -1, stack: 1, done: false }],
        },
      });

      // p1만 REMATCH
      clients[0].send({ type: 'REMATCH' });
      // REMATCH_STATUS는 broadcast (3개 클라이언트 모두에 전달)
      const rs1 = await clients[0].next('REMATCH_STATUS');
      expect(rs1.playersReady).toBeDefined();
      const p1Ready1 = rs1.playersReady.find(p => p.id === 'p1');
      expect(p1Ready1.ready).toBe(true);
      // p2, p3는 아직 미동의
      const p2Ready1 = rs1.playersReady.find(p => p.id === 'p2');
      expect(p2Ready1.ready).toBe(false);
      // 다른 클라이언트의 REMATCH_STATUS도 드레인
      for (const c of clients) { c.drain('REMATCH_STATUS'); }
      await new Promise(r => setTimeout(r, 100));
      for (const c of clients) { c.drain('REMATCH_STATUS'); }

      // p2도 REMATCH -> 아직 START 안 옴 (3인 필요)
      clients[1].send({ type: 'REMATCH' });
      const rs2 = await clients[0].next('REMATCH_STATUS');
      // 이 시점 p1, p2 ready, p3 not ready
      const p1r2 = rs2.playersReady.find(p => p.id === 'p1');
      const p2r2 = rs2.playersReady.find(p => p.id === 'p2');
      const p3r2 = rs2.playersReady.find(p => p.id === 'p3');
      expect(p1r2.ready).toBe(true);
      expect(p2r2.ready).toBe(true);
      expect(p3r2.ready).toBe(false);
      // 드레인
      for (const c of clients) { c.drain('REMATCH_STATUS'); }
      await new Promise(r => setTimeout(r, 100));
      for (const c of clients) { c.drain('REMATCH_STATUS'); }

      // p3 REMATCH -> 이제 전원 동의 -> START 와야 함
      clients[2].send({ type: 'REMATCH' });
      // REMATCH_STATUS가 먼저 올 수 있고, 그 뒤에 START+STATE
      // 또는 전원 동의 시 REMATCH_STATUS + START + STATE 순서
      const start = await clients[0].next('START');
      expect(start.type).toBe('START');

      // 새 STATE (started=true)
      const state = await clients[0].next('STATE');
      expect(state.started).toBe(true);
      expect(state.currentTurn).toBe('p1');
      expect(state.players.length).toBe(3);
    } finally {
      clients.forEach(c => c.close());
    }
  });

  test('YM-014: 3인 게임 중 disconnect 시 GAME_OVER 발생', async () => {
    const clients = await setupNPlayerGame(port, 3);
    try {
      await injectAndDrainN(port, clients, {
        started: true,
        currentTurn: 'p1',
        pendingResults: [],
      });

      // p2 disconnect
      clients[1].close();

      // 나머지에게 GAME_OVER 전달
      const go1 = await clients[0].next('GAME_OVER', 5000);
      expect(go1.reason).toBe('disconnect');
      // winner는 남은 첫 번째 플레이어
      expect(go1.winner).toBeDefined();

      const go3 = await clients[2].next('GAME_OVER', 5000);
      expect(go3.reason).toBe('disconnect');
    } finally {
      clients[0].close();
      clients[2].close();
    }
  });

  test('YM-015: ?players 쿼리 없이 접속 시 기본 2인 방 생성', async () => {
    const c1 = await connectWs(port); // 쿼리 없음
    c1.send({ type: 'JOIN', playerName: 'Default1' });
    const j1 = await c1.next('JOINED');
    expect(j1.waiting).toBe(true); // 1/2

    const c2 = await connectWs(port);
    c2.send({ type: 'JOIN', playerName: 'Default2' });
    const j2 = await c2.next('JOINED');
    expect(j2.waiting).toBe(false); // 2/2

    c1.close();
    c2.close();
  });

  test('YM-016: ?players=5 (범위 외) 접속 시 기본 2인으로 폴백', async () => {
    const c1 = await connectWs(port, '?players=5');
    c1.send({ type: 'JOIN', playerName: 'Over1' });
    const j1 = await c1.next('JOINED');
    expect(j1.waiting).toBe(true); // 1/2 (5는 범위 외 -> 기본 2)

    const c2 = await connectWs(port);
    c2.send({ type: 'JOIN', playerName: 'Over2' });
    const j2 = await c2.next('JOINED');
    expect(j2.waiting).toBe(false); // 2/2

    // 3번째 접속 시 거절
    const c3ws = new WebSocket(`ws://localhost:${port}`);
    const result = await new Promise((resolve) => {
      c3ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'ERROR') resolve('rejected');
      });
      c3ws.on('close', () => resolve('closed'));
      setTimeout(() => resolve('timeout'), 3000);
    });
    expect(result === 'rejected' || result === 'closed').toBe(true);

    c1.close();
    c2.close();
    try { c3ws.close(); } catch (_) {}
  });

  test('YM-017: ?players=1 (범위 외) 접속 시 기본 2인으로 폴백', async () => {
    const c1 = await connectWs(port, '?players=1');
    c1.send({ type: 'JOIN', playerName: 'Under1' });
    const j1 = await c1.next('JOINED');
    expect(j1.waiting).toBe(true); // 1/2 (1은 범위 외 -> 기본 2)

    const c2 = await connectWs(port);
    c2.send({ type: 'JOIN', playerName: 'Under2' });
    const j2 = await c2.next('JOINED');
    expect(j2.waiting).toBe(false); // 2/2

    c1.close();
    c2.close();
  });
});
