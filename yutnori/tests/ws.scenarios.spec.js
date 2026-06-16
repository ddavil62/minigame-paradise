/**
 * @fileoverview 윷놀이 WebSocket 프로토콜 시나리오 테스트.
 *
 * 각 테스트는 독립적인 서버 인스턴스(포트 0 → OS 자동 할당)를 사용한다.
 * 브라우저 불필요. createApp()를 직접 임포트하여 http.createServer로 서빙.
 *
 * 실행:
 *   npx playwright test tests/ws.scenarios.spec.js --reporter=list
 *
 * §1 기본 연결  (W-01~W-06)
 * §2 게임 흐름  (W-07~W-14)
 * §3 특수 케이스 (W-15~W-20)
 */

import { test, expect } from 'playwright/test';
import http from 'http';
import { WebSocket } from 'ws';
import { createApp } from '../server.js';

// ── WsClient — 메시지 버퍼링 클라이언트 ──────────────────────────
/**
 * 메시지를 큐에 버퍼링하여 race condition 없이 순차 소비를 지원하는 WS 래퍼.
 * - 도착한 메시지를 즉시 큐에 쌓는다.
 * - next(type?) 호출 시: 큐에 해당 타입이 있으면 즉시 반환, 없으면 도착 대기.
 */
class WsClient {
  constructor(ws) {
    this.ws = ws;
    /** @type {object[]} */
    this._queue = [];
    /** @type {Array<{type: string|null, resolve: Function, timer: any}>} */
    this._waiters = [];

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      // 대기 중인 waiter 중 매칭되는 것에 전달
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

  /**
   * 다음 메시지 (또는 특정 type) 를 반환한다.
   * @param {string|null} type 원하는 메시지 타입. null이면 무관.
   * @param {number} timeoutMs 대기 최대 시간
   * @returns {Promise<object>}
   */
  next(type = null, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      // 큐에서 타입 검색
      if (type) {
        const qIdx = this._queue.findIndex((m) => m.type === type);
        if (qIdx >= 0) {
          resolve(this._queue.splice(qIdx, 1)[0]);
          return;
        }
      } else if (this._queue.length > 0) {
        resolve(this._queue.shift());
        return;
      }
      // 큐에 없으면 대기 등록
      const timer = setTimeout(() => {
        const wIdx = this._waiters.findIndex((w) => w.resolve === resolve);
        if (wIdx >= 0) this._waiters.splice(wIdx, 1);
        reject(new Error(`WsClient.next('${type}') timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this._waiters.push({ type, resolve, timer });
    });
  }

  /** JSON 메시지 전송. */
  send(obj) {
    this.ws.send(JSON.stringify(obj));
  }

  /** 연결 종료. */
  close() {
    try { this.ws.close(); } catch (_) {}
  }

  /** close 이벤트 대기. */
  waitClose() {
    return new Promise((resolve) => this.ws.once('close', resolve));
  }
}

// ── 헬퍼 ─────────────────────────────────────────────────────────

/** 포트 0으로 서버 시작 → 실제 포트 반환. */
function startServer(app) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app.handleHttp);
    server.on('upgrade', app.handleUpgrade);
    server.listen(0, () => resolve({ server, port: server.address().port }));
    server.once('error', reject);
  });
}

/** 서버 종료. */
function stopServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

/** WsClient 연결. */
function connect(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    ws.once('open', () => resolve(new WsClient(ws)));
    ws.once('error', reject);
  });
}

/**
 * 두 플레이어가 JOIN + READY 완료(START + STATE 수신)까지 세팅한다.
 *
 * 주의: connect()가 먼저 두 플레이어를 WS 연결한 뒤 JOIN을 보내므로,
 * 각 JOIN 수신 시점에 players.length === 2 이미 성립 → 각 JOIN마다 broadcastState 1회 = 총 2회.
 * → 각 플레이어가 JOIN 페이즈에서 STATE 2개씩 받는다.
 *
 * @returns {Promise<{ p1: WsClient, p2: WsClient }>}
 */
async function setupGame(port) {
  const p1 = await connect(port);
  const p2 = await connect(port);

  p1.send({ type: 'JOIN', playerName: 'TestP1' });
  p2.send({ type: 'JOIN', playerName: 'TestP2' });

  // P1 JOIN → broadcastState (players=2) → P1·P2 각 STATE 1개
  // P2 JOIN → broadcastState (players=2) → P1·P2 각 STATE 1개
  // 합계: 각 플레이어 STATE 2개
  await p1.next('JOINED');
  await p2.next('JOINED');
  await p1.next('STATE');  // P1 JOIN 유발 broadcast
  await p2.next('STATE');
  await p1.next('STATE');  // P2 JOIN 유발 broadcast
  await p2.next('STATE');

  // 양쪽 READY
  p1.send({ type: 'READY' });
  p2.send({ type: 'READY' });

  // START + STATE broadcast
  await p1.next('START');
  await p2.next('START');
  await p1.next('STATE');
  await p2.next('STATE');

  return { p1, p2 };
}

/** inject HTTP 요청. */
async function inject(port, cfg) {
  const res = await fetch(`http://localhost:${port}/test/inject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cfg),
  });
  return res.json();
}

// ── §1 기본 연결 ─────────────────────────────────────────────────

test('W-01: P1 JOIN → JOINED(waiting:true, playerId:p1)', async () => {
  const app = createApp({});
  const { server, port } = await startServer(app);
  const p1 = await connect(port);
  try {
    p1.send({ type: 'JOIN', playerName: 'Alice' });
    const msg = await p1.next('JOINED');
    expect(msg.type).toBe('JOINED');
    expect(msg.playerId).toBe('p1');
    expect(msg.waiting).toBe(true);
  } finally {
    p1.close();
    await stopServer(server);
  }
});

test('W-02: P2 JOIN → P2 JOINED(waiting:false), P1이 STATE 받음', async () => {
  const app = createApp({});
  const { server, port } = await startServer(app);
  const p1 = await connect(port);
  p1.send({ type: 'JOIN', playerName: 'Alice' });
  await p1.next('JOINED');

  const p2 = await connect(port);
  p2.send({ type: 'JOIN', playerName: 'Bob' });
  try {
    const joinedP2 = await p2.next('JOINED');
    expect(joinedP2.type).toBe('JOINED');
    expect(joinedP2.playerId).toBe('p2');
    expect(joinedP2.waiting).toBe(false);

    // P1이 STATE를 받아야 함
    const stateForP1 = await p1.next('STATE');
    expect(stateForP1.type).toBe('STATE');
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('W-03: 양쪽 READY → START + STATE broadcast', async () => {
  const app = createApp({});
  const { server, port } = await startServer(app);
  const p1 = await connect(port);
  const p2 = await connect(port);

  p1.send({ type: 'JOIN', playerName: 'Alice' });
  p2.send({ type: 'JOIN', playerName: 'Bob' });
  // 두 플레이어가 이미 WS 연결된 상태에서 JOIN → 각 JOIN마다 broadcastState → STATE 2개씩
  await p1.next('JOINED');
  await p2.next('JOINED');
  await p1.next('STATE');  // P1 JOIN broadcast
  await p2.next('STATE');
  await p1.next('STATE');  // P2 JOIN broadcast
  await p2.next('STATE');

  try {
    p1.send({ type: 'READY' });
    p2.send({ type: 'READY' });

    const start1 = await p1.next('START');
    expect(start1.type).toBe('START');
    expect(typeof start1.countdown).toBe('number');

    const state1 = await p1.next('STATE');
    expect(state1.type).toBe('STATE');
    expect(state1.started).toBe(true);
    expect(state1.currentTurn).toBe('p1');
    // 양쪽 말 4개씩 HOME(-1) 확인
    const p1Data = state1.players.find((p) => p.id === 'p1');
    expect(p1Data.pieces.every((pc) => pc.cell === -1)).toBe(true);
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('W-04: THROW_YUT → YUT_RESULT broadcast + STATE', async () => {
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    p1.send({ type: 'THROW_YUT' });

    const yutResult = await p1.next('YUT_RESULT');
    expect(yutResult.type).toBe('YUT_RESULT');
    expect(yutResult.by).toBe('p1');
    expect(typeof yutResult.result).toBe('string');
    expect(Array.isArray(yutResult.sticks)).toBe(true);

    const state = await p1.next('STATE');
    expect(state.type).toBe('STATE');
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('W-05: 상대 턴에 THROW_YUT → ERROR', async () => {
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    // 현재 P1 턴 → P2가 던지려 하면 에러
    p2.send({ type: 'THROW_YUT' });
    const err = await p2.next('ERROR');
    expect(err.type).toBe('ERROR');
    expect(typeof err.message).toBe('string');
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('W-06: 3번째 연결 시도 → ERROR + 자동 닫힘', async () => {
  const app = createApp({});
  const { server, port } = await startServer(app);
  const p1 = await connect(port);
  const p2 = await connect(port);
  p1.send({ type: 'JOIN', playerName: 'A' });
  p2.send({ type: 'JOIN', playerName: 'B' });
  await p1.next('JOINED');
  await p2.next('JOINED');
  await p1.next('STATE');

  const p3 = await connect(port);
  try {
    const err = await p3.next('ERROR');
    expect(err.type).toBe('ERROR');
    await p3.waitClose();
  } finally {
    p1.close(); p2.close(); p3.close();
    await stopServer(server);
  }
});

// ── §2 게임 흐름 ─────────────────────────────────────────────────

test('W-07: MOVE_PIECE 유효 → STATE에 말 위치 갱신', async () => {
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    // inject로 pendingResults에 'do' 주입
    const body = await inject(port, {
      started: true, currentTurn: 'p1', pendingResults: ['do'],
    });
    expect(body.ok).toBe(true);
    // STATE broadcast 소화
    await p1.next('STATE');
    await p2.next('STATE');

    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
    const state = await p1.next('STATE');
    const myPieces = state.players.find((p) => p.id === 'p1').pieces;
    // piece[0]이 HOME(-1)에서 이동 → 0 이상
    expect(myPieces[0].cell).not.toBe(-1);
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('W-08: 빈 pendingResults에 MOVE_PIECE → ERROR', async () => {
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
    const err = await p1.next('ERROR');
    expect(err.type).toBe('ERROR');
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('W-09: P1 연결 해제 → P2 GAME_OVER (reason:disconnect)', async () => {
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    p1.close();
    const gameOver = await p2.next('GAME_OVER');
    expect(gameOver.type).toBe('GAME_OVER');
    expect(gameOver.reason).toBe('disconnect');
    expect(gameOver.winner).toBe('p2');
  } finally {
    p2.close();
    await stopServer(server);
  }
});

test('W-10: 백도 폐기 — 출발한 말 없을 때 discarded:true', async () => {
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    // 반복 던지기로 backdo + 모든 말이 HOME인 케이스 → discarded:true 확인
    let found = false;
    for (let attempt = 0; attempt < 50 && !found; attempt++) {
      p1.send({ type: 'THROW_YUT' });
      const result = await p1.next('YUT_RESULT');
      await p1.next('STATE');
      await p2.next('YUT_RESULT');
      await p2.next('STATE');

      if (result.result === 'backdo' && result.discarded === true) {
        found = true;
        break;
      }
      if (result.result === 'backdo') {
        // 백도인데 discarded=false라면 말이 이미 나간 것 → 리셋
        break;
      }
      // backdo가 아닌 결과 → inject로 상태 초기화 후 재시도
      await inject(port, {
        started: true, currentTurn: 'p1', pendingResults: [],
      });
      await p1.next('STATE');
      await p2.next('STATE');
    }
    expect(found).toBe(true);
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('W-11: pendingResults 마지막이 yut이면 보너스 던지기 허용', async () => {
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    // pendingResults=['do','yut'] 주입: 'do'를 MOVE로 소진하면 ['yut']이 남아 보너스 가능
    await inject(port, { started: true, currentTurn: 'p1', pendingResults: ['do', 'yut'] });
    await p1.next('STATE');
    await p2.next('STATE');

    // MOVE_PIECE(useResult='do') → pendingResults=['yut'] 잔여 → 턴 유지 + 보너스 던지기 허용
    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
    await p1.next('STATE');
    await p2.next('STATE');

    // 보너스 던지기: pendingResults 마지막이 'yut' → THROW_YUT 허용
    p1.send({ type: 'THROW_YUT' });
    const throwResult = await p1.next('YUT_RESULT');
    expect(throwResult.by).toBe('p1');
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('W-12: inject로 말 위치 설정 — STATE에 반영', async () => {
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    const body = await inject(port, {
      started: true, currentTurn: 'p1',
      pieces: {
        p1: [
          { cell: 3, stack: 1, done: false },
          { cell: -1, stack: 1, done: false },
          { cell: -1, stack: 1, done: false },
          { cell: -1, stack: 1, done: false },
        ],
      },
    });
    expect(body.ok).toBe(true);

    const state = await p1.next('STATE');
    const p1Data = state.players.find((p) => p.id === 'p1');
    expect(p1Data.pieces[0].cell).toBe(3);
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('W-13: CHOOSE_PATH 후 분기 이동 완료', async () => {
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    // 갱신 사유: 버그A 수정(2026-06-16) — 지름길 경유 중앙 "통과"는 자동 라우팅이라
    //   BRANCH_REQUEST가 발생하지 않는다. 중앙 분기 모달은 말이 중앙(23)에 **정확 정착**한
    //   상태에서 다음 이동 시 발생하므로 setup을 cell 23으로 변경.
    //   버그B 수정 — top(centerExitA)이 23→28→29→15 경로화. gae(2) → cell 29.
    await inject(port, {
      started: true, currentTurn: 'p1', pendingResults: ['gae'],
      pieces: {
        p1: [
          { cell: 23, stack: 1, done: false },
          { cell: -1, stack: 1, done: false },
          { cell: -1, stack: 1, done: false },
          { cell: -1, stack: 1, done: false },
        ],
      },
    });
    await p1.next('STATE');
    await p2.next('STATE');

    // MOVE_PIECE: 중앙(23)에서 gae(2) 이동 시도 → branchChoice 필요 → BRANCH_REQUEST(center)
    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'gae' });
    const branchReq = await p1.next('BRANCH_REQUEST');
    expect(branchReq.type).toBe('BRANCH_REQUEST');
    expect(branchReq.playerId).toBe('p1');
    expect(branchReq.branchType).toBe('center');
    // MOVE_PIECE → broadcastState(awaitingBranch, 말 아직 이동 전) 소화
    await p1.next('STATE');

    // CHOOSE_PATH: 위쪽 출구(top) 선택
    p1.send({ type: 'CHOOSE_PATH', pathChoice: 'top' });
    const state = await p1.next('STATE');
    const p1Data = state.players.find((p) => p.id === 'p1');
    // 23→top → 28→29 (centerExitA: 23→28→29). gae(2) → cell 29.
    expect(p1Data.pieces[0].cell).toBe(29);
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('W-14: 모든 말 완주 → GAME_OVER', async () => {
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    // P1 말 3개 done + 1개를 cell 19에 배치 + pendingResults=['do']
    await inject(port, {
      started: true, currentTurn: 'p1', pendingResults: ['do'],
      pieces: {
        p1: [
          { cell: 19, stack: 1, done: false },
          { cell: 99, stack: 1, done: true },
          { cell: 99, stack: 1, done: true },
          { cell: 99, stack: 1, done: true },
        ],
      },
    });
    await p1.next('STATE');
    await p2.next('STATE');

    // do(1): 19→GOAL → 4개 완주 → P1 승리
    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
    const gameOver = await p1.next('GAME_OVER');
    expect(gameOver.winner).toBe('p1');
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

// ── §3 특수 케이스 ────────────────────────────────────────────────

test('W-15: REMATCH 양쪽 클릭 → 새 게임 START', async () => {
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    // inject로 winner 설정
    await inject(port, { winner: 'p1' });
    await p1.next('STATE');
    await p1.next('GAME_OVER');
    await p2.next('STATE');
    await p2.next('GAME_OVER');

    p1.send({ type: 'REMATCH' });
    const status1 = await p1.next('REMATCH_STATUS');
    expect(status1.type).toBe('REMATCH_STATUS');

    p2.send({ type: 'REMATCH' });
    // 양쪽 REMATCH → START
    const start = await p1.next('START');
    expect(start.type).toBe('START');
    const newState = await p1.next('STATE');
    expect(newState.started).toBe(true);
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('W-16: inject 엔드포인트 — currentTurn 변경 후 반영', async () => {
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    // 기본 p1 턴 → inject로 p2 턴으로 변경
    const body = await inject(port, { started: true, currentTurn: 'p2' });
    expect(body.ok).toBe(true);

    const state = await p1.next('STATE');
    expect(state.currentTurn).toBe('p2');

    // P1이 던지기 시도 → 에러
    p1.send({ type: 'THROW_YUT' });
    const err = await p1.next('ERROR');
    expect(err.type).toBe('ERROR');
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('W-17: 미사용 결과 있을 때 THROW_YUT (마지막 do) → ERROR', async () => {
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    // pendingResults=['do'] → MOVE_PIECE 전에 THROW_YUT 시도 → ERROR
    await inject(port, { started: true, currentTurn: 'p1', pendingResults: ['do'] });
    await p1.next('STATE');
    await p2.next('STATE');

    p1.send({ type: 'THROW_YUT' });
    const err = await p1.next('ERROR');
    expect(err.type).toBe('ERROR');
    expect(err.message).toMatch(/먼저|결과/);
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('W-18: 분기 대기 중 THROW_YUT → ERROR', async () => {
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    // 갱신 사유: 버그A 수정(2026-06-16) — cell 22 통과는 자동 라우팅. 중앙 정착(cell 23)으로 변경.
    await inject(port, {
      started: true, currentTurn: 'p1', pendingResults: ['gae'],
      pieces: {
        p1: [
          { cell: 23, stack: 1, done: false },
          { cell: -1, stack: 1, done: false },
          { cell: -1, stack: 1, done: false },
          { cell: -1, stack: 1, done: false },
        ],
      },
    });
    await p1.next('STATE');
    await p2.next('STATE');

    // MOVE_PIECE → BRANCH_REQUEST(center)
    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'gae' });
    await p1.next('BRANCH_REQUEST');

    // 분기 대기 중 THROW_YUT → ERROR
    p1.send({ type: 'THROW_YUT' });
    const err = await p1.next('ERROR');
    expect(err.type).toBe('ERROR');
    expect(err.message).toMatch(/분기/);
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('W-19: 상대 턴에 MOVE_PIECE → ERROR', async () => {
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, { started: true, currentTurn: 'p1', pendingResults: ['do'] });
    await p1.next('STATE');
    await p2.next('STATE');

    // P2가 P1 턴에 MOVE_PIECE → ERROR
    p2.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
    const err = await p2.next('ERROR');
    expect(err.type).toBe('ERROR');
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('W-20: inject winner → GAME_OVER broadcast + STATE(started=false)', async () => {
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    const body = await inject(port, { winner: 'p2' });
    expect(body.ok).toBe(true);

    // P1도 GAME_OVER 받음
    const gameOver = await p1.next('GAME_OVER');
    expect(gameOver.winner).toBe('p2');

    const state = await p1.next('STATE');
    expect(state.winner).toBe('p2');
    expect(state.started).toBe(false);
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});
