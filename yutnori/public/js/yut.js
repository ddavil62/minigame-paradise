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
  // 원목 트레이 배경 (기존 단색 검정 → 원목 gradient)
  const bgGrad = ctx.createLinearGradient(0, 0, 0, canvasH);
  bgGrad.addColorStop(0, '#5a3518');
  bgGrad.addColorStop(1, '#3a2010');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, canvasW, canvasH);

  // 인셋 테두리 (원목 트레이 가장자리 어둠)
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 3;
  ctx.strokeRect(1, 1, canvasW - 2, canvasH - 2);

  // 세로형 레이아웃: 가락 4개를 가늘고 긴 막대(H:W≈5:1)로 나란히 세운다.
  // canvasW=120, canvasH=130 기준 stickW≈23, stickH=116 → H:W=5.04:1.
  const padX = 6; // 좌우 내부 여백
  const padY = 7; // 상하 내부 여백
  const gap = 4; // 가락 사이 간격
  const stickW = (canvasW - padX * 2) / 4 - gap;
  const stickH = canvasH - padY * 2;

  for (let i = 0; i < 4; i++) {
    const x = padX + i * (stickW + gap);
    const isFront = sticks[i] === 1;
    const isMarked = i === MARKED_STICK_INDEX;
    drawStick(ctx, x, padY, stickW, stickH, isFront, isMarked);
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
  // 완전 반원형 끝: 반경 = 폭/2 → 위아래 끝이 반구로 마감(실물 윷가락 끝과 동일).
  const r = w / 2;
  const cx = x + w * 0.5; // 가락 중심 x

  ctx.save();

  // ── 가락 본체 채우기 (좌우 방향 그라디언트로 반원통 단면 표현) ──
  ctx.beginPath();
  roundRect(ctx, x, y, w, h, r);
  if (isFront) {
    // 앞면(평평면, flat-up): 절단된 목재 내부면. 좌우 그라디언트 —
    // 가장자리는 모서리 음영으로 약간 어둡고, 중앙이 밝은 한지빛 목재.
    const grad = ctx.createLinearGradient(x, y, x + w, y);
    grad.addColorStop(0, '#d4b47a');
    grad.addColorStop(0.35, '#f5e4b0');
    grad.addColorStop(0.65, '#f5e4b0');
    grad.addColorStop(1, '#d4b47a');
    ctx.fillStyle = grad;
  } else {
    // 뒷면(둥근면, round-up): 원통 외피. 좌우 4-stop 볼록 그라디언트 —
    // 양 가장자리 매우 어둡고 중앙 능선이 가장 밝아 볼록 입체감을 준다.
    const grad = ctx.createLinearGradient(x, y, x + w, y);
    grad.addColorStop(0, '#2a1508');
    grad.addColorStop(0.35, '#6b3c1a');
    grad.addColorStop(0.5, '#a06030');
    grad.addColorStop(0.65, '#6b3c1a');
    grad.addColorStop(1, '#2a1508');
    ctx.fillStyle = grad;
  }
  ctx.fill();

  // 가락 본체에 클립(나뭇결/하이라이트가 반원 끝 밖으로 새지 않게)
  ctx.save();
  ctx.beginPath();
  roundRect(ctx, x, y, w, h, r);
  ctx.clip();

  if (isFront) {
    // ── 앞면 나뭇결: 길이 방향(세로) 결선 5개 + sin 오프셋으로 자연스러운 결 ──
    ctx.strokeStyle = 'rgba(140, 80, 20, 0.15)';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    for (let k = 1; k <= 5; k++) {
      const kx = x + (w * k) / 6 + Math.sin(k * 1.7) * 2;
      ctx.moveTo(kx, y + r);
      ctx.lineTo(kx + Math.sin(k * 0.9) * 1.5, y + h - r);
    }
    ctx.stroke();
  } else {
    // ── 뒷면 중앙 능선 하이라이트: 볼록 원통의 가장 밝은 마루 ──
    ctx.strokeStyle = 'rgba(255, 200, 140, 0.30)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, y + r + 2);
    ctx.lineTo(cx, y + h - r - 2);
    ctx.stroke();
  }
  ctx.restore();

  // ── 외곽 stroke ──
  ctx.beginPath();
  roundRect(ctx, x, y, w, h, r);
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = isFront ? '#8a6020' : '#1a0a04';
  ctx.stroke();

  // ── 백도 마크: 평평면 중앙 부근에 큼지막한 빨간 X (앞/뒤 모두 표시 — 어느 면이든 식별) ──
  if (isMarked) {
    ctx.strokeStyle = isFront ? '#c8281e' : 'rgba(255, 80, 80, 0.9)';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    const mcx = cx; // X 중심 x
    const mcy = y + h * 0.45; // 중앙보다 약간 위
    const halfW = w * 0.28; // X 가로 반폭 (가락 폭의 56%)
    const halfH = h * 0.1; // X 세로 반높이
    ctx.beginPath();
    ctx.moveTo(mcx - halfW, mcy - halfH);
    ctx.lineTo(mcx + halfW, mcy + halfH);
    ctx.moveTo(mcx + halfW, mcy - halfH);
    ctx.lineTo(mcx - halfW, mcy + halfH);
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
