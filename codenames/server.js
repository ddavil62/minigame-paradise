/**
 * @fileoverview 코드네임 클래식 WebSocket + 정적 파일 서버. LAN 4인(2:2) 팀 대전을 중계한다.
 *
 * 아키텍처: 서버 권위 게임 상태
 * - 게임 로직(키 분배, 단서, 추측, 승패)은 모두 game.js 순수 함수로 서버에서 처리
 * - 클라이언트는 입력만 보내고, 서버는 매 상태 변경마다 역할별 마스킹 스냅샷을 개별 전송
 * - 의존성 최소화: Node 내장 http + ws (Express 사용 안 함)
 *
 * 룸 흐름 (3단계 phase):
 *   role_select → 4인 입장 + 팀/역할 선택 + 호스트 START_GAME
 *   playing     → 게임 진행 (역할별 STATE 마스킹)
 *   over        → 게임 종료 + 리매치(선공 교체) 대기
 *
 * 통합 라우터 지원:
 *   - `createApp()`을 export하여 launcher가 단일 포트(3000)에서 라우팅할 수 있게 한다.
 *   - 단독 실행 (`node server.js [--port N]`)도 그대로 지원 (기본 3014, 충돌 시 +1 폴백).
 *
 * 봇 확장 여지:
 *   - createApp(options)의 options.getBotUrl 자리를 예약해 두었다(이번 미구현).
 *   - Player 슬롯의 ws 자리에 봇 WS를 삽입하면 휴먼과 동일 경로로 동작하도록 설계.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import {
  createGame, giveClue, guessCard, endTurnByPass, snapshotForPlayer,
} from './game.js';

// ── 경로 + 설정 ───────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');

/** 룸 정원 (2팀 × [스파이마스터1 + 요원1]). */
const ROOM_CAPACITY = 4;

// ── 정적 파일 서빙 (public/) ─────────────────────────────────────
/** MIME 매핑 (기본 확장자만). */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

/** 선택 가능한 4개 슬롯 (팀 × 역할). canStart 검증 기준. */
const SLOTS = [
  { team: 'red',  role: 'spymaster' },
  { team: 'red',  role: 'operative' },
  { team: 'blue', role: 'spymaster' },
  { team: 'blue', role: 'operative' },
];

/**
 * 코드네임 클래식 게임 앱 인스턴스를 생성한다.
 * 모든 룸 상태(players/game/phase)는 closure로 격리되어 다른 게임과 공유되지 않는다.
 *
 * @param {Object} [options]
 * @param {() => (string|null)} [options.getBotUrl] - 향후 봇 슬롯 자동 채우기용 훅 (이번 미구현).
 *   TODO: 빈 슬롯을 봇 WS로 채울 때 이 URL로 봇을 spawn → mode=bot 재접속해 Player.ws 점유.
 * @returns {{ handleHttp: Function, handleUpgrade: Function }}
 */
