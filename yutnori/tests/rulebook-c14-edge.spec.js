/**
 * @fileoverview YR-C14 시리즈 — 엣지케이스 (15개)
 * 룰북 참조: minigames/yutnori/docs/RULEBOOK.md §10 §6 §9 §11 부록
 *
 * 단위 + WS 혼합. 룰북에 언급된 경계 조건을 망라.
 */

import { test, expect } from 'playwright/test';
import { computeNextCell, createApp } from '../server.js';
import { startServer, stopServer, setupGame, inject } from './rulebook-helpers.js';

const HOME = -1;
const GOAL = 99;

test('YR-C14-001: HOME 말에 backdo MOVE_PIECE → ERROR (§9-2)', async () => {
  // Given: P1 모든 말 HOME, 큐=['backdo']
  // When: MOVE_PIECE(pieceIndex=0, useResult=backdo)
  // Then: ERROR (백도는 출발한 말에만)
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, {
      started: true, currentTurn: 'p1', pendingResults: ['backdo'],
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

    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'backdo' });
    const err = await p1.next('ERROR');
    expect(err.type).toBe('ERROR');
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C14-002: 완주(GOAL) 말에 MOVE_PIECE → ERROR (§4-4)', async () => {
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

test('YR-C14-003: 분기 대기 중 THROW_YUT → ERROR (§10-3)', async () => {
  // Given: BRANCH_REQUEST 대기 상태
  // When: THROW_YUT
  // Then: ERROR(분기...)
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    // 갱신 사유: 버그A 수정(2026-06-16) — 지름길 경유 중앙 통과는 자동 라우팅으로 BRANCH_REQUEST가
    //   더 이상 발생하지 않는다. 분기 대기는 말이 중앙(23)에 **정확 정착**한 뒤 다음 이동 시 발생.
    //   따라서 setup을 cell 23 정착으로 변경.
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
    expect(err.type).toBe('ERROR');
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C14-004: 분기 대기 중 MOVE_PIECE → ERROR (§10-3)', async () => {
  // Given: BRANCH_REQUEST 대기 상태
  // When: 다른 말에 MOVE_PIECE
  // Then: ERROR(분기 선택을 먼저)
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    // 갱신 사유: 버그A 수정(2026-06-16) — cell 22 통과는 자동 라우팅. 중앙 정착(cell 23)으로 변경.
    await inject(port, {
      started: true, currentTurn: 'p1', pendingResults: ['gae', 'do'],
      pieces: {
        p1: [
          { cell: 23, stack: 1, done: false },
          { cell: 0, stack: 1, done: false },
          { cell: HOME, stack: 1, done: false },
          { cell: HOME, stack: 1, done: false },
        ],
      },
    });
    await p1.next('STATE');
    await p2.next('STATE');

    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'gae' });
    await p1.next('BRANCH_REQUEST');
    await p1.next('STATE');

    // 분기 대기 중 piece 1에 do 사용 시도
    p1.send({ type: 'MOVE_PIECE', pieceIndex: 1, useResult: 'do' });
    const err = await p1.next('ERROR');
    expect(err.message).toMatch(/분기/);
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C14-005: 모서리 5 통과(멈추지 않음) — 외곽 계속 진행 (§10-1 §10-2)', () => {
  // Given: cell 4
  // When: 개(2) — 4→5→6 (5에 멈추지 않고 통과)
  // Then: cell 6 (외곽 유지)
  expect(computeNextCell(4, 2).toCell).toBe(6);
});

test('YR-C14-006: 모서리 10 통과 — 외곽 계속 진행 (§10-1 §10-2)', () => {
  // Given: cell 9
  // When: 개(2) — 9→10→11
  // Then: cell 11
  expect(computeNextCell(9, 2).toCell).toBe(11);
});

test('YR-C14-007: 지름길A 진입 중(cell 22)에서 잔여 steps로 중앙 통과 → 자동 centerExitA (버그A 2026-06-16) (§10-3)', () => {
  // 갱신 사유: 버그A 수정(2026-06-16) — 통과는 분기 의미가 없으므로 자동 centerExitA 라우팅.
  // Given: cell 22
  // When: gae(2) — 22→23(잔여 1, 자동)→28
  // Then: awaitingBranch=false, toCell=28
  const r = computeNextCell(22, 2);
  expect(r.toCell).toBe(28);
  expect(r.awaitingBranch).toBe(false);
  expect(r.finalPath).toBe('centerExitA');
});

test('YR-C14-008: 지름길B 진입 중(cell 27)에서 잔여 steps로 중앙 통과 → 자동 centerExitB (버그A 2026-06-16) (§10-3)', () => {
  // 갱신 사유: 버그A 수정(2026-06-16) — 자동 centerExitB 라우팅.
  // Given: cell 27
  // When: gae(2) — 27→23(잔여 1, 자동)→24
  // Then: awaitingBranch=false, toCell=24
  const r = computeNextCell(27, 2);
  expect(r.toCell).toBe(24);
  expect(r.awaitingBranch).toBe(false);
  expect(r.finalPath).toBe('centerExitB');
});

