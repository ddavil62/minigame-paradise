/**
 * @fileoverview 끝말잇기 배틀 보통 난이도 WebSocket AI 클라이언트.
 * 서버가 보낸 공개 상태를 추적해 일반 참가자와 같은 WORD_SUBMIT/REMATCH만 전송한다.
 */

import { WebSocket } from 'ws';
import { createAiChooser } from './ai.js';
import { loadWords } from './words.js';

const argv = process.argv.slice(2);
const urlIndex = argv.indexOf('--url');
const BOT_URL = urlIndex >= 0 && argv[urlIndex + 1]
  ? argv[urlIndex + 1]
  : 'ws://localhost:3008/ws?mode=bot';
const BOT_TOKEN = process.env.WORDCHAIN_BOT_TOKEN || '';
const chooser = createAiChooser(loadWords());
const ws = new WebSocket(BOT_URL, {
  headers: { 'x-wordchain-bot-token': BOT_TOKEN },
});

/** @type {string|null} 봇의 서버 플레이어 ID. */
let myId = null;
/** @type {object|null} 가장 최근 자기 STATE. */
let latestPlayer = null;
/** 경기 전체에서 수락된 단어 집합. */
let usedWords = new Set();
/** 최신 상태에서 거절된 후보 집합. */
let rejectedWords = new Set();
/** 현재 경기 세대. */
let matchGeneration = 0;
/** 서버가 PLAYING을 알렸는지 여부. */
let playing = false;
/** 동일 상태 중복 예약 방지 키. */
let scheduledKey = null;
/** @type {NodeJS.Timeout|null} 단어 제출 예약. */
let actionTimer = null;
/** @type {NodeJS.Timeout|null} 거절 재시도 예약. */
let retryTimer = null;
/** @type {NodeJS.Timeout|null} 리매치 예약. */
let rematchTimer = null;
/** 현재 결과 화면에서 이미 리매치 동의를 보냈는지 여부. */
let rematchRequested = false;

/**
 * 지정 timeout을 취소한다.
 * @param {'action'|'retry'|'rematch'} kind 타이머 종류
 * @returns {void}
 */
function clearScheduled(kind) {
  const handle = kind === 'action' ? actionTimer : kind === 'retry' ? retryTimer : rematchTimer;
  if (handle) clearTimeout(handle);
  if (kind === 'action') actionTimer = null;
  else if (kind === 'retry') retryTimer = null;
  else rematchTimer = null;
}

/** 모든 예약 작업을 취소한다. */
function clearAllScheduled() {
  clearScheduled('action');
  clearScheduled('retry');
  clearScheduled('rematch');
  scheduledKey = null;
}

/**
 * 서버에 허용된 봇 메시지를 전송한다.
 * @param {{type:'WORD_SUBMIT', word:string}|{type:'REMATCH'}} payload 전송 내용
 * @returns {void}
 */
function send(payload) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

/** 최신 자기 상태에 따라 1.2~2.0초 뒤 제출을 예약한다. */
function scheduleWord() {
  clearScheduled('action');
  if (!playing || !latestPlayer || !myId) return;
  const key = `${matchGeneration}|${latestPlayer.forced || ''}|${latestPlayer.lastSyllable || ''}|${usedWords.size}|${latestPlayer.lastWord || ''}`;
  if (key === scheduledKey) return;
  scheduledKey = key;
  const generation = matchGeneration;
  const delay = 1200 + Math.floor(Math.random() * 801);
  actionTimer = setTimeout(() => {
    actionTimer = null;
    if (!playing || generation !== matchGeneration || key !== scheduledKey || ws.readyState !== WebSocket.OPEN) return;
    const word = chooser.chooseAiWord({ player: latestPlayer, usedWords, excludedWords: rejectedWords });
    if (word) send({ type: 'WORD_SUBMIT', word });
  }, delay);
}

/** 거절된 최신 상태에서 다른 후보를 한 번 재시도한다. */
function scheduleRetry() {
  clearScheduled('retry');
  if (!playing || !latestPlayer) return;
  const generation = matchGeneration;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (!playing || generation !== matchGeneration || ws.readyState !== WebSocket.OPEN) return;
    const word = chooser.chooseAiWord({ player: latestPlayer, usedWords, excludedWords: rejectedWords });
    if (word) send({ type: 'WORD_SUBMIT', word });
  }, 250 + Math.floor(Math.random() * 251));
}

/** 게임 종료 후 AI 리매치 동의를 한 번 예약한다. */
function scheduleRematch() {
  if (rematchTimer || rematchRequested) return;
  rematchTimer = setTimeout(() => {
    rematchTimer = null;
    rematchRequested = true;
    send({ type: 'REMATCH' });
  }, 500 + Math.floor(Math.random() * 301));
}

ws.on('message', (data) => {
  let msg;
  try { msg = JSON.parse(data.toString()); } catch (_) { return; }
  if (!msg || typeof msg.type !== 'string') return;

  switch (msg.type) {
    case 'JOINED':
      myId = msg.yourId || msg.playerId || myId;
      break;
    case 'GAME_START':
      clearAllScheduled();
      matchGeneration += 1;
      playing = false;
      latestPlayer = null;
      usedWords = new Set();
      rejectedWords = new Set();
      rematchRequested = false;
      break;
    case 'PLAYING':
      playing = true;
      break;
    case 'STATE': {
      clearScheduled('action');
      const own = Array.isArray(msg.players) ? msg.players.find((player) => player.id === myId) : null;
      latestPlayer = own || null;
      rejectedWords = new Set();
      scheduledKey = null;
      scheduleWord();
      break;
    }
    case 'WORD_ACCEPTED':
      if (typeof msg.word === 'string') usedWords.add(msg.word);
      if (msg.playerId === myId) rejectedWords.delete(msg.word);
      break;
    case 'WORD_REJECTED':
      if (msg.playerId === myId && typeof msg.word === 'string') {
        rejectedWords.add(msg.word);
        scheduledKey = null;
        scheduleRetry();
      }
      break;
    case 'TIMER_EXPIRED':
      if (msg.playerId === myId) {
        scheduledKey = null;
        scheduleWord();
      }
      break;
    case 'GAME_OVER':
      playing = false;
      clearScheduled('action');
      clearScheduled('retry');
      scheduleRematch();
      break;
    case 'REMATCH_WAITING':
      scheduleRematch();
      break;
    case 'REMATCH_START':
      clearAllScheduled();
      playing = false;
      latestPlayer = null;
      usedWords = new Set();
      rejectedWords = new Set();
      rematchRequested = false;
      break;
    case 'OPPONENT_LEFT':
    case 'ERROR':
      clearAllScheduled();
      playing = false;
      ws.close();
      break;
    default:
      break;
  }
});

ws.on('close', () => {
  clearAllScheduled();
  process.exit(0);
});

ws.on('error', (error) => {
  console.error('[wordchain-bot] WebSocket 오류:', error.message);
});
