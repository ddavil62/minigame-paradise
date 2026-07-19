/**
 * @fileoverview 프리즈 중 아이템 입력과 반복 재대결 입력 초기화를 검증한다.
 */

import assert from 'node:assert/strict';
import { createInput, DAS_MS, ARR_MS } from '../public/js/input.js';
import { createItems } from '../public/js/items.js';

/** 지정 시간만큼 비동기로 기다린다. @param {number} ms @returns {Promise<void>} */
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 브라우저 window 이벤트와 게임 의존성을 최소 구현한 테스트 환경을 만든다.
 * @returns {object} 테스트 하네스
 */
function createHarness() {
  const listeners = { keydown: new Set(), keyup: new Set() };
  const fakeWindow = {
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    addEventListener(type, handler) { listeners[type]?.add(handler); },
    removeEventListener(type, handler) { listeners[type]?.delete(handler); },
  };
  globalThis.window = fakeWindow;

  const calls = {
    left: 0, right: 0, rotateCW: 0, rotateCCW: 0, hardDrop: 0, hold: 0,
    itemUses: [], sent: [], gameFrozen: [], freezeFeedback: [], slotRenders: 0,
  };
  let items;
  const input = createInput({
    moveLeft: () => { calls.left++; },
    moveRight: () => { calls.right++; },
    softDrop: () => {},
    rotateCW: () => { calls.rotateCW++; },
    rotateCCW: () => { calls.rotateCCW++; },
    hardDrop: () => { calls.hardDrop++; },
    hold: () => { calls.hold++; },
    useItem: (slot) => {
      calls.itemUses.push(slot);
      items.useItem(slot);
    },
  });
  const game = {
    setFrozenByItem(value) { calls.gameFrozen.push(value); },
    clearBottomLines() {},
    receiveGarbageImmediate() {},
  };
  const ui = {
    renderItemSlots() { calls.slotRenders++; },
    setDarkOverlay() {},
    setFreezeFeedback(value) { calls.freezeFeedback.push(value); },
    flashShield() {},
    setStatus() {},
    shakeBoard() {},
  };
  const net = {
    sendItemUse(itemId, slotIndex) { calls.sent.push({ itemId, slotIndex }); },
  };
  items = createItems({ game, input, ui, net });

  /**
   * 등록된 키 이벤트를 발생시킨다.
   * @param {'keydown'|'keyup'} type 이벤트 종류
   * @param {string} key 키 값
   * @param {boolean} [repeat=false] OS 반복 여부
   * @returns {{defaultPrevented: boolean}}
   */
  function fire(type, key, repeat = false) {
    const event = {
      key,
      repeat,
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
    };
    for (const handler of listeners[type]) handler(event);
    return event;
  }

  return { calls, input, items, listeners, fire };
}

