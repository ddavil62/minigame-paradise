/**
 * @fileoverview 리치마작 AI. 본인 시점의 뷰(`game.viewFor(seat)`)만으로 행동을 결정한다.
 *
 * 난이도
 * - easy: 효율 위주, 방어 없음, 가끔 무작위 버림, 울기 확률적
 * - normal: 효율 + 리치 상대에 대한 기본 방어, 역이 보장되는 울기만
 * - hard: normal + 강한 방어, 리치 판단 보수화, 안전패 선호
 */

import { kindOf, isRedId, toCounts, doraFromIndicator, isHonor, isYaochuu, isDragon, YAOCHUU_KINDS } from './tiles.js';
import { shanten, getWaits } from './agari.js';

/** @param {object} view 뷰 @returns {number[]} 보이는 패 종류별 개수 */
export function visibleCounts(view) {
  const vis = new Array(34).fill(0);
  const add = (id) => { vis[kindOf(id)]++; };
  view.myHand.forEach(add);
  if (view.myDrawn != null) add(view.myDrawn);
  view.dora.forEach(add);
  for (const p of view.players) {
    p.discards.forEach((d) => {
      // 울린 패는 부로에서 세므로 중복 방지
      if (!d.called) add(d.id);
    });
    p.melds.forEach((m) => m.tiles.forEach(add));
  }
  return vis;
}

/**
 * 한 종류 패의 위험도(0 안전 ~ 8 매우 위험)를 리치한 상대 기준으로 구한다.
 * @param {object} view 뷰
 * @param {number} k 종류
 * @param {number[]} vis 보이는 개수
 * @returns {number} 최대 위험도
 */
function dangerOf(view, k, vis) {
  let worst = 0;
  for (const p of view.players) {
    if (p.seat === view.me || !p.riichi) continue;
    const thrown = new Set(p.discards.map((d) => kindOf(d.id)));
    let d;
    if (thrown.has(k)) d = 0;
    else if (isHonor(k)) {
      d = vis[k] >= 3 ? 0.5 : vis[k] === 2 ? 2 : 3.5;
      if (k >= 31) d += 0.5;
    } else {
      const n = k % 9;
      const base = k - n;
      const suji = (a) => n - a >= 0 && thrown.has(base + n - a) && thrown.has(base + n + a);
      const halfSuji = (n >= 3 && thrown.has(base + n - 3)) || (n <= 5 && thrown.has(base + n + 3));
      if (n === 0 || n === 8) d = (n === 0 ? thrown.has(base + 3) : thrown.has(base + 5)) ? 1.5 : 3;
      else if (n === 1 || n === 7) d = halfSuji ? 2.5 : 4.5;
      else if (n === 2 || n === 6) d = halfSuji ? 3.5 : 5.5;
      else d = suji(3) ? 3 : halfSuji ? 4.5 : 6.5;
      if (n >= 1 && n <= 7 && vis[k] >= 3) d = Math.min(d, 2.5);
    }
    worst = Math.max(worst, d);
  }
  return worst;
}

/** 패를 남기려는 가치(클수록 버리기 아까움). */
function keepValue(view, k, counts, doraKinds) {
  let v = 0;
  if (doraKinds.includes(k)) v += 30;
  const me = view.players[view.me];
  const seatWind = 27 + me.wind;
  const roundWind = 27 + view.roundWind;
  const yakuhai = isDragon(k) || k === seatWind || k === roundWind;
  if (yakuhai && counts[k] >= 2) v += 25;
  if (isHonor(k)) return v - 2;
  const n = k % 9;
  if (n >= 2 && n <= 6) v += 4;
  else if (n === 1 || n === 7) v += 2;
  return v;
}

