/**
 * @fileoverview 키 입력 처리 모듈. DAS(167ms) + ARR(33ms) 자동 반복 처리.
 *
 * 키 매핑:
 *  - ArrowLeft / ArrowRight: 수평 이동 (DAS/ARR 적용)
 *  - ArrowDown: 소프트 드롭 (홀드 시 빠른 낙하)
 *  - ArrowUp / X: 시계방향 회전
 *  - Z (Phase 2 대비) / Ctrl: 반시계방향 회전
 *  - Space: 하드 드롭
 *  - Shift / C: 홀드
 *  - Z, X, C: 아이템 사용 슬롯 (프리즈 중에도 사용 가능)
 */

// ── DAS/ARR 상수 (스펙 그대로) ───────────────────────────────────
export const DAS_MS = 167;
export const ARR_MS = 33;

/**
 * 입력 핸들러 인스턴스를 생성한다.
 *
 * @param {object} actions - 게임 액션 콜백 모음
 * @param {() => void} actions.moveLeft
 * @param {() => void} actions.moveRight
 * @param {() => void} actions.softDrop
 * @param {() => void} actions.rotateCW
 * @param {() => void} actions.rotateCCW
 * @param {() => void} actions.hardDrop
 * @param {() => void} actions.hold
 * @param {(slot: number) => void} [actions.useItem] - 아이템/대상 숫자 입력 (0=1번 키 ... 5=6번 키)
 * @returns {{ enable: () => void, disable: () => void, setFrozen: (v: boolean) => void }}
 */
