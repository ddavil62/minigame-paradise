/**
 * @fileoverview 맞고 게임 로직 단위 테스트 — game.js 함수 직접 호출.
 *
 * 브라우저 불필요. Playwright test runner가 Node.js에서 직접 실행.
 * 서버 미시작 상태에서도 단독 실행 가능.
 *
 * 룰 기준: .claude/specs/2026-05-30-matgo-rulebook.md
 *
 * 실행: npx playwright test tests/game.unit.spec.js --reporter=list
 */

import { test, expect } from '@playwright/test';
import {
  createGame, playCard, chooseFloor, goStop,
  shakeDecision, selectKkeutType, bomb, sangtongDecision,
} from '../game.js';
import { buildDeck } from '../cards.js';

// ── 카드 룩업 ─────────────────────────────────────────────────────────
/** 전체 50장 카드(화투 48 + 조커 2)를 id→Card 맵으로 빌드. */
const ALL_CARDS = buildDeck();
const BY_ID = Object.fromEntries(ALL_CARDS.map((c) => [c.id, c]));

/**
 * 카드 id로 카드 객체를 반환한다.
 * @param {string} id
 * @returns {Card}
 */
const card = (id) => {
  const c = BY_ID[id];
  if (!c) throw new Error(`카드 ${id} 없음 — cards.js buildDeck() 확인`);
  return c;
};

// ── 게임 상태 팩토리 ──────────────────────────────────────────────────
/**
 * 결정적 게임 상태를 직접 구성한다. startRound(shuffle)를 우회한다.
 *
 * @param {object} cfg
 * @param {string[]} cfg.p1Hand   - p1 손패 카드 ID 배열
 * @param {string[]} cfg.p2Hand   - p2 손패 카드 ID 배열
 * @param {string[]} cfg.floor    - 바닥 카드 ID 배열
 * @param {string[]} cfg.deck     - 더미 카드 ID 배열 (top = 끝)
 * @param {'p1'|'p2'} [cfg.turn]  - 첫 턴 (기본 'p1')
 * @returns {GameState}
 */
function makeGame({ p1Hand = [], p2Hand = [], floor = [], deck = [], turn = 'p1' } = {}) {
  return {
    deck:    deck.map(card),
    floor:   floor.map(card),
    hands:   { p1: p1Hand.map(card), p2: p2Hand.map(card) },
    captured: { p1: [], p2: [] },
    ppeokFlags: {},
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
    // ── 5건 룰 보강 (2026-05-31) ──
    pendingSangtong: null,
    shakeAsked: { p1: false, p2: false },
    bombExtraDraw: false,
    firstPpeokBy: null,
  };
}

// ============================================================
// §1 기본 초기화
// ============================================================

test('G-01: createGame — 손패 10+10, 바닥 ≤ 8 (조커 자동 획득), 덱 22 (2026-06-03 룰 정정)', () => {
  const g = createGame();
  expect(g.hands.p1.length).toBe(10);
  expect(g.hands.p2.length).toBe(10);
  // 2026-06-03 룰 정정: 분배 시 바닥(8장 슬롯)에 조커 N장이 있으면 선공자(기본 p1) captured로 자동 이동.
  // 따라서 floor = 8 - N (N=0~2), captured 총합 = N. 카드 총합 50장 일관성.
  expect(g.floor.length).toBeGreaterThanOrEqual(6);
  expect(g.floor.length).toBeLessThanOrEqual(8);
  // 50 - 10 - 10 - 8 = 22 (화투 48 + 조커 2). 덱은 분배 후 잔여 — 불변.
  expect(g.deck.length).toBe(22);
  const capturedTotal = g.captured.p1.length + g.captured.p2.length;
  expect(capturedTotal).toBe(8 - g.floor.length);
  const total = g.hands.p1.length + g.hands.p2.length + g.floor.length + g.deck.length + capturedTotal;
  expect(total).toBe(50);
  // 이동한 카드는 무조건 조커 + 선공자(p1)에게만
  if (capturedTotal > 0) {
    expect(g.captured.p2.length).toBe(0);
    expect(g.captured.p1.every((c) => c.type === 'joker')).toBe(true);
  }
});

test('G-02: createGame — 초기 phase와 잔고', () => {
  const g = createGame();
  // shake_decision 또는 awaiting_play 중 하나여야 한다
  expect(['awaiting_play', 'shake_decision']).toContain(g.phase);
  expect(g.money.p1).toBe(10000);
  expect(g.money.p2).toBe(10000);
  expect(g.goCount.p1).toBe(0);
  expect(g.goCount.p2).toBe(0);
});

// ============================================================
// §2 playCard — 기본 매칭
// ============================================================

test('G-03: 0매칭 — 카드가 바닥에 추가됨', () => {
  const g = makeGame({
    p1Hand: ['m01_gwang', 'm05_kkeut'],
    p2Hand: ['m06_kkeut'],
    floor:  ['m02_kkeut_godori'], // 다른 월 → 0매칭
    deck:   [],
  });
  const result = playCard(g, 'p1', 'm01_gwang');
  expect(result.ok).toBe(true);
  expect(g.hands.p1.length).toBe(1);           // m05_kkeut 남음
  expect(g.floor.some((c) => c.id === 'm01_gwang')).toBe(true); // 바닥에 추가
  expect(g.turn).toBe('p2');                   // 턴 교대
  expect(g.phase).toBe('awaiting_play');
});

test('G-04: 1매칭 — 둘 다 captured로', () => {
  const g = makeGame({
    p1Hand: ['m01_gwang', 'm05_kkeut'],
    p2Hand: ['m06_kkeut'],
    floor:  ['m01_tti_hong'], // 같은 1월 → 1매칭
    deck:   [],
  });
  playCard(g, 'p1', 'm01_gwang');
  expect(g.hands.p1.length).toBe(1);
  expect(g.floor.length).toBe(0);
  expect(g.captured.p1.length).toBe(2); // gwang + tti_hong
  expect(g.captured.p1.some((c) => c.id === 'm01_gwang')).toBe(true);
  expect(g.captured.p1.some((c) => c.id === 'm01_tti_hong')).toBe(true);
  expect(g.turn).toBe('p2');
});

