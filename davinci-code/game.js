/**
 * @fileoverview 다빈치 코드 플러스(3색) 게임 상태 관리.
 *
 * 룰 요약 (2인 단순화):
 * - 빨강 0~11 + 조커 / 노랑 0~11 + 조커 / 파랑 0~11 + 조커 = 39장
 * - 각자 4장씩(숫자 카드) 비공개로 손에 들고, 조커 1장은 별도 보관 후 배치 페이즈에서 위치 선택
 * - 자기 손은 숫자 오름차순 정렬 (동률 시 red < yellow < blue)
 * - 배치 페이즈: 조커를 손패의 원하는 위치에 삽입 (양쪽 모두 배치 완료 시 게임 시작)
 * - 턴: 덱에서 1장 → 상대 카드 슬롯+숫자(또는 조커) 추측
 *   - 맞힘: 상대 카드 공개 → 계속 추측 / 멈춤 선택
 *     - 멈춤: 뽑은 카드 비공개로 자기 손에 추가, 턴 종료
 *     - 계속: 다시 추측 (뽑은 카드는 그대로)
 *   - 틀림: 뽑은 카드 공개해 자기 손에 추가, 턴 종료
 *     - 덱 비어서 못 뽑은 상태면: 자기 손에서 미공개 1장 골라 공개
 * - 한쪽 손 전부 공개되면 상대 승.
 */

// ── 상수 ──────────────────────────────────────────────────────────
/** 카드 색상 (red < yellow < blue 순서). */
export const COLORS = /** @type {const} */ (['red', 'yellow', 'blue']);
/** 카드 숫자 범위 (0~11). */
export const VALUES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
/** 시작 손패 크기 (숫자 카드만). */
export const INITIAL_HAND_SIZE = 4;
/** 색상 정렬 우선순위 (낮을수록 앞). */
const COLOR_ORDER = { red: 0, yellow: 1, blue: 2 };
/** 색상별 ID prefix. */
const COLOR_PREFIX = { red: 'r', yellow: 'y', blue: 'b' };

// ── 유틸 ──────────────────────────────────────────────────────────
/**
 * Fisher-Yates 셔플 (in-place).
 * @template T
 * @param {T[]} arr
 * @returns {T[]} 같은 배열
 */
function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * 전체 39장 덱을 생성한다.
 * 각 색상별 숫자 카드 12장(0~11) + 조커 1장 = 13장 x 3 = 39장.
 * @returns {Card[]}
 */
function buildFullDeck() {
  /** @type {Card[]} */
  const deck = [];
  for (const color of COLORS) {
    const prefix = COLOR_PREFIX[color];
    for (const value of VALUES) {
      deck.push({
        id: `${prefix}${value}`,
        color,
        value,
        revealed: false,
        isJoker: false,
      });
    }
    // 조커
    deck.push({
      id: `${prefix}-joker`,
      color,
      value: null,
      revealed: false,
      isJoker: true,
    });
  }
  return deck;
}

/**
 * 손패 정렬: 숫자 카드만 value 오름차순, 동률이면 red < yellow < blue.
 * 조커는 배치된 인덱스 위치를 유지한다 (정렬 대상에서 제외).
 * @param {Card[]} hand
 */
function sortHand(hand) {
  // 조커의 현재 인덱스와 참조를 기록
  const jokers = [];
  const numerics = [];
  for (let i = 0; i < hand.length; i++) {
    if (hand[i].isJoker) {
      jokers.push({ index: i, card: hand[i] });
    } else {
      numerics.push(hand[i]);
    }
  }

  // 조커가 없으면 전체 정렬
  if (jokers.length === 0) {
    hand.sort((a, b) => {
      if (a.value !== b.value) return a.value - b.value;
      return COLOR_ORDER[a.color] - COLOR_ORDER[b.color];
    });
    return;
  }

  // 숫자 카드만 정렬
  numerics.sort((a, b) => {
    if (a.value !== b.value) return a.value - b.value;
    return COLOR_ORDER[a.color] - COLOR_ORDER[b.color];
  });

  // 조커 위치를 유지하면서 숫자 카드를 재배치
  hand.length = 0;
  let numIdx = 0;
  const totalLen = numerics.length + jokers.length;
  for (let i = 0; i < totalLen; i++) {
    const jokerHere = jokers.find((j) => j.index === i);
    if (jokerHere) {
      hand.push(jokerHere.card);
    } else {
      hand.push(numerics[numIdx++]);
    }
  }
}

