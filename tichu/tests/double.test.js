/**
 * @fileoverview 더블 티추(2벌, 112장) 규칙 테스트: 카드 id·조합·소원·교환·점수·AI 퍼즈.
 * 두 번째 벌의 카드는 코드에 `*`를 붙여 쓴다('5j' 첫 벌, '5j*' 두 번째 벌).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { TichuGame } from '../lib/game.js';
import { idOf, seededRng, baseOf, fullDeck, pointsSum, DECK_SIZE } from '../lib/cards.js';
import {
  interpretations, beats, pickCombo, enumeratePlays, phoenixChoices, label,
} from '../lib/combos.js';
import { decide } from '../lib/ai.js';
import { playFullMatch } from './helpers.js';

const id = (code) => (code.endsWith('*') ? idOf(code.slice(0, -1)) + DECK_SIZE : idOf(code));
const ids = (s) => (s ? s.split(/\s+/).map(id) : []);
const combo = (s, top = null) => {
  const list = interpretations(ids(s), top);
  assert.ok(list.length >= 1, `해석 없음: ${s}`);
  return list[0];
};

/** 교환까지 끝낸 2벌 대국에 손패를 시나리오대로 놓는다. */
function setup2(hands, { turn = 0, wishUsed = false, wish = null } = {}) {
  const g = new TichuGame({ settings: { decks: 2, grand: false }, rng: seededRng(1), now: () => 0 });
  g.start();
  for (let s = 0; s < 4; s++) g.act(s, { type: 'exchange', give: g.h.hands[s].slice(0, 6) });
  assert.equal(g.phase, 'play');
  g.h.hands = hands.map((x) => ids(x).sort((a, b) => a - b));
  g.h.started = [false, false, false, false];
  g.h.wish = wish;
  g.h.wishUsed = wishUsed;
  g.pending = { type: 'turn', seat: turn };
  g.drainEvents();
  return g;
}
const play = (g, seat, s, extra = {}) => g.act(seat, { type: 'play', ids: ids(s), ...extra });

test('카드 id: 두 번째 벌은 +56이고 정체는 baseOf로 본다', () => {
  assert.equal(fullDeck(2).length, 112);
  assert.equal(baseOf(id('5j*')), baseOf(id('5j')));
  assert.notEqual(id('5j*'), id('5j'));
  assert.equal(combo('5j 5j*').type, 'pair');
  assert.equal(combo('DRG').rank, 15);
  assert.equal(combo('DRG*').rank, 15);
  assert.equal(combo('DOG*').type, 'dog');
});

test('더블 티추: 처음 16장 → 그랜드 선택 → 12장 더(28장) → 6장 교환', () => {
  const g = new TichuGame({ settings: { decks: 2 }, rng: seededRng(5), now: () => 0 });
  g.start();
  assert.equal(g.viewFor(0).hand.length, 16);
  for (let s = 0; s < 4; s++) g.act(s, { type: 'grand', on: false });
  assert.equal(g.phase, 'exchange');
  for (let s = 0; s < 4; s++) assert.equal(g.viewFor(s).hand.length, 28);
  const all = [0, 1, 2, 3].flatMap((s) => g.viewFor(s).hand);
  assert.equal(new Set(all).size, 112);

  assert.equal(g.act(0, { type: 'exchange', give: g.h.hands[0].slice(0, 3) }).error, 'bad_action', '3장은 거절');
  const picks = g.h.hands.map((hand) => hand.slice(0, 6));
  picks.forEach((p, s) => assert.ok(g.act(s, { type: 'exchange', give: p }).ok));
  assert.equal(g.phase, 'play');
  for (let s = 0; s < 4; s++) {
    assert.equal(g.viewFor(s).hand.length, 28);
    const rec = g.viewFor(s).received;
    assert.equal(rec.length, 6);
    // 왼쪽(seat+1)·파트너(seat+2)·오른쪽(seat+3)에게 두 장씩 간다
    const to = (t) => g.viewFor(s).given.filter((x) => x.to === (s + t) % 4).map((x) => x.id);
    assert.deepEqual(to(1), picks[s].slice(0, 2));
    assert.deepEqual(to(2), picks[s].slice(2, 4));
    assert.deepEqual(to(3), picks[s].slice(4, 6));
  }
  assert.equal(g.canCall(0), true, '28장일 때 티추 콜 가능');
});

