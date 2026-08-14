/**
 * @fileoverview 끝말잇기 배틀 WebSocket + 정적 파일 서버.
 *
 * 아키텍처: **서버 권위(Server Authoritative)**
 *  - 단어 유효성 검증, 전투 계산, 보상 적용, 타이머 관리, 승패 판정
 *    모두 서버 game.js 순수 함수에서 처리한다.
 *  - 클라이언트는 WORD_SUBMIT { word }, REWARD_SELECT { rewardId } 의도만 전송한다.
 *  - 의존성 최소화: Node 내장 http + ws (Express 미사용).
 *
 * 입장 흐름:
 *  1. 첫 연결 → playerId='p1'
 *  2. 두 번째 연결 → playerId='p2'
 *  3. 두 플레이어 모두 JOIN → 카운트다운(3초) → GAME_START
 *
 * 통합 라우터 지원:
 *  - createApp()을 export하여 launcher가 단일 포트(3000)에서 라우팅한다.
 *  - 단독 실행(`node server.js [--port N]`)도 지원하며 포트 충돌 시 자동 폴백.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { randomBytes, timingSafeEqual } from 'crypto';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import {
  createGame, submitWord, resolveCombatTurn, applyTimerExpiry, applyResign,
  isGameOver, snapshot, getEffectiveAnswerTime, REWARD_TIMER_SEC, TURN_STATE,
} from './game.js';
import { publicCombatConfig } from './combat-config.js';
import { loadWords, getWordSet, buildFollowerCountMap } from './words.js';
import { createMissingWordLogger } from './missing-word-log.js';

// ── 경로 + 설정 ───────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');
const ASSETS_DIR = path.join(__dirname, 'assets');

/** MIME 매핑 (정적 파일 서빙용). */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
};

/** 카운트다운 시간 (초) */
const COUNTDOWN_SEC = 3;

// ── 단어 DB 초기화 ──────────────────────────────────────────────
const wordSet = loadWords();
const followerCountMap = buildFollowerCountMap();

// ── createApp ───────────────────────────────────────────────────

/**
 * 끝말잇기 배틀 앱 인스턴스를 생성한다.
 * 모든 룸 상태는 closure로 격리된다.
 *
 * @param {object} [opts]
 * @param {string} [opts.hostUrl] LAN 접속 URL
 * @param {() => string|null} [opts.getBotUrl] 서버 관리형 봇 접속 URL 반환 함수
 * @param {typeof spawn} [opts.spawnBotProcess] 테스트용 봇 프로세스 생성 함수
 * @param {{log: Function, flush?: Function}} [opts.missingWordLogger] 사전 누락 후보 기록기
 * @returns {{ handleHttp: Function, handleUpgrade: Function, setHostUrl: Function }}
 */
