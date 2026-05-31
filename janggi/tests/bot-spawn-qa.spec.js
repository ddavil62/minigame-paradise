/**
 * @fileoverview QA: janggi 단독 서버에 mode=ai로 접속 → 봇 자동 spawn → 게임 진행 확인.
 *
 * 검증 시나리오:
 *   - 사람 WS가 mode=ai로 접속 → JOINED 수신
 *   - 200ms 후 봇이 mode=bot으로 접속 → 게임 상태 setup_cho 진입
 *   - 봇이 자동으로 SELECT_SETUP 송신 → setup_han 진입
 *   - 사람이 SELECT_SETUP 송신 → playing 진입
 *   - 사람 WS close → 봇도 종료되는지 (서버 로그로 간접 확인)
 *
 * 외부 서버 의존: localhost:3099 — janggi 단독 서버가 미리 기동되어 있어야 한다.
 */

import { test, expect } from '@playwright/test';
import { WebSocket } from 'ws';

const SERVER_URL = 'ws://localhost:3099/ws';

/**
 * 단순 WS 클라이언트 헬퍼. 메시지 큐 + cursor 기반 소비.
 */
function connect(url) {
  const ws = new WebSocket(url);
  const queue = [];
  const consumers = [];
  let isOpen = false;
  ws.on('open', () => { isOpen = true; });
  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    // 대기 중인 consumer가 있고 predicate 만족하면 즉시 소비
    for (let i = 0; i < consumers.length; i += 1) {
      if (consumers[i].predicate(msg)) {
        const c = consumers.splice(i, 1)[0];
        clearTimeout(c.timer);
        c.resolve(msg);
        return;
      }
    }
    queue.push(msg);
  });
  return {
    ws,
    waitOpen: () => new Promise((resolve, reject) => {
      if (isOpen) return resolve();
      ws.once('open', resolve);
      ws.once('error', reject);
    }),
    waitFor: (typeOrPredicate, timeoutMs = 3000) => {
      const predicate = typeof typeOrPredicate === 'string'
        ? (m) => m.type === typeOrPredicate
        : typeOrPredicate;
      return new Promise((resolve, reject) => {
        // 큐에서 매치 찾고 제거 (소비)
        const idx = queue.findIndex(predicate);
        if (idx >= 0) {
          const msg = queue.splice(idx, 1)[0];
          return resolve(msg);
        }
        // 없으면 consumer로 등록
        const consumer = { predicate, resolve };
        consumer.timer = setTimeout(() => {
          const i = consumers.indexOf(consumer);
          if (i >= 0) consumers.splice(i, 1);
          reject(new Error(`waitFor timeout`));
        }, timeoutMs);
        consumers.push(consumer);
      });
    },
    send: (obj) => ws.send(JSON.stringify(obj)),
    close: () => { try { ws.close(); } catch {} },
  };
}

