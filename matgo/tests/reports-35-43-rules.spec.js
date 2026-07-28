/**
 * @fileoverview 리포트 #39·#40의 선택 대기 및 턴 단위 원자 정산 규칙을 검증한다.
 */

import { test, expect } from '@playwright/test';
import { buildDeck } from '../cards.js';
import {
  chooseFloor,
  playCardSteps,
  snapshotForPlayer,
} from '../game.js';

const BY_ID = Object.fromEntries(buildDeck().map((card) => [card.id, card]));

/**
 * 결정적인 맞고 규칙 상태를 만든다.
 *
 * @param {object} config
 * @returns {object}
 */
function makeGame(config) {
  const cards = (ids) => ids.map((id) => BY_ID[id]);
  return {
    deck: cards(config.deck || []),
    floor: cards(config.floor || []),
    hands: { p1: cards(config.p1Hand || []), p2: cards(config.p2Hand || []) },
    captured: { p1: cards(config.p1Captured || []), p2: cards(config.p2Captured || []) },
    ppeokFlags: { ...(config.ppeokFlags || {}) },
    ppeokCount: { p1: 0, p2: 0 },
    pendingFloorChoice: null,
    pendingCaptureBatch: null,
    pendingChoiceSrcCardId: null,
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

/**
 * 모든 권위 zone과 임시 선택 컨텍스트의 카드 ID를 수집한다.
 *
 * @param {object} game
 * @returns {string[]}
 */
function allLogicalCardIds(game) {
  return [
    ...game.deck,
    ...game.floor,
    ...game.hands.p1,
    ...game.hands.p2,
    ...game.captured.p1,
    ...game.captured.p2,
    ...(game.pendingCaptureBatch?.cards || []),
    ...(game.pendingFloorChoice?.srcCard ? [game.pendingFloorChoice.srcCard] : []),
  ].map((card) => card.id);
}

test('#39 선택 전 손패 매칭 2장을 보류하고 선택 후 4장을 단일 배치로 정산한다', () => {
  const game = makeGame({
    p1Hand: ['m01_gwang'],
    floor: ['m01_tti_hong', 'm02_tti_hong', 'm02_pi_a'],
    deck: ['m02_kkeut_godori'],
  });
  const initialIds = allLogicalCardIds(game).sort();
  const steps = playCardSteps(game, 'p1', 'm01_gwang');

  expect(steps.next().value.step).toBe('hand_played');
  expect(steps.next().value.step).toBe('deck_flipped');
  expect(game.phase).toBe('awaiting_floor_choice');
  expect(game.captured.p1).toHaveLength(0);
  expect(game.pendingCaptureBatch.cards.map((card) => card.id).sort()).toEqual([
    'm01_gwang',
    'm01_tti_hong',
  ].sort());
  expect(game.turnAction.steps.filter((step) => step.type === 'SETTLE_CAPTURE_BATCH')).toHaveLength(0);

  const waitingSnapshot = snapshotForPlayer(game, 'p1');
  expect(waitingSnapshot.captured.p1).toHaveLength(0);
  expect(waitingSnapshot.pendingCaptureBatch.cards).toHaveLength(2);
  expect(waitingSnapshot.pendingChoiceSourceCard.id).toBe('m02_kkeut_godori');
  expect(allLogicalCardIds(game).sort()).toEqual(initialIds);

  expect(chooseFloor(game, 'p1', 'm02_tti_hong')).toEqual({ ok: true });
  const settleSteps = game.turnAction.steps.filter((step) => step.type === 'SETTLE_CAPTURE_BATCH');
  expect(settleSteps).toHaveLength(1);
  expect(settleSteps[0].moves.map((move) => move.cardId).sort()).toEqual([
    'm01_gwang',
    'm01_tti_hong',
    'm02_kkeut_godori',
    'm02_tti_hong',
  ].sort());
  expect(new Set(settleSteps[0].moves.map((move) => move.cardId)).size).toBe(4);
  expect(game.captured.p1).toHaveLength(4);
  expect(game.pendingCaptureBatch).toBeNull();
  expect(allLogicalCardIds(game).sort()).toEqual(initialIds);
});

test('#40 타인 뻑 회수 4장과 후속 더미 매칭 2장을 단일 배치로 정산한다', () => {
  const game = makeGame({
    p1Hand: ['m01_gwang'],
    floor: ['m01_tti_hong', 'm01_pi_a', 'm01_pi_b', 'm02_tti_hong'],
    deck: ['m02_kkeut_godori'],
    ppeokFlags: { 1: 'p2' },
  });
  const initialIds = allLogicalCardIds(game).sort();
  const steps = playCardSteps(game, 'p1', 'm01_gwang');

  expect(steps.next().value.step).toBe('hand_played');
  expect(game.captured.p1).toHaveLength(0);
  expect(game.pendingCaptureBatch.cards).toHaveLength(4);
  expect(game.turnAction.steps.filter((step) => step.type === 'SETTLE_CAPTURE_BATCH')).toHaveLength(0);
  expect(allLogicalCardIds(game).sort()).toEqual(initialIds);

  expect(steps.next().value.step).toBe('deck_flipped');
  const settleSteps = game.turnAction.steps.filter((step) => step.type === 'SETTLE_CAPTURE_BATCH');
  expect(settleSteps).toHaveLength(1);
  expect(settleSteps[0].moves).toHaveLength(6);
  expect(new Set(settleSteps[0].moves.map((move) => move.cardId)).size).toBe(6);
  expect(game.captured.p1.map((card) => card.id).sort()).toEqual(initialIds);
  expect(game.pendingCaptureBatch).toBeNull();
  expect(allLogicalCardIds(game).sort()).toEqual(initialIds);
});
