/**
 * @fileoverview 다빈치 코드(알고리즘) 게임 상태 관리.
 *
 * 룰 요약 (2인 단순화):
 * - 흑색 0~11 + 백색 0~11 = 24장
 * - 각자 4장씩 비공개로 손에 들고, 나머지는 덱
 * - 자기 손은 숫자 오름차순 정렬 (동률 시 흑이 백보다 앞)
 * - 턴: 덱에서 1장 → 상대 카드 슬롯+숫자 추측
 *   - 맞힘: 상대 카드 공개 → 계속 추측 / 멈춤 선택
 *     - 멈춤: 뽑은 카드 비공개로 자기 손에 추가, 턴 종료
 *     - 계속: 다시 추측 (뽑은 카드는 그대로)
 *   - 틀림: 뽑은 카드 공개해 자기 손에 추가, 턴 종료
 *     - 덱 비어서 못 뽑은 상태면: 자기 손에서 미공개 1장 골라 공개
 * - 한쪽 손 전부 공개되면 상대 승.
 */

// ── 상수 ──────────────────────────────────────────────────────────
/** 카드 색상. */
export const COLORS = /** @type {const} */ (['black', 'white']);
/** 카드 숫자 범위 (0~11). */
export const VALUES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
/** 시작 손패 크기. */
export const INITIAL_HAND_SIZE = 4;

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
 * 전체 24장 덱을 생성한다.
 * @returns {Card[]}
 */
function buildFullDeck() {
  /** @type {Card[]} */
  const deck = [];
  for (const color of COLORS) {
    for (const value of VALUES) {
      deck.push({
        id: `${color === 'black' ? 'b' : 'w'}${value}`,
        color,
        value,
        revealed: false,
      });
    }
  }
  return deck;
}

/**
 * 손패 정렬: value 오름차순, 동률이면 black이 white보다 앞.
 * @param {Card[]} hand
 */
function sortHand(hand) {
  hand.sort((a, b) => {
    if (a.value !== b.value) return a.value - b.value;
    if (a.color === b.color) return 0;
    return a.color === 'black' ? -1 : 1;
  });
}

// ── 타입 정의 (JSDoc) ─────────────────────────────────────────────
/**
 * @typedef {Object} Card
 * @property {string} id          - 'b0'~'b11', 'w0'~'w11'
 * @property {'black'|'white'} color
 * @property {number} value       - 0~11
 * @property {boolean} revealed   - 공개 여부
 */

/**
 * @typedef {Object} GameState
 * @property {Card[]} deck
 * @property {{p1: Card[], p2: Card[]}} hands
 * @property {Card|null} pendingDrawn          - 현재 턴에서 뽑은 카드 (덱 비면 null)
 * @property {'p1'|'p2'|null} pendingDrawnOwner
 * @property {'p1'|'p2'} turn
 * @property {'awaiting_guess'|'awaiting_continue_decision'|'awaiting_self_reveal'|'won'} phase
 * @property {'p1'|'p2'|null} winner
 * @property {{from:string, slot:number, value:number, correct:boolean, actualColor?:string, actualValue?:number}|null} lastGuess
 */

// ── 게임 생성 ─────────────────────────────────────────────────────
/**
 * 새 게임 상태를 생성한다.
 * @param {'p1'|'p2'} [firstTurn] - 선공 (기본 p1)
 * @returns {GameState}
 */
export function createGame(firstTurn = 'p1') {
  const deck = shuffleInPlace(buildFullDeck());
  const p1Hand = deck.splice(0, INITIAL_HAND_SIZE);
  const p2Hand = deck.splice(0, INITIAL_HAND_SIZE);
  sortHand(p1Hand);
  sortHand(p2Hand);

  /** @type {GameState} */
  const state = {
    deck,
    hands: { p1: p1Hand, p2: p2Hand },
    pendingDrawn: null,
    pendingDrawnOwner: null,
    turn: firstTurn,
    phase: 'awaiting_guess',
    winner: null,
    lastGuess: null,
  };

  // 첫 턴: 자동으로 1장 뽑기 (덱은 항상 충분히 있음)
  drawForCurrentTurn(state);
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

// ── 액션: 추측 ────────────────────────────────────────────────────
/**
 * 현재 턴 플레이어가 상대 카드를 지목해 숫자를 추측한다.
 * @param {GameState} state
 * @param {string} playerId
 * @param {number} slot   - 상대 손 인덱스 0..n-1
 * @param {number} value  - 추측 숫자 0~11
 * @returns {{ok:boolean, error?:string, correct?:boolean, win?:boolean}}
 */
export function guess(state, playerId, slot, value) {
  if (state.phase !== 'awaiting_guess') {
    return { ok: false, error: '지금은 추측 단계가 아니다' };
  }
  if (state.turn !== playerId) {
    return { ok: false, error: '당신의 턴이 아니다' };
  }
  if (!Number.isInteger(value) || value < 0 || value > 11) {
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

  const correct = target.value === value;
  state.lastGuess = {
    from: playerId,
    slot,
    value,
    correct,
    actualColor: target.color,
    actualValue: correct ? target.value : undefined,
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
    state.hands[playerId].push(state.pendingDrawn);
    sortHand(state.hands[playerId]);
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
      state.hands[playerId].push(state.pendingDrawn);
      sortHand(state.hands[playerId]);
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
  }));

  const oppHand = state.hands[opponent].map((c) => ({
    color: c.color,
    value: c.revealed ? c.value : null,  // 미공개면 가림
    revealed: c.revealed,
  }));

  let pendingDrawn = null;
  if (state.pendingDrawn) {
    if (state.pendingDrawnOwner === playerId) {
      // 자기가 뽑은 카드는 숫자 봄
      pendingDrawn = { color: state.pendingDrawn.color, value: state.pendingDrawn.value };
    } else {
      // 상대가 뽑은 카드는 색깔만
      pendingDrawn = { color: state.pendingDrawn.color, value: null };
    }
  }

  return {
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
  };
}
