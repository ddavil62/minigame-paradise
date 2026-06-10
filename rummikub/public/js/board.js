/**
 * @fileoverview 보드 렌더링 — 세트 단위로 묶어 표시, 빈 슬롯 / 빈 세트 / 클릭 핸들링.
 *
 * 인터랙션 흐름:
 *   - 본인 턴에 손 타일을 선택한 상태에서 보드 빈 세트(.board-set.empty) 클릭 → 그 세트의 첫 자리에 삽입.
 *   - 본인 턴에 손 타일을 선택한 상태에서 기존 세트의 슬롯(.board-set-slot[data-index]) 클릭 → 그 인덱스에 삽입.
 *   - 보드 타일 클릭(보드→보드 또는 보드→손 회수):
 *       - 선택 해제된 상태에서 클릭 → 그 타일을 선택(보드 source).
 *       - 그 후 다른 슬롯 또는 손 영역(외부) 클릭으로 이동.
 *   - 본인이 이번 턴에 보드로 옮긴 타일은 "fresh" 강조.
 */

import { buildTileEl } from './tiles.js';
import { lookupTile, validateSet } from './game.js';

/**
 * 보드 전체 렌더.
 *
 * @param {HTMLElement} container
 * @param {object} ctx {
 *   state, myId, myTurn, selectedSrc,   // selectedSrc: { kind, ... } | null
 *   freshTileIds: Set<string>,
 *   onSetEmptyClick(setId),              // 빈 세트 클릭(첫 자리에 삽입)
 *   onSetSlotClick(setId, index),        // 슬롯 클릭(특정 위치 삽입)
 *   onBoardTileClick(setId, tileId, el), // 보드 타일 클릭(선택 또는 이동)
 * }
 */
export function renderBoard(container, ctx) {
  container.innerHTML = '';
  const { state, myTurn, selectedSrc, freshTileIds } = ctx;
  if (!state || !state.board) return;
  const swapTargetJoker = ctx.jokerSwapMode && typeof ctx.jokerSwapMode.jokerTileId === 'string'
    ? ctx.jokerSwapMode.jokerTileId
    : null;

  for (const set of state.board) {
    const setEl = document.createElement('div');
    setEl.className = 'board-set';
    setEl.dataset.setId = set.id;

    // 빈 세트는 클릭하면 첫 자리에 선택된 타일 삽입.
    if (set.tiles.length === 0) {
      setEl.classList.add('empty');
      if (myTurn && selectedSrc) {
        setEl.addEventListener('click', () => ctx.onSetEmptyClick && ctx.onSetEmptyClick(set.id));
      }
      container.appendChild(setEl);
      continue;
    }

    // 세트 valid 시각 표시(invalid면 빨간 보더).
    const resolved = set.tiles.map((id) => lookupTile(state, id)).filter(Boolean);
    if (resolved.length === set.tiles.length) {
      const v = validateSet(resolved);
      if (!v.valid) setEl.classList.add('invalid');
    }

    // 선택된 보드 타일이 이 세트에서 나왔으면 set-target 강조 (옵션).
    if (myTurn && selectedSrc && selectedSrc.kind === 'set' && selectedSrc.setId === set.id) {
      setEl.classList.add('set-target');
    }

    // 슬롯(왼쪽 끝) + 타일들 + 슬롯(타일 사이) + 슬롯(오른쪽 끝).
    setEl.appendChild(makeSlot(set.id, 0, ctx));
    for (let i = 0; i < set.tiles.length; i++) {
      const tileId = set.tiles[i];
      const tile = lookupTile(state, tileId);
      if (!tile) continue;
      const fresh = freshTileIds.has(tileId);
      const selected = !!(selectedSrc && selectedSrc.kind === 'set' && selectedSrc.tileId === tileId);
      const swapTarget = swapTargetJoker === tileId;
      const tileEl = buildTileEl(tile, {
        selectable: myTurn,
        selected,
        fresh,
        swapTarget,
        onClick: () => ctx.onBoardTileClick && ctx.onBoardTileClick(set.id, tileId, tileEl),
      });
      setEl.appendChild(tileEl);
      // 타일 다음 위치 슬롯.
      setEl.appendChild(makeSlot(set.id, i + 1, ctx));
    }
    container.appendChild(setEl);
  }
}

/**
 * 보드 set 안의 빈 슬롯(타일 사이 간격) — 손 타일이 선택된 상태에서 클릭하면 그 인덱스에 삽입.
 * @returns {HTMLElement}
 */
function makeSlot(setId, index, ctx) {
  const slot = document.createElement('div');
  slot.className = 'board-set-slot';
  slot.dataset.index = String(index);
  // 손 타일 선택 상태일 때만 클릭 활성화.
  if (ctx.myTurn && ctx.selectedSrc) {
    slot.addEventListener('click', (e) => {
      e.stopPropagation();
      ctx.onSetSlotClick && ctx.onSetSlotClick(setId, index);
    });
  }
  return slot;
}