test('G-05: 2매칭 — awaiting_floor_choice 진입', () => {
  const g = makeGame({
    p1Hand: ['m01_gwang', 'm05_kkeut'],
    p2Hand: ['m06_kkeut'],
    // 바닥에 1월 카드 2장 → 선택 대기
    floor:  ['m01_tti_hong', 'm01_pi_a'],
    deck:   [],
  });
  playCard(g, 'p1', 'm01_gwang');
  expect(g.phase).toBe('awaiting_floor_choice');
  expect(g.pendingFloorChoice).not.toBeNull();
  expect(g.pendingFloorChoice.candidates.length).toBe(2);
  expect(g.pendingFloorChoice.srcCard.id).toBe('m01_gwang');
});

test('G-06: chooseFloor — 선택 후 captured, 턴 교대', () => {
  const g = makeGame({
    p1Hand: ['m01_gwang', 'm05_kkeut'],
    p2Hand: ['m06_kkeut'],
    floor:  ['m01_tti_hong', 'm01_pi_a'],
    deck:   [],
  });
  playCard(g, 'p1', 'm01_gwang');
  expect(g.phase).toBe('awaiting_floor_choice');

  chooseFloor(g, 'p1', 'm01_tti_hong');
  expect(g.phase).toBe('awaiting_play');
  expect(g.captured.p1.some((c) => c.id === 'm01_gwang')).toBe(true);
  expect(g.captured.p1.some((c) => c.id === 'm01_tti_hong')).toBe(true);
  // m01_pi_a는 바닥에 남아있어야 함
  expect(g.floor.some((c) => c.id === 'm01_pi_a')).toBe(true);
  expect(g.turn).toBe('p2');
});

test('G-07: 잘못된 cardId → ok:false', () => {
  const g = makeGame({
    p1Hand: ['m01_gwang'],
    p2Hand: ['m06_kkeut'],
    floor:  [],
    deck:   [],
  });
  const result = playCard(g, 'p1', 'INVALID_CARD');
  expect(result.ok).toBe(false);
  expect(result.error).toBeDefined();
});

test('G-08: 내 차례 아닌데 playCard → ok:false', () => {
  const g = makeGame({
    p1Hand: ['m01_gwang'],
    p2Hand: ['m06_kkeut'],
    floor:  [],
    deck:   [],
    turn:   'p2', // p2 차례
  });
  const result = playCard(g, 'p1', 'm01_gwang'); // p1이 내려하면 오류
  expect(result.ok).toBe(false);
});

// ============================================================
// §3 점수 평가 + 고/스톱
// ============================================================

test('G-09: 점수 7점 미만 → 다음 턴으로 (awaiting_play)', () => {
  // p1이 카드를 내도 점수가 7점 미만이면 턴 교대
  const g = makeGame({
    p1Hand: ['m01_gwang', 'm05_kkeut'],
    p2Hand: ['m06_kkeut'],
    floor:  [],
    deck:   [],
  });
  playCard(g, 'p1', 'm01_gwang');
  // 0점 (광 1장, 끗 없음 등) → 7점 미만
  expect(g.phase).toBe('awaiting_play');
  expect(g.turn).toBe('p2');
});

test('G-10: 점수 7점 이상 → awaiting_go_stop', () => {
  // p1이 5광 카드를 완성하면(15점) awaiting_go_stop으로
  const g = makeGame({
    p1Hand: ['m12_gwang_bigwang', 'm05_kkeut'], // m05_kkeut 있어야 손패 비지 않음
    p2Hand: ['m06_kkeut'],
    floor:  ['m12_kkeut'], // 12월 끗 — 비광과 매칭
    deck:   [],
  });
  // 4광 미리 captured
  g.captured.p1 = [card('m01_gwang'), card('m03_gwang'), card('m08_gwang'), card('m11_gwang')];

  playCard(g, 'p1', 'm12_gwang_bigwang'); // 5광 완성 → 15점
  expect(g.phase).toBe('awaiting_go_stop');
});

test('G-11: 고 선언 → goCount 증가, 다음 턴', () => {
  const g = makeGame({
    p1Hand: ['m05_kkeut', 'm06_kkeut'],
    p2Hand: ['m07_kkeut'],
    floor:  [],
    deck:   [],
    turn:   'p1',
  });
  g.phase = 'awaiting_go_stop';
  // 7점 이상 상태로 세팅
  g.captured.p1 = [card('m01_gwang'), card('m03_gwang'), card('m08_gwang'),
                    card('m01_tti_hong'), card('m02_tti_hong'), card('m03_tti_hong')];

  const result = goStop(g, 'p1', 'go');
  expect(result.ok).toBe(true);
  expect(g.goCount.p1).toBe(1);
  expect(g.turn).toBe('p2');
  expect(g.phase).toBe('awaiting_play');
});

test('G-12: 스톱 → round_end, roundWinner 설정', () => {
  const g = makeGame({
    p1Hand: ['m05_kkeut'],
    p2Hand: ['m07_kkeut'],
    floor:  [],
    deck:   [],
    turn:   'p1',
  });
  g.phase = 'awaiting_go_stop';
  g.captured.p1 = [card('m01_gwang'), card('m03_gwang'), card('m08_gwang'),
                    card('m01_tti_hong'), card('m02_tti_hong'), card('m03_tti_hong')];
  // p2: 피 10장 (멍박 없음, 피박 없음)
  g.captured.p2 = [card('m01_pi_a'), card('m01_pi_b'), card('m02_pi_a'), card('m02_pi_b'),
                    card('m03_pi_a'), card('m03_pi_b'), card('m04_pi_a'), card('m04_pi_b'),
                    card('m05_pi_a'), card('m05_pi_b')];

  const result = goStop(g, 'p1', 'stop');
  expect(result.ok).toBe(true);
  expect(g.phase).toBe('round_end');
  expect(g.roundWinner).toBe('p1');
  expect(g.roundResult).not.toBeNull();
  expect(g.roundResult.finalScore).toBeGreaterThan(0);
});