export function createApp(opts = {}) {
  let HOST_URL = typeof opts.hostUrl === 'string' ? opts.hostUrl : '';
  const getBotUrl = typeof opts.getBotUrl === 'function' ? opts.getBotUrl : (() => null);
  const spawnBotProcess = typeof opts.spawnBotProcess === 'function' ? opts.spawnBotProcess : spawn;
  const random = typeof opts.random === 'function' ? opts.random : Math.random;
  const missingWordLogger = opts.missingWordLogger || createMissingWordLogger({
    directory: path.join(__dirname, 'logs', 'dictionary-candidates'),
  });
  const loggedMissingWords = new WeakMap();

  // ── 룸 상태 (closure 격리, 2인 1룸 고정) ─────────────────

  /**
   * @typedef {Object} Player
   * @property {string} id 'p1' | 'p2'
   * @property {import('ws').WebSocket} ws
   * @property {string} name 닉네임
   * @property {boolean} joined JOIN 메시지 처리 완료 여부
   * @property {'human'|'ai'|'bot'} mode 연결 모드
   * @property {boolean} _isBot 서버 관리형 봇 여부
   */

  /** @type {Player[]} */
  let players = [];

  /** @type {import('./game.js').GameState|null} */
  let game = null;

  /** @type {NodeJS.Timeout|null} 현재 턴 만료 타이머 핸들 */
  let turnTimer = null;

  /** @type {NodeJS.Timeout|null} 현재 턴 tick 인터벌 핸들 */
  let turnTickInterval = null;

  /** 오래된 State 타이머 콜백을 무효화하는 세대 번호. */
  let turnTimerGeneration = 0;

  /** 리매치 동의한 playerId Set. */
  let rematchPending = new Set();

  /** @type {NodeJS.Timeout|null} 현재 카운트다운 예약 핸들. */
  let countdownTimeout = null;

  /** 카운트다운 콜백의 세대를 구분하는 단조 증가 번호. */
  let countdownGeneration = 0;

  /** @type {import('child_process').ChildProcess|null} 서버가 소유한 봇 프로세스. */
  let botChild = null;

  /** @type {NodeJS.Timeout|null} 봇 spawn 지연 예약. */
  let botSpawnPending = null;

  /** 봇 spawn 예약과 오래된 child 이벤트를 구분하는 세대. */
  let botGeneration = 0;

  /** 승인된 자식 프로세스 한 개에만 발급되는 미사용 일회용 인증 토큰. */
  let botAuthToken = null;

  // ── 유틸리티 ──────────────────────────────────────────────

  /**
   * 특정 플레이어에게 JSON 메시지를 보낸다.
   * @param {import('ws').WebSocket} ws
   * @param {object} payload
   */
  function sendJson(ws, payload) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }

  /**
   * 모든 플레이어에게 메시지를 브로드캐스트한다.
   * @param {object} payload
   */
  function broadcastAll(payload) {
    const msg = JSON.stringify(payload);
    for (const p of players) {
      if (p.ws.readyState === WebSocket.OPEN) p.ws.send(msg);
    }
  }

  /**
   * 상태 스냅샷을 브로드캐스트한다.
   */
  function broadcastState() {
    if (!game) return;
    broadcastAll(snapshot(game));
  }

  /**
   * 요청 URL에서 허용된 연결 모드를 읽는다.
   * @param {http.IncomingMessage} req WebSocket upgrade 요청
   * @returns {'human'|'ai'|'bot'} 정규화된 연결 모드
   */
  function parseConnectionMode(req) {
    try {
      const mode = new URL(req.url || '/ws', 'http://localhost').searchParams.get('mode');
      return mode === 'ai' || mode === 'bot' ? mode : 'human';
    } catch (_) {
      return 'human';
    }
  }

  /**
   * 봇 요청 헤더의 토큰을 현재 미사용 토큰과 상수 시간으로 비교한다.
   * @param {http.IncomingMessage} req WebSocket upgrade 요청
   * @returns {boolean} 정확한 활성 토큰인지 여부
   */
  function hasValidBotToken(req) {
    const raw = req.headers['x-wordchain-bot-token'];
    const candidate = Array.isArray(raw) ? raw[0] : raw;
    if (typeof candidate !== 'string' || typeof botAuthToken !== 'string') return false;
    const actual = Buffer.from(candidate, 'utf8');
    const expected = Buffer.from(botAuthToken, 'utf8');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  /**
   * 봇 자식 프로세스와 예약을 종료한다. 봇 슬롯 제거는 호출자가 먼저 수행한다.
   * @returns {void}
   */
  function killBotChild() {
    botGeneration += 1;
    botAuthToken = null;
    if (botSpawnPending) {
      clearTimeout(botSpawnPending);
      botSpawnPending = null;
    }
    if (botChild) {
      const child = botChild;
      botChild = null;
      try { child.kill(); } catch (_) { /* 이미 종료된 프로세스는 무시한다. */ }
    }
  }

  /**
   * 봇이 소켓을 만들기 전에 종료되면 대기 중인 사람에게 기존 이탈 흐름을 알린다.
   * @param {Player} human 봇을 요청한 사람 identity
   * @param {number} generation 봇 세대
   * @returns {void}
   */
  function handleBotStartupFailure(human, generation) {
    if (generation !== botGeneration || !players.includes(human)) return;
    sendJson(human.ws, { type: 'OPPONENT_LEFT' });
    cancelCountdown();
    game = null;
    clearAllTimers();
    rematchPending = new Set();
  }

  /**
   * AI 모드 사람 세션에 서버 관리형 봇을 한 번 실행한다.
   * @param {Player} human 현재 AI 모드 사람 플레이어 identity
   * @returns {void}
   */
  function scheduleBotSpawn(human) {
    if (botChild || botSpawnPending || human._isBot || human.mode !== 'ai') return;
    const generation = ++botGeneration;
    botSpawnPending = setTimeout(() => {
      botSpawnPending = null;
      if (generation !== botGeneration
        || !players.includes(human)
        || !human.joined
        || human.ws.readyState !== WebSocket.OPEN
        || players.some((candidate) => candidate._isBot)) return;

      const url = getBotUrl();
      if (!url) {
        console.warn('[wordchain] getBotUrl이 없어 AI 봇 실행을 건너뜁니다.');
        handleBotStartupFailure(human, generation);
        return;
      }
      // URL과 로그에는 비밀값을 넣지 않고 해당 자식에게만 환경변수로 일회용 토큰을 전달한다.
      const token = randomBytes(32).toString('hex');
      botAuthToken = token;
      let child;
      try {
        child = spawnBotProcess(process.execPath, [path.join(__dirname, 'bot.js'), '--url', url], {
          stdio: ['ignore', 'inherit', 'inherit'],
          env: { ...process.env, WORDCHAIN_BOT_TOKEN: token },
        });
      } catch (error) {
        botAuthToken = null;
        console.error('[wordchain] AI 봇 실행 오류:', error.message);
        handleBotStartupFailure(human, generation);
        return;
      }
      botChild = child;
      child.once('exit', () => {
        if (botChild === child) {
          botChild = null;
          botAuthToken = null;
          if (!players.some((candidate) => candidate._isBot)) {
            handleBotStartupFailure(human, generation);
          }
        }
      });
      child.once('error', (error) => {
        if (botChild === child) {
          botChild = null;
          botAuthToken = null;
          handleBotStartupFailure(human, generation);
        }
        console.error('[wordchain] AI 봇 실행 오류:', error.message);
      });
    }, 200);
  }

  /**
   * 두 참가자 identity와 JOIN 상태가 모두 유효할 때만 카운트다운을 시작한다.
   * @returns {void}
   */
  function maybeStartCountdown() {
    if (game || players.length !== 2) return;
    if (!players.every((player) => player.joined && player.ws.readyState === WebSocket.OPEN)) return;
    for (const player of players) {
      sendJson(player.ws, {
        type: 'JOINED',
        yourId: player.id,
        waiting: false,
        hostUrl: HOST_URL,
      });
    }
    startCountdown();
  }

  // ── 타이머 관리 ────────────────────────────────────────────

  /** 현재 WORD_INPUT 또는 REWARD_SELECT State의 타이머를 시작한다. */
  function startStateTimer() {
    clearAllTimers();
    if (!game || game.phase !== 'playing') return;

    const playerId = game.turn;
    const turnState = game.turnState;
    const generation = turnTimerGeneration;
    const duration = turnState === TURN_STATE.REWARD_SELECT
      ? REWARD_TIMER_SEC
      : getEffectiveAnswerTime(game.players[playerId]);
    let remaining = duration;
    broadcastAll({ type: 'TIMER_TICK', playerId, turnState, remaining, duration });

    turnTickInterval = setInterval(() => {
      if (generation !== turnTimerGeneration) return;
      remaining -= 1;
      broadcastAll({ type: 'TIMER_TICK', playerId, turnState, remaining, duration });
      if (remaining <= 0 && turnTickInterval) {
        clearInterval(turnTickInterval);
        turnTickInterval = null;
      }
    }, 1000);

    turnTimer = setTimeout(() => {
      if (generation !== turnTimerGeneration
        || !game
        || game.phase !== 'playing'
        || game.turn !== playerId
        || game.turnState !== turnState) return;
      turnTimer = null;

      if (turnState === TURN_STATE.REWARD_SELECT) {
        const combat = resolveCombatTurn(game, playerId, null);
        broadcastAll({ type: 'REWARD_EXPIRED', playerId, combat });
        broadcastAll({ type: 'COMBAT_RESOLVED', ...combat });
      } else {
        const {
          hpLoss, newHp, nextTurn, autoWord, deadEndExpanded,
        } = applyTimerExpiry(game, playerId, wordSet, followerCountMap);
        broadcastAll({
          type: 'TIMER_EXPIRED', playerId, hpLoss, newHp, nextTurn, autoWord, deadEndExpanded,
        });
        broadcastAll({ type: 'TYPING', playerId, count: 0 });
      }
      broadcastState();

      const over = isGameOver(game);
      if (over.ended) {
        handleGameEnd();
        return;
      }

      startStateTimer();
    }, duration * 1000);
  }

  /**
   * 모든 타이머를 정지한다.
   */
  function clearAllTimers() {
    turnTimerGeneration += 1;
    if (turnTimer) clearTimeout(turnTimer);
    if (turnTickInterval) clearInterval(turnTickInterval);
    turnTimer = null;
    turnTickInterval = null;
  }

  // ── 게임 시작/종료 ─────────────────────────────────────────

  /**
   * 진행 중인 카운트다운을 취소하고 이전 콜백 세대를 무효화한다.
   * @returns {void}
   */
  function cancelCountdown() {
    countdownGeneration += 1;
    if (countdownTimeout) {
      clearTimeout(countdownTimeout);
      countdownTimeout = null;
    }
  }

  /**
   * 카운트다운 후 게임을 시작한다.
   * @returns {void}
   */
  function startCountdown() {
    cancelCountdown();
    const p1 = players.find((p) => p.id === 'p1');
    const p2 = players.find((p) => p.id === 'p2');
    game = createGame(
      p1 ? p1.name : '플레이어1',
      p2 ? p2.name : '플레이어2',
      random() < 0.5 ? 'p1' : 'p2',
      null,
      followerCountMap,
    );
    game.phase = 'countdown';
    rematchPending = new Set();
    const countdownGame = game;
    const countdownPlayers = [p1, p2];
    const generation = countdownGeneration;

    broadcastAll({
      type: 'GAME_START',
      players: Object.values(game.players).map((p) => ({
        id: p.id,
        name: p.name,
        hp: p.hp,
      })),
      countdown: COUNTDOWN_SEC,
      firstTurn: game.turn,
      combatConfig: publicCombatConfig(),
    });

    console.log('[wordchain] 카운트다운 시작');

    const timeoutHandle = setTimeout(() => {
      // 이미 새 카운트다운이 예약됐다면 그 핸들을 지우지 않는다.
      if (countdownTimeout === timeoutHandle) countdownTimeout = null;
      const currentPlayers = countdownPlayers.every((expected) => (
        expected
        && players.includes(expected)
        && expected.joined
        && expected.ws.readyState === WebSocket.OPEN
      ));
      if (generation !== countdownGeneration
        || game !== countdownGame
        || game.phase !== 'countdown'
        || players.length !== 2
        || !currentPlayers) return;
      game.phase = 'playing';
      broadcastAll({ type: 'PLAYING' });
      broadcastState();

      startStateTimer();
      console.log('[wordchain] 게임 시작');
    }, COUNTDOWN_SEC * 1000);
    countdownTimeout = timeoutHandle;
  }

  /**
   * 게임 종료를 처리한다.
   */
  function handleGameEnd() {
    cancelCountdown();
    clearAllTimers();
    if (!game) return;
    game.phase = 'over';

    broadcastAll({
      type: 'GAME_OVER',
      winner: game.winner,
      loser: game.loser,
      reason: game.reason,
    });
    console.log(`[wordchain] 게임 종료: 승자=${game.winner}, 사유=${game.reason}`);
  }

  // ── WebSocket 서버 (noServer 모드) ─────────────────────────
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws, req) => {
    const mode = parseConnectionMode(req);
    // 좀비 슬롯 정리
    const dead = players.filter((p) => p.ws.readyState !== WebSocket.OPEN);
    if (dead.length > 0) {
      for (const z of dead) {
        try { z.ws.terminate(); } catch (e) { /* noop */ }
      }
      players = players.filter((p) => p.ws.readyState === WebSocket.OPEN);
      if (players.length === 0) {
        cancelCountdown();
        game = null;
        clearAllTimers();
      }
    }

    const aiHuman = players.find((candidate) => candidate.mode === 'ai' && !candidate._isBot);
    const botAllowed = mode === 'bot'
      && Boolean(aiHuman)
      && aiHuman.joined
      && players.length === 1
      && Boolean(botChild)
      && hasValidBotToken(req);
    const humanBlockedByAiSession = mode !== 'bot' && Boolean(aiHuman);
    const aiMustOwnEmptyRoom = mode === 'ai' && players.length > 0;

    // 서버가 실행하지 않은 봇이나 AI 세션 중 추가 사람 연결은 슬롯을 차지하지 못한다.
    if ((mode === 'bot' && !botAllowed) || humanBlockedByAiSession || aiMustOwnEmptyRoom) {
      sendJson(ws, { type: 'ERROR', message: '현재 세션에 입장할 수 없습니다.' });
      ws.close();
      return;
    }

    // 성공한 첫 연결에서 즉시 폐기해 같은 토큰의 동시/재사용 접속을 차단한다.
    if (mode === 'bot') botAuthToken = null;

    // 정원 초과 거절
    if (players.length >= 2) {
      sendJson(ws, { type: 'ERROR', message: '방이 가득 찼다 (2/2)' });
      ws.close();
      return;
    }

    // 슬롯 배정
    const usedIds = new Set(players.map((p) => p.id));
    const playerId = ['p1', 'p2'].find((id) => !usedIds.has(id)) || 'p1';
    const player = {
      id: playerId,
      ws,
      name: mode === 'bot' ? 'AI (보통)' : '',
      joined: mode === 'bot',
      mode,
      _isBot: mode === 'bot',
    };
    players.push(player);
    console.log(`[wordchain] ${playerId} 연결됨 (${players.length}/2)`);

    // JOINED 즉시 전송
    sendJson(ws, {
      type: 'JOINED',
      yourId: playerId,
      waiting: players.length < 2,
      hostUrl: HOST_URL,
    });

    if (player._isBot) maybeStartCountdown();

    // ── 메시지 라우터 ──
    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch (e) { return; }
      if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;
      if (player._isBot && !['WORD_SUBMIT', 'REWARD_SELECT', 'REMATCH'].includes(msg.type)) return;

      switch (msg.type) {
        case 'JOIN': {
          if (player._isBot) break;
          const raw = typeof msg.name === 'string' ? msg.name.trim().slice(0, 12) : '';
          player.name = raw || '(알 수 없음)';
          player.joined = true;
          console.log(`[wordchain] JOIN: ${player.id} → "${player.name}"`);

          if (player.mode === 'ai') scheduleBotSpawn(player);
          maybeStartCountdown();
          break;
        }

        case 'WORD_SUBMIT': {
          if (!game || game.phase !== 'playing') {
            sendJson(ws, { type: 'ERROR', message: '게임이 진행 중이 아닙니다.' });
            break;
          }

          const word = typeof msg.word === 'string' ? msg.word.trim() : '';
          if (!word) {
            sendJson(ws, { type: 'ERROR', message: '빈 단어입니다.' });
            break;
          }

          const result = submitWord(
            game,
            player.id,
            word,
            wordSet,
            followerCountMap,
            random,
          );

          if (!result.ok) {
            if (result.reason === 'invalid' && /^[가-힣]{2,30}$/.test(word.normalize('NFC'))) {
              let loggedForGame = loggedMissingWords.get(game);
              if (!loggedForGame) {
                loggedForGame = new Set();
                loggedMissingWords.set(game, loggedForGame);
              }
              const normalizedWord = word.normalize('NFC');
              const dedupeKey = `${player.id}\u0000${normalizedWord}`;
              if (!loggedForGame.has(dedupeKey)) {
                loggedForGame.add(dedupeKey);
                Promise.resolve(missingWordLogger.log({
                  word: normalizedWord,
                  expectedStart: game.chain.lastSyllable || null,
                  acceptedStartChars: game.chain.deadEndAlts ? [...game.chain.deadEndAlts] : [],
                  previousWord: game.chain.lastWord || null,
                  playerMode: player.mode,
                })).catch((error) => {
                  console.warn('[wordchain] 사전 누락 후보 기록 실패:', error?.message || error);
                });
              }
            }
            // 거절된 시도 단어는 상대에게 노출하지 않는다.
            sendJson(ws, {
              type: 'WORD_REJECTED',
              playerId: player.id,
              word,
              reason: result.reason,
            });
            break;
          }

          broadcastAll({ type: 'TYPING', playerId: player.id, count: 0 });

          // 단어 수락
          broadcastAll({
            type: 'WORD_ACCEPTED',
            playerId: player.id,
            word: result.word,
            wordLength: result.wordLength,
            wordEffect: result.wordEffect,
            newLastSyllable: result.newLastSyllable,
            deadEndExpanded: result.deadEndExpanded,
          });

          // 상태 브로드캐스트
          broadcastState();

          // 같은 플레이어의 보상 선택 State 타이머 시작
          startStateTimer();
          break;
        }

        case 'REWARD_SELECT': {
          if (!game || game.phase !== 'playing') {
            sendJson(ws, { type: 'REWARD_REJECTED', reason: 'not_playing' });
            break;
          }
          const rewardId = typeof msg.rewardId === 'string' ? msg.rewardId : '';
          const combat = resolveCombatTurn(game, player.id, rewardId);
          if (!combat.ok) {
            sendJson(ws, { type: 'REWARD_REJECTED', reason: combat.reason, rewardId });
            break;
          }
          broadcastAll({ type: 'REWARD_SELECTED', playerId: player.id, rewardId });
          broadcastAll({ type: 'COMBAT_RESOLVED', ...combat });
          broadcastState();

          const over = isGameOver(game);
          if (over.ended) {
            handleGameEnd();
            break;
          }
          startStateTimer();
          break;
        }

        case 'TYPING': {
          if (!game
            || game.phase !== 'playing'
            || game.turn !== player.id
            || game.turnState !== TURN_STATE.WORD_INPUT
            || player._isBot) break;
          const count = Number.isFinite(msg.count)
            ? Math.max(0, Math.min(30, Math.floor(msg.count)))
            : 0;
          broadcastAll({ type: 'TYPING', playerId: player.id, count });
          break;
        }

        case 'RESIGN': {
          if (!game || game.phase !== 'playing') break;
          applyResign(game, player.id);
          handleGameEnd();
          break;
        }

        case 'REMATCH': {
          if (!game || game.phase !== 'over') {
            sendJson(ws, { type: 'ERROR', message: '게임 종료 후에만 리매치 가능합니다.' });
            break;
          }
          rematchPending.add(player.id);

          if (rematchPending.size < 2) {
            broadcastAll({
              type: 'REMATCH_WAITING',
              ready: [...rematchPending],
            });
            break;
          }

          // 양쪽 동의 → 새 게임 시작
          rematchPending = new Set();
          broadcastAll({ type: 'REMATCH_START', players: players.map((p) => ({ id: p.id, name: p.name })) });
          cancelCountdown();
          game = null;
          clearAllTimers();
          startCountdown();
          break;
        }

        default:
          break;
      }
    });

    // ── 연결 해제 ──
    ws.on('close', () => {
      console.log(`[wordchain] ${player.id} 연결 해제`);
      if (!players.includes(player)) return;

      if (!player._isBot && player.mode === 'ai') {
        const bot = players.find((candidate) => candidate._isBot);
        players = players.filter((candidate) => candidate !== player && !candidate._isBot);
        if (bot) {
          try { bot.ws.terminate(); } catch (_) { /* 이미 닫힌 봇 소켓은 무시한다. */ }
        }
        killBotChild();
      } else {
        players = players.filter((candidate) => candidate !== player);
        if (player._isBot) killBotChild();
      }
      rematchPending.delete(player.id);
      cancelCountdown();

      if (players.length === 0) {
        game = null;
        clearAllTimers();
        rematchPending = new Set();
      } else {
        broadcastAll({ type: 'OPPONENT_LEFT' });
        game = null;
        clearAllTimers();
        rematchPending = new Set();
      }
    });

    ws.on('error', (err) => {
      console.error(`[wordchain] ${player.id} WS 에러:`, err.message);
    });
  });

  // ── HTTP 핸들러 (정적 파일 서빙) ────────────────────────────

  /**
   * 정적 파일 응답 핸들러.
   * assets/ 경로도 서빙한다 (key-art.svg 포함).
   * @param {http.IncomingMessage} req
   * @param {http.ServerResponse} res
   */
  function handleHttp(req, res) {
    const reqUrl = req.url || '/';
    const reqPath = reqUrl.split('?')[0] || '/';
    let decodedPath;
    try {
      decodedPath = decodeURIComponent(reqPath);
    } catch (_) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Bad request');
      return;
    }

    const isAsset = decodedPath.startsWith('/assets/');
    const root = isAsset ? ASSETS_DIR : PUBLIC_DIR;
    const relativeUrl = isAsset ? decodedPath.slice('/assets/'.length) : decodedPath;
    const segments = relativeUrl.split('/').filter(Boolean);

    // 디코딩 이후 경계 문자를 검사해 혼합 구분자와 경로 이탈을 파일 접근 전에 차단한다.
    if (decodedPath.includes('\0') || decodedPath.includes('\\') || segments.includes('..')) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }

    const relativePath = segments.join(path.sep) || 'index.html';
    const fullPath = path.resolve(root, relativePath);
    const containment = path.relative(root, fullPath);
    if (containment === '..' || containment.startsWith(`..${path.sep}`) || path.isAbsolute(containment)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }

    fs.stat(fullPath, (statError, stat) => {
      if (statError || !stat.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }
      fs.readFile(fullPath, (readError, data) => {
        if (readError) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Not found');
          return;
        }
        const ext = path.extname(fullPath).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
      });
    });
  }

  /**
   * HTTP upgrade 이벤트를 WS로 전달한다.
   * @param {http.IncomingMessage} req
   * @param {import('net').Socket} socket
   * @param {Buffer} head
   */
  function handleUpgrade(req, socket, head) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  }

  /**
   * HOST_URL을 갱신한다.
   * @param {string} url
   */
  function setHostUrl(url) {
    HOST_URL = typeof url === 'string' ? url : '';
  }

  return { handleHttp, handleUpgrade, setHostUrl };
}

