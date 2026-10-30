/**
 * @fileoverview 화료 판정·역·부수·점수·향청수 단위 테스트.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateHand, getWaits, shanten, basePoints, paymentOf, decompose, isAgariShape,
} from '../lib/agari.js';

/** "123m456p789s11z" → 종류별 개수 */
function parse(str) {
  const c = new Array(34).fill(0);
  let digits = [];
  for (const ch of str) {
    if (ch >= '0' && ch <= '9') { digits.push(+ch); continue; }
    const base = { m: 0, p: 9, s: 18, z: 27 }[ch];
    for (const d of digits) c[base + d - 1] += 1;
    digits = [];
  }
  return c;
}
const kind = (s) => { const c = parse(s); return c.findIndex((v) => v > 0); };

const BASE = { seatWind: 28, roundWind: 27, tsumo: false, rules: { kuitan: true } };

test('핑후 탕야오 리치 론: 3판 30부 = 3900', () => {
  const r = evaluateHand({ ...BASE, counts: parse('234m456p678s34p55s' + '5p'), winKind: kind('5p'), riichi: 1 });
  assert.ok(r);
  const names = r.yaku.map((y) => y.name);
  assert.ok(names.includes('핑후') && names.includes('탕야오') && names.includes('리치'));
  assert.equal(r.han, 3);
  assert.equal(r.fu, 30);
  assert.equal(paymentOf(basePoints(r.han, r.fu), false, false).ron, 3900);
});

test('핑후 쯔모는 20부', () => {
  const r = evaluateHand({ ...BASE, tsumo: true, counts: parse('234m456p678s34p55s' + '5p'), winKind: kind('5p'), riichi: 1 });
  assert.equal(r.fu, 20);
  assert.equal(r.han, 4); // 리치 멘젠쯔모 핑후 탕야오
});

test('역이 없으면 null (쿠이탕 없는 경우 포함)', () => {
  const r = evaluateHand({ ...BASE, counts: parse('234p456m678s99p'), melds: [{ type: 'pon', k: kind('5p') }], winKind: kind('9p') });
  assert.equal(r, null);
});

test('쿠이탕 규칙 off면 울고 탕야오 불가', () => {
  const ctx = { ...BASE, counts: parse('234p456m678s55p'), melds: [{ type: 'chi', k: kind('2s') }], winKind: kind('5p') };
  assert.ok(evaluateHand(ctx));
  assert.equal(evaluateHand({ ...ctx, rules: { kuitan: false } }), null);
});

test('치또이츠 리치: 3판 25부 = 3200', () => {
  const r = evaluateHand({ ...BASE, counts: parse('113355m2255p4477s'), winKind: kind('4s'), riichi: 1 });
  assert.equal(r.fu, 25);
  assert.equal(r.han, 3);
  assert.equal(paymentOf(basePoints(r.han, r.fu), false, false).ron, 3200);
});

test('국사무쌍 / 13면 대기는 더블 역만', () => {
  const normal = evaluateHand({ ...BASE, counts: parse('19m19p19s1234567z' + '1m'), winKind: kind('1m') });
  assert.equal(normal.yakuman, 2); // 1m 가 머리, 화료패도 1m → 13면
  const single = evaluateHand({ ...BASE, counts: parse('19m19p19s1234567z' + '1m'), winKind: kind('7z') });
  assert.equal(single.yakuman, 1);
});

test('대삼원', () => {
  const r = evaluateHand({ ...BASE, counts: parse('555666777z234m11p'), winKind: kind('1p') });
  assert.equal(r.yakuman, 1);
  assert.equal(paymentOf(basePoints(0, 0, 1), true, true).allPay, 16000);
});

test('친 쯔모 만관 4000 올 / 자 쯔모 만관 2000-4000', () => {
  const base = basePoints(5, 30);
  assert.equal(paymentOf(base, true, true).allPay, 4000);
  const c = paymentOf(base, false, true);
  assert.equal(c.dealerPay, 4000);
  assert.equal(c.childPay, 2000);
  assert.equal(paymentOf(base, false, false).ron, 8000);
  assert.equal(paymentOf(base, true, false).ron, 12000);
});

test('끊어올림 만관: 4판 30부는 만관', () => {
  assert.equal(basePoints(4, 30), 2000);
  assert.equal(basePoints(3, 60), 2000);
  assert.equal(basePoints(3, 30), 960);
});

test('역패 퐁 + 도라: 2판 30부', () => {
  const ok = evaluateHand({
    ...BASE, counts: parse('234m567p88s'), melds: [{ type: 'pon', k: kind('5z') }, { type: 'chi', k: kind('4s') }],
    winKind: kind('8s'), dora: 1,
  });
  assert.ok(ok);
  assert.ok(ok.yaku.some((y) => y.name === '역패 백'));
  assert.equal(ok.han, 2);
  assert.equal(ok.fu, 30);
});

test('이페코', () => {
  const r = evaluateHand({ ...BASE, counts: parse('112233m456p789s11z'), winKind: kind('3m') });
  assert.ok(r.yaku.some((y) => y.name === '이페코'));
  assert.equal(r.han, 1);
  assert.equal(r.fu, 40);
});

test('삼색동순 멘젠 리치', () => {
  const ok = evaluateHand({ ...BASE, counts: parse('234m234p234s567s11z'), winKind: kind('7s'), riichi: 1 });
  assert.ok(ok);
  assert.ok(ok.yaku.some((y) => y.name === '삼색동순'));
  assert.equal(ok.han, 3);
});

