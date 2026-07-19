/**
 * @fileoverview 베네치아 급류 낙하 시계와 정답·만료 피해 규칙 단위 테스트.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  expireWords,
  materializeFallClock,
  setFallSpeed,
  submitWord,
  applyItemEffect,
  WORD_LIFETIME_MS,
  WORD_CLEAR_DAMAGE,
  WORD_MISS_DAMAGE,
  applyDamage,
  checkGameOver,
} from '../venezia/game.js';
import { getItemSlotIndex } from '../venezia/public/js/item-controls.js';

/**
 * 테스트용 키 이벤트 객체를 만든다.
 * @param {object} overrides 덮어쓸 속성
 * @returns {object} 키 이벤트 유사 객체
 */
function keyEvent(overrides = {}) {
  return {
    code: '', key: '', keyCode: 0, isComposing: false,
    altKey: false, ctrlKey: false, metaKey: false, shiftKey: false,
    target: null,
    ...overrides,
  };
}

test('Digit/Numpad 1·2·3만 슬롯으로 매핑한다', () => {
  assert.equal(getItemSlotIndex(keyEvent({ code: 'Digit1', key: '1' })), 0);
  assert.equal(getItemSlotIndex(keyEvent({ code: 'Numpad2', key: '2' })), 1);
  assert.equal(getItemSlotIndex(keyEvent({ code: 'Digit3', key: '3' })), 2);
  assert.equal(getItemSlotIndex(keyEvent({ code: '', key: '2' })), 1);
});

test('수정키·IME·일반 편집 요소에서는 슬롯을 사용하지 않는다', () => {
  assert.equal(getItemSlotIndex(keyEvent({ code: 'Digit1', key: '1', altKey: true })), null);
  assert.equal(getItemSlotIndex(keyEvent({ code: 'Digit1', key: '1', shiftKey: true })), null);
  assert.equal(getItemSlotIndex(keyEvent({ code: 'Digit1', key: 'Process' })), null);
  assert.equal(getItemSlotIndex(keyEvent({ code: 'Digit1', key: '1', keyCode: 229 })), null);
  const target = { id: 'input-name', closest: () => ({}) };
  assert.equal(getItemSlotIndex(keyEvent({ code: 'Digit1', key: '1', target })), null);
  const wordInput = { id: 'input-word', closest: () => ({}) };
  assert.equal(getItemSlotIndex(keyEvent({ code: 'Digit1', key: '1', target: wordInput })), 0);
});

test('낙하 배율 변경 전 진행량을 확정해 위치 점프 없이 이어간다', () => {
  const game = createGame();
  const player = game.players.p1;
  assert.equal(materializeFallClock(player, 2000), 2000);
  assert.equal(setFallSpeed(game, 'p1', 2, 3000), 3000);
  assert.equal(materializeFallClock(player, 5000), 7000);
  assert.equal(setFallSpeed(game, 'p1', 1, 5000), 7000);
  assert.equal(materializeFallClock(player, 6000), 8000);
});

test('기존 단어와 급류 중 신규 단어가 같은 누적 시계에서 만료된다', () => {
  const game = createGame();
  game.words.old = { id: 'old', text: '기존', ownerId: 'p1', spawnedAt: 0, spawnedAtFallClock: 0 };
  setFallSpeed(game, 'p1', 2, 2000);
  game.words.new = { id: 'new', text: '신규', ownerId: 'p1', spawnedAt: 2000, spawnedAtFallClock: 2000 };
  assert.deepEqual(expireWords(game, 4900), []);
  const firstExpired = expireWords(game, 5000);
  assert.deepEqual(firstExpired.map((word) => word.id), ['old']);
  assert.equal(materializeFallClock(game.players.p1, 6000) - game.words.new.spawnedAtFallClock, WORD_LIFETIME_MS);
  assert.deepEqual(expireWords(game, 6000).map((word) => word.id), ['new']);
});

test('일반 정답은 상대 HP를 정확히 2 감소시키고 공격 정보를 반환한다', () => {
  const game = createGame();
  game.words.w1 = { id: 'w1', text: '달빛', ownerId: 'p1', difficulty: 'hard', spawnedAt: 0, spawnedAtFallClock: 0 };
  const result = submitWord(game, 'p1', 'w1', '달빛');
  assert.equal(result.ok, true);
  assert.equal(game.players.p2.hp, 98);
  assert.equal(game.players.p1.combo, 1);
  assert.equal(result.damage, WORD_CLEAR_DAMAGE);
  assert.equal(result.targetId, 'p2');
});

test('만료 단어는 소유자에게 개당 2 피해를 주고 HP 0에서 종료한다', () => {
  const game = createGame();
  game.players.p1.hp = 3;
  game.words.a = { id: 'a', text: '하나', ownerId: 'p1', spawnedAt: 0, spawnedAtFallClock: 0 };
  game.words.b = { id: 'b', text: '둘', ownerId: 'p1', spawnedAt: 0, spawnedAtFallClock: 0 };
  const expired = expireWords(game, WORD_LIFETIME_MS);
  assert.deepEqual(expired.map((word) => word.id), ['a', 'b']);
  assert.equal(applyDamage(game, 'p1', expired.length * WORD_MISS_DAMAGE), 3);
  assert.equal(game.players.p1.hp, 0);
  assert.deepEqual(checkGameOver(game), { ended: true, winner: 'p2', reason: 'hp_zero' });
});

test('방어막은 급류를 한 번 차단하고 낙하 배율을 바꾸지 않는다', () => {
  const game = createGame();
  game.players.p1.itemSlots.push({ itemId: 'item_freeze', emoji: '🌊', name: '급류' });
  game.players.p2.shield = true;
  const result = applyItemEffect(game, 'p1', 0);
  assert.equal(result.ok, true);
  assert.equal(result.blocked, true);
  assert.equal(game.players.p2.shield, false);
  assert.equal(game.players.p2.fallSpeedMultiplier, 1);
});
