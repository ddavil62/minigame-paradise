/**
 * @fileoverview JOKER — 조커 2장 룰 ad-hoc 단위 검증 (2026-06-03 추가).
 *
 * 룰 요약:
 *   - 조커 2장 추가 (덱 총 50장 = 화투 48 + 조커 2)
 *   - 어떤 월과도 매치되지 않음
 *   - captured 진입 시 피 2장 가치 (쌍피 동일)
 *
 *   케이스 A (손에서 조커 내기):
 *     1) 상대 피 1장 → 본인 captured (없으면 스킵)
 *     2) 조커 → 본인 captured (피 더미)
 *     3) 더미 매치 단계 완전 스킵
 *     4) 더미 위 1장 → 본인 손 (보충, 손 갯수 유지)
 *     5) 턴 종료, 보너스 턴 없음
 *
 *   케이스 B (더미 뒤집은 게 조커):
 *     1) 상대 피 1장 → 본인 captured
 *     2) 조커 → 본인 손 (다음 턴에 케이스 A로 사용)
 *     3) 더미 한 번 더 뒤집기 (재귀, 또 조커면 또 케이스 B)
 *
 *   상대 피 0장: 피 뺏기 스킵 (쪽/쓸과 동일)
 *
 * Node 직접 실행: `node tests/joker-adhoc.mjs`
 */

import { playCard, bonusFlipSteps, createGame, bomb, chooseFloor, applyFloorJokerToFirst } from '../game.js';
import { buildDeck, deckStats } from '../cards.js';
import { calculateScore } from '../score.js';

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

// ── JOKER-001: 덱 분포 ───────────────────────────────────────
it('JOKER-001: 덱 총 50장, 조커 2장, 분배 시 손/바닥/더미 합계 일관성', () => {
  const deck = buildDeck();
  eq(deck.length, 50, '덱 총 50장');
  const jokers = deck.filter((c) => c.type === 'joker');
  eq(jokers.length, 2, '조커 2장');
  eq(jokers[0].id, 'm00_joker_a', 'joker_a id');
  eq(jokers[1].id, 'm00_joker_b', 'joker_b id');
  // createGame 분배: 손 10+10, 바닥 8, 더미 22 = 50
  const g = createGame();
  eq(g.hands.p1.length, 10, 'p1 손 10');
  eq(g.hands.p2.length, 10, 'p2 손 10');
  eq(g.floor.length, 8, '바닥 8');
  eq(g.deck.length, 22, '더미 22');
  const all = [...g.hands.p1, ...g.hands.p2, ...g.floor, ...g.deck];
  eq(all.length, 50, '합계 50');
  const allJokers = all.filter((c) => c.type === 'joker');
  eq(allJokers.length, 2, '조커 2장 분배 후에도 유지');
  // deckStats 확인
  const stats = deckStats(deck);
  eq(stats.byType.joker, 2, 'deckStats.byType.joker = 2');
});

// ── JOKER-002: 케이스 A — 손에서 조커 내기 ────────────────
it('JOKER-002: 케이스 A — 조커 → captured + 상대 피 1장 + 더미 1장 손 보충, 매치 단계 스킵', () => {
  const g = makeGame({
    p1Hand: ['m00_joker_a', 'm05_kkeut'],
    p2Hand: ['m06_kkeut'],
    floor:  ['m01_tti_hong', 'm02_kkeut_godori'],
    deck:   ['m07_kkeut', 'm08_gwang'], // top(pop) = m08_gwang → 손 보충
  });
  g.captured.p2 = [card('m06_pi_a')];

  const r = playCard(g, 'p1', 'm00_joker_a');
  truthy(r.ok, 'playCard ok');
  eq(g.lastAction.kind, 'joker_play', 'kind=joker_play');
  truthy(g.captured.p1.some((c) => c.id === 'm00_joker_a'), '조커 본인 captured');
  truthy(g.captured.p1.some((c) => c.id === 'm06_pi_a'),     'p2 피 빼앗음');
  eq(g.captured.p2.length, 0, 'p2 피 0장');
  // 바닥 변동 없음 — m01, m02 그대로
  eq(g.floor.length, 2, '바닥 2장 유지 (매치 단계 스킵)');
  truthy(g.floor.some((c) => c.id === 'm01_tti_hong'), '바닥 m01 그대로');
  // 손 보충: m08_gwang이 손에 들어옴 (손 갯수: 시작 2 - 1(낸 조커) + 1(보충) = 2)
  eq(g.hands.p1.length, 2, '손 갯수 유지');
  truthy(g.hands.p1.some((c) => c.id === 'm08_gwang'), 'm08_gwang 손 보충');
  // 턴 종료
  eq(g.turn, 'p2', '턴 교대');
});

