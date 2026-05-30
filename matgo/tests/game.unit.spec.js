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
  shakeDecision, selectKkeutType, bomb,
} from '../game.js';
import { buildDeck } from '../cards.js';

// ── 카드 룩업 ─────────────────────────────────────────────────────────
/** 전체 48장 카드를 id→Card 맵으로 빌드. */
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
  };
}

// ============================================================
// §1 기본 초기화
// ============================================================

test('G-01: createGame — 손패 10+10, 바닥 8, 덱 20', () => {
  const g = createGame();
  expect(g.hands.p1.length).toBe(10);
  expect(g.hands.p2.length).toBe(10);
  expect(g.floor.length).toBe(8);
  // 48 - 10 - 10 - 8 = 20
  expect(g.deck.length).toBe(20);
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
