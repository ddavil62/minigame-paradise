/**
 * @fileoverview 운영형 슬롯과 실제 WebSocket을 사용해 힌트·뒤집기·슬롯 정산 회귀를 검증한다.
 */
import { test, expect } from '@playwright/test';

const BASE = process.env.QA_BASE_URL || 'http://127.0.0.1:3028';

/**
 * 실제 WebSocket 전송은 유지하면서 수신 순서·유실만 제어하는 브라우저 계층을 설치한다.
 * @param {import('@playwright/test').BrowserContext} context 브라우저 컨텍스트
 * @returns {Promise<void>}
 */
async function installSocketControl(context) {
  await context.addInitScript(() => {
    const NativeSocket = window.WebSocket;
    let mode = 'normal';
    class ControlledSocket extends EventTarget {
      constructor(url, protocols) {
        super();
        this.native = protocols === undefined ? new NativeSocket(url) : new NativeSocket(url, protocols);
        this.bufferedResolved = null;
        this.useSent = false;
        for (const eventName of ['open', 'close', 'error']) {
          this.native.addEventListener(eventName, () => this.dispatchEvent(new Event(eventName)));
        }
        this.native.addEventListener('message', (event) => {
          let message = null;
          try { message = JSON.parse(event.data); } catch {}
          if (!this.useSent || !message) {
            this.dispatchEvent(new MessageEvent('message', { data: event.data }));
            return;
          }
          if (mode === 'sync-first' && message.type === 'ITEM_RESOLVED') {
            this.bufferedResolved = event.data;
            return;
          }
          if (mode === 'sync-first' && message.type === 'STATE_SYNC' && this.bufferedResolved) {
            this.dispatchEvent(new MessageEvent('message', { data: event.data }));
            const resolved = this.bufferedResolved;
            this.bufferedResolved = null;
            setTimeout(() => this.dispatchEvent(new MessageEvent('message', { data: resolved })), 30);
            return;
          }
          if (mode === 'drop-resolved' && message.type === 'ITEM_RESOLVED') return;
          if (mode === 'reconnect' && message.type === 'ITEM_RESOLVED') {
            this.native.close();
            return;
          }
          if (mode === 'until-result' && message.type === 'ITEM_RESOLVED') return;
          if (mode === 'until-result' && message.type === 'STATE_SYNC' && message.snapshot?.phase !== 'result') return;
          this.dispatchEvent(new MessageEvent('message', { data: event.data }));
        });
      }
      get readyState() { return this.native.readyState; }
      get protocol() { return this.native.protocol; }
      get url() { return this.native.url; }
      get bufferedAmount() { return this.native.bufferedAmount; }
      get extensions() { return this.native.extensions; }
      get binaryType() { return this.native.binaryType; }
      set binaryType(value) { this.native.binaryType = value; }
      send(data) {
        try {
          const message = JSON.parse(data);
          if (message.type === 'USE_ITEM') this.useSent = true;
        } catch {}
        this.native.send(data);
      }
      close(code, reason) { this.native.close(code, reason); }
    }
    for (const key of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) {
      Object.defineProperty(ControlledSocket, key, { value: NativeSocket[key] });
      Object.defineProperty(ControlledSocket.prototype, key, { value: NativeSocket[key] });
    }
    window.WebSocket = ControlledSocket;
    window.__qaSetSocketMode = (nextMode) => { mode = nextMode; };
  });
}

/**
 * 실제 두 브라우저 경기 방을 연다.
 * @param {import('@playwright/test').Browser} browser 브라우저
 * @param {string} suffix 식별자
 * @param {boolean} controlled 공격자 소켓 제어 여부
 * @returns {Promise<object>}
 */
async function openPvp(browser, suffix, controlled = false) {
  const aContext = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const bContext = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  if (controlled) await installSocketControl(aContext);
  const attacker = await aContext.newPage();
  const defender = await bContext.newPage();
  await Promise.all([
    attacker.goto(`${BASE}/sichuan-battle/?name=QA-A-${suffix}&e2e=1`),
    defender.goto(`${BASE}/sichuan-battle/?name=QA-B-${suffix}&e2e=1`),
  ]);
  await Promise.all([
    attacker.locator('#board .tile').first().waitFor(),
    defender.locator('#board .tile').first().waitFor(),
  ]);
  // 서버의 3초 시작 카운트다운 뒤에만 아이템 판정이 허용된다.
  await attacker.waitForTimeout(3_150);
  return { aContext, bContext, attacker, defender };
}