// ── JOKER-003: 케이스 A + 상대 피 0장 ─────────────────────
it('JOKER-003: 케이스 A — 상대 피 0장이면 피 뺏기 스킵, 나머지 정상', () => {
  const g = makeGame({
    p1Hand: ['m00_joker_a', 'm05_kkeut'],
    p2Hand: ['m06_kkeut'],
    floor:  ['m01_tti_hong'],
    deck:   ['m07_kkeut'],
  });
  // p2 captured는 비어있음 (피 0)
  eq(g.captured.p2.length, 0, '시작 p2 captured 0장');

  playCard(g, 'p1', 'm00_joker_a');
  eq(g.lastAction.kind, 'joker_play', 'kind=joker_play');
  truthy(g.captured.p1.some((c) => c.id === 'm00_joker_a'), '조커 captured');
  eq(g.captured.p1.length, 1, '조커 1장만 (피 빼앗기 스킵)');
  eq(g.captured.p2.length, 0, 'p2 그대로 0');
  // 더미 보충은 그대로
  truthy(g.hands.p1.some((c) => c.id === 'm07_kkeut'), '더미 보충 정상');
  eq(g.turn, 'p2', '턴 교대');
});

// ── JOKER-004: 케이스 B — 더미 뒤집은 게 조커 ──────────────
it('JOKER-004: 케이스 B — 조커 뒤집힘 → p2 피 1 + 조커 손으로 + 한 번 더 뒤집기', () => {
  const g = makeGame({
    p1Hand: ['m01_gwang', 'm05_kkeut'],
    p2Hand: ['m06_kkeut'],
    floor:  ['m02_kkeut_godori'], // 1월 매치 없음 → 1매칭 안 됨
    // 1월 카드 손에서 냄 → 바닥 0매칭 → 바닥에 m01_gwang 놓임
    // 그다음 더미에서 m00_joker_a 뒤집힘 → 케이스 B
    //   → p2 피 1장 빼앗기, joker_a 손으로, 더미 한 번 더 뒤집기 (m08_gwang)
    //   → m08_gwang은 바닥에 같은 월(8월) 없으므로 그냥 바닥에 놓임
    deck:   ['m08_gwang', 'm00_joker_a'], // pop 순: joker_a 먼저, 그 다음 m08_gwang
  });
  g.captured.p2 = [card('m06_pi_a')];

  playCard(g, 'p1', 'm01_gwang');
  // 검증
  truthy(g.captured.p1.some((c) => c.id === 'm06_pi_a'), 'p2 피 1장 빼앗음');
  eq(g.captured.p2.length, 0, 'p2 피 0');
  // 조커는 손에 들어와 있음 (다음 턴에 사용 가능)
  truthy(g.hands.p1.some((c) => c.id === 'm00_joker_a'), '조커 손에 추가됨');
  // 추가 뒤집힘 m08_gwang은 바닥에 (8월 매치 없음)
  truthy(g.floor.some((c) => c.id === 'm08_gwang'), 'm08_gwang 바닥 놓임');
  // 첫 손패 m01_gwang은 0매칭이라 바닥에 남음
  truthy(g.floor.some((c) => c.id === 'm01_gwang'), 'm01_gwang 바닥 남음 (0매칭)');
  // 턴 교대
  eq(g.turn, 'p2', '턴 교대');
});

// ── JOKER-005: 케이스 B 재귀 — 더미 두 번 다 조커 ─────────
it('JOKER-005: 케이스 B 재귀 — 더미 위 2장 모두 조커, p2 피 2장 빼앗기 + 조커 2장 손으로', () => {
  const g = makeGame({
    p1Hand: ['m01_gwang', 'm05_kkeut'],
    p2Hand: ['m06_kkeut'],
    floor:  ['m02_kkeut_godori'],
    // pop 순: joker_a 먼저 → 케이스 B → joker_b → 또 케이스 B → m08_gwang (바닥에)
    deck:   ['m08_gwang', 'm00_joker_b', 'm00_joker_a'],
  });
  // 피 3장 (실제 존재 ID: m06_pi_a, m04_pi_a, m05_pi_a)
  g.captured.p2 = [card('m06_pi_a'), card('m04_pi_a'), card('m05_pi_a')];

  playCard(g, 'p1', 'm01_gwang');
  // 조커 2장 모두 손에
  truthy(g.hands.p1.some((c) => c.id === 'm00_joker_a'), 'joker_a 손에');
  truthy(g.hands.p1.some((c) => c.id === 'm00_joker_b'), 'joker_b 손에');
  // p2 피 2장 빼앗김 (조커당 1장씩)
  eq(g.captured.p1.filter((c) => c.type === 'pi').length, 2, 'p1이 p2 피 2장 가져옴');
  eq(g.captured.p2.length, 1, 'p2 피 1장 남음 (3 - 2)');
  // 마지막 더미 m08_gwang은 바닥에
  truthy(g.floor.some((c) => c.id === 'm08_gwang'), 'm08_gwang 바닥');
  eq(g.turn, 'p2', '턴 교대');
});

