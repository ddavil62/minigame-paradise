/**
 * @fileoverview 9x10 장기판 보드 상태 관리 모듈.
 * 기물 배치, 조회, 이동, 직렬화, 해시를 담당하며 게임 로직(rules/game)과 분리된다.
 *
 * 좌표계 (룰북 #2-1):
 *   file: 0..8 (가로, 한 기준 좌->우)
 *   rank: 0..9 (세로, 한 1행->초 10행)
 *   (0,0) = 한 진영 좌측 상단
 *   한 진영: rank 0~4, 초 진영: rank 5~9
 *
 * 기물 객체: { type: string, side: 'han'|'cho' }
 *   type: 'king'|'advisor'|'chariot'|'cannon'|'horse'|'elephant'|'soldier'
 */

// ── 상수 ──────────────────────────────────────────────────────────

/** 보드 가로(file) 크기. */
const NUM_FILES = 9;
/** 보드 세로(rank) 크기. */
const NUM_RANKS = 10;

/**
 * 기물 타입 약어 <-> 풀네임 매핑.
 * 직렬화/해시에서 한 글자 약어를 사용한다.
 * @type {Record<string, string>}
 */
const TYPE_TO_ABBR = {
  king: 'K', advisor: 'A', chariot: 'R', cannon: 'C',
  horse: 'H', elephant: 'E', soldier: 'P',
};

/** @type {Record<string, string>} */
const ABBR_TO_TYPE = {};
for (const [k, v] of Object.entries(TYPE_TO_ABBR)) {
  ABBR_TO_TYPE[v] = k;
}

/**
 * 한 궁성 대각선이 그려진 칸 좌표 (룰북 #2-2).
 * 꼭짓점 4개 + 중앙 = 5칸.
 * @type {Set<string>}
 */
const HAN_PALACE_DIAG = new Set([
  '3,0', '5,0', '4,1', '3,2', '5,2',
]);

/**
 * 초 궁성 대각선이 그려진 칸 좌표 (룰북 #2-2).
 * @type {Set<string>}
 */
const CHO_PALACE_DIAG = new Set([
  '3,7', '5,7', '4,8', '3,9', '5,9',
]);

/**
 * 마/상 배치 코드별 file 2, 7 (왼쪽 쌍), file 1, 6 (오른쪽 쌍) 매핑.
 * 코드의 각 문자는 file 1, 2, 6, 7 순서 (0-based)에 대응한다.
 * @type {Record<string, Array<{file: number, type: string}>>}
 */
const SETUP_MAP = {
  MSMS: [
    { file: 1, type: 'horse' }, { file: 2, type: 'elephant' },
    { file: 6, type: 'horse' }, { file: 7, type: 'elephant' },
  ],
  SMSM: [
    { file: 1, type: 'elephant' }, { file: 2, type: 'horse' },
    { file: 6, type: 'elephant' }, { file: 7, type: 'horse' },
  ],
  MSSM: [
    { file: 1, type: 'horse' }, { file: 2, type: 'elephant' },
    { file: 6, type: 'elephant' }, { file: 7, type: 'horse' },
  ],
  SMMS: [
    { file: 1, type: 'elephant' }, { file: 2, type: 'horse' },
    { file: 6, type: 'horse' }, { file: 7, type: 'elephant' },
  ],
};

// ── 기물 생성 헬퍼 ────────────────────────────────────────────────

/**
 * 기물 객체를 생성한다.
 * @param {string} type 기물 유형
 * @param {'han'|'cho'} side 진영
 * @returns {{ type: string, side: 'han'|'cho' }}
 */
function piece(type, side) {
  return { type, side };
}

// ── 보드 생성 ─────────────────────────────────────────────────────

/**
 * 빈 9x10 보드를 생성한다.
 * 내부 표현: board[rank][file] = Piece | null
 * @returns {Array<Array<{type:string,side:string}|null>>}
 */
export function createBoard() {
  const board = [];
  for (let r = 0; r < NUM_RANKS; r++) {
    board.push(new Array(NUM_FILES).fill(null));
  }
  return board;
}

