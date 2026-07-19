/**
 * @fileoverview 베네치아 타이핑 배틀 순수 게임 로직.
 *
 * 아키텍처: **서버 권위(Server Authoritative)**
 *  - 단어 풀·HP·공격 판정·게임 종료 모두 이 모듈에서만 수행한다.
 *  - 네트워크 코드 없음 — 단위 테스트에서 직접 import 가능(서버 불필요).
 *  - state 객체를 직접 변이(mutate)한다(기존 omok/yahtzee game.js 패턴 동일).
 */

// ── 상수 ────────────────────────────────────────────────────────
/** 초기 HP. */
export const INITIAL_HP = 100;
/** 난이도별 공격력 계수. */
export const DIFFICULTY_MULTIPLIER = { easy: 1.0, medium: 1.5, hard: 2.0 };
/** 화면에 동시에 활성 가능한 최대 단어 수. */
export const MAX_ACTIVE_WORDS = 5;
/** 단어 낙하 시간(ms). 이 시간이 지나면 소멸. */
export const WORD_LIFETIME_MS = 8000;

/**
 * @typedef {Object} VeneziaWord
 * @property {string} id 단어 고유 ID (서버가 시퀀스 생성)
 * @property {string} text 단어 텍스트
 * @property {'easy'|'medium'|'hard'} difficulty 난이도
 * @property {string} ownerId 이 단어가 표시되는 플레이어 ID
 * @property {number} x 수평 위치 비율 (0.0~1.0)
 * @property {number} spawnedAt 생성 시각 (게임 시작 기준 ms)
 */

/**
 * @typedef {Object} VeneziaItemSlot
 * @property {string} itemId   아이템 ID ('item_bomb' 등)
 * @property {string} emoji    이모지
 * @property {string} name     한국어 이름
 */

/**
 * @typedef {Object} VeneziaPlayer
 * @property {string} id 'p1' | 'p2'
 * @property {string} name 닉네임
 * @property {number} hp 현재 HP
 * @property {number} combo 연속 타이핑 성공 횟수
 * @property {VeneziaItemSlot[]} itemSlots 최대 3개 FIFO
 * @property {number} fallClockMs 누적 낙하 시계(ms)
 * @property {number} fallClockUpdatedAt 마지막 낙하 시계 갱신 시각
 * @property {number} fallSpeedMultiplier 현재 낙하 속도 배율
 * @property {boolean} dark 암흑 상태
 * @property {boolean} shield 방어막 보유
 */

/**
 * @typedef {Object} VeneziaState
 * @property {'waiting'|'playing'|'ended'} phase 게임 단계
 * @property {number} startedAt 게임 시작 시각 (Date.now())
 * @property {{ p1: VeneziaPlayer, p2: VeneziaPlayer }} players 플레이어 정보
 * @property {Object<string, VeneziaWord>} words 현재 활성 단어 Map
 * @property {number} wordIdSeq 다음 단어 ID 시퀀스
 * @property {null|{ winner: string, reason: string }} result 종료 결과
 */

// ── 게임 생성 ────────────────────────────────────────────────────

/**
 * 새 게임 상태를 생성한다.
 * @param {string} p1Name 플레이어1 닉네임
 * @param {string} p2Name 플레이어2 닉네임
 * @returns {VeneziaState}
 */
export function createGame(p1Name = '플레이어1', p2Name = '플레이어2') {
  return {
    phase: 'playing',
    startedAt: Date.now(),
    players: {
      p1: { id: 'p1', name: p1Name, hp: INITIAL_HP, combo: 0, itemSlots: [], fallClockMs: 0, fallClockUpdatedAt: 0, fallSpeedMultiplier: 1, dark: false, shield: false },
      p2: { id: 'p2', name: p2Name, hp: INITIAL_HP, combo: 0, itemSlots: [], fallClockMs: 0, fallClockUpdatedAt: 0, fallSpeedMultiplier: 1, dark: false, shield: false },
    },
    words: {},
    wordIdSeq: 1,
    result: null,
  };
}

// ── 난이도 판정 ────────────────────────────────────────────────

/**
 * 경과 시간으로 현재 난이도 단계를 판정한다.
 * @param {number} elapsedSec 게임 시작 후 경과 초
 * @returns {'easy'|'medium'|'hard'}
 */
export function getDifficulty(elapsedSec) {
  if (elapsedSec < 30) return 'easy';
  if (elapsedSec < 60) return 'medium';
  return 'hard';
}

// ── 단어 관리 ────────────────────────────────────────────────────

