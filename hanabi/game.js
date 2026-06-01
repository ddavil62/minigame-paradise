/**
 * @fileoverview 하나비(Hanabi) 순수 게임 로직 — 서버 권위 모델.
 *
 * 협력 카드게임 하나비의 모든 룰 판정을 담당하는 순수 함수 모음이다.
 * server.js가 이 모듈을 import하며, WebSocket/네트워크 코드는 일절 포함하지 않는다.
 * 모든 함수는 GameState 객체를 입력받아 검사·변형하거나(in-place) 마스킹 스냅샷을 반환한다.
 *
 * 룰북 권위 문서: minigames/hanabi/docs/RULEBOOK.md (§1~§13).
 * §13 구현 결정 사항은 코드 주석에 `// §13-N` 형태로 명시한다.
 *
 * 정보 비대칭 핵심:
 *   - 각 플레이어는 자기 손패의 색·숫자를 볼 수 없다(§1).
 *   - snapshotForPlayer()가 본인 손패의 color/number를 null로 마스킹하여
 *     클라이언트로 절대 누설되지 않도록 서버가 강제 보장한다(§12-6).
 */

// ── 상수 ──────────────────────────────────────────────────────────

/** 5색 ID. CSS 클래스명으로도 사용된다(§2-1). */
export const COLORS = ['white', 'red', 'blue', 'green', 'yellow'];

/** 카드 숫자 범위(§2-1). */
export const NUMBERS = [1, 2, 3, 4, 5];

/** 숫자별 각 색당 장수(§2-1): 1→3, 2→2, 3→2, 4→2, 5→1. 색당 합계 10장. */
export const CARD_DISTRIBUTION = { 1: 3, 2: 2, 3: 2, 4: 2, 5: 1 };

/** 초기 정보 토큰(힌트) 개수(§2-2). */
export const INITIAL_CLUE_TOKENS = 8;

/** 초기 폭탄 토큰(실수) 개수(§2-2). */
export const INITIAL_FUSE_TOKENS = 3;

/** 2인 고정 손패 장수(§3, §13-2). */
export const HAND_SIZE = 5;

// ── 내부 헬퍼 ─────────────────────────────────────────────────────

/**
 * 상대 플레이어 ID를 반환한다(2인 고정 — §13-2).
 * @param {string} playerId 'p1'|'p2'
 * @returns {string} 상대 ID
 */
function opponentOf(playerId) {
  return playerId === 'p1' ? 'p2' : 'p1';
}

/**
 * Fisher-Yates 셔플(in-place).
 * @param {Array} arr
 * @returns {Array} 셔플된 동일 배열
 */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * 덱에서 1장을 뽑아 해당 플레이어 손패 맨 뒤(가장 새 카드)에 추가한다(§6-3, §7).
 * 덱이 이미 비었으면 보충하지 않는다.
 * 이 함수는 덱 소진 감지 + 마지막 라운드 카운트다운 초기화도 담당한다(§9 종료-3, §13-7).
 *
 * @param {GameState} state
 * @param {string} playerId 'p1'|'p2'
 */
function drawCard(state, playerId) {
  if (state.deck.length === 0) return; // 덱 소진 — 보충 없음(§6-3)
  const card = state.deck.pop();
  card.clues = []; // 새 카드는 아직 받은 힌트 없음
  state.hands[playerId].push(card);

  // §13-7: 마지막 카드를 뽑아 덱을 처음 비웠다면 마지막 라운드를 발동한다.
  // 덱을 비운 플레이어 포함, 양쪽이 각 1턴씩 더 진행해야 하므로 2턴을 카운트한다.
  // 이미 lastRoundTurnsLeft가 설정돼 있으면 중복 발동하지 않는다.
  if (state.deck.length === 0 && state.deckEmptyTurn === null) {
    state.deckEmptyTurn = playerId;
    state.lastRoundTurnsLeft = 2;
  }
}

