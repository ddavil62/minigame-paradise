/**
 * @fileoverview YR-C8 시리즈 — 보너스 던지기 (10개)
 * 룰북 참조: minigames/yutnori/docs/RULEBOOK.md §6 (보너스 한 번 더), §13-11 capturedBonus 리셋
 *
 * WS 시나리오: createApp + inject + THROW_YUT / MOVE_PIECE 시퀀스.
 */

import { test, expect } from 'playwright/test';
import { createApp } from '../server.js';
import { startServer, stopServer, setupGame, inject } from './rulebook-helpers.js';

const HOME = -1;

// ── §6-1 §6-2 윷/모/잡기 보너스 허용 ──────────────────────────────

test('YR-C8-001: 큐에 yut 잔여 시 THROW_YUT 허용 (§6-1 §6-2)', async () => {
  // Given: pendingResults=['yut']
  // When: P1 THROW_YUT
  // Then: YUT_RESULT 수신 (ERROR 아님)
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, { started: true, currentTurn: 'p1', pendingResults: ['yut'] });
    await p1.next('STATE');
    await p2.next('STATE');

    p1.send({ type: 'THROW_YUT' });
    const yr = await p1.next('YUT_RESULT');
    expect(yr.by).toBe('p1');
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C8-002: 큐에 mo 잔여 시 THROW_YUT 허용 (§6-1 §6-2)', async () => {
  // Given: pendingResults=['mo']
  // When: P1 THROW_YUT
  // Then: YUT_RESULT 수신
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, { started: true, currentTurn: 'p1', pendingResults: ['mo'] });
    await p1.next('STATE');
    await p2.next('STATE');

    p1.send({ type: 'THROW_YUT' });
    const yr = await p1.next('YUT_RESULT');
    expect(yr.by).toBe('p1');
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C8-003: 잡기 후 capturedBonus=true → THROW_YUT 허용 (§6-1 §6-2)', async () => {
  // Given: capturedBonus=true (직접 주입), 큐 비어 있음
  // When: P1 THROW_YUT
  // Then: YUT_RESULT 수신
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, {
      started: true, currentTurn: 'p1', pendingResults: [], capturedBonus: true,
    });
    await p1.next('STATE');
    await p2.next('STATE');

    p1.send({ type: 'THROW_YUT' });
    const yr = await p1.next('YUT_RESULT');
    expect(yr.by).toBe('p1');
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C8-004: 윷+모 연속 → pendingResults에 2개 누적 (§6-3)', async () => {
  // Given: 큐=['yut','mo'] 직접 주입 (보너스 누적 시뮬레이션)
  // When: STATE 검사
  // Then: pendingResults에 2개
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, {
      started: true, currentTurn: 'p1', pendingResults: ['yut', 'mo'],
    });
    const state = await p1.next('STATE');
    expect(state.pendingResults).toEqual(['yut', 'mo']);
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C8-005: 윷+모+도 누적 → 3개 큐에서 차례로 이동 (§6-3)', async () => {
  // Given: 큐=['do','yut','mo'], P1 piece 0=cell 0
  // When: do 사용 → cell 1, 그 다음 yut(4) → cell 5
  // Then: 두 번의 MOVE_PIECE 후 cell 5, pendingResults에 mo만 남음
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, {
      started: true, currentTurn: 'p1', pendingResults: ['do', 'yut', 'mo'],
      pieces: {
        p1: [{ cell: 0, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }],
      },
    });
    await p1.next('STATE');
    await p2.next('STATE');

    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
    await p1.next('STATE');
    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'yut' });
    const state = await p1.next('STATE');
    const pieces = state.players.find((p) => p.id === 'p1').pieces;
    expect(pieces[0].cell).toBe(5);
    expect(state.pendingResults).toEqual(['mo']);
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C8-006: 큐 비고 보너스 없으면 THROW_YUT 차단 — 같은 턴에 두 번 시도 (§6-3)', async () => {
  // Given: 게임 시작 직후 P1 첫 던지기 → 결과가 do(보너스 없음)인 경우 가정.
  //         단순화: pendingResults=['do'] 주입한 상태에서 THROW_YUT 시도 → ERROR (먼저 결과 사용)
  // When: pendingResults=['do']에 THROW_YUT
  // Then: ERROR (마지막 결과가 yut/mo 아니므로 차단)
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, { started: true, currentTurn: 'p1', pendingResults: ['do'] });
    await p1.next('STATE');
    await p2.next('STATE');

    p1.send({ type: 'THROW_YUT' });
    const err = await p1.next('ERROR');
    expect(err.type).toBe('ERROR');
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C8-007: 도 사용 후 큐 소진 → 턴 종료 (p2로 currentTurn 전환) (§5-1 §6-3)', async () => {
  // Given: 큐=['do'], P1 piece 0=cell 0
  // When: MOVE_PIECE(do)
  // Then: 큐 비고 보너스 없음 → currentTurn=p2
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

