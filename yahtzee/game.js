/**
 * @fileoverview 요트 다이스(Yahtzee) 순수 게임 로직 — 서버 권위 모델.
 *
 * 표준 Yahtzee 13 카테고리 룰을 그대로 구현한다. 모든 룰 판정/점수 계산은
 * 서버 측에서 본 모듈의 순수 함수만 사용해 처리한다(서버 권위 패턴).
 * 다이스 랜덤도 서버에서 발생시켜 클라이언트 위조를 차단한다.
 *
 * 핵심 규칙 (사용자 확정):
 *   - 2인 LAN 1:1, 턴 교대 1턴씩 번갈아
 *   - 각자 13턴 = 총 26턴 진행 후 점수 비교
 *   - 다이스 5개, 1턴 최대 3번 굴림 (1차 굴림은 keep 무시)
 *   - 1턴 마무리: 13개 카테고리 중 1개 선택해 점수 기록
 *     (이미 기록된 카테고리는 못 씀, 못 맞춰도 1개는 0점이라도 선택해야 함)
 *   - 상단(1~6) 합 ≥ 63 → +35점 보너스
 *   - Yahtzee 카테고리 50점 기록 상태에서 추가 야츠 → +100점 누적
 *   - Yahtzee 카테고리 0점 기록 상태에서 추가 야츠 → 보너스 없음
 *
 * server.js가 본 모듈을 import 하며, WebSocket/네트워크 코드는 일절 포함하지 않는다.
 */

// ── 상수 ──────────────────────────────────────────────────────────

/** 다이스 개수. */
export const DICE_COUNT = 5;

/** 1턴 최대 굴림 횟수. */
export const MAX_ROLLS_PER_TURN = 3;

/** 각자 진행하는 턴 수(13 카테고리). 총 26턴 게임. */
export const TURNS_PER_PLAYER = 13;

/** 상단(Upper Section) 카테고리 ID 목록. 순서 = UI 표시 순서. */
export const UPPER_CATEGORIES = ['aces', 'twos', 'threes', 'fours', 'fives', 'sixes'];

/** 하단(Lower Section) 카테고리 ID 목록. */
export const LOWER_CATEGORIES = [
  'threeOfAKind',
  'fourOfAKind',
  'fullHouse',
  'smallStraight',
  'largeStraight',
  'yahtzee',
  'chance',
];

/** 전체 13 카테고리 (Upper 6 + Lower 7). */
export const ALL_CATEGORIES = [...UPPER_CATEGORIES, ...LOWER_CATEGORIES];

/** 상단 보너스 도달 임계값. */
export const UPPER_BONUS_THRESHOLD = 63;

/** 상단 보너스 점수. */
export const UPPER_BONUS_SCORE = 35;

/** 추가 야츠 보너스(첫 야츠 50점 기록 후 발생 시 누적). */
export const YAHTZEE_BONUS_SCORE = 100;

/** 상단 카테고리 → 해당 숫자 매핑(점수 계산용). */
const UPPER_FACE_OF = {
  aces: 1, twos: 2, threes: 3, fours: 4, fives: 5, sixes: 6,
};

// ── 내부 헬퍼 ─────────────────────────────────────────────────────

/**
 * 상대 플레이어 ID를 반환한다(2인 고정).
 * @param {string} playerId 'p1'|'p2'
 * @returns {string} 상대 ID
 */
function opponentOf(playerId) {
  return playerId === 'p1' ? 'p2' : 'p1';
}

/**
 * N인 턴 순환 헬퍼. currentId의 다음 플레이어 ID를 반환한다.
 * playerIds 배열 순서대로 순환: p1→p2→p3→…→p1.
 * N=2이면 기존 opponentOf와 동일 결과를 반환한다.
 *
 * @param {string} currentId  현재 턴 플레이어 ID
 * @param {string[]} playerIds  전체 플레이어 ID 배열
 * @returns {string} 다음 턴 플레이어 ID
 */
export function nextPlayer(currentId, playerIds) {
  const idx = playerIds.indexOf(currentId);
  return playerIds[(idx + 1) % playerIds.length];
}

/**
 * 1~6 균등 분포의 정수 1개를 반환한다.
 * @returns {number} 1~6
 */
function rollOneDie() {
  return Math.floor(Math.random() * 6) + 1;
}

/**
 * 다이스 5개 면값을 받아 1~6 각 개수 배열(인덱스 0 미사용)을 반환한다.
 * @param {number[]} dice
 * @returns {number[]} length 7, counts[1]..counts[6]
 */
function countFaces(dice) {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const d of dice) counts[d] += 1;
  return counts;
}