export function createInput(actions) {
  // ── 내부 상태 ──
  /** @type {Map<string, { dasTimer: number, arrTimer: number, direction: -1 | 1 }>} */
  const heldKeys = new Map(); // 수평 이동 키만 추적
  let softDropHeld = false;
  let frozen = false; // 프리즈 아이템 시 블록 조작만 차단

  // Phase 2 활성화 토글 — Z=슬롯0, X=슬롯1, C=슬롯2로 분리
  // (반시계 회전은 Control 키만 유지, 홀드는 Shift 키만 유지)
  const ITEMS_ENABLED = true;

  /**
   * 수평 이동 키 누름 처리. 즉시 1회 이동 + DAS 타이머 시작.
   * @param {string} key
   * @param {-1 | 1} direction
   */
  function startHorizontalMove(key, direction) {
    if (heldKeys.has(key)) return; // 이미 눌려 있으면 무시 (keydown 반복 방지)
    // 즉시 1회 이동
    if (direction === -1) actions.moveLeft();
    else actions.moveRight();
    // DAS 시작
    const dasTimer = window.setTimeout(() => {
      // DAS 만료 → ARR 간격으로 반복
      const arrTimer = window.setInterval(() => {
        if (frozen) return;
        if (direction === -1) actions.moveLeft();
        else actions.moveRight();
      }, ARR_MS);
      const entry = heldKeys.get(key);
      if (entry) entry.arrTimer = arrTimer;
    }, DAS_MS);
    heldKeys.set(key, { dasTimer, arrTimer: 0, direction });
  }

  /**
   * 수평 이동 키 떼기 처리. DAS/ARR 타이머 모두 정리.
   * @param {string} key
   */
  function stopHorizontalMove(key) {
    const entry = heldKeys.get(key);
    if (!entry) return;
    if (entry.dasTimer) window.clearTimeout(entry.dasTimer);
    if (entry.arrTimer) window.clearInterval(entry.arrTimer);
    heldKeys.delete(key);
  }

  /**
   * 소프트 드롭은 별도 인터벌로 처리 (50ms 간격).
   * 게임 루프에서 직접 폴링하므로 여기서는 플래그만 관리.
   */
  function setSoftDrop(v) {
    softDropHeld = v;
  }

  /**
   * 게임 루프에서 매 프레임 폴링하여 소프트 드롭 적용.
   * @returns {boolean} 현재 소프트 드롭 키가 눌려 있는지
   */
  function isSoftDropHeld() {
    return softDropHeld && !frozen;
  }

  // ── keydown ──
  /**
   * 아이템 단축키에 대응하는 슬롯 번호를 반환한다.
   * @param {string} key 키보드 이벤트 키
   * @returns {number} 슬롯 번호. 아이템 키가 아니면 -1
   */
  function getItemSlot(key) {
    return /^[1-6]$/.test(key) ? Number(key) - 1 : -1;
  }

  /**
   * 키 입력을 아이템과 블록 조작으로 분리해 처리한다.
   * 프리즈 중에도 아이템 키는 허용하되 OS 반복 입력은 소비만 하고 무시한다.
   * @param {KeyboardEvent} e 키보드 이벤트
   */
  function onKeyDown(e) {
    const itemSlot = ITEMS_ENABLED ? getItemSlot(e.key) : -1;
    if (itemSlot >= 0) {
      if (!e.repeat) actions.useItem?.(itemSlot);
      e.preventDefault();
      return;
    }

    if (frozen) {
      e.preventDefault();
      return;
    }
    // 입력 키가 게임 키면 기본 동작(스크롤 등) 차단
    const handled = handleKeyDown(e);
    if (handled) e.preventDefault();
  }

  function handleKeyDown(e) {
    if (e.repeat) {
      // OS 자동 반복은 무시 (DAS/ARR을 직접 처리)
      return ['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', ' ',
              'Spacebar', 'Shift', 'Control', 'z', 'Z', 'x', 'X', 'c', 'C'].includes(e.key);
    }
    switch (e.key) {
      case 'ArrowLeft':
        startHorizontalMove('left', -1);
        return true;
      case 'ArrowRight':
        startHorizontalMove('right', 1);
        return true;
      case 'ArrowDown':
        setSoftDrop(true);
        return true;
      case 'ArrowUp':
        // 시계방향 회전 (X 키는 Phase 2 활성 시 슬롯 1로 분리되므로 ArrowUp 전용)
        actions.rotateCW();
        return true;
      case 'x':
      case 'X':
        // Phase 1: 회전 (X는 회전과 공유)
        // Phase 2 활성화 시 X는 슬롯 1 아이템 사용으로 분리
        actions.rotateCW();
        return true;
      case 'Control':
        actions.rotateCCW();
        return true;
      case ' ':
      case 'Spacebar':
        actions.hardDrop();
        return true;
      case 'Shift':
        actions.hold();
        return true;
      case 'z':
      case 'Z':
        // Phase 1: 반시계 회전
        // Phase 2 활성화 시: 슬롯 0 아이템 사용
        actions.rotateCCW();
        return true;
      case 'c':
      case 'C':
        // Phase 1: 홀드 보조 키
        // Phase 2 활성화 시: 슬롯 2 아이템 사용
        actions.hold();
        return true;
      default:
        return false;
    }
  }

  // ── keyup ──
  function onKeyUp(e) {
    switch (e.key) {
      case 'ArrowLeft':
        stopHorizontalMove('left');
        break;
      case 'ArrowRight':
        stopHorizontalMove('right');
        break;
      case 'ArrowDown':
        setSoftDrop(false);
        break;
    }
  }

  /**
   * 모든 키 상태를 강제 초기화 (게임 일시정지/오버 시 사용).
   */
  function clearAll() {
    for (const key of Array.from(heldKeys.keys())) {
      stopHorizontalMove(key);
    }
    setSoftDrop(false);
  }

  let attached = false;

  return {
    /** 이벤트 리스너 등록. */
    enable() {
      if (attached) return;
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      attached = true;
    },
    /** 이벤트 리스너 제거. */
    disable() {
      clearAll();
      frozen = false;
      if (attached) {
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        attached = false;
      }
    },
    /** 프리즈 효과 토글 (Phase 2 사용). */
    setFrozen(v) {
      frozen = v;
      if (v) clearAll();
    },
    /** 테스트와 라운드 상태 동기화를 위한 프리즈 상태 조회. */
    isFrozen() { return frozen; },
    /** 게임 루프에서 폴링: 소프트 드롭 키가 눌려 있는가? */
    isSoftDropHeld,
  };
}
