/**
 * @fileoverview 대국 상태 머신 규칙 테스트: 정산, 후리텐, 치 제한, 리치, 깡, 유국, 종료 조건.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { MahjongGame } from '../lib/game.js';
import { kindOf, seededRng, sortTiles, doraFromIndicator, isRedId } from '../lib/tiles.js';
import { playFullMatch } from './helpers.js';

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

/** 테스트용 국 구성. spec: {hands:{seat:'str'}, drawn:{seat,kind}, melds, discards, wall:'str'} */
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
  if (spec.drawn) {
    const id = take(spec.drawn.kind);
    h.hands[spec.drawn.seat].push(id);
    h.drawn = id;
    h.turn = spec.drawn.seat;
  }
  const wallKinds = kinds(spec.wall || '');
  const rest = Array.from({ length: 136 }, (_, i) => i).filter((i) => !used.has(i));
  const wallIds = wallKinds.map(take);
  const rest2 = rest.filter((i) => !used.has(i));
  h.dead = rest2.slice(0, 14);
  h.wall = [...wallIds, ...rest2.slice(14)];
  if (spec.wallLen != null) h.wall = h.wall.slice(0, spec.wallLen);
  for (const s of [0, 1, 2, 3]) h.hands[s] = sortTiles(h.hands[s].filter((id) => id !== h.drawn)).concat(h.drawn != null && h.turn === s ? [h.drawn] : []);
  h.doraRevealed = 1;
  h.callsHappened = !!spec.callsHappened;
  g.pending = { type: 'turn', seat: h.turn };
  if (spec.honba != null) g.honba = spec.honba;
  if (spec.kyotaku != null) g.kyotaku = spec.kyotaku;
  return g;
}


const F1 = '147m258p369s2345z';
const F2 = '147m147p369s2345z';

/** 대기 중인 반응 창을 전원 패스로 닫는다. */
function passAll(g) {
  while (g.pending && g.pending.type === 'reaction') {
    const s = Object.keys(g.pending.eligible).map(Number).find((x) => !g.pending.responses[x]);
    g.act(s, { type: 'pass' });
  }
}

test('론 정산: 본장 300점과 공탁이 화료자에게 간다', () => {
  const g = setup({
    hands: { 0: '123456789m1234p', 2: '234m456p678s34p55s' },
    drawn: { seat: 0, kind: kinds('5p')[0] },
    honba: 2,
    kyotaku: 1,
  });
  const before = g.scores.slice();
  assert.ok(g.act(0, { type: 'discard', id: g.h.drawn }).ok);
  assert.equal(g.pending.type, 'reaction');
  assert.ok(g.pending.eligible[2].ron);
  assert.ok(g.act(2, { type: 'ron' }).ok);
  assert.equal(g.result.kind, 'agari');
  const w = g.result.winners[0];
  assert.equal(w.seat, 2);
  assert.ok(w.han >= 2);
  assert.equal(g.scores.reduce((a, b) => a + b, 0), before.reduce((a, b) => a + b, 0) + 1000);
  assert.equal(g.kyotaku, 0);
  assert.equal(g.scores[2] - before[2], w.points + 1000);
  assert.equal(g.scores[0] - before[0], -w.points);
  assert.ok(w.points % 100 === 0 && w.points >= 600, '본장 600점 포함');
});

test('후리텐: 자기 버림패에 대기패가 있으면 론할 수 없다', () => {
  const g = setup({
    hands: { 0: '123456789m1234p', 2: '234m456p678s34p55s' },
    discards: { 2: '2p' },
    drawn: { seat: 0, kind: kinds('5p')[0] },
  });
  g.act(0, { type: 'discard', id: g.h.drawn });
  assert.ok(!g.pending || g.pending.type !== 'reaction' || !g.pending.eligible[2]?.ron);
});

test('임시 후리텐: 론을 패스하면 다음 자기 버림까지 론 불가', () => {
  const g = setup({
    hands: { 0: '123456789m1234p', 2: '234m456p678s34p55s', 1: '1m', 3: '1m' },
    drawn: { seat: 0, kind: kinds('5p')[0] },
  });
  g.act(0, { type: 'discard', id: g.h.drawn });
  g.act(2, { type: 'pass' });
  assert.equal(g.h.furitenTemp[2], true);
  assert.equal(g.isFuriten(2), true);
});

