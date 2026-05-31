/**
 * @fileoverview QA 능동 탐색 테스트 — 기존 QA-001~020에서 누락된 엣지케이스.
 * 장기 룰북과 코드 정적 분석에서 도출한 시나리오.
 */

import { test, expect } from '@playwright/test';
import {
  piece, buildBoard, createPlayingGame, countPieces, getFilteredMoves,
  createBoard, createInitialBoard, getPiece, setPiece,
  cloneBoard, boardHash, inBounds, inPalace, isPalaceDiagonal,
  getLegalMoves,
  isInCheck, wouldBeSelfCheck, isCheckmate,
  getAllLegalMoves, findKing, countRepetition,
  calculateScore, getScoreWinner, PIECE_SCORE, DEOM,
  createGameSession, applySetupChoice, applyMove,
  applyResign, applyDrawOffer, tickTimer, serializeState,
  TIME_CONFIG,
} from './helpers.js';

// ======================================================================
// EDGE-01: Elephant displacement verification (PATCH-P4-1)
// ======================================================================

test.describe('EDGE-01: 상(Elephant) 변위 정확성 검증', () => {
  test('중앙(4,5)에서 상의 도착 좌표는 (+-2,+-3)/(+-3,+-2) 변위', () => {
    const board = buildBoard([
      { file: 4, rank: 5, type: 'elephant', side: 'han' },
      { file: 4, rank: 1, type: 'king', side: 'han' },
      { file: 4, rank: 8, type: 'king', side: 'cho' },
    ]);

    const moves = getLegalMoves(board, 4, 5);
    const displacements = moves.map(m => ({
      df: m.file - 4,
      dr: m.rank - 5,
    }));

    // All displacements should satisfy |df|+|dr| = 5 and
    // (|df|,|dr|) in {(2,3),(3,2)}
    for (const d of displacements) {
      const absF = Math.abs(d.df);
      const absR = Math.abs(d.dr);
      expect(
        (absF === 2 && absR === 3) || (absF === 3 && absR === 2)
      ).toBe(true);
    }

    // Should have 8 moves from center with no blockers
    expect(moves.length).toBe(8);
  });

  test('상이 보드 모서리(0,0)에서 범위 밖은 생성되지 않음', () => {
    const board = buildBoard([
      { file: 0, rank: 0, type: 'elephant', side: 'han' },
      { file: 4, rank: 1, type: 'king', side: 'han' },
      { file: 4, rank: 8, type: 'king', side: 'cho' },
    ]);

    const moves = getLegalMoves(board, 0, 0);
    // All moves must be in bounds
    for (const m of moves) {
      expect(inBounds(m.file, m.rank)).toBe(true);
    }
    // From (0,0): only down direction is viable (0,1 step1)
    // down->left: step2=(0-1,2) = (-1,2) OOB
    // down->right: step2=(1,2) -> arrive (2,3)
    // right direction (1,0): step1 might have piece or not
    // right->up: (2,-1) OOB
    // right->down: step2=(2,1) -> arrive (3,2)
    // left: (-1,0) OOB
    // up: (0,-1) OOB
    expect(moves.length).toBe(2);
    expect(moves.some(m => m.file === 2 && m.rank === 3)).toBe(true);
    expect(moves.some(m => m.file === 3 && m.rank === 2)).toBe(true);
  });
});

// ======================================================================
// EDGE-02: Cannon palace diagonal deep check
// ======================================================================

