/**
 * @fileoverview 일본식 리치마작 대국 상태 머신(서버 권위, 순수 로직).
 *
 * - 좌석은 0~3 고정이며 좌석 0이 첫 친(동가)이다. 친은 `roundNum % 4`이다.
 * - 진행 대기 상태는 `pending`이 단일 기준이다:
 *   `turn`(해당 좌석이 버림/쯔모/깡 선택), `reaction`(버림패·깡패에 대한 론/울기 응답),
 *   `ack`(국 결과 확인), null(대국 종료).
 * - 모든 변경은 `act(seat, action)`을 통해서만 일어나며 불법 행동은 `{ok:false}`로 거절된다.
 * - 타이머·네트워크·AI 호출은 이 모듈 바깥(server.js)에서 처리한다.
 */

import {
  kindOf, isRedId, toCounts, shuffledTiles, sortTiles, doraFromIndicator, YAOCHUU_KINDS,
  isYaochuu,
} from './tiles.js';
import {
  evaluateHand, getWaits, basePoints, paymentOf, limitName,
} from './agari.js';

export const DEFAULT_SETTINGS = Object.freeze({
  length: 'east', // 'east' 동풍전 | 'half' 반장전
  aka: true,
  kuitan: true,
  startScore: 25000,
  returnScore: 30000,
});

const WIND_LABEL = ['동', '남', '서', '북'];

/**
 * @typedef {{type:'chi'|'pon'|'minkan'|'ankan'|'kakan', k:number, tiles:number[], from:number, called:number|null}} Meld
 */

export class MahjongGame {
  /**
   * @param {{settings?:object, rng?:() => number}} [opts] 설정과 난수 함수
   */
  constructor(opts = {}) {
    this.settings = { ...DEFAULT_SETTINGS, ...(opts.settings || {}) };
    this.rng = opts.rng || Math.random;
    this.events = [];
    this.scores = [0, 1, 2, 3].map(() => this.settings.startScore);
    this.roundNum = 0;
    this.honba = 0;
    this.kyotaku = 0;
    this.handNo = 0;
    /** @type {null|object} */ this.pending = null;
    /** @type {null|object} */ this.result = null;
    /** @type {null|object} */ this.final = null;
    /** @type {null|object} */ this.h = null;
  }

  // ── 기본 값 ──────────────────────────────────────────────
  get dealer() { return this.roundNum % 4; }
  get roundWindIndex() { return Math.min(3, Math.floor(this.roundNum / 4)); }
  get regularRounds() { return this.settings.length === 'half' ? 8 : 4; }
  get lastRoundNum() { return this.regularRounds + 4 - 1; }
  /** @param {number} seat 좌석 @returns {number} 자풍 인덱스(0 동) */
  seatWindIndex(seat) { return (seat - this.dealer + 4) % 4; }
  /** @returns {string} 국 표기(예: 동 1국) */
  roundLabel() { return `${WIND_LABEL[this.roundWindIndex]} ${(this.roundNum % 4) + 1}국`; }

  emit(ev) { this.events.push(ev); }
  /** @returns {object[]} 누적 이벤트를 비우고 반환 */
  drainEvents() { const e = this.events; this.events = []; return e; }

  // ── 시작 / 국 준비 ───────────────────────────────────────
  /** @returns {void} 대국을 시작한다. */
  start() { this.startHand(); }

  startHand() {
    const ids = shuffledTiles(this.rng);
    const dead = ids.slice(0, 14);
    const rest = ids.slice(14);
    const hands = [[], [], [], []];
    for (let i = 0; i < 52; i++) hands[i % 4].push(rest[i]);
    this.handNo += 1;
    this.result = null;
    this.h = {
      dead,
      wall: rest.slice(52),
      doraRevealed: 1,
      kanCount: 0,
      kanOwners: [],
      rinshanUsed: 0,
      hands: hands.map(sortTiles),
      melds: [[], [], [], []],
      discards: [[], [], [], []],
      turn: this.dealer,
      drawn: null,
      drawnRinshan: false,
      riichi: [0, 0, 0, 0],
      ippatsu: [false, false, false, false],
      riichiPending: null,
      furitenTemp: [false, false, false, false],
      furitenRiichi: [false, false, false, false],
      callsHappened: false,
      kuikaeBan: [],
      kanDoraPending: 0,
      lastDiscard: null,
      kakan: null,
    };
    this.emit({ t: 'hand_start', handNo: this.handNo, dealer: this.dealer, label: this.roundLabel(), honba: this.honba });
    this.beginDraw(this.dealer);
  }

  // ── 조회 헬퍼 ────────────────────────────────────────────
  doraIndicators() {
    const h = this.h;
    return Array.from({ length: h.doraRevealed }, (_, i) => h.dead[4 + 2 * i]);
  }

