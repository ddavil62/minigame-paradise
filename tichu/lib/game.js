/**
 * @fileoverview 티추 대국 상태 머신. 모든 규칙 판정은 여기서만 일어난다(서버 권위).
 *
 * 좌석 0~3은 시계 방향이고 팀은 `seat % 2`(0·2 대 1·3)다. 맞은편이 파트너다.
 * 진행 대기 상태는 `pending`이 단일 기준이다:
 *   grand(그랜드 티추 선택) · exchange(카드 3장 교환) · turn(낼 차례) · gift(용 트릭 선물) · ack(라운드 결과 확인) · null(종료)
 * 모든 변경은 `act(seat, action)`으로만 일어나고 불법 행동은 `{ok:false, error}`로 거절된다.
 * 내 차례가 아니어도 낼 수 있는 행동은 폭탄(`play`)과 티추 콜(`tichu`)뿐이다.
 */
import {
  DOG, MJ, PHX, DRG, rankOf, pointsSum, sortHand, shuffle, fullDeck,
} from './cards.js';
import { pickCombo, enumeratePlays, bombsIn, phoenixChoices } from './combos.js';

export const DEFAULT_SETTINGS = Object.freeze({ target: 1000, grand: true, bombWindowMs: 2000 });

const team = (seat) => seat % 2;
const partnerOf = (seat) => (seat + 2) % 4;
const fail = (error) => ({ ok: false, error });
const hasRealRank = (combo, r) => combo.ids.some((id) => id !== PHX && rankOf(id) === r);

export class TichuGame {
  /**
   * @param {{settings?:object, rng?:() => number, now?:() => number}} [opts] 옵션
   */
  constructor(opts = {}) {
    this.settings = { ...DEFAULT_SETTINGS, ...(opts.settings || {}) };
    this.rng = opts.rng || Math.random;
    this.now = opts.now || (() => Date.now());
    this.roundNo = 0;
    this.scores = [0, 0];
    this.phase = 'init';
    this.pending = null;
    this.events = [];
    this.result = null;
    this.final = null;
    this.h = null;
  }

  /** 첫 라운드를 시작한다. */
  start() { this.startRound(); }

  drainEvents() { const e = this.events; this.events = []; return e; }
  emit(e) { this.events.push(e); }

  // ── 라운드 시작 ──────────────────────────────────────────
  startRound() {
    this.roundNo++;
    const deck = shuffle(fullDeck(), this.rng);
    this.h = {
      hands: [0, 1, 2, 3].map((s) => sortHand(deck.slice(s * 8, s * 8 + 8))),
      rest: deck.slice(32),
      won: [[], [], [], []],
      calls: [null, null, null, null],
      started: [false, false, false, false],
      out: [],
      picks: {},
      received: [[], [], [], []],
      given: [[], [], [], []],
      trick: this.newTrick(),
      wish: null,
      openAt: 0,
    };
    this.result = null;
    this.emit({ t: 'deal', round: this.roundNo });
    if (this.settings.grand) {
      this.phase = 'grand';
      this.pending = { type: 'grand', responses: {} };
    } else {
      this.dealRest();
    }
  }

  newTrick() { return { plays: [], top: null, topSeat: -1, passed: new Set(), pile: [] }; }

  dealRest() {
    const h = this.h;
    for (let s = 0; s < 4; s++) h.hands[s] = sortHand([...h.hands[s], ...h.rest.slice(s * 6, s * 6 + 6)]);
    h.rest = [];
    this.phase = 'exchange';
    this.pending = { type: 'exchange', done: {} };
    this.emit({ t: 'dealrest' });
  }

  // ── 행동 진입점 ──────────────────────────────────────────
  /**
   * @param {number} seat 좌석 @param {object} a 행동
   * @returns {{ok:boolean, error?:string}} 결과
   */
  act(seat, a) {
    if (!a || typeof a.type !== 'string' || !(seat >= 0 && seat < 4)) return fail('bad_action');
    switch (a.type) {
      case 'grand': return this.actGrand(seat, a);
      case 'exchange': return this.actExchange(seat, a);
      case 'tichu': return this.actTichu(seat);
      case 'play': return this.actPlay(seat, a);
      case 'pass': return this.actPass(seat);
      case 'gift': return this.actGift(seat, a);
      case 'next': return this.actNext(seat);
      default: return fail('bad_action');
    }
  }

