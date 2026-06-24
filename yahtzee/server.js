/**
 * @fileoverview 요트 다이스(Yahtzee) WebSocket + 정적 파일 서버.
 *
 * 아키텍처: **서버 권위(Server Authoritative)**
 * - 다이스 랜덤·점수 계산·턴 진행은 모두 서버에서만 처리한다(game.js 순수 함수).
 * - 클라이언트는 keep 선택 + 카테고리 선택 입력만 전송한다.
 * - 매 액션 후 STATE를 양쪽에 동일하게 broadcast 한다(정보 비대칭 없음).
 * - 의존성 최소화: Node 내장 http + ws (Express 미사용 — hanabi 패턴 차용).
 *
 * 통합 라우터 지원:
 *   - createApp()을 export하여 launcher가 단일 포트(3000)에서 라우팅한다.
 *   - 단독 실행(`node server.js [--port N]`)도 지원하며 포트 충돌 시 자동 폴백.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import {
  createGame,
  rollDice,
  scoreCategory,
  toggleKeep,
  snapshot,
} from './game.js';

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
 * 요트 다이스 게임 앱 인스턴스를 생성한다.
 * 모든 룸 상태(players/game)는 closure로 격리되어 다른 게임과 공유되지 않는다.
 *
 * @param {object} [opts]
 * @param {string} [opts.hostUrl] LAN 접속 URL (JOINED 메시지에 포함, 친구 안내용)
 * @param {() => string} [opts.getBotUrl]
 *   봇이 접속할 WS URL을 반환하는 함수 (mode=ai 사용자 진입 시 호출).
 *   launcher 통합 모드에서는 launcher가 `ws://localhost:{PORT}/yahtzee/ws?mode=bot` 를 넘기고,
 *   standalone 모드에서는 listen 포트로 자동 구성.
 * @returns {{ handleHttp: Function, handleUpgrade: Function, setHostUrl: Function }}
 */