/**
 * 숫자 카드를 정렬된 손패에 올바른 위치에 삽입한다.
 * 조커의 위치는 건드리지 않고, 숫자 카드끼리의 순서만 고려하여 삽입한다.
 * @param {Card[]} hand
 * @param {Card} card - 삽입할 숫자 카드
 */
function insertCardSorted(hand, card) {
  hand.push(card);
  sortHand(hand);
}

// ── 타입 정의 (JSDoc) ─────────────────────────────────────────────
/**
 * @typedef {Object} Card
 * @property {string} id          - 숫자: 'r0'~'r11', 'y0'~'y11', 'b0'~'b11' / 조커: 'r-joker', 'y-joker', 'b-joker'
 * @property {'red'|'yellow'|'blue'} color
 * @property {number|null} value  - 0~11, 조커는 null
 * @property {boolean} revealed   - 공개 여부
 * @property {boolean} isJoker    - 조커 여부
 */

/**
 * @typedef {Object} GameState
 * @property {Card[]} deck
 * @property {{p1: Card[], p2: Card[]}} hands
 * @property {Card|null} pendingDrawn          - 현재 턴에서 뽑은 카드 (덱 비면 null)
 * @property {'p1'|'p2'|null} pendingDrawnOwner
 * @property {'p1'|'p2'} turn
 * @property {'awaiting_joker_placement'|'awaiting_guess'|'awaiting_continue_decision'|'awaiting_self_reveal'|'won'} phase
 * @property {'p1'|'p2'|null} winner
 * @property {{from:string, slot:number, value:number|null, correct:boolean, actualColor?:string, actualValue?:number|null}|null} lastGuess
 * @property {{p1: Card|null, p2: Card|null}} unplacedJokers - 아직 배치되지 않은 조커
 * @property {{p1: boolean, p2: boolean}} jokerPlaced - 조커 배치 완료 여부
 */

// ── 게임 생성 ─────────────────────────────────────────────────────
/**
 * 새 게임 상태를 생성한다.
 * 배분 후 조커를 손패에서 분리하여 unplacedJokers에 보관한다.
 * @param {'p1'|'p2'} [firstTurn] - 선공 (기본 p1)
 * @returns {GameState}
 */
export function createGame(firstTurn = 'p1') {
  const deck = shuffleInPlace(buildFullDeck());
  // 각자 숫자 카드 4장 + 조커 1장 = 5장씩 배분 (총 10장 소모)
  // 단, 조커가 섞여있으므로 충분히 뽑은 후 분리
  const p1Raw = deck.splice(0, INITIAL_HAND_SIZE + 1); // 5장
  const p2Raw = deck.splice(0, INITIAL_HAND_SIZE + 1); // 5장

  // 조커 분리 — 만약 5장 중 조커가 2장 이상 있으면 1장만 분리하고 나머지는 덱에 반납 후 숫자 카드 보충
  // 5장 중 조커가 0장이면 덱에서 조커 1장을 찾아서 가져오고 숫자 카드 1장을 반납
  function separateJoker(rawHand) {
    const jokerIdx = rawHand.findIndex((c) => c.isJoker);
    if (jokerIdx >= 0) {
      const joker = rawHand.splice(jokerIdx, 1)[0];
      // 추가 조커가 있으면 덱에 반납하고 숫자 카드 보충
      while (rawHand.length < INITIAL_HAND_SIZE) {
        const extraJokerIdx = rawHand.findIndex((c) => c.isJoker);
        if (extraJokerIdx >= 0) {
          deck.push(rawHand.splice(extraJokerIdx, 1)[0]);
        }
        // 숫자 카드 부족 시 덱에서 보충
        if (rawHand.length < INITIAL_HAND_SIZE) {
          const numCard = deck.findIndex((c) => !c.isJoker);
          if (numCard >= 0) rawHand.push(deck.splice(numCard, 1)[0]);
          else break;
        }
      }
      // 남은 추가 조커도 반납
      for (let i = rawHand.length - 1; i >= 0; i--) {
        if (rawHand[i].isJoker) {
          deck.push(rawHand.splice(i, 1)[0]);
          const numCard = deck.findIndex((c) => !c.isJoker);
          if (numCard >= 0) rawHand.push(deck.splice(numCard, 1)[0]);
        }
      }
      return joker;
    }
    // 조커가 없으면 덱에서 조커 1장을 찾아 가져오고 숫자 카드 1장 반납
    const deckJokerIdx = deck.findIndex((c) => c.isJoker);
    if (deckJokerIdx >= 0) {
      const joker = deck.splice(deckJokerIdx, 1)[0];
      // 숫자 카드 1장 반납 (마지막 카드)
      deck.push(rawHand.pop());
      return joker;
    }
    // 이론적으로 도달 불가 (39장에 조커 3장)
    return null;
  }

  const p1Joker = separateJoker(p1Raw);
  const p2Joker = separateJoker(p2Raw);

  // 덱 다시 셔플 (반납된 카드 포함)
  shuffleInPlace(deck);

  const p1Hand = p1Raw.slice(0, INITIAL_HAND_SIZE);
  const p2Hand = p2Raw.slice(0, INITIAL_HAND_SIZE);
  sortHand(p1Hand);
  sortHand(p2Hand);

  /** @type {GameState} */
  const state = {
    deck,
    hands: { p1: p1Hand, p2: p2Hand },
    pendingDrawn: null,
    pendingDrawnOwner: null,
    turn: firstTurn,
    phase: 'awaiting_joker_placement',
    winner: null,
    lastGuess: null,
    unplacedJokers: { p1: p1Joker, p2: p2Joker },
    jokerPlaced: { p1: false, p2: false },
  };

  return state;
}

