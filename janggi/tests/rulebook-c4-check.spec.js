/**
 * @fileoverview JR-C4 시리즈 — 장군/외통수/자살수 (15개)
 * 룰북 참조: minigames/janggi/docs/RULEBOOK.md §7-1, §8-3, §8-4
 *
 * §7-1 외통수, §8-3 자살수 금지, §8-4 장군.
 * 단위 테스트 위주 (보드 구성 → 판정 함수 직접 호출).
 */

import { test, expect } from '@playwright/test';
import {
  piece, buildBoard, createPlayingGame, getAllLegalMoves,
  isInCheck, wouldBeSelfCheck, isCheckmate,
  applyMove, createGameSession, applySetupChoice,
  setPiece, getPiece,
} from './helpers.js';

test.describe('JR-C4: 장군/외통수/자살수 (§7-1, §8-3, §8-4)', () => {

  // ── §8-4 장군 판정 ─────────────────────────────────────────────

  test('JR-C4-001: 차가 같은 file 직선으로 한 궁 공격 → 장군 (§8-4)', () => {
    // Given: 한 궁(4,1), 초 차(4,5)가 같은 file에서 가로막힘 없이 공격
    const board = buildBoard([
      { file: 4, rank: 1, type: 'king', side: 'han' },
      { file: 4, rank: 5, type: 'chariot', side: 'cho' },
      { file: 4, rank: 8, type: 'king', side: 'cho' },
    ]);
    // When
    const check = isInCheck(board, 'han');
    // Then: 장군 상태
    expect(check).toBe(true);
  });

  test('JR-C4-002: 포가 다리 넘어 궁 공격 → 장군 (§8-4)', () => {
    // Given: 한 궁(4,1), 같은 file에 다리(아무 기물) (4,3), 초 포(4,5)
    const board = buildBoard([
      { file: 4, rank: 1, type: 'king', side: 'han' },
      { file: 4, rank: 3, type: 'horse', side: 'han' }, // 다리
      { file: 4, rank: 5, type: 'cannon', side: 'cho' },
      { file: 4, rank: 8, type: 'king', side: 'cho' },
    ]);
    // When
    const check = isInCheck(board, 'han');
    // Then: 포가 (4,3) 다리 넘어 (4,1) 공격
    expect(check).toBe(true);
  });

  test('JR-C4-003: 마 L자로 궁 공격 → 장군 (§8-4)', () => {
    // Given: 한 궁(4,1), 초 마(3,3) — L자(직선 위 1 + 좌 대각): (3,3)→up→(3,2)→up-left→(2,1) … 마는 (3,3)에서 위(3,2)경유→(2,1)(4,1). 멱(3,2) 빈 칸 필요
    const board = buildBoard([
      { file: 4, rank: 1, type: 'king', side: 'han' },
      { file: 3, rank: 3, type: 'horse', side: 'cho' },
      { file: 4, rank: 8, type: 'king', side: 'cho' },
    ]);
    // When
    const check = isInCheck(board, 'han');
    // Then: 마가 (3,3)→(3,2)→(4,1) L자 공격
    expect(check).toBe(true);
  });

  test('JR-C4-004: 장군 없는 상태 → false (§8-4)', () => {
    // Given: 한 궁(4,1), 초 차(0,9), 둘 사이 시야 없음
    const board = buildBoard([
      { file: 4, rank: 1, type: 'king', side: 'han' },
      { file: 0, rank: 9, type: 'chariot', side: 'cho' },
      { file: 4, rank: 8, type: 'king', side: 'cho' },
    ]);
    // When
    const check = isInCheck(board, 'han');
    // Then: 장군 아님
    expect(check).toBe(false);
  });

  // ── §8-3 자살수 ────────────────────────────────────────────────

  test('JR-C4-005: 자살수 wouldBeSelfCheck → true (§8-3)', () => {
    // Given: 한 궁(4,1), 같은 file에 한 차(4,3) (장군 방어 중), 초 차(4,5)
    // 한 차(4,3)→(0,3) 이동 시 (4,1)-(4,5) 사이 시야 열림 → 한 궁 장군 → 자살수
    const board = buildBoard([
      { file: 4, rank: 1, type: 'king', side: 'han' },
      { file: 4, rank: 3, type: 'chariot', side: 'han' },
      { file: 4, rank: 5, type: 'chariot', side: 'cho' },
      { file: 4, rank: 8, type: 'king', side: 'cho' },
    ]);
    // When: (4,3)→(0,3) 이동 시뮬레이션
    const isSuicide = wouldBeSelfCheck(board, 4, 3, 0, 3);
    // Then: 자살수
    expect(isSuicide).toBe(true);
  });

  test('JR-C4-006: 자살수 applyMove 거부 (§8-3)', () => {
    // Given: GameSession, 보드 직접 조작 — 한 차(4,3)가 방어 중인 상태로 한 차례
    const state = createPlayingGame();
    // 보드를 자살수 가능 형태로 강제 변경
    // 모든 기물 제거 후 필요한 것만 배치
    for (let r = 0; r < 10; r++) {
      for (let f = 0; f < 9; f++) {
        setPiece(state.board, f, r, null);
      }
    }
    setPiece(state.board, 4, 1, piece('king', 'han'));
    setPiece(state.board, 4, 3, piece('chariot', 'han'));
    setPiece(state.board, 4, 5, piece('chariot', 'cho'));
    setPiece(state.board, 4, 8, piece('king', 'cho'));
    state.turn = 'han';
    // When: (4,3)→(0,3) 이동 시도 (한 궁 노출)
    const res = applyMove(state, 'han', 4, 3, 0, 3);
    // Then: ok:false, error 메시지에 '자살수' 포함
    expect(res.ok).toBe(false);
    expect(res.error).toContain('자살수');
  });

  test('JR-C4-007: 비자살수 applyMove 허용 (§8-3)', () => {
    // Given: 정상 게임 시작 상태
    const state = createPlayingGame();
    // When: 한 졸(0,3)→(0,4) 전진
    const res = applyMove(state, 'han', 0, 3, 0, 4);
    // Then: ok:true
    expect(res.ok).toBe(true);
  });

  // ── §7-1 외통수 판정 ───────────────────────────────────────────

  test('JR-C4-008: 외통수 — 한 궁이 모든 합법 수에서 장군 해소 불가 (§7-1)', () => {
    // Given: 한 궁(4,0) 모서리, 초 차 2대로 봉쇄
    // 한 궁(4,0), 초 차(4,2) — 직선 장군. 한 궁 이동 후보: (3,0)(5,0)(4,1)
    // (4,1)로 가면 차 (4,2)에 잡힘. (3,0)(5,0)도 각각 차로 봉쇄
    const board = buildBoard([
      { file: 4, rank: 0, type: 'king', side: 'han' },
      { file: 4, rank: 2, type: 'chariot', side: 'cho' },
      { file: 3, rank: 9, type: 'chariot', side: 'cho' }, // (3,0) 봉쇄
      { file: 5, rank: 9, type: 'chariot', side: 'cho' }, // (5,0) 봉쇄
      { file: 4, rank: 8, type: 'king', side: 'cho' },
    ]);
    // When
    const isMate = isCheckmate(board, 'han');
    // Then: 외통수
    expect(isMate).toBe(true);
  });

  test('JR-C4-009: 장군이지만 피할 수 있음 → 외통수 아님 (§7-1)', () => {
    // Given: 한 궁(4,0), 초 차(4,2) — 장군. 하지만 (3,0)(5,0)으로 피할 수 있음
    const board = buildBoard([
      { file: 4, rank: 0, type: 'king', side: 'han' },
      { file: 4, rank: 2, type: 'chariot', side: 'cho' },
      { file: 4, rank: 8, type: 'king', side: 'cho' },
    ]);
    // When
    const isMate = isCheckmate(board, 'han');
    // Then: 외통수 아님 (피할 수 있음)
    expect(isMate).toBe(false);
    // 그리고 장군 상태는 맞음
    expect(isInCheck(board, 'han')).toBe(true);
  });

  test('JR-C4-010: 장군 아닌 상태 → 외통수 false (§7-1)', () => {
    // Given: 한 궁(4,1), 초 기물 시야 밖
    const board = buildBoard([
      { file: 4, rank: 1, type: 'king', side: 'han' },
      { file: 0, rank: 9, type: 'chariot', side: 'cho' },
      { file: 4, rank: 8, type: 'king', side: 'cho' },
    ]);
    // When
    const isMate = isCheckmate(board, 'han');
    // Then: 외통수 아님
    expect(isMate).toBe(false);
  });

  test('JR-C4-011: 외통수 만드는 수 → applyMove 결과 checkmate:true + gameOver (§7-1)', () => {
    // Given: 한 궁(4,0), 초 차(4,5) (장군 아님 — 직선 4,5→4,0 사이 비어있어야)
    // 그리고 초 차(3,9), (5,9) — (3,0)(5,0) 봉쇄
    // 초가 차(4,5)→(4,2)로 이동하면 한 궁 (4,0)는 외통수가 된다
    const state = createPlayingGame();
    for (let r = 0; r < 10; r++) {
      for (let f = 0; f < 9; f++) {
        setPiece(state.board, f, r, null);
      }
    }
    setPiece(state.board, 4, 0, piece('king', 'han'));
    setPiece(state.board, 4, 5, piece('chariot', 'cho'));
    setPiece(state.board, 3, 9, piece('chariot', 'cho'));
    setPiece(state.board, 5, 9, piece('chariot', 'cho'));
    setPiece(state.board, 4, 8, piece('king', 'cho'));
    state.turn = 'cho';
    // 동형반복 해시 초기화
    state.repetitionHistory = new Map();
    // When: 초 차(4,5)→(4,2) 이동
    const res = applyMove(state, 'cho', 4, 5, 4, 2);
    // Then: ok, checkmate:true, gameOver:true
    expect(res.ok).toBe(true);
    expect(res.checkmate).toBe(true);
    expect(res.gameOver).toBe(true);
    expect(state.phase).toBe('ended');
    expect(state.endReason).toBe('checkmate');
    expect(state.winner).toBe('cho');
  });

  test('JR-C4-012: 장군 상태에서 장군 해소 안 하는 수 → 자살수 (§8-3 + §8-4)', () => {
    // Given: 한 궁(4,0), 초 차(4,5) 장군. 한 차(0,3) (한 진영) — 장군 해소와 무관한 위치
    const board = buildBoard([
      { file: 4, rank: 0, type: 'king', side: 'han' },
      { file: 4, rank: 5, type: 'chariot', side: 'cho' },
      { file: 0, rank: 3, type: 'chariot', side: 'han' },
      { file: 4, rank: 8, type: 'king', side: 'cho' },
    ]);
    // When: (0,3)→(0,4) 이동 시 장군 미해소 → 자살수
    const isSuicide = wouldBeSelfCheck(board, 0, 3, 0, 4);
    // Then: 자살수 (장군 해소 안 함)
    expect(isSuicide).toBe(true);
  });

  test('JR-C4-013: 장군 해소 — 궁 이동으로 벗어남 (§8-4)', () => {
    // Given: 한 궁(4,0), 초 차(4,5) 장군. 궁 이동(3,0) 가능
    const board = buildBoard([
      { file: 4, rank: 0, type: 'king', side: 'han' },
      { file: 4, rank: 5, type: 'chariot', side: 'cho' },
      { file: 4, rank: 8, type: 'king', side: 'cho' },
    ]);
    // When: 합법 수 목록
    const legalMoves = getAllLegalMoves(board, 'han');
    // Then: 궁 (4,0)→(3,0) 또는 (5,0) 포함
    const kingEscape = legalMoves.filter(
      m => m.fromFile === 4 && m.fromRank === 0
    );
    expect(kingEscape.length).toBeGreaterThan(0);
    // 궁이 (4,1)로 가면 여전히 차 시야이므로 자살수, 제외됨
    expect(kingEscape).not.toContainEqual(
      expect.objectContaining({ toFile: 4, toRank: 1 })
    );
  });

  test('JR-C4-014: 장군 해소 — 중간 기물 차단 (§8-4)', () => {
    // Given: 한 궁(4,0), 초 차(4,5) 장군. 한 차(0,2) — (4,2)로 가서 막을 수 있음
    const board = buildBoard([
      { file: 4, rank: 0, type: 'king', side: 'han' },
      { file: 4, rank: 5, type: 'chariot', side: 'cho' },
      { file: 0, rank: 2, type: 'chariot', side: 'han' },
      { file: 4, rank: 8, type: 'king', side: 'cho' },
    ]);
    // When
    const legalMoves = getAllLegalMoves(board, 'han');
    // Then: 한 차(0,2)→(4,2) 막는 수 포함
    const blockMove = legalMoves.find(
      m => m.fromFile === 0 && m.fromRank === 2 && m.toFile === 4 && m.toRank === 2
    );
    expect(blockMove).toBeDefined();
  });

  test('JR-C4-015: 궁 포획 시 즉시 gameOver — endReason:checkmate (§7-1)', () => {
    // Given: 적 궁이 잡히는 직전 상태
    const state = createPlayingGame();
    for (let r = 0; r < 10; r++) {
      for (let f = 0; f < 9; f++) {
        setPiece(state.board, f, r, null);
      }
    }
    setPiece(state.board, 4, 1, piece('king', 'han'));
    setPiece(state.board, 4, 8, piece('king', 'cho'));
    setPiece(state.board, 4, 7, piece('chariot', 'han')); // 한 차가 초 궁 한 칸 앞
    state.turn = 'han';
    state.repetitionHistory = new Map();
    // When: 한 차(4,7)→(4,8) 이동, 초 궁 포획
    const res = applyMove(state, 'han', 4, 7, 4, 8);
    // Then: gameOver, captured.type=king, endReason=checkmate
    expect(res.ok).toBe(true);
    expect(res.gameOver).toBe(true);
    expect(res.captured && res.captured.type).toBe('king');
    expect(state.endReason).toBe('checkmate');
    expect(state.winner).toBe('han');
  });

});