/**
 * 다이스 5개 합산.
 * @param {number[]} dice
 * @returns {number}
 */
function sumDice(dice) {
  return dice.reduce((s, n) => s + n, 0);
}

/**
 * 1턴 점수표(scoreSheet) 초기값을 생성한다. 모든 카테고리는 null(미기록).
 * @returns {Record<string, number|null>}
 */
function emptyScoreSheet() {
  const sheet = {};
  for (const cat of ALL_CATEGORIES) sheet[cat] = null;
  return sheet;
}

// ── 점수 계산 (카테고리별 순수 함수) ─────────────────────────────

/**
 * 주어진 다이스 5개에 대해 특정 카테고리의 점수를 계산한다.
 * 카테고리에 부합하지 않으면 0점을 반환한다(룰 표준).
 *
 * @param {number[]} dice 다이스 5개 면값 배열(각 1~6)
 * @param {string} category ALL_CATEGORIES 중 하나
 * @returns {number} 점수(부합 안 하면 0)
 */
export function calcCategoryScore(dice, category) {
  if (!Array.isArray(dice) || dice.length !== DICE_COUNT) return 0;
  for (const d of dice) {
    if (!Number.isInteger(d) || d < 1 || d > 6) return 0;
  }
  const counts = countFaces(dice);

  // ── 상단: 해당 숫자 개수 × 숫자 ─────────────────────────────
  if (UPPER_FACE_OF[category] !== undefined) {
    const face = UPPER_FACE_OF[category];
    return counts[face] * face;
  }

  // ── 하단 ──────────────────────────────────────────────────
  switch (category) {
    case 'threeOfAKind': {
      // 같은 숫자 3개 이상 → 5개 다이스 합. 부족하면 0.
      const ok = counts.some((c) => c >= 3);
      return ok ? sumDice(dice) : 0;
    }
    case 'fourOfAKind': {
      const ok = counts.some((c) => c >= 4);
      return ok ? sumDice(dice) : 0;
    }
    case 'fullHouse': {
      // 같은 숫자 3개 + 다른 숫자 2개 → 25점 고정.
      // 단, 5개 전부 같은 야츠는 표준상 풀하우스로도 인정(3+2 패턴 포함)
      // 하지만 본 구현은 사용자 스펙대로 "3+2" 패턴으로 한정 — 야츠는 0점.
      // (사용자 스펙에 "3+2"로 명시.)
      let hasThree = false;
      let hasTwo = false;
      for (let f = 1; f <= 6; f++) {
        if (counts[f] === 3) hasThree = true;
        else if (counts[f] === 2) hasTwo = true;
      }
      return (hasThree && hasTwo) ? 25 : 0;
    }
    case 'smallStraight': {
      // 연속 4개 (1234 / 2345 / 3456) → 30점 고정.
      const has = (n) => counts[n] >= 1;
      const s1 = has(1) && has(2) && has(3) && has(4);
      const s2 = has(2) && has(3) && has(4) && has(5);
      const s3 = has(3) && has(4) && has(5) && has(6);
      return (s1 || s2 || s3) ? 30 : 0;
    }
    case 'largeStraight': {
      // 연속 5개 (12345 / 23456) → 40점 고정.
      const has = (n) => counts[n] >= 1;
      const l1 = has(1) && has(2) && has(3) && has(4) && has(5);
      const l2 = has(2) && has(3) && has(4) && has(5) && has(6);
      return (l1 || l2) ? 40 : 0;
    }
    case 'yahtzee': {
      // 5개 같음 → 50점 고정.
      const ok = counts.some((c) => c === DICE_COUNT);
      return ok ? 50 : 0;
    }
    case 'chance': {
      // 아무거나 → 5개 다이스 합.
      return sumDice(dice);
    }
    default:
      return 0;
  }
}

/**
 * 비어있는 모든 카테고리에 대한 미리보기 점수 맵을 반환한다.
 * 카테고리 선택 UI에서 현재 굴린 다이스 기준 점수를 보여주는 데 사용한다.
 *
 * @param {number[]} dice 현재 다이스
 * @param {Record<string, number|null>} sheet 해당 플레이어 점수표
 * @returns {Record<string, number>} 비어있는 카테고리만 점수 미리보기
 */
export function previewAllCategories(dice, sheet) {
  const out = {};
  for (const cat of ALL_CATEGORIES) {
    if (sheet[cat] === null) {
      out[cat] = calcCategoryScore(dice, cat);
    }
  }
  return out;
}

/**
 * 상단 합계(보너스 적용 전).
 * @param {Record<string, number|null>} sheet
 * @returns {number}
 */