  uraIndicators() {
    const h = this.h;
    return Array.from({ length: h.doraRevealed }, (_, i) => h.dead[5 + 2 * i]);
  }

  /** @param {number} seat 좌석 @returns {number[]} 부로를 제외한 멘젠 패 개수 */
  concealedCounts(seat) { return toCounts(this.h.hands[seat]); }

  isMenzen(seat) { return this.h.melds[seat].every((m) => m.type === 'ankan'); }

  allTileIds(seat, extra = []) {
    const h = this.h;
    const ids = [...h.hands[seat], ...extra];
    for (const m of h.melds[seat]) ids.push(...m.tiles);
    return ids;
  }

  /** @param {number} seat 좌석 @returns {number[]} 대기 종류(쯔모 직후면 쯔모패를 뺀 13장 기준) */
  waitsOf(seat) {
    const h = this.h;
    const counts = this.concealedCounts(seat);
    if (h.hands[seat].length % 3 === 2) {
      if (h.turn !== seat || h.drawn == null) return [];
      counts[kindOf(h.drawn)]--;
    }
    return getWaits(counts, h.melds[seat].length);
  }

  /** @param {number} seat 좌석 @returns {boolean} 후리텐 여부 */
  isFuriten(seat) {
    const h = this.h;
    if (h.furitenTemp[seat] || h.furitenRiichi[seat]) return true;
    const waits = this.waitsOf(seat);
    if (waits.length === 0) return false;
    return h.discards[seat].some((d) => waits.includes(kindOf(d.id)));
  }

  /**
   * 화료 평가(역·판·부). 쯔모면 손패에 이미 화료패가 있고, 론이면 winId를 추가해 평가한다.
   * @returns {object|null}
   */
  evalWin(seat, winId, { tsumo, chankan = false, rinshan = false }) {
    const h = this.h;
    const ids = tsumo ? h.hands[seat] : [...h.hands[seat], winId];
    const counts = toCounts(ids);
    const all = this.allTileIds(seat, tsumo ? [] : [winId]);
    const doraKinds = this.doraIndicators().map((id) => doraFromIndicator(kindOf(id)));
    const uraKinds = h.riichi[seat] ? this.uraIndicators().map((id) => doraFromIndicator(kindOf(id))) : [];
    const countKinds = (kinds) => all.reduce((a, id) => a + kinds.filter((k) => k === kindOf(id)).length, 0);
    const fresh = !h.callsHappened && h.discards[seat].length === 0;
    const r = evaluateHand({
      counts,
      melds: h.melds[seat].map((m) => ({ type: m.type, k: m.k })),
      winKind: kindOf(winId),
      tsumo,
      seatWind: 27 + this.seatWindIndex(seat),
      roundWind: 27 + this.roundWindIndex,
      riichi: h.riichi[seat],
      ippatsu: h.ippatsu[seat],
      haitei: tsumo && h.wall.length === 0 && !rinshan,
      houtei: !tsumo && h.wall.length === 0 && !chankan,
      rinshan: tsumo && rinshan,
      chankan,
      tenhou: tsumo && fresh && seat === this.dealer,
      chiihou: tsumo && fresh && seat !== this.dealer,
      dora: countKinds(doraKinds),
      ura: countKinds(uraKinds),
      aka: this.settings.aka ? all.filter(isRedId).length : 0,
      rules: { kuitan: this.settings.kuitan },
    });
    if (r) {
      r.limit = limitName(r.han, r.fu, r.yakuman);
      this.attachHighlights(r, all, doraKinds, uraKinds);
    }
    return r;
  }

  /**
   * 각 역에 결과 화면에서 강조할 패 id 목록(hl)을 붙인다. 형태 역은 agari.js가 준 종류 목록을
   * 실제 패 id에 대응시키고, 도라류는 해당 패를 직접 고른다. 패와 무관한 역은 hl이 없다.
   * @param {{yaku:{name:string,hl?:number[]}[]}} r 평가 결과
   * @param {number[]} all 화료 손의 모든 패 id(멘젠 + 부로 + 화료패)
   * @param {number[]} doraKinds 도라 종류
   * @param {number[]} uraKinds 뒷도라 종류
   * @returns {void}
   */
  attachHighlights(r, all, doraKinds, uraKinds) {
    const byKind = (kinds) => {
      const used = new Set();
      const out = [];
      for (const k of kinds) {
        const id = all.find((t) => kindOf(t) === k && !used.has(t));
        if (id != null) { used.add(id); out.push(id); }
      }
      return out;
    };
    for (const y of r.yaku) {
      if (y.name === '도라') y.hl = all.filter((id) => doraKinds.includes(kindOf(id)));
      else if (y.name === '뒷도라') y.hl = all.filter((id) => uraKinds.includes(kindOf(id)));
      else if (y.name === '적도라') y.hl = all.filter(isRedId);
      else if (y.hl) y.hl = byKind(y.hl);
    }
  }

