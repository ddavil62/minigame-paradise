/**
 * @fileoverview 맞고(2인 고스톱) 게임 룰 로직 — 서버 권위 상태.
 *
 * 핵심 흐름:
 *   1) 손패 선택(playCard) → 바닥 매칭 처리 → 잠시 awaiting_floor_choice 또는 즉시 더미 뒤집기
 *   2) 더미 뒤집기 → 바닥 매칭 처리 → 다시 awaiting_floor_choice 가능
 *   3) 점수 평가 → 7점 이상이면 awaiting_go_stop
 *   4) GO_STOP 처리 → 다음 턴 또는 라운드 종료
 *
 * 특수 이벤트:
 *   쪽    : 손패→바닥 0매칭 후, 더미 뒤집기에서 그 카드와 같은 월이 나옴 → 모두 가져감 + 상대 피 1장
 *   뻑    : 손패+바닥 1장 매칭 직전 더미 뒤집기에서 같은 월 또 나옴 → 3장 바닥에 쌓임 (못 가져감)
 *   따닥  : 한 턴에 같은 월 4장을 모두 가져가는 케이스 → 상대 피 1장
 *   자뻑  : 자기 뻑을 자기가 푸는 것 → 동일 처리 (보너스 없음, 일반 뻑 풀이와 동일)
 *   흔들기: 손패 10장 중 같은 월 3장 보유 시 선언 가능 → 점수 ×2 (선언자측만)
 *           라운드 시작 일괄 검사가 아니라, 그 월 첫 카드를 낼 때 클라이언트 모달로 선언.
 *   폭탄  : 손 3장 + 바닥 1장 같은 월 → 한번에 점수판 + 상대 피 1장 (표준 규칙)
 *           폭탄 후 덱 2장 연속 뒤집기 권리 (bombExtraDraw 플래그로 제어).
 *   사통  : 라운드 시작 시 손 10장 중 같은 월 4장 보유 → 즉시 라운드 승 + 7점 보너스 옵션.
 *   첫뻑  : 라운드 첫 뻑을 만든 사람이 라운드 승리 시 +7점 가산 (score.js).
 *   쌍피  : 피 카운트에서 2장으로 계산
 *   광박/피박/멍박/고박: score.js applyFinalMultipliers에서 처리
 *
 * 단순화 사항:
 *   - 폭탄 보너스는 "상대 피 1장 + 손 3장 + 바닥 1장 모두 점수판"으로 표준화.
 *   - 고박은 "고 부른 측이 결국 패배 시 점수 ×2"로 단순화.
 *   - 첫쪽 가산 변형 룰은 미적용 (첫뻑만 적용).
 */

import { buildDeck, shuffle } from './cards.js';
import { calculateScore, applyFinalMultipliers } from './score.js';

/**
 * @typedef {object} Card
 * @property {string} id
 * @property {number} month
 * @property {'gwang'|'tti'|'kkeut'|'pi'} type
 * @property {string} [subtype]
 * @property {string} name
 */

/**
 * @typedef {object} GameState
 * @property {Card[]} deck                              - 더미 (top = 끝)
 * @property {Card[]} floor                             - 바닥
 * @property {{p1:Card[], p2:Card[]}} hands
 * @property {{p1:Card[], p2:Card[]}} captured          - 점수판
 * @property {Object.<number, 'p1'|'p2'>} ppeokFlags    - 뻑 만든 사람
 * @property {object|null} pendingFloorChoice           - 같은 월 2장 선택 대기 컨텍스트
 * @property {'p1'|'p2'} turn
 * @property {string} phase
 * @property {{p1:number, p2:number}} goCount
 * @property {{p1:boolean, p2:boolean}} shaking
 * @property {{p1:number, p2:number}} money
 * @property {number} perPoint
 * @property {'p1'|'p2'|null} roundWinner
 * @property {'p1'|'p2'|null} stoppedBy
 * @property {object|null} lastAction
 * @property {object|null} pendingShake                 - 흔들기 선언 대기 (자동 감지)
 * @property {object|null} roundResult                  - 라운드 결과 (UI 모달용)
 */

// ── 상수 ─────────────────────────────────────────────────────
const HAND_SIZE = 10;
const FLOOR_INIT = 8;
const SCORE_THRESHOLD_GO_STOP = 7;

// ── 셋업 ─────────────────────────────────────────────────────
/**
 * 새 게임(잔고 포함) 생성.
 * @param {'p1'|'p2'} firstTurn
 * @param {object} [opts]
 * @param {number} [opts.startMoney=10000]
 * @param {number} [opts.perPoint=100]
 * @returns {GameState}
 */
export function createGame(firstTurn = 'p1', opts = {}) {
  const startMoney = opts.startMoney ?? 10000;
  const perPoint = opts.perPoint ?? 100;
  const game = startRound({
    deck: [], floor: [],
    hands: { p1: [], p2: [] },
    captured: { p1: [], p2: [] },
    ppeokFlags: {},
    ppeokCount: { p1: 0, p2: 0 },
    pendingFloorChoice: null,
    turn: firstTurn,
    phase: 'awaiting_play',
    goCount: { p1: 0, p2: 0 },
    shaking: { p1: false, p2: false },
    money: { p1: startMoney, p2: startMoney },
    perPoint,
    roundWinner: null,
    stoppedBy: null,
    lastAction: null,
    pendingShake: null,
    roundResult: null,
    // 게임 종료(잔고 음수 도달) 상태. NEW_ROUND가 거부되고 NEW_GAME만 허용된다.
    gameOver: false,
    gameWinner: null,
    // 폭탄 보너스 뒤집기 권리. 폭탄 1회당 +2 누적, 자기 차례에 손 0이면 1씩 차감하며 자동 뒤집기.
    // "기회 보존의 법칙": 손 + bombDeckCredit 합이 매 턴 -1로 진행 (양쪽 동기).
    bombDeckCredit: { p1: 0, p2: 0 },
    // ── 5건 룰 보강 (2026-05-31) ──
    pendingSangtong: null,
    shakeAsked: { p1: false, p2: false },
    bombExtraDraw: false,
    firstPpeokBy: null,
  }, firstTurn);
  return game;
}

/**
 * 새 라운드 시작 — 잔고/perPoint는 유지하고 덱·손패·바닥만 재배치.
 * @param {GameState} game
 * @param {'p1'|'p2'} firstTurn
 * @returns {GameState}
 */
