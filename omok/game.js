/**
 * @fileoverview 오목(Gomoku) 순수 게임 로직 — 보드·착수·승리 판정.
 *
 * 아키텍처: **서버 권위(Server Authoritative)**
 *  - 착수 검증·승리 판정·무승부 판정 모두 이 모듈에서만 수행한다.
 *  - 네트워크 코드 없음 — 단위 테스트에서 직접 import 가능(서버 불필요).
 *  - 표준 19×19 오목. 5목 이상 연속(가로/세로/대각) 승리.
 *    장목(6목 이상)도 승리로 처리한다(금지 아님).
 *  - 렌주 금수: 쌍삼(열린3 2개+)·사사(4목 2개+) 동시 생성 시 착수 거부(흑·백 동일).
 *    단 5목+(승리)·장목은 금수보다 우선해 승리로 처리한다.
 *
 * 주의: placeStone/applyResign 은 state 객체를 직접 변이(mutate)한다.
 *       순수 함수가 아님(기존 yahtzee game.js 패턴 동일).
 */

// ── 상수 ────────────────────────────────────────────────────────
/** 바둑판 한 변의 교차점 개수 (19×19). */
export const BOARD_SIZE = 19;
/** 전체 교차점 개수 (361). */
export const TOTAL_CELLS = BOARD_SIZE * BOARD_SIZE;
/** 승리에 필요한 최소 연속 돌 개수. */
export const WIN_COUNT = 5;

/**
 * 승리 탐색 4방향. 각 [dr, dc]는 한 칸 이동 벡터.
 *  - [0,1]  가로
 *  - [1,0]  세로
 *  - [1,1]  대각(↘)
 *  - [1,-1] 대각(↗)
 * 정/역방향을 모두 탐색하므로 8방향이 아닌 4방향이면 충분하다.
 * @type {Array<[number, number]>}
 */
const DIRS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

/**
 * @typedef {Object} OmokState
 * @property {Array<('black'|'white'|null)>} board 길이 361, 인덱스 = row*19+col
 * @property {'black'|'white'} currentTurn 현재 착수 차례 (black=p1 선공)
 * @property {'playing'|'ended'} phase 게임 단계
 * @property {null|{winner:string, reason:string, winLine?:Array<[number,number]>}} result 종료 결과
 * @property {number} moveCount 누적 착수 수
 */

/**
 * 색 → 상대 색.
 * @param {'black'|'white'} color
 * @returns {'black'|'white'}
 */
function opponent(color) {
  return color === 'black' ? 'white' : 'black';
}

/**
 * 새 게임 상태를 생성한다.
 * @returns {OmokState}
 */
export function createGame() {
  return {
    board: new Array(TOTAL_CELLS).fill(null),
    currentTurn: 'black', // 흑(p1) 선공
    phase: 'playing',
    result: null,
    moveCount: 0,
  };
}

/**
 * (row, col)이 보드 범위 안인지 검사.
 * @param {number} row
 * @param {number} col
 * @returns {boolean}
 */
function inBounds(row, col) {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}

/**
 * 한 방향으로 같은 색이 연속된 칸을 탐색한다.
 * 5목 이상 승리 판정 시 사용. 정/역 양방향을 합쳐 연속선(winLine)을 구성한다.
 *
 * @param {OmokState} state
 * @param {'black'|'white'} color 방금 착수한 색
 * @param {number} row 착수 행
 * @param {number} col 착수 열
 * @returns {null|Array<[number,number]>} 5목 이상이면 연속 교차점 좌표 배열, 아니면 null
 */
function checkWin(state, color, row, col) {
  const { board } = state;
  for (const [dr, dc] of DIRS) {
    // 착수점 자신을 시작으로 한 연속선. (정방향 push / 역방향 unshift로 좌표 순서 유지)
    const line = [[row, col]];

    // 정방향 탐색.
    let r = row + dr;
    let c = col + dc;
    while (inBounds(r, c) && board[r * BOARD_SIZE + c] === color) {
      line.push([r, c]);
      r += dr;
      c += dc;
    }
    // 역방향 탐색.
    r = row - dr;
    c = col - dc;
    while (inBounds(r, c) && board[r * BOARD_SIZE + c] === color) {
      line.unshift([r, c]);
      r -= dr;
      c -= dc;
    }

    // 5목 이상(장목 포함) → 승리.
    if (line.length >= WIN_COUNT) {
      return line;
    }
  }
  return null;
}