export function upperSum(sheet) {
  let s = 0;
  for (const cat of UPPER_CATEGORIES) {
    if (typeof sheet[cat] === 'number') s += sheet[cat];
  }
  return s;
}

/**
 * 상단 보너스 점수(63점 도달 시 35점, 아니면 0).
 * @param {Record<string, number|null>} sheet
 * @returns {number}
 */
export function upperBonus(sheet) {
  return upperSum(sheet) >= UPPER_BONUS_THRESHOLD ? UPPER_BONUS_SCORE : 0;
}

/**
 * 특정 플레이어의 총점 = 상단합 + 상단보너스 + 하단합 + 야츠보너스.
 *
 * @param {Record<string, number|null>} sheet
 * @param {number} yahtzeeBonus 누적된 추가 야츠 보너스(100점 단위)
 * @returns {number}
 */
export function totalScore(sheet, yahtzeeBonus) {
  let lower = 0;
  for (const cat of LOWER_CATEGORIES) {
    if (typeof sheet[cat] === 'number') lower += sheet[cat];
  }
  return upperSum(sheet) + upperBonus(sheet) + lower + (yahtzeeBonus || 0);
}

// ── 공개 함수: 게임 상태 ─────────────────────────────────────────

/**
 * 새 게임 상태를 생성한다.
 * 선공 = playerIds[0] (기본 p1). 초기 dice는 빈 배열(아직 굴리지 않음), rollCount=0.
 *
 * N인 확장: playerIds를 받아 동적으로 점수표와 보너스를 초기화한다.
 * 인자 없이 호출하면 기존 2인(['p1', 'p2']) 동작과 동일하다 (하위 호환).
 *
 * @param {string[]} [playerIds] 플레이어 ID 배열 (기본: ['p1', 'p2'])
 * @returns {GameState}
 */
export function createGame(playerIds) {
  const pids = Array.isArray(playerIds) && playerIds.length >= 2
    ? playerIds
    : ['p1', 'p2'];

  /** @type {GameState} */
  const state = {
    playerIds: pids,
    sheets: Object.fromEntries(pids.map((id) => [id, emptyScoreSheet()])),
    yahtzeeBonus: Object.fromEntries(pids.map((id) => [id, 0])),
    currentTurn: pids[0],
    dice: [0, 0, 0, 0, 0], // 아직 한 번도 굴리지 않은 상태(rollCount=0)
    keep: [false, false, false, false, false],
    rollCount: 0,
    turnNumber: 1, // 1~(13*N) (N명 각 13턴)
    phase: 'playing',
    result: null,
  };
  return state;
}

/**
 * 현재 턴 플레이어가 다이스를 굴린다.
 * - rollCount 0(첫 굴림): keep 무시, 5개 전부 새로 굴림. 첫 굴림 후 rollCount=1.
 * - rollCount 1 또는 2: keep=true 다이스 유지, 나머지만 다시 굴림. rollCount += 1.
 * - rollCount 3 이상: 더 굴릴 수 없음 → 에러.
 *
 * @param {GameState} state
 * @param {string} by 'p1'|'p2'
 * @param {boolean[]} [keep] 길이 5 boolean 배열(true=유지). 1차 굴림에서는 무시.
 * @returns {{ ok: boolean, error?: string, dice?: number[], rollCount?: number }}
 */
export function rollDice(state, by, keep) {
  if (state.phase !== 'playing') {
    return { ok: false, error: '게임이 진행 중이 아닙니다.' };
  }
  if (state.currentTurn !== by) {
    return { ok: false, error: '지금은 당신의 턴이 아닙니다.' };
  }
  if (state.rollCount >= MAX_ROLLS_PER_TURN) {
    return { ok: false, error: '1턴 최대 3번까지만 굴릴 수 있습니다.' };
  }

  // 1차 굴림은 무조건 5개 전부 새로 굴린다(keep 입력 무시).
  if (state.rollCount === 0) {
    for (let i = 0; i < DICE_COUNT; i++) {
      state.dice[i] = rollOneDie();
      state.keep[i] = false;
    }
  } else {
    // 2/3차 굴림: keep 배열 검증 + true는 유지, false는 새로 굴림.
    if (!Array.isArray(keep) || keep.length !== DICE_COUNT) {
      return { ok: false, error: 'keep 배열은 길이 5의 boolean 배열이어야 합니다.' };
    }
    for (let i = 0; i < DICE_COUNT; i++) {
      const k = !!keep[i];
      state.keep[i] = k;
      if (!k) state.dice[i] = rollOneDie();
    }
  }
  state.rollCount += 1;

  return { ok: true, dice: state.dice.slice(), rollCount: state.rollCount };
}

