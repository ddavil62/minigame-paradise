/**
 * @fileoverview BUGFIX-DUP — 폭탄 후 덱 뒤집기 + awaiting_floor_choice 복제 버그 재현.
 * 사용자 신고: 폭탄 후 통상 뒤집기에서 바닥 같은 월 2장 → 선택 → 양쪽 captured/floor에 복제.
 *
 * Node 직접 실행: `node tests/bombdup-adhoc.mjs`
 */

import { playCard, chooseFloor, bomb, bonusFlipSteps } from '../game.js';
import { buildDeck } from '../cards.js';

const ALL = buildDeck();
const BY_ID = Object.fromEntries(ALL.map((c) => [c.id, c]));
const card = (id) => {
  const c = BY_ID[id];
  if (!c) throw new Error(`카드 ${id} 없음`);
  return c;
};

function makeGame({ p1Hand = [], p2Hand = [], floor = [], deck = [], turn = 'p1' } = {}) {
  return {
    deck:    deck.map(card),
    floor:   floor.map(card),
    hands:   { p1: p1Hand.map(card), p2: p2Hand.map(card) },
    captured: { p1: [], p2: [] },
    ppeokFlags: {},
    ppeokCount: { p1: 0, p2: 0 },
    pendingFloorChoice: null,
    turn,
    phase: 'awaiting_play',
    goCount:  { p1: 0, p2: 0 },
    shaking:  { p1: false, p2: false },
    money:    { p1: 10000, p2: 10000 },
    perPoint: 100,
    roundWinner: null,
    stoppedBy: null,
    lastAction: null,
    pendingShake: null,
    roundResult: null,
    lastGoScore: { p1: null, p2: null },
    kkeutAsSsangpi:   { p1: false, p2: false },
    kkeutChoiceMade:  { p1: false, p2: false },
    pendingKkeutChoice: null,
    pendingSangtong: null,
    shakeAsked: { p1: false, p2: false },
    bombExtraDraw: false,
    bombDeckCredit: { p1: 0, p2: 0 },
    firstPpeokBy: null,
  };
}

let passed = 0;
let failed = 0;
const results = [];

function it(name, fn) {
  try {
    fn();
    passed++;
    results.push(`  PASS  ${name}`);
  } catch (e) {
    failed++;
    results.push(`  FAIL  ${name}\n         ${e.message}\n${e.stack ? '         ' + e.stack.split('\n').slice(1, 3).join('\n         ') : ''}`);
  }
}

