/**
 * @fileoverview 맞고 사용자 리포트 27~30 독립 QA 규칙·불변식 테스트.
 */

import { test, expect } from '@playwright/test';
import { buildDeck } from '../cards.js';
import { chooseFloor, playCard, selectKkeutType } from '../game.js';

const BY_ID = Object.fromEntries(buildDeck().map((card) => [card.id, card]));

/**
 * 카드 ID 배열을 실제 카드 배열로 바꾼다.
 *
 * @param {string[]} ids
 * @returns {object[]}
 */
function cards(ids) {
  return ids.map((id) => {
    if (!BY_ID[id]) throw new Error(`알 수 없는 카드: ${id}`);
    return BY_ID[id];
  });
}

/**
 * 결정적 QA 상태를 만든다.
 *
 * @param {object} config
 * @returns {object}
 */
function makeGame(config) {
  return {
    deck: cards(config.deck || []),
    floor: cards(config.floor || []),
    hands: { p1: cards(config.p1Hand || []), p2: cards(config.p2Hand || []) },
    captured: { p1: cards(config.p1Captured || []), p2: cards(config.p2Captured || []) },
    ppeokFlags: {},
    ppeokCount: { p1: 0, p2: 0 },
    pendingFloorChoice: null,
    pendingChoiceSrcCardId: null,
    turn: config.turn || 'p1',
    phase: 'awaiting_play',
    goCount: { p1: 0, p2: 0 },
    shaking: { p1: false, p2: false },
    money: { p1: 10000, p2: 10000 },
    perPoint: 100,
    roundWinner: null,
    stoppedBy: null,
    lastAction: null,
    lastHandPlayed: null,
    roundResult: null,
    lastGoScore: { p1: null, p2: null },
    kkeutAsSsangpi: { p1: false, p2: false },
    kkeutChoiceMade: { p1: false, p2: false },
    pendingKkeutChoice: null,
    pendingSangtong: null,
    shakeAsked: { p1: false, p2: false },
    bombDeckCredit: { p1: 0, p2: 0 },
    pendingBombFlips: { p1: 0, p2: 0 },
    bombResolvingPlayer: null,
    firstPpeokBy: null,
  };
}

/**
 * 상태 전체의 카드 ID를 수집한다.
 *
 * @param {object} game
 * @returns {string[]}
 */
function allCardIds(game) {
  return [
    ...game.deck,
    ...game.floor,
    ...game.hands.p1,
    ...game.hands.p2,
    ...game.captured.p1,
    ...game.captured.p2,
  ].map((card) => card.id);
}

test('QA-R29: 정확한 쓸은 상대 피를 한 장만 빼앗고 카드 수·고유성을 보존한다', () => {
  const game = makeGame({
    p1Hand: ['m01_gwang', 'm05_kkeut'],
    p2Hand: ['m06_kkeut'],
    floor: ['m01_tti_hong', 'm02_tti_hong'],
    deck: ['m02_kkeut_godori'],
    p2Captured: ['m06_pi_a', 'm07_pi_a'],
  });
  const before = allCardIds(game);

  expect(playCard(game, 'p1', 'm01_gwang').ok).toBe(true);
  expect(game.lastAction).toMatchObject({ kind: 'sseul', stoleFromOpp: 1 });
  expect(game.floor).toHaveLength(0);
  expect(game.captured.p2).toHaveLength(1);
  expect(allCardIds(game)).toHaveLength(before.length);
  expect(new Set(allCardIds(game)).size).toBe(before.length);
});

test('QA-R29: 같은 월 네 장 선택 흐름은 쓸이 아니며 기존 따닥 강탈만 적용된다', () => {
  const game = makeGame({
    p1Hand: ['m01_gwang', 'm05_kkeut'],
    p2Hand: ['m06_kkeut'],
    floor: ['m01_tti_hong', 'm01_pi_a'],
    deck: ['m01_pi_b'],
    p2Captured: ['m06_pi_a'],
  });

  expect(playCard(game, 'p1', 'm01_gwang').ok).toBe(true);
  expect(chooseFloor(game, 'p1', 'm01_tti_hong').ok).toBe(true);
  expect(game.lastAction.kind).not.toBe('sseul');
  expect(game.lastAction).toMatchObject({ kind: 'ttadak', stoleFromOpp: 1 });
  expect(game.captured.p2).toHaveLength(0);
});

test('QA-R30: 상대 소진 뒤 마지막 9월 패는 입력·매칭·더미·선택을 모두 거친다', () => {
  const game = makeGame({
    p1Hand: ['m09_kkeut'],
    p2Hand: ['m09_pi_a'],
    deck: ['m07_kkeut', 'm08_kkeut_godori'],
    turn: 'p2',
  });
  const before = allCardIds(game);

  expect(playCard(game, 'p2', 'm09_pi_a').ok).toBe(true);
  expect(game).toMatchObject({ phase: 'awaiting_play', turn: 'p1' });
  expect(game.hands.p1.map((card) => card.id)).toEqual(['m09_kkeut']);
  expect(game.captured.p1).toHaveLength(0);

  expect(playCard(game, 'p1', 'm09_kkeut').ok).toBe(true);
  expect(game.phase).toBe('awaiting_kkeut_choice');
  expect(game.captured.p1.map((card) => card.id)).toEqual(expect.arrayContaining([
    'm09_kkeut', 'm09_pi_a',
  ]));
  expect(game.floor.map((card) => card.id)).toContain('m07_kkeut');
  expect(selectKkeutType(game, 'p1', 'kkeut').ok).toBe(true);
  expect(game.phase).toBe('round_end');
  expect(allCardIds(game)).toHaveLength(before.length);
  expect(new Set(allCardIds(game)).size).toBe(before.length);
});
