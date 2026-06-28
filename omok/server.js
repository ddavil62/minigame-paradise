/**
 * @fileoverview 오목(Gomoku) WebSocket + 정적 파일 서버.
 *
 * 아키텍처: **서버 권위(Server Authoritative)**
 *  - 착수 검증·승리 판정은 모두 서버 game.js 순수 함수에서 처리한다.
 *  - 클라이언트는 PLACE { row, col } / RESIGN {} 입력만 전송한다.
 *  - 매 착수 후 STATE를 양쪽에 동일하게 broadcast 한다(정보 비대칭 없음).
 *  - 의존성 최소화: Node 내장 http + ws (Express 미사용 — yahtzee 패턴 차용).
 *
 * 입장 흐름(janggi 패턴 — READY 단계 없음):
 *  1. 첫 연결 → playerId='p1', color='black'
 *  2. 두 번째 연결 → playerId='p2', color='white'
 *  3. 두 플레이어 모두 입장 → createGame() → GAME_START + STATE broadcast
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
import { createGame, placeStone, applyResign, snapshot } from './game.js';

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

/**
 * 오목 게임 앱 인스턴스를 생성한다.
 * 모든 룸 상태(players/game)는 closure로 격리되어 다른 게임과 공유되지 않는다.
 *
 * @param {object} [opts]
 * @param {string} [opts.hostUrl] LAN 접속 URL (JOINED 메시지에 포함, 친구 안내용)
 * @param {() => string} [opts.getBotUrl]
 *   봇이 접속할 WS URL을 반환하는 함수 (mode=ai 사용자 진입 시 호출).
 * @returns {{ handleHttp: Function, handleUpgrade: Function, setHostUrl: Function }}
 */