test('YR-C14-009: GAME_OVER 후 MOVE_PIECE → 차단 (§11-2)', async () => {
  // Given: inject winner → game.started=false
  // When: MOVE_PIECE 시도
  // Then: 차단 (winner 분기 → 함수 즉시 break, 응답 없음 또는 ERROR)
  //         server.js MOVE_PIECE 핸들러는 winner 시 if(!started || winner) break → 응답 없음.
  //         단순 검증: ERROR 또는 timeout 처리 — 본 테스트는 piece가 변하지 않음을 확인한다.
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, {
      winner: 'p1',
      pieces: {
        p1: [
          { cell: 5, stack: 1, done: false },
          { cell: HOME, stack: 1, done: false },
          { cell: HOME, stack: 1, done: false },
          { cell: HOME, stack: 1, done: false },
        ],
      },
    });
    await p1.next('STATE');
    await p1.next('GAME_OVER');
    await p2.next('STATE');
    await p2.next('GAME_OVER');

    // MOVE_PIECE 시도 — 서버는 winner 분기에서 응답 없이 break.
    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
    // 응답 없음을 확인하기 위해 250ms 후 piece가 그대로인지 inject STATE로 검증
    await new Promise((r) => setTimeout(r, 150));
    await inject(port, {}); // STATE broadcast 유도
    const st = await p1.next('STATE');
    const pieces = st.players.find((p) => p.id === 'p1').pieces;
    expect(pieces[0].cell).toBe(5); // 그대로
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C14-010: 게임 미시작(started=false) 시 THROW_YUT → ERROR (§1)', async () => {
  // Given: inject started=false
  // When: P1 THROW_YUT
  // Then: ERROR
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, { started: false });
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

test('YR-C14-011: 큐에 없는 useResult로 MOVE_PIECE → ERROR (§5-1)', async () => {
  // Given: 큐=['do']
  // When: MOVE_PIECE(useResult='yut')
  // Then: ERROR
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, { started: true, currentTurn: 'p1', pendingResults: ['do'] });
    await p1.next('STATE');
    await p2.next('STATE');

    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'yut' });
    const err = await p1.next('ERROR');
    expect(err.type).toBe('ERROR');
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C14-012: 4말 모두 완주 상태에서 winner 설정 확인 (§11-2)', async () => {
  // Given: 모든 piece done=true, 큐=['do'] (사실상 완주 후)
  //         자가 확인: inject winner='p1' → STATE.winner === 'p1'
  // When: STATE 수신
  // Then: winner='p1', started=false
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, {
      winner: 'p1',
      pieces: {
        p1: [
          { cell: GOAL, stack: 1, done: true },
          { cell: GOAL, stack: 1, done: true },
          { cell: GOAL, stack: 1, done: true },
          { cell: GOAL, stack: 1, done: true },
        ],
      },
    });
    const st = await p1.next('STATE');
    expect(st.winner).toBe('p1');
    expect(st.started).toBe(false);
    const pieces = st.players.find((p) => p.id === 'p1').pieces;
    expect(pieces.every((pc) => pc.done && pc.cell === GOAL)).toBe(true);
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C14-013: 같은 결과가 큐에 2개 있을 때 하나만 소비됨 (§5-1)', async () => {
  // Given: 큐=['do','do'], P1 piece 0=cell 0
  // When: MOVE_PIECE(do) 한 번 수행
  // Then: pendingResults=['do'] 1개 남음
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, {
      started: true, currentTurn: 'p1', pendingResults: ['do', 'do'],
      pieces: {
        p1: [{ cell: 0, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }],
      },
    });
    await p1.next('STATE');
    await p2.next('STATE');

    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
    const st = await p1.next('STATE');
    expect(st.pendingResults).toEqual(['do']);
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C14-014: inject capturedBonus=true → 큐 비어도 THROW_YUT 허용 (§6-2)', async () => {
  // Given: 큐=[], capturedBonus=true
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

test('YR-C14-015: inject winner 후 REMATCH + 새 게임 → pieces 전부 HOME 초기화 (§4-2)', async () => {
  // Given: 게임 종료 (inject winner='p1') → 양쪽 REMATCH
  // When: 새 게임 START 후 STATE 검사
  // Then: 양쪽 pieces 4개씩 모두 HOME
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

    await p1.next('START');
    const st = await p1.next('STATE');
    const p1Pieces = st.players.find((p) => p.id === 'p1').pieces;
    const p2Pieces = st.players.find((p) => p.id === 'p2').pieces;
    expect(p1Pieces.every((pc) => pc.cell === HOME)).toBe(true);
    expect(p2Pieces.every((pc) => pc.cell === HOME)).toBe(true);
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});
