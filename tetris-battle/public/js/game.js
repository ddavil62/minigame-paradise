/**
 * @fileoverview 게임 루프 + 상태 머신 + 점수/레벨/콤보 계산.
 *
 * 상태 머신: WAITING → COUNTDOWN → PLAYING → GAME_OVER
 * 게임 루프는 requestAnimationFrame 기반이며, dt(ms)를 누적해 중력/Lock Delay 타이머를 처리한다.
 */

import {
  BOARD_HEIGHT, BOARD_WIDTH,
  createEmptyGrid, isColliding, lockPiece, clearLines, addGarbage,
  isPieceLanded, getGhostY, garbageFromLines, comboBonus, getColumnHeights,
  clearBottomLines as clearBottomLinesFn,
} from './board.js';
import { createBag, createPiece, getRotated, PIECE_COLORS } from './tetromino.js';

// ── 게임 상수 ────────────────────────────────────────────────────
export const GRAVITY_BASE_MS = 1000;        // Lv1 중력 (1줄/sec)
export const GRAVITY_DECREMENT_MS = 100;    // 레벨당 감소
export const GRAVITY_MIN_MS = 100;          // 최소 중력
export const SOFT_DROP_MS = 50;             // 소프트 드롭 간격 (중력의 20배)
export const LOCK_DELAY_MS = 500;           // 바닥 닿은 후 잠금 지연
export const LOCK_RESET_MAX = 15;           // Lock Delay 리셋 최대 횟수
export const LINES_PER_LEVEL = 10;          // 레벨업 라인 수
export const SCORES = {
  1: 100,   // Single
  2: 300,   // Double
  3: 500,   // Triple
  4: 800,   // Tetris
};

// 게임 상태
export const STATE = Object.freeze({
  WAITING: 'WAITING',
  COUNTDOWN: 'COUNTDOWN',
  PLAYING: 'PLAYING',
  GAME_OVER: 'GAME_OVER',
});

/**
 * 게임 인스턴스를 생성한다. 보드/피스/타이머/HUD 상태를 관리한다.
 *
 * @param {object} deps
 * @param {(grid: number[][], piece: object|null, ghostY: number|null) => void} deps.renderBoard
 * @param {(hud: object) => void} deps.renderHUD
 * @param {(nexts: string[]) => void} deps.renderNext
 * @param {(holdType: string|null) => void} deps.renderHold
 * @param {(lines: number, combo: number, clearEventId: number) => void} deps.onAttack - 가비지 전송 콜백
 * @param {() => void} deps.onGameOver
 * @param {(payload: object) => void} [deps.onBoardChange] - 미니맵 동기화용 (선택)
 * @returns {object} 게임 컨트롤러
 */
