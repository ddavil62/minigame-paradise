/**
 * @fileoverview 클라이언트 상태 캐시 + 미리보기 점수 계산.
 *
 * 서버는 매 액션 후 STATE를 broadcast하고, 클라는 본 모듈의 cache에 저장한다.
 * 점수 카테고리 미리보기(현재 다이스 기준)는 서버 game.js와 동일한 룰을 재구현한다.
 * (서버는 항상 최종 권위. 미리보기는 UX 보조 표시일 뿐.)
 */

// ── 상수 ──────────────────────────────────────────────────────────
export const DICE_COUNT = 5;
export const MAX_ROLLS_PER_TURN = 3;

export const UPPER_CATEGORIES = ['aces', 'twos', 'threes', 'fours', 'fives', 'sixes'];
export const LOWER_CATEGORIES = [
  'threeOfAKind', 'fourOfAKind', 'fullHouse',
  'smallStraight', 'largeStraight', 'yahtzee', 'chance',
];
export const ALL_CATEGORIES = [...UPPER_CATEGORIES, ...LOWER_CATEGORIES];

/** 카테고리 UI 라벨 (한국어). */
export const CATEGORY_LABEL = {
  aces:           '에이스 (1)',
  twos:           '듀스 (2)',
  threes:         '트리플 (3)',
  fours:          '쿼드 (4)',
  fives:          '시노 (5)',
  sixes:          '식스 (6)',
  threeOfAKind:   '쓰리 오브 어 카인드',
  fourOfAKind:    '포 오브 어 카인드',
  fullHouse:      '풀하우스',
  smallStraight:  '스몰 스트레이트',
  largeStraight:  '라지 스트레이트',
  yahtzee:        '야츠 (Yahtzee)',
  chance:         '찬스',
};

/** 카테고리 룰 설명 (작은 글씨로 표시). */
export const CATEGORY_RULE = {
  aces:           '1의 개수 × 1',
  twos:           '2의 개수 × 2',
  threes:         '3의 개수 × 3',
  fours:          '4의 개수 × 4',
  fives:          '5의 개수 × 5',
  sixes:          '6의 개수 × 6',
  threeOfAKind:   '같은 숫자 3개 이상 → 다이스 합',
  fourOfAKind:    '같은 숫자 4개 이상 → 다이스 합',
  fullHouse:      '3+2 → 25점',
  smallStraight:  '연속 4개 → 30점',
  largeStraight:  '연속 5개 → 40점',
  yahtzee:        '5개 같음 → 50점',
  chance:         '아무거나 → 다이스 합',
};

const UPPER_FACE_OF = {
  aces: 1, twos: 2, threes: 3, fours: 4, fives: 5, sixes: 6,
};

/**
 * 다이스 면 개수 배열.
 * @param {number[]} dice
 * @returns {number[]} length 7
 */
function countFaces(dice) {
  const c = [0, 0, 0, 0, 0, 0, 0];
  for (const d of dice) {
    if (d >= 1 && d <= 6) c[d] += 1;
  }
  return c;
}

function sumDice(dice) {
  return dice.reduce((s, n) => s + n, 0);
}

/**
 * 다이스 5개에 대해 특정 카테고리 점수 계산. 부합 안 하면 0.
 * 서버 game.js의 calcCategoryScore와 동일한 룰.
 *
 * @param {number[]} dice
 * @param {string} category
 * @returns {number}
 */
export function calcCategoryScore(dice, category) {
  if (!Array.isArray(dice) || dice.length !== DICE_COUNT) return 0;
  for (const d of dice) {
    if (!Number.isInteger(d) || d < 1 || d > 6) return 0;
  }
  const counts = countFaces(dice);

  if (UPPER_FACE_OF[category] !== undefined) {
    const face = UPPER_FACE_OF[category];
    return counts[face] * face;
  }
  switch (category) {
    case 'threeOfAKind': {
      return counts.some((c) => c >= 3) ? sumDice(dice) : 0;
    }
    case 'fourOfAKind': {
      return counts.some((c) => c >= 4) ? sumDice(dice) : 0;
    }
    case 'fullHouse': {
      let hasThree = false, hasTwo = false;
      for (let f = 1; f <= 6; f++) {
        if (counts[f] === 3) hasThree = true;
        else if (counts[f] === 2) hasTwo = true;
      }
      return (hasThree && hasTwo) ? 25 : 0;
    }
    case 'smallStraight': {
      const has = (n) => counts[n] >= 1;
      const s1 = has(1) && has(2) && has(3) && has(4);
      const s2 = has(2) && has(3) && has(4) && has(5);
      const s3 = has(3) && has(4) && has(5) && has(6);
      return (s1 || s2 || s3) ? 30 : 0;
    }
    case 'largeStraight': {
      const has = (n) => counts[n] >= 1;
      const l1 = has(1) && has(2) && has(3) && has(4) && has(5);
      const l2 = has(2) && has(3) && has(4) && has(5) && has(6);
      return (l1 || l2) ? 40 : 0;
    }
    case 'yahtzee': {
      return counts.some((c) => c === DICE_COUNT) ? 50 : 0;
    }
    case 'chance': {
      return sumDice(dice);
    }
    default:
      return 0;
  }
}

// ── 클라 상태 캐시 ─────────────────────────────────────────────
/**
 * 마지막으로 받은 STATE를 그대로 캐시한다.
 * 다른 모듈은 getState() 로 접근.
 */
let cached = null;

/**
 * 마지막으로 받은 STATE를 저장한다.
 * @param {object} state
 */
export function setState(state) {
  cached = state;
}

/**
 * 현재 STATE 스냅샷을 반환한다(없으면 null).
 * @returns {object|null}
 */
export function getState() {
  return cached;
}
