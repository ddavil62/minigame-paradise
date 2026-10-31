/**
 * @fileoverview 티추 조합 판정(순수 함수). 서버·AI·브라우저 클라이언트가 같은 코드를 쓴다.
 *
 * 조합 `{type, rank, n, ids, phx, bomb}`:
 * - type: single · pair · triple · fullhouse · straight · pairseq · bomb4 · bombSF · dog
 * - rank: 비교 기준 숫자(스트레이트·연속 페어는 가장 높은 숫자, 풀하우스는 트리플의 숫자)
 * - n: 카드 장수(같은 종류끼리 장수가 같아야 비교된다)
 * - phx: 봉황이 대신하는 숫자(봉황이 없으면 null)
 *
 * 봉황: 싱글로 내면 직전 싱글 +0.5(맨 앞이면 1.5), 그 밖에는 2~A 중 하나를 대신한다. 폭탄·용·개·참새 자리에는 못 쓴다.
 */
import { DOG, MJ, PHX, DRG, rankOf, suitOf, sortHand, rankLabel } from './cards.js';

function make(type, rank, ids, phx = null, extra = {}) {
  return { type, rank, n: ids.length, ids: sortHand(ids), phx, bomb: type === 'bomb4' || type === 'bombSF', ...extra };
}

/**
 * 고른 카드가 만들 수 있는 모든 조합 해석(내 차례인지·이길 수 있는지는 보지 않는다).
 * 봉황이 들어가면 해석이 둘 이상일 수 있다(스트레이트 양 끝, 2+2+봉황 풀하우스).
 * @param {number[]} ids 카드 id
 * @param {object|null} [top] 지금 이겨야 하는 조합(봉황 싱글의 숫자를 정하는 데만 쓴다)
 * @returns {object[]} 조합 목록
 */
