/**
 * @fileoverview 7종 기물의 합법 이동 산출 모듈.
 * 멱(장애물), 포다리, 궁성 대각선 규칙을 모두 포함한다.
 * 자살수 검증은 rules.js에서 수행하므로 이 모듈은 포함하지 않는다.
 *
 * 각 기물 이동 규칙은 룰북 #5 (5-1 ~ 5-7) 기준.
 */

import {
  getPiece, inBounds, inPalace, isPalaceDiagonal, whichPalace,
} from './board.js';

// ── 궁성 대각선 인접 관계 ─────────────────────────────────────────

/**
 * 궁성 내 대각선이 그려진 칸 사이의 인접 관계 맵.
 * 대각선 위의 칸에서 1칸 대각 이동으로 도달 가능한 칸 목록.
 * 한/초 궁성 모두 포함한다.
 * @type {Map<string, Array<{file:number, rank:number}>>}
 */
const PALACE_DIAG_ADJ = new Map();

/**
 * 궁성 대각선 인접 관계를 빌드한다.
 * 꼭짓점 <-> 중앙 간 대각선만 존재한다 (변 중앙 4칸은 대각 없음).
 */
function buildPalaceDiagAdj() {
  // 한 궁성
  const hanCorners = [[3, 0], [5, 0], [3, 2], [5, 2]];
  const hanCenter = [4, 1];
  for (const [cf, cr] of hanCorners) {
    addDiagAdj(cf, cr, hanCenter[0], hanCenter[1]);
  }
  // 초 궁성
  const choCorners = [[3, 7], [5, 7], [3, 9], [5, 9]];
  const choCenter = [4, 8];
  for (const [cf, cr] of choCorners) {
    addDiagAdj(cf, cr, choCenter[0], choCenter[1]);
  }
}

/**
 * 대각선 인접 칸을 양방향으로 등록한다.
 * @param {number} f1
 * @param {number} r1
 * @param {number} f2
 * @param {number} r2
 */
function addDiagAdj(f1, r1, f2, r2) {
  const k1 = `${f1},${r1}`;
  const k2 = `${f2},${r2}`;
  if (!PALACE_DIAG_ADJ.has(k1)) PALACE_DIAG_ADJ.set(k1, []);
  if (!PALACE_DIAG_ADJ.has(k2)) PALACE_DIAG_ADJ.set(k2, []);
  PALACE_DIAG_ADJ.get(k1).push({ file: f2, rank: r2 });
  PALACE_DIAG_ADJ.get(k2).push({ file: f1, rank: r1 });
}

buildPalaceDiagAdj();

// ── 공통 유틸 ─────────────────────────────────────────────────────

/** 직선 방향 4개 (상, 하, 좌, 우). */
const ORTHO_DIRS = [
  { df: 0, dr: -1 }, // 상
  { df: 0, dr: 1 },  // 하
  { df: -1, dr: 0 }, // 좌
  { df: 1, dr: 0 },  // 우
];

/**
 * 도착 칸에 자기 기물이 없으면 이동 후보로 추가한다.
 * @param {Array<{file:number,rank:number}>} moves
 * @param {*} board
 * @param {number} file
 * @param {number} rank
 * @param {'han'|'cho'} side
 * @returns {boolean} 추가 성공 여부
 */
function addIfNotFriendly(moves, board, file, rank, side) {
  if (!inBounds(file, rank)) return false;
  const target = getPiece(board, file, rank);
  if (target && target.side === side) return false;
  moves.push({ file, rank });
  return true;
}

// ── 기물별 이동 산출 ──────────────────────────────────────────────

/**
 * 주어진 보드와 좌표에서 해당 기물의 합법 이동 후보를 반환한다.
 * 자살수 필터링 전 단계(후보 목록). rules.js의 wouldBeSelfCheck()로 추가 필터링한다.
 *
 * @param {Array<Array<{type:string,side:string}|null>>} board
 * @param {number} file
 * @param {number} rank
 * @returns {Array<{file: number, rank: number}>} 이동 가능한 칸 목록
 */
export function getLegalMoves(board, file, rank) {
  const p = getPiece(board, file, rank);
  if (!p) return [];

  switch (p.type) {
    case 'king':     return getKingMoves(board, file, rank, p.side);
    case 'advisor':  return getAdvisorMoves(board, file, rank, p.side);
    case 'chariot':  return getChariotMoves(board, file, rank, p.side);
    case 'cannon':   return getCannonMoves(board, file, rank, p.side);
    case 'horse':    return getHorseMoves(board, file, rank, p.side);
    case 'elephant': return getElephantMoves(board, file, rank, p.side);
    case 'soldier':  return getSoldierMoves(board, file, rank, p.side);
    default:         return [];
  }
}

