/**
 * @fileoverview 오목 Canvas 보드 렌더링 + 클릭→교차점 변환.
 *
 * 모든 시각 요소(나뭇결 바둑판·격자·화점·돌·마지막 착수 표시·승리선)를
 * 외부 이미지 없이 Canvas 2D로 코드 합성한다.
 *
 * 좌표계:
 *  - 교차점(row, col) → 화면(x, y): x = MARGIN + col*CELL, y = MARGIN + row*CELL
 *  - 화면(x, y) → 교차점(row, col): Math.round((x-MARGIN)/CELL) 등
 */

// ── 레이아웃 상수 ──────────────────────────────────────────────────
/** 바둑판 한 변 교차점 개수. */
export const BOARD_SIZE = 19;
/** 교차점 간격(px). */
const CELL = 36;
/** 보드 테두리 여백(px) — 좌표 라벨이 들어가는 공간. */
const MARGIN = 40;
/** 돌 반지름(px). */
const STONE_R = 15;
/** Canvas 한 변 크기(px). 36*18 + 80 = 728. */
export const CANVAS_SIZE = CELL * (BOARD_SIZE - 1) + MARGIN * 2;

/** 화점(花点) 위치 — 표준 19×19 9곳(3/9/15 교차). */
const STAR_POINTS = [
  [3, 3], [3, 9], [3, 15],
  [9, 3], [9, 9], [9, 15],
  [15, 3], [15, 9], [15, 15],
];

/** 가로 좌표 라벨(A~T, I 제외 — 바둑 관례). 19개. */
const COL_LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T'];

/**
 * 바둑판 배경 + 격자 + 화점 + 좌표 라벨을 그린다.
 * @param {CanvasRenderingContext2D} ctx
 */
