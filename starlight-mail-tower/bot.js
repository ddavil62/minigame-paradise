/**
 * @fileoverview 별빛 우편탑 1인 테스트용 AI 봇 -- 단일 프로세스에서 p1/p2 두 WS 연결을
 * 동시에 관리하여 전체 협동 등반(부스트, anchor/switch, 체크포인트, 결승)을 자동 수행한다.
 *
 * 실행:
 *   node bot.js --url ws://localhost:3015/ws?mode=bot
 *
 * physical-playthrough.js의 서버리스 드라이버를 실제 WS INPUT 메시지 기반으로 이식한다.
 */

import { WebSocket } from 'ws';
import { getLevel } from './shared/levels.js';

// ── 인자 파싱 ─────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const urlIdx = argv.indexOf('--url');
const BASE_URL = urlIdx >= 0 && argv[urlIdx + 1]
  ? argv[urlIdx + 1]
  : 'ws://localhost:3015/ws?mode=bot';

// ── 상수 ──────────────────────────────────────────────────────────
/** 봇 틱 간격 (30Hz, 서버 TICK_RATE와 동일) */
const BOT_TICK_MS = 33;
/** 각 서브 상태의 최대 틱 제한 (약 30초) */
const MAX_TICKS_PER_PHASE = 900;
/** moveToX 수렴 허용 오차 (px) */
const MOVE_THRESHOLD = 9;

// ── 봇 상태 enum ──────────────────────────────────────────────────
const BOT_PHASE = Object.freeze({
  INIT: 'INIT',
  WAITING: 'WAITING',
  MODULE_BOOST: 'MODULE_BOOST',
  MODULE_ANCHOR: 'MODULE_ANCHOR',
  MODULE_PARTNER_CROSS: 'MODULE_PARTNER_CROSS',
  MODULE_PARTNER_SWITCH: 'MODULE_PARTNER_SWITCH',
  MODULE_ANCHOR_CROSS: 'MODULE_ANCHOR_CROSS',
  MODULE_CHECKPOINT: 'MODULE_CHECKPOINT',
  FINISH_DECK: 'FINISH_DECK',
  FINISH_PRESS: 'FINISH_PRESS',
  DONE: 'DONE',
});

// ── 부스트 서브 상태 ──────────────────────────────────────────────
const BOOST_SUB = Object.freeze({
  ALIGN: 'ALIGN',
  RECEIVER_JUMP: 'RECEIVER_JUMP',
  STRIKER_JUMP: 'STRIKER_JUMP',
  WAIT_LANDING: 'WAIT_LANDING',
});

// ── 상태 변수 ─────────────────────────────────────────────────────
let wsP1 = null;
let wsP2 = null;
let p1Id = null;
let p2Id = null;
let p1Ready = false;
let p2Ready = false;
/** 봇이 실제로 제어하는 플레이어 ID 집합 */
const ownedIds = new Set();
let latestSnapshot = null;
let levelData = null;
let botPhase = BOT_PHASE.INIT;
let moduleIndex = 0;
let boostSub = BOOST_SUB.ALIGN;
let boostTickCounter = 0;
let phaseTicks = 0;
let phaseRetries = 0;
let inputSeqP1 = 0;
let inputSeqP2 = 0;
let gameStarted = false;
let bothClosed = false;
let p1Closed = false;
let p2Closed = false;

/** 각 플레이어의 desired 입력 상태 */
const desired = {
  p1: { left: false, right: false, jump: false, interact: false },
  p2: { left: false, right: false, jump: false, interact: false },
};

console.log(`[starlight-bot] 서버에 접속 시도: ${BASE_URL}`);

// ── WS 연결 생성 ──────────────────────────────────────────────────

/**
 * 단일 WS 연결을 생성하고 이벤트 핸들러를 등록한다.
 * @param {string} url 접속 URL
 * @param {string} roleName 역할 이름 (봇-A 또는 봇-B)
 * @param {string} requestedRole 요청 역할 (p1 또는 p2)
 * @returns {WebSocket}
 */