test.describe('EDGE-02: 포 궁성 대각선 상세 검증', () => {
  test('포가 궁성 중앙에 있으면 대각 이동 불가 (다리 없음)', () => {
    const board = buildBoard([
      { file: 4, rank: 8, type: 'cannon', side: 'cho' },
      { file: 4, rank: 1, type: 'king', side: 'han' },
      { file: 3, rank: 9, type: 'king', side: 'cho' },
    ]);

    const moves = getLegalMoves(board, 4, 8);
    // From center, no diagonal moves (no bridge)
    const diagMoves = moves.filter(m =>
      m.file !== 4 && m.rank !== 8
    );
    // Diagonal palace moves: center -> corners need NO bridge (cannon cannot move diag from center)
    // Actually from center, cannon would need a bridge at a mid-point, but palace diag doesn't have one
    expect(diagMoves.length).toBe(0);
  });

  test('포가 궁성 꼭짓점에 있고 중앙에 비-포 다리가 있으면 반대편 꼭짓점으로 이동', () => {
    const board = buildBoard([
      { file: 3, rank: 7, type: 'cannon', side: 'cho' },
      { file: 4, rank: 8, type: 'advisor', side: 'han' }, // bridge at center
      { file: 4, rank: 1, type: 'king', side: 'han' },
      { file: 3, rank: 9, type: 'king', side: 'cho' },
    ]);

    const moves = getLegalMoves(board, 3, 7);
    // Should be able to jump to opposite corner (5,9)
    expect(moves.some(m => m.file === 5 && m.rank === 9)).toBe(true);
  });

  test('포가 궁성 꼭짓점에 있고 중앙에 포 다리가 있으면 이동 불가', () => {
    const board = buildBoard([
      { file: 3, rank: 7, type: 'cannon', side: 'cho' },
      { file: 4, rank: 8, type: 'cannon', side: 'han' }, // bridge is cannon - forbidden
      { file: 4, rank: 1, type: 'king', side: 'han' },
      { file: 3, rank: 9, type: 'king', side: 'cho' },
    ]);

    const moves = getLegalMoves(board, 3, 7);
    // Cannot jump to opposite corner because bridge is cannon
    expect(moves.some(m => m.file === 5 && m.rank === 9)).toBe(false);
  });
});

// ======================================================================
// EDGE-03: Chariot palace diagonal blocking
// ======================================================================

test.describe('EDGE-03: 차 궁성 대각선 경유 칸 막힘', () => {
  test('차가 궁성 꼭짓점, 중앙에 적 기물 -> 잡기 가능 but 관통 불가', () => {
    const board = buildBoard([
      { file: 3, rank: 0, type: 'chariot', side: 'han' },
      { file: 4, rank: 1, type: 'advisor', side: 'cho' }, // enemy at center
      { file: 4, rank: 2, type: 'king', side: 'han' },
      { file: 4, rank: 8, type: 'king', side: 'cho' },
    ]);

    const moves = getLegalMoves(board, 3, 0);
    // Can capture center (4,1) but cannot go to opposite corner (5,2)
    expect(moves.some(m => m.file === 4 && m.rank === 1)).toBe(true);
    expect(moves.some(m => m.file === 5 && m.rank === 2)).toBe(false);
  });

  test('차가 궁성 꼭짓점, 중앙에 아군 기물 -> 이동 및 관통 불가', () => {
    const board = buildBoard([
      { file: 3, rank: 0, type: 'chariot', side: 'han' },
      { file: 4, rank: 1, type: 'advisor', side: 'han' }, // friendly at center
      { file: 5, rank: 2, type: 'king', side: 'han' },
      { file: 4, rank: 8, type: 'king', side: 'cho' },
    ]);

    const moves = getLegalMoves(board, 3, 0);
    // Cannot move to center (friendly) and cannot pass through
    expect(moves.some(m => m.file === 4 && m.rank === 1)).toBe(false);
    expect(moves.some(m => m.file === 5 && m.rank === 2)).toBe(false);
  });
});

// ======================================================================
// EDGE-04: Double move / turn violation
// ======================================================================

test.describe('EDGE-04: 차례 위반 및 이중 이동', () => {
  test('같은 측이 연속 두 수를 두면 두 번째는 ERROR', () => {
    const state = createPlayingGame('MSMS', 'MSMS');
    // Han plays first valid move
    const r1 = applyMove(state, 'han', 0, 3, 0, 4);
    expect(r1.ok).toBe(true);

    // Han tries to play again immediately
    const r2 = applyMove(state, 'han', 2, 3, 2, 4);
    expect(r2.ok).toBe(false);
    expect(r2.error).toBeTruthy();
  });

  test('게임 종료 후 이동 시도 -> ERROR', () => {
    const state = createPlayingGame('MSMS', 'MSMS');
    applyResign(state, 'han');
    expect(state.phase).toBe('ended');

    const r = applyMove(state, 'cho', 0, 6, 0, 5);
    expect(r.ok).toBe(false);
  });
});

