/**
 * @fileoverview 쓸 룰 ad-hoc 단위 검증 — Playwright nested module 충돌 우회용.
 * Node 직접 실행: `node tests/sseul-adhoc.mjs`
 * 회귀 안정화 후 game.unit.spec.js의 정식 테스트(G-40~G-44)로 통합됨.
 */

import { playCard, chooseFloor, createGame, bomb } from '../game.js';
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
    results.push(`  FAIL  ${name}\n         ${e.message}`);
  }
}

function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg || 'eq'} — got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`);
}
function truthy(v, msg) {
  if (!v) throw new Error(`${msg || 'truthy'} — got ${JSON.stringify(v)}`);
}
function not(v, msg) {
  if (v) throw new Error(`${msg || 'not'} — got ${JSON.stringify(v)}`);
}

// ── G-40 ─────────────────────────────────────────────────────
it('G-40: 쓸 — 바닥 마지막 두 장을 손패와 더미가 각각 맞춤 → 피 1장', () => {
  const g = makeGame({
    p1Hand: ['m01_gwang', 'm05_kkeut'],
    p2Hand: ['m06_kkeut'],
    floor:  ['m01_tti_hong', 'm02_tti_hong'],
    deck:   ['m02_kkeut_godori'],
  });
  g.captured.p2 = [card('m06_pi_a')];

  const r1 = playCard(g, 'p1', 'm01_gwang');
  truthy(r1.ok, 'playCard ok');

  eq(g.lastAction.kind, 'sseul', 'kind=sseul');
  eq(g.floor.length, 0, '바닥 0장');
  truthy(g.captured.p1.some((c) => c.id === 'm06_pi_a'), 'p2 피 빼앗음');
  eq(g.captured.p2.length, 0, 'p2 captured 비움');
});

// ── G-41 ─────────────────────────────────────────────────────
it('G-41: 쓸 — 상대 피 0장이어도 정상 진행', () => {
  const g = makeGame({
    p1Hand: ['m01_gwang', 'm05_kkeut'],
    p2Hand: ['m06_kkeut'],
    floor:  ['m01_tti_hong', 'm02_tti_hong'],
    deck:   ['m02_kkeut_godori'],
  });
  g.captured.p2 = [];

  playCard(g, 'p1', 'm01_gwang');

  eq(g.lastAction.kind, 'sseul', 'kind=sseul');
  eq(g.captured.p1.length, 4, '피 빼앗기 skip — 4장만');
  truthy(['awaiting_play', 'awaiting_go_stop', 'round_end'].includes(g.phase), `phase=${g.phase} 정상`);
});

// ── G-42 ─────────────────────────────────────────────────────
it('G-42: 같은 월 네 장 선택 경로는 쓸로 재라벨링하지 않음', () => {
  const g = makeGame({
    p1Hand: ['m01_gwang', 'm05_kkeut'],
    p2Hand: ['m06_kkeut'],
    floor:  ['m01_tti_hong', 'm01_pi_a'],
    deck:   ['m01_pi_b'],
  });
  playCard(g, 'p1', 'm01_gwang');
  chooseFloor(g, 'p1', 'm01_tti_hong');
  not(g.lastAction.kind === 'sseul', 'sseul 아님');
});

// ── G-43 ─────────────────────────────────────────────────────
it('G-43: 쓸 시나리오에서 더미가 다른 월이면 sseul/ttadak 아님', () => {
  const g = makeGame({
    p1Hand: ['m01_gwang', 'm05_kkeut'],
    p2Hand: ['m06_kkeut'],
    floor:  ['m01_tti_hong', 'm01_pi_a'],
    deck:   ['m03_pi_a'],
  });
  g.captured.p2 = [card('m06_pi_a')];

  playCard(g, 'p1', 'm01_gwang');
  chooseFloor(g, 'p1', 'm01_tti_hong');
  not(g.lastAction.kind === 'sseul', 'sseul 아님');
  not(g.lastAction.kind === 'ttadak', 'ttadak 아님');
  eq(g.captured.p2.length, 1, '피 보존');
});

// ── G-44 ─────────────────────────────────────────────────────
it('G-44: 바닥 3장 시작이면 쓸 아님 — sweep_from_hand로 처리', () => {
  const g = makeGame({
    p1Hand: ['m01_gwang', 'm05_kkeut'],
    p2Hand: ['m06_kkeut'],
    floor:  ['m01_tti_hong', 'm01_pi_a', 'm01_pi_b'],
    deck:   [],
  });
  g.captured.p2 = [card('m06_pi_a')];

  playCard(g, 'p1', 'm01_gwang');
  eq(g.lastAction.kind, 'sweep_from_hand', 'sweep_from_hand로 식별');
});

// ── 기존 케이스 회귀 — 따닥 (정확히 같은 월 4장 ttadak 시나리오는
//    chooseFloor 경로뿐이므로 G-40에서 이미 검증. 손패 1매칭 + 더미 같은 월은 ppeok로
//    가버린다(drawAndResolve sameMonthOnFloor.length===0 분기). 별개 케이스 — 검증 skip.)

// ── 기존 ttadak (라인 471~482) 회귀 ─────────────────────────────
// 손패가 다른 월에서 1매칭, 더미가 그 또 다른 월에 1매칭 + handCard도 captured에 있으면 ttadak.
// 예: 바닥에 1월 1장 + 3월 1장. p1 손에 1월·3월 카드. p1이 1월 내서 1월 매칭 → 더미에서 3월 → 3월 매칭.
//     이때 pair.month === handCard.month 조건이 거짓이라 ttadak 분기 아님(다른 월).
//   진짜 ttadak (라인 471~482) 조건: pair.month === handCard.month && handCard가 captured에 있음.
//   → handCard 월 == flipped 월 == pair 월. 그러나 손패 1매칭이면 바닥에 그 월 0장 남는다 → ppeok 분기.
//   → 실제로 라인 471~482의 ttadak은 도달 불가능한 dead code로 보임. 본 검증 skip.

// ── 기존 G-18(쪽) 회귀 ─────────────────────────────────
it('REG-G-18: 쪽 — 바닥 0매칭 + 더미 같은 월 → kind=jjok', () => {
  const g = makeGame({
    p1Hand: ['m01_gwang', 'm05_kkeut'],
    p2Hand: ['m06_kkeut'],
    floor:  ['m02_kkeut_godori'],
    deck:   ['m01_tti_hong'],
  });
  g.captured.p2 = [card('m06_pi_a')];

  playCard(g, 'p1', 'm01_gwang');
  eq(g.lastAction.kind, 'jjok', 'kind=jjok');
  truthy(g.captured.p1.some((c) => c.id === 'm06_pi_a'), '피 빼앗음');
});

// ── 기존 G-04 (1매칭) 회귀 ─────────────────────────────
it('REG-G-04: 1매칭 — 둘 다 captured, 턴 교대', () => {
  const g = makeGame({
    p1Hand: ['m01_gwang', 'm05_kkeut'],
    p2Hand: ['m06_kkeut'],
    floor:  ['m01_tti_hong'],
    deck:   [],
  });
  playCard(g, 'p1', 'm01_gwang');
  eq(g.captured.p1.length, 2, 'captured 2장');
  eq(g.floor.length, 0, '바닥 비움');
  eq(g.turn, 'p2', '턴 교대');
});

// ── 기존 G-05/G-06 (2매칭 + 선택) 회귀 ────────────────
it('REG-G-05/06: 2매칭 → chooseFloor 정상 동작 (다른 월 더미)', () => {
  const g = makeGame({
    p1Hand: ['m01_gwang', 'm05_kkeut'],
    p2Hand: ['m06_kkeut'],
    floor:  ['m01_tti_hong', 'm01_pi_a'],
    deck:   ['m07_kkeut'], // 더미 다른 월
  });
  playCard(g, 'p1', 'm01_gwang');
  eq(g.phase, 'awaiting_floor_choice', 'awaiting_floor_choice');
  chooseFloor(g, 'p1', 'm01_tti_hong');
  eq(g.phase, 'awaiting_play', '정상 턴 진행');
  eq(g.turn, 'p2', '턴 교대');
  // 더미가 7월 → 바닥에 놓임. captured엔 1월 2장. ttadak/sseul 아님.
  not(g.lastAction.kind === 'sseul', 'sseul 아님');
  not(g.lastAction.kind === 'ttadak', 'ttadak 아님');
});

// ── 기존 G-17 (뻑) 회귀 ───────────────────────────────
it('REG-G-17: 뻑 형성 — kind=ppeok, 바닥 3장 누적', () => {
  const g = makeGame({
    p1Hand: ['m01_gwang', 'm05_kkeut'],
    p2Hand: ['m06_kkeut'],
    floor:  ['m01_tti_hong'],
    deck:   ['m01_pi_a'],
  });
  playCard(g, 'p1', 'm01_gwang');
  eq(g.lastAction.kind, 'ppeok', 'kind=ppeok');
  eq(g.floor.filter((c) => c.month === 1).length, 3, '바닥 1월 3장');
});

// ── 기존 G-24 (폭탄) 회귀 ─────────────────────────────
it('REG-G-24: 폭탄 — 4장 captured + 피 1장', () => {
  const g = makeGame({
    p1Hand: ['m01_gwang', 'm01_tti_hong', 'm01_pi_a', 'm05_kkeut'],
    p2Hand: ['m06_kkeut'],
    floor:  ['m01_pi_b'],
    deck:   [],
  });
  g.captured.p2 = [card('m06_pi_a')];

  const r = bomb(g, 'p1', 1);
  truthy(r.ok, 'bomb ok');
  eq(g.captured.p1.filter((c) => c.month === 1).length, 4, '1월 4장 captured');
  truthy(g.captured.p1.some((c) => c.id === 'm06_pi_a'), 'p2 피 빼앗음');
});

// ── createGame 기본 회귀 ───────────────────────────────
it('REG-G-01: createGame — 손패 10+10, 카드 총 50장 일관성 (2026-06-03 룰 정정: 바닥 조커는 선공자 captured로 이동, 바닥 ≤ 8 가변)', () => {
  const g = createGame();
  eq(g.hands.p1.length, 10, 'p1 손 10장');
  eq(g.hands.p2.length, 10, 'p2 손 10장');
  // 2026-06-15 바닥 리필 룰 (함정 #11): 바닥 조커 N장은 선공자 captured로 이동 후
  // deck.pop()으로 floor를 8로 복원한다. 따라서 floor === 8(불변), deck === 22 - N(가변),
  // captured = N. 카드 총합 50은 불변. (이전 "floor 6~8 / deck 22 고정" 단언은 폐기.)
  eq(g.floor.length, 8, '바닥 8장 (리필 룰로 항상 복원)');
  const capturedTotal = g.captured.p1.length + g.captured.p2.length;
  eq(g.deck.length, 22 - capturedTotal, '덱 22-N (N=리필 소비, 바닥 조커 수)');
  // 카드 총합 50장 일관성
  const total = g.hands.p1.length + g.hands.p2.length + g.floor.length + g.deck.length
    + g.captured.p1.length + g.captured.p2.length;
  eq(total, 50, '카드 총 50장');
  // captured에 들어간 건 무조건 조커여야 하고, 선공자(기본 p1) 쪽으로만 이동
  if (capturedTotal > 0) {
    eq(g.captured.p2.length, 0, '비선공(p2) captured 0장');
    truthy(g.captured.p1.every((c) => c.type === 'joker'), 'p1 captured 모두 조커');
  }
});

// ── 결과 출력 ─────────────────────────────────────────────────
console.log('');
console.log(`쓸 룰 ad-hoc 단위 검증 (${passed + failed}건)`);
console.log('─'.repeat(60));
for (const r of results) console.log(r);
console.log('─'.repeat(60));
console.log(`Result: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
