/**
 * @fileoverview YR-C2 시리즈 — 이동 칸 수 (15개)
 * 룰북 참조: minigames/yutnori/docs/RULEBOOK.md §5 (이동 규칙), §13-10 (HOME → 칸 N 정통 매핑)
 *
 * 단위 테스트: computeNextCell을 직접 import.
 * §13-10 해소(2026-05-31) 이후 정통 룰 매핑(HOME + do = 칸 1) 회귀 가드 포함.
 */

import { test, expect } from 'playwright/test';
import { computeNextCell } from '../server.js';

const HOME = -1;
const GOAL = 99;

// ── §13-10 해소: HOME → 칸 N 정통 매핑 ──────────────────────────────

test('YR-C2-001: HOME + do(1) → 칸 1 (§4-3 §13-10 정통 매핑)', () => {
  // Given: 출발 전 말 (HOME=-1)
  // When: 도(1칸) 결과로 이동
  // Then: 칸 1 도달 (정통 룰: HOME → 칸 N)
  const r = computeNextCell(HOME, 1);
  expect(r.toCell).toBe(1);
  expect(r.awaitingBranch).toBe(false);
});

test('YR-C2-002: HOME + gae(2) → 칸 2 (§4-3 §13-10)', () => {
  // Given: HOME에 있는 말
  // When: 개(2칸) 이동
  // Then: 칸 2 도달
  expect(computeNextCell(HOME, 2).toCell).toBe(2);
});

test('YR-C2-003: HOME + geol(3) → 칸 3 (§4-3 §13-10)', () => {
  // Given: HOME에 있는 말
  // When: 걸(3칸) 이동
  // Then: 칸 3 도달
  expect(computeNextCell(HOME, 3).toCell).toBe(3);
});

test('YR-C2-004: HOME + yut(4) → 칸 4 (§4-3 §13-10)', () => {
  // Given: HOME에 있는 말
  // When: 윷(4칸) 이동
  // Then: 칸 4 도달
  expect(computeNextCell(HOME, 4).toCell).toBe(4);
});

test('YR-C2-005: HOME + mo(5) → 칸 5 (§4-3 §13-10)', () => {
  // Given: HOME에 있는 말
  // When: 모(5칸) 이동
  // Then: 칸 5 도달 (좌상 모서리)
  expect(computeNextCell(HOME, 5).toCell).toBe(5);
});

// ── §5-2 보드 위 이동 ──────────────────────────────────────────────

test('YR-C2-006: cell 0 + do(1) → 칸 1 (보드 위 진행) (§5-2)', () => {
  // Given: 출발선(칸 0) 위 말
  // When: 도(1칸) 이동
  // Then: 칸 1
  expect(computeNextCell(0, 1).toCell).toBe(1);
});

test('YR-C2-007: cell 3 + do(1) → 칸 4 (§5-2)', () => {
  // Given: 외곽 좌측 변 칸 3
  // When: 도 이동
  // Then: 칸 4
  expect(computeNextCell(3, 1).toCell).toBe(4);
});

test('YR-C2-008: cell 3 + gae(2) → 칸 5 (좌상 모서리 도달) (§5-2 §10)', () => {
  // Given: 칸 3
  // When: 개(2칸) 이동
  // Then: 칸 5 도달 (다음 이동부터 지름길A 자동 진입 — §10-2 §13-1)
  expect(computeNextCell(3, 2).toCell).toBe(5);
});

test('YR-C2-009: cell 3 + geol(3) → 칸 6 (모서리 5 통과) (§5-2 §10-1)', () => {
  // Given: 칸 3
  // When: 걸(3칸) 이동
  // Then: 칸 6 (5는 통과만)
  expect(computeNextCell(3, 3).toCell).toBe(6);
});

test('YR-C2-010: cell 3 + yut(4) → 칸 7 (§5-2)', () => {
  // Given: 칸 3
  // When: 윷(4칸) 이동
  // Then: 칸 7
  expect(computeNextCell(3, 4).toCell).toBe(7);
});

test('YR-C2-011: cell 3 + mo(5) → 칸 8 (§5-2)', () => {
  // Given: 칸 3
  // When: 모(5칸) 이동
  // Then: 칸 8
  expect(computeNextCell(3, 5).toCell).toBe(8);
});

// ── §13-8 미사용 인덱스 (20/24/25/28) ──────────────────────────────

test('YR-C2-012: 인덱스 20은 어떤 외곽 이동에서도 반환되지 않음 (§2-2 §13-8)', () => {
  // Given: 외곽 칸 0~19 진행은 칸 0~19 사이로만
  // When: 18+do, 19+do, 19+gae 등 외곽 진행
  // Then: 모두 19/GOAL이며 20 미반환
  expect(computeNextCell(18, 1).toCell).toBe(19);
  expect(computeNextCell(19, 1).toCell).toBe(GOAL);
  expect(computeNextCell(19, 2).toCell).toBe(GOAL);
});

test('YR-C2-013: 인덱스 28은 어떤 이동에서도 반환되지 않음 (§2-2 §13-8)', () => {
  // 갱신 사유: §13-2 해소(FIX-3) — 24/25가 centerExitB 중간 칸으로 활성화됨.
  //            forbidden에서 24/25 제거(28만 미사용). 모서리 샘플은 shortcut 명시로 갱신(FIX-2).
  // Given: 28은 표준 인덱스 매핑에서 미사용
  // When: 외곽/지름길/중앙 출구(top) 다양한 이동 (centerExitB는 별도 시리즈에서 검증)
  // Then: 결과 인덱스가 28에 속하지 않음
  const forbidden = new Set([28]);
  const samples = [
    computeNextCell(HOME, 5),
    computeNextCell(5, 1, 'shortcut'),
    computeNextCell(5, 2, 'shortcut'),
    computeNextCell(10, 1, 'shortcut'),
    computeNextCell(10, 2, 'shortcut'),
    computeNextCell(22, 1),
    computeNextCell(27, 1),
    computeNextCell(23, 1, 'top'),
    computeNextCell(23, 2, 'top'),
    computeNextCell(23, 3, 'top'),
    computeNextCell(23, 4, 'top'),
    computeNextCell(23, 5, 'top'),
    computeNextCell(15, 1),
    computeNextCell(15, 5),
  ];
  for (const r of samples) {
    expect(forbidden.has(r.toCell)).toBe(false);
  }
});

// ── §4-4 §11-3 완주 ────────────────────────────────────────────────

test('YR-C2-014: cell 19 + do(1) → GOAL (외곽 완주) (§4-4 §5-2)', () => {
  // Given: 외곽 마지막 칸 19
  // When: 도 이동
  // Then: GOAL (passedStart=true)
  const r = computeNextCell(19, 1);
  expect(r.toCell).toBe(GOAL);
  expect(r.passedStart).toBe(true);
});

test('YR-C2-015: cell 16 + mo(5) → GOAL (통과 완주) (§4-4 §11-3)', () => {
  // Given: 칸 16에서 5칸 이동 시 19를 넘어가는 통과 완주
  // When: 모(5칸) 이동
  // Then: GOAL
  const r = computeNextCell(16, 5);
  expect(r.toCell).toBe(GOAL);
  expect(r.passedStart).toBe(true);
});