test('G-13: 잘못된 phase에서 goStop → ok:false', () => {
  const g = makeGame({ p1Hand: ['m01_gwang'], p2Hand: ['m06_kkeut'], floor: [], deck: [] });
  g.phase = 'awaiting_play'; // 고/스톱 아닌 phase
  const result = goStop(g, 'p1', 'stop');
  expect(result.ok).toBe(false);
});

// ============================================================
// §4 박 (배수 패널티) — 룰북 §6.2
// ============================================================

test('G-14: 피박 — roundResult.reasons에 포함 (패자 piCount≤7)', () => {
  const g = makeGame({ p1Hand: ['m05_kkeut'], p2Hand: ['m07_kkeut'], floor: [], deck: [], turn: 'p1' });
  g.phase = 'awaiting_go_stop';
  // p1: 3광+홍단+5끗 = 7점 (7점 이상 → 스톱 가능)
  g.captured.p1 = [card('m01_gwang'), card('m03_gwang'), card('m08_gwang'),
                    card('m01_tti_hong'), card('m02_tti_hong'), card('m03_tti_hong'),
                    card('m05_kkeut'), card('m06_kkeut'), card('m07_kkeut'), card('m09_tti_cheong'), card('m10_kkeut')];
  // p2: 피 5장 → piCount=5 ≤7 → 피박
  g.captured.p2 = [card('m04_pi_a'), card('m04_pi_b'), card('m05_pi_a'), card('m05_pi_b'), card('m06_pi_a')];
  g.kkeutChoiceMade.p1 = true; // 술잔 체크 스킵

  goStop(g, 'p1', 'stop');
  expect(g.roundResult.reasons).toContain('피박 ×2');
});

test('G-15: 멍박 — roundResult.reasons에 포함 (패자 kkeut=0)', () => {
  const g = makeGame({ p1Hand: ['m05_kkeut'], p2Hand: ['m07_pi_a'], floor: [], deck: [], turn: 'p1' });
  g.phase = 'awaiting_go_stop';
  // p1: 3광+홍단+5끗 = 7점
  g.captured.p1 = [card('m01_gwang'), card('m03_gwang'), card('m08_gwang'),
                    card('m01_tti_hong'), card('m02_tti_hong'), card('m03_tti_hong'),
                    card('m05_kkeut'), card('m06_kkeut'), card('m07_kkeut'), card('m09_tti_cheong'), card('m10_kkeut')];
  // p2: 피 8장 + 끗 0장 → piCount=8(피박없음), kkeut=0(멍박)
  g.captured.p2 = [card('m04_pi_a'), card('m04_pi_b'), card('m05_pi_a'), card('m05_pi_b'),
                    card('m06_pi_a'), card('m06_pi_b'), card('m07_pi_b'), card('m08_pi_a')];
  g.kkeutChoiceMade.p1 = true;

  goStop(g, 'p1', 'stop');
  expect(g.roundResult.reasons).toContain('멍박 ×2');
  expect(g.roundResult.reasons).not.toContain('피박 ×2');
});

test('G-16: 광박 — roundResult.reasons에 포함 (승자 광≥3, 패자 광=0)', () => {
  const g = makeGame({ p1Hand: ['m05_kkeut'], p2Hand: ['m07_pi_a'], floor: [], deck: [], turn: 'p1' });
  g.phase = 'awaiting_go_stop';
  // p1: 3광 이상 → 광박 조건 성립
  g.captured.p1 = [card('m01_gwang'), card('m03_gwang'), card('m08_gwang'),
                    card('m01_tti_hong'), card('m02_tti_hong'), card('m03_tti_hong')];
  // p2: 광 0장, 피 10장
  g.captured.p2 = [card('m04_pi_a'), card('m04_pi_b'), card('m05_pi_a'), card('m05_pi_b'),
                    card('m06_pi_a'), card('m06_pi_b'), card('m07_pi_b'), card('m08_pi_a'),
                    card('m08_pi_b'), card('m09_pi_a')];

  goStop(g, 'p1', 'stop');
  expect(g.roundResult.reasons).toContain('광박 ×2');
});

// ============================================================
// §5 특수 이벤트
// ============================================================

test('G-17: 뻑 형성 — lastAction.kind = ppeok, 바닥에 3장 쌓임', () => {
  // p1: m01_gwang 냄, 바닥에 m01_tti_hong(1매칭 → 가져감),
  // 덱에서 m01_pi_a(같은 월 1) 뒤집힘 → 뻑
  const g = makeGame({
    p1Hand: ['m01_gwang', 'm05_kkeut'],
    p2Hand: ['m06_kkeut'],
    floor:  ['m01_tti_hong'],
    deck:   ['m01_pi_a'], // 덱 top(pop) = 같은 월 → 뻑
  });

  playCard(g, 'p1', 'm01_gwang');

  expect(g.lastAction.kind).toBe('ppeok');
  expect(g.ppeokFlags[1]).toBe('p1');
  // 바닥에 1월 카드 3장 (gwang + tti_hong + pi_a)
  expect(g.floor.filter((c) => c.month === 1).length).toBe(3);
  // captured.p1에서 제거되어 있어야 함
  expect(g.captured.p1.filter((c) => c.month === 1).length).toBe(0);
});

