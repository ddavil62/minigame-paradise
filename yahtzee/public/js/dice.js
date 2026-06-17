/**
 * @fileoverview 다이스 렌더링 — CSS pip 주사위 5개 + 굴림 시 "주사위 컵" 흔들기 애니메이션.
 *
 * [우드 리디자인]
 *  - 기존 Canvas pip → CSS 3×3 그리드 pip (테마 일관성 + 가벼움).
 *  - 굴림 감지: renderDice 호출 시 다이스 값이 바뀌면(=막 굴려짐) 가죽 컵이
 *    올라와 촤르륵 흔들리고 → 기울여 쏟아지며 새 주사위가 통통 착지하는 시퀀스를 재생.
 *  - 자체 감지 방식이라 main.js 수정 불필요. 시그니처는 기존과 동일:
 *      renderDice(container, { dice, keep, selectable, onToggle })
 *  - [N3] 컵 애니메이션 완료 시점에 opts.onCupDone()을 1회 호출(있을 때만).
 *    호출부(main.js)가 이 콜백에서 scoreboard를 재렌더하면 컵 착지 즉시 점수 미리보기가 노출된다.
 */

import { DICE_COUNT } from './game.js';

/** 1~6 면값별 3×3 pip 위치(0~8 인덱스). */
const PIP_POSITIONS = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

const ROLL_MS = 1000;        // 컵 흔들기 + 쏟아짐 총 시간(style.css의 cup-shake와 일치)
const DROP_MS = 560;         // 착지 애니메이션 시간

/** 이전 렌더의 다이스 값(굴림 감지용, 컨테이너별). */
const prevDiceMap = new WeakMap();

/** 단일 다이스 면(3×3 pip 그리드) 요소를 만든다. */
function buildFace(face) {
  const wrap = document.createElement('span');
  wrap.className = 'die-face';
  const pips = PIP_POSITIONS[face] || [];
  for (let i = 0; i < 9; i++) {
    const slot = document.createElement('span');
    slot.className = 'pip-slot' + (pips.includes(i) ? ' on' : '');
    const pip = document.createElement('span');
    pip.className = 'pip';
    slot.appendChild(pip);
    wrap.appendChild(slot);
  }
  return wrap;
}

/** 가죽 주사위 컵 요소를 만든다(순수 CSS). */
function buildCup() {
  const cup = document.createElement('div');
  cup.className = 'dice-cup';
  cup.setAttribute('aria-hidden', 'true');
  const rim = document.createElement('div'); rim.className = 'dice-cup-rim';
  const body = document.createElement('div'); body.className = 'dice-cup-body';
  cup.appendChild(rim);
  cup.appendChild(body);
  for (let i = 1; i <= 3; i++) {
    const s = document.createElement('span');
    s.className = 'dice-cup-streak s' + i;
    cup.appendChild(s);
  }
  return cup;
}

/**
 * 다이스 요소들을 컨테이너에 그린다.
 * @param {HTMLElement} container
 * @param {object} o { dice, keep, selectable, onToggle, inCupMask, dropMask, opponentTurn }
 */
function drawDice(container, o) {
  const { dice, keep, selectable, onToggle, inCupMask, dropMask, opponentTurn } = o;
  container.innerHTML = '';

  for (let i = 0; i < DICE_COUNT; i++) {
    const face = dice[i];
    const rolled = face >= 1 && face <= 6;
    const el = document.createElement(rolled ? 'button' : 'div');
    el.className = 'die';
    if (rolled) {
      el.type = 'button';
      el.appendChild(buildFace(face));
      if (keep[i]) {
        el.classList.add('kept');
        // 상대 턴이면 상대 keep 시각화 (다른 색·라벨 — "내 KEEP"과 즉시 구분).
        // 본인 턴이면 기존 액센트 KEEP 그대로.
        if (opponentTurn) el.classList.add('opponent');
        const tag = document.createElement('span');
        tag.className = 'keep-tag';
        tag.textContent = opponentTurn ? '상대 KEEP' : 'KEEP';
        el.appendChild(tag);
      }
      if (selectable) {
        el.classList.add('selectable');
        el.addEventListener('click', () => onToggle && onToggle(i));
      }
    } else {
      el.classList.add('unrolled'); // '?' (style.css ::after)
    }
    if (inCupMask && inCupMask[i]) el.classList.add('in-cup');   // 컵 안에 숨김
    if (dropMask && dropMask[i]) el.classList.add('dropping');   // 착지 애니메이션
    container.appendChild(el);
  }
}

