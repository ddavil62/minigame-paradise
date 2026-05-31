/**
 * @fileoverview JR-C8 시리즈 — 무승부/기권 (5개)
 * 룰북 참조: minigames/janggi/docs/RULEBOOK.md §7-3, §8-7, §10
 *
 * 기권 → 상대 승. 무승부 제안 → 수락(점수제 종료)/거절(취소).
 * 제안 후 수를 두면 자동 취소.
 */

import { test, expect } from '@playwright/test';
import {
  createPlayingGame, applyResign, applyDrawOffer, applyMove,
} from './helpers.js';

test.describe('JR-C8: 무승부/기권 (§7-3, §8-7, §10)', () => {

  test('JR-C8-001: 한 기권 → 초 승, endReason:resign (§7-3)', () => {
    // Given
    const state = createPlayingGame();
    // When: 한이 기권
    const res = applyResign(state, 'han');
    // Then: 초 승
    expect(res.ok).toBe(true);
    expect(state.winner).toBe('cho');
    expect(state.endReason).toBe('resign');
    expect(state.phase).toBe('ended');
  });

  test('JR-C8-002: 이미 종료된 게임 기권 불가 (§7-3)', () => {
    // Given: 종료된 게임
    const state = createPlayingGame();
    applyResign(state, 'cho'); // 한 승으로 종료
    // When: 다시 기권 시도
    const res = applyResign(state, 'han');
    // Then: 거부
    expect(res.ok).toBe(false);
  });

  test('JR-C8-003: 무승부 제안 → 수락 → 점수제 종료 endReason:draw_score (§10)', () => {
    // Given: 한이 무승부 제안
    const state = createPlayingGame();
    const offerRes = applyDrawOffer(state, 'han', 'offer');
    expect(offerRes.ok).toBe(true);
    expect(state.drawOfferedBy).toBe('han');
    // When: 초가 수락
    const acceptRes = applyDrawOffer(state, 'cho', 'accept');
    // Then: 점수제 종료
    expect(acceptRes.ok).toBe(true);
    expect(acceptRes.ended).toBe(true);
    expect(state.phase).toBe('ended');
    expect(state.endReason).toBe('draw_score');
    expect(state.endScores).not.toBeNull();
  });

  test('JR-C8-004: 무승부 제안 → 거절 → drawOfferedBy=null, 게임 계속 (§8-7)', () => {
    // Given
    const state = createPlayingGame();
    applyDrawOffer(state, 'han', 'offer');
    // When: 초가 거절
    const res = applyDrawOffer(state, 'cho', 'reject');
    // Then
    expect(res.ok).toBe(true);
    expect(res.ended).toBe(false);
    expect(state.drawOfferedBy).toBeNull();
    expect(state.phase).toBe('playing');
  });

  test('JR-C8-005: 무승부 제안 상태에서 수를 두면 자동 취소 (§8-7)', () => {
    // Given: 한이 제안 (한 차례, 제안만)
    const state = createPlayingGame();
    applyDrawOffer(state, 'han', 'offer');
    expect(state.drawOfferedBy).toBe('han');
    // When: 한이 수를 두면 (자기 차례) drawOfferedBy 자동 초기화
    const res = applyMove(state, 'han', 0, 3, 0, 4);
    // Then
    expect(res.ok).toBe(true);
    expect(state.drawOfferedBy).toBeNull();
  });

  test('JR-C8-006: 무승부 제안 상태에서 상대가 수를 두어도 자동 취소 (§8-7 양방향)', () => {
    // Given: 한이 자기 차례에 무승부 제안. 한이 자기 졸 한 수 두어 턴을 초로 넘김
    //   (제안 직후 같은 측이 둘 수도 있지만, 본 케이스는 제안만 등록 후 다른 흐름을 시뮬)
    //   드디어 한이 제안만 한 채로 초의 차례가 되도록 한다.
    const state = createPlayingGame();
    // 한 차례에 한이 제안
    const offerRes = applyDrawOffer(state, 'han', 'offer');
    expect(offerRes.ok).toBe(true);
    expect(state.drawOfferedBy).toBe('han');
    // 한이 응답을 기다리지 않고 수를 둘 수도 있지만(자기측 취소 = JR-C8-005),
    //  여기서는 '상대측 수에 의한 취소'를 검증해야 하므로 한이 수를 두면 안 된다.
    //  따라서 turn을 강제로 'cho'로 전환하여 '한이 제안한 상태에서 초의 차례'를 만든다.
    state.turn = 'cho';
    expect(state.drawOfferedBy).toBe('han'); // 제안 유지 확인
    // When: 상대(초)가 수락/거절 없이 자기 졸 한 수를 둠
    //   초 졸(0,6)→(0,5) (초 졸 forward = rank-1)
    const res = applyMove(state, 'cho', 0, 6, 0, 5);
    // Then: 수가 정상 처리되고, 무승부 제안은 자동 취소(null)된다
    expect(res.ok).toBe(true);
    expect(state.drawOfferedBy).toBeNull();
    expect(state.phase).toBe('playing');
  });

});