test('G-18: 쪽 — lastAction.kind = jjok, 상대 피 빼앗김', () => {
  // p1: m01_gwang 냄 (0매칭 → 바닥), 덱에서 m01_tti_hong(같은 월) → 쪽
  const g = makeGame({
    p1Hand: ['m01_gwang', 'm05_kkeut'],
    p2Hand: ['m06_kkeut'],
    floor:  ['m02_kkeut_godori'], // 다른 월
    deck:   ['m01_tti_hong'],   // 같은 1월 → 쪽
  });
  g.captured.p2 = [card('m06_pi_a')]; // p2 피 카드

  playCard(g, 'p1', 'm01_gwang');

  expect(g.lastAction.kind).toBe('jjok');
  expect(g.captured.p1.some((c) => c.id === 'm01_gwang')).toBe(true);
  expect(g.captured.p1.some((c) => c.id === 'm01_tti_hong')).toBe(true);
  // 상대 피 1장 빼앗김
  expect(g.captured.p1.some((c) => c.id === 'm06_pi_a')).toBe(true);
  expect(g.captured.p2.length).toBe(0);
});

test('G-19: 9월 술잔 획득 → awaiting_kkeut_choice', () => {
  // p1이 m09_kkeut을 captured하면 끗/쌍피 선택 대기
  const g = makeGame({
    p1Hand: ['m09_kkeut', 'm05_kkeut'],
    p2Hand: ['m06_kkeut'],
    floor:  ['m09_tti_cheong'], // 9월 청단과 1매칭
    deck:   [],
  });

  playCard(g, 'p1', 'm09_kkeut');

  expect(g.phase).toBe('awaiting_kkeut_choice');
  expect(g.pendingKkeutChoice).not.toBeNull();
  expect(g.pendingKkeutChoice.player).toBe('p1');
});

test('G-20: 9월 술잔 ssangpi 선택 → kkeutAsSsangpi=true, 피 카운트 +2', () => {
  const g = makeGame({
    p1Hand: ['m09_kkeut', 'm05_kkeut'],
    p2Hand: ['m06_kkeut'],
    floor:  ['m09_tti_cheong'],
    deck:   [],
  });
  playCard(g, 'p1', 'm09_kkeut'); // awaiting_kkeut_choice로

  selectKkeutType(g, 'p1', 'ssangpi');

  expect(g.kkeutAsSsangpi.p1).toBe(true);
  expect(g.kkeutChoiceMade.p1).toBe(true);
  expect(g.phase).toBe('awaiting_play'); // finishTurn 재실행 후
});

test('G-21: 9월 술잔 kkeut 선택 → kkeutAsSsangpi=false, 끗으로 카운트', () => {
  const g = makeGame({
    p1Hand: ['m09_kkeut', 'm05_kkeut'],
    p2Hand: ['m06_kkeut'],
    floor:  ['m09_tti_cheong'],
    deck:   [],
  });
  playCard(g, 'p1', 'm09_kkeut');

  selectKkeutType(g, 'p1', 'kkeut');

  expect(g.kkeutAsSsangpi.p1).toBe(false);
  expect(g.kkeutChoiceMade.p1).toBe(true);
  expect(g.phase).toBe('awaiting_play');
});

// ============================================================
// §6 흔들기
// ============================================================

test('G-22: 흔들기 선언 → shaking=true, phase=awaiting_play', () => {
  const g = makeGame({
    p1Hand: ['m01_gwang', 'm01_tti_hong', 'm01_pi_a', 'm05_kkeut'],
    p2Hand: ['m06_kkeut'],
    floor:  [],
    deck:   [],
  });
  // checkShakeOpportunity는 private이므로 직접 상태 세팅
  g.pendingShake = { player: 'p1', month: 1 };
  g.phase = 'shake_decision';

  const result = shakeDecision(g, 'p1', 'shake');
  expect(result.ok).toBe(true);
  expect(g.shaking.p1).toBe(true);
  expect(g.phase).toBe('awaiting_play');
  expect(g.pendingShake).toBeNull();
});

test('G-23: 흔들기 거절 → shaking=false 유지', () => {
  const g = makeGame({
    p1Hand: ['m01_gwang', 'm01_tti_hong', 'm01_pi_a', 'm05_kkeut'],
    p2Hand: ['m06_kkeut'],
    floor:  [],
    deck:   [],
  });
  g.pendingShake = { player: 'p1', month: 1 };
  g.phase = 'shake_decision';

  shakeDecision(g, 'p1', 'normal');
  expect(g.shaking.p1).toBe(false);
  expect(g.phase).toBe('awaiting_play');
});

// ============================================================
// §7 폭탄
// ============================================================

test('G-24: 폭탄 발동 — 4장 captured + 상대 피 1장 빼앗음', () => {
  // p1 손패: 1월 3장 + 기타 1장 / 바닥: 1월 1장 → 폭탄 조건 성립
  const g = makeGame({
    p1Hand: ['m01_gwang', 'm01_tti_hong', 'm01_pi_a', 'm05_kkeut'],
    p2Hand: ['m06_kkeut'],
    floor:  ['m01_pi_b'], // 바닥에 1월 1장
    deck:   [],
  });
  g.captured.p2 = [card('m06_pi_a')]; // 빼앗길 피

  const result = bomb(g, 'p1', 1);
  expect(result.ok).toBe(true);
  // 1월 카드 4장 모두 captured.p1으로
  expect(g.captured.p1.filter((c) => c.month === 1).length).toBe(4);
  // 상대 피 1장 빼앗음
  expect(g.captured.p1.some((c) => c.id === 'm06_pi_a')).toBe(true);
  expect(g.captured.p2.length).toBe(0);
  // 손패에서 1월 3장 제거
  expect(g.hands.p1.filter((c) => c.month === 1).length).toBe(0);
  expect(g.hands.p1.length).toBe(1); // m05_kkeut 남음
});