/**
 * 운영형 슬롯 ID로 아이템을 지급한다.
 * @param {import('@playwright/test').Page} page 페이지
 * @param {string} itemId 아이템 ID
 * @param {string} suffix 슬롯 접미사
 * @returns {Promise<string>}
 */
async function grantLive(page, itemId, suffix) {
  const slotId = `s-qa-${itemId}-${suffix}`;
  await page.evaluate(({ itemId, slotId }) => window.__sichuanTestSend({
    type: 'TEST_GRANT_ITEM', itemId, slotId,
  }), { itemId, slotId });
  await expect(page.locator(`[data-slot-id="${slotId}"]`)).toHaveCount(1);
  return slotId;
}

/** @param {object} room 경기 리소스를 닫는다. @returns {Promise<void>} */
async function closeRoom(room) {
  await Promise.all([
    room.attacker.evaluate(() => window.__sichuanTestSend?.({ type: 'LEAVE_MATCH' })).catch(() => {}),
    room.defender.evaluate(() => window.__sichuanTestSend?.({ type: 'LEAVE_MATCH' })).catch(() => {}),
  ]);
  await Promise.all([room.aContext.close(), room.bContext.close()]);
}

test('운영형 힌트는 선택·취소·동기화·4초 뒤 유지되고 매칭에서 제거되며 상대에게 비공개다', async ({ browser }) => {
  const room = await openPvp(browser, `hint-${Date.now()}`);
  const { attacker, defender } = room;
  await grantLive(attacker, 'hint', '1');
  const started = Date.now();
  await attacker.locator('[data-item-id="hint"]').click();
  await expect(attacker.locator('#hint-banner')).toBeVisible({ timeout: 250 });
  await expect(attacker.locator('#board .tile.hinted')).toHaveCount(2, { timeout: 250 });
  expect(Date.now() - started).toBeLessThan(750);
  await expect(defender.locator('#opponent-board .tile.hinted')).toHaveCount(0);
  const privacy = await defender.evaluate(() => {
    const own = window.__sichuanTestSnapshot().opponent.effects.find((effect) => effect.itemId === 'hint');
    return { targets: own?.targets, path: own?.path };
  });
  expect(privacy.targets).toBeUndefined();
  expect(privacy.path).toBeUndefined();

  const ids = await attacker.locator('#board .tile.hinted').evaluateAll((nodes) => nodes.map((node) => node.dataset.tileId));
  await attacker.locator(`#board [data-tile-id="${ids[0]}"]`).click();
  await expect(attacker.locator('#hint-banner')).toBeVisible();
  await attacker.locator(`#board [data-tile-id="${ids[0]}"]`).click();
  await expect(attacker.locator('#hint-banner')).toBeVisible();
  await attacker.waitForTimeout(4_100);
  await expect(attacker.locator('#hint-banner')).toBeVisible();
  await expect(attacker.locator('#board .tile.hinted')).toHaveCount(2);
  await attacker.screenshot({ path: 'tests/screenshots/qa-live-item-regression-hint.png' });
  await attacker.locator(`#board [data-tile-id="${ids[0]}"]`).click();
  await attacker.locator(`#board [data-tile-id="${ids[1]}"]`).click();
  await expect(attacker.locator('#hint-banner')).toBeHidden();
  await expect(attacker.locator('#board .tile.hinted')).toHaveCount(0);
  await closeRoom(room);
});

