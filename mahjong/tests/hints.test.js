/**
 * @fileoverview 초보 도우미 힌트 테스트: 역 유무·추천 버림·방어 전환·울기 영향.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { MahjongGame } from '../lib/game.js';
import { computeHints } from '../lib/hints.js';
import { kindOf, seededRng, sortTiles } from '../lib/tiles.js';

/** "123m456p789s11z" → 종류 배열 */
function kinds(str) {
  const out = [];
  let digits = [];
  for (const ch of str) {
    if (ch >= '0' && ch <= '9') { digits.push(+ch); continue; }
    const base = { m: 0, p: 9, s: 18, z: 27 }[ch];
    for (const d of digits) out.push(base + d - 1);
    digits = [];
  }
  return out;
}

/** 테스트용 국 구성(game.test.js의 setup과 같은 규칙). 별도 인자: riichi 좌석 목록 */
function setup(spec = {}, settings = {}) {
  const g = new MahjongGame({ rng: seededRng(7), settings: { aka: false, ...settings } });
  g.start();
  const h = g.h;
  const used = new Set();
  const take = (k) => {
    for (let c = 3; c >= 0; c--) {
      const id = k * 4 + c;
      if (!used.has(id)) { used.add(id); return id; }
    }
    throw new Error(`no tile for kind ${k}`);
  };
  h.hands = [[], [], [], []];
  h.melds = [[], [], [], []];
  h.discards = [[], [], [], []];
  for (const [seat, str] of Object.entries(spec.hands || {})) h.hands[+seat] = kinds(str).map(take);
  for (const [seat, list] of Object.entries(spec.melds || {})) {
    h.melds[+seat] = list.map((m) => ({ type: m.type, k: m.k, tiles: m.kinds.map(take), from: m.from ?? 0, called: null }));
  }
  for (const [seat, str] of Object.entries(spec.discards || {})) {
    h.discards[+seat] = kinds(str).map((k) => ({ id: take(k), riichi: false, tsumogiri: false, called: false }));
  }
  for (const s of spec.riichi || []) h.riichi[s] = 1;
  h.drawn = null;
  h.callsHappened = !!spec.callsHappened;
  if (spec.drawn) {
    const id = take(spec.drawn.kind);
    h.hands[spec.drawn.seat].push(id);
    h.drawn = id;
    h.turn = spec.drawn.seat;
  }
  const rest = Array.from({ length: 136 }, (_, i) => i).filter((i) => !used.has(i));
  h.dead = rest.slice(0, 14);
  h.wall = rest.slice(14);
  for (const s of [0, 1, 2, 3]) h.hands[s] = sortTiles(h.hands[s].filter((id) => id !== h.drawn)).concat(h.drawn != null && h.turn === s ? [h.drawn] : []);
  h.doraRevealed = 1;
  g.pending = { type: 'turn', seat: h.turn };
  return g;
}

/** 13장(내 차례가 아닌) 손의 힌트 */
function hintsFor13(spec) {
  const g = setup(spec);
  const v = g.viewFor(0);
  v.legal = null;
  return computeHints(v);
}

test('역 없는 울음 텐파이는 대기가 있어도 역 없음(none)으로 표시된다', () => {
  // 111m 퐁(탕야오 아님·역패 아님) + 234p 567p 345s + 9m 단기
  const hints = hintsFor13({
    hands: { 0: '234567p345s9m' },
    melds: { 0: [{ type: 'pon', k: 0, kinds: [0, 0, 0] }] },
  });
  assert.equal(hints.shanten, 0);
  assert.deepEqual(hints.waits.map((w) => w.kind), [8]);
  assert.equal(hints.yaku, 'none');
  assert.equal(hints.fixable, false);
});

test('문전 텐파이: 쯔모로만 이기는 모양은 tsumo, 리치로 고칠 수 있다(fixable)', () => {
  // 123m 456p 789s 23p 11z — 역패(동) 머리라 핑후가 아니고 론은 역이 없다
  const hints = hintsFor13({ hands: { 0: '123m456p23p789s11z' } });
  assert.equal(hints.shanten, 0);
  assert.equal(hints.yaku, 'tsumo');
  assert.equal(hints.fixable, true);
});

