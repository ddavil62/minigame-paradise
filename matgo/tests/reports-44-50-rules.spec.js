/**
 * @fileoverview 리포트 #45 폭탄 원자 정산과 #49 손 조커 보충 공개 순서를 검증한다.
 */

import { test, expect } from '@playwright/test';
import { buildDeck } from '../cards.js';
import { bombSteps, playCardSteps, snapshotForPlayer } from '../game.js';

const BY_ID = Object.fromEntries(buildDeck().map((card) => [card.id, card]));

/** @returns {object} 규칙 검증용 최소 게임 상태를 만든다. */
function makeGame() {
  return {
    deck: [],
    floor: [],
    hands: { p1: [], p2: [] },
    captured: { p1: [], p2: [] },
    ppeokFlags: {},
    ppeokCount: { p1: 0, p2: 0 },
    pendingFloorChoice: null,
    pendingCaptureBatch: null,
    turn: 'p1',
    phase: 'awaiting_play',
    goCount: { p1: 0, p2: 0 },
    shaking: { p1: false, p2: false },
    money: { p1: 10000, p2: 10000 },
    perPoint: 100,
    roundWinner: null,
    stoppedBy: null,
    lastAction: null,
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

test('#45 폭탄 네 장은 더미 처리 전 staging이고 최종 단일 batch로 정산된다', () => {
  const game = makeGame();
  game.hands.p1 = [BY_ID.m01_gwang, BY_ID.m01_tti_hong, BY_ID.m01_pi_a];
  game.floor = [BY_ID.m01_pi_b, BY_ID.m02_pi_a];
  game.deck = [BY_ID.m05_pi_a, BY_ID.m04_pi_a, BY_ID.m03_pi_a];
  const steps = bombSteps(game, 'p1', 1);

  expect(steps.next().value.step).toBe('bomb_played');
  expect(game.captured.p1).toHaveLength(0);
  expect(game.pendingCaptureBatch.cards.map((card) => card.id)).toHaveLength(4);

  for (let next = steps.next(); !next.done; next = steps.next()) {
    expect(next.value.error).toBeUndefined();
  }
  const settlements = game.turnAction.steps.filter((step) => step.type === 'SETTLE_CAPTURE_BATCH');
  expect(settlements).toHaveLength(1);
  const bombIds = new Set(['m01_gwang', 'm01_tti_hong', 'm01_pi_a', 'm01_pi_b']);
  expect(settlements[0].moves.filter((move) => bombIds.has(move.cardId))).toHaveLength(4);
  expect(new Set(settlements[0].moves.map((move) => move.cardId)).size)
    .toBe(settlements[0].moves.length);
});

test('#49 손 조커는 정산 STATE 뒤 별도 REFILL_HAND 단계에서 더미 카드를 공개한다', () => {
  const game = makeGame();
  game.hands.p1 = [BY_ID.m00_joker_a];
  game.captured.p2 = [BY_ID.m06_pi_a];
  game.deck = [BY_ID.m08_pi_a];
  const steps = playCardSteps(game, 'p1', 'm00_joker_a');

  expect(steps.next().value.step).toBe('hand_played');
  expect(game.hands.p1).toHaveLength(0);
  expect(game.captured.p1.map((card) => card.id)).toEqual(
    expect.arrayContaining(['m00_joker_a', 'm06_pi_a']),
  );
  expect(game.turnAction.steps.some((step) => step.type === 'REFILL_HAND')).toBe(false);

  expect(steps.next().value.step).toBe('deck_flipped');
  expect(game.hands.p1.map((card) => card.id)).toEqual(['m08_pi_a']);
  const refill = game.turnAction.steps.find((step) => step.type === 'REFILL_HAND');
  expect(refill.moves).toContainEqual(expect.objectContaining({
    cardId: 'm08_pi_a',
    sourceZone: 'deck',
    destinationZone: 'hand',
    actor: 'p1',
    ownerAfter: 'p1',
  }));
  const snapshot = snapshotForPlayer(game, 'p1');
  expect(snapshot.lastAction.refilled.id).toBe('m08_pi_a');
});

test('#46 쪽은 뻑 풀이 메시지 키를 구조화한다', () => {
  const game = makeGame();
  game.hands.p1 = [BY_ID.m01_gwang];
  game.floor = [BY_ID.m02_pi_a];
  game.deck = [BY_ID.m01_pi_a];
  game.captured.p2 = [BY_ID.m06_pi_a];
  const steps = playCardSteps(game, 'p1', 'm01_gwang');
  expect(steps.next().value.step).toBe('hand_played');
  expect(steps.next().value.step).toBe('deck_flipped');
  expect(game.lastAction).toMatchObject({
    kind: 'jjok',
    messageKey: 'action.jjok',
  });
});

test('#50 타인 뻑 6장과 강탈 피 1장을 정확히 하나의 7장 batch로 정산한다', () => {
  const game = makeGame();
  game.hands.p1 = [BY_ID.m01_gwang];
  game.floor = [BY_ID.m01_tti_hong, BY_ID.m01_pi_a, BY_ID.m01_pi_b, BY_ID.m02_tti_hong];
  game.deck = [BY_ID.m02_kkeut_godori];
  game.captured.p2 = [BY_ID.m06_pi_a];
  game.ppeokFlags = { 1: 'p2' };
  const steps = playCardSteps(game, 'p1', 'm01_gwang');

  expect(steps.next().value.step).toBe('hand_played');
  expect(game.captured.p1).toHaveLength(0);
  expect(game.pendingCaptureBatch.cards).toHaveLength(5);

  expect(steps.next().value.step).toBe('deck_flipped');
  const settlements = game.turnAction.steps.filter((step) => step.type === 'SETTLE_CAPTURE_BATCH');
  expect(settlements).toHaveLength(1);
  expect(settlements[0].moves).toHaveLength(7);
  expect(new Set(settlements[0].moves.map((move) => move.cardId)).size).toBe(7);
  expect(settlements[0].moves.find((move) => move.cardId === 'm06_pi_a')).toMatchObject({
    sourceZone: 'captured',
    destinationZone: 'captured',
    ownerBefore: 'p2',
    ownerAfter: 'p1',
  });
});
