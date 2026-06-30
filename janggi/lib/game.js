/**
 * @fileoverview GameSession 상태 관리. 턴, 시간, 종료 조건을 담당한다.
 * 룰북 #6 (한 수의 순서), #7 (승패 판정), #9 (시간 제한) 기준.
 *
 * 함수형 API: 상태 객체(GameState)를 인자로 받아 변경하고 결과를 반환한다.
 * GameSession 클래스 대신 순수 함수 + 상태 객체 패턴을 사용하여
 * 직렬화/복원이 단순하다.
 */

import {
  createInitialBoard, getPiece, movePiece, cloneBoard,
  boardHash, serialize, deserialize,
} from './board.js';
import { getLegalMoves } from './pieces.js';
import {
  isInCheck, wouldBeSelfCheck, isCheckmate,
  getAllLegalMoves, countRepetition, findKing,
} from './rules.js';
import { calculateScore, getScoreWinner } from './score.js';

// ── 상수 ──────────────────────────────────────────────────────────

/**
 * 표준 대국 시간 설정 (룰북 #9).
 */
export const TIME_CONFIG = {
  mainTimeSec: 600,      // 본 시간 10분
  byoyomiSec: 30,        // 초읽기 1회 시간
  byoyomiCount: 3,       // 초읽기 횟수
};

/** 유효한 배치 코드 목록. */
const VALID_SETUPS = ['MSMS', 'SMSM', 'MSSM', 'SMMS'];

/** 50수 룰 한계 (기물 포획/졸 이동 없이 N수 경과 시 점수제 종료). */
const FIFTY_MOVE_LIMIT = 50;

// ── GameState 생성 ───────────────────────────────────────────────

/**
 * 새 게임 세션 상태를 생성한다.
 * @returns {object} GameState 객체
 */
export function createGameSession() {
  return {
    /** @type {'setup_cho'|'setup_han'|'playing'|'ended'} */
    phase: 'setup_cho',
    /** @type {'han'|'cho'} 현재 차례 (playing 단계에서 사용) */
    turn: 'cho',
    /** @type {Array<Array<{type:string,side:string}|null>>|null} */
    board: null,
    /** @type {'MSMS'|'SMSM'|'MSSM'|'SMMS'|null} */
    choSetup: null,
    /** @type {'MSMS'|'SMSM'|'MSSM'|'SMMS'|null} */
    hanSetup: null,

    // 시간 관리
    hanTime: {
      mainSec: TIME_CONFIG.mainTimeSec,
      byoyomiSec: TIME_CONFIG.byoyomiSec,
      byoyomiLeft: TIME_CONFIG.byoyomiCount,
    },
    choTime: {
      mainSec: TIME_CONFIG.mainTimeSec,
      byoyomiSec: TIME_CONFIG.byoyomiSec,
      byoyomiLeft: TIME_CONFIG.byoyomiCount,
    },

    // 동형반복 기록
    /** @type {Map<string, number>} */
    repetitionHistory: new Map(),
    /** 50수 카운터: 기물 포획 또는 졸/병 이동이 없는 수 누적 */
    noCaptureOrSoldierMoves: 0,
    /** 총 수 카운터 */
    moveCount: 0,

    // 잡힌 기물 기록
    /** @type {Array<{type:string,side:string}>} 한이 잡은 기물 (초 기물) */
    capturedByHan: [],
    /** @type {Array<{type:string,side:string}>} 초가 잡은 기물 (한 기물) */
    capturedByCho: [],

    // 마지막 수 기록
    /** @type {{fromFile:number,fromRank:number,toFile:number,toRank:number}|null} */
    lastMove: null,

    // 종료 상태
    /** @type {'han'|'cho'|null} */
    winner: null,
    /** @type {string|null} 종료 이유: checkmate|resign|timeout|repetition|fifty_move */
    endReason: null,
    /** @type {{han:number, cho:number}|null} 점수제 종료 시 점수 */
    endScores: null,

    // 장군 상태
    /** @type {boolean} 현재 장군 상태인지 */
    inCheck: false,

    // 무승부 제안
    /** @type {'han'|'cho'|null} 무승부 제안자 */
    drawOfferedBy: null,
  };
}

// ── 배치 선택 ────────────────────────────────────────────────────