/**
 * 궁(K) 이동 후보 (룰북 #5-1).
 * 궁성 내 1칸 직선 + 그려진 대각선.
 * @param {*} board
 * @param {number} file
 * @param {number} rank
 * @param {'han'|'cho'} side
 * @returns {Array<{file:number,rank:number}>}
 */
function getKingMoves(board, file, rank, side) {
  const moves = [];

  // 직선 1칸 (궁성 내)
  for (const { df, dr } of ORTHO_DIRS) {
    const nf = file + df;
    const nr = rank + dr;
    if (inPalace(nf, nr, side)) {
      addIfNotFriendly(moves, board, nf, nr, side);
    }
  }

  // 대각선 1칸 (그려진 대각선 칸 사이만)
  if (isPalaceDiagonal(file, rank)) {
    const adj = PALACE_DIAG_ADJ.get(`${file},${rank}`) || [];
    for (const { file: nf, rank: nr } of adj) {
      if (inPalace(nf, nr, side)) {
        addIfNotFriendly(moves, board, nf, nr, side);
      }
    }
  }

  return moves;
}

/**
 * 사(A) 이동 후보 (룰북 #5-2).
 * 궁과 동일 규칙: 궁성 내 1칸 직선 + 그려진 대각선.
 * @param {*} board
 * @param {number} file
 * @param {number} rank
 * @param {'han'|'cho'} side
 * @returns {Array<{file:number,rank:number}>}
 */
function getAdvisorMoves(board, file, rank, side) {
  // 사와 궁의 이동 규칙은 동일하다
  return getKingMoves(board, file, rank, side);
}

/**
 * 차(R) 이동 후보 (룰북 #5-3).
 * 직선 임의칸 + 궁성 내 대각선 경로.
 * @param {*} board
 * @param {number} file
 * @param {number} rank
 * @param {'han'|'cho'} side
 * @returns {Array<{file:number,rank:number}>}
 */
function getChariotMoves(board, file, rank, side) {
  const moves = [];

  // 직선 4방향 무제한
  for (const { df, dr } of ORTHO_DIRS) {
    let nf = file + df;
    let nr = rank + dr;
    while (inBounds(nf, nr)) {
      const target = getPiece(board, nf, nr);
      if (target) {
        if (target.side !== side) moves.push({ file: nf, rank: nr });
        break; // 막힘
      }
      moves.push({ file: nf, rank: nr });
      nf += df;
      nr += dr;
    }
  }

  // 궁성 내 대각선 이동 (룰북 #5-3)
  // 차가 궁성 대각 칸에 있을 때 대각선 방향으로 이동 가능
  const palace = whichPalace(file, rank);
  if (palace && isPalaceDiagonal(file, rank)) {
    addChariotPalaceDiagonal(moves, board, file, rank, side, palace);
  }

  return moves;
}

/**
 * 차의 궁성 대각선 이동을 추가한다.
 * 꼭짓점에서 중앙(1칸), 중앙에서 반대 꼭짓점(1칸), 또는 꼭짓점에서 반대 꼭짓점(중앙 경유 2칸)까지 이동.
 * @param {Array<{file:number,rank:number}>} moves
 * @param {*} board
 * @param {number} file
 * @param {number} rank
 * @param {'han'|'cho'} side
 * @param {'han'|'cho'} palace
 */
function addChariotPalaceDiagonal(moves, board, file, rank, side, palace) {
  const centerF = 4;
  const centerR = palace === 'han' ? 1 : 8;

  if (file === centerF && rank === centerR) {
    // 중앙에서 4 꼭짓점으로
    const corners = palace === 'han'
      ? [[3, 0], [5, 0], [3, 2], [5, 2]]
      : [[3, 7], [5, 7], [3, 9], [5, 9]];
    for (const [cf, cr] of corners) {
      addIfNotFriendly(moves, board, cf, cr, side);
    }
  } else {
    // 꼭짓점에서 중앙으로
    const centerPiece = getPiece(board, centerF, centerR);
    if (!centerPiece) {
      // 중앙 비어있으면: 중앙으로 이동 + 반대편 꼭짓점까지 관통
      moves.push({ file: centerF, rank: centerR });
      // 반대편 꼭짓점 (대각 방향 반대)
      const oppF = centerF + (centerF - file);
      const oppR = centerR + (centerR - rank);
      if (inPalace(oppF, oppR, palace)) {
        addIfNotFriendly(moves, board, oppF, oppR, side);
      }
    } else if (centerPiece.side !== side) {
      // 중앙에 적 기물: 잡기 가능
      moves.push({ file: centerF, rank: centerR });
    }
    // 중앙에 아군 기물: 이동 불가 (이미 직선에서 처리 안됨)
  }
}

