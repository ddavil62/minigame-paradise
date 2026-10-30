/**
 * @fileoverview 초보 도우미 힌트. 본인 시점 뷰만으로 향청수·대기패·역 유무·안전패·추천 버림·울기 영향을 계산한다.
 *
 * 서버가 도우미를 켠 플레이어에게만 STATE와 함께 전달한다. 상대 손패 정보는 사용하지 않는다.
 *
 * 추천 버림은 다음 순서로 고른다(앞선 기준이 같을 때만 다음 기준을 본다).
 * 1) 향청수가 가장 낮아지는 패  2) 텐파이라면 역이 있는 대기  3) 필요한 패(수용 장수)가 많은 쪽
 * 4) 도라·적도라는 남기기  5) 자패·1·9 같은 쓸모 적은 패부터
 * 리치한 상대가 있고 내 손이 아직 2향청 이상이면 이미 나온 안전패(현물)를 우선한다.
 */

import { kindOf, toCounts, isDragon, isRedId, isHonor, isTerminal, doraFromIndicator } from './tiles.js';
import { shanten, getWaits, evaluateHand } from './agari.js';
import { visibleCounts } from './ai.js';

/** 낮을수록 먼저 버려도 되는 패: 자패 → 1·9 → 2·8 → 나머지 */
const usefulness = (k) => (isHonor(k) ? 0 : isTerminal(k) ? 1 : (k % 9 === 1 || k % 9 === 7) ? 2 : 3);

/**
 * 대기 목록의 역 상태를 하나로 합친다.
 * @param {{remaining:number, yaku:string|null}[]} waits 대기 목록
 * @returns {'ok'|'tsumo'|'none'|'partial'|null} ok=론·쯔모 모두 / tsumo=쯔모만 / none=역 없음 / partial=일부 대기만 역 없음
 */
function aggregate(waits) {
  const live = waits.filter((w) => w.remaining > 0 && w.yaku);
  const ys = new Set((live.length ? live : waits.filter((w) => w.yaku)).map((w) => w.yaku));
  if (ys.size === 0) return null;
  if (ys.size === 1) return [...ys][0];
  return ys.has('none') ? 'partial' : 'ok';
}

const YAKU_ORDER = { ok: 0, partial: 1, tsumo: 2, none: 3 };

/**
 * 손패를 향청수가 가장 낮은 방식으로 묶는다(일반형만. 치또이츠·국사 모양은 다루지 않는다).
 * 해석이 여러 개면 완성 면자가 많은 쪽 → 머리가 있는 쪽을 고른다.
 * @param {number[]} counts 부로를 뺀 손패 개수
 * @param {number} fixed 부로 수
 * @param {number[]} vis 보이는 패 개수(남은 장수 계산용)
 * @returns {{s:number, groups:{t:'seq'|'tri'|'pair'|'ta', kinds:number[], need:{k:number, left:number}[]}[]}}
 */