export function startRound(game, firstTurn) {
  const deck = shuffle(buildDeck());
  // 손패 분배: 각 10장
  const p1Hand = deck.splice(0, HAND_SIZE);
  const p2Hand = deck.splice(0, HAND_SIZE);
  // 바닥 8장
  const floor = deck.splice(0, FLOOR_INIT);
  // 잔여 22장이 더미

  game.deck = deck;
  game.floor = floor;
  game.hands = { p1: p1Hand, p2: p2Hand };
  game.captured = { p1: [], p2: [] };
  game.ppeokFlags = {};
  // 라운드 동안 누적된 뻑 개수 — 점수 multiplier(×2^N) 적용 + 3뻑 즉시 승리 판정에 사용
  game.ppeokCount = { p1: 0, p2: 0 };
  game.pendingFloorChoice = null;
  game.turn = firstTurn;
  game.phase = 'awaiting_play';
  game.goCount = { p1: 0, p2: 0 };
  game.shaking = { p1: false, p2: false };
  // BUGFIX: lastGoScore도 라운드마다 초기화. 안 그러면 이전 라운드의 "고" 시점 점수가
  // 남아 다음 라운드에서 7점 도달해도 awaiting_go_stop 분기가 막힘.
  game.lastGoScore = { p1: null, p2: null };
  // 9월 술잔(m09_kkeut) 끗/쌍피 선택 상태 — 라운드마다 초기화
  game.kkeutAsSsangpi   = { p1: false, p2: false };
  game.kkeutChoiceMade  = { p1: false, p2: false };
  game.pendingKkeutChoice = null;
  game.roundWinner = null;
  game.stoppedBy = null;
  game.lastAction = { kind: 'round_start', firstTurn };
  game.roundResult = null;
  // ── 5건 룰 보강 (2026-05-31): 라운드 단위 상태 초기화 ──
  // 흔들기는 라운드 시작 일괄 검사가 아니라 클라이언트 모달에서 카드 클릭 시점에 결정한다.
  // shakeAsked로 라운드 당 흔들기 모달 1회 표시 제한.
  game.pendingShake = null;
  game.shakeAsked = { p1: false, p2: false };
  // 폭탄 보너스 뒤집기 권리. 폭탄 1회당 +2 누적, 자기 차례에 손 0이면 1씩 차감하며 자동 뒤집기.
  // "기회 보존의 법칙": 손 + bombDeckCredit 합이 매 턴 -1로 진행 (양쪽 동기).
  game.bombDeckCredit = { p1: 0, p2: 0 };
  // 라운드 첫 뻑을 만든 사람 — applyFinalMultipliers에서 첫뻑 보너스 판정에 사용.
  game.firstPpeokBy = null;
  // 사통(같은 월 4장 손패) 검사 — 자기 차례 선플레이어부터 검사. 동시 충돌 시 선공자 우선.
  game.pendingSangtong = checkSangtongOpportunity(game);
  if (game.pendingSangtong) {
    game.phase = 'awaiting_sangtong';
  }
  return game;
}

/**
 * 라운드 시작 시점에 사통(같은 월 4장 손패) 보유자가 있는지 검사.
 * 양쪽 모두 사통 가능한 경우는 매우 희박하지만, 그래도 선공자(firstTurn) 우선.
 * @param {GameState} game
 * @returns {{player:'p1'|'p2', month:number}|null}
 */
function checkSangtongOpportunity(game) {
  const candidates = [game.turn, game.turn === 'p1' ? 'p2' : 'p1'];
  for (const pid of candidates) {
    const hand = game.hands[pid];
    const monthCount = {};
    for (const c of hand) monthCount[c.month] = (monthCount[c.month] || 0) + 1;
    for (const m of Object.keys(monthCount)) {
      if (monthCount[m] === 4) {
        return { player: pid, month: parseInt(m, 10) };
      }
    }
  }
  return null;
}

// ── 룰 실행: PLAY_CARD ──────────────────────────────────────
/**
 * 손패 1장을 낸다.
 *
 * 폭탄(같은 월 4장 한번에) 처리는 별도 메시지로 받지만, 단일 카드만 보내도
 * 자동으로 폭탄 카운트(4장)을 확인해서 처리할 수 있도록 한다.
 *
 * @param {GameState} g
 * @param {'p1'|'p2'} playerId
 * @param {string} cardId
 * @returns {{ ok:boolean, error?:string }}
 */
export function playCard(g, playerId, cardId) {
  for (const step of playCardSteps(g, playerId, cardId)) {
    if (step && step.error) return { ok: false, error: step.error };
  }
  return { ok: true };
}

/**
 * playCard의 단계별 generator 버전.
 * server.js가 각 yield 사이에 broadcastState + setTimeout(STEP_DELAY)을 끼워넣어
 * 클라이언트가 단계별로 카드 fly 애니메이션을 재생할 수 있게 한다.
 *
 * yield 값:
 *   { error: string }         — 검증 실패. 즉시 중단.
 *   { step: 'hand_played' }   — 손패 카드가 바닥 매칭까지 처리됨
 *   { step: 'deck_flipped' }  — 덱에서 1장 뒤집기 + 매칭 처리됨
 *   { step: 'turn_finished' } — 점수 평가 + 턴 마무리
 *
 * 중간에 phase가 사용자 입력 대기로 바뀌면 generator는 그 yield까지만 진행.
 */
export function* playCardSteps(g, playerId, cardId) {
  if (g.phase !== 'awaiting_play') { yield { error: '지금은 카드를 낼 수 없다' }; return; }
  if (g.turn !== playerId)         { yield { error: '네 차례가 아니다' }; return; }

  const hand = g.hands[playerId];
  const idx = hand.findIndex((c) => c.id === cardId);
  if (idx < 0) { yield { error: '손에 그 카드가 없다' }; return; }
  const card = hand[idx];

  // 단계 1: 손패에서 카드 제거 + 바닥 매칭 처리
  hand.splice(idx, 1);
  // 손 origin 추적 — defer로 단계 1+2 통합 STATE 시 client가 손에서 낸 카드 식별용.
  // turn_finished에서 reset.
  g.lastHandPlayed = { player: playerId, card };
  resolveCardOnFloor(g, playerId, card, true);
  yield { step: 'hand_played', card };

  // awaiting_floor_choice로 빠지면 사용자 선택 대기 (chooseFloor에서 이어짐)
  if (g.phase === 'awaiting_floor_choice') {
    g.lastAction = { kind: 'play_card_choice_pending', player: playerId, cardId, month: card.month };
    return;
  }

  // 단계 2: 덱 1장 뒤집기 + 매칭 처리
  drawAndResolve(g, playerId, card);
  yield { step: 'deck_flipped' };
  if (g.phase === 'awaiting_floor_choice') return;

  // 단계 3: 점수 평가 + 턴 교대
  finishTurn(g, playerId);
  yield { step: 'turn_finished' };
}

/**
 * 바닥 카드 선택 (같은 월 2장 중 1장).
 * @param {GameState} g
 * @param {'p1'|'p2'} playerId
 * @param {string} cardId
 * @returns {{ ok:boolean, error?:string }}
 */
export function chooseFloor(g, playerId, cardId) {
  for (const step of chooseFloorSteps(g, playerId, cardId)) {
    if (step && step.error) return { ok: false, error: step.error };
  }
  return { ok: true };
}

