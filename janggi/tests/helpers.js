/**
 * @fileoverview 장기 Playwright QA 테스트 헬퍼 모듈.
 * 보드 상태 직접 구성, WS 클라이언트 접속, 배치 선택 자동화 등을 제공한다.
 */

import {
  createBoard, createInitialBoard, getPiece, setPiece,
  cloneBoard, boardHash, inBounds, inPalace, isPalaceDiagonal,
} from '../lib/board.js';
import { getLegalMoves } from '../lib/pieces.js';
import {
  isInCheck, wouldBeSelfCheck, isCheckmate,
  getAllLegalMoves, findKing, countRepetition,
} from '../lib/rules.js';
import { calculateScore, getScoreWinner, PIECE_SCORE, DEOM } from '../lib/score.js';
import {
  createGameSession, applySetupChoice, applyMove,
  applyResign, applyDrawOffer, tickTimer, serializeState,
  TIME_CONFIG,
} from '../lib/game.js';

// ── 기물 생성 헬퍼 ──────────────────────────────────────────────────

/**
 * 기물 객체를 간편하게 생성한다.
 * @param {string} type 기물 유형 (king, advisor, chariot, cannon, horse, elephant, soldier)
 * @param {'han'|'cho'} side 진영
 * @returns {{ type: string, side: 'han'|'cho' }}
 */
export function piece(type, side) {
  return { type, side };
}

// ── 보드 구성 헬퍼 ──────────────────────────────────────────────────

/**
 * 빈 보드에 지정된 기물들을 배치한다.
 * @param {Array<{ file: number, rank: number, type: string, side: 'han'|'cho' }>} placements
 * @returns {Array<Array<{type:string,side:string}|null>>}
 */
export function buildBoard(placements) {
  const board = createBoard();
  for (const { file, rank, type, side } of placements) {
    setPiece(board, file, rank, piece(type, side));
  }
  return board;
}

/**
 * 기본 게임 세션을 생성하고 양측 배치를 완료하여 playing 상태로 만든다.
 * @param {'MSMS'|'SMSM'|'MSSM'|'SMMS'} [hanSetup='MSMS']
 * @param {'MSMS'|'SMSM'|'MSSM'|'SMMS'} [choSetup='MSMS']
 * @returns {object} GameState (phase === 'playing')
 */
export function createPlayingGame(hanSetup = 'MSMS', choSetup = 'MSMS') {
  const state = createGameSession();
  applySetupChoice(state, 'cho', choSetup);
  applySetupChoice(state, 'han', hanSetup);
  return state;
}

// ── 보드 카운트 헬퍼 ─────────────────────────────────────────────────

/**
 * 보드 위 기물 수를 세어 반환한다.
 * @param {Array<Array<{type:string,side:string}|null>>} board
 * @returns {{ total: number, han: number, cho: number }}
 */
export function countPieces(board) {
  let total = 0, han = 0, cho = 0;
  for (let r = 0; r < 10; r++) {
    for (let f = 0; f < 9; f++) {
      const p = getPiece(board, f, r);
      if (p) {
        total++;
        if (p.side === 'han') han++;
        else cho++;
      }
    }
  }
  return { total, han, cho };
}

// ── 합법 수 필터 (자살수 제외) ───────────────────────────────────────

/**
 * 자살수를 제외한 최종 합법 수 목록을 반환한다.
 * @param {*} board
 * @param {number} file
 * @param {number} rank
 * @returns {Array<{file:number, rank:number}>}
 */
export function getFilteredMoves(board, file, rank) {
  const moves = getLegalMoves(board, file, rank);
  return moves.filter(m => !wouldBeSelfCheck(board, file, rank, m.file, m.rank));
}

// ── re-export ─────────────────────────────────────────────────────

export {
  createBoard, createInitialBoard, getPiece, setPiece,
  cloneBoard, boardHash, inBounds, inPalace, isPalaceDiagonal,
  getLegalMoves,
  isInCheck, wouldBeSelfCheck, isCheckmate,
  getAllLegalMoves, findKing, countRepetition,
  calculateScore, getScoreWinner, PIECE_SCORE, DEOM,
  createGameSession, applySetupChoice, applyMove,
  applyResign, applyDrawOffer, tickTimer, serializeState,
  TIME_CONFIG,
};
