/**
 * @fileoverview WebSocket + 정적 파일 서버. LAN 환경에서 2인 한국 장기 대전을 중계한다.
 *
 * 아키텍처: 서버 권위 게임 상태
 * - 모든 룰 판정은 lib/game.js가 처리, 클라이언트는 입력 + 스냅샷만 받음
 * - 의존성 최소화: Node 내장 http + ws
 * - 안정성: 30초 heartbeat, 좀비 슬롯 청소
 *
 * 통합 라우터 지원:
 *   - `createApp()`을 export하여 launcher가 단일 포트(3000)에서 라우팅할 수 있게 한다.
 *   - 단독 실행 (`node server.js [--port N]`)도 그대로 지원.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import {
  createGameSession, applySetupChoice, applyMove,
  applyResign, applyDrawOffer, tickTimer, serializeState,
} from './lib/game.js';
import { getLegalMoves } from './lib/pieces.js';
import { wouldBeSelfCheck } from './lib/rules.js';

// ── 경로 + 설정 ───────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');

// ── 정적 파일 서빙 (public/) ─────────────────────────────────────
/** MIME 매핑. */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

/**
 * 장기 게임 앱 인스턴스를 생성한다.
 * 모든 룸 상태(players/game)는 closure로 격리되어 다른 게임과 공유되지 않는다.
 *
 * @param {object} [opts]
 * @param {() => string} [opts.getBotUrl]
 *   봇이 접속할 WS URL을 반환하는 함수 (mode=ai 사용자 진입 시 호출).
 *   launcher 통합 모드에서는 launcher가 `ws://localhost:{PORT}/janggi/ws?mode=bot` 를 넘기고,
 *   standalone 모드에서는 listen 포트로 자동 구성.
 * @returns {{ handleHttp: Function, handleUpgrade: Function }}
 */
