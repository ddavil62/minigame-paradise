/**
 * @fileoverview 코드네임 클래식(정통 4인 팀 대전) 순수 게임 로직 — 서버 권위.
 *
 * - 25칸 단어 보드 + 단일 공유 키 카드(red/blue/neutral/assassin)
 * - 선공팀 9장 / 후공팀 8장 / 중립 7장 / 암살자 1장 = 25, 선공팀은 매 게임 랜덤
 * - 2팀(레드/블루) 턴제 경쟁: 단서(스파이마스터) → 추측(요원) → 색 판정으로 턴 유지/종료
 * - 역할별 시야 분리: snapshotForPlayer가 스파이마스터=키 전체, 요원=공개 카드만 노출
 *
 * 듀엣(codenames-duet/game.js)과 독립 — shuffleInPlace/pickWords/마스킹 패턴만 차용.
 * 모든 상태 변이는 순수 함수로 수행하며 서버(server.js)가 GameState를 보유한다.
 */

import { WORDS } from './words.js';

// ── 상수 ──────────────────────────────────────────────────────────
/** 그리드 크기 (5x5 = 25칸). */
export const BOARD_SIZE = 25;
/** 선공팀(9장 보유 팀) 카드 수. */
export const FIRST_TEAM_CARDS = 9;
/** 후공팀 카드 수. */
export const SECOND_TEAM_CARDS = 8;
/** 중립 카드 수. */
export const NEUTRAL_CARDS = 7;
/** 암살자 카드 수. */
export const ASSASSIN_CARDS = 1;

// ── 유틸 ──────────────────────────────────────────────────────────
/**
 * Fisher-Yates 셔플 (in-place). 듀엣과 동일 패턴.
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
 * 상대 팀 색을 반환한다.
 * @param {'red'|'blue'} team
 * @returns {'red'|'blue'}
 */
function opponentTeam(team) {
  return team === 'red' ? 'blue' : 'red';
}

/**
 * 단일 공유 키 카드(25칸 색상 배열)를 생성한다.
 * 선공팀(firstTeam)이 9장, 후공팀이 8장, 중립 7장, 암살자 1장을 채우고 셔플한다.
 * @param {'red'|'blue'} firstTeam - 9장을 보유할 선공팀
 * @returns {('red'|'blue'|'neutral'|'assassin')[]} 셔플된 25칸 키 카드
 */
function buildKeyCard(firstTeam) {
  const secondTeam = opponentTeam(firstTeam);
  /** @type {('red'|'blue'|'neutral'|'assassin')[]} */
  const cells = [];
  for (let i = 0; i < FIRST_TEAM_CARDS; i++) cells.push(firstTeam);
  for (let i = 0; i < SECOND_TEAM_CARDS; i++) cells.push(secondTeam);
  for (let i = 0; i < NEUTRAL_CARDS; i++) cells.push('neutral');
  for (let i = 0; i < ASSASSIN_CARDS; i++) cells.push('assassin');
  if (cells.length !== BOARD_SIZE) {
    throw new Error(`[game] 키 카드 합계 오류: ${cells.length} (기대 ${BOARD_SIZE})`);
  }
  return shuffleInPlace(cells);
}

// ── 게임 상태 ─────────────────────────────────────────────────────
/**
 * @typedef {Object} GameState
 * @property {string[]} words                                   - 25개 단어 (인덱스 = 카드 위치)
 * @property {('red'|'blue'|'neutral'|'assassin')[]} keyCard    - 단일 공유 키 (칸별 색상)
 * @property {(null|'red'|'blue'|'neutral'|'assassin')[]} revealed - 공개된 카드 색상 (null=미공개)
 * @property {'red'|'blue'} firstTeam                           - 선공팀 (9장 보유)
 * @property {number} redTotal                                  - 레드 총 카드 수 (9|8)
 * @property {number} blueTotal                                 - 블루 총 카드 수 (8|9)
 * @property {number} redFound                                  - 공개된 레드 카드 수
 * @property {number} blueFound                                 - 공개된 블루 카드 수
 * @property {'red'|'blue'} currentTeam                         - 현재 턴 팀
 * @property {'clue'|'guess'} turnPhase                         - 현재 단계 (스파이마스터 단서 대기 / 요원 추측)
 * @property {{word:string, number:number, team:'red'|'blue'}|null} currentClue - 현재 단서
 * @property {number} guessesLeft                               - 남은 추측 횟수 (number+1)
 * @property {'playing'|'over'} gamePhase                       - 게임 진행/종료
 * @property {'red'|'blue'|null} winner                         - 승리 팀
 * @property {'completed'|'assassin'|''} winReason              - 승리 사유
 */

/**
 * 새 게임 상태를 생성한다 (리매치용 재생성 헬퍼 겸용).
 * @param {'red'|'blue'} [startTeam] - 선공팀(9장 팀) 강제 지정. 미지정 시 랜덤.
 * @returns {GameState}
 */
