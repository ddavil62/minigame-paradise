/**
 * @fileoverview 타일 DOM 렌더링 유틸 — 단일 타일을 색·숫자·조커에 따라 그린다.
 */

/**
 * 단일 타일 DOM 생성.
 * @param {object} tile { id, kind:'num'|'joker', color, number }
 * @param {object} [opts] { selectable, selected, fresh, swapCandidate, mustUse, swapTarget, onClick }
 *   - swapCandidate: 조커 회수 후보 손 타일 — 강조
 *   - mustUse: 이번 턴 회수된 조커 — "이 턴 사용 필수" 배지
 *   - swapTarget: 회수 모드의 보드 조커 — 강조
 * @returns {HTMLElement}
 */
export function buildTileEl(tile, opts = {}) {
  const el = document.createElement('div');
  el.className = 'tile';
  el.dataset.tileId = tile.id;
  if (tile.kind === 'joker') {
    el.classList.add('color-joker');
    el.innerHTML = '<span class="tile-num">★</span>';
    el.title = '조커';
  } else {
    el.classList.add(`color-${tile.color}`);
    const corner = document.createElement('span');
    corner.className = 'tile-corner';
    corner.textContent = tile.number;
    const num = document.createElement('span');
    num.className = 'tile-num';
    num.textContent = tile.number;
    el.appendChild(corner);
    el.appendChild(num);
    el.title = `${tile.color} ${tile.number}`;
  }
  if (opts.selectable) {
    el.classList.add('selectable');
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      opts.onClick && opts.onClick(tile, el);
    });
  }
  if (opts.selected) el.classList.add('selected');
  if (opts.fresh) el.classList.add('fresh');
  if (opts.swapCandidate) el.classList.add('swap-candidate');
  if (opts.swapTarget) el.classList.add('swap-target');
  if (opts.mustUse) {
    el.classList.add('must-use');
    const badge = document.createElement('span');
    badge.className = 'tile-badge';
    badge.textContent = '필수';
    badge.title = '이번 턴에 다른 세트에 반드시 사용해야 합니다.';
    el.appendChild(badge);
  }
  return el;
}