test('더블: 같은 숫자 폭탄은 5~8장까지, 장수가 많으면 이기고 같으면 숫자가 높아야 한다', () => {
  const b4 = combo('5j 5s 5p 5t');
  const b5 = combo('5j 5s 5p 5t 5j*');
  const b8 = combo('9j 9s 9p 9t 9j* 9s* 9p* 9t*');
  assert.deepEqual([b4.type, b4.n, b5.n, b8.n], ['bomb4', 4, 5, 8]);
  assert.equal(label(b5), '5장 폭탄 5');
  assert.ok(beats(b5, combo('Aj As Ap At')), '5장 폭탄이 A 네 장을 이긴다');
  assert.ok(!beats(combo('Aj As Ap At'), b5));
  assert.ok(beats(combo('6j 6s 6p 6t'), b4));
  assert.ok(!beats(b4, b4), '같으면 못 이긴다');
  assert.ok(beats(b8, b5));
  // 플러시는 같은 숫자 폭탄보다 항상 강하다(기존 규칙: 플러시 > 네 장)
  const sf = combo('3j 4j 5j 6j 7j');
  assert.equal(sf.type, 'bombSF');
  assert.ok(beats(sf, b8) && !beats(b8, sf));
  // 참새·용·개는 같은 숫자 폭탄이 못 된다
  assert.deepEqual(interpretations(ids('MJ MJ* DRG DRG*'), null), []);
  assert.equal(interpretations(ids('MJ MJ*'), null).length, 0, '참새 둘은 페어가 아니다');
});

test('더블: 두 번째 벌 카드로도 스트레이트·플러시·연속 페어·풀하우스가 된다', () => {
  assert.equal(combo('3j 4s 5p 6t 7j*').type, 'straight');
  assert.equal(combo('3j 4j 5j* 6j 7j').type, 'bombSF');
  assert.equal(combo('3j 3j* 4s 4p').type, 'pairseq');
  const fh = combo('Qj Qs Qj* 4j 4s*');
  assert.deepEqual([fh.type, fh.rank], ['fullhouse', 12]);
  // 같은 숫자가 겹치면 스트레이트가 아니다
  assert.equal(interpretations(ids('3j 3j* 4s 5p 6t'), null).length, 0);
});

test('더블 봉황: 한 조합에 두 장을 함께 쓸 수 있고, 봉황끼리만으로 묶음은 못 만든다', () => {
  const t = combo('7j PHX PHX*');
  assert.deepEqual([t.type, t.rank, t.phx], ['triple', 7, [7, 7]]);
  assert.equal(combo('7j PHX').type, 'pair');
  assert.equal(interpretations(ids('PHX PHX*'), null).length, 0, '봉황 둘은 페어가 아니다');
  // 스트레이트: 3 4 _ 6 _ 로 두 칸을 봉황이 채운다
  const st = interpretations(ids('3j 4s 6p PHX PHX*'), null).filter((c) => c.type === 'straight');
  assert.ok(st.some((c) => c.rank === 7 && JSON.stringify(c.phx) === '[5,7]'), '3 4 5 6 7');
  assert.ok(st.some((c) => c.rank === 6 && JSON.stringify(c.phx) === '[2,5]'), '2 3 4 5 6');
  // 풀하우스: 8 8 + 3 + 봉황 둘 → 888 33 (봉황 8, 3)
  const fh = interpretations(ids('8j 8s 3p PHX PHX*'), null).filter((c) => c.type === 'fullhouse');
  assert.ok(fh.some((c) => c.rank === 8 && JSON.stringify(c.phx) === '[3,8]'));
  assert.ok(fh.some((c) => c.rank === 3 && JSON.stringify(c.phx) === '[3,3]'), '3 3 3 + 8 8');
  // 연속 페어
  const ps = interpretations(ids('5j 6s PHX PHX*'), null).filter((c) => c.type === 'pairseq');
  assert.ok(ps.some((c) => c.rank === 6 && JSON.stringify(c.phx) === '[5,6]'));
  // 폭탄에는 못 쓴다
  assert.equal(interpretations(ids('9j 9s 9p PHX'), null).some((c) => c.bomb), false);
  // pickCombo: as로 해석을 고른다
  const pick = pickCombo(ids('3j 4s 6p PHX PHX*'), null, { as: [2, 5] });
  assert.equal(pick.rank, 6);
  assert.ok(phoenixChoices(ids('3j 4s 6p PHX PHX*'), null).length >= 2);
});