/**
 * 현재 턴 플레이어가 keep 토글 1개를 변경한다(실시간 동기화용).
 *
 * 검증:
 *  - state.phase === 'playing'
 *  - 본인 턴(state.currentTurn === by)
 *  - 1회 이상 굴린 상태(rollCount >= 1) — 1차 굴림 전엔 keep 의미 없음
 *  - 0 ≤ index < DICE_COUNT
 *
 * 통과 시 `state.keep[index] = !!value` 적용. 실패 시 ok:false + error.
 * (3차 굴림 직후라 더 굴릴 수 없는 상태에서도 시각적 keep 표시는 의미가 있을 수 있어
 *  rollCount 상한은 두지 않는다. 실제 의미는 카테고리 선택 직전 점수 미리보기 기준에 영향이 없으므로 무해.)
 *
 * @param {GameState} state
 * @param {string} by 'p1'|'p2'
 * @param {number} index 0~4
 * @param {boolean} value true=keep, false=unkeep
 * @returns {{ ok: boolean, error?: string, index?: number, value?: boolean }}
 */
export function toggleKeep(state, by, index, value) {
  if (state.phase !== 'playing') {
    return { ok: false, error: '게임이 진행 중이 아닙니다.' };
  }
  if (state.currentTurn !== by) {
    return { ok: false, error: '지금은 당신의 턴이 아닙니다.' };
  }
  if (state.rollCount < 1) {
    return { ok: false, error: '1차 굴림 전에는 keep을 토글할 수 없습니다.' };
  }
  if (!Number.isInteger(index) || index < 0 || index >= DICE_COUNT) {
    return { ok: false, error: 'keep 인덱스 범위 오류(0~4).' };
  }
  state.keep[index] = !!value;
  return { ok: true, index, value: state.keep[index] };
}

/**
 * 현재 턴 플레이어가 카테고리를 선택해 점수를 기록한다(1턴 마무리).
 * - 비어있는 카테고리에만 기록 가능(중복 기록 차단).
 * - 부합하지 않아도 0점으로 기록할 수 있다(룰 표준).
 * - 1회 이상 굴린 뒤에만 기록 가능(rollCount >= 1).
 * - 야츠 보너스: yahtzee 카테고리 50점 기록 상태에서 추가 야츠 시 +100점 누적.
 *   yahtzee 0점 기록 상태에서 추가 야츠는 보너스 없음.
 *
 * @param {GameState} state
 * @param {string} by 'p1'|'p2'
 * @param {string} category ALL_CATEGORIES 중 하나
 * @returns {{
 *   ok: boolean, error?: string,
 *   scored?: number, yahtzeeBonusAwarded?: number,
 *   gameOver?: boolean
 * }}
 */
export function scoreCategory(state, by, category) {
  if (state.phase !== 'playing') {
    return { ok: false, error: '게임이 진행 중이 아닙니다.' };
  }
  if (state.currentTurn !== by) {
    return { ok: false, error: '지금은 당신의 턴이 아닙니다.' };
  }
  if (state.rollCount < 1) {
    return { ok: false, error: '다이스를 1회 이상 굴려야 카테고리를 선택할 수 있습니다.' };
  }
  if (!ALL_CATEGORIES.includes(category)) {
    return { ok: false, error: '알 수 없는 카테고리입니다.' };
  }
  const sheet = state.sheets[by];
  if (sheet[category] !== null) {
    return { ok: false, error: '이미 기록된 카테고리입니다.' };
  }

  const dice = state.dice.slice();
  const scored = calcCategoryScore(dice, category);
  sheet[category] = scored;

  // ── 추가 야츠 보너스 처리 ──
  // 조건: 이번 다이스가 야츠(5개 같음) + yahtzee 카테고리 이미 50점 기록.
  // 단, 선택한 카테고리가 yahtzee 자신인 경우는 첫 야츠 50점 그 자체이므로 보너스 없음.
  let yahtzeeBonusAwarded = 0;
  const counts = countFaces(dice);
  const isYahtzeeRoll = counts.some((c) => c === DICE_COUNT);
  if (isYahtzeeRoll && category !== 'yahtzee' && sheet.yahtzee === 50) {
    state.yahtzeeBonus[by] += YAHTZEE_BONUS_SCORE;
    yahtzeeBonusAwarded = YAHTZEE_BONUS_SCORE;
  }

  // ── 턴 정리 ──
  // 다음 턴 준비: 다이스/keep 초기화, rollCount=0, 턴 교대, turnNumber 증가.
  state.dice = [0, 0, 0, 0, 0];
  state.keep = [false, false, false, false, false];
  state.rollCount = 0;
  state.turnNumber += 1;
  // N인 순환: playerIds 배열 순서대로 다음 턴 결정. N=2이면 기존 p1↔p2와 동일.
  state.currentTurn = nextPlayer(by, state.playerIds);

  // ── 종료 판정 ──
  // 두 플레이어 모두 13 카테고리를 전부 채우면 종료.
  const gameOver = isAllFilled(state);
  if (gameOver) {
    finalizeResult(state);
  }

  return { ok: true, scored, yahtzeeBonusAwarded, gameOver };
}