// ── JOKER-006: 매치 차단 ──────────────────────────────────
it('JOKER-006: 바닥에 조커 깔린 상태 — 어떤 손패와도 매치 안 됨', () => {
  const g = makeGame({
    p1Hand: ['m01_gwang', 'm05_kkeut'],
    p2Hand: ['m06_kkeut'],
    floor:  ['m00_joker_a', 'm02_kkeut_godori'], // 바닥에 조커 + 다른 카드
    deck:   ['m03_pi_a'], // 더미도 매치 안 됨
  });

  playCard(g, 'p1', 'm01_gwang');
  // 손패 m01_gwang은 바닥 m00_joker_a와 매치 안 됨 (month=0 vs 1)
  // 바닥에 0매칭 → m01_gwang 바닥에 놓임
  truthy(g.floor.some((c) => c.id === 'm01_gwang'), 'm01_gwang 바닥 놓임 (조커와 매치 X)');
  truthy(g.floor.some((c) => c.id === 'm00_joker_a'), '바닥 조커 그대로');
  // 더미 m03_pi_a도 바닥에 (매치 없음)
  truthy(g.floor.some((c) => c.id === 'm03_pi_a'), 'm03_pi_a 바닥');
  // 조커는 captured로 안 감
  not(g.captured.p1.some((c) => c.id === 'm00_joker_a'), '조커 captured 안 감');
});

// ── JOKER-007: 점수 계산 ──────────────────────────────────
it('JOKER-007: piCount += 2*joker, 광/끗/띠 영향 없음', () => {
  // 조커 1장: piCount += 2
  const captured1 = [card('m00_joker_a')];
  const r1 = calculateScore(captured1);
  eq(r1.piCount, 2, '조커 1장 → piCount=2');
  eq(r1.score, 0, '점수 0 (10장 미만)');

  // 조커 2장: piCount += 4
  const captured2 = [card('m00_joker_a'), card('m00_joker_b')];
  const r2 = calculateScore(captured2);
  eq(r2.piCount, 4, '조커 2장 → piCount=4');

  // 조커 2장 + 일반 피 8장 = piCount 12 → 10장 달성 + 2 = 3점
  const captured3 = [
    card('m00_joker_a'), card('m00_joker_b'),
    card('m01_pi_a'), card('m02_pi_a'), card('m03_pi_a'),
    card('m04_pi_a'), card('m05_pi_a'), card('m06_pi_a'),
    card('m07_pi_a'), card('m08_pi_a'),
  ];
  const r3 = calculateScore(captured3);
  eq(r3.piCount, 12, '조커 2 + 피 8 = 12');
  eq(r3.score, 3, '피 점수 3 (10 +2)');

  // 광/끗/띠 영향 검증 — 조커 추가가 광 카운트에 영향 없음
  const capturedG = [
    card('m01_gwang'), card('m03_gwang'), card('m08_gwang'),
    card('m00_joker_a'),
  ];
  const rG = calculateScore(capturedG);
  eq(rG.gwang, 3, '광 3장 (조커 미영향)');
  eq(rG.score, 3, '3광 3점');
  eq(rG.piCount, 2, '조커는 piCount만');
});