/**
 * chooseFloor의 단계별 generator 버전.
 * yield 값:
 *   { step: 'choice_made' }   — 선택한 바닥 카드 + srcCard 모두 captured로
 *   { step: 'deck_flipped' }  — (손패에서 온 경우만) 덱 뒤집기 + 매칭
 *   { step: 'turn_finished' } — 점수 평가 + 턴 마무리
 *
 * 폭탄/보너스 뒤집기로 인한 awaiting_floor_choice도 동일 경로. fromHand=false인 경우
 * 단계 2(덱 뒤집기)를 건너뛰고 바로 turn_finished로 이동.
 */
export function* chooseFloorSteps(g, playerId, cardId) {
  if (g.phase !== 'awaiting_floor_choice') { yield { error: '지금은 선택할 수 없다' }; return; }
  if (!g.pendingFloorChoice || g.pendingFloorChoice.player !== playerId) {
    yield { error: '네가 선택할 차례가 아니다' }; return;
  }
  const pending = g.pendingFloorChoice;
  const chosen = pending.candidates.find((c) => c.id === cardId);
  if (!chosen) { yield { error: '잘못된 카드' }; return; }

  // 단계 1: 바닥에서 선택한 카드 + srcCard 모두 captured로
  g.floor = g.floor.filter((c) => c.id !== cardId);
  g.captured[playerId].push(pending.srcCard, chosen);
  const wasFromHand = pending.fromHand;
  g.pendingFloorChoice = null;
  g.phase = 'awaiting_play';
  g.lastAction = { kind: 'choice_made', player: playerId, srcCard: pending.srcCard, chosen };
  yield { step: 'choice_made' };

  if (wasFromHand) {
    // 단계 2: 덱 뒤집기 (손패에서 온 매칭이었던 경우만)
    drawAndResolve(g, playerId, pending.srcCard);
    yield { step: 'deck_flipped' };
    if (g.phase === 'awaiting_floor_choice') return;
  }

  // 단계 3: 점수 평가 + 턴 마무리
  finishTurn(g, playerId);
  yield { step: 'turn_finished' };
}

/**
 * 손패 또는 더미 카드 1장을 바닥에 시도해 매칭 처리 한다.
 *
 * @param {GameState} g
 * @param {'p1'|'p2'} playerId
 * @param {Card} card
 * @param {boolean} fromHand  - true면 손패에서 온 카드 (false=더미 뒤집기)
 * @returns {{matched:number}}
 *
 * - 같은 월 0장: 카드를 바닥에 놓음
 * - 같은 월 1장: 둘 다 점수판으로
 * - 같은 월 2장: pendingFloorChoice로 일시정지
 * - 같은 월 3장: 4장 모두 점수판 + 상대 피 1장 (뻑 푸는 효과)
 *
 * fromHand 여부에 따라 뻑/쪽/따닥 판정이 달라진다.
 */
function resolveCardOnFloor(g, playerId, card, fromHand) {
  const opp = playerId === 'p1' ? 'p2' : 'p1';
  const month = card.month;
  const sameMonth = g.floor.filter((c) => c.month === month);

  // ── 0매칭: 그냥 바닥에 놓음 ─────────────────────────────
  if (sameMonth.length === 0) {
    g.floor.push(card);
    g.lastAction = { kind: fromHand ? 'place_on_floor' : 'flip_place', player: playerId, card };
    return { matched: 0 };
  }

  // ── 1매칭: 짝지어 점수판으로 ────────────────────────────
  if (sameMonth.length === 1) {
    const pair = sameMonth[0];
    g.floor = g.floor.filter((c) => c.id !== pair.id);
    g.captured[playerId].push(card, pair);
    g.lastAction = { kind: fromHand ? 'pair_from_hand' : 'pair_from_flip', player: playerId, card, pair };
    return { matched: 1 };
  }

  // ── 2매칭: 선택 대기 ────────────────────────────────────
  if (sameMonth.length === 2) {
    g.pendingFloorChoice = {
      player: playerId,
      month,
      candidates: sameMonth.slice(),
      srcCard: card,
      fromHand,
    };
    g.phase = 'awaiting_floor_choice';
    g.lastAction = { kind: 'choice_pending', player: playerId, card, candidates: sameMonth.slice() };
    return { matched: 2 };
  }

  // ── 3매칭: 4장 모두 가져옴 + 상대 피 1장 (뻑 풀기 또는 따닥 비슷한 케이스) ──
  // (바닥에 같은 월 3장이 있다는 건 이전 뻑 또는 누적 상황)
  const trio = sameMonth.slice();
  g.floor = g.floor.filter((c) => c.month !== month);
  g.captured[playerId].push(card, ...trio);
  // 상대 피 1장 빼앗기
  stealPi(g, playerId, opp, 1);
  // 뻑 플래그 해제 (만든 사람 무관, 그 월 뻑은 풀림)
  delete g.ppeokFlags[month];
  g.lastAction = {
    kind: fromHand ? 'sweep_from_hand' : 'sweep_from_flip',
    player: playerId, card, trio, stoleFromOpp: 1,
  };
  return { matched: 3 };
}

/**
 * 더미에서 1장 뒤집어 매칭 처리. 손패에서 낸 srcCard와의 관계로 쪽/뻑/따닥 판정.
 *
 * @param {GameState} g
 * @param {'p1'|'p2'} playerId
 * @param {Card} handCard  - 직전 손패에서 낸 카드
 */