/**
 * 포(C) 이동 후보 (룰북 #5-4).
 * 직선 방향: 다리 정확히 1개 필요. 다리가 포면 불가. 적 포 잡기 불가.
 * 궁성 대각선: 중앙 기물을 다리로 대각 이동 가능.
 * @param {*} board
 * @param {number} file
 * @param {number} rank
 * @param {'han'|'cho'} side
 * @returns {Array<{file:number,rank:number}>}
 */
function getCannonMoves(board, file, rank, side) {
  const moves = [];

  // 직선 4방향
  for (const { df, dr } of ORTHO_DIRS) {
    let nf = file + df;
    let nr = rank + dr;
    let foundBridge = false;

    while (inBounds(nf, nr)) {
      const target = getPiece(board, nf, nr);
      if (!foundBridge) {
        // 다리 찾기
        if (target) {
          // 다리가 포면 넘을 수 없다 (룰북 #5-4 제약 1)
          if (target.type === 'cannon') break;
          foundBridge = true;
        }
      } else {
        // 다리 너머 이동
        if (target) {
          // 적 포는 잡을 수 없다 (룰북 #5-4 제약 2)
          if (target.type === 'cannon') break;
          if (target.side !== side) {
            moves.push({ file: nf, rank: nr });
          }
          break; // 막힘 (적/아군 불문)
        }
        moves.push({ file: nf, rank: nr });
      }
      nf += df;
      nr += dr;
    }
  }

  // 궁성 대각선 포 이동 (룰북 #5-4)
  // 포가 궁성 꼭짓점에 있고 중앙에 다리(비-포) 기물이 있으면 반대편 꼭짓점으로 이동
  const palace = whichPalace(file, rank);
  if (palace && isPalaceDiagonal(file, rank)) {
    addCannonPalaceDiagonal(moves, board, file, rank, side, palace);
  }

  return moves;
}

/**
 * 포의 궁성 대각선 이동을 처리한다.
 * 꼭짓점에서 중앙을 다리로 삼아 반대편 꼭짓점으로, 또는
 * 중앙에서는 이동 불가(다리가 없으므로).
 * @param {Array<{file:number,rank:number}>} moves
 * @param {*} board
 * @param {number} file
 * @param {number} rank
 * @param {'han'|'cho'} side
 * @param {'han'|'cho'} palace
 */
function addCannonPalaceDiagonal(moves, board, file, rank, side, palace) {
  const centerF = 4;
  const centerR = palace === 'han' ? 1 : 8;

  if (file === centerF && rank === centerR) {
    // 중앙에 있는 포: 대각선으로 이동 불가 (다리가 없음)
    return;
  }

  // 꼭짓점에서 중앙을 다리로 반대편 꼭짓점으로
  const bridgePiece = getPiece(board, centerF, centerR);
  if (!bridgePiece) return; // 다리 없음
  if (bridgePiece.type === 'cannon') return; // 다리가 포면 불가

  const oppF = centerF + (centerF - file);
  const oppR = centerR + (centerR - rank);
  if (!inPalace(oppF, oppR, palace)) return;

  const target = getPiece(board, oppF, oppR);
  if (!target) {
    moves.push({ file: oppF, rank: oppR });
  } else if (target.side !== side && target.type !== 'cannon') {
    // 적 기물(포 제외) 잡기
    moves.push({ file: oppF, rank: oppR });
  }
}

/**
 * 마(H) 이동 후보 (룰북 #5-5).
 * 직선 1칸 + 외각 대각선 1칸. 직선 경유 칸이 막히면(멱) 불가.
 * @param {*} board
 * @param {number} file
 * @param {number} rank
 * @param {'han'|'cho'} side
 * @returns {Array<{file:number,rank:number}>}
 */
function getHorseMoves(board, file, rank, side) {
  const moves = [];

  // 4방향 직선 1칸 -> 대각 2개
  const patterns = [
    // 위 1칸 -> 좌상, 우상
    { df: 0, dr: -1, targets: [{ df: -1, dr: -1 }, { df: 1, dr: -1 }] },
    // 아래 1칸 -> 좌하, 우하
    { df: 0, dr: 1, targets: [{ df: -1, dr: 1 }, { df: 1, dr: 1 }] },
    // 좌 1칸 -> 좌상, 좌하
    { df: -1, dr: 0, targets: [{ df: -1, dr: -1 }, { df: -1, dr: 1 }] },
    // 우 1칸 -> 우상, 우하
    { df: 1, dr: 0, targets: [{ df: 1, dr: -1 }, { df: 1, dr: 1 }] },
  ];

  for (const { df, dr, targets } of patterns) {
    const midF = file + df;
    const midR = rank + dr;

    // 멱 확인: 직선 경유 칸에 기물이 있으면 이 방향 전체 불가
    if (!inBounds(midF, midR)) continue;
    if (getPiece(board, midF, midR)) continue;

    // 대각 도착 2칸
    for (const { df: tdf, dr: tdr } of targets) {
      const nf = midF + tdf;
      const nr = midR + tdr;
      if (inBounds(nf, nr)) {
        addIfNotFriendly(moves, board, nf, nr, side);
      }
    }
  }

  return moves;
}