  canRon(seat, tileId, { chankan = false } = {}) {
    const k = kindOf(tileId);
    if (!this.waitsOf(seat).includes(k)) return null;
    if (this.isFuriten(seat)) return null;
    return this.evalWin(seat, tileId, { tsumo: false, chankan });
  }

  // ── 합법 행동 ────────────────────────────────────────────
  /** @param {number} seat 좌석 @returns {object|null} 해당 좌석이 지금 할 수 있는 행동 */
  legalFor(seat) {
    const p = this.pending;
    if (!p) return null;
    if (p.type === 'turn') return p.seat === seat ? this.legalTurn(seat) : null;
    if (p.type === 'reaction') {
      const o = p.eligible[seat];
      if (!o || p.responses[seat]) return null;
      return { kind: 'reaction', ...o, tile: p.tile, from: p.discarder };
    }
    if (p.type === 'ack') return p.acks.has(seat) ? null : { kind: 'ack' };
    return null;
  }

  legalTurn(seat) {
    const h = this.h;
    const hand = h.hands[seat];
    const info = { kind: 'turn', discard: [], riichi: [], riichiWaits: {}, tsumo: false, ankan: [], kakan: [], kyuushu: false };
    if (h.riichi[seat]) {
      info.discard = h.drawn != null ? [h.drawn] : [];
    } else {
      let ids = hand.filter((id) => !h.kuikaeBan.includes(kindOf(id)));
      if (ids.length === 0) ids = hand.slice();
      info.discard = ids;
    }
    if (h.drawn != null) {
      if (this.evalWin(seat, h.drawn, { tsumo: true, rinshan: h.drawnRinshan })) info.tsumo = true;
      const counts = this.concealedCounts(seat);
      const canKan = h.wall.length > 0 && h.kanCount < 4;
      if (canKan) {
        for (let k = 0; k < 34; k++) {
          if (counts[k] !== 4) continue;
          if (h.riichi[seat] && !this.ankanKeepsWaits(seat, k)) continue;
          info.ankan.push(k);
        }
        if (!h.riichi[seat]) {
          for (const m of h.melds[seat]) {
            if (m.type !== 'pon') continue;
            const id = hand.find((x) => kindOf(x) === m.k);
            if (id != null) info.kakan.push(id);
          }
        }
      }
      if (!h.callsHappened && h.discards[seat].length === 0) {
        const distinct = YAOCHUU_KINDS.filter((k) => counts[k] > 0).length;
        if (distinct >= 9) info.kyuushu = true;
      }
    }
    if (!h.riichi[seat] && h.wall.length >= 4 && this.scores[seat] >= 1000 && this.isMenzen(seat) && h.drawn != null) {
      const counts = this.concealedCounts(seat);
      for (const k of new Set(hand.map(kindOf))) {
        counts[k]--;
        const waits = getWaits(counts, h.melds[seat].length);
        counts[k]++;
        if (waits.length > 0) {
          info.riichi.push(...hand.filter((id) => kindOf(id) === k));
          info.riichiWaits[k] = waits;
        }
      }
    }
    return info;
  }

  /** 리치 후 암깡이 대기를 바꾸지 않는지(화료패로 깡 구성 + 대기 동일). */
  ankanKeepsWaits(seat, k) {
    const h = this.h;
    if (h.drawn == null || kindOf(h.drawn) !== k) return false;
    const before = toCounts(h.hands[seat]);
    before[kindOf(h.drawn)]--;
    const waitsBefore = getWaits(before, h.melds[seat].length);
    const after = toCounts(h.hands[seat]);
    after[k] -= 4;
    const waitsAfter = getWaits(after, h.melds[seat].length + 1);
    return waitsBefore.length > 0 && waitsBefore.length === waitsAfter.length
      && waitsBefore.every((w, i) => w === waitsAfter[i]);
  }

  /** 버림패에 대한 응답 옵션을 계산한다. */
  buildReactionOptions(discarder, tileId, rkind) {
    const h = this.h;
    const k = kindOf(tileId);
    const eligible = {};
    for (let i = 1; i < 4; i++) {
      const s = (discarder + i) % 4;
      const o = {};
      if (this.canRon(s, tileId, { chankan: rkind === 'kakan' })) o.ron = true;
      if (rkind === 'discard' && h.wall.length > 0 && !h.riichi[s]) {
        const mine = h.hands[s].filter((id) => kindOf(id) === k);
        if (mine.length >= 2 && this.hasDiscardAfterCall(s, mine.slice(0, 2), [k])) o.pon = true;
        if (mine.length >= 3 && h.kanCount < 4) o.daiminkan = true;
        if (i === 1 && k < 27) {
          const chi = this.chiOptions(s, k);
          if (chi.length) o.chi = chi;
        }
      }
      if (o.ron || o.pon || o.daiminkan || o.chi) eligible[s] = o;
    }
    return eligible;
  }