/**
 * 플레이어에게 활성된 단어 수를 센다.
 * @param {VeneziaState} state
 * @param {string} playerId
 * @returns {number}
 */
export function countActiveWords(state, playerId) {
  let count = 0;
  for (const w of Object.values(state.words)) {
    if (w.ownerId === playerId) count++;
  }
  return count;
}

/**
 * 플레이어의 누적 낙하 시계를 지정 시각까지 확정한다.
 * @param {VeneziaPlayer} player 대상 플레이어
 * @param {number} nowRelative 게임 시작 기준 현재 시각(ms)
 * @returns {number} 확정된 누적 낙하 시계(ms)
 */
export function materializeFallClock(player, nowRelative) {
  if (!player) return 0;
  const safeNow = Math.max(player.fallClockUpdatedAt || 0, Number(nowRelative) || 0);
  const elapsed = safeNow - (player.fallClockUpdatedAt || 0);
  player.fallClockMs = (player.fallClockMs || 0) + elapsed * (player.fallSpeedMultiplier || 1);
  player.fallClockUpdatedAt = safeNow;
  return player.fallClockMs;
}

/**
 * 현재 진행을 보존하면서 플레이어의 낙하 배율을 변경한다.
 * @param {VeneziaState} state 게임 상태
 * @param {string} playerId 대상 플레이어 ID
 * @param {number} multiplier 새 낙하 배율
 * @param {number} nowRelative 게임 시작 기준 현재 시각(ms)
 * @returns {number} 변경 직전까지 확정된 누적 낙하 시계(ms)
 */
export function setFallSpeed(state, playerId, multiplier, nowRelative) {
  const player = state.players[playerId];
  const clock = materializeFallClock(player, nowRelative);
  if (player) player.fallSpeedMultiplier = multiplier;
  return clock;
}

/**
 * 새 단어를 생성하여 state에 추가한다.
 * @param {VeneziaState} state
 * @param {string} playerId 단어를 받을 플레이어
 * @param {string} text 단어 텍스트
 * @param {'easy'|'medium'|'hard'} difficulty 난이도
 * @returns {VeneziaWord} 생성된 단어 객체
 */
export function spawnWord(state, playerId, text, difficulty) {
  const nowRelative = Date.now() - state.startedAt;
  const spawnedAtFallClock = materializeFallClock(state.players[playerId], nowRelative);
  const id = `w${state.wordIdSeq++}`;
  const word = {
    id,
    text,
    difficulty,
    ownerId: playerId,
    x: 0.1 + Math.random() * 0.8, // 좌우 10~90% 범위
    spawnedAt: nowRelative,
    spawnedAtFallClock,
  };
  state.words[id] = word;
  return word;
}

/**
 * 만료된 단어(수명 초과)를 제거한다.
 * @param {VeneziaState} state
 * @param {number} nowRelative 현재 시각(게임 시작 기준 ms)
 * @returns {string[]} 제거된 단어 ID 배열
 */
export function expireWords(state, nowRelative) {
  /** @type {Array<{id: string, ownerId: string}>} */
  const expired = [];
  const ownerClocks = new Map();
  for (const [id, word] of Object.entries(state.words)) {
    if (!ownerClocks.has(word.ownerId)) {
      ownerClocks.set(word.ownerId, materializeFallClock(state.players[word.ownerId], nowRelative));
    }
    const spawnedClock = Number.isFinite(word.spawnedAtFallClock) ? word.spawnedAtFallClock : word.spawnedAt;
    if (ownerClocks.get(word.ownerId) - spawnedClock >= WORD_LIFETIME_MS) {
      // ownerId 포함 반환 — 서버가 플레이어별 / 상대별로 분류할 수 있도록.
      expired.push({ id, ownerId: word.ownerId });
      delete state.words[id];
    }
  }
  return expired;
}

// ── 단어 제출 ────────────────────────────────────────────────────

/**
 * 단어 제출을 검증하고 공격력을 계산한다.
 * @param {VeneziaState} state
 * @param {string} playerId 제출한 플레이어 ID
 * @param {string} wordId 제출 대상 단어 ID
 * @param {string} text 플레이어가 입력한 텍스트
 * @returns {{ ok: boolean, error?: string, word?: VeneziaWord, combo?: number }}
 */