export function createApp(opts = {}) {
  const getBotUrl = opts.getBotUrl || (() => null);
  // ── 룸 상태 (closure 격리, 2인 1룸 고정) ─────────────────────────
  /**
   * @typedef {Object} Player
   * @property {'p1'|'p2'} id
   * @property {'han'|'cho'} side
   * @property {import('ws').WebSocket} ws
   */

  /** @type {Player[]} */
  let players = [];
  /** @type {object|null} GameState */
  let game = null;
  /** @type {NodeJS.Timeout|null} 1초 타이머 */
  let tickInterval = null;
  /** @type {NodeJS.Timeout|null} 배치 선택 30초 타이머 */
  let setupTimer = null;
  /**
   * READY 선언한 playerId Set. 양쪽 모두 READY일 때만 게임 시작.
   * @type {Set<string>}
   */
  let readySet = new Set();

  // ── 브로드캐스트 유틸 ───────────────────────────────────────────

  /**
   * 모든 플레이어에게 현재 게임 상태 스냅샷을 브로드캐스트한다.
   */
  function broadcastState() {
    if (!game) return;
    const snapshot = serializeState(game);
    const msg = JSON.stringify({ type: 'STATE', ...snapshot });
    for (const p of players) {
      if (p.ws.readyState === 1) p.ws.send(msg);
    }
  }

  /**
   * 모든 플레이어에게 임의 페이로드 브로드캐스트.
   * @param {object} payload
   */
  function broadcastAll(payload) {
    const msg = JSON.stringify(payload);
    for (const p of players) {
      if (p.ws.readyState === 1) p.ws.send(msg);
    }
  }

  /**
   * 특정 플레이어에게 단일 메시지 전송.
   * @param {Player} player
   * @param {object} payload
   */
  function sendTo(player, payload) {
    if (player && player.ws.readyState === 1) {
      player.ws.send(JSON.stringify(payload));
    }
  }

  /**
   * playerId로 Player 객체를 찾는다.
   * @param {string} id
   * @returns {Player|undefined}
   */
  function findPlayer(id) {
    return players.find(p => p.id === id);
  }

  /**
   * side로 Player 객체를 찾는다.
   * @param {'han'|'cho'} side
   * @returns {Player|undefined}
   */
  function findPlayerBySide(side) {
    return players.find(p => p.side === side);
  }

  /**
   * 상대 Player를 반환한다.
   * @param {Player} player
   * @returns {Player|undefined}
   */
  function otherPlayer(player) {
    return players.find((p) => p.id !== player.id);
  }

  /**
   * 각 플레이어에게 자신 관점의 READY_STATE를 개별 전송한다.
   * (myReady = 본인, opponentReady = 상대 기준)
   */
  function broadcastReadyState() {
    for (const p of players) {
      const other = otherPlayer(p);
      sendTo(p, {
        type: 'READY_STATE',
        myReady: readySet.has(p.id),
        opponentReady: other ? readySet.has(other.id) : false,
      });
    }
  }

  /**
   * 양쪽 모두 입장 + 양쪽 모두 READY일 때만 게임 시작한다.
   * (기존 "2인 JOIN 즉시 배치선택" 대체)
   */
  function maybeStartGame() {
    if (players.length === 2 && readySet.size === 2 && !game) {
      game = createGameSession();
      console.log('[janggi] 양쪽 READY 완료 → 배치 선택 시작');
      broadcastAll({ type: 'GAME_START', phase: 'setup_cho' });
      broadcastState();
      // 초가 먼저 배치 선택 (30초 타이머)
      startSetupTimer('cho');
    }
  }

  // ── 시간 tick ────────────────────────────────────────────────────

  /**
   * 1초 타이머를 시작한다. playing 상태에서만 동작.
   */
  function startTickTimer() {
    if (tickInterval) clearInterval(tickInterval);
    tickInterval = setInterval(() => {
      if (!game || game.phase !== 'playing') return;
      const result = tickTimer(game);
      // 매 초 상태를 브로드캐스트 (시간 업데이트)
      broadcastState();
      if (result.timedOut) {
        broadcastAll({
          type: 'GAME_OVER',
          winner: game.winner,
          reason: 'timeout',
          scores: game.endScores,
        });
        stopTickTimer();
      }
    }, 1000);
  }

  /**
   * 1초 타이머를 정지한다.
   */
  function stopTickTimer() {
    if (tickInterval) {
      clearInterval(tickInterval);
      tickInterval = null;
    }
  }

  // ── 배치 선택 타이머 ──────────────────────────────────────────────

  /**
   * 배치 선택 30초 타이머를 시작한다.
   * @param {'han'|'cho'} side 선택할 진영
   */
  function startSetupTimer(side) {
    clearSetupTimer();
    broadcastAll({ type: 'SETUP_PROMPT', side, timeoutSec: 30 });
    setupTimer = setTimeout(() => {
      if (!game) return;
      // 시간 초과 시 MSMS 자동 선택
      const result = applySetupChoice(game, side, 'MSMS');
      console.log(`[janggi] 배치 선택 시간 초과 → ${side} MSMS 자동 선택`);
      if (result.gameStarted) {
        onGameStarted();
      } else if (result.nextPhase === 'setup_han') {
        startSetupTimer('han');
      }
      broadcastState();
    }, 30000);
  }

  /**
   * 배치 선택 타이머를 해제한다.
   */
  function clearSetupTimer() {
    if (setupTimer) {
      clearTimeout(setupTimer);
      setupTimer = null;
    }
  }

  /**
   * 양측 배치 완료 후 게임 시작 처리.
   */
  function onGameStarted() {
    clearSetupTimer();
    startTickTimer();
    broadcastAll({ type: 'GAME_START', phase: 'playing' });
  }

  // ── 봇 자식 프로세스 관리 (mode=ai 사용자가 들어왔을 때 자동 spawn) ────
  /** @type {import('child_process').ChildProcess|null} */
  let botChild = null;

  /**
   * 봇 자식 프로세스를 spawn한다. 이미 실행 중이면 무시.
   * bot.js가 없으면 경고 출력 후 스킵.
   */
  function spawnBotChild() {
    const botPath = path.join(__dirname, 'bot.js');
    if (!fs.existsSync(botPath)) {
      console.warn('[janggi] bot.js 없음 — 봇 spawn 스킵');
      return;
    }
    if (botChild && botChild.exitCode === null) {
      console.log('[janggi] 봇 이미 실행 중');
      return;
    }
    const url = getBotUrl();
    if (!url) {
      console.warn('[janggi] getBotUrl이 null 반환 — 봇 spawn 스킵');
      return;
    }
    console.log(`[janggi] 봇 spawn: ${url}`);
    botChild = spawn(process.execPath, [botPath, '--url', url], {
      detached: false,
      stdio: 'ignore',
    });
    botChild.on('exit', (code) => {
      console.log(`[janggi] 봇 종료 (code=${code})`);
      botChild = null;
    });
  }

  /**
   * 봇 자식 프로세스를 종료한다. mode=ai 사용자가 끊어졌을 때 호출.
   */
  function killBotChild() {
    if (botChild && botChild.exitCode === null) {
      console.log('[janggi] 봇 종료 요청');
      botChild.kill();
      botChild = null;
    }
  }

  // ── WebSocket 서버 (noServer 모드) ─────────────────────────────
  const wss = new WebSocketServer({ noServer: true });

  // ── WebSocket 핸들러 ──────────────────────────────────────────────
  wss.on('connection', (ws, req) => {
    // URL 쿼리에서 roomId, side, mode 파싱 (런처에서 전달)
    const url = new URL(req.url, 'http://localhost');
    const querySide = url.searchParams.get('side'); // 'han' | 'cho' | null
    const wsMode = url.searchParams.get('mode') || 'human'; // 'human' | 'ai' | 'bot'
    const isBot = wsMode === 'bot';
    ws._mode = wsMode;
    ws._isBot = isBot;

    // 정원 초과 직전, 좀비 슬롯 즉시 청소 시도
    if (players.length >= 2) {
      const before = players.length;
      players = players.filter((p) => p.ws.readyState <= 1);
      if (players.length < before) {
        console.log(`[janggi] 좀비 슬롯 ${before - players.length}개 청소`);
        if (players.length === 0) {
          game = null;
          stopTickTimer();
          clearSetupTimer();
        }
      }
    }

    // 재접속 시도: 기존 게임이 있고 슬롯이 비어있으면 재접속
    if (game && players.length < 2) {
      const existingSides = new Set(players.map(p => p.side));
      const missingSide = !existingSides.has('han') ? 'han'
        : !existingSides.has('cho') ? 'cho' : null;

      if (missingSide) {
        const playerId = missingSide === 'han' ? 'p1' : 'p2';
        ws.isAlive = true;
        ws.on('pong', () => { ws.isAlive = true; });

        /** @type {Player} */
        const player = { id: playerId, side: missingSide, ws };
        players.push(player);
        console.log(`[janggi] ${playerId}(${missingSide}) 재접속 (${players.length}/2)`);

        sendTo(player, { type: 'JOINED', playerId, side: missingSide, waiting: false });
        // 현재 게임 상태 즉시 전송 (재접속 복구)
        const snapshot = serializeState(game);
        sendTo(player, { type: 'STATE', ...snapshot });
        setupMessageHandler(ws, player);
        return;
      }
    }

    if (players.length >= 2) {
      ws.send(JSON.stringify({ type: 'ERROR', message: '방이 가득 찼다 (2/2)' }));
      ws.close();
      console.log('[janggi] 연결 거절: 룸 정원 초과');
      return;
    }

    // Heartbeat 상태 초기화
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    // 진영 배정: p1=한, p2=초 (기본). 쿼리로 명시 가능
    const playerId = players.length === 0 ? 'p1' : 'p2';
    let side;
    if (querySide === 'han' || querySide === 'cho') {
      // 요청한 진영이 이미 점유되었으면 반대편으로
      const taken = players.some(p => p.side === querySide);
      side = taken ? (querySide === 'han' ? 'cho' : 'han') : querySide;
    } else {
      side = playerId === 'p1' ? 'han' : 'cho';
    }

    /** @type {Player} */
    // 봇은 JOIN을 보내지 않으므로 서버가 즉시 name='AI'를 부여한다.
    const player = { id: playerId, side, ws, name: isBot ? 'AI' : '(알 수 없음)' };
    players.push(player);
    console.log(`[janggi] ${playerId}(${side}) 연결됨 (${players.length}/2)`);

    // JOINED 전송 — 상대가 이미 있으면 상대 이름 포함
    const existingOpp = otherPlayer(player);
    sendTo(player, {
      type: 'JOINED',
      playerId,
      side,
      waiting: players.length < 2,
      hasName: isBot,
      opponentName: (existingOpp && existingOpp.name && existingOpp.name !== '(알 수 없음)') ? existingOpp.name : undefined,
    });

    // 봇은 JOIN을 보내지 않으므로 connection 즉시 상대에게 알림
    if (isBot) {
      const human = otherPlayer(player);
      if (human) {
        sendTo(human, {
          type: 'JOINED',
          playerId: human.id,
          side: human.side,
          waiting: false,
          hasName: true,
          opponentName: 'AI',
        });
      }
      broadcastReadyState();
    }

    if (wsMode === 'ai' && !isBot && players.length === 1) {
      // mode=ai 사용자가 혼자 들어왔다 → 봇 자동 spawn (자기 자식 프로세스).
      // 봇이 connect하면 READY 게이트를 통해 게임 시작.
      // 약간의 지연: 사용자가 JOINED를 받기 전 봇이 먼저 와서 side 충돌 가능성 회피.
      setTimeout(() => spawnBotChild(), 200);
    }

    setupMessageHandler(ws, player);
  });

  /**
   * 플레이어 WS에 메시지 핸들러를 등록한다.
   * @param {import('ws').WebSocket} ws
   * @param {Player} player
   */
  function setupMessageHandler(ws, player) {
    // ── 메시지 라우터 ──
    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch (e) {
        console.warn('[janggi] JSON 파싱 실패:', data.toString());
        return;
      }

      switch (msg.type) {
        case 'JOIN': {
          // 닉네임 전달. name 누락 시 '(알 수 없음)' 폴백(후방호환 — JOIN 미수신 smoke 무영향).
          const raw = typeof msg.name === 'string' ? msg.name.trim().slice(0, 12) : '';
          player.name = raw || '(알 수 없음)';
          console.log(`[janggi] JOIN: ${player.id} → "${player.name}"`);
          // 상대가 이미 있으면 상대에게 opponentName 포함 JOINED 재전송
          const other = otherPlayer(player);
          if (other) {
            sendTo(other, {
              type: 'JOINED',
              playerId: other.id,
              side: other.side,
              waiting: false,
              hasName: true,
              opponentName: player.name,
            });
          }
          broadcastReadyState();
          break;
        }

        case 'READY': {
          // 양방향 READY 게이트. 양쪽 READY 시에만 게임 시작.
          readySet.add(player.id);
          console.log(`[janggi] READY: ${player.id} (readySet.size=${readySet.size})`);
          broadcastReadyState();
          if (readySet.size === 2) {
            maybeStartGame();
          }
          break;
        }

        case 'SELECT_SETUP': {
          if (!game) break;
          const code = msg.setup || msg.code;
          const result = applySetupChoice(game, player.side, code);
          if (!result.ok) {
            sendTo(player, { type: 'ERROR', message: result.error });
            break;
          }
          console.log(`[janggi] SELECT_SETUP: ${player.id}(${player.side}) → ${code}`);
          clearSetupTimer();
          broadcastState();

          if (result.gameStarted) {
            onGameStarted();
          } else if (result.nextPhase === 'setup_han') {
            startSetupTimer('han');
          }
          break;
        }

        case 'MOVE': {
          if (!game) break;
          const { fromFile, fromRank, toFile, toRank } = msg;
          const result = applyMove(game, player.side, fromFile, fromRank, toFile, toRank);
          if (!result.ok) {
            sendTo(player, { type: 'ERROR', message: result.error });
            break;
          }
          console.log(`[janggi] MOVE: ${player.id}(${player.side}) (${fromFile},${fromRank})→(${toFile},${toRank})`);

          if (result.check) {
            broadcastAll({ type: 'CHECK', side: game.turn });
          }

          broadcastState();

          if (result.gameOver) {
            broadcastAll({
              type: 'GAME_OVER',
              winner: game.winner,
              reason: game.endReason,
              scores: game.endScores,
            });
            stopTickTimer();
          }
          break;
        }

        case 'RESIGN': {
          if (!game) break;
          const result = applyResign(game, player.side);
          if (!result.ok) {
            sendTo(player, { type: 'ERROR', message: result.error });
            break;
          }
          console.log(`[janggi] RESIGN: ${player.id}(${player.side})`);
          broadcastState();
          broadcastAll({
            type: 'GAME_OVER',
            winner: game.winner,
            reason: 'resign',
            scores: null,
          });
          stopTickTimer();
          break;
        }

        case 'DRAW_OFFER': {
          if (!game) break;
          const result = applyDrawOffer(game, player.side, 'offer');
          if (!result.ok) {
            sendTo(player, { type: 'ERROR', message: result.error });
            break;
          }
          console.log(`[janggi] DRAW_OFFER: ${player.id}(${player.side})`);
          broadcastAll({ type: 'DRAW_OFFERED', by: player.side });
          break;
        }

        case 'DRAW_ACCEPT': {
          if (!game) break;
          const result = applyDrawOffer(game, player.side, 'accept');
          if (!result.ok) {
            sendTo(player, { type: 'ERROR', message: result.error });
            break;
          }
          console.log(`[janggi] DRAW_ACCEPT: ${player.id}(${player.side})`);
          broadcastState();
          broadcastAll({
            type: 'GAME_OVER',
            winner: game.winner,
            reason: 'draw_score',
            scores: game.endScores,
          });
          stopTickTimer();
          break;
        }

        case 'REQUEST_MOVES': {
          if (!game || game.phase !== 'playing') break;
          const { file, rank } = msg;
          const piece = game.board ? game.board[rank]?.[file] : null;
          if (!piece || piece.side !== player.side) {
            sendTo(player, { type: 'LEGAL_MOVES', file, rank, moves: [] });
            break;
          }
          // 자살수 제외 합법 수 산출
          const candidates = getLegalMoves(game.board, file, rank)
            .filter(m => !wouldBeSelfCheck(game.board, file, rank, m.file, m.rank));
          sendTo(player, { type: 'LEGAL_MOVES', file, rank, moves: candidates });
          break;
        }

        default:
          console.warn(`[janggi] 알 수 없는 메시지 타입: ${msg.type}`);
      }
    });

    ws.on('close', () => {
      console.log(`[janggi] ${player.id}(${player.side}) 연결 해제 (mode=${ws._mode})`);
      const disconnectedName = player.name || '(알 수 없음)';
      readySet.delete(player.id);
      players = players.filter((p) => p.id !== player.id);
      // 사람(mode=ai)이 끊긴 경우: 봇 자식 프로세스도 같이 종료.
      // 새 사용자가 다시 들어오면 새 봇이 spawn된다.
      if (!ws._isBot) {
        killBotChild();
      }
      if (players.length === 0) {
        game = null;
        stopTickTimer();
        clearSetupTimer();
      } else {
        broadcastAll({
          type: 'OPPONENT_LEFT',
          name: disconnectedName,
          message: `${disconnectedName}님이 나갔습니다.`,
        });
        game = null;
        stopTickTimer();
        clearSetupTimer();
      }
    });

    ws.on('error', (err) => {
      console.error(`[janggi] ${player.id} WS 에러:`, err.message);
    });
  }

  // ── Heartbeat: 30초마다 ping ────────────────────────────────────
  const HEARTBEAT_INTERVAL_MS = 30000;
  const heartbeatTimer = setInterval(() => {
    for (const p of [...players]) {
      if (p.ws.isAlive === false) {
        console.log(`[janggi] ${p.id} heartbeat 응답 없음 → 강제 종료`);
        p.ws.terminate();
        continue;
      }
      p.ws.isAlive = false;
      try { p.ws.ping(); } catch (e) { /* 이미 닫힌 ws */ }
    }
  }, HEARTBEAT_INTERVAL_MS);

  wss.on('close', () => {
    clearInterval(heartbeatTimer);
    stopTickTimer();
    clearSetupTimer();
  });

  // ── HTTP 핸들러 (정적 파일 서빙) ──────────────────────────────
  /**
   * 정적 파일 응답 핸들러. public/ 외 경로는 차단 (디렉토리 탈출 방지).
   * @param {http.IncomingMessage} req
   * @param {http.ServerResponse} res
   */
  function handleHttp(req, res) {
    const reqUrl = req.url || '/';
    const reqPath = reqUrl.split('?')[0] || '/';
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
   * HTTP upgrade 이벤트를 WS로 전달한다 (noServer 모드).
   * @param {http.IncomingMessage} req
   * @param {import('net').Socket} socket
   * @param {Buffer} head
   */
  function handleUpgrade(req, socket, head) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  }

  return { handleHttp, handleUpgrade };
}