export function bestGrouping(counts, fixed, vis) {
  const c = counts.slice();
  const cur = [];
  let best = null;
  let mentsu = fixed;
  let pair = 0;
  const left = (k) => Math.max(0, 4 - vis[k]);
  const need = (...ks) => ks.map((k) => ({ k, left: left(k) }));
  const leaf = () => {
    // 면자+탈락 후보가 4개를 넘으면 넘치는 후보는 쓸모없는 패로 본다.
    let room = 4 - mentsu;
    const groups = [];
    for (const g of cur) {
      if (g.t === 'ta') { if (room <= 0) continue; room--; }
      groups.push(g);
    }
    const s = 8 - 2 * mentsu - groups.filter((g) => g.t === 'ta').length - pair;
    if (!best || s < best.s || (s === best.s && (mentsu > best.m || (mentsu === best.m && pair > best.p)))) {
      best = { s, m: mentsu, p: pair, groups };
    }
  };
  const dfs = (start) => {
    let i = start;
    while (i < 34 && c[i] === 0) i++;
    if (i >= 34) { leaf(); return; }
    const suit = i < 27;
    const take = (ks, g, nextStart, onSet) => {
      ks.forEach((k) => { c[k]--; });
      cur.push(g);
      if (onSet) mentsu++;
      dfs(nextStart);
      if (onSet) mentsu--;
      cur.pop();
      ks.forEach((k) => { c[k]++; });
    };
    if (c[i] >= 3) take([i, i, i], { t: 'tri', kinds: [i, i, i], need: [] }, i, true);
    if (suit && i % 9 <= 6 && c[i + 1] > 0 && c[i + 2] > 0) take([i, i + 1, i + 2], { t: 'seq', kinds: [i, i + 1, i + 2], need: [] }, i, true);
    if (c[i] >= 2) {
      if (!pair) { pair = 1; take([i, i], { t: 'pair', kinds: [i, i], need: [] }, i, false); pair = 0; }
      take([i, i], { t: 'ta', kinds: [i, i], need: need(i) }, i, false);
    }
    if (suit && i % 9 <= 7 && c[i + 1] > 0) {
      const n = [];
      if (i % 9 >= 1) n.push(i - 1);
      if (i % 9 <= 6) n.push(i + 2);
      take([i, i + 1], { t: 'ta', kinds: [i, i + 1], need: need(...n) }, i, false);
    }
    if (suit && i % 9 <= 6 && c[i + 2] > 0) take([i, i + 2], { t: 'ta', kinds: [i, i + 2], need: need(i + 1) }, i, false);
    c[i]--;
    dfs(i);
    c[i]++;
  };
  dfs(0);
  return { s: best.s, groups: best.groups };
}

/**
 * @param {object} view `MahjongGame#viewFor` 결과
 * @returns {object|null} 힌트(없으면 null)
 *
 * 힌트 필드
 * - shanten: 향청수(-1이면 완성 모양, 0이면 텐파이)
 * - waits / yaku: 텐파이일 때 대기 [{kind, remaining, yaku}]와 역 상태 합산
 * - fixable: 문전이고 아직 리치 전이라 리치로 역을 만들 수 있는가
 * - discards[종류]: {s, u, waits, yaku} 버렸을 때의 평가
 * - best: 추천 버림 종류(0~1개), bestWhy: 'fold'|'tenpai'|'speed', bestRisky, bestSavedDora
 * - safe: 리치한 상대에게 안전한 패 종류
 * - call: 퐁·치 반응 창일 때 {type, before, after, opens, yakuAfter, advice, why} (advice: yes·maybe·no)
 * - kan: 내 차례의 암깡·가깡 판정 {깡할 종류: {advice, why}}
 * - callKan: 대명깡 반응 창일 때 {advice, why}
 * - note: 한 줄 안내(쯔모 가능, 역 없음, 역패 퐁)
 * - groups: 손패 묶음 [{t:'seq'|'tri'|'pair'|'ta', kinds, need:[{k, left}]}] (ta=한 장 더 오면 묶음이 되는 후보). 일반형이 최선이 아니면 null
 */