/** @returns {boolean} 현재 부로 + 손패로 역이 거의 보장되는지 */
function yakuLikely(view, counts, melds) {
  const me = view.players[view.me];
  const seatWind = 27 + me.wind;
  const roundWind = 27 + view.roundWind;
  const yakuhai = (k) => isDragon(k) || k === seatWind || k === roundWind;
  if (melds.some((m) => m.type !== 'chi' && yakuhai(m.k))) return true;
  for (let k = 0; k < 34; k++) if (counts[k] >= 3 && yakuhai(k)) return true;
  const all = counts.slice();
  for (const m of melds) for (const id of m.tiles) all[kindOf(id)]++;
  // 탕야오
  if (view.settings.kuitan && all.every((c, k) => c === 0 || !isYaochuu(k))) return true;
  // 혼일색 / 청일색 경향
  for (let s = 0; s < 3; s++) {
    let suit = 0;
    let other = 0;
    for (let k = 0; k < 27; k++) {
      if (Math.floor(k / 9) === s) suit += all[k]; else other += all[k];
    }
    if (other === 0 && suit >= 8) return true;
  }
  return false;
}

function pickDiscardId(view, kind, legalIds) {
  const ids = legalIds.filter((id) => kindOf(id) === kind);
  return ids.find((id) => !isRedId(id)) ?? ids[0];
}

/**
 * 뷰와 합법 행동만으로 AI 행동을 결정한다.
 * @param {object} view `MahjongGame#viewFor` 결과
 * @param {{level?:'easy'|'normal'|'hard', rng?:() => number}} [opts] 옵션
 * @returns {object|null} 행동 객체
 */
export function decide(view, opts = {}) {
  const level = opts.level || 'normal';
  const rng = opts.rng || Math.random;
  const L = view.legal;
  if (!L) return null;
  if (L.kind === 'ack') return { type: 'next' };
  if (L.kind === 'turn') return decideTurn(view, L, level, rng);
  return decideReaction(view, L, level, rng);
}

function decideTurn(view, L, level, rng) {
  if (L.tsumo) return { type: 'tsumo' };
  const me = view.players[view.me];
  const mc = me.melds.length;
  const hand = view.myDrawn != null ? [...view.myHand, view.myDrawn] : view.myHand.slice();
  const counts = toCounts(hand);
  const vis = visibleCounts(view);
  const doraKinds = view.dora.map((id) => doraFromIndicator(kindOf(id)));
  const riichiOpp = view.players.filter((p) => p.seat !== view.me && p.riichi);

  if (L.kyuushu && level !== 'easy') {
    const distinct = YAOCHUU_KINDS.filter((k) => counts[k] > 0).length;
    if (distinct >= 10) return { type: 'kyuushu' };
  }

  const cands = [...new Set(L.discard.map(kindOf))];
  const sOf = new Map();
  for (const k of cands) {
    counts[k]--;
    sOf.set(k, shanten(counts, mc));
    counts[k]++;
  }
  const minS = Math.min(...sOf.values());

  // 깡
  if (riichiOpp.length === 0 || me.riichi) {
    for (const k of L.ankan) {
      const after = counts.slice();
      after[k] -= 4;
      if (shanten(after, mc + 1) <= minS || me.riichi) return { type: 'ankan', kind: k };
    }
    if (!me.riichi && L.kakan.length && level !== 'easy') return { type: 'kakan', id: L.kakan[0] };
  }

  // 후보별 효율
  const ukeire = new Map();
  for (const k of cands) {
    if (sOf.get(k) !== minS) continue;
    counts[k]--;
    let u = 0;
    for (let j = 0; j < 34; j++) {
      const remain = 4 - vis[j];
      if (remain <= 0 || counts[j] >= 4) continue;
      counts[j]++;
      if (shanten(counts, mc) < minS) u += remain;
      counts[j]--;
    }
    counts[k]++;
    ukeire.set(k, u);
  }
  const eff = (k) => (ukeire.get(k) ?? 0) * 10 + keepValue(view, k, counts, doraKinds) * -1;

  let chosen;
  const pushCands = cands.filter((k) => sOf.get(k) === minS);
  const defending = level !== 'easy' && riichiOpp.length > 0 && !me.riichi;
  const foldS = level === 'hard' ? 1 : 2;
  const mustFold = defending && (minS >= foldS || (level === 'hard' && minS >= 1 && riichiOpp.length >= 2));
  if (mustFold) {
    chosen = cands.slice().sort((a, b) => dangerOf(view, a, vis) - dangerOf(view, b, vis)
      || (sOf.get(a) - sOf.get(b)) || (eff(b) - eff(a)))[0];
  } else if (defending) {
    const w = level === 'hard' ? 9 : 6;
    chosen = pushCands.slice().sort((a, b) => (eff(b) - dangerOf(view, b, vis) * w) - (eff(a) - dangerOf(view, a, vis) * w))[0];
  } else {
    chosen = pushCands.slice().sort((a, b) => eff(b) - eff(a))[0];
  }
  if (level === 'easy' && rng() < 0.2) {
    const loose = cands.filter((k) => sOf.get(k) <= minS + 1);
    chosen = loose[Math.floor(rng() * loose.length)];
  }

  const id = pickDiscardId(view, chosen, L.discard);

  // 리치
  if (L.riichi.length > 0 && L.riichi.includes(id) && sOf.get(chosen) === 0 && !mustFold) {
    counts[chosen]--;
    const waits = getWaits(counts, mc);
    counts[chosen]++;
    const remaining = waits.reduce((a, w) => a + Math.max(0, 4 - vis[w]), 0);
    let go;
    if (level === 'easy') go = remaining >= 1;
    else if (level === 'hard') go = remaining >= 3 || (remaining >= 2 && riichiOpp.length === 0);
    else go = remaining >= 2 || (remaining >= 1 && riichiOpp.length === 0);
    if (go && view.wallLeft >= 6) return { type: 'discard', id, riichi: true };
  }
  return { type: 'discard', id, riichi: false };
}

