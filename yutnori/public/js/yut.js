/**
 * @fileoverview 윷 결과 관련 클라이언트 유틸 (이름 매핑, 애니메이션 데이터 등).
 * 윷가락 실제 던지기 판정은 서버가 수행한다.
 */

/** 결과명 → 이동 칸 수 (백도는 -1). */
export const YUT_STEPS = {
  backdo: -1,
  do: 1,
  gae: 2,
  geol: 3,
  yut: 4,
  mo: 5,
};

/** 결과명 → 한글 이름. */
export const YUT_NAMES_KO = {
  backdo: '백도',
  do: '도',
  gae: '개',
  geol: '걸',
  yut: '윷',
  mo: '모',
};

/** 결과명 → CSS 색상 변수명 (style.css의 변수). */
export const YUT_CSS_CLASS = {
  backdo: 'yut-backdo',
  do: 'yut-do',
  gae: 'yut-gae',
  geol: 'yut-geol',
  yut: 'yut-yut',
  mo: 'yut-mo',
};

/** 마크된 가락의 인덱스 (서버와 동일). */
export const MARKED_STICK_INDEX = 0;

/**
 * 윷가락 4개를 캔버스에 그린다. (sticks: 1=앞, 0=뒤)
 * MARKED_STICK_INDEX 가락은 빨간 X 표식을 추가로 그린다 (백도 표시).
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number[]} sticks   길이 4, 각 0/1
 * @param {number} canvasW
 * @param {number} canvasH
 */
export function drawYutSticks(ctx, sticks, canvasW, canvasH) {
  ctx.fillStyle = '#0a0a0f';
  ctx.fillRect(0, 0, canvasW, canvasH);

  const padX = 8;
  const stickW = (canvasW - padX * 2) / 4 - 4;
  const stickH = canvasH - 16;
  const startY = 8;

  for (let i = 0; i < 4; i++) {
    const x = padX + i * (stickW + 4);
    const isFront = sticks[i] === 1;
    const isMarked = i === MARKED_STICK_INDEX;
    drawStick(ctx, x, startY, stickW, stickH, isFront, isMarked);
  }
}

/**
 * 윷가락 한 개 (반원통 모양). 앞면(평평한 면)이 위로 향하면 isFront=true.
 * isMarked=true이면 백도 가락임을 표시하기 위해 빨간 X 표식을 진하게 그린다.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {boolean} isFront
 * @param {boolean} [isMarked=false]  백도용 마크 가락 여부
 */
function drawStick(ctx, x, y, w, h, isFront, isMarked = false) {
  // 둥근 직사각형
  const r = Math.min(w, h) / 3;
  ctx.save();
  ctx.beginPath();
  roundRect(ctx, x, y, w, h, r);
  if (isFront) {
    // 앞면: 밝은 베이지 (평평한 면이 보임)
    const grad = ctx.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, '#f3e2b2');
    grad.addColorStop(1, '#c9a96a');
    ctx.fillStyle = grad;
  } else {
    // 뒷면: 어두운 갈색 (둥근 면이 위)
    const grad = ctx.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, '#6b4a2a');
    grad.addColorStop(1, '#3b2614');
    ctx.fillStyle = grad;
  }
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = isFront ? '#8a6e3a' : '#1a0e08';
  ctx.stroke();

  if (isFront) {
    // 앞면 일반 표식 (X자 미세) — 마크되지 않은 가락에만
    if (!isMarked) {
      ctx.strokeStyle = 'rgba(140, 90, 40, 0.6)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + w * 0.3, y + h * 0.45);
      ctx.lineTo(x + w * 0.7, y + h * 0.55);
      ctx.moveTo(x + w * 0.7, y + h * 0.45);
      ctx.lineTo(x + w * 0.3, y + h * 0.55);
      ctx.stroke();
    }
  } else {
    // 뒷면: 곡선 하이라이트 (둥근 면 표현)
    ctx.strokeStyle = 'rgba(255, 220, 180, 0.15)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + w * 0.5, y + r);
    ctx.lineTo(x + w * 0.5, y + h - r);
    ctx.stroke();
  }

  // 백도 마크: 가락 전체에 큼지막한 빨간 X (앞/뒤 모두 표시 — 어느 면이든 식별 가능)
  if (isMarked) {
    ctx.strokeStyle = isFront ? 'rgba(220, 50, 50, 0.95)' : 'rgba(255, 90, 90, 0.95)';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    const mx1 = x + w * 0.25;
    const mx2 = x + w * 0.75;
    const my1 = y + h * 0.38;
    const my2 = y + h * 0.62;
    ctx.beginPath();
    ctx.moveTo(mx1, my1);
    ctx.lineTo(mx2, my2);
    ctx.moveTo(mx2, my1);
    ctx.lineTo(mx1, my2);
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Canvas roundRect 폴리필 (구형 브라우저용).
 */
function roundRect(ctx, x, y, w, h, r) {
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