export function createApp(options = {}) {
  // 봇 확장용 훅 자리 예약 (이번 작업에서는 호출하지 않음).
  // const getBotUrl = options.getBotUrl || (() => null);

  // ── 룸 상태 (closure 격리, 4인 1룸 고정) ─────────────────────────
  /**
   * @typedef {Object} Player
   * @property {string} id      - 'p1'|'p2'|'p3'|'p4'
   * @property {string} name
   * @property {'red'|'blue'|null} team               - 선택한 팀
   * @property {'spymaster'|'operative'|null} role    - 선택한 역할
   * @property {boolean} joined                       - JOIN 수신 여부
   * @property {boolean} isHost                        - 첫 입장자(호스트)
   * @property {import('ws').WebSocket} ws
   *
   * NOTE: ws 자리에 봇 WS를 삽입할 수 있도록 구조를 설계했다(getBotUrl 훅 예약).
   */

  /** @type {Player[]} */
  let players = [];
  /** @type {import('./game.js').GameState|null} */
  let game = null;
  /** @type {'role_select'|'playing'|'over'} */
  let phase = 'role_select';
  /** 리매치 동의 집합 (양쪽 팀 한 명씩 이상 동의 시 재시작 — omok 패턴). */
  let rematchPending = new Set();
  /** 직전 게임 선공팀 (리매치 시 교체 기준). */
  let lastFirstTeam = null;

  // ── 전송 헬퍼 ────────────────────────────────────────────────
  /**
   * 특정 플레이어에게 단일 메시지를 보낸다.
   * @param {Player} player
   * @param {object} payload
   */
  function sendTo(player, payload) {
    if (player && player.ws && player.ws.readyState === 1) {
      player.ws.send(JSON.stringify(payload));
    }
  }

  /**
   * 모든 플레이어에게 임의 페이로드를 브로드캐스트한다.
   * @param {object} payload
   */
  function broadcastAll(payload) {
    const msg = JSON.stringify(payload);
    for (const p of players) {
      if (p.ws && p.ws.readyState === 1) p.ws.send(msg);
    }
  }

  /**
   * 호스트(첫 입장자)를 반환한다. 없으면 null.
   * @returns {Player|null}
   */
  function getHost() {
    return players.find((p) => p.isHost) || players[0] || null;
  }

  /**
   * 4개 슬롯이 모두 1명씩 채워졌는지(중복 없이) 검사한다.
   * @returns {boolean}
   */
  function isAllSlotsFilled() {
    if (players.length < ROOM_CAPACITY) return false;
    for (const slot of SLOTS) {
      const count = players.filter((p) => p.team === slot.team && p.role === slot.role).length;
      if (count !== 1) return false;
    }
    return true;
  }

  /**
   * role_select 단계 현황을 모든 플레이어에게 브로드캐스트한다.
   */
  function broadcastRoleState() {
    const host = getHost();
    const canStart = isAllSlotsFilled();
    const payload = {
      type: 'ROLE_STATE',
      players: players.map((p) => ({
        id: p.id,
        name: p.name,
        team: p.team,
        role: p.role,
        isHost: !!(host && p.id === host.id),
      })),
      canStart,
    };
    // you 필드는 수신자별로 다르므로 개별 전송.
    for (const p of players) {
      sendTo(p, { ...payload, you: p.id });
    }
  }

  /**
   * 게임 진행 중 각 플레이어에게 역할별 마스킹 스냅샷을 개별 전송한다.
   * (스파이마스터=키 전체, 요원=공개 카드만 — duet per-player STATE 패턴)
   */
  function broadcastState() {
    if (!game) return;
    for (const p of players) {
      if (p.ws && p.ws.readyState === 1 && p.role) {
        p.ws.send(JSON.stringify(snapshotForPlayer(game, p.role, p.id)));
      }
    }
  }

  /**
   * 게임 종료 페이로드를 만든다.
   * 게임이 끝났으므로 키 카드 전체를 복기 데이터로 공개해도 안전하다.
   * @returns {object}
   */
  function buildGameOverPayload() {
    /** @type {object} */
    const payload = {
      type: 'GAME_OVER',
      winner: game ? game.winner : null,
      reason: game ? game.winReason : '',
    };
    if (game) {
      payload.review = {
        words: game.words.slice(),
        keyCard: game.keyCard.slice(),
        revealed: game.revealed.slice(),
        firstTeam: game.firstTeam,
      };
    }
    return payload;
  }

  /**
   * 호스트의 START_GAME 수신 시 게임을 시작한다.
   * @param {Player} requester - 요청 플레이어
   */
  function startGame(requester) {
    const host = getHost();
    if (!host || requester.id !== host.id) {
      sendTo(requester, { type: 'ERROR', message: '호스트만 게임을 시작할 수 있다' });
      return;
    }
    if (!isAllSlotsFilled()) {
      sendTo(requester, { type: 'ERROR', message: '아직 모든 슬롯이 채워지지 않았다' });
      return;
    }
    game = createGame(); // 선공팀 랜덤
    lastFirstTeam = game.firstTeam;
    phase = 'playing';
    rematchPending = new Set();
    console.log(`[codenames] 게임 시작 (선공: ${game.firstTeam})`);
    broadcastAll({ type: 'GAME_START', firstTeam: game.firstTeam });
    broadcastState();
  }

  /**
   * 게임 종료를 감지해 phase 전환 + GAME_OVER를 브로드캐스트한다.
   */
  function handleGameOverIfEnded() {
    if (game && game.gamePhase === 'over') {
      phase = 'over';
      rematchPending = new Set();
      console.log(`[codenames] 게임 종료 — 승: ${game.winner} (${game.winReason})`);
      broadcastAll(buildGameOverPayload());
    }
  }

  /**
   * 리매치를 시도한다. 양 팀에서 각각 1명 이상 동의하면 재시작한다.
   * 재시작 시 선공팀을 교체하고 game을 재생성한다(역할 유지).
   * @param {Player} requester
   */
  function tryRematch(requester) {
    if (phase !== 'over') {
      sendTo(requester, { type: 'ERROR', message: '아직 게임이 끝나지 않았다' });
      return;
    }
    rematchPending.add(requester.id);
    // 양 팀에서 최소 1명씩 동의했는지 확인.
    const redAgreed = players.some((p) => p.team === 'red' && rematchPending.has(p.id));
    const blueAgreed = players.some((p) => p.team === 'blue' && rematchPending.has(p.id));
    if (!(redAgreed && blueAgreed)) {
      broadcastAll({ type: 'REMATCH_WAITING', readyIds: [...rematchPending] });
      return;
    }
    // 선공팀 교체 후 재생성.
    const nextFirst = lastFirstTeam === 'red' ? 'blue' : 'red';
    game = createGame(nextFirst);
    lastFirstTeam = game.firstTeam;
    phase = 'playing';
    rematchPending = new Set();
    console.log(`[codenames] 리매치 시작 (선공 교체: ${game.firstTeam})`);
    broadcastAll({ type: 'REMATCH_START', firstTeam: game.firstTeam });
    broadcastState();
  }

  // ── WebSocket 서버 (noServer 모드) ─────────────────────────────
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws) => {
    // 정원 초과 직전, 좀비 슬롯(끊겼지만 close 미발화) 청소 시도.
    if (players.length >= ROOM_CAPACITY) {
      const before = players.length;
      players = players.filter((p) => p.ws && p.ws.readyState <= 1);
      if (players.length < before) {
        console.log(`[codenames] 좀비 슬롯 ${before - players.length}개 청소`);
        if (players.length === 0) resetRoom();
      }
    }

    // 룸 정원 초과 시 즉시 거절.
    if (players.length >= ROOM_CAPACITY) {
      ws.send(JSON.stringify({ type: 'ERROR', message: `방이 가득 찼다 (${ROOM_CAPACITY}/${ROOM_CAPACITY})` }));
      ws.close();
      console.log('[codenames] 연결 거절: 룸 정원 초과');
      return;
    }

    // Heartbeat 상태 초기화.
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    // 사용 중이지 않은 가장 작은 pN을 부여.
    const usedIds = new Set(players.map((p) => p.id));
    let playerId = 'p1';
    for (let i = 1; i <= ROOM_CAPACITY; i++) {
      if (!usedIds.has(`p${i}`)) { playerId = `p${i}`; break; }
    }
    /** @type {Player} */
    const player = {
      id: playerId,
      name: '(알 수 없음)',
      team: null,
      role: null,
      joined: false,
      isHost: players.length === 0, // 첫 입장자가 호스트
      ws,
    };
    players.push(player);
    console.log(`[codenames] ${playerId} 연결됨 (${players.length}/${ROOM_CAPACITY})`);

    // ── 메시지 라우터 ──
    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch (e) {
        console.warn('[codenames] JSON 파싱 실패:', data.toString());
        return;
      }

      switch (msg.type) {
        case 'JOIN': {
          player.name = (msg.name || '(알 수 없음)').toString().slice(0, 32);
          player.joined = true;
          sendTo(player, { type: 'JOINED', playerId: player.id, isHost: player.isHost });
          broadcastRoleState();
          break;
        }

        // PICK_ROLE: 팀/역할 선택. SELECT_ROLE도 동일 처리(별칭).
        case 'PICK_ROLE':
        case 'SELECT_ROLE': {
          if (phase !== 'role_select') {
            sendTo(player, { type: 'ERROR', message: '지금은 역할을 변경할 수 없다' });
            break;
          }
          const team = msg.team;
          const role = msg.role;
          if ((team !== 'red' && team !== 'blue') || (role !== 'spymaster' && role !== 'operative')) {
            sendTo(player, { type: 'ERROR', message: '잘못된 팀/역할' });
            break;
          }
          // 중복 방지: 같은 (팀, 역할)을 다른 사람이 점유 중이면 거부.
          const taken = players.some((p) => p.id !== player.id && p.team === team && p.role === role);
          if (taken) {
            sendTo(player, { type: 'ERROR', message: '이미 선택된 자리다' });
            break;
          }
          player.team = team;
          player.role = role;
          console.log(`[codenames] ${player.id} → ${team}/${role}`);
          broadcastRoleState();
          break;
        }

        case 'START_GAME': {
          if (phase !== 'role_select') {
            sendTo(player, { type: 'ERROR', message: '이미 게임이 시작되었다' });
            break;
          }
          startGame(player);
          break;
        }

        case 'CLUE': {
          if (phase !== 'playing' || !game) break;
          if (player.role !== 'spymaster') {
            sendTo(player, { type: 'ERROR', message: '스파이마스터만 단서를 줄 수 있다' });
            break;
          }
          const result = giveClue(game, player.team, msg.word, msg.number);
          if (!result.ok) {
            sendTo(player, { type: 'ERROR', message: result.error });
            break;
          }
          console.log(`[codenames] CLUE: ${player.team} → "${msg.word}" ${msg.number}`);
          broadcastState();
          break;
        }

        case 'GUESS': {
          if (phase !== 'playing' || !game) break;
          if (player.role !== 'operative') {
            sendTo(player, { type: 'ERROR', message: '요원만 추측할 수 있다' });
            break;
          }
          const result = guessCard(game, player.team, msg.cardIndex);
          if (!result.ok) {
            sendTo(player, { type: 'ERROR', message: result.error });
            break;
          }
          console.log(`[codenames] GUESS: ${player.team} → 카드 ${msg.cardIndex} = ${result.result}`);
          broadcastState();
          handleGameOverIfEnded();
          break;
        }

        case 'END_TURN': {
          if (phase !== 'playing' || !game) break;
          if (player.role !== 'operative') {
            sendTo(player, { type: 'ERROR', message: '요원만 패스할 수 있다' });
            break;
          }
          const result = endTurnByPass(game, player.team);
          if (!result.ok) {
            sendTo(player, { type: 'ERROR', message: result.error });
            break;
          }
          console.log(`[codenames] END_TURN: ${player.team}`);
          broadcastState();
          break;
        }

        case 'REMATCH': {
          tryRematch(player);
          break;
        }

        default:
          console.warn(`[codenames] 알 수 없는 메시지 타입: ${msg.type}`);
      }
    });

    // ── 연결 해제 ──
    ws.on('close', () => {
      console.log(`[codenames] ${player.id} 연결 해제`);
      players = players.filter((p) => p.id !== player.id);
      rematchPending.delete(player.id);
      // 호스트가 나가면 다음 입장자에게 승계.
      if (player.isHost && players.length > 0) {
        players[0].isHost = true;
      }
      if (players.length === 0) {
        resetRoom();
      } else {
        broadcastAll({
          type: 'OPPONENT_LEFT',
          message: '플레이어가 나갔다. 게임이 중단되었다.',
        });
        // 한 명이라도 나가면 진행 중 게임 무효화 → 역할 선택 단계로 복귀.
        game = null;
        phase = 'role_select';
        rematchPending = new Set();
        broadcastRoleState();
      }
    });

    ws.on('error', (err) => {
      console.error(`[codenames] ${player.id} WS 에러:`, err.message);
    });
  });

  /**
   * 룸 상태를 초기값으로 리셋한다(전원 퇴장 시).
   */
  function resetRoom() {
    game = null;
    phase = 'role_select';
    rematchPending = new Set();
  }

  // ── Heartbeat: 30초마다 ping, 응답 없는 좀비 강제 종료 ────────
  const HEARTBEAT_INTERVAL_MS = 30000;
  const heartbeatTimer = setInterval(() => {
    for (const p of [...players]) {
      if (p.ws.isAlive === false) {
        console.log(`[codenames] ${p.id} heartbeat 응답 없음 → 강제 종료`);
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
   * 정적 파일 응답 핸들러. public/ 외 경로는 차단한다 (디렉토리 탈출 방지).
   * @param {http.IncomingMessage} req
   * @param {http.ServerResponse} res
   */
  function handleHttp(req, res) {
    const reqUrl = req.url || '/';
    const reqPath = reqUrl.split('?')[0] || '/';
    const urlPath = (reqPath === '/' || reqPath === '') ? '/index.html' : reqPath;
    const safePath = path.normalize(urlPath).replace(/^([\\/])+/, '');
    const fullPath = path.join(PUBLIC_DIR, safePath);
    // 디렉토리 탈출 방어: public/ 바깥 경로 거절.
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
// 단독 실행 모드: `node server.js [--port N]` (기본 3014, 충돌 시 +1 폴백)
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
  const REQUESTED_PORT = portFlagIndex >= 0 && argv[portFlagIndex + 1]
    ? parseInt(argv[portFlagIndex + 1], 10)
    : 3014;

  const app = createApp();

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

  // ── 콘솔 배너 (간단 ANSI) ─────────────────────────────────────────
  function supportsAnsi() {
    if (process.env.NO_COLOR) return false;
    if (process.env.TERM === 'dumb') return false;
    if (!process.stdout || !process.stdout.isTTY) return false;
    return true;
  }

  const ANSI = supportsAnsi()
    ? { reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m', magenta: '\x1b[35m' }
    : { reset: '', bold: '', dim: '', cyan: '', green: '', yellow: '', magenta: '' };

  function printBanner(port, lanIps, requestedPort) {
    console.log('');
    console.log(`${ANSI.cyan}${ANSI.bold}=== CODENAMES (클래식) — LAN 2:2 팀 대전 ===${ANSI.reset}`);
    console.log(`  ${ANSI.yellow}호스트 PC:${ANSI.reset} ${ANSI.green}http://localhost:${port}${ANSI.reset}`);
    if (lanIps.length > 0) {
      for (const entry of lanIps) {
        const tag = entry.virtual ? `${ANSI.dim} (가상)${ANSI.reset}` : '';
        console.log(`  ${ANSI.yellow}친구 PC:${ANSI.reset}   ${ANSI.green}http://${entry.ip}:${port}${ANSI.reset}${tag}`);
      }
    } else {
      console.log(`  ${ANSI.dim}(LAN IP 미감지 — ipconfig로 확인)${ANSI.reset}`);
    }
    if (port !== requestedPort) {
      console.log(`  ${ANSI.magenta}* 요청 포트 ${requestedPort} 사용 중 → ${port}로 폴백${ANSI.reset}`);
    }
    console.log(`  ${ANSI.dim}종료: Ctrl+C${ANSI.reset}`);
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
        console.log(`[codenames] 포트 ${port} 사용 중. ${port + 1}로 재시도...`);
        setTimeout(() => startListening(port + 1, attemptsLeft - 1), 100);
        return;
      }
      console.error('[codenames] listen 에러:', err && err.message ? err.message : err);
      process.exit(1);
    };
    server.once('error', onError);
    // LAN 접속을 허용하기 위해 0.0.0.0에 바인딩.
    server.listen(port, '0.0.0.0', () => {
      server.removeListener('error', onError);
      const lanIps = getLanAddresses();
      printBanner(port, lanIps, REQUESTED_PORT);
      console.log(`${ANSI.dim} Tip: 방화벽 팝업이 뜨면 "개인 네트워크" 체크 후 액세스 허용.${ANSI.reset}`);
      console.log('');
    });
  }

  startListening(REQUESTED_PORT, MAX_PORT_FALLBACK);
}
