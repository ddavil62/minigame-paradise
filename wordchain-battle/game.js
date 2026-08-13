/**
 * @fileoverview 끝말잇기 배틀 순수 게임 로직.
 *
 * 서버 권위(Server Authoritative) 구조:
 *   - HP 계산, 게이지 계산, 가비지 발동, 타이머 관리, 승패 판정 모두 여기서 처리.
 *   - 클라이언트는 WORD_SUBMIT만 전송.
 *
 * 턴제 공유 체인 구조:
 *   - 두 플레이어는 하나의 공유 체인(chain)을 번갈아 이어간다.
 *   - 매 순간 game.turn이 입력 가능한 플레이어를 가리킨다.
 *   - 단어 제출 성공 또는 타이머 만료 시 턴이 상대에게 넘어간다.
 *   - 타이머 만료는 HP만 깎고 체인 요구 글자는 그대로 유지된다(다음 턴 플레이어가 이어받음).
 */

import {
  isKorean, getLastSyllable, matchesStartChar, pickGarbageSyllable, computeDeadEndAlts, getDueumAlt,
} from './words.js';

// ── 밸런스 수치 ─────────────────────────────────────────────────

/** 초기 HP */
export const INITIAL_HP = 100;

/** 가비지 음절 데미지 */
export const GARBAGE_DAMAGE = 10;

/** 타이머 만료 페널티 (HP) */
export const TIMER_PENALTY = 5;

/** 단어 제출 타이머 (초). 빠른 교대 흐름을 위해 10초로 제한한다. */
export const TURN_TIMER_SEC = 10;

/** 가비지 게이지 최대값 */
export const MAX_GAUGE = 100;

/** 남은 시간 1초당 게이지 충전량 */
export const GAUGE_PER_SECOND = 5;

// ── 게임 상태 생성 ──────────────────────────────────────────────

/**
 * @typedef {Object} PlayerState
 * @property {string} id           - 'p1' | 'p2'
 * @property {string} name         - 닉네임
 * @property {number} hp           - 현재 HP (0~100)
 * @property {number} gauge        - 공격 게이지 (0~100)
 */

/**
 * @typedef {Object} ChainState
 * @property {string|null} lastWord      - 마지막으로 수락된 단어
 * @property {string|null} lastSyllable  - 다음 단어의 시작 글자 요구값 (자유면 null)
 * @property {string|null} forced        - 가비지 음절로 강제된 시작 글자. null이면 비활성
 * @property {Set<string>|null} deadEndAlts - 막힘/희귀 종성 발동 시 허용되는 대체 시작 글자 집합
 */

/**
 * @typedef {Object} GameState
 * @property {'waiting' | 'countdown' | 'playing' | 'over'} phase
 * @property {Object<string, PlayerState>} players - 'p1', 'p2' 키
 * @property {ChainState} chain                     - 공유 체인 상태
 * @property {string} turn                          - 현재 입력 가능한 playerId
 * @property {Set<string>} usedWords              - 매치에서 사용된 단어 집합
 * @property {string|null} winner                  - 승자 playerId. null이면 진행 중
 * @property {string|null} loser                   - 패자 playerId
 * @property {string|null} reason                  - 종료 사유
 */

/**
 * 초기 게임 상태를 생성한다.
 * @param {string} p1Name P1 닉네임
 * @param {string} p2Name P2 닉네임
 * @param {string} [firstTurn='p1'] 첫 턴을 가질 플레이어 ID
 * @param {string|null} [initialSyllable=null] 첫 단어의 시작 글자
 * @param {Map<string, number>} [followerCountMap] 글자별 후속 단어 수 맵 (대체 시작 글자 표시용)
 * @returns {GameState}
 */
export function createGame(p1Name, p2Name, firstTurn = 'p1', initialSyllable = null, followerCountMap = null) {
  const validInitialSyllable = typeof initialSyllable === 'string' && initialSyllable.length === 1
    ? initialSyllable
    : null;
  const { alts: initialAlts } = resolveStartAlts(validInitialSyllable, followerCountMap);

  return {
    phase: 'waiting',
    players: {
      p1: {
        id: 'p1',
        name: p1Name || '플레이어1',
        hp: INITIAL_HP,
        gauge: 0,
      },
      p2: {
        id: 'p2',
        name: p2Name || '플레이어2',
        hp: INITIAL_HP,
        gauge: 0,
      },
    },
    chain: {
      lastWord: null,
      lastSyllable: validInitialSyllable,
      forced: null,
      deadEndAlts: initialAlts,
    },
    turn: firstTurn === 'p2' ? 'p2' : 'p1',
    usedWords: new Set(),
    winner: null,
    loser: null,
    reason: null,
  };
}

