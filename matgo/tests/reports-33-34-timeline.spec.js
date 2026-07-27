/**
 * @fileoverview 리포트 33·34의 조커 연속 뒤집기와 따닥 정산 타임라인 회귀 테스트.
 */

import { test, expect } from '@playwright/test';
import { buildDeck } from '../cards.js';
import { playCard, chooseFloor, snapshotForPlayer } from '../game.js';

const BY_ID = Object.fromEntries(buildDeck().map((card) => [card.id, card]));

/**
 * 결정적 규칙 상태를 생성한다.
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
    captured: { p1: [], p2: cards(config.p2Captured || []) },
    ppeokFlags: {},
    ppeokCount: { p1: 0, p2: 0 },
    pendingFloorChoice: null,
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

test('#33 덱 조커는 스테이징 뒤 추가 뒤집기를 기록하고 여섯 장을 한 배치로 정산한다', () => {
  const game = makeGame({
    p1Hand: ['m01_gwang', 'm07_pi_a'],
    p2Hand: ['m08_pi_a'],
    floor: ['m01_tti_hong', 'm02_tti_hong'],
    // top은 배열 끝: 조커 공개 뒤 2월 카드가 추가로 뒤집힌다.
    deck: ['m02_kkeut_godori', 'm00_joker_a'],
    p2Captured: ['m06_pi_a'],
  });

  expect(playCard(game, 'p1', 'm01_gwang')).toEqual({ ok: true });
  expect(game.captured.p1.map((card) => card.id).sort()).toEqual([
    'm00_joker_a',
    'm01_gwang',
    'm01_tti_hong',
    'm02_kkeut_godori',
    'm02_tti_hong',
    'm06_pi_a',
  ].sort());

  const snapshot = snapshotForPlayer(game, 'p1');
  expect(snapshot.turnAction.steps.map((step) => step.type)).toEqual([
    'PLAY_MATCH',
    'STAGE_DRAWN_JOKER',
    'DRAW_MATCH',
    'SETTLE_CAPTURE_BATCH',
  ]);
  const settle = snapshot.turnAction.steps.at(-1);
  expect(settle.capturedCards.map((card) => card.id).sort()).toEqual([
    'm01_gwang',
    'm01_tti_hong',
    'm02_kkeut_godori',
    'm02_tti_hong',
  ].sort());
  expect(settle.stagedJokers.map((card) => card.id)).toEqual(['m00_joker_a']);
  expect(settle.stolenCards.map((card) => card.id)).toEqual(['m06_pi_a']);
  expect(new Set(game.captured.p1.map((card) => card.id)).size).toBe(6);
});

test('#34 따닥 네 장과 강탈 피는 동일 정산 배치에 포함된다', () => {
  const game = makeGame({
    p1Hand: ['m01_gwang', 'm07_pi_a'],
    p2Hand: ['m08_pi_a'],
    floor: ['m01_tti_hong', 'm01_pi_a'],
    deck: ['m01_pi_b'],
    p2Captured: ['m06_pi_a'],
  });

  expect(playCard(game, 'p1', 'm01_gwang')).toEqual({ ok: true });
  expect(game.phase).toBe('awaiting_floor_choice');
  expect(chooseFloor(game, 'p1', 'm01_tti_hong')).toEqual({ ok: true });
  expect(game.lastAction.kind).toBe('ttadak');

  const settle = game.turnAction.steps.at(-1);
  expect(settle.type).toBe('SETTLE_CAPTURE_BATCH');
  expect(settle.reason).toBe('ttadak');
  expect(settle.capturedCards.map((card) => card.id).sort()).toEqual([
    'm01_gwang',
    'm01_pi_a',
    'm01_pi_b',
    'm01_tti_hong',
  ].sort());
  expect(settle.stolenCards.map((card) => card.id)).toEqual(['m06_pi_a']);
  expect(settle.batchId).toBe(`${game.turnAction.turnId}:settle`);
});