function drawAndResolve(g, playerId, handCard) {
  if (g.deck.length === 0) {
    g.lastAction = { ...g.lastAction, deckEmpty: true };
    return;
  }
  const flipped = g.deck.pop();
  const opp = playerId === 'p1' ? 'p2' : 'p1';

  // 손패카드와 동일 월인 경우 — 쪽/뻑/따닥 판정 분기
  if (flipped.month === handCard.month) {
    // 손패가 0매칭이었으면 바닥에 handCard가 놓인 상태. 같은 월이 1장 추가됨 → 쪽 (2장 가져가기 + 상대 피 1장)
    // 손패가 1매칭이었으면 둘 다 점수판에 갔고, 같은 월이 또 → 뻑이 만들어진 직후 추가 비슷 — 이건 따닥 케이스에 해당. (단순화: 뻑 형성)
    // 손패가 2매칭(awaiting_floor_choice)이었으면 drawAndResolve를 호출하지 않으므로 여기 도달 X.
    // 손패가 3매칭(스윕)이었으면 바닥에 그 월이 0장 남음 — 여기서 flipped 동월이 나오면 그냥 바닥에 놓이거나, 또 동월이 있으면 자동 매칭.
    // 단순화: handCard와 flipped의 관계는 "현재 바닥 상태"를 기준으로 결정한다.

    // 바닥에 같은 월이 0장(handCard가 0매칭으로 바닥에 놓인 후 그 1장만 있는 경우 등)
    // → 둘 다 가져가기 + 상대 피 1장 (쪽)
    const sameMonthOnFloor = g.floor.filter((c) => c.month === handCard.month);

    if (sameMonthOnFloor.length === 1 && sameMonthOnFloor[0].id === handCard.id) {
      // 바닥에 handCard만 있는 상황 (손패 0매칭으로 handCard가 바닥에 놓였는데 더미에서 동월) → 쪽
      g.floor = g.floor.filter((c) => c.id !== handCard.id);
      g.captured[playerId].push(handCard, flipped);
      stealPi(g, playerId, opp, 1);
      g.lastAction = { kind: 'jjok', player: playerId, handCard, flipped, stoleFromOpp: 1 };
      return;
    }

    if (sameMonthOnFloor.length === 0) {
      // 한국 표준 룰: 손패 1매칭으로 점수판 간 직후 더미에서 같은 월이 또 나오면 → 뻑 형성.
      // 점수판으로 갔던 handCard + 짝을 다시 바닥으로 되돌리고 flipped도 바닥에 → 3장 쌓임.
      // 다음에 누가 그 월 내면 4장 모두 가져감 + 상대 피 1장 (뻑 풀이).
      const captured = g.captured[playerId];
      const handIdx = captured.findIndex((c) => c.id === handCard.id);
      const pairIdx = captured.findIndex((c) => c.month === handCard.month && c.id !== handCard.id);
      if (handIdx >= 0 && pairIdx >= 0) {
        const pair = captured[pairIdx];
        // 큰 인덱스 먼저 제거 (인덱스 시프트 방지)
        const a = Math.max(handIdx, pairIdx);
        const b = Math.min(handIdx, pairIdx);
        captured.splice(a, 1);
        captured.splice(b, 1);
        g.floor.push(handCard, pair, flipped);
        g.ppeokFlags[handCard.month] = playerId;
        g.ppeokCount = g.ppeokCount || { p1: 0, p2: 0 };
        g.ppeokCount[playerId] = (g.ppeokCount[playerId] || 0) + 1;
        // 첫뻑 트래킹: 라운드 최초 뻑 생성자 기록 (이후 뻑은 갱신하지 않음)
        if (g.firstPpeokBy == null) g.firstPpeokBy = playerId;
        g.lastAction = { kind: 'ppeok', player: playerId, month: handCard.month, count: g.ppeokCount[playerId] };
        return;
      }
      // 비정상(가져간 카드 못 찾음) — 안전망: flipped만 바닥에
      g.floor.push(flipped);
      g.lastAction = { kind: 'flip_place', player: playerId, card: flipped };
      return;
    }

    if (sameMonthOnFloor.length === 1) {
      // 손패 매칭으로 1쌍 점수판으로 가고도 바닥에 같은 월 1장이 더 있음 → 따닥(4장 모두)
      const remaining = sameMonthOnFloor[0];
      g.floor = g.floor.filter((c) => c.id !== remaining.id);
      g.captured[playerId].push(flipped, remaining);
      stealPi(g, playerId, opp, 1);
      g.lastAction = { kind: 'ttadak', player: playerId, flipped, pair: remaining, stoleFromOpp: 1 };
      return;
    }

    if (sameMonthOnFloor.length === 2) {
      // 바닥에 같은 월 2장 (handCard가 0매칭/뻑 풀기 등 변형 시나리오) → 뻑 형성
      g.floor.push(flipped);
      g.ppeokFlags[flipped.month] = playerId;
      g.ppeokCount = g.ppeokCount || { p1: 0, p2: 0 };
      g.ppeokCount[playerId] = (g.ppeokCount[playerId] || 0) + 1;
      // 첫뻑 트래킹
      if (g.firstPpeokBy == null) g.firstPpeokBy = playerId;
      g.lastAction = { kind: 'ppeok', player: playerId, month: flipped.month, count: g.ppeokCount[playerId] };
      return;
    }
  }

  // 일반 매칭 처리 (handCard와 무관)
  const sameMonth = g.floor.filter((c) => c.month === flipped.month);
  if (sameMonth.length === 0) {
    g.floor.push(flipped);
    g.lastAction = { kind: 'flip_place', player: playerId, card: flipped };
    return;
  }
  if (sameMonth.length === 1) {
    // 1매칭 — 둘 다 점수판으로
    const pair = sameMonth[0];
    g.floor = g.floor.filter((c) => c.id !== pair.id);
    g.captured[playerId].push(flipped, pair);
    // 뻑 해제 + 따닥 판정: handCard와 pair가 같은 월이면 따닥(같은 턴에 4장 모두 가져감)
    if (pair.month === handCard.month && g.captured[playerId].some((c) => c.id === handCard.id)) {
      stealPi(g, playerId, opp, 1);
      g.lastAction = { kind: 'ttadak', player: playerId, flipped, pair, stoleFromOpp: 1 };
    } else {
      g.lastAction = { kind: 'pair_from_flip', player: playerId, card: flipped, pair };
    }
    return;
  }
  if (sameMonth.length === 2) {
    // 2매칭 — 선택 대기
    g.pendingFloorChoice = {
      player: playerId,
      month: flipped.month,
      candidates: sameMonth.slice(),
      srcCard: flipped,
      fromHand: false,
    };
    g.phase = 'awaiting_floor_choice';
    g.lastAction = { kind: 'flip_choice_pending', player: playerId, card: flipped, candidates: sameMonth.slice() };
    return;
  }
  // 3매칭 — 4장 모두 + 상대 피 1장
  const trio = sameMonth.slice();
  g.floor = g.floor.filter((c) => c.month !== flipped.month);
  g.captured[playerId].push(flipped, ...trio);
  stealPi(g, playerId, opp, 1);
  delete g.ppeokFlags[flipped.month];
  g.lastAction = { kind: 'sweep_from_flip', player: playerId, card: flipped, trio, stoleFromOpp: 1 };
}

/**
 * 상대 점수판에서 피를 N장 빼앗아 본인 점수판에 추가.
 * 쌍피보다 일반 피를 우선 빼앗는다 (스펙 단순화).
 * 상대 피가 부족하면 가능한 만큼만 빼앗는다.
 *
 * @param {GameState} g
 * @param {'p1'|'p2'} taker
 * @param {'p1'|'p2'} victim
 * @param {number} count
 */
function stealPi(g, taker, victim, count) {
  let remaining = count;
  // 일반 피 우선
  for (let i = g.captured[victim].length - 1; i >= 0 && remaining > 0; i--) {
    const c = g.captured[victim][i];
    if (c.type === 'pi' && c.subtype !== 'ssangpi') {
      g.captured[victim].splice(i, 1);
      g.captured[taker].push(c);
      remaining--;
    }
  }
  // 부족하면 쌍피
  for (let i = g.captured[victim].length - 1; i >= 0 && remaining > 0; i--) {
    const c = g.captured[victim][i];
    if (c.type === 'pi') {
      g.captured[victim].splice(i, 1);
      g.captured[taker].push(c);
      remaining--;
    }
  }
}

