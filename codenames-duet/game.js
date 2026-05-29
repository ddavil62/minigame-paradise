/**
 * @fileoverview 코드네임 듀엣 게임 상태 관리.
 *
 * - 25칸 카드 그리드 생성 (단어 + 키 카드)
 * - 키 카드는 호스트/게스트 시점이 다른 (leftColor, rightColor) 쌍으로 구성
 * - 클릭 판정: green(정답) / neutral(턴 종료) / assassin(즉시 패배)
 * - 미션 토큰 9개로 시작, 추측 횟수만큼 소비
 * - 양쪽 모두 자기 시점 green 9개를 모두 발견하면 승리
 */

import { WORDS } from './words.js';

// ── 상수 ──────────────────────────────────────────────────────────
/** 그리드 크기 (5x5 = 25칸). */
export const BOARD_SIZE = 25;
/** 초기 미션 토큰 수 (코드네임 듀엣 원작 기본 9개). */
export const INITIAL_TOKENS = 9;
/** 양 시점 합산 green 분포 (한 플레이어 시점에서 green 카드 수). */
export const GREEN_PER_SIDE = 9;

/**
 * 듀엣 키 카드 카테고리 분포.
 * 9가지 (좌시점색상, 우시점색상) 조합의 카드 개수.
 *
 * 행렬 (좌\우):
 *           green  neutral  assassin   행합
 *   green    3      4        2          9   ← p1 시점 green = 9
 *   neutral  4      8        1         13   ← p1 시점 neutral = 13
 *   assassin 2      1        0          3   ← p1 시점 assassin = 3
 *   열합     9     13        3         25   ← p2 시점도 동일 9/13/3
 *
 * 검증:
 *  - 합계: 3+4+2+4+8+1+2+1+0 = 25 ✓
 *  - 좌 green: 3+4+2 = 9 ✓ / 우 green: 3+4+2 = 9 ✓
 *  - 좌 assassin: 2+1+0 = 3 ✓ / 우 assassin: 2+1+0 = 3 ✓
 */
const KEY_DISTRIBUTION = [
  { left: 'green',    right: 'green',    count: 3 },
  { left: 'green',    right: 'neutral',  count: 4 },
  { left: 'green',    right: 'assassin', count: 2 },
  { left: 'neutral',  right: 'green',    count: 4 },
  { left: 'neutral',  right: 'neutral',  count: 8 },
  { left: 'neutral',  right: 'assassin', count: 1 },
  { left: 'assassin', right: 'green',    count: 2 },
  { left: 'assassin', right: 'neutral',  count: 1 },
  { left: 'assassin', right: 'assassin', count: 0 },
];

// ── 유틸 ──────────────────────────────────────────────────────────
/**
 * Fisher-Yates 셔플 (in-place).
 * @template T
 * @param {T[]} arr
 * @returns {T[]} 같은 배열(체이닝용)
 */
function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * 단어 풀에서 중복 없이 N개를 뽑아 반환한다.
 * @param {string[]} pool
 * @param {number} n
 * @returns {string[]}
 */
function pickWords(pool, n) {
  const copy = pool.slice();
  shuffleInPlace(copy);
  return copy.slice(0, n);
}

/**
 * 듀엣 키 카드(25칸 색상 쌍 배열)를 생성한다.
 * 각 칸은 { left, right } 형식이며 셔플된 순서로 인덱스 0..24에 매핑된다.
 * @returns {{left:string,right:string}[]}
 */
function buildKeyCard() {
  /** @type {{left:string,right:string}[]} */
  const cells = [];
  for (const cat of KEY_DISTRIBUTION) {
    for (let i = 0; i < cat.count; i++) {
      cells.push({ left: cat.left, right: cat.right });
    }
  }
  if (cells.length !== BOARD_SIZE) {
    throw new Error(`[game] 키 카드 합계 오류: ${cells.length} (기대 ${BOARD_SIZE})`);
  }
  return shuffleInPlace(cells);
}

// ── 게임 상태 ─────────────────────────────────────────────────────
/**
 * @typedef {Object} GameState
 * @property {string[]} words                       - 25개 단어 (인덱스 = 카드 위치)
 * @property {{left:string,right:string}[]} keyCard - 칸별 색상 쌍
 * @property {(null|'green'|'neutral'|'assassin')[]} revealed - 각 칸의 공개 상태(공개된 카드의 실제 색상; null이면 미공개)
 *                                                              여기서 공개된 색상은 "단서를 준 사람의 반대편 시점 색상"이다.
 * @property {number} tokens                        - 남은 미션 토큰
 * @property {string|null} turn                     - 현재 단서를 줘야 하는 플레이어 id ('p1' | 'p2'); null이면 단서 대기 종료(다음 단계)
 * @property {string|null} guessingPlayer           - 현재 추측 중인 플레이어 id (단서를 받은 쪽)
 * @property {{word:string,number:number,from:string}|null} currentClue - 현재 단서
 * @property {number} guessesLeft                   - 현재 단서로 남은 추측 횟수 (number+1; +1은 보너스 추측)
 * @property {'lobby'|'playing'|'won'|'lost'} phase - 게임 상태
 * @property {string} lostReason                    - 'assassin' | 'tokens' | ''
 * @property {{p1:number, p2:number}} greenFound    - 양 플레이어 시점에서 발견한 자기 green 수
 */

