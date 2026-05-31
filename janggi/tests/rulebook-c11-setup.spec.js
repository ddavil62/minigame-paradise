/**
 * @fileoverview JR-C11 시리즈 — 마/상 배치 4종 (5개)
 * 룰북 참조: minigames/janggi/docs/RULEBOOK.md §4
 *
 * 배치 4종: MSMS/SMSM/MSSM/SMMS. 초가 먼저, 한이 응수. 16 조합 모두 합법.
 */

import { test, expect } from '@playwright/test';
import {
  createGameSession, applySetupChoice,
} from './helpers.js';

test.describe('JR-C11: 마/상 배치 4종 (§4)', () => {

  test('JR-C11-001: 초가 먼저 배치 — 한이 먼저 시도 시 거부 (§4-2)', () => {
    // Given
    const state = createGameSession();
    // When: 한이 먼저 배치 시도
    const res = applySetupChoice(state, 'han', 'MSMS');
    // Then: 거부
    expect(res.ok).toBe(false);
    expect(res.error).toContain('초');
  });

  test('JR-C11-002: 유효하지 않은 배치 코드 거부 (§4-1)', () => {
    // Given
    const state = createGameSession();
    // When: 초가 잘못된 코드
    const res = applySetupChoice(state, 'cho', 'XYZW');
    // Then: 거부
    expect(res.ok).toBe(false);
  });

  test('JR-C11-003: 초:MSMS → 한:SMMS 응수 가능 (§4-3)', () => {
    // Given
    const state = createGameSession();
    // When
    const r1 = applySetupChoice(state, 'cho', 'MSMS');
    expect(r1.ok).toBe(true);
    const r2 = applySetupChoice(state, 'han', 'SMMS');
    // Then: 한이 다른 코드도 선택 가능
    expect(r2.ok).toBe(true);
    expect(r2.gameStarted).toBe(true);
  });

  test('JR-C11-004: 배치 완료 후 phase:playing, turn:han (§4-2)', () => {
    // Given/When
    const state = createGameSession();
    applySetupChoice(state, 'cho', 'MSMS');
    applySetupChoice(state, 'han', 'MSMS');
    // Then
    expect(state.phase).toBe('playing');
    expect(state.turn).toBe('han'); // 한이 선수
  });

  test('JR-C11-005: 4 × 4 = 16 조합 모두 합법 (§4-3)', () => {
    // Given
    const codes = ['MSMS', 'SMSM', 'MSSM', 'SMMS'];
    // When/Then: 모든 조합에서 phase:playing 도달
    for (const choCode of codes) {
      for (const hanCode of codes) {
        const state = createGameSession();
        const r1 = applySetupChoice(state, 'cho', choCode);
        const r2 = applySetupChoice(state, 'han', hanCode);
        expect(r1.ok).toBe(true);
        expect(r2.ok).toBe(true);
        expect(state.phase).toBe('playing');
      }
    }
  });

});