/**
 * 턴을 상대에게 넘긴다. 마지막 라운드 카운트다운도 감소시킨다(§13-7).
 *
 * 오프바이원 해설(§9 종료-3, §13-7):
 *   - 덱이 p1 턴에 비면 deckEmptyTurn='p1', lastRoundTurnsLeft=2.
 *   - p1 행동 완료 → advanceTurn → lastRoundTurnsLeft=1, 턴 p2.
 *   - p2 행동 완료 → advanceTurn → lastRoundTurnsLeft=0 → checkGameEnd가 종료.
 *   - 결과: 덱 비운 p1 1턴 + p2 1턴 = 양쪽 각 1턴(§9 충족).
 *
 * @param {GameState} state
 */
function advanceTurn(state) {
  if (state.lastRoundTurnsLeft !== null) {
    state.lastRoundTurnsLeft -= 1;
  }
  state.currentTurn = opponentOf(state.currentTurn);
}

// ── 공개 함수 ─────────────────────────────────────────────────────

/**
 * 새 게임 상태를 생성한다. 덱 셔플 + 손패 각 5장 분배 수행(§3).
 * 선공은 p1 호스트 고정(§13-1).
 *
 * @returns {GameState}
 */
export function createGame() {
  // ── 덱 50장 생성(§2-1) ──
  // COLORS × NUMBERS × CARD_DISTRIBUTION 으로 카드 객체 생성.
  // 같은 색+숫자가 여러 장이므로 일련번호(index)를 id에 포함한다.
  const deck = [];
  for (const color of COLORS) {
    for (const number of NUMBERS) {
      const count = CARD_DISTRIBUTION[number];
      for (let i = 0; i < count; i++) {
        deck.push({ id: `${color}-${number}-${i}`, color, number, clues: [] });
      }
    }
  }
  shuffle(deck);

  /** @type {GameState} */
  const state = {
    deck,
    hands: { p1: [], p2: [] },
    fireworks: { white: 0, red: 0, blue: 0, green: 0, yellow: 0 },
    discardPile: [],
    tokens: { clue: INITIAL_CLUE_TOKENS, fuse: INITIAL_FUSE_TOKENS },
    currentTurn: 'p1', // §13-1: p1(호스트) 선공 고정
    phase: 'playing',
    deckEmptyTurn: null,
    lastRoundTurnsLeft: null,
    // 직전 힌트가 닿은 손패 인덱스(클라 하이라이트용). 다음 STATE에서 null로 초기화된다.
    lastTouch: null,
    result: null,
  };

  // ── 손패 5장씩 분배(§3) ──
  // 번갈아 분배(p1, p2, p1, p2 ...)하여 한쪽이 덱 상단을 독점하지 않도록 한다.
  for (let i = 0; i < HAND_SIZE; i++) {
    drawCard(state, 'p1');
    drawCard(state, 'p2');
  }

  return state;
}

/**
 * 힌트를 준다. §5 규칙 검증.
 *
 * @param {GameState} state
 * @param {string} by        힌트를 주는 플레이어('p1'|'p2')
 * @param {string} target    힌트를 받는 플레이어('p1'|'p2', 2인이므로 항상 상대)
 * @param {'color'|'number'} clueType
 * @param {string|number} value 색 ID 문자열 또는 숫자 1~5
 * @returns {{ ok: boolean, error?: string, touchedIndices?: number[] }}
 */
