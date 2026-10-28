/**
 * @fileoverview 패 SVG 렌더링과 한글 패 이름. 외부 이미지 없이 SVG/CSS로 그린다.
 *
 * 패 코드: '1m'~'9m' 만수, '1p'~'9p' 통수, '1s'~'9s' 삭수, '1z'~'7z' 동남서북백발중, '0m/0p/0s' 적5.
 */

const KN = ['一', '二', '三', '四', '伍', '六', '七', '八', '九'];
const HONOR = { 1: ['東', 'k'], 2: ['南', 'k'], 3: ['西', 'k'], 4: ['北', 'k'], 5: ['白', 'b'], 6: ['發', 'g'], 7: ['中', 'r'] };
const KO = { m: '만', p: '통', s: '삭' };
const KO_HONOR = { 1: '동', 2: '남', 3: '서', 4: '북', 5: '백', 6: '발', 7: '중' };
const SUITS = ['m', 'p', 's', 'z'];

const PIN = {
  1: [[15, 20, 10, 'r']],
  2: [[15, 10.5, 6, 'g'], [15, 29.5, 6, 'b']],
  3: [[8, 9, 5, 'b'], [15, 20, 5, 'r'], [22, 31, 5, 'g']],
  4: [[9, 11, 5, 'b'], [21, 11, 5, 'g'], [9, 29, 5, 'g'], [21, 29, 5, 'b']],
  5: [[8.5, 9.5, 4.6, 'b'], [21.5, 9.5, 4.6, 'g'], [15, 20, 4.6, 'r'], [8.5, 30.5, 4.6, 'g'], [21.5, 30.5, 4.6, 'b']],
  6: [[10, 8, 4.4, 'g'], [20, 8, 4.4, 'g'], [10, 21, 4.4, 'r'], [20, 21, 4.4, 'r'], [10, 32, 4.4, 'r'], [20, 32, 4.4, 'r']],
  7: [[7, 5.5, 3.8, 'g'], [15, 9, 3.8, 'g'], [23, 12.5, 3.8, 'g'], [10, 23, 3.8, 'r'], [20, 23, 3.8, 'r'], [10, 33, 3.8, 'r'], [20, 33, 3.8, 'r']],
  8: [[10, 6, 3.8, 'b'], [20, 6, 3.8, 'b'], [10, 15.3, 3.8, 'b'], [20, 15.3, 3.8, 'b'], [10, 24.7, 3.8, 'b'], [20, 24.7, 3.8, 'b'], [10, 34, 3.8, 'b'], [20, 34, 3.8, 'b']],
  9: [[7, 8, 3.9, 'b'], [15, 8, 3.9, 'b'], [23, 8, 3.9, 'b'], [7, 20, 3.9, 'r'], [15, 20, 3.9, 'r'], [23, 20, 3.9, 'r'], [7, 32, 3.9, 'g'], [15, 32, 3.9, 'g'], [23, 32, 3.9, 'g']],
};
const SOU = {
  2: [[15, 10.5], [15, 29.5]],
  3: [[15, 10.5], [10, 29.5], [20, 29.5]],
  4: [[10, 10.5], [20, 10.5], [10, 29.5], [20, 29.5]],
  5: [[8, 10.5], [22, 10.5], [15, 20, 'r'], [8, 29.5], [22, 29.5]],
  6: [[8, 10.5], [15, 10.5], [22, 10.5], [8, 29.5], [15, 29.5], [22, 29.5]],
  7: [[15, 7, 'r', 8.5], [8, 20, 0, 8.5], [15, 20, 0, 8.5], [22, 20, 0, 8.5], [8, 33, 0, 8.5], [15, 33, 0, 8.5], [22, 33, 0, 8.5]],
  8: [[6, 10.5, 0, 10, 0], [12, 10.5, 0, 10, 18], [18, 10.5, 0, 10, -18], [24, 10.5, 0, 10, 0], [6, 29.5, 0, 10, 0], [12, 29.5, 0, 10, -18], [18, 29.5, 0, 10, 18], [24, 29.5, 0, 10, 0]],
  9: [[8, 7, 0, 8.5], [15, 7, 'r', 8.5], [22, 7, 0, 8.5], [8, 20, 0, 8.5], [15, 20, 'r', 8.5], [22, 20, 0, 8.5], [8, 33, 0, 8.5], [15, 33, 'r', 8.5], [22, 33, 0, 8.5]],
};

