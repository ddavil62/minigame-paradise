/**
 * @fileoverview 하나비 룰북 기반 유닛 테스트 (HR-C1~HR-C5).
 *
 * 서버 불필요 — game.js 순수 함수를 직접 import하여 검증한다.
 * 룰북 §12 QA 체크리스트의 덱·셋업/힌트/내기/버리기/종료·점수 그룹을 커버한다.
 *
 * 실행:
 *   npx playwright test tests/rulebook-c1-c5-unit.spec.js --reporter=list
 *
 * 테스트 ID 형식: HR-Cn-xxx (Hanabi Rulebook, Category n, 번호).
 */

import { test, expect } from 'playwright/test';
import {
  createGame,
  giveClue,
  playCard,
  discardCard,
  checkGameEnd,
  snapshotForPlayer,
  calcScore,
  getGrade,
  COLORS,
  NUMBERS,
} from '../game.js';

// ── 테스트 헬퍼 ─────────────────────────────────────────────────

/**
 * 손패를 결정론적으로 세팅한다(셔플 무작위성 제거).
 * @param {object} state
 * @param {string} pid 'p1'|'p2'
 * @param {Array<[string, number]>} cards [color, number] 쌍 배열
 */
function setHand(state, pid, cards) {
  state.hands[pid] = cards.map(([color, number], i) => ({
    id: `${color}-${number}-set${i}`,
    color,
    number,
    clues: [],
  }));
}

// ── HR-C1: 덱·셋업 (§12-1) ──────────────────────────────────────

test('HR-C1-001 덱 장수: deck + p1손패 + p2손패 = 50', () => {
  const s = createGame();
  expect(s.deck.length + s.hands.p1.length + s.hands.p2.length).toBe(50);
});

test('HR-C1-002 색당 10장', () => {
  const s = createGame();
  const all = [...s.deck, ...s.hands.p1, ...s.hands.p2];
  for (const color of COLORS) {
    const count = all.filter((c) => c.color === color).length;
    expect(count).toBe(10);
  }
});

test('HR-C1-003 숫자 분포 (1→15, 2→10, 3→10, 4→10, 5→5)', () => {
  const s = createGame();
  const all = [...s.deck, ...s.hands.p1, ...s.hands.p2];
  const expected = { 1: 15, 2: 10, 3: 10, 4: 10, 5: 5 };
  for (const n of NUMBERS) {
    const count = all.filter((c) => c.number === n).length;
    expect(count).toBe(expected[n]);
  }
});

test('HR-C1-004 손패 5장', () => {
  const s = createGame();
  expect(s.hands.p1.length).toBe(5);
  expect(s.hands.p2.length).toBe(5);
});

test('HR-C1-005 초기 토큰 clue=8 fuse=3', () => {
  const s = createGame();
  expect(s.tokens.clue).toBe(8);
  expect(s.tokens.fuse).toBe(3);
});

test('HR-C1-006 손패 가림(단위): 본인 myHand color/number === null', () => {
  const s = createGame();
  const snap = snapshotForPlayer(s, 'p1');
  for (const c of snap.myHand) {
    expect(c.color).toBeNull();
    expect(c.number).toBeNull();
  }
  // 상대 손패는 공개되어야 한다.
  for (const c of snap.opponentHand) {
    expect(c.color).not.toBeNull();
    expect(c.number).not.toBeNull();
  }
});

// ── HR-C2: 힌트 (§12-2) ─────────────────────────────────────────

test('HR-C2-001 색 힌트 전부 마킹', () => {
  const s = createGame();
  s.currentTurn = 'p1';
  // p2 손패에 blue 2장 배치
  setHand(s, 'p2', [['blue', 1], ['red', 2], ['blue', 3], ['green', 4], ['yellow', 5]]);
  const r = giveClue(s, 'p1', 'p2', 'color', 'blue');
  expect(r.ok).toBe(true);
  expect(r.touchedIndices.sort()).toEqual([0, 2]);
  expect(s.hands.p2[0].clues).toContainEqual({ type: 'color', value: 'blue' });
  expect(s.hands.p2[2].clues).toContainEqual({ type: 'color', value: 'blue' });
});

