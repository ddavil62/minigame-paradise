/**
 * @fileoverview 손 타일 영역 렌더링 — 가로 정렬 + 클릭 선택.
 *
 * 정렬: 색별로 → 숫자 오름차순 → 마지막에 조커.
 */

import { buildTileEl } from './tiles.js';
import { lookupTile } from './game.js';

const COLOR_ORDER = ['red', 'blue', 'black', 'orange'];

/**
 * 손 타일 영역 렌더.
 *
 * @param {HTMLElement} container
 * @param {object} ctx {
 *   state, myTurn, selectedSrc,
 *   jokerSwapMode?: { candidateTileIds: string[] },  // 회수 모드 후보 강조용
 *   mustUseTileIds?: Set<string>,                     // 이번 턴 회수된 조커 ID — "필수" 배지
 *   onTileClick(tileId, el),
 * }
 */
export function renderHand(container, ctx) {
  container.innerHTML = '';
  const { state, myTurn, selectedSrc } = ctx;
  if (!state || !Array.isArray(state.myHand)) return;
  const swapCandidates = ctx.jokerSwapMode && Array.isArray(ctx.jokerSwapMode.candidateTileIds)
    ? new Set(ctx.jokerSwapMode.candidateTileIds)
    : null;
  const mustUseIds = ctx.mustUseTileIds instanceof Set ? ctx.mustUseTileIds : null;

  const tiles = state.myHand
    .map((id) => lookupTile(state, id))
    .filter(Boolean);

  // 정렬: 조커 마지막, 일반은 (color order index, number).
  tiles.sort((a, b) => {
    if (a.kind === 'joker' && b.kind === 'joker') return 0;
    if (a.kind === 'joker') return 1;
    if (b.kind === 'joker') return -1;
    const ca = COLOR_ORDER.indexOf(a.color);
    const cb = COLOR_ORDER.indexOf(b.color);
    if (ca !== cb) return ca - cb;
    return a.number - b.number;
  });

  for (const tile of tiles) {
    const selected = !!(selectedSrc && selectedSrc.kind === 'hand' && selectedSrc.tileId === tile.id);
    const swapCandidate = !!(swapCandidates && swapCandidates.has(tile.id));
    const mustUse = !!(mustUseIds && mustUseIds.has(tile.id));
    const el = buildTileEl(tile, {
      selectable: myTurn,
      selected,
      swapCandidate,
      mustUse,
      onClick: () => ctx.onTileClick && ctx.onTileClick(tile.id, el),
    });
    container.appendChild(el);
  }
}