test.describe('JR-BOT-SPAWN: janggi mode=ai 자동 봇 spawn 라이브 검증', () => {
  test('SPAWN-001: 사람 mode=ai 접속 → JOINED 수신', async () => {
    const human = connect(`${SERVER_URL}?mode=ai`);
    await human.waitOpen();
    const joined = await human.waitFor('JOINED', 3000);
    expect(joined.side).toMatch(/^(han|cho)$/);
    expect(joined.waiting).toBe(true);
    human.close();
  });

  test('SPAWN-002: 사람 mode=ai → 200ms+ 후 봇 spawn → 게임 상태 setup_cho 진입', async () => {
    const human = connect(`${SERVER_URL}?mode=ai`);
    await human.waitOpen();
    await human.waitFor('JOINED', 3000);

    // 봇이 200ms 후 spawn + WS 연결 + 두 명 입장 완료 → GAME_START phase=setup_cho
    const start = await human.waitFor('GAME_START', 5000);
    expect(start.phase).toBe('setup_cho');

    // STATE 메시지로 phase 확인
    const state = await human.waitFor('STATE', 2000);
    expect(['setup_cho', 'setup_han', 'playing']).toContain(state.phase);

    human.close();
  });

  test('SPAWN-003: 봇이 자동으로 SELECT_SETUP 처리 → playing 진입', async () => {
    const human = connect(`${SERVER_URL}?mode=ai`);
    await human.waitOpen();
    const joined = await human.waitFor('JOINED', 3000);
    console.log(`[QA] joined.side=${joined.side}, playerId=${joined.playerId}`);
    await human.waitFor('GAME_START', 5000);

    // SETUP_PROMPT를 트리거로 사용 (더 명확한 시점)
    let humanSetupSent = false;
    let playingReached = false;
    const startTime = Date.now();
    while (Date.now() - startTime < 15000) {
      try {
        // 다음 메시지 대기 (STATE 또는 SETUP_PROMPT 또는 GAME_START)
        const msg = await human.waitFor((m) =>
          m.type === 'STATE' || m.type === 'SETUP_PROMPT' || m.type === 'GAME_START'
        , 5000);
        console.log(`[QA] received ${msg.type} phase=${msg.phase ?? '-'} side=${msg.side ?? '-'}`);
        if (msg.type === 'GAME_START' && msg.phase === 'playing') {
          playingReached = true;
          break;
        }
        if (msg.type === 'STATE' && msg.phase === 'playing') {
          playingReached = true;
          break;
        }
        // SETUP_PROMPT 수신 시 사람 측이면 응답
        if (msg.type === 'SETUP_PROMPT' && msg.side === joined.side && !humanSetupSent) {
          humanSetupSent = true;
          console.log(`[QA] sending SELECT_SETUP for ${joined.side}`);
          human.send({ type: 'SELECT_SETUP', setup: 'MSMS' });
        }
      } catch (e) {
        console.log(`[QA] timeout/error: ${e.message}`);
        break;
      }
    }
    expect(playingReached).toBe(true);

    human.close();
  });

  test('SPAWN-005: playing 진입 후 봇이 MOVE 송신 (사람 STATE에 moveCount > 0 확인)', async () => {
    const human = connect(`${SERVER_URL}?mode=ai`);
    await human.waitOpen();
    const joined = await human.waitFor('JOINED', 3000);
    await human.waitFor('GAME_START', 5000);

    // setup 단계 통과 (사람도 응답)
    let humanSetupSent = false;
    let playingState = null;
    while (true) {
      const msg = await human.waitFor((m) =>
        m.type === 'STATE' || m.type === 'SETUP_PROMPT', 10000);
      if (msg.type === 'STATE' && msg.phase === 'playing') {
        playingState = msg;
        break;
      }
      if (msg.type === 'SETUP_PROMPT' && msg.side === joined.side && !humanSetupSent) {
        humanSetupSent = true;
        human.send({ type: 'SELECT_SETUP', setup: 'MSMS' });
      }
    }
    expect(playingState).not.toBeNull();
    // playing 진입 시 turn은 'han' (룰북 §6 한이 선수)
    expect(playingState.turn).toBe('han');
    expect(playingState.moveCount).toBe(0);

    // 사람이 han이면 사람부터 둬야 함 — 사람이 첫 수를 두면 봇이 응수
    if (joined.side === 'han') {
      // 사람이 가장 안전한 수: 졸 전진 — 한 진영 졸 (3,3) 또는 (1,3) → 전진(같은 file 한 칸 위)
      // 한 진영은 위쪽(rank 0~4)이므로 졸은 (3,3) → (3,4)
      human.send({ type: 'MOVE', fromFile: 0, fromRank: 3, toFile: 0, toRank: 4 });
      // 사람 수 후 STATE → 그 다음 봇 수로 moveCount=2 도달
      const afterBot = await human.waitFor((m) =>
        m.type === 'STATE' && m.moveCount >= 2, 5000);
      expect(afterBot.moveCount).toBeGreaterThanOrEqual(2);
      expect(afterBot.turn).toBe('han'); // 봇(cho)이 둔 후 사람(han) 차례
    } else {
      // 사람이 cho — 봇(han) 먼저 둠 → moveCount=1로 갱신됨
      const next = await human.waitFor((m) =>
        m.type === 'STATE' && m.moveCount > 0, 5000);
      expect(next.moveCount).toBeGreaterThanOrEqual(1);
      expect(next.turn).toBe('cho');
    }
    human.close();
  });

  test('SPAWN-004: 사람 disconnect 후 봇도 종료 (재접속 가능 확인)', async () => {
    const human = connect(`${SERVER_URL}?mode=ai`);
    await human.waitOpen();
    await human.waitFor('JOINED', 3000);
    await human.waitFor('GAME_START', 5000);
    // 잠시 대기 (봇이 setup을 처리할 시간)
    await new Promise((resolve) => setTimeout(resolve, 1500));
    human.close();

    // 봇 종료 + 룸 리셋을 위해 잠시 대기
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // 새 사람이 접속 → 다시 JOINED + 새 봇 spawn 가능해야 함
    const human2 = connect(`${SERVER_URL}?mode=ai`);
    await human2.waitOpen();
    const joined2 = await human2.waitFor('JOINED', 3000);
    expect(joined2.waiting).toBe(true);
    // 두 번째 봇 spawn으로 GAME_START 가능
    const start = await human2.waitFor('GAME_START', 5000);
    expect(start.phase).toBe('setup_cho');
    human2.close();
  });
});
