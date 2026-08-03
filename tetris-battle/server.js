/**
 * @fileoverview WebSocket 서버 + 정적 파일 서빙. LAN 환경에서 다중 독립 룸 대전을 중계한다.
 *
 * 아키텍처: 클라이언트 권위 + 서버 중계
 * - 게임 로직은 각 클라이언트가 로컬에서 처리한다 (입력 지연 최소화)
 * - 서버는 가비지/아이템/게임오버 같은 이벤트만 두 플레이어 간 중계한다
 * - 2026-08-01: 단일 전역 2인 룸 → Map<roomId, Room> 멀티룸 구조로 전환
 */

import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import fs from 'fs';
import { spawn } from 'child_process';
import crypto from 'crypto';

// ── 경로 ──────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');

/** 라인 클리어 한 번당 아이템 지급 확률(2026-07-20 상향 결정 복원). */
export const ITEM_GRANT_PROB = 0.8;

/**
 * 아이템 지급 난수값이 80% 당첨 구간에 포함되는지 판정한다.
 * @param {number} roll 0 이상 1 미만의 난수값
 * @returns {boolean}
 */
export function isWinningItemGrantRoll(roll) {
  return Number.isFinite(roll) && roll >= 0 && roll < ITEM_GRANT_PROB;
}

// ──────────────────────────────────────────────────────────────
// createApp(): launcher 통합 라우터용 앱 인스턴스를 생성한다.
// 모든 룸 상태(roomMap)는 closure 내부에 보관되어 다른 게임과 격리된다.
// 2026-08-01: 단일 전역 players[] → Map<roomId, Room> 멀티룸 구조로 전환.
// 옵션:
//   - opts.hostUrl: JOINED 메시지에 포함될 친구 안내용 URL. 통합 라우터에서 launcher가
//     공급한다. setHostUrl()로 부트 후 갱신 가능.
//   - opts.getBotUrl(roomId): 봇이 접속할 WS URL을 반환한다. roomId를 인자로 받아
//     해당 룸에 봇을 연결하는 URL을 생성한다.
// ──────────────────────────────────────────────────────────────
/**
 * 테트리스 배틀 게임 앱 인스턴스를 생성한다.
 * @param {{ hostUrl?: string, getBotUrl?: (roomId: string) => (string|null), random?: () => number, heartbeatIntervalMs?: number }} [opts]
 * @returns {{ handleHttp: Function, handleUpgrade: Function, setHostUrl: Function }}
 */