/**
 * 반대 플레이어 ID를 반환한다.
 * @param {string} playerId
 * @returns {string}
 */
function opponentOf(playerId) {
  return playerId === 'p1' ? 'p2' : 'p1';
}

/**
 * 다음 턴 체인에 표시/허용할 대체 시작 글자 집합을 계산한다.
 * 막힘/희귀 종성(followerCount < threshold)이면 받침 제거까지 포함한 전체 확장을 쓰고,
 * 그렇지 않아도 두음법칙 변환형은 matchesStartChar가 항상 허용하므로 UI에 노출한다.
 * @param {string|null} syllable 끝 글자
 * @param {Map<string, number>} [followerCountMap] 글자별 후속 단어 수 맵
 * @returns {{ alts: Set<string>|null, expanded: boolean }}
 */
function resolveStartAlts(syllable, followerCountMap) {
  if (!followerCountMap || !syllable) {
    return { alts: null, expanded: false };
  }

  const deadEndAlts = computeDeadEndAlts(syllable, followerCountMap);
  if (deadEndAlts !== null) {
    return { alts: deadEndAlts, expanded: true };
  }

  const dueumAlt = getDueumAlt(syllable);
  if (dueumAlt) {
    return { alts: new Set([syllable, dueumAlt]), expanded: false };
  }

  return { alts: null, expanded: false };
}

// ── 게이지 계산 ─────────────────────────────────────────────────

/**
 * 제출 시 남은 시간에 따른 게이지 충전량을 계산한다.
 * @param {number} remainingSec 남은 정수 초
 * @returns {number} 게이지 충전량
 */
export function calcGaugeGain(remainingSec) {
  const seconds = Math.max(0, Math.min(TURN_TIMER_SEC, Math.floor(Number(remainingSec) || 0)));
  return seconds * GAUGE_PER_SECOND;
}

// ── 단어 제출 처리 ──────────────────────────────────────────────

/**
 * @typedef {Object} SubmitResult
 * @property {boolean} ok       - 수락 여부
 * @property {string} [reason]  - 거부 사유 ('invalid'|'duplicate'|'wrong_start'|'not_korean'|'not_your_turn')
 * @property {number} [gaugeGain]     - 게이지 충전량
 * @property {number} [newGauge]      - 새 게이지 값
 * @property {string} [newLastSyllable] - 새 시작 글자
 * @property {boolean} [wasGarbage] - 직전에 받은 강제 글자에 대응한 단어인지 여부
 * @property {boolean} [garbageFired] - 가비지 발동 여부
 * @property {string|null} [garbageChar] - 가비지 음절
 * @property {string|null} [garbageTargetId] - 가비지 대상
 * @property {boolean} [deadEndExpanded] - 막힘/희귀 종성 대체 글자 확장이 발동됐는지 여부
 * @property {string} [nextTurn] - 처리 후 턴을 가질 playerId
 */

/**
 * 단어 제출을 처리한다. 모든 검증은 서버에서 수행.
 * @param {GameState} game 게임 상태
 * @param {string} playerId 제출한 플레이어 ID
 * @param {string} word 제출된 단어
 * @param {Set<string>} wordSet 사전 단어 Set
 * @param {Map<string, number>} garbageCandidates 가비지 후보 맵
 * @param {Map<string, number>} [followerCountMap] 글자별 후속 단어 수 맵 (막힘/희귀 종성 판정용)
 * @returns {SubmitResult}
 */