/**
 * 상(E) 이동 후보 (룰북 #5-6).
 * 직선 1칸 + 외각 대각선 2칸. 경유 2칸 중 하나라도 막히면(멱) 불가.
 * 최종 변위: (+/-2, +/-3) 또는 (+/-3, +/-2).
 * @param {*} board
 * @param {number} file
 * @param {number} rank
 * @param {'han'|'cho'} side
 * @returns {Array<{file:number,rank:number}>}
 */
function getElephantMoves(board, file, rank, side) {
  const moves = [];

  // 4방향 직선 1칸 -> 대각 1칸 (중간) -> 대각 1칸 (도착)
  // 마지막 대각 1칸은 중간 대각과 같은 방향으로 한 번 더 진행 (룰북 §5-6).
  // 총 변위: (±2, ±3) 또는 (±3, ±2).
  const patterns = [
    // 위 1칸: 좌상상, 우상상
    {
      df: 0, dr: -1,
      legs: [
        { midDf: -1, midDr: -1, endDf: -1, endDr: -1 },
        { midDf: 1, midDr: -1, endDf: 1, endDr: -1 },
      ],
    },
    // 아래 1칸: 좌하하, 우하하
    {
      df: 0, dr: 1,
      legs: [
        { midDf: -1, midDr: 1, endDf: -1, endDr: 1 },
        { midDf: 1, midDr: 1, endDf: 1, endDr: 1 },
      ],
    },
    // 좌 1칸: 좌좌상, 좌좌하
    {
      df: -1, dr: 0,
      legs: [
        { midDf: -1, midDr: -1, endDf: -1, endDr: -1 },
        { midDf: -1, midDr: 1, endDf: -1, endDr: 1 },
      ],
    },
    // 우 1칸: 우우상, 우우하
    {
      df: 1, dr: 0,
      legs: [
        { midDf: 1, midDr: -1, endDf: 1, endDr: -1 },
        { midDf: 1, midDr: 1, endDf: 1, endDr: 1 },
      ],
    },
  ];

  for (const { df, dr, legs } of patterns) {
    const step1F = file + df;
    const step1R = rank + dr;

    // 첫 번째 멱: 직선 1칸 경유 칸
    if (!inBounds(step1F, step1R)) continue;
    if (getPiece(board, step1F, step1R)) continue;

    for (const { midDf, midDr, endDf, endDr } of legs) {
      const step2F = step1F + midDf;
      const step2R = step1R + midDr;

      // 두 번째 멱: 대각 1칸 경유 칸
      if (!inBounds(step2F, step2R)) continue;
      if (getPiece(board, step2F, step2R)) continue;

      // 도착 칸
      const nf = step2F + endDf;
      const nr = step2R + endDr;
      if (inBounds(nf, nr)) {
        addIfNotFriendly(moves, board, nf, nr, side);
      }
    }
  }

  return moves;
}

/**
 * 졸/병(P) 이동 후보 (룰북 #5-7).
 * 앞 1칸 + 좌우 1칸. 뒤로 불가.
 * 적 궁성 내 그려진 대각선 위에 있으면 대각 앞 이동 가능.
 *
 * 한 졸: rank 증가(아래)가 앞.
 * 초 병: rank 감소(위)가 앞.
 * @param {*} board
 * @param {number} file
 * @param {number} rank
 * @param {'han'|'cho'} side
 * @returns {Array<{file:number,rank:number}>}
 */
function getSoldierMoves(board, file, rank, side) {
  const moves = [];
  const forward = side === 'han' ? 1 : -1;

  // 앞 1칸
  addIfNotFriendly(moves, board, file, rank + forward, side);
  // 좌 1칸
  addIfNotFriendly(moves, board, file - 1, rank, side);
  // 우 1칸
  addIfNotFriendly(moves, board, file + 1, rank, side);

  // 적 궁성 내 그려진 대각선 위에서 대각 앞 이동 (룰북 #5-7)
  const enemySide = side === 'han' ? 'cho' : 'han';
  if (inPalace(file, rank, enemySide) && isPalaceDiagonal(file, rank)) {
    // 좌앞 대각
    const lfF = file - 1;
    const lfR = rank + forward;
    if (inPalace(lfF, lfR, enemySide) && isPalaceDiagonal(lfF, lfR)) {
      addIfNotFriendly(moves, board, lfF, lfR, side);
    }
    // 우앞 대각
    const rfF = file + 1;
    const rfR = rank + forward;
    if (inPalace(rfF, rfR, enemySide) && isPalaceDiagonal(rfF, rfR)) {
      addIfNotFriendly(moves, board, rfF, rfR, side);
    }
  }

  return moves;
}
