/**
 * @fileoverview JR-C7 시리즈 — 시간/초읽기 (5개)
 * 룰북 참조: minigames/janggi/docs/RULEBOOK.md §9
 *
 * 본 시간 600초, 초읽기 30초 × 3회. 본 시간 소진 후 초읽기 진입,
 * 초읽기 모두 소진 시 시간패(endReason:timeout).
 */

import { test, expect } from '@playwright/test';
import {
  createPlayingGame, tickTimer, TIME_CONFIG,
} from './helpers.js';

test.describe('JR-C7: 시간/초읽기 (§9)', () => {

  test('JR-C7-001: TIME_CONFIG 값 = {600, 30, 3} (§9)', () => {
    // Given/When/Then
    expect(TIME_CONFIG.mainTimeSec).toBe(600);
    expect(TIME_CONFIG.byoyomiSec).toBe(30);
    expect(TIME_CONFIG.byoyomiCount).toBe(3);
  });

  test('JR-C7-002: 본 시간 tick 1회 → mainSec 감소 (§9)', () => {
    // Given: 게임 시작 직후, 한 차례
    const state = createPlayingGame();
    const before = state.hanTime.mainSec;
    // When
    tickTimer(state);
    // Then: 한 본 시간 1초 차감
    expect(state.hanTime.mainSec).toBe(before - 1);
  });

  test('JR-C7-003: 본 시간 소진 후 tick → 초읽기로 진입 (§9)', () => {
    // Given: 한 차례, 한 본 시간 0, 초읽기 30/3
    const state = createPlayingGame();
    state.hanTime.mainSec = 0;
    state.hanTime.byoyomiSec = TIME_CONFIG.byoyomiSec;
    state.hanTime.byoyomiLeft = TIME_CONFIG.byoyomiCount;
    // When
    tickTimer(state);
    // Then: byoyomiSec 1 감소
    expect(state.hanTime.byoyomiSec).toBe(TIME_CONFIG.byoyomiSec - 1);
  });

  test('JR-C7-004: 초읽기 소진 → 다음 회차 시작 (§9)', () => {
    // Given: 한 차례, 본 시간 0, byoyomiSec 1, byoyomiLeft 2
    const state = createPlayingGame();
    state.hanTime.mainSec = 0;
    state.hanTime.byoyomiSec = 1;
    state.hanTime.byoyomiLeft = 2;
    // When
    tickTimer(state);
    // Then: byoyomiSec 30 리셋, byoyomiLeft 1
    expect(state.hanTime.byoyomiSec).toBe(TIME_CONFIG.byoyomiSec);
    expect(state.hanTime.byoyomiLeft).toBe(1);
  });

  test('JR-C7-005: 마지막 초읽기 소진 → 시간패 endReason:timeout (§9)', () => {
    // Given: 한 차례, 본 시간 0, byoyomiSec 1, byoyomiLeft 1
    const state = createPlayingGame();
    state.hanTime.mainSec = 0;
    state.hanTime.byoyomiSec = 1;
    state.hanTime.byoyomiLeft = 1;
    // When
    const res = tickTimer(state);
    // Then: 시간패
    expect(res.timedOut).toBe(true);
    expect(res.loser).toBe('han');
    expect(state.phase).toBe('ended');
    expect(state.endReason).toBe('timeout');
    expect(state.winner).toBe('cho');
  });

});