test('치는 바로 다음 순번만 가능하다', () => {
  const g = setup({
    hands: { 0: '123456789m1234p', 1: '34m4569p678s1122z', 2: '34m4569p678s3344z', 3: '34m4569p678s5566z' },
    drawn: { seat: 0, kind: kinds('2m')[0] },
  });
  g.act(0, { type: 'discard', id: g.h.drawn });
  assert.equal(g.pending.type, 'reaction');
  assert.ok(g.pending.eligible[1]?.chi?.length >= 1);
  assert.ok(!g.pending.eligible[2]?.chi);
  assert.ok(!g.pending.eligible[3]?.chi);
});

test('식스왑: 치한 패와 반대편 끝 패는 버릴 수 없다', () => {
  const g = setup({
    hands: { 0: '123456789m1234p', 1: '45m1699p123s7788z' },
    drawn: { seat: 0, kind: kinds('3m')[0] },
  });
  g.act(0, { type: 'discard', id: g.h.drawn });
  const opt = g.pending.eligible[1].chi.find((c) => c.ids.every((id) => [3, 4].includes(kindOf(id))));
  assert.ok(opt, '4-5m 으로 3m 치 가능');
  g.act(1, { type: 'chi', ids: opt.ids });
  assert.equal(g.pending.type, 'turn');
  const legal = g.legalFor(1);
  assert.ok(legal.discard.every((id) => ![2, 5].includes(kindOf(id))), '3m·6m 금지');
});

test('리치: 버림이 통과하면 1000점 공탁, 첫 순이면 더블리치, 일발 성립', () => {
  const g = setup({
    hands: { 0: '123m456p789s23p11z', 1: F1, 2: F1, 3: F1 },
    drawn: { seat: 0, kind: kinds('7z')[0] },
  });
  const drawn = g.h.drawn;
  assert.ok(g.legalFor(0).riichi.includes(drawn));
  g.act(0, { type: 'discard', id: drawn, riichi: true });
  passAll(g);
  assert.equal(g.h.riichi[0], 2);
  assert.equal(g.scores[0], 24000);
  assert.equal(g.kyotaku, 1);
  assert.equal(g.h.ippatsu[0], true);
});

test('리치 선언패가 론당하면 공탁이 성립하지 않는다', () => {
  const g = setup({
    hands: { 0: '123m456p789s23p11z', 2: '123s456s789s666z8p', 1: F1, 3: F1 },
    drawn: { seat: 0, kind: kinds('8p')[0] },
  });
  g.h.riichi[2] = 1;
  const drawnId = g.h.drawn;
  assert.ok(g.legalFor(0).riichi.includes(drawnId));
  g.act(0, { type: 'discard', id: drawnId, riichi: true });
  assert.equal(g.pending.type, 'reaction');
  assert.ok(g.pending.eligible[2].ron);
  g.act(2, { type: 'ron' });
  assert.equal(g.result.kind, 'agari');
  assert.equal(g.h.riichi[0], 0, '리치 불성립');
  assert.equal(g.result.sticks, 0);
  assert.ok(g.scores[0] > 0 && g.scores[0] < 25000);
});

test('유국: 텐파이 1명이면 +3000/-1000', () => {
  const g = setup({
    hands: { 0: '123m456p789s23p11z', 1: F1, 2: F1, 3: F1 },
    discards: { 1: '5m', 2: '5m', 3: '5m' },
    drawn: { seat: 3, kind: kinds('5z')[0] },
    wallLen: 0,
  });
  g.act(3, { type: 'discard', id: g.h.drawn });
  passAll(g);
  assert.equal(g.result.kind, 'draw');
  assert.equal(g.result.reason, 'exhaustive');
  assert.deepEqual(g.result.tenpai, [true, false, false, false]);
  assert.deepEqual(g.result.deltas, [3000, -1000, -1000, -1000]);
});

test('창깡: 가깡한 패로 론할 수 있다', () => {
  const k8 = kinds('8p')[0];
  const g = setup({
    hands: { 0: '123m456p789s1z', 1: F2, 2: '234m456p678s67p55s', 3: F2 },
    melds: { 0: [{ type: 'pon', k: k8, kinds: [k8, k8, k8] }] },
    drawn: { seat: 0, kind: k8 },
    callsHappened: true,
  });
  const legal = g.legalFor(0);
  assert.equal(legal.kakan.length, 1);
  g.act(0, { type: 'kakan', id: legal.kakan[0] });
  assert.equal(g.pending.type, 'reaction');
  assert.equal(g.pending.rkind, 'kakan');
  assert.ok(g.pending.eligible[2].ron);
  g.act(2, { type: 'ron' });
  assert.equal(g.result.kind, 'agari');
  assert.ok(g.result.winners[0].yaku.some((y) => y.name === '창깡'));
});

