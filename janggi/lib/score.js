/**
 * @fileoverview 점수 집계 모듈. 남은 기물 합산 + 초 덤 1.5 적용.
 * 룰북 #3 (기물 점수), #7-2 (점수제 종료) 기준.
 */

// ── 상수 ──────────────────────────────────────────────────────────

/** 보드 크기. */
const NUM_FILES = 9;
const NUM_RANKS = 10;

/**
 * 기물 유형별 점수표 (룰북 #3).
 * 궁(king)은 0점이지만 잡히면 즉시 패배.
 * @type {Record<string, number>}
 */
export const PIECE_SCORE = {
  chariot: 13,
  cannon: 7,
  horse: 5,
  elephant: 3,
  advisor: 3,
  soldier: 2,
  king: 0,
};

/** 후수(초) 덤 점수. 선수 한의 선착 이점 보정 (룰북 #1, #7-2). */
export const DEOM = 1.5;

// ── 점수 계산 ────────────────────────────────────────────────────

/**
 * 현재 보드에서 양 진영 점수를 집계한다.
 * @param {Array<Array<{type:string,side:string}|null>>} board
 * @param {boolean} [includeDeom=true] 후수(초) 덤 1.5 포함 여부
 * @returns {{ han: number, cho: number }} 각 진영 점수 (cho에 덤 포함 시 +1.5)
 */
export function calculateScore(board, includeDeom = true) {
  let han = 0;
  let cho = 0;

  for (let r = 0; r < NUM_RANKS; r++) {
    for (let f = 0; f < NUM_FILES; f++) {
      const p = board[r][f];
      if (!p) continue;
      const score = PIECE_SCORE[p.type] || 0;
      if (p.side === 'han') han += score;
      else cho += score;
    }
  }

  if (includeDeom) {
    cho += DEOM;
  }

  return { han, cho };
}

/**
 * 점수 비교로 승자를 결정한다 (룰북 #7-2).
 * @param {{ han: number, cho: number }} scores calculateScore() 반환값
 * @returns {'han'|'cho'} 점수 높은 쪽. 동점이면 'cho' (덤 효과로 사실상 동점 불가)
 */
export function getScoreWinner(scores) {
  if (scores.han > scores.cho) return 'han';
  return 'cho'; // 동점 시 후수(초) 승
}