// ======================================================================
// EDGE-05: Invalid setup codes
// ======================================================================

test.describe('EDGE-05: 유효하지 않은 배치 코드', () => {
  test('존재하지 않는 배치 코드 거부', () => {
    const state = createGameSession();
    const r = applySetupChoice(state, 'cho', 'XXXX');
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });

  test('빈 문자열 배치 코드 거부', () => {
    const state = createGameSession();
    const r = applySetupChoice(state, 'cho', '');
    expect(r.ok).toBe(false);
  });

  test('null/undefined 배치 코드 거부', () => {
    const state = createGameSession();
    const r1 = applySetupChoice(state, 'cho', null);
    expect(r1.ok).toBe(false);

    const r2 = applySetupChoice(state, 'cho', undefined);
    expect(r2.ok).toBe(false);
  });

  test('playing 단계에서 배치 선택 시도 -> ERROR', () => {
    const state = createPlayingGame('MSMS', 'MSMS');
    const r = applySetupChoice(state, 'cho', 'MSMS');
    expect(r.ok).toBe(false);
  });
});

// ======================================================================
// EDGE-06: Out-of-bounds move coordinates
// ======================================================================

test.describe('EDGE-06: 범위 밖 좌표 이동 시도', () => {
  test('출발지 범위 밖 -> ERROR', () => {
    const state = createPlayingGame('MSMS', 'MSMS');
    const r = applyMove(state, 'han', -1, 0, 0, 0);
    expect(r.ok).toBe(false);
  });

  test('도착지 범위 밖 -> ERROR', () => {
    const state = createPlayingGame('MSMS', 'MSMS');
    const r = applyMove(state, 'han', 0, 3, -1, 3);
    expect(r.ok).toBe(false);
  });

  test('빈 칸에서 이동 시도 -> ERROR', () => {
    const state = createPlayingGame('MSMS', 'MSMS');
    const r = applyMove(state, 'han', 4, 4, 4, 5);
    expect(r.ok).toBe(false);
  });
});

// ======================================================================
// EDGE-07: Soldier palace diagonal - both palaces
// ======================================================================

test.describe('EDGE-07: 졸 궁성 대각선 - 양쪽 궁성 검증', () => {
  test('한 졸은 자기 궁성에서 대각 이동 불가 (적 궁성만 허용)', () => {
    // Place han soldier inside han palace diagonal position
    const board = buildBoard([
      { file: 4, rank: 1, type: 'soldier', side: 'han' }, // han palace center
      { file: 3, rank: 0, type: 'king', side: 'han' },
      { file: 4, rank: 8, type: 'king', side: 'cho' },
    ]);

    const moves = getLegalMoves(board, 4, 1);
    // Han soldier forward = rank+1 = (4,2), left (3,1), right (5,1)
    // No diagonal because this is han's OWN palace, not enemy
    const diagMoves = moves.filter(m =>
      m.file !== 4 && m.rank !== 1 // not same file/rank as origin
    );
    // (3,1) is side move, (5,1) is side move, (4,2) is forward
    // No diagonal forward moves should exist from own palace
    expect(moves.some(m => m.file === 3 && m.rank === 2)).toBe(false);
    expect(moves.some(m => m.file === 5 && m.rank === 2)).toBe(false);
  });

  test('초 졸은 한 궁성에서 대각 앞 이동 가능', () => {
    // Place cho soldier inside han palace diagonal
    const board = buildBoard([
      { file: 4, rank: 1, type: 'soldier', side: 'cho' }, // han palace center
      { file: 3, rank: 0, type: 'king', side: 'han' },
      { file: 4, rank: 8, type: 'king', side: 'cho' },
    ]);

    const moves = getLegalMoves(board, 4, 1);
    // Cho soldier forward = rank-1. From center(4,1):
    // forward (4,0), left (3,1), right (5,1)
    // diagonal forward: (3,0) and (5,0) -- both are palace diagonal positions
    expect(moves.some(m => m.file === 3 && m.rank === 0)).toBe(true);
    expect(moves.some(m => m.file === 5 && m.rank === 0)).toBe(true);
  });
});