/**
 * 마/상 배치 코드를 적용하여 초기 보드를 완성한다 (룰북 #4-1, #4-2).
 * 고정 기물(차, 사, 궁, 포, 졸/병)은 항상 동일 위치에 배치하고,
 * 마/상만 setupCode에 따라 배치한다.
 *
 * @param {'MSMS'|'SMSM'|'MSSM'|'SMMS'} hanSetup 한 진영 배치 코드
 * @param {'MSMS'|'SMSM'|'MSSM'|'SMMS'} choSetup 초 진영 배치 코드
 * @returns {Array<Array<{type:string,side:string}|null>>} 초기 보드
 */
export function createInitialBoard(hanSetup, choSetup) {
  const board = createBoard();

  // ── 한(漢) 진영 고정 배치 (rank 0~3) ──
  // 차: (0,0), (8,0)
  setPiece(board, 0, 0, piece('chariot', 'han'));
  setPiece(board, 8, 0, piece('chariot', 'han'));
  // 사: (3,0), (5,0)
  setPiece(board, 3, 0, piece('advisor', 'han'));
  setPiece(board, 5, 0, piece('advisor', 'han'));
  // 궁: (4,1)
  setPiece(board, 4, 1, piece('king', 'han'));
  // 포: (1,2), (7,2)
  setPiece(board, 1, 2, piece('cannon', 'han'));
  setPiece(board, 7, 2, piece('cannon', 'han'));
  // 졸: (0,3), (2,3), (4,3), (6,3), (8,3)
  for (const f of [0, 2, 4, 6, 8]) {
    setPiece(board, f, 3, piece('soldier', 'han'));
  }

  // ── 초(楚) 진영 고정 배치 (rank 6~9) ──
  // 차: (0,9), (8,9)
  setPiece(board, 0, 9, piece('chariot', 'cho'));
  setPiece(board, 8, 9, piece('chariot', 'cho'));
  // 사: (3,9), (5,9)
  setPiece(board, 3, 9, piece('advisor', 'cho'));
  setPiece(board, 5, 9, piece('advisor', 'cho'));
  // 궁: (4,8)
  setPiece(board, 4, 8, piece('king', 'cho'));
  // 포: (1,7), (7,7)
  setPiece(board, 1, 7, piece('cannon', 'cho'));
  setPiece(board, 7, 7, piece('cannon', 'cho'));
  // 병: (0,6), (2,6), (4,6), (6,6), (8,6)
  for (const f of [0, 2, 4, 6, 8]) {
    setPiece(board, f, 6, piece('soldier', 'cho'));
  }

  // ── 마/상 배치 (setup 코드 적용) ──
  const hanPlacements = SETUP_MAP[hanSetup];
  const choPlacements = SETUP_MAP[choSetup];

  if (!hanPlacements || !choPlacements) {
    throw new Error(`유효하지 않은 배치 코드: han=${hanSetup}, cho=${choSetup}`);
  }

  for (const { file, type } of hanPlacements) {
    setPiece(board, file, 0, piece(type, 'han'));
  }
  for (const { file, type } of choPlacements) {
    setPiece(board, file, 9, piece(type, 'cho'));
  }

  return board;
}

// ── 보드 조회/수정 ────────────────────────────────────────────────

/**
 * 지정 좌표의 기물을 반환한다.
 * @param {Array<Array<{type:string,side:string}|null>>} board
 * @param {number} file 0..8
 * @param {number} rank 0..9
 * @returns {{type:string,side:string}|null}
 */
export function getPiece(board, file, rank) {
  if (!inBounds(file, rank)) return null;
  return board[rank][file];
}

/**
 * 지정 좌표에 기물을 배치한다.
 * @param {Array<Array<{type:string,side:string}|null>>} board
 * @param {number} file
 * @param {number} rank
 * @param {{type:string,side:string}|null} p 기물 또는 null
 */
export function setPiece(board, file, rank, p) {
  if (!inBounds(file, rank)) return;
  board[rank][file] = p;
}

/**
 * 기물을 이동시키고 잡힌 기물(있으면)을 반환한다.
 * 출발지는 null로 비워진다.
 * @param {Array<Array<{type:string,side:string}|null>>} board
 * @param {number} fromFile
 * @param {number} fromRank
 * @param {number} toFile
 * @param {number} toRank
 * @returns {{type:string,side:string}|null} 잡힌 기물 또는 null
 */
