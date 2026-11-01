/**
 * @fileoverview 티추 조합 판정(순수 함수). 서버·AI·브라우저 클라이언트가 같은 코드를 쓴다.
 *
 * 조합 `{type, rank, n, ids, phx, bomb}`:
 * - type: single · pair · triple · fullhouse · straight · pairseq · bomb4(같은 숫자 4~8장) · bombSF · dog
 * - rank: 비교 기준 숫자(스트레이트·연속 페어는 가장 높은 숫자, 풀하우스는 트리플의 숫자)
 * - n: 카드 장수(같은 종류끼리 장수가 같아야 비교된다. 같은 숫자 폭탄·플러시 폭탄은 장수가 많으면 이긴다)
 * - phx: 봉황이 대신하는 숫자(없으면 null, 봉황 한 장이면 숫자, 두 장이면 오름차순 [숫자, 숫자])
 *
 * 봉황: 싱글로 내면 직전 싱글 +0.5(맨 앞이면 1.5), 그 밖에는 2~A 중 하나를 대신한다. 폭탄·용·개·참새 자리에는 못 쓴다.
 * 2벌(더블 티추)에서는 봉황이 두 장일 수 있고 한 조합에 둘 다 쓸 수 있다. 다만 페어·트리플·풀하우스·연속 페어의 한 묶음은
 * 진짜 카드가 한 장은 있어야 하고(봉황끼리만으로 묶음을 만들 수 없다), 용은 용을 이기지 못한다(숫자가 같다).
 * 카드의 정체는 `cards.js`의 `baseOf`(벌과 무관)로 본다.
 */
import {
  rankOf, suitOf, sortHand, rankLabel, isDog, isDrg, isPhx, isSuited,
} from './cards.js';

const phxKey = (p) => (p === null || p === undefined ? '' : Array.isArray(p) ? p.join('+') : String(p));
/** @returns {boolean} 두 봉황 해석(숫자 또는 숫자 배열)이 같은가 */
export const samePhx = (a, b) => phxKey(a) === phxKey(b);
const phxNum = (p) => (Array.isArray(p) ? p[0] * 100 + p[1] : p ?? 0);

function make(type, rank, ids, phx = null, extra = {}) {
  return { type, rank, n: ids.length, ids: sortHand(ids), phx, bomb: type === 'bomb4' || type === 'bombSF', ...extra };
}

/**
 * 묶음 목록(`needs`: [숫자, 필요한 장수])을 진짜 카드(`cnt`)와 봉황 `k`장으로 채울 수 있는가.
 * @returns {number[]|null} 봉황이 채운 숫자들(오름차순), 못 채우면 null
 */
function fit(needs, cnt, k, realTotal) {
  const fill = [];
  let used = 0;
  for (const [r, need] of needs) {
    const have = cnt.get(r) || 0;
    if (have > need) return null;
    const miss = need - have;
    if (miss && r < 2) return null; // 참새 자리는 봉황이 못 채운다
    if (need >= 2 && have === 0) return null; // 봉황끼리만으로 묶음을 만들 수 없다
    used += have;
    for (let i = 0; i < miss; i++) fill.push(r);
  }
  if (used !== realTotal || fill.length !== k) return null;
  return fill.sort((a, b) => a - b);
}
const phxOf = (fill) => (fill.length === 0 ? null : fill.length === 1 ? fill[0] : fill);

/**
 * 고른 카드가 만들 수 있는 모든 조합 해석(내 차례인지·이길 수 있는지는 보지 않는다).
 * 봉황이 들어가면 해석이 둘 이상일 수 있다(스트레이트 양 끝, 2+2+봉황 풀하우스 …).
 * @param {number[]} ids 카드 id
 * @param {object|null} [top] 지금 이겨야 하는 조합(봉황 싱글의 숫자를 정하는 데만 쓴다)
 * @returns {object[]} 조합 목록
 */
