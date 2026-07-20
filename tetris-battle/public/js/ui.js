/**
 * @fileoverview 렌더링 모듈. Canvas로 게임 보드/NEXT/HOLD를 그리고, DOM으로 HUD를 갱신한다.
 *
 * 캔버스 좌표계: (0,0)이 좌측 상단. 셀 크기는 픽셀 단위 상수.
 */

import { BOARD_HEIGHT, BOARD_WIDTH, VANISH_ZONE, VISIBLE_HEIGHT } from './board.js';
import { COLOR_HEX, PIECES, PIECE_COLORS, PIECE_TYPES } from './tetromino.js';

// ── 렌더링 상수 ──────────────────────────────────────────────────
export const CELL_SIZE = 30;          // 메인 보드 셀 (px)
export const PREVIEW_CELL = 18;       // NEXT/HOLD 미니 셀 (px)
export const MINIMAP_CELL = 12;       // 상대방 미니맵 셀 (px)

/**
 * UI 인스턴스를 생성한다.
 *
 * @param {object} els - DOM 요소 참조
 * @param {HTMLCanvasElement} els.boardCanvas
 * @param {HTMLCanvasElement} els.nextCanvas
 * @param {HTMLCanvasElement} els.holdCanvas
 * @param {HTMLCanvasElement} els.opponentCanvas
 * @param {HTMLElement} els.scoreEl
 * @param {HTMLElement} els.levelEl
 * @param {HTMLElement} els.linesEl
 * @param {HTMLElement} els.comboEl
 * @param {HTMLElement} els.statusEl
 * @param {HTMLElement} els.resultOverlay
 * @param {HTMLElement} els.resultText
 * @returns {object} 렌더 컨트롤러
 */
