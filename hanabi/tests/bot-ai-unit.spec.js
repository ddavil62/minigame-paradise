/**
 * @fileoverview 마스킹 관측 기반 하나비 AI 의사결정 단위 테스트.
 */

import { test, expect } from 'playwright/test';
import { chooseBotAction } from '../bot.js';

/**
 * 테스트용 기본 관측을 만든다.
 * @param {object} [overrides] 덮어쓸 필드
 * @returns {object} 봇 관측
 */
function snapshot(overrides = {}) {
  return {
    you: 'p2',
    phase: 'playing',
    currentTurn: 'p2',
    tokens: { clue: 8, fuse: 3 },
    fireworks: { white: 0, red: 0, blue: 0, green: 0, yellow: 0 },
    discardPile: [],
    myHand: [
      { id: 'a', color: null, number: null, clues: [] },
      { id: 'b', color: null, number: null, clues: [] },
    ],
    opponentHand: [
      { id: 'o', color: 'red', number: 1, clues: [] },
    ],
    ...overrides,
  };
}

test('확정된 다음 숫자 카드를 우선 연주한다', () => {
  const input = snapshot({
    myHand: [{ id: 'a', color: null, number: null, clues: [
      { type: 'color', value: 'red' }, { type: 'number', value: 1 },
    ] }],
  });
  expect(chooseBotAction(input)).toEqual({ type: 'PLAY_CARD', handIndex: 0 });
});

test('즉시 연주 가능한 상대 카드에 유효한 단서를 준다', () => {
  expect(chooseBotAction(snapshot())).toEqual({
    type: 'GIVE_CLUE', clueType: 'number', value: 1,
  });
});

test('단서 토큰이 0이면 단서를 고르지 않는다', () => {
  const action = chooseBotAction(snapshot({ tokens: { clue: 0, fuse: 3 } }));
  expect(action?.type).not.toBe('GIVE_CLUE');
});

test('단서 토큰이 8이면 버리기를 고르지 않는다', () => {
  const action = chooseBotAction(snapshot({
    opponentHand: [{ id: 'o', color: 'blue', number: 4, clues: [] }],
  }));
  expect(action?.type).not.toBe('DISCARD_CARD');
});

test('이미 지난 확정 카드를 안전하게 버린다', () => {
  const input = snapshot({
    tokens: { clue: 7, fuse: 3 },
    fireworks: { white: 0, red: 2, blue: 0, green: 0, yellow: 0 },
    myHand: [{ id: 'a', color: null, number: null, clues: [
      { type: 'color', value: 'red' }, { type: 'number', value: 1 },
    ] }],
    opponentHand: [],
  });
  expect(chooseBotAction(input)).toEqual({ type: 'DISCARD_CARD', handIndex: 0 });
});

test('같은 관측은 같은 결과를 내고 입력을 변경하지 않는다', () => {
  const input = snapshot({ tokens: { clue: 6, fuse: 3 }, opponentHand: [] });
  const before = structuredClone(input);
  expect(chooseBotAction(input)).toEqual(chooseBotAction(input));
  expect(input).toEqual(before);
});

test('자기 패 정체가 노출된 입력은 거부한다', () => {
  const input = snapshot({
    myHand: [{ id: 'secret', color: 'red', number: 5, clues: [] }],
  });
  expect(chooseBotAction(input)).toBeNull();
});

test('빈 손패에서도 범위를 벗어난 행동을 만들지 않는다', () => {
  const input = snapshot({ myHand: [], opponentHand: [], tokens: { clue: 0, fuse: 3 } });
  expect(chooseBotAction(input)).toBeNull();
});