function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg || 'eq'} — got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`);
}
function truthy(v, msg) {
  if (!v) throw new Error(`${msg || 'truthy'} — got ${JSON.stringify(v)}`);
}

/**
 * 모든 카드(captured + floor + hand + deck) 합집합에서 중복 ID가 있는지 검사.
 * @param {object} g
 * @returns {string[]} 중복된 카드 ID 목록 (없으면 빈 배열)
 */
function findDupIds(g) {
  const all = [
    ...g.captured.p1, ...g.captured.p2,
    ...g.floor,
    ...g.hands.p1, ...g.hands.p2,
    ...g.deck,
  ];
  const seen = new Set();
  const dups = new Set();
  for (const c of all) {
    if (seen.has(c.id)) dups.add(c.id);
    seen.add(c.id);
  }
  return Array.from(dups);
}

// ── BUGFIX-DUP-001 ─────────────────────────────────────────────
// 시나리오: 폭탄(3월) → 통상 뒤집기에서 1월이 나오는데 바닥에 1월 2장 → awaiting_floor_choice → 선택
it('BUGFIX-DUP-001: 폭탄 후 통상 뒤집기 awaiting_floor_choice 복제 검사', () => {
  const g = makeGame({
    // p1 손: 4월 3장 (폭탄용 — gwang 없는 월, 손 3장 후보) + 7월 1장
    // 4월 슬롯: kkeut_godori, tti_cho, pi_a, pi_b → 폭탄 3장: tti_cho, pi_a, pi_b
    p1Hand: ['m04_tti_cho', 'm04_pi_a', 'm04_pi_b', 'm07_kkeut'],
    p2Hand: ['m06_kkeut'],
    // 바닥: 4월 1장 (폭탄 매칭용) + 1월 2장 (통상 뒤집기 시 선택 분기 유도) + 다른 월
    floor:  ['m04_kkeut_godori', 'm01_tti_hong', 'm01_pi_a', 'm05_kkeut'],
    // 덱 top(pop이므로 마지막): 1월 카드 → 바닥 1월 2장이라 awaiting_floor_choice 진입
    deck:   ['m01_pi_b'],
  });
  g.captured.p2 = [card('m06_pi_a')];

  const r1 = bomb(g, 'p1', 4);
  truthy(r1.ok, `bomb ok (err=${r1.error || ''})`);
  // 폭탄 후 통상 뒤집기에서 1월 1장 뒤집힘 → 바닥 1월 2장(m01_tti_hong, m01_pi_a)이라 선택 대기
  eq(g.phase, 'awaiting_floor_choice', 'awaiting_floor_choice 진입');
  eq(g.pendingFloorChoice.fromHand, false, 'fromHand=false (덱 뒤집기)');
  eq(g.pendingFloorChoice.srcCard.id, 'm01_pi_b', 'srcCard=m01_pi_b (덱에서 뒤집힌 카드)');

  // 사용자가 m01_tti_hong 선택
  const r2 = chooseFloor(g, 'p1', 'm01_tti_hong');
  truthy(r2.ok, 'chooseFloor ok');

  // 검증 1: 중복 카드 없음
  const dups = findDupIds(g);
  eq(dups.length, 0, `중복 카드 없음 (dups=${JSON.stringify(dups)})`);

  // 검증 2: floor에 m01_tti_hong / m01_pi_b 모두 없어야 함 (둘 다 captured.p1)
  truthy(!g.floor.some((c) => c.id === 'm01_tti_hong'), 'floor에 m01_tti_hong 없음');
  truthy(!g.floor.some((c) => c.id === 'm01_pi_b'),     'floor에 m01_pi_b 없음 (덱에서 온 srcCard)');

  // 검증 3: captured.p1에 m01_tti_hong + m01_pi_b 모두 있어야 함 (선택한 거 + srcCard)
  truthy(g.captured.p1.some((c) => c.id === 'm01_tti_hong'), 'captured.p1에 m01_tti_hong 있음');
  truthy(g.captured.p1.some((c) => c.id === 'm01_pi_b'),     'captured.p1에 m01_pi_b 있음');

  // 검증 4: 바닥에 1월 남은 카드는 m01_pi_a 1장만 있어야 함
  const floorJanuary = g.floor.filter((c) => c.month === 1);
  eq(floorJanuary.length, 1, '바닥 1월 1장 남음');
  eq(floorJanuary[0].id, 'm01_pi_a', '남은 1월은 m01_pi_a');
});

// ── BUGFIX-DUP-002 ─────────────────────────────────────────────
// fromHand=true (손패→2매칭→선택) 경로도 확인
it('BUGFIX-DUP-002: 손패 2매칭 → awaiting_floor_choice → 선택 후 복제 없음', () => {
  const g = makeGame({
    p1Hand: ['m01_gwang', 'm05_kkeut'],
    p2Hand: ['m06_kkeut'],
    floor:  ['m01_tti_hong', 'm01_pi_a'],
    deck:   ['m07_kkeut'], // 다른 월
  });
  g.captured.p2 = [card('m06_pi_a')];

  playCard(g, 'p1', 'm01_gwang');
  eq(g.phase, 'awaiting_floor_choice', 'awaiting_floor_choice');
  chooseFloor(g, 'p1', 'm01_tti_hong');

  const dups = findDupIds(g);
  eq(dups.length, 0, `중복 카드 없음 (dups=${JSON.stringify(dups)})`);
  truthy(!g.floor.some((c) => c.id === 'm01_tti_hong'), 'floor에 m01_tti_hong 없음');
  truthy(g.captured.p1.some((c) => c.id === 'm01_tti_hong'), 'captured.p1에 m01_tti_hong 있음');
});

// ── BUGFIX-DUP-003 ─────────────────────────────────────────────
// 보너스 뒤집기에서 awaiting_floor_choice 진입 → 선택 (bonusFlipSteps 경로)
it('BUGFIX-DUP-003: 보너스 뒤집기 awaiting_floor_choice 복제 검사', () => {
  const g = makeGame({
    p1Hand: [],
    p2Hand: ['m06_kkeut'],
    floor:  ['m01_tti_hong', 'm01_pi_a', 'm05_kkeut'],
    deck:   ['m01_pi_b'], // 뒤집어지면 바닥 1월 2장이라 선택 진입
  });
  g.bombDeckCredit = { p1: 2, p2: 0 };
  g.captured.p2 = [card('m06_pi_a')];

  // bonusFlipSteps 직접 소진
  for (const step of bonusFlipSteps(g, 'p1')) {
    if (step && step.error) throw new Error(step.error);
    if (step && step.step === 'bonus_flipped') break; // 추가 yield 막기 위해 break
  }
  eq(g.phase, 'awaiting_floor_choice', 'awaiting_floor_choice 진입');
  eq(g.pendingFloorChoice.fromHand, false, 'fromHand=false (보너스 뒤집기)');
  eq(g.pendingFloorChoice.srcCard.id, 'm01_pi_b', 'srcCard=m01_pi_b');

  chooseFloor(g, 'p1', 'm01_tti_hong');

  const dups = findDupIds(g);
  eq(dups.length, 0, `중복 카드 없음 (dups=${JSON.stringify(dups)})`);
  truthy(!g.floor.some((c) => c.id === 'm01_tti_hong'), 'floor에 m01_tti_hong 없음');
  truthy(!g.floor.some((c) => c.id === 'm01_pi_b'),     'floor에 m01_pi_b 없음 (srcCard, 수정 전엔 잔존했음)');
  truthy(g.captured.p1.some((c) => c.id === 'm01_pi_b'),     'captured.p1에 m01_pi_b 있음');
  truthy(g.captured.p1.some((c) => c.id === 'm01_tti_hong'), 'captured.p1에 m01_tti_hong 있음');
  // 바닥 1월 남은 카드는 m01_pi_a 1장
  const floorJan = g.floor.filter((c) => c.month === 1);
  eq(floorJan.length, 1, '바닥 1월 1장');
  eq(floorJan[0].id, 'm01_pi_a', '남은 1월은 m01_pi_a');
  // bombDeckCredit -1
  eq(g.bombDeckCredit.p1, 1, 'bombDeckCredit -1');
});

// ── BUGFIX-DUP-004: bonusFlip 0매칭 회귀 (단순 바닥 놓기) ─────
it('BUGFIX-DUP-004: 보너스 뒤집기 0매칭 — flipped만 floor 추가, 복제 없음', () => {
  const g = makeGame({
    p1Hand: [], p2Hand: ['m06_kkeut'],
    floor:  ['m05_kkeut'],
    deck:   ['m01_pi_b'],
  });
  g.bombDeckCredit = { p1: 1, p2: 0 };

  for (const step of bonusFlipSteps(g, 'p1')) {
    if (step && step.error) throw new Error(step.error);
  }
  const dups = findDupIds(g);
  eq(dups.length, 0, `중복 없음 (dups=${JSON.stringify(dups)})`);
  truthy(g.floor.some((c) => c.id === 'm01_pi_b'), 'floor에 m01_pi_b (0매칭 → 바닥 놓기)');
  eq(g.bombDeckCredit.p1, 0, 'bombDeckCredit -1');
});

// ── BUGFIX-DUP-005: bonusFlip 1매칭 회귀 ─────
it('BUGFIX-DUP-005: 보너스 뒤집기 1매칭 — 둘 다 captured, 복제 없음', () => {
  const g = makeGame({
    p1Hand: [], p2Hand: ['m06_kkeut'],
    floor:  ['m01_tti_hong', 'm05_kkeut'],
    deck:   ['m01_pi_b'],
  });
  g.bombDeckCredit = { p1: 1, p2: 0 };

  for (const step of bonusFlipSteps(g, 'p1')) {
    if (step && step.error) throw new Error(step.error);
  }
  const dups = findDupIds(g);
  eq(dups.length, 0, `중복 없음 (dups=${JSON.stringify(dups)})`);
  truthy(!g.floor.some((c) => c.id === 'm01_tti_hong'), 'floor에 m01_tti_hong 없음');
  truthy(!g.floor.some((c) => c.id === 'm01_pi_b'),     'floor에 m01_pi_b 없음');
  truthy(g.captured.p1.some((c) => c.id === 'm01_tti_hong'), 'captured.p1');
  truthy(g.captured.p1.some((c) => c.id === 'm01_pi_b'),     'captured.p1');
});

// ── BUGFIX-DUP-006: bonusFlip 3매칭 (뻑 풀이) 회귀 ─────
it('BUGFIX-DUP-006: 보너스 뒤집기 3매칭 — 4장 captured + 피 1장, 복제 없음', () => {
  const g = makeGame({
    p1Hand: [], p2Hand: ['m06_kkeut'],
    floor:  ['m01_gwang', 'm01_tti_hong', 'm01_pi_a', 'm05_kkeut'],
    deck:   ['m01_pi_b'],
  });
  g.bombDeckCredit = { p1: 1, p2: 0 };
  g.captured.p2 = [card('m06_pi_a')];
  g.ppeokFlags = { 1: 'p2' };

  for (const step of bonusFlipSteps(g, 'p1')) {
    if (step && step.error) throw new Error(step.error);
  }
  const dups = findDupIds(g);
  eq(dups.length, 0, `중복 없음 (dups=${JSON.stringify(dups)})`);
  eq(g.captured.p1.filter((c) => c.month === 1).length, 4, '1월 4장 captured');
  truthy(g.captured.p1.some((c) => c.id === 'm06_pi_a'), 'p2 피 빼앗음');
  truthy(!g.ppeokFlags[1], '뻑 플래그 해제');
});

// ── BUGFIX-DUP-007: 일반 덱 뒤집기 2매칭 (drawAndResolve 일반 분기) 회귀 ─────
it('BUGFIX-DUP-007: 일반 덱 뒤집기 2매칭 → chooseFloor → 복제 없음', () => {
  // 손패에서 다른 월 1매칭으로 처리 후 덱 뒤집기가 또 다른 월 2매칭
  // p1이 5월 카드 내서 1매칭 → 덱 뒤집기는 1월(바닥 1월 2장) → awaiting_floor_choice
  const g = makeGame({
    p1Hand: ['m05_kkeut', 'm08_gwang'],
    p2Hand: ['m06_kkeut'],
    floor:  ['m05_tti_cho', 'm01_tti_hong', 'm01_pi_a'],
    deck:   ['m01_pi_b'],
  });
  playCard(g, 'p1', 'm05_kkeut');
  eq(g.phase, 'awaiting_floor_choice', 'awaiting_floor_choice');
  eq(g.pendingFloorChoice.fromHand, false, 'fromHand=false (덱 뒤집기 경로)');
  chooseFloor(g, 'p1', 'm01_tti_hong');

  const dups = findDupIds(g);
  eq(dups.length, 0, `중복 없음 (dups=${JSON.stringify(dups)})`);
  truthy(!g.floor.some((c) => c.id === 'm01_pi_b'), 'srcCard floor 잔존 X');
  truthy(g.captured.p1.some((c) => c.id === 'm01_pi_b'),     'captured.p1');
  truthy(g.captured.p1.some((c) => c.id === 'm01_tti_hong'), 'captured.p1');
});

// ── 결과 출력 ─────────────────────────────────────────────────
console.log('');
console.log(`폭탄 후 복제 버그 재현 검사 (${passed + failed}건)`);
console.log('─'.repeat(60));
for (const r of results) console.log(r);
console.log('─'.repeat(60));
console.log(`Result: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