// ──────────────────────────────────────────────────────────────
// 단독 실행 모드: `node server.js [--port N]`
// ──────────────────────────────────────────────────────────────

/**
 * 현재 모듈이 직접 실행되었는지 판정한다.
 * @returns {boolean}
 */
function isDirectExecution() {
  if (!process.argv[1]) return false;
  const argvPath = process.argv[1].replace(/\\/g, '/');
  const metaPath = import.meta.url.replace('file:///', '').replace('file://', '');
  return metaPath === argvPath || metaPath.endsWith(argvPath);
}

if (isDirectExecution()) {
  const argv = process.argv.slice(2);
  const portFlagIndex = argv.indexOf('--port');
  const REQUESTED_PORT = portFlagIndex >= 0 && argv[portFlagIndex + 1]
    ? parseInt(argv[portFlagIndex + 1], 10)
    : 3008;

  let listeningPort = 0;
  const app = createApp({
    hostUrl: '',
    getBotUrl: () => (listeningPort > 0 ? `ws://localhost:${listeningPort}/ws?mode=bot` : null),
  });

  // ── LAN IP 감지 ────────────────────────────────────────────
  const VIRTUAL_IF_PATTERNS = [
    /vEthernet/i, /VirtualBox/i, /VMware/i, /Hyper-?V/i, /WSL/i, /Loopback Pseudo/i,
  ];

  /** @param {string} name */
  function isVirtualInterface(name) {
    return VIRTUAL_IF_PATTERNS.some((re) => re.test(name));
  }

  /** @param {string} name */
  function interfacePriority(name) {
    if (isVirtualInterface(name)) return 9;
    if (/wi-?fi|wireless|wlan|wlp/i.test(name)) return 0;
    if (/ethernet|이더넷|eth\d|enp/i.test(name)) return 1;
    return 2;
  }

  /** @returns {{ ip: string, ifname: string, virtual: boolean }[]} */
  function getLanAddresses() {
    const nets = os.networkInterfaces();
    const results = [];
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        if (net.family === 'IPv4' && !net.internal) {
          results.push({ ip: net.address, ifname: name, virtual: isVirtualInterface(name) });
        }
      }
    }
    results.sort((a, b) => interfacePriority(a.ifname) - interfacePriority(b.ifname));
    return results;
  }

  // ── 서버 시작 ──────────────────────────────────────────────
  const MAX_PORT_FALLBACK = 10;

  /**
   * 지정 포트로 서버 listen을 시도한다.
   * @param {number} port
   * @param {number} attemptsLeft
   */
  function startListening(port, attemptsLeft) {
    const server = http.createServer(app.handleHttp);
    server.on('upgrade', app.handleUpgrade);

    let handled = false;
    const onError = (err) => {
      if (handled) return;
      handled = true;
      server.removeListener('error', onError);
      if (err && err.code === 'EADDRINUSE' && attemptsLeft > 0) {
        console.log(`[wordchain] 포트 ${port} 사용 중. ${port + 1}로 재시도...`);
        setTimeout(() => startListening(port + 1, attemptsLeft - 1), 100);
        return;
      }
      console.error('[wordchain] listen 에러:', err && err.message ? err.message : err);
      process.exit(1);
    };
    server.once('error', onError);

    server.listen(port, '0.0.0.0', () => {
      server.removeListener('error', onError);
      listeningPort = port;
      const lanIps = getLanAddresses();
      const hostUrl = lanIps.length > 0
        ? `http://${lanIps[0].ip}:${port}`
        : `http://localhost:${port}`;
      app.setHostUrl(hostUrl);
      console.log(`[wordchain] 서버 시작: http://localhost:${port}`);
      if (lanIps.length > 0) {
        console.log(`[wordchain] LAN 접속: ${hostUrl}`);
      }
    });
  }

  startListening(REQUESTED_PORT, MAX_PORT_FALLBACK);
}
