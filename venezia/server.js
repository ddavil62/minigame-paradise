/**
 * @fileoverview 베네치아 타이핑 배틀 WebSocket + 정적 파일 서버.
 *
 * 아키텍처: **서버 권위(Server Authoritative)**
 *  - 단어 생성·HP·공격 판정 모두 서버 game.js 순수 함수에서 처리한다.
 *  - 클라이언트는 WORD_SUBMIT { wordId, text } 입력만 전송한다.
 *  - 의존성 최소화: Node 내장 http + ws (Express 미사용).
 *
 * 입장 흐름:
 *  1. 첫 연결 → playerId='p1'
 *  2. 두 번째 연결 → playerId='p2'
 *  3. 두 플레이어 모두 입장 → createGame() → GAME_START + 단어 스폰 루프 시작
 *  4. mode=ai 단독 진입 → 200ms 후 spawnBotChild()
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
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import {
  createGame, spawnWord, submitWord,
  applyResign, snapshot, countActiveWords, expireWords,
  MAX_ACTIVE_WORDS,
  WORD_MISS_DAMAGE,
  rollItemDrop,
  applyItemEffect,
  applyDamage,
  checkGameOver,
  resetCombo,
  setFallSpeed,
} from './game.js';
import { pickWordByTime } from './words.js';

// ── 경로 + 설정 ───────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');

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
  '.webp': 'image/webp',
};

/** 단어 스폰 간격 (ms). */
const WORD_SPAWN_INTERVAL = 1500;

/**
 * 베네치아 타이핑 배틀 앱 인스턴스를 생성한다.
 * 모든 룸 상태는 closure로 격리된다.
 *
 * @param {object} [opts]
 * @param {string} [opts.hostUrl] LAN 접속 URL
 * @param {() => string} [opts.getBotUrl] 봇 접속 WS URL 반환 함수
 * @param {(combo:number) => object} [opts.rollItemDrop] 테스트용 아이템 추첨 함수
 * @param {(playerId:string) => boolean} [opts.shouldSpawnWord] 테스트용 스폰 대상 필터
 * @returns {{ handleHttp: Function, handleUpgrade: Function, setHostUrl: Function }}
 */