/**
 * 현재 턴 플레이어를 위해 덱에서 1장 뽑아 pendingDrawn으로 설정한다.
 * 덱이 비어있으면 pendingDrawn = null (덱 비면 자기 카드 공개로 대체).
 * @param {GameState} state
 */
function drawForCurrentTurn(state) {
  if (state.deck.length > 0) {
    state.pendingDrawn = state.deck.shift();
    state.pendingDrawnOwner = state.turn;
  } else {
    state.pendingDrawn = null;
    state.pendingDrawnOwner = null;
  }
}

// ── 액션: 조커 배치 ──────────────────────────────────────────────
/**
 * 플레이어가 조커를 손패의 지정 위치에 배치한다.
 * @param {GameState} state
 * @param {'p1'|'p2'} playerId
 * @param {number} insertAfter - -1이면 맨 앞(index 0), N이면 N+1 위치에 삽입
 * @returns {{ok: boolean, error?: string, bothPlaced?: boolean}}
 */
export function placeJoker(state, playerId, insertAfter) {
  if (state.phase !== 'awaiting_joker_placement') {
    return { ok: false, error: '지금은 조커 배치 단계가 아니다' };
  }
  if (state.jokerPlaced[playerId]) {
    return { ok: false, error: '이미 조커를 배치했다' };
  }
  const joker = state.unplacedJokers[playerId];
  if (!joker) {
    return { ok: false, error: '배치할 조커가 없다' };
  }

  const hand = state.hands[playerId];
  if (!Number.isInteger(insertAfter) || insertAfter < -1 || insertAfter >= hand.length) {
    return { ok: false, error: '잘못된 배치 위치' };
  }

  // 조커를 손패에 삽입
  hand.splice(insertAfter + 1, 0, joker);
  state.unplacedJokers[playerId] = null;
  state.jokerPlaced[playerId] = true;

  const bothPlaced = state.jokerPlaced.p1 && state.jokerPlaced.p2;
  if (bothPlaced) {
    // 양쪽 배치 완료 → 게임 시작
    state.phase = 'awaiting_guess';
    drawForCurrentTurn(state);
  }

  return { ok: true, bothPlaced };
}

// ── 액션: 추측 ────────────────────────────────────────────────────
/**
 * 현재 턴 플레이어가 상대 카드를 지목해 숫자 또는 조커를 추측한다.
 * @param {GameState} state
 * @param {string} playerId
 * @param {number} slot   - 상대 손 인덱스 0..n-1
 * @param {number|null} value  - 추측 숫자 0~11, 또는 null(조커 추측)
 * @returns {{ok:boolean, error?:string, correct?:boolean, win?:boolean}}
 */