// ── 렌주 금수 검사 (쌍삼·사사) ──────────────────────────────────
// 호출 규약: 아래 함수들은 board[row*19+col]에 color가 **이미 놓인**
// 가상 착수 상태에서 호출한다. "방금 착수한 칸이 기여하는" 연속만 센다.

/**
 * 착수점을 포함해 한 방향(dr,dc)의 정/역방향 연속을 분석해 열린3 여부를 판정한다.
 * 열린3: 착수 포함 정확히 3연속이고, 양 끝 바로 바깥 칸이 모두 빈칸(보드 범위 내).
 *
 * @param {Array<('black'|'white'|null)>} board 길이 361 (착수가 이미 반영된 상태)
 * @param {number} row 착수 행
 * @param {number} col 착수 열
 * @param {'black'|'white'} color
 * @param {number} dr 행 이동 벡터
 * @param {number} dc 열 이동 벡터
 * @returns {boolean} 해당 방향에서 착수가 만든 연속이 열린3이면 true
 */
function isOpenThree(board, row, col, color, dr, dc) {
  // 정방향 끝칸 탐색(연속이 끊기기 직전 칸).
  let er1 = row;
  let ec1 = col;
  let r = row + dr;
  let c = col + dc;
  while (inBounds(r, c) && board[r * BOARD_SIZE + c] === color) {
    er1 = r;
    ec1 = c;
    r += dr;
    c += dc;
  }
  // 역방향 끝칸 탐색.
  let er2 = row;
  let ec2 = col;
  r = row - dr;
  c = col - dc;
  while (inBounds(r, c) && board[r * BOARD_SIZE + c] === color) {
    er2 = r;
    ec2 = c;
    r -= dr;
    c -= dc;
  }

  // 연속 길이 = 정방향 칸수 + 역방향 칸수 + 착수점(1).
  const len = (Math.abs(er1 - er2) || Math.abs(ec1 - ec2)) + 1;
  if (len !== 3) return false;

  // 정방향 끝 바로 다음 칸이 빈칸이면 frontOpen.
  const fr = er1 + dr;
  const fc = ec1 + dc;
  const frontOpen = inBounds(fr, fc) && board[fr * BOARD_SIZE + fc] === null;
  // 역방향 끝 바로 다음 칸이 빈칸이면 backOpen.
  const br = er2 - dr;
  const bc = ec2 - dc;
  const backOpen = inBounds(br, bc) && board[br * BOARD_SIZE + bc] === null;

  return frontOpen && backOpen;
}

/**
 * 착수 포함 한 방향(dr,dc) 연속 길이가 정확히 4인지 확인한다(열린·닫힌 불문).
 * 5목+(len>=5)은 checkWin에서 이미 승리로 처리되므로 여기 도달하지 않는다.
 * 따라서 len===4 만 4목으로 센다.
 *
 * @param {Array<('black'|'white'|null)>} board
 * @param {number} row
 * @param {number} col
 * @param {'black'|'white'} color
 * @param {number} dr
 * @param {number} dc
 * @returns {boolean}
 */
function isFour(board, row, col, color, dr, dc) {
  let len = 1; // 착수점 자신.
  // 정방향.
  let r = row + dr;
  let c = col + dc;
  while (inBounds(r, c) && board[r * BOARD_SIZE + c] === color) {
    len += 1;
    r += dr;
    c += dc;
  }
  // 역방향.
  r = row - dr;
  c = col - dc;
  while (inBounds(r, c) && board[r * BOARD_SIZE + c] === color) {
    len += 1;
    r -= dr;
    c -= dc;
  }
  return len === 4;
}

/**
 * 착수 후 열린3이 2개 이상 동시 생성됐는지(쌍삼) 검사한다.
 * 호출 전 board[row*19+col]에 color가 이미 놓여 있어야 한다(가상 착수 상태).
 *
 * @param {Array<('black'|'white'|null)>} board
 * @param {number} row
 * @param {number} col
 * @param {'black'|'white'} color
 * @returns {boolean} 쌍삼이면 true
 */
export function checkDoubleThree(board, row, col, color) {
  let openThrees = 0;
  for (const [dr, dc] of DIRS) {
    if (isOpenThree(board, row, col, color, dr, dc)) openThrees += 1;
  }
  return openThrees >= 2;
}

/**
 * 착수 후 4목이 2개 이상 동시 생성됐는지(사사) 검사한다.
 * 호출 전 board[row*19+col]에 color가 이미 놓여 있어야 한다(가상 착수 상태).
 *
 * @param {Array<('black'|'white'|null)>} board
 * @param {number} row
 * @param {number} col
 * @param {'black'|'white'} color
 * @returns {boolean} 사사이면 true
 */