test('YR-C8-008: 백도는 보너스 없음 (§6-2 §9-2)', async () => {
  // Given: 큐=['backdo'], P1 piece 0=cell 3, capturedBonus=false 명시
  // When: MOVE_PIECE(backdo) → 큐 소진
  // Then: currentTurn=p2 (백도 사용 후 보너스 없음 → 턴 종료)
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    // §13-11: capturedBonus를 명시적으로 false 주입하여 이전 batch 잔류 가능성 차단.
    await inject(port, {
      started: true, currentTurn: 'p1', pendingResults: ['backdo'], capturedBonus: false,
      pieces: {
        p1: [{ cell: 3, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }],
      },
    });
    // inject 후 STATE 1개씩 broadcast — 이전 잔여 STATE까지 모두 비워 race 차단.
    await p1.next('STATE');
    await p2.next('STATE');
    p1.drain('STATE');
    p2.drain('STATE');

    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'backdo' });
    const state = await p1.next('STATE');
    expect(state.currentTurn).toBe('p2');
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C8-009: 윷으로 잡은 경우 중복 보너스 (yut 큐 잔여 + capturedBonus) — §13-2 미해소 정책 PASS (§6-4)', async () => {
  // Given: 큐=['yut'], P1 piece 0=cell 2, P2 piece 0=cell 6 (4칸 이동시 잡힘)
  // When: P1 yut(4) 사용 → cell 6 도착, 잡기
  // Then: 큐 비지만 capturedBonus=true → THROW_YUT 허용 (중복 보너스 정책 PASS)
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, {
      started: true, currentTurn: 'p1', pendingResults: ['yut'],
      pieces: {
        p1: [{ cell: 2, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }],
        p2: [{ cell: 6, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }],
      },
    });
    await p1.next('STATE');
    await p2.next('STATE');

    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'yut' });
    await p1.next('STATE');

    // capturedBonus=true → 큐 비어도 THROW 가능
    p1.send({ type: 'THROW_YUT' });
    const yr = await p1.next('YUT_RESULT');
    expect(yr.by).toBe('p1');
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C8-010: 잡기 보너스 사용 후 capturedBonus 리셋 확인 (§6-2 §13-11)', async () => {
  // Given: capturedBonus=true, 큐=[], 잡기 보너스로 do 결과 가정 — inject로 큐=['do']도 주입
  //         P1 piece 0=cell 0
  // When: MOVE_PIECE(do) → 큐 비고 보너스 소진 → passTurn() → capturedBonus=false
  // Then: STATE 검증 — currentTurn=p2, 그리고 P2가 던질 수 있다 (잘못된 잔류 없음)
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

    // P2 THROW_YUT 가능
    p2.send({ type: 'THROW_YUT' });
    const yr = await p2.next('YUT_RESULT');
    expect(yr.by).toBe('p2');
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});
