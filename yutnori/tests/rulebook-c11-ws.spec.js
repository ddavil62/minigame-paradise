/**
 * @fileoverview YR-C11 시리즈 — WebSocket 프로토콜 (15개)
 * 룰북 참조: minigames/yutnori/docs/RULEBOOK.md 부록 (WebSocket 프로토콜)
 *
 * WS 시나리오: createApp + ws.scenarios 패턴 재사용. 브라우저 불필요.
 */

import { test, expect } from 'playwright/test';
import { createApp } from '../server.js';
import { startServer, stopServer, connectWs, setupGame, inject } from './rulebook-helpers.js';

const HOME = -1;
const GOAL = 99;

test('YR-C11-001: P1 JOIN → JOINED(waiting=true, playerId=p1) (부록)', async () => {
  // Given: 신규 서버
  // When: P1만 JOIN
  // Then: JOINED 메시지, playerId=p1, waiting=true
  const app = createApp({});
  const { server, port } = await startServer(app);
  const p1 = await connectWs(port);
  try {
    p1.send({ type: 'JOIN', playerName: 'Alice' });
    const j = await p1.next('JOINED');
    expect(j.playerId).toBe('p1');
    expect(j.waiting).toBe(true);
  } finally {
    p1.close();
    await stopServer(server);
  }
});

test('YR-C11-002: P2 JOIN → JOINED(waiting=false), P1에 STATE broadcast (부록)', async () => {
  // Given: P1 JOIN 완료
  // When: P2 JOIN
  // Then: P2 JOINED(waiting=false), P1이 STATE 수신
  const app = createApp({});
  const { server, port } = await startServer(app);
  const p1 = await connectWs(port);
  p1.send({ type: 'JOIN', playerName: 'A' });
  await p1.next('JOINED');
  const p2 = await connectWs(port);
  try {
    p2.send({ type: 'JOIN', playerName: 'B' });
    const j2 = await p2.next('JOINED');
    expect(j2.playerId).toBe('p2');
    expect(j2.waiting).toBe(false);
    const stateForP1 = await p1.next('STATE');
    expect(stateForP1.type).toBe('STATE');
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C11-003: 양쪽 READY → START + STATE broadcast (부록)', async () => {
  // Given: 두 플레이어 JOIN 완료
  // When: 양쪽 READY
  // Then: START + STATE 양쪽 수신, STATE.started=true, currentTurn=p1
  const app = createApp({});
  const { server, port } = await startServer(app);
  const p1 = await connectWs(port);
  const p2 = await connectWs(port);
  p1.send({ type: 'JOIN', playerName: 'A' });
  p2.send({ type: 'JOIN', playerName: 'B' });
  await p1.next('JOINED');
  await p2.next('JOINED');
  await p1.next('STATE');
  await p2.next('STATE');
  await p1.next('STATE');
  await p2.next('STATE');
  try {
    p1.send({ type: 'READY' });
    p2.send({ type: 'READY' });
    const s = await p1.next('START');
    expect(s.type).toBe('START');
    const st = await p1.next('STATE');
    expect(st.started).toBe(true);
    expect(st.currentTurn).toBe('p1');
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C11-004: THROW_YUT → YUT_RESULT broadcast + STATE (부록 §3)', async () => {
  // Given: 게임 시작 후 P1 턴
  // When: P1 THROW_YUT
  // Then: YUT_RESULT(by=p1, sticks 4개) + STATE 수신
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    p1.send({ type: 'THROW_YUT' });
    const yr = await p1.next('YUT_RESULT');
    expect(yr.by).toBe('p1');
    expect(Array.isArray(yr.sticks)).toBe(true);
    expect(yr.sticks).toHaveLength(4);
    const st = await p1.next('STATE');
    expect(st.type).toBe('STATE');
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C11-005: MOVE_PIECE 유효 → STATE 말 위치 갱신 (부록 §5)', async () => {
  // Given: 큐=['do'], P1 piece 0=HOME
  // When: MOVE_PIECE
  // Then: STATE pieces[0].cell !== HOME
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, { started: true, currentTurn: 'p1', pendingResults: ['do'] });
    await p1.next('STATE');
    await p2.next('STATE');

    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
    const st = await p1.next('STATE');
    const pieces = st.players.find((p) => p.id === 'p1').pieces;
    expect(pieces[0].cell).not.toBe(HOME);
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C11-006: CHOOSE_PATH 후 분기 이동 완료 (부록 §10-3)', async () => {
  // 갱신 사유: 버그A 수정(2026-06-16) — cell 22 통과는 자동 라우팅이라 BRANCH_REQUEST 없음.
  //   중앙 분기 모달은 cell 23 정착 후 다음 이동 시 발생하므로 setup을 cell 23으로 변경.
  //   버그B 수정 — top(centerExitA) 출구가 23→28→29→15 경로화. gae(2) → cell 29.
  // Given: piece 0=cell 23, 큐=['gae'] → MOVE_PIECE 후 BRANCH_REQUEST(center)
  // When: CHOOSE_PATH(top)
  // Then: piece 0 = cell 29 (centerExitA: 23→28→29)
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, {
      started: true, currentTurn: 'p1', pendingResults: ['gae'],
      pieces: {
        p1: [{ cell: 23, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }],
      },
    });
    await p1.next('STATE');
    await p2.next('STATE');

    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'gae' });
    await p1.next('BRANCH_REQUEST');
    await p1.next('STATE');

    p1.send({ type: 'CHOOSE_PATH', pathChoice: 'top' });
    const st = await p1.next('STATE');
    const pieces = st.players.find((p) => p.id === 'p1').pieces;
    expect(pieces[0].cell).toBe(29);
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C11-007: REMATCH 양쪽 → REMATCH_STATUS + START + STATE (부록)', async () => {
  // Given: inject winner=p1 → GAME_OVER
  // When: 양쪽 REMATCH
  // Then: START + STATE(started=true)
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, { winner: 'p1' });
    await p1.next('STATE');
    await p1.next('GAME_OVER');
    await p2.next('STATE');
    await p2.next('GAME_OVER');

    p1.send({ type: 'REMATCH' });
    await p1.next('REMATCH_STATUS');
    p2.send({ type: 'REMATCH' });
    const s = await p1.next('START');
    expect(s.type).toBe('START');
    const st = await p1.next('STATE');
    expect(st.started).toBe(true);
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C11-008: 3번째 연결 → ERROR + 자동 close (부록)', async () => {
  // Given: 두 플레이어 JOIN 완료
  // When: 3번째 클라이언트 연결
  // Then: ERROR(Room is full) + 자동 close
  const app = createApp({});
  const { server, port } = await startServer(app);
  const p1 = await connectWs(port);
  const p2 = await connectWs(port);
  p1.send({ type: 'JOIN', playerName: 'A' });
  p2.send({ type: 'JOIN', playerName: 'B' });
  await p1.next('JOINED');
  await p2.next('JOINED');
  await p1.next('STATE');

  const p3 = await connectWs(port);
  try {
    const err = await p3.next('ERROR');
    expect(err.type).toBe('ERROR');
    await p3.waitClose();
  } finally {
    p1.close(); p2.close(); p3.close();
    await stopServer(server);
  }
});