export function guess(state, playerId, slot, value) {
  if (state.phase !== 'awaiting_guess') {
    return { ok: false, error: '지금은 추측 단계가 아니다' };
  }
  if (state.turn !== playerId) {
    return { ok: false, error: '당신의 턴이 아니다' };
  }
  // 숫자 유효성 검사: null(조커 추측)은 허용, 숫자는 0~11 범위
  if (value !== null && (!Number.isInteger(value) || value < 0 || value > 11)) {
    return { ok: false, error: '숫자는 0~11 사이' };
  }

  const opponent = playerId === 'p1' ? 'p2' : 'p1';
  const oppHand = state.hands[opponent];
  if (!Number.isInteger(slot) || slot < 0 || slot >= oppHand.length) {
    return { ok: false, error: '잘못된 슬롯' };
  }
  const target = oppHand[slot];
  if (target.revealed) {
    return { ok: false, error: '이미 공개된 카드' };
  }

  // 정답 판정: 조커이면 value===null이어야 정답, 숫자이면 value===target.value
  const correct = target.isJoker ? value === null : target.value === value;
  state.lastGuess = {
    from: playerId,
    slot,
    value,
    correct,
    actualColor: target.color,
    actualValue: correct ? (target.isJoker ? null : target.value) : undefined,
  };

  if (correct) {
    // 맞춤 → 상대 카드 공개
    target.revealed = true;

    // 승리 검사: 상대 손 전부 revealed인가?
    if (oppHand.every((c) => c.revealed)) {
      state.phase = 'won';
      state.winner = playerId;
      return { ok: true, correct: true, win: true };
    }

    // 계속/멈춤 선택 단계로
    state.phase = 'awaiting_continue_decision';
    return { ok: true, correct: true };
  }

  // 틀림 처리
  return failGuess(state, playerId);
}

/**
 * 추측 실패 처리.
 * 덱에서 뽑은 카드가 있으면 그걸 공개해 자기 손에 추가, 없으면 자기 카드 공개 단계로.
 * @param {GameState} state
 * @param {string} playerId
 * @returns {{ok:true, correct:false, win?:boolean}}
 */
function failGuess(state, playerId) {
  if (state.pendingDrawn) {
    // 뽑은 카드를 공개로 자기 손에 추가
    state.pendingDrawn.revealed = true;
    insertCardSorted(state.hands[playerId], state.pendingDrawn);
    state.pendingDrawn = null;
    state.pendingDrawnOwner = null;

    // 자기 손 전부 공개되면 상대 승 (드물지만 가능)
    if (state.hands[playerId].every((c) => c.revealed)) {
      state.phase = 'won';
      state.winner = playerId === 'p1' ? 'p2' : 'p1';
      return { ok: true, correct: false, win: true };
    }

    // 턴 넘김
    endTurn(state);
    return { ok: true, correct: false };
  }
  // 덱이 비어 못 뽑은 상태 → 자기 카드 공개 선택 단계
  state.phase = 'awaiting_self_reveal';
  return { ok: true, correct: false };
}

// ── 액션: 계속/멈춤 결정 ──────────────────────────────────────────
/**
 * 정답 후 "계속 추측" 또는 "멈춤" 결정.
 * @param {GameState} state
 * @param {string} playerId
 * @param {'continue'|'stop'} decision
 * @returns {{ok:boolean, error?:string}}
 */
export function continueDecision(state, playerId, decision) {
  if (state.phase !== 'awaiting_continue_decision') {
    return { ok: false, error: '지금은 선택 단계가 아니다' };
  }
  if (state.turn !== playerId) {
    return { ok: false, error: '당신의 턴이 아니다' };
  }

  if (decision === 'continue') {
    // 다시 추측 단계 (pendingDrawn 유지)
    state.phase = 'awaiting_guess';
    return { ok: true };
  }
  if (decision === 'stop') {
    // 뽑은 카드를 비공개로 자기 손에 추가 (있으면)
    if (state.pendingDrawn) {
      state.pendingDrawn.revealed = false;
      insertCardSorted(state.hands[playerId], state.pendingDrawn);
      state.pendingDrawn = null;
      state.pendingDrawnOwner = null;
    }
    endTurn(state);
    return { ok: true };
  }
  return { ok: false, error: '선택은 continue 또는 stop' };
}

