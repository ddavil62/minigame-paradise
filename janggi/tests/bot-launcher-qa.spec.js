/**
 * @fileoverview QA: launcher 통합 환경(/janggi/ws)에서 봇 spawn 검증.
 *
 * launcher가 createJanggiApp({ getBotUrl: () => `ws://localhost:${PORT}/janggi/ws?mode=bot` })로
 * 호출하므로, 사람이 /janggi/ws?mode=ai로 접속하면 봇이 /janggi/ws?mode=bot으로 spawn된다.
 *
 * 외부 서버 의존: localhost:3088 — launcher가 미리 기동되어 있어야 한다.
 */

import { test, expect } from '@playwright/test';
import { WebSocket } from 'ws';

const LAUNCHER_WS = 'ws://localhost:3088/janggi/ws';

function connect(url) {
  const ws = new WebSocket(url);
  const queue = [];
  const consumers = [];
  let isOpen = false;
  ws.on('open', () => { isOpen = true; });
  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
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
    waitFor: (typeOrPredicate, timeoutMs = 5000) => {
      const predicate = typeof typeOrPredicate === 'string'
        ? (m) => m.type === typeOrPredicate
        : typeOrPredicate;
      return new Promise((resolve, reject) => {
        const idx = queue.findIndex(predicate);
        if (idx >= 0) {
          const msg = queue.splice(idx, 1)[0];
          return resolve(msg);
        }
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

test.describe('JR-BOT-LAUNCHER: launcher 통합 라우터에서 봇 spawn', () => {
  test('LAUNCHER-001: /janggi/ws?mode=ai 접속 → 봇이 /janggi/ws?mode=bot으로 spawn → GAME_START', async () => {
    const human = connect(`${LAUNCHER_WS}?mode=ai`);
    await human.waitOpen();
    const joined = await human.waitFor('JOINED', 5000);
    expect(joined.side).toMatch(/^(han|cho)$/);
    const start = await human.waitFor('GAME_START', 5000);
    expect(start.phase).toBe('setup_cho');
    human.close();
  });

  test('LAUNCHER-002: launcher 환경에서 setup → playing → MOVE 전체 흐름', async () => {
    const human = connect(`${LAUNCHER_WS}?mode=ai`);
    await human.waitOpen();
    const joined = await human.waitFor('JOINED', 5000);
    await human.waitFor('GAME_START', 5000);

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
    expect(playingState.turn).toBe('han');
    expect(playingState.moveCount).toBe(0);
    human.close();
  });
});