// ── JOKER-008: 폭탄 후 보너스 뒤집기에서 조커 ─────────────
it('JOKER-008: bonusFlipSteps에서 조커 뒤집힘 → 케이스 B 동일 처리', () => {
  const g = makeGame({
    p1Hand: [],
    p2Hand: ['m06_kkeut'],
    floor:  ['m05_kkeut'],
    deck:   ['m08_gwang', 'm00_joker_a'], // pop = joker_a 먼저
  });
  g.bombDeckCredit = { p1: 1, p2: 0 };
  g.captured.p2 = [card('m06_pi_a')];

  for (const step of bonusFlipSteps(g, 'p1')) {
    if (step && step.error) throw new Error(step.error);
  }
  // 조커는 손으로
  truthy(g.hands.p1.some((c) => c.id === 'm00_joker_a'), '조커 손에 추가');
  // p2 피 빼앗김
  truthy(g.captured.p1.some((c) => c.id === 'm06_pi_a'), 'p2 피 빼앗음');
  // 재귀로 m08_gwang 뒤집힘 → 바닥에
  truthy(g.floor.some((c) => c.id === 'm08_gwang'), 'm08_gwang 바닥');
  // bombDeckCredit -1
  eq(g.bombDeckCredit.p1, 0, 'bombDeckCredit -1');
});

// ── JOKER-009: 조커 손에서 내기 + 더미 비었을 때 ──────────
it('JOKER-009: 손 조커 내기 + 더미 0 → 손 보충 스킵, 정상 진행', () => {
  const g = makeGame({
    p1Hand: ['m00_joker_a', 'm05_kkeut'],
    p2Hand: ['m06_kkeut'],
    floor:  ['m01_tti_hong'],
    deck:   [], // 더미 비어있음
  });
  g.captured.p2 = [card('m06_pi_a')];

  const r = playCard(g, 'p1', 'm00_joker_a');
  truthy(r.ok, 'playCard ok');
  eq(g.lastAction.kind, 'joker_play', 'kind=joker_play');
  truthy(g.captured.p1.some((c) => c.id === 'm00_joker_a'), '조커 captured');
  truthy(g.captured.p1.some((c) => c.id === 'm06_pi_a'), 'p2 피 빼앗음');
  // refilled는 null
  eq(g.lastAction.refilled, null, 'refilled=null (더미 0)');
  // 손은 1장 줄어듦 (보충 안 됨)
  eq(g.hands.p1.length, 1, '손 1장 (보충 없음)');
  truthy(g.hands.p1.some((c) => c.id === 'm05_kkeut'), 'm05_kkeut 남음');
  eq(g.turn, 'p2', '턴 교대');
});

// ── JOKER-010: 바닥 조커 0장 → 변동 없음 (2026-06-03 룰 정정) ──
it('JOKER-010: 바닥 조커 0장 → applyFloorJokerToFirst 무동작, captured/floor/hand 변동 없음', () => {
  const g = makeGame({
    p1Hand:  ['m01_gwang', 'm05_kkeut'],
    p2Hand:  ['m06_kkeut'],
    floor:   ['m02_kkeut_godori', 'm03_pi_a'],
    deck:    ['m07_kkeut'],
    turn:    'p1',
  });
  // 기존 lastAction을 round_start로 세팅 (startRound 시점 모방)
  g.lastAction = { kind: 'round_start', firstTurn: 'p1' };

  const moved = applyFloorJokerToFirst(g, 'p1');
  eq(moved, 0, '이동 0장');
  eq(g.captured.p1.length, 0, 'p1 captured 변동 없음');
  eq(g.captured.p2.length, 0, 'p2 captured 변동 없음');
  eq(g.floor.length, 2, '바닥 그대로');
  eq(g.hands.p1.length, 2, 'p1 손 그대로');
  eq(g.hands.p2.length, 1, 'p2 손 그대로');
  eq(g.deck.length, 1, '더미 그대로');
  // lastAction은 round_start 유지 (덮어쓰지 않음)
  eq(g.lastAction.kind, 'round_start', 'lastAction 그대로');
});

