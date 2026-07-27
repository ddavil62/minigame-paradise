/**
 * @fileoverview 리포트 32의 80% 아이템 지급과 고유 이벤트 중복 방지를 결정적으로 검증한다.
 */

import http from 'http';
import WebSocket from 'ws';
import {
  createApp,
  ITEM_GRANT_PROB,
  isWinningItemGrantRoll,
} from '../server.js';

let passed = 0;
let failed = 0;

/**
 * 조건을 검증하고 결과를 누적한다.
 * @param {boolean} condition 검증 조건
 * @param {string} message 검증 설명
 * @returns {void}
 */
function check(condition, message) {
  if (condition) {
    passed += 1;
    console.log(`PASS ${message}`);
  } else {
    failed += 1;
    console.error(`FAIL ${message}`);
  }
}

/**
 * 지정 시간만큼 비동기로 대기한다.
 * @param {number} milliseconds 대기 시간
 * @returns {Promise<void>}
 */
function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * 수신 메시지를 기록하는 테스트 WebSocket 클라이언트를 만든다.
 * @param {string} url 접속 URL
 * @returns {{ws: WebSocket, received: object[], open: () => Promise<void>, waitFor: (predicate: (message: object) => boolean, timeout?: number) => Promise<object>, send: (payload: object) => void}}
 */
function createClient(url) {
  const ws = new WebSocket(url);
  const received = [];
  const waiters = [];

  ws.on('message', (raw) => {
    const message = JSON.parse(raw.toString());
    received.push(message);
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      const waiter = waiters[index];
      if (!waiter.predicate(message)) continue;
      waiters.splice(index, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    }
  });

  return {
    ws,
    received,
    open() {
      return new Promise((resolve, reject) => {
        if (ws.readyState === WebSocket.OPEN) {
          resolve();
          return;
        }
        ws.once('open', resolve);
        ws.once('error', reject);
      });
    },
    waitFor(predicate, timeout = 1500) {
      const existing = received.find(predicate);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const waiter = {
          predicate,
          resolve,
          timer: setTimeout(() => {
            const index = waiters.indexOf(waiter);
            if (index >= 0) waiters.splice(index, 1);
            reject(new Error('메시지 대기 시간 초과'));
          }, timeout),
        };
        waiters.push(waiter);
      });
    },
    send(payload) {
      ws.send(JSON.stringify(payload));
    },
  };
}

/**
 * 테스트 앱을 임시 포트에서 시작한다.
 * @param {() => number} random 결정적 난수 공급자
 * @returns {Promise<{server: http.Server, url: string}>}
 */
async function startTestServer(random) {
  const app = createApp({ random });
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', (request, socket, head) => {
    app.handleUpgrade(request, socket, head);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return { server, url: `ws://127.0.0.1:${address.port}/ws` };
}

/**
 * 두 클라이언트를 참가·준비시켜 실제 경기 상태로 만든다.
 * @param {string} url 접속 URL
 * @returns {Promise<{a: ReturnType<typeof createClient>, b: ReturnType<typeof createClient>}>}
 */
async function joinPlayingPair(url) {
  const a = createClient(url);
  const b = createClient(url);
  await Promise.all([a.open(), b.open()]);
  a.send({ type: 'JOIN', playerName: 'A' });
  b.send({ type: 'JOIN', playerName: 'B' });
  await Promise.all([
    a.waitFor((message) => message.type === 'JOINED'),
    b.waitFor((message) => message.type === 'JOINED'),
  ]);
  a.send({ type: 'READY' });
  b.send({ type: 'READY' });
  await Promise.all([
    a.waitFor((message) => message.type === 'START'),
    b.waitFor((message) => message.type === 'START'),
  ]);
  return { a, b };
}

check(ITEM_GRANT_PROB === 0.8, '복원된 아이템 지급 확률은 80%');
check(isWinningItemGrantRoll(0), '난수 0은 지급');
check(isWinningItemGrantRoll(0.799999), '80% 경계 직전은 지급');
check(!isWinningItemGrantRoll(0.8), '80% 경계값은 미지급');
check(!isWinningItemGrantRoll(1), '난수 1은 미지급');
check(!isWinningItemGrantRoll(Number.NaN), '비정상 난수는 미지급');

const rolls = [
  0.799999, 0, // 이벤트 1: 당첨 + 첫 아이템 선택
  0.8,         // 이벤트 2: 경계값 미당첨
  0, 0.25,     // 이벤트 3: 당첨 + 두 번째 아이템 선택
  0, 0.5,      // 이벤트 4: 당첨 + 재사용 슬롯 아이템 선택
];
const { server, url } = await startTestServer(() => rolls.shift() ?? 0.99);
const { a, b } = await joinPlayingPair(url);

a.send({ type: 'GARBAGE_SEND', lines: 0, combo: 0, clearEventId: 1 });
const first = await a.waitFor((message) => message.type === 'ITEM_GRANT');
check(first.slotIndex === 0, '0콤보 라인 클리어도 80% 당첨 시 슬롯 0에 지급');

a.send({ type: 'GARBAGE_SEND', lines: 0, combo: 99, clearEventId: 1 });
await sleep(80);
check(
  a.received.filter((message) => message.type === 'ITEM_GRANT').length === 1,
  '동일 clearEventId 재전송은 재추첨·중복 지급하지 않음',
);

a.send({ type: 'GARBAGE_SEND', lines: 0, combo: 99, clearEventId: 2 });
await sleep(80);
check(
  a.received.filter((message) => message.type === 'ITEM_GRANT').length === 1,
  '콤보 99여도 난수 0.8이면 지급하지 않음',
);

a.send({ type: 'GARBAGE_SEND', lines: 0, combo: 0, clearEventId: 3 });
const second = await a.waitFor((message) => (
  message.type === 'ITEM_GRANT' && message.slotIndex === 1
));
check(second.slotIndex === 1, '다음 당첨 이벤트는 다음 빈 슬롯 1을 사용');

a.send({ type: 'ITEM_USE', itemId: first.itemId, slotIndex: 0 });
a.send({ type: 'GARBAGE_SEND', lines: 0, combo: 0, clearEventId: 4 });
await sleep(80);
check(
  a.received.filter((message) => (
    message.type === 'ITEM_GRANT' && message.slotIndex === 0
  )).length === 2,
  '사용한 첫 빈 슬롯 0을 다음 당첨 지급이 재사용',
);
check(rolls.length === 0, '중복 이벤트는 난수를 추가 소비하지 않음');

a.ws.close();
b.ws.close();
await sleep(80);
await new Promise((resolve) => server.close(resolve));

console.log(`결과: ${passed} PASS / ${failed} FAIL`);
process.exitCode = failed > 0 ? 1 : 0;
