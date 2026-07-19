/**
 * @fileoverview 아이템 시스템 (Phase 2).
 *
 * 5종 아이템:
 *  - garbage_bomb  (공격): 상대 보드 하단에 즉시 가비지 2줄 추가
 *  - dark          (공격): 상대 보드를 5초간 검은 오버레이로 덮음
 *  - freeze        (공격): 상대 블록 조작 3초간 차단 (중력은 유지)
 *  - line_clear    (방어): 자신의 하단 2줄 즉시 제거
 *  - shield        (방어): 다음 공격 1회 무효화
 *
 * 흐름:
 *  - 라인 클리어 → 서버가 50% 확률로 ITEM_GRANT 전송 → grantItem(slot, id) → 슬롯 채움
 *  - Z/X/C → useItem(slot) → 방어형은 즉시 로컬 적용, 공격형은 서버 경유로 상대에게 전달
 *  - 상대로부터 ITEM_EFFECT 수신 → applyEffect(id, duration) → 다크/프리즈/가비지폭탄 처리
 *  - 공격을 받기 직전 서버가 shieldActive 확인 → 활성이면 SHIELD_BLOCK으로 양쪽 통보
 */

import { GARBAGE_BOMB_LINES, LINE_CLEAR_LINES } from './board.js';

// ── 아이템 정의 ──────────────────────────────────────────────────
/**
 * @typedef {Object} ItemDef
 * @property {string} id          - 서버/네트워크 식별자
 * @property {string} name        - 한국어 표시 이름
 * @property {'attack'|'defense'} type
 * @property {string} icon        - HUD 슬롯 표시 아이콘 (이모지 또는 도형)
 * @property {string} cssClass    - .item-slot에 추가될 색상 클래스
 * @property {number} duration    - ms (0 = 즉시 효과)
 */

/** @type {Record<string, ItemDef>} */
export const ITEMS = Object.freeze({
  garbage_bomb: {
    id: 'garbage_bomb',
    name: '가비지 폭탄',
    type: 'attack',
    icon: '▣',  // ▣
    cssClass: 'item-garbage',
    duration: 0,
  },
  dark: {
    id: 'dark',
    name: '시야 가림',
    type: 'attack',
    icon: '●',  // ●
    cssClass: 'item-dark',
    duration: 5000,
  },
  freeze: {
    id: 'freeze',
    name: '프리즈',
    type: 'attack',
    icon: '❆',  // ❆
    cssClass: 'item-freeze',
    duration: 3000,
  },
  line_clear: {
    id: 'line_clear',
    name: '라인 클리어',
    type: 'defense',
    icon: '━',  // ━
    cssClass: 'item-lineclear',
    duration: 0,
  },
  shield: {
    id: 'shield',
    name: '방어막',
    type: 'defense',
    icon: '◇',  // ◇
    cssClass: 'item-shield',
    duration: 0,
  },
});

export const SLOT_COUNT = 3;

/**
 * 아이템 시스템 인스턴스를 생성한다.
 *
 * @param {object} deps
 * @param {object} deps.game - createGame()의 반환 객체
 * @param {object} deps.input - createInput()의 반환 객체 (setFrozen 호출용)
 * @param {object} deps.net - createNetwork()의 반환 객체 (sendItemUse 등)
 * @param {object} deps.ui - createUI()의 반환 객체 (슬롯/오버레이/피드백 렌더링)
 * @returns {object} 아이템 컨트롤러
 */