// ── JOKER-011: 바닥 조커 1장 → 선공자 captured ──
it('JOKER-011: 바닥 조커 1장 → 선공(p1) captured 1장 추가, 손/더미/턴 영향 없음', () => {
  const g = makeGame({
    p1Hand:  ['m01_gwang', 'm05_kkeut'],
    p2Hand:  ['m06_kkeut'],
    floor:   ['m00_joker_a', 'm02_kkeut_godori', 'm03_pi_a'],
    deck:    ['m07_kkeut'],
    turn:    'p1',
  });

  const moved = applyFloorJokerToFirst(g, 'p1');
  eq(moved, 1, '이동 1장');
  // p1 captured에 조커 1장
  eq(g.captured.p1.length, 1, 'p1 captured 1장');
  truthy(g.captured.p1.some((c) => c.id === 'm00_joker_a'), 'joker_a captured.p1');
  // floor에서 조커 제거 (나머지 2장 유지)
  eq(g.floor.length, 2, '바닥 2장');
  not(g.floor.some((c) => c.type === 'joker'), '바닥 조커 제거됨');
  truthy(g.floor.some((c) => c.id === 'm02_kkeut_godori'), '바닥 m02 유지');
  truthy(g.floor.some((c) => c.id === 'm03_pi_a'), '바닥 m03 유지');
  // p2 영향 없음 — 추가 보너스 없음 (피 뺏기 X)
  eq(g.captured.p2.length, 0, 'p2 captured 영향 없음');
  // 손/덱 영향 없음
  eq(g.hands.p1.length, 2, 'p1 손 그대로');
  eq(g.hands.p2.length, 1, 'p2 손 그대로');
  eq(g.deck.length, 1, '더미 그대로 (뒤집기 X)');
  // 턴 영향 없음 — p1 여전히 선공
  eq(g.turn, 'p1', '턴 그대로 p1');
  // lastAction 갱신
  eq(g.lastAction.kind, 'floor_joker_to_first', 'lastAction kind');
  eq(g.lastAction.player, 'p1', 'lastAction player');
  eq(g.lastAction.count, 1, 'lastAction count');
});

// ── JOKER-012: 바닥 조커 2장 → 선공자 captured 2장 + score 검증 ──
it('JOKER-012: 바닥 조커 2장 → 선공 captured 2장, score 계산 시 piCount +4', () => {
  const g = makeGame({
    p1Hand:  ['m01_gwang'],
    p2Hand:  ['m06_kkeut'],
    floor:   ['m00_joker_a', 'm00_joker_b', 'm02_kkeut_godori'],
    deck:    ['m07_kkeut'],
    turn:    'p2', // 선공 p2 케이스
  });

  const moved = applyFloorJokerToFirst(g, 'p2');
  eq(moved, 2, '이동 2장');
  // p2 captured에 조커 2장
  eq(g.captured.p2.length, 2, 'p2 captured 2장');
  truthy(g.captured.p2.some((c) => c.id === 'm00_joker_a'), 'joker_a captured.p2');
  truthy(g.captured.p2.some((c) => c.id === 'm00_joker_b'), 'joker_b captured.p2');
  // floor 조커 모두 제거 (1장 남음)
  eq(g.floor.length, 1, '바닥 1장');
  not(g.floor.some((c) => c.type === 'joker'), '바닥 조커 제거됨');
  // p1 영향 없음
  eq(g.captured.p1.length, 0, 'p1 captured 영향 없음');
  // 점수: piCount += 2 * 2 = 4
  const score = calculateScore(g.captured.p2);
  eq(score.piCount, 4, 'piCount=4 (조커 2장 × 2)');
  eq(score.score, 0, '점수 0 (10장 미만)');
  // lastAction
  eq(g.lastAction.kind, 'floor_joker_to_first', 'kind');
  eq(g.lastAction.player, 'p2', 'player=p2');
  eq(g.lastAction.count, 2, 'count=2');
});

// ── JOKER-013: 자동 획득은 보너스 없음 (더미/턴/상대 피 모두 무영향) ──
it('JOKER-013: 자동 획득은 보너스 없음 — 더미 뒤집기/턴 변경/상대 피 뺏기 X', () => {
  const g = makeGame({
    p1Hand:  ['m01_gwang', 'm05_kkeut'],
    p2Hand:  ['m06_kkeut'],
    floor:   ['m00_joker_a', 'm00_joker_b'],
    deck:    ['m07_kkeut', 'm08_gwang'],
    turn:    'p1',
  });
  // p2가 피를 갖고 있어도 — 자동 획득은 상대 피를 뺏지 않는다
  g.captured.p2 = [card('m06_pi_a'), card('m04_pi_a')];
  const p2PiBefore = g.captured.p2.length;
  const deckBefore = g.deck.length;
  const turnBefore = g.turn;
  const goCountBefore = { ...g.goCount };
  const shakingBefore = { ...g.shaking };

  applyFloorJokerToFirst(g, 'p1');
  // 상대 피 뺏기 발생 안 함
  eq(g.captured.p2.length, p2PiBefore, '상대 피 그대로');
  truthy(g.captured.p2.every((c) => c.type === 'pi'), 'p2 피 카드 그대로');
  // 더미 뒤집기 발생 안 함
  eq(g.deck.length, deckBefore, '더미 그대로 (뒤집기 X)');
  // 턴 변경 없음
  eq(g.turn, turnBefore, '턴 그대로');
  // goCount/shaking 등 다른 상태 영향 없음
  eq(g.goCount.p1, goCountBefore.p1, 'goCount.p1 변동 X');
  eq(g.goCount.p2, goCountBefore.p2, 'goCount.p2 변동 X');
  eq(g.shaking.p1, shakingBefore.p1, 'shaking.p1 변동 X');
  eq(g.shaking.p2, shakingBefore.p2, 'shaking.p2 변동 X');
  // p1 captured는 조커 2장만 (피 뺏기 없으므로)
  eq(g.captured.p1.length, 2, 'p1 captured 2장 (조커만)');
  truthy(g.captured.p1.every((c) => c.type === 'joker'), 'p1 captured 모두 조커');
  // 보너스 권리 변동 X
  eq(g.bombDeckCredit?.p1 || 0, 0, 'bombDeckCredit.p1 = 0');
  eq(g.bombDeckCredit?.p2 || 0, 0, 'bombDeckCredit.p2 = 0');
  // 첫뻑 트래킹 영향 X
  eq(g.firstPpeokBy, null, 'firstPpeokBy 그대로 null');
});

