/**
 * @fileoverview 7종 테트로미노 정의 + 7-bag 랜덤 생성기 + 회전 행렬.
 *
 * 좌표 시스템: 행렬은 [row][col] 형태. row가 아래로 증가하는 보드 좌표계와 일치한다.
 * 각 피스는 1=채워짐, 0=빈칸으로 표현되며, 회전 상태 0~3에 해당하는 4개 행렬을 갖는다.
 */

// ── 피스 색상 인덱스 ────────────────────────────────────────────
// board의 grid 값과 매핑된다. 0은 빈칸이므로 1부터 시작.
export const PIECE_COLORS = {
  I: 1,
  O: 2,
  T: 3,
  S: 4,
  Z: 5,
  J: 6,
  L: 7,
};

// 인덱스 → 색상 코드 (CSS 변수와 매핑)
export const COLOR_MAP = {
  0: 'var(--cell-empty)',
  1: 'var(--piece-i)',
  2: 'var(--piece-o)',
  3: 'var(--piece-t)',
  4: 'var(--piece-s)',
  5: 'var(--piece-z)',
  6: 'var(--piece-j)',
  7: 'var(--piece-l)',
  8: 'var(--garbage)', // 가비지 라인
};

// 인덱스 → 실제 색상 헥스 (Canvas 렌더링용 — CSS 변수 안 됨)
export const COLOR_HEX = {
  0: '#1a1a2e',
  1: '#00f0f0',
  2: '#f0f000',
  3: '#a000f0',
  4: '#00f000',
  5: '#f00000',
  6: '#0000f0',
  7: '#f0a000',
  8: '#444444',
};

/**
 * 7종 피스의 회전 상태 4종 행렬 정의.
 * 각 회전 상태는 정사각형 행렬 (I와 O는 4x4, 나머지는 3x3).
 * @type {Object<string, number[][][]>}
 */
export const PIECES = {
  I: [
    [
      [0, 0, 0, 0],
      [1, 1, 1, 1],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
    [
      [0, 0, 1, 0],
      [0, 0, 1, 0],
      [0, 0, 1, 0],
      [0, 0, 1, 0],
    ],
    [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [1, 1, 1, 1],
      [0, 0, 0, 0],
    ],
    [
      [0, 1, 0, 0],
      [0, 1, 0, 0],
      [0, 1, 0, 0],
      [0, 1, 0, 0],
    ],
  ],
  O: [
    [
      [0, 1, 1, 0],
      [0, 1, 1, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
    [
      [0, 1, 1, 0],
      [0, 1, 1, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
    [
      [0, 1, 1, 0],
      [0, 1, 1, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
    [
      [0, 1, 1, 0],
      [0, 1, 1, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
  ],
  T: [
    [
      [0, 1, 0],
      [1, 1, 1],
      [0, 0, 0],
    ],
    [
      [0, 1, 0],
      [0, 1, 1],
      [0, 1, 0],
    ],
    [
      [0, 0, 0],
      [1, 1, 1],
      [0, 1, 0],
    ],
    [
      [0, 1, 0],
      [1, 1, 0],
      [0, 1, 0],
    ],
  ],
  S: [
    [
      [0, 1, 1],
      [1, 1, 0],
      [0, 0, 0],
    ],
    [
      [0, 1, 0],
      [0, 1, 1],
      [0, 0, 1],
    ],
    [
      [0, 0, 0],
      [0, 1, 1],
      [1, 1, 0],
    ],
    [
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
    ],
  ],
  Z: [
    [
      [1, 1, 0],
      [0, 1, 1],
      [0, 0, 0],
    ],
    [
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 0],
    ],
    [
      [0, 0, 0],
      [1, 1, 0],
      [0, 1, 1],
    ],
    [
      [0, 1, 0],
      [1, 1, 0],
      [1, 0, 0],
    ],
  ],
  J: [
    [
      [1, 0, 0],
      [1, 1, 1],
      [0, 0, 0],
    ],
    [
      [0, 1, 1],
      [0, 1, 0],
      [0, 1, 0],
    ],
    [
      [0, 0, 0],
      [1, 1, 1],
      [0, 0, 1],
    ],
    [
      [0, 1, 0],
      [0, 1, 0],
      [1, 1, 0],
    ],
  ],
  L: [
    [
      [0, 0, 1],
      [1, 1, 1],
      [0, 0, 0],
    ],
    [
      [0, 1, 0],
      [0, 1, 0],
      [0, 1, 1],
    ],
    [
      [0, 0, 0],
      [1, 1, 1],
      [1, 0, 0],
    ],
    [
      [1, 1, 0],
      [0, 1, 0],
      [0, 1, 0],
    ],
  ],
};

export const PIECE_TYPES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

/**
 * 7-bag 생성기. 7종 피스를 한 번씩 무작위 순서로 반환하는 큐를 유지한다.
 *
 * @returns {{ next: () => string, peek: (n?: number) => string[] }}
 */
export function createBag() {
  /** @type {string[]} 다음 피스 큐 */
  let queue = [];

  /**
   * 새로운 7-bag을 섞어 큐 뒤에 추가한다.
   * Fisher-Yates 셔플 사용.
   */
  function refill() {
    const bag = [...PIECE_TYPES];
    // Fisher-Yates 셔플
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    queue.push(...bag);
  }

  // 초기 2 bag 채워두기 (NEXT 미리보기 3개 확보 + 여유)
  refill();
  refill();

  return {
    /**
     * 다음 피스 타입 1개를 꺼낸다. 큐가 부족하면 새 bag을 추가한다.
     * @returns {string} 'I' | 'O' | 'T' | 'S' | 'Z' | 'J' | 'L'
     */
    next() {
      if (queue.length < 7) refill();
      return queue.shift();
    },

    /**
     * 다음에 나올 피스를 미리 본다 (소비하지 않음).
     * @param {number} [n=3] 미리볼 개수
     * @returns {string[]}
     */
    peek(n = 3) {
      while (queue.length < n) refill();
      return queue.slice(0, n);
    },
  };
}

/**
 * 새로운 피스 인스턴스를 생성한다 (보드 상단 중앙 스폰).
 * @param {string} type - 피스 타입
 * @returns {{ type: string, rotation: number, x: number, y: number, lockResetCount: number }}
 */
export function createPiece(type) {
  // I와 O는 4x4 행렬, 나머지는 3x3 → 보드 폭 10 기준 중앙 정렬
  const matrix = PIECES[type][0];
  const width = matrix[0].length;
  const x = Math.floor((10 - width) / 2);
  return {
    type,
    rotation: 0,
    x,
    y: 0,         // 상단부터 스폰 (음수 행이 필요하면 board에서 처리)
    lockResetCount: 0, // Lock Delay 리셋 횟수 (최대 15회)
  };
}

/**
 * 피스를 지정한 방향으로 회전시킨 새 회전 상태를 반환한다 (인스턴스는 수정하지 않음).
 * @param {object} piece
 * @param {number} dir - +1: 시계방향, -1: 반시계방향
 * @returns {number} 새 rotation 값 (0~3)
 */
export function getRotated(piece, dir) {
  return (piece.rotation + dir + 4) % 4;
}

/**
 * 특정 피스/회전의 행렬을 반환한다.
 * @param {string} type
 * @param {number} rotation
 * @returns {number[][]}
 */
export function getMatrix(type, rotation) {
  return PIECES[type][rotation];
}