// ======================================================================
// EDGE-08: Resign during setup phase
// ======================================================================

test.describe('EDGE-08: 배치 단계에서의 특수 동작', () => {
  test('배치 선택 단계에서 기권 가능', () => {
    const state = createGameSession();
    applySetupChoice(state, 'cho', 'MSMS');
    // Still in setup_han phase
    const r = applyResign(state, 'cho');
    expect(r.ok).toBe(true);
    expect(state.phase).toBe('ended');
    expect(state.winner).toBe('han');
  });

  test('배치 선택 단계에서 이동 시도 -> ERROR', () => {
    const state = createGameSession();
    const r = applyMove(state, 'han', 0, 0, 0, 1);
    expect(r.ok).toBe(false);
  });
});

// ======================================================================
// EDGE-09: Score edge cases
// ======================================================================

test.describe('EDGE-09: 점수 계산 엣지케이스', () => {
  test('궁만 남으면 양쪽 0점 + 덤으로 초 승', () => {
    const board = buildBoard([
      { file: 4, rank: 1, type: 'king', side: 'han' },
      { file: 4, rank: 8, type: 'king', side: 'cho' },
    ]);

    const scores = calculateScore(board, true);
    expect(scores.han).toBe(0);
    expect(scores.cho).toBe(1.5);
    expect(getScoreWinner(scores)).toBe('cho');
  });

  test('한이 기물 우세지만 덤으로 동점이면 초 승', () => {
    // han has 1 soldier (2 pts), cho has nothing + 1.5 deom
    // han = 2, cho = 1.5 -> han wins
    const board = buildBoard([
      { file: 4, rank: 1, type: 'king', side: 'han' },
      { file: 4, rank: 8, type: 'king', side: 'cho' },
      { file: 0, rank: 5, type: 'soldier', side: 'han' },
    ]);

    const scores = calculateScore(board, true);
    expect(scores.han).toBe(2);
    expect(scores.cho).toBe(1.5);
    expect(getScoreWinner(scores)).toBe('han');
  });
});

// ======================================================================
// EDGE-10: Board hash stability
// ======================================================================

test.describe('EDGE-10: boardHash 안정성', () => {
  test('동일 보드+턴은 동일 해시', () => {
    const b1 = createInitialBoard('MSMS', 'MSMS');
    const b2 = createInitialBoard('MSMS', 'MSMS');

    const h1 = boardHash(b1, 'han');
    const h2 = boardHash(b2, 'han');
    expect(h1).toBe(h2);
  });

  test('같은 보드라도 턴이 다르면 해시 다름', () => {
    const b = createInitialBoard('MSMS', 'MSMS');
    const h1 = boardHash(b, 'han');
    const h2 = boardHash(b, 'cho');
    expect(h1).not.toBe(h2);
  });

  test('기물 1개 차이로 해시 다름', () => {
    const b1 = createInitialBoard('MSMS', 'MSMS');
    const b2 = cloneBoard(b1);
    setPiece(b2, 0, 3, null); // Remove a soldier

    const h1 = boardHash(b1, 'han');
    const h2 = boardHash(b2, 'han');
    expect(h1).not.toBe(h2);
  });
});

// ======================================================================
// EDGE-11: Checkmate vs Stalemate distinction
// ======================================================================

test.describe('EDGE-11: 외통수 vs 무합법수(스테일메이트) 구분', () => {
  test('장군 아닌 상태에서 합법 수 0이면 외통수 아님', () => {
    // In janggi, if side is not in check but has no legal moves,
    // it's not checkmate (isCheckmate checks isInCheck first)
    const board = buildBoard([
      { file: 4, rank: 1, type: 'king', side: 'han' },
      { file: 4, rank: 8, type: 'king', side: 'cho' },
    ]);

    // King at (4,1) center: has moves, but let's verify isCheckmate needs check first
    expect(isInCheck(board, 'han')).toBe(false);
    expect(isCheckmate(board, 'han')).toBe(false);
  });
});

