/**
 * @fileoverview 리포트 #51의 쪽·뻑 풀이 액션 의미와 메시지 키 분리를 검증한다.
 */

import { test, expect } from '@playwright/test';
import { buildDeck } from '../cards.js';
import {
  bombSteps,
  bonusFlipSteps,
  goStop,
  playCardSteps,
} from '../game.js';

const BY_ID = Object.fromEntries(buildDeck().map((card) => [card.id, card]));

/** @returns {object} 규칙 단위 테스트용 최소 게임 상태 */
function makeGame() {
  return {
    deck: [], floor: [], hands: { p1: [], p2: [] }, captured: { p1: [], p2: [] },
    ppeokFlags: {}, ppeokCount: { p1: 0, p2: 0 }, pendingFloorChoice: null,
    pendingCaptureBatch: null, turn: 'p1', phase: 'awaiting_play',
    goCount: { p1: 0, p2: 0 }, shaking: { p1: false, p2: false },
    money: { p1: 10000, p2: 10000 }, perPoint: 100, roundWinner: null,
    stoppedBy: null, lastAction: null, roundResult: null,
    lastGoScore: { p1: null, p2: null }, kkeutAsSsangpi: { p1: false, p2: false },
    kkeutChoiceMade: { p1: false, p2: false }, pendingKkeutChoice: null,
    pendingSangtong: null, shakeAsked: { p1: false, p2: false },
    bombDeckCredit: { p1: 0, p2: 0 }, pendingBombFlips: { p1: 0, p2: 0 },
    bombResolvingPlayer: null, firstPpeokBy: null,
  };
}

test('#51 실제 쪽은 kind=jjok과 action.jjok을 함께 기록한다', () => {
  const game = makeGame();
  game.hands.p1 = [BY_ID.m01_gwang];
  game.floor = [BY_ID.m02_pi_a];
  game.deck = [BY_ID.m01_pi_a];
  game.captured.p2 = [BY_ID.m06_pi_a];
  const steps = playCardSteps(game, 'p1', 'm01_gwang');
  expect(steps.next().value.step).toBe('hand_played');
  expect(steps.next().value.step).toBe('deck_flipped');
  expect(game.lastAction).toMatchObject({ kind: 'jjok', messageKey: 'action.jjok' });
});

test('#51 뻑 풀이는 action.ppeokSweep을 유지하고 쪽 키를 재사용하지 않는다', () => {
  const game = makeGame();
  game.hands.p1 = [BY_ID.m01_gwang];
  game.floor = [BY_ID.m01_tti_hong, BY_ID.m01_pi_a, BY_ID.m01_pi_b];
  game.deck = [BY_ID.m02_pi_a];
  game.ppeokFlags = { 1: 'p2' };
  const steps = playCardSteps(game, 'p1', 'm01_gwang');
  expect(steps.next().value.step).toBe('hand_played');
  expect(game.lastAction).toMatchObject({
    kind: 'sweep_from_hand',
    messageKey: 'action.ppeokSweep',
  });
  expect(game.lastAction.messageKey).not.toBe('action.jjok');
});

test('#52 폭탄 4장과 통상 더미 매칭 2장은 마지막까지 pending인 단일 6장 batch다', () => {
  const game = makeGame();
  game.hands.p1 = [BY_ID.m01_gwang, BY_ID.m01_tti_hong, BY_ID.m01_pi_a];
  game.floor = [BY_ID.m01_pi_b, BY_ID.m02_pi_a];
  // pop 순서: 2월 매칭, 3월 놓기, 4월 놓기
  game.deck = [BY_ID.m04_pi_a, BY_ID.m03_pi_a, BY_ID.m02_tti_hong];
  const steps = bombSteps(game, 'p1', 1);

  expect(steps.next().value.step).toBe('bomb_played');
  expect(game.captured.p1).toHaveLength(0);
  expect(game.pendingCaptureBatch.cards).toHaveLength(4);
  expect(game.bombDeckCredit.p1).toBe(2);

  expect(steps.next().value.step).toBe('deck_flipped');
  expect(game.captured.p1).toHaveLength(0);
  expect(game.pendingCaptureBatch.cards).toHaveLength(6);

  expect(steps.next().value.step).toBe('bomb_bonus_flipped');
  expect(game.captured.p1).toHaveLength(0);
  expect(steps.next().value.step).toBe('bomb_bonus_flipped');
  expect(game.captured.p1).toHaveLength(0);
  expect(steps.next().value.step).toBe('turn_finished');

  expect(game.captured.p1).toHaveLength(6);
  expect(game.pendingCaptureBatch).toBeNull();
  const settlements = game.turnAction.steps.filter((step) => step.type === 'SETTLE_CAPTURE_BATCH');
  expect(settlements).toHaveLength(1);
  expect(settlements[0].moves).toHaveLength(6);
  expect(new Set(settlements[0].moves.map((move) => move.cardId)).size).toBe(6);
});

test('#52 매칭 없는 폭탄은 정확히 4장 단일 batch로 정산한다', () => {
  const game = makeGame();
  game.hands.p1 = [BY_ID.m01_gwang, BY_ID.m01_tti_hong, BY_ID.m01_pi_a];
  game.floor = [BY_ID.m01_pi_b];
  game.deck = [BY_ID.m04_pi_a, BY_ID.m03_pi_a, BY_ID.m02_pi_a];
  for (const result of bombSteps(game, 'p1', 1)) expect(result.error).toBeUndefined();
  const settlement = game.turnAction.steps.find((step) => step.type === 'SETTLE_CAPTURE_BATCH');
  expect(settlement.moves).toHaveLength(4);
  expect(game.captured.p1).toHaveLength(4);
});

test('#53 폭탄 권리가 있으면 손패 0장 GO와 다음 bonus flip을 허용하고 한 번만 소모한다', () => {
  const game = makeGame();
  game.phase = 'awaiting_go_stop';
  game.hands.p1 = [];
  game.hands.p2 = [];
  game.bombDeckCredit.p1 = 1;
  game.deck = [BY_ID.m03_pi_a];

  expect(goStop(game, 'p1', 'go')).toEqual({ ok: true });
  expect(game.turn).toBe('p1');
  expect(game.phase).toBe('awaiting_play');
  const first = [...bonusFlipSteps(game, 'p1')];
  expect(first.some((result) => result.error)).toBe(false);
  expect(game.bombDeckCredit.p1).toBe(0);

  game.phase = 'awaiting_play';
  game.turn = 'p1';
  game.deck = [BY_ID.m04_pi_a];
  const second = [...bonusFlipSteps(game, 'p1')];
  expect(second).toHaveLength(1);
  expect(second[0].error).toBeTruthy();
  expect(game.bombDeckCredit.p1).toBe(0);
});

test('#53 손패와 폭탄 권리가 모두 없으면 기존 GO 오류를 유지한다', () => {
  const game = makeGame();
  game.phase = 'awaiting_go_stop';
  game.hands.p1 = [];
  game.bombDeckCredit.p1 = 0;
  const result = goStop(game, 'p1', 'go');
  expect(result.ok).toBe(false);
  expect(result.error).toBeTruthy();
});
