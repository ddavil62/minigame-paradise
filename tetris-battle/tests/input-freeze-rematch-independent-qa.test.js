/**
 * @fileoverview 두 플레이어 관점의 프리즈 입력 분리와 반복 재대결 상태 복구를 독립 검증한다.
 */

import assert from 'node:assert/strict';
import { createInput, DAS_MS, ARR_MS } from '../public/js/input.js';
import { createItems } from '../public/js/items.js';

/** @param {number} ms 대기 시간 @returns {Promise<void>} */
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 독립 브라우저 탭 하나에 해당하는 입력·아이템 테스트 장치를 만든다.
 * @param {string} playerLabel 플레이어 식별자
 * @returns {object} 테스트 장치
 */
function createHarness(playerLabel) {
  const listeners = { keydown: new Set(), keyup: new Set() };
  globalThis.window = {
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    addEventListener(type, handler) { listeners[type]?.add(handler); },
    removeEventListener(type, handler) { listeners[type]?.delete(handler); },
  };

  const calls = {
    left: 0, right: 0, soft: 0, cw: 0, ccw: 0, drop: 0, hold: 0,
    itemCallbacks: [], sent: [], gameFrozen: [], feedback: [],
  };
  let items;
  const input = createInput({
    moveLeft: () => { calls.left++; },
    moveRight: () => { calls.right++; },
    softDrop: () => { calls.soft++; },
    rotateCW: () => { calls.cw++; },
    rotateCCW: () => { calls.ccw++; },
    hardDrop: () => { calls.drop++; },
    hold: () => { calls.hold++; },
    useItem: (slot) => {
      calls.itemCallbacks.push(slot);
      items.useItem(slot);
    },
  });
  items = createItems({
    input,
    game: {
      setFrozenByItem(value) { calls.gameFrozen.push(value); },
      clearBottomLines() {},
      receiveGarbageImmediate() {},
    },
    net: {
      sendItemUse(itemId, slotIndex) { calls.sent.push({ itemId, slotIndex }); },
    },
    ui: {
      renderItemSlots() {},
      setDarkOverlay() {},
      setFreezeFeedback(value) { calls.feedback.push(value); },
      flashShield() {},
      setStatus() {},
      shakeBoard() {},
    },
  });

  /** @param {'keydown'|'keyup'} type 이벤트 종류 @param {string} key 키 @param {boolean} [repeat=false] 반복 여부 */
  function fire(type, key, repeat = false) {
    const event = { key, repeat, prevented: false, preventDefault() { this.prevented = true; } };
    for (const handler of listeners[type]) handler(event);
    return event;
  }

  return { playerLabel, listeners, calls, input, items, fire };
}

/**
 * 한 플레이어가 프리즈 상태에서 종료한 뒤 다섯 번 재대결하는 흐름을 검증한다.
 * @param {string} playerLabel 플레이어 식별자
 * @returns {Promise<void>}
 */
async function verifyPlayerPerspective(playerLabel) {
  const h = createHarness(playerLabel);
  h.input.enable();

  // 프리즈 직전에 잡고 있던 DAS/ARR와 소프트 드롭은 즉시 폐기되어야 한다.
  h.fire('keydown', 'ArrowRight');
  h.fire('keydown', 'ArrowDown');
  assert.equal(h.calls.right, 1, `${playerLabel}: 최초 우측 이동`);
  assert.equal(h.input.isSoftDropHeld(), true, `${playerLabel}: 소프트 드롭 held`);
  h.items.applyEffect('freeze', 10_000);
  assert.equal(h.input.isSoftDropHeld(), false, `${playerLabel}: 프리즈가 held 해제`);
  await wait(DAS_MS + ARR_MS * 2 + 20);
  assert.equal(h.calls.right, 1, `${playerLabel}: 이전 DAS/ARR 타이머 비간섭`);

  const blockedBefore = [h.calls.left, h.calls.right, h.calls.cw, h.calls.ccw, h.calls.drop, h.calls.hold];
  for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', ' ', 'Spacebar', 'Space', 'Shift', 'Control']) {
    assert.equal(h.fire('keydown', key).prevented, true, `${playerLabel}: ${key} 차단`);
  }
  assert.deepEqual(
    [h.calls.left, h.calls.right, h.calls.cw, h.calls.ccw, h.calls.drop, h.calls.hold],
    blockedBefore,
    `${playerLabel}: 프리즈 중 블록 콜백 0회`,
  );

  // Z/X/C는 프리즈보다 먼저 분기되고 repeat 및 빈 슬롯 연타는 송신하지 않아야 한다.
  h.items.grantItem('dark', 0);
  h.items.grantItem('freeze', 1);
  h.items.grantItem('garbage_bomb', 2);
  for (const key of ['z', 'X', 'c']) {
    h.fire('keydown', key);
    h.fire('keydown', key, true);
    h.fire('keydown', key);
  }
  assert.deepEqual(h.calls.sent.map((entry) => entry.itemId), ['dark', 'freeze', 'garbage_bomb'], `${playerLabel}: Z/X/C 각 1회 송신`);

  // 슬롯 클릭 역시 프리즈 중 허용되며 같은 빈 슬롯의 연타는 한 번만 송신한다.
  h.items.grantItem('shield', 1);
  h.items.useItem(1);
  h.items.useItem(1);
  assert.equal(h.calls.sent.filter((entry) => entry.itemId === 'shield').length, 1, `${playerLabel}: 클릭 연타 중복 송신 없음`);

  for (let round = 1; round <= 5; round++) {
    h.input.disable();
    h.items.reset();
    h.input.enable();
    assert.equal(h.input.isFrozen(), false, `${playerLabel}: 재대결 ${round} 프리즈 해제`);
    assert.equal(h.listeners.keydown.size, 1, `${playerLabel}: 재대결 ${round} keydown 리스너 1개`);
    assert.equal(h.listeners.keyup.size, 1, `${playerLabel}: 재대결 ${round} keyup 리스너 1개`);
    const before = [h.calls.left, h.calls.cw, h.calls.ccw, h.calls.drop, h.calls.hold];
    for (const key of ['ArrowLeft', 'ArrowUp', 'Control', ' ', 'Shift']) h.fire('keydown', key);
    const after = [h.calls.left, h.calls.cw, h.calls.ccw, h.calls.drop, h.calls.hold];
    assert.deepEqual(after, before.map((value) => value + 1), `${playerLabel}: 재대결 ${round} 모든 블록키 1회 처리`);
    if (round < 5) h.items.applyEffect('freeze', 10_000);
  }

  // 취소된 타이머가 다음 라운드 상태를 뒤늦게 변경하면 안 된다.
  h.items.applyEffect('freeze', 20);
  h.items.reset();
  const frozenCalls = h.calls.gameFrozen.length;
  const feedbackCalls = h.calls.feedback.length;
  await wait(50);
  assert.equal(h.calls.gameFrozen.length, frozenCalls, `${playerLabel}: 이전 프리즈 게임 타이머 비간섭`);
  assert.equal(h.calls.feedback.length, feedbackCalls, `${playerLabel}: 이전 프리즈 UI 타이머 비간섭`);
  h.input.disable();
}

await verifyPlayerPerspective('P1');
await verifyPlayerPerspective('P2');
console.log('PASS independent QA: P1/P2 각각 5회 재대결 및 프리즈 입력 경계');