export function createGame(startTeam) {
  // 선공팀: 인자로 받으면 고정(리매치 교체용), 없으면 매 게임 랜덤.
  const firstTeam = (startTeam === 'red' || startTeam === 'blue')
    ? startTeam
    : (Math.random() < 0.5 ? 'red' : 'blue');
  const keyCard = buildKeyCard(firstTeam);
  // 키 카드를 실제로 세어 총 카드 수 산출(분배 불변식 검증 겸용).
  const redTotal = keyCard.filter((c) => c === 'red').length;
  const blueTotal = keyCard.filter((c) => c === 'blue').length;
  return {
    words: pickWords(WORDS, BOARD_SIZE),
    keyCard,
    revealed: new Array(BOARD_SIZE).fill(null),
    firstTeam,
    redTotal,
    blueTotal,
    redFound: 0,
    blueFound: 0,
    currentTeam: firstTeam, // 선공팀이 첫 단서를 준다
    turnPhase: 'clue',
    currentClue: null,
    guessesLeft: 0,
    gamePhase: 'playing',
    winner: null,
    winReason: '',
    turnCount: 0, // [P1-FIX-5] 0-공개 패스 후 stateKey 충돌 방지용 턴 카운터
  };
}

/**
 * 특정 팀의 총 카드 수를 반환한다.
 * @param {GameState} state
 * @param {'red'|'blue'} team
 * @returns {number}
 */
function teamTotal(state, team) {
  return team === 'red' ? state.redTotal : state.blueTotal;
}

/**
 * 특정 팀의 공개된 카드 수를 반환한다.
 * @param {GameState} state
 * @param {'red'|'blue'} team
 * @returns {number}
 */
function teamFound(state, team) {
  return team === 'red' ? state.redFound : state.blueFound;
}

/**
 * 특정 팀의 공개 카드 수를 1 증가시킨다.
 * @param {GameState} state
 * @param {'red'|'blue'} team
 */
function incrTeamFound(state, team) {
  if (team === 'red') state.redFound += 1;
  else state.blueFound += 1;
}

/**
 * 특정 팀이 자기 색 카드를 전부 공개했으면 승리 처리한다.
 * @param {GameState} state
 * @param {'red'|'blue'} team
 * @returns {boolean} 승리했으면 true
 */
function checkTeamWin(state, team) {
  if (teamFound(state, team) >= teamTotal(state, team)) {
    state.gamePhase = 'over';
    state.winner = team;
    state.winReason = 'completed';
    return true;
  }
  return false;
}

/**
 * 스파이마스터가 단서를 제출한다. 현재 팀·단계 검증 후 추측 단계로 전환.
 * 정통 보너스: guessesLeft = number + 1.
 * 단서 단어 검증은 공백/길이 최소만 수행한다(LAN 신뢰 환경).
 * @param {GameState} state
 * @param {'red'|'blue'} team - 단서를 주는 팀
 * @param {string} word       - 단서 단어
 * @param {number} number     - 단서 숫자 (1~9)
 * @returns {{ok:boolean, error?:string}}
 */
export function giveClue(state, team, word, number) {
  if (state.gamePhase !== 'playing') return { ok: false, error: '게임이 종료되었다' };
  if (state.currentTeam !== team) return { ok: false, error: '당신 팀의 차례가 아니다' };
  if (state.turnPhase !== 'clue') return { ok: false, error: '지금은 단서를 줄 수 없다' };
  if (state.currentClue) return { ok: false, error: '이미 단서가 활성화되어 있다' };

  const trimmed = (word == null ? '' : String(word)).trim();
  if (trimmed.length < 1) return { ok: false, error: '단서 단어가 비어있다' };

  const n = Number(number);
  if (!Number.isInteger(n) || n < 1 || n > 9) return { ok: false, error: '단서 숫자는 1~9' };

  state.currentClue = { word: trimmed.slice(0, 30), number: n, team };
  state.guessesLeft = n + 1; // 정통 규칙: 보너스 추측 +1
  state.turnPhase = 'guess';
  return { ok: true };
}

/**
 * 요원이 카드를 클릭(추측)한다. 카드를 공개하고 색을 판정해 상태를 변이한다.
 *
 * 결과별 처리:
 *  - 'correct'  (자기 팀): guessesLeft -= 1, 0이면 턴 종료. 자기 팀 전체 공개 시 승리.
 *  - 'neutral'  (중립):    즉시 턴 종료.
 *  - 'opponent' (상대 팀): 상대 found +1 → 상대 전체 공개면 상대 승리, 아니면 턴 종료.
 *  - 'assassin' (암살자):  현재 팀 즉시 패배(상대 승리), 게임 종료.
 *
 * @param {GameState} state
 * @param {'red'|'blue'} team - 추측하는 팀
 * @param {number} cardIndex  - 0..24
 * @returns {{ok:boolean, error?:string, result?:'correct'|'neutral'|'opponent'|'assassin', turnEnded?:boolean, win?:boolean}}
 */
