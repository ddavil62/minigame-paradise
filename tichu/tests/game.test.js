import test from 'node:test';
import assert from 'node:assert/strict';
import { TichuGame } from '../lib/game.js';
import { decide, decideInterrupt } from '../lib/ai.js';
import { idOf, seededRng, pointsSum, MJ } from '../lib/cards.js';
import { playFullMatch } from './helpers.js';

const ids = (s) => (s ? s.split(/\s+/).map(idOf) : []);

/** 교환까지 끝낸 뒤 손패를 시나리오대로 바꿔 놓은 대국(내 차례는 turn 좌석). */
function setup(hands, { turn = 0, settings = {}, calls = null, wish = null } = {}) {
  const g = new TichuGame({ settings: { grand: false, bombWindowMs: 0, ...settings }, rng: seededRng(1), now: () => 0 });
  g.start();
  for (let s = 0; s < 4; s++) g.act(s, { type: 'exchange', give: g.h.hands[s].slice(0, 3) });
  assert.equal(g.phase, 'play');
  g.h.hands = hands.map((x) => ids(x).sort((a, b) => a - b));
  g.h.started = [false, false, false, false];
  g.h.calls = calls || [null, null, null, null];
  g.h.wish = wish;
  g.pending = { type: 'turn', seat: turn };
  g.drainEvents();
  return g;
}
const play = (g, seat, s, extra = {}) => g.act(seat, { type: 'play', ids: ids(s), ...extra });

// 14장을 맞추기 위한 채움 카드(시나리오에서 쓰지 않는 낮은 카드)
const FILL = '2j 2s 2p 2t 3j 3s 3p 3t 4j 4s 4p 4t 6j 6s';

test('그랜드 티추: 8장 → 모두 선택 → 6장 더 → 교환 단계', () => {
  const g = new TichuGame({ rng: seededRng(3), now: () => 0 });
  g.start();
  assert.equal(g.pending.type, 'grand');
  assert.ok(g.viewFor(0).hand.length === 8);
  assert.equal(g.act(0, { type: 'tichu' }).ok, false, '그랜드 선택 중에는 일반 티추 불가');
  g.act(0, { type: 'grand', on: true });
  assert.equal(g.act(0, { type: 'grand', on: false }).ok, false, '두 번 선택 불가');
  assert.equal(g.viewFor(1).calls[0], null, '다른 사람의 선택은 모두 정해질 때까지 안 보인다');
  for (const s of [1, 2, 3]) g.act(s, { type: 'grand', on: false });
  assert.equal(g.phase, 'exchange');
  assert.equal(g.viewFor(1).calls[0], 'grand');
  assert.ok([0, 1, 2, 3].every((s) => g.viewFor(s).hand.length === 14));
});

test('카드 교환: 왼쪽·파트너·오른쪽에 한 장씩, 참새를 가진 사람이 선', () => {
  const g = new TichuGame({ settings: { grand: false }, rng: seededRng(5), now: () => 0 });
  g.start();
  const before = [0, 1, 2, 3].map((s) => g.viewFor(s).hand.slice());
  const give = before.map((h) => h.slice(0, 3));
  assert.equal(g.act(0, { type: 'exchange', give: [999, 1, 2] }).ok, false);
  assert.equal(g.act(0, { type: 'exchange', give: [give[0][0], give[0][0], give[0][1]] }).ok, false);
  for (let s = 0; s < 4; s++) assert.ok(g.act(s, { type: 'exchange', give: give[s] }).ok);
  assert.equal(g.phase, 'play');
  assert.deepEqual(g.h.given[0].map((x) => x.to), [1, 2, 3]);
  const v1 = g.viewFor(1);
  assert.equal(v1.received.find((r) => r.from === 0).id, give[0][0], '왼쪽(좌석+1)에는 첫 장');
  assert.ok(g.viewFor(2).received.some((r) => r.from === 0 && r.id === give[0][1]), '파트너에는 둘째 장');
  assert.ok(g.viewFor(3).received.some((r) => r.from === 0 && r.id === give[0][2]), '오른쪽에는 셋째 장');
  const holder = [0, 1, 2, 3].find((s) => g.viewFor(s).hand.includes(MJ));
  assert.equal(g.pending.seat, holder);
});