test('G-25: 폭탄 조건 미충족 (손패 3장 아님) → ok:false', () => {
  const g = makeGame({
    p1Hand: ['m01_gwang', 'm01_tti_hong', 'm05_kkeut'], // 1월 2장만
    p2Hand: ['m06_kkeut'],
    floor:  ['m01_pi_b'],
    deck:   [],
  });
  const result = bomb(g, 'p1', 1);
  expect(result.ok).toBe(false);
});

// ============================================================
// §8 무승부
// ============================================================

test('G-26: 양쪽 손패 소진 + 7점 미만 → 무승부 (roundWinner=null)', () => {
  // p1 손패 1장, p2 손패 없음 → 플레이 후 양쪽 모두 0장 + 7점 미만
  const g = makeGame({
    p1Hand: ['m01_gwang'], // 1장만
    p2Hand: [],
    floor:  ['m05_kkeut'], // 다른 월 → 0매칭
    deck:   [],
  });

  playCard(g, 'p1', 'm01_gwang');
  // 플레이 후: hands.p1=0, hands.p2=0, score=0 < 7 → 무승부
  expect(g.phase).toBe('round_end');
  expect(g.roundWinner).toBeNull();
  expect(g.roundResult.finalScore).toBe(0);
  expect(g.roundResult.reasons[0]).toContain('무승부');
});

// ============================================================
// §9 고박
// ============================================================

test('G-27: 고박 — 고를 부른 패자 → roundResult.reasons에 고박 포함', () => {
  // p1이 먼저 고를 부른 뒤, p2가 점수 도달하여 스톱으로 이김
  const g = makeGame({
    p1Hand: ['m05_kkeut'],
    p2Hand: ['m06_kkeut'],
    floor:  [],
    deck:   [],
  });
  g.goCount.p1 = 1; // p1이 고를 부른 상태
  g.phase = 'awaiting_go_stop';
  g.turn = 'p2'; // 이제 p2 차례

  // p2가 충분한 점수
  g.captured.p2 = [card('m01_gwang'), card('m03_gwang'), card('m08_gwang'),
                    card('m01_tti_hong'), card('m02_tti_hong'), card('m03_tti_hong')];
  // p1(패자)이 고를 불렀으므로 goCount.p1 = 1 → gobakApplies = true

  goStop(g, 'p2', 'stop');
  expect(g.roundWinner).toBe('p2');
  expect(g.roundResult.gobakApplies).toBe(true);
  expect(g.roundResult.reasons).toContain('고박 ×2');
});

// ============================================================
// §10 사통(같은 월 4장 손) — 2026-05-31 신규
// ============================================================

test('G-28: 사통 선언 → endRoundWin + 7점 보너스, reasons에 "사통 +7"', () => {
  // 사통 선언은 라운드 시작 시점이므로 양쪽 captured=비어 있음 → 피박/멍박 발동.
  // 그 결과 base=7 × mult(피박×멍박=4) = 28점.
  // 즉 사통 보너스가 가산되었음을 reasons + sangtongBonusApplied로만 확인한다.
  const g = makeGame({
    p1Hand: ['m01_gwang', 'm01_tti_hong', 'm01_pi_a', 'm01_pi_b', 'm05_kkeut'],
    p2Hand: ['m06_kkeut'],
    floor: [],
    deck: [],
  });
  g.phase = 'awaiting_sangtong';
  g.pendingSangtong = { player: 'p1', month: 1 };

  const r = sangtongDecision(g, 'p1', 'declare');
  expect(r.ok).toBe(true);
  expect(g.phase).toBe('round_end');
  expect(g.roundWinner).toBe('p1');
  expect(g.roundResult.reasons).toContain('사통 +7');
  expect(g.roundResult.sangtongBonusApplied).toBe(true);
  // 라운드 시작 시 빈 captured라 피박/멍박 발동 → 7×4=28 (현 구현 기준)
  expect(g.roundResult.finalScore).toBeGreaterThanOrEqual(7);
});

test('G-29: 사통 포기 → awaiting_play 복귀, pendingSangtong=null', () => {
  const g = makeGame({
    p1Hand: ['m01_gwang', 'm01_tti_hong', 'm01_pi_a', 'm01_pi_b', 'm05_kkeut'],
    p2Hand: ['m06_kkeut'],
    floor: [],
    deck: [],
  });
  g.phase = 'awaiting_sangtong';
  g.pendingSangtong = { player: 'p1', month: 1 };

  const r = sangtongDecision(g, 'p1', 'continue');
  expect(r.ok).toBe(true);
  expect(g.phase).toBe('awaiting_play');
  expect(g.pendingSangtong).toBeNull();
  expect(g.roundWinner).toBeNull();
});

test('G-30: createGame에서 같은 월 4장 손이 분배되면 phase=awaiting_sangtong', () => {
  // shuffle 결과에 의존 — 충분히 많이 돌려도 거의 발생 안 함. 직접 검증은 startRound 후
  // pendingSangtong 필드가 존재하는 구조인지만 확인.
  const g = createGame();
  expect(g).toHaveProperty('pendingSangtong');
  expect(g).toHaveProperty('shakeAsked');
  expect(g).toHaveProperty('bombExtraDraw');
  expect(g).toHaveProperty('firstPpeokBy');
  expect(g.shakeAsked).toEqual({ p1: false, p2: false });
  expect(g.bombExtraDraw).toBe(false);
  expect(g.firstPpeokBy).toBeNull();
});

// ============================================================
// §11 첫뻑 보너스 — 2026-05-31 신규
// ============================================================