test('탕야오·핑후가 되는 텐파이는 론·쯔모 모두 역이 있다(ok)', () => {
  const hints = hintsFor13({ hands: { 0: '234m78m567p345s66s' } });
  assert.equal(hints.shanten, 0);
  assert.equal(hints.yaku, 'ok');
});

test('완성 모양인데 역이 없으면 쯔모 불가 안내를 준다', () => {
  const g = setup({
    hands: { 0: '234567p345s9m' },
    melds: { 0: [{ type: 'pon', k: 0, kinds: [0, 0, 0] }] },
    drawn: { seat: 0, kind: 8 },
    callsHappened: true,
  });
  const v = g.viewFor(0);
  assert.equal(v.legal.tsumo, false);
  const hints = computeHints(v);
  assert.equal(hints.shanten, -1);
  assert.match(hints.note, /역이 없어서/);
});

test('리치한 상대가 있고 내 손이 멀면 안전패(현물)를 추천한다', () => {
  const g = setup({
    hands: { 0: '1379m1469p258s14z' },
    drawn: { seat: 0, kind: 9 + 7 },
    discards: { 1: '9p' },
    riichi: [1],
  });
  const hints = computeHints(g.viewFor(0));
  assert.ok(hints.shanten >= 2);
  assert.deepEqual(hints.safe, [9 + 8]);
  assert.deepEqual(hints.best, [9 + 8]);
  assert.equal(hints.bestWhy, 'fold');
});

test('텐파이에 가까우면 효율대로 버리되 위험한 패면 bestRisky로 알린다', () => {
  const g = setup({
    hands: { 0: '123m456p23p789s11z' },
    drawn: { seat: 0, kind: 33 },
    discards: { 1: '5s' },
    riichi: [1],
  });
  const hints = computeHints(g.viewFor(0));
  assert.equal(hints.shanten, 0);
  assert.deepEqual(hints.best, [33]);
  assert.equal(hints.bestWhy, 'tenpai');
  assert.equal(hints.bestRisky, true);
});

test('금지된 버림(legal.discard에 없는 패)은 추천하지 않는다', () => {
  const g = setup({ hands: { 0: '123m456p23p789s11z' }, drawn: { seat: 0, kind: 33 } });
  const v = g.viewFor(0);
  assert.deepEqual(computeHints(v).best, [33]);
  v.legal = { ...v.legal, discard: v.legal.discard.filter((id) => kindOf(id) !== 33) };
  const again = computeHints(v);
  assert.equal(again.discards[33], undefined);
  assert.notDeepEqual(again.best, [33]);
});

test('퐁 반응 창: 울기 전후 향청수·문전 상실·역 유무를 알려 준다', () => {
  const g = setup({
    hands: { 0: '1357m1357p135s24z', 1: '55z123m456p789s24s', 2: '2468m2468p2468s7z', 3: '3579m3579p3579s1z' },
    drawn: { seat: 0, kind: 31 },
  });
  const id = g.h.drawn;
  assert.ok(g.act(0, { type: 'discard', id }).ok);
  assert.equal(g.pending.type, 'reaction');
  const v = g.viewFor(1);
  assert.ok(v.legal.pon);
  const hints = computeHints(v);
  assert.equal(hints.call.type, 'pon');
  assert.equal(hints.call.before, 0);
  assert.equal(hints.call.after, 0);
  assert.equal(hints.call.opens, true);
  assert.equal(hints.call.yakuAfter, 'ok');
  assert.equal(hints.call.advice, 'yes');
  assert.equal(hints.call.why, 'yaku-gain');
  assert.match(hints.note, /역패/);
});

