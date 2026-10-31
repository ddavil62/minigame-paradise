import test from 'node:test';
import assert from 'node:assert/strict';
import { idOf } from '../lib/cards.js';
import { interpretations, beats, pickCombo, enumeratePlays, phoenixChoices, label } from '../lib/combos.js';

const ids = (s) => s.split(/\s+/).map(idOf);
const one = (s, top = null) => {
  const list = interpretations(ids(s), top);
  assert.ok(list.length >= 1, `해석 없음: ${s}`);
  return list[0];
};
const bomb = (s) => {
  const c = interpretations(ids(s), null).find((x) => x.bomb);
  assert.ok(c, `폭탄 아님: ${s}`);
  return c;
};

test('싱글·페어·트리플·풀하우스 해석', () => {
  assert.equal(one('Kj').type, 'single');
  assert.deepEqual([one('5j 5s').type, one('5j 5s').rank], ['pair', 5]);
  assert.equal(one('9j 9s 9p').type, 'triple');
  const fh = one('Qj Qs Qp 4j 4s');
  assert.deepEqual([fh.type, fh.rank], ['fullhouse', 12]);
  assert.equal(interpretations(ids('5j 6s'), null).length, 0);
  assert.equal(interpretations(ids('5j 5s 6p'), null).length, 0);
});

test('특수 카드: 용·개·참새', () => {
  assert.equal(one('DRG').rank, 15);
  assert.equal(one('DOG').type, 'dog');
  assert.equal(one('MJ').rank, 1);
  assert.equal(interpretations(ids('DRG Aj'), null).length, 0, '용은 싱글만');
  assert.equal(interpretations(ids('DOG Aj'), null).length, 0);
  assert.equal(interpretations(ids('MJ PHX'), null).length, 0, '참새와 봉황은 페어가 안 된다');
});

test('개는 맨 앞에서만 낼 수 있다', () => {
  const dog = one('DOG');
  assert.ok(beats(dog, null));
  assert.ok(!beats(dog, one('3j')));
});

test('봉황 싱글: 맨 앞이면 1.5, 아니면 직전 싱글 +0.5, 용 위에는 못 낸다', () => {
  assert.equal(one('PHX').rank, 1.5);
  const top = one('Kj');
  const p = one('PHX', top);
  assert.equal(p.rank, 13.5);
  assert.ok(beats(p, top));
  assert.ok(beats(one('Aj'), p), 'A는 K.5를 이긴다');
  assert.equal(interpretations(ids('PHX'), one('DRG')).length, 0);
  assert.equal(interpretations(ids('PHX'), one('5j 5s')).length, 0, '페어 위에 봉황 싱글은 불가');
});

test('봉황이 들어간 페어·트리플·풀하우스', () => {
  assert.deepEqual([one('8j PHX').type, one('8j PHX').rank], ['pair', 8]);
  assert.equal(one('8j 8s PHX').type, 'triple');
  const fh = one('7j 7s 7p 3j PHX');
  assert.deepEqual([fh.type, fh.rank, fh.phx], ['fullhouse', 7, 3]);
  const two = interpretations(ids('7j 7s 3j 3s PHX'), null);
  assert.deepEqual(two.map((c) => c.rank).sort((a, b) => a - b), [3, 7], '2+2+봉황은 두 가지 풀하우스');
});

test('스트레이트: 5장 이상, 에이스가 가장 높고 이어지지 않는다', () => {
  const s = one('3j 4s 5p 6t 7j');
  assert.deepEqual([s.type, s.rank, s.n], ['straight', 7, 5]);
  assert.equal(label(s), '스트레이트 3~7');
  assert.equal(interpretations(ids('Qj Ks Ap 2t 3j'), null).length, 0, 'A-2 연결 불가');
  assert.equal(interpretations(ids('3j 4s 5p 6t'), null).length, 0, '4장은 스트레이트가 아니다');
  assert.equal(one('MJ 2j 3s 4p 5t').rank, 5, '참새는 1로 스트레이트에 들어간다');
});

test('봉황 스트레이트: 가운데는 그 자리, 끝이면 두 해석, 참새 자리(1)는 못 채운다', () => {
  const gap = one('3j 4s 6p 7t PHX');
  assert.deepEqual([gap.rank, gap.phx], [7, 5]);
  const ends = interpretations(ids('3j 4s 5p 6t PHX'), null);
  assert.deepEqual(ends.map((c) => c.rank).sort((a, b) => a - b), [6, 7]);
  assert.deepEqual(phoenixChoices(ids('3j 4s 5p 6t PHX'), null), [2, 7]);
  const top = one('2j 3s 4p 5t 6j');
  assert.equal(pickCombo(ids('3j 4s 5p 6t PHX'), top).rank, 7, '이길 수 있는 해석을 자동으로 고른다');
  assert.equal(pickCombo(ids('3j 4s 5p 6t PHX'), top, { as: 2 }), null, '2~6 위에 2~6은 못 낸다');
  assert.equal(pickCombo(ids('3j 4s 5p 6t PHX'), top, { as: 7 }).rank, 7);
  assert.deepEqual(interpretations(ids('10j Js Qp Kt PHX'), null).map((c) => c.rank).sort((a, b) => a - b), [13, 14]);
  assert.equal(interpretations(ids('Jj Qs Kp At PHX'), null).length, 1, 'A 위로는 못 늘리고 10으로만');
  assert.equal(interpretations(ids('2j 3s 4p 5t PHX'), null).length, 1, '1 자리에는 봉황을 못 둔다');
});

