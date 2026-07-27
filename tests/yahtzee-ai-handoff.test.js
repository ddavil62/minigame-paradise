/**
 * @fileoverview 런처의 야추 AI 채우기가 1명 사람 + 1명 AI 계약을 유지하는지 검증한다.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 런처 게임 메타데이터에서 야추 항목을 읽는다.
 *
 * @returns {object} 야추 게임 메타데이터
 */
function readYahtzeeMetadata() {
  const gamesPath = path.join(__dirname, '..', 'launcher', 'public', 'games.json');
  const games = JSON.parse(fs.readFileSync(gamesPath, 'utf8'));
  const yahtzee = games.find((game) => game.id === 'yahtzee');
  assert.ok(yahtzee, '런처 게임 목록에 yahtzee가 있어야 한다');
  return yahtzee;
}

/**
 * 테스트에 사용할 빈 TCP 포트를 구한다.
 *
 * @returns {Promise<number>} 사용 가능한 포트
 */
function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

/**
 * WebSocket 연결이 열릴 때까지 기다린다.
 *
 * @param {string} url 접속 URL
 * @returns {Promise<WebSocket>} 열린 WebSocket
 */
function connectWebSocket(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}

/**
 * 조건에 맞는 다음 WebSocket 메시지를 기다린다.
 *
 * @param {WebSocket} socket 대상 소켓
 * @param {(message:object)=>boolean} predicate 완료 조건
 * @param {number} timeoutMs 최대 대기 시간
 * @returns {Promise<object>} 조건에 맞는 메시지
 */
function waitForMessage(socket, predicate, timeoutMs = 7000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('WebSocket 메시지 대기 시간 초과'));
    }, timeoutMs);

    /**
     * 테스트 리스너를 정리한다.
     *
     * @returns {void}
     */
    function cleanup() {
      clearTimeout(timer);
      socket.off('message', onMessage);
    }

    /**
     * 오류 또는 목표 메시지를 처리한다.
     *
     * @param {Buffer} raw 원시 메시지
     * @returns {void}
     */
    function onMessage(raw) {
      const message = JSON.parse(raw.toString());
      if (message.type === 'ERROR' || message.type === 'ROOM_FULL') {
        cleanup();
        reject(new Error(`${message.type}: ${message.message || ''}`));
        return;
      }
      if (!predicate(message)) return;
      cleanup();
      resolve(message);
    }

    socket.on('message', onMessage);
  });
}

/**
 * 런처 HTTP 서버가 준비될 때까지 폴링한다.
 *
 * @param {number} port 런처 포트
 * @returns {Promise<void>}
 */
async function waitForLauncher(port) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/games.json`);
      if (response.ok) return;
    } catch {
      // 서버가 listen을 시작할 때까지 짧게 재시도한다.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('테스트 런처 시작 시간 초과');
}

/**
 * 메타데이터와 실제 런처→야추 AI handoff를 함께 검증한다.
 *
 * @returns {Promise<void>}
 */
async function main() {
  const yahtzee = readYahtzeeMetadata();
  assert.equal(yahtzee.minPlayers, 2, '야추 최소 인원은 2명이어야 한다');
  assert.equal(yahtzee.maxPlayers, 2, 'AI 채우기는 빈 슬롯 하나만 생성하도록 최대 인원이 2명이어야 한다');
  assert.equal(yahtzee.botAvailable, true, '야추 AI 채우기가 활성화되어야 한다');

  const port = await getFreePort();
  const launcherPath = path.join(__dirname, '..', 'launcher', 'server.js');
  const launcher = spawn(process.execPath, [launcherPath, '--port', String(port)], {
    stdio: 'ignore',
  });
  let lobbySocket;
  let gameSocket;

  try {
    await waitForLauncher(port);
    lobbySocket = await connectWebSocket(`ws://127.0.0.1:${port}/lobby/ws?gameId=yahtzee`);

    const joinedRoom = waitForMessage(
      lobbySocket,
      (message) => message.type === 'ROOM_STATE' && message.players?.length === 1,
    );
    lobbySocket.send(JSON.stringify({ type: 'JOIN', name: '회귀테스터' }));
    await joinedRoom;

    const aiFilled = waitForMessage(
      lobbySocket,
      (message) => message.type === 'ROOM_STATE' && message.aiSlots?.length === 1,
    );
    lobbySocket.send(JSON.stringify({ type: 'FILL_WITH_AI' }));
    await aiFilled;

    const redirected = waitForMessage(lobbySocket, (message) => message.type === 'REDIRECT');
    lobbySocket.send(JSON.stringify({ type: 'READY' }));
    const redirect = await redirected;
    assert.equal(redirect.playerCount, 2, '런처는 사람 1명과 AI 1명만 야추로 전달해야 한다');

    gameSocket = await connectWebSocket(`ws://127.0.0.1:${port}/yahtzee/ws?mode=human`);
    const joinedGame = waitForMessage(gameSocket, (message) => message.type === 'JOINED');
    gameSocket.send(JSON.stringify({ type: 'JOIN', playerName: '회귀테스터' }));
    await joinedGame;

    const started = waitForMessage(gameSocket, (message) => message.type === 'START');
    gameSocket.send(JSON.stringify({ type: 'READY' }));
    await started;
    console.log('PASS: 야추 런처 AI handoff는 1인 + AI 1인으로 게임을 시작한다.');
  } finally {
    if (gameSocket) gameSocket.close();
    if (lobbySocket) lobbySocket.close();
    launcher.kill();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