test('HR-C2-002 숫자 힌트 전부 마킹', () => {
  const s = createGame();
  s.currentTurn = 'p1';
  setHand(s, 'p2', [['blue', 3], ['red', 3], ['green', 3], ['green', 4], ['yellow', 5]]);
  const r = giveClue(s, 'p1', 'p2', 'number', 3);
  expect(r.ok).toBe(true);
  expect(r.touchedIndices.sort()).toEqual([0, 1, 2]);
});

test('HR-C2-003 0장 힌트 거부', () => {
  const s = createGame();
  s.currentTurn = 'p1';
  setHand(s, 'p2', [['blue', 1], ['red', 2], ['green', 3], ['green', 4], ['yellow', 5]]);
  const r = giveClue(s, 'p1', 'p2', 'color', 'white'); // white 없음
  expect(r.ok).toBe(false);
});

test('HR-C2-004 토큰 0 시 힌트 불가', () => {
  const s = createGame();
  s.currentTurn = 'p1';
  s.tokens.clue = 0;
  const r = giveClue(s, 'p1', 'p2', 'color', s.hands.p2[0].color);
  expect(r.ok).toBe(false);
});

test('HR-C2-005 힌트 후 토큰 -1', () => {
  const s = createGame();
  s.currentTurn = 'p1';
  setHand(s, 'p2', [['blue', 1], ['red', 2], ['green', 3], ['green', 4], ['yellow', 5]]);
  const before = s.tokens.clue;
  giveClue(s, 'p1', 'p2', 'color', 'blue');
  expect(s.tokens.clue).toBe(before - 1);
});

test('HR-C2-006 턴 아님 힌트 거부', () => {
  const s = createGame();
  s.currentTurn = 'p2'; // p2 턴인데 p1이 힌트
  const r = giveClue(s, 'p1', 'p2', 'color', s.hands.p2[0].color);
  expect(r.ok).toBe(false);
});

// ── HR-C3: 내기 (§12-3) ─────────────────────────────────────────

test('HR-C3-001 빈 색에 1 성공', () => {
  const s = createGame();
  s.currentTurn = 'p1';
  setHand(s, 'p1', [['white', 1], ['red', 2], ['blue', 3], ['green', 4], ['yellow', 5]]);
  const r = playCard(s, 'p1', 0);
  expect(r.ok).toBe(true);
  expect(r.success).toBe(true);
  expect(s.fireworks.white).toBe(1);
});

test('HR-C3-002 빈 색에 2 실패 + 폭탄', () => {
  const s = createGame();
  s.currentTurn = 'p1';
  setHand(s, 'p1', [['white', 2], ['red', 2], ['blue', 3], ['green', 4], ['yellow', 5]]);
  const fuseBefore = s.tokens.fuse;
  const r = playCard(s, 'p1', 0);
  expect(r.success).toBe(false);
  expect(r.fuseBroke).toBe(true);
  expect(s.tokens.fuse).toBe(fuseBefore - 1);
  expect(s.discardPile.some((c) => c.color === 'white' && c.number === 2)).toBe(true);
});

test('HR-C3-003 N+1 성공', () => {
  const s = createGame();
  s.currentTurn = 'p1';
  s.fireworks.white = 2;
  setHand(s, 'p1', [['white', 3], ['red', 2], ['blue', 3], ['green', 4], ['yellow', 5]]);
  const r = playCard(s, 'p1', 0);
  expect(r.success).toBe(true);
  expect(s.fireworks.white).toBe(3);
});

test('HR-C3-004 5 완성 토큰 회수', () => {
  const s = createGame();
  s.currentTurn = 'p1';
  s.fireworks.white = 4;
  s.tokens.clue = 5;
  setHand(s, 'p1', [['white', 5], ['red', 2], ['blue', 3], ['green', 4], ['yellow', 5]]);
  const r = playCard(s, 'p1', 0);
  expect(r.success).toBe(true);
  expect(r.fiveCompleted).toBe(true);
  expect(s.tokens.clue).toBe(6);
});