// ── 턴 마무리: 점수 평가 + 고/스톱 분기 ─────────────────────
/**
 * 턴 끝에서 점수 평가 + 고/스톱 결정 단계로 이동 또는 다음 턴.
 * @param {GameState} g
 * @param {'p1'|'p2'} playerId
 */
function finishTurn(g, playerId) {
  // 3뻑 즉시 승리 — 한 사람이 한 라운드에 뻑 3개 만들면 즉시 라운드 승.
  // (한국 일반 룰; ×2^3=8배 점수 multiplier도 endRoundWin에서 함께 적용)
  if (g.ppeokCount && g.ppeokCount[playerId] >= 3) {
    g.lastAction = { kind: 'three_ppeok', player: playerId, count: g.ppeokCount[playerId] };
    endRoundWin(g, playerId);
    return;
  }
  // 9월 술잔 카드를 가져왔는데 아직 끗/쌍피 선택 안 했으면 선택 단계로 이동
  if (!g.kkeutChoiceMade[playerId] && g.captured[playerId].some((c) => c.id === 'm09_kkeut')) {
    g.pendingKkeutChoice = { player: playerId };
    g.phase = 'awaiting_kkeut_choice';
    return;
  }
  // 점수 평가
  const breakdown = calculateScore(g.captured[playerId], { kkeutAsSsangpi: g.kkeutAsSsangpi[playerId] });
  const goCount = g.goCount[playerId];
  // 고 한번이라도 부른 경우엔 매 턴 점수 갱신 시 추가 점수 발생 여부를 확인하지만,
  // 단순화: 점수가 7점 이상이면 awaiting_go_stop. 이미 한번 고를 부른 상태라면
  // 마지막 점수보다 1점이라도 늘었으면 다시 awaiting_go_stop.
  if (breakdown.score >= SCORE_THRESHOLD_GO_STOP) {
    // 첫 발생이거나, 마지막 고 시점 점수보다 늘었으면 결정 단계로 이동
    const lastGoScore = g.lastGoScore?.[playerId] ?? null;
    if (lastGoScore === null || breakdown.score > lastGoScore) {
      // 자기 손패가 비고 + 보너스 권리도 0이면 더 이상 진행 불가 → 자동 스톱.
      // 폭탄 권리(bombDeckCredit > 0)가 남아 있으면 손 0이어도 고/스톱 결정 가능.
      const remainingCredit = g.bombDeckCredit?.[playerId] || 0;
      if (g.hands[playerId].length === 0 && remainingCredit === 0) {
        endRoundWin(g, playerId);
        return;
      }
      g.phase = 'awaiting_go_stop';
      g.lastAction = { ...g.lastAction, scoreReached: breakdown.score, by: playerId };
      return;
    }
  }

  // 라운드 종료 조건: 양쪽 모두 손 0 && 보너스 권리 0 — 무승부 종료
  // "기회 보존의 법칙"에 의해 양쪽 잔여는 항상 동기화되어 동시에 0에 도달.
  const p1Remaining = g.hands.p1.length + (g.bombDeckCredit?.p1 || 0);
  const p2Remaining = g.hands.p2.length + (g.bombDeckCredit?.p2 || 0);
  if (p1Remaining === 0 && p2Remaining === 0) {
    endRoundDraw(g);
    return;
  }

  // 다음 턴으로
  g.turn = playerId === 'p1' ? 'p2' : 'p1';
  g.phase = 'awaiting_play';
  // 턴 종료 시 손 origin 정보 reset (다음 턴 시각화에 잔존하면 잘못된 fly 발동).
  g.lastHandPlayed = null;
}

// ── 고/스톱 ─────────────────────────────────────────────────
/**
 * 고 또는 스톱 선택을 처리한다.
 * @param {GameState} g
 * @param {'p1'|'p2'} playerId
 * @param {'go'|'stop'} decision
 * @returns {{ok:boolean, error?:string}}
 */
export function goStop(g, playerId, decision) {
  if (g.phase !== 'awaiting_go_stop') return { ok: false, error: '지금은 결정할 수 없다' };
  if (g.turn !== playerId)            return { ok: false, error: '네 차례가 아니다' };

  if (decision === 'go') {
    // 안전망: 손패와 보너스 권리가 모두 0이면 다음 턴에 할 수 있는 행동이 없으므로 고 거절.
    // 폭탄 권리(bombDeckCredit > 0)가 남아 있으면 손 0이어도 고 가능.
    const remainingCredit = g.bombDeckCredit?.[playerId] || 0;
    if (g.hands[playerId].length === 0 && remainingCredit === 0) {
      return { ok: false, error: '손패와 보너스 뒤집기 권리가 모두 없어 더 진행 불가 — 스톱만 가능' };
    }
    g.goCount[playerId] = (g.goCount[playerId] || 0) + 1;
    g.lastGoScore = g.lastGoScore || {};
    g.lastGoScore[playerId] = calculateScore(g.captured[playerId], { kkeutAsSsangpi: g.kkeutAsSsangpi[playerId] }).score;
    g.lastAction = { kind: 'go', player: playerId, count: g.goCount[playerId] };
    // 다음 턴으로
    g.turn = playerId === 'p1' ? 'p2' : 'p1';
    g.phase = 'awaiting_play';
    return { ok: true };
  }

  if (decision === 'stop') {
    endRoundWin(g, playerId);
    return { ok: true };
  }
  return { ok: false, error: '알 수 없는 결정' };
}

// ── 9월 술잔 끗/쌍피 선택 ───────────────────────────────────
/**
 * 9월 술잔(m09_kkeut)을 끗으로 카운트할지 쌍피로 카운트할지 선택.
 * 선택 후 finishTurn을 재호출해 게임 진행 계속.
 * @param {GameState} g
 * @param {'p1'|'p2'} playerId
 * @param {'kkeut'|'ssangpi'} choice
 * @returns {{ok:boolean, error?:string}}
 */
export function selectKkeutType(g, playerId, choice) {
  for (const step of selectKkeutTypeSteps(g, playerId, choice)) {
    if (step && step.error) return { ok: false, error: step.error };
  }
  return { ok: true };
}

/**
 * selectKkeutType의 단계별 generator 버전.
 * yield: { step: 'kkeut_chosen' }, { step: 'turn_finished' }
 */