/** 테스트 케이스를 실행하고 결과를 표시한다. @param {string} name @param {() => (void|Promise<void>)} test */
async function run(name, test) {
  try {
    await test();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

await run('정상 상태의 이동·회전·드롭·홀드 입력 유지', () => {
  const h = createHarness();
  h.input.enable();
  h.fire('keydown', 'ArrowLeft');
  h.fire('keyup', 'ArrowLeft');
  h.fire('keydown', 'ArrowUp');
  h.fire('keydown', 'Control');
  h.fire('keydown', ' ');
  h.fire('keydown', 'Shift');
  h.fire('keydown', 'ArrowDown');
  assert.equal(h.input.isSoftDropHeld(), true);
  h.fire('keyup', 'ArrowDown');
  assert.deepEqual(
    [h.calls.left, h.calls.rotateCW, h.calls.rotateCCW, h.calls.hardDrop, h.calls.hold],
    [1, 1, 1, 1, 1],
  );
  h.input.disable();
});

await run('프리즈 중 블록 조작은 모두 차단', () => {
  const h = createHarness();
  h.input.enable();
  h.input.setFrozen(true);
  for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', ' ', 'Spacebar', 'Shift', 'Control']) {
    assert.equal(h.fire('keydown', key).defaultPrevented, true);
  }
  assert.deepEqual(
    [h.calls.left, h.calls.right, h.calls.rotateCW, h.calls.rotateCCW, h.calls.hardDrop, h.calls.hold],
    [0, 0, 0, 0, 0, 0],
  );
  assert.equal(h.input.isSoftDropHeld(), false);
  h.input.disable();
});

await run('프리즈 중 Z/X/C 아이템은 각 1회 사용되고 repeat는 무시', () => {
  const h = createHarness();
  h.items.grantItem('dark', 0);
  h.items.grantItem('freeze', 1);
  h.items.grantItem('garbage_bomb', 2);
  h.input.enable();
  h.input.setFrozen(true);
  for (const key of ['z', 'X', 'c']) {
    assert.equal(h.fire('keydown', key).defaultPrevented, true);
    h.fire('keydown', key, true);
  }
  assert.deepEqual(h.calls.itemUses, [0, 1, 2]);
  assert.deepEqual(h.calls.sent.map(({ itemId }) => itemId), ['dark', 'freeze', 'garbage_bomb']);
  assert.deepEqual(h.items.getSlots(), [null, null, null]);
  h.input.disable();
});

await run('프리즈 중 슬롯 클릭도 아이템을 1회만 사용', () => {
  const h = createHarness();
  h.items.grantItem('shield', 1);
  h.input.setFrozen(true);
  h.items.useItem(1);
  h.items.useItem(1);
  assert.deepEqual(h.calls.sent, [{ itemId: 'shield', slotIndex: 1 }]);
  assert.equal(h.items.isShieldActive(), true);
  h.items.reset();
});

await run(`프리즈 적용 시 진행 중 DAS(${DAS_MS}ms)/ARR(${ARR_MS}ms)와 소프트 드롭 정리`, async () => {
  const h = createHarness();
  h.input.enable();
  h.fire('keydown', 'ArrowRight');
  h.fire('keydown', 'ArrowDown');
  assert.equal(h.calls.right, 1);
  assert.equal(h.input.isSoftDropHeld(), true);
  h.input.setFrozen(true);
  assert.equal(h.input.isSoftDropHeld(), false);
  await wait(DAS_MS + ARR_MS * 2 + 25);
  assert.equal(h.calls.right, 1, '기존 DAS/ARR 타이머가 재이동시키지 않아야 한다');
  h.input.setFrozen(false);
  await wait(ARR_MS * 2 + 10);
  assert.equal(h.calls.right, 1, '키를 새로 누르기 전 자동 재활성화되면 안 된다');
  h.input.disable();
});

await run('종료·시작 초기화를 5회 반복해도 입력 잠금과 리스너 중복 없음', () => {
  const h = createHarness();
  for (let round = 0; round < 5; round++) {
    h.input.enable();
    h.items.applyEffect('freeze', 10_000);
    assert.equal(h.input.isFrozen(), true);

    // 실제 main.js 경계와 같은 종료 후 시작 순서를 반복한다.
    h.input.disable();
    h.items.reset();
    h.items.reset();
    h.input.enable();

    assert.equal(h.input.isFrozen(), false);
    assert.equal(h.calls.gameFrozen.at(-1), false);
    assert.equal(h.calls.freezeFeedback.at(-1), false);
    assert.equal(h.listeners.keydown.size, 1);
    assert.equal(h.listeners.keyup.size, 1);

    const before = h.calls.rotateCW;
    h.fire('keydown', 'ArrowUp');
    assert.equal(h.calls.rotateCW, before + 1, `재대결 ${round + 1}회 입력은 정확히 1회 처리`);
  }
  h.input.disable();
});

await run('취소한 이전 프리즈 타이머가 다음 라운드 상태를 바꾸지 않음', async () => {
  const h = createHarness();
  h.items.applyEffect('freeze', 25);
  h.items.reset();
  const gameCallCount = h.calls.gameFrozen.length;
  const feedbackCallCount = h.calls.freezeFeedback.length;
  await wait(60);
  assert.equal(h.input.isFrozen(), false);
  assert.equal(h.calls.gameFrozen.length, gameCallCount);
  assert.equal(h.calls.freezeFeedback.length, feedbackCallCount);
});

console.log('input-freeze-rematch: all tests passed');
