/**
 * @fileoverview 캔버스 렌더링 + DOM UI 갱신. 보드/말/윷가락/HUD를 그린다.
 */

import {
  BOARD_SIZE, CELL_RADIUS, CELL_RADIUS_BIG,
  allCells, cellToCoord, homeCoord, goalCoord,
} from './board.js';
import { drawYutSticks, YUT_NAMES_KO, YUT_CSS_CLASS } from './yut.js';

/** 플레이어 색상 (P1=단청 빨강, P2=전통 청색). 한지/원목 팔레트와 동기화. */
const PLAYER_COLOR = {
  p1: '#c0392b',   // --p1
  p2: '#1a6fad',   // --p2
};
const PLAYER_COLOR_DIM = {
  p1: 'rgba(192, 57, 43, 0.55)',   // --p1-light 유사
  p2: 'rgba(26, 111, 173, 0.55)',  // --p2-light 유사
};

/**
 * UI 컨트롤러 생성.
 *
 * @param {object} els
 */
export function createUI(els) {
  const boardCtx = els.boardCanvas.getContext('2d');
  const yutCtx = els.yutCanvas.getContext('2d');

  // 캔버스 크기
  // 보드 캔버스는 BOARD_SIZE(560) 좌표계로 그리되, 실제 표시 크기는
  // 좌측 board-area 가용 정사각형에 맞춰 키운다(resizeBoard). 내부 픽셀
  // 해상도는 표시 px × devicePixelRatio로 잡고 ctx를 스케일해, 보드를
  // 크게 채워도 선명하게 렌더한다. board.js 칸 좌표/렌더 로직은 무변경 —
  // 그리기 좌표계는 항상 BOARD_SIZE 기준이다.
  els.boardCanvas.width = BOARD_SIZE;
  els.boardCanvas.height = BOARD_SIZE;
  // 윷가락 캔버스: 세로형(120×130) — 가늘고 긴 실물 윷가락 비율(H:W≈5:1) 렌더용.
  // (이전 가로형 220×80에서 변경, 2026-06-18 윷가락 재설계)
  els.yutCanvas.width = 120;
  els.yutCanvas.height = 130;

  /**
   * board-area의 가용 공간을 측정해 보드 캔버스를 정사각형으로 키운다.
   * - 표시 크기(CSS px): 가용 폭/높이 중 작은 값.
   * - 내부 해상도: 표시 px × DPR (선명도). renderBoard가 ctx를
   *   BOARD_SIZE → 표시 px로 스케일하므로 그리기 좌표는 무변경.
   */
  function resizeBoard() {
    const area = els.boardCanvas.parentElement;
    if (!area) return;
    const rect = area.getBoundingClientRect();
    // board-area의 padding/gap을 고려해 약간 여유를 둔다.
    const avail = Math.max(120, Math.min(rect.width, rect.height));
    const dpr = window.devicePixelRatio || 1;
    const internal = Math.round(avail * dpr);
    // 표시 크기 (정사각형)
    els.boardCanvas.style.width = `${avail}px`;
    els.boardCanvas.style.height = `${avail}px`;
    // 내부 해상도 변경 시에만 재설정 (불필요한 재할당 방지)
    if (els.boardCanvas.width !== internal || els.boardCanvas.height !== internal) {
      els.boardCanvas.width = internal;
      els.boardCanvas.height = internal;
    }
    renderBoard();
  }

  // 창 크기 변경 시 보드 재산정 (디바운스 없이 가벼움 — 턴제 게임).
  window.addEventListener('resize', resizeBoard);

  /** @type {{ cell:number, x:number, y:number, big:boolean }[]} */
  const cells = allCells();

  /** 현재 가능 칸 하이라이트 (이동 미리보기). */
  let highlightCell = null;
  /** 선택된 결과명 (do/gae/...) - 사용자가 클릭한 결과. */
  let selectedResult = null;
  /** 선택된 내 piece 인덱스 (말 클릭 시). */
  let selectedPieceIdx = -1;
  /** 가장 최근 게임 STATE 캐시 (renderBoard에서 사용). */
  let lastState = null;
  /** 내 player id. */
  let myId = null;

  function setMyId(id) { myId = id; }

  /**
   * 보드 + 말 + 강조 등을 모두 다시 그린다.
   *
   * @param {object} state  STATE 메시지
   */
  function renderBoard(state) {
    if (state) lastState = state;
    const ctx = boardCtx;

    // 내부 픽셀 해상도 → BOARD_SIZE(560) 좌표계로 스케일.
    // 이후 모든 그리기는 0~BOARD_SIZE 좌표를 사용한다(board.js 좌표 무변경).
    const scale = els.boardCanvas.width / BOARD_SIZE;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);

    // ── 1. 보드 배경 베이스 (원목 크림) ──
    ctx.fillStyle = '#e8d5a8';
    ctx.fillRect(0, 0, BOARD_SIZE, BOARD_SIZE);

    // ── 2. 나뭇결 레이어1 — 미세 결 (간격 18px) ──
    ctx.save();
    for (let y = 0; y < BOARD_SIZE; y += 18) {
      const alpha = 0.02 + Math.random() * 0.02;  // 0.02~0.04
      ctx.strokeStyle = `rgba(100, 60, 10, ${alpha})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      // bezierCurveTo 수평 물결선 (±4px 진폭)
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(
        BOARD_SIZE * 0.33, y + 3 + Math.random() * 4,
        BOARD_SIZE * 0.66, y - 3 - Math.random() * 4,
        BOARD_SIZE, y + Math.random() * 3,
      );
      ctx.stroke();
    }

    // ── 3. 나뭇결 레이어2 — 굵은 결 (간격 54px) ──
    for (let y = 0; y < BOARD_SIZE; y += 54) {
      const alpha = 0.04 + Math.random() * 0.02;  // 0.04~0.06
      ctx.strokeStyle = `rgba(80, 45, 8, ${alpha})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(
        BOARD_SIZE * 0.33, y + 6 + Math.random() * 6,
        BOARD_SIZE * 0.66, y - 6 - Math.random() * 6,
        BOARD_SIZE, y + Math.random() * 5,
      );
      ctx.stroke();
    }
    ctx.restore();

    // ── 4. 비네팅 (인셋 섀도 효과) ──
    const vig = ctx.createRadialGradient(
      BOARD_SIZE / 2, BOARD_SIZE / 2, BOARD_SIZE * 0.3,
      BOARD_SIZE / 2, BOARD_SIZE / 2, BOARD_SIZE * 0.75,
    );
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.12)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, BOARD_SIZE, BOARD_SIZE);

    // 외곽 사각형 + 지름길 라인
    drawConnections(ctx);
    drawCells(ctx);

    // 시작점/완주 라벨
    drawHomeGoalLabels(ctx);

    // 말 (모든 플레이어)
    if (lastState && Array.isArray(lastState.players)) {
      for (const player of lastState.players) {
        drawPlayerPieces(ctx, player);
      }
    }

    // 강조 칸 (이동 미리보기) — accent 점선 링
    if (highlightCell !== null) {
      const c = cellToCoord(highlightCell);
      if (c) {
        ctx.strokeStyle = '#d4812a';  // --accent
        ctx.lineWidth = 3;
        ctx.setLineDash([6, 3]);
        ctx.beginPath();
        ctx.arc(c.x, c.y, CELL_RADIUS_BIG + 4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  /**
   * 외곽 사각형 + 두 대각 지름길 라인 그리기.
   */
  function drawConnections(ctx) {
    // ── 외곽 사각형 (--ink #2e1f0e, 3px solid) ──
    ctx.strokeStyle = '#2e1f0e';   // --ink
    ctx.lineWidth = 3;
    ctx.setLineDash([]);
    // 외곽 사각형 (0~19 연결 + 19→0)
    ctx.beginPath();
    for (let i = 0; i <= 19; i++) {
      const c = cellToCoord(i);
      if (i === 0) ctx.moveTo(c.x, c.y);
      else ctx.lineTo(c.x, c.y);
    }
    ctx.closePath();
    ctx.stroke();

    // ── 지름길A 본선: 5 → 21 → 22 → 23 → 15 (--ink, 2.5px solid) ──
    ctx.strokeStyle = '#2e1f0e';   // --ink
    ctx.lineWidth = 2.5;
    ctx.setLineDash([]);
    ctx.beginPath();
    drawShortcutLine(ctx, [5, 21, 22, 23, 15]);
    ctx.stroke();

    // ── 지름길B 본선: 10 → 26 → 27 → 23 (--ink, 2.5px solid) ──
    ctx.beginPath();
    drawShortcutLine(ctx, [10, 26, 27, 23]);
    ctx.stroke();
    ctx.setLineDash([]);

    // ── centerExitB 경로선: 중앙(23) → 24 → 25 → 좌하(0) (점선, --plank-light, 2px) ──
    // 지름길B 본선과 동일한 대각이지만 24/25 칸 노드를 명시적으로 경유한다.
    ctx.strokeStyle = '#c8924a';   // --plank-light
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    drawShortcutLine(ctx, [23, 24, 25, 0]);
    ctx.stroke();

    // ── centerExitA 경로선: 중앙(23) → 28 → 29 → 우하(15) (점선, --plank-light, 2px) ──
    // board.js에 이미 존재하는 CENTER_EXIT_A 좌표(28/29)를 사용.
    // centerExitB(23→24→25→0)와 동일 스타일로 대칭 렌더(2026-06-16 버그B 경로선 보완).
    ctx.strokeStyle = '#c8924a';   // --plank-light
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    drawShortcutLine(ctx, [23, 28, 29, 15]);
    ctx.stroke();

    ctx.setLineDash([]);  // 반드시 리셋 (이후 실선 그리기 오염 방지)
  }

  function drawShortcutLine(ctx, cellList) {
    for (let i = 0; i < cellList.length; i++) {
      const c = cellToCoord(cellList[i]);
      if (!c) continue;
      if (i === 0) ctx.moveTo(c.x, c.y);
      else ctx.lineTo(c.x, c.y);
    }
  }

  /**
   * 모든 칸 그리기.
   */
  function drawCells(ctx) {
    for (const c of cells) {
      const r = c.big ? CELL_RADIUS_BIG : CELL_RADIUS;

      // radialGradient: 중심 밝음 → 외곽 어두움 (셀 유형별 구분)
      let grad;
      if (c.cell === 23) {
        // 중앙 방: 황금빛 그라디언트
        grad = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, r);
        grad.addColorStop(0, '#fff9d8');
        grad.addColorStop(1, '#d4b040');
      } else if (c.big) {
        // 모서리(0, 5, 10, 15): 크림 그라디언트
        grad = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, r);
        grad.addColorStop(0, '#fffcee');
        grad.addColorStop(1, '#d8c070');
      } else {
        // 일반 칸
        grad = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, r);
        grad.addColorStop(0, '#fff3d8');
        grad.addColorStop(1, '#e8c888');
      }

      ctx.fillStyle = grad;
      ctx.strokeStyle = '#2e1f0e';  // --ink
      ctx.lineWidth = c.big ? 2.5 : 1.5;
      ctx.beginPath();
      ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // 중앙 방(23) 점선 강조 링
      if (c.cell === 23) {
        ctx.strokeStyle = '#d4812a';  // --accent
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.arc(c.x, c.y, CELL_RADIUS_BIG + 7, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // 모서리/중앙 라벨 (start, 중앙 등) — --plank-edge 색
      if (c.cell === 0) {
        drawCellLabel(ctx, c.x, c.y, '시작', '#6b4220');   // --plank-edge
      } else if (c.cell === 5) {
        drawCellLabel(ctx, c.x, c.y, '좌상', '#6b4220');
      } else if (c.cell === 10) {
        drawCellLabel(ctx, c.x, c.y, '우상', '#6b4220');
      } else if (c.cell === 15) {
        drawCellLabel(ctx, c.x, c.y, '우하', '#6b4220');
      } else if (c.cell === 23) {
        drawCellLabel(ctx, c.x, c.y, '방', '#6b4220');
      }
    }
  }

  function drawCellLabel(ctx, x, y, text, color) {
    ctx.fillStyle = color;
    ctx.font = 'bold 11px "Gowun Dodum", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
  }

  function drawHomeGoalLabels(ctx) {
    const home = homeCoord();
    const goal = goalCoord();
    ctx.fillStyle = '#8a6e48';   // --ink-dim
    ctx.font = '10px "Gowun Dodum", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('출발=시작점', home.x, home.y - 12);
    ctx.fillText('완주=시작점 통과', goal.x, goal.y);
  }

  /**
   * 한 플레이어의 모든 말 그리기.
   */
  function drawPlayerPieces(ctx, player) {
    // 같은 cell에 여러 piece가 있으면 그루핑 (업힘 시각화).
    // cell -> [pieceIdx, ...]
    const groups = new Map();
    player.pieces.forEach((p, idx) => {
      if (p.done) return;
      if (p.cell === -1) {
        // HOME: 보드 외부에 표시
        const key = `home_${player.id}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(idx);
        return;
      }
      const key = `c_${p.cell}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(idx);
    });

    const color = PLAYER_COLOR[player.id] || '#888';
    const colorDim = PLAYER_COLOR_DIM[player.id] || 'rgba(120,120,120,0.5)';

    for (const [key, indices] of groups) {
      let cx, cy;
      if (key.startsWith('home_')) {
        // HOME 영역: 양 팀 모두 같은 출발점(좌하) 근처에 배치. 정통 윷놀이는
        // 두 팀이 같은 출발점에서 시작하며, 시각적 구분은 piece 색상으로 한다.
        // P1은 출발선 바로 위, P2는 그 옆 가로 라인에 배치(겹침 방지).
        const home = homeCoord();
        const baseX = home.x;
        const baseY = player.id === 'p1' ? home.y - 30 : home.y - 12;
        cx = baseX;
        cy = baseY;
        indices.forEach((idx, k) => {
          drawPiece(ctx, baseX + k * 16, baseY, 10, color, colorDim, '');
        });
        continue;
      }
      // 일반 칸: 같은 칸에 모인 piece 묶음을 하나로 표시 + 숫자
      const cellNum = parseInt(key.slice(2), 10);
      const c = cellToCoord(cellNum);
      if (!c) continue;
      const r = c.big ? 16 : 13;
      // 업힘 카운트 = indices.length (같은 cell의 자기 말 수)
      const totalStack = indices.length;
      drawPiece(ctx, c.x - (player.id === 'p1' ? 6 : -6), c.y - 4, r, color, colorDim,
        totalStack > 1 ? String(totalStack) : '');
    }

    // 완주한 말은 우측 상단 트로피 영역에 작게
    const doneCount = player.pieces.filter((p) => p.done).length;
    if (doneCount > 0) {
      const goal = goalCoord();
      const baseX = player.id === 'p1' ? goal.x + 60 : BOARD_SIZE - goal.x - 60 - doneCount * 14;
      const baseY = goal.y + 4;
      for (let i = 0; i < doneCount; i++) {
        drawPiece(ctx, baseX + i * 14, baseY, 8, color, colorDim, '');
      }
    }
  }

  /**
   * 말 하나 그리기.
   */
  function drawPiece(ctx, x, y, r, color, colorDim, label) {
    // 3D 구체감 radialGradient (상단 밝음 → 하단 어두움)
    const grad = ctx.createRadialGradient(
      x - r * 0.28, y - r * 0.28, r * 0.05,  // 하이라이트 중심 (좌상)
      x, y, r,
    );
    grad.addColorStop(0, lightenColor(color, 0.35));  // 상단 하이라이트
    grad.addColorStop(0.6, color);                    // 중간
    grad.addColorStop(1, darkenColor(color, 0.3));    // 하단 어둠
    ctx.fillStyle = grad;

    // 그림자 (구체가 보드 위에 떠 있는 느낌)
    ctx.save();
    ctx.shadowBlur = 6;
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 외곽선
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();

    // 하이라이트 반점 (상단 좌)
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.beginPath();
    ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.36, 0, Math.PI * 2);
    ctx.fill();

    // 라벨 (업힘 수)
    if (label) {
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.floor(r * 0.95)}px "Gowun Dodum", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x, y);
    }
  }

  /**
   * 색상 밝히기 (HEX → rgba 흰 혼합).
   * @param {string} hex  '#rrggbb'
   * @param {number} amount  0~1
   * @returns {string}
   */
  function lightenColor(hex, amount) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${Math.min(255, Math.round(r + (255 - r) * amount))},${Math.min(255, Math.round(g + (255 - g) * amount))},${Math.min(255, Math.round(b + (255 - b) * amount))},1)`;
  }

  /**
   * 색상 어둡히기 (HEX → rgba 검정 혼합).
   * @param {string} hex  '#rrggbb'
   * @param {number} amount  0~1
   * @returns {string}
   */
  function darkenColor(hex, amount) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${Math.round(r * (1 - amount))},${Math.round(g * (1 - amount))},${Math.round(b * (1 - amount))},1)`;
  }

  /** 윷가락 시각화. */
  function renderYut(sticks) {
    drawYutSticks(yutCtx, sticks, els.yutCanvas.width, els.yutCanvas.height);
  }

  /** 윷 결과 큰 글씨 표시 (1.5초 후 자동 흐림). */
  function showYutResultText(resultName, byMyTurn) {
    if (!els.yutResultEl) return;
    els.yutResultEl.textContent = YUT_NAMES_KO[resultName] || '?';
    els.yutResultEl.className = `yut-result active ${YUT_CSS_CLASS[resultName] || ''}`;
    setTimeout(() => {
      if (els.yutResultEl) els.yutResultEl.classList.remove('active');
    }, 1500);
  }

  /** 상태 메시지. */
  function setStatus(text) {
    if (els.statusEl) els.statusEl.textContent = text;
  }

  /** 턴 라벨. */
  function setTurnLabel(text) {
    if (els.turnLabelEl) els.turnLabelEl.textContent = text;
  }

  /**
   * 결과 큐(pendingResults)를 화면에 표시. 클릭으로 선택 가능.
   * @param {string[]} results
   * @param {boolean} myTurn
   * @param {(result:string)=>void} onSelect
   */
  function renderResultQueue(results, myTurn, onSelect) {
    if (!els.resultQueueEl) return;
    els.resultQueueEl.innerHTML = '';
    if (!results || results.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'queue-empty';
      empty.textContent = '없음';
      els.resultQueueEl.appendChild(empty);
      selectedResult = null;
      return;
    }
    results.forEach((r, idx) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `result-chip ${YUT_CSS_CLASS[r] || ''}`;
      if (selectedResult === r) chip.classList.add('selected');
      chip.textContent = YUT_NAMES_KO[r] || '?';
      chip.disabled = !myTurn;
      chip.addEventListener('click', () => {
        selectedResult = r;
        // 다시 그려 selected 반영
        renderResultQueue(results, myTurn, onSelect);
        onSelect(r);
      });
      els.resultQueueEl.appendChild(chip);
    });
  }

  /** 결과 선택 해제. */
  function clearSelectedResult() {
    selectedResult = null;
  }

  function getSelectedResult() {
    return selectedResult;
  }

  /** 강조 칸 설정. */
  function setHighlightCell(cell) {
    highlightCell = cell;
    renderBoard();
  }

  /** 강조 해제. */
  function clearHighlight() {
    highlightCell = null;
    renderBoard();
  }

  /**
   * 분기 모달 표시/숨김.
   * FIX-2: branchType에 따라 버튼/제목 텍스트를 전환한다.
   *   - 'corner': 모서리(5/10) 분기 — "외곽 계속" / "지름길 진입".
   *   - 'center'(기본): 중앙(23) 분기 — 기존 위/아래 출구 텍스트.
   *
   * @param {boolean} show
   * @param {('center'|'corner')} [branchType='center']
   */
  function showBranchModal(show, branchType = 'center') {
    if (!els.branchModalEl) return;
    if (show) {
      if (branchType === 'corner') {
        if (els.branchTitleEl) {
          els.branchTitleEl.innerHTML = '모서리 도착!<br>외곽으로 계속할까요?';
        }
        if (els.branchTopBtn) els.branchTopBtn.textContent = '↩ 외곽 계속';
        if (els.branchBottomBtn) els.branchBottomBtn.textContent = '↗ 지름길 진입';
      } else {
        // center (기존 텍스트 복원)
        if (els.branchTitleEl) {
          els.branchTitleEl.innerHTML = '중앙(방) 도착!<br>어느 출구로 갈까요?';
        }
        if (els.branchTopBtn) els.branchTopBtn.textContent = '↖ 위쪽 출구 (먼 길)';
        if (els.branchBottomBtn) els.branchBottomBtn.textContent = '↙ 아래쪽 출구 (빠른 길)';
      }
      els.branchModalEl.classList.remove('hidden');
    } else {
      els.branchModalEl.classList.add('hidden');
    }
  }

  /** 결과 오버레이. */
  function showResult(text, cssClass = '') {
    els.resultText.textContent = text;
    els.resultOverlay.classList.remove('hidden', 'win', 'lose');
    if (cssClass) els.resultOverlay.classList.add(cssClass);
  }
  function hideResult() {
    els.resultOverlay.classList.add('hidden');
    els.resultOverlay.classList.remove('win', 'lose');
  }

  /** 내 말/상대 말 패널 갱신 (완주 카운트만 표시). */
  function renderPieceStatus(state, myId) {
    if (!state || !Array.isArray(state.players)) return;
    const me = state.players.find((p) => p.id === myId);
    const opp = state.players.find((p) => p.id !== myId);
    const myDone = me ? me.pieces.filter((p) => p.done).length : 0;
    const oppDone = opp ? opp.pieces.filter((p) => p.done).length : 0;
    if (els.myDoneEl) els.myDoneEl.textContent = String(myDone);
    if (els.oppDoneEl) els.oppDoneEl.textContent = String(oppDone);

    // piece-dot 색상 갱신 (완주 시 비활성)
    if (me && els.myPiecesEl) {
      els.myPiecesEl.querySelectorAll('.piece-dot').forEach((dot, idx) => {
        const p = me.pieces[idx];
        dot.classList.toggle('done', !!(p && p.done));
        dot.style.background = PLAYER_COLOR[myId] || '#888';
      });
    }
    if (opp && els.oppPiecesEl) {
      const oppColor = PLAYER_COLOR[opp.id] || '#888';
      els.oppPiecesEl.querySelectorAll('.piece-dot').forEach((dot, idx) => {
        const p = opp.pieces[idx];
        dot.classList.toggle('done', !!(p && p.done));
        dot.style.background = oppColor;
      });
    }
  }

  /** 최근 던지기 표시. */
  function setLastThrow(text) {
    if (els.lastThrowEl) els.lastThrowEl.textContent = text;
  }

  /**
   * P1/P2 준비 상태를 대기 화면에 표시한다 (yahtzee ready-mark 패턴).
   * @param {boolean} p1Ready
   * @param {boolean} p2Ready
   */
  function showReadyStatus(p1Ready, p2Ready) {
    const status = document.getElementById('ready-status');
    if (status) status.classList.remove('hidden');
    const markP1 = document.getElementById('ready-mark-p1');
    const markP2 = document.getElementById('ready-mark-p2');
    if (markP1) {
      markP1.textContent = p1Ready ? '✓ 준비' : '대기';
      markP1.classList.toggle('ready', p1Ready);
    }
    if (markP2) {
      markP2.textContent = p2Ready ? '✓ 준비' : '대기';
      markP2.classList.toggle('ready', p2Ready);
    }
  }

  /**
   * 준비 상태 표시 블록을 숨긴다 (게임 시작 후 불필요).
   */
  function hideReadyStatus() {
    const el = document.getElementById('ready-status');
    if (el) el.classList.add('hidden');
  }

  let toastTimer = 0;
  function showToast(text, kind = '', durationMs = 1800) {
    if (!els.toastEl) return;
    els.toastEl.textContent = text;
    els.toastEl.classList.remove('success', 'error');
    if (kind) els.toastEl.classList.add(kind);
    els.toastEl.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      els.toastEl.classList.remove('show');
      toastTimer = 0;
    }, durationMs);
  }

  /** 던지기 버튼 활성/비활성. */
  function setThrowEnabled(enabled, label) {
    if (!els.throwBtnEl) return;
    els.throwBtnEl.disabled = !enabled;
    if (label) els.throwBtnEl.textContent = label;
  }

  // 초기 1회 보드 크기 산정 (레이아웃 settle 후).
  requestAnimationFrame(resizeBoard);

  return {
    setMyId,
    renderBoard,
    resizeBoard,
    renderYut,
    showYutResultText,
    setStatus,
    setTurnLabel,
    renderResultQueue,
    clearSelectedResult,
    getSelectedResult,
    setHighlightCell,
    clearHighlight,
    showBranchModal,
    showResult,
    hideResult,
    renderPieceStatus,
    setLastThrow,
    showReadyStatus,
    hideReadyStatus,
    showToast,
    setThrowEnabled,
  };
}
