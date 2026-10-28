/**
 * @fileoverview 초보 도우미 힌트. 본인 시점 뷰만으로 향청수·대기패·안전패·추천 버림을 계산한다.
 *
 * 서버가 도우미를 켠 플레이어에게만 STATE와 함께 전달한다. 상대 손패 정보는 사용하지 않는다.
 */

import { kindOf, toCounts, isDragon } from './tiles.js';
import { shanten, getWaits } from './agari.js';
import { visibleCounts } from './ai.js';

/**
 * @param {object} view `MahjongGame#viewFor` 결과
 * @returns {object|null} 힌트(없으면 null)
 */
export function computeHints(view) {
  if (!view || !view.myHand || view.phase === 'over' || view.phase === 'ack') return null;
  const me = view.players[view.me];
  const mc = me.melds.length;
  const hand = view.myDrawn != null ? [...view.myHand, view.myDrawn] : view.myHand.slice();
  const counts = toCounts(hand);
  const vis = visibleCounts(view);
  const hints = { shanten: null, waits: [], discards: {}, best: [], safe: [], note: null };

  // 리치한 상대 기준 안전패(현물)
  const riichiOpp = view.players.filter((p) => p.seat !== view.me && p.riichi);
  if (riichiOpp.length > 0) {
    const sets = riichiOpp.map((p) => new Set(p.discards.map((d) => kindOf(d.id))));
    for (let k = 0; k < 34; k++) {
      if (counts[k] > 0 && sets.every((s) => s.has(k))) hints.safe.push(k);
    }
  }

  const waitInfo = (c) => getWaits(c, mc).map((k) => ({ kind: k, remaining: Math.max(0, 4 - vis[k]) }));

  if (hand.length % 3 === 2) {
    // 내 차례(14장): 어떤 패를 버릴지 평가
    hints.shanten = shanten(counts, mc);
    let bestS = 9;
    const evals = {};
    for (const k of new Set(hand.map(kindOf))) {
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
      evals[k] = { s, u, waits };
      bestS = Math.min(bestS, s);
    }
    hints.discards = evals;
    const top = Object.entries(evals).filter(([, e]) => e.s === bestS);
    const maxU = Math.max(...top.map(([, e]) => e.u));
    hints.best = top.filter(([, e]) => e.u === maxU).map(([k]) => +k);
    if (view.legal?.kind === 'turn' && view.legal.tsumo) hints.note = '쯔모 화료가 가능해요!';
  } else if (hand.length % 3 === 1) {
    hints.shanten = shanten(counts, mc);
    if (hints.shanten === 0) hints.waits = waitInfo(counts);
  }

  if (view.legal?.kind === 'reaction' && view.legal.pon) {
    const k = kindOf(view.legal.tile);
    const seatWind = 27 + me.wind;
    const roundWind = 27 + view.roundWind;
    if (isDragon(k) || k === seatWind || k === roundWind) {
      const names = [];
      if (isDragon(k)) names.push('역패');
      if (k === seatWind) names.push('자풍');
      if (k === roundWind) names.push('장풍');
      hints.note = `퐁하면 ${names.join('+')}으로 역이 생겨요.`;
    }
  }
  return hints;
}