/**
 * N명 플레이어의 모든 카테고리가 채워졌는지 확인.
 * @param {GameState} state
 * @returns {boolean}
 */
function isAllFilled(state) {
  for (const pid of state.playerIds) {
    for (const cat of ALL_CATEGORIES) {
      if (state.sheets[pid][cat] === null) return false;
    }
  }
  return true;
}

/**
 * 최종 결과(state.result + phase)를 채운다.
 * N인 확장: 전원의 합계를 계산하고 최고점자를 winner로 선정한다.
 * @param {GameState} state
 */
function finalizeResult(state) {
  // N인 전원 합계 계산
  const totals = {};
  const breakdown = {};
  for (const pid of state.playerIds) {
    const t = totalScore(state.sheets[pid], state.yahtzeeBonus[pid]);
    totals[pid] = t;
    breakdown[pid] = {
      sheet: { ...state.sheets[pid] },
      upperSum: upperSum(state.sheets[pid]),
      upperBonus: upperBonus(state.sheets[pid]),
      yahtzeeBonus: state.yahtzeeBonus[pid],
      total: t,
    };
  }

  // 최고점자 결정 (동점이면 draw)
  let maxScore = -1;
  let winner = 'draw';
  let tieCount = 0;
  for (const pid of state.playerIds) {
    if (totals[pid] > maxScore) {
      maxScore = totals[pid];
      winner = pid;
      tieCount = 1;
    } else if (totals[pid] === maxScore) {
      tieCount += 1;
    }
  }
  if (tieCount > 1) winner = 'draw';

  state.phase = 'ended';
  state.result = {
    winner,
    totals,
    breakdown,
    // 후방 호환: 2인 시 기존 p1Total/p2Total 필드 유지
    p1Total: totals.p1 !== undefined ? totals.p1 : 0,
    p2Total: totals.p2 !== undefined ? totals.p2 : 0,
  };
}

/**
 * N명 플레이어가 공유하는 STATE 스냅샷을 만든다.
 * 모든 정보가 공개되므로 마스킹은 필요 없다(하나비와 달리 정보 비대칭 없음).
 *
 * @param {GameState} state
 * @returns {object} S→C STATE 메시지 페이로드
 */
export function snapshot(state) {
  const pids = state.playerIds;

  // N인 동적 sheets/upper/totals/yahtzeeBonus 생성
  const sheets = {};
  const upper = {};
  const totals = {};
  const yahtzeeBonus = {};
  for (const pid of pids) {
    sheets[pid] = { ...state.sheets[pid] };
    upper[pid] = {
      sum: upperSum(state.sheets[pid]),
      bonus: upperBonus(state.sheets[pid]),
    };
    totals[pid] = totalScore(state.sheets[pid], state.yahtzeeBonus[pid]);
    yahtzeeBonus[pid] = state.yahtzeeBonus[pid];
  }

  return {
    type: 'STATE',
    playerIds: pids,
    currentTurn: state.currentTurn,
    phase: state.phase,
    dice: state.dice.slice(),
    keep: state.keep.slice(),
    rollCount: state.rollCount,
    turnNumber: state.turnNumber,
    sheets,
    yahtzeeBonus,
    upper,
    totals,
    result: state.result,
  };
}

/**
 * @typedef {Object} GameState
 * @property {string[]} playerIds 플레이어 ID 배열 (예: ['p1', 'p2'] 또는 ['p1', 'p2', 'p3'])
 * @property {Record<string, Record<string, number|null>>} sheets N인 점수표
 * @property {Record<string, number>} yahtzeeBonus N인 추가 야츠 보너스 누적
 * @property {string} currentTurn 현재 턴 플레이어 ID
 * @property {number[]} dice 길이 5
 * @property {boolean[]} keep 길이 5
 * @property {number} rollCount 0~3 (0=아직 안 굴림)
 * @property {number} turnNumber 1~(13*N)
 * @property {string} phase 'playing'|'ended'
 * @property {object|null} result { winner, totals, breakdown, p1Total, p2Total (후방 호환) }
 */