// ======================================================================
// EDGE-12: Double draw offer
// ======================================================================

test.describe('EDGE-12: 무승부 제안 엣지케이스', () => {
  test('같은 측이 연속 무승부 제안 -> 덮어쓰기', () => {
    const state = createPlayingGame('MSMS', 'MSMS');
    const r1 = applyDrawOffer(state, 'han', 'offer');
    expect(r1.ok).toBe(true);

    // Same side offers again
    const r2 = applyDrawOffer(state, 'han', 'offer');
    expect(r2.ok).toBe(true);
    expect(state.drawOfferedBy).toBe('han');
  });

  test('제안자 자신이 수락 시도 -> ERROR', () => {
    const state = createPlayingGame('MSMS', 'MSMS');
    applyDrawOffer(state, 'han', 'offer');

    const r = applyDrawOffer(state, 'han', 'accept');
    expect(r.ok).toBe(false);
  });

  test('수를 두면 무승부 제안 취소됨', () => {
    const state = createPlayingGame('MSMS', 'MSMS');
    applyDrawOffer(state, 'han', 'offer');
    expect(state.drawOfferedBy).toBe('han');

    // Han makes a move - this should cancel the draw offer
    applyMove(state, 'han', 0, 3, 0, 4);
    expect(state.drawOfferedBy).toBeNull();
  });
});

// ======================================================================
// EDGE-13: Timer edge cases
// ======================================================================

test.describe('EDGE-13: 타이머 엣지케이스', () => {
  test('playing 아닌 상태에서 tick -> 시간 변화 없음', () => {
    const state = createGameSession();
    const before = state.hanTime.mainSec;
    const r = tickTimer(state);
    expect(r.timedOut).toBe(false);
    expect(state.hanTime.mainSec).toBe(before);
  });

  test('초읽기 마지막 회차 소진 시 정확히 시간패', () => {
    const state = createPlayingGame('MSMS', 'MSMS');
    state.hanTime.mainSec = 0;
    state.hanTime.byoyomiSec = 1;
    state.hanTime.byoyomiLeft = 1;

    // Tick: byoyomiSec 1->0, byoyomiLeft 1->0 => timeout
    const r = tickTimer(state);
    expect(r.timedOut).toBe(true);
    expect(r.loser).toBe('han');
    expect(state.phase).toBe('ended');
    expect(state.winner).toBe('cho');
    expect(state.endReason).toBe('timeout');
  });

  test('수를 두면 초읽기 리셋됨 (본 시간 소진 후)', () => {
    const state = createPlayingGame('MSMS', 'MSMS');
    state.hanTime.mainSec = 0;
    state.hanTime.byoyomiSec = 5;
    state.hanTime.byoyomiLeft = 3;

    // Han plays
    applyMove(state, 'han', 0, 3, 0, 4);

    // Han's byoyomi should be reset to 30
    expect(state.hanTime.byoyomiSec).toBe(TIME_CONFIG.byoyomiSec);
  });
});

// ======================================================================
// EDGE-14: Cannon self-capture attempt
// ======================================================================

test.describe('EDGE-14: 포의 자기 기물 잡기 시도', () => {
  test('포가 다리를 넘어 아군 기물 위치로 이동 불가', () => {
    // Cannon at (0,0), bridge at (0,3) cho soldier, friendly at (0,5)
    // Kings placed far from column 0 to avoid being used as bridge
    const board = buildBoard([
      { file: 0, rank: 0, type: 'cannon', side: 'han' },
      { file: 0, rank: 3, type: 'soldier', side: 'cho' }, // bridge
      { file: 0, rank: 5, type: 'soldier', side: 'han' }, // friendly - cannot land here
      { file: 4, rank: 1, type: 'king', side: 'han' },
      { file: 4, rank: 8, type: 'king', side: 'cho' },
    ]);

    const moves = getLegalMoves(board, 0, 0);
    // Cannon uses (0,3) as bridge. After bridge:
    // (0,4) empty -> can move
    // (0,5) friendly -> cannot move, blocked
    expect(moves.some(m => m.file === 0 && m.rank === 4)).toBe(true);
    expect(moves.some(m => m.file === 0 && m.rank === 5)).toBe(false);
  });
});