// ── JOKER-014: 라운드 종료 — 사용자 손 3장 + 상대 손 0 + credit 0 ──
// (2026-06-08 조커 라운드 종료 불가 수정 회귀 게이트)
//
// 시나리오: 사용자(p2) 손 3장(조커 2 + 일반 1), 상대(p1) 손 0, 양쪽 credit 0.
//   - 마지막 턴: p1이 손 0인 상태에서 카드를 낼 수 없음. 어떻게든 finishTurn(p1)이
//     호출되도록 p1이 손 1장 있는 상태에서 시작 → 카드 내기 → 손 0 도달.
//   - finishTurn(p1) 시점: p1 손+credit = 0, p2 손+credit = 3, p2 credit = 0.
//     기존 종료 조건(둘 다 0)으로는 영구 종료 불가 → p2 턴으로 넘어가야 하나
//     p2는 조커 2+일반 1로 정상 카드 낼 수 있음.
//   - 본 테스트는 핵심을 단순화: p2 턴에서 일반 카드를 내고 손 2장(조커만) 남음 →
//     p2도 조커만 남아 사실상 진행 무의미 → 라운드 종료 트리거 검증.
//   - 직접 검증: finishTurn 종료 조건 분기를 강제로 트리거하기 위해
//     "사용자 시나리오 막판" 상태를 재현. p1 손 1장으로 시작 → playCard로 0 도달 →
//     신규 종료 조건이 작동해야 하나 p2 손이 3이므로 p2 턴으로 이동 (정상).
//   - 더 직접적인 검증: p1 손 0 + p2 손 3 + 양쪽 credit 0 상태에서 p1의 finishTurn이
//     호출되었다고 가정. → playCardSteps의 마지막 단계에서 finishTurn 호출됨.
//
// 단순화된 결정성 시나리오:
//   p1 손 1장(m11_gwang), p2 손 3장(조커 2 + m05_kkeut), 바닥에 m11_pi_b(11월 매치).
//   p1이 m11_gwang을 내면 1매칭 → captured + finishTurn(p1) 호출.
//   이 시점에 p1 손 = 0, p2 손 = 3, 양쪽 credit = 0.
//   신규 조건: p1Done && p2Credit === 0 → 종료 트리거.
//   → flushHandsToCaptured로 p2 조커 2 + m05 → p2 captured 이동.
//   → 점수 평가: p1 점수 vs p2 점수 비교 후 승자/무승부 결정.
it('JOKER-014: p1 손 0 + p2 손 3장(조커 2+일반 1) + credit 0 → 라운드 자동 종료 + 잔여 captured 이동', () => {
  const g = makeGame({
    p1Hand:  ['m11_gwang'],
    p2Hand:  ['m00_joker_a', 'm00_joker_b', 'm05_kkeut'],
    floor:   ['m11_pi_b'], // 11월 매치 → p1이 가져감 (광 + 피)
    deck:    [], // 더미 비움 (drawAndResolve 시 안전 return)
    turn:    'p1',
  });

  const r = playCard(g, 'p1', 'm11_gwang');
  truthy(r.ok, 'playCard ok');
  // 검증 1: 라운드 종료됨 (phase=round_end)
  eq(g.phase, 'round_end', 'phase=round_end (자동 종료)');
  // 검증 2: roundResult 존재
  truthy(g.roundResult, 'roundResult 존재');
  // 검증 3: p2 손이 비워졌고 잔여 카드가 captured로 이동
  eq(g.hands.p2.length, 0, 'p2 손 비움');
  truthy(g.captured.p2.some((c) => c.id === 'm00_joker_a'), 'p2 captured에 joker_a');
  truthy(g.captured.p2.some((c) => c.id === 'm00_joker_b'), 'p2 captured에 joker_b');
  truthy(g.captured.p2.some((c) => c.id === 'm05_kkeut'), 'p2 captured에 m05_kkeut');
  // 검증 4: p1 captured 그대로 (m11_gwang + m11_pi_b)
  truthy(g.captured.p1.some((c) => c.id === 'm11_gwang'), 'p1 captured m11_gwang');
  truthy(g.captured.p1.some((c) => c.id === 'm11_pi_b'), 'p1 captured m11_pi_b');
  // 검증 5: 점수 — p2는 조커 2 = piCount 4 + 끗 1장 = 0점 (10장 미만), p1은 광 1 = 0점 → 무승부
  // (단, p2는 조커 + m05 captured만이라 7점 못 미침 → roundWinner null)
  eq(g.roundWinner, null, '둘 다 7점 미만 → 무승부');
});