/**
 * 배치 선택을 처리한다 (룰북 #4-3).
 * 초가 먼저 선택, 그 후 한이 선택. 양측 선택 완료 시 보드를 생성한다.
 * @param {object} state GameState
 * @param {'han'|'cho'} side
 * @param {'MSMS'|'SMSM'|'MSSM'|'SMMS'} setupCode
 * @returns {{ ok: boolean, error?: string, nextPhase?: string, gameStarted?: boolean }}
 */
export function applySetupChoice(state, side, setupCode) {
  if (state.phase === 'ended') {
    return { ok: false, error: '게임이 이미 종료되었다' };
  }

  if (!VALID_SETUPS.includes(setupCode)) {
    return { ok: false, error: `유효하지 않은 배치 코드: ${setupCode}` };
  }

  // 초가 먼저 선택
  if (state.phase === 'setup_cho') {
    if (side !== 'cho') {
      return { ok: false, error: '초(楚)가 먼저 배치를 선택해야 한다' };
    }
    state.choSetup = setupCode;
    state.phase = 'setup_han';
    return { ok: true, nextPhase: 'setup_han' };
  }

  // 한 선택
  if (state.phase === 'setup_han') {
    if (side !== 'han') {
      return { ok: false, error: '한(漢)이 배치를 선택할 차례이다' };
    }
    state.hanSetup = setupCode;

    // 양측 선택 완료 -> 게임 시작
    startGame(state);
    return { ok: true, nextPhase: 'playing', gameStarted: true };
  }

  return { ok: false, error: '현재 배치 선택 단계가 아니다' };
}

/**
 * 양측 배치 완료 시 초기 보드를 생성하고 게임을 시작한다.
 * @param {object} state GameState
 */
function startGame(state) {
  state.board = createInitialBoard(state.hanSetup, state.choSetup);
  state.phase = 'playing';
  // 한(선수)이 먼저 둔다 (룰북 #6)
  state.turn = 'han';
  state.moveCount = 0;
  state.noCaptureOrSoldierMoves = 0;

  // 초기 보드 해시를 반복 기록에 등록
  const hash = boardHash(state.board, state.turn);
  countRepetition(state.repetitionHistory, hash);
}

// ── 기물 이동 ────────────────────────────────────────────────────

/**
 * 기물 이동을 처리한다. 서버 권위 검증 포함.
 * 검증 순서:
 *   1) 게임 진행 중 확인
 *   2) 차례 확인
 *   3) 기물 존재 및 소유 확인
 *   4) 합법 이동 범위 확인
 *   5) 자살수 검증
 * 검증 통과 시:
 *   보드 갱신 -> 잡힌 기물 처리 -> 50수 카운터 -> 동형반복 카운트
 *   -> 장군/외통수 판정 -> 턴 전환
 *
 * @param {object} state GameState
 * @param {'han'|'cho'} side
 * @param {number} fromFile
 * @param {number} fromRank
 * @param {number} toFile
 * @param {number} toRank
 * @returns {{ ok: boolean, error?: string, captured?: object, check?: boolean, checkmate?: boolean, gameOver?: boolean }}
 */