test('트릭: 모두 패스하면 낸 사람이 가져가고 다시 선을 잡는다', () => {
  const g = setup([`5j 5s ${FILL}`, `8j 8s ${FILL}`, `9j ${FILL}`, `Kj ${FILL}`]);
  assert.ok(play(g, 0, '5j 5s').ok);
  assert.equal(g.pending.seat, 1);
  assert.equal(g.act(1, { type: 'pass' }).ok, true);
  assert.equal(g.act(2, { type: 'pass' }).ok, true);
  assert.equal(g.act(3, { type: 'pass' }).ok, true);
  assert.equal(g.pending.seat, 0);
  assert.equal(g.h.trick.top, null);
  assert.equal(pointsSum(g.h.won[0]), 10, '5점 카드 두 장');
  assert.equal(g.act(0, { type: 'pass' }).ok, false, '선은 패스할 수 없다');
});

test('같은 종류·더 높은 것만 낼 수 있고, 내 차례가 아니면 거절', () => {
  const g = setup([`5j 5s ${FILL}`, `4j 4s ${FILL}`, `9j 9s ${FILL}`, `Kj ${FILL}`]);
  play(g, 0, '5j 5s');
  assert.equal(play(g, 1, '4j 4s').error, 'illegal');
  assert.equal(play(g, 2, '9j 9s').error, 'not_turn');
  assert.equal(play(g, 1, '4j').error, 'illegal');
});

test('개: 파트너에게 선을 넘기고, 파트너가 나갔으면 그 다음 사람', () => {
  let g = setup([`DOG 5j ${FILL}`, FILL, FILL.replace('2j', '7j'), FILL.replace('2s', '7s')]);
  assert.ok(play(g, 0, 'DOG').ok);
  assert.equal(g.pending.seat, 2);
  assert.equal(g.h.trick.top, null);
  assert.equal(g.h.won[0].length, 1);
  g = setup(['DOG 5s', '5j', '7j', '8j'], { turn: 0 });
  g.h.out = [2];
  g.h.hands[2] = [];
  play(g, 0, 'DOG');
  assert.equal(g.roundOver(), false);
  assert.equal(g.pending.seat, 3, '파트너(2) 다음 사람');
});

test('개는 트릭 위에 낼 수 없다', () => {
  const g = setup([`5j ${FILL}`, `DOG ${FILL}`, FILL, FILL]);
  play(g, 0, '5j');
  assert.equal(play(g, 1, 'DOG').error, 'illegal');
});

test('폭탄은 내 차례가 아니어도 낼 수 있고, 일반 조합은 안 된다', () => {
  const g = setup([`9j ${FILL}`, `Kj ${FILL}`, `Qj ${FILL}`, `5j 5s 5p 5t ${FILL}`.replace('4t', '7t').replace('4s', '7s')]);
  play(g, 0, '9j');
  assert.equal(play(g, 2, 'Qj').error, 'not_turn');
  const bombRes = play(g, 3, '5j 5s 5p 5t');
  assert.ok(bombRes.ok, bombRes.error);
  assert.equal(g.pending.seat, 0, '폭탄을 낸 사람 다음 순서로 이어진다');
  assert.equal(g.h.trick.topSeat, 3);
  assert.equal(g.legalFor(1).kind, 'wait');
});

test('내 차례가 아닌데 맨 앞(트릭 없음)에서 폭탄은 낼 수 없다', () => {
  const g = setup([`9j ${FILL}`, FILL, FILL, `5j 5s 5p 5t ${FILL}`.replace('4t', '7t').replace('4s', '7s')]);
  assert.equal(play(g, 3, '5j 5s 5p 5t').error, 'not_turn');
});