  actGrand(seat, a) {
    const p = this.pending;
    if (!p || p.type !== 'grand' || p.responses[seat] !== undefined) return fail('not_allowed');
    p.responses[seat] = !!a.on;
    if (Object.keys(p.responses).length < 4) return { ok: true };
    for (let s = 0; s < 4; s++) {
      if (p.responses[s]) { this.h.calls[s] = 'grand'; this.emit({ t: 'call', seat: s, call: 'grand' }); }
    }
    this.dealRest();
    return { ok: true };
  }

  actExchange(seat, a) {
    const p = this.pending;
    const h = this.h;
    if (!p || p.type !== 'exchange' || p.done[seat]) return fail('not_allowed');
    const give = a.give;
    if (!Array.isArray(give) || give.length !== 3 || new Set(give).size !== 3) return fail('bad_action');
    if (!give.every((id) => Number.isInteger(id) && h.hands[seat].includes(id))) return fail('illegal');
    h.picks[seat] = give.slice();
    p.done[seat] = true;
    this.emit({ t: 'picked', seat });
    if (Object.keys(p.done).length === 4) this.performExchange();
    return { ok: true };
  }

  performExchange() {
    const h = this.h;
    for (let g = 0; g < 4; g++) {
      const to = [(g + 1) % 4, (g + 2) % 4, (g + 3) % 4];
      h.hands[g] = h.hands[g].filter((id) => !h.picks[g].includes(id));
      h.picks[g].forEach((id, i) => {
        h.received[to[i]].push({ from: g, id });
        h.given[g].push({ to: to[i], id });
      });
    }
    for (let s = 0; s < 4; s++) {
      h.hands[s] = sortHand([...h.hands[s], ...h.received[s].map((r) => r.id)]);
    }
    this.phase = 'play';
    this.emit({ t: 'exchanged' });
    const leader = h.hands.findIndex((hand) => hand.includes(MJ));
    this.pending = { type: 'turn', seat: leader };
    this.emit({ t: 'start', seat: leader });
  }

  /** 티추(일반) 콜: 첫 카드를 내기 전까지 언제든, 내 차례가 아니어도 부를 수 있다. */
  actTichu(seat) {
    const h = this.h;
    if (!h || (this.phase !== 'exchange' && this.phase !== 'play')) return fail('not_allowed');
    if (h.calls[seat] || h.started[seat] || h.hands[seat].length !== 14) return fail('not_allowed');
    h.calls[seat] = 'tichu';
    this.emit({ t: 'call', seat, call: 'tichu' });
    return { ok: true };
  }

  actNext(seat) {
    const p = this.pending;
    if (!p || p.type !== 'ack' || p.acks.has(seat)) return fail('not_allowed');
    p.acks.add(seat);
    if (p.acks.size < 4) return { ok: true };
    if (this.result.over) {
      this.phase = 'over';
      this.pending = null;
      this.final = { scores: this.scores.slice(), winner: this.result.winner, rounds: this.roundNo };
      this.emit({ t: 'over', winner: this.result.winner });
    } else {
      this.startRound();
    }
    return { ok: true };
  }

  // ── 플레이 ──────────────────────────────────────────────
  active(seat) { return this.h.hands[seat].length > 0; }

  /** @param {number} from 기준 좌석 @returns {number} 시계 방향으로 다음에 카드가 남은 좌석(없으면 -1) */
  nextActive(from) {
    for (let i = 1; i <= 4; i++) {
      const s = (from + i) % 4;
      if (this.active(s)) return s;
    }
    return -1;
  }

  /** 소원이 걸려 있고 내가 소원 숫자가 든 합법 조합을 낼 수 있으면 그 숫자, 아니면 null. */
  mustWish(seat) {
    const h = this.h;
    if (!h.wish) return null;
    const hand = h.hands[seat];
    if (!hand.some((id) => id !== PHX && rankOf(id) === h.wish)) return null;
    return enumeratePlays(hand, h.trick.top).some((c) => hasRealRank(c, h.wish)) ? h.wish : null;
  }