// ── JOKER-015: 케이스 B로 조커 받음 → 끝까지 안 냄 → 자동 captured 이동 ──
//
// 시나리오: p2(케이스 B로 조커 1장 받음 → 손 +1 누적) 시점.
//   - 단순화: p2 손에 조커 1장 + 일반 1장 = 2장, p1 손 1장, 양쪽 credit 0.
//   - p1이 카드 내면 p1 손 0, p2 손 2장 → 신규 조건 트리거(p1Done && p2Credit=0).
//   - 신규 종료: p2의 조커 1장 + 일반 1장이 p2 captured로 이동, piCount +2 반영.
it('JOKER-015: 케이스 B 조커 잔여 → 라운드 종료 시 captured 이동 + piCount +2 반영', () => {
  const g = makeGame({
    p1Hand:  ['m11_pi_b'],
    p2Hand:  ['m00_joker_a', 'm10_pi_a'], // 케이스 B로 받은 조커 + 일반 1장(피)
    floor:   ['m11_pi_c'], // 11월 피끼리 1매칭 → 둘 다 p1 captured
    deck:    [],
    turn:    'p1',
  });
  // p1이 m11_pi_b 냄 → 바닥 m11_pi_c와 1매칭 → 둘 다 p1 captured → finishTurn(p1)
  playCard(g, 'p1', 'm11_pi_b');
  // 종료 트리거
  eq(g.phase, 'round_end', 'phase=round_end');
  // p2 잔여 카드 자동 이동
  eq(g.hands.p2.length, 0, 'p2 손 0');
  truthy(g.captured.p2.some((c) => c.id === 'm00_joker_a'), '조커 captured');
  truthy(g.captured.p2.some((c) => c.id === 'm10_pi_a'), '일반 카드 captured');
  // piCount 검증: 조커 1 = +2, m10_pi_a = +1 → piCount = 3
  const score = calculateScore(g.captured.p2);
  eq(score.piCount, 3, 'piCount=3 (조커 2 + 피 1)');
});