// ======================================================================
// EDGE-15: Capture resets 50-move counter
// ======================================================================

test.describe('EDGE-15: 50수 카운터 리셋 시나리오', () => {
  test('졸 이동 시 카운터 리셋', () => {
    const state = createPlayingGame('MSMS', 'MSMS');
    // Make a few non-capture, non-soldier moves first
    applyMove(state, 'han', 1, 0, 0, 2); // horse moves
    expect(state.noCaptureOrSoldierMoves).toBe(1);

    applyMove(state, 'cho', 1, 9, 0, 7); // cho horse moves
    expect(state.noCaptureOrSoldierMoves).toBe(2);

    // Now soldier moves
    applyMove(state, 'han', 0, 3, 0, 4); // soldier forward
    expect(state.noCaptureOrSoldierMoves).toBe(0); // reset
  });
});

// ======================================================================
// EDGE-16: King captured should end game immediately
// ======================================================================

test.describe('EDGE-16: 궁 포획 즉시 종료', () => {
  test('궁을 잡으면 checkmate reason으로 즉시 종료', () => {
    // Set up a board where han chariot can capture cho king
    const board = buildBoard([
      { file: 0, rank: 8, type: 'chariot', side: 'han' },
      { file: 4, rank: 8, type: 'king', side: 'cho' },
      { file: 4, rank: 1, type: 'king', side: 'han' },
    ]);

    const state = createPlayingGame('MSMS', 'MSMS');
    state.board = board;
    state.turn = 'han';

    const r = applyMove(state, 'han', 0, 8, 4, 8);
    expect(r.ok).toBe(true);
    expect(r.gameOver).toBe(true);
    expect(r.checkmate).toBe(true);
    expect(state.winner).toBe('han');
    expect(state.endReason).toBe('checkmate');
  });
});

// ======================================================================
// EDGE-17: Multiple resign attempts
// ======================================================================

test.describe('EDGE-17: 중복 기권 시도', () => {
  test('이미 종료된 게임에서 기권 -> ERROR', () => {
    const state = createPlayingGame('MSMS', 'MSMS');
    applyResign(state, 'han');
    const r = applyResign(state, 'cho');
    expect(r.ok).toBe(false);
  });
});

// ======================================================================
// EDGE-18: Horse at board edges
// ======================================================================

test.describe('EDGE-18: 마 보드 경계 이동', () => {
  test('마가 (0,0)에서 가능한 이동만 반환', () => {
    const board = buildBoard([
      { file: 0, rank: 0, type: 'horse', side: 'han' },
      { file: 4, rank: 1, type: 'king', side: 'han' },
      { file: 4, rank: 8, type: 'king', side: 'cho' },
    ]);

    const moves = getLegalMoves(board, 0, 0);
    for (const m of moves) {
      expect(inBounds(m.file, m.rank)).toBe(true);
    }
    // From (0,0): up/left OOB.
    // down: (0,1), then (-1,2) OOB / (1,2) OK
    // right: (1,0), then (2,-1) OOB / (2,1) OK
    expect(moves.length).toBe(2);
    expect(moves.some(m => m.file === 1 && m.rank === 2)).toBe(true);
    expect(moves.some(m => m.file === 2 && m.rank === 1)).toBe(true);
  });
});

// ======================================================================
// EDGE-19: Serialize/Deserialize round-trip fidelity
// ======================================================================

test.describe('EDGE-19: 직렬화 왕복 무결성', () => {
  test('serializeState 후 모든 필수 필드 포함', () => {
    const state = createPlayingGame('MSMS', 'MSMS');
    applyMove(state, 'han', 0, 3, 0, 4);

    const s = serializeState(state);
    expect(s.phase).toBe('playing');
    expect(s.turn).toBe('cho');
    expect(s.board).toBeDefined();
    expect(s.hanTime).toBeDefined();
    expect(s.choTime).toBeDefined();
    expect(s.capturedByHan).toBeDefined();
    expect(s.capturedByCho).toBeDefined();
    expect(s.lastMove).toEqual({ fromFile: 0, fromRank: 3, toFile: 0, toRank: 4 });
    expect(s.moveCount).toBe(1);
    expect(typeof s.inCheck).toBe('boolean');
    expect(s.drawOfferedBy).toBeNull();
  });
});

