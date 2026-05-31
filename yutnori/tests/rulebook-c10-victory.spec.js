/**
 * @fileoverview YR-C10 시리즈 — 승리 (5개)
 * 룰북 참조: minigames/yutnori/docs/RULEBOOK.md §11 (승리 조건)
 */

import { test, expect } from 'playwright/test';
import { createApp } from '../server.js';
import { startServer, stopServer, setupGame, inject } from './rulebook-helpers.js';

const HOME = -1;
const GOAL = 99;

test('YR-C10-001: 마지막 말 GOAL → GAME_OVER + winner=p1 (§11-1 §11-2)', async () => {
  // Given: P1 piece 0=cell 19, 1/2/3=완주(done=true), 큐=['do']
  // When: do(1) → 19 + do → GOAL → 4말 완주
  // Then: GAME_OVER + winner='p1'
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, {
      started: true, currentTurn: 'p1', pendingResults: ['do'],
      pieces: {
        p1: [
          { cell: 19, stack: 1, done: false },
          { cell: GOAL, stack: 1, done: true },
          { cell: GOAL, stack: 1, done: true },
          { cell: GOAL, stack: 1, done: true },
        ],
      },
    });
    await p1.next('STATE');
    await p2.next('STATE');

    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
    const over = await p1.next('GAME_OVER');
    expect(over.winner).toBe('p1');
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C10-002: 완주 후 남은 pendingResults 있어도 즉시 종료 (§11-2)', async () => {
  // Given: P1 piece 0=19, 나머지 done, 큐=['do','yut']
  // When: do 사용 → 완주 → GAME_OVER 즉시
  // Then: GAME_OVER 수신 (yut 잔여는 무시)
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, {
      started: true, currentTurn: 'p1', pendingResults: ['do', 'yut'],
      pieces: {
        p1: [
          { cell: 19, stack: 1, done: false },
          { cell: GOAL, stack: 1, done: true },
          { cell: GOAL, stack: 1, done: true },
          { cell: GOAL, stack: 1, done: true },
        ],
      },
    });
    await p1.next('STATE');
    await p2.next('STATE');

    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
    const over = await p1.next('GAME_OVER');
    expect(over.winner).toBe('p1');
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C10-003: 통과 완주 — cell 17에서 mo(5) → GOAL (§11-3 §4-4)', async () => {
  // Given: piece 0=cell 17, 나머지 done, 큐=['mo']
  // When: mo(5) → 17→18→19→GOAL (통과 완주)
  // Then: GAME_OVER winner=p1
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, {
      started: true, currentTurn: 'p1', pendingResults: ['mo'],
      pieces: {
        p1: [
          { cell: 17, stack: 1, done: false },
          { cell: GOAL, stack: 1, done: true },
          { cell: GOAL, stack: 1, done: true },
          { cell: GOAL, stack: 1, done: true },
        ],
      },
    });
    await p1.next('STATE');
    await p2.next('STATE');

    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'mo' });
    const over = await p1.next('GAME_OVER');
    expect(over.winner).toBe('p1');
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C10-004: p2가 4말 완주 → winner=p2 (§11-1)', async () => {
  // Given: P2 piece 0=19, 나머지 done, 큐=['do'], currentTurn=p2
  // When: P2 do(1) → 완주
  // Then: winner='p2'
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, {
      started: true, currentTurn: 'p2', pendingResults: ['do'],
      pieces: {
        p2: [
          { cell: 19, stack: 1, done: false },
          { cell: GOAL, stack: 1, done: true },
          { cell: GOAL, stack: 1, done: true },
          { cell: GOAL, stack: 1, done: true },
        ],
      },
    });
    await p1.next('STATE');
    await p2.next('STATE');

    p2.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
    const over = await p2.next('GAME_OVER');
    expect(over.winner).toBe('p2');
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C10-005: GAME_OVER 후 THROW_YUT → 차단 (game.started=false) (§11-2)', async () => {
  // Given: inject로 winner=p1 설정 → game.started=false
  // When: P1이 THROW_YUT 시도
  // Then: ERROR (게임이 진행 중이 아닙니다)
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, { winner: 'p1' });
    await p1.next('STATE');
    await p1.next('GAME_OVER');
    await p2.next('STATE');
    await p2.next('GAME_OVER');

    p1.send({ type: 'THROW_YUT' });
    const err = await p1.next('ERROR');
    expect(err.type).toBe('ERROR');
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});