test('폭탄 끼어들기 대기: 낸 직후에는 다음 사람이 일반 조합을 못 내지만 폭탄은 된다', () => {
  let t = 1000;
  const g = new TichuGame({ settings: { grand: false, bombWindowMs: 2000 }, rng: seededRng(1), now: () => t });
  g.start();
  for (let s = 0; s < 4; s++) g.act(s, { type: 'exchange', give: g.h.hands[s].slice(0, 3) });
  g.h.hands = [`9j ${FILL}`, `Kj ${FILL}`, FILL, FILL].map(ids);
  g.pending = { type: 'turn', seat: 0 };
  play(g, 0, '9j');
  assert.equal(play(g, 1, 'Kj').error, 'wait');
  assert.equal(g.act(1, { type: 'pass' }).error, 'wait');
  t += 2100;
  assert.ok(play(g, 1, 'Kj').ok);
});

test('용: 가장 높은 싱글이고, 이기면 상대 팀 한 명에게 트릭을 선물해야 한다', () => {
  const g = setup([`Kj 5j ${FILL}`, `Aj ${FILL}`, `DRG ${FILL}`, `Qj ${FILL}`], { turn: 0 });
  play(g, 0, 'Kj');
  play(g, 1, 'Aj');
  play(g, 2, 'DRG');
  g.act(3, { type: 'pass' });
  g.act(0, { type: 'pass' });
  g.act(1, { type: 'pass' });
  assert.equal(g.pending.type, 'gift');
  assert.equal(g.pending.seat, 2);
  assert.deepEqual(g.pending.options, [3, 1]);
  assert.equal(g.act(2, { type: 'gift', to: 0 }).ok, false, '파트너·본인에게는 줄 수 없다');
  const pile = pointsSum(g.h.trick.pile);
  assert.equal(pile, 35);
  assert.ok(g.act(2, { type: 'gift', to: 1 }).ok);
  assert.equal(pointsSum(g.h.won[1]), 35);
  assert.equal(g.pending.seat, 2, '용을 낸 사람이 다시 선');
});

test('봉황: 싱글로 직전 싱글 +0.5, 점수는 −25', () => {
  const g = setup([`7j ${FILL}`, `PHX ${FILL}`, FILL, FILL]);
  play(g, 0, '7j');
  assert.ok(play(g, 1, 'PHX').ok);
  assert.equal(g.h.trick.top.rank, 7.5);
  assert.equal(pointsSum(g.h.trick.pile), -25);
});

test('소원: 낼 수 있으면 반드시 그 숫자를 내야 하고 패스할 수 없다, 이루어지면 사라진다', () => {
  const g = setup([`MJ 9j ${FILL}`, `Qj Qs ${FILL}`, `9s ${FILL}`, `Kj ${FILL}`]);
  assert.ok(play(g, 0, 'MJ', { wish: 12 }).ok);
  assert.equal(g.h.wish, 12);
  assert.equal(g.act(1, { type: 'pass' }).error, 'wish');
  assert.equal(play(g, 1, 'Qj').ok, true, '싱글 Q는 참새 위에 낼 수 있다');
  assert.equal(g.h.wish, null);
  assert.equal(g.act(2, { type: 'pass' }).ok, true, '소원이 끝났으니 패스 가능');
});

test('소원: 그 숫자를 낼 수 없는 사람은 패스할 수 있다', () => {
  const g = setup([`MJ 9j ${FILL}`, `Qj ${FILL}`, `5j ${FILL}`, `Kj ${FILL}`]);
  play(g, 0, 'MJ', { wish: 9 });
  assert.equal(g.act(1, { type: 'pass' }).ok, true, '9가 없다');
  assert.equal(g.legalFor(2).canPass, true);
  assert.equal(g.h.wish, 9);
});