export function guessCard(state, team, cardIndex) {
  if (state.gamePhase !== 'playing') return { ok: false, error: '게임이 종료되었다' };
  if (state.currentTeam !== team) return { ok: false, error: '당신 팀의 차례가 아니다' };
  if (state.turnPhase !== 'guess') return { ok: false, error: '아직 단서가 나오지 않았다' };
  if (!Number.isInteger(cardIndex) || cardIndex < 0 || cardIndex >= BOARD_SIZE) {
    return { ok: false, error: '잘못된 카드 인덱스' };
  }
  if (state.revealed[cardIndex] !== null) return { ok: false, error: '이미 공개된 카드' };
  if (state.guessesLeft <= 0) return { ok: false, error: '남은 추측이 없다' };

  const color = state.keyCard[cardIndex];
  state.revealed[cardIndex] = color;

  // ── 암살자: 즉시 패배 (상대 승리) ──
  if (color === 'assassin') {
    state.gamePhase = 'over';
    state.winner = opponentTeam(team);
    state.winReason = 'assassin';
    return { ok: true, result: 'assassin', turnEnded: true };
  }

  // ── 자기 팀 카드 적중 ──
  if (color === team) {
    incrTeamFound(state, team);
    if (checkTeamWin(state, team)) {
      return { ok: true, result: 'correct', turnEnded: true, win: true };
    }
    state.guessesLeft -= 1;
    if (state.guessesLeft <= 0) {
      // 추측 한도 소진 → 턴 종료.
      endTurn(state, team);
      return { ok: true, result: 'correct', turnEnded: true };
    }
    // 한도 내 → 턴 유지, 계속 추측.
    return { ok: true, result: 'correct', turnEnded: false };
  }

  // ── 상대 팀 카드 적중: 상대 진척 +1 + 턴 종료 ──
  if (color === 'red' || color === 'blue') {
    const opp = color; // 적중한 카드 색이 곧 상대 팀
    incrTeamFound(state, opp);
    if (checkTeamWin(state, opp)) {
      // 상대 팀이 이 카드로 전체 공개를 완성 → 상대 즉시 승리.
      return { ok: true, result: 'opponent', turnEnded: true, win: true };
    }
    endTurn(state, team);
    return { ok: true, result: 'opponent', turnEnded: true };
  }

  // ── 중립: 즉시 턴 종료 ──
  endTurn(state, team);
  return { ok: true, result: 'neutral', turnEnded: true };
}

/**
 * 요원이 명시적으로 패스(조기 턴 종료)한다.
 * @param {GameState} state
 * @param {'red'|'blue'} team
 * @returns {{ok:boolean, error?:string}}
 */
export function endTurnByPass(state, team) {
  if (state.gamePhase !== 'playing') return { ok: false, error: '게임이 종료되었다' };
  if (state.currentTeam !== team) return { ok: false, error: '당신 팀의 차례가 아니다' };
  if (state.turnPhase !== 'guess') return { ok: false, error: '단서가 나오기 전엔 패스할 수 없다' };
  endTurn(state, team);
  return { ok: true };
}

/**
 * 현재 팀의 턴을 종료하고 상대 팀의 단서 대기 단계로 전환한다.
 * 턴 교대 시 clue=null, guessesLeft=0, turnPhase='clue'로 초기화한다.
 * @param {GameState} state
 * @param {'red'|'blue'} team - 턴을 마치는 현재 팀
 */
function endTurn(state, team) {
  if (state.gamePhase !== 'playing') return;
  state.currentTeam = opponentTeam(team);
  state.turnPhase = 'clue';
  state.currentClue = null;
  state.guessesLeft = 0;
  // [P1-FIX-5] turnCount 증가 — 0-공개 패스 연속 시 stateKey 중복 방지
  state.turnCount = (state.turnCount || 0) + 1;
}

/**
 * 클라이언트(특정 역할)에게 보낼 상태 스냅샷을 만든다.
 * 듀엣 마스킹 패턴 참조 — 역할에 따라 키 카드 노출을 분리한다.
 *
 * - 스파이마스터: keyCard 전체 노출 (myKey = 전체 색상 배열)
 * - 요원: 미공개 카드의 색은 null로 마스킹 (revealed=true인 카드만 색 노출)
 *
 * @param {GameState} state
 * @param {'spymaster'|'operative'} role - 수신자 역할
 * @param {string} playerId              - 수신자 ID
 * @returns {object} STATE 페이로드
 */
export function snapshotForPlayer(state, role, playerId) {
  // 스파이마스터는 키 전체, 요원은 공개된 카드만(미공개는 null).
  const myKey = role === 'spymaster'
    ? state.keyCard.slice()
    : state.keyCard.map((c, i) => (state.revealed[i] !== null ? c : null));

  return {
    type: 'STATE',
    words: state.words,
    revealed: state.revealed,
    myKey,
    firstTeam: state.firstTeam,
    redTotal: state.redTotal,
    blueTotal: state.blueTotal,
    redFound: state.redFound,
    blueFound: state.blueFound,
    currentTeam: state.currentTeam,
    turnPhase: state.turnPhase,
    currentClue: state.currentClue,
    guessesLeft: state.guessesLeft,
    gamePhase: state.gamePhase,
    winner: state.winner,
    winReason: state.winReason,
    you: playerId,
    yourRole: role,
    turnCount: state.turnCount ?? 0, // [P1-FIX-5] 봇 stateKey 중복 방지용
  };
}
