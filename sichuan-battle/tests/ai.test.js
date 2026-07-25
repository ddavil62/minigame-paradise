/**
 * @fileoverview 사천성 보통 AI의 합법 후보, 템포와 7종 아이템 정책을 검증한다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoard } from '../lib/board.js';
import { chooseAiDelay, chooseAiItem, chooseLegalPair, enumerateLegalPairs, planAiDelay } from '../lib/ai.js';
import { createPrng } from '../lib/prng.js';
import { AiController } from '../bot.js';
import { findPath } from '../lib/pathfinder.js';

/** @param {object} board 보드 @param {object[]} [inventory=[]] 슬롯 @returns {object} 스냅샷 */
function snapshot(board, inventory = []) { return { me: { board, inventory, effects: [], shieldUntil: 0 }, opponent: { remaining: 30 } }; }

test('AI가 공개 보드에서 서버 경로 판정과 일치하는 합법 짝만 열거한다', () => {
  const board = createBoard(4242); const pairs = enumerateLegalPairs(board.tiles); assert.ok(pairs.length > 0);
  for (const pair of pairs) { assert.equal(pair.a.faceId, pair.b.faceId); assert.ok(findPath(board.tiles, pair.a.tileId, pair.b.tileId)); }
  const picked = chooseLegalPair(snapshot(board), () => 0.5); assert.ok(picked); assert.ok(pairs.some((pair) => pair.a.tileId === picked.a.tileId && pair.b.tileId === picked.b.tileId));
});

test('보통 난이도 지연은 종류별 범위에 있고 방해 중 더 느려진다', () => {
  const state = snapshot(createBoard(7)); assert.equal(chooseAiDelay('first', state, () => 0), 900); assert.equal(chooseAiDelay('first', state, () => 1), 1700); assert.equal(chooseAiDelay('pair', state, () => 0), 850); assert.equal(chooseAiDelay('pair', state, () => 1), 1550); assert.equal(chooseAiDelay('item', state, () => 0), 550); assert.equal(chooseAiDelay('item', state, () => 1), 1200);
  state.me.effects = [{ itemId: 'fog' }]; assert.equal(chooseAiDelay('pair', state, () => 0), 1200); assert.equal(chooseAiDelay('pair', state, () => 1), 2350);
});

test('숙고 18%·휴지 12%와 후보 풀 65%·35%가 시드 기반 허용 오차에 든다', () => {
  const state = snapshot(createBoard(77)); const delayRandom = createPrng(20260723); let thinking = 0; let resting = 0;
  for (let index = 0; index < 5000; index += 1) { const plan = planAiDelay('pair', state, delayRandom); thinking += Number(plan.thinking); resting += Number(plan.resting); }
  assert.ok(Math.abs(thinking / 5000 - 0.18) < 0.025); assert.ok(Math.abs(resting / 5000 - 0.12) < 0.025);
  const pairRandom = createPrng(424242); let top = 0; let all = 0; for (let index = 0; index < 2000; index += 1) { const pair = chooseLegalPair(state, pairRandom); if (pair.selectionPool === 'top') top += 1; else all += 1; }
  assert.ok(Math.abs(top / 2000 - 0.65) < 0.04); assert.ok(Math.abs(all / 2000 - 0.35) < 0.04);
});

test('AI 아이템 정책은 정화·방어와 6종 슬롯을 상황에 맞게 선택한다', () => {
  const board = createBoard(9); const all = ['lock', 'flip', 'fog', 'hint', 'cleanse', 'shield'].map((itemId, index) => ({ slotId: `s${index}`, itemId }));
  const state = snapshot(board, all); state.me.effects = [{ itemId: 'lock' }]; assert.equal(chooseAiItem(state, {}, () => 0).itemId, 'cleanse');
  state.me.effects = []; assert.equal(chooseAiItem(state, {}, () => 0).itemId, 'shield');
  state.me.shieldUntil = Date.now() + 10000; const selected = chooseAiItem(state, { actionOrdinal: 1 }, () => 0); assert.ok(all.some((slot) => slot.itemId === selected.itemId));
});

test('인벤토리 획득 snapshot은 일반 짝 타이머 대신 item 전용 지연을 예약한다', () => {
  let capturedDelay = null; const controller = new AiController({ url: 'ws://invalid', random: () => 0.5, setTimer: (_callback, delay) => { capturedDelay = delay; return 1; }, clearTimer: () => {} });
  controller.lastMatchId = 'm'; controller.snapshot = { matchId: 'm', phase: 'playing', startedAt: 0, me: { inventory: [{ slotId: 's1', itemId: 'shield' }], effects: [], board: { revision: 1, tiles: [] } } };
  controller.handleSnapshot(false); assert.equal(capturedDelay, 875);
});