export function applyMove(state, side, fromFile, fromRank, toFile, toRank) {
  // 1) 게임 진행 중 확인
  if (state.phase !== 'playing') {
    return { ok: false, error: '게임이 진행 중이 아니다' };
  }

  // 2) 차례 확인
  if (state.turn !== side) {
    return { ok: false, error: '당신의 차례가 아니다' };
  }

  // 3) 기물 존재 및 소유 확인
  const piece = getPiece(state.board, fromFile, fromRank);
  if (!piece) {
    return { ok: false, error: '해당 위치에 기물이 없다' };
  }
  if (piece.side !== side) {
    return { ok: false, error: '자기 기물만 이동할 수 있다' };
  }

  // 4) 합법 이동 범위 확인
  const candidateMoves = getLegalMoves(state.board, fromFile, fromRank);
  const isValidTarget = candidateMoves.some(
    m => m.file === toFile && m.rank === toRank
  );
  if (!isValidTarget) {
    return { ok: false, error: '해당 위치로 이동할 수 없다' };
  }

  // 5) 자살수 검증 (룰북 #8-3)
  if (wouldBeSelfCheck(state.board, fromFile, fromRank, toFile, toRank)) {
    return { ok: false, error: '자살수는 둘 수 없다 (궁이 장군 상태가 된다)' };
  }

  // ── 이동 실행 ──
  const captured = movePiece(state.board, fromFile, fromRank, toFile, toRank);

  // 잡힌 기물 기록
  if (captured) {
    if (side === 'han') {
      state.capturedByHan.push(captured);
    } else {
      state.capturedByCho.push(captured);
    }
  }

  // 마지막 수 기록
  state.lastMove = { fromFile, fromRank, toFile, toRank };
  state.moveCount++;

  // ── 50수 카운터 갱신 ──
  const isSoldierMove = piece.type === 'soldier';
  if (captured || isSoldierMove) {
    state.noCaptureOrSoldierMoves = 0;
  } else {
    state.noCaptureOrSoldierMoves++;
  }

  // 무승부 제안 초기화 (수를 두면 제안 취소)
  state.drawOfferedBy = null;

  // ── 상대 진영 판정 ──
  const opponent = side === 'han' ? 'cho' : 'han';

  // 궁 포획 시 즉시 승리 (룰북 #7-1)
  if (captured && captured.type === 'king') {
    endGame(state, side, 'checkmate');
    return { ok: true, captured, check: false, checkmate: true, gameOver: true };
  }

  // ── 턴 전환 ──
  state.turn = opponent;

  // ── 동형반복 카운트 ──
  const hash = boardHash(state.board, state.turn);
  const rep = countRepetition(state.repetitionHistory, hash);
  if (rep.isThreefold) {
    // 동형반복 3회 -> 점수제 종료 (룰북 #7-4)
    const scores = calculateScore(state.board);
    const winner = getScoreWinner(scores);
    state.endScores = scores;
    endGame(state, winner, 'repetition');
    return { ok: true, captured, check: false, checkmate: false, gameOver: true };
  }

  // ── 50수 룰 검사 ──
  if (state.noCaptureOrSoldierMoves >= FIFTY_MOVE_LIMIT) {
    const scores = calculateScore(state.board);
    const winner = getScoreWinner(scores);
    state.endScores = scores;
    endGame(state, winner, 'fifty_move');
    return { ok: true, captured, check: false, checkmate: false, gameOver: true };
  }

  // ── 장군/외통수 판정 ──
  const check = isInCheck(state.board, opponent);
  state.inCheck = check;

  let checkmate = false;
  if (check) {
    checkmate = isCheckmate(state.board, opponent);
    if (checkmate) {
      endGame(state, side, 'checkmate');
      return { ok: true, captured, check: true, checkmate: true, gameOver: true };
    }
  }

  // P2-8: 스테일메이트 감지 — 비장군 + 합법수 0이면 못 두는 쪽 패
  if (!check) {
    const oppMoves = getAllLegalMoves(state.board, opponent);
    if (oppMoves.length === 0) {
      endGame(state, side, 'stalemate');
      return { ok: true, captured, check: false, checkmate: false, gameOver: true };
    }
  }

  // 초읽기 리셋: 수를 두면 초읽기 타이머 초기화
  resetByoyomiForTurn(state, side);

  return { ok: true, captured: captured || null, check, checkmate: false, gameOver: false };
}

// ── 기권 ────────────────────────────────────────────────────────

/**
 * 기권을 처리한다 (룰북 #7-1).
 * @param {object} state GameState
 * @param {'han'|'cho'} side 기권하는 쪽
 * @returns {{ ok: boolean }}
 */
export function applyResign(state, side) {
  if (state.phase === 'ended') {
    return { ok: false, error: '게임이 이미 종료되었다' };
  }

  const winner = side === 'han' ? 'cho' : 'han';
  endGame(state, winner, 'resign');
  return { ok: true };
}

// ── 무승부 제안 ──────────────────────────────────────────────────

/**
 * 무승부 제안을 처리한다 (양측 합의 시 점수제 종료).
 * @param {object} state GameState
 * @param {'han'|'cho'} side 행동자
 * @param {'offer'|'accept'|'reject'} action
 * @returns {{ ok: boolean, ended?: boolean, error?: string }}
 */