/**
 * 다이스 영역을 렌더한다. (시그니처 기존과 동일 + N3 onCupDone 선택 옵션)
 * @param {HTMLElement} container
 * @param {object} opts { dice, keep, selectable, onToggle, opponentTurn, onCupDone }
 *   - onCupDone: (선택) 컵 굴림 애니메이션이 완전히 끝난 시점에 1회 호출되는 콜백.
 */
export function renderDice(container, opts) {
  const dice = (opts.dice || [0, 0, 0, 0, 0]).slice();
  const keep = opts.keep || [false, false, false, false, false];
  const selectable = !!opts.selectable;
  const opponentTurn = !!opts.opponentTurn;

  const prev = prevDiceMap.get(container) || null;

  // 컵 애니메이션 진행 중 + 동일 다이스로 재호출되면(중복 렌더) 무시하여 애니메이션 유지.
  const sameAsPrev = prev && dice.every((v, i) => v === prev[i]);
  if (container._cupTimer && sameAsPrev) return;

  prevDiceMap.set(container, dice.slice());

  const allZero = dice.every((d) => d < 1);
  // 굴림 발생 신호: prev 대비 dice 값이 1개라도 변했는가.
  // (keep 토글 같은 비-굴림 재렌더와 구분하기 위함.)
  const diceChanged = !!prev && dice.some((v, i) => v !== prev[i]);
  const rolledNow = !allZero && diceChanged;

  // 진행 중이던 컵 타이머 정리.
  if (container._cupTimer) { clearTimeout(container._cupTimer); container._cupTimer = null; }

  if (rolledNow) {
    // [버그 수정] inCupMask/dropMask 판정 기준을 "값 비교"가 아닌 "서버 권위 keep"으로 변경.
    //  - 기존 changed 기반: 새로 굴린 다이스가 우연히 prev와 같은 값일 때 changed[i]=false →
    //    해당 칸이 컵 안에도 안 들어가고 drop 애니메이션도 안 됨 → 사용자 시야에는 "안 굴러간 것"으로 보임.
    //    (1/6 ≈ 17% 확률로 칸당 발생. "한 번씩 안 굴러간다"는 신고와 일치.)
    //  - 수정: rollMask[i] = !keep[i]. 서버 game.js의 rollDice가 보장하는 진실 — keep=false 인 칸이
    //    실제로 새로 굴린 칸. 동일 값 케이스도 정상적으로 컵/drop 애니메이션 표시.
    const rollMask = keep.map((k) => !k);

    // 1) 굴려진 주사위는 컵 안에 숨기고(rollMask 기준), 유지된 주사위는 그대로 노출.
    drawDice(container, { dice, keep, selectable: false, onToggle: opts.onToggle, inCupMask: rollMask, opponentTurn });
    container.appendChild(buildCup());
    // 2) 흔들기 끝 → 컵 제거 + 새 주사위 착지 애니메이션으로 노출.
    container._cupTimer = setTimeout(() => {
      drawDice(container, { dice, keep, selectable, onToggle: opts.onToggle, dropMask: rollMask, opponentTurn });
      container._cupTimer = setTimeout(() => {
        // 착지 후 클래스 정리(클릭/hover 정상화).
        drawDice(container, { dice, keep, selectable, onToggle: opts.onToggle, opponentTurn });
        container._cupTimer = null;
        // [N3] 컵 애니메이션 완료 콜백 — _cupTimer를 null로 정리한 직후 호출한다.
        //  - 호출부가 여기서 scoreboard를 재렌더하면 컵 착지 즉시 점수 미리보기가 노출된다.
        //  - 재호출 시 dice 값이 동일(rolledNow=false)하므로 컵 애니메이션/onCupDone 재등록은 일어나지 않아
        //    무한 루프가 발생하지 않는다.
        if (typeof opts.onCupDone === 'function') opts.onCupDone();
      }, DROP_MS);
    }, ROLL_MS);
  } else {
    drawDice(container, { dice, keep, selectable, onToggle: opts.onToggle, opponentTurn });
  }
}