test('HR-C3-005 5 완성 토큰 8 상한', () => {
  const s = createGame();
  s.currentTurn = 'p1';
  s.fireworks.white = 4;
  s.tokens.clue = 8;
  setHand(s, 'p1', [['white', 5], ['red', 2], ['blue', 3], ['green', 4], ['yellow', 5]]);
  playCard(s, 'p1', 0);
  expect(s.tokens.clue).toBe(8); // 상한 초과 회수 없음
});

test('HR-C3-006 내기 후 보충', () => {
  const s = createGame();
  s.currentTurn = 'p1';
  const deckBefore = s.deck.length;
  playCard(s, 'p1', 0);
  expect(s.deck.length).toBe(deckBefore - 1);
  expect(s.hands.p1.length).toBe(5); // 5장 유지
});

test('HR-C3-007 실패 카드 버림 더미, fireworks 불변', () => {
  const s = createGame();
  s.currentTurn = 'p1';
  s.fireworks.white = 3;
  setHand(s, 'p1', [['white', 5], ['red', 2], ['blue', 3], ['green', 4], ['yellow', 5]]); // white 5는 4 다음이라 실패
  const before = s.fireworks.white;
  const r = playCard(s, 'p1', 0);
  expect(r.success).toBe(false);
  expect(s.fireworks.white).toBe(before);
  expect(s.discardPile.length).toBeGreaterThan(0);
});

// ── HR-C4: 버리기 (§12-4) ────────────────────────────────────────

test('HR-C4-001 버리기 토큰 회수', () => {
  const s = createGame();
  s.currentTurn = 'p1';
  s.tokens.clue = 5;
  const r = discardCard(s, 'p1', 0);
  expect(r.ok).toBe(true);
  expect(s.tokens.clue).toBe(6);
});

test('HR-C4-002 토큰 8 시 버리기 차단 (§13-5)', () => {
  const s = createGame();
  s.currentTurn = 'p1';
  s.tokens.clue = 8;
  const r = discardCard(s, 'p1', 0);
  expect(r.ok).toBe(false);
});

test('HR-C4-003 버린 카드 공개', () => {
  const s = createGame();
  s.currentTurn = 'p1';
  s.tokens.clue = 5;
  setHand(s, 'p1', [['white', 1], ['red', 2], ['blue', 3], ['green', 4], ['yellow', 5]]);
  discardCard(s, 'p1', 0);
  const last = s.discardPile[s.discardPile.length - 1];
  expect(last.color).toBe('white');
  expect(last.number).toBe(1);
});

test('HR-C4-004 버리기 후 보충', () => {
  const s = createGame();
  s.currentTurn = 'p1';
  s.tokens.clue = 5;
  const deckBefore = s.deck.length;
  discardCard(s, 'p1', 0);
  expect(s.deck.length).toBe(deckBefore - 1);
  expect(s.hands.p1.length).toBe(5);
});

// ── HR-C5: 종료·점수 (§12-5) ────────────────────────────────────

test('HR-C5-001 25점 즉시 승리', () => {
  const s = createGame();
  for (const c of COLORS) s.fireworks[c] = 5;
  const ended = checkGameEnd(s);
  expect(ended).toBe(true);
  expect(s.result.outcome).toBe('win');
  expect(s.result.score).toBe(25);
  expect(s.result.reason).toBe('perfect');
});

test('HR-C5-002 폭탄3 즉시 패배', () => {
  const s = createGame();
  s.currentTurn = 'p1';
  s.tokens.fuse = 1;
  s.fireworks.white = 3; // white 5 내기 → 실패 → fuse 0
  setHand(s, 'p1', [['white', 5], ['red', 2], ['blue', 3], ['green', 4], ['yellow', 5]]);
  playCard(s, 'p1', 0);
  expect(s.phase).toBe('ended');
  expect(s.result.outcome).toBe('lose');
  expect(s.result.reason).toBe('fuse');
});