export function createApp(opts = {}) {
  // closure 변수: standalone listen 이후 setHostUrl로 갱신 가능.
  let HOST_URL = typeof opts.hostUrl === 'string' ? opts.hostUrl : '';
  // mode=ai 사용자 진입 시 봇이 접속할 WS URL을 공급하는 함수(통합 라우터가 주입).
  const getBotUrl = typeof opts.getBotUrl === 'function' ? opts.getBotUrl : (() => null);
  // 테스트에서는 결정적 경계값을 주입하고, 실제 게임에서는 표준 난수를 사용한다.
  const random = typeof opts.random === 'function' ? opts.random : Math.random;

  // ── Express 정적 파일 서빙 ────────────────────────────────────
  const expressApp = express();
  expressApp.use(express.static(PUBLIC_DIR));

  // ── WSS (noServer 모드) ───────────────────────────────────────
  const wss = new WebSocketServer({ noServer: true });

  // ── 하트비트 (ping/pong 기반 좀비 소켓 탐지) ──────────────────
  // 네트워크 단절·브라우저 강제 종료 등으로 정상 close 프레임 없이 침묵 사망한
  // 소켓을 주기적으로 탐지해 terminate()한다. 기존 close 핸들러가 그대로
  // 좀비 슬롯 제거·상대 통보·resetRoomFlags 등을 처리하므로 코드 중복 없음.
  // .unref()로 프로세스/테스트 종료를 막지 않는다.
  // Room-is-full 근본원인 fix(2026-08-01 3차): 기존 20000ms는 하드 리프레시 직후
  // 곧바로 재접속하면 이전 소켓(+mode=ai 봇)이 아직 좀비로 판정되지 않아 방을 점유한
  // 채로 새 접속이 거절되는 race window(최대 20~40초)를 만들었다. 4000ms로 단축해
  // 회수 지연을 최소화한다(클라이언트 측 pagehide 명시적 close와 상호보완).
  const HEARTBEAT_MS = opts.heartbeatIntervalMs ?? 4000;
  if (HEARTBEAT_MS > 0) {
    setInterval(() => {
      for (const client of wss.clients) {
        if (client.isAlive === false) {
          client.terminate();
          continue;
        }
        client.isAlive = false;
        client.ping();
      }
    }, HEARTBEAT_MS).unref();
  }

// ── 룸 상태 (다중 독립 룸 — Map<roomId, Room>) ──────────────────
/**
 * @typedef {Object} Player
 * @property {string} id        - 'p1' | 'p2'
 * @property {string} name      - 표시 이름
 * @property {boolean} ready    - READY 메시지 수신 여부
 * @property {boolean} shieldActive - 방어막 활성 여부 (Phase 2)
 * @property {number} slotCount - 현재 보유 중인 아이템 슬롯 개수 (서버 추적)
 * @property {(string|null)[]} itemSlots - 서버 권위 아이템 슬롯
 * @property {number} lastClearEventId - 마지막으로 처리한 라인 클리어 이벤트
 * @property {boolean} rematchReady - 재대결 준비 여부
 * @property {boolean} gameOver  - 자기 토프아웃 발생 후 true (Phase 3 LOW-2: 사후 ITEM_USE 차단용)
 * @property {string} mode      - WS 접속 모드 ('human' | 'ai' | 'bot')
 * @property {import('ws').WebSocket} ws - WebSocket 인스턴스
 */

/**
 * @typedef {Object} Room
 * @property {string}   id          - crypto.randomUUID() 또는 런처가 생성한 UUID
 * @property {Player[]} players     - 이 룸의 플레이어 배열 (최대 2)
 * @property {import('child_process').ChildProcess|null} botChild - 이 룸의 봇 프로세스
 * @property {boolean}  _botSpawnPending - 200ms 지연 spawn 예약 여부 (중복 spawn 방지)
 */

/** @type {Map<string, Room>} roomId → Room */
const roomMap = new Map();

/**
 * 새 룸 ID를 생성한다. crypto.randomUUID()를 사용한다.
 * @returns {string}
 */
function generateRoomId() {
  return crypto.randomUUID();
}

/**
 * 새 빈 Room 객체를 생성해 roomMap에 등록하고 반환한다.
 * @param {string} id
 * @returns {Room}
 */
function createRoom(id) {
  const room = { id, players: [], botChild: null, _botSpawnPending: false };
  roomMap.set(id, room);
  return room;
}

/**
 * 외부(런처)가 미리 발급한 roomId로 룸을 선제 생성한다. 이미 존재하면 아무 것도 하지 않는다.
 *
 * 배경(Room-is-full/Room-not-found 근본원인 4차 fix, 2026-08-03): 런처는 로비 매칭이
 * 완료되면 tetris-battle 전용으로 crypto.randomUUID()를 생성해 매칭된 클라이언트(및
 * AI 채우기 봇)를 `?room=<roomId>`로 리다이렉트한다. 그러나 이 서버의 roomMap에는
 * 해당 ID가 등록된 적이 없어, 클라이언트가 실제로 접속을 시도하면 `if (roomParam)` 분기가
 * "Room not found"로 즉시 거절해왔다(런처 경유 매칭이 완전히 동작하지 않던 결함).
 * 런처가 REDIRECT를 브로드캐스트하기 직전에 이 함수를 호출해 룸을 먼저 등록해 두면,
 * 이후 클라이언트/봇의 접속이 정상적으로 그 룸에 합류할 수 있다.
 * 공유 초대 링크(hostUrl) 등 서버가 스스로 생성하지 않은 임의의 roomId에 대해서는
 * 이 함수가 호출되지 않으므로, 기존 "Room not found" 거절 동작은 그대로 유지된다.
 * @param {string} id - 런처가 생성한 roomId
 * @returns {void}
 */
function ensureRoom(id) {
  if (!roomMap.has(id)) createRoom(id);
}

/**
 * 대기 중(인원 1명)인 첫 번째 룸을 반환한다. 없으면 null.
 * @returns {Room|null}
 */
function findWaitingRoom() {
  for (const room of roomMap.values()) {
    // AI 전용 룸(_botSpawnPending=true)은 봇 spawn 대기 중이므로 일반 사용자의
    // 자동 합류 대상에서 제외한다 (DEFECT-1: 200ms 레이스 윈도우 차단).
    if (room.players.length === 1 && !room._botSpawnPending) return room;
  }
  return null;
}

/**
 * 봇 자식 프로세스를 spawn한다. 이미 실행 중이거나 bot.js가 없으면 무시.
 * @param {Room} room - 봇을 연결할 대상 룸
 * @returns {void}
 */
function spawnBotChild(room) {
  const botPath = path.join(__dirname, 'bot.js');
  if (!fs.existsSync(botPath)) {
    console.warn('[tetris] bot.js 없음 — 봇 spawn 스킵');
    return;
  }
  if (room.botChild && room.botChild.exitCode === null) {
    console.log(`[tetris] 봇 이미 실행 중 (룸=${room.id})`);
    return;
  }
  const url = getBotUrl(room.id);
  if (!url) {
    console.warn('[tetris] getBotUrl이 null 반환 — 봇 spawn 스킵');
    return;
  }
  console.log(`[tetris] 봇 spawn (룸=${room.id}): ${url}`);
  room.botChild = spawn(process.execPath, [botPath, '--url', url], {
    detached: false,
    stdio: 'ignore',
  });
  room.botChild.on('exit', (code) => {
    console.log(`[tetris] 봇 종료 (룸=${room.id}, code=${code})`);
    room.botChild = null;
  });
}

/**
 * 봇 자식 프로세스를 종료한다. mode=ai 사용자가 끊어졌을 때 호출.
 * @param {Room} room
 * @returns {void}
 */
function killBotChild(room) {
  if (room.botChild && room.botChild.exitCode === null) {
    console.log(`[tetris] 봇 종료 요청 (룸=${room.id})`);
    room.botChild.kill();
    room.botChild = null;
  }
}

/**
 * 룸이 게임 중(playing) 상태인지 판정한다 (Phase 3 LOW-2).
 * 두 플레이어가 모두 READY인 상태에서 어느 한쪽도 GAME_OVER로 종료되지 않았을 때 true.
 *
 * @param {Room} room
 * @returns {boolean}
 */
function isRoomPlaying(room) {
  if (room.players.length < 2) return false;
  if (!room.players.every((p) => p.ready)) return false;
  if (room.players.some((p) => p.gameOver)) return false;
  return true;
}

/**
 * 룸 내 죽은(비OPEN) 슬롯을 선제 제거한다 (기존 전역 sweep의 룸 단위 버전).
 * @param {Room} room
 */
function sweepZombiesInRoom(room) {
  const zombies = room.players.filter((p) => p.ws.readyState !== WebSocket.OPEN);
  if (zombies.length > 0) {
    console.log(`[server] 룸 ${room.id}: 좀비 ${zombies.length}개 선제 제거`);
    for (const z of zombies) z.ws.terminate();
    room.players = room.players.filter((p) => p.ws.readyState === WebSocket.OPEN);
  }
}

/**
 * 게임 종료 방치 상태 룸을 초기화한다 (기존 gameOver 안전망의 룸 단위 버전).
 * @param {Room} room
 */
function clearGameOverRoom(room) {
  if (room.players.length > 0 && room.players.some((p) => p.gameOver)) {
    console.log(`[server] 룸 ${room.id}: 게임 종료 방치 — 초기화`);
    for (const p of room.players) {
      try { p.ws.close(); } catch { /* 무시 */ }
    }
    room.players = [];
  }
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
const MAX_ITEM_SLOTS = 3;

/**
 * 무작위 아이템 ID를 선택한다.
 * @returns {string}
 */
function pickRandomItem() {
  return ITEM_IDS[Math.floor(random() * ITEM_IDS.length)];
}

/**
 * 룸을 초기 상태로 되돌린다 (재대결 시작 시 사용).
 * @param {Room} room
 * @returns {void}
 */
function resetRoomFlags(room) {
  for (const p of room.players) {
    p.ready = false;
    p.shieldActive = false;
    p.slotCount = 0;
    p.itemSlots = Array(MAX_ITEM_SLOTS).fill(null);
    p.lastClearEventId = 0;
    p.rematchReady = false;
    p.gameOver = false;
  }
}

/**
 * 특정 플레이어를 제외한 나머지에게 메시지를 보낸다.
 * @param {Room} room
 * @param {string} senderId   - 제외할 플레이어 ID
 * @param {object} payload    - JSON 직렬화할 메시지 객체
 * @returns {void}
 */
function broadcastOthers(room, senderId, payload) {
  const msg = JSON.stringify(payload);
  for (const p of room.players) {
    if (p.id !== senderId && p.ws.readyState === 1) {
      p.ws.send(msg);
    }
  }
}

/**
 * 모든 플레이어에게 메시지를 브로드캐스트한다.
 * @param {Room} room
 * @param {object} payload - JSON 직렬화할 메시지 객체
 * @returns {void}
 */
function broadcastAll(room, payload) {
  const msg = JSON.stringify(payload);
  for (const p of room.players) {
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
 * @param {Room} room
 * @returns {void}
 */
function broadcastReadyState(room) {
  for (const me of room.players) {
    if (me.ws.readyState !== 1) continue;
    const opp = room.players.find((p) => p.id !== me.id);
    sendTo(me, {
      type: 'READY_STATE',
      myReady: me.ready,
      opponentReady: opp ? opp.ready : false,
    });
  }
}

/**
 * 고유 라인 클리어 이벤트마다 80% 확률로 아이템을 지급한다.
 * 빈 슬롯 선택과 이벤트 중복 제거는 서버가 권위적으로 처리한다.
 * @param {Player} player 수혜자
 * @param {number} clearEventId 라운드 내 클리어 이벤트 식별자
 */
function tryGrantItem(player, clearEventId) {
  if (!Number.isInteger(clearEventId) || clearEventId <= player.lastClearEventId) return;
  // 확률 실패 이벤트도 처리 완료로 기록해 동일 이벤트 재전송으로 재추첨하지 못하게 한다.
  player.lastClearEventId = clearEventId;
  const slotIndex = player.itemSlots.indexOf(null);
  if (slotIndex < 0) return;
  if (!isWinningItemGrantRoll(random())) return;
  const itemId = pickRandomItem();
  player.itemSlots[slotIndex] = itemId;
  player.slotCount = player.itemSlots.filter(Boolean).length;
  sendTo(player, {
    type: 'ITEM_GRANT',
    itemId,
    slotIndex,
  });
  console.log(`[server] ${player.id} 아이템 지급: ${itemId} (슬롯 ${slotIndex})`);
}

// ── WebSocket 핸들러 ─────────────────────────────────────────────
wss.on('connection', (ws, req) => {
  // 하트비트: 연결 직후 살아있음을 표시하고, pong 수신 시마다 갱신한다.
  // 브라우저 WebSocket과 ws 라이브러리 모두 프로토콜 레벨에서 ping에 자동 pong을 반환한다.
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  // URL 쿼리에서 mode/room 파싱 (launcher/network가 mode=ai|bot|human, room=<roomId> 전달).
  const reqUrlObj = new URL(req.url || '/', 'http://localhost');
  const wsMode = reqUrlObj.searchParams.get('mode') || 'human';
  const roomParam = reqUrlObj.searchParams.get('room') || null;
  const isBot = wsMode === 'bot';

  // ── 룸 결정 로직 (멀티룸 아키텍처 2026-08-01) ──
  let room = null;

  if (roomParam) {
    // 명시적 room 파라미터 있음: 지정 룸에만 입장 시도
    room = roomMap.get(roomParam) || null;
    if (!room) {
      ws.send(JSON.stringify({ type: 'ERROR', message: 'Room not found' }));
      ws.close();
      console.log(`[server] 연결 거절: 룸 ${roomParam} 존재하지 않음`);
      return;
    }
    // 좀비 선제 정리 (비봇 접속 시)
    if (!isBot) {
      sweepZombiesInRoom(room);
      clearGameOverRoom(room);
    }
    if (room.players.length >= 2) {
      ws.send(JSON.stringify({ type: 'ERROR', message: 'Room is full' }));
      ws.close();
      console.log(`[server] 연결 거절: 룸 ${roomParam} 정원 초과`);
      return;
    }
  } else if (wsMode === 'ai') {
    // mode=ai: 항상 전용 신규 룸 생성
    const newId = generateRoomId();
    room = createRoom(newId);
    console.log(`[server] AI 전용 룸 생성: ${newId}`);
  } else {
    // room 파라미터 없음: 대기 중인 룸 자동 합류 or 신규 생성
    if (!isBot) {
      // 비봇 사람이 접속: 대기 룸(1인)을 찾되, 찾은 룸의 좀비/gameOver 정리 후 재검증
      const candidate = findWaitingRoom();
      if (candidate) {
        sweepZombiesInRoom(candidate);
        clearGameOverRoom(candidate);
        // 정리 후 인원이 여전히 1명이면 합류, 아니면 룸이 비었거나 만석이므로 스킵
        if (candidate.players.length === 1) {
          room = candidate;
        } else if (candidate.players.length === 0) {
          // 좀비 정리 후 빈 룸이 됨 → 소멸 후 새 룸 생성
          roomMap.delete(candidate.id);
        }
      }
    }
    if (!room) {
      const newId = generateRoomId();
      room = createRoom(newId);
      console.log(`[server] 새 룸 생성: ${newId}`);
    }
  }

  // 비어있는 슬롯 ID에 할당 — players.length 기반은 재접속 시 ID 충돌 발생 (P0-B fix)
  const usedIds = new Set(room.players.map((p) => p.id));
  const playerId = ['p1', 'p2'].find((id) => !usedIds.has(id)) || 'p1';
  /** @type {Player} */
  const player = {
    id: playerId,
    name: '',
    ready: false,
    shieldActive: false,
    slotCount: 0,
    itemSlots: Array(MAX_ITEM_SLOTS).fill(null),
    lastClearEventId: 0,
    rematchReady: false,
    gameOver: false,
    mode: wsMode,
    ws,
  };
  room.players.push(player);
  // 역참조: ws → room (close 핸들러에서 룸 추적용)
  ws._room = room;

  console.log(`[server] ${playerId} 연결됨 (룸=${room.id}, 현재 인원: ${room.players.length}/2)`);

  // ── 메시지 라우터 (기존과 동일, players → room.players, 함수 호출에 room 추가) ──
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
          waiting: room.players.length < 2,
          // 멀티룸: hostUrl에 ?room=<roomId>를 포함시켜 초대 링크가 특정 룸을 가리키도록 한다.
          hostUrl: HOST_URL ? `${HOST_URL}/tetris-battle/?room=${room.id}` : '',
          roomId: room.id,
        });
        // mode=ai 단독 진입(사람 p1) 시 봇 자식 프로세스를 자동 spawn.
        // 봇 자신(mode=bot)이 들어올 때는 재spawn 하지 않는다. room.players.length===1로
        // 사람 단독 대기 시점을 보장(타이밍 경쟁 회피 — connection 직후가 아닌 JOIN 후).
        if (wsMode === 'ai' && !isBot && room.players.length === 1) {
          room._botSpawnPending = true;
          setTimeout(() => {
            room._botSpawnPending = false;
            // 200ms 내에 이 사람이 이미 나갔으면(로비 복귀 등) 스폰을 취소한다.
            // 그렇지 않으면 빈 방에 봇만 홀로 남아 다음 방문자의 p1 슬롯을 선점해버린다.
            if (room.players.includes(player) && player.ws.readyState === WebSocket.OPEN) {
              spawnBotChild(room);
            }
          }, 200);
        }
        // 두 명 모두 입장 시 양쪽에 상대 입장 알림 가능 (현재는 JOINED만 사용)
        break;

      case 'READY':
        // P2-5A: 게임 진행 중 중복 READY 차단 — START 재브로드캐스트 방지
        if (isRoomPlaying(room)) break;
        player.ready = true;
        console.log(`[server] ${player.id} READY (룸=${room.id})`);
        broadcastReadyState(room);
        // 두 명 모두 READY면 카운트다운 시작
        if (room.players.length === 2 && room.players.every((p) => p.ready)) {
          console.log(`[server] 양쪽 READY → 게임 시작 카운트다운 (룸=${room.id})`);
          broadcastAll(room, { type: 'START', countdown: 3 });
        }
        break;

      case 'GARBAGE_SEND': {
        // Phase 3 LOW-1: 신뢰 환경(LAN)이지만 입력값을 클램프하여 spam/오용 방지.
        // 음수/NaN → 0, 비현실적 큰 값 → 20으로 제한.
        const rawLines = Number.isFinite(msg.lines) ? Math.floor(msg.lines) : 0;
        const safeLines = Math.max(0, Math.min(20, rawLines));
        const rawCombo = Number.isFinite(msg.combo) ? Math.floor(msg.combo) : 0;
        const safeCombo = Math.max(0, Math.min(99, rawCombo));
        const clearEventId = Number.isFinite(msg.clearEventId)
          ? Math.floor(msg.clearEventId)
          : 0;

        // Phase 3 LOW-2: GAME_OVER 후의 잔여 메시지는 무시.
        if (player.gameOver || !isRoomPlaying(room)) {
          break;
        }

        // lines>0일 때만 가비지를 상대에 중계한다.
        if (safeLines > 0) {
          broadcastOthers(room, player.id, {
            type: 'GARBAGE_RECV',
            lines: safeLines,
            combo: safeCombo,
          });
        }
        // 콤보 수와 무관하게 고유 라인 클리어 이벤트마다 80% 확률로 지급한다.
        tryGrantItem(player, clearEventId);
        break;
      }

      case 'BOARD_STATE': {
        // 셀 값과 크기를 검증해 실제 구멍/블록 배치를 그대로 중계한다.
        const safeCells = Array.isArray(msg.cells) && msg.cells.length === 22
          ? msg.cells.map((row) => (
              Array.isArray(row) && row.length === 10
                ? row.map((value) => (
                    Number.isInteger(value) && value >= 0 && value <= 8 ? value : 0
                  ))
                : Array(10).fill(0)
            ))
          : [];
        broadcastOthers(room, player.id, {
          type: 'OPPONENT_BOARD',
          height: msg.height || 0,
          stack: msg.stack || [],
          cells: safeCells,
          final: msg.final === true,
        });
        break;
      }

      case 'ITEM_USE': {
        // Phase 2: 권위 처리 (방어막/슬롯 차감)
        const itemId = msg.itemId;
        if (!ITEM_IDS.includes(itemId)) {
          console.warn(`[server] 알 수 없는 ITEM_USE itemId: ${itemId}`);
          break;
        }
        // Phase 3 LOW-2: GAME_OVER 후/게임 시작 전 ITEM_USE는 무시 (룸이 playing 상태일 때만 처리).
        if (player.gameOver || !isRoomPlaying(room)) {
          console.log(`[server] ITEM_USE 무시: ${player.id} (room not playing, 룸=${room.id})`);
          break;
        }
        // 서버 슬롯에서 실제 사용 위치를 비워 다음 지급이 그 빈칸을 재사용하게 한다.
        const slotIndex = Number.isInteger(msg.slotIndex) ? msg.slotIndex : -1;
        if (slotIndex >= 0 && slotIndex < MAX_ITEM_SLOTS) {
          player.itemSlots[slotIndex] = null;
          player.slotCount = player.itemSlots.filter(Boolean).length;
        }

        const opp = room.players.find((p) => p.id !== player.id);
        if (!opp) break;

        if (itemId === 'shield') {
          // 방어막은 자기 자신에게 적용 (서버가 권위적으로 추적)
          player.shieldActive = true;
          console.log(`[server] ${player.id} 방어막 활성화 (룸=${room.id})`);
          // 상대에게 방어막 활성 알림 (상대 보드에 배지 표시용)
          sendTo(opp, { type: 'SHIELD_ACTIVE' });
          break;
        }
        if (itemId === 'line_clear') {
          // 자기 보드 효과만 (서버는 통과만시킴)
          console.log(`[server] ${player.id} 라인 클리어 사용 (룸=${room.id})`);
          break;
        }
        // 공격형: garbage_bomb / dark / freeze
        if (opp.shieldActive) {
          // 방어막에 차단됨 → 수신자별 역할을 명시해 양쪽 방어막 동시 활성도 안전하게 구분한다.
          opp.shieldActive = false;
          console.log(`[server] ${opp.id} 방어막 발동: ${itemId} 차단 (룸=${room.id})`);
          sendTo(player, { type: 'SHIELD_BLOCK', itemId, isDefender: false });
          sendTo(opp, { type: 'SHIELD_BLOCK', itemId, isDefender: true });
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
        const alreadyOut = room.players.find((p) => p.id !== player.id && p.gameOver);
        if (alreadyOut) {
          console.log(`[server] GAME_OVER: 양쪽 동시 topout → 무승부 (룸=${room.id})`);
          broadcastAll(room, {
            type: 'GAME_RESULT',
            winner: null,
            reason: 'double_topout',
          });
          break;
        }

        // 자신의 패배 선언 → 상대가 승리
        const winnerId = room.players.find((p) => p.id !== player.id)?.id || null;
        console.log(`[server] GAME_OVER: ${player.id} 패배, ${winnerId} 승리 (룸=${room.id})`);
        broadcastAll(room, {
          type: 'GAME_RESULT',
          winner: winnerId,
          reason: 'topout',
        });
        break;
      }

      case 'REMATCH':
        player.rematchReady = true;
        broadcastAll(room, {
          type: 'REMATCH_STATUS',
          p1Ready: room.players.find((p) => p.id === 'p1')?.rematchReady || false,
          p2Ready: room.players.find((p) => p.id === 'p2')?.rematchReady || false,
        });
        if (room.players.length === 2 && room.players.every((p) => p.rematchReady)) {
          console.log(`[server] 양쪽 REMATCH → 새 게임 시작 (룸=${room.id})`);
          resetRoomFlags(room);
          // Phase 3 LOW-2: resetRoomFlags가 ready를 false로 되돌리지만 재대결 START 직후에는
          // 게임이 즉시 진행되므로 ready를 true로 복원하여 isRoomPlaying()이 통과되도록 한다.
          // (재대결은 새 JOIN/READY 흐름을 거치지 않고 직접 START됨.)
          for (const p of room.players) {
            p.ready = true;
          }
          broadcastAll(room, { type: 'START', countdown: 3 });
        }
        break;

      default:
        console.warn(`[server] 알 수 없는 메시지 타입: ${msg.type}`);
    }
  });

  // ── 연결 해제 ──
  ws.on('close', () => {
    // room을 ws._room으로 추적
    const r = ws._room;
    if (!r) return;

    console.log(`[server] ${player.id} 연결 해제 (룸=${r.id})`);
    // 종료된 이전 방의 close 이벤트가 늦게 도착해 같은 ID를 재사용한 새 방 참가자를
    // 제거하거나 새 봇을 종료하지 않도록 객체 동일성으로 현재 슬롯을 확인한다.
    if (!r.players.includes(player)) {
      console.log(`[server] ${player.id} 지연 close 무시 (이미 교체된 슬롯)`);
      return;
    }
    const leaverName = player.name || '(알 수 없음)';
    r.players = r.players.filter((p) => p !== player);
    // 사람(비봇)이 끊긴 경우 봇 슬롯을 동기적으로 정리한다 (#13 좀비 봇 차단).
    if (!isBot) {
      // killBotChild()의 SIGTERM은 비동기라 봇 WS가 실제 close될 때까지 players에 좀비로 남는다.
      // 따라서 짝 봇 슬롯을 players에서 즉시 제거하고 ws.terminate()로 TCP를 강제 종료한다.
      // (terminate 후 봇 close 핸들러가 연달아 발화돼도 이미 제거된 상태라 filter는 no-op)
      const botSlot = r.players.find((p) => p.mode === 'bot');
      if (botSlot) {
        r.players = r.players.filter((p) => p.mode !== 'bot');
        botSlot.ws.terminate();
      }
      // 봇 자식 프로세스도 종료 (프로세스 자원 정리 병행).
      killBotChild(r);
    }
    // 상대가 있으면 이탈 배너 + disconnect 결과 알림
    if (r.players.length > 0) {
      // 상대 이탈 배너용 OPPONENT_LEFT 메시지 전송
      broadcastAll(r, { type: 'OPPONENT_LEFT', name: leaverName });
      const remainingId = r.players[0].id;
      broadcastAll(r, {
        type: 'GAME_RESULT',
        winner: remainingId,
        reason: 'disconnect',
      });
      // 남은 플레이어의 상태 리셋 (재대결 대기)
      resetRoomFlags(r);
    } else {
      // 인원 0명 → 룸 즉시 소멸
      roomMap.delete(r.id);
      console.log(`[server] 룸 소멸: ${r.id}`);
    }
  });

  ws.on('error', (err) => {
    console.error(`[tetris] ${player.id} WS 에러 (룸=${ws._room?.id}):`, err.message);
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

  return { handleHttp, handleUpgrade, setHostUrl, ensureRoom };
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
  // getBotUrl은 roomId를 인자로 받아 해당 룸에 봇을 연결하는 URL을 생성한다.
  const app = createApp({
    hostUrl: '',
    getBotUrl: (roomId) => `ws://localhost:${ACTUAL_PORT}/ws?mode=bot&room=${roomId}`,
  });

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
