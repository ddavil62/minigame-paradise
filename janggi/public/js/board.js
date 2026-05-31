/**
 * @fileoverview 9x10 장기판 Canvas 렌더링 모듈.
 * AD 컨셉 §8-4 ~ §8-6 기준으로 격자, 강 띠, 궁성 대각선, 좌표 라벨을 그린다.
 *
 * 격자 교차점 기반 장기판 (한국식 표준).
 * - 칸 간격(stride): 64px
 * - 내부: 8*64 = 512px (가로) x 9*64 = 576px (세로)
 * - 외곽 여백: 좌우 40px, 상하 48px
 * - 최종 캔버스: 592 x 672 px
 */

// ── 상수 (AD §8-4) ──────────────────────────────────────────────
/** 칸 간격 (격자 교차점 사이 거리). */
export const CELL = 64;
/** 좌우 패딩. */
export const PAD_X = 40;
/** 상하 패딩. */
export const PAD_Y = 48;
/** 캔버스 너비. */
export const CANVAS_W = 592;
/** 캔버스 높이. */
export const CANVAS_H = 672;

/**
 * 격자 좌표(file, rank)를 캔버스 픽셀 좌표로 변환한다.
 * @param {number} file 0..8
 * @param {number} rank 0..9
 * @returns {{ x: number, y: number }}
 */
export function cellToPx(file, rank) {
  return {
    x: PAD_X + file * CELL,
    y: PAD_Y + rank * CELL,
  };
}

/**
 * 캔버스 픽셀 좌표를 가장 가까운 격자 좌표(file, rank)로 변환한다.
 * 임계 거리 이내가 아니면 null을 반환한다.
 * @param {number} px 캔버스 X 좌표
 * @param {number} py 캔버스 Y 좌표
 * @param {number} [threshold=32] 클릭 인식 반경 (기본 32px = CELL/2)
 * @returns {{ file: number, rank: number }|null}
 */
export function pxToCell(px, py, threshold = 32) {
  const file = Math.round((px - PAD_X) / CELL);
  const rank = Math.round((py - PAD_Y) / CELL);
  if (file < 0 || file > 8 || rank < 0 || rank > 9) return null;
  const { x, y } = cellToPx(file, rank);
  const dist = Math.sqrt((px - x) ** 2 + (py - y) ** 2);
  if (dist > threshold) return null;
  return { file, rank };
}

/**
 * 장기판을 Canvas에 렌더링한다 (1회 정적 그리기).
 * 격자선, 강 띠, 궁성 대각선, 좌표 라벨을 포함한다.
 * @param {CanvasRenderingContext2D} ctx
 */
export function renderBoard(ctx) {
  const canvas = ctx.canvas;
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;

  // 배경 (보드 본체)
  ctx.fillStyle = '#D9B380'; // --janggi-board-bg
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // 외곽 테두리
  ctx.strokeStyle = '#7A4A2B'; // --janggi-board-border
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, CANVAS_W - 3, CANVAS_H - 3);

  // ── 격자선 ──
  ctx.strokeStyle = '#3A2418'; // --janggi-grid-line
  ctx.lineWidth = 1;

  // 세로선 (file 0~8)
  for (let f = 0; f <= 8; f++) {
    const x = PAD_X + f * CELL;
    // 세로선은 강 위와 아래를 분리하여 그린다 (한국 장기 표준)
    // 양 끝 세로선(f=0, f=8)은 연결, 내부 세로선은 강 부분 끊기
    if (f === 0 || f === 8) {
      ctx.beginPath();
      ctx.moveTo(x, PAD_Y);
      ctx.lineTo(x, PAD_Y + 9 * CELL);
      ctx.stroke();
    } else {
      // 한 진영 (rank 0 ~ 4)
      ctx.beginPath();
      ctx.moveTo(x, PAD_Y);
      ctx.lineTo(x, PAD_Y + 4 * CELL);
      ctx.stroke();
      // 초 진영 (rank 5 ~ 9)
      ctx.beginPath();
      ctx.moveTo(x, PAD_Y + 5 * CELL);
      ctx.lineTo(x, PAD_Y + 9 * CELL);
      ctx.stroke();
    }
  }

  // 가로선 (rank 0~9, 강 띠 제외)
  for (let r = 0; r <= 9; r++) {
    if (r === 5) continue; // 강 사이 가로선은 이미 rank 4에서 처리
    const y = PAD_Y + r * CELL;
    ctx.beginPath();
    ctx.moveTo(PAD_X, y);
    ctx.lineTo(PAD_X + 8 * CELL, y);
    ctx.stroke();
  }
  // rank 5 가로선
  {
    const y = PAD_Y + 5 * CELL;
    ctx.beginPath();
    ctx.moveTo(PAD_X, y);
    ctx.lineTo(PAD_X + 8 * CELL, y);
    ctx.stroke();
  }

  // ── 강(楚河漢界) 띠 (AD §8-5) ──
  ctx.fillStyle = 'rgba(70,110,160,0.18)'; // --janggi-river-bg
  ctx.fillRect(PAD_X, PAD_Y + 4 * CELL, 8 * CELL, CELL);

  // 강 한자 텍스트
  ctx.fillStyle = '#5A6A7A'; // --janggi-river-text
  ctx.font = 'bold 28px "Noto Sans KR", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('楚河', PAD_X + 2 * CELL, PAD_Y + 4.5 * CELL);
  ctx.fillText('漢界', PAD_X + 6 * CELL, PAD_Y + 4.5 * CELL);

  // ── 궁성 대각선 (AD §8-6) ──
  drawPalace(ctx, 3, 0); // 한 궁성
  drawPalace(ctx, 3, 7); // 초 궁성

  // ── 좌표 라벨 (AD §3-4) ──
  drawLabels(ctx);
}

/**
 * 궁성 대각선 X자를 그린다.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} file0 궁성 좌상단 file (3)
 * @param {number} rank0 궁성 좌상단 rank (한: 0, 초: 7)
 */
function drawPalace(ctx, file0, rank0) {
  const a = cellToPx(file0, rank0);
  const b = cellToPx(file0 + 2, rank0 + 2);
  const c = cellToPx(file0 + 2, rank0);
  const d = cellToPx(file0, rank0 + 2);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
  ctx.moveTo(c.x, c.y); ctx.lineTo(d.x, d.y);
  ctx.strokeStyle = '#3A2418'; // --janggi-palace-line
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

/**
 * 좌표 라벨을 그린다.
 * 가로(file): 1~9, 세로(rank): 양 가장자리.
 * @param {CanvasRenderingContext2D} ctx
 */
function drawLabels(ctx) {
  ctx.fillStyle = '#7A4A2B';
  ctx.font = '14px "Segoe UI", "Malgun Gothic", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  // 하단 file 라벨 (1~9)
  for (let f = 0; f <= 8; f++) {
    const { x } = cellToPx(f, 9);
    ctx.fillText(String(f + 1), x, PAD_Y + 9 * CELL + 8);
  }

  // 좌측 rank 라벨 (1~10)
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let r = 0; r <= 9; r++) {
    const { y } = cellToPx(0, r);
    ctx.fillText(String(r + 1), PAD_X - 10, y);
  }
}
