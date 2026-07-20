/**
 * @fileoverview WebSocket 서버 + 정적 파일 서빙. LAN 환경에서 2인 1룸 대전을 중계한다.
 *
 * 아키텍처: 클라이언트 권위 + 서버 중계
 * - 게임 로직은 각 클라이언트가 로컬에서 처리한다 (입력 지연 최소화)
 * - 서버는 가비지/아이템/게임오버 같은 이벤트만 두 플레이어 간 중계한다
 */

import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import fs from 'fs';
import { spawn } from 'child_process';

// ── 경로 ──────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');

// ──────────────────────────────────────────────────────────────
// createApp(): launcher 통합 라우터용 앱 인스턴스를 생성한다.
// 모든 룸 상태(players)는 closure 내부에 보관되어 다른 게임과 격리된다.
// 옵션:
//   - opts.hostUrl: JOINED 메시지에 포함될 친구 안내용 URL. 통합 라우터에서 launcher가
//     공급한다. setHostUrl()로 부트 후 갱신 가능.
// ──────────────────────────────────────────────────────────────
/**
 * 테트리스 배틀 게임 앱 인스턴스를 생성한다.
 * @param {{ hostUrl?: string, getBotUrl?: () => (string|null) }} [opts]
 * @returns {{ handleHttp: Function, handleUpgrade: Function, setHostUrl: Function }}
 */
