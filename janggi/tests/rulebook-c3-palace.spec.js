/**
 * @fileoverview JR-C3 시리즈 — 궁성 대각선/제한 (10개)
 * 룰북 참조: minigames/janggi/docs/RULEBOOK.md §2, §5-1~§5-4, §5-7
 *
 * 궁성: 한(file 3..5, rank 0..2) / 초(file 3..5, rank 7..9)
 * 그려진 대각선 칸 5개: 꼭짓점 4 + 중앙 1
 */

import { test, expect } from '@playwright/test';
import {
  piece, buildBoard,
  getLegalMoves, isPalaceDiagonal,
} from './helpers.js';

function withKings(extras) {
  return buildBoard([
    { file: 4, rank: 1, type: 'king', side: 'han' },
    { file: 4, rank: 8, type: 'king', side: 'cho' },
    ...extras,
  ]);
}

test.describe('JR-C3: 궁성 대각선/제한 (§2, §5-1~§5-4, §5-7)', () => {

  // ── §2: isPalaceDiagonal 분류 ─────────────────────────────────

  test('JR-C3-001: 한 궁성 대각선 5칸 모두 true (§2-2)', () => {
    // Given/When/Then
    const han5 = [[3, 0], [5, 0], [4, 1], [3, 2], [5, 2]];
    for (const [f, r] of han5) {
      expect(isPalaceDiagonal(f, r)).toBe(true);
    }
  });

  test('JR-C3-002: 초 궁성 대각선 5칸 모두 true (§2-2)', () => {
    const cho5 = [[3, 7], [5, 7], [4, 8], [3, 9], [5, 9]];
    for (const [f, r] of cho5) {
      expect(isPalaceDiagonal(f, r)).toBe(true);
    }
  });

  test('JR-C3-003: 궁성 변 중앙 4칸은 대각선 아님 (§2-2)', () => {
    // 한 궁성 변 중앙
    const sides = [[4, 0], [3, 1], [5, 1], [4, 2]];
    for (const [f, r] of sides) {
      expect(isPalaceDiagonal(f, r)).toBe(false);
    }
    // 초 궁성 변 중앙
    const sidesCho = [[4, 7], [3, 8], [5, 8], [4, 9]];
    for (const [f, r] of sidesCho) {
      expect(isPalaceDiagonal(f, r)).toBe(false);
    }
  });

  // ── §5-3 차 궁성 대각 ────────────────────────────────────────

  test('JR-C3-004: 차 한 궁성 중앙(4,1)에서 4 꼭짓점 모두 이동 가능 (§5-3)', () => {
    // Given: 한 차(4,1), 한 궁은 다른 위치
    const board = buildBoard([
      { file: 4, rank: 1, type: 'chariot', side: 'han' },
      { file: 3, rank: 1, type: 'king', side: 'han' },
      { file: 4, rank: 8, type: 'king', side: 'cho' },
    ]);
    // When
    const moves = getLegalMoves(board, 4, 1);
    // Then: (3,0)(5,0)(3,2)(5,2) 4 꼭짓점 모두 포함
    expect(moves).toContainEqual({ file: 3, rank: 0 });
    expect(moves).toContainEqual({ file: 5, rank: 0 });
    expect(moves).toContainEqual({ file: 3, rank: 2 });
    expect(moves).toContainEqual({ file: 5, rank: 2 });
  });

  test('JR-C3-005: 차 꼭짓점(3,0)에서 중앙 빈 칸 → 반대편 꼭짓점(5,2) 관통 (§5-3)', () => {
    // Given: 한 차(3,0), 중앙(4,1) 비어있음
    const board = buildBoard([
      { file: 3, rank: 0, type: 'chariot', side: 'han' },
      { file: 5, rank: 1, type: 'king', side: 'han' },
      { file: 4, rank: 8, type: 'king', side: 'cho' },
    ]);
    // When
    const moves = getLegalMoves(board, 3, 0);
    // Then: (4,1)(5,2) 모두 포함
    expect(moves).toContainEqual({ file: 4, rank: 1 });
    expect(moves).toContainEqual({ file: 5, rank: 2 });
  });

  test('JR-C3-006: 차 꼭짓점에서 중앙에 적 → 잡기만, 반대편 불가 (§5-3)', () => {
    // Given: 한 차(3,0), 중앙(4,1)에 적 포
    const board = buildBoard([
      { file: 3, rank: 0, type: 'chariot', side: 'han' },
      { file: 4, rank: 1, type: 'cannon', side: 'cho' },
      { file: 3, rank: 1, type: 'king', side: 'han' },
      { file: 4, rank: 8, type: 'king', side: 'cho' },
    ]);
    // When
    const moves = getLegalMoves(board, 3, 0);
    // Then: (4,1) 포함 (적 잡기), (5,2) 미포함 (관통 불가)
    expect(moves).toContainEqual({ file: 4, rank: 1 });
    expect(moves).not.toContainEqual({ file: 5, rank: 2 });
  });

  // ── §5-4 포 궁성 대각 ────────────────────────────────────────

  test('JR-C3-007: 포 꼭짓점(3,0)에서 중앙(4,1) 비-포 다리로 (5,2) 대각 이동 (§5-4)', () => {
    // Given: 한 포(3,0), (4,1)에 비-포 기물(아군 사), (5,2)공백
    const board = buildBoard([
      { file: 3, rank: 0, type: 'cannon', side: 'han' },
      { file: 4, rank: 1, type: 'advisor', side: 'han' },
      { file: 3, rank: 1, type: 'king', side: 'han' },
      { file: 4, rank: 8, type: 'king', side: 'cho' },
    ]);
    // When
    const moves = getLegalMoves(board, 3, 0);
    // Then: (5,2) 포함
    expect(moves).toContainEqual({ file: 5, rank: 2 });
  });

  test('JR-C3-008: 포 궁성 중앙(4,1)에서 대각 이동 불가 (§5-4, §13-3)', () => {
    // Given: 한 포(4,1) 중앙
    const board = buildBoard([
      { file: 4, rank: 1, type: 'cannon', side: 'han' },
      { file: 3, rank: 1, type: 'king', side: 'han' },
      { file: 4, rank: 8, type: 'king', side: 'cho' },
    ]);
    // When
    const moves = getLegalMoves(board, 4, 1);
    // Then: 대각 방향 꼭짓점(3,0)(5,0)(3,2)(5,2) 모두 미포함
    expect(moves).not.toContainEqual({ file: 3, rank: 0 });
    expect(moves).not.toContainEqual({ file: 5, rank: 0 });
    expect(moves).not.toContainEqual({ file: 3, rank: 2 });
    expect(moves).not.toContainEqual({ file: 5, rank: 2 });
  });

  // ── §5-7 졸 궁성 대각 ────────────────────────────────────────

  test('JR-C3-009: 한 졸 초 궁성 꼭짓점(3,7)에서 대각 앞(4,8) 이동 가능 (§5-7)', () => {
    // Given: 한 졸(3,7) — 초 궁성 꼭짓점, 대각 앞 (4,8)은 isPalaceDiagonal=true
    const board = buildBoard([
      { file: 3, rank: 7, type: 'soldier', side: 'han' },
      { file: 4, rank: 1, type: 'king', side: 'han' },
      { file: 4, rank: 8, type: 'king', side: 'cho' },
    ]);
    // When
    const moves = getLegalMoves(board, 3, 7);
    // Then: (4,8) 포함 (적 궁 잡기)
    expect(moves).toContainEqual({ file: 4, rank: 8 });
  });

  // ── §5-1 궁 꼭짓점-꼭짓점 직접 이동 불가 ──────────────────────

  test('JR-C3-010: 궁 꼭짓점(3,0)에서 꼭짓점(5,0) 직접 이동 불가 (§5-1)', () => {
    // Given: 한 궁(3,0), 한 궁성 내 다른 칸 모두 공백
    const board = buildBoard([
      { file: 3, rank: 0, type: 'king', side: 'han' },
      { file: 4, rank: 8, type: 'king', side: 'cho' },
    ]);
    // When
    const moves = getLegalMoves(board, 3, 0);
    // Then: (5,0) 미포함 (꼭짓점 직접 이동 불가, 중앙 경유만)
    expect(moves).not.toContainEqual({ file: 5, rank: 0 });
    // (3,2) 직접 이동도 불가 (대각선이지만 PALACE_DIAG_ADJ는 꼭짓점-중앙만)
    expect(moves).not.toContainEqual({ file: 3, rank: 2 });
  });

});