export function computeHints(view) {
  if (!view || !view.myHand || view.phase === 'over' || view.phase === 'ack') return null;
  const me = view.players[view.me];
  const mc = me.melds.length;
  const hand = view.myDrawn != null ? [...view.myHand, view.myDrawn] : view.myHand.slice();
  const counts = toCounts(hand);
  const vis = visibleCounts(view);
  const melds = me.melds.map((m) => ({ type: m.type, k: m.k }));
  const closed = me.melds.every((m) => m.type === 'ankan');
  const fixable = closed && !me.riichi;
  const seatWind = 27 + me.wind;
  const roundWind = 27 + view.roundWind;
  const rules = { kuitan: view.settings?.kuitan !== false };
  const doraKinds = new Set((view.dora || []).map((id) => doraFromIndicator(kindOf(id))));
  const hints = {
    shanten: null, waits: [], yaku: null, fixable, discards: {}, best: [], bestWhy: null,
    bestRisky: false, bestSavedDora: false, safe: [], call: null, kan: {}, callKan: null, note: null, groups: null,
  };
  const isYakuhai = (k) => isDragon(k) || k === seatWind || k === roundWind;

  // 리치한 상대 기준 안전패(현물)
  const riichiOpp = view.players.filter((p) => p.seat !== view.me && p.riichi);
  if (riichiOpp.length > 0) {
    const sets = riichiOpp.map((p) => new Set(p.discards.map((d) => kindOf(d.id))));
    for (let k = 0; k < 34; k++) {
      if (counts[k] > 0 && sets.every((s) => s.has(k))) hints.safe.push(k);
    }
  }

  /** c(화료패 제외 손)에 k를 더해 화료할 때의 역 상태. 같은 패 4장을 이미 쥐고 있으면 null */
  const yakuOf = (c, k, extra = []) => {
    if (c[k] >= 4) return null;
    const cc = c.slice();
    cc[k]++;
    const base = { counts: cc, melds: [...melds, ...extra], winKind: k, seatWind, roundWind, riichi: me.riichi ? 1 : 0, rules };
    if (evaluateHand({ ...base, tsumo: false })) return 'ok';
    return evaluateHand({ ...base, tsumo: true }) ? 'tsumo' : 'none';
  };
  const waitInfo = (c, extra = []) => getWaits(c, mc + extra.length)
    .map((k) => ({ kind: k, remaining: Math.max(0, 4 - vis[k]), yaku: yakuOf(c, k, extra) }));

  if (hand.length % 3 === 2) {
    // 내 차례(14장): 어떤 패를 버릴지 평가
    hints.shanten = shanten(counts, mc);
    // 치·퐁 직후의 금지된 버림(쿠이카에)은 추천하지 않는다.
    const allowed = view.legal?.kind === 'turn' ? new Set(view.legal.discard.map(kindOf)) : null;
    const evals = {};
    for (const k of new Set(hand.map(kindOf))) {
      if (allowed && !allowed.has(k)) continue;
      counts[k]--;
      const s = shanten(counts, mc);
      let u = 0;
      if (s <= hints.shanten) {
        for (let j = 0; j < 34; j++) {
          const remain = 4 - vis[j];
          if (remain <= 0 || counts[j] >= 4) continue;
          counts[j]++;
          if (shanten(counts, mc) < s) u += remain;
          counts[j]--;
        }
      }
      const waits = s === 0 ? waitInfo(counts) : [];
      counts[k]++;
      evals[k] = { s, u, waits, yaku: s === 0 ? aggregate(waits) : null };
    }
    hints.discards = evals;

    const redOnly = new Set(hand.filter(isRedId).map(kindOf).filter((k) => counts[k] === 1));
    const penalty = (k) => (doraKinds.has(k) ? 2 : redOnly.has(k) ? 1 : 0);
    const yakuRank = (e) => {
      if (e.s !== 0 || !e.yaku || e.yaku === 'ok') return 0;
      return e.yaku === 'none' && !fixable ? 3 : 1;
    };
    const keyOf = (k) => { const e = evals[k]; return [e.s, yakuRank(e), -e.u, penalty(k), usefulness(k), k]; };
    const cmp = (a, b) => { const x = keyOf(a); const y = keyOf(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };

    const kindsLeft = Object.keys(evals).map(Number);
    const safePool = hints.safe.filter((k) => evals[k]);
    const fold = riichiOpp.length > 0 && hints.shanten >= 2 && safePool.length > 0;
    const pool = (fold ? safePool : kindsLeft).slice().sort(cmp);
    if (pool.length > 0) {
      const w = pool[0];
      hints.best = [w];
      hints.bestWhy = fold ? 'fold' : evals[w].s === 0 ? 'tenpai' : 'speed';
      hints.bestRisky = !fold && riichiOpp.length > 0 && !hints.safe.includes(w);
      const kw = keyOf(w);
      hints.bestSavedDora = !fold && penalty(w) === 0
        && pool.some((k) => k !== w && penalty(k) > 0 && keyOf(k).slice(0, 3).join() === kw.slice(0, 3).join());
    }

    if (view.legal?.kind === 'turn' && hints.shanten >= 0) {
      for (const k of view.legal.ankan || []) hints.kan[k] = adviseKan('ankan', k);
      for (const id of view.legal.kakan || []) hints.kan[kindOf(id)] = adviseKan('kakan', kindOf(id));
    }
    if (view.legal?.kind === 'turn' && view.legal.tsumo) hints.note = '쯔모 화료가 가능해요!';
    else if (hints.shanten === -1) hints.note = '모양은 완성됐지만 역이 없어서 화료할 수 없어요. 역이 생기도록 패를 바꿔 보세요.';
  } else if (hand.length % 3 === 1) {
    hints.shanten = shanten(counts, mc);
    if (hints.shanten === 0) {
      hints.waits = waitInfo(counts);
      hints.yaku = aggregate(hints.waits);
    }
  }

  // 손패 묶음 표시: 일반형이 최선일 때만(치또이츠·국사 모양이 더 가까우면 생략)
  if (hand.length % 3 !== 0) {
    const gp = bestGrouping(counts, mc, vis);
    if (gp.s <= shanten(counts, mc)) hints.groups = gp.groups;
  }

  if (view.legal?.kind === 'reaction') {
    const lg = view.legal;
    const tk = kindOf(lg.tile);
    if (lg.pon) {
      const k = tk;
      const seatW = 27 + me.wind;
      const roundW = 27 + view.roundWind;
      if (isDragon(k) || k === seatW || k === roundW) {
        const names = [];
        if (isDragon(k)) names.push('역패');
        if (k === seatW) names.push('자풍');
        if (k === roundW) names.push('장풍');
        hints.note = `퐁하면 ${names.join('+')}으로 역이 생겨요.`;
      }
    }
    if (hand.length % 3 === 1 && (lg.pon || lg.chi)) hints.call = callHint(lg, tk);
    if (hand.length % 3 === 1 && lg.daiminkan && hints.shanten >= 0) hints.callKan = adviseDaiminkan(tk);
  }
  return hints;

  /**
   * 암깡·가깡을 해도 되는지 판정한다(초보 기준). 모양이 나빠지지 않고 위험이 없을 때만 권한다.
   * @param {'ankan'|'kakan'} type
   * @param {number} k 깡할 패 종류
   * @returns {{advice:'yes'|'maybe'|'no', why:string}} why: worse·riichi-keep·riichi-danger·waits-drop·ankan·kakan
   */
  function adviseKan(type, k) {
    const c = counts.slice();
    c[k] -= type === 'ankan' ? 4 : 1;
    const after = shanten(c, type === 'ankan' ? mc + 1 : mc);
    if (after > hints.shanten) return { advice: 'no', why: 'worse' };
    if (me.riichi) return { advice: 'yes', why: 'riichi-keep' };
    if (riichiOpp.length > 0) return { advice: 'maybe', why: 'riichi-danger' };
    if (hints.shanten === 0 && after === 0) {
      const rem = (ws) => ws.reduce((a, w) => a + w.remaining, 0);
      const kanRem = rem(waitInfo(c, type === 'ankan' ? [{ type: 'ankan', k }] : []));
      const bestRem = Math.max(0, ...Object.values(hints.discards).filter((e) => e.s === 0).map((e) => rem(e.waits)));
      if (kanRem < bestRem) return { advice: 'maybe', why: 'waits-drop' };
    }
    return { advice: 'yes', why: type };
  }

  /** 대명깡(남이 버린 패로 깡) 판정. 문전이 깨지고 상대 도라도 늘어서 초보에겐 대개 권하지 않는다. */
  function adviseDaiminkan(tk) {
    const c = counts.slice();
    c[tk] -= 3;
    if (shanten(c, mc + 1) > hints.shanten) return { advice: 'no', why: 'worse' };
    if (isYakuhai(tk)) return { advice: 'maybe', why: 'dai-yakuhai' };
    return fixable ? { advice: 'no', why: 'dai-open' } : { advice: 'maybe', why: 'dai-opened' };
  }

  /** 퐁·치를 했을 때의 변화: 향청수, 문전 상실, 텐파이가 된다면 역 유무 */
  function callHint(lg, tk) {
    const opts = [];
    if (lg.pon) {
      const c = counts.slice();
      c[tk] -= 2;
      opts.push({ type: 'pon', meld: { type: 'pon', k: tk }, c, ban: [tk] });
    }
    for (const o of lg.chi || []) {
      const c = counts.slice();
      o.ids.forEach((id) => { c[kindOf(id)]--; });
      const low = Math.min(tk, ...o.ids.map(kindOf));
      opts.push({ type: 'chi', meld: { type: 'chi', k: low }, c, ban: o.ban || [tk] });
    }
    const isSimpleMeld = (m) => m.k < 27 && (m.type === 'chi' ? m.k % 9 >= 1 && m.k % 9 <= 5 : !isTerminal(m.k));
    for (const o of opts) {
      o.after = shanten(o.c, mc + 1);
      o.yakuAfter = null;
      if (o.after === 0) {
        // 울고 나서 버릴 패를 골라 텐파이가 될 때 가장 좋은 역 상태
        for (let k2 = 0; k2 < 34; k2++) {
          if (o.c[k2] <= 0 || o.ban.includes(k2)) continue;
          o.c[k2]--;
          if (shanten(o.c, mc + 1) === 0) {
            const ag = aggregate(waitInfo(o.c, [o.meld]));
            if (ag && (o.yakuAfter === null || YAKU_ORDER[ag] < YAKU_ORDER[o.yakuAfter])) o.yakuAfter = ag;
          }
          o.c[k2]++;
        }
      }
      // 울고 나서 역이 거의 확실한가: 역패 퐁이 있거나, 쿠이탕 on에 전부 2~8 수패
      const all = [...melds, o.meld];
      const yakuhai = all.some((m) => m.type !== 'chi' && isYakuhai(m.k));
      const tanyao = rules.kuitan && all.every(isSimpleMeld)
        && o.c.every((n, k) => n === 0 || (k < 27 && !isTerminal(k)));
      o.sure = yakuhai || tanyao;
      Object.assign(o, adviseCall(o));
    }
    const RANK = { yes: 0, maybe: 1, no: 2 };
    const pick = opts.reduce((a, o) => (!a || RANK[o.advice] < RANK[a.advice]
      || (o.advice === a.advice && o.after < a.after) ? o : a), null);
    return {
      type: pick.type, before: hints.shanten, after: pick.after, opens: fixable, yakuAfter: pick.yakuAfter,
      advice: pick.advice, why: pick.why,
    };
  }

  /**
   * 울어도 되는지 판정한다(초보 기준). 속도가 빨라지고 역이 확실할 때만 권한다.
   * @returns {{advice:'yes'|'maybe'|'no', why:string}} why: slower·same·yaku-gain·no-yaku·tenpai-yaku·tsumo-only·partial·yaku-sure·closed-no-yaku·open-no-yaku
   */
  function adviseCall(o) {
    const before = hints.shanten;
    const yk = o.yakuAfter;
    if (o.after > before) return { advice: 'no', why: 'slower' };
    if (o.after === before) {
      // 이미 텐파이: 지금 역이 없는데 울면 역이 생길 때만 의미가 있다
      if (before === 0 && yk === 'ok' && hints.yaku && hints.yaku !== 'ok') return { advice: 'yes', why: 'yaku-gain' };
      return { advice: 'no', why: 'same' };
    }
    if (o.after === 0) {
      if (yk === 'ok') return { advice: 'yes', why: 'tenpai-yaku' };
      if (yk === 'none') return { advice: 'no', why: 'no-yaku' };
      return { advice: 'maybe', why: yk === 'tsumo' ? 'tsumo-only' : 'partial' };
    }
    if (o.sure) return { advice: 'yes', why: 'yaku-sure' };
    return fixable ? { advice: 'no', why: 'closed-no-yaku' } : { advice: 'maybe', why: 'open-no-yaku' };
  }
}