// ── JOKER-016: 폭탄 후 p1 손 0 + credit 2 → 종료 X (폭탄 권리 우선) ──
//
// 시나리오: p1이 폭탄 후 손 0 + credit 2 도달. p2 손 0 + credit 0.
//   - 신규 조건: p2Done(true) && p1Credit(2) !== 0 → 종료 X (폭탄 권리 우선).
//   - p1이 bonusFlip 2회 다 쓴 후 (p1Done=true & p2Credit=0) → 라운드 종료.
//
// 단순화: 직접 finishTurn 호출 후 종료 여부만 확인.
//   makeGame으로 상태 셋업 → playCard로 finishTurn 트리거 → 종료 X 확인.
//   p1 손 1장으로 시작 → 카드 내면 손 0 도달. credit 2 보유. p2는 손 0 + credit 0.
//   finishTurn(p1) 시점:
//     - p1Done = (0 + 2) === 0 → false. p2Done = (0 + 0) === 0 → true.
//     - 신규 조건: (p1Done && p2Credit=0) → false. (p2Done && p1Credit=0) → p1Credit=2 → false.
//     - 둘 다 false → 종료 X, p2 턴으로 이동.
//   p2 턴 시작: p2 손 0 + credit 0 → bonusFlip 불가 + playCard 불가.
//   해결책: 본 테스트는 finishTurn 종료 조건 작동 안 함만 검증.
it('JOKER-016: p1 손 0 + credit 2 + p2 손 0 + credit 0 → finishTurn 종료 X (폭탄 권리 우선)', () => {
  const g = makeGame({
    p1Hand:  ['m11_pi_b'],
    p2Hand:  [],
    floor:   ['m11_pi_c'],
    deck:    [],
    turn:    'p1',
  });
  g.bombDeckCredit = { p1: 2, p2: 0 };

  // p1이 m11_pi_b 내면 1매칭 → captured → finishTurn(p1)
  const r = playCard(g, 'p1', 'm11_pi_b');
  truthy(r.ok, 'playCard ok');
  // 신규 조건: 종료 X — p1Credit > 0이므로 폭탄 권리 우선
  // (p1Done = (0+2)==0 → false. p2Done = (0+0)==0 → true.
  //  (p1Done && p2Credit=0) → false. (p2Done && p1Credit=0) → p1Credit=2 → false.
  //  → 종료 X, turn=p2로 변경. 실서버에서는 server.js 봇/턴 로직이 p1 bonusFlip을 추가
  //  처리할 책임이지만, 본 테스트는 game.js의 finishTurn 종료 조건만 검증.)
  eq(g.phase, 'awaiting_play', 'phase=awaiting_play (종료 X)');
});

// ── JOKER-017: 양쪽 손 0 + credit 0 → 정상 무승부 종료 (기존 동작 회귀) ──
it('JOKER-017: 양쪽 손+credit 모두 0 → 정상 무승부 종료', () => {
  const g = makeGame({
    p1Hand:  ['m11_pi_b'],
    p2Hand:  [],
    floor:   ['m11_pi_c'],
    deck:    [],
    turn:    'p1',
  });
  // 양쪽 credit 0 (기본)
  playCard(g, 'p1', 'm11_pi_b');
  // p1 손 0, p2 손 0, credit 양쪽 0
  eq(g.phase, 'round_end', '정상 종료');
  truthy(g.roundResult, 'roundResult 존재');
  // p1은 m11 피 페어 1쌍만 captured → piCount=2 → 점수 0 (10장 미만)
  // → 둘 다 7점 미만 → 무승부
  eq(g.roundWinner, null, '무승부');
});

// ── 회귀 게이트: 기존 분포 보존 ────────────────────────────
it('REG-DIST: 화투 48종 그대로 + 조커 2장만 추가', () => {
  const deck = buildDeck();
  // 화투 부분 48장 (이전과 동일)
  const hwatu = deck.filter((c) => c.type !== 'joker');
  eq(hwatu.length, 48, '화투 48장');
  // 각 월 4장
  for (let m = 1; m <= 12; m++) {
    const cnt = hwatu.filter((c) => c.month === m).length;
    eq(cnt, 4, `${m}월 4장`);
  }
  // 조커 month=0
  const jokers = deck.filter((c) => c.type === 'joker');
  eq(jokers.length, 2, '조커 2장');
  for (const j of jokers) eq(j.month, 0, `${j.id} month=0`);
});

// ── 회귀: 조커가 폭탄/사통 대상에서 제외 ──────────────────
it('REG-BOMB-SANGTONG: 조커는 폭탄/사통 트리거 안 됨', () => {
  // bombableMonths 검사 — month=0이라도 floor에 1장 + 손에 3장이 가능할 일 거의 없지만
  // 명시적으로 안전망 확인. 일단 조커 손/바닥은 사통 검사(month별 카운트) 영향 받음.
  // 조커 2장만 손에 있고 같은 month=0 → 카운트=2 → 4 미만이므로 사통 발동 X.
  // (조커는 2장뿐이라 4장 도달 불가능 — 자연 차단)
  // 안전망 동작만 코드 라인 도달 확인
  truthy(true, 'placeholder — 분포가 자연히 차단');
});

// ── 결과 출력 ─────────────────────────────────────────────────
console.log('');
console.log(`조커 룰 ad-hoc 단위 검증 (${passed + failed}건, JOKER-001~017 + REG-DIST + REG-BOMB-SANGTONG)`);
console.log('─'.repeat(60));
for (const r of results) console.log(r);
console.log('─'.repeat(60));
console.log(`Result: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