/**
 * 새 게임 상태를 생성한다.
 * @param {string} firstClueGiver - 첫 단서를 줄 플레이어 id ('p1' 권장)
 * @param {number} [initialTokens] - 시작 미션 토큰 수 (1~15). 미지정 시 기본값 9.
 * @returns {GameState}
 */
export function createGame(firstClueGiver = 'p1', initialTokens = INITIAL_TOKENS) {
  // 토큰 수 검증 + 클램프
  let t = Number.isInteger(initialTokens) ? initialTokens : INITIAL_TOKENS;
  if (t < 1)  t = 1;
  if (t > 15) t = 15;
  return {
    words: pickWords(WORDS, BOARD_SIZE),
    keyCard: buildKeyCard(),
    revealed: new Array(BOARD_SIZE).fill(null),
    tokens: t,
    turn: firstClueGiver,
    guessingPlayer: null,
    currentClue: null,
    guessesLeft: 0,
    phase: 'playing',
    lostReason: '',
    greenFound: { p1: 0, p2: 0 },
  };
}

/**
 * 현재 단서 입력 → 추측 단계 시작.
 * @param {GameState} state
 * @param {string} playerId - 단서를 주는 플레이어
 * @param {string} word     - 단서 단어
 * @param {number} number   - 단서 숫자 (1~9)
 * @returns {{ok:boolean, error?:string}}
 */
export function submitClue(state, playerId, word, number) {
  if (state.phase !== 'playing') return { ok: false, error: '게임이 종료되었다' };
  if (state.turn !== playerId) return { ok: false, error: '당신의 단서 차례가 아니다' };
  if (state.currentClue) return { ok: false, error: '이미 단서가 활성화되어 있다' };
  if (!word || typeof word !== 'string') return { ok: false, error: '단서 단어가 비어있다' };
  const n = Number(number);
  if (!Number.isInteger(n) || n < 1 || n > 9) return { ok: false, error: '단서 숫자는 1~9' };

  const opponent = playerId === 'p1' ? 'p2' : 'p1';
  state.currentClue = { word: word.trim().slice(0, 30), number: n, from: playerId };
  state.guessingPlayer = opponent;
  state.guessesLeft = n + 1; // 듀엣 규칙: 보너스 추측 +1
  return { ok: true };
}

/**
 * 추측 중인 플레이어가 카드를 클릭한다.
 * @param {GameState} state
 * @param {string} playerId
 * @param {number} index - 0..24
 * @returns {{ok:boolean, error?:string, result?:'green'|'neutral'|'assassin', win?:boolean, lose?:boolean}}
 */
export function guessCard(state, playerId, index) {
  if (state.phase !== 'playing') return { ok: false, error: '게임이 종료되었다' };
  if (state.guessingPlayer !== playerId) return { ok: false, error: '당신의 추측 차례가 아니다' };
  if (!Number.isInteger(index) || index < 0 || index >= BOARD_SIZE) {
    return { ok: false, error: '잘못된 카드 인덱스' };
  }
  if (state.revealed[index] !== null) return { ok: false, error: '이미 공개된 카드' };
  if (state.guessesLeft <= 0) return { ok: false, error: '남은 추측이 없다' };

  // 단서를 준 사람(state.currentClue.from) 시점에서의 색상이 공개된다.
  // 즉 추측한 사람이 보는 것은 "상대(단서 준 사람)의 키 카드"에서의 색상.
  // p1이 단서를 줬다면 left, p2가 줬다면 right.
  const clueGiver = state.currentClue.from;
  const side = clueGiver === 'p1' ? 'left' : 'right';
  const color = state.keyCard[index][side];

  state.revealed[index] = color;

  if (color === 'assassin') {
    state.phase = 'lost';
    state.lostReason = 'assassin';
    return { ok: true, result: 'assassin', lose: true };
  }

  // 카드 공개 시 양쪽 시점의 green을 각각 카운트한다 (공식 듀엣 룰).
  // 즉 카드가 한쪽 시점에선 neutral이고 반대쪽 시점에선 green인 경우,
  // 반대쪽 플레이어의 진척으로 인정된다.
  const guesserId = playerId;
  if (state.keyCard[index].left === 'green')  state.greenFound.p1 = countSideGreen(state, 'left');
  if (state.keyCard[index].right === 'green') state.greenFound.p2 = countSideGreen(state, 'right');

  if (color === 'green') {
    state.guessesLeft -= 1;
    // 양쪽 모두 자기 시점 green 9개를 다 찾으면 승리.
    if (state.greenFound.p1 >= GREEN_PER_SIDE && state.greenFound.p2 >= GREEN_PER_SIDE) {
      state.phase = 'won';
      return { ok: true, result: 'green', win: true };
    }
    if (state.guessesLeft === 0) {
      // 추측 횟수 소진 → 턴 종료. 토큰은 차감하지 않음(보너스 +1을 쓰지 않은 자연 종료).
      endTurn(state, false);
    }
    return { ok: true, result: 'green' };
  }

  // neutral
  // 듀엣 규칙: 중립 카드를 누르면 추측 턴이 즉시 종료되며 미션 토큰 1개 소비.
  // (단, 그 카드가 받는 쪽 시점에서 green이었다면 위에서 이미 그쪽 카운트에 반영됨.)
  state.guessesLeft = 0;
  endTurn(state, true);
  if (state.phase === 'lost') {
    return { ok: true, result: 'neutral', lose: true };
  }
  // 승리 조건도 다시 검사 (받는 쪽 green 9개 도달 + 단서 쪽도 이미 9개였던 경계 케이스)
  if (state.greenFound.p1 >= GREEN_PER_SIDE && state.greenFound.p2 >= GREEN_PER_SIDE) {
    state.phase = 'won';
    return { ok: true, result: 'neutral', win: true };
  }
  return { ok: true, result: 'neutral' };
}