  actPlay(seat, a) {
    const p = this.pending;
    const h = this.h;
    if (this.phase !== 'play' || !p || p.type !== 'turn' || !this.active(seat)) return fail('not_turn');
    const ids = a.ids;
    if (!Array.isArray(ids) || !ids.length || !ids.every((id) => Number.isInteger(id) && h.hands[seat].includes(id))) return fail('illegal');
    const top = h.trick.top;
    const mine = p.seat === seat;
    if (!mine && !top) return fail('not_turn');
    const combo = pickCombo(ids, top, { as: a.as, outOfTurn: !mine });
    if (!combo) return fail(!mine && pickCombo(ids, top, { as: a.as }) ? 'not_turn' : 'illegal');
    if (mine) {
      const w = this.mustWish(seat);
      if (w && !hasRealRank(combo, w)) return fail('wish');
      if (top && !combo.bomb && this.settings.bombWindowMs > 0 && this.now() < h.openAt) return fail('wait');
    }

    h.hands[seat] = h.hands[seat].filter((id) => !ids.includes(id));
    h.started[seat] = true;
    this.emit({ t: 'play', seat, combo: summary(combo), outOfTurn: !mine });

    if (combo.type === 'dog') {
      h.won[seat].push(DOG);
      const lead = this.dogTarget(seat);
      if (!h.hands[seat].length) this.goOut(seat);
      this.emit({ t: 'dog', seat, to: lead });
      if (this.roundOver()) { this.finishRound(); return { ok: true }; }
      h.trick = this.newTrick();
      this.pending = { type: 'turn', seat: lead };
      h.openAt = 0;
      return { ok: true };
    }

    const tr = h.trick;
    tr.plays.push({ seat, combo });
    tr.top = combo;
    tr.topSeat = seat;
    tr.passed.clear();
    tr.pile.push(...ids);
    h.openAt = this.now() + this.settings.bombWindowMs;

    if (combo.ids.includes(MJ)) {
      const w = Number.isInteger(a.wish) && a.wish >= 2 && a.wish <= 14 ? a.wish : null;
      h.wish = w;
      if (w) this.emit({ t: 'wish', seat, rank: w });
    }
    if (h.wish && hasRealRank(combo, h.wish)) { h.wish = null; this.emit({ t: 'wishdone', seat }); }

    if (!h.hands[seat].length) this.goOut(seat);
    if (this.roundOver()) { this.resolveTrick(); return { ok: true }; }
    this.pending = { type: 'turn', seat: this.nextActive(seat) };
    return { ok: true };
  }

  /** 개를 낸 사람 다음에 선이 되는 좌석: 파트너, 파트너가 나갔으면 파트너 다음 사람. */
  dogTarget(seat) {
    const partner = partnerOf(seat);
    return [partner, (partner + 1) % 4, (seat + 1) % 4].find((s) => s !== seat && this.active(s)) ?? -1;
  }

  goOut(seat) {
    this.h.out.push(seat);
    this.emit({ t: 'out', seat, place: this.h.out.length });
  }

  roundOver() {
    const o = this.h.out;
    return o.length >= 3 || (o.length === 2 && team(o[0]) === team(o[1]));
  }

  actPass(seat) {
    const p = this.pending;
    const h = this.h;
    if (this.phase !== 'play' || !p || p.type !== 'turn' || p.seat !== seat) return fail('not_turn');
    const tr = h.trick;
    if (!tr.top) return fail('must_lead');
    if (this.mustWish(seat)) return fail('wish');
    if (this.settings.bombWindowMs > 0 && this.now() < h.openAt) return fail('wait');
    h.started[seat] = true;
    tr.passed.add(seat);
    this.emit({ t: 'pass', seat });
    const waiting = [0, 1, 2, 3].filter((s) => this.active(s) && s !== tr.topSeat && !tr.passed.has(s));
    if (!waiting.length) this.resolveTrick();
    else this.pending = { type: 'turn', seat: this.nextActive(seat) };
    return { ok: true };
  }