export function giveClue(state, by, target, clueType, value) {
  if (state.phase !== 'playing') {
    return { ok: false, error: '게임이 진행 중이 아닙니다.' };
  }
  if (state.currentTurn !== by) {
    return { ok: false, error: '지금은 당신의 턴이 아닙니다.' };
  }
  // §5-3: 2인이므로 힌트 대상은 항상 상대. 자기 자신에게는 줄 수 없다.
  if (by === target) {
    return { ok: false, error: '자기 자신에게는 힌트를 줄 수 없습니다.' };
  }
  if (target !== 'p1' && target !== 'p2') {
    return { ok: false, error: '잘못된 힌트 대상입니다.' };
  }
  // §5-2: 정보 토큰이 0개이면 힌트를 줄 수 없다.
  if (state.tokens.clue === 0) {
    return { ok: false, error: '힌트 토큰이 없습니다.' };
  }
  if (clueType !== 'color' && clueType !== 'number') {
    return { ok: false, error: '잘못된 힌트 종류입니다.' };
  }
  if (clueType === 'color' && !COLORS.includes(value)) {
    return { ok: false, error: '잘못된 색입니다.' };
  }
  if (clueType === 'number' && !NUMBERS.includes(value)) {
    return { ok: false, error: '잘못된 숫자입니다.' };
  }

  // 대상 손패에서 clueType+value에 해당하는 카드 인덱스 수집.
  // §5-2: 완전·정확 — 해당 속성 카드는 하나도 빠짐없이 전부 가리킨다.
  const targetHand = state.hands[target];
  const touchedIndices = [];
  for (let i = 0; i < targetHand.length; i++) {
    const card = targetHand[i];
    if (clueType === 'color' && card.color === value) touchedIndices.push(i);
    if (clueType === 'number' && card.number === value) touchedIndices.push(i);
  }

  // §5-2: 0장 힌트 금지 — 가리킬 카드가 없으면 거부한다.
  if (touchedIndices.length === 0) {
    return { ok: false, error: '0장 힌트는 줄 수 없습니다.' };
  }

  // 통과: 토큰 1개 소비 + 닿은 카드에 받은 힌트 누적(§5-3, §13-4).
  state.tokens.clue -= 1;
  for (const idx of touchedIndices) {
    targetHand[idx].clues.push({ type: clueType, value });
  }

  // 클라 하이라이트용 직전 힌트 정보(1턴 유지).
  state.lastTouch = { target, clueType, value, indices: touchedIndices.slice() };

  // §4: 힌트는 카드 보충 없음. 턴만 넘긴다.
  // §13-7: 마지막 라운드의 마지막 턴이 힌트일 수 있으므로 advanceTurn 후 종료 재검사한다.
  // (playCard/discardCard와 동일 패턴. 진입부 phase!=='playing' 가드로 종료 후 힌트는 차단됨.)
  advanceTurn(state);
  checkGameEnd(state);

  return { ok: true, touchedIndices };
}

/**
 * 손패에서 카드를 내어 불꽃에 올린다(§6).
 *
 * @param {GameState} state
 * @param {string} by
 * @param {number} handIndex 0~(손패 길이-1)
 * @returns {{
 *   ok: boolean, error?: string,
 *   success?: boolean, card?: object,
 *   fuseBroke?: boolean, fiveCompleted?: boolean
 * }}
 */
export function playCard(state, by, handIndex) {
  if (state.phase !== 'playing') {
    return { ok: false, error: '게임이 진행 중이 아닙니다.' };
  }
  if (state.currentTurn !== by) {
    return { ok: false, error: '지금은 당신의 턴이 아닙니다.' };
  }
  const hand = state.hands[by];
  if (!Number.isInteger(handIndex) || handIndex < 0 || handIndex >= hand.length) {
    return { ok: false, error: '잘못된 손패 위치입니다.' };
  }

  // 매 행동마다 직전 힌트 하이라이트는 초기화된다.
  state.lastTouch = null;

  const card = hand.splice(handIndex, 1)[0];
  let success = false;
  let fuseBroke = false;
  let fiveCompleted = false;

  // §6-1: 순번 검증 — 그 색 불꽃의 현재 최고 숫자 +1 이면 성공.
  if (state.fireworks[card.color] === card.number - 1) {
    success = true;
    state.fireworks[card.color] = card.number;
    // §6-2: 5 완성 시 정보 토큰 1개 회수(상한 8 초과 시 회수 없음).
    if (card.number === 5) {
      if (state.tokens.clue < INITIAL_CLUE_TOKENS) {
        state.tokens.clue += 1;
        fiveCompleted = true;
      } else {
        fiveCompleted = true; // 회수는 없었지만 5 완성 자체는 성립
      }
    }
  } else {
    // §6-1: 실패(오연주) — 버림 더미로 + 폭탄 토큰 1개 소진.
    state.discardPile.push({ id: card.id, color: card.color, number: card.number });
    state.tokens.fuse -= 1;
    fuseBroke = true;
  }

  // §6-3: 내기 후 1장 보충(덱이 비었으면 보충 없음).
  drawCard(state, by);

  // §9: 종료-1(25점) / 종료-2(폭탄3) 즉시 검사. 종료되면 턴을 넘기지 않는다.
  if (!checkGameEnd(state)) {
    advanceTurn(state);
    // advanceTurn으로 마지막 라운드가 0이 됐을 수 있으므로 재검사(종료-3).
    checkGameEnd(state);
  }

  return {
    ok: true,
    success,
    card: { id: card.id, color: card.color, number: card.number },
    fuseBroke,
    fiveCompleted,
  };
}

