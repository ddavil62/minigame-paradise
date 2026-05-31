/**
 * @fileoverview JR-C1 시리즈 — 기물별 합법 이동 (25개)
 * 룰북 참조: minigames/janggi/docs/RULEBOOK.md §5-1 ~ §5-7
 *
 * 각 test() 안에 룰북 §번호 인용 + Given/When/Then 주석.
 * 모든 케이스는 lib 직접 호출(단위) 방식이며 서버 미기동.
 */

import { test, expect } from '@playwright/test';
import {
  piece, buildBoard, getFilteredMoves,
  getLegalMoves, inBounds,
} from './helpers.js';

// ── 공통 헬퍼: 양측 궁만 모서리에 둔 후 검사 대상 기물 추가 ───────
// 자살수 필터에 영향 없도록 양 궁이 서로 시야에 들어오지 않게 배치한다.
function withKings(extras) {
  return buildBoard([
    { file: 4, rank: 1, type: 'king', side: 'han' },
    { file: 4, rank: 8, type: 'king', side: 'cho' },
    ...extras,
  ]);
}

// ══════════════════════════════════════════════════════════════════
// §5-1 궁(King) — JR-C1-001 ~ 004
// ══════════════════════════════════════════════════════════════════

test.describe('JR-C1: 기물 합법 이동 (§5-1 ~ §5-7)', () => {

  test('JR-C1-001: 궁 중앙(4,1)에서 합법 수 정확 8개 (직선4 + 대각4) (§5-1)', () => {
    // Given: 한 궁이 한 궁성 중앙(4,1)에 있고 주변 8칸 모두 공백
    const board = buildBoard([
      { file: 4, rank: 1, type: 'king', side: 'han' },
      { file: 4, rank: 8, type: 'king', side: 'cho' },
    ]);
    // When: getLegalMoves(4,1)
    const moves = getLegalMoves(board, 4, 1);
    // Then: 정확히 8개 (직선 4: (3,1)(5,1)(4,0)(4,2) + 대각 4: (3,0)(5,0)(3,2)(5,2))
    //   — 정밀도 강화: set 비교로 의도 외 후보가 포함되지 않음을 보장
    const expected = [
      { file: 3, rank: 1 }, { file: 5, rank: 1 },
      { file: 4, rank: 0 }, { file: 4, rank: 2 },
      { file: 3, rank: 0 }, { file: 5, rank: 0 },
      { file: 3, rank: 2 }, { file: 5, rank: 2 },
    ];
    expect(moves.length).toBe(expected.length);
    const movesSet = new Set(moves.map(m => `${m.file},${m.rank}`));
    const expectedSet = new Set(expected.map(m => `${m.file},${m.rank}`));
    expect(movesSet).toEqual(expectedSet);
  });

  test('JR-C1-002: 궁 중앙에서 대각 4방향 꼭짓점 이동 — 대각 후보 정확 4개 (§5-1)', () => {
    // Given: 한 궁(4,1) 중앙 — 대각선 칸이므로 4 꼭짓점 모두 이동 가능
    const board = buildBoard([
      { file: 4, rank: 1, type: 'king', side: 'han' },
      { file: 4, rank: 8, type: 'king', side: 'cho' },
    ]);
    // When
    const moves = getLegalMoves(board, 4, 1);
    // Then: 대각 4 꼭짓점만 추출하여 정확히 4개 + 명시된 위치 일치
    //   — 정밀도 강화: 대각 후보가 추가/누락되지 않음을 보장
    const diagonals = moves.filter(m =>
      Math.abs(m.file - 4) === 1 && Math.abs(m.rank - 1) === 1
    );
    const expectedDiagonals = [
      { file: 3, rank: 0 }, { file: 5, rank: 0 },
      { file: 3, rank: 2 }, { file: 5, rank: 2 },
    ];
    expect(diagonals.length).toBe(expectedDiagonals.length);
    const diagSet = new Set(diagonals.map(m => `${m.file},${m.rank}`));
    const expectedSet = new Set(expectedDiagonals.map(m => `${m.file},${m.rank}`));
    expect(diagSet).toEqual(expectedSet);
  });

  test('JR-C1-003: 궁 꼭짓점(3,0)에서 중앙(4,1)으로 대각 이동 (§5-1)', () => {
    // Given: 한 궁이 꼭짓점(3,0)에 있음
    const board = buildBoard([
      { file: 3, rank: 0, type: 'king', side: 'han' },
      { file: 4, rank: 8, type: 'king', side: 'cho' },
    ]);
    // When
    const moves = getLegalMoves(board, 3, 0);
    // Then: (4,1) 포함 (꼭짓점-중앙 대각 가능)
    expect(moves).toContainEqual({ file: 4, rank: 1 });
  });

  test('JR-C1-004: 궁 꼭짓점(3,2)에서 궁성 외(rank>=3) 이동 불가 (§5-1)', () => {
    // Given: 한 궁이 (3,2)에 있음
    const board = buildBoard([
      { file: 3, rank: 2, type: 'king', side: 'han' },
      { file: 4, rank: 8, type: 'king', side: 'cho' },
    ]);
    // When
    const moves = getLegalMoves(board, 3, 2);
    // Then: 모든 이동의 rank는 0..2 사이, file은 3..5 사이
    for (const m of moves) {
      expect(m.rank).toBeLessThanOrEqual(2);
      expect(m.rank).toBeGreaterThanOrEqual(0);
      expect(m.file).toBeGreaterThanOrEqual(3);
      expect(m.file).toBeLessThanOrEqual(5);
    }
  });

  // ── §5-2 사(Advisor) ───────────────────────────────────────────

  test('JR-C1-005: 사 꼭짓점(3,0)에서 직선+대각 이동 (§5-2)', () => {
    // Given: 한 사가 (3,0) 꼭짓점
    const board = buildBoard([
      { file: 3, rank: 0, type: 'advisor', side: 'han' },
      { file: 4, rank: 1, type: 'king', side: 'han' },
      { file: 4, rank: 8, type: 'king', side: 'cho' },
    ]);
    // When
    const moves = getLegalMoves(board, 3, 0);
    // Then: (3,1) 직선 + (4,0) 직선 + (4,1)은 아군 궁 → 포함 X
    expect(moves).toContainEqual({ file: 3, rank: 1 });
    expect(moves).toContainEqual({ file: 4, rank: 0 });
    // 중앙(4,1)에는 아군 궁 → 아군 점유로 불가
    expect(moves).not.toContainEqual({ file: 4, rank: 1 });
  });

  test('JR-C1-006: 사 궁성 외 칸 이동 불가 (§5-2)', () => {
    // Given: 한 사가 (5,0) 꼭짓점
    const board = buildBoard([
      { file: 5, rank: 0, type: 'advisor', side: 'han' },
      { file: 4, rank: 1, type: 'king', side: 'han' },
      { file: 4, rank: 8, type: 'king', side: 'cho' },
    ]);
    // When
    const moves = getLegalMoves(board, 5, 0);
    // Then: 모든 이동이 한 궁성 (file 3..5, rank 0..2) 내부
    for (const m of moves) {
      expect(m.file).toBeGreaterThanOrEqual(3);
      expect(m.file).toBeLessThanOrEqual(5);
      expect(m.rank).toBeGreaterThanOrEqual(0);
      expect(m.rank).toBeLessThanOrEqual(2);
    }
  });

  // ── §5-3 차(Chariot) ───────────────────────────────────────────

  test('JR-C1-007: 차 직선 임의 거리 이동 (§5-3)', () => {
    // Given: 차가 (4,5), 같은 가로/세로 모두 비어있음
    const board = withKings([
      { file: 4, rank: 5, type: 'chariot', side: 'han' },
    ]);
    // When
    const moves = getLegalMoves(board, 4, 5);
    // Then: 좌(3..0), 우(5..8), 위(4..0 = rank 0~4 중 한 궁 (4,1) 제외하면 rank 2,3,4),
    //       아래(rank 6,7,8,9 중 (4,8) 초궁 잡기 가능)
    // 가로 전체 8칸 - 자기 자신 1 = 8칸 가능
    const horizontal = moves.filter(m => m.rank === 5);
    expect(horizontal.length).toBe(8); // (0..8) - 자기(4) = 8
  });

  test('JR-C1-008: 차 직선 아군 장애물에서 정지 (§5-3)', () => {
    // Given: 한 차(0,5), (5,5)에 아군 마
    const board = withKings([
      { file: 0, rank: 5, type: 'chariot', side: 'han' },
      { file: 5, rank: 5, type: 'horse', side: 'han' },
    ]);
    // When
    const moves = getLegalMoves(board, 0, 5);
    // Then: (5,5) 미포함(아군), (4,5)까지 포함
    expect(moves).not.toContainEqual({ file: 5, rank: 5 });
    expect(moves).toContainEqual({ file: 4, rank: 5 });
    expect(moves).not.toContainEqual({ file: 6, rank: 5 });
  });

  test('JR-C1-009: 차 적 기물 포획 후 정지 (§5-3)', () => {
    // Given: 한 차(0,5), (5,5)에 적 마
    const board = withKings([
      { file: 0, rank: 5, type: 'chariot', side: 'han' },
      { file: 5, rank: 5, type: 'horse', side: 'cho' },
    ]);
    // When
    const moves = getLegalMoves(board, 0, 5);
    // Then: (5,5) 포함 (적 잡기), (6,5) 미포함 (잡고 정지)
    expect(moves).toContainEqual({ file: 5, rank: 5 });
    expect(moves).not.toContainEqual({ file: 6, rank: 5 });
  });

  // ── §5-4 포(Cannon) ───────────────────────────────────────────

  test('JR-C1-010: 포 다리 있어야 이동 가능 — 가로 후보 정확 5개 (§5-4)', () => {
    // Given: 한 포(0,5), (3,5)에 비-포 기물(마)
    const board = withKings([
      { file: 0, rank: 5, type: 'cannon', side: 'han' },
      { file: 3, rank: 5, type: 'horse', side: 'han' },
    ]);
    // When
    const moves = getLegalMoves(board, 0, 5);
    // Then: 가로(rank=5) 합법 후보가 정확히 (4,5)(5,5)(6,5)(7,5)(8,5) 5개
    //   — 정밀도 강화: 다리 너머 임의 거리 + 다리 전후 칸 미포함을 동시에 보장
    const horizontal = moves.filter(m => m.rank === 5);
    const expectedH = [
      { file: 4, rank: 5 }, { file: 5, rank: 5 }, { file: 6, rank: 5 },
      { file: 7, rank: 5 }, { file: 8, rank: 5 },
    ];
    expect(horizontal.length).toBe(expectedH.length);
    const hSet = new Set(horizontal.map(m => `${m.file},${m.rank}`));
    const expectedSet = new Set(expectedH.map(m => `${m.file},${m.rank}`));
    expect(hSet).toEqual(expectedSet);
    // 명시적 부정 검증(기존 의도 유지)
    expect(moves).not.toContainEqual({ file: 3, rank: 5 });
    expect(moves).not.toContainEqual({ file: 1, rank: 5 });
    expect(moves).not.toContainEqual({ file: 2, rank: 5 });
  });

  test('JR-C1-011: 포 다리 너머 2번째 기물에서 정지 (§5-4)', () => {
    // Given: 한 포(0,5), (3,5)다리(마), (6,5)적 마, (8,5)공백
    const board = withKings([
      { file: 0, rank: 5, type: 'cannon', side: 'han' },
      { file: 3, rank: 5, type: 'horse', side: 'han' },
      { file: 6, rank: 5, type: 'horse', side: 'cho' },
    ]);
    // When
    const moves = getLegalMoves(board, 0, 5);
    // Then: (4,5)(5,5)(6,5) 포함, (7,5)(8,5) 미포함
    expect(moves).toContainEqual({ file: 4, rank: 5 });
    expect(moves).toContainEqual({ file: 5, rank: 5 });
    expect(moves).toContainEqual({ file: 6, rank: 5 });
    expect(moves).not.toContainEqual({ file: 7, rank: 5 });
    expect(moves).not.toContainEqual({ file: 8, rank: 5 });
  });

  // ── §5-5 마(Horse) ────────────────────────────────────────────

  test('JR-C1-012: 마 중앙(4,5)에서 L자 8방향 이동 (§5-5)', () => {
    // Given: 한 마(4,5), 주변 모두 공백
    const board = withKings([
      { file: 4, rank: 5, type: 'horse', side: 'han' },
    ]);
    // When
    const moves = getLegalMoves(board, 4, 5);
    // Then: 8개 이동 (멱 없음)
    expect(moves.length).toBe(8);
    // 모두 변위 (±1,±2) 또는 (±2,±1)
    for (const m of moves) {
      const af = Math.abs(m.file - 4);
      const ar = Math.abs(m.rank - 5);
      expect((af === 1 && ar === 2) || (af === 2 && ar === 1)).toBe(true);
    }
  });

  test('JR-C1-013: 마 모서리(0,0)에서 범위 내 이동만 생성 (§5-5)', () => {
    // Given: 한 마(0,0), 주변 공백
    const board = withKings([
      { file: 0, rank: 0, type: 'horse', side: 'han' },
    ]);
    // When
    const moves = getLegalMoves(board, 0, 0);
    // Then: 모든 이동이 보드 내. 가능 후보: (1,2)(2,1)
    for (const m of moves) {
      expect(inBounds(m.file, m.rank)).toBe(true);
    }
    expect(moves).toContainEqual({ file: 1, rank: 2 });
    expect(moves).toContainEqual({ file: 2, rank: 1 });
    expect(moves.length).toBe(2);
  });

  // ── §5-6 상(Elephant) ─────────────────────────────────────────

  test('JR-C1-014: 상 중앙(4,5)에서 8방향 이동 — 변위 (±2,±3)/(±3,±2) (§5-6)', () => {
    // Given: 한 상(4,5), 주변 모두 공백
    const board = withKings([
      { file: 4, rank: 5, type: 'elephant', side: 'han' },
    ]);
    // When
    const moves = getLegalMoves(board, 4, 5);
    // Then: 8개, 변위 |df|+|dr|=5
    expect(moves.length).toBe(8);
    for (const m of moves) {
      const af = Math.abs(m.file - 4);
      const ar = Math.abs(m.rank - 5);
      expect((af === 2 && ar === 3) || (af === 3 && ar === 2)).toBe(true);
    }
  });

  test('JR-C1-015: 상 모서리(0,0)에서 범위 내 이동만 생성 (§5-6)', () => {
    // Given: 한 상(0,0)
    const board = withKings([
      { file: 0, rank: 0, type: 'elephant', side: 'han' },
    ]);
    // When
    const moves = getLegalMoves(board, 0, 0);
    // Then: 모두 inBounds. (2,3),(3,2) 가능
    for (const m of moves) {
      expect(inBounds(m.file, m.rank)).toBe(true);
    }
    expect(moves).toContainEqual({ file: 2, rank: 3 });
    expect(moves).toContainEqual({ file: 3, rank: 2 });
    expect(moves.length).toBe(2);
  });

  // ── §5-7 졸/병(Soldier) ───────────────────────────────────────

  test('JR-C1-016: 한 졸 중앙(4,5)에서 3방향 이동 — 정확 3개 (§5-7)', () => {
    // Given: 한 졸(4,5), 주변 공백 (궁성 밖이므로 대각 보너스 없음)
    const board = withKings([
      { file: 4, rank: 5, type: 'soldier', side: 'han' },
    ]);
    // When
    const moves = getLegalMoves(board, 4, 5);
    // Then: 정확히 3개 — (4,6) 앞 + (3,5) 좌 + (5,5) 우
    //   — 정밀도 강화: 후방/대각이 의도 외로 포함되지 않음을 보장
    const expected = [
      { file: 4, rank: 6 }, { file: 3, rank: 5 }, { file: 5, rank: 5 },
    ];
    expect(moves.length).toBe(expected.length);
    const movesSet = new Set(moves.map(m => `${m.file},${m.rank}`));
    const expectedSet = new Set(expected.map(m => `${m.file},${m.rank}`));
    expect(movesSet).toEqual(expectedSet);
  });

  test('JR-C1-017: 한 졸 후방(rank-1) 이동 불가 (§5-7)', () => {
    // Given: 한 졸(4,5)
    const board = withKings([
      { file: 4, rank: 5, type: 'soldier', side: 'han' },
    ]);
    // When
    const moves = getLegalMoves(board, 4, 5);
    // Then: (4,4) 미포함 (후방 rank 감소 = 한 졸 후방)
    expect(moves).not.toContainEqual({ file: 4, rank: 4 });
  });

  test('JR-C1-018: 초 병 중앙(4,5)에서 3방향 이동 — 정확 3개 (§5-7)', () => {
    // Given: 초 병(4,5), 주변 공백 (궁성 밖이므로 대각 보너스 없음)
    const board = withKings([
      { file: 4, rank: 5, type: 'soldier', side: 'cho' },
    ]);
    // When
    const moves = getLegalMoves(board, 4, 5);
    // Then: 정확히 3개 — (4,4) 앞 + (3,5) 좌 + (5,5) 우
    //   — 정밀도 강화: 후방/대각이 의도 외로 포함되지 않음을 보장
    const expected = [
      { file: 4, rank: 4 }, { file: 3, rank: 5 }, { file: 5, rank: 5 },
    ];
    expect(moves.length).toBe(expected.length);
    const movesSet = new Set(moves.map(m => `${m.file},${m.rank}`));
    const expectedSet = new Set(expected.map(m => `${m.file},${m.rank}`));
    expect(movesSet).toEqual(expectedSet);
  });

  test('JR-C1-019: 초 병 후방(rank+1) 이동 불가 (§5-7)', () => {
    // Given: 초 병(4,5)
    const board = withKings([
      { file: 4, rank: 5, type: 'soldier', side: 'cho' },
    ]);
    // When
    const moves = getLegalMoves(board, 4, 5);
    // Then: (4,6) 미포함 (초 병 후방 = rank 증가)
    expect(moves).not.toContainEqual({ file: 4, rank: 6 });
  });

  test('JR-C1-020: 한 졸 초 궁성 꼭짓점(3,7)에서 대각 앞(4,8) 이동 가능 (§5-7)', () => {
    // Given: 한 졸(3,7) — 초 궁성 대각 꼭짓점
    const board = withKings([
      { file: 3, rank: 7, type: 'soldier', side: 'han' },
    ]);
    // When
    const moves = getLegalMoves(board, 3, 7);
    // Then: (4,8) 포함 (대각 앞, 도착도 isPalaceDiagonal)
    // 단, (4,8)에는 초 궁이 있어 적 잡기 — addIfNotFriendly는 적 진입 허용
    expect(moves).toContainEqual({ file: 4, rank: 8 });
  });

  test('JR-C1-021: 한 졸 초 궁성 비-대각(3,8)에서 대각 이동 없음 (§5-7)', () => {
    // Given: 한 졸(3,8) — isPalaceDiagonal(3,8)=false (변 중앙)
    // (4,8)에는 초 궁이 있으므로 대각 이동이 가능해 보이지만 출발 칸이 대각 아님 → 불가
    const board = buildBoard([
      { file: 3, rank: 8, type: 'soldier', side: 'han' },
      { file: 4, rank: 1, type: 'king', side: 'han' },
      { file: 4, rank: 8, type: 'king', side: 'cho' },
    ]);
    // When
    const moves = getLegalMoves(board, 3, 8);
    // Then: 대각 이동 (2,9)(4,9) 등 없음. 직진(3,9)/좌(2,8)/우(4,8)만 가능
    // (4,8)은 좌/우가 아니라 우(4,8)는 정확히 우 1칸
    // 대각 이동이 추가로 발생하지 않음을 확인: (2,7)(4,7) 등 대각 앞 후보가 있지만
    // 한 졸의 forward는 rank+1이므로 대각 앞은 (2,9)(4,9). 둘 다 isPalaceDiagonal=false 또는 true 확인 필요.
    // (4,9)는 isPalaceDiagonal=false → 미포함. (2,9)는 초 궁성 밖 → 미포함.
    expect(moves).not.toContainEqual({ file: 2, rank: 9 });
    expect(moves).not.toContainEqual({ file: 4, rank: 9 });
  });

  // ── 아군 점유 칸 잡기 불가 (모든 기물 공통) ───────────────────

  test('JR-C1-022: 차 아군 기물 잡기 불가 (§5-3)', () => {
    // Given: 한 차(0,5), (3,5)에 아군 마
    const board = withKings([
      { file: 0, rank: 5, type: 'chariot', side: 'han' },
      { file: 3, rank: 5, type: 'horse', side: 'han' },
    ]);
    // When
    const moves = getLegalMoves(board, 0, 5);
    // Then: (3,5) 미포함
    expect(moves).not.toContainEqual({ file: 3, rank: 5 });
  });

  test('JR-C1-023: 포 아군 기물 잡기 불가 (§5-4)', () => {
    // Given: 한 포(0,5), (3,5)다리(마), (6,5)에 아군 마
    const board = withKings([
      { file: 0, rank: 5, type: 'cannon', side: 'han' },
      { file: 3, rank: 5, type: 'horse', side: 'han' },
      { file: 6, rank: 5, type: 'horse', side: 'han' },
    ]);
    // When
    const moves = getLegalMoves(board, 0, 5);
    // Then: (6,5) 미포함 (아군)
    expect(moves).not.toContainEqual({ file: 6, rank: 5 });
  });

  test('JR-C1-024: 마 아군 기물 잡기 불가 (§5-5)', () => {
    // Given: 한 마(4,5), (5,3)(도착 후보)에 아군
    const board = withKings([
      { file: 4, rank: 5, type: 'horse', side: 'han' },
      { file: 5, rank: 3, type: 'soldier', side: 'han' },
    ]);
    // When
    const moves = getLegalMoves(board, 4, 5);
    // Then: (5,3) 미포함
    expect(moves).not.toContainEqual({ file: 5, rank: 3 });
  });

  test('JR-C1-025: 상 아군 기물 잡기 불가 (§5-6)', () => {
    // Given: 한 상(4,5), (6,3)(도착 후보)에 아군
    const board = withKings([
      { file: 4, rank: 5, type: 'elephant', side: 'han' },
      { file: 6, rank: 3, type: 'soldier', side: 'han' },
    ]);
    // When
    const moves = getLegalMoves(board, 4, 5);
    // Then: (6,3) 미포함
    expect(moves).not.toContainEqual({ file: 6, rank: 3 });
  });

});