export function createApp(opts = {}) {
  // closure 변수: standalone listen 이후 setHostUrl로 갱신 가능.
  let HOST_URL = typeof opts.hostUrl === 'string' ? opts.hostUrl : '';
  const getBotUrl = typeof opts.getBotUrl === 'function' ? opts.getBotUrl : (() => null);

  // ── 룸 상태 (closure 격리, 2인 1룸 고정) ─────────────────
  /**
   * @typedef {Object} Player
   * @property {string} id    'p1' | 'p2'
   * @property {'black'|'white'} color p1=black(선공), p2=white
   * @property {import('ws').WebSocket} ws
   * @property {string} name  닉네임. JOIN 수신 전까지 '' (봇은 'AI' 자동).
   */

  /** @type {Player[]} */
  let players = [];
  /** @type {import('./game.js').OmokState|null} */
  let game = null;
  /** 리매치 동의한 playerId Set. 2명 모두 동의 시 새 판 시작. */
  let rematchPending = new Set();
  /**
   * READY 선언한 playerId Set. 양쪽 모두 READY일 때만 createGame().
   * 신규 게임/리매치 진입 시마다 초기화한다.
   * @type {Set<string>}
   */
  let readySet = new Set();
  /**
   * 직전 게임 종료 결과(색 swap 결정용). null이면 아직 종료 안 됨(또는 새 판 진행 중).
   * @type {null|{winner:'black'|'white'|'draw', reason:string}}
   */
  let lastGameResult = null;

  /**
   * 모든 플레이어에게 동일한 STATE 스냅샷을 broadcast 한다.
   */
  function broadcastState() {
    if (!game) return;
    const msg = JSON.stringify(snapshot(game));
    for (const p of players) {
      if (p.ws.readyState === 1) p.ws.send(msg);
    }
  }

  /**
   * 모든 플레이어에게 임의 페이로드를 broadcast 한다.
   * @param {object} payload
   */
  function broadcastAll(payload) {
    const msg = JSON.stringify(payload);
    for (const p of players) {
      if (p.ws.readyState === 1) p.ws.send(msg);
    }
  }

  /**
   * 특정 플레이어에게 단일 메시지를 보낸다.
   * @param {Player} player
   * @param {object} payload
   */
  function sendTo(player, payload) {
    if (player && player.ws.readyState === 1) {
      player.ws.send(JSON.stringify(payload));
    }
  }

  /**
   * 양쪽 모두 입장 + 양쪽 모두 READY일 때만 새 게임을 시작한다.
   * (READY 게이트 — 기존 "양쪽 접속 즉시 시작"을 대체)
   */
  function maybeStartGameIfReady() {
    if (players.length === 2 && readySet.size === 2 && !game) {
      game = createGame();
      console.log('[omok] 양쪽 READY 완료 → 게임 시작');
      broadcastAll({ type: 'GAME_START', phase: 'playing' });
      broadcastState();
    }
  }

  /**
   * 상대 player를 반환한다.
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
   * 게임이 종료됐으면 GAME_OVER를 broadcast 한다.
   * @returns {boolean} 종료됐으면 true
   */
  function maybeBroadcastGameOver() {
    if (game && game.phase === 'ended' && game.result) {
      const payload = {
        type: 'GAME_OVER',
        winner: game.result.winner,
        reason: game.result.reason,
      };
      if (game.result.winLine) payload.winLine = game.result.winLine;
      broadcastAll(payload);
      // 리매치 색 swap 결정에 사용할 직전 결과를 저장하고 동의 상태를 초기화한다.
      lastGameResult = { winner: game.result.winner, reason: game.result.reason };
      rematchPending = new Set();
      return true;
    }
    return false;
  }

  /**
   * 색 → 상대 색.
   * @param {'black'|'white'} color
   * @returns {'black'|'white'}
   */
  function opponentColor(color) {
    return color === 'black' ? 'white' : 'black';
  }

  /**
   * 리매치 시 다음 판 흑을 결정하고 players 배열의 color를 재배정한다.
   * players의 id(p1/p2)는 변경하지 않고 color 필드만 swap 한다.
   *
   * 규칙(목적 정의서 D-7 선공 결정):
   *  - winner=black/white(승/패·기권) → 진 쪽이 다음 흑(선공)
   *  - winner=draw  → 색 교체(직전 백 → 다음 흑)
   *
   * @returns {string} nextBlack — 다음 판 흑을 맡는 playerId ('p1'|'p2')
   */
  function swapColorsForRematch() {
    const lastResult = lastGameResult;
    if (lastResult && lastResult.winner === 'draw') {
      // 무승부: 직전 색을 그대로 교체.
      for (const p of players) p.color = opponentColor(p.color);
    } else if (lastResult) {
      // 승/패·기권: 진 쪽(loserColor 보유자)이 다음 흑.
      const loserColor = opponentColor(lastResult.winner);
      for (const p of players) {
        p.color = (p.color === loserColor) ? 'black' : 'white';
      }
    }
    const blackPlayer = players.find((p) => p.color === 'black');
    return blackPlayer ? blackPlayer.id : 'p1';
  }

  // ── 봇 자식 프로세스 관리 (mode=ai 사용자 진입 시 자동 spawn) ────
  /** @type {import('child_process').ChildProcess|null} */
  let botChild = null;

  /**
   * 봇 자식 프로세스를 spawn한다. 이미 실행 중이면 무시.
   */
  function spawnBotChild() {
    const botPath = path.join(__dirname, 'bot.js');
    if (!fs.existsSync(botPath)) {
      console.warn('[omok] bot.js 없음 — 봇 spawn 스킵');
      return;
    }
    if (botChild && botChild.exitCode === null) {
      console.log('[omok] 봇 이미 실행 중');
      return;
    }
    const url = getBotUrl();
    if (!url) {
      console.warn('[omok] getBotUrl이 null 반환 — 봇 spawn 스킵');
      return;
    }
    console.log(`[omok] 봇 spawn: ${url}`);
    botChild = spawn(process.execPath, [botPath, '--url', url], {
      detached: false,
      stdio: 'ignore',
    });
    botChild.on('exit', (code) => {
      console.log(`[omok] 봇 종료 (code=${code})`);
      botChild = null;
    });
  }

  /**
   * 봇 자식 프로세스를 종료한다. mode=ai 사용자가 끊어졌을 때 호출.
   */
  function killBotChild() {
    if (botChild && botChild.exitCode === null) {
      console.log('[omok] 봇 종료 요청');
      botChild.kill();
      botChild = null;
    }
  }

  // ── WebSocket 서버 (noServer 모드) ─────────────────────────────
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws, req) => {
    // URL 쿼리에서 mode 파싱 (launcher가 mode=ai|bot|human 전달).
    const reqUrlObj = new URL(req.url || '/', 'http://localhost');
    const wsMode = reqUrlObj.searchParams.get('mode') || 'human';
    const isBot = wsMode === 'bot';
    ws._mode = wsMode;
    ws._isBot = isBot;

    // 사람(비봇)이 새로 연결될 때, 정원 판정 직전에 "죽은/닫히는" 슬롯만 선제 정리한다 (#13 안전망).
    // 살아있는(OPEN) 봇은 보존한다 — AI채우기 플로우는 봇이 먼저 접속하므로 전체 sweep 금지.
    // readyState가 OPEN이 아닌(좀비) 슬롯만 축출해 누적된 죽은 연결만 정리한다.
    if (!isBot) {
      const dead = players.filter((p) => p.ws.readyState !== WebSocket.OPEN);
      if (dead.length > 0) {
        for (const z of dead) {
          try {
            z.ws.terminate();
          } catch (e) {}
        }
        players = players.filter((p) => p.ws.readyState === WebSocket.OPEN);
        console.log(`[omok] 죽은(좀비) 슬롯 ${dead.length}개 선제 제거`);
        if (players.length === 0) game = null;
      }
    }

    // 룸 정원 초과 시 즉시 거절.
    if (players.length >= 2) {
      ws.send(JSON.stringify({ type: 'ERROR', message: '방이 가득 찼다 (2/2)' }));
      ws.close();
      console.log('[omok] 연결 거절: 룸 정원 초과');
      return;
    }

    // Heartbeat 상태 초기화.
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    const playerId = players.length === 0 ? 'p1' : 'p2';
    const color = playerId === 'p1' ? 'black' : 'white';
    /** @type {Player} */
    // 봇은 JOIN 메시지를 보내지 않으므로 서버가 즉시 name='AI'를 부여한다.
    const player = { id: playerId, color, ws, name: isBot ? 'AI' : '' };
    players.push(player);
    console.log(`[omok] ${playerId}(${color}) 연결됨 (${players.length}/2, mode=${wsMode})`);

    // JOINED 즉시 전송 (opponentName은 JOIN 수신 후 별도 전송).
    // 상대가 이미 입장+JOIN 했으면 그 이름을 함께 실어 보낸다.
    const existingOpp = otherPlayer(player);
    sendTo(player, {
      type: 'JOINED',
      playerId: player.id,
      color: player.color,
      waiting: players.length < 2,
      hostUrl: HOST_URL,
      opponentName: (existingOpp && existingOpp.name) ? existingOpp.name : undefined,
    });

    // 봇은 JOIN을 보내지 않으므로 서버가 connection 즉시 JOIN 처리를 대행한다.
    if (isBot) {
      const human = otherPlayer(player);
      if (human) {
        // 사람에게 상대(봇) 입장 + 이름 고지.
        sendTo(human, {
          type: 'JOINED',
          playerId: human.id,
          color: human.color,
          waiting: false,
          hostUrl: HOST_URL,
          opponentName: 'AI',
        });
      }
      broadcastReadyState();
    }

    // mode=ai 사용자가 혼자 들어왔다 → 봇 자동 spawn (자기 자식 프로세스).
    // 봇이 connect하면 두 번째 슬롯을 차지하고 게임을 시작한다.
    if (wsMode === 'ai' && !isBot && players.length === 1) {
      setTimeout(() => spawnBotChild(), 200);
    }

    // ── 메시지 라우터 ──
    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch (e) {
        console.warn('[omok] JSON 파싱 실패:', data.toString());
        return;
      }

      switch (msg.type) {
        case 'JOIN': {
          // 닉네임 전달. name 누락 시 '(알 수 없음)' 폴백(후방호환 — JOIN 미수신 smoke 무영향).
          const raw = typeof msg.name === 'string' ? msg.name.trim().slice(0, 12) : '';
          player.name = raw || '(알 수 없음)';
          console.log(`[omok] JOIN: ${player.id} → "${player.name}"`);
          // 상대가 이미 있으면 상대에게 opponentName 포함 JOINED 재전송(상대 이름 갱신).
          const other = otherPlayer(player);
          if (other) {
            sendTo(other, {
              type: 'JOINED',
              playerId: other.id,
              color: other.color,
              waiting: false,
              hostUrl: HOST_URL,
              opponentName: player.name,
            });
          }
          // READY_STATE 초기 전송(양쪽 아직 not ready 또는 현재 상태 반영).
          broadcastReadyState();
          break;
        }

        case 'READY': {
          // 양방향 READY 게이트. 양쪽 READY 시에만 게임 시작.
          readySet.add(player.id);
          console.log(`[omok] READY: ${player.id} (readySet.size=${readySet.size})`);
          broadcastReadyState();
          if (readySet.size === 2) {
            maybeStartGameIfReady();
          }
          break;
        }

        case 'PLACE': {
          if (!game) {
            sendTo(player, { type: 'ERROR', message: '게임이 시작되지 않았습니다.' });
            break;
          }
          const result = placeStone(game, player.color, msg.row, msg.col);
          if (!result.ok) {
            sendTo(player, { type: 'ERROR', message: result.error });
            break;
          }
          console.log(`[omok] PLACE: ${player.id}(${player.color}) → (${msg.row},${msg.col}) moveCount=${game.moveCount}`);
          broadcastState();
          maybeBroadcastGameOver();
          break;
        }

        case 'RESIGN': {
          if (!game) {
            sendTo(player, { type: 'ERROR', message: '게임이 시작되지 않았습니다.' });
            break;
          }
          const result = applyResign(game, player.color);
          if (!result.ok) {
            sendTo(player, { type: 'ERROR', message: result.error });
            break;
          }
          console.log(`[omok] RESIGN: ${player.id}(${player.color}) → winner=${result.winner}`);
          broadcastState();
          maybeBroadcastGameOver();
          break;
        }

        case 'REMATCH': {
          // 게임 종료 전 요청은 무시.
          if (!lastGameResult) {
            sendTo(player, { type: 'ERROR', message: '게임 종료 후에만 리매치 가능합니다.' });
            break;
          }
          rematchPending.add(player.id);

          if (rematchPending.size < 2) {
            // 한 쪽만 동의 → 상대에게 REMATCH_WAITING 알림.
            const other = players.find((p) => p.id !== player.id);
            if (other) sendTo(other, { type: 'REMATCH_WAITING' });
            break;
          }

          // 양쪽 동의 → 색 swap. 단, createGame은 양쪽 READY 후로 미룬다(포크 D).
          const nextBlack = swapColorsForRematch();
          lastGameResult = null;
          rematchPending = new Set();
          // READY 게이트 재진입: 이전 READY 상태 초기화 → 양쪽 다시 READY 필요.
          readySet = new Set();
          // 직전 게임(phase='ended')을 폐기한다. game이 null이어야 양쪽 READY 시
          // maybeStartGameIfReady의 `!game` 조건이 통과해 createGame이 실행된다.
          // (BOT-004 회귀: game 리셋 누락 시 양쪽 READY여도 GAME_START 미발생)
          game = null;
          // game은 아직 생성하지 않는다(READY 후 maybeStartGameIfReady가 생성).

          broadcastAll({ type: 'REMATCH_START', nextBlack });
          // 각 플레이어에게 갱신된 color 정보 포함 JOINED 재전송(color 변경 고지) + READY_STATE 초기 전송.
          for (const p of players) {
            sendTo(p, {
              type: 'JOINED',
              playerId: p.id,
              color: p.color,
              waiting: false,
              hostUrl: HOST_URL,
              opponentName: (otherPlayer(p) && otherPlayer(p).name) ? otherPlayer(p).name : undefined,
            });
          }
          broadcastReadyState();
          // GAME_START/STATE는 양쪽 READY 후 maybeStartGameIfReady에서 전송.
          console.log(`[omok] 리매치 색 배정 — nextBlack=${nextBlack} (READY 대기)`);
          break;
        }

        default:
          console.warn(`[omok] 알 수 없는 메시지 타입: ${msg.type}`);
      }
    });

    // ── 연결 해제 ──
    ws.on('close', () => {
      console.log(`[omok] ${player.id} 연결 해제 (mode=${ws._mode})`);
      players = players.filter((p) => p.id !== player.id);
      // 리매치/READY 동의 추적에서 제거(나간 사람은 동의 무효).
      rematchPending.delete(player.id);
      readySet.delete(player.id);
      // 사람(mode=ai)이 끊긴 경우: 봇 자식 프로세스도 같이 종료.
      if (!ws._isBot) {
        // 짝 봇 슬롯을 동기 제거 + terminate (#13 좀비 봇 차단).
        // killBotChild()의 SIGTERM은 비동기라 봇 WS가 실제 close될 때까지 players에 좀비로 남는다.
        const botSlot = players.find((p) => p.ws._isBot);
        if (botSlot) {
          players = players.filter((p) => !p.ws._isBot);
          try {
            botSlot.ws.terminate();
          } catch (e) {}
        }
        killBotChild();
      }
      if (players.length === 0) {
        game = null;
        lastGameResult = null;
        rematchPending = new Set();
        readySet = new Set();
      } else {
        broadcastAll({
          type: 'OPPONENT_LEFT',
          name: player.name || '(알 수 없음)',
          message: '상대방이 나갔어요.',
        });
        game = null; // 1명 남으면 게임 무효화 → 두 번째 접속 시 새 게임.
        // 남은 사람은 다시 1인 대기 → 본인 READY도 무효화(상대 합류 후 다시 READY).
        readySet = new Set();
        broadcastReadyState();
      }
    });

    ws.on('error', (err) => {
      console.error(`[omok] ${player.id} WS 에러:`, err.message);
    });
  });

  // ── Heartbeat: 30초마다 ping, 응답 없는 좀비 연결 강제 종료 ────────
  const HEARTBEAT_INTERVAL_MS = 30000;
  const heartbeatTimer = setInterval(() => {
    for (const p of [...players]) {
      if (p.ws.isAlive === false) {
        console.log(`[omok] ${p.id} heartbeat 응답 없음 → 강제 종료`);
        p.ws.terminate();
        continue;
      }
      p.ws.isAlive = false;
      try { p.ws.ping(); } catch (e) { /* ws 이미 닫힘 — 다음 사이클에 정리됨 */ }
    }
  }, HEARTBEAT_INTERVAL_MS);

  wss.on('close', () => { clearInterval(heartbeatTimer); });

  // ── HTTP 핸들러 (정적 파일 서빙) ──────────────────────────────
  /**
   * 정적 파일 응답 핸들러. public/ 외 경로는 차단한다(디렉토리 탈출 방지).
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
   * HTTP upgrade 이벤트를 WS로 전달한다(noServer 모드).
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
   * standalone listen 이후 LAN URL이 결정되면 호출. JOINED 메시지에 포함된다.
   * @param {string} url
   */
  function setHostUrl(url) {
    HOST_URL = typeof url === 'string' ? url : '';
  }

  return { handleHttp, handleUpgrade, setHostUrl };
}