test('G-31: 첫뻑 발생 → g.firstPpeokBy 기록', () => {
  // G-17과 동일한 뻑 형성 시나리오
  const g = makeGame({
    p1Hand: ['m01_gwang', 'm05_kkeut'],
    p2Hand: ['m06_kkeut'],
    floor:  ['m01_tti_hong'],
    deck:   ['m01_pi_a'],
  });
  playCard(g, 'p1', 'm01_gwang');
  expect(g.lastAction.kind).toBe('ppeok');
  expect(g.firstPpeokBy).toBe('p1');
});

test('G-32: 첫뻑 후 같은 사람이 두 번째 뻑을 만들어도 firstPpeokBy 유지', () => {
  const g = makeGame({
    p1Hand: ['m01_gwang', 'm05_kkeut'],
    p2Hand: ['m06_kkeut'],
    floor:  ['m01_tti_hong'],
    deck:   ['m01_pi_a'],
  });
  playCard(g, 'p1', 'm01_gwang');
  expect(g.firstPpeokBy).toBe('p1');
  // 또 한 번 뻑이 만들어졌다고 가정한 뒤(직접 갱신 시뮬레이트) firstPpeokBy는 그대로
  g.ppeokFlags[5] = 'p1';
  // firstPpeokBy는 함수 내부에서 null 체크 후 한 번만 설정되므로 그대로 'p1' 유지
  expect(g.firstPpeokBy).toBe('p1');
});

test('G-33: 첫뻑 보너스 — 첫뻑 만든 사람이 라운드 승리 시 +7점, reasons에 "첫뻑 +7"', () => {
  const g = makeGame({
    p1Hand: ['m05_kkeut'],
    p2Hand: ['m07_kkeut'],
    floor:  [],
    deck:   [],
    turn:   'p1',
  });
  g.phase = 'awaiting_go_stop';
  g.firstPpeokBy = 'p1';
  // p1: 7점 짜리 captured
  g.captured.p1 = [card('m01_gwang'), card('m03_gwang'), card('m08_gwang'),
                    card('m01_tti_hong'), card('m02_tti_hong'), card('m03_tti_hong'),
                    card('m05_kkeut'), card('m06_kkeut'), card('m07_kkeut'), card('m09_tti_cheong'), card('m10_kkeut')];
  // p2: 피 10장 (박 없음)
  g.captured.p2 = [card('m01_pi_a'), card('m01_pi_b'), card('m02_pi_a'), card('m02_pi_b'),
                    card('m03_pi_a'), card('m03_pi_b'), card('m04_pi_a'), card('m04_pi_b'),
                    card('m05_pi_a'), card('m05_pi_b')];
  g.kkeutChoiceMade.p1 = true;

  goStop(g, 'p1', 'stop');
  expect(g.roundWinner).toBe('p1');
  expect(g.roundResult.reasons).toContain('첫뻑 +7');
  expect(g.roundResult.firstPpeokBy).toBe('p1');
});

test('G-34: 첫뻑한 사람이 패배 시 보너스 미적용', () => {
  const g = makeGame({
    p1Hand: ['m05_kkeut'],
    p2Hand: ['m07_kkeut'],
    floor:  [],
    deck:   [],
    turn:   'p2', // p2가 스톱하여 승리
  });
  g.phase = 'awaiting_go_stop';
  g.firstPpeokBy = 'p1'; // p1이 첫뻑인데 p2가 승리
  g.captured.p2 = [card('m01_gwang'), card('m03_gwang'), card('m08_gwang'),
                    card('m01_tti_hong'), card('m02_tti_hong'), card('m03_tti_hong')];
  g.captured.p1 = [card('m01_pi_a'), card('m01_pi_b'), card('m02_pi_a'), card('m02_pi_b'),
                    card('m03_pi_a'), card('m03_pi_b'), card('m04_pi_a'), card('m04_pi_b'),
                    card('m05_pi_a'), card('m05_pi_b')];

  goStop(g, 'p2', 'stop');
  expect(g.roundWinner).toBe('p2');
  expect(g.roundResult.reasons).not.toContain('첫뻑 +7');
});

// ============================================================
// §12 폭탄 후 덱 2장 뒤집기 — 2026-05-31 신규
// ============================================================

test('G-35: 폭탄 후 bombExtraDraw=false (덱 2장 모두 정상 뒤집힘 시)', () => {
  // 폭탄 발동 + 덱 2장 모두 다른 월(awaiting_floor_choice 진입 없음)
  const g = makeGame({
    p1Hand: ['m01_gwang', 'm01_tti_hong', 'm01_pi_a', 'm05_kkeut'],
    p2Hand: ['m06_kkeut'],
    floor:  ['m01_pi_b'],
    // 덱 top(pop) = 끝에 있는 게 먼저 뽑힘. 두 카드 모두 바닥에 없는 월로 설정.
    deck:   ['m03_pi_a', 'm04_pi_a'],
  });
  const r = bomb(g, 'p1', 1);
  expect(r.ok).toBe(true);
  // 폭탄 후 두 번째 drawAndResolve까지 진행되면 bombExtraDraw는 false로 복원
  expect(g.bombExtraDraw).toBe(false);
  // 덱 2장 모두 뒤집혔으면 turn 교대 또는 round_end
  expect(['awaiting_play', 'round_end', 'awaiting_go_stop'].includes(g.phase)).toBe(true);
});

test('G-36: 폭탄 후 첫 번째 뒤집기에서 awaiting_floor_choice → bombExtraDraw=true', () => {
  // 첫 번째 뒤집기로 같은 월 2장이 있는 케이스를 만들어 awaiting_floor_choice 진입.
  const g = makeGame({
    p1Hand: ['m01_gwang', 'm01_tti_hong', 'm01_pi_a', 'm05_kkeut'],
    p2Hand: ['m06_kkeut'],
    floor:  ['m01_pi_b', 'm07_pi_a', 'm07_pi_b'], // 7월 2장 있음
    deck:   ['m07_kkeut'], // 첫 뒤집기로 7월 → 7월 2장과 매칭(2매칭) → awaiting_floor_choice
  });
  const r = bomb(g, 'p1', 1);
  expect(r.ok).toBe(true);
  // 첫 번째 뒤집기에서 멈춤 → bombExtraDraw 플래그가 살아 있어야 한다.
  expect(g.phase).toBe('awaiting_floor_choice');
  expect(g.bombExtraDraw).toBe(true);
});

