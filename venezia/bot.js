/**
 * @fileoverview 베네치아 타이핑 배틀 AI 봇.
 *
 * mode=ai 사용자가 들어왔을 때 server.js가 child_process로 spawn 한다.
 *
 * 실행:
 *   node bot.js                  → ws://localhost:3017/ws?mode=bot 에 접속
 *   node bot.js --url ws://...   → 다른 서버 지정 가능
 *
 * 행동:
 *  - JOIN 후 WORD_ADDED 수신 시 난이도에 따른 딜레이 후 WORD_SUBMIT 전송
 *  - 초급: 글자수 * 0.35초, 중급: 글자수 * 0.50초, 고급: 글자수 * 0.70초
 *  - 지터: +/- 0.3초
 *  - GAME_OVER 시 자동 REMATCH 동의
 */

import { WebSocket } from 'ws';

// ── 인자 파싱 ─────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const urlIdx = argv.indexOf('--url');
const URL = urlIdx >= 0 && argv[urlIdx + 1] ? argv[urlIdx + 1] : 'ws://localhost:3017/ws?mode=bot';

console.log(`[venezia-bot] 서버에 접속 시도: ${URL}`);

// ── 타이핑 딜레이 계수 (난이도별) ────────────────────────────────
const TYPING_DELAY = { easy: 0.35, medium: 0.50, hard: 0.70 };
/** 지터 범위 (초). */
const JITTER = 0.3;

// ── 상태 ────────────────────────────────────────────────────────
/** @type {string|null} */
let myId = null;
/** 단어별 예약된 타이머 ID. */
const wordTimers = new Map();
/** 리매치 타이머. */
let rematchTimer = null;
/** 봇 보유 아이템 슬롯 (최대 3). */
const botItemSlots = [null, null, null];
/** 마지막 아이템 사용 시각 (과도한 연발 방지). */
let lastItemUsedAt = 0;

const ws = new WebSocket(URL);

ws.on('open', () => {
  console.log('[venezia-bot] 연결됨');
  // 봇은 JOIN을 보내지 않음 (서버가 name='AI' 자동 배정)
});

ws.on('close', (code) => {
  console.log(`[venezia-bot] 연결 종료 (code=${code})`);
  clearAllTimers();
  process.exit(0);
});

ws.on('error', (err) => {
  console.error('[venezia-bot] 에러:', err.message);
});

ws.on('message', (data) => {
  let msg;
  try { msg = JSON.parse(data.toString()); } catch { return; }

  switch (msg.type) {
    case 'JOINED':
      myId = msg.playerId;
      console.log(`[venezia-bot] ${myId} 자리 점유`);
      break;

    case 'GAME_START':
      console.log('[venezia-bot] 게임 시작');
      clearAllTimers();
      botItemSlots.fill(null);
      lastItemUsedAt = 0;
      break;

    case 'WORD_ADDED':
      handleWordAdded(msg.word);
      break;

    case 'WORD_CLEARED':
      // 내가 성공적으로 제출한 단어 — 타이머 정리
      cancelWordTimer(msg.wordId);
      break;

    case 'WORDS_EXPIRED':
      // 만료된 단어 타이머 정리
      if (Array.isArray(msg.wordIds)) {
        for (const id of msg.wordIds) cancelWordTimer(id);
      }
      break;

    case 'STATE':
      // 상태 동기화 (필요 시 사용)
      break;

    case 'GAME_OVER':
      console.log(`[venezia-bot] 게임 종료: winner=${msg.winner}`);
      clearAllTimers();
      scheduleRematch();
      break;

    case 'REMATCH_WAITING':
      scheduleRematch();
      break;

    case 'ITEM_GRANTED':
      if (typeof msg.slotIndex === 'number' && msg.slotIndex >= 0 && msg.slotIndex < 3) {
        botItemSlots[msg.slotIndex] = msg.itemId;
        scheduleItemUse();
      }
      break;

    case 'ITEM_EFFECT_START':
    case 'ITEM_EFFECT_END':
      // 낙하·만료는 서버 권위이므로 봇은 효과 시계를 따로 계산하지 않는다.
      break;

    case 'REMATCH_START':
      if (rematchTimer) { clearTimeout(rematchTimer); rematchTimer = null; }
      console.log('[venezia-bot] 리매치 시작');
      clearAllTimers();
      botItemSlots.fill(null);
      lastItemUsedAt = 0;
      break;

    case 'OPPONENT_LEFT':
      console.log('[venezia-bot] 상대 이탈 → 종료');
      clearAllTimers();
      ws.close();
      break;

    case 'ERROR':
      if (msg.message && msg.message.includes('가득')) {
        ws.close();
      }
      break;

    default:
      break;
  }
});

/**
 * WORD_ADDED 수신 시 딜레이 타이머를 등록한다.
 * @param {object} word
 */
function handleWordAdded(word) {
  if (!word || !word.id || !word.text) return;

  const diff = word.difficulty || 'easy';
  const baseDelay = word.text.length * (TYPING_DELAY[diff] || 0.5);
  const jitter = (Math.random() * 2 - 1) * JITTER;
  const delay = Math.max(0.3, baseDelay + jitter) * 1000;

  const timer = setTimeout(() => {
    wordTimers.delete(word.id);
    sendSubmit(word.id, word.text);
  }, delay);

  wordTimers.set(word.id, timer);
}

/**
 * WORD_SUBMIT을 서버에 전송한다.
 * @param {string} wordId
 * @param {string} text
 */
function sendSubmit(wordId, text) {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'WORD_SUBMIT', wordId, text }));
}

/**
 * 특정 단어 타이머를 취소한다.
 * @param {string} wordId
 */
function cancelWordTimer(wordId) {
  const timer = wordTimers.get(wordId);
  if (timer) {
    clearTimeout(timer);
    wordTimers.delete(wordId);
  }
}

/**
 * 모든 단어 타이머를 정리한다.
 */
function clearAllTimers() {
  for (const timer of wordTimers.values()) {
    clearTimeout(timer);
  }
  wordTimers.clear();
}

/**
 * 봇 아이템 사용을 예약한다. 2~4초 딜레이 후 첫 번째 보유 슬롯 사용.
 */
function scheduleItemUse() {
  const delay = 2000 + Math.random() * 2000;
  setTimeout(() => {
    const now = Date.now();
    if (now - lastItemUsedAt < 3000) return; // 연발 방지 3초 쿨다운
    const idx = botItemSlots.findIndex((s) => s !== null);
    if (idx === -1) return;
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'ITEM_USED', slotIndex: idx }));
    botItemSlots[idx] = null;
    lastItemUsedAt = now;
  }, delay);
}

/**
 * 리매치를 예약한다.
 */
function scheduleRematch() {
  if (rematchTimer) return;
  rematchTimer = setTimeout(() => {
    rematchTimer = null;
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'REMATCH' }));
    }
  }, 500);
}