  hasDiscardAfterCall(seat, usedIds, banKinds) {
    const rest = this.h.hands[seat].filter((id) => !usedIds.includes(id));
    return rest.some((id) => !banKinds.includes(kindOf(id)));
  }

  /** 치 가능한 조합: [{ids:[a,b], ban:[kinds]}] */
  chiOptions(seat, k) {
    const hand = this.h.hands[seat];
    const n = k % 9;
    const base = k - n;
    const pick = (kind) => {
      const cand = hand.filter((id) => kindOf(id) === kind);
      if (!cand.length) return null;
      return cand.find((id) => !isRedId(id)) ?? cand[0];
    };
    const patterns = [[-2, -1], [-1, 1], [1, 2]];
    const out = [];
    for (const [a, b] of patterns) {
      if (n + a < 0 || n + b > 8) continue;
      const ia = pick(base + n + a);
      const ib = pick(base + n + b);
      if (ia == null || ib == null) continue;
      const ban = [k];
      if (a === -2 && n - 3 >= 0) ban.push(k - 3);
      if (a === 1 && n + 3 <= 8) ban.push(k + 3);
      if (!this.hasDiscardAfterCall(seat, [ia, ib], ban)) continue;
      out.push({ ids: [ia, ib], ban });
    }
    return out;
  }

  // ── 행동 처리 ────────────────────────────────────────────
  /**
   * 좌석의 행동을 처리한다.
   * @param {number} seat 좌석
   * @param {object} a 행동
   * @returns {{ok:boolean, error?:string}} 결과
   */
  act(seat, a) {
    const p = this.pending;
    if (!p || !a || typeof a.type !== 'string') return { ok: false, error: 'no_pending' };
    if (p.type === 'turn') {
      if (seat !== p.seat) return { ok: false, error: 'not_your_turn' };
      return this.actTurn(seat, a);
    }
    if (p.type === 'reaction') return this.actReaction(seat, a);
    if (p.type === 'ack') {
      if (a.type !== 'next') return { ok: false, error: 'bad_action' };
      p.acks.add(seat);
      if (p.acks.size >= 4) this.advanceAfterResult();
      return { ok: true };
    }
    return { ok: false, error: 'bad_state' };
  }

  actTurn(seat, a) {
    const h = this.h;
    const legal = this.legalTurn(seat);
    switch (a.type) {
      case 'discard': {
        if (!legal.discard.includes(a.id)) return { ok: false, error: 'illegal_discard' };
        const declare = !!a.riichi;
        if (declare && !legal.riichi.includes(a.id)) return { ok: false, error: 'illegal_riichi' };
        this.doDiscard(seat, a.id, declare);
        return { ok: true };
      }
      case 'tsumo': {
        if (!legal.tsumo) return { ok: false, error: 'cannot_tsumo' };
        this.settleAgari([seat], { tsumo: true, from: seat, tileId: h.drawn });
        return { ok: true };
      }
      case 'ankan': {
        if (!legal.ankan.includes(a.kind)) return { ok: false, error: 'cannot_ankan' };
        this.doAnkan(seat, a.kind);
        return { ok: true };
      }
      case 'kakan': {
        if (!legal.kakan.includes(a.id)) return { ok: false, error: 'cannot_kakan' };
        this.doKakan(seat, a.id);
        return { ok: true };
      }
      case 'kyuushu': {
        if (!legal.kyuushu) return { ok: false, error: 'cannot_kyuushu' };
        this.abortiveDraw('kyuushu', seat);
        return { ok: true };
      }
      default:
        return { ok: false, error: 'bad_action' };
    }
  }

  actReaction(seat, a) {
    const p = this.pending;
    const o = p.eligible[seat];
    if (!o) return { ok: false, error: 'no_option' };
    if (p.responses[seat]) return { ok: false, error: 'already_responded' };
    let resp;
    switch (a.type) {
      case 'pass': resp = { type: 'pass' }; break;
      case 'ron': if (!o.ron) return { ok: false, error: 'cannot_ron' }; resp = { type: 'ron' }; break;
      case 'pon': if (!o.pon) return { ok: false, error: 'cannot_pon' }; resp = { type: 'pon' }; break;
      case 'daiminkan': if (!o.daiminkan) return { ok: false, error: 'cannot_kan' }; resp = { type: 'daiminkan' }; break;
      case 'chi': {
        const opt = (o.chi || []).find((c) => Array.isArray(a.ids) && c.ids.length === a.ids.length
          && c.ids.every((id) => a.ids.includes(id)));
        if (!opt) return { ok: false, error: 'cannot_chi' };
        resp = { type: 'chi', opt };
        break;
      }
      default: return { ok: false, error: 'bad_action' };
    }
    p.responses[seat] = resp;
    if (Object.keys(p.eligible).every((s) => p.responses[s])) this.resolveReaction();
    return { ok: true };
  }