test('더블 봉황 싱글: 봉황 위에 봉황을 얹을 수 있지만 15.0이 되는 건 막는다', () => {
  const top = combo('Kj');
  const p1 = combo('PHX', top);
  assert.equal(p1.rank, 13.5);
  const p2 = combo('PHX*', p1);
  assert.equal(p2.rank, 14);
  assert.ok(beats(p2, p1));
  const onAce = combo('PHX', combo('Aj'));
  assert.equal(onAce.rank, 14.5);
  assert.equal(interpretations(ids('PHX*'), onAce).length, 0, '14.5 위에 얹으면 15.0이 되어 용을 막는다');
  assert.equal(interpretations(ids('PHX'), combo('DRG')).length, 0, '용 위에는 못 얹는다');
  assert.ok(beats(combo('DRG'), onAce));
});

test('더블 용: 용은 용을 이기지 못한다', () => {
  const d1 = combo('DRG');
  const d2 = combo('DRG*');
  assert.ok(!beats(d2, d1));
  assert.ok(beats(combo('5j 5s 5p 5t'), d1), '폭탄은 용을 이긴다');
  const g = setup2(['DRG ' + '2j 2s 3j 3s 4j 4s'.split(' ').join(' '), 'DRG* 5j 5s 6j 6s', '7j 7s', '8j 8s']);
  assert.ok(play(g, 0, 'DRG').ok);
  assert.equal(g.act(1, { type: 'play', ids: ids('DRG*') }).ok, false, '두 번째 용은 낼 수 없다');
});

test('더블 소원: 처음 낸 참새의 주인만 빌 수 있고, 두 번째 참새는 소원이 없다', () => {
  const g = setup2([
    'MJ 5j 6s 7p 8t 9j', 'MJ* 4j 4s 4p 4t 8s',
    '10j Jj Qj Kj Aj 2j', '3j 3s 3p 2s 2p 2t',
  ]);
  assert.ok(play(g, 0, 'MJ', { wish: 11 }).ok);
  assert.equal(g.h.wish, 11);
  assert.equal(g.h.wishUsed, true);
  assert.equal(g.viewFor(0).wishUsed, true);
  // 소원 11이 걸려 있어 seat1은 11을 낼 수 없으니 패스해도 된다. 두 번째 참새는 트릭 위에 낼 수 없으므로 일단 패스.
  assert.ok(g.act(1, { type: 'pass' }).ok);
  // seat2는 J(11)를 가졌으므로 내야 한다
  assert.equal(g.act(2, { type: 'pass' }).error, 'wish');
  assert.ok(play(g, 2, 'Jj').ok);
  assert.equal(g.h.wish, null, '이루어진 소원은 사라진다');
  assert.ok(g.act(3, { type: 'pass' }).ok);
  assert.ok(g.act(0, { type: 'pass' }).ok);
  assert.ok(g.act(1, { type: 'pass' }).ok);
  // 트릭은 seat2가 가져가고 선이 된다. seat1이 선을 잡을 때를 위해 직접 선을 넘겨 두 번째 참새를 낸다.
  g.pending = { type: 'turn', seat: 1 };
  g.h.trick = g.newTrick();
  assert.ok(play(g, 1, 'MJ*', { wish: 9 }).ok);
  assert.equal(g.h.wish, null, '두 번째 참새로는 소원을 빌 수 없다');
});

