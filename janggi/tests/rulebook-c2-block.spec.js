/**
 * @fileoverview JR-C2 시리즈 — 멱/포다리 차단 (10개)
 * 룰북 참조: minigames/janggi/docs/RULEBOOK.md §8-1, §8-2
 *
 * §8-1 멱: 마/상의 직선 1칸 경유 칸에 기물(아군/적군 불문) 있으면 차단.
 * §8-2 포다리: 다리 1개 필수, 다리가 포면 불가, 포로 포 잡기 불가.
 */

import { test, expect } from '@playwright/test';
import {
  piece, buildBoard,
  getLegalMoves,
} from './helpers.js';

// 자살수 영향 배제용 양 궁 배치
function withKings(extras) {
  return buildBoard([
    { file: 4, rank: 1, type: 'king', side: 'han' },
    { file: 4, rank: 8, type: 'king', side: 'cho' },
    ...extras,
  ]);
}

test.describe('JR-C2: 멱/포다리 차단 (§8-1, §8-2)', () => {

  // ── §8-1 멱 (마/상 차단) ─────────────────────────────────────

  test('JR-C2-001: 마 직선 경유 칸 아군 멱 → 그 방향 2칸 불가 (§8-1)', () => {
    // Given: 한 마(4,4), 위 경유 칸 (4,3)에 아군 졸
    const board = withKings([
      { file: 4, rank: 4, type: 'horse', side: 'han' },
      { file: 4, rank: 3, type: 'soldier', side: 'han' },
    ]);
    // When
    const moves = getLegalMoves(board, 4, 4);
    // Then: 위 방향 도착지 (3,2)(5,2) 미포함
    expect(moves).not.toContainEqual({ file: 3, rank: 2 });
    expect(moves).not.toContainEqual({ file: 5, rank: 2 });
  });

  test('JR-C2-002: 마 직선 경유 칸 적군 멱 → 그 방향 불가 (§8-1, 진영 불문)', () => {
    // Given: 한 마(4,4), 위 경유 칸 (4,3)에 적군 졸
    const board = withKings([
      { file: 4, rank: 4, type: 'horse', side: 'han' },
      { file: 4, rank: 3, type: 'soldier', side: 'cho' },
    ]);
    // When
    const moves = getLegalMoves(board, 4, 4);
    // Then: 멱은 진영 불문 — (3,2)(5,2) 모두 미포함
    expect(moves).not.toContainEqual({ file: 3, rank: 2 });
    expect(moves).not.toContainEqual({ file: 5, rank: 2 });
  });

  test('JR-C2-003: 마 4방향 모두 멱 → 합법 수 0개 (§8-1)', () => {
    // Given: 한 마(4,5), 상하좌우 모두 기물
    const board = withKings([
      { file: 4, rank: 5, type: 'horse', side: 'han' },
      { file: 4, rank: 4, type: 'soldier', side: 'han' },
      { file: 4, rank: 6, type: 'soldier', side: 'han' },
      { file: 3, rank: 5, type: 'soldier', side: 'han' },
      { file: 5, rank: 5, type: 'soldier', side: 'han' },
    ]);
    // When
    const moves = getLegalMoves(board, 4, 5);
    // Then: 길이 0 (모든 방향 멱)
    expect(moves.length).toBe(0);
  });

  test('JR-C2-004: 상 첫 번째 멱 (직선 1칸) → 위 방향 도착지 모두 불가 (§8-1)', () => {
    // Given: 한 상(4,5), 위 직선 (4,4)에 기물
    const board = withKings([
      { file: 4, rank: 5, type: 'elephant', side: 'han' },
      { file: 4, rank: 4, type: 'soldier', side: 'han' },
    ]);
    // When
    const moves = getLegalMoves(board, 4, 5);
    // Then: 위 방향 도착지 (2,2)(6,2)는 없음. 변위가 dr=-3인 모든 후보 제외
    const upArrivals = moves.filter(m => m.rank - 5 === -3);
    expect(upArrivals.length).toBe(0);
  });

  test('JR-C2-005: 상 두 번째 멱 (대각 1칸) → 좌상 방향 도착지 불가 (§8-1)', () => {
    // Given: 한 상(4,5), (4,4)비어있음(첫 멱 통과), (3,3)에 기물(두 번째 멱)
    // pieces.js 상 패턴: 위(4,4) → 좌상 대각(3,3) → 좌상 대각(2,2). 두 번째 멱이 (3,3)
    const board = withKings([
      { file: 4, rank: 5, type: 'elephant', side: 'han' },
      { file: 3, rank: 3, type: 'soldier', side: 'han' },
    ]);
    // When
    const moves = getLegalMoves(board, 4, 5);
    // Then: 좌상-상 도착지 (2,2) 미포함
    expect(moves).not.toContainEqual({ file: 2, rank: 2 });
    // 우상-상 도착지 (6,2)는 (5,4)가 비어있으므로 가능
    expect(moves).toContainEqual({ file: 6, rank: 2 });
  });

  // ── §8-2 포다리 차단 ────────────────────────────────────────

  test('JR-C2-006: 포 다리 없으면 직선 이동 0개 (§8-2)', () => {
    // Given: 한 포(0,5), 같은 가로/세로 모두 공백
    const board = withKings([
      { file: 0, rank: 5, type: 'cannon', side: 'han' },
    ]);
    // When
    const moves = getLegalMoves(board, 0, 5);
    // Then: 다리 없으므로 직선 이동 0개
    expect(moves.length).toBe(0);
  });

  test('JR-C2-007: 포 다리가 포(아군)이면 그 방향 이동 불가 (§8-2)', () => {
    // Given: 한 포(0,5), (3,5)에 아군 포
    const board = withKings([
      { file: 0, rank: 5, type: 'cannon', side: 'han' },
      { file: 3, rank: 5, type: 'cannon', side: 'han' },
    ]);
    // When
    const moves = getLegalMoves(board, 0, 5);
    // Then: (3,5) 방향 이동 0개 (다리가 포라서 못 넘음)
    const rightArrivals = moves.filter(m => m.rank === 5 && m.file > 0);
    expect(rightArrivals.length).toBe(0);
  });

  test('JR-C2-008: 포 다리가 적 포이면 그 방향 이동 불가 (§8-2)', () => {
    // Given: 한 포(0,5), (3,5)에 적 포
    const board = withKings([
      { file: 0, rank: 5, type: 'cannon', side: 'han' },
      { file: 3, rank: 5, type: 'cannon', side: 'cho' },
    ]);
    // When
    const moves = getLegalMoves(board, 0, 5);
    // Then: 진영 불문 다리가 포면 못 넘음
    const rightArrivals = moves.filter(m => m.rank === 5 && m.file > 0);
    expect(rightArrivals.length).toBe(0);
  });

  test('JR-C2-009: 포로 적 포를 잡을 수 없음 (§8-2)', () => {
    // Given: 한 포(0,5), (3,5)비-포 다리(마), (6,5)에 적 포
    const board = withKings([
      { file: 0, rank: 5, type: 'cannon', side: 'han' },
      { file: 3, rank: 5, type: 'horse', side: 'han' },
      { file: 6, rank: 5, type: 'cannon', side: 'cho' },
    ]);
    // When
    const moves = getLegalMoves(board, 0, 5);
    // Then: (6,5) 미포함 (포로 포 잡기 불가)
    expect(moves).not.toContainEqual({ file: 6, rank: 5 });
    // (4,5)(5,5)는 빈 칸이므로 포함
    expect(moves).toContainEqual({ file: 4, rank: 5 });
    expect(moves).toContainEqual({ file: 5, rank: 5 });
  });

  test('JR-C2-010: 포 다리 2개 — 첫 다리 너머~두 번째 다리(포함)까지만 (§8-2)', () => {
    // Given: 한 포(0,5), (2,5)다리1(마), (5,5)다리2(적 마)
    const board = withKings([
      { file: 0, rank: 5, type: 'cannon', side: 'han' },
      { file: 2, rank: 5, type: 'horse', side: 'han' },
      { file: 5, rank: 5, type: 'horse', side: 'cho' },
    ]);
    // When
    const moves = getLegalMoves(board, 0, 5);
    // Then: 다리(2,5) 너머 (3,5)(4,5)(5,5) 포함, (5,5)에서 적 잡고 정지
    expect(moves).toContainEqual({ file: 3, rank: 5 });
    expect(moves).toContainEqual({ file: 4, rank: 5 });
    expect(moves).toContainEqual({ file: 5, rank: 5 });
    expect(moves).not.toContainEqual({ file: 6, rank: 5 });
    expect(moves).not.toContainEqual({ file: 1, rank: 5 });
    expect(moves).not.toContainEqual({ file: 2, rank: 5 });
  });

});
