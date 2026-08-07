/**
 * @fileoverview 끝말잇기 배틀 WebSocket + 정적 파일 서버.
 *
 * 아키텍처: **서버 권위(Server Authoritative)**
 *  - 단어 유효성 검증, HP 계산, 게이지 계산, 가비지 발동, 타이머 관리, 승패 판정
 *    모두 서버 game.js 순수 함수에서 처리한다.
 *  - 클라이언트는 WORD_SUBMIT { word } 입력만 전송한다.
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
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import {
  createGame, submitWord, applyTimerExpiry, applyResign,
  isGameOver, snapshot, TURN_TIMER_SEC,
} from './game.js';
import { loadWords, getWordSet, buildGarbageCandidates } from './words.js';

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
};

/** 카운트다운 시간 (초) */
const COUNTDOWN_SEC = 3;

// ── 단어 DB 초기화 ──────────────────────────────────────────────
const wordSet = loadWords();
const garbageCandidates = buildGarbageCandidates(50);

// ── createApp ───────────────────────────────────────────────────

/**
 * 끝말잇기 배틀 앱 인스턴스를 생성한다.
 * 모든 룸 상태는 closure로 격리된다.
 *
 * @param {object} [opts]
 * @param {string} [opts.hostUrl] LAN 접속 URL
 * @returns {{ handleHttp: Function, handleUpgrade: Function, setHostUrl: Function }}
 */