  // ── 진행 ────────────────────────────────────────────────
  beginDraw(seat) {
    const h = this.h;
    if (h.wall.length === 0) { this.exhaustiveDraw(); return; }
    const id = h.wall.shift();
    h.hands[seat].push(id);
    h.drawn = id;
    h.drawnRinshan = false;
    h.turn = seat;
    this.pending = { type: 'turn', seat };
    this.emit({ t: 'draw', seat, wallLeft: h.wall.length });
  }

  drawRinshan(seat) {
    const h = this.h;
    const id = h.dead[h.rinshanUsed++];
    h.wall.pop();
    h.hands[seat].push(id);
    h.drawn = id;
    h.drawnRinshan = true;
    h.turn = seat;
    this.pending = { type: 'turn', seat };
    this.emit({ t: 'draw', seat, rinshan: true, wallLeft: h.wall.length });
  }

  revealDora() {
    const h = this.h;
    if (h.doraRevealed < 5) {
      h.doraRevealed += 1;
      this.emit({ t: 'dora', count: h.doraRevealed });
    }
  }

  doDiscard(seat, id, declare) {
    const h = this.h;
    const hand = h.hands[seat];
    hand.splice(hand.indexOf(id), 1);
    h.ippatsu[seat] = false;
    h.furitenTemp[seat] = false;
    const tsumogiri = id === h.drawn;
    const double = declare && !h.callsHappened && h.discards[seat].length === 0;
    h.discards[seat].push({ id, riichi: declare, tsumogiri, called: false });
    h.drawn = null;
    h.drawnRinshan = false;
    h.kuikaeBan = [];
    h.hands[seat] = sortTiles(hand);
    while (h.kanDoraPending > 0) { h.kanDoraPending -= 1; this.revealDora(); }
    if (declare) h.riichiPending = { seat, double };
    h.lastDiscard = { seat, id };
    this.emit({ t: 'discard', seat, id, riichi: declare, tsumogiri });
    this.openReaction('discard', seat, id);
  }

  openReaction(rkind, discarder, tileId) {
    const eligible = this.buildReactionOptions(discarder, tileId, rkind);
    if (Object.keys(eligible).length === 0) {
      if (rkind === 'kakan') this.finishKakan();
      else this.afterDiscard();
      return;
    }
    this.pending = { type: 'reaction', rkind, discarder, tile: tileId, eligible, responses: {} };
  }

  establishRiichi() {
    const h = this.h;
    const rp = h.riichiPending;
    if (!rp) return;
    h.riichiPending = null;
    h.riichi[rp.seat] = rp.double ? 2 : 1;
    h.ippatsu[rp.seat] = true;
    this.scores[rp.seat] -= 1000;
    this.kyotaku += 1;
    this.emit({ t: 'riichi', seat: rp.seat, double: rp.double });
  }

  clearIppatsu() { this.h.ippatsu.fill(false); }

  resolveReaction() {
    const p = this.pending;
    const h = this.h;
    const rons = [];
    for (const [sKey, o] of Object.entries(p.eligible)) {
      const s = +sKey;
      if (!o.ron) continue;
      if (p.responses[s].type === 'ron') rons.push(s);
      else if (h.riichi[s]) h.furitenRiichi[s] = true;
      else h.furitenTemp[s] = true;
    }
    if (rons.length > 0) {
      if (rons.length === 3) { this.pending = null; this.abortiveDraw('sanchahou', p.discarder); return; }
      rons.sort((a, b) => ((a - p.discarder + 4) % 4) - ((b - p.discarder + 4) % 4));
      this.pending = null;
      this.settleAgari(rons, { tsumo: false, from: p.discarder, tileId: p.tile, chankan: p.rkind === 'kakan' });
      return;
    }
    const entries = Object.entries(p.responses).map(([s, r]) => [+s, r]);
    const kan = entries.find(([, r]) => r.type === 'daiminkan');
    const pon = entries.find(([, r]) => r.type === 'pon');
    const chi = entries.find(([, r]) => r.type === 'chi');
    this.pending = null;
    if (p.rkind === 'kakan') { this.finishKakan(); return; }
    if (kan) this.doDaiminkan(kan[0], p.discarder, p.tile);
    else if (pon) this.doPon(pon[0], p.discarder, p.tile);
    else if (chi) this.doChi(chi[0], p.discarder, p.tile, chi[1].opt);
    else this.afterDiscard();
  }