export function createApp(opts = {}) {
  // closure 변수: standalone listen 이후 setHostUrl로 갱신 가능.
  let HOST_URL = typeof opts.hostUrl === 'string' ? opts.hostUrl : '';
  const getBotUrl = typeof opts.getBotUrl === 'function' ? opts.getBotUrl : (() => null);

  // ── 룸 상태 (closure 격리) ──────────────────────────────
  /**
   * @typedef {Object} Player
   * @property {string} id   'p1' ~ 'p4'
   * @property {string} name
   * @property {boolean} joined JOIN 메시지 수신 여부
   * @property {boolean} ready READY 수신 여부(전원 READY 시 게임 시작)
   * @property {boolean} rematchReady
   * @property {import('ws').WebSocket} ws
   */

  /** @type {Player[]} */
  let players = [];
  /** @type {import('./game.js').GameState|null} */
  let game = null;
  /** N인 룸 정원. 첫 접속자의 ?players=N 쿼리로 결정. 기본 2(하위 호환). */
  let roomMaxPlayers = 2;
  /** 플레이어 ID 탐색용 상수. */
  const ALL_IDS = ['p1', 'p2', 'p3', 'p4'];

  /**
   * 모든 플레이어에게 동일한 STATE 스냅샷을 broadcast 한다.
   * (Yahtzee는 정보 비대칭이 없어 마스킹 불필요.)
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
   * 상대 player를 반환한다(2인 전용 헬퍼).
   * @param {Player} player
   * @returns {Player|undefined}
   */
  function otherPlayer(player) {
    return players.find((p) => p.id !== player.id);
  }

  /**
   * 각 플레이어에게 자신 관점의 READY_STATE를 개별 전송한다.
   * (myReady = 본인, opponentReady = 상대 기준 — 오목 패턴)
   * 후방 호환: 기존 READY_STATUS도 동시 broadcast 한다.
   */
  function broadcastReadyState() {
    // 오목 패턴: 개별 전송 READY_STATE
    for (const p of players) {
      const other = otherPlayer(p);
      sendTo(p, {
        type: 'READY_STATE',
        myReady: p.ready,
        opponentReady: other ? other.ready : false,
      });
    }
    // 후방 호환: 기존 READY_STATUS broadcast (N인 확장 형식)
    const readyStatus = { type: 'READY_STATUS' };
    for (const p of players) {
      readyStatus[p.id + 'Ready'] = p.ready;
    }
    broadcastAll(readyStatus);
  }

  /**
   * 게임이 종료됐으면 GAME_OVER를 broadcast 한다.
   * N인 확장: totals 객체에 전원 합계 포함. 후방 호환으로 p1Total/p2Total도 유지.
   * @returns {boolean} 종료됐으면 true
   */
  function maybeBroadcastGameOver() {
    if (game && game.phase === 'ended') {
      broadcastAll({
        type: 'GAME_OVER',
        winner: game.result.winner,
        totals: game.result.totals,
        // 후방 호환: 2인 시 기존 p1Total/p2Total 필드 유지
        p1Total: game.result.p1Total,
        p2Total: game.result.p2Total,
        breakdown: game.result.breakdown,
      });
      return true;
    }
    return false;
  }

  /**
   * 새 게임을 시작하고 START + STATE를 전송한다.
   * N인 확장: players 배열의 ID를 createGame에 전달한다.
   */
  function startNewGame() {
    game = createGame(players.map((p) => p.id));
    for (const p of players) {
      p.ready = false;
      p.rematchReady = false;
    }
    broadcastAll({ type: 'START' });
    broadcastState();
  }

  // ── 봇 자식 프로세스 관리 (mode=ai 사용자가 들어왔을 때 자동 spawn) ────
  /** @type {import('child_process').ChildProcess|null} */
  let botChild = null;

  /**
   * 봇 자식 프로세스를 spawn한다. 이미 실행 중이면 무시.
   * bot.js가 없거나 getBotUrl이 null을 반환하면 경고 출력 후 스킵.
   */
  function spawnBotChild() {
    const botPath = path.join(__dirname, 'bot.js');
    if (!fs.existsSync(botPath)) {
      console.warn('[yahtzee] bot.js 없음 — 봇 spawn 스킵');
      return;
    }
    if (botChild && botChild.exitCode === null) {
      console.log('[yahtzee] 봇 이미 실행 중');
      return;
    }
    const url = getBotUrl();
    if (!url) {
      console.warn('[yahtzee] getBotUrl이 null 반환 — 봇 spawn 스킵');
      return;
    }
    console.log(`[yahtzee] 봇 spawn: ${url}`);
    botChild = spawn(process.execPath, [botPath, '--url', url], {
      detached: false,
      stdio: 'ignore',
    });
    botChild.on('exit', (code) => {
      console.log(`[yahtzee] 봇 종료 (code=${code})`);
      botChild = null;
    });
  }

  /**
   * 봇 자식 프로세스를 종료한다. mode=ai 사용자가 끊어졌을 때 호출.
   */
  function killBotChild() {
    if (botChild && botChild.exitCode === null) {
      console.log('[yahtzee] 봇 종료 요청');
      botChild.kill();
      botChild = null;
    }
  }

  // ── WebSocket 서버 (noServer 모드) ─────────────────────────────
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws, req) => {
    // URL 쿼리에서 mode 파싱 (launcher가 mode=ai|bot|human 전달)
    const reqUrlObj = new URL(req.url || '/', 'http://localhost');
    const wsMode = reqUrlObj.searchParams.get('mode') || 'human';
    const isBot = wsMode === 'bot';
    ws._mode = wsMode;
    ws._isBot = isBot;

    // N인 정원: 첫 번째 접속자의 쿼리(?players=N)로 룸 정원을 설정한다.
    // 이후 접속자의 쿼리는 무시(첫 접속자가 정원 결정). N=2가 기본(하위 호환).
    if (players.length === 0) {
      const parsedPlayers = parseInt(reqUrlObj.searchParams.get('players'), 10);
      if (parsedPlayers >= 2 && parsedPlayers <= 4) {
        roomMaxPlayers = parsedPlayers;
      } else {
        roomMaxPlayers = 2;
      }
    }

    // 정원 초과 직전, 좀비 슬롯(끊겼지만 close 미발화) 청소 시도.
    if (players.length >= roomMaxPlayers) {
      const before = players.length;
      players = players.filter((p) => p.ws.readyState <= 1);
      if (players.length < before) {
        console.log(`[yahtzee] 좀비 슬롯 ${before - players.length}개 청소`);
        if (players.length === 0) {
          game = null;
          roomMaxPlayers = 2;
        }
      }
    }

    // 룸 정원 초과 시 즉시 거절.
    if (players.length >= roomMaxPlayers) {
      ws.send(JSON.stringify({ type: 'ERROR', message: `방이 가득 찼다 (${roomMaxPlayers}/${roomMaxPlayers})` }));
      ws.close();
      console.log(`[yahtzee] 연결 거절: 룸 정원 초과 (${players.length}/${roomMaxPlayers})`);
      return;
    }

    // Heartbeat 상태 초기화.
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    // N인 확장: 미사용 ID를 배정 (재입장 데드락 방지, yutnori FIX-1 패턴).
    const usedIds = new Set(players.map((p) => p.id));
    const playerId = ALL_IDS.find((id) => !usedIds.has(id)) || 'p1';
    /** @type {Player} */
    const player = {
      id: playerId,
      name: playerId,
      joined: false,
      ready: false,
      rematchReady: false,
      ws,
    };
    players.push(player);
    console.log(`[yahtzee] ${playerId} 연결됨 (${players.length}/${roomMaxPlayers}, mode=${wsMode})`);

    // mode=ai 사용자가 혼자 들어왔다 → 봇 자동 spawn (자기 자식 프로세스).
    // 봇이 connect하면 두 번째 슬롯을 차지하고 JOIN/READY로 게임을 시작한다.
    // 약간의 지연: 사용자 클라이언트가 JOIN/READY를 먼저 보낼 여유 확보.
    // N인 확장: 다인 방(roomMaxPlayers > 2)에서 AI 봇은 미지원 → spawn 스킵 + 에러 로그.
    if (wsMode === 'ai' && !isBot && players.length === 1) {
      if (roomMaxPlayers > 2) {
        console.error('[yahtzee] 다인 방(N>2)에서 AI 봇은 미지원 — 봇 spawn 스킵');
      } else {
        setTimeout(() => spawnBotChild(), 200);
      }
    }

    // ── 메시지 라우터 ──
    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch (e) {
        console.warn('[yahtzee] JSON 파싱 실패:', data.toString());
        return;
      }

      switch (msg.type) {
        case 'JOIN': {
          // 닉네임 전달. name 누락 시 '(알 수 없음)' 폴백(후방호환 — JOIN 미수신 smoke 무영향).
          const rawName = typeof msg.playerName === 'string'
            ? msg.playerName.trim().slice(0, 32)
            : (typeof msg.name === 'string' ? msg.name.trim().slice(0, 12) : '');
          player.name = rawName || '(알 수 없음)';
          player.joined = true;
          console.log(`[yahtzee] JOIN: ${player.id} → "${player.name}"`);
          // 상대가 이미 있으면 opponentName을 포함하여 전송.
          const existingOpp = otherPlayer(player);
          sendTo(player, {
            type: 'JOINED',
            playerId: player.id,
            waiting: players.length < roomMaxPlayers,
            hostUrl: HOST_URL,
            roomMaxPlayers,
            opponentName: (existingOpp && existingOpp.name && existingOpp.name !== '(알 수 없음)') ? existingOpp.name : undefined,
          });
          // 상대에게 내 이름 고지(JOINED 재전송).
          if (existingOpp) {
            sendTo(existingOpp, {
              type: 'JOINED',
              playerId: existingOpp.id,
              waiting: false,
              hostUrl: HOST_URL,
              roomMaxPlayers,
              opponentName: player.name,
            });
          }
          // READY_STATE 초기 전송.
          broadcastReadyState();
          break;
        }

        case 'READY': {
          player.ready = true;
          console.log(`[yahtzee] READY: ${player.id} (${players.filter(p => p.ready).length}/${players.length})`);
          // 오목 패턴 READY_STATE 개별 전송 + 후방호환 READY_STATUS broadcast.
          broadcastReadyState();
          // N명 모두 접속 + JOIN + READY 완료 시 새 게임 시작.
          if (
            players.length === roomMaxPlayers &&
            players.every((p) => p.joined && p.ready) &&
            !game
          ) {
            console.log(`[yahtzee] ${roomMaxPlayers}명 READY → 새 게임 시작`);
            startNewGame();
          }
          break;
        }

        case 'ROLL_DICE': {
          if (!game) {
            sendTo(player, { type: 'ERROR', message: '게임이 시작되지 않았습니다.' });
            break;
          }
          const result = rollDice(game, player.id, msg.keep);
          if (!result.ok) {
            sendTo(player, { type: 'ERROR', message: result.error });
            break;
          }
          console.log(
            `[yahtzee] ROLL_DICE: ${player.id} → [${result.dice.join(',')}] (${result.rollCount}/3)`
          );
          // DICE_ROLLED는 굴림 직후 효과(애니메이션 등) 트리거용으로 양쪽에 broadcast 한다.
          broadcastAll({
            type: 'DICE_ROLLED',
            by: player.id,
            dice: result.dice,
            rollCount: result.rollCount,
          });
          broadcastState();
          break;
        }

        case 'TOGGLE_KEEP': {
          // 본인 턴 + rollCount>=1 + 0~4 index 검증은 game.js의 toggleKeep에서 처리.
          // 정상 토글 시 STATE 전체 broadcast — Yahtzee는 정보 비대칭이 없어 일관성을 위해 STATE 사용.
          // 실패(본인 턴 아님 등)는 조용히 무시 — 클라가 본인 턴 외엔 송신하지 않아야 정상.
          if (!game) break;
          const tk = toggleKeep(game, player.id, msg.index, msg.value);
          if (!tk.ok) {
            // 디버깅용 한 줄만 남기고 ERROR는 보내지 않음(과도한 토스트 방지).
            console.log(`[yahtzee] TOGGLE_KEEP 무시: ${player.id} idx=${msg.index} val=${msg.value} (${tk.error})`);
            break;
          }
          broadcastState();
          break;
        }

        case 'SCORE_CATEGORY': {
          if (!game) {
            sendTo(player, { type: 'ERROR', message: '게임이 시작되지 않았습니다.' });
            break;
          }
          const result = scoreCategory(game, player.id, msg.category);
          if (!result.ok) {
            sendTo(player, { type: 'ERROR', message: result.error });
            break;
          }
          console.log(
            `[yahtzee] SCORE_CATEGORY: ${player.id} → ${msg.category}=${result.scored}`
            + (result.yahtzeeBonusAwarded ? ` (+${result.yahtzeeBonusAwarded} yahtzee bonus)` : '')
          );
          broadcastAll({
            type: 'CATEGORY_SCORED',
            by: player.id,
            category: msg.category,
            scored: result.scored,
            yahtzeeBonusAwarded: result.yahtzeeBonusAwarded || 0,
          });
          broadcastState();
          maybeBroadcastGameOver();
          break;
        }

        case 'REMATCH': {
          if (players.length < roomMaxPlayers) {
            sendTo(player, { type: 'ERROR', message: '인원이 부족하여 새 게임을 시작할 수 없습니다.' });
            break;
          }
          player.rematchReady = true;
          // N인 확장: 전원의 rematchReady 상태를 동적으로 생성
          const rematchStatus = { type: 'REMATCH_STATUS' };
          for (const p of players) {
            rematchStatus[p.id + 'Ready'] = p.rematchReady;
          }
          broadcastAll(rematchStatus);
          if (players.every((p) => p.rematchReady)) {
            console.log(`[yahtzee] ${players.length}명 REMATCH → 새 게임`);
            startNewGame();
          }
          break;
        }

        default:
          console.warn(`[yahtzee] 알 수 없는 메시지 타입: ${msg.type}`);
      }
    });

    // ── 연결 해제 ──
    ws.on('close', () => {
      console.log(`[yahtzee] ${player.id} 연결 해제 (mode=${ws._mode})`);
      players = players.filter((p) => p.id !== player.id);
      // 사람(mode=ai)이 끊긴 경우: 봇 자식 프로세스도 같이 종료.
      // 새 사용자가 다시 들어오면 새 봇이 spawn된다.
      if (!ws._isBot) {
        killBotChild();
      }
      if (players.length === 0) {
        game = null;
        roomMaxPlayers = 2; // 모두 퇴장 시 기본값으로 리셋
      } else {
        broadcastAll({
          type: 'OPPONENT_LEFT',
          name: player.name || '(알 수 없음)',
          message: '상대방이 나갔어요.',
        });
        game = null; // 정원 미달 시 게임 무효화 → 전원 재접속 + READY 시 새 게임.
        // 남은 사람의 READY도 초기화(상대 합류 후 다시 READY).
        for (const p of players) p.ready = false;
        broadcastReadyState();
      }
    });

    ws.on('error', (err) => {
      console.error(`[yahtzee] ${player.id} WS 에러:`, err.message);
    });
  });

  // ── Heartbeat: 30초마다 ping, 응답 없는 좀비 연결 강제 종료 ────────
  const HEARTBEAT_INTERVAL_MS = 30000;
  const heartbeatTimer = setInterval(() => {
    for (const p of [...players]) {
      if (p.ws.isAlive === false) {
        console.log(`[yahtzee] ${p.id} heartbeat 응답 없음 → 강제 종료`);
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
   * launcher가 path prefix를 제거한 req.url을 전달한다(예: '/css/style.css').
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

if (isDirectExecution() && !process.env.YAHTZEE_NO_LISTEN) {
  const argv = process.argv.slice(2);
  const portFlagIndex = argv.indexOf('--port');
  const REQUESTED_PORT = portFlagIndex >= 0 && argv[portFlagIndex + 1]
    ? parseInt(argv[portFlagIndex + 1], 10)
    : 3010;
  let HOST_URL = '';
  // 단독 실행 시 봇 WS URL을 listen 콜백에서 결정된 포트로 동적 구성.
  // closure 변수 listeningPort를 getBotUrl이 참조한다 (포트 폴백 대응).
  let listeningPort = 0;

  const app = createApp({
    hostUrl: '',
    // mode=ai 사용자 진입 시 봇 자동 spawn 지원. 포트 결정 후에만 유효한 URL 반환.
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
    console.log(ANSI.cyan + line(`  ${ANSI.bold}YAHTZEE${ANSI.reset}${ANSI.cyan} - LAN 1:1 요트 다이스`) + ANSI.reset);
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
        console.log(`[yahtzee] 포트 ${port} 사용 중. ${port + 1}로 재시도...`);
        setTimeout(() => startListening(port + 1, attemptsLeft - 1), 100);
        return;
      }
      console.error('[yahtzee] listen 에러:', err && err.message ? err.message : err);
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
