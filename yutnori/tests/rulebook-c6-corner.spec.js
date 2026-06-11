/**
 * @fileoverview YR-C6 시리즈 — 모서리 분기 (10개)
 * 룰북 참조: minigames/yutnori/docs/RULEBOOK.md §10-1~3 (모서리 분기), §13-1 (외곽/지름길 선택)
 *
 * 단위 테스트: computeNextCell 직접 import.
 *
 * 갱신 사유 (2026-06-11 FIX-2, §13-1 해소):
 *   기존에는 모서리(5/10)에 멈춘 말이 다음 이동 시 무조건 지름길로 강제 진입했으나,
 *   정통 룰 정합을 위해 "외곽 계속 / 지름길 진입" 분기 선택을 도입했다.
 *   branchChoice 없이 5/10에서 출발하면 awaitingBranch=true를 반환한다.
 *   따라서 본 시리즈의 강제 지름길 기댓값을 분기 대기(또는 명시 선택)로 갱신한다.
 */

import { test, expect } from 'playwright/test';
import { computeNextCell } from '../server.js';

// ── §10-2 §13-1 모서리 분기 대기 (5번 모서리) ────────────────────

test('YR-C6-001: cell 5 + do(1) + branchChoice=null → awaitingBranch=true (§10-2 §13-1)', () => {
  // 갱신 사유: §13-1 해소 — 강제 지름길(toCell 21)에서 분기 대기로 변경.
  // Given: 좌상 모서리 5에 정확히 멈춘 상태
  // When: 다음 턴 도(1), 분기 미선택
  // Then: 외곽/지름길 선택 요청 (awaitingBranch=true, toCell 유지)
  const r = computeNextCell(5, 1, null);
  expect(r.awaitingBranch).toBe(true);
  expect(r.toCell).toBe(5);
});

test('YR-C6-002: cell 5 + gae(2) + shortcut → cell 22 (지름길A) (§10-2 §13-1)', () => {
  // 갱신 사유: §13-1 해소 — 지름길 선택 시 기존 동선(5→21→22) 유지.
  // Given: 모서리 5
  // When: 개(2) + 지름길 선택
  // Then: 칸 22 (5→21→22)
  expect(computeNextCell(5, 2, 'shortcut').toCell).toBe(22);
});

test('YR-C6-003: cell 5 + geol(3) + shortcut → cell 23 (지름길A 중앙 도달) (§10-2 §13-1)', () => {
  // 갱신 사유: §13-1 해소 — 지름길 선택 시 중앙 도달.
  // Given: 모서리 5
  // When: 걸(3) + 지름길 선택
  // Then: 중앙 23 (5→21→22→23)
  expect(computeNextCell(5, 3, 'shortcut').toCell).toBe(23);
});

// ── §10-2 §13-1 모서리 분기 대기 (10번 모서리) ───────────────────

test('YR-C6-004: cell 10 + do(1) + branchChoice=null → awaitingBranch=true (§10-2 §13-1)', () => {
  // 갱신 사유: §13-1 해소 — 강제 지름길(toCell 26)에서 분기 대기로 변경.
  // Given: 우상 모서리 10
  // When: 도(1), 분기 미선택
  // Then: 외곽/지름길 선택 요청 (awaitingBranch=true)
  const r = computeNextCell(10, 1, null);
  expect(r.awaitingBranch).toBe(true);
  expect(r.toCell).toBe(10);
});

test('YR-C6-005: cell 10 + gae(2) + shortcut → cell 27 (§10-2 §13-1)', () => {
  // 갱신 사유: §13-1 해소 — 지름길 선택 시 기존 동선 유지.
  // Given: 모서리 10
  // When: 개(2) + 지름길 선택
  // Then: 칸 27 (10→26→27)
  expect(computeNextCell(10, 2, 'shortcut').toCell).toBe(27);
});

test('YR-C6-006: cell 10 + geol(3) + shortcut → cell 23 (지름길B 중앙 도달) (§10-2 §13-1)', () => {
  // 갱신 사유: §13-1 해소 — 지름길 선택 시 중앙 도달.
  // Given: 모서리 10
  // When: 걸(3) + 지름길 선택
  // Then: 중앙 23 (10→26→27→23)
  expect(computeNextCell(10, 3, 'shortcut').toCell).toBe(23);
});

// ── §10-1 모서리 통과 (멈추지 않음) — 분기 없음 (불변) ────────────

test('YR-C6-007: cell 4 + gae(2) → cell 6 (모서리 5 통과, 외곽 유지) (§10-1)', () => {
  // Given: 칸 4
  // When: 개(2) — 4→5→6 (5에 멈추지 않고 통과)
  // Then: 칸 6 (외곽 유지, 분기 없음 — FIX-2 통과 케이스 불변)
  expect(computeNextCell(4, 2).toCell).toBe(6);
});

test('YR-C6-008: cell 9 + gae(2) → cell 11 (모서리 10 통과, 외곽 유지) (§10-1)', () => {
  // Given: 칸 9
  // When: 개(2) — 9→10→11 (10에 멈추지 않고 통과)
  // Then: 칸 11
  expect(computeNextCell(9, 2).toCell).toBe(11);
});

// ── §10-2 §13-1 모서리 분기 대기 (branchChoice=null이면 step 무관 즉시 대기) ──

test('YR-C6-009: cell 5 + yut(4) + branchChoice=null → awaitingBranch=true (§10-2 §10-3 §13-1)', () => {
  // 갱신 사유: §13-1 해소 — 모서리에서 출발 시 step 무관 즉시 분기 대기.
  // Given: 모서리 5
  // When: 윷(4), 분기 미선택
  // Then: 분기 대기 (awaitingBranch=true, toCell 유지)
  const r = computeNextCell(5, 4, null);
  expect(r.awaitingBranch).toBe(true);
  expect(r.toCell).toBe(5);
});

test('YR-C6-010: cell 10 + yut(4) + branchChoice=null → awaitingBranch=true (§10-2 §10-3 §13-1)', () => {
  // 갱신 사유: §13-1 해소 — 모서리에서 출발 시 step 무관 즉시 분기 대기.
  // Given: 모서리 10
  // When: 윷(4), 분기 미선택
  // Then: 분기 대기 (awaitingBranch=true)
  const r = computeNextCell(10, 4, null);
  expect(r.awaitingBranch).toBe(true);
  expect(r.toCell).toBe(10);
});