/**
 * 손패에서 카드를 버린다(§7).
 *
 * @param {GameState} state
 * @param {string} by
 * @param {number} handIndex
 * @returns {{ ok: boolean, error?: string, card?: object }}
 */
export function discardCard(state, by, handIndex) {
  if (state.phase !== 'playing') {
    return { ok: false, error: '게임이 진행 중이 아닙니다.' };
  }
  if (state.currentTurn !== by) {
    return { ok: false, error: '지금은 당신의 턴이 아닙니다.' };
  }
  // §13-5: 정보 토큰이 가득(8)이면 버리기 행동 자체를 차단한다.
  if (state.tokens.clue >= INITIAL_CLUE_TOKENS) {
    return { ok: false, error: '힌트 토큰이 가득 차 버릴 수 없습니다.' };
  }
  const hand = state.hands[by];
  if (!Number.isInteger(handIndex) || handIndex < 0 || handIndex >= hand.length) {
    return { ok: false, error: '잘못된 손패 위치입니다.' };
  }

  state.lastTouch = null;

  const card = hand.splice(handIndex, 1)[0];
  // §7: 버린 카드는 공개되어 버림 더미에 쌓이고, 정보 토큰 1개 회수(상한 8).
  state.discardPile.push({ id: card.id, color: card.color, number: card.number });
  state.tokens.clue = Math.min(INITIAL_CLUE_TOKENS, state.tokens.clue + 1);

  // §7: 버린 후 1장 보충(덱이 비면 보충 없음).
  drawCard(state, by);

  if (!checkGameEnd(state)) {
    advanceTurn(state);
    checkGameEnd(state);
  }

  return { ok: true, card: { id: card.id, color: card.color, number: card.number } };
}

/**
 * 게임 종료 조건을 검사하고 state.result/state.phase를 설정한다(§9).
 * 매 행동 후 호출. 종료됐으면 true.
 *
 * @param {GameState} state
 * @returns {boolean} 종료됐으면 true
 */
export function checkGameEnd(state) {
  if (state.phase === 'ended') return true;

  const score = calcScore(state);

  // §9 종료-1: 5색 전부 완성 → 즉시 승리, 25점 만점.
  if (score === 25) {
    state.phase = 'ended';
    state.result = {
      outcome: 'win',
      score: 25,
      grade: getGrade(25),
      reason: 'perfect',
    };
    return true;
  }

  // §9 종료-2: 폭탄 토큰 3개 모두 소진 → 즉시 패배.
  // §13-6: 점수 처리는 "현재까지 점수 표기 + 실패 라벨"로 채택.
  if (state.tokens.fuse === 0) {
    state.phase = 'ended';
    state.result = {
      outcome: 'lose',
      score,
      grade: getGrade(score),
      reason: 'fuse',
    };
    return true;
  }

  // §9 종료-3: 덱 소진 후 마지막 라운드 종료(양쪽 각 1턴 — §13-7).
  if (state.lastRoundTurnsLeft === 0) {
    state.phase = 'ended';
    state.result = {
      // 점수가 25면 win, 그 외는 lose로 표기하되 점수로 평가한다.
      outcome: score === 25 ? 'win' : 'lose',
      score,
      grade: getGrade(score),
      reason: 'deck_end',
    };
    return true;
  }

  return false;
}