export function createGame(deps) {
  // ── 게임 상태 ──
  /** @type {number[][]} */
  let grid = createEmptyGrid();
  let bag = createBag();
  /** @type {object|null} 현재 활성 피스 */
  let piece = null;
  /** @type {string|null} 홀드 슬롯 (피스 타입) */
  let holdType = null;
  /** @type {boolean} 이번 피스로 이미 홀드 사용했는지 */
  let holdUsedThisPiece = false;
  let score = 0;
  let level = 1;
  let totalLines = 0;
  let combo = -1;             // -1: 콤보 없음, 0 이상: 콤보 횟수
  let clearEventId = 0;       // 라운드 내 라인 클리어 이벤트 식별자
  let state = STATE.WAITING;
  let isFrozenByItem = false; // Phase 2 프리즈 효과 (중력은 유지)

  // 타이머 누적 (ms)
  let gravityAcc = 0;
  let softDropAcc = 0;
  let lockDelayAcc = 0;
  let isOnGround = false;     // 바닥에 닿은 상태인지

  // 가비지 큐: 상대로부터 받은 가비지를 다음 피스 고정 시 적용
  let pendingGarbage = 0;

  // rAF
  let rafId = 0;
  let lastTime = 0;

  // 외부 입력 폴링 콜백 (input.js의 isSoftDropHeld)
  let softDropHeldFn = () => false;

  // ── 보조 함수 ──

  /**
   * 현재 레벨의 중력 간격 (ms) 반환.
   * @returns {number}
   */
  function currentGravity() {
    return Math.max(GRAVITY_MIN_MS, GRAVITY_BASE_MS - (level - 1) * GRAVITY_DECREMENT_MS);
  }

  /**
   * 새 피스를 큐에서 꺼내 보드 상단에 스폰한다. 스폰 즉시 충돌하면 게임 오버.
   * @returns {boolean} false면 토프아웃 (게임 오버)
   */
  function spawnNext() {
    const type = bag.next();
    piece = createPiece(type);
    holdUsedThisPiece = false;
    gravityAcc = 0;
    lockDelayAcc = 0;
    isOnGround = false;
    // 스폰 위치 충돌 검사 (토프아웃)
    if (isColliding(grid, piece.type, piece.rotation, piece.x, piece.y)) {
      return false;
    }
    return true;
  }

  /**
   * 활성 피스를 좌/우로 이동 시도. 성공 시 true.
   * @param {-1 | 1} dx
   * @returns {boolean}
   */
  function tryMove(dx) {
    if (!piece || state !== STATE.PLAYING) return false;
    if (!isColliding(grid, piece.type, piece.rotation, piece.x + dx, piece.y)) {
      piece.x += dx;
      resetLockDelay();
      return true;
    }
    return false;
  }

  /**
   * 활성 피스를 회전 시도. 충돌 시 단순 거부 (SRS 벽킥 없음).
   * @param {-1 | 1} dir
   */
  function tryRotate(dir) {
    if (!piece || state !== STATE.PLAYING) return;
    const newRot = getRotated(piece, dir);
    if (!isColliding(grid, piece.type, newRot, piece.x, piece.y)) {
      piece.rotation = newRot;
      resetLockDelay();
    }
  }

  /**
   * 활성 피스를 한 줄 아래로 내림. 못 내리면 false (바닥).
   * @returns {boolean}
   */
  function stepDown() {
    if (!piece) return false;
    if (!isColliding(grid, piece.type, piece.rotation, piece.x, piece.y + 1)) {
      piece.y += 1;
      return true;
    }
    return false;
  }

  /**
   * Lock Delay 타이머를 리셋한다 (이동/회전 시). 최대 횟수 제한.
   */
  function resetLockDelay() {
    if (isOnGround && piece && piece.lockResetCount < LOCK_RESET_MAX) {
      piece.lockResetCount += 1;
      lockDelayAcc = 0;
    }
  }

  /**
   * 하드 드롭: 즉시 바닥까지 떨어뜨리고 고정.
   */
  function hardDrop() {
    if (!piece || state !== STATE.PLAYING) return;
    const ghostY = getGhostY(grid, piece);
    const dropDist = ghostY - piece.y;
    score += dropDist * 2; // 하드 드롭 보너스 (라인당 2점)
    piece.y = ghostY;
    lockAndAdvance();
  }

  /**
   * 홀드: 현재 피스를 홀드 슬롯에 저장하고 슬롯의 피스를 새로 스폰한다.
   * 한 피스 당 1회만 가능.
   */
  function hold() {
    if (!piece || state !== STATE.PLAYING) return;
    if (holdUsedThisPiece) return;
    holdUsedThisPiece = true;
    const currentType = piece.type;
    if (holdType === null) {
      // 슬롯 비었음 → 현재 저장 + 다음 피스 스폰
      holdType = currentType;
      if (!spawnNext()) {
        triggerGameOver();
        return;
      }
    } else {
      // 교환
      const swapType = holdType;
      holdType = currentType;
      piece = createPiece(swapType);
      gravityAcc = 0;
      lockDelayAcc = 0;
      isOnGround = false;
      // 교환 직후 충돌이면 게임 오버
      if (isColliding(grid, piece.type, piece.rotation, piece.x, piece.y)) {
        triggerGameOver();
        return;
      }
    }
    deps.renderHold(holdType);
  }

  /**
   * 피스를 보드에 고정하고, 라인 클리어 + 가비지 전송 + 다음 피스 스폰 처리.
   */
  function lockAndAdvance() {
    if (!piece) return;
    lockPiece(grid, piece);

    // 라인 클리어
    const cleared = clearLines(grid);
    if (cleared > 0) {
      // 점수 + 레벨 + 콤보 갱신
      const baseScore = SCORES[cleared] || 0;
      score += baseScore * level;
      totalLines += cleared;
      level = 1 + Math.floor(totalLines / LINES_PER_LEVEL);
      combo += 1;
      // 가비지 전송 (변환표 + 콤보 보너스).
      // 가비지가 0이어도 서버가 콤보 아이템 조건을 판정할 수 있도록 전송한다.
      const garbage = garbageFromLines(cleared) + comboBonus(combo);
      clearEventId += 1;
      deps.onAttack(garbage, combo, clearEventId);
    } else {
      // 콤보 리셋
      combo = -1;
    }

    // 받은 가비지 적용 (라인 클리어 후 잔여분 — 한게임 스타일 단순화)
    if (pendingGarbage > 0) {
      addGarbage(grid, pendingGarbage);
      pendingGarbage = 0;
    }

    // 다음 피스
    if (!spawnNext()) {
      triggerGameOver();
      return;
    }

    // 미니맵 동기화
    if (deps.onBoardChange) {
      const stack = getColumnHeights(grid);
      const height = Math.max(...stack);
      deps.onBoardChange({ height, stack, cells: grid.map((row) => row.slice()) });
    }
  }

  /**
   * 게임 오버 트리거.
   */
  function triggerGameOver() {
    state = STATE.GAME_OVER;
    piece = null;
    // BOARD_STATE와 GAME_OVER를 같은 소켓에서 이 순서로 보내 최종 가비지/토프아웃
    // 보드가 상대 화면에 먼저 반영되도록 한다.
    if (deps.onBoardChange) {
      const stack = getColumnHeights(grid);
      deps.onBoardChange({
        height: Math.max(...stack),
        stack,
        cells: grid.map((row) => row.slice()),
        final: true,
      });
    }
    deps.onGameOver();
  }

  // ── 게임 루프 ──
  function loop(now) {
    if (state !== STATE.PLAYING) {
      rafId = 0;
      return;
    }
    const dt = lastTime === 0 ? 0 : now - lastTime;
    lastTime = now;

    // 1. 중력 누적
    if (piece) {
      gravityAcc += dt;
      const gravityMs = currentGravity();
      while (gravityAcc >= gravityMs) {
        gravityAcc -= gravityMs;
        if (!stepDown()) break;
      }
      // 2. 소프트 드롭 (입력 폴링)
      if (softDropHeldFn()) {
        softDropAcc += dt;
        while (softDropAcc >= SOFT_DROP_MS) {
          softDropAcc -= SOFT_DROP_MS;
          if (stepDown()) score += 1; // 소프트 드롭 보너스
          else break;
        }
      } else {
        softDropAcc = 0;
      }

      // 3. Lock Delay 처리
      const landed = isPieceLanded(grid, piece);
      if (landed) {
        if (!isOnGround) {
          isOnGround = true;
          lockDelayAcc = 0;
        } else {
          lockDelayAcc += dt;
          if (lockDelayAcc >= LOCK_DELAY_MS || piece.lockResetCount >= LOCK_RESET_MAX) {
            lockAndAdvance();
          }
        }
      } else {
        isOnGround = false;
        lockDelayAcc = 0;
      }
    }

    // 4. 렌더링
    const ghostY = piece ? getGhostY(grid, piece) : null;
    deps.renderBoard(grid, piece, ghostY);
    deps.renderHUD({ score, level, lines: totalLines, combo });
    deps.renderNext(bag.peek(3));

    rafId = requestAnimationFrame(loop);
  }

  // ── 외부 API ──
  return {
    /** 현재 상태를 반환. */
    getState() { return state; },

    /** 입력 모듈의 소프트 드롭 폴링 함수 등록. */
    bindSoftDropPoll(fn) { softDropHeldFn = fn; },

    /** 게임 시작. 보드를 리셋하고 첫 피스 스폰 후 루프 시작. */
    start() {
      grid = createEmptyGrid();
      bag = createBag();
      holdType = null;
      holdUsedThisPiece = false;
      score = 0;
      level = 1;
      totalLines = 0;
      combo = -1;
      clearEventId = 0;
      pendingGarbage = 0;
      gravityAcc = 0;
      lockDelayAcc = 0;
      isOnGround = false;
      isFrozenByItem = false;

      if (!spawnNext()) {
        triggerGameOver();
        return;
      }
      state = STATE.PLAYING;
      deps.renderHold(holdType);
      lastTime = 0;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(loop);
    },

    /** 게임 강제 중단 (상대 disconnect 등). */
    stop() {
      state = STATE.GAME_OVER;
      piece = null;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
    },

    // 입력 액션
    moveLeft() { tryMove(-1); },
    moveRight() { tryMove(1); },
    softDrop() { /* 폴링 방식이므로 no-op (호환용) */ },
    rotateCW() { tryRotate(1); },
    rotateCCW() { tryRotate(-1); },
    hardDrop,
    hold,

    // 네트워크 이벤트 → 게임 상태 반영
    /** 상대로부터 가비지 수신. 다음 lock 시점에 적용. */
    receiveGarbage(lines) {
      if (state !== STATE.PLAYING) return;
      pendingGarbage += lines;
    },

    /**
     * Phase 2 가비지 폭탄: lock 시점까지 기다리지 않고 즉시 가비지를 추가한다.
     * 활성 피스가 새 가비지와 겹치면 위로 한 칸 밀어올린다 (간단한 보정).
     * 겹친 채 보드 밖으로 밀려나면 토프아웃.
     * @param {number} lines
     */
    receiveGarbageImmediate(lines) {
      if (state !== STATE.PLAYING) return;
      if (lines <= 0) return;
      addGarbage(grid, lines);
      // 활성 피스 보정: 가비지로 위로 밀린 효과를 보전하기 위해 위로 이동
      if (piece) {
        for (let shift = 0; shift < lines; shift++) {
          if (isColliding(grid, piece.type, piece.rotation, piece.x, piece.y)) {
            piece.y -= 1;
          } else {
            break;
          }
        }
        // 보드 밖으로 완전히 밀려나면 토프아웃
        if (isColliding(grid, piece.type, piece.rotation, piece.x, piece.y)) {
          triggerGameOver();
          return;
        }
      }
      // 미니맵 동기화
      if (deps.onBoardChange) {
        const stack = getColumnHeights(grid);
        const height = Math.max(...stack);
        deps.onBoardChange({ height, stack, cells: grid.map((row) => row.slice()) });
      }
    },

    /**
     * Phase 2 라인 클리어 아이템 (자기 보드 하단 N줄 제거).
     * 활성 피스가 떠 있는 상태에서 호출되어도 위치 보정 없이 안전하게 처리한다.
     * @param {number} lines
     */
    clearBottomLines(lines) {
      if (state !== STATE.PLAYING) return;
      clearBottomLinesFn(grid, lines);
      if (deps.onBoardChange) {
        const stack = getColumnHeights(grid);
        const height = stack.length ? Math.max(...stack) : 0;
        deps.onBoardChange({ height, stack, cells: grid.map((row) => row.slice()) });
      }
    },

    /** Phase 2: 아이템 효과 적용 (프리즈). */
    setFrozenByItem(v) { isFrozenByItem = v; },

    /** 현재 보드 상태 스냅샷 (디버그/테스트용). */
    snapshot() {
      return {
        grid: grid.map((row) => row.slice()),
        piece: piece ? { ...piece } : null,
        score, level, totalLines, combo, state, holdType,
      };
    },
  };
}