export function createApp(opts = {}) {
  // closure 변수: standalone listen 이후 setHostUrl로 갱신 가능.
  let HOST_URL = typeof opts.hostUrl === 'string' ? opts.hostUrl : '';
  // mode=ai 사용자 진입 시 봇이 접속할 WS URL을 공급하는 함수(통합 라우터가 주입).
  const getBotUrl = typeof opts.getBotUrl === 'function' ? opts.getBotUrl : (() => null);

  // ── Express 정적 파일 서빙 ────────────────────────────────────
  const expressApp = express();
  expressApp.use(express.static(PUBLIC_DIR));

  // ── WSS (noServer 모드) ───────────────────────────────────────
  const wss = new WebSocketServer({ noServer: true });

// ── 룸 상태 (2인 1룸 고정) ────────────────────────────────────────
/**
 * @typedef {Object} Player
 * @property {string} id        - 'p1' | 'p2'
 * @property {string} name      - 표시 이름
 * @property {boolean} ready    - READY 메시지 수신 여부
 * @property {boolean} shieldActive - 방어막 활성 여부 (Phase 2)
 * @property {number} slotCount - 현재 보유 중인 아이템 슬롯 개수 (서버 추적)
 * @property {boolean} rematchReady - 재대결 준비 여부
 * @property {boolean} gameOver  - 자기 토프아웃 발생 후 true (Phase 3 LOW-2: 사후 ITEM_USE 차단용)
 * @property {string} mode      - WS 접속 모드 ('human' | 'ai' | 'bot')
 * @property {import('ws').WebSocket} ws - WebSocket 인스턴스
 */

/** @type {Player[]} */
let players = [];

// ── 봇 자식 프로세스 관리 (mode=ai 사용자 진입 시 자동 spawn) ────
/** @type {import('child_process').ChildProcess|null} */
let botChild = null;

/**
 * 봇 자식 프로세스를 spawn한다. 이미 실행 중이거나 bot.js가 없으면 무시.
 * @returns {void}
 */
function spawnBotChild() {
  const botPath = path.join(__dirname, 'bot.js');
  if (!fs.existsSync(botPath)) {
    console.warn('[tetris] bot.js 없음 — 봇 spawn 스킵');
    return;
  }
  if (botChild && botChild.exitCode === null) {
    console.log('[tetris] 봇 이미 실행 중');
    return;
  }
  const url = getBotUrl();
  if (!url) {
    console.warn('[tetris] getBotUrl이 null 반환 — 봇 spawn 스킵');
    return;
  }
  console.log(`[tetris] 봇 spawn: ${url}`);
  botChild = spawn(process.execPath, [botPath, '--url', url], {
    detached: false,
    stdio: 'ignore',
  });
  botChild.on('exit', (code) => {
    console.log(`[tetris] 봇 종료 (code=${code})`);
    botChild = null;
  });
}

/**
 * 봇 자식 프로세스를 종료한다. mode=ai 사용자가 끊어졌을 때 호출.
 * @returns {void}
 */
function killBotChild() {
  if (botChild && botChild.exitCode === null) {
    console.log('[tetris] 봇 종료 요청');
    botChild.kill();
    botChild = null;
  }
}

/**
 * 룸이 게임 중(playing) 상태인지 판정한다 (Phase 3 LOW-2).
 * 두 플레이어가 모두 READY인 상태에서 어느 한쪽도 GAME_OVER로 종료되지 않았을 때 true.
 *
 * @returns {boolean}
 */
function isRoomPlaying() {
  if (players.length < 2) return false;
  if (!players.every((p) => p.ready)) return false;
  if (players.some((p) => p.gameOver)) return false;
  return true;
}

// ── Phase 2 아이템 상수 ─────────────────────────────────────────
const ITEM_IDS = ['garbage_bomb', 'dark', 'freeze', 'line_clear', 'shield'];
const ITEM_DURATIONS = {
  garbage_bomb: 0,
  dark: 5000,
  freeze: 3000,
  line_clear: 0,
  shield: 0,
};
/** 라인 클리어 시 아이템 지급 확률. */
const ITEM_GRANT_PROB = 0.8;
const MAX_ITEM_SLOTS = 3;

/**
 * 무작위 아이템 ID를 선택한다.
 * @returns {string}
 */
function pickRandomItem() {
  return ITEM_IDS[Math.floor(Math.random() * ITEM_IDS.length)];
}

/**
 * 룸을 초기 상태로 되돌린다 (재대결 시작 시 사용).
 * @returns {void}
 */
function resetRoomFlags() {
  for (const p of players) {
    p.ready = false;
    p.shieldActive = false;
    p.slotCount = 0;
    p.rematchReady = false;
    p.gameOver = false;
  }
}

/**
 * 특정 플레이어를 제외한 나머지에게 메시지를 보낸다.
 * @param {string} senderId   - 제외할 플레이어 ID
 * @param {object} payload    - JSON 직렬화할 메시지 객체
 * @returns {void}
 */
function broadcastOthers(senderId, payload) {
  const msg = JSON.stringify(payload);
  for (const p of players) {
    if (p.id !== senderId && p.ws.readyState === 1) {
      p.ws.send(msg);
    }
  }
}

/**
 * 모든 플레이어에게 메시지를 브로드캐스트한다.
 * @param {object} payload - JSON 직렬화할 메시지 객체
 * @returns {void}
 */
function broadcastAll(payload) {
  const msg = JSON.stringify(payload);
  for (const p of players) {
    if (p.ws.readyState === 1) {
      p.ws.send(msg);
    }
  }
}

/**
 * 특정 플레이어에게 메시지를 보낸다.
 * @param {Player} player
 * @param {object} payload
 * @returns {void}
 */
function sendTo(player, payload) {
  if (player && player.ws.readyState === 1) {
    player.ws.send(JSON.stringify(payload));
  }
}

/**
 * 각 플레이어에게 개별 관점으로 READY_STATE를 전송한다 (오목 파일럿 패턴).
 * myReady: 자기 자신의 ready, opponentReady: 상대의 ready.
 * @returns {void}
 */
function broadcastReadyState() {
  for (const me of players) {
    if (me.ws.readyState !== 1) continue;
    const opp = players.find((p) => p.id !== me.id);
    sendTo(me, {
      type: 'READY_STATE',
      myReady: me.ready,
      opponentReady: opp ? opp.ready : false,
    });
  }
}

/**
 * 라인 클리어 시 확률(ITEM_GRANT_PROB)로 아이템을 지급한다.
 * 슬롯이 가득 차 있거나 확률 실패 시 무시한다.
 * @param {Player} player 수혜자
 */
function tryGrantItem(player) {
  if (player.slotCount >= MAX_ITEM_SLOTS) return;
  if (Math.random() >= ITEM_GRANT_PROB) return;
  const itemId = pickRandomItem();
  const slotIndex = player.slotCount; // 0,1,2 순서대로 채움
  player.slotCount += 1;
  sendTo(player, {
    type: 'ITEM_GRANT',
    itemId,
    slotIndex,
  });
  console.log(`[server] ${player.id} 아이템 지급: ${itemId} (슬롯 ${slotIndex})`);
}

// ── WebSocket 핸들러 ─────────────────────────────────────────────
wss.on('connection', (ws, req) => {
  // URL 쿼리에서 mode 파싱 (launcher/network가 mode=ai|bot|human 전달).
  const reqUrlObj = new URL(req.url || '/', 'http://localhost');
  const wsMode = reqUrlObj.searchParams.get('mode') || 'human';
  const isBot = wsMode === 'bot';

  // 사람(비봇)이 새로 연결될 때, 정원 판정 직전에 "죽은/닫히는" 슬롯만 선제 정리한다 (#13 안전망).
  // 주의: 살아있는(OPEN) 봇은 보존한다. AI채우기 플로우는 런처가 봇을 먼저 spawn·접속시킨 뒤
  // 사람이 접속하므로, 모든 봇을 sweep하면 방금 매칭된 정상 봇까지 죽여 상대가 사라진다.
  // 따라서 ws.readyState가 OPEN이 아닌(좀비) 슬롯만 축출해 누적된 죽은 연결만 정리한다.
  if (!isBot) {
    const zombies = players.filter((p) => p.ws.readyState !== WebSocket.OPEN);
    if (zombies.length > 0) {
      console.log(`[server] 죽은(좀비) 슬롯 ${zombies.length}개 선제 제거`);
      for (const z of zombies) z.ws.terminate();
      players = players.filter((p) => p.ws.readyState === WebSocket.OPEN);
    }

    // #14 fix: 연결은 살아있지만 게임이 이미 끝난 플레이어들이 결과창에서 아무것도
    // 안 눌렀을 때 새 접속자가 "Room is full"로 막히는 문제 해소.
    // 승자(gameOver=false)의 구 WS가 아직 OPEN일 때 every() 체크가 실패하는 문제 수정:
    // 누구 하나라도 gameOver이면 게임이 끝난 것이므로 some()으로 완화한다.
    if (players.length > 0 && players.some((p) => p.gameOver)) {
      console.log('[server] 게임 종료 방치 상태 — 룸 초기화 후 새 접속 수용');
      for (const p of players) {
        try { p.ws.close(); } catch { /* 무시 */ }
      }
      players = [];
    }
  }

  // 룸 정원 초과 시 즉시 거절
  if (players.length >= 2) {
    ws.send(JSON.stringify({ type: 'ERROR', message: 'Room is full' }));
    ws.close();
    console.log('[server] 연결 거절: 룸 정원 초과');
    return;
  }

  // 비어있는 슬롯 ID에 할당 — players.length 기반은 재접속 시 ID 충돌 발생 (P0-B fix)
  const usedIds = new Set(players.map((p) => p.id));
  const playerId = ['p1', 'p2'].find((id) => !usedIds.has(id)) || 'p1';
  /** @type {Player} */
  const player = {
    id: playerId,
    name: '',
    ready: false,
    shieldActive: false,
    slotCount: 0,
    rematchReady: false,
    gameOver: false,
    mode: wsMode,
    ws,
  };
  players.push(player);
  console.log(`[server] ${playerId} 연결됨 (현재 인원: ${players.length}/2)`);

  // ── 메시지 라우터 ──
  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch (e) {
      console.warn('[server] JSON 파싱 실패:', data.toString());
      return;
    }

    // JSON.parse('null')은 null, 'true'/'0' 등은 원시값으로 정상 파싱된다.
    // 그 후 msg.type 접근 시 TypeError로 서버 프로세스가 죽으므로 객체+type 검증을 거친다. (P0-A fix)
    if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.type !== 'string') {
      try {
        sendTo(player, { type: 'ERROR', message: '잘못된 메시지 형식입니다.' });
      } catch (e) { /* 송신 실패는 무시 */ }
      return;
    }

    switch (msg.type) {
      case 'JOIN':
        player.name = msg.playerName || playerId;
        sendTo(player, {
          type: 'JOINED',
          playerId: player.id,
          waiting: players.length < 2,
          // Phase 4 C-2: 친구에게 안내할 호스트 LAN URL을 함께 전달.
          // 빈 문자열일 수도 있음(LAN IP 미감지 시) → 클라이언트가 폴백 처리.
          hostUrl: HOST_URL,
        });
        // mode=ai 단독 진입(사람 p1) 시 봇 자식 프로세스를 자동 spawn.
        // 봇 자신(mode=bot)이 들어올 때는 재spawn 하지 않는다. players.length===1로
        // 사람 단독 대기 시점을 보장(타이밍 경쟁 회피 — connection 직후가 아닌 JOIN 후).
        if (wsMode === 'ai' && !isBot && players.length === 1) {
          setTimeout(() => spawnBotChild(), 200);
        }
        // 두 명 모두 입장 시 양쪽에 상대 입장 알림 가능 (현재는 JOINED만 사용)
        break;

      case 'READY':
        // P2-5A: 게임 진행 중 중복 READY 차단 — START 재브로드캐스트 방지
        if (isRoomPlaying()) break;
        player.ready = true;
        console.log(`[server] ${player.id} READY`);
        broadcastReadyState();
        // 두 명 모두 READY면 카운트다운 시작
        if (players.length === 2 && players.every((p) => p.ready)) {
          console.log('[server] 양쪽 READY → 게임 시작 카운트다운');
          broadcastAll({ type: 'START', countdown: 3 });
        }
        break;

      case 'GARBAGE_SEND': {
        // Phase 3 LOW-1: 신뢰 환경(LAN)이지만 입력값을 클램프하여 spam/오용 방지.
        // 음수/NaN → 0, 비현실적 큰 값 → 20으로 제한.
        const rawLines = Number.isFinite(msg.lines) ? Math.floor(msg.lines) : 0;
        const safeLines = Math.max(0, Math.min(20, rawLines));
        const rawCombo = Number.isFinite(msg.combo) ? Math.floor(msg.combo) : 0;
        const safeCombo = Math.max(0, Math.min(99, rawCombo));

        // Phase 3 LOW-2: GAME_OVER 후의 잔여 메시지는 무시.
        if (player.gameOver || !isRoomPlaying()) {
          break;
        }

        // Phase 3 MED-1: lines>0일 때만 가비지를 상대에 중계.
        // lines==0(Single 클리어)이라도 ITEM_GRANT 추첨은 매번 시도한다.
        if (safeLines > 0) {
          broadcastOthers(player.id, {
            type: 'GARBAGE_RECV',
            lines: safeLines,
            combo: safeCombo,
          });
        }
        // 라인 클리어 시 확률로 아이템 지급 (송신자에게)
        tryGrantItem(player);
        break;
      }

      case 'BOARD_STATE':
        // 상대 미니맵 동기화용: 가비지 높이만 간단히 전송
        broadcastOthers(player.id, {
          type: 'OPPONENT_BOARD',
          height: msg.height || 0,
          stack: msg.stack || [],
        });
        break;

      case 'ITEM_USE': {
        // Phase 2: 권위 처리 (방어막/슬롯 차감)
        const itemId = msg.itemId;
        if (!ITEM_IDS.includes(itemId)) {
          console.warn(`[server] 알 수 없는 ITEM_USE itemId: ${itemId}`);
          break;
        }
        // Phase 3 LOW-2: GAME_OVER 후/게임 시작 전 ITEM_USE는 무시 (룸이 playing 상태일 때만 처리).
        if (player.gameOver || !isRoomPlaying()) {
          console.log(`[server] ITEM_USE 무시: ${player.id} (room not playing)`);
          break;
        }
        // 송신자 슬롯 카운트 차감 (음수 방지)
        if (player.slotCount > 0) player.slotCount -= 1;

        const opp = players.find((p) => p.id !== player.id);
        if (!opp) break;

        if (itemId === 'shield') {
          // 방어막은 자기 자신에게 적용 (서버가 권위적으로 추적)
          player.shieldActive = true;
          console.log(`[server] ${player.id} 방어막 활성화`);
          // 상대에게 방어막 활성 알림 (상대 보드에 배지 표시용)
          sendTo(opp, { type: 'SHIELD_ACTIVE' });
          break;
        }
        if (itemId === 'line_clear') {
          // 자기 보드 효과만 (서버는 통과만시킴)
          console.log(`[server] ${player.id} 라인 클리어 사용`);
          break;
        }
        // 공격형: garbage_bomb / dark / freeze
        if (opp.shieldActive) {
          // 방어막에 차단됨 → 양쪽에 알림
          opp.shieldActive = false;
          console.log(`[server] ${opp.id} 방어막 발동: ${itemId} 차단`);
          sendTo(player, { type: 'SHIELD_BLOCK', itemId });
          sendTo(opp, { type: 'SHIELD_BLOCK', itemId });
        } else {
          // 정상 전달
          sendTo(opp, {
            type: 'ITEM_EFFECT',
            itemId,
            duration: ITEM_DURATIONS[itemId] || 0,
          });
        }
        break;
      }

      case 'GAME_OVER': {
        // Phase 3 LOW-2: 자신이 이미 게임오버 상태면 중복 처리 방지.
        if (player.gameOver) {
          break;
        }
        player.gameOver = true;

        // P2-1: 상대가 이미 topout한 경우 → 무승부(double topout). 1회만 브로드캐스트.
        const alreadyOut = players.find((p) => p.id !== player.id && p.gameOver);
        if (alreadyOut) {
          console.log(`[server] GAME_OVER: 양쪽 동시 topout → 무승부`);
          broadcastAll({
            type: 'GAME_RESULT',
            winner: null,
            reason: 'double_topout',
          });
          break;
        }

        // 자신의 패배 선언 → 상대가 승리
        const winnerId = players.find((p) => p.id !== player.id)?.id || null;
        console.log(`[server] GAME_OVER: ${player.id} 패배, ${winnerId} 승리`);
        broadcastAll({
          type: 'GAME_RESULT',
          winner: winnerId,
          reason: 'topout',
        });
        break;
      }

      case 'REMATCH':
        player.rematchReady = true;
        broadcastAll({
          type: 'REMATCH_STATUS',
          p1Ready: players.find((p) => p.id === 'p1')?.rematchReady || false,
          p2Ready: players.find((p) => p.id === 'p2')?.rematchReady || false,
        });
        if (players.length === 2 && players.every((p) => p.rematchReady)) {
          console.log('[server] 양쪽 REMATCH → 새 게임 시작');
          resetRoomFlags();
          // Phase 3 LOW-2: resetRoomFlags가 ready를 false로 되돌리지만 재대결 START 직후에는
          // 게임이 즉시 진행되므로 ready를 true로 복원하여 isRoomPlaying()이 통과되도록 한다.
          // (재대결은 새 JOIN/READY 흐름을 거치지 않고 직접 START됨.)
          for (const p of players) {
            p.ready = true;
          }
          broadcastAll({ type: 'START', countdown: 3 });
        }
        break;

      default:
        console.warn(`[server] 알 수 없는 메시지 타입: ${msg.type}`);
    }
  });

  // ── 연결 해제 ──
  ws.on('close', () => {
    console.log(`[server] ${player.id} 연결 해제`);
    const leaverName = player.name || '(알 수 없음)';
    players = players.filter((p) => p.id !== player.id);
    // 사람(비봇)이 끊긴 경우 봇 슬롯을 동기적으로 정리한다 (#13 좀비 봇 차단).
    if (!isBot) {
      // killBotChild()의 SIGTERM은 비동기라 봇 WS가 실제 close될 때까지 players에 좀비로 남는다.
      // 따라서 짝 봇 슬롯을 players에서 즉시 제거하고 ws.terminate()로 TCP를 강제 종료한다.
      // (terminate 후 봇 close 핸들러가 연달아 발화돼도 이미 제거된 상태라 filter는 no-op)
      const botSlot = players.find((p) => p.mode === 'bot');
      if (botSlot) {
        players = players.filter((p) => p.mode !== 'bot');
        botSlot.ws.terminate();
      }
      // 봇 자식 프로세스도 종료 (프로세스 자원 정리 병행).
      killBotChild();
    }
    // 상대가 있으면 이탈 배너 + disconnect 결과 알림
    if (players.length > 0) {
      // 상대 이탈 배너용 OPPONENT_LEFT 메시지 전송
      broadcastAll({ type: 'OPPONENT_LEFT', name: leaverName });
      const remainingId = players[0].id;
      broadcastAll({
        type: 'GAME_RESULT',
        winner: remainingId,
        reason: 'disconnect',
      });
      // 남은 플레이어의 상태 리셋 (재대결 대기)
      resetRoomFlags();
    }
  });

  ws.on('error', (err) => {
    console.error(`[tetris] ${player.id} WS 에러:`, err.message);
  });
});

  // ── HTTP 핸들러 (express 미들웨어 위임) ─────────────────────
  /**
   * 정적 파일 응답 핸들러. express 정적 미들웨어가 처리.
   * launcher가 path prefix를 제거한 req.url을 전달한다.
   * @param {http.IncomingMessage} req
   * @param {http.ServerResponse} res
   */
  function handleHttp(req, res) {
    expressApp(req, res, () => {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
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

  /**
   * standalone listen 이후 LAN URL이 결정되면 호출. JOINED 메시지에 포함된다.
   * @param {string} url
   */
  function setHostUrl(url) {
    HOST_URL = typeof url === 'string' ? url : '';
  }

  return { handleHttp, handleUpgrade, setHostUrl };
}

// ── 호스트 IP 자동 감지 ──────────────────────────────────────────
/**
 * 가상 어댑터(VirtualBox, VMware, Hyper-V vEthernet, WSL 등) 인터페이스 이름 패턴.
 * 친구 PC가 실제로 그쪽 가상 네트워크로 들어오지 않으므로 표시 우선순위를 낮춘다.
 * (완전 배제는 하지 않음 — 사용자 환경에 따라 유효할 수 있어 후순위로만 둠.)
 */
const VIRTUAL_IF_PATTERNS = [
  /vEthernet/i,
  /VirtualBox/i,
  /VMware/i,
  /Hyper-?V/i,
  /WSL/i,
  /Loopback Pseudo/i,
];

/**
 * 인터페이스 이름이 가상 어댑터로 추정되는지 판정한다.
 * @param {string} name
 * @returns {boolean}
 */
function isVirtualInterface(name) {
  return VIRTUAL_IF_PATTERNS.some((re) => re.test(name));
}

/**
 * 인터페이스 이름의 우선순위 점수 (낮을수록 우선).
 *  - Wi-Fi/Wireless: 0
 *  - Ethernet/이더넷: 1
 *  - 그 외 물리 추정: 2
 *  - 가상 어댑터: 9 (후순위)
 * @param {string} name
 * @returns {number}
 */
function interfacePriority(name) {
  if (isVirtualInterface(name)) return 9;
  if (/wi-?fi|wireless|wlan|wlp/i.test(name)) return 0;
  if (/ethernet|이더넷|eth\d|enp/i.test(name)) return 1;
  return 2;
}

/**
 * 현재 머신의 LAN IPv4 주소를 우선순위 정렬하여 반환한다 (loopback/internal 제외).
 * Phase 4 C-1: Wi-Fi/이더넷 우선, 가상 어댑터 후순위.
 *
 * @returns {Array<{ip: string, ifname: string, virtual: boolean}>}
 */
function getLanAddresses() {
  const nets = os.networkInterfaces();
  const results = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        results.push({
          ip: net.address,
          ifname: name,
          virtual: isVirtualInterface(name),
        });
      }
    }
  }
  // 우선순위 오름차순 정렬 (Wi-Fi → 이더넷 → 기타 물리 → 가상)
  results.sort((a, b) => interfacePriority(a.ifname) - interfacePriority(b.ifname));
  return results;
}