export function submitWord(
  game,
  playerId,
  word,
  wordSet,
  garbageCandidates,
  followerCountMap,
  remainingSec = TURN_TIMER_SEC,
) {
  const player = game.players[playerId];
  if (!player) return { ok: false, reason: 'invalid' };

  // 0. 턴 검사 — 공유 체인은 자기 턴에만 이을 수 있다.
  if (game.turn !== playerId) {
    return { ok: false, reason: 'not_your_turn' };
  }

  // macOS 등 일부 환경의 한글 IME는 자모가 분리된 NFD 형태로 입력을 전달한다.
  // 사전(words.json)은 NFC(완성형)로 저장되어 있으므로, 검증 전 NFC로 통일해
  // "사과"(NFD)가 "한글 아님"/"사전 없음"으로 오판되지 않게 한다.
  word = typeof word === 'string' ? word.normalize('NFC') : word;

  // 1. 한글 검사
  if (!isKorean(word)) {
    return { ok: false, reason: 'not_korean' };
  }

  // 2. 사전 검증
  if (!wordSet.has(word)) {
    return { ok: false, reason: 'invalid' };
  }

  // 3. 중복 검사 (공유 체인이므로 매치 전체에서 단 한 번만 등장 가능)
  if (game.usedWords.has(word)) {
    return { ok: false, reason: 'duplicate' };
  }

  // 4. 시작 글자 검사
  const startChar = word[0];
  const chain = game.chain;

  // 4a. forced (가비지 음절) 확인 — forced가 있으면 forced 우선
  if (chain.forced) {
    if (!matchesStartChar(startChar, chain.forced)) {
      return { ok: false, reason: 'wrong_start' };
    }
  } else if (chain.lastSyllable) {
    // 4b. 공유 체인의 마지막 글자 확인
    // deadEndAlts가 있으면 확장 집합으로 판정, 없으면 기존 matchesStartChar 로직
    const validStart = chain.deadEndAlts
      ? chain.deadEndAlts.has(startChar)
      : matchesStartChar(startChar, chain.lastSyllable);
    if (!validStart) {
      return { ok: false, reason: 'wrong_start' };
    }
  }
  // chain.lastSyllable이 null이면 첫 단어 — 아무 글자로 시작 가능

  // ── 모든 검사 통과: 단어 수락 ──

  // 검증에 성공한 시점의 forced 상태를 보존해야 이후 상태 해제와 의미가 섞이지 않는다.
  const wasGarbage = Boolean(chain.forced);

  // 사용된 단어 추가
  game.usedWords.add(word);

  // 빠르게 답할수록 더 많은 게이지를 충전한다.
  const gaugeGain = calcGaugeGain(remainingSec);
  player.gauge = Math.min(MAX_GAUGE, player.gauge + gaugeGain);

  // 체인 갱신
  chain.lastWord = word;
  chain.lastSyllable = getLastSyllable(word);
  chain.forced = null;
  chain.deadEndAlts = null;

  const opponentId = opponentOf(playerId);
  const opponent = game.players[opponentId];

  // 가비지 발동 판정
  let garbageFired = false;
  let garbageChar = null;
  let garbageTargetId = null;

  if (player.gauge >= MAX_GAUGE) {
    // 가비지 음절 선택 (방금 갱신된 체인의 다음 요구 글자와 겹치지 않게)
    garbageChar = pickGarbageSyllable(garbageCandidates, chain.lastSyllable);

    // 상대(다음 턴 플레이어)에게 가비지 강제
    chain.forced = garbageChar;

    // 데미지 적용
    opponent.hp = Math.max(0, opponent.hp - GARBAGE_DAMAGE);

    // 게이지 리셋
    player.gauge = 0;
    garbageFired = true;
    garbageTargetId = opponentId;
  }

  // 대체 시작 글자 판정 → 다음 턴(상대) 체인에 deadEndAlts 주입
  // forced가 이미 설정됐다면(가비지 발동) 우선순위상 deadEndAlts는 적용하지 않는다.
  let deadEndExpanded = false;
  if (!chain.forced) {
    const resolved = resolveStartAlts(chain.lastSyllable, followerCountMap);
    chain.deadEndAlts = resolved.alts;
    deadEndExpanded = resolved.expanded;
  }

  // 턴 전환
  game.turn = opponentId;

  return {
    ok: true,
    gaugeGain,
    newGauge: player.gauge,
    newLastSyllable: chain.lastSyllable,
    wasGarbage,
    garbageFired,
    garbageChar,
    garbageTargetId,
    deadEndExpanded,
    nextTurn: game.turn,
  };
}

// ── 타이머 만료 처리 ────────────────────────────────────────────

/**
 * 현재 체인 요구 조건(forced/deadEndAlts/lastSyllable)을 만족하고 아직 사용되지 않은
 * 단어 중 하나를 무작위로 고른다. submitWord의 시작 글자 판정 로직과 동일한 기준을 쓴다.
 * @param {ChainState} chain 공유 체인 상태
 * @param {Set<string>} wordSet 사전 단어 Set
 * @param {Set<string>} usedWords 이미 사용된 단어 집합
 * @returns {string|null} 선택된 단어. 조건에 맞는 단어가 없으면 null
 */