test('암깡 후 영상 패를 뽑고 도라 표시패가 늘어난다', () => {
  const g = setup({
    hands: { 0: '1111m456p789s12s5z' },
    drawn: { seat: 0, kind: kinds('3s')[0] },
  });
  const legal = g.legalFor(0);
  assert.deepEqual(legal.ankan, [0]);
  g.act(0, { type: 'ankan', kind: 0 });
  assert.equal(g.h.doraRevealed, 2);
  assert.equal(g.h.melds[0].length, 1);
  assert.equal(g.h.drawnRinshan, true);
  assert.equal(g.pending.type, 'turn');
});

test('삼가화는 유국 처리', () => {
  const g = setup({
    hands: {
      0: '123456789m1234p',
      1: '123s456s789s111z5p',
      2: '123m456m789m222z5p',
      3: '123m456m789m333z5p',
    },
    drawn: { seat: 0, kind: kinds('5p')[0] },
  });
  g.h.riichi = [0, 1, 1, 1];
  g.act(0, { type: 'discard', id: g.h.drawn });
  for (const s of [1, 2, 3]) g.act(s, { type: 'ron' });
  assert.equal(g.result.kind, 'draw');
  assert.equal(g.result.reason, 'sanchahou');
});

test('더블 론은 허용되고 공탁·본장은 가까운 쪽이 가져간다', () => {
  const g = setup({
    hands: {
      0: '123456789m1234p',
      1: '123s456s789s111z5p',
      2: '123m456m789m222z5p',
      3: F1,
    },
    drawn: { seat: 0, kind: kinds('5p')[0] },
    honba: 1,
    kyotaku: 2,
  });
  g.h.riichi = [0, 1, 1, 0];
  g.act(0, { type: 'discard', id: g.h.drawn });
  g.act(1, { type: 'ron' });
  g.act(2, { type: 'ron' });
  assert.equal(g.result.kind, 'agari');
  assert.equal(g.result.winners.length, 2);
  assert.equal(g.result.winners[0].seat, 1, '버린 사람 다음 순번이 우선');
  assert.equal(g.result.sticks, 2);
  assert.equal(g.result.winners[0].points - g.result.winners[1].points, 300);
});

test('구종구패 선언', () => {
  const g = setup({
    hands: { 0: '19m19p19s123456z5m' },
    drawn: { seat: 0, kind: kinds('7z')[0] },
  });
  assert.equal(g.legalFor(0).kyuushu, true);
  g.act(0, { type: 'kyuushu' });
  assert.equal(g.result.reason, 'kyuushu');
});

test('연장: 친이 이기면 본장 +1, 친 유지', () => {
  const g = setup({
    hands: { 0: '234m456p678s34p55s' },
    drawn: { seat: 0, kind: kinds('5p')[0] },
  });
  g.act(0, { type: 'tsumo' });
  assert.equal(g.result.kind, 'agari');
  const roundBefore = g.roundNum;
  for (const s of [0, 1, 2, 3]) g.act(s, { type: 'next' });
  assert.equal(g.roundNum, roundBefore);
  assert.equal(g.honba, 1);
  assert.equal(g.handNo, 2);
});

test('도비: 0점 미만이면 대국 종료', () => {
  const g = setup({
    hands: { 1: '234m456p678s34p55s' },
    drawn: { seat: 1, kind: kinds('5p')[0] },
  });
  g.scores = [500, 30000, 30000, 39500];
  g.act(1, { type: 'tsumo' });
  g.scores[0] = -100;
  for (const s of [0, 1, 2, 3]) g.act(s, { type: 'next' });
  assert.equal(g.final.reason, 'tobi');
  assert.ok(g.final.ranking[0].score >= g.final.ranking[1].score);
});