export function createApp(opts = {}) {
  let HOST_URL = typeof opts.hostUrl === 'string' ? opts.hostUrl : '';

  // ── 룸 상태 (closure 격리, 2인 1룸 고정) ─────────────────

  /**
   * @typedef {Object} Player
   * @property {string} id 'p1' | 'p2'
   * @property {import('ws').WebSocket} ws
   * @property {string} name 닉네임
   * @property {boolean} joined JOIN 메시지 처리 완료 여부
   */

  /** @type {Player[]} */
  let players = [];

  /** @type {import('./game.js').GameState|null} */
  let game = null;

  /** @type {Object<string, NodeJS.Timeout>} 플레이어별 타이머 핸들 */
  const timers = {};

  /** @type {Object<string, NodeJS.Timeout>} 플레이어별 tick 인터벌 핸들 */
  const tickIntervals = {};

  /** 리매치 동의한 playerId Set. */
  let rematchPending = new Set();

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

  // ── 타이머 관리 ────────────────────────────────────────────

  /**
   * 특정 플레이어의 제출 타이머를 시작(리셋)한다.
   * @param {string} playerId
   */
  function startTimer(playerId) {
    clearTimer(playerId);

    let remaining = TURN_TIMER_SEC;

    // 1초 간격 틱 전송
    tickIntervals[playerId] = setInterval(() => {
      remaining--;
      broadcastAll({ type: 'TIMER_TICK', playerId, remaining });
      if (remaining <= 0) {
        clearInterval(tickIntervals[playerId]);
        delete tickIntervals[playerId];
      }
    }, 1000);

    // 만료 타이머
    timers[playerId] = setTimeout(() => {
      if (!game || game.phase !== 'playing') return;

      const { hpLoss, newHp } = applyTimerExpiry(game, playerId);
      broadcastAll({ type: 'TIMER_EXPIRED', playerId, hpLoss, newHp });
      broadcastState();

      // HP 체크
      const over = isGameOver(game);
      if (over.ended) {
        handleGameEnd();
        return;
      }

      // 타이머 재시작
      startTimer(playerId);
    }, TURN_TIMER_SEC * 1000);
  }

  /**
   * 특정 플레이어의 타이머를 정지한다.
   * @param {string} playerId
   */
  function clearTimer(playerId) {
    if (timers[playerId]) {
      clearTimeout(timers[playerId]);
      delete timers[playerId];
    }
    if (tickIntervals[playerId]) {
      clearInterval(tickIntervals[playerId]);
      delete tickIntervals[playerId];
    }
  }

  /**
   * 모든 타이머를 정지한다.
   */
  function clearAllTimers() {
    for (const pid of Object.keys(timers)) clearTimer(pid);
  }

  // ── 게임 시작/종료 ─────────────────────────────────────────

  /**
   * 카운트다운 후 게임을 시작한다.
   */
  function startCountdown() {
    const p1 = players.find((p) => p.id === 'p1');
    const p2 = players.find((p) => p.id === 'p2');
    game = createGame(
      p1 ? p1.name : '플레이어1',
      p2 ? p2.name : '플레이어2',
    );
    game.phase = 'countdown';
    rematchPending = new Set();

    broadcastAll({
      type: 'GAME_START',
      players: Object.values(game.players).map((p) => ({
        id: p.id,
        name: p.name,
        hp: p.hp,
        gauge: p.gauge,
      })),
      countdown: COUNTDOWN_SEC,
    });

    console.log('[wordchain] 카운트다운 시작');

    setTimeout(() => {
      if (!game || game.phase !== 'countdown') return;
      game.phase = 'playing';
      broadcastAll({ type: 'PLAYING' });
      broadcastState();

      // 양쪽 타이머 시작
      startTimer('p1');
      startTimer('p2');
      console.log('[wordchain] 게임 시작');
    }, COUNTDOWN_SEC * 1000);
  }

  /**
   * 게임 종료를 처리한다.
   */
  function handleGameEnd() {
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

  wss.on('connection', (ws) => {
    // 좀비 슬롯 정리
    const dead = players.filter((p) => p.ws.readyState !== WebSocket.OPEN);
    if (dead.length > 0) {
      for (const z of dead) {
        try { z.ws.terminate(); } catch (e) { /* noop */ }
      }
      players = players.filter((p) => p.ws.readyState === WebSocket.OPEN);
      if (players.length === 0) { game = null; clearAllTimers(); }
    }

    // 정원 초과 거절
    if (players.length >= 2) {
      sendJson(ws, { type: 'ERROR', message: '방이 가득 찼다 (2/2)' });
      ws.close();
      return;
    }

    // 슬롯 배정
    const usedIds = new Set(players.map((p) => p.id));
    const playerId = ['p1', 'p2'].find((id) => !usedIds.has(id)) || 'p1';
    const player = { id: playerId, ws, name: '', joined: false };
    players.push(player);
    console.log(`[wordchain] ${playerId} 연결됨 (${players.length}/2)`);

    // JOINED 즉시 전송
    sendJson(ws, {
      type: 'JOINED',
      yourId: playerId,
      waiting: players.length < 2,
      hostUrl: HOST_URL,
    });

    // ── 메시지 라우터 ──
    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch (e) { return; }
      if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;

      switch (msg.type) {
        case 'JOIN': {
          const raw = typeof msg.name === 'string' ? msg.name.trim().slice(0, 12) : '';
          player.name = raw || '(알 수 없음)';
          player.joined = true;
          console.log(`[wordchain] JOIN: ${player.id} → "${player.name}"`);

          // 양쪽 입장 완료 시 카운트다운 시작
          if (players.length === 2 && players.every((p) => p.joined) && !game) {
            const otherPlayer = players.find((p) => p.id !== player.id);
            if (otherPlayer) {
              sendJson(otherPlayer.ws, {
                type: 'JOINED',
                yourId: otherPlayer.id,
                waiting: false,
                hostUrl: HOST_URL,
              });
            }
            startCountdown();
          }
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

          const result = submitWord(game, player.id, word, wordSet, garbageCandidates);

          if (!result.ok) {
            broadcastAll({
              type: 'WORD_REJECTED',
              playerId: player.id,
              word,
              reason: result.reason,
            });
            break;
          }

          // 단어 수락
          broadcastAll({
            type: 'WORD_ACCEPTED',
            playerId: player.id,
            word,
            gaugeGain: result.gaugeGain,
            newGauge: result.newGauge,
            newLastSyllable: result.newLastSyllable,
            garbagedOpponent: result.garbageFired,
            garbageChar: result.garbageChar,
          });

          // 가비지 발동 시 알림
          if (result.garbageFired) {
            broadcastAll({
              type: 'GARBAGE_RECEIVED',
              targetId: result.garbageTargetId,
              garbageChar: result.garbageChar,
            });
          }

          // 상태 브로드캐스트
          broadcastState();

          // HP 체크
          const over = isGameOver(game);
          if (over.ended) {
            handleGameEnd();
            break;
          }

          // 타이머 리셋
          startTimer(player.id);
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
      players = players.filter((p) => p.id !== player.id);
      rematchPending.delete(player.id);

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
    let urlPath = (reqPath === '/' || reqPath === '') ? '/index.html' : reqPath;

    // assets/ 경로는 프로젝트 루트의 assets/ 디렉토리에서 서빙
    if (urlPath.startsWith('/assets/')) {
      const safePath = path.normalize(urlPath).replace(/^([\\/])+/, '');
      const fullPath = path.join(__dirname, safePath);
      if (!fullPath.startsWith(__dirname)) {
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
      return;
    }

    // public/ 디렉토리에서 서빙
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
    : 3008;

  const app = createApp({ hostUrl: '' });

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
