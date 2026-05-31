/**
 * @fileoverview JR-C5 시리즈 — 동형반복/50수 룰 (10개)
 * 룰북 참조: minigames/janggi/docs/RULEBOOK.md §7-4, §10
 *
 * §7-4 동형반복 3회 → 점수제 종료.
 * §10 50수 룰: 비포획·비졸 이동 50회 누적 시 점수제 종료. 포획/졸 이동 시 리셋.
 */

import { test, expect } from '@playwright/test';
import {
  piece, buildBoard, createPlayingGame,
  boardHash, countRepetition,
  applyMove, setPiece, getPiece,
  calculateScore, DEOM,
} from './helpers.js';

test.describe('JR-C5: 동형반복/50수 룰 (§7-4, §10)', () => {

  // ── §7-4 동형반복 boardHash ──────────────────────────────────

  test('JR-C5-001: boardHash는 보드+차례를 모두 포함 — 차례 다르면 다른 해시 (§7-4)', () => {
    // Given: 동일 보드, 차례만 다름
    const board = buildBoard([
      { file: 4, rank: 1, type: 'king', side: 'han' },
      { file: 4, rank: 8, type: 'king', side: 'cho' },
    ]);
    // When
    const hHan = boardHash(board, 'han');
    const hCho = boardHash(board, 'cho');
    // Then: 서로 다른 해시
    expect(hHan).not.toBe(hCho);
  });

  test('JR-C5-002: boardHash 동일 보드+차례 → 동일 해시 (§7-4)', () => {
    // Given
    const board = buildBoard([
      { file: 4, rank: 1, type: 'king', side: 'han' },
      { file: 4, rank: 8, type: 'king', side: 'cho' },
      { file: 0, rank: 5, type: 'chariot', side: 'han' },
    ]);
    // When
    const h1 = boardHash(board, 'han');
    const h2 = boardHash(board, 'han');
    // Then
    expect(h1).toBe(h2);
  });

  test('JR-C5-003: countRepetition 3회째 → isThreefold:true (§7-4)', () => {
    // Given: 빈 history
    const history = new Map();
    // When: 동일 해시 3회 등록
    countRepetition(history, 'h');
    countRepetition(history, 'h');
    const r3 = countRepetition(history, 'h');
    // Then: 3회째 isThreefold true
    expect(r3.count).toBe(3);
    expect(r3.isThreefold).toBe(true);
  });

  test('JR-C5-004: countRepetition 2회는 아직 아님 (§7-4)', () => {
    // Given
    const history = new Map();
    // When: 2회 등록
    countRepetition(history, 'h');
    const r2 = countRepetition(history, 'h');
    // Then
    expect(r2.count).toBe(2);
    expect(r2.isThreefold).toBe(false);
  });

  test('JR-C5-005: GameSession 차-차 왕복 동형반복 3회 → endReason:repetition (§7-4)', () => {
    // Given: 정상 게임 시작 (초기 해시 1회 등록됨)
    const state = createPlayingGame();
    // 한 차(0,0) ↔ (0,1) 왕복, 초도 차(0,9) ↔ (0,8) 왕복
    // 사이클: 한 (0,0)→(0,1), 초 (0,9)→(0,8), 한 (0,1)→(0,0), 초 (0,8)→(0,9)
    // 위 한 사이클이 완료되면 초기 보드 상태로 복귀
    // 시작 상태 해시는 startGame()에서 1회 카운트. 사이클 1회 후 = 2회. 사이클 2회 후 = 3회 (isThreefold)
    let res;
    // 사이클 1
    res = applyMove(state, 'han', 0, 0, 0, 1); expect(res.ok).toBe(true);
    res = applyMove(state, 'cho', 0, 9, 0, 8); expect(res.ok).toBe(true);
    res = applyMove(state, 'han', 0, 1, 0, 0); expect(res.ok).toBe(true);
    res = applyMove(state, 'cho', 0, 8, 0, 9); expect(res.ok).toBe(true);
    // 사이클 2 (이 사이클 마지막 수에서 동형반복 트리거)
    res = applyMove(state, 'han', 0, 0, 0, 1); expect(res.ok).toBe(true);
    res = applyMove(state, 'cho', 0, 9, 0, 8); expect(res.ok).toBe(true);
    res = applyMove(state, 'han', 0, 1, 0, 0); expect(res.ok).toBe(true);
    res = applyMove(state, 'cho', 0, 8, 0, 9);
    // Then: 동형반복 3회 → 종료
    expect(res.ok).toBe(true);
    expect(state.phase).toBe('ended');
    expect(state.endReason).toBe('repetition');
  });

  test('JR-C5-006: 동형반복 종료 시 endScores 계산됨 + 덤 1.5 포함 (§7-2, §7-4)', () => {
    // Given: 위와 동일 사이클로 종료 유도 (포획 없음 → 32개 기물 그대로)
    const state = createPlayingGame();
    applyMove(state, 'han', 0, 0, 0, 1);
    applyMove(state, 'cho', 0, 9, 0, 8);
    applyMove(state, 'han', 0, 1, 0, 0);
    applyMove(state, 'cho', 0, 8, 0, 9);
    applyMove(state, 'han', 0, 0, 0, 1);
    applyMove(state, 'cho', 0, 9, 0, 8);
    applyMove(state, 'han', 0, 1, 0, 0);
    applyMove(state, 'cho', 0, 8, 0, 9);
    // Then: endScores 존재 + 룰북 §7-2 덤 1.5 적용 검증
    expect(state.endScores).not.toBeNull();
    expect(typeof state.endScores.han).toBe('number');
    expect(typeof state.endScores.cho).toBe('number');
    // 덤 1.5 검증: cho = (덤 미포함 점수) + DEOM
    const rawScores = calculateScore(state.board, false);
    expect(state.endScores.cho).toBe(rawScores.cho + DEOM);
    expect(state.endScores.cho - rawScores.cho).toBe(1.5);
    // 한은 덤 영향 없음
    expect(state.endScores.han).toBe(rawScores.han);
    // 포획 없이 종료 → 초기 보드 점수(72) 유지: han=72, cho=72+1.5=73.5
    expect(state.endScores.han).toBe(72);
    expect(state.endScores.cho).toBe(73.5);
  });

  // ── §10 50수 룰 ──────────────────────────────────────────────

  test('JR-C5-007: 50수 룰 — 비포획·비졸 이동 50회 → endReason:fifty_move (§10)', () => {
    // Given: 정상 게임. noCaptureOrSoldierMoves 카운터를 49로 강제 설정 후 비포획·비졸 이동 1회
    const state = createPlayingGame();
    state.noCaptureOrSoldierMoves = 49;
    // 동형반복 트리거 방지를 위해 history 비움
    state.repetitionHistory = new Map();
    // When: 한 마(1,0)→(2,2) 비포획·비졸 이동
    // MSMS 배치: (1,0)=마, (2,0)=상. 마(1,0)→(2,2). 멱(1,1)=비어있음? — 초기 보드에서 (1,1)은 빈 칸이므로 OK.
    const res = applyMove(state, 'han', 1, 0, 2, 2);
    // Then: 50수 도달 → 종료
    expect(res.ok).toBe(true);
    expect(state.phase).toBe('ended');
    expect(state.endReason).toBe('fifty_move');
  });

  test('JR-C5-008: 포획 시 noCaptureOrSoldierMoves 리셋 (§10)', () => {
    // Given: 게임 시작 후 카운터 강제 49. 한 진영이 잡을 수 있는 적 기물 배치
    const state = createPlayingGame();
    state.noCaptureOrSoldierMoves = 49;
    state.repetitionHistory = new Map();
    // 초 졸 (4,4) — 한 마(1,0)→(2,2) 후 다음 적 졸 잡기는 어려우니 강제로 보드 조작
    // 더 단순하게: 빈 보드에 한 차 + 적 졸 배치
    for (let r = 0; r < 10; r++) {
      for (let f = 0; f < 9; f++) setPiece(state.board, f, r, null);
    }
    setPiece(state.board, 4, 1, piece('king', 'han'));
    setPiece(state.board, 4, 8, piece('king', 'cho'));
    setPiece(state.board, 0, 5, piece('chariot', 'han'));
    setPiece(state.board, 3, 5, piece('soldier', 'cho')); // 잡힐 대상
    state.turn = 'han';
    state.repetitionHistory = new Map();
    // When: 한 차(0,5)→(3,5) 적 졸 포획
    const res = applyMove(state, 'han', 0, 5, 3, 5);
    // Then: 카운터 리셋
    expect(res.ok).toBe(true);
    expect(state.noCaptureOrSoldierMoves).toBe(0);
  });

  test('JR-C5-009: 졸 이동 시 noCaptureOrSoldierMoves 리셋 (§10)', () => {
    // Given: 카운터 49, 한 졸 이동 가능
    const state = createPlayingGame();
    state.noCaptureOrSoldierMoves = 49;
    state.repetitionHistory = new Map();
    // When: 한 졸(0,3)→(0,4)
    const res = applyMove(state, 'han', 0, 3, 0, 4);
    // Then: 리셋
    expect(res.ok).toBe(true);
    expect(state.noCaptureOrSoldierMoves).toBe(0);
  });

  test('JR-C5-010: 50수 종료 시 endScores 계산됨 + 덤 1.5 포함 (§7-2, §10)', () => {
    // Given
    const state = createPlayingGame();
    state.noCaptureOrSoldierMoves = 49;
    state.repetitionHistory = new Map();
    // When: 50번째 비졸·비포획 이동 (한 마(1,0)→(2,2), 포획 없음)
    applyMove(state, 'han', 1, 0, 2, 2);
    // Then: endScores 존재 + 룰북 §7-2 덤 1.5 적용 검증
    expect(state.endScores).not.toBeNull();
    expect(typeof state.endScores.han).toBe('number');
    expect(typeof state.endScores.cho).toBe('number');
    // 덤 1.5 검증: cho = (덤 미포함 점수) + DEOM
    const rawScores = calculateScore(state.board, false);
    expect(state.endScores.cho).toBe(rawScores.cho + DEOM);
    expect(state.endScores.cho - rawScores.cho).toBe(1.5);
    // 한은 덤 영향 없음
    expect(state.endScores.han).toBe(rawScores.han);
    // 포획 없이 종료 → 초기 보드 점수(72) 유지: han=72, cho=72+1.5=73.5
    expect(state.endScores.han).toBe(72);
    expect(state.endScores.cho).toBe(73.5);
  });

});
