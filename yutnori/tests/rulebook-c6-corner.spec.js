/**
 * @fileoverview YR-C6 시리즈 — 모서리 분기 (10개)
 * 룰북 참조: minigames/yutnori/docs/RULEBOOK.md §10-1~3 (모서리 분기), §13-1 (강제 지름길)
 *
 * 단위 테스트: computeNextCell 직접 import.
 * §13-1 정책 PASS — 현재 구현이 모서리(5, 10)에서 강제 지름길로 동작하는 것을 확인한다.
 */

import { test, expect } from 'playwright/test';
import { computeNextCell } from '../server.js';

// ── §10-2 §13-1 강제 지름길 진입 (5번 모서리) ────────────────────

test('YR-C6-001: cell 5 + do(1) → cell 21 (지름길A 강제 진입) (§10-2 §13-1)', () => {
  // Given: 좌상 모서리 5에 정확히 멈춘 상태
  // When: 다음 턴 도(1)
  // Then: 지름길A로 강제 진입 → 칸 21 (정통 룰은 선택지지만 본 구현은 강제)
  expect(computeNextCell(5, 1).toCell).toBe(21);
});

test('YR-C6-002: cell 5 + gae(2) → cell 22 (지름길A) (§10-2 §13-1)', () => {
  // Given: 모서리 5
  // When: 개(2)
  // Then: 칸 22 (5→21→22)
  expect(computeNextCell(5, 2).toCell).toBe(22);
});

test('YR-C6-003: cell 5 + geol(3) → cell 23 (지름길A 중앙 도달) (§10-2 §13-1)', () => {
  // Given: 모서리 5
  // When: 걸(3)
  // Then: 중앙 23 (5→21→22→23)
  expect(computeNextCell(5, 3).toCell).toBe(23);
});

// ── §10-2 §13-1 강제 지름길 진입 (10번 모서리) ───────────────────

test('YR-C6-004: cell 10 + do(1) → cell 26 (지름길B 강제 진입) (§10-2 §13-1)', () => {
  // Given: 우상 모서리 10
  // When: 도(1)
  // Then: 지름길B → 칸 26
  expect(computeNextCell(10, 1).toCell).toBe(26);
});

test('YR-C6-005: cell 10 + gae(2) → cell 27 (§10-2 §13-1)', () => {
  // Given: 모서리 10
  // When: 개(2)
  // Then: 칸 27 (10→26→27)
  expect(computeNextCell(10, 2).toCell).toBe(27);
});

test('YR-C6-006: cell 10 + geol(3) → cell 23 (지름길B 중앙 도달) (§10-2 §13-1)', () => {
  // Given: 모서리 10
  // When: 걸(3)
  // Then: 중앙 23 (10→26→27→23)
  expect(computeNextCell(10, 3).toCell).toBe(23);
});

// ── §10-1 모서리 통과 (멈추지 않음) ──────────────────────────────

test('YR-C6-007: cell 4 + gae(2) → cell 6 (모서리 5 통과, 외곽 유지) (§10-1)', () => {
  // Given: 칸 4
  // When: 개(2) — 4→5→6 (5에 멈추지 않고 통과)
  // Then: 칸 6 (외곽 유지, 지름길 진입 없음)
  expect(computeNextCell(4, 2).toCell).toBe(6);
});

test('YR-C6-008: cell 9 + gae(2) → cell 11 (모서리 10 통과, 외곽 유지) (§10-1)', () => {
  // Given: 칸 9
  // When: 개(2) — 9→10→11 (10에 멈추지 않고 통과)
  // Then: 칸 11
  expect(computeNextCell(9, 2).toCell).toBe(11);
});

// ── §10-2 §13-1 모서리 + 윷(4) ───────────────────────────────────

test('YR-C6-009: cell 5 + yut(4) → 중앙 통과 awaitingBranch=true (§10-2 §10-3 §13-1)', () => {
  // Given: 모서리 5
  // When: 윷(4) — 5→21→22→23(중앙, 잔여 1) → 분기 대기
  // Then: 중앙 도달 후 awaitingBranch=true
  const r = computeNextCell(5, 4);
  expect(r.toCell).toBe(23);
  expect(r.awaitingBranch).toBe(true);
});

test('YR-C6-010: cell 10 + yut(4) → 중앙 통과 awaitingBranch=true (§10-2 §10-3 §13-1)', () => {
  // Given: 모서리 10
  // When: 윷(4) — 10→26→27→23(중앙, 잔여 1) → 분기 대기
  // Then: 중앙 도달 후 awaitingBranch=true
  const r = computeNextCell(10, 4);
  expect(r.toCell).toBe(23);
  expect(r.awaitingBranch).toBe(true);
});
