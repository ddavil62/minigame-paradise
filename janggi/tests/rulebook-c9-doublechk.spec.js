/**
 * @fileoverview JR-C9 시리즈 — 양수겸장 (5개)
 * 룰북 참조: minigames/janggi/docs/RULEBOOK.md §8-5, §13-7
 *
 * 2개 이상 기물이 동시 장군 → isDoubleCheck:true.
 * 자살수 필터가 자동으로 궁 이동 외 응수를 제거.
 */

import { test, expect } from '@playwright/test';
import {
  piece, buildBoard, getAllLegalMoves, getPiece,
  isInCheck,
} from './helpers.js';
// isDoubleCheck는 helpers에서 re-export 누락 — 직접 import
import { isDoubleCheck } from '../lib/rules.js';

test.describe('JR-C9: 양수겸장 (§8-5, §13-7)', () => {

  test('JR-C9-001: 차+마 동시 장군 → isDoubleCheck:true (§8-5)', () => {
    // Given: 한 궁(4,0), 초 차(4,5) 직선 장군 + 초 마(3,2) L자 장군
    // 마 (3,2)→(2,0)(4,0). (4,0)이 한 궁이므로 장군. 멱(3,1) 비어있어야.
    const board = buildBoard([
      { file: 4, rank: 0, type: 'king', side: 'han' },
      { file: 4, rank: 5, type: 'chariot', side: 'cho' },
      { file: 3, rank: 2, type: 'horse', side: 'cho' },
      { file: 4, rank: 8, type: 'king', side: 'cho' },
    ]);
    // When
    const dbl = isDoubleCheck(board, 'han');
    // Then
    expect(dbl).toBe(true);
    // 그리고 isInCheck도 true
    expect(isInCheck(board, 'han')).toBe(true);
  });

  test('JR-C9-002: 1개 기물만 장군 → isDoubleCheck:false (§8-5)', () => {
    // Given: 차 1개만 장군
    const board = buildBoard([
      { file: 4, rank: 0, type: 'king', side: 'han' },
      { file: 4, rank: 5, type: 'chariot', side: 'cho' },
      { file: 4, rank: 8, type: 'king', side: 'cho' },
    ]);
    // When
    const dbl = isDoubleCheck(board, 'han');
    // Then
    expect(dbl).toBe(false);
    expect(isInCheck(board, 'han')).toBe(true);
  });

  test('JR-C9-003: 장군 없음 → isDoubleCheck:false (§8-5)', () => {
    // Given
    const board = buildBoard([
      { file: 4, rank: 1, type: 'king', side: 'han' },
      { file: 4, rank: 8, type: 'king', side: 'cho' },
    ]);
    // When/Then
    expect(isDoubleCheck(board, 'han')).toBe(false);
  });

  test('JR-C9-004: 양수겸장 시 합법 수는 궁 이동만 남음 (§8-5, §13-7)', () => {
    // Given: 한 궁(4,1), 초 차(4,5) + 초 마(3,3) 동시 장군
    // 마(3,3)→(2,1)(4,1) — (4,1)이 한 궁이므로 장군. 멱(3,2) 비어있어야.
    // 한 차(0,0) — 도움이 될 수 없는 위치 (양수겸장 상황 시 차 이동은 모두 자살수)
    const board = buildBoard([
      { file: 4, rank: 1, type: 'king', side: 'han' },
      { file: 4, rank: 5, type: 'chariot', side: 'cho' },
      { file: 3, rank: 3, type: 'horse', side: 'cho' },
      { file: 0, rank: 0, type: 'chariot', side: 'han' },
      { file: 4, rank: 8, type: 'king', side: 'cho' },
    ]);
    // 검증: 양수겸장 상태
    expect(isDoubleCheck(board, 'han')).toBe(true);
    // When: 합법 수
    const legalMoves = getAllLegalMoves(board, 'han');
    // Then: 모든 합법 수의 from은 한 궁 위치 (4,1)
    for (const m of legalMoves) {
      const p = getPiece(board, m.fromFile, m.fromRank);
      expect(p && p.type).toBe('king');
    }
  });

  test('JR-C9-005: 양수겸장 + 궁 이동으로 해소 가능 → 합법 수 > 0 (§8-5)', () => {
    // Given: 한 궁(4,1), 양수겸장 상태이지만 궁이 (3,1)/(5,1)/(4,0)/(4,2) 등으로 이동 가능
    // (위 JR-C9-004와 동일 보드)
    const board = buildBoard([
      { file: 4, rank: 1, type: 'king', side: 'han' },
      { file: 4, rank: 5, type: 'chariot', side: 'cho' },
      { file: 3, rank: 3, type: 'horse', side: 'cho' },
      { file: 4, rank: 8, type: 'king', side: 'cho' },
    ]);
    // When
    const legalMoves = getAllLegalMoves(board, 'han');
    // Then: 합법 수가 적어도 1개 (궁 이동)
    expect(legalMoves.length).toBeGreaterThan(0);
    // 모두 궁 이동
    for (const m of legalMoves) {
      const p = getPiece(board, m.fromFile, m.fromRank);
      expect(p && p.type).toBe('king');
    }
  });

});