export function createUI(els) {
  const boardCtx = els.boardCanvas.getContext('2d');
  const nextCtx = els.nextCanvas.getContext('2d');
  const holdCtx = els.holdCanvas.getContext('2d');
  const oppCtx = els.opponentCanvas ? els.opponentCanvas.getContext('2d') : null;

  // Phase 2 DOM 참조 (없을 수도 있는 환경에 대비해 안전하게 조회)
  const itemSlotEls = Array.from(document.querySelectorAll('.item-slot'));
  const boardWrapEl = els.boardCanvas ? els.boardCanvas.parentElement : null;
  const darkOverlayEl = document.getElementById('dark-overlay');
  const freezeBadgeEl = document.getElementById('freeze-badge');
  const shieldBadgeEl = document.getElementById('shield-badge');
  // 토스트 DOM
  const toastEl = document.getElementById('toast');

  // 캔버스 크기 강제 설정 (HTML attribute가 미설정일 경우 대비)
  // Phase 5: 캔버스는 visible 영역(20줄)만 표시. hidden zone(2줄)은 데이터에만 존재하고 렌더링 X.
  els.boardCanvas.width = BOARD_WIDTH * CELL_SIZE;
  els.boardCanvas.height = VISIBLE_HEIGHT * CELL_SIZE;
  els.nextCanvas.width = 4 * PREVIEW_CELL;
  els.nextCanvas.height = 4 * PREVIEW_CELL * 3; // 3개 표시
  els.holdCanvas.width = 4 * PREVIEW_CELL;
  els.holdCanvas.height = 4 * PREVIEW_CELL;
  if (els.opponentCanvas) {
    // 미니맵도 visible 영역(20줄)만 표시
    els.opponentCanvas.width = BOARD_WIDTH * MINIMAP_CELL;
    els.opponentCanvas.height = VISIBLE_HEIGHT * MINIMAP_CELL;
  }

  /**
   * 단일 셀을 그린다 (테두리 포함).
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x       - 픽셀 x
   * @param {number} y       - 픽셀 y
   * @param {number} size    - 셀 크기
   * @param {string} fill    - 배경색
   * @param {number} [alpha=1]
   */
  function drawCell(ctx, x, y, size, fill, alpha = 1) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, size, size);
    // 안쪽 하이라이트 (입체감)
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(x, y, size, 2);
    ctx.fillRect(x, y, 2, size);
    // 테두리
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
    ctx.globalAlpha = 1;
  }

  /**
   * 메인 게임 보드를 렌더링한다 (보드 + 활성 피스 + 고스트).
   *
   * Phase 5 — Vanish Zone 렌더링 규칙:
   * - 데이터 grid는 BOARD_HEIGHT(=22)줄이지만 캔버스에는 visible 영역 20줄만 그린다.
   * - 그리드 좌표 (gridRow, gridCol) → 캔버스 픽셀 좌표: y = (gridRow - VANISH_ZONE) * CELL_SIZE
   * - 결과 y가 음수인 셀(hidden zone)은 캔버스 영역 밖이므로 그리지 않는다.
   *
   * @param {number[][]} grid
   * @param {object|null} piece
   * @param {number|null} ghostY
   */
  function renderBoard(grid, piece, ghostY) {
    const w = els.boardCanvas.width;
    const h = els.boardCanvas.height;
    // 배경
    boardCtx.fillStyle = COLOR_HEX[0];
    boardCtx.fillRect(0, 0, w, h);
    // 그리드 라인 (얇게) — visible 영역만
    boardCtx.strokeStyle = 'rgba(80,80,120,0.2)';
    boardCtx.lineWidth = 1;
    for (let r = 1; r < VISIBLE_HEIGHT; r++) {
      boardCtx.beginPath();
      boardCtx.moveTo(0, r * CELL_SIZE);
      boardCtx.lineTo(w, r * CELL_SIZE);
      boardCtx.stroke();
    }
    for (let c = 1; c < BOARD_WIDTH; c++) {
      boardCtx.beginPath();
      boardCtx.moveTo(c * CELL_SIZE, 0);
      boardCtx.lineTo(c * CELL_SIZE, h);
      boardCtx.stroke();
    }
    // 보드 셀 — hidden zone(grid[0..VANISH_ZONE-1])은 렌더링 X
    for (let r = VANISH_ZONE; r < BOARD_HEIGHT; r++) {
      for (let c = 0; c < BOARD_WIDTH; c++) {
        const v = grid[r][c];
        if (v !== 0) {
          // 캔버스 y는 visible 영역 0부터 시작
          drawCell(boardCtx, c * CELL_SIZE, (r - VANISH_ZONE) * CELL_SIZE, CELL_SIZE, COLOR_HEX[v]);
        }
      }
    }
    // 고스트 피스
    // 알파 0.30: plan 명세 "투명도 30%" 준수, J 피스(#0000f0) 고스트가 배경(#1a1a2e)에 묻히지 않도록 보강 (AD3 MED-2 수정)
    if (piece && ghostY !== null && ghostY > piece.y) {
      const matrix = PIECES[piece.type][piece.rotation];
      const colorIdx = PIECE_COLORS[piece.type];
      for (let r = 0; r < matrix.length; r++) {
        for (let c = 0; c < matrix[r].length; c++) {
          if (matrix[r][c] === 0) continue;
          const gx = (piece.x + c) * CELL_SIZE;
          const gridRow = ghostY + r;
          const gy = (gridRow - VANISH_ZONE) * CELL_SIZE;
          // hidden zone에 걸친 셀은 캔버스 밖이므로 스킵
          if (gy < 0) continue;
          drawCell(boardCtx, gx, gy, CELL_SIZE, COLOR_HEX[colorIdx], 0.30);
        }
      }
    }
    // 활성 피스 — piece.y는 grid 좌표. 캔버스 좌표는 piece.y - VANISH_ZONE으로 보정.
    if (piece) {
      const matrix = PIECES[piece.type][piece.rotation];
      const colorIdx = PIECE_COLORS[piece.type];
      for (let r = 0; r < matrix.length; r++) {
        for (let c = 0; c < matrix[r].length; c++) {
          if (matrix[r][c] === 0) continue;
          const gx = (piece.x + c) * CELL_SIZE;
          const gridRow = piece.y + r;
          const gy = (gridRow - VANISH_ZONE) * CELL_SIZE;
          // hidden zone에 있는 row는 캔버스 밖 → 그리지 않음
          if (gy < 0) continue;
          drawCell(boardCtx, gx, gy, CELL_SIZE, COLOR_HEX[colorIdx]);
        }
      }
    }
    // 테두리
    boardCtx.strokeStyle = '#333366';
    boardCtx.lineWidth = 2;
    boardCtx.strokeRect(0, 0, w, h);
  }

  /**
   * NEXT 영역에 다음 피스 3개를 위에서 아래로 표시한다.
   * @param {string[]} types - 길이 3
   */
  function renderNext(types) {
    nextCtx.fillStyle = '#0a0a0f';
    nextCtx.fillRect(0, 0, els.nextCanvas.width, els.nextCanvas.height);
    types.slice(0, 3).forEach((type, idx) => {
      drawMiniPiece(nextCtx, type, 0, idx * 4 * PREVIEW_CELL, PREVIEW_CELL);
    });
  }

  /**
   * HOLD 영역에 홀드 피스를 표시한다.
   * @param {string|null} type
   */
  function renderHold(type) {
    holdCtx.fillStyle = '#0a0a0f';
    holdCtx.fillRect(0, 0, els.holdCanvas.width, els.holdCanvas.height);
    if (type) {
      drawMiniPiece(holdCtx, type, 0, 0, PREVIEW_CELL);
    }
  }

  /**
   * 미니 캔버스에 피스 한 개를 그린다 (4x4 박스 안에 중앙 정렬).
   * @param {CanvasRenderingContext2D} ctx
   * @param {string} type
   * @param {number} offsetX
   * @param {number} offsetY
   * @param {number} cellSize
   */
  function drawMiniPiece(ctx, type, offsetX, offsetY, cellSize) {
    const matrix = PIECES[type][0];
    const colorIdx = PIECE_COLORS[type];
    // 행렬 내 채워진 영역의 bounding box로 중앙 정렬
    let minR = 99, maxR = -1, minC = 99, maxC = -1;
    for (let r = 0; r < matrix.length; r++) {
      for (let c = 0; c < matrix[r].length; c++) {
        if (matrix[r][c]) {
          if (r < minR) minR = r;
          if (r > maxR) maxR = r;
          if (c < minC) minC = c;
          if (c > maxC) maxC = c;
        }
      }
    }
    const w = (maxC - minC + 1) * cellSize;
    const h = (maxR - minR + 1) * cellSize;
    const startX = offsetX + (4 * cellSize - w) / 2 - minC * cellSize;
    const startY = offsetY + (4 * cellSize - h) / 2 - minR * cellSize;
    for (let r = 0; r < matrix.length; r++) {
      for (let c = 0; c < matrix[r].length; c++) {
        if (matrix[r][c] === 0) continue;
        drawCell(ctx, startX + c * cellSize, startY + r * cellSize, cellSize, COLOR_HEX[colorIdx]);
      }
    }
  }

  /**
   * HUD(점수/레벨/라인/콤보) 갱신.
   * @param {{score:number, level:number, lines:number, combo:number}} hud
   */
  function renderHUD(hud) {
    els.scoreEl.textContent = hud.score.toLocaleString();
    els.levelEl.textContent = hud.level.toString();
    els.linesEl.textContent = hud.lines.toString();
    if (hud.combo >= 1) {
      els.comboEl.textContent = `${hud.combo} COMBO`;
      els.comboEl.classList.add('active');
    } else {
      els.comboEl.textContent = '';
      els.comboEl.classList.remove('active');
    }
  }

  /**
   * 상대방 미니맵 렌더링: 가비지 높이 + 컬럼별 스택 막대 시각화.
   * Phase 5: visible 영역(20줄)만 표시. stack[c]는 board.getColumnHeights에서 이미 visible 기준으로 산출됨.
   *
   * @param {{height: number, stack: number[]}} state
   */
  function renderOpponent(state) {
    if (!oppCtx) return;
    const w = els.opponentCanvas.width;
    const h = els.opponentCanvas.height;
    oppCtx.fillStyle = COLOR_HEX[0];
    oppCtx.fillRect(0, 0, w, h);
    // 그리드 — visible 영역(20줄)만
    oppCtx.strokeStyle = 'rgba(80,80,120,0.2)';
    oppCtx.lineWidth = 1;
    for (let r = 1; r < VISIBLE_HEIGHT; r++) {
      oppCtx.beginPath();
      oppCtx.moveTo(0, r * MINIMAP_CELL);
      oppCtx.lineTo(w, r * MINIMAP_CELL);
      oppCtx.stroke();
    }
    // 컬럼별 스택 막대 (가비지 색상으로 통일하여 간소화)
    // stack[c]는 visible 영역 기준 높이(0~VISIBLE_HEIGHT)
    const stack = state.stack || [];
    for (let c = 0; c < BOARD_WIDTH; c++) {
      // 미니맵 캔버스 한계를 넘지 않도록 클램프 (이론상 stack[c] <= VISIBLE_HEIGHT)
      const colHeight = Math.min(stack[c] || 0, VISIBLE_HEIGHT);
      for (let i = 0; i < colHeight; i++) {
        const y = (VISIBLE_HEIGHT - 1 - i) * MINIMAP_CELL;
        drawCell(oppCtx, c * MINIMAP_CELL, y, MINIMAP_CELL, COLOR_HEX[8]);
      }
    }
    // 테두리
    oppCtx.strokeStyle = '#333366';
    oppCtx.lineWidth = 2;
    oppCtx.strokeRect(0, 0, w, h);
  }

  /**
   * 상태 메시지 표시 (대기/카운트다운 등).
   * @param {string} text
   */
  function setStatus(text) {
    if (els.statusEl) els.statusEl.textContent = text;
  }

  /**
   * 결과 오버레이 표시.
   * @param {string} text
   * @param {string} [cssClass]
   */
  function showResult(text, cssClass = '') {
    els.resultText.textContent = text;
    els.resultOverlay.classList.remove('hidden', 'win', 'lose');
    if (cssClass) els.resultOverlay.classList.add(cssClass);
  }

  /** 결과 오버레이 숨김. */
  function hideResult() {
    els.resultOverlay.classList.add('hidden');
    els.resultOverlay.classList.remove('win', 'lose');
  }

  // ── Phase 2: 아이템 슬롯 / 효과 오버레이 ───────────────────────

  /**
   * 아이템 슬롯 3개를 갱신한다.
   * @param {Array<{id: string, name: string, type: string, icon: string, cssClass: string}|null>} slots
   */
  function renderItemSlots(slots) {
    itemSlotEls.forEach((el, idx) => {
      const item = slots[idx];
      // 키 라벨(Z/X/C)은 항상 표시
      const keyLabel = ['Z', 'X', 'C'][idx] || '';
      el.classList.remove('filled', 'item-garbage', 'item-dark', 'item-freeze', 'item-lineclear', 'item-shield');
      if (item) {
        el.classList.add('filled', item.cssClass);
        el.innerHTML = `<span class="slot-icon">${item.icon}</span><span class="slot-key">${keyLabel}</span>`;
        el.title = `${item.name} (${keyLabel})`;
      } else {
        el.innerHTML = `<span class="slot-key empty">${keyLabel}</span>`;
        el.title = `슬롯 ${idx + 1} (${keyLabel})`;
      }
    });
  }

  /**
   * 슬롯 클릭 핸들러를 등록한다 (한 번만 호출).
   * @param {(slotIndex: number) => void} onClick
   */
  function bindItemSlotClick(onClick) {
    itemSlotEls.forEach((el) => {
      el.addEventListener('click', () => {
        const slot = parseInt(el.dataset.slot, 10);
        if (!Number.isNaN(slot)) onClick(slot);
      });
    });
  }

  /**
   * 다크 오버레이 표시/숨김.
   * @param {boolean} on
   */
  function setDarkOverlay(on) {
    if (!darkOverlayEl) return;
    if (on) darkOverlayEl.classList.add('active');
    else darkOverlayEl.classList.remove('active');
  }

  /**
   * 프리즈 피드백 표시/숨김 (보드 테두리 펄스 + "FROZEN" 배지).
   * @param {boolean} on
   */
  function setFreezeFeedback(on) {
    if (boardWrapEl) {
      if (on) boardWrapEl.classList.add('frozen');
      else boardWrapEl.classList.remove('frozen');
    }
    if (freezeBadgeEl) {
      if (on) freezeBadgeEl.classList.add('active');
      else freezeBadgeEl.classList.remove('active');
    }
  }

  /**
   * 방어막 장착/해제 배지를 보이거나 숨긴다 (차단 전까지 지속 표시).
   * @param {boolean} on
   */
  function setShieldBadge(on) {
    if (!shieldBadgeEl) return;
    if (on) shieldBadgeEl.classList.add('active');
    else shieldBadgeEl.classList.remove('active');
  }

  /**
   * 방어막 발동 시 보드 외곽에 짧은 글로우 효과 (Phase 3: 알림 텍스트 동시 표시).
   * @param {boolean} on
   * @param {string} [message] 표시할 알림 텍스트 (예: "방어막 장착!")
   */
  function flashShield(on, message) {
    if (!boardWrapEl) return;
    if (on) {
      boardWrapEl.classList.add('shield-flash');
      // Phase 3: 보드 상단에 알림 (1초 후 자동 사라짐)
      if (message) {
        showBoardNotice(message, 'shield');
      }
    } else {
      boardWrapEl.classList.remove('shield-flash');
    }
  }

  /**
   * 방어막 차단 성공 시 강화 연출 (장착 글로우보다 강한 펄스 + 알림).
   * @param {string} [message] 표시할 알림 텍스트 (예: "방어막 차단!")
   */
  function flashShieldBlock(message) {
    if (!boardWrapEl) return;
    boardWrapEl.classList.remove('shield-block-flash');
    void boardWrapEl.offsetWidth; // reflow로 애니메이션 재시작
    boardWrapEl.classList.add('shield-block-flash');
    if (message) showBoardNotice(message, 'shield', 1500);
    const onEnd = () => {
      boardWrapEl.classList.remove('shield-block-flash');
      boardWrapEl.removeEventListener('animationend', onEnd);
    };
    boardWrapEl.addEventListener('animationend', onEnd);
  }

  // ── Phase 3: 보드 상단 알림 텍스트 ─────────────────────────────

  /** @type {number} 알림 자동 숨김 타이머 핸들 */
  let boardNoticeTimer = 0;

  /**
   * 보드 상단에 짧은 알림 텍스트를 표시한다 (방어막/가비지 폭탄 등).
   * 동일 영역에 freeze-badge가 있을 수 있으므로 z-index를 65로 두어 위로 띄움.
   *
   * @param {string} text 표시할 한국어 텍스트
   * @param {string} [kind='shield'] CSS 색상 변형 ('shield' | 'attack')
   * @param {number} [durationMs=1000]
   */
  function showBoardNotice(text, kind = 'shield', durationMs = 1000) {
    if (!boardWrapEl) return;
    // 기존 알림이 있으면 재사용, 없으면 동적 생성 (index.html 수정 없이 안전)
    let noticeEl = boardWrapEl.querySelector('.board-notice');
    if (!noticeEl) {
      noticeEl = document.createElement('div');
      noticeEl.className = 'board-notice';
      boardWrapEl.appendChild(noticeEl);
    }
    noticeEl.classList.remove('shield', 'attack');
    noticeEl.classList.add(kind);
    noticeEl.textContent = text;
    // 애니메이션 재시작: class 제거 → reflow → 추가
    noticeEl.classList.remove('active');
    void noticeEl.offsetWidth;
    noticeEl.classList.add('active');
    if (boardNoticeTimer) clearTimeout(boardNoticeTimer);
    boardNoticeTimer = setTimeout(() => {
      noticeEl.classList.remove('active');
      boardNoticeTimer = 0;
    }, durationMs);
  }

  /**
   * Phase 3: 가비지 폭탄을 받았을 때 보드를 짧게 흔든다 (0.2초).
   * 사용자가 외부 공격을 받았음을 시각적으로 인지.
   */
  function shakeBoard() {
    if (!boardWrapEl) return;
    boardWrapEl.classList.remove('shake');
    // reflow 강제
    void boardWrapEl.offsetWidth;
    boardWrapEl.classList.add('shake');
    // 애니메이션 종료 시 클래스 제거 (animationend 1회만)
    const onEnd = () => {
      boardWrapEl.classList.remove('shake');
      boardWrapEl.removeEventListener('animationend', onEnd);
    };
    boardWrapEl.addEventListener('animationend', onEnd);
  }

  /**
   * Phase 3 LOW-2: 결과 화면 표시 시 아이템 슬롯 클릭을 비활성화한다.
   * pointer-events 토글로 마우스 입력만 차단 (시각은 유지).
   * @param {boolean} interactive true면 클릭 가능, false면 차단
   */
  function setItemSlotsInteractive(interactive) {
    itemSlotEls.forEach((el) => {
      el.style.pointerEvents = interactive ? '' : 'none';
      if (interactive) {
        el.classList.remove('disabled');
      } else {
        el.classList.add('disabled');
      }
    });
  }

  // ── Phase 4 C-2: 친구 접속 안내 패널 + 토스트 ──────────────────

  /** @type {number} 토스트 자동 숨김 타이머 */
  let toastTimer = 0;

  /**
   * 화면 하단에 토스트 메시지를 띄운다.
   * @param {string} text
   * @param {'success'|'error'|''} [kind='']
   * @param {number} [durationMs=1800]
   */
  function showToast(text, kind = '', durationMs = 1800) {
    if (!toastEl) return;
    toastEl.textContent = text;
    toastEl.classList.remove('success', 'error');
    if (kind) toastEl.classList.add(kind);
    toastEl.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.remove('show');
      toastTimer = 0;
    }, durationMs);
  }

  return {
    renderBoard,
    renderNext,
    renderHold,
    renderHUD,
    renderOpponent,
    setStatus,
    showResult,
    hideResult,
    // Phase 2
    renderItemSlots,
    bindItemSlotClick,
    setDarkOverlay,
    setFreezeFeedback,
    flashShield,
    // 방어막 배지 + 차단 연출
    setShieldBadge,
    flashShieldBlock,
    // Phase 3
    showBoardNotice,
    shakeBoard,
    setItemSlotsInteractive,
    showToast,
  };
}