// ──────────────────────────────────────────────────────────────
// 단독 실행 모드: `node server.js [--port N]`
// ──────────────────────────────────────────────────────────────

/**
 * 현재 모듈이 직접 실행되었는지 (vs launcher가 import) 판정한다.
 * 윈도우 경로 구분자 차이를 흡수.
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
  const PORT = portFlagIndex >= 0 && argv[portFlagIndex + 1]
    ? parseInt(argv[portFlagIndex + 1], 10)
    : 3006;

  const app = createApp({
    // 단독 실행 시 봇 WS URL 제공 (mode=ai 사용자 진입 시 봇 자동 spawn 지원)
    getBotUrl: () => `ws://localhost:${PORT}/ws?mode=bot`,
  });
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);

  // ── 호스트 IP 자동 감지 ──────────────────────────────────────────
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

  // ── 콘솔 배너 ────────────────────────────────────────────────────
  function supportsAnsi() {
    if (process.env.NO_COLOR) return false;
    if (process.env.TERM === 'dumb') return false;
    if (!process.stdout || !process.stdout.isTTY) return false;
    return true;
  }

  const ANSI = supportsAnsi()
    ? { reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m', magenta: '\x1b[35m' }
    : { reset: '', bold: '', dim: '', cyan: '', green: '', yellow: '', magenta: '' };

  function padBoxLine(text, width) {
    const visible = text.replace(/\x1b\[[0-9;]*m/g, '');
    const padLen = Math.max(0, width - visible.length);
    return text + ' '.repeat(padLen);
  }

  function printBanner(port, lanIps) {
    const W = 60;
    const top   = `+${'-'.repeat(W)}+`;
    const sep   = `+${'-'.repeat(W)}+`;
    const empty = `|${' '.repeat(W)}|`;
    const line  = (s) => `|${padBoxLine(s, W)}|`;

    console.log('');
    console.log(ANSI.cyan + top + ANSI.reset);
    console.log(ANSI.cyan + line(`  ${ANSI.bold}JANGGI${ANSI.reset}${ANSI.cyan} - LAN 1:1 한국 장기`) + ANSI.reset);
    console.log(ANSI.cyan + sep + ANSI.reset);
    console.log(ANSI.cyan + line(`  ${ANSI.yellow}호스트 PC 접속:${ANSI.reset}`) + ANSI.reset);
    console.log(ANSI.cyan + line(`    ${ANSI.green}http://localhost:${port}${ANSI.reset}`) + ANSI.reset);
    console.log(ANSI.cyan + empty + ANSI.reset);
    console.log(ANSI.cyan + line(`  ${ANSI.yellow}친구 PC 접속:${ANSI.reset}`) + ANSI.reset);
    if (lanIps.length > 0) {
      for (const entry of lanIps) {
        const tag = entry.virtual ? ANSI.dim + ' (가상)' + ANSI.reset : '';
        console.log(ANSI.cyan + line(`    ${ANSI.green}http://${entry.ip}:${port}${ANSI.reset}${tag}`) + ANSI.reset);
      }
    } else {
      console.log(ANSI.cyan + line(`    ${ANSI.dim}(LAN IP 미감지 - ipconfig로 확인)${ANSI.reset}`) + ANSI.reset);
    }
    console.log(ANSI.cyan + empty + ANSI.reset);
    console.log(ANSI.cyan + line(`  ${ANSI.dim}종료: Ctrl+C${ANSI.reset}`) + ANSI.reset);
    console.log(ANSI.cyan + top + ANSI.reset);
    console.log('');
  }

  // ── 서버 시작 ────────────────────────────────────────────────────
  server.on('error', (err) => {
    console.error('[janggi] HTTP 에러:', err.message);
    process.exit(1);
  });

  server.listen(PORT, '0.0.0.0', () => {
    const lanIps = getLanAddresses();
    printBanner(PORT, lanIps);
    console.log(ANSI.dim
      + ' Tip: 처음 실행 시 Windows Defender 방화벽 팝업이 뜨면 "개인 네트워크"에 체크 후 액세스 허용.'
      + ANSI.reset);
    console.log('');
  });
}