export function createItems(deps) {
  /** @type {(string|null)[]} 슬롯 배열 (null = 빈 슬롯) */
  const itemSlots = Array(SLOT_COUNT).fill(null);

  /** 방어막 활성 플래그 (다음 공격 1회 차단). */
  let shieldActive = false;

  /** 다크/프리즈 활성 타이머 핸들 (중복 적용 시 기존 타이머 정리). */
  let darkTimer = 0;
  let freezeTimer = 0;
  let shieldFeedbackTimer = 0;

  // ── 슬롯 헬퍼 ─────────────────────────────────────────────────

  /**
   * 슬롯 UI를 다시 그린다.
   */
  function refreshSlots() {
    deps.ui.renderItemSlots(itemSlots.map((id) => (id ? ITEMS[id] : null)));
  }

  /**
   * 비어 있는 슬롯 인덱스를 반환한다 (없으면 -1).
   * @returns {number}
   */
  function findEmptySlot() {
    return itemSlots.indexOf(null);
  }

  /**
   * 슬롯이 모두 차 있는지.
   * @returns {boolean}
   */
  function isFull() {
    return itemSlots.every((s) => s !== null);
  }

  // ── 효과 적용 (내가 받는 입장) ────────────────────────────────

  /**
   * 다크(시야 가림) 효과를 적용한다. duration 후 자동 해제.
   * @param {number} duration ms
   */
  function applyDark(duration) {
    deps.ui.setDarkOverlay(true);
    if (darkTimer) clearTimeout(darkTimer);
    darkTimer = setTimeout(() => {
      deps.ui.setDarkOverlay(false);
      darkTimer = 0;
    }, duration);
  }

  /**
   * 프리즈(조작 차단) 효과를 적용한다. duration 후 자동 해제.
   * 중력은 게임 루프가 계속 처리하므로 별도 처리 없음.
   * @param {number} duration ms
   */
  function applyFreeze(duration) {
    deps.input.setFrozen(true);
    deps.game.setFrozenByItem(true);
    deps.ui.setFreezeFeedback(true);
    if (freezeTimer) clearTimeout(freezeTimer);
    freezeTimer = setTimeout(() => {
      deps.input.setFrozen(false);
      deps.game.setFrozenByItem(false);
      deps.ui.setFreezeFeedback(false);
      freezeTimer = 0;
    }, duration);
  }

  /**
   * 가비지 폭탄을 적용한다 (보드 하단에 즉시 N줄 가비지 추가).
   * Phase 3: 받은 측에서 보드를 짧게 흔들어 시각적 피드백 제공.
   */
  function applyGarbageBomb() {
    deps.game.receiveGarbageImmediate(GARBAGE_BOMB_LINES);
    if (deps.ui && typeof deps.ui.shakeBoard === 'function') {
      deps.ui.shakeBoard();
    }
  }

  // ── 효과 사용 (내가 쓰는 입장) ────────────────────────────────

  /**
   * 라인 클리어 아이템 (방어형): 자신의 하단 2줄을 즉시 제거한다.
   * 서버 전송 없음 (자기 보드 영향만).
   */
  function applyLocalLineClear() {
    deps.game.clearBottomLines(LINE_CLEAR_LINES);
  }

  /**
   * 방어막 발동 (자신에게 shieldActive 플래그 ON).
   * 시각 피드백 1초 (Phase 3: 보드 상단 "방어막 발동!" 알림 동시 표시).
   */
  function triggerShield() {
    shieldActive = true;
    deps.ui.flashShield(true, '방어막 발동!');
    if (shieldFeedbackTimer) clearTimeout(shieldFeedbackTimer);
    shieldFeedbackTimer = setTimeout(() => {
      deps.ui.flashShield(false);
      shieldFeedbackTimer = 0;
    }, 1000);
  }

  /**
   * 공격을 받기 직전 방어막 검사 + 차단 시 차감.
   * (서버가 권위적으로 처리하므로 클라는 SHIELD_BLOCK 수신 시 UI만 갱신함.)
   * @param {string} itemId 공격 아이템 ID
   * @returns {boolean} 차단됐으면 true
   */
  function tryBlockWithShield(itemId) {
    if (!shieldActive) return false;
    // 클라이언트 측 보조 차단 (서버 권위와 별개로 즉시 UI 표시 가능)
    shieldActive = false;
    deps.ui.flashShield(true, '방어막 차단!');
    if (shieldFeedbackTimer) clearTimeout(shieldFeedbackTimer);
    shieldFeedbackTimer = setTimeout(() => {
      deps.ui.flashShield(false);
      shieldFeedbackTimer = 0;
    }, 1000);
    console.log(`[items] 방어막 차단: ${itemId}`);
    return true;
  }

  // ── 공개 API ──────────────────────────────────────────────────

  /**
   * 슬롯 사용 (Z/X/C 또는 클릭).
   * 프리즈는 블록 조작만 차단하므로 키보드와 슬롯 클릭 모두 아이템 사용을 허용한다.
   * @param {number} slotIndex 0~2
   */
  function useItem(slotIndex) {
    if (slotIndex < 0 || slotIndex >= SLOT_COUNT) return;
    const itemId = itemSlots[slotIndex];
    if (!itemId) return;
    const def = ITEMS[itemId];
    if (!def) return;

    if (def.type === 'attack') {
      // 공격형: 서버 경유로 상대에게 전달 (방어막 처리는 서버가 권위)
    } else {
      // 방어형: 로컬 즉시 적용
      if (itemId === 'line_clear') {
        applyLocalLineClear();
      } else if (itemId === 'shield') {
        triggerShield();
      }
    }

    // 슬롯 사용을 항상 서버에 통보 — 서버 slotCount 차감 동기화.
    // 공격형은 상대에게 ITEM_EFFECT 중계, 방어형(shield/line_clear)은 slotCount만 차감.
    // line_clear가 sendItemUse를 생략하던 버그: slotCount가 차감되지 않아
    // MAX_ITEM_SLOTS 도달 후 아이템이 더 이상 지급되지 않는 문제를 유발했음.
    deps.net.sendItemUse(itemId, slotIndex);

    // 슬롯 비우기
    itemSlots[slotIndex] = null;
    refreshSlots();
  }

  /**
   * 서버에서 ITEM_GRANT 수신 시 슬롯에 채운다.
   * @param {string} itemId
   * @param {number} slotIndex
   */
  function grantItem(itemId, slotIndex) {
    if (!ITEMS[itemId]) {
      console.warn('[items] 알 수 없는 아이템 ID:', itemId);
      return;
    }
    let target = slotIndex;
    // 서버가 명시한 슬롯이 이미 차 있으면 첫 빈 슬롯에 채움 (보호)
    if (target < 0 || target >= SLOT_COUNT || itemSlots[target] !== null) {
      target = findEmptySlot();
    }
    if (target < 0) {
      console.warn('[items] 슬롯이 가득 차서 지급 무시:', itemId);
      return;
    }
    itemSlots[target] = itemId;
    refreshSlots();
  }

  /**
   * 상대로부터 ITEM_EFFECT 수신 시 효과를 적용한다.
   * 서버에서 방어막 처리를 마쳤다고 가정 (SHIELD_BLOCK 수신 시 여기는 호출 안 됨).
   * @param {string} itemId
   * @param {number} duration ms (0이면 즉시)
   */
  function applyEffect(itemId, duration) {
    const def = ITEMS[itemId];
    if (!def) {
      console.warn('[items] 알 수 없는 효과:', itemId);
      return;
    }
    switch (itemId) {
      case 'garbage_bomb':
        applyGarbageBomb();
        break;
      case 'dark':
        applyDark(duration || def.duration);
        break;
      case 'freeze':
        applyFreeze(duration || def.duration);
        break;
      default:
        // line_clear / shield는 자기 자신에게만 적용되므로 ITEM_EFFECT로 도착할 일이 없음
        console.warn('[items] applyEffect 미처리 itemId:', itemId);
    }
  }

  /**
   * 서버에서 SHIELD_BLOCK 수신 (내가 보낸 공격이 상대 방어막에 차단됨).
   * 단순 알림 (송신자 시각 피드백).
   * @param {string} itemId
   */
  function onShieldBlocked(itemId) {
    console.log(`[items] 내 ${itemId} 공격이 상대 방어막에 차단됨`);
    deps.ui.setStatus(`상대 방어막에 차단됨 (${ITEMS[itemId]?.name || itemId})`);
  }

  /**
   * 게임 시작/재대결 시 슬롯/효과/플래그 초기화.
   */
  function reset() {
    for (let i = 0; i < SLOT_COUNT; i++) itemSlots[i] = null;
    shieldActive = false;
    if (darkTimer) { clearTimeout(darkTimer); darkTimer = 0; }
    if (freezeTimer) { clearTimeout(freezeTimer); freezeTimer = 0; }
    if (shieldFeedbackTimer) { clearTimeout(shieldFeedbackTimer); shieldFeedbackTimer = 0; }
    // 라운드 종료가 프리즈 타이머보다 먼저 와도 다음 재대결에 잠금이 남지 않게 한다.
    deps.input.setFrozen(false);
    deps.game.setFrozenByItem(false);
    deps.ui.setDarkOverlay(false);
    deps.ui.setFreezeFeedback(false);
    deps.ui.flashShield(false);
    refreshSlots();
  }

  // 슬롯 클릭으로도 아이템 사용 가능 (deps.ui가 click 핸들러 호출 시)
  return {
    useItem,
    grantItem,
    applyEffect,
    onShieldBlocked,
    triggerShield,
    tryBlockWithShield,
    reset,
    /** 외부에서 슬롯 상태 조회 (테스트용). */
    getSlots() { return itemSlots.slice(); },
    /** 외부에서 shield 활성 조회 (테스트용). */
    isShieldActive() { return shieldActive; },
    /** 슬롯이 가득 찼는지 (테스트용). */
    isFull,
  };
}
