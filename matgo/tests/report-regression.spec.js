/**
 * @fileoverview 2026-07-27 사용자 리포트의 맞고 규칙 회귀 테스트.
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import {
  bomb,
  chooseFloor,
  nextRoundStarter,
  playCard,
} from '../game.js';
import { buildDeck } from '../cards.js';
import { applyFinalMultipliers } from '../score.js';

const BY_ID = Object.fromEntries(buildDeck().map((card) => [card.id, card]));

/**
 * 카드 ID를 실제 카드 객체로 변환한다.
 *
 * @param {string} id
 * @returns {object}
 */
function card(id) {
  if (!BY_ID[id]) throw new Error(`알 수 없는 카드: ${id}`);
  return BY_ID[id];
}

/**
 * 결정적인 규칙 테스트용 게임 상태를 만든다.
 *
 * @param {object} config
 * @returns {object}
 */
function makeGame({
  p1Hand = [],
  p2Hand = ['m12_gwang_bigwang'],
  floor = [],
  deck = [],
} = {}) {
  return {
    deck: deck.map(card),
    floor: floor.map(card),
    hands: { p1: p1Hand.map(card), p2: p2Hand.map(card) },
    captured: { p1: [], p2: [] },
    ppeokFlags: {},
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
    ppeokCount: { p1: 0, p2: 0 },
    firstPpeokBy: null,
  };
}

test('R2/R19: 일반 피가 없으면 쌍피와 조커도 카드 단위 강탈 대상이다', () => {
  const ssangpiGame = makeGame({ p1Hand: ['m00_joker_a'], deck: ['m08_gwang'] });
  ssangpiGame.captured.p2 = [card('m11_pi_ssangpi')];
  expect(playCard(ssangpiGame, 'p1', 'm00_joker_a').ok).toBe(true);
  expect(ssangpiGame.captured.p1.some((c) => c.id === 'm11_pi_ssangpi')).toBe(true);

  const jokerGame = makeGame({ p1Hand: ['m02_pi_a'], floor: [], deck: ['m02_pi_b'] });
  jokerGame.captured.p2 = [card('m00_joker_b')];
  expect(playCard(jokerGame, 'p1', 'm02_pi_a').ok).toBe(true);
  expect(jokerGame.captured.p1.some((c) => c.id === 'm00_joker_b')).toBe(true);
  expect(jokerGame.captured.p2.some((c) => c.id === 'm00_joker_b')).toBe(false);
});

test('R3: 덱 조커는 손이 아니라 captured로 가고 즉시 한 장을 더 뒤집는다', () => {
  const game = makeGame({
    p1Hand: ['m01_gwang', 'm10_kkeut'],
    floor: ['m01_pi_a'],
    deck: ['m08_gwang', 'm00_joker_a'],
  });
  game.captured.p2 = [card('m06_pi_a')];

  expect(playCard(game, 'p1', 'm01_gwang').ok).toBe(true);
  expect(game.hands.p1.some((c) => c.type === 'joker')).toBe(false);
  expect(game.captured.p1.some((c) => c.id === 'm00_joker_a')).toBe(true);
  expect(game.captured.p1.some((c) => c.id === 'm06_pi_a')).toBe(true);
  expect(game.floor.some((c) => c.id === 'm08_gwang')).toBe(true);
  expect(game.lastAction.stoleFromOpp).toBe(1);
  expect(game.lastAction.jokerFlips.map((c) => c.id)).toContain('m00_joker_a');
});

test('R4: 손 조커는 중간 점수·9월 선택을 평가하지 않고 같은 플레이어 입력을 유지한다', () => {
  const game = makeGame({ p1Hand: ['m00_joker_a', 'm02_kkeut_godori'], deck: ['m03_pi_a'] });
  game.captured.p1 = [
    card('m01_gwang'), card('m03_gwang'), card('m08_gwang'),
    card('m01_tti_hong'), card('m02_tti_hong'), card('m03_tti_hong'),
    card('m09_kkeut'),
  ];

  expect(playCard(game, 'p1', 'm00_joker_a').ok).toBe(true);
  expect(game.turn).toBe('p1');
  expect(game.phase).toBe('awaiting_play');
  expect(game.pendingKkeutChoice).toBeNull();
});

test('R17: 폭탄은 통상 뒤집기 뒤 추가 두 장을 같은 턴에 즉시 해결한다', () => {
  const game = makeGame({
    p1Hand: ['m01_gwang', 'm01_tti_hong', 'm01_pi_a'],
    floor: ['m01_pi_b'],
    deck: ['m07_kkeut', 'm06_kkeut', 'm05_kkeut'],
  });

  expect(bomb(game, 'p1', 1).ok).toBe(true);
  expect(game.deck).toHaveLength(0);
  expect(game.pendingBombFlips.p1).toBe(0);
  expect(game.bombDeckCredit.p1).toBe(0);
  expect(game.bombResolvingPlayer).toBeNull();
});

test('R17: 폭탄 추가 뒤집기 중 선택 대기 후에도 남은 권리와 턴을 이어간다', () => {
  const game = makeGame({
    p1Hand: ['m01_gwang', 'm01_tti_hong', 'm01_pi_a', 'm02_kkeut_godori'],
    floor: ['m01_pi_b', 'm05_tti_cho', 'm05_pi_a'],
    deck: ['m07_kkeut', 'm05_kkeut', 'm06_kkeut'],
  });

  expect(bomb(game, 'p1', 1).ok).toBe(true);
  expect(game.phase).toBe('awaiting_floor_choice');
  expect(game.turn).toBe('p1');
  expect(game.pendingBombFlips.p1).toBe(1);

  expect(chooseFloor(game, 'p1', 'm05_tti_cho').ok).toBe(true);
  expect(game.pendingBombFlips.p1).toBe(0);
  expect(game.bombResolvingPlayer).toBeNull();
  expect(game.deck).toHaveLength(0);
});

test('R18: 다음 라운드 선공자는 직전 승자다', () => {
  expect(nextRoundStarter({ roundWinner: 'p2' })).toBe('p2');
  expect(nextRoundStarter({ roundWinner: 'p1' })).toBe('p1');
  expect(nextRoundStarter({ roundWinner: null })).toBe('p1');
});

test('R20: 승자 끗 7장 이상이면 패자 끗 수와 무관하게 멍박이 적용된다', () => {
  const winner = { score: 7, gwang: 0, kkeut: 7, piCount: 10 };
  const loser = { score: 0, gwang: 1, kkeut: 7, piCount: 10 };
  const result = applyFinalMultipliers(winner, loser, {});

  expect(result.multiplier).toBe(2);
  expect(result.reasons).toContain('멍박 ×2');
});

test('R16/R24: 강탈은 실제 카드 좌표에서 출발하고 효과는 포획 정리 뒤 전면 표시된다', () => {
  const clientSource = readFileSync(new URL('../public/client.js', import.meta.url), 'utf8');
  const styleSource = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');

  expect(clientSource).toContain('prevCapturedRects.get(id)');
  expect(clientSource).toContain('sourceCardRect.left');
  expect(clientSource.indexOf('e.clone.remove();')).toBeLessThan(
    clientSource.lastIndexOf('maybeShowActionToast(pendingCaptureToast);'),
  );
  expect(styleSource).toMatch(/\.action-toast\s*\{[\s\S]*?z-index:\s*10001;/);
});