export function createApp(opts = {}) {
  let HOST_URL = typeof opts.hostUrl === 'string' ? opts.hostUrl : '';
  const getBotUrl = typeof opts.getBotUrl === 'function' ? opts.getBotUrl : (() => null);
  const itemDropRoller = typeof opts.rollItemDrop === 'function' ? opts.rollItemDrop : rollItemDrop;
  const shouldSpawnWord = typeof opts.shouldSpawnWord === 'function' ? opts.shouldSpawnWord : (() => true);

  // ── 룸 상태 (closure 격리, 2인 1룸 고정) ─────────────────
  /**
   * @typedef {Object} Player
   * @property {string} id 'p1' | 'p2'
   * @property {import('ws').WebSocket} ws
   * @property {string} name 닉네임
   */

  /** @type {Player[]} */
  let players = [];
  /** @type {import('./game.js').VeneziaState|null} */
  let game = null;
  /** 단어 스폰 타이머 핸들. */
  let wordSpawnTimer = null;
  /** 단어 만료 체크 타이머 핸들. */
  let wordExpireTimer = null;
  /** 리매치 동의한 playerId Set. */
  let rematchPending = new Set();
  /** @type {import('child_process').ChildProcess|null} */
  let botChild = null;
  /** 아이템 효과 타이머 (키: `${playerId}_${effect}` → clearTimeout 핸들). */
  const itemTimers = new Map();

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
   * 각 플레이어에게 개별 STATE 스냅샷을 보낸다.
   */
  function broadcastState() {
    if (!game) return;
    for (const p of players) {
      if (p.ws.readyState === WebSocket.OPEN) {
        sendJson(p.ws, snapshot(game, p.id));
      }
    }
  }

  /**
   * 서버가 보유한 아이템 슬롯 전체를 해당 플레이어에게 동기화한다.
   * @param {string} playerId 동기화 대상 ID
   */
  function syncItemSlots(playerId) {
    if (!game || !game.players[playerId]) return;
    const player = players.find((entry) => entry.id === playerId);
    if (!player) return;
    sendJson(player.ws, {
      type: 'ITEM_SLOTS_SYNC',
      slots: game.players[playerId].itemSlots.map((item) => ({ ...item })),
    });
  }

  // ── 단어 스폰 루프 ────────────────────────────────────────

  /**
   * 1.5초마다 각 플레이어에게 독립적으로 새 단어를 생성·전송한다.
   */
  function startWordSpawn() {
    wordSpawnTimer = setInterval(() => {
      if (!game || game.phase !== 'playing') return;
      const elapsed = (Date.now() - game.startedAt) / 1000;

      for (const p of players) {
        if (!shouldSpawnWord(p.id)) continue;
        if (countActiveWords(game, p.id) < MAX_ACTIVE_WORDS) {
          const { text, difficulty } = pickWordByTime(elapsed);
          const word = spawnWord(game, p.id, text, difficulty);
          sendJson(p.ws, { type: 'WORD_ADDED', word });
          // 상대에게 내 단어 전송 — 상대 화면에 미니 뷰로 표시.
          const other = players.find((op) => op.id !== p.id);
          if (other && other.ws.readyState === WebSocket.OPEN) {
            sendJson(other.ws, { type: 'OPP_WORD_ADDED', word });
          }
        }
      }
    }, WORD_SPAWN_INTERVAL);

    // 급류의 2배속 만료와 Canvas 바닥 도달 시점을 가깝게 맞춘다.
    wordExpireTimer = setInterval(() => {
      if (!game || game.phase !== 'playing') return;
      const nowRelative = Date.now() - game.startedAt;
      const expired = expireWords(game, nowRelative);
      if (expired.length > 0) {
        const damageByOwner = new Map();
        for (const word of expired) {
          damageByOwner.set(word.ownerId, (damageByOwner.get(word.ownerId) || 0) + WORD_MISS_DAMAGE);
        }
        for (const [ownerId, requestedDamage] of damageByOwner) {
          const damage = applyDamage(game, ownerId, requestedDamage);
          resetCombo(game, ownerId);
          const victim = players.find((p) => p.id === ownerId);
          if (victim) {
            sendJson(victim.ws, {
              type: 'HIT',
              damage,
              source: 'word_missed',
              wordIds: expired.filter((word) => word.ownerId === ownerId).map((word) => word.id),
            });
          }
        }
        // 만료된 단어를 플레이어별로 분류하여 각각에게 전송.
        // myIds: 본인 단어 만료, oppIds: 상대 단어 만료 (상대 화면에서 제거).
        for (const p of players) {
          const myIds  = expired.filter((w) => w.ownerId === p.id).map((w) => w.id);
          const oppIds = expired.filter((w) => w.ownerId !== p.id).map((w) => w.id);
          sendJson(p.ws, { type: 'WORDS_EXPIRED', wordIds: myIds, oppWordIds: oppIds });
        }
        broadcastState();
        const gameOver = checkGameOver(game);
        if (gameOver.ended) handleGameEnd();
      }
    }, 50);
  }

  /**
   * 스폰 루프를 정지한다.
   */
  function stopWordSpawn() {
    if (wordSpawnTimer) { clearInterval(wordSpawnTimer); wordSpawnTimer = null; }
    if (wordExpireTimer) { clearInterval(wordExpireTimer); wordExpireTimer = null; }
    // 아이템 효과 타이머 정리
    for (const timer of itemTimers.values()) {
      clearTimeout(timer);
    }
    itemTimers.clear();
  }

  // ── 게임 시작/종료 ─────────────────────────────────────────

  /**
   * 양쪽 입장 완료 시 게임을 시작한다.
   */
  function startGame() {
    const p1 = players.find((p) => p.id === 'p1');
    const p2 = players.find((p) => p.id === 'p2');
    game = createGame(p1 ? p1.name : '플레이어1', p2 ? p2.name : '플레이어2');
    rematchPending = new Set();
    console.log('[venezia] 게임 시작');
    broadcastAll({ type: 'GAME_START', phase: 'playing' });
    broadcastState();
    syncItemSlots('p1');
    syncItemSlots('p2');
    startWordSpawn();
  }

  /**
   * 게임 종료를 브로드캐스트한다.
   */
  function handleGameEnd() {
    stopWordSpawn();
    if (!game || !game.result) return;
    for (const p of players) {
      const isWinner = game.result.winner === p.id;
      sendJson(p.ws, {
        type: 'GAME_OVER',
        winner: game.result.winner,
        reason: game.result.reason,
        myHp: game.players[p.id].hp,
        opponentHp: game.players[p.id === 'p1' ? 'p2' : 'p1'].hp,
      });
    }
  }

  // ── 봇 관리 ────────────────────────────────────────────────

  /**
   * 봇 자식 프로세스를 spawn한다.
   */
  function spawnBotChild() {
    const botPath = path.join(__dirname, 'bot.js');
    if (!fs.existsSync(botPath)) {
      console.warn('[venezia] bot.js 없음 — 봇 spawn 스킵');
      return;
    }
    if (botChild && botChild.exitCode === null) {
      console.log('[venezia] 봇 이미 실행 중');
      return;
    }
    const url = getBotUrl();
    if (!url) {
      console.warn('[venezia] getBotUrl이 null 반환 — 봇 spawn 스킵');
      return;
    }
    console.log(`[venezia] 봇 spawn: ${url}`);
    botChild = spawn(process.execPath, [botPath, '--url', url], {
      detached: false,
      stdio: 'ignore',
    });
    botChild.on('exit', (code) => {
      console.log(`[venezia] 봇 종료 (code=${code})`);
      botChild = null;
    });
  }

  /**
   * 봇 자식 프로세스를 종료한다.
   */
  function killBotChild() {
    if (botChild && botChild.exitCode === null) {
      console.log('[venezia] 봇 종료 요청');
      botChild.kill();
      botChild = null;
    }
  }

  // ── WebSocket 서버 (noServer 모드) ─────────────────────────
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws, req) => {
    const reqUrlObj = new URL(req.url || '/', 'http://localhost');
    const wsMode = reqUrlObj.searchParams.get('mode') || 'human';
    const isBot = wsMode === 'bot';
    ws._mode = wsMode;
    ws._isBot = isBot;

    // 좀비 슬롯 정리
    if (!isBot) {
      const dead = players.filter((p) => p.ws.readyState !== WebSocket.OPEN);
      if (dead.length > 0) {
        for (const z of dead) {
          try { z.ws.terminate(); } catch (e) {}
        }
        players = players.filter((p) => p.ws.readyState === WebSocket.OPEN);
        if (players.length === 0) { game = null; stopWordSpawn(); }
      }
    }

    // 정원 초과 거절
    if (players.length >= 2) {
      ws.send(JSON.stringify({ type: 'ERROR', message: '방이 가득 찼다 (2/2)' }));
      ws.close();
      return;
    }

    // 슬롯 배정
    const usedIds = new Set(players.map((p) => p.id));
    const playerId = ['p1', 'p2'].find((id) => !usedIds.has(id)) || 'p1';
    const player = { id: playerId, ws, name: isBot ? 'AI' : '' };
    players.push(player);
    console.log(`[venezia] ${playerId} 연결됨 (${players.length}/2, mode=${wsMode})`);

    // JOINED 즉시 전송
    sendJson(ws, {
      type: 'JOINED',
      playerId,
      waiting: players.length < 2,
      hostUrl: HOST_URL,
    });

    // 봇은 JOIN을 보내지 않으므로 즉시 처리
    if (isBot) {
      // 양쪽 입장 완료 시 게임 시작
      if (players.length === 2 && !game) {
        startGame();
      }
    }

    // mode=ai 사용자가 혼자 들어왔을 때 봇 자동 spawn
    if (wsMode === 'ai' && !isBot && players.length === 1) {
      setTimeout(() => spawnBotChild(), 200);
    }

    // ── 메시지 라우터 ──
    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch (e) { return; }
      if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;

      switch (msg.type) {
        case 'JOIN': {
          const raw = typeof msg.playerName === 'string' ? msg.playerName.trim().slice(0, 12) : '';
          player.name = raw || '(알 수 없음)';
          console.log(`[venezia] JOIN: ${player.id} → "${player.name}"`);

          // 양쪽 입장 완료 시 게임 시작
          if (players.length === 2 && !game) {
            // 상대에게도 입장 알림
            const other = players.find((p) => p.id !== player.id);
            if (other) {
              sendJson(other.ws, {
                type: 'JOINED',
                playerId: other.id,
                waiting: false,
                hostUrl: HOST_URL,
              });
            }
            startGame();
          }
          break;
        }

        case 'WORD_SUBMIT': {
          if (!game || game.phase !== 'playing') {
            sendJson(ws, { type: 'ERROR', message: '게임이 진행 중이 아닙니다.' });
            break;
          }
          const { wordId, text } = msg;
          if (!wordId || typeof text !== 'string') {
            sendJson(ws, { type: 'ERROR', message: '잘못된 제출 형식입니다.' });
            break;
          }

          const result = submitWord(game, player.id, wordId, text);
          if (!result.ok) {
            sendJson(ws, { type: 'ERROR', message: result.error });
            break;
          }

          // 성공: 제출자에게 WORD_CLEARED 전송
          sendJson(ws, {
            type: 'WORD_CLEARED',
            wordId,
            attackDamage: result.damage,
          });
          // 상대에게 내 단어 클리어 알림 — 상대 화면에서 해당 단어 제거.
          const otherPlayer = players.find((p) => p.id !== player.id);
          if (otherPlayer && otherPlayer.ws.readyState === WebSocket.OPEN) {
            sendJson(otherPlayer.ws, { type: 'OPP_WORD_CLEARED', wordId });
            sendJson(otherPlayer.ws, {
              type: 'HIT',
              damage: result.damage,
              source: 'word_clear',
              attackerId: player.id,
              wordId,
            });
          }

          // STATE 브로드캐스트
          broadcastState();

          const gameOver = checkGameOver(game);
          if (gameOver.ended) {
            handleGameEnd();
            break;
          }

          // ── 아이템 드랍 판정 ──
          const combo = result.combo;
          const drop = itemDropRoller(combo);
          if (drop.dropped) {
            const playerState = game.players[player.id];
            if (playerState.itemSlots.length < 3) {
              const slotIndex = playerState.itemSlots.length;
              playerState.itemSlots.push({ itemId: drop.itemId, emoji: drop.emoji, name: drop.name });
              sendJson(ws, {
                type: 'ITEM_GRANTED',
                itemId: drop.itemId,
                emoji: drop.emoji,
                name: drop.name,
                slotIndex,
              });
              syncItemSlots(player.id);
            }
            // 슬롯 3개 이상이면 폐기 (메시지 없음)
          }
          break;
        }

        case 'RESIGN': {
          if (!game) break;
          const resignResult = applyResign(game, player.id);
          if (resignResult.ok) {
            handleGameEnd();
          }
          break;
        }

        case 'ITEM_USED': {
          if (!game || game.phase !== 'playing') {
            if (game) syncItemSlots(player.id);
            break;
          }
          const { slotIndex: usedSlotIndex } = msg;
          if (typeof usedSlotIndex !== 'number' || usedSlotIndex < 0 || usedSlotIndex > 2) {
            syncItemSlots(player.id);
            break;
          }

          const itemResult = applyItemEffect(game, player.id, usedSlotIndex);
          syncItemSlots(player.id);
          if (!itemResult.ok) break;

          // 방어막으로 차단된 경우
          if (itemResult.blocked) {
            broadcastAll({
              type: 'ITEM_EFFECT_START',
              effect: 'shield_blocked',
              targetId: itemResult.targetId,
              attackerId: player.id,
              durationMs: null,
            });
            break;
          }

          // 아이템 종류별 처리
          const usedItem = itemResult.item;
          const itemTargetId = itemResult.targetId;

          switch (usedItem.itemId) {
            case 'item_bomb': {
              // 상대에게 hard 단어 2개 강제 스폰
              broadcastAll({
                type: 'ITEM_EFFECT_START',
                effect: 'bomb',
                targetId: itemTargetId,
                attackerId: player.id,
                durationMs: null,
              });
              const elapsed = (Date.now() - game.startedAt) / 1000;
              for (let i = 0; i < 2; i++) {
                const { text: bombText } = pickWordByTime(elapsed);
                const bombWord = spawnWord(game, itemTargetId, bombText, 'hard');
                // 대상에게 WORD_ADDED
                const targetPlayer = players.find((p) => p.id === itemTargetId);
                if (targetPlayer) sendJson(targetPlayer.ws, { type: 'WORD_ADDED', word: bombWord });
                // 사용자에게 OPP_WORD_ADDED
                const attackerPlayer = players.find((p) => p.id === player.id);
                if (attackerPlayer) sendJson(attackerPlayer.ws, { type: 'OPP_WORD_ADDED', word: bombWord });
              }
              break;
            }
            case 'item_freeze': {
              // item_freeze는 구버전 호환 ID이며 사용자 효과는 4초간 2배속 급류다.
              const fastFallNow = Date.now() - game.startedAt;
              const fallClockMs = setFallSpeed(game, itemTargetId, 2, fastFallNow);
              broadcastAll({
                type: 'ITEM_EFFECT_START',
                effect: 'fast_fall',
                targetId: itemTargetId,
                attackerId: player.id,
                durationMs: 4000,
                serverNowRelative: fastFallNow,
                fallClockMs,
                fallSpeedMultiplier: 2,
              });
              broadcastState();
              const fastFallKey = `${itemTargetId}_fast_fall`;
              // 재사용 시 배율은 2배로 유지하고 종료 시각만 마지막 사용부터 갱신한다.
              if (itemTimers.has(fastFallKey)) clearTimeout(itemTimers.get(fastFallKey));
              const effectGame = game;
              const fastFallTimer = setTimeout(() => {
                itemTimers.delete(fastFallKey);
                if (game !== effectGame || !game.players[itemTargetId]) return;
                const endNow = Date.now() - game.startedAt;
                const endFallClockMs = setFallSpeed(game, itemTargetId, 1, endNow);
                broadcastAll({
                  type: 'ITEM_EFFECT_END',
                  effect: 'fast_fall',
                  targetId: itemTargetId,
                  serverNowRelative: endNow,
                  fallClockMs: endFallClockMs,
                  fallSpeedMultiplier: 1,
                });
                broadcastState();
              }, 4000);
              itemTimers.set(fastFallKey, fastFallTimer);
              break;
            }
            case 'item_dark': {
              // dark 효과: 5초
              broadcastAll({
                type: 'ITEM_EFFECT_START',
                effect: 'dark',
                targetId: itemTargetId,
                attackerId: player.id,
                durationMs: 5000,
              });
              const darkKey = `${itemTargetId}_dark`;
              if (itemTimers.has(darkKey)) clearTimeout(itemTimers.get(darkKey));
              const darkTimer = setTimeout(() => {
                itemTimers.delete(darkKey);
                if (game && game.players[itemTargetId]) {
                  game.players[itemTargetId].dark = false;
                }
                broadcastAll({
                  type: 'ITEM_EFFECT_END',
                  effect: 'dark',
                  targetId: itemTargetId,
                });
              }, 5000);
              itemTimers.set(darkKey, darkTimer);
              break;
            }
            case 'item_shield': {
              // 본인 방어막 설정 알림
              broadcastAll({
                type: 'ITEM_EFFECT_START',
                effect: 'shield',
                targetId: player.id,
                attackerId: player.id,
                durationMs: null,
              });
              break;
            }
            case 'item_heal': {
              // HP 회복 알림 + STATE 브로드캐스트
              broadcastAll({
                type: 'ITEM_EFFECT_START',
                effect: 'heal',
                targetId: player.id,
                attackerId: player.id,
                durationMs: null,
              });
              broadcastState();
              break;
            }
            default:
              break;
          }
          break;
        }

        case 'REMATCH': {
          if (!game || game.phase !== 'ended') {
            sendJson(ws, { type: 'ERROR', message: '게임 종료 후에만 리매치 가능합니다.' });
            break;
          }
          rematchPending.add(player.id);

          if (rematchPending.size < 2) {
            const other = players.find((p) => p.id !== player.id);
            if (other) sendJson(other.ws, { type: 'REMATCH_WAITING', ready: true });
            break;
          }

          // 양쪽 동의 → 새 게임 시작
          rematchPending = new Set();
          broadcastAll({ type: 'REMATCH_START' });
          game = null;
          startGame();
          break;
        }

        default:
          break;
      }
    });

    // ── 연결 해제 ──
    ws.on('close', () => {
      console.log(`[venezia] ${player.id} 연결 해제`);
      players = players.filter((p) => p.id !== player.id);
      rematchPending.delete(player.id);

      if (!ws._isBot) {
        const botSlot = players.find((p) => p.ws._isBot);
        if (botSlot) {
          players = players.filter((p) => !p.ws._isBot);
          try { botSlot.ws.terminate(); } catch (e) {}
        }
        killBotChild();
      }

      if (players.length === 0) {
        game = null;
        stopWordSpawn();
        rematchPending = new Set();
      } else {
        broadcastAll({ type: 'OPPONENT_LEFT' });
        game = null;
        stopWordSpawn();
        rematchPending = new Set();
      }
    });

    ws.on('error', (err) => {
      console.error(`[venezia] ${player.id} WS 에러:`, err.message);
    });
  });

  // ── HTTP 핸들러 (정적 파일 서빙) ────────────────────────────
  /**
   * 정적 파일 응답 핸들러.
   * @param {http.IncomingMessage} req
   * @param {http.ServerResponse} res
   */
  function handleHttp(req, res) {
    const reqUrl = req.url || '/';
    const reqPath = reqUrl.split('?')[0] || '/';
    if (req.method === 'POST' && (reqPath === '/lobby/return' || reqPath === '/venezia/lobby/return')) {
      broadcastAll({ type: 'RETURN_TO_LOBBY' });
      res.writeHead(204, { 'Cache-Control': 'no-store' });
      res.end();
      return;
    }
    const urlPath = (reqPath === '/' || reqPath === '') ? '/index.html' : reqPath;
    const safePath = path.normalize(urlPath).replace(/^([\\/])+/, '');
    const fullPath = path.join(PUBLIC_DIR, safePath);
    if (!fullPath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    fs.readFile(fullPath, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }
      const ext = path.extname(fullPath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(data);
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
    : 3017;
  let listeningPort = 0;

  const app = createApp({
    hostUrl: '',
    getBotUrl: () => (listeningPort > 0
      ? `ws://localhost:${listeningPort}/ws?mode=bot`
      : null),
  });

  // ── LAN IP 감지 ────────────────────────────────────────────
  const VIRTUAL_IF_PATTERNS = [
    /vEthernet/i, /VirtualBox/i, /VMware/i, /Hyper-?V/i, /WSL/i, /Loopback Pseudo/i,
  ];

  function isVirtualInterface(name) {
    return VIRTUAL_IF_PATTERNS.some((re) => re.test(name));
  }

  function interfacePriority(name) {
    if (isVirtualInterface(name)) return 9;
    if (/wi-?fi|wireless|wlan|wlp/i.test(name)) return 0;
    if (/ethernet|이더넷|eth\d|enp/i.test(name)) return 1;
    return 2;
  }

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

  function startListening(port, attemptsLeft) {
    const server = http.createServer(app.handleHttp);
    server.on('upgrade', app.handleUpgrade);

    let handled = false;
    const onError = (err) => {
      if (handled) return;
      handled = true;
      server.removeListener('error', onError);
      if (err && err.code === 'EADDRINUSE' && attemptsLeft > 0) {
        console.log(`[venezia] 포트 ${port} 사용 중. ${port + 1}로 재시도...`);
        setTimeout(() => startListening(port + 1, attemptsLeft - 1), 100);
        return;
      }
      console.error('[venezia] listen 에러:', err && err.message ? err.message : err);
      process.exit(1);
    };
    server.once('error', onError);

    server.listen(port, '0.0.0.0', () => {
      server.removeListener('error', onError);
      listeningPort = port;
      const lanIps = getLanAddresses();
      const HOST_URL = lanIps.length > 0
        ? `http://${lanIps[0].ip}:${port}`
        : `http://localhost:${port}`;
      app.setHostUrl(HOST_URL);
      console.log(`[venezia] 서버 시작: http://localhost:${port}`);
      if (lanIps.length > 0) {
        console.log(`[venezia] LAN 접속: ${HOST_URL}`);
      }
    });
  }

  startListening(REQUESTED_PORT, MAX_PORT_FALLBACK);
}