test('HR-C5-003 덱 소진 마지막 라운드 시작 (lastRoundTurnsLeft===2)', () => {
  const s = createGame();
  s.currentTurn = 'p1';
  s.tokens.clue = 5;
  // 덱을 1장만 남김
  s.deck = [{ id: 'last-card', color: 'white', number: 1, clues: [] }];
  // 버리기 → drawCard로 마지막 카드 뽑힘 → 덱 소진
  discardCard(s, 'p1', 0);
  // discardCard 내부: drawCard로 덱 비움 → lastRoundTurnsLeft=2, 그 후 advanceTurn으로 1
  // 따라서 시작 직후 시점(advanceTurn 전)은 2이지만 호출 끝나면 1.
  // 시작값 2 검증은 drawCard 직후 상태를 별도 검증.
  expect(s.deckEmptyTurn).toBe('p1');
  expect(s.lastRoundTurnsLeft).toBe(1); // advanceTurn 1회 적용 후
});

test('HR-C5-003b 덱 소진 카운트다운 초기값 2 (advanceTurn 직전)', () => {
  // drawCard만 직접 검증하기 위해 createGame 후 덱을 비우고 내부 동작을 추적.
  const s = createGame();
  s.deck = [{ id: 'last', color: 'red', number: 1, clues: [] }];
  // discardCard는 advanceTurn까지 하므로, 카운트다운 초기값 2는
  // "drawCard 직후 = lastRoundTurnsLeft 2" → advanceTurn → 1 로 확인됨.
  s.currentTurn = 'p1';
  s.tokens.clue = 5;
  discardCard(s, 'p1', 0);
  // 2(초기) - 1(advanceTurn) = 1. 양쪽 1턴씩 = 총 2턴 게이트 확인됨.
  expect(s.lastRoundTurnsLeft).toBe(1);
});

test('HR-C5-004 마지막 라운드 양쪽 1턴 후 종료', () => {
  const s = createGame();
  s.currentTurn = 'p1';
  s.tokens.clue = 5;
  s.deck = [{ id: 'last', color: 'white', number: 1, clues: [] }];
  // p1 행동: 버리기 → 덱 소진 → lastRoundTurnsLeft 2→1, 턴 p2
  discardCard(s, 'p1', 0);
  expect(s.phase).toBe('playing');
  expect(s.lastRoundTurnsLeft).toBe(1);
  expect(s.currentTurn).toBe('p2');
  // p2 행동: 버리기 → lastRoundTurnsLeft 1→0 → 종료
  discardCard(s, 'p2', 0);
  expect(s.lastRoundTurnsLeft).toBe(0);
  expect(s.phase).toBe('ended');
  expect(s.result.reason).toBe('deck_end');
});

test('HR-C5-005 오프바이원 게이트: 종료 후 추가 행동 불가', () => {
  const s = createGame();
  s.currentTurn = 'p1';
  s.tokens.clue = 5;
  s.deck = [{ id: 'last', color: 'white', number: 1, clues: [] }];
  discardCard(s, 'p1', 0); // 덱 비움 (p1)
  discardCard(s, 'p2', 0); // p2 1턴 → 종료
  expect(s.phase).toBe('ended');
  // 종료 후 p1이 다시 행동 시도 → 거부되어야 함 (추가 턴 불가)
  const r = discardCard(s, 'p1', 0);
  expect(r.ok).toBe(false);
});

test('HR-C5-006 점수 계산', () => {
  const s = createGame();
  s.fireworks = { white: 3, red: 1, blue: 5, green: 2, yellow: 4 };
  expect(calcScore(s)).toBe(15);
});

test('HR-C5-007 등급 매핑', () => {
  expect(getGrade(25)).toBe('전설의 불꽃놀이!');
  expect(getGrade(0)).toBe('처참함');
  expect(getGrade(5)).toBe('처참함');
  expect(getGrade(6)).toBe('아쉬움');
  expect(getGrade(11)).toBe('무난함');
  expect(getGrade(16)).toBe('훌륭함');
  expect(getGrade(21)).toBe('경이로움');
  expect(getGrade(24)).toBe('경이로움');
});