export function* selectKkeutTypeSteps(g, playerId, choice) {
  if (g.phase !== 'awaiting_kkeut_choice') {
    yield { error: '지금은 결정할 수 없다' }; return;
  }
  if (!g.pendingKkeutChoice || g.pendingKkeutChoice.player !== playerId) {
    yield { error: '당신의 선택 차례가 아니다' }; return;
  }
  if (choice !== 'kkeut' && choice !== 'ssangpi') {
    yield { error: '선택은 kkeut 또는 ssangpi' }; return;
  }

  // 단계 1: 선택 적용
  g.kkeutAsSsangpi[playerId] = (choice === 'ssangpi');
  g.kkeutChoiceMade[playerId] = true;
  g.pendingKkeutChoice = null;
  g.lastAction = { kind: 'kkeut_choice', player: playerId, choice };
  yield { step: 'kkeut_chosen' };

  // 단계 2: finishTurn 재실행 (점수 평가 + 턴 교대)
  finishTurn(g, playerId);
  yield { step: 'turn_finished' };
}

// ── 라운드 종료 ─────────────────────────────────────────────
/**
 * 승자가 결정된 라운드 종료 처리.
 * @param {GameState} g
 * @param {'p1'|'p2'} winnerId
 * @param {object} [extraFlags] - 사통 등 부가 flags (applyFinalMultipliers에 그대로 전달).
 */
function endRoundWin(g, winnerId, extraFlags = {}) {
  const loserId = winnerId === 'p1' ? 'p2' : 'p1';
  const winner = calculateScore(g.captured[winnerId], { kkeutAsSsangpi: g.kkeutAsSsangpi[winnerId] });
  const loser  = calculateScore(g.captured[loserId],  { kkeutAsSsangpi: g.kkeutAsSsangpi[loserId] });
  const winnerGoCount = g.goCount[winnerId];
  const loserGoCount  = g.goCount[loserId];
  // 고박: 패자가 고를 부른 경우 (단순화) → 점수 ×2
  const gobakApplies = loserGoCount > 0;

  const result = applyFinalMultipliers(winner, loser, {
    winnerGoCount,
    winnerShake: g.shaking[winnerId],
    loserShake: g.shaking[loserId],
    gobakApplies,
    winnerPpeokCount: g.ppeokCount?.[winnerId] || 0,
    // 첫뻑 보너스: 라운드 첫 뻑을 만든 사람이 승자와 일치 시 +7 가산.
    firstPpeokBonus: g.firstPpeokBy === winnerId,
    // 사통 보너스: 라운드 시작 시 사통 선언으로 종료된 경우 +7 가산.
    sangtongBonus: !!extraFlags.sangtongBonus,
  });

  const totalMoney = result.finalScore * g.perPoint;
  g.money[winnerId] += totalMoney;
  g.money[loserId]  -= totalMoney;

  // 패자 잔고가 음수가 되면 게임 자체가 종료된다 (제로섬이므로 음수는 항상 loser 쪽).
  // 게임 승자는 라운드 승자(winnerId)와 동일.
  const gameOver = g.money[loserId] < 0;
  if (gameOver) {
    g.gameOver = true;
    g.gameWinner = winnerId;
  }

  g.roundWinner = winnerId;
  g.stoppedBy = winnerId;
  g.phase = 'round_end';
  g.roundResult = {
    winner: winnerId,
    loser: loserId,
    winnerBreakdown: winner,
    loserBreakdown: loser,
    finalScore: result.finalScore,
    multiplier: result.multiplier,
    reasons: result.reasons,
    money: totalMoney,
    moneyAfter: { ...g.money },
    goCount: { ...g.goCount },
    shaking: { ...g.shaking },
    gobakApplies,
    // 5건 룰 보강 (2026-05-31) — UI/QA 검증용 부가 필드
    firstPpeokBy: g.firstPpeokBy,
    sangtongBonusApplied: !!extraFlags.sangtongBonus,
    // 게임 종료 (잔고 음수 도달, 2026-05-31)
    gameOver,
    gameWinner: gameOver ? winnerId : null,
  };
  g.lastAction = { kind: 'round_end_win', winner: winnerId };
}

/**
 * 양쪽 손패 소진(7점 미만)으로 무승부 종료.
 * @param {GameState} g
 */
function endRoundDraw(g) {
  g.roundWinner = null;
  g.phase = 'round_end';
  g.roundResult = {
    winner: null,
    loser: null,
    winnerBreakdown: null,
    loserBreakdown: null,
    finalScore: 0,
    multiplier: 1,
    reasons: ['무승부 — 양쪽 손패 소진, 7점 미만'],
    money: 0,
    goCount: { ...g.goCount },
    shaking: { ...g.shaking },
    gobakApplies: false,
  };
  g.lastAction = { kind: 'round_end_draw' };
}

// ── 사통(같은 월 4장 손) 결정 ───────────────────────────────
/**
 * 사통 선언/포기 처리. 라운드 시작 시 손 10장 중 같은 월 4장 보유 시 모달이 뜬다.
 *
 * - declare: 즉시 라운드 승 + 7점 보너스 (multiplier 없이 base 가산).
 * - continue: 그대로 정상 진행 (awaiting_play 복귀).
 *
 * @param {GameState} g
 * @param {'p1'|'p2'} playerId
 * @param {'declare'|'continue'} choice
 * @returns {{ok:boolean, error?:string}}
 */
export function sangtongDecision(g, playerId, choice) {
  for (const step of sangtongSteps(g, playerId, choice)) {
    if (step && step.error) return { ok: false, error: step.error };
  }
  return { ok: true };
}

/**
 * sangtongDecision의 단계별 generator 버전.
 * yield: { step: 'sangtong_decided' } (선언/포기 공통), { step: 'turn_finished' } (선언 시만)
 */
export function* sangtongSteps(g, playerId, choice) {
  if (g.phase !== 'awaiting_sangtong') {
    yield { error: '지금은 사통 결정 단계가 아니다' }; return;
  }
  if (!g.pendingSangtong || g.pendingSangtong.player !== playerId) {
    yield { error: '네가 사통을 결정할 차례가 아니다' }; return;
  }
  if (choice !== 'declare' && choice !== 'continue') {
    yield { error: '선택은 declare 또는 continue' }; return;
  }

  const month = g.pendingSangtong.month;

  if (choice === 'continue') {
    // 정상 진행 — pendingSangtong 해제, awaiting_play로.
    g.pendingSangtong = null;
    g.phase = 'awaiting_play';
    g.lastAction = { kind: 'sangtong_decline', player: playerId, month };
    yield { step: 'sangtong_decided' };
    return;
  }

  // declare: 즉시 라운드 종료 — 사통 선언자가 승자, +7점 보너스.
  g.pendingSangtong = null;
  // phase를 awaiting_play로 잠깐 변경 — yield 직후 server runSteps의 isPauseForUserInput
  // 검사에서 false가 되어 다음 단계(endRoundWin)가 정상 실행되도록 한다. endRoundWin이
  // 곧바로 phase를 'round_end'로 바꾼다.
  g.phase = 'awaiting_play';
  g.lastAction = { kind: 'sangtong', player: playerId, month };
  yield { step: 'sangtong_decided' };

  endRoundWin(g, playerId, { sangtongBonus: true });
  yield { step: 'turn_finished' };
}