test('더블 점수: 카드 점수 합 200, 원투 400, 콜 ±200/±400', () => {
  assert.equal(pointsSum(fullDeck(2)), 200, '5×8 + 10×8 + K×8 + 용 50 − 봉황 50');

  // 세 명이 나가 라운드가 끝난다: seat0이 1등이면 티추 성공(+200)
  const g = setup2(['2j', '3j', '4j', '5j 5s']);
  g.h.calls = ['tichu', null, null, null];
  assert.ok(play(g, 0, '2j').ok);
  assert.ok(play(g, 1, '3j').ok);
  assert.ok(play(g, 2, '4j').ok);
  assert.equal(g.pending.type, 'ack');
  assert.equal(g.result.bonus[0], 200, '티추 성공 +200(2벌)');
  assert.deepEqual(g.result.cardPts, [10, 0], '꼴찌(seat3)의 남은 손패 5+5가 상대 팀(seat0 팀)에게 간다');

  // 원투: seat0이 1등, 같은 팀 seat2가 2등 → 카드 점수 대신 400, 그랜드 성공 +400
  const one = setup2(['2j', '3j 3s', '4j', '5j 5s']);
  one.h.calls = ['grand', null, null, null];
  assert.ok(play(one, 0, '2j').ok);
  assert.ok(play(one, 1, '3j').ok);
  assert.ok(play(one, 2, '4j').ok);
  assert.equal(one.result.oneTwo, true);
  assert.deepEqual(one.result.cardPts, [400, 0]);
  assert.equal(one.result.bonus[0], 400, '그랜드 성공 +400(2벌)');
});

test('더블 enumeratePlays: 손패에서 나온 조합은 모두 합법으로 다시 해석된다(퍼즈)', () => {
  const rng = seededRng(7);
  for (let i = 0; i < 60; i++) {
    const deck = fullDeck(2).sort(() => rng() - 0.5);
    const hand = deck.slice(0, 28);
    for (const top of [null, combo('5j'), combo('8j 8s'), combo('3j 4s 5p 6t 7j')]) {
      const plays = enumeratePlays(hand, top);
      for (const c of plays) {
        assert.ok(c.ids.every((x) => hand.includes(x)), '손패에 없는 카드');
        assert.ok(pickCombo(c.ids, top, { as: c.phx }), `낼 수 없는 조합 ${label(c)}`);
      }
    }
  }
});

test('더블 티추 AI 퍼즈: 카드 112장 보존, 점수 합 200(원투 400), 목표 2000', () => {
  for (let seed = 1; seed <= 12; seed++) {
    let rounds = 0;
    const { game } = playFullMatch(seed, {
      settings: { decks: 2, target: 2000 },
      levels: ['easy', 'normal', 'hard', 'normal'],
      onStep(g) {
        const h = g.h;
        if (g.phase === 'play') {
          const all = [...h.hands.flat(), ...h.won.flat(), ...h.trick.pile];
          assert.equal(all.length, 112, `seed ${seed}: 카드 수 ${all.length}`);
          assert.equal(new Set(all).size, 112, `seed ${seed}: 중복 카드`);
        }
        if (g.phase === 'roundEnd' && g.result.round !== rounds) {
          rounds = g.result.round;
          const r = g.result;
          assert.equal(r.cardPts[0] + r.cardPts[1], r.oneTwo ? 400 : 200, `seed ${seed} 라운드 ${rounds} 카드 점수`);
        }
      },
    });
    assert.equal(game.phase, 'over');
    assert.ok(game.scores.some((s) => s >= 2000));
    assert.notEqual(game.scores[0], game.scores[1]);
  }
});

test('더블 AI: 폭탄이 아닌 선택은 항상 합법이다', () => {
  for (let seed = 1; seed <= 6; seed++) {
    const { game } = playFullMatch(100 + seed, { settings: { decks: 2, target: 1000 }, maxSteps: 20000 });
    assert.equal(game.phase, 'over');
  }
  // decide가 만든 play 행동은 서버(act)가 받아들인다는 사실은 playFullMatch가 예외로 확인한다.
  assert.equal(typeof decide, 'function');
});