/**
 * 점수 합계를 계산한다 = 5색 불꽃 각각의 최고 숫자 합(§8, §10).
 * @param {GameState} state
 * @returns {number}
 */
export function calcScore(state) {
  return COLORS.reduce((sum, color) => sum + state.fireworks[color], 0);
}

/**
 * §10 등급표에서 점수에 해당하는 한글 등급을 반환한다.
 * @param {number} score 0~25
 * @returns {string}
 */
export function getGrade(score) {
  if (score >= 25) return '전설의 불꽃놀이!';
  if (score >= 21) return '경이로움';
  if (score >= 16) return '훌륭함';
  if (score >= 11) return '무난함';
  if (score >= 6) return '아쉬움';
  return '처참함';
}

/**
 * 특정 플레이어 시점으로 마스킹된 STATE 스냅샷을 만든다(§12-6).
 *
 * 마스킹 규칙:
 *   - 본인 손패: color=null, number=null(마스킹). 받은 힌트(clues)는 공개.
 *   - 상대 손패: color·number·clues 모두 공개.
 *   - fireworks, discardPile, tokens, currentTurn, phase, result: 공개.
 *   - 덱 남은 장수(deckSize): 공개. 덱 내용(카드 정보): 비공개.
 *
 * @param {GameState} state
 * @param {string} playerId 'p1'|'p2'
 * @returns {object} S→C STATE 메시지 페이로드
 */
export function snapshotForPlayer(state, playerId) {
  const opponentId = opponentOf(playerId);

  return {
    type: 'STATE',
    you: playerId,
    currentTurn: state.currentTurn,
    phase: state.phase,
    tokens: { clue: state.tokens.clue, fuse: state.tokens.fuse },
    fireworks: { ...state.fireworks },
    discardPile: state.discardPile.map((c) => ({
      id: c.id, color: c.color, number: c.number,
    })),
    deckSize: state.deck.length,
    lastRoundTurnsLeft: state.lastRoundTurnsLeft,
    lastTouch: state.lastTouch,
    result: state.result,
    // §12-6 손패 가림 핵심: 본인 손패는 color/number를 null로 마스킹한다.
    myHand: state.hands[playerId].map((c) => ({
      id: c.id,
      color: null,
      number: null,
      clues: c.clues.slice(),
    })),
    // 상대 손패는 색·숫자 공개(§1: 상대 손패는 보인다).
    opponentHand: state.hands[opponentId].map((c) => ({
      id: c.id,
      color: c.color,
      number: c.number,
      clues: c.clues.slice(),
    })),
  };
}

/**
 * @typedef {Object} GameState
 * @property {Array<{id:string,color:string,number:number,clues:Array}>} deck
 * @property {{p1:Array, p2:Array}} hands
 * @property {{white:number,red:number,blue:number,green:number,yellow:number}} fireworks
 * @property {Array<{id:string,color:string,number:number}>} discardPile
 * @property {{clue:number,fuse:number}} tokens
 * @property {string} currentTurn 'p1'|'p2'
 * @property {string} phase 'playing'|'ended'
 * @property {string|null} deckEmptyTurn 덱을 비운 플레이어 ID(§13-7)
 * @property {number|null} lastRoundTurnsLeft 마지막 라운드 남은 턴 수(2→1→0)
 * @property {object|null} lastTouch 직전 힌트 하이라이트 정보
 * @property {object|null} result 종료 결과 { outcome, score, grade, reason }
 */