  afterDiscard() {
    const h = this.h;
    this.establishRiichi();
    const last = h.lastDiscard;
    // 사풍연타
    if (!h.callsHappened && h.discards.every((d) => d.length === 1)) {
      const kinds = h.discards.map((d) => kindOf(d[0].id));
      if (kinds[0] >= 27 && kinds[0] <= 30 && kinds.every((k) => k === kinds[0])) {
        this.abortiveDraw('suufon', last.seat);
        return;
      }
    }
    if (h.riichi.every((r) => r > 0)) { this.abortiveDraw('suucha', last.seat); return; }
    if (h.kanCount === 4 && new Set(h.kanOwners).size > 1) { this.abortiveDraw('suukan', last.seat); return; }
    this.beginDraw((last.seat + 1) % 4);
  }

  markCalled(discarder) {
    const d = this.h.discards[discarder];
    d[d.length - 1].called = true;
  }

  takeFromHand(seat, ids) {
    const hand = this.h.hands[seat];
    for (const id of ids) hand.splice(hand.indexOf(id), 1);
  }

  doPon(seat, discarder, tileId) {
    const h = this.h;
    this.establishRiichi();
    const k = kindOf(tileId);
    const mine = h.hands[seat].filter((id) => kindOf(id) === k)
      .sort((a, b) => Number(isRedId(a)) - Number(isRedId(b))).slice(0, 2);
    this.takeFromHand(seat, mine);
    this.markCalled(discarder);
    h.melds[seat].push({ type: 'pon', k, tiles: [...mine, tileId], from: discarder, called: tileId });
    this.afterOpenCall(seat, [k]);
    this.emit({ t: 'call', seat, type: 'pon', from: discarder, tile: tileId });
  }

  doChi(seat, discarder, tileId, opt) {
    const h = this.h;
    this.establishRiichi();
    this.takeFromHand(seat, opt.ids);
    this.markCalled(discarder);
    const tiles = [...opt.ids, tileId].sort((a, b) => kindOf(a) - kindOf(b));
    h.melds[seat].push({ type: 'chi', k: kindOf(tiles[0]), tiles, from: discarder, called: tileId });
    this.afterOpenCall(seat, opt.ban);
    this.emit({ t: 'call', seat, type: 'chi', from: discarder, tile: tileId });
  }

  afterOpenCall(seat, ban) {
    const h = this.h;
    h.callsHappened = true;
    this.clearIppatsu();
    h.turn = seat;
    h.drawn = null;
    h.drawnRinshan = false;
    h.kuikaeBan = ban;
    this.pending = { type: 'turn', seat };
  }

  doDaiminkan(seat, discarder, tileId) {
    const h = this.h;
    this.establishRiichi();
    const k = kindOf(tileId);
    const mine = h.hands[seat].filter((id) => kindOf(id) === k).slice(0, 3);
    this.takeFromHand(seat, mine);
    this.markCalled(discarder);
    h.melds[seat].push({ type: 'minkan', k, tiles: [...mine, tileId], from: discarder, called: tileId });
    h.callsHappened = true;
    this.clearIppatsu();
    h.kanCount += 1;
    h.kanOwners.push(seat);
    h.kanDoraPending += 1;
    this.emit({ t: 'call', seat, type: 'minkan', from: discarder, tile: tileId });
    this.drawRinshan(seat);
  }

  doAnkan(seat, k) {
    const h = this.h;
    const tiles = h.hands[seat].filter((id) => kindOf(id) === k);
    this.takeFromHand(seat, tiles);
    h.melds[seat].push({ type: 'ankan', k, tiles, from: seat, called: null });
    h.callsHappened = true;
    this.clearIppatsu();
    h.kanCount += 1;
    h.kanOwners.push(seat);
    this.emit({ t: 'call', seat, type: 'ankan', from: seat, tile: null });
    this.revealDora();
    this.drawRinshan(seat);
  }

  doKakan(seat, id) {
    const h = this.h;
    const k = kindOf(id);
    const meld = h.melds[seat].find((m) => m.type === 'pon' && m.k === k);
    h.kakan = { seat, id, meld };
    this.emit({ t: 'call', seat, type: 'kakan', from: seat, tile: id });
    this.openReaction('kakan', seat, id);
  }

  finishKakan() {
    const h = this.h;
    const { seat, id, meld } = h.kakan;
    h.kakan = null;
    this.takeFromHand(seat, [id]);
    meld.type = 'kakan';
    meld.tiles.push(id);
    h.callsHappened = true;
    this.clearIppatsu();
    h.kanCount += 1;
    h.kanOwners.push(seat);
    h.kanDoraPending += 1;
    this.drawRinshan(seat);
  }

