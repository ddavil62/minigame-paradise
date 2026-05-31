/**
 * @fileoverview 룰북 기반 Playwright 시나리오 공용 헬퍼.
 * - withRandom: Math.random 결정론 주입 (기존 yut.unit 패턴 공용화)
 * - startServer / stopServer / connectWs: createApp + http + WS 부트스트랩
 * - setupGame: JOIN + READY 완료까지 양 플레이어 세팅
 * - inject / injectAndDrain / placePieces / forceResults: 상태 주입 헬퍼
 *
 * 본 파일은 신규 생성이며 기존 ws.scenarios.spec.js의 WsClient와 별도 독립 구현이다.
 * 기존 110개 spec(yut.unit / ws.scenarios / e2e-scenarios)은 본 모듈을 사용하지 않는다.
 *
 * 룰북 참조: minigames/yutnori/docs/RULEBOOK.md
 */

import http from 'http';
import { WebSocket } from 'ws';

/**
 * Math.random을 순서대로 주어진 값으로 대체한 후 fn을 실행한다.
 * 값 배열은 순환하며 사용된다. fn 종료 후 원래 Math.random으로 복원한다.
 *
 * 사용 예:
 *   withRandom([0.1, 0.1, 0.1, 0.1], () => throwYutSticks());  // 윷 강제
 *
 * @param {number[]} values 순서대로 반환될 값들
 * @param {Function} fn     실행할 함수
 * @returns {*} fn의 반환값
 */
export function withRandom(values, fn) {
  let idx = 0;
  const saved = Math.random;
  Math.random = () => {
    const v = values[idx % values.length];
    idx++;
    return v;
  };
  try {
    return fn();
  } finally {
    Math.random = saved;
  }
}

/**
 * WS 메시지를 버퍼링하여 race-condition 없이 순차 소비를 지원하는 클라이언트 래퍼.
 * 도착한 메시지를 즉시 큐에 쌓고, next(type)에서 매칭되는 항목을 꺼낸다.
 * 본 클래스는 ws.scenarios.spec.js의 WsClient와 동작이 동일하지만 독립 구현이다.
 */
