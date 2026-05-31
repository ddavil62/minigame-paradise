/**
 * @fileoverview 장군, 외통수, 자살수, 동형반복 판정 모듈.
 * 룰북 #7 (승패 판정), #8 (특수 규칙) 기준.
 */

import { getPiece, cloneBoard, movePiece, inBounds } from './board.js';
import { getLegalMoves } from './pieces.js';

// ── 상수 ──────────────────────────────────────────────────────────

/** 보드 크기. */
const NUM_FILES = 9;
const NUM_RANKS = 10;

// ── 궁 찾기 ──────────────────────────────────────────────────────

/**
 * 지정 진영의 궁 좌표를 반환한다.
 * @param {Array<Array<{type:string,side:string}|null>>} board
 * @param {'han'|'cho'} side
 * @returns {{file:number, rank:number}|null} 궁 좌표 또는 null (궁이 없으면)
 */
export function findKing(board, side) {
  for (let r = 0; r < NUM_RANKS; r++) {
    for (let f = 0; f < NUM_FILES; f++) {
      const p = board[r][f];
      if (p && p.type === 'king' && p.side === side) {
        return { file: f, rank: r };
      }
    }
  }
  return null;
}

// ── 장군 판정 ────────────────────────────────────────────────────

/**
 * 주어진 side의 궁이 현재 장군 상태인지 판정한다 (룰북 #8-4).
 * 상대 기물의 getLegalMoves() 범위에 자신의 궁이 포함되면 장군.
 * @param {Array<Array<{type:string,side:string}|null>>} board
 * @param {'han'|'cho'} side 장군 여부를 확인할 진영
 * @returns {boolean}
 */
export function isInCheck(board, side) {
  const king = findKing(board, side);
  if (!king) return false; // 궁이 없으면 (이미 잡힌 경우)

  const opponent = side === 'han' ? 'cho' : 'han';

  for (let r = 0; r < NUM_RANKS; r++) {
    for (let f = 0; f < NUM_FILES; f++) {
      const p = board[r][f];
      if (p && p.side === opponent) {
        const moves = getLegalMoves(board, f, r);
        for (const m of moves) {
          if (m.file === king.file && m.rank === king.rank) {
            return true;
          }
        }
      }
    }
  }
  return false;
}

// ── 자살수 판정 ──────────────────────────────────────────────────

/**
 * 특정 수를 두었을 때 자기 궁이 장군 상태가 되는지 검사한다 (자살수 판정, 룰북 #8-3).
 * 보드를 복사하여 시뮬레이션 후 isInCheck() 호출. 원본 보드 불변.
 * @param {Array<Array<{type:string,side:string}|null>>} board
 * @param {number} fromFile
 * @param {number} fromRank
 * @param {number} toFile
 * @param {number} toRank
 * @returns {boolean} true이면 자살수 (이 수는 금지)
 */
export function wouldBeSelfCheck(board, fromFile, fromRank, toFile, toRank) {
  const piece = getPiece(board, fromFile, fromRank);
  if (!piece) return false;

  const sim = cloneBoard(board);
  movePiece(sim, fromFile, fromRank, toFile, toRank);
  return isInCheck(sim, piece.side);
}

// ── 합법 수 목록 ────────────────────────────────────────────────

/**
 * 지정 진영의 모든 합법 수를 반환한다.
 * 자살수를 제외한 최종 합법 수 목록.
 * @param {Array<Array<{type:string,side:string}|null>>} board
 * @param {'han'|'cho'} side
 * @returns {Array<{fromFile:number, fromRank:number, toFile:number, toRank:number}>}
 */
export function getAllLegalMoves(board, side) {
  const result = [];

  for (let r = 0; r < NUM_RANKS; r++) {
    for (let f = 0; f < NUM_FILES; f++) {
      const p = board[r][f];
      if (!p || p.side !== side) continue;

      const moves = getLegalMoves(board, f, r);
      for (const m of moves) {
        if (!wouldBeSelfCheck(board, f, r, m.file, m.rank)) {
          result.push({
            fromFile: f, fromRank: r,
            toFile: m.file, toRank: m.rank,
          });
        }
      }
    }
  }

  return result;
}

// ── 외통수 판정 ──────────────────────────────────────────────────

/**
 * 주어진 side가 외통수(체크메이트) 상태인지 판정한다 (룰북 #7-1).
 * 장군 상태에서 모든 합법 수를 시뮬레이션해도 장군이 해소되지 않으면 외통수.
 * @param {Array<Array<{type:string,side:string}|null>>} board
 * @param {'han'|'cho'} side
 * @returns {boolean}
 */
export function isCheckmate(board, side) {
  // 장군 상태가 아니면 외통수가 아님
  if (!isInCheck(board, side)) return false;

  // 합법 수가 하나라도 있으면 외통수가 아님
  const legalMoves = getAllLegalMoves(board, side);
  return legalMoves.length === 0;
}

// ── 양수겸장 판정 ────────────────────────────────────────────────

/**
 * 양수겸장(이중 장군) 상태인지 판정한다 (룰북 #8-5).
 * 상대 진영의 2개 이상 기물이 동시에 장군을 부르고 있으면 true.
 * @param {Array<Array<{type:string,side:string}|null>>} board
 * @param {'han'|'cho'} attackedSide 장군을 당한 쪽
 * @returns {boolean}
 */
export function isDoubleCheck(board, attackedSide) {
  const king = findKing(board, attackedSide);
  if (!king) return false;

  const opponent = attackedSide === 'han' ? 'cho' : 'han';
  let attackerCount = 0;

  for (let r = 0; r < NUM_RANKS; r++) {
    for (let f = 0; f < NUM_FILES; f++) {
      const p = board[r][f];
      if (!p || p.side !== opponent) continue;

      const moves = getLegalMoves(board, f, r);
      for (const m of moves) {
        if (m.file === king.file && m.rank === king.rank) {
          attackerCount++;
          break; // 이 기물은 장군 1회로 카운트
        }
      }

      if (attackerCount >= 2) return true;
    }
  }

  return false;
}

// ── 동형반복 ────────────────────────────────────────────────────

/**
 * 동형반복 카운트를 갱신하고 3회 도달 여부를 반환한다 (룰북 #7-4).
 * @param {Map<string, number>} history key=boardHash(), value=발생 횟수
 * @param {string} hash boardHash() 반환값
 * @returns {{ count: number, isThreefold: boolean }}
 */
export function countRepetition(history, hash) {
  const prev = history.get(hash) || 0;
  const count = prev + 1;
  history.set(hash, count);
  return { count, isThreefold: count >= 3 };
}