function pickAutoWord(chain, wordSet, usedWords) {
  const candidates = [];
  for (const word of wordSet) {
    if (usedWords.has(word)) continue;
    const startChar = word[0];
    let valid;
    if (chain.forced) {
      valid = matchesStartChar(startChar, chain.forced);
    } else if (chain.deadEndAlts) {
      valid = chain.deadEndAlts.has(startChar);
    } else if (chain.lastSyllable) {
      valid = matchesStartChar(startChar, chain.lastSyllable);
    } else {
      valid = true;
    }
    if (valid) candidates.push(word);
  }
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

/**
 * 타이머 만료 시 HP 페널티를 적용하고, 조건에 맞는 임의의 단어로 체인을 자동 진행한 뒤
 * 턴을 상대에게 넘긴다. wordSet이 주어지지 않거나 조건에 맞는 단어가 없으면(극히 드문 경우)
 * 기존처럼 체인 요구 글자를 그대로 유지한 채 턴만 넘긴다.
 * @param {GameState} game 게임 상태
 * @param {string} playerId 타이머 만료된 플레이어 ID
 * @param {Set<string>} [wordSet] 사전 단어 Set (자동 진행 단어 탐색용)
 * @param {Map<string, number>} [followerCountMap] 글자별 후속 단어 수 맵 (막힘 판정용)
 * @returns {{ hpLoss: number, newHp: number, nextTurn: string, autoWord: string|null, deadEndExpanded: boolean }}
 */
export function applyTimerExpiry(game, playerId, wordSet, followerCountMap) {
  const player = game.players[playerId];
  if (!player) {
    return {
      hpLoss: 0, newHp: 0, nextTurn: game.turn, autoWord: null, deadEndExpanded: false,
    };
  }

  player.hp = Math.max(0, player.hp - TIMER_PENALTY);

  const chain = game.chain;
  const autoWord = wordSet ? pickAutoWord(chain, wordSet, game.usedWords) : null;
  let deadEndExpanded = false;

  if (autoWord) {
    game.usedWords.add(autoWord);
    chain.lastWord = autoWord;
    chain.lastSyllable = getLastSyllable(autoWord);
    chain.forced = null;

    const resolved = resolveStartAlts(chain.lastSyllable, followerCountMap);
    chain.deadEndAlts = resolved.alts;
    deadEndExpanded = resolved.expanded;
  }

  game.turn = opponentOf(playerId);
  return {
    hpLoss: TIMER_PENALTY, newHp: player.hp, nextTurn: game.turn, autoWord, deadEndExpanded,
  };
}

// ── 기권 처리 ───────────────────────────────────────────────────

/**
 * 기권 처리.
 * @param {GameState} game 게임 상태
 * @param {string} playerId 기권한 플레이어 ID
 */
export function applyResign(game, playerId) {
  const opponentId = opponentOf(playerId);
  game.phase = 'over';
  game.winner = opponentId;
  game.loser = playerId;
  game.reason = 'resign';
}

// ── 승패 판정 ───────────────────────────────────────────────────

/**
 * HP 기반 게임 종료 여부를 확인한다.
 * @param {GameState} game 게임 상태
 * @returns {{ ended: boolean, winner: string|null, loser: string|null }}
 */
export function isGameOver(game) {
  for (const pid of ['p1', 'p2']) {
    if (game.players[pid].hp <= 0) {
      const winner = opponentOf(pid);
      game.phase = 'over';
      game.winner = winner;
      game.loser = pid;
      game.reason = 'hp_zero';
      return { ended: true, winner, loser: pid };
    }
  }
  return { ended: false, winner: null, loser: null };
}

// ── 스냅샷 ──────────────────────────────────────────────────────

/**
 * 클라이언트에 전송할 상태 스냅샷을 생성한다.
 * @param {GameState} game 게임 상태
 * @returns {object} STATE 메시지 페이로드
 */
export function snapshot(game) {
  return {
    type: 'STATE',
    turn: game.turn,
    chain: {
      lastWord: game.chain.lastWord,
      lastSyllable: game.chain.lastSyllable,
      forced: game.chain.forced,
      deadEndAlts: game.chain.deadEndAlts ? [...game.chain.deadEndAlts] : null,
    },
    players: Object.values(game.players).map((p) => ({
      id: p.id,
      name: p.name,
      hp: p.hp,
      gauge: p.gauge,
    })),
    usedWordsCount: game.usedWords.size,
  };
}
