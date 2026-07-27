/**
 * @fileoverview 야추 AI가 모든 주사위를 보관한 뒤 무의미하게 재굴림하는 회귀를 검증한다.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 봇이 보낸 다음 게임 행동 메시지를 기다린다.
 *
 * @param {import('ws').WebSocket} socket 테스트용 봇 소켓
 * @param {number} timeoutMs 최대 대기 시간
 * @returns {Promise<object>} 수신한 행동 메시지
 */
function waitForAction(socket, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('AI 행동 메시지 대기 시간 초과'));
    }, timeoutMs);

    /**
     * 메시지 리스너와 타이머를 정리한다.
     *
     * @returns {void}
     */
    function cleanup() {
      clearTimeout(timer);
      socket.off('message', onMessage);
    }

    /**
     * READY가 아닌 첫 게임 행동을 반환한다.
     *
     * @param {Buffer} raw 원시 WebSocket 메시지
     * @returns {void}
     */
    function onMessage(raw) {
      const message = JSON.parse(raw.toString());
      if (!['ROLL_DICE', 'SCORE_CATEGORY'].includes(message.type)) return;
      cleanup();
      resolve(message);
    }

    socket.on('message', onMessage);
  });
}

/**
 * 테스트용 WebSocket 서버에 실제 봇 프로세스를 연결해 회귀 시나리오를 실행한다.
 *
 * @returns {Promise<void>}
 */
async function main() {
  const wss = new WebSocketServer({ port: 0 });
  await once(wss, 'listening');
  const address = wss.address();
  assert.equal(typeof address, 'object');

  const botPath = path.join(__dirname, '..', 'bot.js');
  const bot = spawn(process.execPath, [botPath, '--url', `ws://127.0.0.1:${address.port}?mode=bot`], {
    stdio: 'ignore',
  });

  try {
    const [socket] = await once(wss, 'connection');
    await once(socket, 'message');

    socket.send(JSON.stringify({
      type: 'JOINED',
      playerId: 'p1',
      waiting: false,
      opponentName: '테스트 상대',
    }));
    socket.send(JSON.stringify({ type: 'START' }));

    const actionPromise = waitForAction(socket);
    socket.send(JSON.stringify({
      type: 'STATE',
      phase: 'playing',
      currentTurn: 'p1',
      turnNumber: 1,
      rollCount: 1,
      dice: [6, 6, 6, 5, 5],
      sheets: {
        p1: {
          aces: null, twos: null, threes: null, fours: null, fives: null, sixes: null,
          threeOfAKind: null, fourOfAKind: null, fullHouse: null, smallStraight: null,
          largeStraight: null, yahtzee: null, chance: null,
        },
      },
    }));

    const action = await actionPromise;
    assert.equal(action.type, 'SCORE_CATEGORY', '다섯 주사위를 모두 보관하면 즉시 점수를 기록해야 한다');
    console.log('PASS: AI는 모든 주사위 보관 결정 뒤 재굴림하지 않는다.');
  } finally {
    bot.kill();
    await new Promise((resolve) => wss.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