// ──────────────────────────────────────────────────────────────
// 단독 실행 모드: `node server.js [--port N]`
// 포트 충돌 시 자동 폴백.
// ──────────────────────────────────────────────────────────────

/**
 * 현재 모듈이 직접 실행되었는지(vs launcher가 import) 판정한다.
 * @returns {boolean}
 */
function isDirectExecution() {
  if (!process.argv[1]) return false;
  const argvPath = process.argv[1].replace(/\\/g, '/');
  const metaPath = import.meta.url.replace('file:///', '').replace('file://', '');
  return metaPath === argvPath || metaPath.endsWith(argvPath);
}

if (isDirectExecution() && !process.env.OMOK_NO_LISTEN) {
  const argv = process.argv.slice(2);
  const portFlagIndex = argv.indexOf('--port');
  const REQUESTED_PORT = portFlagIndex >= 0 && argv[portFlagIndex + 1]
    ? parseInt(argv[portFlagIndex + 1], 10)
    : 3012;
  let HOST_URL = '';
  // 단독 실행 시 봇 WS URL을 listen 콜백에서 결정된 포트로 동적 구성.
  let listeningPort = 0;

  const app = createApp({
    hostUrl: '',
    getBotUrl: () => (listeningPort > 0
      ? `ws://localhost:${listeningPort}/ws?mode=bot`
      : null),
  });

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

  function printBanner(port, lanIps, requestedPort) {
    const W = 60;
    const top   = `+${'-'.repeat(W)}+`;
    const sep   = `+${'-'.repeat(W)}+`;
    const empty = `|${' '.repeat(W)}|`;
    const line  = (s) => `|${padBoxLine(s, W)}|`;

    console.log('');
    console.log(ANSI.cyan + top + ANSI.reset);
    console.log(ANSI.cyan + line(`  ${ANSI.bold}OMOK${ANSI.reset}${ANSI.cyan} - LAN 1:1 오목`) + ANSI.reset);
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
      console.log(ANSI.cyan + line(`    ${ANSI.dim}(LAN IP 미감지 — ipconfig로 확인)${ANSI.reset}`) + ANSI.reset);
    }
    console.log(ANSI.cyan + empty + ANSI.reset);
    console.log(ANSI.cyan + line(`  ${ANSI.dim}종료: Ctrl+C${ANSI.reset}`) + ANSI.reset);
    if (port !== requestedPort) {
      console.log(ANSI.cyan + line(`  ${ANSI.magenta}* 요청 포트 ${requestedPort} 사용 중 → ${port}로 폴백${ANSI.reset}`) + ANSI.reset);
    }
    console.log(ANSI.cyan + top + ANSI.reset);
    console.log('');
  }

  // ── 서버 시작 (포트 충돌 시 자동 폴백) ─────────────────────
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
        console.log(`[omok] 포트 ${port} 사용 중. ${port + 1}로 재시도...`);
        setTimeout(() => startListening(port + 1, attemptsLeft - 1), 100);
        return;
      }
      console.error('[omok] listen 에러:', err && err.message ? err.message : err);
      process.exit(1);
    };
    server.once('error', onError);
    // LAN 접속을 허용하기 위해 0.0.0.0에 바인딩.
    server.listen(port, '0.0.0.0', () => {
      server.removeListener('error', onError);
      listeningPort = port;
      const lanIps = getLanAddresses();
      HOST_URL = lanIps.length > 0
        ? `http://${lanIps[0].ip}:${port}`
        : `http://localhost:${port}`;
      app.setHostUrl(HOST_URL);
      printBanner(port, lanIps, REQUESTED_PORT);
      console.log(ANSI.dim
        + ' Tip: 처음 실행 시 Windows Defender 방화벽 팝업이 뜨면 "개인 네트워크"에 체크 후 액세스 허용.'
        + ANSI.reset);
      console.log('');
    });
  }

  startListening(REQUESTED_PORT, MAX_PORT_FALLBACK);
}