test('소원: 선일 때도 소원 숫자가 든 조합을 내야 한다(개로 도망 불가)', () => {
  const g = setup([`DOG 9j 5s ${FILL}`, FILL, FILL, FILL], { wish: 9 });
  assert.equal(play(g, 0, 'DOG').error, 'wish');
  assert.equal(play(g, 0, '5s').error, 'wish');
  assert.ok(play(g, 0, '9j').ok);
  assert.equal(g.h.wish, null);
});

test('티추 콜: 첫 카드를 내기 전에만, 내 차례가 아니어도 가능', () => {
  const g = setup([`5j ${FILL}`, `Kj ${FILL}`, FILL, FILL]);
  assert.ok(g.act(2, { type: 'tichu' }).ok);
  assert.equal(g.act(2, { type: 'tichu' }).ok, false, '두 번 불가');
  play(g, 0, '5j');
  assert.equal(g.act(0, { type: 'tichu' }).ok, false, '이미 냈다');
  g.act(1, { type: 'pass' });
  assert.equal(g.act(1, { type: 'tichu' }).ok, false, '패스도 첫 행동이다');
  assert.equal(g.viewFor(3).calls[2], 'tichu');
});

test('원투 피니시: 같은 팀이 1·2등이면 200점(카드 점수 무시)이고 라운드가 바로 끝난다', () => {
  const g = setup([`5j`, `Kj ${FILL}`, `9j`, `Qj ${FILL}`], { turn: 0 });
  play(g, 0, '5j');
  g.act(1, { type: 'pass' });
  assert.ok(play(g, 2, '9j').ok);
  assert.equal(g.phase, 'roundEnd');
  assert.equal(g.result.oneTwo, true);
  assert.deepEqual(g.result.total, [200, 0]);
  assert.deepEqual(g.scores, [200, 0]);
});

test('티추 성공 +100 / 그랜드 실패 −200: 첫 번째로 나가야 성공', () => {
  const g = setup(['5j', 'Kj', 'Qj', 'Aj'], { turn: 0, calls: ['tichu', 'grand', null, null] });
  assert.ok(play(g, 0, '5j').ok);
  assert.deepEqual(g.h.out, [0]);
  for (const s of [1, 2, 3]) assert.ok(g.act(s, { type: 'pass' }).ok);
  assert.equal(pointsSum(g.h.won[0]), 5, '나간 사람의 트릭도 그 사람 몫');
  assert.equal(g.pending.seat, 1, '이긴 사람이 나갔으면 다음 사람이 선');
  assert.ok(play(g, 1, 'Kj').ok);
  g.act(2, { type: 'pass' });
  assert.ok(play(g, 3, 'Aj').ok);
  assert.equal(g.phase, 'roundEnd');
  const r = g.result;
  assert.deepEqual(r.order, [0, 1, 3, 2]);
  assert.deepEqual(r.cardPts, [5, 10]);
  assert.deepEqual(r.bonus, [100, -200]);
  assert.deepEqual(r.total, [105, -190]);
  assert.deepEqual(r.tichu, [{ seat: 0, call: 'tichu', ok: true }, { seat: 1, call: 'grand', ok: false }]);
  assert.deepEqual(g.scores, [105, -190]);
});

test('정산: 꼴찌의 딴 카드는 1등에게, 남은 손패 점수는 상대 팀에게', () => {
  const g = setup(['5j', '10j', 'Kj', '5s 10s'], { turn: 0 });
  g.h.won[3] = ids('Kp Kt');
  play(g, 0, '5j');
  assert.ok(play(g, 1, '10j').ok);
  assert.ok(play(g, 2, 'Kj').ok);
  assert.equal(g.phase, 'roundEnd');
  const r = g.result;
  assert.equal(r.lastSeat, 3);
  assert.equal(r.oneTwo, false);
  assert.equal(r.lastHand.length, 2);
  // 팀0 = 1등(좌석 0)이 받은 꼴찌의 트릭 20 + 좌석 2가 이긴 트릭 25 + 꼴찌 손패 15
  assert.deepEqual(r.cardPts, [60, 0]);
  assert.equal(pointsSum(g.h.won[0]), 20);
  assert.equal(g.h.won[3].length, 0);
});