  /** 트릭이 끝났다: 이긴 사람이 가져가고(용이면 상대 팀에게 선물) 선을 잡는다. */
  resolveTrick() {
    const h = this.h;
    const tr = h.trick;
    const winner = tr.topSeat;
    const points = pointsSum(tr.pile);
    this.emit({ t: 'trickwin', seat: winner, points, n: tr.pile.length, bomb: tr.top.bomb });
    if (tr.top.type === 'single' && tr.top.rank === 15) {
      const opps = [(winner + 1) % 4, (winner + 3) % 4];
      const alive = opps.filter((s) => this.active(s));
      const options = alive.length ? alive : opps;
      if (options.length === 1) { this.giveTrick(winner, options[0]); return; }
      this.pending = { type: 'gift', seat: winner, options };
      this.emit({ t: 'dragon', seat: winner, points });
      return;
    }
    this.giveTrick(winner, winner);
  }

  actGift(seat, a) {
    const p = this.pending;
    if (!p || p.type !== 'gift' || p.seat !== seat || !p.options.includes(a.to)) return fail('not_allowed');
    this.giveTrick(seat, a.to);
    return { ok: true };
  }

  giveTrick(winner, to) {
    const h = this.h;
    const pile = h.trick.pile;
    if (to !== winner) this.emit({ t: 'gift', seat: winner, to, points: pointsSum(pile) });
    h.won[to].push(...pile);
    h.trick = this.newTrick();
    h.openAt = 0;
    if (this.roundOver()) { this.finishRound(); return; }
    this.pending = { type: 'turn', seat: this.active(winner) ? winner : this.nextActive(winner) };
  }

  // ── 라운드 정산 ──────────────────────────────────────────
  finishRound() {
    const h = this.h;
    const out = h.out;
    const oneTwo = out.length >= 2 && team(out[0]) === team(out[1]);
    const cardPts = [0, 0];
    let lastSeat = -1;
    let lastHand = [];
    if (oneTwo) {
      cardPts[team(out[0])] = 200;
    } else {
      lastSeat = [0, 1, 2, 3].find((s) => !out.includes(s));
      lastHand = h.hands[lastSeat].slice();
      h.won[out[0]].push(...h.won[lastSeat]);
      h.won[lastSeat] = [];
      cardPts[1 - team(lastSeat)] += pointsSum(lastHand);
      for (let s = 0; s < 4; s++) cardPts[team(s)] += pointsSum(h.won[s]);
    }
    const bonus = [0, 0];
    const tichu = [];
    for (let s = 0; s < 4; s++) {
      const c = h.calls[s];
      if (!c) continue;
      const ok = out[0] === s;
      bonus[team(s)] += (c === 'grand' ? 200 : 100) * (ok ? 1 : -1);
      tichu.push({ seat: s, call: c, ok });
    }
    const total = [cardPts[0] + bonus[0], cardPts[1] + bonus[1]];
    this.scores = [this.scores[0] + total[0], this.scores[1] + total[1]];
    const reached = this.scores.some((x) => x >= this.settings.target);
    const over = reached && this.scores[0] !== this.scores[1];
    this.result = {
      round: this.roundNo,
      order: out.slice().concat(lastSeat >= 0 ? [lastSeat] : []),
      oneTwo,
      cardPts,
      bonus,
      total,
      scores: this.scores.slice(),
      tichu,
      lastSeat,
      lastHand,
      over,
      winner: over ? (this.scores[0] > this.scores[1] ? 0 : 1) : null,
    };
    this.phase = 'roundEnd';
    this.pending = { type: 'ack', acks: new Set() };
    this.emit({ t: 'round', total, oneTwo, over });
  }

  // ── 대기 상태 질의 ───────────────────────────────────────
  /** @returns {number[]} 지금 행동해야 하는 좌석(서버 타이머·AI 스케줄용) */
  waitingSeats() {
    const p = this.pending;
    if (!p) return [];
    switch (p.type) {
      case 'grand': return [0, 1, 2, 3].filter((s) => p.responses[s] === undefined);
      case 'exchange': return [0, 1, 2, 3].filter((s) => !p.done[s]);
      case 'turn': case 'gift': return [p.seat];
      default: return [0, 1, 2, 3].filter((s) => !p.acks.has(s));
    }
  }