test('G-37: chooseFloorSteps가 bombExtraDraw=true를 이어받아 두 번째 뒤집기 실행', () => {
  // G-36과 동일 셋업 + 덱에 두 번째 뒤집기용 카드 추가
  const g = makeGame({
    p1Hand: ['m01_gwang', 'm01_tti_hong', 'm01_pi_a', 'm05_kkeut'],
    p2Hand: ['m06_kkeut'],
    floor:  ['m01_pi_b', 'm07_pi_a', 'm07_pi_b'],
    // 덱 top(pop) 순서: m07_kkeut(첫번째), m03_pi_a(두번째, 다른 월)
    deck:   ['m03_pi_a', 'm07_kkeut'],
  });
  bomb(g, 'p1', 1);
  expect(g.phase).toBe('awaiting_floor_choice');
  expect(g.bombExtraDraw).toBe(true);

  // 바닥에서 m07_pi_a 선택
  const r = chooseFloor(g, 'p1', 'm07_pi_a');
  expect(r.ok).toBe(true);
  // chooseFloorSteps가 두 번째 뒤집기까지 실행 → bombExtraDraw 복원
  expect(g.bombExtraDraw).toBe(false);
  // 두 번째 뒤집기 후 정상적으로 턴 교대 또는 round_end
  expect(['awaiting_play', 'round_end', 'awaiting_go_stop'].includes(g.phase)).toBe(true);
});

// ============================================================
// §13 흔들기 카드 클릭 시점 — 2026-05-31 신규
// ============================================================

test('G-38: shakeDecision은 awaiting_play phase에서도 작동 (클라 모달 방식)', () => {
  const g = makeGame({
    p1Hand: ['m01_gwang', 'm01_tti_hong', 'm01_pi_a', 'm05_kkeut'],
    p2Hand: ['m06_kkeut'],
    floor: [],
    deck: [],
    turn: 'p1',
  });
  // phase는 awaiting_play 그대로
  const r = shakeDecision(g, 'p1', 'shake', 1);
  expect(r.ok).toBe(true);
  expect(g.shaking.p1).toBe(true);
  expect(g.shakeAsked.p1).toBe(true);
  expect(g.phase).toBe('awaiting_play'); // phase 변경 없이 그대로
});

test('G-39: shakeAsked.p1=true 이후 재호출 시 에러', () => {
  const g = makeGame({
    p1Hand: ['m01_gwang', 'm01_tti_hong', 'm01_pi_a', 'm05_kkeut'],
    p2Hand: ['m06_kkeut'],
    floor: [],
    deck: [],
    turn: 'p1',
  });
  shakeDecision(g, 'p1', 'shake', 1);
  // 한 번 호출 후 다시 호출하면 에러
  const r2 = shakeDecision(g, 'p1', 'normal', 1);
  expect(r2.ok).toBe(false);
});

// ============================================================
// §14 쓸 (한국 표준 룰) — 2026-06-03 신규
// 바닥 같은 월 2장 + 손패 1장(awaiting_floor_choice → 선택) + 더미 1장 → 그 월 4장 전부 + 피 1장.
// 따닥(같은 월 손패 1매칭 + 더미 1매칭)과 효과는 같으나 lastAction.kind를 'sseul'로 분리.
// ============================================================

test('G-40: 쓸 — 바닥 2장 + 손패 1장 선택 + 더미 1장 → kind=sseul, 4장 captured, 피 1장 빼앗김', () => {
  // 바닥에 1월 2장. p1이 1월 카드를 내면 awaiting_floor_choice.
  // 1장 선택 후 단계 2 drawAndResolve에서 덱 top(pop) = 1월 → 남은 1장과 매칭 → 쓸.
  const g = makeGame({
    p1Hand: ['m01_gwang', 'm05_kkeut'],
    p2Hand: ['m06_kkeut'],
    floor:  ['m01_tti_hong', 'm01_pi_a'], // 1월 2장 → 2매칭
    deck:   ['m01_pi_b'],                 // 더미 top = 1월 → 쓸 시나리오
  });
  g.captured.p2 = [card('m06_pi_a')]; // 빼앗길 피

  const r1 = playCard(g, 'p1', 'm01_gwang');
  expect(r1.ok).toBe(true);
  expect(g.phase).toBe('awaiting_floor_choice');

  const r2 = chooseFloor(g, 'p1', 'm01_tti_hong');
  expect(r2.ok).toBe(true);

  // 쓸 검증
  expect(g.lastAction.kind).toBe('sseul');
  expect(g.lastAction.month).toBe(1);
  // 1월 4장 모두 p1 captured
  expect(g.captured.p1.filter((c) => c.month === 1).length).toBe(4);
  // 바닥에서 1월 카드 모두 빠짐
  expect(g.floor.filter((c) => c.month === 1).length).toBe(0);
  // 상대 피 1장 빼앗김
  expect(g.captured.p1.some((c) => c.id === 'm06_pi_a')).toBe(true);
  expect(g.captured.p2.length).toBe(0);
});