export function interpretations(ids, top = null) {
  const n = ids.length;
  if (n === 0 || new Set(ids).size !== n) return [];
  const k = ids.filter(isPhx).length;
  const real = ids.filter((id) => !isPhx(id));

  if (n === 1) {
    const id = ids[0];
    if (isDog(id)) return [make('dog', 0, ids)];
    if (isDrg(id)) return [make('single', 15, ids)];
    if (isPhx(id)) {
      if (!top) return [make('single', 1.5, ids)];
      if (top.type !== 'single' || top.rank + 0.5 >= 15) return []; // 용 위에는 못 얹고, 15.0이 되는 봉황 위에도 못 얹는다
      return [make('single', top.rank + 0.5, ids)];
    }
    return [make('single', rankOf(id), ids)];
  }
  if (!real.length || real.some((id) => isDog(id) || isDrg(id))) return [];

  const cnt = new Map();
  for (const id of real) { const r = rankOf(id); cnt.set(r, (cnt.get(r) || 0) + 1); }
  const out = [];
  const add = (type, rank, fill) => { if (fill) out.push(make(type, rank, ids, phxOf(fill))); };

  // 폭탄(봉황 불가)
  if (!k) {
    if (n >= 4 && n <= 8 && cnt.size === 1 && real.every(isSuited) && rankOf(real[0]) >= 2) out.push(make('bomb4', rankOf(real[0]), ids));
    if (n >= 5 && real.every(isSuited) && cnt.size === n) {
      const suit = suitOf(real[0]);
      const distinct = [...cnt.keys()].sort((a, b) => a - b);
      if (real.every((id) => suitOf(id) === suit) && consecutive(distinct)) {
        out.push(make('bombSF', distinct[n - 1], ids, null, { suit }));
      }
    }
  }

  if (n === 2) for (let r = 2; r <= 14; r++) add('pair', r, fit([[r, 2]], cnt, k, real.length));
  if (n === 3) for (let r = 2; r <= 14; r++) add('triple', r, fit([[r, 3]], cnt, k, real.length));
  if (n === 5) {
    for (let t = 2; t <= 14; t++) {
      for (let q = 2; q <= 14; q++) if (q !== t) add('fullhouse', t, fit([[t, 3], [q, 2]], cnt, k, real.length));
    }
  }
  if (n >= 5) {
    for (let lo = 1; lo + n - 1 <= 14; lo++) {
      const needs = [];
      for (let r = lo; r < lo + n; r++) needs.push([r, 1]);
      add('straight', lo + n - 1, fit(needs, cnt, k, real.length));
    }
  }
  if (n >= 4 && n % 2 === 0) {
    const m = n / 2;
    for (let lo = 2; lo + m - 1 <= 14; lo++) {
      const needs = [];
      for (let r = lo; r < lo + m; r++) needs.push([r, 2]);
      add('pairseq', lo + m - 1, fit(needs, cnt, k, real.length));
    }
  }
  return out;
}

function consecutive(sorted) {
  for (let i = 1; i < sorted.length; i++) if (sorted[i] !== sorted[i - 1] + 1) return false;
  return true;
}

/**
 * @param {object} c 내려는 조합 @param {object|null} top 지금 이겨야 하는 조합
 * @returns {boolean} 낼 수 있는가(맨 앞이면 무엇이든 가능, 개는 맨 앞에서만)
 */
export function beats(c, top) {
  if (!top) return true;
  if (c.type === 'dog') return false;
  if (c.bomb) {
    if (!top.bomb) return true;
    if (c.type === 'bombSF' && top.type === 'bomb4') return true;
    if (c.type === 'bomb4' && top.type === 'bombSF') return false;
    return c.n > top.n || (c.n === top.n && c.rank > top.rank); // 플러시는 길이 → 높이, 같은 숫자 폭탄은 장수 → 숫자
  }
  if (top.bomb) return false;
  return c.type === top.type && c.n === top.n && c.rank > top.rank;
}

/**
 * 고른 카드를 실제로 낼 수 있는 해석 중 하나를 고른다.
 * @param {number[]} ids 카드 id
 * @param {object|null} top 이겨야 하는 조합
 * @param {{as?:number|number[], outOfTurn?:boolean}} [opts] as: 봉황이 대신할 숫자(두 장이면 배열), outOfTurn: 내 차례가 아니면 폭탄만 가능
 * @returns {object|null} 조합 또는 null
 */
export function pickCombo(ids, top, opts = {}) {
  let list = interpretations(ids, top).filter((c) => beats(c, top));
  if (opts.outOfTurn) list = list.filter((c) => c.bomb);
  if (opts.as !== undefined && opts.as !== null) list = list.filter((c) => samePhx(c.phx, opts.as));
  if (!list.length) return null;
  // 스트레이트 플러시는 맨 앞·일반 트릭에서는 보통 스트레이트로 내고, 폭탄이어야만 할 때만 폭탄이다.
  list.sort((a, b) => (a.bomb - b.bomb) || (b.rank - a.rank));
  return list[0];
}

/**
 * 봉황 때문에 같은 카드가 서로 다른 숫자로 해석되는 경우 고를 수 있는 숫자 목록.
 * @param {number[]} ids 카드 id @param {object|null} top 이겨야 하는 조합
 * @returns {Array<number|number[]>} 봉황이 대신할 수 있는 숫자들(2개 이상일 때만 선택이 필요하다)
 */
export function phoenixChoices(ids, top) {
  if (!ids.some(isPhx) || ids.length < 2) return [];
  const list = interpretations(ids, top).filter((c) => beats(c, top) && !c.bomb);
  const uniq = new Map(list.map((c) => [phxKey(c.phx), c.phx]));
  return [...uniq.values()].sort((a, b) => phxNum(a) - phxNum(b));
}

/**
 * 손패에서 낼 수 있는 모든 조합(종류·숫자별로 대표 카드 한 벌씩).
 * @param {number[]} hand 손패 @param {object|null} top 이겨야 하는 조합
 * @returns {object[]} 조합 목록(이길 수 있는 것만)
 */
