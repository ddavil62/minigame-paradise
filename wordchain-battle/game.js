/**
 * @fileoverview 끝말잇기 배틀 순수 게임 로직.
 *
 * 서버 권위(Server Authoritative) 구조:
 *   - HP 계산, 게이지 계산, 가비지 발동, 타이머 관리, 승패 판정 모두 여기서 처리.
 *   - 클라이언트는 WORD_SUBMIT만 전송.
 */

import { isValidWord, isKorean, getLastSyllable, matchesStartChar, pickGarbageSyllable } from './words.js';

// ── 밸런스 수치 ─────────────────────────────────────────────────

/** 초기 HP */
export const INITIAL_HP = 100;

/** 가비지 음절 데미지 */
export const GARBAGE_DAMAGE = 10;

/** 타이머 만료 페널티 (HP) */
export const TIMER_PENALTY = 5;

/** 단어 제출 타이머 (초) */
export const TURN_TIMER_SEC = 20;

/** 가비지 게이지 최대값 */
export const MAX_GAUGE = 100;

/**
 * 글자 수별 게이지 충전량.
 * @type {Record<number, number>}
 */
const GAUGE_TABLE = {
  2: 15,
  3: 25,
  4: 35,
};

/** 5글자 이상 게이지 충전량 */
const GAUGE_5PLUS = 50;

// ── 게임 상태 생성 ──────────────────────────────────────────────

/**
 * @typedef {Object} PlayerState
 * @property {string} id           - 'p1' | 'p2'
 * @property {string} name         - 닉네임
 * @property {number} hp           - 현재 HP (0~100)
 * @property {number} gauge        - 공격 게이지 (0~100)
 * @property {string|null} forced  - 다음 단어의 강제 시작 글자 (가비지 음절). null이면 자유
 * @property {string|null} lastWord - 마지막으로 제출한 단어
 * @property {string|null} lastSyllable - 다음 단어의 시작 글자 (자기 체인의 마지막 글자)
 */

/**
 * @typedef {Object} GameState
 * @property {'waiting' | 'countdown' | 'playing' | 'over'} phase
 * @property {Object<string, PlayerState>} players - 'p1', 'p2' 키
 * @property {Set<string>} usedWords              - 매치에서 사용된 단어 집합
 * @property {string|null} winner                  - 승자 playerId. null이면 진행 중
 * @property {string|null} loser                   - 패자 playerId
 * @property {string|null} reason                  - 종료 사유
 */

/**
 * 초기 게임 상태를 생성한다.
 * @param {string} p1Name P1 닉네임
 * @param {string} p2Name P2 닉네임
 * @returns {GameState}
 */
export function createGame(p1Name, p2Name) {
  return {
    phase: 'waiting',
    players: {
      p1: {
        id: 'p1',
        name: p1Name || '플레이어1',
        hp: INITIAL_HP,
        gauge: 0,
        forced: null,
        lastWord: null,
        lastSyllable: null,
      },
      p2: {
        id: 'p2',
        name: p2Name || '플레이어2',
        hp: INITIAL_HP,
        gauge: 0,
        forced: null,
        lastWord: null,
        lastSyllable: null,
      },
    },
    usedWords: new Set(),
    winner: null,
    loser: null,
    reason: null,
  };
}

// ── 게이지 계산 ─────────────────────────────────────────────────

/**
 * 단어 길이에 따른 게이지 충전량을 계산한다.
 * @param {number} wordLength 단어 글자 수
 * @returns {number} 게이지 충전량
 */
export function calcGaugeGain(wordLength) {
  if (wordLength >= 5) return GAUGE_5PLUS;
  return GAUGE_TABLE[wordLength] || GAUGE_TABLE[2];
}

// ── 단어 제출 처리 ──────────────────────────────────────────────

/**
 * @typedef {Object} SubmitResult
 * @property {boolean} ok       - 수락 여부
 * @property {string} [reason]  - 거부 사유 ('invalid'|'duplicate'|'wrong_start'|'not_korean')
 * @property {number} [gaugeGain]     - 게이지 충전량
 * @property {number} [newGauge]      - 새 게이지 값
 * @property {string} [newLastSyllable] - 새 시작 글자
 * @property {boolean} [garbageFired] - 가비지 발동 여부
 * @property {string|null} [garbageChar] - 가비지 음절
 * @property {string|null} [garbageTargetId] - 가비지 대상
 */