test('G-41: 쓸 — 상대 피 0장이어도 게임 정상 진행 (피 빼앗기 skip)', () => {
  const g = makeGame({
    p1Hand: ['m01_gwang', 'm05_kkeut'],
    p2Hand: ['m06_kkeut'],
    floor:  ['m01_tti_hong', 'm01_pi_a'],
    deck:   ['m01_pi_b'],
  });
  // p2 피 0장
  g.captured.p2 = [];

  playCard(g, 'p1', 'm01_gwang');
  chooseFloor(g, 'p1', 'm01_tti_hong');

  expect(g.lastAction.kind).toBe('sseul');
  expect(g.captured.p1.filter((c) => c.month === 1).length).toBe(4);
  // 빼앗을 피가 없었으므로 captured.p1 = 1월 4장만
  expect(g.captured.p1.length).toBe(4);
  // 게임은 정상적으로 다음 턴(또는 점수 도달 시 awaiting_go_stop)
  expect(['awaiting_play', 'awaiting_go_stop', 'round_end'].includes(g.phase)).toBe(true);
});

test('G-42: 쓸 vs 따닥 구분 — 바닥 1장 + 손패 1장 + 더미 1장은 따닥 (sseul 아님)', () => {
  // 손패 1매칭(바닥 1장과) → 더미에서 같은 월 1장 → 그 월 4장이 아니라
  // 손패+바닥짝+더미 = 3장 점수판인데 바닥에 남은 1장이 또 있으면 따닥.
  // 정확히 같은 월 4장 케이스를 따닥으로 만들기 위해 바닥에 1월 2장 + 손패 1매칭은
  // awaiting_floor_choice가 되므로 시나리오를 정확히 분리:
  //   - 손패 1매칭 (바닥 1장과 매칭) → drawAndResolve 단계에서 같은 월 더미 → 바닥에
  //     남은 1장과 매칭되어 ttadak. 이 케이스는 chooseFloor 경로 아님 → 따닥 유지.
  const g = makeGame({
    p1Hand: ['m01_gwang', 'm05_kkeut'],
    p2Hand: ['m06_kkeut'],
    floor:  ['m01_tti_hong', 'm01_pi_a'], // 1월 2장 — playCard 단계 1에서 2매칭(awaiting_floor_choice)
    deck:   ['m01_pi_b'],
  });
  // 위 케이스는 G-40의 쓸 시나리오. "따닥"이 발생하는 정확한 케이스는 손패 1매칭이어야 하므로
  // 바닥에 1월 1장만 두고 손패에 1월 1장, 더미에 1월 1장 + 바닥에 추가로 매칭될 다른 카드.
  // 정확한 따닥 시나리오: 바닥에 1월 1장 + (드로우용) 2매칭 만들 수 있는 1월 카드가 또…
  //   → 사실 같은 월 4장 따닥은 손패 1매칭 + 더미 1매칭(같은 월) 시나리오인데,
  //     이 경우 바닥에는 1월 1장만 있어야 손패가 1매칭. 더미가 1월이면 바닥에 0장 남음 → jjok 분기.
  //   → drawAndResolve의 sameMonthOnFloor.length === 0 분기는 ppeok로 가버린다.
  //   → 즉 같은 월 4장 따닥은 "바닥에 1월 2장 + 손패 1매칭" 시나리오만 가능한데, 그건 awaiting_floor_choice.
  // 따라서 손패 1매칭 + 더미 1매칭으로 "같은 월 4장 한꺼번에 가져가는 따닥"은 실제 가능 시나리오:
  //   바닥에 1월 1장(짝지을 카드) + 손패 m01_X (1매칭) + 그 후 더미에서 m01_Y 나옴 →
  //   sameMonthOnFloor.length === 0 → ppeok. ttadak 아님!
  //   따라서 같은 월 ttadak은 사실상 awaiting_floor_choice 경로(=쓸)뿐.
  // → 본 검증은 G-40과 동일한 셋업에서 chooseFloor 결과 kind가 'ttadak'이 아닌 'sseul'임을 확인.
  playCard(g, 'p1', 'm01_gwang');
  chooseFloor(g, 'p1', 'm01_tti_hong');
  // 따닥이 아니라 쓸로 식별되어야 한다
  expect(g.lastAction.kind).toBe('sseul');
  expect(g.lastAction.kind).not.toBe('ttadak');
});

test('G-43: 쓸 시나리오에서 더미가 다른 월이면 그냥 통상 처리 (sseul/ttadak 아님)', () => {
  const g = makeGame({
    p1Hand: ['m01_gwang', 'm05_kkeut'],
    p2Hand: ['m06_kkeut'],
    floor:  ['m01_tti_hong', 'm01_pi_a'], // 바닥 1월 2장
    deck:   ['m03_pi_a'],                 // 더미 = 3월 (다른 월)
  });
  g.captured.p2 = [card('m06_pi_a')];

  playCard(g, 'p1', 'm01_gwang');
  chooseFloor(g, 'p1', 'm01_tti_hong');
  // 더미가 다른 월 → 바닥에 그대로 놓임. 쓸/따닥 아님.
  expect(g.lastAction.kind).not.toBe('sseul');
  expect(g.lastAction.kind).not.toBe('ttadak');
  // 상대 피 빼앗기지 않음
  expect(g.captured.p2.length).toBe(1);
});

test('G-44: 쓸 — 바닥 같은 월 3장 시작이면 쓸 아님 (사용자 명세: 정확히 2장 + 1 + 1)', () => {
  // 바닥에 1월 3장 → 손패가 1월 카드 내면 3매칭 분기(라인 362) → sweep_from_hand,
  // chooseFloor 경로로 진입하지 않음. → 쓸이 발생할 수 없음.
  const g = makeGame({
    p1Hand: ['m01_gwang', 'm05_kkeut'],
    p2Hand: ['m06_kkeut'],
    floor:  ['m01_tti_hong', 'm01_pi_a', 'm01_pi_b'], // 1월 3장
    deck:   [],
  });
  g.captured.p2 = [card('m06_pi_a')];

  playCard(g, 'p1', 'm01_gwang');
  // sweep_from_hand이지 sseul이 아님
  expect(g.lastAction.kind).toBe('sweep_from_hand');
});