export function movePiece(board, fromFile, fromRank, toFile, toRank) {
  const captured = getPiece(board, toFile, toRank);
  const moving = getPiece(board, fromFile, fromRank);
  setPiece(board, toFile, toRank, moving);
  setPiece(board, fromFile, fromRank, null);
  return captured;
}

/**
 * 보드를 깊은 복사한다 (시뮬레이션용).
 * @param {Array<Array<{type:string,side:string}|null>>} board
 * @returns {Array<Array<{type:string,side:string}|null>>}
 */
export function cloneBoard(board) {
  return board.map(row =>
    row.map(cell => (cell ? { type: cell.type, side: cell.side } : null))
  );
}

// ── 직렬화 ────────────────────────────────────────────────────────

/**
 * 보드를 JSON 직렬화 가능한 2D 배열로 반환한다.
 * 기물 객체를 약어+진영 형태의 간결한 형식으로 변환한다.
 * @param {Array<Array<{type:string,side:string}|null>>} board
 * @returns {Array<Array<{type:string,side:string}|null>>} 깊은 복사된 배열
 */
export function serialize(board) {
  return board.map(row =>
    row.map(cell => (cell ? { type: cell.type, side: cell.side } : null))
  );
}

/**
 * 직렬화된 배열을 보드로 복원한다 (재접속 복구용).
 * @param {Array<Array<{type:string,side:string}|null>>} data
 * @returns {Array<Array<{type:string,side:string}|null>>}
 */
export function deserialize(data) {
  return data.map(row =>
    row.map(cell => (cell ? { type: cell.type, side: cell.side } : null))
  );
}

/**
 * 보드 상태와 차례를 결합하여 동형반복 판정용 해시 문자열을 생성한다.
 * 안정적인 문자열 표현을 위해 각 칸을 약어(예: 'hK')로 인코딩한다.
 * @param {Array<Array<{type:string,side:string}|null>>} board
 * @param {'han'|'cho'} turn
 * @returns {string}
 */
export function boardHash(board, turn) {
  const parts = [];
  for (let r = 0; r < NUM_RANKS; r++) {
    const rowParts = [];
    for (let f = 0; f < NUM_FILES; f++) {
      const cell = board[r][f];
      if (cell) {
        const sideChar = cell.side === 'han' ? 'h' : 'c';
        rowParts.push(sideChar + TYPE_TO_ABBR[cell.type]);
      } else {
        rowParts.push('--');
      }
    }
    parts.push(rowParts.join(''));
  }
  return parts.join('/') + ':' + turn;
}

// ── 좌표 유틸리티 ─────────────────────────────────────────────────

/**
 * 좌표가 유효한 보드 범위인지 확인한다.
 * @param {number} file
 * @param {number} rank
 * @returns {boolean}
 */
export function inBounds(file, rank) {
  return file >= 0 && file < NUM_FILES && rank >= 0 && rank < NUM_RANKS;
}

/**
 * 좌표가 궁성 내부인지 확인한다 (룰북 #2-2).
 * @param {number} file
 * @param {number} rank
 * @param {'han'|'cho'} side 어느 진영 궁성인지
 * @returns {boolean}
 */
export function inPalace(file, rank, side) {
  if (file < 3 || file > 5) return false;
  if (side === 'han') return rank >= 0 && rank <= 2;
  return rank >= 7 && rank <= 9;
}

/**
 * 궁성에서 대각선이 그려진 칸인지 확인한다 (룰북 #2-2).
 * 궁/사/차/포/졸의 궁성 대각선 이동 허용 여부 판정에 사용.
 * @param {number} file
 * @param {number} rank
 * @returns {boolean}
 */
export function isPalaceDiagonal(file, rank) {
  const key = `${file},${rank}`;
  return HAN_PALACE_DIAG.has(key) || CHO_PALACE_DIAG.has(key);
}

/**
 * 좌표가 어느 진영의 궁성에 속하는지 반환한다.
 * 궁성에 속하지 않으면 null.
 * @param {number} file
 * @param {number} rank
 * @returns {'han'|'cho'|null}
 */
export function whichPalace(file, rank) {
  if (inPalace(file, rank, 'han')) return 'han';
  if (inPalace(file, rank, 'cho')) return 'cho';
  return null;
}