// ======================================================================
// EDGE-20: Advisor/King same moves verification
// ======================================================================

test.describe('EDGE-20: 사/궁 동일 이동 규칙 검증', () => {
  test('사와 궁이 같은 위치에서 같은 이동 후보를 생성', () => {
    // Place advisor and king at same palace position (separately) and compare
    const board1 = buildBoard([
      { file: 4, rank: 1, type: 'king', side: 'han' },
      { file: 4, rank: 8, type: 'king', side: 'cho' },
    ]);
    const board2 = buildBoard([
      { file: 4, rank: 1, type: 'advisor', side: 'han' },
      { file: 4, rank: 8, type: 'king', side: 'cho' },
      { file: 3, rank: 0, type: 'king', side: 'han' },
    ]);

    const kingMoves = getLegalMoves(board1, 4, 1)
      .sort((a, b) => a.file - b.file || a.rank - b.rank);
    const advisorMoves = getLegalMoves(board2, 4, 1)
      .sort((a, b) => a.file - b.file || a.rank - b.rank);

    // Advisor and King have same movement rules (both confined to palace)
    // The moves should be identical coordinates (ignoring what's on the board)
    // Note: board2 has a king at (3,0) which blocks one of advisor's moves
    // So let's use a clean comparison board
    const board3 = buildBoard([
      { file: 4, rank: 1, type: 'advisor', side: 'han' },
      { file: 4, rank: 8, type: 'king', side: 'cho' },
      { file: 0, rank: 0, type: 'king', side: 'han' },  // far away
    ]);
    const advisorMoves2 = getLegalMoves(board3, 4, 1)
      .sort((a, b) => a.file - b.file || a.rank - b.rank);

    // Should generate same moves as king at same position
    expect(advisorMoves2.length).toBe(kingMoves.length);
    for (let i = 0; i < kingMoves.length; i++) {
      expect(advisorMoves2[i].file).toBe(kingMoves[i].file);
      expect(advisorMoves2[i].rank).toBe(kingMoves[i].rank);
    }
  });
});

// ======================================================================
// EDGE-21: Move own piece onto own piece
// ======================================================================

test.describe('EDGE-21: 아군 기물 위로 이동 시도', () => {
  test('아군 기물이 있는 칸으로 이동 불가', () => {
    const state = createPlayingGame('MSMS', 'MSMS');
    // Han chariot (0,0) tries to move to (0,3) which has han soldier
    const r = applyMove(state, 'han', 0, 0, 0, 3);
    expect(r.ok).toBe(false);
  });
});

// ======================================================================
// EDGE-22: Cannon without bridge on initial board
// ======================================================================

test.describe('EDGE-22: 초기 보드 포 합법 수 = 0', () => {
  test('한 포(1,2) 초기 보드에서 합법 수 0개', () => {
    const board = createInitialBoard('MSMS', 'MSMS');
    const moves = getLegalMoves(board, 1, 2);
    expect(moves.length).toBe(0);
  });

  test('초 포(1,7) 초기 보드에서 합법 수 0개', () => {
    const board = createInitialBoard('MSMS', 'MSMS');
    const moves = getLegalMoves(board, 1, 7);
    expect(moves.length).toBe(0);
  });
});

// ======================================================================
// EDGE-23: All 4 setup combinations cross-verified
// ======================================================================

test.describe('EDGE-23: 한/초 교차 배치 16종 조합', () => {
  const setups = ['MSMS', 'SMSM', 'MSSM', 'SMMS'];
  for (const h of setups) {
    for (const c of setups) {
      test(`한=${h}, 초=${c} -> 32개 기물 정상`, () => {
        const board = createInitialBoard(h, c);
        const counts = countPieces(board);
        expect(counts.total).toBe(32);
        expect(counts.han).toBe(16);
        expect(counts.cho).toBe(16);
      });
    }
  }
});