// ── 흔들기 결정 ─────────────────────────────────────────────
/**
 * 흔들기 결정 처리. 클라이언트가 카드 클릭 시점 모달에서 결정을 전송한다.
 *
 * 2026-05-31 변경: shake_decision phase 자체를 제거. 클라이언트가 같은 월 3장 손
 * 보유 상태에서 그 월 카드를 처음 낼 때 모달을 띄우고, 결과를 SHAKE 메시지로 보낸
 * 뒤 곧바로 PLAY_CARD를 이어 전송한다. 서버는 phase 무관하게 g.shaking 플래그만
 * 갱신한다. 라운드 당 1회 제한은 g.shakeAsked로 관리.
 *
 * @param {GameState} g
 * @param {'p1'|'p2'} playerId
 * @param {'shake'|'normal'} decision
 * @param {number} [month] - 클라이언트가 보낸 그 월 (lastAction 기록용)
 * @returns {{ok:boolean, error?:string}}
 */
export function shakeDecision(g, playerId, decision, month) {
  if (g.turn !== playerId) {
    return { ok: false, error: '네 차례가 아니다' };
  }
  if (g.shakeAsked && g.shakeAsked[playerId]) {
    return { ok: false, error: '이미 흔들기 결정함' };
  }
  if (decision === 'shake') {
    g.shaking[playerId] = true;
    g.lastAction = { kind: 'shake', player: playerId, month: month ?? null };
  } else {
    g.lastAction = { kind: 'shake_decline', player: playerId };
  }
  // 라운드 당 1회 제한
  g.shakeAsked = g.shakeAsked || { p1: false, p2: false };
  g.shakeAsked[playerId] = true;
  g.pendingShake = null;
  // 레거시 호환: shake_decision phase를 사용하는 inject 테스트나 옛 흐름에서
  // 호출된 경우 phase를 awaiting_play로 복원해 카드 플레이를 이어갈 수 있게 한다.
  if (g.phase === 'shake_decision') {
    g.phase = 'awaiting_play';
  }
  return { ok: true };
}

// ── 폭탄 ───────────────────────────────────────────────────
/**
 * 폭탄: 손패에 같은 월 4장 보유 시 한번에 처리.
 * 단순화: 4장 모두 점수판 + 상대 피 2장. 더미 뒤집기는 진행하지 않음(즉시 턴 종료).
 *
 * @param {GameState} g
 * @param {'p1'|'p2'} playerId
 * @param {number} month
 * @returns {{ok:boolean, error?:string}}
 */
export function bomb(g, playerId, month) {
  for (const step of bombSteps(g, playerId, month)) {
    if (step && step.error) return { ok: false, error: step.error };
  }
  return { ok: true };
}

/**
 * bomb의 단계별 generator 버전.
 * yield: { step: 'bomb_played' }, { step: 'deck_flipped' }, { step: 'turn_finished' }
 *
 * 표준 룰 (2026-05-31 정정): 폭탄 발동 시 같은 월 4장(손 3 + 바닥 1) + 상대 피 1장
 * 가져가기 + 통상 뒤집기 1회. 추가로 보너스 뒤집기 권리 +2 누적 (g.bombDeckCredit).
 * 보너스 뒤집기는 자기 차례에 손 0일 때 자동 발동 (bonusFlipSteps).
 * "기회 보존의 법칙": 손 -3 + 보너스 +2 = 순 -1 (정상 1턴과 동등).
 */
export function* bombSteps(g, playerId, month) {
  if (g.phase !== 'awaiting_play') { yield { error: '지금은 폭탄을 낼 수 없다' }; return; }
  if (g.turn !== playerId)         { yield { error: '네 차례가 아니다' }; return; }
  const hand = g.hands[playerId];
  const handSame  = hand.filter((c) => c.month === month);
  const floorSame = g.floor.filter((c) => c.month === month);
  if (handSame.length !== 3) {
    yield { error: `${month}월 카드 3장이 손에 있어야 한다` }; return;
  }
  if (floorSame.length !== 1) {
    yield { error: `${month}월 카드 1장이 바닥에 있어야 한다` }; return;
  }

  // 단계 1: 폭탄 실행 (손 3장 + 바닥 1장 모두 captured + 상대 피 1장 + 보너스 권리 +2)
  g.hands[playerId] = hand.filter((c) => c.month !== month);
  g.floor          = g.floor.filter((c) => c.month !== month);
  g.captured[playerId].push(...handSame, ...floorSame);
  const opp = playerId === 'p1' ? 'p2' : 'p1';
  stealPi(g, playerId, opp, 1);
  g.bombDeckCredit[playerId] = (g.bombDeckCredit[playerId] || 0) + 2;
  // 손 origin 추적 — 폭탄은 손에서 3장 + 바닥 1장 모두 가져감. handSame이 손 origin.
  g.lastHandPlayed = { player: playerId, card: handSame[0], cards: handSame, month };
  g.lastAction = { kind: 'bomb', player: playerId, month, stoleFromOpp: 1 };
  yield { step: 'bomb_played' };

  // 단계 2: 통상 덱 뒤집기 1회 (폭탄 당 턴의 통상 뒤집기)
  drawAndResolve(g, playerId, handSame[0]);
  yield { step: 'deck_flipped' };
  if (g.phase === 'awaiting_floor_choice') return;

  // 단계 3: 점수 평가 + 턴 마무리
  finishTurn(g, playerId);
  yield { step: 'turn_finished' };
}

/**
 * 보너스 뒤집기 단계별 generator. 자기 차례에 손 0이고 bombDeckCredit > 0일 때 발동.
 * yield: { step: 'bonus_flipped' }, { step: 'turn_finished' }
 *
 * 표준 룰: 덱에서 한 장 뒤집기 → 바닥 매칭 처리 (단순 매칭만).
 *   - 동월 1장: 둘 다 가져가기 (쪽 보너스 없음 — 손패에서 낸 게 아니므로)
 *   - 동월 0장: 그냥 바닥에 놓기
 *   - 동월 2장: 사용자 1장 선택 (awaiting_floor_choice)
 *   - 동월 3장(뻑 풀이): 4장 모두 가져가기 + 상대 피 1장
 *   뻑/따닥/쪽은 발생하지 않음 (모두 손패에서 낸 카드를 전제로 함).
 */