test('연속 페어', () => {
  const p = one('5j 5s 6p 6t');
  assert.deepEqual([p.type, p.rank, p.n], ['pairseq', 6, 4]);
  assert.equal(label(p), '연속 페어 5~6');
  assert.equal(interpretations(ids('5j 5s 7p 7t'), null).length, 0);
  const withPhx = one('5j 5s 6p PHX');
  assert.deepEqual([withPhx.type, withPhx.phx], ['pairseq', 6]);
  assert.equal(one('9j 9s 10p 10t Jj Js').rank, 11);
});

test('폭탄: 네 장 같은 숫자와 스트레이트 플러시, 봉황은 폭탄이 못 된다', () => {
  assert.deepEqual([bomb('9j 9s 9p 9t').type, bomb('9j 9s 9p 9t').bomb], ['bomb4', true]);
  assert.equal(interpretations(ids('9j 9s 9p PHX'), null).filter((c) => c.bomb).length, 0);
  assert.deepEqual(interpretations(ids('4j 5j 6j 7j 8j'), null).map((c) => c.type).sort(), ['bombSF', 'straight']);
  assert.equal(interpretations(ids('4j 5j 6j 7j 8s'), null).some((c) => c.bomb), false);
});

test('폭탄 우열: 아무 조합 < 네 장 < 플러시(긴 것·높은 것이 이김)', () => {
  const pair = one('Aj As');
  const b4 = bomb('3j 3s 3p 3t');
  const b4hi = bomb('4j 4s 4p 4t');
  const sf5 = bomb('4j 5j 6j 7j 8j');
  const sf5hi = bomb('5s 6s 7s 8s 9s');
  const sf6 = bomb('2p 3p 4p 5p 6p 7p');
  assert.ok(beats(b4, pair) && beats(b4, one('DRG')));
  assert.ok(beats(b4hi, b4) && !beats(b4, b4hi));
  assert.ok(beats(sf5, b4hi) && !beats(b4hi, sf5));
  assert.ok(beats(sf5hi, sf5) && beats(sf6, sf5hi));
  assert.ok(!beats(pair, b4));
});

test('같은 종류·같은 장수끼리만 비교된다', () => {
  assert.ok(beats(one('9j 9s'), one('8j 8s')));
  assert.ok(!beats(one('9j 9s 9p'), one('8j 8s')));
  assert.ok(!beats(one('3j 4s 5p 6t 7j 8s'), one('3j 4s 5p 6t 7j')));
  assert.ok(beats(one('DRG'), one('Aj')));
  assert.ok(!beats(one('MJ'), one('2j')));
});

test('pickCombo: 내 차례가 아니면 폭탄만, 플러시는 평소 스트레이트로 낸다', () => {
  const top = one('8j 8s');
  assert.equal(pickCombo(ids('9j 9s'), top, { outOfTurn: true }), null);
  assert.equal(pickCombo(ids('3j 3s 3p 3t'), top, { outOfTurn: true }).type, 'bomb4');
  assert.equal(pickCombo(ids('4j 5j 6j 7j 8j'), null).type, 'straight');
  assert.equal(pickCombo(ids('4j 5j 6j 7j 8j'), one('3j 4s 5p 6t 7j'), { outOfTurn: false }).type, 'straight');
  assert.equal(pickCombo(ids('4j 5j 6j 7j 8j'), one('9s 9p 9t 9j'), { outOfTurn: false }).type, 'bombSF');
});

test('enumeratePlays: 이길 수 있는 조합만, 봉황·참새 포함', () => {
  const hand = ids('MJ 2j 3s 4p 5t 5j 9s 9p Kj Ks PHX DRG DOG 7t');
  const lead = enumeratePlays(hand, null);
  assert.ok(lead.some((c) => c.type === 'dog'));
  assert.ok(lead.some((c) => c.type === 'straight' && c.n === 5 && c.rank === 5), '참새 스트레이트');
  const top = one('8j 8s');
  const resp = enumeratePlays(hand, top);
  assert.ok(resp.length > 0 && resp.every((c) => beats(c, top)));
  assert.ok(resp.some((c) => c.type === 'pair' && c.rank === 9));
  assert.ok(resp.every((c) => c.type === 'pair' || c.bomb));
  assert.ok(!resp.some((c) => c.type === 'dog'));
});

test('enumeratePlays의 모든 조합은 pickCombo로 다시 검증된다(무작위 손패)', () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const tops = ['6j', '8j 8s', '5j 5s 5p', '3j 4s 5p 6t 7j', '9j 9s 9p 9t'].map((s) => one(s));
  for (let i = 0; i < 300; i++) {
    const hand = Array.from({ length: 56 }, (_, k) => k).sort(() => rnd() - 0.5).slice(0, 14);
    const top = i % 3 === 0 ? null : tops[Math.floor(rnd() * tops.length)];
    for (const c of enumeratePlays(hand, top)) {
      assert.ok(c.ids.every((id) => hand.includes(id)));
      const again = pickCombo(c.ids, top, c.phx ? { as: c.phx } : {});
      assert.ok(again, `재검증 실패 ${label(c)}`);
      assert.ok(beats(again, top));
    }
  }
});