function drawBoard(ctx) {
  // 1. 배경 (황토색 그라디언트, 나뭇결 느낌).
  const grad = ctx.createLinearGradient(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  grad.addColorStop(0, '#D4A55A');   // 연한 원목
  grad.addColorStop(0.5, '#C49040'); // 중간 원목
  grad.addColorStop(1, '#B8832E');   // 진한 원목
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  // 2. 나뭇결 선 (미세한 가로 줄, 낮은 불투명도).
  ctx.strokeStyle = 'rgba(100,60,10,0.15)';
  ctx.lineWidth = 0.5;
  for (let y = 0; y < CANVAS_SIZE; y += 4) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(CANVAS_SIZE, y);
    ctx.stroke();
  }

  // 3. 격자선 (19×19).
  ctx.strokeStyle = '#5C3D0E';
  ctx.lineWidth = 1;
  const start = MARGIN;
  const end = MARGIN + CELL * (BOARD_SIZE - 1);
  for (let i = 0; i < BOARD_SIZE; i++) {
    const pos = MARGIN + i * CELL;
    // 가로선.
    ctx.beginPath();
    ctx.moveTo(start, pos);
    ctx.lineTo(end, pos);
    ctx.stroke();
    // 세로선.
    ctx.beginPath();
    ctx.moveTo(pos, start);
    ctx.lineTo(pos, end);
    ctx.stroke();
  }

  // 4. 화점(花点) — 작은 점 9곳.
  ctx.fillStyle = '#5C3D0E';
  for (const [r, c] of STAR_POINTS) {
    ctx.beginPath();
    ctx.arc(MARGIN + c * CELL, MARGIN + r * CELL, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // 5. 좌표 라벨 (MARGIN 여백 안에 렌더링).
  ctx.fillStyle = '#4A2E08';
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < BOARD_SIZE; i++) {
    const pos = MARGIN + i * CELL;
    // 가로 라벨(A~T) — 상단/하단 여백.
    ctx.fillText(COL_LABELS[i], pos, MARGIN / 2);
    ctx.fillText(COL_LABELS[i], pos, CANVAS_SIZE - MARGIN / 2);
    // 세로 라벨(1~19) — 좌측/우측 여백. 위가 1, 아래가 19.
    const num = String(i + 1);
    ctx.fillText(num, MARGIN / 2, pos);
    ctx.fillText(num, CANVAS_SIZE - MARGIN / 2, pos);
  }
}

/**
 * 단일 돌을 그린다. 방사형 그라디언트로 구체감을 표현한다.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} row
 * @param {number} col
 * @param {'black'|'white'} color
 * @param {boolean} isLast 마지막 착수면 빨간 점 표시
 */
function drawStone(ctx, row, col, color, isLast) {
  const cx = MARGIN + col * CELL;
  const cy = MARGIN + row * CELL;

  const grad = ctx.createRadialGradient(cx - 4, cy - 4, 2, cx, cy, STONE_R);
  if (color === 'black') {
    grad.addColorStop(0, '#888'); // 하이라이트
    grad.addColorStop(1, '#111'); // 가장자리
  } else {
    grad.addColorStop(0, '#FFF');
    grad.addColorStop(1, '#DDD');
  }

  ctx.beginPath();
  ctx.arc(cx, cy, STONE_R, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();

  // 백돌은 배경(밝은 우드)과 구분이 약하므로 얇은 회색 테두리.
  if (color === 'white') {
    ctx.strokeStyle = '#AAA';
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }

  // 마지막 착수 표시 — 빨간 점. CSS --accent(#C8102E)와 색상 통일(F-01).
  if (isLast) {
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#C8102E';
    ctx.fill();
  }
}

/**
 * 승리선을 노란 원으로 하이라이트한다.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<[number,number]>} winLine 연속 교차점 좌표(5개 이상)
 */
function drawWinLine(ctx, winLine) {
  ctx.strokeStyle = '#FFD700';
  ctx.lineWidth = 3;
  for (const [row, col] of winLine) {
    ctx.beginPath();
    ctx.arc(MARGIN + col * CELL, MARGIN + row * CELL, STONE_R + 2, 0, Math.PI * 2);
    ctx.stroke();
  }
}

/**
 * 보드 전체를 렌더링한다(배경 + 돌 + 승리선).
 * @param {HTMLCanvasElement} canvas
 * @param {object} state STATE 페이로드 (board/result 등)
 * @param {'black'|'white'|null} myColor 내 색(현재 미사용, 향후 확장 대비)
 * @param {{row:number, col:number}|null} lastMove 마지막 착수 좌표
 */
export function render(canvas, state, myColor, lastMove) {
  const ctx = canvas.getContext('2d');
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;

  drawBoard(ctx);

  if (state && Array.isArray(state.board)) {
    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        const color = state.board[row * BOARD_SIZE + col];
        if (!color) continue;
        const isLast = !!lastMove && lastMove.row === row && lastMove.col === col;
        drawStone(ctx, row, col, color, isLast);
      }
    }
  }

  if (state && state.result && state.result.winLine) {
    drawWinLine(ctx, state.result.winLine);
  }
}

/**
 * 클릭 이벤트 좌표를 가장 가까운 교차점으로 변환한다.
 * Canvas가 CSS로 축소돼 있어도 정확하도록 scale을 보정한다.
 * @param {HTMLCanvasElement} canvas
 * @param {MouseEvent} event
 * @returns {{row:number, col:number}|null} 유효 교차점 또는 null
 */
export function canvasToCell(canvas, event) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const x = (event.clientX - rect.left) * scaleX;
  const y = (event.clientY - rect.top) * scaleY;
  const col = Math.round((x - MARGIN) / CELL);
  const row = Math.round((y - MARGIN) / CELL);
  if (col < 0 || col >= BOARD_SIZE || row < 0 || row >= BOARD_SIZE) return null;
  // 클릭 허용 반경: 교차점 중심 ±CELL/2 이내만 인정(여백 잘못 클릭 방지).
  const cx = MARGIN + col * CELL;
  const cy = MARGIN + row * CELL;
  if (Math.abs(x - cx) > CELL / 2 || Math.abs(y - cy) > CELL / 2) return null;
  return { row, col };
}
