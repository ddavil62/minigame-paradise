/**
 * @fileoverview YR-C4 시리즈 — 업기 (10개)
 * 룰북 참조: minigames/yutnori/docs/RULEBOOK.md §8 (업기)
 *
 * 본 구현은 명시적 "업힘 객체" 없이 같은 cell의 자기 piece를 묶음 처리한다.
 * WS inject + MOVE_PIECE 후 STATE에서 같은 cell 검증.
 */

import { test, expect } from 'playwright/test';
import { createApp } from '../server.js';
import { startServer, stopServer, setupGame, inject } from './rulebook-helpers.js';

const HOME = -1;

// ── §8-1 업기 기본 ────────────────────────────────────────────────

test('YR-C4-001: 자기 말 있는 칸에 도착 → 두 말이 같은 cell (§8-1)', async () => {
  // Given: P1 piece 0=cell 2, piece 1=cell 3, 큐=['do']
  // When: P1 do(1) → piece 0이 cell 3 도착
  // Then: piece 0 / 1 모두 cell=3
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, {
      started: true, currentTurn: 'p1', pendingResults: ['do'],
      pieces: {
        p1: [
          { cell: 2, stack: 1, done: false },
          { cell: 3, stack: 1, done: false },
          { cell: HOME, stack: 1, done: false },
          { cell: HOME, stack: 1, done: false },
        ],
      },
    });
    await p1.next('STATE');
    await p2.next('STATE');

    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
    const state = await p1.next('STATE');
    const pieces = state.players.find((p) => p.id === 'p1').pieces;
    expect(pieces[0].cell).toBe(3);
    expect(pieces[1].cell).toBe(3);
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C4-002: 업힘 후 다음 이동 시 같은 cell 말들 함께 이동 (§8-1 §5-3)', async () => {
  // Given: P1 piece 0/1이 모두 cell 3 (업힘 묶음 상태), 큐=['do']
  // When: P1 piece 0을 do 사용
  // Then: piece 0/1 모두 cell 4
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, {
      started: true, currentTurn: 'p1', pendingResults: ['do'],
      pieces: {
        p1: [
          { cell: 3, stack: 1, done: false },
          { cell: 3, stack: 1, done: false },
          { cell: HOME, stack: 1, done: false },
          { cell: HOME, stack: 1, done: false },
        ],
      },
    });
    await p1.next('STATE');
    await p2.next('STATE');

    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
    const state = await p1.next('STATE');
    const pieces = state.players.find((p) => p.id === 'p1').pieces;
    expect(pieces[0].cell).toBe(4);
    expect(pieces[1].cell).toBe(4);
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C4-003: 업힌 묶음(2개) 이동 후 cell 동일 (§8-2 §5-3)', async () => {
  // Given: 묶음 + gae(2)
  // When: 묶음 이동
  // Then: 두 piece의 cell 동일하게 갱신
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, {
      started: true, currentTurn: 'p1', pendingResults: ['gae'],
      pieces: {
        p1: [
          { cell: 3, stack: 1, done: false },
          { cell: 3, stack: 1, done: false },
          { cell: HOME, stack: 1, done: false },
          { cell: HOME, stack: 1, done: false },
        ],
      },
    });
    await p1.next('STATE');
    await p2.next('STATE');

    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'gae' });
    const state = await p1.next('STATE');
    const pieces = state.players.find((p) => p.id === 'p1').pieces;
    expect(pieces[0].cell).toBe(pieces[1].cell);
    // 3→5 (모서리 도달)
    expect(pieces[0].cell).toBe(5);
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C4-004: 업힌 묶음이 상대에게 잡힘 → 묶음 전체 HOME (§8-1 §7-1)', async () => {
  // Given: P1 piece 0/1=cell 3 (묶음), P2 piece 0=cell 2, 큐(P2)=['do'], 턴 P2
  // When: P2 do(1) → cell 3 도착, 잡기
  // Then: P1 piece 0/1 모두 HOME
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, {
      started: true, currentTurn: 'p2', pendingResults: ['do'],
      pieces: {
        p1: [
          { cell: 3, stack: 1, done: false },
          { cell: 3, stack: 1, done: false },
          { cell: HOME, stack: 1, done: false },
          { cell: HOME, stack: 1, done: false },
        ],
        p2: [{ cell: 2, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }],
      },
    });
    await p1.next('STATE');
    await p2.next('STATE');

    p2.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
    const state = await p2.next('STATE');
    const p1Pieces = state.players.find((p) => p.id === 'p1').pieces;
    expect(p1Pieces[0].cell).toBe(HOME);
    expect(p1Pieces[1].cell).toBe(HOME);
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C4-005: HOME 말끼리는 업기 없음 (§8-2)', async () => {
  // Given: P1 piece 0/1 모두 HOME
  // When: P1 do(1)로 piece 0 이동 → 칸 1 (정통 매핑)
  // Then: piece 1은 HOME 유지 (HOME끼리는 묶음 아님)
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, {
      started: true, currentTurn: 'p1', pendingResults: ['do'],
      pieces: {
        p1: [
          { cell: HOME, stack: 1, done: false },
          { cell: HOME, stack: 1, done: false },
          { cell: HOME, stack: 1, done: false },
          { cell: HOME, stack: 1, done: false },
        ],
      },
    });
    await p1.next('STATE');
    await p2.next('STATE');

    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
    const state = await p1.next('STATE');
    const pieces = state.players.find((p) => p.id === 'p1').pieces;
    // piece 0만 이동, 나머지 HOME
    expect(pieces[0].cell).toBe(1);
    expect(pieces[1].cell).toBe(HOME);
    expect(pieces[2].cell).toBe(HOME);
    expect(pieces[3].cell).toBe(HOME);
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C4-006: 3개 말 같은 칸 → 다음 이동 시 3개 함께 이동 (§5-3 §8-2)', async () => {
  // Given: piece 0/1/2 모두 cell 3
  // When: do(1)
  // Then: 3개 모두 cell 4
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, {
      started: true, currentTurn: 'p1', pendingResults: ['do'],
      pieces: {
        p1: [
          { cell: 3, stack: 1, done: false },
          { cell: 3, stack: 1, done: false },
          { cell: 3, stack: 1, done: false },
          { cell: HOME, stack: 1, done: false },
        ],
      },
    });
    await p1.next('STATE');
    await p2.next('STATE');

    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
    const state = await p1.next('STATE');
    const pieces = state.players.find((p) => p.id === 'p1').pieces;
    expect(pieces[0].cell).toBe(4);
    expect(pieces[1].cell).toBe(4);
    expect(pieces[2].cell).toBe(4);
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C4-007: 업힘 후 잡기 발생 → 업힌 말 전부 HOME + capturedBonus (§7-1 §8-1)', async () => {
  // Given: P2 piece 0/1=cell 5 (묶음), P1 piece 0=cell 4, 큐=['do']
  // When: P1 do(1) → cell 5 도착, 잡기
  // Then: P2 두 piece HOME, P1 capturedBonus=true (큐 비어도 THROW 가능)
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, {
      started: true, currentTurn: 'p1', pendingResults: ['do'],
      pieces: {
        p1: [{ cell: 4, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }],
        p2: [
          { cell: 5, stack: 1, done: false },
          { cell: 5, stack: 1, done: false },
          { cell: HOME, stack: 1, done: false },
          { cell: HOME, stack: 1, done: false },
        ],
      },
    });
    await p1.next('STATE');
    await p2.next('STATE');

    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
    await p1.next('STATE');

    // 잡기 보너스 → 큐 비어도 THROW_YUT 가능
    p1.send({ type: 'THROW_YUT' });
    const yr = await p1.next('YUT_RESULT');
    expect(yr.by).toBe('p1');
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C4-008: 업힌 묶음 대표 말 이동 시 나머지 따라옴 확인 (§5-3)', async () => {
  // Given: piece 1/2 모두 cell 4 (묶음)
  // When: P1이 piece 1을 do로 이동
  // Then: piece 1, 2 모두 cell 5
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, {
      started: true, currentTurn: 'p1', pendingResults: ['do'],
      pieces: {
        p1: [
          { cell: HOME, stack: 1, done: false },
          { cell: 4, stack: 1, done: false },
          { cell: 4, stack: 1, done: false },
          { cell: HOME, stack: 1, done: false },
        ],
      },
    });
    await p1.next('STATE');
    await p2.next('STATE');

    p1.send({ type: 'MOVE_PIECE', pieceIndex: 1, useResult: 'do' });
    const state = await p1.next('STATE');
    const pieces = state.players.find((p) => p.id === 'p1').pieces;
    expect(pieces[1].cell).toBe(5);
    expect(pieces[2].cell).toBe(5);
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C4-009: 업힘은 같은 편끼리만 (상대 말은 잡기 처리) (§7-1 §8-1)', async () => {
  // Given: P1 piece 0=cell 2, P2 piece 0=cell 3
  // When: P1 do → cell 3 (P2 piece 잡기 발생)
  // Then: P2 piece 0=HOME (업기 아닌 잡기로 처리)
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, {
      started: true, currentTurn: 'p1', pendingResults: ['do'],
      pieces: {
        p1: [{ cell: 2, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }],
        p2: [{ cell: 3, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }],
      },
    });
    await p1.next('STATE');
    await p2.next('STATE');

    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
    const state = await p1.next('STATE');
    const p2Pieces = state.players.find((p) => p.id === 'p2').pieces;
    expect(p2Pieces[0].cell).toBe(HOME);
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C4-010: 완주 말은 업기 그룹에서 제외 (done=true) (§8-2 §4-4)', async () => {
  // Given: piece 0=cell 3 (보드), piece 1=99/done (완주). 두 piece의 cell은 다름.
  //         묶음 처리는 같은 cell + done=false 조건이므로 piece 1은 그룹 제외.
  // When: P1 do(1) → piece 0이 cell 4 도착
  // Then: piece 1은 done 상태 그대로 cell 99 유지 (이동 안 함)
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, {
      started: true, currentTurn: 'p1', pendingResults: ['do'],
      pieces: {
        p1: [
          { cell: 3, stack: 1, done: false },
          { cell: 99, stack: 1, done: true },
          { cell: HOME, stack: 1, done: false },
          { cell: HOME, stack: 1, done: false },
        ],
      },
    });
    await p1.next('STATE');
    await p2.next('STATE');

    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
    const state = await p1.next('STATE');
    const pieces = state.players.find((p) => p.id === 'p1').pieces;
    expect(pieces[0].cell).toBe(4);
    expect(pieces[1].cell).toBe(99);
    expect(pieces[1].done).toBe(true);
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});