function decideReaction(view, L, level, rng) {
  if (L.ron) return { type: 'ron' };
  const me = view.players[view.me];
  const mc = me.melds.length;
  const counts = toCounts(view.myHand);
  const currentS = shanten(counts, mc);
  const riichiOpp = view.players.filter((p) => p.seat !== view.me && p.riichi);
  const k = kindOf(L.tile);
  if (me.riichi) return { type: 'pass' };

  const best = (usedIds, ban, extraMeld) => {
    const after = counts.slice();
    for (const id of usedIds) after[kindOf(id)]--;
    let min = 9;
    for (let j = 0; j < 34; j++) {
      if (after[j] <= 0 || ban.includes(j)) continue;
      after[j]--;
      min = Math.min(min, shanten(after, mc + 1));
      after[j]++;
    }
    const tmpMelds = [...me.melds, extraMeld];
    return { s: min, after, melds: tmpMelds };
  };

  const options = [];
  if (L.pon) {
    const mine = view.myHand.filter((id) => kindOf(id) === k).slice(0, 2);
    const r = best(mine, [k], { type: 'pon', k, tiles: [...mine, L.tile] });
    options.push({ action: { type: 'pon' }, ...r, pri: 1 });
  }
  for (const c of L.chi || []) {
    const r = best(c.ids, c.ban, { type: 'chi', k: Math.min(k, ...c.ids.map(kindOf)), tiles: [...c.ids, L.tile] });
    options.push({ action: { type: 'chi', ids: c.ids }, ...r, pri: 0 });
  }
  if (options.length === 0) return { type: 'pass' };

  const ok = options.filter((o) => {
    if (o.s >= currentS) return false;
    if (level === 'easy') return rng() < 0.4;
    if (!yakuLikely(view, o.after, o.melds)) return false;
    if (riichiOpp.length > 0 && o.s >= 2) return false;
    if (level === 'hard' && o.s >= 2 && currentS <= 1) return false;
    return true;
  });
  if (ok.length === 0) return { type: 'pass' };
  ok.sort((a, b) => a.s - b.s || b.pri - a.pri);
  return ok[0].action;
}