/**
 * 특정 시점(left/right)에서 현재까지 공개된 카드 중 그쪽 시점이 green인 개수를 센다.
 * @param {GameState} state
 * @param {'left'|'right'} side
 * @returns {number}
 */
function countSideGreen(state, side) {
  let n = 0;
  for (let i = 0; i < state.revealed.length; i++) {
    if (state.revealed[i] !== null && state.keyCard[i][side] === 'green') n += 1;
  }
  return n;
}

/**
 * 현재 추측자가 패스(턴 종료)한다.
 * 패스 시에도 미션 토큰 1개 소비 (듀엣 규칙).
 * @param {GameState} state
 * @param {string} playerId
 * @returns {{ok:boolean, error?:string, lose?:boolean}}
 */
export function passTurn(state, playerId) {
  if (state.phase !== 'playing') return { ok: false, error: '게임이 종료되었다' };
  if (state.guessingPlayer !== playerId) return { ok: false, error: '당신의 추측 차례가 아니다' };
  state.guessesLeft = 0;
  endTurn(state, true);
  if (state.phase === 'lost') {
    return { ok: true, lose: true };
  }
  return { ok: true };
}

/**
 * 현재 단서를 종료하고 차례를 상대(단서 입력자)로 넘긴다.
 * 단, 공식 듀엣 룰: 한쪽이 자기 시점 green 9개를 다 찾았다면 그쪽은 단서를 줄 게 없으므로
 * 반대쪽이 남은 게임 동안 계속 단서를 준다.
 * @param {GameState} state
 * @param {boolean} consumeToken - true면 미션 토큰 1개 소비
 */
function endTurn(state, consumeToken) {
  let nextClueGiver = state.guessingPlayer; // 일반적으로 추측하던 쪽이 다음 단서자
  state.currentClue = null;
  state.guessingPlayer = null;
  state.guessesLeft = 0;

  if (consumeToken) {
    state.tokens -= 1;
    if (state.tokens <= 0) {
      state.phase = 'lost';
      state.lostReason = 'tokens';
      state.turn = null;
      return;
    }
  }

  // 다음 단서자 시점에 미공개 green이 0개면 반대쪽이 단서를 준다 (공식 룰).
  if (!hasRemainingGreen(state, nextClueGiver)) {
    const other = nextClueGiver === 'p1' ? 'p2' : 'p1';
    if (hasRemainingGreen(state, other)) {
      nextClueGiver = other;
    }
    // 양쪽 모두 미공개 green 0이면 이미 승리 처리됐어야 함 — 그대로 둔다.
  }
  state.turn = nextClueGiver;
}

/**
 * 특정 플레이어 시점에 아직 미공개인 green 카드가 남아있는지 검사한다.
 * @param {GameState} state
 * @param {string} playerId - 'p1' | 'p2'
 * @returns {boolean}
 */
function hasRemainingGreen(state, playerId) {
  const side = playerId === 'p1' ? 'left' : 'right';
  for (let i = 0; i < state.keyCard.length; i++) {
    if (state.revealed[i] === null && state.keyCard[i][side] === 'green') return true;
  }
  return false;
}

/**
 * 클라이언트(특정 플레이어 시점)에게 보낼 상태 스냅샷을 만든다.
 * 자기 시점의 키 카드만 노출하고, 상대 시점은 숨긴다.
 *
 * @param {GameState} state
 * @param {string} playerId - 'p1' | 'p2'
 * @returns {object}
 */
export function snapshotForPlayer(state, playerId) {
  const side = playerId === 'p1' ? 'left' : 'right';
  const myKey = state.keyCard.map((cell) => cell[side]);
  return {
    type: 'STATE',
    words: state.words,
    revealed: state.revealed,
    myKey,
    tokens: state.tokens,
    turn: state.turn,
    guessingPlayer: state.guessingPlayer,
    currentClue: state.currentClue,
    guessesLeft: state.guessesLeft,
    phase: state.phase,
    lostReason: state.lostReason,
    greenFound: state.greenFound,
    you: playerId,
  };
}