export function enumeratePlays(hand, top = null) {
  const byRank = new Map();
  const phx = [];
  let dog = null;
  let drg = null;
  for (const id of hand) {
    if (isPhx(id)) phx.push(id);
    else if (isDog(id)) dog = dog ?? id;
    else if (isDrg(id)) drg = drg ?? id;
    else {
      const r = rankOf(id);
      if (!byRank.has(r)) byRank.set(r, []);
      byRank.get(r).push(id);
    }
  }
  const K = phx.length;
  const R = (r) => byRank.get(r) || [];
  const cand = [];
  for (const [r, a] of byRank) {
    cand.push([a[0]]);
    if (r < 2) continue;
    if (a.length >= 2) cand.push(a.slice(0, 2)); else if (K >= 1) cand.push([a[0], phx[0]]);
    if (a.length >= 3) cand.push(a.slice(0, 3));
    else if (a.length === 2 && K >= 1) cand.push([...a, phx[0]]);
    else if (a.length === 1 && K >= 2) cand.push([a[0], phx[0], phx[1]]);
    for (let n = 4; n <= Math.min(8, a.length); n++) cand.push(a.slice(0, n));
  }
  if (drg !== null) cand.push([drg]);
  if (K) cand.push([phx[0]]);
  if (dog !== null) cand.push([dog]);

  const ranks = [...byRank.keys()].filter((r) => r >= 2).sort((x, y) => x - y);
  for (const t of ranks) {
    for (const q of ranks) {
      if (t === q) continue;
      const A = R(t).slice(0, 3);
      const B = R(q).slice(0, 2);
      const miss = 5 - A.length - B.length;
      if (miss <= K) cand.push([...A, ...B, ...phx.slice(0, miss)]);
    }
  }
  for (let len = 5; len <= 14; len++) {
    for (let s = 1; s + len - 1 <= 14; s++) {
      const ids = [];
      let missing = 0;
      let ok = true;
      for (let r = s; r < s + len; r++) {
        const a = R(r);
        if (a.length) ids.push(a[0]);
        else if (r < 2) { ok = false; break; } else missing++;
      }
      if (ok && missing <= K) cand.push([...ids, ...phx.slice(0, missing)]);
    }
  }
  // 스트레이트 플러시: 무늬별로 이어진 구간
  for (let suit = 0; suit < 4; suit++) {
    const have = new Map();
    for (const id of hand) if (isSuited(id) && suitOf(id) === suit && !have.has(rankOf(id))) have.set(rankOf(id), id);
    for (let len = 5; len <= 13; len++) {
      for (let s = 2; s + len - 1 <= 14; s++) {
        const ids = [];
        for (let r = s; r < s + len && have.has(r); r++) ids.push(have.get(r));
        if (ids.length === len) cand.push(ids);
      }
    }
  }
  for (let m = 2; m <= 13; m++) {
    for (let s = 2; s + m - 1 <= 14; s++) {
      const ids = [];
      let missing = 0;
      let ok = true;
      for (let r = s; r < s + m; r++) {
        const a = R(r);
        if (!a.length) { ok = false; break; }
        ids.push(...a.slice(0, 2));
        missing += 2 - Math.min(2, a.length);
      }
      if (ok && missing <= K) cand.push([...ids, ...phx.slice(0, missing)]);
    }
  }

  const seen = new Set();
  const out = [];
  for (const ids of cand) {
    for (const c of interpretations(ids, top)) {
      if (!beats(c, top)) continue;
      const key = `${c.type}|${c.rank}|${c.n}|${phxKey(c.phx)}|${c.suit ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(c);
    }
  }
  return out;
}

/** @param {number[]} hand @param {object|null} top @returns {object[]} 낼 수 있는 폭탄 */
export const bombsIn = (hand, top = null) => enumeratePlays(hand, top).filter((c) => c.bomb);

/**
 * 조합을 한국어로 설명한다(결과·로그·칩에 쓰는 짧은 문구).
 * @param {object} c 조합
 * @returns {string} 예: "페어 8", "스트레이트 3~7", "폭탄 9"
 */
export function label(c) {
  if (!c) return '';
  const lo = c.rank - c.n + 1;
  switch (c.type) {
    case 'dog': return '개';
    case 'single':
      if (c.rank === 15) return '용';
      if (c.rank === 1) return '참새';
      if (isPhx(c.ids[0])) return '봉황';
      return `싱글 ${rankLabel(c.rank)}`;
    case 'pair': return `페어 ${rankLabel(c.rank)}`;
    case 'triple': return `트리플 ${rankLabel(c.rank)}`;
    case 'fullhouse': return `풀하우스 ${rankLabel(c.rank)}`;
    case 'straight': return `스트레이트 ${rankLabel(lo)}~${rankLabel(c.rank)}`;
    case 'pairseq': return `연속 페어 ${rankLabel(c.rank - c.n / 2 + 1)}~${rankLabel(c.rank)}`;
    case 'bomb4': return c.n > 4 ? `${c.n}장 폭탄 ${rankLabel(c.rank)}` : `폭탄 ${rankLabel(c.rank)}`;
    case 'bombSF': return `플러시 폭탄 ${rankLabel(lo)}~${rankLabel(c.rank)}`;
    default: return '';
  }
}
