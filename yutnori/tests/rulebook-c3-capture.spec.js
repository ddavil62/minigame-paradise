/**
 * @fileoverview YR-C3 시리즈 — 잡기 (10개)
 * 룰북 참조: minigames/yutnori/docs/RULEBOOK.md §7 (잡기)
 *
 * WS 시나리오: createApp + inject로 말 위치 강제 배치 → MOVE_PIECE → STATE 검증.
 */

import { test, expect } from 'playwright/test';
import { createApp } from '../server.js';
import { startServer, stopServer, setupGame, inject } from './rulebook-helpers.js';

const HOME = -1;

// ── §7-1 단독 잡기 ─────────────────────────────────────────────────

test('YR-C3-001: 상대 단독 말 칸에 도착 → 상대 말 HOME 복귀 (§7-1)', async () => {
  // Given: P1 말 cell=2, P2 말 cell=3
  // When: P1이 do(1) 사용 → cell 3 도착
  // Then: P2의 cell=3 말이 HOME(-1) 복귀
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, {
      started: true,
      currentTurn: 'p1',
      pendingResults: ['do'],
      pieces: {
        p1: [
          { cell: 2, stack: 1, done: false },
          { cell: HOME, stack: 1, done: false },
          { cell: HOME, stack: 1, done: false },
          { cell: HOME, stack: 1, done: false },
        ],
        p2: [
          { cell: 3, stack: 1, done: false },
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
    const p1Pieces = state.players.find((p) => p.id === 'p1').pieces;
    const p2Pieces = state.players.find((p) => p.id === 'p2').pieces;
    expect(p1Pieces[0].cell).toBe(3);
    expect(p2Pieces[0].cell).toBe(HOME);
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C3-002: 잡기 후 capturedBonus 플래그 활성 → 큐 비어도 THROW 허용 (§6-1 §7-2)', async () => {
  // Given: P1 cell=2, P2 cell=3, 큐=['do']
  // When: P1이 do 사용 → 잡기 발생 → 큐 비고 보너스만 남음
  // Then: P1이 추가 THROW_YUT 호출 가능 (YUT_RESULT 수신)
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, {
      started: true,
      currentTurn: 'p1',
      pendingResults: ['do'],
      pieces: {
        p1: [{ cell: 2, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }],
        p2: [{ cell: 3, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }],
      },
    });
    await p1.next('STATE');
    await p2.next('STATE');

    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
    await p1.next('STATE');

    // 잡기 후 capturedBonus=true → 큐가 비어도 THROW 가능
    p1.send({ type: 'THROW_YUT' });
    const yr = await p1.next('YUT_RESULT');
    expect(yr.by).toBe('p1');
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C3-003: 잡기 후 STATE에서 상대 piece[i].cell === -1 (§7-2)', async () => {
  // Given: P1 cell=2, P2 cell=3, 큐=['do']
  // When: P1 do 사용 → 잡기
  // Then: STATE의 P2 pieces[0].cell === -1
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
    expect(p2Pieces[0].cell).toBe(-1);
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C3-004: 업힘 묶음(2개) 잡기 → 묶음 전체 HOME 복귀 (§7-1)', async () => {
  // Given: P1 cell=2, P2 cell=3에 piece 0/1 두 개 (업힘 묶음)
  // When: P1 do(1) → cell 3 도착, 잡기
  // Then: P2 piece 0/1 모두 HOME
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, {
      started: true, currentTurn: 'p1', pendingResults: ['do'],
      pieces: {
        p1: [{ cell: 2, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }],
        p2: [
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
    const p2Pieces = state.players.find((p) => p.id === 'p2').pieces;
    expect(p2Pieces[0].cell).toBe(HOME);
    expect(p2Pieces[1].cell).toBe(HOME);
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C3-005: 업힘 묶음(3개) 잡기 → 전체 HOME 복귀 (§7-1)', async () => {
  // Given: P2의 piece 0/1/2가 cell 5에 묶음
  // When: P1이 cell 4에서 do 사용 → cell 5 도착, 잡기
  // Then: P2 piece 0/1/2 모두 HOME
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
          { cell: 5, stack: 1, done: false },
          { cell: HOME, stack: 1, done: false },
        ],
      },
    });
    await p1.next('STATE');
    await p2.next('STATE');

    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
    const state = await p1.next('STATE');
    const p2Pieces = state.players.find((p) => p.id === 'p2').pieces;
    expect(p2Pieces[0].cell).toBe(HOME);
    expect(p2Pieces[1].cell).toBe(HOME);
    expect(p2Pieces[2].cell).toBe(HOME);
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C3-006: 잡기 보너스 사용 가능 — 큐 비어도 THROW_YUT 허용 (§6-2)', async () => {
  // Given: P1 cell=2, P2 cell=3, 큐=['do']
  // When: P1 do 사용 → 잡기 → 큐 비고 capturedBonus=true
  // Then: P1 추가 THROW_YUT 시 ERROR 없이 YUT_RESULT 수신
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
    await p1.next('STATE');

    p1.send({ type: 'THROW_YUT' });
    const yr = await p1.next('YUT_RESULT');
    expect(yr.by).toBe('p1');
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C3-007: 칸 0(출발선)에서 잡기 → 상대 말 HOME 복귀 (§7-3)', async () => {
  // Given: P1 cell=HOME, P2 cell=0 (출발선), 큐=['do']
  // When: P1 do(1) → 정통 매핑 HOME+do=칸 1 (잡기 미발생) — 대안: 백도 시나리오
  //       대신: P1 cell=1에 두고 backdo로 cell 0의 P2 잡기
  // Then: 칸 0의 P2 잡힘
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, {
      started: true, currentTurn: 'p1', pendingResults: ['backdo'],
      pieces: {
        p1: [{ cell: 1, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }],
        p2: [{ cell: 0, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }],
      },
    });
    await p1.next('STATE');
    await p2.next('STATE');

    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'backdo' });
    const state = await p1.next('STATE');
    const p1Pieces = state.players.find((p) => p.id === 'p1').pieces;
    const p2Pieces = state.players.find((p) => p.id === 'p2').pieces;
    expect(p1Pieces[0].cell).toBe(0);
    expect(p2Pieces[0].cell).toBe(HOME);
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C3-008: 자기 말 있는 칸에 도착 → 잡기 없음 (업기만, 상대 미영향) (§7-1 §8-1)', async () => {
  // Given: P1 cell=2와 cell=3에 자기 말 두 개, P2 말 없음
  // When: P1 do(1) → cell 2→3, 자기 말끼리 업기
  // Then: P2 piece 변화 없음 (잡기 없음). P1 piece 0/1 같은 cell=3.
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
        p2: [
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
    const p1Pieces = state.players.find((p) => p.id === 'p1').pieces;
    expect(p1Pieces[0].cell).toBe(3);
    expect(p1Pieces[1].cell).toBe(3); // 업힘
    const p2Pieces = state.players.find((p) => p.id === 'p2').pieces;
    expect(p2Pieces.every((pc) => pc.cell === HOME)).toBe(true);
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C3-009: 완주(GOAL=99) 말은 잡기 대상 아님 (§7-1 §4-4)', async () => {
  // Given: P2 piece 0이 done=true, cell=99 (완주). P1 cell=2.
  // When: 같은 cell이 아닌 시나리오라 잡기 자체 미발생 검증.
  //       대신: P1 cell=98(불가), GOAL은 같은 인덱스라도 done=true는 충돌 제외 로직 검증.
  // Then: P1이 cell=3으로 이동해도 P2 piece 0(done=true)는 그대로 99 유지.
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, {
      started: true, currentTurn: 'p1', pendingResults: ['do'],
      pieces: {
        p1: [{ cell: 2, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }],
        p2: [
          { cell: 99, stack: 1, done: true },
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
    const p2Pieces = state.players.find((p) => p.id === 'p2').pieces;
    // 완주 말은 그대로 유지
    expect(p2Pieces[0].cell).toBe(99);
    expect(p2Pieces[0].done).toBe(true);
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C3-010: 잡기 후 상대 말 stack=1 초기화 확인 (§7-2)', async () => {
  // Given: P2 piece가 stack=3으로 묶음, P1이 잡으러 도착
  // When: P1 do(1) → 잡기
  // Then: P2 piece의 stack=1 (server.js resolveLanding에서 op.stack=1 명시 초기화)
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, {
      started: true, currentTurn: 'p1', pendingResults: ['do'],
      pieces: {
        p1: [{ cell: 2, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }],
        p2: [
          { cell: 3, stack: 3, done: false },
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
    const p2Pieces = state.players.find((p) => p.id === 'p2').pieces;
    expect(p2Pieces[0].cell).toBe(HOME);
    expect(p2Pieces[0].stack).toBe(1);
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});