/**
 * 단어 제출을 처리한다. 모든 검증은 서버에서 수행.
 * @param {GameState} game 게임 상태
 * @param {string} playerId 제출한 플레이어 ID
 * @param {string} word 제출된 단어
 * @param {Set<string>} wordSet 사전 단어 Set
 * @param {Map<string, number>} garbageCandidates 가비지 후보 맵
 * @returns {SubmitResult}
 */
export function submitWord(game, playerId, word, wordSet, garbageCandidates) {
  const player = game.players[playerId];
  if (!player) return { ok: false, reason: 'invalid' };

  // 1. 한글 검사
  if (!isKorean(word)) {
    return { ok: false, reason: 'not_korean' };
  }

  // 2. 사전 검증
  if (!wordSet.has(word)) {
    return { ok: false, reason: 'invalid' };
  }

  // 3. 중복 검사
  if (game.usedWords.has(word)) {
    return { ok: false, reason: 'duplicate' };
  }

  // 4. 시작 글자 검사
  const startChar = word[0];

  // 4a. forced (가비지 음절) 확인 — forced가 있으면 forced 우선
  if (player.forced) {
    if (!matchesStartChar(startChar, player.forced)) {
      return { ok: false, reason: 'wrong_start' };
    }
  } else if (player.lastSyllable) {
    // 4b. 자기 체인의 마지막 글자 확인
    if (!matchesStartChar(startChar, player.lastSyllable)) {
      return { ok: false, reason: 'wrong_start' };
    }
  }
  // lastSyllable이 null이면 첫 단어 — 아무 글자로 시작 가능

  // ── 모든 검사 통과: 단어 수락 ──

  // 사용된 단어 추가
  game.usedWords.add(word);

  // 게이지 충전
  const gaugeGain = calcGaugeGain(word.length);
  player.gauge = Math.min(MAX_GAUGE, player.gauge + gaugeGain);

  // 가비지 발동 판정
  let garbageFired = false;
  let garbageChar = null;
  let garbageTargetId = null;

  if (player.gauge >= MAX_GAUGE) {
    const opponentId = playerId === 'p1' ? 'p2' : 'p1';
    const opponent = game.players[opponentId];

    // 가비지 음절 선택 (상대의 현재 시작 글자와 겹치지 않게)
    garbageChar = pickGarbageSyllable(garbageCandidates, opponent.lastSyllable);

    // 상대에게 가비지 강제
    opponent.forced = garbageChar;

    // 데미지 적용
    opponent.hp = Math.max(0, opponent.hp - GARBAGE_DAMAGE);

    // 게이지 리셋
    player.gauge = 0;
    garbageFired = true;
    garbageTargetId = opponentId;
  }

  // forced 해소 (이 단어로 forced 조건을 충족했으므로)
  player.forced = null;

  // 체인 갱신
  player.lastWord = word;
  player.lastSyllable = getLastSyllable(word);

  return {
    ok: true,
    gaugeGain,
    newGauge: player.gauge,
    newLastSyllable: player.lastSyllable,
    garbageFired,
    garbageChar,
    garbageTargetId,
  };
}

// ── 타이머 만료 처리 ────────────────────────────────────────────

/**
 * 타이머 만료 시 HP 페널티를 적용한다.
 * @param {GameState} game 게임 상태
 * @param {string} playerId 타이머 만료된 플레이어 ID
 * @returns {{ hpLoss: number, newHp: number }}
 */
export function applyTimerExpiry(game, playerId) {
  const player = game.players[playerId];
  if (!player) return { hpLoss: 0, newHp: 0 };

  player.hp = Math.max(0, player.hp - TIMER_PENALTY);
  return { hpLoss: TIMER_PENALTY, newHp: player.hp };
}

// ── 기권 처리 ───────────────────────────────────────────────────

/**
 * 기권 처리.
 * @param {GameState} game 게임 상태
 * @param {string} playerId 기권한 플레이어 ID
 */
export function applyResign(game, playerId) {
  const opponentId = playerId === 'p1' ? 'p2' : 'p1';
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
      const winner = pid === 'p1' ? 'p2' : 'p1';
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
    players: Object.values(game.players).map((p) => ({
      id: p.id,
      name: p.name,
      hp: p.hp,
      gauge: p.gauge,
      forced: p.forced,
      lastWord: p.lastWord,
      lastSyllable: p.lastSyllable,
    })),
    usedWordsCount: game.usedWords.size,
  };
}