/** @param {string} t 패 코드 @returns {string} SVG 내부 마크업 */
function face(t) {
  const n = +t[0];
  const s = t[1];
  const aka = n === 0;
  const v = aka ? 5 : n;
  if (s === 'z') {
    const [ch, c] = HONOR[n];
    if (n === 5) return '<rect x="6.5" y="7" width="17" height="26" rx="2" fill="none" class="s-b" stroke-width="2"/><rect x="9.5" y="10" width="11" height="20" rx="1" fill="none" class="s-b" stroke-width=".8"/>';
    return `<text x="15" y="20.5" font-size="21" class="kanji f-${c}">${ch}</text>`;
  }
  if (s === 'm') return `<text x="15" y="12" font-size="13" class="kanji f-${aka ? 'r' : 'k'}">${KN[v - 1]}</text><text x="15" y="29" font-size="15" class="kanji f-r">萬</text>`;
  if (s === 'p') {
    return PIN[v].map(([x, y, r, c0]) => {
      const c = aka ? 'r' : c0;
      return `<circle cx="${x}" cy="${y}" r="${r}" class="f-${c}"/><circle cx="${x}" cy="${y}" r="${r * 0.68}" class="f-face"/><circle cx="${x}" cy="${y}" r="${r * 0.42}" class="f-${c}"/>`;
    }).join('');
  }
  if (s === 's') {
    if (v === 1) return '<path d="M15 31 L8 38 M15 31 L15 38.5 M15 31 L22 38" class="s-g" stroke-width="2" stroke-linecap="round"/><ellipse cx="15" cy="22" rx="6.5" ry="8.5" class="f-g"/><ellipse cx="15" cy="22" rx="3" ry="5" class="f-face"/><circle cx="15" cy="11" r="4.2" class="f-r"/><path d="M18.5 10 L23 9 L19 12.5 Z" class="f-r"/>';
    return SOU[v].map(([x, y, c0, h0, rot]) => {
      const h = h0 || 10;
      const c = aka ? 'r' : (c0 || 'g');
      const tr = rot ? ` transform="rotate(${rot} ${x} ${y})"` : '';
      return `<g${tr}><rect x="${x - 2.3}" y="${y - h / 2}" width="4.6" height="${h}" rx="2.2" class="f-${c}"/><rect x="${x - 2.6}" y="${y - 0.7}" width="5.2" height="1.4" rx=".7" class="f-${c}"/><line x1="${x}" y1="${y - h / 2 + 1.5}" x2="${x}" y2="${y + h / 2 - 1.5}" stroke="#fff" stroke-opacity=".45" stroke-width=".8"/></g>`;
    }).join('');
  }
  return '';
}

/**
 * 패 id를 패 코드로 바꾼다.
 * @param {number} id 패 id
 * @param {boolean} aka 적도라 사용 여부
 * @returns {string} 패 코드
 */
export function codeOf(id, aka = true) {
  const k = id >> 2;
  if (k >= 27) return `${k - 26}z`;
  const n = (k % 9) + 1;
  const suit = SUITS[Math.floor(k / 9)];
  return `${aka && n === 5 && id % 4 === 0 ? 0 : n}${suit}`;
}

/** @param {number} k 종류 @returns {string} 한글 패 이름 */
export function kindName(k) {
  if (k >= 27) return KO_HONOR[k - 26];
  return `${(k % 9) + 1}${KO[SUITS[Math.floor(k / 9)]]}`;
}

/** @param {number} k 종류 @returns {string} 패 코드(적5 제외) */
export function codeOfKind(k) {
  return codeOf(k * 4 + 3, false);
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * 앞면 패 HTML.
 * @param {string} code 패 코드
 * @param {string} size 크기 클래스(t-hand 등)
 * @param {string} [extra] 추가 클래스
 * @param {string} [inner] 내부 추가 HTML
 * @param {Record<string,string|number>} [attrs] data 속성
 * @returns {string} HTML
 */
export function tileHtml(code, size, extra = '', inner = '', attrs = {}) {
  const a = Object.entries(attrs).map(([k, v]) => ` data-${k}="${esc(v)}"`).join('');
  return `<div class="tile ${size} ${extra}"${a}><svg viewBox="0 0 30 40">${face(code)}</svg>${inner}</div>`;
}

/** @returns {string} 뒷면 패 HTML */
export function backHtml(size, extra = '') {
  return `<div class="tile back ${size} ${extra}"></div>`;
}

/** @returns {string} 가로로 눕힌 패(울린 패/리치 선언패) HTML */
export function sideHtml(code, size, cls = '', extra = '', attrs = {}) {
  return `<div class="rot ${cls}">${tileHtml(code, size, extra, '', attrs)}</div>`;
}

export { esc };