test('점수 합과 카드 보존: AI 4명이 여러 판을 끝까지 두어도 규칙이 깨지지 않는다', () => {
  for (let seed = 1; seed <= 40; seed++) {
    let rounds = 0;
    const { game } = playFullMatch(seed, {
      levels: ['easy', 'normal', 'hard', 'normal'],
      onStep(g) {
        const h = g.h;
        if (g.phase === 'play') {
          const all = [...h.hands.flat(), ...h.won.flat(), ...h.trick.pile];
          assert.equal(all.length, 56, `seed ${seed}: 카드 수 ${all.length}`);
          assert.equal(new Set(all).size, 56, `seed ${seed}: 중복 카드`);
        }
        if (g.phase === 'roundEnd' && g.result.round !== rounds) {
          rounds = g.result.round;
          const r = g.result;
          assert.equal(r.cardPts[0] + r.cardPts[1], r.oneTwo ? 200 : 100, `seed ${seed} 라운드 ${rounds} 카드 점수`);
          assert.equal(r.order.length, r.oneTwo ? 2 : 4);
        }
      },
    });
    assert.equal(game.phase, 'over');
    assert.ok(game.scores.some((s) => s >= 1000));
    assert.notEqual(game.scores[0], game.scores[1]);
  }
});

test('뷰에는 상대 손패가 들어가지 않는다(상대 손패를 바꿔도 내 뷰가 같다)', () => {
  const g = new TichuGame({ settings: { grand: false }, rng: seededRng(9), now: () => 0 });
  g.start();
  const before = JSON.stringify(g.viewFor(0));
  g.h.hands[1] = g.h.hands[1].map((id) => (id + 20) % 56);
  g.h.hands[2] = g.h.hands[2].map((id) => (id + 31) % 56);
  assert.equal(JSON.stringify(g.viewFor(0)), before);
  assert.deepEqual(g.viewFor(0).counts, [14, 14, 14, 14]);
});

test('AI: 폭탄 끼어들기는 상대가 곧 나가거나 용을 낼 때만', () => {
  const bombHand = '5j 5s 5p 5t Kp 7t 7s 8s 8p 9t 9p 10t 10p Jt';
  let g = setup(['9j Aj', 'Kj 3j', '2j 6j', bombHand], { turn: 0 });
  play(g, 0, '9j');
  const d = decideInterrupt(g.viewFor(3), { level: 'normal' });
  assert.deepEqual(d && d.ids.map((id) => id).sort(), ids('5j 5s 5p 5t').sort(), '상대가 2장 남으면 폭탄');
  assert.equal(decideInterrupt(g.viewFor(3), { level: 'easy' }), null);
  g = setup([`9j Aj ${FILL}`, 'Kj 3j', '2j 6j', bombHand], { turn: 0 });
  play(g, 0, '9j');
  assert.equal(decideInterrupt(g.viewFor(3), { level: 'normal' }), null, '상대 손이 많으면 아낀다');
  g = setup([`DRG ${FILL}`, 'Kj 3j', '2j 6j', bombHand], { turn: 0 });
  play(g, 0, 'DRG');
  assert.ok(decideInterrupt(g.viewFor(3), { level: 'normal' }), '용에는 폭탄');
  assert.equal(decideInterrupt(g.viewFor(2), { level: 'normal' }), null, '파트너 팀의 플레이에는 끼어들지 않는다');
});

test('AI: 폭탄이 아닌 선택은 항상 합법이다(여러 난이도·시드)', () => {
  for (const level of ['easy', 'normal', 'hard']) {
    for (let seed = 50; seed < 56; seed++) {
      playFullMatch(seed, { levels: [level, level, level, level] });
    }
  }
});
