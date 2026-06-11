/**
 * @fileoverview YR-C17 시리즈 — FIX-3 centerExitB 중간 칸 24/25 신설 (9개)
 * 룰북 참조: minigames/yutnori/docs/RULEBOOK.md §10-4 (centerExitB), §9-2 (백도), §13-2 (즉시 완주, 2026-06-11 해소)
 *
 * 검증 내용:
 *   - computeNextCell 단위: 23→24→25→GOAL 잔여 steps 소진.
 *   - 24/25에서 출발(centerExitB) / 백도(25→24, 24→23).
 *   - WS 통합: 24 칸 잡기(capturedBonus) / 업기.
 */

import { test, expect } from 'playwright/test';
import { computeNextCell, createApp } from '../server.js';
import { startServer, stopServer, setupGame, inject } from './rulebook-helpers.js';

const GOAL = 99;
const HOME = -1;

// ── §10-4 §13-2 단위: centerExitB 경로 ───────────────────────────

test('YR-C17-001: cell 23 + do(1) + bottom → cell 24 (§10-4 §13-2)', () => {
  // Given: 중앙 23
  // When: bottom + 도(1)
  // Then: 날밭 첫 칸 24
  expect(computeNextCell(23, 1, 'bottom').toCell).toBe(24);
});

test('YR-C17-002: cell 23 + gae(2) + bottom → cell 25 (§10-4 §13-2)', () => {
  // Given: 중앙 23
  // When: bottom + 개(2) — 23→24→25
  // Then: 칸 25
  expect(computeNextCell(23, 2, 'bottom').toCell).toBe(25);
});

test('YR-C17-003: cell 23 + geol(3) + bottom → GOAL (24→25→GOAL) (§10-4 §13-2)', () => {
  // Given: 중앙 23
  // When: bottom + 걸(3) — 23→24→25→GOAL
  // Then: GOAL
  const r = computeNextCell(23, 3, 'bottom');
  expect(r.toCell).toBe(GOAL);
  expect(r.passedStart).toBe(true);
});

test('YR-C17-004: cell 24 + do(1) → cell 25 (centerExitB 진행) (§10-4)', () => {
  // Given: centerExitB 중간 칸 24
  // When: 도(1)
  // Then: 칸 25 (pathContext centerExitB 자동 적용)
  expect(computeNextCell(24, 1).toCell).toBe(25);
});

test('YR-C17-005: cell 25 + do(1) → GOAL (centerExitB 완주) (§10-4)', () => {
  // Given: centerExitB 중간 칸 25
  // When: 도(1)
  // Then: GOAL
  const r = computeNextCell(25, 1);
  expect(r.toCell).toBe(GOAL);
  expect(r.passedStart).toBe(true);
});

// ── §9-2 백도: 25 → 24, 24 → 23 ──────────────────────────────────

test('YR-C17-006: cell 25 + backdo(-1) → cell 24 (백도 복귀) (§9-2)', () => {
  // Given: 칸 25
  // When: 백도(-1)
  // Then: 칸 24
  const r = computeNextCell(25, -1);
  expect(r.toCell).toBe(24);
  expect(r.awaitingBranch).toBe(false);
});

test('YR-C17-007: cell 24 + backdo(-1) → cell 23 (백도 중앙 복귀) (§9-2)', () => {
  // Given: 칸 24
  // When: 백도(-1)
  // Then: 중앙 23
  const r = computeNextCell(24, -1);
  expect(r.toCell).toBe(23);
  expect(r.awaitingBranch).toBe(false);
});

// ── §10-4 WS 통합: 24 칸 잡기 / 업기 ─────────────────────────────

test('YR-C17-008: WS — cell 24에 상대 말, bottom 이동 후 잡기 + capturedBonus (§10-4 §6)', async () => {
  // Given: 23에 P1 말, 24에 P2 말. pendingResults=['do'].
  // When: MOVE_PIECE → BRANCH_REQUEST(center) → CHOOSE_PATH(bottom) → 23→24 도달, 상대 잡기
  // Then: P2 말 HOME 복귀, capturedBonus 발동 → 큐 비어도 P1 턴 유지(보너스 던지기 가능)
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
          { cell: 23, stack: 1, done: false },
          { cell: HOME, stack: 1, done: false },
          { cell: HOME, stack: 1, done: false },
          { cell: HOME, stack: 1, done: false },
        ],
        p2: [
          { cell: 24, stack: 1, done: false },
          { cell: HOME, stack: 1, done: false },
          { cell: HOME, stack: 1, done: false },
          { cell: HOME, stack: 1, done: false },
        ],
      },
    });
    await p1.next('STATE');
    await p2.next('STATE');

    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
    await p1.next('BRANCH_REQUEST');
    await p1.next('STATE');
    p2.drain('BRANCH_REQUEST'); p2.drain('STATE');

    p1.send({ type: 'CHOOSE_PATH', pathChoice: 'bottom' });
    const st = await p1.next('STATE');
    p2.drain('STATE');

    const me = st.players.find((p) => p.id === 'p1');
    const opp = st.players.find((p) => p.id === 'p2');
    expect(me.pieces[0].cell).toBe(24);       // P1 말 24 도달
    expect(opp.pieces[0].cell).toBe(HOME);     // P2 말 잡혀 HOME
    // 잡기 보너스: 큐가 비었어도 P1 턴 유지 (passTurn 안 됨)
    expect(st.currentTurn).toBe('p1');
    expect(st.pendingResults).toEqual([]);
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C17-009: WS — cell 24에 자기 말, bottom 이동 후 업기 (§10-4 §4)', async () => {
  // Given: 23에 P1 말(piece0), 24에 P1 말(piece1). pendingResults=['do'].
  // When: piece0 MOVE → CHOOSE_PATH(bottom) → 24 도달 시 같은 칸 자기 말과 묶임(업기)
  // Then: piece0, piece1 모두 cell 24 (업힘 시각화는 같은 cell 모임으로 표현)
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
          { cell: 23, stack: 1, done: false },
          { cell: 24, stack: 1, done: false },
          { cell: HOME, stack: 1, done: false },
          { cell: HOME, stack: 1, done: false },
        ],
      },
    });
    await p1.next('STATE');
    await p2.next('STATE');

    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
    await p1.next('BRANCH_REQUEST');
    await p1.next('STATE');
    p2.drain('BRANCH_REQUEST'); p2.drain('STATE');

    p1.send({ type: 'CHOOSE_PATH', pathChoice: 'bottom' });
    const st = await p1.next('STATE');
    p2.drain('STATE');

    const me = st.players.find((p) => p.id === 'p1');
    expect(me.pieces[0].cell).toBe(24); // 이동한 말
    expect(me.pieces[1].cell).toBe(24); // 같은 칸 자기 말 — 업힘 묶음
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});