  /** 티추 콜이 가능한가(첫 카드를 내기 전). */
  canCall(seat) {
    const h = this.h;
    return (this.phase === 'exchange' || this.phase === 'play') && !h.calls[seat] && !h.started[seat] && h.hands[seat].length === 14;
  }

  /**
   * 지금 내가 할 수 있는 행동 요약. 클라이언트는 이것과 손패·트릭으로 버튼을 그린다.
   * @param {number} seat 좌석 @returns {object|null} `kind`: grand·exchange·turn·wait·gift·ack
   */
  legalFor(seat) {
    const p = this.pending;
    const h = this.h;
    if (!p) return null;
    const canTichu = this.canCall(seat);
    switch (p.type) {
      case 'grand': return p.responses[seat] === undefined ? { kind: 'grand' } : null;
      case 'exchange': return p.done[seat] ? { kind: 'exchangeDone', canTichu } : { kind: 'exchange', canTichu };
      case 'gift': return p.seat === seat ? { kind: 'gift', options: p.options.slice() } : null;
      case 'ack': return p.acks.has(seat) ? null : { kind: 'ack' };
      default: break;
    }
    if (!this.active(seat)) return null;
    const top = h.trick.top;
    const canBomb = !!top && bombsIn(h.hands[seat], top).length > 0;
    if (p.seat === seat) {
      const wish = this.mustWish(seat);
      return { kind: 'turn', lead: !top, canPass: !!top && !wish, wish, canTichu, canBomb };
    }
    return { kind: 'wait', canTichu, canBomb };
  }

  /**
   * 한 좌석에게 보이는 대국 상태. 상대 손패·산(남은 카드)은 들어가지 않는다.
   * @param {number} seat 좌석 @returns {object} 뷰
   */
  viewFor(seat) {
    const h = this.h;
    const p = this.pending;
    const grandPhase = this.phase === 'grand';
    const calls = h.calls.map((c, s) => (grandPhase && s !== seat ? null : c));
    const tr = h.trick;
    const view = {
      phase: this.phase,
      round: this.roundNo,
      scores: this.scores.slice(),
      settings: { ...this.settings },
      seat,
      hand: h.hands[seat].slice(),
      started: h.started[seat],
      counts: h.hands.map((x) => x.length),
      calls,
      out: h.out.slice(),
      pending: p ? { type: p.type, seat: p.seat } : null,
      grandDone: grandPhase ? [0, 1, 2, 3].map((s) => p.responses[s] !== undefined) : null,
      exchangeDone: this.phase === 'exchange' ? [0, 1, 2, 3].map((s) => !!p.done[s]) : null,
      ackDone: p && p.type === 'ack' ? [0, 1, 2, 3].map((s) => p.acks.has(s)) : null,
      received: this.phase === 'exchange' ? [] : h.received[seat].slice(),
      given: this.phase === 'exchange' ? [] : h.given[seat].slice(),
      myPicks: this.phase === 'exchange' && h.picks[seat] ? h.picks[seat].slice() : null,
      trick: {
        plays: tr.plays.map((x) => ({ seat: x.seat, ...summary(x.combo) })),
        top: tr.top ? summary(tr.top) : null,
        topSeat: tr.topSeat,
        passed: [...tr.passed],
        points: pointsSum(tr.pile),
      },
      wish: h.wish,
      openAt: h.openAt,
      legal: this.legalFor(seat),
      result: this.phase === 'roundEnd' || this.phase === 'over' ? this.result : null,
      final: this.final,
    };
    return view;
  }

  /** 클라이언트가 봉황 숫자를 고르게 할 때 쓰는 보조: 고른 카드의 봉황 해석 후보. */
  choicesFor(ids) { return phoenixChoices(ids, this.h.trick.top); }
}

/** @param {object} c 조합 @returns {object} 직렬화용 요약 */
export function summary(c) {
  return { ids: c.ids.slice(), type: c.type, rank: c.rank, n: c.n, phx: c.phx, bomb: c.bomb };
}

export { DOG, MJ, PHX, DRG };