  // ── 국 종료 ──────────────────────────────────────────────
  settleAgari(winners, { tsumo, from, tileId, chankan = false }) {
    const h = this.h;
    this.pending = null;
    const deltas = [0, 0, 0, 0];
    const entries = [];
    const rinshan = tsumo && h.drawnRinshan;
    winners.forEach((w, idx) => {
      const ev = this.evalWin(w, tileId, { tsumo, chankan, rinshan });
      const base = basePoints(ev.han, ev.fu, ev.yakuman);
      const pay = paymentOf(base, w === this.dealer, tsumo);
      let gain = 0;
      const first = idx === 0;
      if (!tsumo) {
        const honbaBonus = first ? 300 * this.honba : 0;
        deltas[from] -= pay.ron + honbaBonus;
        deltas[w] += pay.ron + honbaBonus;
        gain = pay.ron + honbaBonus;
      } else {
        const bonus = 100 * this.honba;
        for (let s = 0; s < 4; s++) {
          if (s === w) continue;
          const amount = (w === this.dealer ? pay.allPay : (s === this.dealer ? pay.dealerPay : pay.childPay)) + bonus;
          deltas[s] -= amount;
          deltas[w] += amount;
          gain += amount;
        }
      }
      entries.push({
        seat: w,
        tsumo,
        from,
        han: ev.han,
        fu: ev.fu,
        yaku: ev.yaku,
        yakuman: ev.yakuman,
        limit: ev.limit,
        shape: ev.shape,
        layout: ev.layout,
        points: gain,
        concealed: sortTiles(tsumo ? h.hands[w].filter((id) => id !== tileId) : h.hands[w]),
        melds: h.melds[w].map((m) => ({ type: m.type, k: m.k, tiles: m.tiles.slice(), from: m.from })),
        winTile: tileId,
        riichi: h.riichi[w] > 0,
      });
    });
    const sticks = this.kyotaku;
    deltas[winners[0]] += sticks * 1000;
    this.kyotaku = 0;
    const before = this.scores.slice();
    for (let s = 0; s < 4; s++) this.scores[s] += deltas[s];
    const anyRiichi = entries.some((e) => e.riichi);
    this.result = {
      kind: 'agari',
      label: this.roundLabel(),
      winners: entries,
      deltas,
      sticks,
      honba: this.honba,
      before,
      after: this.scores.slice(),
      dora: this.doraIndicators(),
      ura: anyRiichi ? this.uraIndicators() : [],
      dealerWon: winners.includes(this.dealer),
    };
    this.emit({ t: 'agari', winners: winners.slice(), tsumo, from });
    this.pending = { type: 'ack', acks: new Set() };
  }

  isTenpai(seat) {
    return this.waitsOf(seat).length > 0;
  }

  exhaustiveDraw() {
    const h = this.h;
    this.pending = null;
    const tenpai = [0, 1, 2, 3].map((s) => this.isTenpai(s));
    const nagashi = [0, 1, 2, 3].map((s) => h.discards[s].length > 0
      && h.discards[s].every((d) => isYaochuu(kindOf(d.id)) && !d.called));
    const deltas = [0, 0, 0, 0];
    if (nagashi.some(Boolean)) {
      nagashi.forEach((flag, s) => {
        if (!flag) return;
        for (let o = 0; o < 4; o++) {
          if (o === s) continue;
          const amt = s === this.dealer ? 4000 : (o === this.dealer ? 4000 : 2000);
          deltas[o] -= amt;
          deltas[s] += amt;
        }
      });
    } else {
      const t = tenpai.filter(Boolean).length;
      if (t > 0 && t < 4) {
        for (let s = 0; s < 4; s++) deltas[s] += tenpai[s] ? 3000 / t : -3000 / (4 - t);
      }
    }
    const before = this.scores.slice();
    for (let s = 0; s < 4; s++) this.scores[s] += deltas[s];
    this.result = {
      kind: 'draw',
      reason: 'exhaustive',
      label: this.roundLabel(),
      tenpai,
      nagashi,
      hands: tenpai.map((t, s) => (t ? { concealed: sortTiles(h.hands[s]), melds: h.melds[s].map((m) => ({ type: m.type, k: m.k, tiles: m.tiles.slice(), from: m.from })) } : null)),
      deltas,
      before,
      after: this.scores.slice(),
      honba: this.honba,
      dealerTenpai: tenpai[this.dealer],
    };
    this.emit({ t: 'ryuukyoku', reason: 'exhaustive' });
    this.pending = { type: 'ack', acks: new Set() };
  }