export function* bonusFlipSteps(g, playerId) {
  if (g.phase !== 'awaiting_play') { yield { error: '지금은 보너스 뒤집기를 할 수 없다' }; return; }
  if (g.turn !== playerId)         { yield { error: '네 차례가 아니다' }; return; }
  // 손패 잔여와 무관하게 권리만 있으면 사용 가능 (사용자 선택 가능한 액션).
  if (!g.bombDeckCredit?.[playerId] || g.bombDeckCredit[playerId] <= 0) {
    yield { error: '보너스 뒤집기 권리가 없다' }; return;
  }
  if (g.deck.length === 0) {
    yield { error: '덱이 비었다' }; return;
  }

  // 단계 1: 덱에서 한 장 뒤집기, 단순 매칭 처리
  flipDeckBonus(g, playerId);
  g.bombDeckCredit[playerId]--;
  yield { step: 'bonus_flipped' };
  if (g.phase === 'awaiting_floor_choice') return;

  // 단계 2: 점수 평가 + 턴 마무리
  finishTurn(g, playerId);
  yield { step: 'turn_finished' };
}

/**
 * 보너스 뒤집기 매칭 처리 (손패 없음). 쪽/뻑/따닥 형성 X — 단순 매칭만.
 * @param {GameState} g
 * @param {'p1'|'p2'} playerId
 */
function flipDeckBonus(g, playerId) {
  const flipped = g.deck.pop();
  const sameMonth = g.floor.filter((c) => c.month === flipped.month);
  const opp = playerId === 'p1' ? 'p2' : 'p1';

  if (sameMonth.length === 0) {
    g.floor.push(flipped);
    g.lastAction = { kind: 'bonus_flip_place', player: playerId, card: flipped };
    return;
  }
  if (sameMonth.length === 1) {
    g.floor = g.floor.filter((c) => c.id !== sameMonth[0].id);
    g.captured[playerId].push(flipped, sameMonth[0]);
    g.lastAction = { kind: 'bonus_match', player: playerId, flipped, pair: sameMonth[0] };
    return;
  }
  if (sameMonth.length === 2) {
    // 두 장 중 한 장 선택 — 통상 chooseFloorSteps 분기 활용 (fromHand=false 처리)
    g.floor.push(flipped);
    g.pendingFloorChoice = {
      player: playerId, month: flipped.month, candidates: sameMonth, srcCard: flipped, fromHand: false,
    };
    g.phase = 'awaiting_floor_choice';
    g.lastAction = { kind: 'bonus_flip_2match', player: playerId, flipped };
    return;
  }
  // 동월 3장 (뻑 풀이): 4장 모두 가져가기 + 상대 피 1장
  g.floor = g.floor.filter((c) => c.month !== flipped.month);
  g.captured[playerId].push(flipped, ...sameMonth);
  // 뻑이 풀렸으므로 ppeokFlags에서 제거
  if (g.ppeokFlags[flipped.month]) delete g.ppeokFlags[flipped.month];
  stealPi(g, playerId, opp, 1);
  g.lastAction = { kind: 'bonus_ppeok_sweep', player: playerId, flipped, count: sameMonth.length, stoleFromOpp: 1 };
}

// ── 스냅샷 (시점별) ─────────────────────────────────────────
/**
 * 특정 플레이어용 STATE 스냅샷 생성. 상대 손패는 카운트만 노출.
 * @param {GameState} g
 * @param {'p1'|'p2'} playerId
 * @returns {object}
 */
export function snapshotForPlayer(g, playerId) {
  const opp = playerId === 'p1' ? 'p2' : 'p1';
  const myBreakdown = calculateScore(g.captured[playerId], { kkeutAsSsangpi: g.kkeutAsSsangpi?.[playerId] });
  const oppBreakdown = calculateScore(g.captured[opp],     { kkeutAsSsangpi: g.kkeutAsSsangpi?.[opp] });
  // 흔들기 결정이 자기 차례인 경우만 pendingShake 노출
  const myShake = g.pendingShake && g.pendingShake.player === playerId ? g.pendingShake : null;
  // 바닥 선택이 내 차례인 경우만 pendingFloorChoice 노출
  const myChoice = g.pendingFloorChoice && g.pendingFloorChoice.player === playerId ? g.pendingFloorChoice : null;
  // 폭탄 가능 월 자동 감지 — 표준 규칙: 손 3장 + 바닥 1장
  const handMonthCount = {};
  for (const c of g.hands[playerId]) handMonthCount[c.month] = (handMonthCount[c.month] || 0) + 1;
  const floorMonthCount = {};
  for (const c of g.floor)            floorMonthCount[c.month] = (floorMonthCount[c.month] || 0) + 1;
  const bombableMonths = Object.keys(handMonthCount)
    .filter((m) => handMonthCount[m] === 3 && floorMonthCount[m] === 1)
    .map(Number);
  // 사통 결정이 자기 차례인 경우만 pendingSangtong 노출 (라운드 시작 시 모달 트리거).
  const mySangtong = g.pendingSangtong && g.pendingSangtong.player === playerId
    ? g.pendingSangtong : null;
  return {
    type: 'STATE',
    you: playerId,
    yourHand: g.hands[playerId],
    oppHandCount: g.hands[opp].length,
    floor: g.floor,
    deckCount: g.deck.length,
    captured: { p1: g.captured.p1, p2: g.captured.p2 },
    breakdown: { p1: playerId === 'p1' ? myBreakdown : oppBreakdown, p2: playerId === 'p2' ? myBreakdown : oppBreakdown },
    score: {
      p1: calculateScore(g.captured.p1, { kkeutAsSsangpi: g.kkeutAsSsangpi?.p1 }).score,
      p2: calculateScore(g.captured.p2, { kkeutAsSsangpi: g.kkeutAsSsangpi?.p2 }).score,
    },
    goCount: { ...g.goCount },
    shaking: { ...g.shaking },
    shakeAsked: { ...(g.shakeAsked || { p1: false, p2: false }) },
    ppeokFlags: { ...g.ppeokFlags },
    kkeutAsSsangpi: { ...(g.kkeutAsSsangpi || { p1: false, p2: false }) },
    pendingKkeutChoice: g.pendingKkeutChoice && g.pendingKkeutChoice.player === playerId
      ? { player: g.pendingKkeutChoice.player } : null,
    turn: g.turn,
    phase: g.phase,
    pendingChoice: myChoice ? { month: myChoice.month, candidates: myChoice.candidates } : null,
    pendingShake: myShake ? { month: myShake.month } : null,
    pendingSangtong: mySangtong ? { player: mySangtong.player, month: mySangtong.month } : null,
    bombableMonths,
    firstPpeokBy: g.firstPpeokBy || null,
    bombDeckCredit: { ...(g.bombDeckCredit || { p1: 0, p2: 0 }) },
    // 손 origin 추적: 단계 1+2 통합 STATE 시 client가 손에서 낸 카드를 식별하기 위함.
    lastHandPlayed: g.lastHandPlayed || null,
    lastAction: g.lastAction,
    money: { ...g.money },
    perPoint: g.perPoint,
    roundResult: g.roundResult,
  };
}