export class WsClient {
  constructor(ws) {
    this.ws = ws;
    /** @type {object[]} */
    this._queue = [];
    /** @type {Array<{type: string|null, resolve: Function, timer: any}>} */
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

  /**
   * 다음 메시지 (또는 특정 type) 를 반환한다.
   * @param {string|null} type 원하는 메시지 타입. null이면 무관.
   * @param {number} timeoutMs 대기 최대 시간
   * @returns {Promise<object>}
   */
  next(type = null, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
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
      const timer = setTimeout(() => {
        const wIdx = this._waiters.findIndex((w) => w.resolve === resolve);
        if (wIdx >= 0) this._waiters.splice(wIdx, 1);
        reject(new Error(`WsClient.next('${type}') timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this._waiters.push({ type, resolve, timer });
    });
  }

  /**
   * 큐에서 즉시 매칭되는 타입의 메시지를 모두 비운다 (도착하지 않은 건 기다리지 않음).
   * STATE drain 패턴에서 부수 메시지가 쌓이는 것을 정리할 때 사용.
   * @param {string} type
   * @returns {number} 비운 개수
   */
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

  /** JSON 메시지 전송. */
  send(obj) {
    this.ws.send(JSON.stringify(obj));
  }

  /** 연결 종료 (소켓 close 호출). */
  close() {
    try { this.ws.close(); } catch (_) { /* noop */ }
  }

  /** close 이벤트 대기. */
  waitClose() {
    return new Promise((resolve) => this.ws.once('close', resolve));
  }
}

/**
 * createApp 인스턴스를 받아 포트 0으로 HTTP 서버를 시작한다.
 *
 * @param {{ handleHttp: Function, handleUpgrade: Function }} app
 * @returns {Promise<{ server: http.Server, port: number }>}
 */
export function startServer(app) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app.handleHttp);
    server.on('upgrade', app.handleUpgrade);
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      // server.address()가 가끔 string(unix socket)이나 null을 반환하는 race가 있어 검증.
      const addr = server.address();
      if (!addr || typeof addr === 'string' || typeof addr.port !== 'number' || addr.port <= 0) {
        reject(new Error(`startServer: invalid address ${JSON.stringify(addr)}`));
        return;
      }
      resolve({ server, port: addr.port });
    });
  });
}

/**
 * HTTP 서버를 종료한다 (close 콜백 완료까지 대기).
 *
 * @param {http.Server} server
 * @returns {Promise<void>}
 */
export function stopServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

/**
 * 지정 포트로 WsClient 1개 연결한다.
 *
 * @param {number} port
 * @returns {Promise<WsClient>}
 */
export function connectWs(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    ws.once('open', () => resolve(new WsClient(ws)));
    ws.once('error', reject);
  });
}

/**
 * 두 플레이어가 JOIN + READY → START + STATE 소화 완료까지 세팅한다.
 *
 * 메시지 시퀀스 (기존 ws.scenarios.setupGame 동일):
 *   1) p1, p2 각각 WS 연결
 *   2) 각자 JOIN 전송
 *   3) JOIN 두 번 처리되며 broadcastState가 두 번 일어남 → 양쪽 STATE 2개씩
 *   4) 양쪽 READY → START + STATE broadcast → 양쪽 START 1, STATE 1
 *
 * @param {number} port
 * @returns {Promise<{ p1: WsClient, p2: WsClient }>}
 */
export async function setupGame(port) {
  const p1 = await connectWs(port);
  const p2 = await connectWs(port);

  p1.send({ type: 'JOIN', playerName: 'TestP1' });
  p2.send({ type: 'JOIN', playerName: 'TestP2' });

  await p1.next('JOINED');
  await p2.next('JOINED');
  await p1.next('STATE');
  await p2.next('STATE');
  await p1.next('STATE');
  await p2.next('STATE');

  p1.send({ type: 'READY' });
  p2.send({ type: 'READY' });

  await p1.next('START');
  await p2.next('START');
  await p1.next('STATE');
  await p2.next('STATE');

  return { p1, p2 };
}

/**
 * /test/inject 엔드포인트로 게임 상태를 주입한다.
 *
 * 지원 필드 (server.js POST /test/inject 참조):
 *   started, currentTurn, pendingResults, awaitingBranchAt,
 *   awaitingBranchResult, capturedBonus, winner,
 *   pieces: { p1: [{cell,stack,done},...], p2: [...] }
 *
 * @param {number} port
 * @param {object} cfg inject 페이로드
 * @returns {Promise<{ ok: boolean }>}
 */
export async function inject(port, cfg) {
  // Windows에서 batch 실행 시 가끔 fetch가 "bad port" 또는 ECONNREFUSED로 실패하는
  // race가 관측됨. Node fetch가 undici를 통해 keep-alive 연결을 재사용할 때,
  // 이전 테스트의 closed connection이 재사용되어 "bad port" 에러로 surface된다.
  // 5회까지 점증 delay 재시도 + connection: close 헤더로 재현 방지.
  let lastErr = null;
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
      // 다음 시도 전 점증 대기 (20ms, 50ms, 100ms, 200ms, 400ms)
      await new Promise((resolve) => setTimeout(resolve, 20 * Math.pow(2, i)));
    }
  }
  throw lastErr;
}

/**
 * inject 후 양쪽 클라이언트의 STATE 1개씩(broadcastState 결과)을 소화한다.
 * winner가 함께 주입된 경우 GAME_OVER도 소화한다.
 *
 * @param {number} port
 * @param {WsClient} p1
 * @param {WsClient} p2
 * @param {object} cfg
 */
export async function injectAndDrain(port, p1, p2, cfg) {
  await inject(port, cfg);
  await p1.next('STATE');
  await p2.next('STATE');
  if (cfg.winner) {
    await p1.next('GAME_OVER');
    await p2.next('GAME_OVER');
  }
}

/**
 * 말 위치 강제 배치용 inject 헬퍼.
 *
 * @param {number} port
 * @param {'p1'|'p2'} playerId
 * @param {Array<{cell:number, stack?:number, done?:boolean}>} pieceArr 길이 4 배열
 * @param {object} [extra] 추가로 inject할 게임 상태 (예: { currentTurn:'p1', pendingResults:['do'] })
 * @returns {Promise<{ ok: boolean }>}
 */
export async function placePieces(port, playerId, pieceArr, extra = {}) {
  const cfg = { ...extra, pieces: { ...(extra.pieces || {}), [playerId]: pieceArr } };
  return inject(port, cfg);
}

/**
 * 윷 결과 큐에 직접 결과명을 주입한다 (THROW_YUT를 거치지 않고).
 * 룰북 §3 매핑을 우회하므로 백도 자동 폐기는 발생하지 않는다.
 *
 * @param {number} port
 * @param {string[]} results 큐 값 (예: ['do'], ['yut','mo'])
 * @returns {Promise<{ ok: boolean }>}
 */
export async function forceResults(port, results) {
  return inject(port, { pendingResults: results });
}
