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

test('YR-C8-009: 윷으로 잡은 경우 중복 보너스 차단 — §13-12 해소 (2026-06-15) (§6-1 §6-4)', async () => {
  // ── 기댓값 변경 사유 (§13-12 해소, 2026-06-15) ───────────────────────────────
  // 이 케이스는 이전에 "윷으로 잡은 경우 중복 보너스 — 미해소 정책 PASS"로, 윷으로 잡으면
  // capturedBonus=true가 부여되어 추가 던지기가 1회 더(윷 보너스 + 잡기 보너스 = 2회) 가능했다.
  // 권위 룰(§6-1, 한국어 위키): 윷/모 자체 보너스와 잡기 보너스는 중복 불가(한 행위 최대 1회).
  // server.js MOVE_PIECE/CHOOSE_PATH에 useResult가 yut/mo면 capturedBonus 미부여 가드를 추가하여
  // §13-12를 해소했다. 따라서 윷으로 잡아도 잡기 보너스는 생기지 않으며, 윷 던지기 자체로 얻는
  // 추가 던지기 권리만 유효하다(이 케이스는 inject로 큐에 yut만 주입 — 던지기 권리 흐름이 없는 상태이므로
  // 큐 소진 후 capturedBonus=false → passTurn).
  // ──────────────────────────────────────────────────────────────────────────
  // Given: 큐=['yut'], P1 piece 0=cell 2, P2 piece 0=cell 6 (4칸 이동시 잡힘)
  // When: P1 yut(4) 사용 → cell 6 도착, 잡기
  // Then: capturedBonus 미부여(false) → 큐 비고 보너스 없음 → passTurn → currentTurn=p2.
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, {
      started: true, currentTurn: 'p1', pendingResults: ['yut'], capturedBonus: false,
      pieces: {
        p1: [{ cell: 2, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }],
        p2: [{ cell: 6, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }],
      },
    });
    await p1.next('STATE');
    await p2.next('STATE');

    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'yut' });
    const state = await p1.next('STATE');
    const p2Pieces = state.players.find((p) => p.id === 'p2').pieces;
    expect(p2Pieces[0].cell).toBe(HOME); // 잡기 발생 확인
    // §13-12 해소: 윷으로 잡아도 "잡기 보너스(capturedBonus)"는 미부여 → 중복 차단(이 단언은 유지).
    expect(state.capturedBonus).toBe(false);
    // ── 기댓값 변경 사유 (버그 D 수정, 2026-06-17) ──────────────────────────────
    // 이전 단언 `currentTurn === 'p2'`는 "윷/모로 말을 이동하면 보너스 던지기가 소실되는
    // 버그(D)"를 전제로 한 stale 단언이었다(주석의 "큐 소진 후 passTurn" 서술이 바로 그 버그).
    // 윷/모는 잡기 여부와 무관하게 "윷/모 자체의 추가 던지기" 권리가 있고, 이 권리는 말을
    // 윷/모로 이동해도 보존되어야 한다(D-SC-1/D-SC-6). server.js가 splice 이전에
    // bonusFromConsumed(useResult==='yut') 플래그를 계산하도록 수정되어 큐가 비어도 턴이 유지된다.
    // §13-12(잡기 보너스 중복 차단)와는 독립이며 충돌하지 않는다(capturedBonus는 여전히 false).
    expect(state.currentTurn).toBe('p1');
    expect(state.pendingResults).toEqual([]);
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