export function checkDoubleFour(board, row, col, color) {
  let fours = 0;
  for (const [dr, dc] of DIRS) {
    if (isFour(board, row, col, color, dr, dc)) fours += 1;
  }
  return fours >= 2;
}

/**
 * 보드가 가득 찼는지(무승부 조건) 검사.
 * @param {OmokState} state
 * @returns {boolean}
 */
function checkDraw(state) {
  return state.moveCount >= TOTAL_CELLS;
}

/**
 * 종료 결과를 확정한다(phase='ended' + result 세팅).
 * @param {OmokState} state
 * @param {string} winner 'black' | 'white' | 'draw'
 * @param {string} reason 'five' | 'resign' | 'draw'
 * @param {Array<[number,number]>} [winLine] 승리선 좌표(승리 시)
 */
function finalizeResult(state, winner, reason, winLine) {
  state.phase = 'ended';
  state.result = { winner, reason };
  if (winLine) state.result.winLine = winLine;
}

/**
 * 돌을 착수한다. 검증·승리·무승부 판정을 모두 처리한다.
 *
 * @param {OmokState} state
 * @param {'black'|'white'} by 착수자 색
 * @param {number} row 0~18
 * @param {number} col 0~18
 * @returns {{ok:boolean, error?:string, gameOver?:boolean, winner?:string, reason?:string, winLine?:Array<[number,number]>}}
 */
export function placeStone(state, by, row, col) {
  // ── 검증 ──
  if (state.phase !== 'playing') {
    return { ok: false, error: '게임이 진행 중이 아닙니다.' };
  }
  if (by !== state.currentTurn) {
    return { ok: false, error: '당신의 차례가 아닙니다.' };
  }
  if (!Number.isInteger(row) || !Number.isInteger(col) || !inBounds(row, col)) {
    return { ok: false, error: '보드 범위를 벗어난 좌표입니다.' };
  }
  const idx = row * BOARD_SIZE + col;
  if (state.board[idx] !== null) {
    return { ok: false, error: '이미 돌이 놓인 자리입니다.' };
  }

  // ── 가상 착수 ──
  // 금수 검사는 돌이 놓인 상태를 전제하므로 먼저 반영한다. 거부 시 원복한다.
  state.board[idx] = by;
  state.moveCount += 1;

  // ① 승리 판정 (5목 이상) — 금수보다 우선(D-6 승리 우선).
  const winLine = checkWin(state, by, row, col);
  if (winLine) {
    finalizeResult(state, by, 'five', winLine);
    return { ok: true, gameOver: true, winner: by, reason: 'five', winLine };
  }

  // ② 금수 판정 (승리가 아닐 때만). 위반 시 board/moveCount 원복 후 거부.
  if (checkDoubleThree(state.board, row, col, by)) {
    state.board[idx] = null;
    state.moveCount -= 1;
    return { ok: false, error: '금수입니다: 쌍삼' };
  }
  if (checkDoubleFour(state.board, row, col, by)) {
    state.board[idx] = null;
    state.moveCount -= 1;
    return { ok: false, error: '금수입니다: 사사' };
  }

  // ③ 무승부 판정 (보드 가득 참).
  if (checkDraw(state)) {
    finalizeResult(state, 'draw', 'draw');
    return { ok: true, gameOver: true, winner: 'draw', reason: 'draw' };
  }

  // ④ 승부 미결 → 턴 교대.
  state.currentTurn = opponent(by);
  return { ok: true, gameOver: false };
}

/**
 * 기권을 처리한다. 상대방이 승자가 된다.
 * @param {OmokState} state
 * @param {'black'|'white'} by 기권자 색
 * @returns {{ok:boolean, error?:string, winner?:string, reason?:string}}
 */
export function applyResign(state, by) {
  if (state.phase !== 'playing') {
    return { ok: false, error: '게임이 진행 중이 아닙니다.' };
  }
  const winner = opponent(by);
  finalizeResult(state, winner, 'resign');
  return { ok: true, winner, reason: 'resign' };
}

/**
 * 클라이언트로 broadcast할 STATE 스냅샷을 만든다.
 * 정보 비대칭이 없으므로 마스킹 없이 전체 보드를 노출한다.
 * @param {OmokState} state
 * @returns {object}
 */
export function snapshot(state) {
  return {
    type: 'STATE',
    board: state.board.slice(),
    currentTurn: state.currentTurn,
    phase: state.phase,
    moveCount: state.moveCount,
    result: state.result,
  };
}