function createConnection(url, roleName, requestedRole) {
  const ws = new WebSocket(url);

  ws.on('open', () => {
    console.log(`[starlight-bot] ${roleName} 연결됨`);
    ws.send(JSON.stringify({
      type: 'JOIN',
      name: roleName,
      sessionToken: '',
      locale: 'ko',
      requestedRole,
      readyFromLobby: false,
    }));
  });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    handleMessage(ws, msg, requestedRole);
  });

  ws.on('close', (code) => {
    console.log(`[starlight-bot] ${roleName} 연결 종료 (code=${code})`);
    if (requestedRole === 'p1') p1Closed = true;
    else p2Closed = true;
    // 모든 소유 연결이 닫히면 종료
    if (p1Closed && p2Closed && !bothClosed) {
      bothClosed = true;
      process.exit(0);
    }
  });

  ws.on('error', (err) => {
    console.error(`[starlight-bot] ${roleName} 에러:`, err.message);
  });

  return ws;
}

const urlP1 = `${BASE_URL}&requestedRole=p1`;
const urlP2 = `${BASE_URL}&requestedRole=p2`;
wsP1 = createConnection(urlP1, '봇-A', 'p1');
wsP2 = createConnection(urlP2, '봇-B', 'p2');

// ── 메시지 핸들러 ─────────────────────────────────────────────────

/**
 * 서버로부터 수신한 메시지를 처리한다.
 * @param {WebSocket} ws 수신 소켓
 * @param {object} msg 서버 메시지
 * @param {string} requestedRole 요청 역할
 * @returns {void}
 */
function handleMessage(ws, msg, requestedRole) {
  if (msg.type === 'WELCOME') {
    const actualId = msg.playerId;
    if (requestedRole === 'p1') {
      p1Id = actualId;
      p1Ready = true;
      ownedIds.add(actualId);
      console.log(`[starlight-bot] 봇-A → ${actualId} 할당`);
    } else {
      p2Id = actualId;
      p2Ready = true;
      ownedIds.add(actualId);
      console.log(`[starlight-bot] 봇-B → ${actualId} 할당`);
    }

    // 레벨 데이터 로드
    if (!levelData && msg.selectedLevelId) {
      levelData = getLevel(msg.selectedLevelId);
      if (levelData) {
        console.log(`[starlight-bot] 레벨 로드: ${levelData.id} (모듈 ${levelData.modules.length}개)`);
      }
    }

    // 양쪽 모두 WELCOME 수신 시 READY 전송
    if (p1Ready && p2Ready) {
      sendTo(wsP1, { type: 'READY' });
      sendTo(wsP2, { type: 'READY' });
      botPhase = BOT_PHASE.WAITING;
      console.log('[starlight-bot] 양쪽 READY 전송, START 대기');
    }
    return;
  }

  if (msg.type === 'START') {
    gameStarted = true;
    // START 메시지에서 레벨 ID가 오면 레벨 데이터 재로드
    if (msg.levelId && !levelData) {
      levelData = getLevel(msg.levelId);
    }
    if (msg.levelId && levelData && levelData.id !== msg.levelId) {
      levelData = getLevel(msg.levelId);
    }
    botPhase = BOT_PHASE.MODULE_BOOST;
    moduleIndex = 0;
    boostSub = BOOST_SUB.ALIGN;
    boostTickCounter = 0;
    phaseTicks = 0;
    phaseRetries = 0;
    console.log('[starlight-bot] 게임 시작 → MODULE_BOOST(0)');
    return;
  }

  if (msg.type === 'SNAPSHOT') {
    latestSnapshot = msg;
    // SNAPSHOT에서 레벨 데이터 추출 (폴백)
    if (!levelData && msg.levelId) {
      levelData = getLevel(msg.levelId);
    }
    return;
  }

  if (msg.type === 'EVENT') {
    if (msg.kind === 'COOP_BOOST') {
      console.log(`[starlight-bot] COOP_BOOST 이벤트 수신 (receiver=${msg.payload?.receiverId})`);
    }
    return;
  }

  if (msg.type === 'GAME_OVER') {
    console.log(`[starlight-bot] GAME_OVER: ${msg.elapsedMs}ms, falls=${msg.falls}`);
    // 소유한 슬롯에 RESULT_VOTE 전송
    setTimeout(() => {
      if (ownedIds.has(p1Id)) sendTo(wsP1, { type: 'RESULT_VOTE', action: 'RETRY' });
      if (ownedIds.has(p2Id)) sendTo(wsP2, { type: 'RESULT_VOTE', action: 'RETRY' });
      botPhase = BOT_PHASE.DONE;
      console.log('[starlight-bot] RESULT_VOTE(RETRY) 전송');
    }, 500);
    return;
  }

  if (msg.type === 'SESSION_ENDED') {
    console.log(`[starlight-bot] SESSION_ENDED: reason=${msg.reason}`);
    process.exit(0);
  }

  if (msg.type === 'ERROR') {
    if (msg.code === 'ROOM_FULL') {
      // 인간이 이미 한 슬롯을 점유한 경우, 두 번째 봇 연결은 ROOM_FULL을 받는다.
      // 이미 하나의 연결이 성공했으면 그 연결만으로 운영한다.
      console.log(`[starlight-bot] ${requestedRole} 슬롯 불가 (ROOM_FULL). 인간 파트너 모드.`);
      if (requestedRole === 'p1') {
        p1Ready = true; // 스킵 처리 (인간이 p1)
        p1Closed = true;
        if (ws.readyState === WebSocket.OPEN) ws.close();
      } else {
        p2Ready = true; // 스킵 처리 (인간이 p2)
        p2Closed = true;
        if (ws.readyState === WebSocket.OPEN) ws.close();
      }
      // 다른 쪽이 이미 WELCOME을 받았으면 READY 전송
      if (p1Ready && p2Ready && ownedIds.size > 0) {
        for (const id of ownedIds) {
          const ownedWs = id === p1Id ? wsP1 : wsP2;
          sendTo(ownedWs, { type: 'READY' });
        }
        botPhase = BOT_PHASE.WAITING;
        console.log('[starlight-bot] 단일 슬롯 READY 전송, START 대기');
      }
    }
  }
}