export function applyDrawOffer(state, side, action) {
  if (state.phase !== 'playing') {
    return { ok: false, error: '게임이 진행 중이 아니다' };
  }

  if (action === 'offer') {
    // P2-7: 자기 차례에만 무승부 제안 가능 (룰북 §8-7)
    if (state.turn !== side) {
      return { ok: false, error: '상대 차례에는 무승부 제안 불가' };
    }
    state.drawOfferedBy = side;
    return { ok: true, ended: false };
  }

  if (action === 'accept') {
    if (!state.drawOfferedBy || state.drawOfferedBy === side) {
      return { ok: false, error: '상대방의 무승부 제안이 없다' };
    }
    // 양측 합의 -> 점수제 종료
    const scores = calculateScore(state.board);
    const winner = getScoreWinner(scores);
    state.endScores = scores;
    endGame(state, winner, 'draw_score');
    return { ok: true, ended: true };
  }

  if (action === 'reject') {
    state.drawOfferedBy = null;
    return { ok: true, ended: false };
  }

  return { ok: false, error: `알 수 없는 action: ${action}` };
}

// ── 시간 관리 ────────────────────────────────────────────────────

/**
 * 서버 tick (1초마다 호출). 현재 차례의 시간을 감산하고 시간패 여부를 확인한다.
 * 본 시간 소진 후 초읽기로 전환, 초읽기 소진 시 시간패.
 * @param {object} state GameState
 * @returns {{ timedOut: boolean, loser?: 'han'|'cho' }}
 */
export function tickTimer(state) {
  if (state.phase !== 'playing') {
    return { timedOut: false };
  }

  const timeObj = state.turn === 'han' ? state.hanTime : state.choTime;

  if (timeObj.mainSec > 0) {
    // 본 시간 차감
    timeObj.mainSec--;
  } else {
    // 초읽기 차감
    timeObj.byoyomiSec--;

    if (timeObj.byoyomiSec <= 0) {
      timeObj.byoyomiLeft--;

      if (timeObj.byoyomiLeft <= 0) {
        // 모든 초읽기 소진 -> 시간패 (룰북 #7-1)
        const loser = state.turn;
        const winner = loser === 'han' ? 'cho' : 'han';
        endGame(state, winner, 'timeout');
        return { timedOut: true, loser };
      }

      // 다음 초읽기 시작
      timeObj.byoyomiSec = TIME_CONFIG.byoyomiSec;
    }
  }

  return { timedOut: false };
}

/**
 * 수를 둔 후 해당 측의 초읽기 타이머를 리셋한다.
 * 본 시간이 남아있으면 초읽기는 리셋 불필요. 초읽기 중이면 타이머만 리셋.
 * @param {object} state GameState
 * @param {'han'|'cho'} side 수를 둔 쪽
 */
function resetByoyomiForTurn(state, side) {
  const timeObj = side === 'han' ? state.hanTime : state.choTime;
  // 본 시간 소진 후 초읽기 중이면 타이머 리셋
  if (timeObj.mainSec <= 0 && timeObj.byoyomiLeft > 0) {
    timeObj.byoyomiSec = TIME_CONFIG.byoyomiSec;
  }
}

// ── 게임 종료 ────────────────────────────────────────────────────

/**
 * 게임을 종료 상태로 전환한다.
 * @param {object} state GameState
 * @param {'han'|'cho'} winner 승자
 * @param {string} reason 종료 이유
 */
function endGame(state, winner, reason) {
  state.phase = 'ended';
  state.winner = winner;
  state.endReason = reason;
}

// ── 직렬화 ──────────────────────────────────────────────────────

/**
 * GameState를 클라이언트 전송용 스냅샷으로 변환한다.
 * 내부 Map을 JSON 직렬화 가능한 형태로 정리한다.
 * @param {object} state GameState
 * @returns {object} 직렬화된 상태 스냅샷
 */
export function serializeState(state) {
  return {
    phase: state.phase,
    turn: state.turn,
    board: state.board ? serialize(state.board) : null,
    choSetup: state.choSetup,
    hanSetup: state.hanSetup,
    hanTime: { ...state.hanTime },
    choTime: { ...state.choTime },
    capturedByHan: [...state.capturedByHan],
    capturedByCho: [...state.capturedByCho],
    lastMove: state.lastMove ? { ...state.lastMove } : null,
    moveCount: state.moveCount,
    winner: state.winner,
    endReason: state.endReason,
    endScores: state.endScores ? { ...state.endScores } : null,
    inCheck: state.inCheck,
    drawOfferedBy: state.drawOfferedBy,
  };
}
