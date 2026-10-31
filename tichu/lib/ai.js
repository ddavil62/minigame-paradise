/**
 * @fileoverview 티추 AI(easy / normal / hard). `viewFor(seat)`가 주는 뷰와 공개 정보만 쓴다(`game.h` 직접 접근 금지).
 *
 * 공통: 낼 수 있으면 손패를 가장 많이 털어내는 낮은 조합을 먼저 내고, 파트너가 이기고 있으면 패스한다.
 * easy: 가끔 무작위로 패스하고 티추 콜·폭탄 끼어들기를 하지 않는다.
 * normal: 강한 손이면 티추를 부르고 상대가 곧 나갈 때 폭탄으로 끊는다. hard: 콜 기준이 더 엄격하고 특수 카드를 아낀다.
 */
import { DOG, MJ, PHX, DRG, rankOf } from './cards.js';
import { enumeratePlays, bombsIn } from './combos.js';

const team = (s) => s % 2;

/** @param {number[]} hand 손패(8장 또는 14장) @returns {number} 손의 강도 점수 */
export function handStrength(hand) {
  let s = 0;
  const cnt = new Map();
  for (const id of hand) {
    if (id === DRG) s += 3;
    else if (id === PHX) s += 2.5;
    else if (id === DOG) s += 0.5;
    else if (id !== MJ) {
      const r = rankOf(id);
      cnt.set(r, (cnt.get(r) || 0) + 1);
      if (r === 14) s += 1.5;
      else if (r === 13) s += 0.6;
    }
  }
  for (const c of cnt.values()) if (c === 4) s += 3;
  return s;
}

const CALL_THRESHOLD = {
  normal: { grand: 6.5, tichu: 9.5 },
  hard: { grand: 7.5, tichu: 9 },
};

/** 교환에서 내가 아끼는 정도: 높을수록 내 손에 둔다. */
function keepValue(id, hand) {
  if (id === DRG) return 100;
  if (id === PHX) return 90;
  if (id === DOG) return 6;
  if (id === MJ) return 8;
  const r = rankOf(id);
  const same = hand.filter((x) => x < 52 && rankOf(x) === r).length;
  return r + (same - 1) * 6 + (same === 4 ? 40 : 0);
}

function pickExchange(hand) {
  const left = hand.slice().sort((a, b) => keepValue(a, hand) - keepValue(b, hand));
  const [low1, low2, ...rest] = left;
  // 파트너에게는 쓸모 있는 높은 카드(에이스 등)를 준다. 용·봉황은 내가 쓴다.
  const gift = rest.filter((id) => id !== DRG && id !== PHX && id !== DOG && id !== MJ)
    .sort((a, b) => rankOf(b) - rankOf(a))[0] ?? rest[rest.length - 1];
  return [low1, gift, low2];
}

function pickWish(hand, rng) {
  const mine = new Set(hand.filter((id) => id < 52).map(rankOf));
  const options = [];
  for (let r = 5; r <= 13; r++) if (!mine.has(r)) options.push(r);
  return options.length ? options[Math.floor(rng() * options.length)] : undefined;
}

function usesSpecial(c) { return c.ids.includes(DRG) || c.ids.includes(PHX); }

/**
 * @param {object} view `game.viewFor(seat)`의 결과
 * @param {{level?:string, rng?:() => number}} [opts] 난이도·난수
 * @returns {object|null} 행동(`act()`에 그대로 넣는다). 지금 할 일이 없으면 null
 */
export function decide(view, opts = {}) {
  const level = opts.level || 'normal';
  const rng = opts.rng || Math.random;
  const legal = view.legal;
  if (!legal) return null;
  const me = view.seat;
  const hand = view.hand;

  switch (legal.kind) {
    case 'grand': {
      const t = CALL_THRESHOLD[level];
      return { type: 'grand', on: !!t && handStrength(hand) >= t.grand };
    }
    case 'ack': return { type: 'next' };
    case 'gift': {
      const opts2 = legal.options.slice().sort((a, b) => view.counts[b] - view.counts[a]);
      return { type: 'gift', to: opts2[0] };
    }
    case 'exchange': {
      if (wantsTichu(view, level)) return { type: 'tichu' };
      return { type: 'exchange', give: pickExchange(hand) };
    }
    case 'turn': {
      if (legal.canTichu && wantsTichu(view, level)) return { type: 'tichu' };
      return decideTurn(view, legal, level, rng);
    }
    default: return null;
  }
}

function wantsTichu(view, level) {
  const t = CALL_THRESHOLD[level];
  if (!t || view.calls[view.seat] || !(view.legal && view.legal.canTichu)) return false;
  const mine = view.seat % 2;
  if (view.scores[mine] - view.scores[1 - mine] > 300) return false; // 크게 앞서면 모험하지 않는다
  return handStrength(view.hand) >= t.tichu;
}

