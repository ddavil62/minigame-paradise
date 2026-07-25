/**
 * @fileoverview 아이템 allowlist 정규화와 인벤토리·효과 UI를 렌더링한다.
 */
import { t } from './i18n.js';

export const ITEM_IDS = Object.freeze(['lock', 'flip', 'fog', 'hint', 'cleanse', 'shield']);
const ICONS = Object.freeze({ lock: '🔒', flip: '◩', fog: '≋', hint: '✦', cleanse: '✧', shield: '◈' });
const animationFrames = new WeakMap();
const inventoryNodeCaches = new WeakMap();

/** @param {unknown} itemId 검사할 ID @returns {boolean} 지원 아이템 여부 */
export function isKnownItemId(itemId) { return typeof itemId === 'string' && ITEM_IDS.includes(itemId); }

/** @param {unknown} inventory 외부 인벤토리 @returns {{slotId:string,itemId:string}[]} 안전한 최대 3칸 */
export function normalizeInventory(inventory) {
  const seen = new Set();
  return (Array.isArray(inventory) ? inventory : []).filter((slot) => {
    const valid = slot && typeof slot.slotId === 'string' && slot.slotId && !seen.has(slot.slotId) && isKnownItemId(slot.itemId);
    if (valid) seen.add(slot.slotId);
    return valid;
  }).slice(0, 3).map((slot) => ({ slotId: slot.slotId, itemId: slot.itemId }));
}

/**
 * @param {HTMLElement} root 슬롯 루트
 * @param {object[]} inventory 인벤토리
 * @param {(slotId:string)=>void} use 사용 콜백
 * @param {Set<string>} [pendingSlots] 로컬 전송·정산 대기 슬롯
 * @returns {void}
 */
export function renderInventory(root, inventory, use, pendingSlots = new Set()) {
  const slots = normalizeInventory(inventory);
  let cache = inventoryNodeCaches.get(root);
  if (!cache) {
    cache = new Map();
    inventoryNodeCaches.set(root, cache);
  }
  const activeKeys = new Set();
  const nodes = Array.from({ length: 3 }, (_, index) => {
    const slot = slots[index];
    const key = slot ? `slot:${slot.slotId}` : `empty:${index}`;
    activeKeys.add(key);
    let button = cache.get(key);
    if (!button) {
      button = document.createElement('button');
      cache.set(key, button);
    }
    const pending = Boolean(slot && pendingSlots.has(slot.slotId));
    const className = `item-slot${slot ? '' : ' empty'}${pending ? ' item-pending' : ''}`;
    button.className = className;
    button.disabled = !slot || pending;
    if (slot) {
      const name = t(`item_${slot.itemId}`);
      const description = t(`item_${slot.itemId}_description`);
      const renderKey = `${index}|${slot.slotId}|${slot.itemId}|${pending}|${name}|${description}`;
      button.dataset.itemId = slot.itemId;
      button.dataset.slotId = slot.slotId;
      button.setAttribute('aria-label', `${index + 1}. ${name}. ${description}${pending ? `. ${t('itemPending')}` : ''}`);
      button.setAttribute('aria-busy', pending ? 'true' : 'false');
      // 250ms STATE_SYNC가 포인터 입력 중 도착해도 버튼과 자식 DOM을 교체하지 않는다.
      if (button.dataset.renderKey !== renderKey) {
        button.innerHTML = `<span class="item-icon">${ICONS[slot.itemId]}</span><span><b>${name}</b><small>${pending ? t('itemPending') : description}</small></span><span class="slot-key">${pending ? '…' : index + 1}</span>`;
        button.dataset.renderKey = renderKey;
      }
      button.onclick = () => use(button.dataset.slotId);
    } else {
      const renderKey = `empty|${index}`;
      delete button.dataset.itemId;
      delete button.dataset.slotId;
      button.removeAttribute('aria-label');
      button.removeAttribute('aria-busy');
      button.onclick = null;
      if (button.dataset.renderKey !== renderKey) {
        button.innerHTML = `<span></span><span>EMPTY</span><span class="slot-key">${index + 1}</span>`;
        button.dataset.renderKey = renderKey;
      }
    }
    return button;
  });
  for (const [key, node] of cache) {
    if (activeKeys.has(key)) continue;
    node.remove();
    cache.delete(key);
  }
  nodes.forEach((node, index) => {
    if (root.children[index] !== node) root.insertBefore(node, root.children[index] || null);
  });
}

/** @param {HTMLElement} root 효과 루트 @param {object[]} effects 효과 목록 @param {boolean} shieldActive 방어막 활성 여부 @returns {void} */
export function renderEffects(root, effects, shieldActive = false) {
  const previous = animationFrames.get(root);
  if (previous) cancelAnimationFrame(previous);
  const active = (Array.isArray(effects) ? effects : []).filter((effect) => effect && isKnownItemId(effect.itemId) && effect.itemId !== 'shield' && (effect.itemId === 'hint' || Number.isFinite(Number(effect.endsAt))));
  const chips = active.map((effect) => {
    const chip = document.createElement('span');
    const itemName = t(`item_${effect.itemId}`);
    chip.className = 'effect-chip';
    chip.dataset.effectId = effect.effectId || effect.itemId;
    if (effect.itemId === 'hint') {
      chip.setAttribute('aria-label', `${itemName}. ${t('hintUntilMatched')}`);
      chip.innerHTML = `<span aria-hidden="true">${ICONS.hint}</span><span class="effect-chip-name">${itemName}</span><b>${t('hintUntilMatched')}</b>`;
      return { chip, effect: null };
    }
    chip.innerHTML = `<span aria-hidden="true">${ICONS[effect.itemId]}</span><span class="effect-chip-name">${itemName}</span><time aria-label="${t('remaining', { item: itemName })}"></time>`;
    return { chip, effect };
  });
  if (shieldActive) {
    const chip = document.createElement('span');
    chip.className = 'effect-chip shield-chip';
    chip.dataset.effectId = 'shield';
    chip.setAttribute('aria-label', `${t('item_shield')}. ${t('shieldOneHit')}`);
    chip.innerHTML = `<span aria-hidden="true">${ICONS.shield}</span><span class="effect-chip-name">${t('item_shield')}</span><b>${t('shieldOneHit')}</b>`;
    chips.push({ chip, effect: null });
  }
  root.replaceChildren(...chips.map((entry) => entry.chip));
  const timed = chips.filter((entry) => entry.effect);
  if (!timed.length) { animationFrames.delete(root); return; }
  const update = () => {
    let running = false;
    const now = Date.now();
    for (const { chip, effect } of timed) {
      const remaining = Math.max(0, Number(effect.endsAt) - now);
      chip.querySelector('time').textContent = `${Math.ceil(remaining / 100) / 10}s`;
      if (remaining > 0) running = true;
    }
    if (running) animationFrames.set(root, requestAnimationFrame(update));
    else animationFrames.delete(root);
  };
  update();
}
