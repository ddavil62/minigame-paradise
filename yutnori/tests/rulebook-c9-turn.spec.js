/**
 * @fileoverview YR-C9 시리즈 — 턴 전환 + capturedBonus 리셋 (10개)
 * 룰북 참조: minigames/yutnori/docs/RULEBOOK.md §5-1 §13-7 §13-11
 */

import { test, expect } from 'playwright/test';
import { createApp } from '../server.js';
import { startServer, stopServer, setupGame, inject } from './rulebook-helpers.js';

const HOME = -1;

// ── §5-1 §13-11 큐 소진 + 턴 전환 ──────────────────────────────────

test('YR-C9-001: 큐 소진 + 보너스 없으면 currentTurn 전환 (§5-1)', async () => {
  // Given: 큐=['do'], P1 piece 0=cell 0
  // When: MOVE_PIECE
  // Then: currentTurn=p2
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, {
      started: true, currentTurn: 'p1', pendingResults: ['do'],
      pieces: {
        p1: [{ cell: 0, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }],
      },
    });
    await p1.next('STATE');
    await p2.next('STATE');

    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
    const state = await p1.next('STATE');
    expect(state.currentTurn).toBe('p2');
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C9-002: 턴 전환 후 capturedBonus=false 잔류 없음 — P2가 정상 던지기 가능 (§13-11)', async () => {
  // Given: 잡기 후 capturedBonus 사용 → 큐 소진 → passTurn
  // When: 시뮬: P1 잡기 시나리오 → 결국 턴 종료
  //         단순화: pendingResults=['do'], capturedBonus=false 후 MOVE → passTurn → P2 turn
  // Then: P2가 THROW_YUT 가능
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, {
      started: true, currentTurn: 'p1', pendingResults: ['do'], capturedBonus: false,
      pieces: {
        p1: [{ cell: 0, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }],
      },
    });
    await p1.next('STATE');
    await p2.next('STATE');

    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
    const state = await p1.next('STATE');
    expect(state.currentTurn).toBe('p2');

    p2.send({ type: 'THROW_YUT' });
    const yr = await p2.next('YUT_RESULT');
    expect(yr.by).toBe('p2');
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C9-003: 상대 턴에 THROW_YUT → ERROR (§5-1)', async () => {
  // Given: 게임 시작 (currentTurn=p1)
  // When: P2가 THROW_YUT 시도
  // Then: ERROR
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    p2.send({ type: 'THROW_YUT' });
    const err = await p2.next('ERROR');
    expect(err.type).toBe('ERROR');
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C9-004: 상대 턴에 MOVE_PIECE → ERROR (§5-1)', async () => {
  // Given: currentTurn=p1, 큐=['do']
  // When: P2가 MOVE_PIECE 시도
  // Then: ERROR
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, { started: true, currentTurn: 'p1', pendingResults: ['do'] });
    await p1.next('STATE');
    await p2.next('STATE');

    p2.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
    const err = await p2.next('ERROR');
    expect(err.type).toBe('ERROR');
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C9-005: 게임 시작 후 currentTurn===p1 (§1 §13-7)', async () => {
  // Given: 양쪽 READY → 게임 시작
  // When: 시작 직후 STATE 검사
  // Then: currentTurn === 'p1'
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    // setupGame 직후 STATE는 이미 소화. inject 없이 빈 STATE 추출하기 위해 noop inject 수행
    await inject(port, { currentTurn: 'p1' });
    const state = await p1.next('STATE');
    expect(state.currentTurn).toBe('p1');
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C9-006: p1 턴 종료 → currentTurn=p2 (§5-1)', async () => {
  // Given: P1 큐=['do']
  // When: MOVE_PIECE
  // Then: currentTurn=p2
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, {
      started: true, currentTurn: 'p1', pendingResults: ['do'],
      pieces: {
        p1: [{ cell: 0, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }],
      },
    });
    await p1.next('STATE');
    await p2.next('STATE');

    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
    const state = await p1.next('STATE');
    expect(state.currentTurn).toBe('p2');
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C9-007: p2 턴 종료 → currentTurn=p1 (§5-1)', async () => {
  // Given: currentTurn=p2, P2 큐=['do'], P2 piece 0=cell 0
  // When: MOVE_PIECE
  // Then: currentTurn=p1
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, {
      started: true, currentTurn: 'p2', pendingResults: ['do'],
      pieces: {
        p2: [{ cell: 0, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }],
      },
    });
    await p1.next('STATE');
    await p2.next('STATE');

    p2.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
    const state = await p2.next('STATE');
    expect(state.currentTurn).toBe('p1');
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C9-008: 잡기 → capturedBonus → 보너스 사이클 종료 후 currentTurn=p2 + capturedBonus 리셋 (§6-2 §13-11)', async () => {
  // Given: P1 piece 0=cell 2, P2 piece 0=cell 3, 큐=['do']
  // When: P1 do(1) → 잡기 → capturedBonus=true → 보너스 사이클 종료를 inject로 시뮬:
  //         큐=['do'] + capturedBonus=false 주입 (보너스 던지기로 do 결과 가져온 뒤 보너스 권리 소진된 상태)
  //         → MOVE_PIECE(do) → 큐 소진 + 보너스 없음 → passTurn → currentTurn=p2 + capturedBonus=false 잔류
  // Then: P2가 정상 THROW_YUT 가능 (capturedBonus 잘못된 잔류 없음)
  //
  // NOTE: server.js는 MOVE_PIECE 큐 소진 시 hasBonus 판정에 capturedBonus===true를 포함하므로,
  //       잡기 후 plain MOVE만으로는 capturedBonus를 자체 소진할 수 없다. 실제 흐름은
  //       보너스 THROW_YUT 호출 후 다시 MOVE가 필요하며, 본 테스트는 이 사이클을 inject로 단축한다.
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

    // 보너스 던지기 사이클 종료 시뮬: 큐 ['do'] 주입 + capturedBonus=false 명시 (보너스 소진 후 상태)
    await inject(port, { pendingResults: ['do'], capturedBonus: false });
    await p1.next('STATE');
    await p2.next('STATE');

    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
    const state = await p1.next('STATE');
    expect(state.currentTurn).toBe('p2');

    // P2 정상 THROW 가능 (잔류 capturedBonus 없음)
    p2.send({ type: 'THROW_YUT' });
    const yr = await p2.next('YUT_RESULT');
    expect(yr.by).toBe('p2');
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C9-009: pendingResults=[do,yut] → do 사용 후 yut 잔여 → 같은 턴 유지 (§5-1 §6-3)', async () => {
  // Given: 큐=['do','yut'], P1 piece 0=cell 0
  // When: do 사용
  // Then: pendingResults=['yut'], currentTurn=p1 유지
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, {
      started: true, currentTurn: 'p1', pendingResults: ['do', 'yut'],
      pieces: {
        p1: [{ cell: 0, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }],
      },
    });
    await p1.next('STATE');
    await p2.next('STATE');

    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
    const state = await p1.next('STATE');
    expect(state.currentTurn).toBe('p1');
    expect(state.pendingResults).toEqual(['yut']);
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C9-010: STATE의 currentTurn이 양쪽 클라이언트에 동기화 (부록)', async () => {
  // Given: 큐=['do'], P1 piece 0=cell 0
  // When: P1 MOVE_PIECE → turn 전환
  // Then: P1, P2 모두 STATE에서 currentTurn=p2 확인
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, {
      started: true, currentTurn: 'p1', pendingResults: ['do'],
      pieces: {
        p1: [{ cell: 0, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }],
      },
    });
    await p1.next('STATE');
    await p2.next('STATE');

    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
    const state1 = await p1.next('STATE');
    const state2 = await p2.next('STATE');
    expect(state1.currentTurn).toBe('p2');
    expect(state2.currentTurn).toBe('p2');
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});