  abortiveDraw(reason, seat) {
    this.pending = null;
    const h = this.h;
    const before = this.scores.slice();
    this.result = {
      kind: 'draw',
      reason,
      seat,
      label: this.roundLabel(),
      tenpai: [false, false, false, false],
      nagashi: [false, false, false, false],
      hands: reason === 'kyuushu' ? [0, 1, 2, 3].map((s) => (s === seat ? { concealed: sortTiles(h.hands[s]), melds: [] } : null)) : [null, null, null, null],
      deltas: [0, 0, 0, 0],
      before,
      after: this.scores.slice(),
      honba: this.honba,
      dealerTenpai: true,
    };
    this.emit({ t: 'ryuukyoku', reason });
    this.pending = { type: 'ack', acks: new Set() };
  }

  advanceAfterResult() {
    const r = this.result;
    const dealer = this.dealer;
    let dealerStays;
    if (r.kind === 'agari') {
      dealerStays = r.dealerWon;
      this.honba = dealerStays ? this.honba + 1 : 0;
    } else {
      dealerStays = r.reason === 'exhaustive' ? r.dealerTenpai : true;
      this.honba += 1;
    }
    let over = null;
    if (this.scores.some((s) => s < 0)) over = 'tobi';
    const top = this.scores.indexOf(Math.max(...this.scores));
    const topScore = this.scores[top];
    if (!over) {
      if (dealerStays) {
        const allLast = this.roundNum >= this.regularRounds - 1;
        const yameOk = r.kind === 'agari' || r.reason === 'exhaustive';
        if (allLast && yameOk && top === dealer && topScore >= this.settings.returnScore) over = 'all_last';
      } else {
        this.roundNum += 1;
        if (this.roundNum >= this.regularRounds) {
          if (topScore >= this.settings.returnScore || this.roundNum > this.lastRoundNum) over = 'end';
        }
      }
    }
    if (over) { this.finish(over); return; }
    this.startHand();
  }

  finish(reason) {
    const order = [0, 1, 2, 3].sort((a, b) => this.scores[b] - this.scores[a] || a - b);
    const top = order[0];
    this.scores[top] += this.kyotaku * 1000;
    this.kyotaku = 0;
    this.final = {
      reason,
      ranking: order.map((seat, i) => ({ seat, rank: i + 1, score: this.scores[seat], delta: this.scores[seat] - this.settings.startScore })),
    };
    this.pending = null;
    this.emit({ t: 'game_over', reason });
  }

  // ── 시점별 뷰 ────────────────────────────────────────────
  /**
   * 특정 좌석이 볼 수 있는 상태만 담은 스냅샷.
   * @param {number} seat 좌석
   * @returns {object} 뷰
   */
  viewFor(seat) {
    const h = this.h;
    const view = {
      settings: this.settings,
      me: seat,
      scores: this.scores.slice(),
      dealer: this.dealer,
      roundLabel: this.roundLabel(),
      roundWind: this.roundWindIndex,
      honba: this.honba,
      kyotaku: this.kyotaku,
      handNo: this.handNo,
      phase: this.final ? 'over' : (this.pending ? this.pending.type : 'idle'),
      final: this.final,
      result: this.result,
    };
    if (!h) return view;
    view.wallLeft = h.wall.length;
    view.dora = this.doraIndicators();
    view.turn = h.turn;
    view.lastDiscard = h.lastDiscard;
    view.myHand = sortTiles(h.hands[seat].filter((id) => id !== h.drawn || h.turn !== seat));
    view.myDrawn = h.turn === seat && h.drawn != null ? h.drawn : null;
    view.furiten = !!this.pending && this.pending.type !== 'ack' && this.isFuriten(seat);
    view.players = [0, 1, 2, 3].map((s) => ({
      seat: s,
      wind: this.seatWindIndex(s),
      score: this.scores[s],
      riichi: h.riichi[s] > 0,
      handCount: h.hands[s].length - (h.turn === s && h.drawn != null ? 1 : 0),
      hasDrawn: h.turn === s && h.drawn != null,
      melds: h.melds[s].map((m) => ({ type: m.type, k: m.k, tiles: m.tiles.slice(), from: m.from, called: m.called })),
      discards: h.discards[s].map((d) => ({ ...d })),
    }));
    if (this.pending && this.pending.type === 'reaction') {
      view.waitingOn = Object.keys(this.pending.eligible).map(Number).filter((s) => !this.pending.responses[s]);
    } else if (this.pending && this.pending.type === 'turn') {
      view.waitingOn = [this.pending.seat];
    } else if (this.pending && this.pending.type === 'ack') {
      view.waitingOn = [0, 1, 2, 3].filter((s) => !this.pending.acks.has(s));
    } else view.waitingOn = [];
    view.legal = this.legalFor(seat);
    return view;
  }
}