export function submitWord(state, playerId, wordId, text) {
  if (state.phase !== 'playing') {
    return { ok: false, error: '게임이 진행 중이 아닙니다.' };
  }
  const word = state.words[wordId];
  if (!word) {
    // 실패: 콤보 초기화
    state.players[playerId].combo = 0;
    return { ok: false, error: '해당 단어를 찾을 수 없습니다.' };
  }
  if (word.ownerId !== playerId) {
    state.players[playerId].combo = 0;
    return { ok: false, error: '본인에게 할당된 단어가 아닙니다.' };
  }
  if (text !== word.text) {
    // 오답: 콤보 초기화
    state.players[playerId].combo = 0;
    return { ok: false, error: '입력이 정확하지 않습니다.' };
  }

  // 단어 제거
  delete state.words[wordId];

  // 콤보 증가
  state.players[playerId].combo++;

  return { ok: true, word, combo: state.players[playerId].combo };
}

// ── HP 적용 및 게임 종료 ─────────────────────────────────────────

/**
 * 게임 종료 여부를 확인한다.
 * @param {VeneziaState} state
 * @returns {{ ended: boolean, winner?: string, reason?: string }}
 */
export function checkGameOver(state) {
  if (state.players.p1.hp <= 0) {
    state.phase = 'ended';
    state.result = { winner: 'p2', reason: 'hp_zero' };
    return { ended: true, winner: 'p2', reason: 'hp_zero' };
  }
  if (state.players.p2.hp <= 0) {
    state.phase = 'ended';
    state.result = { winner: 'p1', reason: 'hp_zero' };
    return { ended: true, winner: 'p1', reason: 'hp_zero' };
  }
  return { ended: false };
}

/**
 * 기권 처리.
 * @param {VeneziaState} state
 * @param {string} playerId 기권자
 * @returns {{ ok: boolean, winner?: string, reason?: string }}
 */
export function applyResign(state, playerId) {
  if (state.phase !== 'playing') {
    return { ok: false, error: '게임이 진행 중이 아닙니다.' };
  }
  const winner = playerId === 'p1' ? 'p2' : 'p1';
  state.phase = 'ended';
  state.result = { winner, reason: 'resign' };
  return { ok: true, winner, reason: 'resign' };
}

// ── 스냅샷 ──────────────────────────────────────────────────────

/**
 * 클라이언트 전송용 스냅샷을 만든다.
 * 아이템 슬롯은 ITEM_GRANTED로 개별 전송하므로 STATE에 포함하지 않는다.
 * @param {VeneziaState} state
 * @param {string} playerId 대상 플레이어 (자기 단어만 포함)
 * @returns {object}
 */
export function snapshot(state, playerId) {
  const nowRelative = Date.now() - state.startedAt;
  const elapsedSec = Math.floor(nowRelative / 1000);
  const oppId = playerId === 'p1' ? 'p2' : 'p1';
  const myWords = Object.values(state.words).filter((w) => w.ownerId === playerId);
  // 상대 단어도 전송 — 클라이언트 상대 화면 표시용.
  const oppWords = Object.values(state.words).filter((w) => w.ownerId === oppId);
  return {
    type: 'STATE',
    players: [
      { id: 'p1', name: state.players.p1.name, hp: state.players.p1.hp },
      { id: 'p2', name: state.players.p2.name, hp: state.players.p2.hp },
    ],
    elapsedSec,
    difficulty: getDifficulty(elapsedSec),
    myWords,
    oppWords,
    phase: state.phase,
    serverNowRelative: nowRelative,
    fallClocks: {
      p1: {
        fallClockMs: materializeFallClock(state.players.p1, nowRelative),
        fallClockUpdatedAt: nowRelative,
        fallSpeedMultiplier: state.players.p1.fallSpeedMultiplier,
      },
      p2: {
        fallClockMs: materializeFallClock(state.players.p2, nowRelative),
        fallClockUpdatedAt: nowRelative,
        fallSpeedMultiplier: state.players.p2.fallSpeedMultiplier,
      },
    },
  };
}

// ── 아이템 시스템 ────────────────────────────────────────────────

/** 아이템 5종 정의. */
const ITEM_DEFS = [
  { itemId: 'item_bomb',   emoji: '\u{1F9E8}', name: '단어 폭탄' },
  { itemId: 'item_freeze', emoji: '\u{1F30A}', name: '급류' },
  { itemId: 'item_dark',   emoji: '\u{1F311}', name: '암흑' },
  { itemId: 'item_shield', emoji: '\u{1F6E1}\uFE0F', name: '방어막' },
  { itemId: 'item_heal',   emoji: '\u{1F49A}', name: '회복' },
];