// ── 전송 헬퍼 ─────────────────────────────────────────────────────

/**
 * 특정 소켓에 JSON 메시지를 전송한다.
 * @param {WebSocket} ws 대상 소켓
 * @param {object} payload 메시지
 * @returns {void}
 */
function sendTo(ws, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

/**
 * 특정 플레이어의 현재 desired 입력을 INPUT 메시지로 전송한다.
 * 봇이 소유하지 않는 플레이어(인간이 조종)의 입력은 전송하지 않는다.
 * @param {string} playerId 플레이어 ID (p1 또는 p2)
 * @returns {void}
 */
function sendInput(playerId) {
  if (!ownedIds.has(playerId)) return; // 인간이 조종하는 역할은 건드리지 않는다
  const ws = playerId === p1Id ? wsP1 : wsP2;
  const input = desired[playerId];
  const seq = playerId === p1Id ? inputSeqP1++ : inputSeqP2++;
  sendTo(ws, {
    type: 'INPUT',
    seq,
    left: input.left,
    right: input.right,
    jump: input.jump,
    interact: input.interact,
  });
  // jump는 1틱 후 자동 false로 리셋 (점프 키 held 방지)
  input.jump = false;
}

// ── 입력 드라이버 헬퍼 ────────────────────────────────────────────

/**
 * 특정 플레이어를 목표 X좌표로 이동시키기 위한 desired 입력을 계산한다.
 * @param {string} playerId 플레이어 ID
 * @param {number} targetX 목표 X좌표
 * @returns {boolean} 도달 여부
 */
function driveToX(playerId, targetX) {
  const actor = getPlayer(playerId);
  if (!actor) return false;
  const dx = targetX - actor.x;
  if (Math.abs(dx) <= MOVE_THRESHOLD) {
    desired[playerId].left = false;
    desired[playerId].right = false;
    return true;
  }
  desired[playerId].left = dx < 0;
  desired[playerId].right = dx > 0;
  return false;
}

/**
 * 스냅샷에서 특정 플레이어 데이터를 가져온다.
 * @param {string} playerId 플레이어 ID
 * @returns {object|null}
 */
function getPlayer(playerId) {
  if (!latestSnapshot) return null;
  return latestSnapshot.players.find((p) => p.id === playerId) ?? null;
}

/**
 * 스냅샷에서 특정 ID의 동적 플랫폼을 찾는다.
 * @param {string} platformId 플랫폼 ID
 * @returns {object|null}
 */
function getSnapshotPlatform(platformId) {
  if (!latestSnapshot) return null;
  // SNAPSHOT의 level.platforms에서 찾기
  const plats = latestSnapshot.level?.platforms;
  if (!plats) return null;
  return plats.find((p) => p.id === platformId) ?? null;
}

/**
 * 레벨 데이터에서 특정 ID의 플랫폼을 찾는다.
 * @param {string} platformId 플랫폼 ID
 * @returns {object|null}
 */
function getLevelPlatform(platformId) {
  if (!levelData) return null;
  return levelData.platforms.find((p) => p.id === platformId) ?? null;
}

/**
 * desired 입력을 모두 초기화한다.
 * @param {string} playerId 플레이어 ID
 * @returns {void}
 */
function clearDesired(playerId) {
  desired[playerId].left = false;
  desired[playerId].right = false;
  desired[playerId].jump = false;
  desired[playerId].interact = false;
}

// ── 상태 머신 ─────────────────────────────────────────────────────

/**
 * 30Hz 메인 틱 루프. 상태 머신을 한 스텝 실행하고 두 플레이어의 INPUT을 전송한다.
 * @returns {void}
 */
function tick() {
  if (!gameStarted || !latestSnapshot || !levelData) return;
  if (botPhase === BOT_PHASE.INIT || botPhase === BOT_PHASE.WAITING || botPhase === BOT_PHASE.DONE) return;

  // 타임아웃 방어
  phaseTicks++;
  if (phaseTicks > MAX_TICKS_PER_PHASE) {
    phaseRetries++;
    if (phaseRetries >= 3) {
      console.error(`[starlight-bot] 3회 타임아웃 초과 (phase=${botPhase}, module=${moduleIndex}). 종료.`);
      process.exit(1);
    }
    console.warn(`[starlight-bot] 타임아웃 (phase=${botPhase}, module=${moduleIndex}), 재시도 ${phaseRetries}/3`);
    phaseTicks = 0;
    // BOOST 서브 상태를 재시작
    if (botPhase === BOT_PHASE.MODULE_BOOST) {
      boostSub = BOOST_SUB.ALIGN;
      boostTickCounter = 0;
    }
  }

  // 현재 상태에 따라 상태 머신 실행
  switch (botPhase) {
    case BOT_PHASE.MODULE_BOOST: runModuleBoost(); break;
    case BOT_PHASE.MODULE_ANCHOR: runModuleAnchor(); break;
    case BOT_PHASE.MODULE_PARTNER_CROSS: runModulePartnerCross(); break;
    case BOT_PHASE.MODULE_PARTNER_SWITCH: runModulePartnerSwitch(); break;
    case BOT_PHASE.MODULE_ANCHOR_CROSS: runModuleAnchorCross(); break;
    case BOT_PHASE.MODULE_CHECKPOINT: runModuleCheckpoint(); break;
    case BOT_PHASE.FINISH_DECK: runFinishDeck(); break;
    case BOT_PHASE.FINISH_PRESS: runFinishPress(); break;
    default: break;
  }

  // 소유한 플레이어의 INPUT 전송
  if (p1Id) sendInput(p1Id);
  if (p2Id) sendInput(p2Id);
}

// ── 모듈 부스트 단계 ──────────────────────────────────────────────

/**
 * 모듈 부스트 시퀀스를 실행한다.
 * physical-playthrough.js의 boostToModule 패턴을 WS 기반으로 이식.
 * @returns {void}
 */
function runModuleBoost() {
  const module = levelData.modules[moduleIndex];
  if (!module) {
    console.error(`[starlight-bot] 모듈 ${moduleIndex} 없음`);
    return;
  }

  const receiverId = module.requiredPlayerId;
  const strikerId = receiverId === 'p1' ? 'p2' : 'p1';

  // approach 플랫폼 (하단)과 landing 플랫폼 (상단) 좌표
  const lower = getSnapshotPlatform(module.approachPlatformId) ?? getLevelPlatform(module.approachPlatformId);
  const upper = getSnapshotPlatform(module.boostLandingPlatformId) ?? getLevelPlatform(module.boostLandingPlatformId);
  if (!lower || !upper) return;

  // overlap 영역의 중심 X 계산
  const overlapLeft = Math.max(lower.x + 28, upper.x + 28);
  const overlapRight = Math.min(lower.x + lower.width - 28, upper.x + upper.width - 28);
  const alignX = (overlapLeft + overlapRight) / 2;

  switch (boostSub) {
    case BOOST_SUB.ALIGN: {
      // 두 플레이어를 alignX로 이동
      const receiverReady = driveToX(receiverId, alignX);
      const strikerReady = driveToX(strikerId, alignX);
      if (receiverReady && strikerReady) {
        // receiver 점프 시작
        desired[receiverId].jump = true;
        boostSub = BOOST_SUB.RECEIVER_JUMP;
        boostTickCounter = 0;
        console.log(`[starlight-bot] 부스트: receiver(${receiverId}) 점프`);
      }
      break;
    }
    case BOOST_SUB.RECEIVER_JUMP: {
      boostTickCounter++;
      // 5틱 후 striker 점프
      if (boostTickCounter >= 5) {
        desired[strikerId].jump = true;
        boostSub = BOOST_SUB.STRIKER_JUMP;
        boostTickCounter = 0;
        console.log(`[starlight-bot] 부스트: striker(${strikerId}) 점프`);
      }
      break;
    }
    case BOOST_SUB.STRIKER_JUMP: {
      boostSub = BOOST_SUB.WAIT_LANDING;
      boostTickCounter = 0;
      break;
    }
    case BOOST_SUB.WAIT_LANDING: {
      boostTickCounter++;
      const receiver = getPlayer(receiverId);
      if (!receiver) break;
      // receiver가 upper 플랫폼에 grounded 상태인지 확인
      if (receiver.grounded && receiver.y < upper.y + 30) {
        console.log(`[starlight-bot] 부스트 완료: ${receiverId} 착지 (y=${receiver.y.toFixed(1)})`);
        transitionTo(BOT_PHASE.MODULE_ANCHOR);
        break;
      }
      // 부스트 실패 시 재시도 (90틱 내 성공 못하면 ALIGN으로 리셋)
      if (boostTickCounter > 180) {
        console.warn(`[starlight-bot] 부스트 착지 대기 초과, ALIGN으로 리셋`);
        boostSub = BOOST_SUB.ALIGN;
        boostTickCounter = 0;
        clearDesired(receiverId);
        clearDesired(strikerId);
      }
      break;
    }
    default:
      break;
  }
}

// ── 모듈 앵커 단계 ────────────────────────────────────────────────

/**
 * 앵커 역할 플레이어를 anchor 좌표로 이동시키고 interact를 유지한다.
 * @returns {void}
 */
function runModuleAnchor() {
  const module = levelData.modules[moduleIndex];
  const anchorId = module.requiredPlayerId;

  // anchorId를 anchor.x로 이동
  const reached = driveToX(anchorId, module.anchor.x);
  if (reached) {
    desired[anchorId].interact = true;
  }

  // SNAPSHOT에서 device 상태 확인
  const device = latestSnapshot.devices?.[moduleIndex];
  if (device && device.state === 'POWERED') {
    console.log(`[starlight-bot] 모듈 ${moduleIndex} POWERED`);
    transitionTo(BOT_PHASE.MODULE_PARTNER_CROSS);
  }
}

// ── 파트너 크로스 단계 (파트너가 route를 통해 스위치 근처까지 이동) ───

/**
 * 파트너가 approach -> return -> start -> route -> end 플랫폼을 거쳐 이동한다.
 * 간단하게 end 플랫폼의 switch.x 근처로 직접 이동시킨다.
 * @returns {void}
 */
function runModulePartnerCross() {
  const module = levelData.modules[moduleIndex];
  const anchorId = module.requiredPlayerId;
  const partnerId = anchorId === 'p1' ? 'p2' : 'p1';

  // 앵커는 interact 유지
  desired[anchorId].interact = true;

  // 파트너에게 미리 interact를 유지 (스위치 반경 진입 첫 틱을 놓치지 않도록)
  desired[partnerId].interact = true;

  // 파트너를 switch.x로 이동
  const reached = driveToX(partnerId, module.switch.x);
  if (reached) {
    console.log(`[starlight-bot] 파트너 ${partnerId} 스위치 도달`);
    transitionTo(BOT_PHASE.MODULE_PARTNER_SWITCH);
  }
}

// ── 파트너 스위치 단계 ────────────────────────────────────────────

/**
 * 파트너가 switch 위치에서 interact를 유지하고 LATCHED를 기다린다.
 * @returns {void}
 */
function runModulePartnerSwitch() {
  const module = levelData.modules[moduleIndex];
  const anchorId = module.requiredPlayerId;
  const partnerId = anchorId === 'p1' ? 'p2' : 'p1';

  // 앵커는 interact 유지
  desired[anchorId].interact = true;
  // 파트너도 interact 유지
  desired[partnerId].interact = true;
  // 파트너를 switch.x에 정렬 유지
  driveToX(partnerId, module.switch.x);

  // LATCHED 확인
  const device = latestSnapshot.devices?.[moduleIndex];
  if (device && device.state === 'LATCHED') {
    console.log(`[starlight-bot] 모듈 ${moduleIndex} LATCHED`);
    // interact 해제
    desired[anchorId].interact = false;
    desired[partnerId].interact = false;
    transitionTo(BOT_PHASE.MODULE_ANCHOR_CROSS);
  }
}

// ── 앵커 크로스 단계 ──────────────────────────────────────────────

/**
 * LATCHED 후 두 플레이어 모두 체크포인트 방향으로 이동한다.
 * 앵커 플레이어도 end 플랫폼 쪽으로 이동해야 하므로 switch.x 근처로 보낸다.
 * @returns {void}
 */
function runModuleAnchorCross() {
  const module = levelData.modules[moduleIndex];
  const checkpoint = module.checkpoint;
  const checkpointCenterX = checkpoint.x + checkpoint.width / 2;

  // 두 플레이어 모두 체크포인트 중심으로 이동
  const p1Reached = driveToX('p1', checkpointCenterX - 24);
  const p2Reached = driveToX('p2', checkpointCenterX + 24);

  if (p1Reached && p2Reached) {
    console.log(`[starlight-bot] 두 플레이어 체크포인트 도달 대기`);
    transitionTo(BOT_PHASE.MODULE_CHECKPOINT);
  }
}

// ── 체크포인트 단계 ───────────────────────────────────────────────

/**
 * checkpointId가 moduleIndex + 1이 될 때까지 대기한다.
 * @returns {void}
 */
function runModuleCheckpoint() {
  const module = levelData.modules[moduleIndex];
  const checkpoint = module.checkpoint;
  const checkpointCenterX = checkpoint.x + checkpoint.width / 2;

  // 체크포인트 영역 내 위치 유지
  driveToX('p1', checkpointCenterX - 24);
  driveToX('p2', checkpointCenterX + 24);

  if (latestSnapshot.checkpointId >= moduleIndex + 1) {
    console.log(`[starlight-bot] 체크포인트 ${moduleIndex + 1} 달성`);
    moduleIndex++;
    if (moduleIndex >= levelData.modules.length) {
      console.log('[starlight-bot] 전체 모듈 완료 → FINISH_DECK');
      transitionTo(BOT_PHASE.FINISH_DECK);
    } else {
      console.log(`[starlight-bot] 다음 모듈 ${moduleIndex} → MODULE_BOOST`);
      transitionTo(BOT_PHASE.MODULE_BOOST);
      boostSub = BOOST_SUB.ALIGN;
      boostTickCounter = 0;
    }
  }
}

// ── 결승 데크 단계 ────────────────────────────────────────────────

/**
 * 두 플레이어를 finish-deck 플랫폼으로 이동시킨다.
 * @returns {void}
 */
function runFinishDeck() {
  const finishDeck = getSnapshotPlatform('finish-deck') ?? getLevelPlatform('finish-deck');
  if (!finishDeck) return;

  const deckCenterX = finishDeck.x + finishDeck.width / 2;
  const p1Reached = driveToX('p1', deckCenterX - 50);
  const p2Reached = driveToX('p2', deckCenterX + 50);

  // 두 플레이어가 finish-deck에 올라갔는지 grounded 확인
  const p1Actor = getPlayer('p1');
  const p2Actor = getPlayer('p2');
  if (p1Reached && p2Reached && p1Actor?.grounded && p2Actor?.grounded) {
    console.log('[starlight-bot] finish-deck 착지 → FINISH_PRESS');
    transitionTo(BOT_PHASE.FINISH_PRESS);
  }
}

// ── 결승 프레스 단계 ──────────────────────────────────────────────

/**
 * p1을 leftSwitch, p2를 rightSwitch로 이동시키고 interact를 유지한다.
 * @returns {void}
 */
function runFinishPress() {
  const finish = levelData.finish;

  // p1 → leftSwitch, p2 → rightSwitch
  const p1Reached = driveToX('p1', finish.leftSwitch.x);
  const p2Reached = driveToX('p2', finish.rightSwitch.x);

  if (p1Reached) desired.p1.interact = true;
  if (p2Reached) desired.p2.interact = true;

  // phase가 result로 전환되면 완료
  if (latestSnapshot.phase === 'result') {
    console.log('[starlight-bot] 게임 완료! phase=result');
    botPhase = BOT_PHASE.DONE;
    clearDesired('p1');
    clearDesired('p2');
  }
}

// ── 상태 전환 헬퍼 ────────────────────────────────────────────────

/**
 * 새로운 봇 상태로 전환하고 타이머를 리셋한다.
 * @param {string} newPhase 새 상태
 * @returns {void}
 */
function transitionTo(newPhase) {
  botPhase = newPhase;
  phaseTicks = 0;
  phaseRetries = 0;
  clearDesired('p1');
  clearDesired('p2');
}

// ── 30Hz 틱 루프 시작 ─────────────────────────────────────────────
const tickTimer = setInterval(tick, BOT_TICK_MS);
tickTimer.unref();

// ── 프로세스 종료 시 소켓 정리 ────────────────────────────────────
process.on('SIGTERM', () => {
  console.log('[starlight-bot] SIGTERM 수신, 종료');
  clearInterval(tickTimer);
  if (wsP1 && wsP1.readyState === WebSocket.OPEN) wsP1.close();
  if (wsP2 && wsP2.readyState === WebSocket.OPEN) wsP2.close();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[starlight-bot] SIGINT 수신, 종료');
  clearInterval(tickTimer);
  if (wsP1 && wsP1.readyState === WebSocket.OPEN) wsP1.close();
  if (wsP2 && wsP2.readyState === WebSocket.OPEN) wsP2.close();
  process.exit(0);
});