test('YR-C11-009: P1 disconnect → P2 GAME_OVER(reason:disconnect) (부록)', async () => {
  // Given: 게임 진행 중
  // When: P1 close
  // Then: P2 GAME_OVER(reason='disconnect', winner='p2')
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    p1.close();
    const over = await p2.next('GAME_OVER');
    expect(over.reason).toBe('disconnect');
    expect(over.winner).toBe('p2');
  } finally {
    p2.close();
    await stopServer(server);
  }
});

test('YR-C11-010: inject winner=p1 → GAME_OVER + STATE(started=false) (부록 §11)', async () => {
  // Given: 게임 진행 중
  // When: inject winner=p1
  // Then: 양쪽 GAME_OVER + STATE(started=false, winner=p1)
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, { winner: 'p1' });
    const st = await p1.next('STATE');
    expect(st.started).toBe(false);
    expect(st.winner).toBe('p1');
    const over = await p1.next('GAME_OVER');
    expect(over.winner).toBe('p1');
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C11-011: inject로 turnChange 후 상대 THROW_YUT → ERROR (부록)', async () => {
  // Given: inject currentTurn=p2
  // When: P1이 THROW_YUT
  // Then: ERROR
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, { started: true, currentTurn: 'p2' });
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

test('YR-C11-012: inject로 pieces 배치 → STATE 즉시 반영 (부록)', async () => {
  // Given: inject piece 0 cell=7
  // When: STATE 수신
  // Then: p1 pieces[0].cell === 7
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, {
      started: true, currentTurn: 'p1',
      pieces: {
        p1: [
          { cell: 7, stack: 1, done: false },
          { cell: HOME, stack: 1, done: false },
          { cell: HOME, stack: 1, done: false },
          { cell: HOME, stack: 1, done: false },
        ],
      },
    });
    const st = await p1.next('STATE');
    const pieces = st.players.find((p) => p.id === 'p1').pieces;
    expect(pieces[0].cell).toBe(7);
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C11-013: awaitingBranchAt 상태에서 THROW_YUT → ERROR (부록 §10-3)', async () => {
  // 갱신 사유: 버그A 수정(2026-06-16) — cell 22 통과는 자동 라우팅. 중앙 정착(cell 23)으로 변경.
  // Given: piece 0=23, 큐=['gae'] → MOVE → BRANCH_REQUEST(center)
  // When: P1 THROW_YUT
  // Then: ERROR(분기...)
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, {
      started: true, currentTurn: 'p1', pendingResults: ['gae'],
      pieces: {
        p1: [{ cell: 23, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }],
      },
    });
    await p1.next('STATE');
    await p2.next('STATE');

    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'gae' });
    await p1.next('BRANCH_REQUEST');

    p1.send({ type: 'THROW_YUT' });
    const err = await p1.next('ERROR');
    expect(err.message).toMatch(/분기/);
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C11-014: 미존재 useResult로 MOVE_PIECE → ERROR (부록 §5)', async () => {
  // Given: 큐=['do']
  // When: MOVE_PIECE(useResult='mo')
  // Then: ERROR
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, { started: true, currentTurn: 'p1', pendingResults: ['do'] });
    await p1.next('STATE');
    await p2.next('STATE');

    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'mo' });
    const err = await p1.next('ERROR');
    expect(err.type).toBe('ERROR');
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C11-015: 완주 말(done=true)에 MOVE_PIECE → ERROR (부록 §11)', async () => {
  // Given: piece 0 done=true, 큐=['do']
  // When: MOVE_PIECE(pieceIndex=0)
  // Then: ERROR
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, {
      started: true, currentTurn: 'p1', pendingResults: ['do'],
      pieces: {
        p1: [
          { cell: GOAL, stack: 1, done: true },
          { cell: HOME, stack: 1, done: false },
          { cell: HOME, stack: 1, done: false },
          { cell: HOME, stack: 1, done: false },
        ],
      },
    });
    await p1.next('STATE');
    await p2.next('STATE');

    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
    const err = await p1.next('ERROR');
    expect(err.type).toBe('ERROR');
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});