test('뒤집기는 실제 피격 DOM에서 상하 8/8·행 편차 1 이하이고 반복 사용은 같은 효과를 갱신한다', async ({ browser }) => {
  const room = await openPvp(browser, `flip-${Date.now()}`);
  const { attacker, defender } = room;
  /** @returns {Promise<{upper:number,lower:number,rows:number[]}>} 실제 픽셀 중심 기준 분포 */
  const readDistribution = () => defender.locator('#board .tile').evaluateAll((nodes) => {
    const board = nodes[0].parentElement.getBoundingClientRect();
    const middle = board.top + board.height / 2;
    const rows = Array.from({ length: 8 }, () => 0);
    let upper = 0; let lower = 0;
    nodes.forEach((node, index) => {
      if (!node.classList.contains('flipped')) return;
      const rect = node.getBoundingClientRect();
      const center = rect.top + rect.height / 2;
      if (center < middle) upper += 1; else lower += 1;
      rows[Math.floor(index / 12)] += 1;
    });
    return { upper, lower, rows };
  });
  /** @param {{upper:number,lower:number,rows:number[]}} distribution 분포 @returns {void} */
  const assertBalanced = (distribution) => {
    expect(distribution.upper).toBe(8);
    expect(distribution.lower).toBe(8);
    expect(Math.max(...distribution.rows.slice(0, 4)) - Math.min(...distribution.rows.slice(0, 4))).toBeLessThanOrEqual(1);
    expect(Math.max(...distribution.rows.slice(4)) - Math.min(...distribution.rows.slice(4))).toBeLessThanOrEqual(1);
  };
  await grantLive(attacker, 'flip', '1');
  await attacker.locator('[data-item-id="flip"]').click();
  await expect(defender.locator('#board .tile.flipped')).toHaveCount(16);
  assertBalanced(await readDistribution());
  const before = await attacker.evaluate(() => structuredClone(
    window.__sichuanTestSnapshot().opponent.effects.find((effect) => effect.itemId === 'flip'),
  ));
  await grantLive(attacker, 'flip', '2');
  await attacker.locator('[data-item-id="flip"]').click();
  await expect.poll(() => attacker.evaluate(() => window.__sichuanItemQueue().length)).toBe(0);
  const refreshed = await attacker.evaluate(() => structuredClone(
    window.__sichuanTestSnapshot().opponent.effects.find((effect) => effect.itemId === 'flip'),
  ));
  expect(refreshed.effectId).toBe(before.effectId);
  expect(refreshed.targets).toEqual(before.targets);
  expect(refreshed.endsAt).toBeGreaterThan(before.endsAt);

  await defender.waitForTimeout(3_300);
  await expect(defender.locator('#board .tile.flipped')).toHaveCount(0);
  await grantLive(defender, 'hint', 'progress');
  await defender.locator('[data-item-id="hint"]').click();
  await expect(defender.locator('#board .tile.hinted')).toHaveCount(2);
  const hinted = await defender.locator('#board .tile.hinted').evaluateAll((nodes) => nodes.map((node) => node.dataset.tileId));
  await defender.locator(`#board [data-tile-id="${hinted[0]}"]`).click();
  await defender.locator(`#board [data-tile-id="${hinted[1]}"]`).click();
  await expect(defender.locator('#board .tile.removed')).toHaveCount(2);
  await grantLive(attacker, 'flip', '3');
  await attacker.locator('[data-item-id="flip"]').click();
  await expect(defender.locator('#board .tile.flipped')).toHaveCount(16);
  assertBalanced(await readDistribution());
  await defender.screenshot({ path: 'tests/screenshots/qa-live-item-regression-flip-progress-8x8.png' });
  await closeRoom(room);
});

for (const scenario of [
  { mode: 'normal', name: 'ITEM_RESOLVED→STATE_SYNC' },
  { mode: 'sync-first', name: 'STATE_SYNC→ITEM_RESOLVED' },
  { mode: 'drop-resolved', name: 'ITEM_RESOLVED 유실' },
  { mode: 'reconnect', name: '재접속' },
  { mode: 'until-result', name: '결과 전환' },
]) {
  test(`운영형 flip 슬롯은 ${scenario.name}에서도 즉시 비고 1.5초 내 pending이 정리된다`, async ({ browser }) => {
    const room = await openPvp(browser, `slot-${scenario.mode}-${Date.now()}`, true);
    const { attacker } = room;
    const slotId = await grantLive(attacker, 'flip', scenario.mode);
    await attacker.evaluate((mode) => window.__qaSetSocketMode(mode), scenario.mode);
    await attacker.locator(`[data-slot-id="${slotId}"]`).click();
    await expect(attacker.locator(`[data-slot-id="${slotId}"]`)).toHaveCount(0);
    await expect(attacker.locator('#inventory')).not.toContainText(/사용 중|Using/);
    if (scenario.mode === 'until-result') {
      await attacker.evaluate(() => window.__sichuanTestSend({ type: 'TEST_FINISH_MATCH' }));
    }
    await expect.poll(() => attacker.evaluate(() => window.__sichuanItemQueue().length), { timeout: 1_700 }).toBe(0);
    await expect(attacker.locator(`[data-slot-id="${slotId}"]`)).toHaveCount(0);
    await attacker.screenshot({ path: `tests/screenshots/qa-live-item-regression-slot-${scenario.mode}.png` });
    await closeRoom(room);
  });
}