test('순정구련보등은 더블 역만', () => {
  const r = evaluateHand({ ...BASE, counts: parse('1112345678999m5m'), winKind: kind('5m') });
  assert.equal(r.yakuman, 2);
  assert.ok(r.yaku.some((y) => y.name === '순정구련보등'));
});

test('대기패', () => {
  const waits = getWaits(parse('123m456p789s23p11z'), 0);
  assert.deepEqual(waits, [kind('1p'), kind('4p'), kind('7p')]);
});

test('향청수', () => {
  assert.equal(shanten(parse('123m456p789s23p11z'), 0), 0);
  assert.equal(shanten(parse('123m456p789s23p11z4p'), 0), -1);
  assert.equal(shanten(parse('19m19p19s1234567z'), 0), 0);
  assert.equal(shanten(parse('113355m22p4477s1z'), 0), 0);
  assert.ok(shanten(parse('147m258p369s1234z'), 0) >= 4);
});

test('분해: 111222333 은 각자/순자 둘 다 나온다', () => {
  const ds = decompose(parse('111222333m55p'));
  assert.ok(ds.length >= 2);
  assert.ok(isAgariShape(parse('111222333m55p'), 0));
});

test('부수: 암각(2종 중) + 간짱 + 역패 머리 = 40부', () => {
  const r = evaluateHand({ ...BASE, counts: parse('444p123s789s456m55z'), winKind: kind('5m'), riichi: 1 });
  assert.equal(r.han, 1);
  assert.equal(r.fu, 40);
  assert.equal(paymentOf(basePoints(r.han, r.fu), false, false).ron, 1300);
});

test('론으로 완성한 샤보 각자는 명각 취급(스안커 불성립)', () => {
  const ron = evaluateHand({ ...BASE, counts: parse('111m222p333s444z55z'), winKind: kind('4z') });
  assert.ok(!ron || ron.yakuman === 0);
  const tsumo = evaluateHand({ ...BASE, tsumo: true, counts: parse('111m222p333s444z55z'), winKind: kind('4z') });
  assert.equal(tsumo.yakuman, 1);
});

// ── 역별 관련 패(hl): 결과 화면 강조용 ──────────────────────

/** hl이 화료 손(멘젠 + 부로)의 부분 다중집합인지 확인한다. */
function assertHlWithin(r, counts, melds = []) {
  const left = counts.slice();
  for (const m of melds) {
    const n = m.type === 'chi' ? [0, 1, 2] : m.type === 'pon' ? [0, 0, 0] : [0, 0, 0, 0];
    for (const d of n) left[m.k + d]++;
  }
  for (const y of r.yaku) {
    const need = new Array(34).fill(0);
    for (const k of y.hl || []) need[k]++;
    need.forEach((n, k) => assert.ok(n <= left[k], `${y.name}: kind ${k} hl ${n} > hand ${left[k]}`));
  }
}

test('hl: 이페코는 같은 순쯔 2개, 삼색동순은 세 색 순쯔', () => {
  const counts = parse('112233m456p789s11z');
  const r = evaluateHand({ ...BASE, counts, winKind: kind('3m') });
  assert.deepEqual(r.yaku.find((y) => y.name === '이페코').hl.slice().sort((a, b) => a - b), [0, 0, 1, 1, 2, 2]);
  assertHlWithin(r, counts);
  const c2 = parse('234m234p234s567s11z');
  const r2 = evaluateHand({ ...BASE, counts: c2, winKind: kind('7s'), riichi: 1 });
  assert.deepEqual(r2.yaku.find((y) => y.name === '삼색동순').hl.slice().sort((a, b) => a - b), [1, 2, 3, 10, 11, 12, 19, 20, 21]);
  assertHlWithin(r2, c2);
});

test('hl: 패와 무관한 역(리치·멘젠쯔모)은 hl이 없고 형태 역은 손 안에 있다', () => {
  const counts = parse('234m456p678s34p55s' + '5p');
  const r = evaluateHand({ ...BASE, tsumo: true, counts, winKind: kind('5p'), riichi: 1 });
  for (const n of ['리치', '멘젠쯔모']) assert.equal(r.yaku.find((y) => y.name === n).hl, undefined);
  for (const n of ['탕야오', '핑후']) assert.equal(r.yaku.find((y) => y.name === n).hl.length, 14);
  assertHlWithin(r, counts);
});

test('hl: 역패·부로 포함 손에서도 손 안의 패만 가리킨다', () => {
  const counts = parse('234m456p99s');
  const melds = [{ type: 'pon', k: kind('5z') }, { type: 'chi', k: kind('2s') }];
  const r = evaluateHand({ ...BASE, counts, melds, winKind: kind('9s') });
  assert.ok(r);
  assertHlWithin(r, counts, melds);
  assert.deepEqual(r.yaku.find((y) => y.name === '역패 백').hl, [31, 31, 31]);
});

test('화료 결과에 묶음 분해(layout)가 담긴다: 표준형은 면자+머리+화료 묶음, 치또이츠는 쌍 목록', () => {
  const std = evaluateHand({ ...BASE, counts: parse('234m456p678s34p55s' + '5p'), winKind: kind('5p'), riichi: 1 });
  assert.equal(std.shape, 'standard');
  assert.equal(std.layout.pair, kind('5s'));
  assert.equal(std.layout.sets.length, 4);
  assert.ok(std.layout.win === 'pair' || Number.isInteger(std.layout.win));
  const chi = evaluateHand({ ...BASE, counts: parse('1122m3344p5566s77z'), winKind: kind('7z'), riichi: 1 });
  assert.equal(chi.shape, 'chiitoi');
  assert.equal(chi.layout.pairs.length, 7);
});