export function interpretations(ids, top = null) {
  const n = ids.length;
  if (n === 0 || new Set(ids).size !== n) return [];
  const hasPhx = ids.includes(PHX);
  const real = ids.filter((id) => id !== PHX);

  if (n === 1) {
    const id = ids[0];
    if (id === DOG) return [make('dog', 0, ids)];
    if (id === DRG) return [make('single', 15, ids)];
    if (id === PHX) {
      if (!top) return [make('single', 1.5, ids)];
      if (top.type !== 'single' || top.rank >= 15) return [];
      return [make('single', top.rank + 0.5, ids)];
    }
    return [make('single', rankOf(id), ids)];
  }
  if (real.some((id) => id === DOG || id === DRG)) return [];

  const ranks = real.map(rankOf);
  const cnt = new Map();
  for (const r of ranks) cnt.set(r, (cnt.get(r) || 0) + 1);
  const distinct = [...cnt.keys()].sort((a, b) => a - b);
  const out = [];

  if (n === 2) {
    if (!hasPhx && cnt.size === 1) out.push(make('pair', ranks[0], ids));
    else if (hasPhx && ranks[0] >= 2) out.push(make('pair', ranks[0], ids, ranks[0]));
    return out;
  }
  if (n === 3) {
    if (!hasPhx && cnt.size === 1) out.push(make('triple', ranks[0], ids));
    else if (hasPhx && cnt.size === 1 && ranks[0] >= 2) out.push(make('triple', ranks[0], ids, ranks[0]));
    return out;
  }

  // 폭탄
  if (n === 4 && !hasPhx && cnt.size === 1) out.push(make('bomb4', ranks[0], ids));
  if (n >= 5 && !hasPhx && real.every((id) => id < 52)) {
    const suit = suitOf(real[0]);
    if (real.every((id) => suitOf(id) === suit) && consecutive(distinct) && distinct.length === n) {
      out.push(make('bombSF', distinct[n - 1], ids, null, { suit }));
    }
  }

  // 풀하우스
  if (n === 5) {
    const counts = [...cnt.values()].sort((a, b) => b - a);
    if (!hasPhx && counts[0] === 3 && counts[1] === 2) {
      const t = [...cnt].find(([, c]) => c === 3)[0];
      out.push(make('fullhouse', t, ids));
    } else if (hasPhx) {
      if (counts.join() === '3,1') {
        const t = [...cnt].find(([, c]) => c === 3)[0];
        const single = [...cnt].find(([, c]) => c === 1)[0];
        if (single >= 2) out.push(make('fullhouse', t, ids, single));
      } else if (counts.join() === '2,2') {
        for (const t of distinct) out.push(make('fullhouse', t, ids, t));
      }
    }
  }

  // 스트레이트
  if (n >= 5 && cnt.size === real.length && real.every((id) => id < 52 || id === MJ)) {
    const lo = distinct[0];
    const hi = distinct[distinct.length - 1];
    if (!hasPhx) {
      if (consecutive(distinct)) out.push(make('straight', hi, ids));
    } else {
      const missing = [];
      for (let r = lo; r <= hi; r++) if (!cnt.has(r)) missing.push(r);
      if (missing.length === 1 && missing[0] >= 2) out.push(make('straight', hi, ids, missing[0]));
      else if (missing.length === 0) {
        if (hi + 1 <= 14) out.push(make('straight', hi + 1, ids, hi + 1));
        if (lo - 1 >= 2) out.push(make('straight', hi, ids, lo - 1));
      }
    }
  }

  // 연속 페어
  if (n >= 4 && n % 2 === 0 && real.every((id) => id < 52)) {
    const pairs = n / 2;
    if (!hasPhx) {
      if (distinct.length === pairs && [...cnt.values()].every((c) => c === 2) && consecutive(distinct)) {
        out.push(make('pairseq', distinct[pairs - 1], ids));
      }
    } else if (distinct.length === pairs && consecutive(distinct)) {
      const single = [...cnt].filter(([, c]) => c === 1);
      if (single.length === 1 && [...cnt.values()].every((c) => c <= 2)) {
        out.push(make('pairseq', distinct[pairs - 1], ids, single[0][0]));
      }
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
    if (c.type === 'bombSF') return c.n > top.n || (c.n === top.n && c.rank > top.rank);
    return c.rank > top.rank;
  }
  if (top.bomb) return false;
  return c.type === top.type && c.n === top.n && c.rank > top.rank;
}

/**
 * 고른 카드를 실제로 낼 수 있는 해석 중 하나를 고른다.
 * @param {number[]} ids 카드 id
 * @param {object|null} top 이겨야 하는 조합
 * @param {{as?:number, outOfTurn?:boolean}} [opts] as: 봉황이 대신할 숫자, outOfTurn: 내 차례가 아니면 폭탄만 가능
 * @returns {object|null} 조합 또는 null
 */
export function pickCombo(ids, top, opts = {}) {
  let list = interpretations(ids, top).filter((c) => beats(c, top));
  if (opts.outOfTurn) list = list.filter((c) => c.bomb);
  if (opts.as !== undefined && opts.as !== null) list = list.filter((c) => c.phx === opts.as);
  if (!list.length) return null;
  // 스트레이트 플러시는 맨 앞·일반 트릭에서는 보통 스트레이트로 내고, 폭탄이어야만 할 때만 폭탄이다.
  list.sort((a, b) => (a.bomb - b.bomb) || (b.rank - a.rank));
  return list[0];
}

/**
 * 봉황 때문에 같은 카드가 서로 다른 숫자로 해석되는 경우 고를 수 있는 숫자 목록.
 * @param {number[]} ids 카드 id @param {object|null} top 이겨야 하는 조합
 * @returns {number[]} 봉황이 대신할 수 있는 숫자들(2개 이상일 때만 선택이 필요하다)
 */
export function phoenixChoices(ids, top) {
  if (!ids.includes(PHX) || ids.length < 2) return [];
  const list = interpretations(ids, top).filter((c) => beats(c, top) && !c.bomb);
  return [...new Set(list.map((c) => c.phx))].sort((a, b) => a - b);
}

/**
 * 손패에서 낼 수 있는 모든 조합(종류·숫자별로 대표 카드 한 벌씩).
 * @param {number[]} hand 손패 @param {object|null} top 이겨야 하는 조합
 * @returns {object[]} 조합 목록(이길 수 있는 것만)
 */
export function enumeratePlays(hand, top = null) {
  const byRank = new Map();
  let phx = false;
  let dog = false;
  let drg = false;
  for (const id of hand) {
    if (id === PHX) phx = true;
    else if (id === DOG) dog = true;
    else if (id === DRG) drg = true;
    else {
      const r = rankOf(id);
      if (!byRank.has(r)) byRank.set(r, []);
      byRank.get(r).push(id);
    }
  }
  const R = (r) => byRank.get(r) || [];
  const cand = [];
  for (const [r, a] of byRank) {
    cand.push([a[0]]);
    if (r < 2) continue;
    if (a.length >= 2) cand.push(a.slice(0, 2)); else if (phx) cand.push([a[0], PHX]);
    if (a.length >= 3) cand.push(a.slice(0, 3)); else if (a.length === 2 && phx) cand.push([...a, PHX]);
    if (a.length === 4) cand.push(a.slice(0, 4));
  }
  if (drg) cand.push([DRG]);
  if (phx) cand.push([PHX]);
  if (dog) cand.push([DOG]);

  const ranks = [...byRank.keys()].filter((r) => r >= 2).sort((x, y) => x - y);
  for (const a of ranks) {
    for (const b of ranks) {
      if (a === b) continue;
      const A = R(a);
      const B = R(b);
      if (A.length >= 3 && B.length >= 2) cand.push([...A.slice(0, 3), ...B.slice(0, 2)]);
      if (phx) {
        if (A.length >= 3 && B.length === 1) cand.push([...A.slice(0, 3), B[0], PHX]);
        if (A.length === 2 && B.length >= 2) cand.push([...A, ...B.slice(0, 2), PHX]);
      }
    }
  }
  for (let len = 5; len <= 14; len++) {
    for (let s = 1; s + len - 1 <= 14; s++) {
      const ids = [];
      let missing = 0;
      for (let r = s; r < s + len; r++) { const a = R(r); if (a.length) ids.push(a[0]); else missing++; }
      if (missing === 0) cand.push(ids);
      else if (missing === 1 && phx) cand.push([...ids, PHX]);
    }
  }
  // 스트레이트 플러시: 무늬별로 이어진 구간
  for (let suit = 0; suit < 4; suit++) {
    const have = new Map();
    for (const id of hand) if (id < 52 && suitOf(id) === suit) have.set(rankOf(id), id);
    for (let len = 5; len <= 13; len++) {
      for (let s = 2; s + len - 1 <= 14; s++) {
        const ids = [];
        for (let r = s; r < s + len && have.has(r); r++) ids.push(have.get(r));
        if (ids.length === len) cand.push(ids);
      }
    }
  }
  for (let k = 2; k <= 13; k++) {
    for (let s = 2; s + k - 1 <= 14; s++) {
      const ids = [];
      let singles = 0;
      let ok = true;
      for (let r = s; r < s + k; r++) {
        const a = R(r);
        if (a.length >= 2) ids.push(a[0], a[1]);
        else if (a.length === 1) { ids.push(a[0]); singles++; } else { ok = false; break; }
      }
      if (!ok) continue;
      if (singles === 0) cand.push(ids);
      else if (singles === 1 && phx) cand.push([...ids, PHX]);
    }
  }

  const seen = new Set();
  const out = [];
  for (const ids of cand) {
    for (const c of interpretations(ids, top)) {
      if (!beats(c, top)) continue;
      const key = `${c.type}|${c.rank}|${c.n}|${c.phx}|${c.suit ?? ''}`;
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
      if (c.ids[0] === PHX) return '봉황';
      return `싱글 ${rankLabel(c.rank)}`;
    case 'pair': return `페어 ${rankLabel(c.rank)}`;
    case 'triple': return `트리플 ${rankLabel(c.rank)}`;
    case 'fullhouse': return `풀하우스 ${rankLabel(c.rank)}`;
    case 'straight': return `스트레이트 ${rankLabel(lo)}~${rankLabel(c.rank)}`;
    case 'pairseq': return `연속 페어 ${rankLabel(c.rank - c.n / 2 + 1)}~${rankLabel(c.rank)}`;
    case 'bomb4': return `폭탄 ${rankLabel(c.rank)}`;
    case 'bombSF': return `플러시 폭탄 ${rankLabel(lo)}~${rankLabel(c.rank)}`;
    default: return '';
  }
}