// ──────────────────────────────────────────────────────────────
// 단독 실행 모드: `node server.js [--port N]`
//
// 테스트(WS 슈트)에서도 `node server.js --port 3055` 형태로 호출하므로 이 블록이 동작해야 한다.
// launcher가 import하는 경우엔 isDirectExecution() 검사로 listen이 발생하지 않는다.
// ──────────────────────────────────────────────────────────────

/**
 * 현재 모듈이 직접 실행되었는지 (vs launcher가 import) 판정한다.
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
    : 3005;
  let ACTUAL_PORT = REQUESTED_PORT;
  let HOST_URL = '';

  // ── Phase 4 C-1: ANSI 컬러 박스 출력 ─────────────────────────
  function supportsAnsi() {
    if (process.env.NO_COLOR) return false;
    if (process.env.TERM === 'dumb') return false;
    if (!process.stdout || !process.stdout.isTTY) return false;
    return true;
  }

  const ANSI = supportsAnsi()
    ? {
        reset: '\x1b[0m',
        bold: '\x1b[1m',
        dim: '\x1b[2m',
        cyan: '\x1b[36m',
        green: '\x1b[32m',
        yellow: '\x1b[33m',
        magenta: '\x1b[35m',
      }
    : {
        reset: '', bold: '', dim: '', cyan: '', green: '', yellow: '', magenta: '',
      };

  function padBoxLine(text, width) {
    const visible = text.replace(/\x1b\[[0-9;]*m/g, '');
    const padLen = Math.max(0, width - visible.length);
    return text + ' '.repeat(padLen);
  }

  function printBanner(port, lanIps) {
    const W = 56;
    const top    = `+${'-'.repeat(W)}+`;
    const sep    = `+${'-'.repeat(W)}+`;
    const empty  = `|${' '.repeat(W)}|`;
    const line = (s) => `|${padBoxLine(s, W)}|`;

    console.log('');
    console.log(ANSI.cyan + top + ANSI.reset);
    console.log(ANSI.cyan + line(`  ${ANSI.bold}TETRIS BATTLE${ANSI.reset}${ANSI.cyan} - LAN 1:1 대전`) + ANSI.reset);
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
    console.log(ANSI.cyan + line(`  ${ANSI.dim}종료: Ctrl+C 또는 stop.bat${ANSI.reset}`) + ANSI.reset);
    if (port !== REQUESTED_PORT) {
      console.log(ANSI.cyan + line(`  ${ANSI.magenta}* 요청 포트 ${REQUESTED_PORT} 사용 중 → ${port}로 폴백${ANSI.reset}`) + ANSI.reset);
    }
    console.log(ANSI.cyan + top + ANSI.reset);
    console.log('');
  }

  // ── 서버 시작 (Phase 4 D: 포트 충돌 시 자동 +1 재시도) ─────
  /** 자동 폴백 시도 최대 횟수 (3000 → 3001 → ... → 3010). */
  const MAX_PORT_FALLBACK = 10;

  // standalone에서 사용할 createApp 인스턴스 + HTTP 서버.
  // 포트 폴백 재시도 시 동일 createApp 인스턴스를 재사용한다 (룸 상태 유지).
  const app = createApp({ hostUrl: '' });

  function startListening(port, attemptsLeft) {
    const server = http.createServer(app.handleHttp);
    server.on('upgrade', app.handleUpgrade);

    let handled = false;
    const onError = (err) => {
      if (handled) return;
      handled = true;
      server.removeListener('error', onError);
      if (err && err.code === 'EADDRINUSE' && attemptsLeft > 0) {
        console.log(`[tetris] 포트 ${port} 사용 중. ${port + 1}로 재시도...`);
        setTimeout(() => startListening(port + 1, attemptsLeft - 1), 100);
        return;
      }
      console.error('[tetris] listen 에러:', err && err.message ? err.message : err);
      process.exit(1);
    };
    server.once('error', onError);
    server.listen(port, () => {
      server.removeListener('error', onError);
      ACTUAL_PORT = port;
      const lanIps = getLanAddresses();
      if (lanIps.length > 0) {
        HOST_URL = `http://${lanIps[0].ip}:${port}`;
      } else {
        HOST_URL = `http://localhost:${port}`;
      }
      app.setHostUrl(HOST_URL);
      printBanner(port, lanIps);
      console.log(ANSI.dim
        + ' Tip: 처음 실행 시 Windows Defender 방화벽 팝업이 뜨면 "개인 네트워크" 체크 후 액세스 허용.'
        + ANSI.reset);
      console.log('');
    });
  }

  startListening(REQUESTED_PORT, MAX_PORT_FALLBACK);
}
