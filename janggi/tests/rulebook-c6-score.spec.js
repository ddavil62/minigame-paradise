/**
 * @fileoverview JR-C6 시리즈 — 점수제/덤 (10개)
 * 룰북 참조: minigames/janggi/docs/RULEBOOK.md §3, §7-2
 *
 * §3 기물 점수표, §7-2 점수제 종료. 덤(DEOM)=1.5.
 */

import { test, expect } from '@playwright/test';
import {
  createInitialBoard,
  calculateScore, getScoreWinner, PIECE_SCORE, DEOM,
} from './helpers.js';

test.describe('JR-C6: 점수제/덤 (§3, §7-2)', () => {

  test('JR-C6-001: 초기 보드 점수 합산 정확 — 한=72, cho=72 (덤 미포함) (§3)', () => {
    // Given: 초기 보드 MSMS-MSMS
    const board = createInitialBoard('MSMS', 'MSMS');
    // When: 덤 미포함
    const scores = calculateScore(board, false);
    // Then: 차2*13 + 포2*7 + 마2*5 + 상2*3 + 사2*3 + 졸5*2 = 26+14+10+6+6+10 = 72
    expect(scores.han).toBe(72);
    expect(scores.cho).toBe(72);
  });

  test('JR-C6-002: 덤 포함 시 cho 점수 +1.5 (§3, §7-2)', () => {
    // Given
    const board = createInitialBoard('MSMS', 'MSMS');
    // When
    const withDeom = calculateScore(board, true);
    const without = calculateScore(board, false);
    // Then: cho 차이 정확히 1.5
    expect(withDeom.cho - without.cho).toBe(1.5);
    expect(withDeom.han - without.han).toBe(0);
  });

  test('JR-C6-003: DEOM 상수 = 1.5 (§7-2)', () => {
    // Given/When/Then
    expect(DEOM).toBe(1.5);
  });

  test('JR-C6-004: 차(chariot) 점수 = 13 (§3)', () => {
    expect(PIECE_SCORE.chariot).toBe(13);
  });

  test('JR-C6-005: 포(cannon) 점수 = 7 (§3)', () => {
    expect(PIECE_SCORE.cannon).toBe(7);
  });

  test('JR-C6-006: 마(horse) 점수 = 5 (§3)', () => {
    expect(PIECE_SCORE.horse).toBe(5);
  });

  test('JR-C6-007: 상(elephant)/사(advisor) 점수 = 각 3 (§3)', () => {
    expect(PIECE_SCORE.elephant).toBe(3);
    expect(PIECE_SCORE.advisor).toBe(3);
  });

  test('JR-C6-008: 졸/병(soldier) 점수 = 2 (§3)', () => {
    expect(PIECE_SCORE.soldier).toBe(2);
  });

  test('JR-C6-009: han > cho → getScoreWinner는 han (§7-2)', () => {
    // Given
    const scores = { han: 75, cho: 70 };
    // When/Then
    expect(getScoreWinner(scores)).toBe('han');
  });

  test('JR-C6-010: han <= cho (동점 포함) → getScoreWinner는 cho (§7-2)', () => {
    // Given: 동점
    expect(getScoreWinner({ han: 70, cho: 70 })).toBe('cho');
    // han < cho
    expect(getScoreWinner({ han: 60, cho: 70 })).toBe('cho');
  });

});