/** 콤보 단계별 드랍 확률. 인덱스 = combo 값. */
const DROP_CHANCE = [
  0, 0, 0,       // 0~2: 0%
  0.10, 0.10,    // 3~4: 10%
  0.20, 0.20,    // 5~6: 20%
  0.35, 0.35, 0.35, // 7~9: 35%
  0.50, 0.50, 0.50, 0.50, 0.50, // 10~14: 50%
  // 15+: 0.70 (getDropChance에서 처리)
];

/**
 * 콤보 값에 따른 드랍 확률을 반환한다.
 * @param {number} combo
 * @returns {number}
 */
function getDropChance(combo) {
  if (combo >= 15) return 0.70;
  return DROP_CHANCE[combo] || 0;
}

/**
 * 콤보 수에 따라 아이템 드랍 여부와 종류를 반환한다.
 * @param {number} combo 현재 콤보 수
 * @returns {{ dropped: boolean, itemId?: string, emoji?: string, name?: string }}
 */
export function rollItemDrop(combo) {
  const chance = getDropChance(combo);
  if (chance <= 0 || Math.random() >= chance) {
    return { dropped: false };
  }
  // 5종 중 균등 랜덤 선택
  const item = ITEM_DEFS[Math.floor(Math.random() * ITEM_DEFS.length)];
  return { dropped: true, itemId: item.itemId, emoji: item.emoji, name: item.name };
}

/**
 * 아이템 사용을 처리하고 결과를 반환한다.
 * bomb/item_freeze/dark는 상대에 대한 공격이다. item_freeze는 호환 ID이며 사용자 효과명은 급류다.
 * @param {VeneziaState} state
 * @param {string} userId 사용자 ID
 * @param {number} slotIndex 사용할 슬롯 (0~2)
 * @returns {{ ok: boolean, item?: VeneziaItemSlot, targetId?: string, blocked?: boolean, spawnedWords?: VeneziaWord[], error?: string }}
 */
export function applyItemEffect(state, userId, slotIndex) {
  const player = state.players[userId];
  if (!player || slotIndex < 0 || slotIndex >= player.itemSlots.length) {
    return { ok: false, error: '슬롯이 비어있습니다.' };
  }

  // 슬롯에서 아이템 꺼냄 (FIFO 유지, 남은 슬롯 앞으로 당김)
  const item = player.itemSlots.splice(slotIndex, 1)[0];
  if (!item) {
    return { ok: false, error: '슬롯이 비어있습니다.' };
  }

  const targetId = userId === 'p1' ? 'p2' : 'p1';
  const target = state.players[targetId];

  // 공격성 아이템: 폭탄, 급류(호환 ID item_freeze), 암흑 — 방어막 체크
  if (item.itemId === 'item_bomb' || item.itemId === 'item_freeze' || item.itemId === 'item_dark') {
    if (target.shield) {
      target.shield = false;
      return { ok: true, item, targetId, blocked: true };
    }
  }

  switch (item.itemId) {
    case 'item_bomb': {
      // 상대에게 hard 단어 2개 강제 스폰 (MAX_ACTIVE_WORDS 무시)
      const spawnedWords = [];
      for (let i = 0; i < 2; i++) {
        // pickWordByTime은 server.js에서 주입해야 하므로, 여기서는 스폰만 수행
        // 실제 단어 텍스트는 server.js에서 생성하여 전달
        // → applyItemEffect는 순수 함수이므로 단어 생성을 직접 수행
        // words.js import가 없으므로 spawnWord만 호출 (텍스트는 server.js가 제공)
        // 변경: server.js에서 직접 처리하도록 빈 배열 반환
      }
      return { ok: true, item, targetId, spawnedWords };
    }
    case 'item_freeze':
      return { ok: true, item, targetId };
    case 'item_dark': {
      target.dark = true;
      return { ok: true, item, targetId };
    }
    case 'item_shield': {
      // 본인에게 방어막 설정
      player.shield = true;
      return { ok: true, item, targetId: userId };
    }
    case 'item_heal': {
      // 본인 HP +15 (최대 INITIAL_HP)
      player.hp = Math.min(INITIAL_HP, player.hp + 15);
      return { ok: true, item, targetId: userId };
    }
    default:
      return { ok: false, error: '알 수 없는 아이템입니다.' };
  }
}

/**
 * 플레이어 콤보를 0으로 초기화한다.
 * @param {VeneziaState} state
 * @param {string} playerId
 */
export function resetCombo(state, playerId) {
  if (state.players[playerId]) {
    state.players[playerId].combo = 0;
  }
}