test('동풍전 종료: 4국 후 30000 이상 1위가 있으면 종료, 없으면 서입', () => {
  const g = new MahjongGame({ rng: seededRng(3), settings: { length: 'east' } });
  g.start();
  g.roundNum = 3;
  g.scores = [20000, 20000, 20000, 40000];
  g.result = { kind: 'draw', reason: 'exhaustive', dealerTenpai: false, deltas: [0, 0, 0, 0] };
  g.advanceAfterResult();
  assert.ok(g.final, '30000 이상 1위가 있으면 종료');
  const h = new MahjongGame({ rng: seededRng(3), settings: { length: 'east' } });
  h.start();
  h.roundNum = 3;
  h.scores = [25000, 25000, 25000, 25000];
  h.result = { kind: 'draw', reason: 'exhaustive', dealerTenpai: false, deltas: [0, 0, 0, 0] };
  h.advanceAfterResult();
  assert.equal(h.final, null);
  assert.equal(h.roundNum, 4);
  assert.equal(h.roundLabel(), '남 1국');
});

test('올라스 친이 1위로 이기면 종료(아가리야메)', () => {
  const g = new MahjongGame({ rng: seededRng(5), settings: { length: 'east' } });
  g.start();
  g.roundNum = 3;
  g.scores = [10000, 10000, 10000, 70000];
  g.result = { kind: 'agari', dealerWon: true, winners: [{ seat: 3 }], deltas: [0, 0, 0, 0] };
  g.advanceAfterResult();
  assert.equal(g.final?.reason, 'all_last');
});

test('뷰: 상대 손패는 개수만 노출한다', () => {
  const g = new MahjongGame({ rng: seededRng(9) });
  g.start();
  const v = g.viewFor(1);
  assert.equal(JSON.stringify(v).includes('"hands"'), false);
  assert.equal(v.myHand.length + (v.myDrawn != null ? 1 : 0), 13);
  assert.equal(v.players[0].handCount, 13);
});

test('퍼즈: 시드별 대국이 예외 없이 끝나고 점수 합이 보존된다', () => {
  for (let seed = 1; seed <= 10; seed++) {
    const length = seed % 2 ? 'east' : 'half';
    const { game } = playFullMatch(seed, { settings: { length, aka: seed % 3 !== 0 }, levels: ['easy', 'normal', 'hard', 'normal'] });
    const total = game.scores.reduce((a, b) => a + b, 0);
    assert.equal(total + game.kyotaku * 1000, 100000, `seed ${seed}`);
    assert.ok(game.final);
  }
});

test('결과의 역별 강조 패(hl)는 실제 패 id이며 이페코는 같은 순쯔 2개를 가리킨다', () => {
  const g = setup({
    hands: { 0: '112233m456p789s1z' },
    drawn: { seat: 0, kind: kinds('1z')[0] },
    callsHappened: true,
  });
  g.act(0, { type: 'tsumo' });
  const w = g.result.winners[0];
  const hand = new Set([...w.concealed, w.winTile]);
  const iipeiko = w.yaku.find((y) => y.name === '이페코');
  assert.deepEqual(iipeiko.hl.map(kindOf).sort((a, b) => a - b), [0, 0, 1, 1, 2, 2]);
  assert.equal(new Set(iipeiko.hl).size, 6);
  assert.ok(iipeiko.hl.every((id) => hand.has(id)));
  assert.equal(w.yaku.find((y) => y.name === '멘젠쯔모').hl, undefined);
});

test('퍼즈: 모든 화료 결과의 hl이 화료 손 안의 중복 없는 패 id이고 도라류는 해당 패를 가리킨다', () => {
  let checked = 0;
  let withHl = 0;
  const seen = new WeakSet();
  for (let seed = 1; seed <= 4; seed++) {
    playFullMatch(seed, {
      settings: { aka: true, length: 'east' },
      onStep: (game) => {
        const r = game.result;
        if (!r || r.kind !== 'agari' || seen.has(r)) return;
        seen.add(r);
        const doraKinds = r.dora.map((id) => doraFromIndicator(kindOf(id)));
        for (const w of r.winners) {
          const pool = new Set([...w.concealed, w.winTile, ...w.melds.flatMap((m) => m.tiles)]);
          for (const y of w.yaku) {
            if (!y.hl) continue;
            withHl++;
            assert.equal(new Set(y.hl).size, y.hl.length, `seed ${seed} ${y.name} 중복`);
            assert.ok(y.hl.every((id) => pool.has(id)), `seed ${seed} ${y.name} 손 밖의 패`);
            if (y.name === '도라') assert.ok(y.hl.every((id) => doraKinds.includes(kindOf(id))));
            if (y.name === '적도라') assert.ok(y.hl.every(isRedId));
          }
          checked++;
        }
      },
    });
  }
  assert.ok(checked > 0 && withHl > 0, `화료 ${checked}건, hl ${withHl}건`);
});