function decideTurn(view, legal, level, rng) {
  const me = view.seat;
  const hand = view.hand;
  const top = view.trick.top;
  const topSeat = view.trick.topSeat;
  let plays = enumeratePlays(hand, top);
  if (legal.wish) plays = plays.filter((c) => c.ids.some((id) => id !== PHX && rankOf(id) === legal.wish));
  if (!plays.length) return { type: 'pass' };

  const act = (c) => {
    const a = { type: 'play', ids: c.ids };
    if (c.phx !== null && c.phx !== undefined && c.ids.length > 1) a.as = c.phx;
    if (c.ids.includes(MJ)) { const w = pickWish(hand, rng); if (w) a.wish = w; }
    return a;
  };

  // 한 번에 다 털 수 있으면 그게 최선
  const goOut = plays.find((c) => c.n === hand.length);
  if (goOut) return act(goOut);

  const opps = [(me + 1) % 4, (me + 3) % 4];
  const partner = (me + 2) % 4;
  const oppMin = Math.min(...opps.filter((s) => view.counts[s] > 0).map((s) => view.counts[s]), 99);
  const partnerActive = view.counts[partner] > 0;
  const nonBomb = plays.filter((c) => !c.bomb);

  if (!top) {
    // 선: 개는 파트너에게 선을 넘기는 공짜 카드라 일찍 쓴다.
    const dog = plays.find((c) => c.type === 'dog');
    if (dog && partnerActive && hand.length > 3 && !legal.wish) return act(dog);
    let pool = nonBomb.filter((c) => c.type !== 'dog' && !usesSpecial(c));
    if (!pool.length) pool = nonBomb.filter((c) => c.type !== 'dog');
    if (!pool.length) pool = plays.filter((c) => c.type !== 'dog');
    if (!pool.length) pool = plays;
    if (oppMin <= 1) {
      // 상대가 한 장 남았으면 싱글로 이끌면 나가 버린다: 다장 조합을 먼저, 싱글뿐이면 가장 높은 것으로.
      const multi = pool.filter((c) => c.n > 1);
      if (multi.length) pool = multi;
      else return act(pool.slice().sort((a, b) => b.rank - a.rank)[0]);
    }
    const score = (c) => c.rank - c.n * 2.2 + (c.ids.includes(PHX) ? 4 : 0) + (c.ids.includes(DRG) ? 9 : 0) + (c.bomb ? 20 : 0);
    pool.sort((a, b) => score(a) - score(b));
    return act(level === 'easy' && rng() < 0.2 ? pool[Math.floor(rng() * pool.length)] : pool[0]);
  }

  // 따라가기
  if (level === 'easy' && !legal.wish && rng() < 0.15) return { type: 'pass' };
  if (!legal.wish && (topSeat === partner || team(topSeat) === team(me))) return { type: 'pass' };
  const danger = oppMin <= 2;
  const cheap = nonBomb.filter((c) => !usesSpecial(c));
  const pts = view.trick.points;
  let choice = null;
  if (cheap.length) choice = cheap.slice().sort((a, b) => a.rank - b.rank || a.n - b.n)[0];
  if (!choice) {
    const special = nonBomb.filter((c) => !(c.ids.includes(DRG) && top.rank < 11 && !danger));
    const worthIt = danger || pts >= 20 || hand.length <= 4 || top.rank >= 12;
    if (special.length && (worthIt || level === 'easy')) choice = special.slice().sort((a, b) => a.rank - b.rank)[0];
  }
  if (choice) return act(choice);
  const bombs = plays.filter((c) => c.bomb);
  if (bombs.length && (danger || (top.type === 'single' && top.rank === 15)) && level !== 'easy') return act(bombs[0]);
  return legal.canPass ? { type: 'pass' } : act(plays[0]);
}

/**
 * 내 차례가 아닐 때 폭탄으로 끼어들지 판단한다(상대가 곧 나가거나 용을 냈을 때).
 * @param {object} view 뷰 @param {{level?:string}} [opts] 난이도
 * @returns {object|null} 폭탄 `play` 행동 또는 null
 */
export function decideInterrupt(view, opts = {}) {
  const level = opts.level || 'normal';
  if (level === 'easy') return null;
  const legal = view.legal;
  const top = view.trick.top;
  if (!legal || legal.kind !== 'wait' || !legal.canBomb || !top) return null;
  const me = view.seat;
  const topSeat = view.trick.topSeat;
  if (team(topSeat) === team(me)) return null;
  const nearOut = view.counts[topSeat] <= 2;
  const dragon = top.type === 'single' && top.rank === 15;
  const hot = view.calls[topSeat] && view.counts[topSeat] <= 5;
  if (!(nearOut || dragon || (level === 'hard' && hot))) return null;
  const bombs = bombsIn(view.hand, top).sort((a, b) => a.n - b.n || a.rank - b.rank);
  return bombs.length ? { type: 'play', ids: bombs[0].ids } : null;
}

/**
 * 시간 초과·자리 비움일 때 서버가 대신 낼 행동(가장 무난한 선택).
 * @param {object} view 뷰 @returns {object|null} 행동
 */
export function fallbackAction(view) {
  const legal = view.legal;
  if (!legal) return null;
  switch (legal.kind) {
    case 'grand': return { type: 'grand', on: false };
    case 'ack': return { type: 'next' };
    case 'gift': return { type: 'gift', to: legal.options.slice().sort((a, b) => view.counts[b] - view.counts[a])[0] };
    case 'exchange': return { type: 'exchange', give: pickExchange(view.hand) };
    case 'turn': return decideTurn(view, legal, 'normal', () => 0.5);
    default: return null;
  }
}