test('치 반응 창: 속도가 안 빨라지거나 역이 보장되지 않으면 울지 말라고 판정한다', () => {
  // 내 손(좌석 1): 2-3m 두 장으로 치 가능, 1m 버림(좌석 0 → 하가). 좌석 1이 상가(下家)다.
  const g = setup({
    hands: { 0: '1m13579p13579s1z', 1: '34m1379p1379s246z', 2: '2468m2468p2468s7z', 3: '3579m3579p3579s1z' },
    drawn: { seat: 0, kind: 1 },
  });
  assert.ok(g.act(0, { type: 'discard', id: g.h.drawn }).ok);
  const v = g.viewFor(1);
  assert.ok(v.legal.chi, "치가 가능해야 한다");
  const hints = computeHints(v);
  assert.ok(['yes', 'maybe', 'no'].includes(hints.call.advice));
  assert.ok(hints.call.why);
  if (hints.call.after >= hints.call.before) assert.equal(hints.call.advice, 'no');
});

test('암깡: 모양이 나빠지지 않으면 권하고, 리치한 상대가 있으면 상황 봐서로 낮춘다', () => {
  const spec = { hands: { 0: '111m234p567s11z99s' }, drawn: { seat: 0, kind: 0 } };
  const g = setup(spec);
  const v = g.viewFor(0);
  assert.deepEqual(v.legal.ankan, [0]);
  const hints = computeHints(v);
  assert.equal(hints.kan[0].advice, 'yes');
  assert.equal(hints.kan[0].why, 'ankan');

  const r = setup({ ...spec, discards: { 1: '9p' }, riichi: [1] });
  const again = computeHints(r.viewFor(0));
  assert.equal(again.kan[0].advice, 'maybe');
  assert.equal(again.kan[0].why, 'riichi-danger');
});

test('대명깡: 역패가 아닌 문전 깡은 비추천한다', () => {
  const g = setup({
    hands: { 0: '1357m1357p135s24z', 1: '333z123m456p789s2z', 2: '2468m2468p2468s7z', 3: '3579m3579p3579s1z' },
    drawn: { seat: 0, kind: 29 },
  });
  assert.ok(g.act(0, { type: 'discard', id: g.h.drawn }).ok);
  const v = g.viewFor(1);
  assert.ok(v.legal.daiminkan);
  const hints = computeHints(v);
  assert.equal(hints.callKan.advice, 'no');
  assert.equal(hints.callKan.why, 'dai-open');
});

test('힌트는 상대 손패를 쓰지 않는다: 같은 뷰면 상대 손이 달라도 결과가 같다', () => {
  const a = setup({ hands: { 0: '123m456p23p789s11z', 1: '4444m5555m6666m7m' }, drawn: { seat: 0, kind: 33 } });
  const b = setup({ hands: { 0: '123m456p23p789s11z', 1: '5555m6666m7777m4m' }, drawn: { seat: 0, kind: 33 } });
  assert.deepEqual(computeHints(a.viewFor(0)), computeHints(b.viewFor(0)));
});

test('손패 묶음: 순쯔·머리·후보를 나누고 후보에는 필요한 패와 남은 장수가 붙는다', () => {
  // 123m 순쯔, 99p 머리, 45m 양면 후보(3m·6m 대기), 나머지는 고립
  const hints = hintsFor13({ hands: { 0: '12345m99p17s5z' } });
  assert.ok(hints.groups);
  const by = (t) => hints.groups.filter((g) => g.t === t);
  assert.deepEqual(by('seq').map((g) => g.kinds), [[0, 1, 2]]);
  assert.deepEqual(by('pair').map((g) => g.kinds), [[17, 17]]);
  const ta = by('ta').find((g) => g.kinds.join() === '3,4');
  assert.ok(ta);
  assert.deepEqual(ta.need.map((n) => n.k).sort(), [2, 5]);
  assert.ok(ta.need.every((n) => n.left >= 0 && n.left <= 4));
});

test('손패 묶음: 완성 면자가 많은 해석을 우선한다(3455 → 345 + 5)', () => {
  const hints = hintsFor13({ hands: { 0: '3455m123p456s111z' } });
  const seqs = hints.groups.filter((g) => g.t === 'seq').map((g) => g.kinds.join());
  assert.ok(seqs.includes('2,3,4'));
});

test('손패 묶음: 치또이츠가 더 가까우면 생략한다', () => {
  const hints = hintsFor13({ hands: { 0: '1133m5577p9988s1z' } });
  assert.equal(hints.groups, null);
});
