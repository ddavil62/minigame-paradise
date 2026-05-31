/**
 * @fileoverview JR-C12 시리즈 — 절차 위반 금지 수 (5개)
 * 룰북 참조: minigames/janggi/docs/RULEBOOK.md §11-11
 *
 * §11-11 절차 위반 금지 수:
 *  - 상대 차례에 둔 수
 *  - 상대 기물 이동
 *  - 자기 차례 외 무승부 수락(자기가 한 제안을 자기가 수락)
 *  - 종료된 게임(ended)에서의 액션 시도
 *  - 배치(setup) 단계에서의 MOVE 시도
 *
 * 모든 절차 위반은 lib(game.js)에서 ok:false로 거절되어야 한다.
 * QA에서 probe로 동작은 확인됨(PROBE-3A/3B/3C/9A/9B/10) — 본 spec은 회귀 안전망 구축이 목적.
 */

import { test, expect } from '@playwright/test';
import {
  createGameSession, createPlayingGame,
  applySetupChoice, applyMove, applyResign, applyDrawOffer,
} from './helpers.js';

test.describe('JR-C12: 절차 위반 금지 수 (§11-11)', () => {

  test('JR-C12-001: 상대 차례에 둔 수 거절 (§11-11)', () => {
    // Given: 정상 게임 시작 → 한(선수)의 차례
    const state = createPlayingGame();
    expect(state.turn).toBe('han');
    // When: 초(후수)가 한의 차례에 자기 기물을 두려고 시도
    //   초 졸(0,6)→(0,5) (초 졸 forward = rank-1)
    const res = applyMove(state, 'cho', 0, 6, 0, 5);
    // Then: 거절 — '차례' 관련 오류 메시지
    expect(res.ok).toBe(false);
    expect(res.error).toContain('차례');
    // 게임 상태는 변동 없음
    expect(state.phase).toBe('playing');
    expect(state.turn).toBe('han');
  });

  test('JR-C12-002: 자기 차례에 상대 기물 이동 거절 (§11-11)', () => {
    // Given: 한의 차례
    const state = createPlayingGame();
    expect(state.turn).toBe('han');
    // When: 한이 자기 차례에 초의 졸(0,6)을 이동시키려 시도
    //   side는 정직하게 'han'으로 호출 — 즉 한이 초 기물을 잡아 옮기는 부정 시도
    const res = applyMove(state, 'han', 0, 6, 0, 5);
    // Then: 거절 — '자기 기물' 관련 오류 메시지
    expect(res.ok).toBe(false);
    expect(res.error).toContain('자기 기물');
    // 게임 상태는 변동 없음
    expect(state.phase).toBe('playing');
    expect(state.turn).toBe('han');
  });

  test('JR-C12-003: 자기가 한 무승부 제안을 자기가 수락 거절 (§8-7, §11-11)', () => {
    // Given: 한이 무승부 제안
    const state = createPlayingGame();
    const offerRes = applyDrawOffer(state, 'han', 'offer');
    expect(offerRes.ok).toBe(true);
    expect(state.drawOfferedBy).toBe('han');
    // When: 같은 한이 자기 제안을 수락 시도
    const res = applyDrawOffer(state, 'han', 'accept');
    // Then: 거절
    expect(res.ok).toBe(false);
    expect(res.error).toBeDefined();
    // 게임은 계속, 제안 상태 유지(자기 수락이 아니므로 취소도 아님)
    expect(state.phase).toBe('playing');
    expect(state.drawOfferedBy).toBe('han');
  });

  test('JR-C12-004: ended 상태에서 액션(MOVE) 시도 거절 (§7)', () => {
    // Given: 한이 기권하여 종료된 게임
    const state = createPlayingGame();
    applyResign(state, 'han');
    expect(state.phase).toBe('ended');
    // When: 종료 후 MOVE 시도 (한 졸 (0,3)→(0,4))
    const res = applyMove(state, 'han', 0, 3, 0, 4);
    // Then: 거절 — '게임' 진행 중이 아님
    expect(res.ok).toBe(false);
    expect(res.error).toContain('게임');
    // ended 상태 유지
    expect(state.phase).toBe('ended');
  });

  test('JR-C12-005: setup 단계에서 MOVE 시도 거절 (§6)', () => {
    // Given: 게임 세션 생성 직후 — phase: 'setup_cho', 보드 없음
    const state = createGameSession();
    expect(state.phase).toBe('setup_cho');
    expect(state.board).toBeNull();
    // 초만 배치하고 한 배치 전 (phase: setup_han)에서 시도
    applySetupChoice(state, 'cho', 'MSMS');
    expect(state.phase).toBe('setup_han');
    // When: setup 단계에서 한이 MOVE 시도
    const res = applyMove(state, 'han', 0, 3, 0, 4);
    // Then: 거절 — '게임' 진행 중이 아님
    expect(res.ok).toBe(false);
    expect(res.error).toContain('게임');
    // setup 단계 유지
    expect(state.phase).toBe('setup_han');
  });

});
