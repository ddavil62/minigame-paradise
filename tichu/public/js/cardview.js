/**
 * @fileoverview 카드 DOM 문자열 생성. 목업(tichu-design-v2)의 카드 디자인을 그대로 옮겼다.
 * 모서리 숫자 + 중앙 메달리온, J·Q·K·A는 금박 이중 테두리, 5·10·K는 점수 칩, 특수 4장은 일러스트 + 이름 리본.
 */
import {
  DOG, MJ, PHX, DRG, rankOf, suitOf, SUIT_KEYS, pointsOf, rankLabel,
} from '../lib/cards.js';

const SPECIAL = {
  [DOG]: { cls: 'dog', rk: '개', ko: '개', en: 'DOG', pt: '' },
  [MJ]: { cls: 'spr', rk: '1', ko: '참새', en: 'SPARROW', pt: '' },
  [PHX]: { cls: 'phx', rk: '봉', ko: '봉황', en: 'PHOENIX', pt: '−25' },
  [DRG]: { cls: 'drg', rk: '용', ko: '용', en: 'DRAGON', pt: '+25' },
};

/** @param {string} s @returns {string} HTML 이스케이프 */
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * @param {number} id 카드 id
 * @param {{size?:string, cls?:string, style?:string, data?:boolean}} [o] size: xs·sx·sm·md·lg·xl
 * @returns {string} 카드 HTML
 */
export function cardHtml(id, o = {}) {
  const { size = 'md', cls = '', style = '', data = true } = o;
  const attr = `${data ? ` data-id="${id}"` : ''}${style ? ` style="${style}"` : ''}`;
  const sp = SPECIAL[id];
  if (sp) {
    return `<div class="card sp ${sp.cls} ${size} ${cls}"${attr}><img class="art" src="assets/${sp.cls}.webp" alt="" draggable="false"><i class="fr"></i><span class="ix"><i>${sp.rk}</i></span>${sp.pt ? `<em class="pt">${sp.pt}</em>` : ''}<span class="nm"><b>${sp.ko}</b> <b class="e">${sp.en}</b></span></div>`;
  }
  const r = rankOf(id);
  const suit = SUIT_KEYS[suitOf(id)];
  const hi = r >= 11 ? ' hi' : '';
  const pts = pointsOf(id);
  const pp = pts > 0 ? `<i class="pp">${pts}</i>` : '';
  const ix = (c) => `<span class="ix${c}"><i>${rankLabel(r)}</i><svg><use href="#sym-${suit}"/></svg></span>`;
  return `<div class="card su-${suit}${hi} ${size} ${cls}"${attr}><i class="fr"></i><svg class="wm"><use href="#sym-cloud"/></svg><span class="md"></span><svg class="sb"><use href="#sym-${suit}"/></svg>${ix('')}${ix(' br')}${pp}</div>`;
}

/** @param {string} [size] @param {string} [cls] @returns {string} 카드 뒷면 */
export const backHtml = (size = 'md', cls = '') => `<div class="card back ${size} ${cls}"></div>`;

/** @param {number[]} ids @param {string} [size] @returns {string} 카드 여러 장 */
export const cardsHtml = (ids, size = 'sm') => ids.map((id) => cardHtml(id, { size, data: false })).join('');