// ── 액션: 자기 카드 공개 (덱 비었을 때 실패 처리) ─────────────────
/**
 * 덱이 비어 카드를 못 뽑은 상태에서 추측 실패 시, 자기 손 중 미공개 1장을 공개한다.
 * @param {GameState} state
 * @param {string} playerId
 * @param {number} slot   - 자기 손 인덱스
 * @returns {{ok:boolean, error?:string, win?:boolean}}
 */
export function selfReveal(state, playerId, slot) {
  if (state.phase !== 'awaiting_self_reveal') {
    return { ok: false, error: '자기 카드 공개 단계가 아니다' };
  }
  if (state.turn !== playerId) {
    return { ok: false, error: '당신의 턴이 아니다' };
  }
  const myHand = state.hands[playerId];
  if (!Number.isInteger(slot) || slot < 0 || slot >= myHand.length) {
    return { ok: false, error: '잘못된 슬롯' };
  }
  const card = myHand[slot];
  if (card.revealed) {
    return { ok: false, error: '이미 공개된 카드는 선택할 수 없다' };
  }
  card.revealed = true;

  // 자기 손 전부 공개되면 상대 승
  if (myHand.every((c) => c.revealed)) {
    state.phase = 'won';
    state.winner = playerId === 'p1' ? 'p2' : 'p1';
    return { ok: true, win: true };
  }

  endTurn(state);
  return { ok: true };
}

// ── 턴 종료 ──────────────────────────────────────────────────────
/**
 * 현재 턴을 종료하고 상대에게 넘긴 뒤 자동으로 다음 카드를 뽑는다.
 * @param {GameState} state
 */
function endTurn(state) {
  state.turn = state.turn === 'p1' ? 'p2' : 'p1';
  state.phase = 'awaiting_guess';
  drawForCurrentTurn(state);
}

// ── 스냅샷 ────────────────────────────────────────────────────────
/**
 * 특정 플레이어 시점의 상태 스냅샷.
 * 상대 미공개 카드의 value는 절대 노출하지 않는다.
 * @param {GameState} state
 * @param {'p1'|'p2'} playerId
 * @returns {object}
 */
export function snapshotForPlayer(state, playerId) {
  const opponent = playerId === 'p1' ? 'p2' : 'p1';

  const yourHand = state.hands[playerId].map((c) => ({
    id: c.id,
    color: c.color,
    value: c.value,    // 자기 카드는 미공개여도 자기는 봄
    revealed: c.revealed,
    isJoker: c.isJoker,
  }));

  const oppHand = state.hands[opponent].map((c) => ({
    color: c.color,
    value: c.revealed ? c.value : null,  // 미공개면 가림
    revealed: c.revealed,
    isJoker: c.isJoker,
  }));

  let pendingDrawn = null;
  if (state.pendingDrawn) {
    if (state.pendingDrawnOwner === playerId) {
      // 자기가 뽑은 카드는 숫자 봄
      pendingDrawn = {
        color: state.pendingDrawn.color,
        value: state.pendingDrawn.value,
        isJoker: state.pendingDrawn.isJoker,
      };
    } else {
      // 상대가 뽑은 카드는 색깔만
      pendingDrawn = {
        color: state.pendingDrawn.color,
        value: null,
        isJoker: state.pendingDrawn.isJoker,
      };
    }
  }

  const snap = {
    type: 'STATE',
    you: playerId,
    yourHand,
    oppHand,
    pendingDrawn,
    pendingDrawnOwner: state.pendingDrawnOwner,
    deckCount: state.deck.length,
    turn: state.turn,
    phase: state.phase,
    winner: state.winner,
    lastGuess: state.lastGuess,
    jokerPlaced: { ...state.jokerPlaced },
  };

  // 미배치 조커 정보 (자기 것만)
  if (state.unplacedJokers[playerId]) {
    snap.yourUnplacedJoker = {
      color: state.unplacedJokers[playerId].color,
      isJoker: true,
    };
  } else {
    snap.yourUnplacedJoker = null;
  }

  return snap;
}
