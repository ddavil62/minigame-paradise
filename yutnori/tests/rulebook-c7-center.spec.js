/**
 * @fileoverview YR-C7 시리즈 — 중앙 분기 (10개)
 * 룰북 참조: minigames/yutnori/docs/RULEBOOK.md §10-3~5 (중앙 출구), §13-2 (centerExitB 즉시 완주), §13-6 (양방향 자유)
 *
 * YR-C7-001~009: computeNextCell 단위 직접 import.
 * YR-C7-010: WS inject + MOVE_PIECE 후 awaitingBranchAt STATE 검증.
 */

import { test, expect } from 'playwright/test';
import { computeNextCell, createApp } from '../server.js';
import { startServer, stopServer, setupGame, inject } from './rulebook-helpers.js';

const GOAL = 99;

// ── §10-3 centerExitA (top) ────────────────────────────────────────

test('YR-C7-001: cell 23 + do(1) + branchChoice=null → awaitingBranch=true (§10-3)', () => {
  // Given: 중앙 23에서 출발 분기 미결정
  // When: branchChoice=null로 호출
  // Then: awaitingBranch=true (분기 선택 요청)
  const r = computeNextCell(23, 1, null);
  expect(r.toCell).toBe(23);
  expect(r.awaitingBranch).toBe(true);
});

test('YR-C7-002: cell 23 + do(1) + top → cell 15 (centerExitA) (§10-3)', () => {
  // Given: 중앙 23
  // When: top 분기 + 도(1)
  // Then: 칸 15 (우하 출구 합류)
  expect(computeNextCell(23, 1, 'top').toCell).toBe(15);
});

test('YR-C7-003: cell 23 + gae(2) + top → cell 16 (§10-3)', () => {
  // Given: 중앙 23
  // When: top + 개(2) — 23→15→16
  // Then: 칸 16
  expect(computeNextCell(23, 2, 'top').toCell).toBe(16);
});

test('YR-C7-004: cell 23 + mo(5) + top → cell 19 (§10-3)', () => {
  // Given: 중앙 23
  // When: top + 모(5) — 23→15→16→17→18→19
  // Then: 칸 19
  expect(computeNextCell(23, 5, 'top').toCell).toBe(19);
});

test('YR-C7-005: cell 23 + 6 + top → GOAL (잔여 통과 완주) (§10-3 §11-3)', () => {
  // Given: 중앙 23
  // When: top + 6칸 — 23→15→16→17→18→19→GOAL
  // Then: GOAL
  const r = computeNextCell(23, 6, 'top');
  expect(r.toCell).toBe(GOAL);
  expect(r.passedStart).toBe(true);
});

// ── §10-4 §13-2 centerExitB (bottom) 즉시 완주 ───────────────────

test('YR-C7-006: cell 23 + do(1) + bottom → GOAL (즉시 완주) (§10-4 §13-2)', () => {
  // Given: 중앙 23
  // When: bottom + 도(1)
  // Then: 남은 steps 무관 즉시 GOAL (정책 PASS: §13-2 단순화)
  const r = computeNextCell(23, 1, 'bottom');
  expect(r.toCell).toBe(GOAL);
  expect(r.passedStart).toBe(true);
});

test('YR-C7-007: cell 23 + mo(5) + bottom → GOAL (steps 무관 즉시 완주) (§10-4 §13-2)', () => {
  // Given: 중앙 23
  // When: bottom + 모(5) — steps=5여도
  // Then: 즉시 GOAL (정책 PASS)
  const r = computeNextCell(23, 5, 'bottom');
  expect(r.toCell).toBe(GOAL);
  expect(r.passedStart).toBe(true);
});

// ── §10-5 §13-6 진입 경로 무관 양방향 자유 ───────────────────────

test('YR-C7-008: 지름길B(10→) 진입 후에도 bottom 출구 선택 가능 (§10-5 §13-6)', () => {
  // Given: cell 10 + geol(3) → 중앙 23 도달 (지름길B 경유)
  // When: 다음 턴 do(1) + bottom 선택
  // Then: bottom centerExitB로 진행 가능 (양방향 자유 정책)
  // 정책 확인: 첫 이동에서 23 도달 후 별도 호출로 bottom 사용 가능한지 검증
  const arrived = computeNextCell(10, 3);
  expect(arrived.toCell).toBe(23);
  const next = computeNextCell(23, 1, 'bottom');
  expect(next.toCell).toBe(GOAL);
});

test('YR-C7-009: 지름길A(5→) 진입 후에도 bottom 출구 선택 가능 (§10-5 §13-6)', () => {
  // Given: cell 5 + geol(3) → 중앙 23 도달 (지름길A 경유)
  // When: 23 + bottom
  // Then: 즉시 GOAL (top/bottom 자유 정책)
  const arrived = computeNextCell(5, 3);
  expect(arrived.toCell).toBe(23);
  const next = computeNextCell(23, 1, 'bottom');
  expect(next.toCell).toBe(GOAL);
});

// ── §10-3 WS 통합: awaitingBranchAt STATE 반영 ───────────────────

test('YR-C7-010: 중앙 도달 후 awaitingBranchAt=pieceIdx STATE 반영 (§10-3)', async () => {
  // Given: cell 22에 P1 말 + pendingResults=['gae']
  // When: MOVE_PIECE → 22→23(잔여) → BRANCH_REQUEST
  // Then: STATE의 awaitingBranchAt === 이동한 pieceIdx
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, {
      started: true,
      currentTurn: 'p1',
      pendingResults: ['gae'],
      pieces: {
        p1: [
          { cell: 22, stack: 1, done: false },
          { cell: -1, stack: 1, done: false },
          { cell: -1, stack: 1, done: false },
          { cell: -1, stack: 1, done: false },
        ],
      },
    });
    await p1.next('STATE');
    await p2.next('STATE');

    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'gae' });
    await p1.next('BRANCH_REQUEST');
    const state = await p1.next('STATE');
    expect(state.awaitingBranchAt).toBe(0);
    expect(state.awaitingBranchResult).toBe('gae');
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});
