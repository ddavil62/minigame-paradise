/**
 * @fileoverview 별빛 우편탑 협동 파트너 AI 봇 -- 슬롯 단위 독립 에이전트 구조.
 *
 * 인간이 한 슬롯을 점유하면 봇은 자기 슬롯만 능동 제어하되,
 * SNAPSHOT에서 인간의 상태를 참조 정보로 사용해 협동 시퀀스를 자율 진행한다.
 * 봇이 p1+p2 두 슬롯을 모두 소유하는 셀프 플레이스루도 동일 로직으로 동작한다.
 *
 * 실행:
 *   node bot.js --url ws://localhost:3015/ws?mode=bot
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
/** moveToX 수렴 허용 오차 (px) */
const ARRIVE_THRESHOLD = 9;
/** 교착 감지 최소 이동 거리 (px) */
const STUCK_DISTANCE = 5;
/** 교착 감지 주기 (틱) — 30틱마다 위치 기록, 90틱(3초) 동안 미이동 시 교착 */
const STUCK_CHECK_INTERVAL = 30;
/** 교착 판정 누적 틱 */
const STUCK_TICKS = 90;
/** Jiggle 지속 틱 */
const JIGGLE_TICKS = 40;
/** 상호작용 반경 (px) */
const INTERACT_RADIUS = 84;
/** 부스트 접근 허용 오차 (px) */
const BOOST_ALIGN_THRESHOLD = 12;
/** 부스트 대기 최대 틱 (120틱 = 4초) */
const BOOST_WAIT_MAX_TICKS = 120;
/** 부스트 점프 대기 틱 (30틱 = 1초) */
const BOOST_JUMP_WAIT_TICKS = 30;
/** 부스트 대기 장기 타임아웃 (750틱 = 25초) — 정당한 대기를 교착으로 오판하지 않기 위한 긴 타임아웃 */
const BOOST_LONG_TIMEOUT_TICKS = 750;
/** Fallback 대기 틱 (900틱 = 30초) */
const FALLBACK_WAIT_TICKS = 900;
/** 서버 기본 중력 */
const DEFAULT_GRAVITY = 1450;
/** 서버 기본 점프 속도 */
const DEFAULT_JUMP_SPEED = 650;
/** 플레이어 높이 (서버 PLAYER_HEIGHT) */
const PLAYER_HEIGHT = 56;
/** 플레이어 너비 (서버 PLAYER_WIDTH) */
const PLAYER_WIDTH = 40;
/** 서버 시뮬레이션 dt (1/30초) */
const SIM_DT = 1 / 30;
/** 전방 시뮬레이션 최대 틱 수 — FIX-5: receiver 궤도 전체를 커버할 수 있도록 확장 */
const FORWARD_SIM_MAX_TICKS = 30;
/** 봇이 INPUT을 보낸 뒤 서버 틱에 반영되기까지의 최소 지연 (틱) */
const INPUT_APPLY_DELAY_TICKS = 1;
/** 수평 정렬 최대 허용 거리 (px) — shouldStrikerJump 전방 시뮬에서 사용 */
const STRIKER_ALIGN_X_THRESHOLD = 24;
/** 발판 가장자리 여유 (px) */
const PLATFORM_EDGE_MARGIN = 24;
/** receiver 점프 재시도 최소 쿨다운 (틱) */
const RECEIVER_JUMP_COOLDOWN = 15;
/** 서버 isCoopBoostCandidate 조건 상수 */
const MIN_STRIKER_UP_SPEED = 80;
const MIN_CLOSING_SPEED = 120;
/** 저중력 장치 중력 스케일 */
const LOW_GRAVITY_SCALE = 0.42;
/** 서버 기본 이동 속도 (px/s) */
const DEFAULT_MOVE_SPEED = 250;
/** 점프 도약 시 발판 가장자리 안쪽 마진 (px) */
const JUMP_EDGE_INSET = 16;
/** 점프 높이 안전 마진 (px) — 물리 오차·SNAPSHOT 이산화 보정 */
const JUMP_HEIGHT_SAFETY = 10;
/** 낙하 도달 시 수평 마진 (px) */
const FALL_HORIZONTAL_MARGIN = 8;
/** 내비게이션 경로 캐시 무효화를 위한 최대 보유 틱 */
const NAV_CACHE_MAX_TICKS = 60;
/** 점프 쿨다운 (틱) — grounded 후 즉시 점프하면 서버가 grounded를 아직 갱신하지 않을 수 있다 */
const NAV_JUMP_COOLDOWN = 4;

// ── 목표 종류 ──────────────────────────────────────────────────────
const GOAL = Object.freeze({
  WAIT_RESPAWN: 'WAIT_RESPAWN',
  RECOMPUTE: 'RECOMPUTE',
  DONE: 'DONE',
  BOOST_RECEIVER: 'BOOST_RECEIVER',
  BOOST_STRIKER: 'BOOST_STRIKER',
  GO_ANCHOR: 'GO_ANCHOR',
  HOLD_ANCHOR: 'HOLD_ANCHOR',
  WAIT_NEAR_SWITCH: 'WAIT_NEAR_SWITCH',
  GO_SWITCH: 'GO_SWITCH',
  GO_CHECKPOINT: 'GO_CHECKPOINT',
  FINISH_PRESS: 'FINISH_PRESS',
  FALLBACK_WAIT: 'FALLBACK_WAIT',
  JIGGLE: 'JIGGLE',
});

// ── 부스트 서브 상태 ──────────────────────────────────────────────
const BOOST_SUB = Object.freeze({
  ALIGN: 'ALIGN',
  JUMPING: 'JUMPING',
  WAIT_LAND: 'WAIT_LAND',
});

// ── FIX-1: 전방 시뮬레이션 기반 striker 점프 판정 (순수 함수, export) ─

/**
 * striker가 지금 점프하면 서버 isCoopBoostCandidate 조건을 맞출 수 있는지
 * 최대 FORWARD_SIM_MAX_TICKS 틱 앞까지 탄도를 적분해 판정한다.
 *
 * 서버 조건 (simulation.js:88-98):
 *   1. prevGap >= 60  (이전 틱 striker.top - receiver.bottom >= 4 → gap >= 60)
 *   2. gap ∈ [48, 64]  (현재 틱 수직 경계 접촉 띠 +-8px)
 *   3. strikerVy <= -80
 *   4. (receiverVy - strikerVy) >= 120
 *   5. gap > 0  (striker가 아래)
 *
 * gap 정의: striker.y - receiver.y (양수 = striker가 아래)
 * 서버의 실제 조건은 AABB 기반이므로:
 *   strikerTop = striker.y - 28, receiverBottom = receiver.y + 28
 *   verticalBoundaryDelta = strikerTop - receiverBottom = gap - 56
 *   조건: verticalBoundaryDelta ∈ [-8, 8] → gap ∈ [48, 64]
 *   previousStriker.top + 0.01 >= previousReceiver.bottom + 4
 *     → prevGap - 56 + 0.01 >= 4 → prevGap >= 59.99 → 실질 prevGap >= 60
 *
 * @param {{x:number, y:number, vy:number, grounded:boolean}} striker
 * @param {{x:number, y:number, vy:number, grounded:boolean}} receiver
 * @param {{gravity:number, jumpSpeed:number}} physics
 * @param {number} [latencyTicks] SNAPSHOT 지연 + 입력 전달 지연(틱). 이 시간만큼
 *   receiver가 더 낙하한 뒤에야 봇의 점프가 서버에 반영되므로 반드시 보정해야 한다.
 * @returns {boolean}
 */
export function shouldStrikerJump(striker, receiver, physics, latencyTicks = 0) {
  // 전제 조건
  if (!striker.grounded) return false;
  if (Math.abs(striker.x - receiver.x) > STRIKER_ALIGN_X_THRESHOLD) return false;
  if (receiver.grounded) return false;

  // 부스트는 두 캐릭터가 같은 발판에서 출발하는 것을 전제한다.
  // 점프 최대 상승고(jumpSpeed^2 / 2g)보다 높이 있는 receiver는 다른 발판에 있는 것이므로
  // striker가 아무리 잘 뛰어도 접촉 띠에 들어갈 수 없다.
  const maxRise = (physics.jumpSpeed * physics.jumpSpeed) / (2 * physics.gravity);
  const gap0 = striker.y - receiver.y;
  if (gap0 > maxRise + 20 || gap0 < -20) return false;

  // FIX-5: 지연 후보 중 1개 이상에서 명중하면 점프한다.
  // 이전 구현은 2/3 명중을 요구했으나 SNAPSHOT 15Hz 해상도 + 이산 틱 오차로
  // 실제 부스트 타이밍을 놓치는 일이 잦았다. 1-hit으로 완화하면 조기/지각 점프
  // 리스크가 있지만, 재시도 비용(receiver 재점프)이 낮으므로 적극 시도가 유리하다.
  const base = Math.max(0, Math.round(latencyTicks));
  const candidates = base === 0 ? [0, 1, 2] : [base - 1, base, base + 1];
  for (const delay of candidates) {
    if (simulateBoostHit(striker.y, receiver.y, receiver.vy, physics, delay)) return true;
  }
  return false;
}

/**
 * 지정한 지연 뒤 striker가 점프했을 때 서버의 부스트 접촉 조건을 만족하는 틱이 있는지 판정한다.
 * @param {number} strikerY striker 중심 Y (grounded 상태이므로 지연 동안 불변)
 * @param {number} receiverY receiver 중심 Y
 * @param {number} receiverVy receiver 수직 속도
 * @param {{gravity:number, jumpSpeed:number}} physics 물리 상수
 * @param {number} latencyTicks 점프가 서버에 반영되기까지의 지연(틱)
 * @returns {boolean}
 */
function simulateBoostHit(strikerY, receiverY, receiverVy, physics, latencyTicks) {
  const { gravity, jumpSpeed } = physics;
  // FIX-5: 서버의 정확한 gap 밴드는 [48,64]이지만, SNAPSHOT 이산화 오차 +
  // dead reckoning 오차 + 서버 적분 순서 차이를 감안해 넓게 완화한다.
  // 이 함수가 true를 반환해도 서버에서 실패할 수 있지만, 그 경우 receiver가
  // 재점프하여 재시도한다. 놓치는 것보다 시도하는 것이 낫다.
  const GAP_LOWER = 38;
  const GAP_UPPER = 74;
  const PREV_GAP_MIN = 50; // 서버 60보다 넓게 완화

  let ry = receiverY;
  let rvy = receiverVy;
  // 지연 보정: 결정 시점과 서버 반영 시점 사이에 receiver는 계속 이동한다.
  // striker는 grounded이므로 이 구간에서 위치가 변하지 않는다.
  for (let i = 0; i < latencyTicks; i++) {
    rvy += gravity * SIM_DT;
    ry += rvy * SIM_DT;
  }

  let sy = strikerY;
  let svy = -jumpSpeed;
  let prevGap = sy - ry; // 지연 보정 후 점프 직전 gap

  // 부스트는 두 캐릭터가 같은 approach 발판에서 시작하는 상황을 전제한다.
  // 따라서 receiver의 착지 바닥은 striker의 발판(strikerY)과 같다.
  // 이 경계를 넘어가면 receiver는 이미 착지했으므로 예측이 무의미하다.
  const groundY = strikerY;

  for (let t = 0; t < FORWARD_SIM_MAX_TICKS; t++) {
    svy += gravity * SIM_DT;
    sy += svy * SIM_DT;
    rvy += gravity * SIM_DT;
    ry += rvy * SIM_DT;

    // striker가 점프 포물선을 마치고 발판에 되돌아오면 더 볼 것이 없다.
    if (svy > 0 && sy >= groundY) return false;
    // receiver가 발판에 착지하면 접근 속도가 사라져 부스트가 성립하지 않는다.
    if (rvy > 0 && ry >= groundY) return false;

    const gap = sy - ry;
    if (
      prevGap >= PREV_GAP_MIN
      && gap >= GAP_LOWER && gap <= GAP_UPPER
      && svy <= -MIN_STRIKER_UP_SPEED
      && (rvy - svy) >= MIN_CLOSING_SPEED
      && gap > 0
    ) {
      return true;
    }
    prevGap = gap;
  }
  return false;
}

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
/** SNAPSHOT 수신 시각 (dead reckoning용) */
let snapshotReceivedAt = 0;
let levelData = null;
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
/** 인간 슬롯의 마지막으로 미러링한 action (중복 전송·무한 루프 방지) */
const lastMirroredAction = new Map();

/**
 * 슬롯별 독립 에이전트 상태
 * @type {Map<string, {goal: string, prevGoal: string, stuckTicks: number, jiggleDir: number, jiggleTicks: number, boostSub: string, boostTick: number, boostFailCount: number, lastRecordedX: number, lastRecordedTick: number, unchangedTicks: number, fallbackTick: number, receiverCooldown: number, targetX: number, boostWaitTotalTick: number, navPath: string[]|null, navTargetPlatId: string|null, navCacheTick: number, navJumpCooldown: number, navLastGroundedPlatId: string|null}>}
 */
const agentState = new Map();

console.log(`[starlight-bot] 서버에 접속 시도: ${BASE_URL}`);

// ── 에이전트 상태 초기화 ──────────────────────────────────────────

/**
 * 슬롯 에이전트 상태를 초기화한다.
 * @param {string} slotId 슬롯 ID
 * @returns {void}
 */
function initAgent(slotId) {
  agentState.set(slotId, {
    goal: GOAL.RECOMPUTE,
    prevGoal: '',
    stuckTicks: 0,
    jiggleDir: 1,
    jiggleTicks: 0,
    boostSub: BOOST_SUB.ALIGN,
    boostTick: 0,
    boostFailCount: 0,
    lastRecordedX: 0,
    lastRecordedTick: 0,
    unchangedTicks: 0,
    fallbackTick: 0,
    receiverCooldown: 0,
    targetX: NaN,
    boostWaitTotalTick: 0,
    navPath: null,
    navTargetPlatId: null,
    navCacheTick: 0,
    navJumpCooldown: 0,
    navLastGroundedPlatId: null,
  });
}

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
      initAgent(actualId);
      console.log(`[starlight-bot] 봇-A → ${actualId} 할당`);
    } else {
      p2Id = actualId;
      p2Ready = true;
      ownedIds.add(actualId);
      initAgent(actualId);
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
    // 모든 에이전트 상태 초기화
    for (const slotId of ownedIds) initAgent(slotId);
    console.log('[starlight-bot] 게임 시작');
    return;
  }

  if (msg.type === 'SNAPSHOT') {
    latestSnapshot = msg;
    snapshotReceivedAt = performance.now();
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
    for (const slotId of ownedIds) setGoal(slotId, GOAL.DONE);
    // #62: RESULT_VOTE는 RESULT_VOTE_STATE 수신 시 인간의 선택을 미러링한다.
    // 봇이 두 슬롯을 모두 소유하는 셀프 플레이스루(인간 없음)에서는
    // 서버가 투표 없이는 합의를 진행하지 않으므로, 아래 RESULT_VOTE_STATE 핸들러의
    // allBot 분기에서 RETRY 폴백을 전송한다.
    lastMirroredAction.clear();
    // 인간 슬롯 판별: SNAPSHOT 기반으로 양쪽 player ID를 확인하여
    // 봇이 소유하지 않는 ID를 인간으로 간주한다.
    // (p1Id/p2Id는 봇이 WELCOME을 받은 슬롯만 설정되므로 인간 슬롯 ID가 null일 수 있다)
    const allPlayerIds = latestSnapshot?.players?.map((p) => p.id) ?? [];
    const humanSlotId = allPlayerIds.find((id) => !ownedIds.has(id));
    if (!humanSlotId) {
      // 셀프 플레이스루: 인간이 없으면 봇이 먼저 한 표를 던져 RESULT_VOTE_STATE를 유발한다
      setTimeout(() => {
        const firstOwned = [...ownedIds][0];
        if (firstOwned) {
          const ws = firstOwned === p1Id ? wsP1 : wsP2;
          sendTo(ws, { type: 'RESULT_VOTE', action: 'RETRY' });
          console.log(`[starlight-bot] 셀프 플레이스루 첫 RESULT_VOTE(RETRY) -> ${firstOwned}`);
        }
      }, 500);
    }
    return;
  }

  // #62: RESULT_VOTE_STATE 핸들러 — 인간의 결과 화면 선택을 미러링한다
  if (msg.type === 'RESULT_VOTE_STATE') {
    const votes = msg.votes ?? {};
    // 합의 진행 중(processing) / 초기화(menu) / 파트너 이탈(partner_left) 상태에서는
    // 미러링하지 않는다 (서버가 전환 처리 중이므로 추가 전송은 불필요하고 위험하다)
    if (msg.status === 'processing' || msg.status === 'menu' || msg.status === 'partner_left') {
      return;
    }
    // 인간 슬롯 판별: SNAPSHOT과 votes에서 양쪽 player ID를 합산하여
    // 봇이 소유하지 않는 ID를 인간으로 간주한다.
    const knownIds = new Set([
      ...(latestSnapshot?.players?.map((p) => p.id) ?? []),
      ...Object.keys(votes),
    ]);
    const humanSlotId = [...knownIds].find((id) => !ownedIds.has(id));

    if (!humanSlotId) {
      // 봇이 두 슬롯 모두 소유하는 셀프 플레이스루:
      // 미러링 대상이 없으므로 RETRY를 폴백으로 전송한다.
      // 양쪽 모두 이미 투표했으면 재전송하지 않는다 (무한 루프 방지).
      const allVoted = [...ownedIds].every((id) => votes[id]);
      if (!allVoted) {
        for (const slotId of ownedIds) {
          if (!votes[slotId]) {
            const ws = slotId === p1Id ? wsP1 : wsP2;
            sendTo(ws, { type: 'RESULT_VOTE', action: 'RETRY' });
            console.log(`[starlight-bot] 셀프 플레이스루 RESULT_VOTE(RETRY) -> ${slotId}`);
          }
        }
      }
      return;
    }

    // 인간의 선택 읽기
    const humanAction = votes[humanSlotId];
    if (!humanAction) return; // 인간이 아직 선택하지 않음

    // 중복 전송 방지: 이미 같은 action을 미러링했으면 재전송하지 않는다
    if (lastMirroredAction.get('_last') === humanAction) return;
    lastMirroredAction.set('_last', humanAction);

    // 봇 소유 슬롯에 인간의 선택을 미러링
    for (const slotId of ownedIds) {
      const ws = slotId === p1Id ? wsP1 : wsP2;
      sendTo(ws, { type: 'RESULT_VOTE', action: humanAction });
      console.log(`[starlight-bot] RESULT_VOTE(${humanAction}) 미러링 -> ${slotId}`);
    }
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
  if (!input) return; // 방어: desired에 해당 키가 없으면 무시
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

// ── 플레이어 조회 헬퍼 ────────────────────────────────────────────

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
 * SNAPSHOT 수신 시각 이후 경과 시간만큼 외삽한 플레이어 추정 상태를 반환한다.
 * grounded, anchored, respawnTimer는 외삽하지 않고 스냅샷 값 그대로 쓴다.
 * @param {string} playerId 플레이어 ID
 * @returns {object|null}
 */
function getEstimatedPlayer(playerId) {
  const actor = getPlayer(playerId);
  if (!actor) return null;
  // grounded/anchored/respawnTimer 상태에서는 외삽 불필요
  if (actor.grounded || actor.anchored || actor.respawnTimer > 0) return actor;
  const dtMs = performance.now() - snapshotReceivedAt;
  const dt = dtMs / 1000;
  const gravity = getEffectiveGravity();
  return {
    ...actor,
    x: actor.x + actor.vx * dt,
    y: actor.y + actor.vy * dt + 0.5 * gravity * dt * dt,
    vx: actor.vx,
    vy: actor.vy + gravity * dt,
  };
}

/**
 * 현재 장치에 따라 보정된 유효 중력값을 반환한다.
 * @returns {number}
 */
function getEffectiveGravity() {
  const baseGravity = levelData?.physics?.gravity ?? DEFAULT_GRAVITY;
  const device = getCurrentDevice();
  if (device?.type === 'low-gravity' && device.active && baseGravity >= 1000) {
    return baseGravity * LOW_GRAVITY_SCALE;
  }
  return baseGravity;
}

/**
 * 스냅샷에서 특정 ID의 동적 플랫폼을 찾는다.
 * @param {string} platformId 플랫폼 ID
 * @returns {object|null}
 */
function getSnapshotPlatform(platformId) {
  if (!latestSnapshot) return null;
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
  if (!desired[playerId]) return;
  desired[playerId].left = false;
  desired[playerId].right = false;
  desired[playerId].jump = false;
  desired[playerId].interact = false;
}

// ── FIX-3: 발판 가장자리 가드 ────────────────────────────────────

/**
 * 봇이 현재 서 있는 발판을 snapshot.platforms에서 찾는다.
 * @param {string} slotId 슬롯 ID
 * @returns {object|null} 발판 객체 {x, y, width, ...} 또는 null
 */
function findStandingPlatform(slotId) {
  const actor = getPlayer(slotId);
  if (!actor || !actor.grounded) return null;
  const platforms = latestSnapshot?.level?.platforms;
  if (!platforms) return null;
  const feet = actor.y + PLAYER_HEIGHT / 2;
  const halfW = PLAYER_WIDTH / 2;
  for (const plat of platforms) {
    // 수평 범위: actor 중심이 발판 위에 있는지 확인
    if (actor.x + halfW > plat.x && actor.x - halfW < plat.x + plat.width) {
      // 수직: feet가 발판 y 근처 (4px 이내)
      if (Math.abs(feet - plat.y) <= 4) {
        return plat;
      }
    }
  }
  return null;
}

/**
 * 목표 X좌표를 현재 발판의 안전 범위로 클램프한다.
 * @param {string} slotId 슬롯 ID
 * @param {number} targetX 원래 목표 X
 * @returns {number} 클램프된 목표 X
 */
function clampToSafePlatformX(slotId, targetX) {
  const platform = findStandingPlatform(slotId);
  if (!platform) return targetX; // 발판을 못 찾으면 클램프 불가
  const safeLeft = platform.x + PLATFORM_EDGE_MARGIN;
  const safeRight = platform.x + platform.width - PLATFORM_EDGE_MARGIN;
  if (safeLeft >= safeRight) {
    // 발판이 너무 좁으면 중심으로 클램프
    return platform.x + platform.width / 2;
  }
  return Math.max(safeLeft, Math.min(safeRight, targetX));
}

// ── 이동 프리미티브 ──────────────────────────────────────────────

/**
 * 봇 슬롯을 목표 X좌표로 이동시키기 위한 desired 입력을 설정한다.
 * FIX-3: grounded일 때 발판 가장자리 가드를 적용한다.
 * 반환값은 로컬 참고용이며, 게이트 조건으로 사용하지 않는다.
 * @param {string} slotId 슬롯 ID
 * @param {number} targetX 목표 X좌표
 * @returns {boolean} 도달 여부 (참고용)
 */
function moveToX(slotId, targetX) {
  const actor = getPlayer(slotId);
  if (!actor) return false;

  // FIX-3: grounded일 때 발판 가장자리 가드
  const clampedX = actor.grounded ? clampToSafePlatformX(slotId, targetX) : targetX;

  const dx = clampedX - actor.x;
  if (Math.abs(dx) <= ARRIVE_THRESHOLD) {
    desired[slotId].left = false;
    desired[slotId].right = false;
    return true;
  }
  desired[slotId].left = dx < 0;
  desired[slotId].right = dx > 0;
  return false;
}

/**
 * 도달 여부 전용 조회 (봇 자신 슬롯에만 사용).
 * @param {string} slotId 슬롯 ID
 * @param {number} targetX 목표 X좌표
 * @param {number} [threshold=ARRIVE_THRESHOLD] 허용 오차
 * @returns {boolean}
 */
function isNearX(slotId, targetX, threshold = ARRIVE_THRESHOLD) {
  const actor = getPlayer(slotId);
  return actor ? Math.abs(actor.x - targetX) <= threshold : false;
}

/**
 * 두 점 사이 유클리드 거리가 반경 이내인지 검사한다.
 * @param {object} a {x, y}
 * @param {object} b {x, y}
 * @param {number} radius 반경
 * @returns {boolean}
 */
function isNearPoint(a, b, radius) {
  return Math.hypot(a.x - b.x, a.y - b.y) <= radius;
}

// ── 발판 그래프 기반 2D 내비게이션 ───────────────────────────────
//
// moveToX()는 수평 이동만 수행하므로, 목표 좌표가 다른 높이의 발판에 있을 때
// 발판 간 점프·낙하를 통한 경로 탐색이 필요하다.
// 물리 상수(gravity, jumpSpeed, moveSpeed)로 연결성을 판정하고,
// BFS로 최단 경로를 탐색한 뒤, 경유 발판마다 점프/낙하를 실행한다.

/** @type {Map<string, string[]>|null} 발판 연결 그래프 (발판 ID → 도달 가능 발판 ID 배열) */
let platformGraph = null;
/** @type {string|null} 그래프 구축 시 사용한 레벨 ID (레벨 변경 감지용) */
let platformGraphLevelId = null;

/**
 * 발판 A에서 발판 B로 점프로 도달할 수 있는지 판정한다.
 * @param {object} a 출발 발판 {x, y, width}
 * @param {object} b 도착 발판 {x, y, width}
 * @param {number} maxJumpHeight 최대 점프 상승고 (px)
 * @param {number} jumpHangTime 점프 체공 시간 (s)
 * @param {number} moveSpeed 수평 이동 속도 (px/s)
 * @returns {boolean}
 */
function canReachByJump(a, b, maxJumpHeight, jumpHangTime, moveSpeed) {
  // 위로 올라가야 하는 경우: 수직 차이가 점프 상승고 이내
  const rise = a.y - b.y; // 양수 = b가 위에 있음
  if (rise < -JUMP_HEIGHT_SAFETY) return false; // b가 아래면 점프로 가지 않음
  if (rise > maxJumpHeight + JUMP_HEIGHT_SAFETY) return false; // 너무 높음

  // 수평 도달 범위: 점프 체공 시간 동안 이동 가능한 수평 거리
  const maxHorizontal = moveSpeed * jumpHangTime;

  // 수평 간격 계산: 두 발판이 수평으로 얼마나 떨어져 있는지
  const aLeft = a.x;
  const aRight = a.x + a.width;
  const bLeft = b.x;
  const bRight = b.x + b.width;

  // 수평 겹침이 있으면 간격은 0
  if (aRight > bLeft && aLeft < bRight) return true; // 겹침 있음
  // 간격 계산
  const gap = Math.max(bLeft - aRight, aLeft - bRight);
  return gap <= maxHorizontal;
}

/**
 * 발판 A에서 발판 B로 낙하로 도달할 수 있는지 판정한다.
 * @param {object} a 출발 발판 {x, y, width}
 * @param {object} b 도착 발판 {x, y, width}
 * @param {number} moveSpeed 수평 이동 속도 (px/s)
 * @param {number} gravity 중력 (px/s^2)
 * @returns {boolean}
 */
function canReachByFall(a, b, moveSpeed, gravity) {
  // 아래로 내려가야 함: b.y > a.y
  const drop = b.y - a.y; // 양수 = b가 아래
  if (drop < -JUMP_HEIGHT_SAFETY) return false; // b가 위면 낙하로 가지 않음

  // 낙하 시간: sqrt(2 * drop / gravity) — 초기 vy=0에서 자유 낙하
  if (drop <= 0) return false; // 같은 높이거나 위면 낙하 불가
  const fallTime = Math.sqrt(2 * drop / gravity);

  // 수평 도달 범위: 낙하 시간 동안 이동 가능한 수평 거리
  const maxHorizontal = moveSpeed * fallTime + FALL_HORIZONTAL_MARGIN;

  // 수평 겹침/간격 판정
  const aLeft = a.x;
  const aRight = a.x + a.width;
  const bLeft = b.x;
  const bRight = b.x + b.width;

  if (aRight > bLeft && aLeft < bRight) return true;
  const gap = Math.max(bLeft - aRight, aLeft - bRight);
  return gap <= maxHorizontal;
}

/**
 * 발판 A에서 B로 점프할 때 중간에 가로막는 발판이 있는지 판정한다.
 * 수직으로 A.y와 B.y 사이에 있고, 수평으로 점프 경로와 겹치는 발판이 있으면
 * 물리적으로 해당 발판에 착지하게 되므로 A->B 직행 엣지를 제거해야 한다.
 * @param {object} platA 출발 발판
 * @param {object} platB 도착 발판 (위)
 * @param {Array<object>} allPlatforms 모든 발판 목록
 * @returns {boolean} 차단 발판이 있으면 true
 */
function hasInterceptingPlatform(platA, platB, allPlatforms) {
  // 점프 궤적의 수평 범위: A와 B의 수평 합집합 (여유 포함)
  const jumpLeft = Math.min(platA.x, platB.x) - PLAYER_WIDTH;
  const jumpRight = Math.max(platA.x + platA.width, platB.x + platB.width) + PLAYER_WIDTH;

  for (const platC of allPlatforms) {
    if (platC.id === platA.id || platC.id === platB.id) continue;
    // 수직: C가 A와 B 사이에 있어야 함 (상단 = y가 작음)
    if (platC.y >= platA.y - 2 || platC.y <= platB.y + 2) continue;
    // 수평: C가 점프 경로와 겹치는지 확인
    const cLeft = platC.x;
    const cRight = platC.x + platC.width;
    if (cRight <= jumpLeft || cLeft >= jumpRight) continue;
    // 차단 발판 발견
    return true;
  }
  return false;
}

/**
 * 현재 레벨의 모든 발판 간 연결 그래프를 구축한다.
 * 동적 발판(cycle-platform의 solid=false)은 정적 그래프에서는 포함하되,
 * 실시간 navigateTo에서 solid 상태를 확인한다.
 *
 * FIX-6: 점프 궤적 도중 중간 발판에 착지하는 경우를 방지하기 위해,
 * A->B 점프 엣지에서 A.y와 B.y 사이에 수평 겹침이 있는 발판이 있으면
 * 해당 엣지를 제거한다. BFS가 중간 발판을 반드시 경유하도록 강제한다.
 * @returns {Map<string, string[]>} 발판 ID → 도달 가능 발판 ID 배열
 */
function buildPlatformGraph() {
  const platforms = latestSnapshot?.level?.platforms ?? levelData?.platforms;
  if (!platforms || platforms.length === 0) return new Map();

  const physics = getPhysics();
  const { gravity, jumpSpeed } = physics;
  const moveSpeed = levelData?.physics?.moveSpeed ?? DEFAULT_MOVE_SPEED;

  // 점프 물리 계산
  const maxJumpHeight = (jumpSpeed * jumpSpeed) / (2 * gravity) - JUMP_HEIGHT_SAFETY;
  // 점프 체공 시간: 상승 + 하강 = 2 * (jumpSpeed / gravity)
  const jumpHangTime = 2 * jumpSpeed / gravity;

  const graph = new Map();
  for (const platA of platforms) {
    const neighbors = [];
    for (const platB of platforms) {
      if (platA.id === platB.id) continue;
      // 위로: 점프로 도달 가능
      if (platB.y < platA.y && canReachByJump(platA, platB, maxJumpHeight, jumpHangTime, moveSpeed)) {
        // FIX-6: 중간 발판 차단 검사 — 차단 시 직행 엣지를 생성하지 않는다
        if (!hasInterceptingPlatform(platA, platB, platforms)) {
          neighbors.push(platB.id);
        }
      }
      // 아래로: 낙하로 도달 가능
      else if (platB.y > platA.y && canReachByFall(platA, platB, moveSpeed, gravity)) {
        neighbors.push(platB.id);
      }
      // 같은 높이(±4px): 수평 이동으로 도달 가능
      else if (Math.abs(platB.y - platA.y) <= 4) {
        const aRight = platA.x + platA.width;
        const bLeft = platB.x;
        const aLeft = platA.x;
        const bRight = platB.x + platB.width;
        // 겹치거나 간격이 점프 수평 도달 이내
        if (aRight > bLeft && aLeft < bRight) {
          neighbors.push(platB.id);
        } else {
          const gap = Math.max(bLeft - aRight, aLeft - bRight);
          if (gap <= moveSpeed * jumpHangTime) {
            neighbors.push(platB.id);
          }
        }
      }
    }
    graph.set(platA.id, neighbors);
  }
  return graph;
}

/**
 * 그래프를 필요 시 구축/갱신한다.
 * @returns {Map<string, string[]>}
 */
function ensurePlatformGraph() {
  const currentLevelId = levelData?.id ?? '';
  if (!platformGraph || platformGraphLevelId !== currentLevelId) {
    platformGraph = buildPlatformGraph();
    platformGraphLevelId = currentLevelId;
    if (platformGraph.size > 0) {
      console.log(`[bot] 발판 그래프 구축: ${platformGraph.size}개 노드`);
    }
  }
  return platformGraph;
}

/**
 * BFS로 출발 발판에서 도착 발판까지 최단 경로를 탐색한다.
 * @param {string} fromId 출발 발판 ID
 * @param {string} toId 도착 발판 ID
 * @returns {string[]|null} 발판 ID 경로 (출발 포함, 도착 포함) 또는 null
 */
function findPlatformPath(fromId, toId) {
  if (fromId === toId) return [fromId];
  const graph = ensurePlatformGraph();
  if (!graph.has(fromId) || !graph.has(toId)) return null;

  const visited = new Set([fromId]);
  const queue = [[fromId]];
  while (queue.length > 0) {
    const path = queue.shift();
    const current = path[path.length - 1];
    const neighbors = graph.get(current) ?? [];
    for (const neighbor of neighbors) {
      if (neighbor === toId) return [...path, neighbor];
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push([...path, neighbor]);
      }
    }
  }
  return null; // 도달 불가
}

/**
 * 목표 좌표(x, y)에 가장 가까운 발판을 찾는다.
 * @param {number} targetX 목표 X
 * @param {number} targetY 목표 Y
 * @returns {object|null} 발판 객체
 */
function findNearestPlatform(targetX, targetY) {
  const platforms = latestSnapshot?.level?.platforms ?? levelData?.platforms;
  if (!platforms) return null;

  let best = null;
  let bestDist = Infinity;
  for (const plat of platforms) {
    // 수평 범위 내 또는 가장 가까운 점과의 거리
    const clampedX = Math.max(plat.x, Math.min(plat.x + plat.width, targetX));
    const dist = Math.hypot(clampedX - targetX, plat.y - targetY);
    if (dist < bestDist) {
      bestDist = dist;
      best = plat;
    }
  }
  return best;
}

/**
 * 봇이 현재 서 있거나 가장 가까운 발판을 반환한다.
 * grounded이면 정확히 서 있는 발판, 공중이면 아래에서 가장 가까운 발판.
 * @param {string} slotId 슬롯 ID
 * @returns {object|null}
 */
function getCurrentPlatform(slotId) {
  // grounded이면 정확한 발판 사용
  const standing = findStandingPlatform(slotId);
  if (standing) return standing;

  // 공중이면 현재 위치에서 가장 가까운 발판
  const actor = getPlayer(slotId);
  if (!actor) return null;
  return findNearestPlatform(actor.x, actor.y);
}

/**
 * 2D 내비게이션 메인 진입점.
 * 목표 좌표까지의 발판 경유 경로를 탐색하고, 다음 경유점으로 이동/점프/낙하를 실행한다.
 *
 * FIX-6v2: 공중에서의 현재 발판 판정 개선. grounded가 아닐 때
 * findNearestPlatform이 아직 도달하지 않은 발판을 "현재"로 잡으면
 * 다음 경유점이 잘못 산출되어 조향이 어긋나는 문제를 해결한다.
 * 공중에서는 findStandingPlatform 실패 → 경로상 가장 최근 출발 발판을
 * 현재 발판으로 유지하고, 다음 경유점 방향으로만 조향한다.
 *
 * @param {string} slotId 슬롯 ID
 * @param {number} targetX 최종 목표 X
 * @param {number} targetY 최종 목표 Y
 * @returns {boolean} 최종 목표 도달 여부 (참고용)
 */
function navigateTo(slotId, targetX, targetY) {
  const actor = getPlayer(slotId);
  if (!actor) return false;
  const agent = agentState.get(slotId);
  if (!agent) return false;

  // 내비게이션 점프 쿨다운 감소
  if (agent.navJumpCooldown > 0) agent.navJumpCooldown--;

  // 이미 최종 목표에 도달했으면 moveToX만 사용
  const distToTarget = Math.hypot(actor.x - targetX, actor.y - targetY);
  if (distToTarget <= INTERACT_RADIUS && actor.grounded) {
    return moveToX(slotId, targetX);
  }

  // 목표 발판 식별
  const targetPlat = findNearestPlatform(targetX, targetY);
  if (!targetPlat) {
    return moveToX(slotId, targetX);
  }

  // FIX-6v2: 공중/지면에 따른 현재 발판 식별 분기
  // grounded이면 findStandingPlatform으로 정확한 발판, 아니면 경로 기반으로 결정
  const standingPlat = findStandingPlatform(slotId);
  let currentPlat;

  if (standingPlat) {
    // 지면에 있으면 서 있는 발판이 현재 발판
    currentPlat = standingPlat;
  } else if (agent.navPath && agent.navPath.length > 0) {
    // 공중이면서 이전 경로가 있으면: 경로상 발판 중 마지막으로 서 있었던 발판을 유지
    // agent.navLastGroundedPlatId를 사용 (아래에서 갱신)
    if (agent.navLastGroundedPlatId) {
      currentPlat = getSnapshotPlatform(agent.navLastGroundedPlatId)
        ?? getLevelPlatform(agent.navLastGroundedPlatId);
    }
    if (!currentPlat) {
      currentPlat = getCurrentPlatform(slotId);
    }
  } else {
    currentPlat = getCurrentPlatform(slotId);
  }

  if (!currentPlat) {
    return moveToX(slotId, targetX);
  }

  // FIX-6v2: grounded일 때 마지막 착지 발판 기록
  if (standingPlat) {
    agent.navLastGroundedPlatId = standingPlat.id;
  }

  // 같은 발판 위에 있으면 수평 이동만
  if (currentPlat.id === targetPlat.id && actor.grounded) {
    agent.navPath = null;
    return moveToX(slotId, targetX);
  }

  // 경로 캐시 확인 및 갱신
  const tickNow = latestSnapshot?.tick ?? 0;
  let needRepath = !agent.navPath || agent.navTargetPlatId !== targetPlat.id
    || tickNow - agent.navCacheTick > NAV_CACHE_MAX_TICKS;

  // 현재 발판이 경로에 없으면 재계산 (발판 전환 감지)
  if (agent.navPath && agent.navPath.indexOf(currentPlat.id) < 0) {
    needRepath = true;
  }

  if (needRepath) {
    const path = findPlatformPath(currentPlat.id, targetPlat.id);
    if (!path) {
      // 경로 탐색 실패 — 수평 이동으로 폴백하고 로그
      if (!agent.navPath) {
        console.log(`[bot ${slotId}] nav FAIL: ${currentPlat.id} -> ${targetPlat.id} (no path)`);
      }
      agent.navPath = null;
      return moveToX(slotId, targetX);
    }
    // 경로가 변경된 경우에만 로그 출력 (스팸 방지)
    const pathStr = path.join(' -> ');
    const prevPathStr = agent.navPath ? agent.navPath.join(' -> ') : '';
    if (pathStr !== prevPathStr) {
      console.log(`[bot ${slotId}] path: ${pathStr} (target=${targetPlat.id})`);
    }
    agent.navPath = path;
    agent.navTargetPlatId = targetPlat.id;
    agent.navCacheTick = tickNow;
  }

  // 경로에서 현재 발판의 인덱스를 찾는다
  // FIX-6v2: grounded일 때만 정확한 pathIndex를 사용.
  // 공중일 때는 navLastGroundedPlatId 기반으로 경유점을 결정.
  let pathIndex = -1;

  if (actor.grounded) {
    pathIndex = agent.navPath.indexOf(currentPlat.id);
  } else {
    // 공중: 마지막 착지 발판 기준
    const lastPlatId = agent.navLastGroundedPlatId;
    if (lastPlatId) {
      pathIndex = agent.navPath.indexOf(lastPlatId);
    }
    if (pathIndex < 0) {
      pathIndex = agent.navPath.indexOf(currentPlat.id);
    }
  }

  if (pathIndex < 0) {
    // 현재 발판이 경로에 없으면 경로 재계산
    agent.navPath = null;
    return moveToX(slotId, targetX);
  }

  // 이미 마지막 발판(목표)에 도달
  if (pathIndex >= agent.navPath.length - 1) {
    if (actor.grounded) {
      agent.navPath = null;
      return moveToX(slotId, targetX);
    }
    // 공중이면 목표 발판 방향으로 조향
    const tgtCenterX = targetPlat.x + targetPlat.width / 2;
    const dx = tgtCenterX - actor.x;
    if (Math.abs(dx) > ARRIVE_THRESHOLD) {
      desired[slotId].left = dx < 0;
      desired[slotId].right = dx > 0;
    }
    return false;
  }

  // 다음 경유 발판
  const nextPlatId = agent.navPath[pathIndex + 1];
  const nextPlat = getSnapshotPlatform(nextPlatId) ?? getLevelPlatform(nextPlatId);
  if (!nextPlat) {
    agent.navPath = null;
    return moveToX(slotId, targetX);
  }

  // 공중이면: 다음 발판의 안전 착지 지점 방향으로 수평 이동만 (점프/착지 대기)
  if (!actor.grounded) {
    // 다음 발판의 중심이 아니라 안전 착지 범위 내 중심으로 조향
    const safeLandX = Math.max(nextPlat.x + JUMP_EDGE_INSET,
      Math.min(nextPlat.x + nextPlat.width - JUMP_EDGE_INSET,
        nextPlat.x + nextPlat.width / 2));
    const dx = safeLandX - actor.x;
    if (Math.abs(dx) > ARRIVE_THRESHOLD) {
      desired[slotId].left = dx < 0;
      desired[slotId].right = dx > 0;
    }
    return false;
  }

  // 다음 발판이 위에 있으면: 가장자리로 이동 후 점프
  if (nextPlat.y < currentPlat.y - 4) {
    return executeJumpToHigherPlatform(slotId, actor, currentPlat, nextPlat);
  }

  // 다음 발판이 아래에 있으면: 가장자리로 이동 후 낙하
  if (nextPlat.y > currentPlat.y + 4) {
    return executeFallToLowerPlatform(slotId, actor, currentPlat, nextPlat);
  }

  // 같은 높이면: 수평 이동 (갭 점프 포함)
  return executeHorizontalMove(slotId, actor, currentPlat, nextPlat);
}

/**
 * 위에 있는 발판으로 점프한다.
 * @param {string} slotId 슬롯 ID
 * @param {object} actor 플레이어 상태
 * @param {object} currentPlat 현재 발판
 * @param {object} nextPlat 다음 발판 (위)
 * @returns {boolean}
 */
function executeJumpToHigherPlatform(slotId, actor, currentPlat, nextPlat) {
  const agent = agentState.get(slotId);

  // 다음 발판의 수평 중심을 향해 이동
  const nextCenterX = nextPlat.x + nextPlat.width / 2;

  // 수평 겹침 영역을 계산해서 점프 위치 결정
  const overlapLeft = Math.max(currentPlat.x + JUMP_EDGE_INSET, nextPlat.x);
  const overlapRight = Math.min(currentPlat.x + currentPlat.width - JUMP_EDGE_INSET,
    nextPlat.x + nextPlat.width);

  let jumpX;
  if (overlapLeft < overlapRight) {
    // 겹침 영역이 있으면 그 중심에서 점프
    jumpX = (overlapLeft + overlapRight) / 2;
  } else {
    // 겹침이 없으면 현재 발판의 다음 발판 방향 가장자리로 이동
    if (nextCenterX > actor.x) {
      jumpX = currentPlat.x + currentPlat.width - JUMP_EDGE_INSET;
    } else {
      jumpX = currentPlat.x + JUMP_EDGE_INSET;
    }
  }

  // 안전 범위로 클램프
  jumpX = Math.max(currentPlat.x + JUMP_EDGE_INSET,
    Math.min(currentPlat.x + currentPlat.width - JUMP_EDGE_INSET, jumpX));

  // 점프 위치로 이동
  const atJumpPos = moveToX(slotId, jumpX);
  if (atJumpPos && actor.grounded && agent && agent.navJumpCooldown <= 0) {
    // 점프!
    desired[slotId].jump = true;
    agent.navJumpCooldown = NAV_JUMP_COOLDOWN;
    // 점프 후 다음 발판 방향으로 수평 이동 설정
    const dx = nextCenterX - actor.x;
    if (Math.abs(dx) > ARRIVE_THRESHOLD) {
      desired[slotId].left = dx < 0;
      desired[slotId].right = dx > 0;
    }
  }
  return false;
}

/**
 * 아래에 있는 발판으로 낙하한다.
 * @param {string} slotId 슬롯 ID
 * @param {object} actor 플레이어 상태
 * @param {object} currentPlat 현재 발판
 * @param {object} nextPlat 다음 발판 (아래)
 * @returns {boolean}
 */
function executeFallToLowerPlatform(slotId, actor, currentPlat, nextPlat) {
  // 다음 발판의 수평 중심
  const nextCenterX = nextPlat.x + nextPlat.width / 2;

  // 현재 발판의 다음 발판 방향 가장자리로 이동하여 낙하
  let edgeX;
  if (nextCenterX > currentPlat.x + currentPlat.width / 2) {
    // 오른쪽으로 낙하
    edgeX = currentPlat.x + currentPlat.width + 5; // 가장자리 바로 너머
  } else {
    // 왼쪽으로 낙하
    edgeX = currentPlat.x - 5; // 가장자리 바로 너머
  }

  // 그런데 다음 발판이 바로 아래(겹침 있음)이면 그쪽 가장자리로 걸어가면 자동 낙하
  const overlapLeft = Math.max(currentPlat.x, nextPlat.x);
  const overlapRight = Math.min(currentPlat.x + currentPlat.width, nextPlat.x + nextPlat.width);
  if (overlapRight > overlapLeft) {
    // 겹침이 있으면: 현재 발판의 겹침 쪽 가장자리를 넘으면 낙하
    if (nextCenterX > actor.x) {
      edgeX = currentPlat.x + currentPlat.width + 5;
    } else {
      edgeX = currentPlat.x - 5;
    }
  }

  // 가장자리 clamp 해제 — 의도적 낙하이므로 가장자리 가드를 우회해 직접 입력
  const dx = edgeX - actor.x;
  if (Math.abs(dx) > ARRIVE_THRESHOLD) {
    desired[slotId].left = dx < 0;
    desired[slotId].right = dx > 0;
  } else {
    // 가장자리에 도달 — 다음 발판 중심 방향으로 계속 이동
    desired[slotId].left = nextCenterX < actor.x;
    desired[slotId].right = nextCenterX > actor.x;
  }
  return false;
}

/**
 * 같은 높이의 발판으로 수평 이동한다 (갭 점프 포함).
 * @param {string} slotId 슬롯 ID
 * @param {object} actor 플레이어 상태
 * @param {object} currentPlat 현재 발판
 * @param {object} nextPlat 다음 발판
 * @returns {boolean}
 */
function executeHorizontalMove(slotId, actor, currentPlat, nextPlat) {
  const agent = agentState.get(slotId);
  const nextCenterX = nextPlat.x + nextPlat.width / 2;

  // 겹침 확인
  const overlapLeft = Math.max(currentPlat.x, nextPlat.x);
  const overlapRight = Math.min(currentPlat.x + currentPlat.width, nextPlat.x + nextPlat.width);

  if (overlapRight > overlapLeft) {
    // 겹침 있음: 그냥 수평 이동
    return moveToX(slotId, nextCenterX);
  }

  // 갭이 있음: 가장자리로 이동 후 점프
  let edgeX;
  if (nextCenterX > actor.x) {
    edgeX = currentPlat.x + currentPlat.width - JUMP_EDGE_INSET;
  } else {
    edgeX = currentPlat.x + JUMP_EDGE_INSET;
  }

  const atEdge = Math.abs(actor.x - edgeX) <= ARRIVE_THRESHOLD;
  if (atEdge && actor.grounded && agent && agent.navJumpCooldown <= 0) {
    desired[slotId].jump = true;
    agent.navJumpCooldown = NAV_JUMP_COOLDOWN;
    desired[slotId].left = nextCenterX < actor.x;
    desired[slotId].right = nextCenterX > actor.x;
  } else if (!atEdge) {
    moveToX(slotId, edgeX);
  }
  return false;
}

// ── 에이전트 상태 헬퍼 ───────────────────────────────────────────

/**
 * 슬롯의 목표를 변경하고 변경 시 로그를 남긴다.
 * @param {string} slotId 슬롯 ID
 * @param {string} newGoal 새 목표
 * @param {string} [detail=''] 추가 정보
 * @returns {void}
 */
function setGoal(slotId, newGoal, detail = '') {
  const agent = agentState.get(slotId);
  if (!agent) return;
  if (agent.goal === newGoal) return;
  const prev = agent.goal;
  // #61 Fix-2: RECOMPUTE 경유 동일 부스트 목표 재진입 판정에 사용하기 위해
  // agent.prevGoal 갱신 전에 이전 값을 먼저 읽는다.
  const prevPrevGoal = agent.prevGoal;
  agent.prevGoal = prev;
  agent.goal = newGoal;
  // 부스트/대기 장기 타임아웃 리셋:
  // RECOMPUTE를 거쳐 동일한 부스트 목표로 재진입하는 경우에는 리셋하지 않는다.
  // (BOOST_STRIKER → RECOMPUTE → BOOST_STRIKER 루프에서 타임아웃이 영구 리셋되는 것을 방지)
  const boostGoals = [GOAL.BOOST_STRIKER, GOAL.BOOST_RECEIVER, GOAL.WAIT_NEAR_SWITCH];
  const isBoostReentry = boostGoals.includes(newGoal)
    && prev === GOAL.RECOMPUTE
    && boostGoals.includes(prevPrevGoal);
  if (boostGoals.includes(newGoal) && !isBoostReentry) {
    agent.boostWaitTotalTick = 0;
  }
  // 목표 변경 시 내비게이션 경로 캐시 무효화
  agent.navPath = null;
  agent.navTargetPlatId = null;
  console.log(`[bot ${slotId}] goal: ${prev} -> ${newGoal}${detail ? ` (${detail})` : ''}`);
}

/**
 * 슬롯의 교착 카운터를 리셋한다.
 * @param {string} slotId 슬롯 ID
 * @returns {void}
 */
function resetStuck(slotId) {
  const agent = agentState.get(slotId);
  if (!agent) return;
  agent.stuckTicks = 0;
  agent.unchangedTicks = 0;
  agent.jiggleTicks = 0;
}

// ── 현재 장치/모듈 조회 ─────────────────────────────────────────

/**
 * SNAPSHOT에서 현재 checkpointId에 해당하는 장치 상태를 반환한다.
 * @returns {object|null}
 */
function getCurrentDevice() {
  if (!latestSnapshot) return null;
  const cpId = latestSnapshot.checkpointId;
  return latestSnapshot.devices?.[cpId] ?? null;
}

/**
 * SNAPSHOT에서 현재 checkpointId에 해당하는 모듈 정의를 반환한다.
 * @returns {object|null}
 */
function getCurrentModule() {
  if (!latestSnapshot?.level?.modules) return null;
  const cpId = latestSnapshot.checkpointId;
  return latestSnapshot.level.modules[cpId] ?? null;
}

/**
 * 파트너 슬롯 ID를 반환한다. (인간이든 봇이든)
 * @param {string} slotId 현재 슬롯
 * @returns {string}
 */
function getPartnerSlotId(slotId) {
  return slotId === 'p1' ? 'p2' : 'p1';
}

// ── 물리 파라미터 조회 ──────────────────────────────────────────

/**
 * 현재 물리 파라미터를 반환한다.
 * 저중력 장치가 활성화된 경우 보정된 중력을 반환한다.
 * @returns {{gravity: number, jumpSpeed: number}}
 */
function getPhysics() {
  const baseGravity = levelData?.physics?.gravity ?? DEFAULT_GRAVITY;
  const jumpSpeed = levelData?.physics?.jumpSpeed ?? DEFAULT_JUMP_SPEED;
  const device = getCurrentDevice();
  let gravity = baseGravity;
  if (device?.type === 'low-gravity' && device.active && baseGravity >= 1000) {
    gravity = baseGravity * LOW_GRAVITY_SCALE;
  }
  return { gravity, jumpSpeed };
}

// ── 부스트 관련 헬퍼 ──────────────────────────────────────────────

/**
 * 부스트 모듈의 alignX(하단·상단 발판 수평 overlap 중심)를 계산한다.
 * @param {object} module 모듈 정의
 * @returns {number|null}
 */
function getBoostAlignX(module) {
  const lower = getSnapshotPlatform(module.approachPlatformId) ?? getLevelPlatform(module.approachPlatformId);
  const upper = getSnapshotPlatform(module.boostLandingPlatformId) ?? getLevelPlatform(module.boostLandingPlatformId);
  if (!lower || !upper) return null;
  // 캐릭터 너비 여유 28px 씩 안쪽
  const overlapLeft = Math.max(lower.x + 28, upper.x + 28);
  const overlapRight = Math.min(lower.x + lower.width - 28, upper.x + upper.width - 28);
  return (overlapLeft + overlapRight) / 2;
}

/**
 * 부스트 상단 landing 발판을 반환한다.
 * @param {object} module 모듈 정의
 * @returns {object|null}
 */
function getBoostLandingPlatform(module) {
  return getSnapshotPlatform(module.boostLandingPlatformId) ?? getLevelPlatform(module.boostLandingPlatformId);
}

// ── 목표 계산 (computeGoal) ──────────────────────────────────────

/**
 * SNAPSHOT 기반으로 슬롯의 현재 목표를 결정한다.
 * @param {string} slotId 슬롯 ID
 * @returns {string} 목표 종류 (GOAL enum)
 */
function computeGoal(slotId) {
  if (!latestSnapshot || !levelData) return GOAL.RECOMPUTE;

  const actor = getPlayer(slotId);
  if (!actor) return GOAL.RECOMPUTE;

  // 1. 리스폰 중
  if (actor.respawnTimer > 0) return GOAL.WAIT_RESPAWN;

  // 2. 게임 완료
  if (latestSnapshot.phase === 'result') return GOAL.DONE;

  const cpId = latestSnapshot.checkpointId;
  const modules = latestSnapshot.level?.modules ?? levelData.modules;

  // 3. 모든 모듈 완료 → 결승
  if (cpId >= modules.length) return GOAL.FINISH_PRESS;

  const module = modules[cpId];
  const device = latestSnapshot.devices?.[cpId];
  if (!module || !device) return GOAL.RECOMPUTE;

  const isAnchorRole = module.requiredPlayerId === slotId;

  // 4. 부스트 필요 판정
  if (module.boostRequired) {
    const receiver = getPlayer(module.requiredPlayerId);
    const landingPlatform = getBoostLandingPlatform(module);
    // receiver가 아직 상위 발판에 올라가지 않았으면 부스트 시퀀스 활성화
    if (receiver && landingPlatform) {
      // #61 Fix-1: receiver가 anchored 상태이면 부스트 게이트를 건너뛴다.
      // anchored 중에는 simulation.js가 grounded를 갱신하지 않으므로(simulation.js:335 continue)
      // 공중 앵커 시 grounded=false가 동결된다. 이 동결값으로 receiverOnTop=false가 되어
      // BOOST_STRIKER에 영구 고착되는데, isCoopBoostCandidate가 anchored를 차단하므로
      // 부스트는 달성 불가능한 목표다. anchored이면 장치 상태 분기로 직접 진입한다.
      if (!receiver.anchored) {
        const receiverOnTop = receiver.grounded && receiver.y < landingPlatform.y + 30;
        if (!receiverOnTop) {
          // 봇이 receiver 역할이면 BOOST_RECEIVER, 아니면 BOOST_STRIKER
          return isAnchorRole ? GOAL.BOOST_RECEIVER : GOAL.BOOST_STRIKER;
        }
      }
    }
  }

  // 5. 장치 상태에 따른 목표 결정
  if (device.state === 'IDLE') {
    if (isAnchorRole) return GOAL.GO_ANCHOR;
    else return GOAL.WAIT_NEAR_SWITCH;
  }

  if (device.state === 'POWERED') {
    if (isAnchorRole) return GOAL.HOLD_ANCHOR;
    else return GOAL.GO_SWITCH;
  }

  if (device.state === 'LATCHED') {
    return GOAL.GO_CHECKPOINT;
  }

  return GOAL.RECOMPUTE;
}

// ── 목표 실행 (executeGoal) ──────────────────────────────────────

/**
 * 목표에 따라 슬롯의 입력을 실행한다.
 * @param {string} slotId 슬롯 ID
 * @param {string} goal 목표 종류
 * @returns {void}
 */
function executeGoal(slotId, goal) {
  const agent = agentState.get(slotId);
  if (!agent) return;

  switch (goal) {
    case GOAL.WAIT_RESPAWN:
      clearDesired(slotId);
      break;

    case GOAL.DONE:
      clearDesired(slotId);
      break;

    case GOAL.RECOMPUTE:
      // 다음 틱에 다시 계산
      break;

    case GOAL.BOOST_RECEIVER:
      executeBoostReceiver(slotId);
      break;

    case GOAL.BOOST_STRIKER:
      executeBoostStriker(slotId);
      break;

    case GOAL.GO_ANCHOR:
      executeGoAnchor(slotId);
      break;

    case GOAL.HOLD_ANCHOR:
      executeHoldAnchor(slotId);
      break;

    case GOAL.WAIT_NEAR_SWITCH:
      executeWaitNearSwitch(slotId);
      break;

    case GOAL.GO_SWITCH:
      executeGoSwitch(slotId);
      break;

    case GOAL.GO_CHECKPOINT:
      executeGoCheckpoint(slotId);
      break;

    case GOAL.FINISH_PRESS:
      executeFinishPress(slotId);
      break;

    case GOAL.JIGGLE:
      executeJiggle(slotId);
      break;

    case GOAL.FALLBACK_WAIT:
      executeFallbackWait(slotId);
      break;

    default:
      break;
  }
}

// ── 부스트 실행 ──────────────────────────────────────────────────

/**
 * 봇이 receiver 역할일 때 부스트 시퀀스를 실행한다.
 * FIX-2: striker(파트너)가 grounded이고 수평 정렬이 된 상태에서만 점프한다.
 * 쿨다운을 적용해 연타를 방지한다.
 * @param {string} slotId 슬롯 ID
 * @returns {void}
 */
function executeBoostReceiver(slotId) {
  const agent = agentState.get(slotId);
  const module = getCurrentModule();
  if (!module || !agent) return;

  const alignX = getBoostAlignX(module);
  if (alignX === null) return;

  const landingPlatform = getBoostLandingPlatform(module);
  if (!landingPlatform) return;

  // 쿨다운 감소
  if (agent.receiverCooldown > 0) agent.receiverCooldown--;

  switch (agent.boostSub) {
    case BOOST_SUB.ALIGN: {
      // alignX로 이동 (발판 가장자리 가드 적용됨)
      agent.targetX = alignX;
      moveToX(slotId, alignX);
      if (isNearX(slotId, alignX, BOOST_ALIGN_THRESHOLD)) {
        // FIX-2: striker(파트너)가 grounded이고 alignX에 가까운지 확인
        const strikerId = getPartnerSlotId(slotId);
        const striker = getPlayer(strikerId);
        if (!striker) return;
        if (!striker.grounded) return;
        if (Math.abs(striker.x - alignX) > STRIKER_ALIGN_X_THRESHOLD) return;
        // 쿨다운 확인
        if (agent.receiverCooldown > 0) return;
        // 점프 시작
        desired[slotId].jump = true;
        agent.boostSub = BOOST_SUB.JUMPING;
        agent.boostTick = 0;
        agent.receiverCooldown = RECEIVER_JUMP_COOLDOWN;
      }
      break;
    }
    case BOOST_SUB.JUMPING: {
      agent.boostTick++;
      // 공중에서 수평 보정 (발판 가장자리 가드는 공중이므로 비적용)
      const actor = getPlayer(slotId);
      if (actor && actor.vy < 0) {
        // 공중이므로 clamp 없이 직접 이동
        const dx = alignX - actor.x;
        if (Math.abs(dx) > ARRIVE_THRESHOLD) {
          desired[slotId].left = dx < 0;
          desired[slotId].right = dx > 0;
        }
      }
      if (agent.boostTick >= BOOST_JUMP_WAIT_TICKS) {
        agent.boostSub = BOOST_SUB.WAIT_LAND;
        agent.boostTick = 0;
      }
      break;
    }
    case BOOST_SUB.WAIT_LAND: {
      agent.boostTick++;
      const actor = getPlayer(slotId);
      if (actor && actor.grounded && actor.y < landingPlatform.y + 30) {
        // 부스트 성공 → 서브 상태 리셋
        agent.boostSub = BOOST_SUB.ALIGN;
        agent.boostTick = 0;
        agent.boostFailCount = 0;
        resetStuck(slotId);
        break;
      }
      // grounded로 복귀했으나 상위 발판에 못 올라갔으면 (실패)
      if (actor && actor.grounded && agent.boostTick > 10) {
        agent.boostSub = BOOST_SUB.ALIGN;
        agent.boostTick = 0;
        agent.boostFailCount++;
        clearDesired(slotId);
        // FIX-5: stuckTicks 직접 증가 제거 — 장기 타임아웃(detectStuck)이 대체한다
        break;
      }
      if (agent.boostTick > BOOST_WAIT_MAX_TICKS) {
        // 타임아웃 실패 → ALIGN으로 재시도
        agent.boostSub = BOOST_SUB.ALIGN;
        agent.boostTick = 0;
        agent.boostFailCount++;
        clearDesired(slotId);
        // FIX-5: stuckTicks 직접 증가 제거
      }
      break;
    }
    default:
      agent.boostSub = BOOST_SUB.ALIGN;
      break;
  }
}

/**
 * 봇이 striker 역할일 때 부스트 시퀀스를 실행한다.
 * FIX-1+FIX-5: 전방 시뮬레이션(shouldStrikerJump)으로 점프 타이밍을 결정하되,
 * receiver가 하강 중(vy > 0)이면 추가 "가까운 gap 범위" 조건으로 적극 점프를 시도한다.
 * 또한 receiver.grounded에서도 boostTick을 누적해 진단 정보를 유지한다.
 * @param {string} slotId 슬롯 ID
 * @returns {void}
 */
function executeBoostStriker(slotId) {
  const agent = agentState.get(slotId);
  const module = getCurrentModule();
  if (!module || !agent) return;

  const alignX = getBoostAlignX(module);
  if (alignX === null) return;

  const receiverId = module.requiredPlayerId;
  const receiver = getPlayer(receiverId);

  // 1. alignX로 이동 (발판 가장자리 가드 적용됨)
  agent.targetX = alignX;
  moveToX(slotId, alignX);

  // boostTick 항상 누적 (진단 + 장기 타임아웃용)
  agent.boostTick++;

  // 2. 정렬 완료 시 receiver 상태 관측
  if (!isNearX(slotId, alignX, BOOST_ALIGN_THRESHOLD)) {
    if (agent.boostTick % 150 === 0) {
      const a = getPlayer(slotId);
      console.log(`[bot ${slotId}] STRIKER align: x=${a?.x?.toFixed(0)}, alignX=${alignX.toFixed(0)}, gap=${Math.abs((a?.x ?? 0) - alignX).toFixed(0)}`);
    }
    return;
  }

  if (!receiver) return;
  const actor = getPlayer(slotId);
  if (!actor) return;

  // receiver가 아직 지면에 있으면(점프 안 했으면) 대기
  if (receiver.grounded) {
    if (agent.boostTick % 150 === 0) {
      console.log(`[bot ${slotId}] STRIKER waiting: receiver grounded at y=${receiver.y.toFixed(0)}`);
    }
    return;
  }

  // FIX-5v2: receiver가 하강 중(vy >= 0)일 때만 점프를 시도한다.
  // 상승 중에 점프하면 양쪽이 동시에 올라가 접촉 띠에 절대 들어갈 수 없다.
  // receiver가 하강 중이면 전방 시뮬레이션 + 간이 heuristic 두 경로로 판정한다.
  if (receiver.vy < 0) {
    // receiver가 아직 상승 중 → 하강 전환까지 대기
    return;
  }

  const physics = getPhysics();
  const strikerState = { x: actor.x, y: actor.y, vy: actor.vy, grounded: actor.grounded };
  const receiverState = { x: receiver.x, y: receiver.y, vy: receiver.vy, grounded: receiver.grounded };
  const snapshotAgeTicks = Math.round((performance.now() - snapshotReceivedAt) / (SIM_DT * 1000));
  const latencyTicks = Math.min(4, Math.max(0, snapshotAgeTicks)) + INPUT_APPLY_DELAY_TICKS;
  let shouldJump = shouldStrikerJump(strikerState, receiverState, physics, latencyTicks);

  // FIX-5v2 폴백: 전방 시뮬레이션이 미명중이어도, receiver가 하강 중이고
  // 수직 거리가 적정 범위이고 striker가 grounded이면 적극 점프한다.
  if (!shouldJump && actor.grounded) {
    const maxRise = (physics.jumpSpeed * physics.jumpSpeed) / (2 * physics.gravity);
    const gap = actor.y - receiver.y;
    const hOverlap = Math.min(actor.x + PLAYER_WIDTH / 2, receiver.x + PLAYER_WIDTH / 2)
      - Math.max(actor.x - PLAYER_WIDTH / 2, receiver.x - PLAYER_WIDTH / 2);
    // 수직 거리가 접촉 띠에 들어갈 수 있는 범위이고 수평 겹침이 충분하면 시도
    if (gap > 30 && gap < maxRise + 10 && hOverlap >= 12) {
      shouldJump = true;
    }
  }

  if (shouldJump) {
    desired[slotId].jump = true;
    console.log(`[bot ${slotId}] STRIKER JUMP! gap=${(actor.y - receiver.y).toFixed(1)} rvy=${receiver.vy.toFixed(1)} lat=${latencyTicks}`);
  }
}

// ── 장치 역할 실행 ──────────────────────────────────────────────

/**
 * anchor 역할: anchor 좌표로 2D 내비게이션 이동 후 interact 홀드.
 * @param {string} slotId 슬롯 ID
 * @returns {void}
 */
function executeGoAnchor(slotId) {
  const module = getCurrentModule();
  if (!module) return;
  const agent = agentState.get(slotId);
  if (agent) agent.targetX = module.anchor.x;
  navigateTo(slotId, module.anchor.x, module.anchor.y);
  // anchor 반경 이내이면 interact 시작
  const actor = getPlayer(slotId);
  if (actor && isNearPoint(actor, module.anchor, INTERACT_RADIUS)) {
    desired[slotId].interact = true;
  }
}

/**
 * anchor 홀드: interact 유지. safe-ground/lightning-lock 대피 포함.
 * @param {string} slotId 슬롯 ID
 * @returns {void}
 */
function executeHoldAnchor(slotId) {
  // anchored 상태이면 서버가 위치를 고정하므로 이동 명령 불필요
  desired[slotId].interact = true;
}

/**
 * 파트너가 switch 역할이지만 아직 POWERED가 아닌 상태:
 * switch 근처로 미리 이동해 대기한다.
 * @param {string} slotId 슬롯 ID
 * @returns {void}
 */
function executeWaitNearSwitch(slotId) {
  const module = getCurrentModule();
  const device = getCurrentDevice();
  if (!module || !device) return;

  // safe-ground/lightning-lock 대피 처리
  if (device.strikeWarning && (device.type === 'safe-ground' || device.type === 'lightning-lock')) {
    executeShelter(slotId, device);
    return;
  }

  // switch 근처로 2D 내비게이션 이동 (아직 interact 하지 않음)
  const agent = agentState.get(slotId);
  if (agent) agent.targetX = module.switch.x;
  navigateTo(slotId, module.switch.x, module.switch.y);
}

/**
 * GO_SWITCH: POWERED 상태에서 switch 좌표로 이동 후 interact.
 * 장치 타입별 특수 정책 적용.
 * @param {string} slotId 슬롯 ID
 * @returns {void}
 */
function executeGoSwitch(slotId) {
  const module = getCurrentModule();
  const device = getCurrentDevice();
  if (!module || !device) return;

  // 장치 타입별 특수 정책
  if (executeDeviceSpecific(slotId, device, module)) return;

  // 기본: switch 좌표로 2D 내비게이션 이동 + interact
  const agent = agentState.get(slotId);
  if (agent) agent.targetX = module.switch.x;
  navigateTo(slotId, module.switch.x, module.switch.y);
  const actor = getPlayer(slotId);
  if (actor && isNearPoint(actor, module.switch, INTERACT_RADIUS)) {
    desired[slotId].interact = true;
  }
}

/**
 * GO_CHECKPOINT: LATCHED 후 체크포인트 구역 중심으로 이동.
 * @param {string} slotId 슬롯 ID
 * @returns {void}
 */
function executeGoCheckpoint(slotId) {
  const module = getCurrentModule();
  if (!module) return;
  const checkpoint = module.checkpoint;
  // p1은 왼쪽 1/4, p2는 오른쪽 3/4으로 분산
  const offsetX = slotId === 'p1' ? checkpoint.width * 0.25 : checkpoint.width * 0.75;
  const targetX = checkpoint.x + offsetX;
  // FIX-6v2: checkpoint 구역 내에서 가장 아래 발판(현재 모듈의 end 발판)을 목표로 한다.
  // checkpoint.y + height 하한 근처를 targetY로 사용하면 findNearestPlatform이
  // 다음 모듈의 return 발판 대신 현재 모듈의 end 발판을 정확히 선택한다.
  const targetY = checkpoint.y + (checkpoint.height ?? 0) - 10;
  const agent = agentState.get(slotId);
  if (agent) agent.targetX = targetX;
  navigateTo(slotId, targetX, targetY);
  // interact 해제
  desired[slotId].interact = false;
}

/**
 * FINISH_PRESS: 자기 슬롯에 해당하는 결승 스위치로 이동 후 interact 홀드.
 * @param {string} slotId 슬롯 ID
 * @returns {void}
 */
function executeFinishPress(slotId) {
  if (!levelData?.finish || !latestSnapshot) return;
  const finish = latestSnapshot.level?.finish ?? levelData.finish;
  const finishState = latestSnapshot.finishState;

  // 발사 중이면 interact 해제
  if (finishState?.phase === 'launching') {
    desired[slotId].interact = false;
    return;
  }

  // p1 → leftSwitch, p2 → rightSwitch
  const mySwitch = slotId === 'p1' ? finish.leftSwitch : finish.rightSwitch;
  navigateTo(slotId, mySwitch.x, mySwitch.y);

  const actor = getPlayer(slotId);
  if (actor && isNearPoint(actor, mySwitch, INTERACT_RADIUS)) {
    // 파트너 위치 관계없이 즉시 interact 홀드
    desired[slotId].interact = true;
  }
}

// ── 장치 타입별 특수 정책 ────────────────────────────────────────

/**
 * 장치 타입별 특수 동작을 실행한다.
 * @param {string} slotId 슬롯 ID
 * @param {object} device 장치 상태
 * @param {object} module 모듈 정의
 * @returns {boolean} true면 기본 GO_SWITCH 로직을 건너뛴다
 */
function executeDeviceSpecific(slotId, device, module) {
  // safe-ground / lightning-lock: 경보 시 대피
  if (device.strikeWarning && (device.type === 'safe-ground' || device.type === 'lightning-lock')) {
    executeShelter(slotId, device);
    return true;
  }

  // rotary: 위험 각도에서는 interact 억제
  if (device.type === 'rotary' && device.warning) {
    navigateTo(slotId, module.switch.x, module.switch.y);
    desired[slotId].interact = false;
    return true;
  }

  // docking-lock: 속도/높이 미충족 시 interact 억제
  if ((device.type === 'docking-lock' || device.type === 'merge-lift') && device.warning) {
    // 파트너 속도에 맞추기
    const partnerId = getPartnerSlotId(slotId);
    const partner = getPlayer(partnerId);
    if (partner) {
      if (partner.vx > 5) { desired[slotId].left = false; desired[slotId].right = true; }
      else if (partner.vx < -5) { desired[slotId].left = true; desired[slotId].right = false; }
      else { desired[slotId].left = false; desired[slotId].right = false; }
    }
    desired[slotId].interact = false;
    return true;
  }

  // timer-gate: 닫힘 상태에서 게이트 직전 대기
  if (device.type === 'timer-gate') {
    if (device.solid) {
      // 게이트 닫힌 상태 → switch 방향으로 이동하되 경보 시 멈춤
      if (device.warning) {
        // 곧 닫힘 예고 + 아직 진입 전 → 대기
        desired[slotId].left = false;
        desired[slotId].right = false;
        return true;
      }
      // 닫힘 → 대기
      return true;
    }
    // 열림 → 기본 이동
    return false;
  }

  // cycle-platform: 발판 사라짐 시 대기
  if (device.type === 'cycle-platform') {
    if (!device.solid) {
      // 사라진 상태 → 대기
      desired[slotId].left = false;
      desired[slotId].right = false;
      return true;
    }
    return false;
  }

  // wind-shutter: 바람 부는 중에도 방향을 유지 (서버가 물리 처리)
  // updraft: interact 안 하면 상승, interact 하면 고정
  // 기본 동작으로 충분

  return false;
}

/**
 * safe-ground/lightning-lock 경보 시 대피 위치로 이동한다.
 * @param {string} slotId 슬롯 ID
 * @param {object} device 장치 상태
 * @returns {void}
 */
function executeShelter(slotId, device) {
  // 체크포인트 오른쪽 절반 중심으로 대피
  const shelterX = device.checkpoint.x + device.checkpoint.width * (slotId === 'p1' ? 0.25 : 0.75);
  moveToX(slotId, shelterX);
  desired[slotId].interact = true;
}

// ── FIX-4v2: 교착 감지 (2차 개선) ─────────────────────────────────

/**
 * 슬롯의 교착 여부를 매 틱 감지한다.
 * FIX-4v2: BOOST_STRIKER/BOOST_RECEIVER/WAIT_NEAR_SWITCH를 무조건 제외.
 * 이 목표들은 정당한 대기(파트너 점프 대기, 파트너 anchor 대기)를 수반하므로
 * 3초 교착 감지에서 완전히 배제한다. 대신 별도의 장기 타임아웃(BOOST_LONG_TIMEOUT_TICKS)
 * 으로 진짜 무한 대기를 방지한다.
 * @param {string} slotId 슬롯 ID
 * @returns {void}
 */
function detectStuck(slotId) {
  const agent = agentState.get(slotId);
  if (!agent) return;

  // 무조건 제외 목표: 정당한 대기 또는 자체 타이머가 있는 목표
  const unconditionalExclude = [
    GOAL.FINISH_PRESS, GOAL.DONE, GOAL.WAIT_RESPAWN,
    GOAL.HOLD_ANCHOR, GOAL.FALLBACK_WAIT, GOAL.JIGGLE,
    GOAL.BOOST_STRIKER, GOAL.BOOST_RECEIVER, GOAL.WAIT_NEAR_SWITCH,
  ];
  if (unconditionalExclude.includes(agent.goal)) {
    // 장기 타임아웃: 부스트/대기 목표에서 BOOST_LONG_TIMEOUT_TICKS 이상 체류 시 목표 재계산
    if (agent.goal === GOAL.BOOST_STRIKER || agent.goal === GOAL.BOOST_RECEIVER
      || agent.goal === GOAL.WAIT_NEAR_SWITCH) {
      agent.boostWaitTotalTick++;
      if (agent.boostWaitTotalTick >= BOOST_LONG_TIMEOUT_TICKS) {
        agent.boostWaitTotalTick = 0;
        agent.boostSub = BOOST_SUB.ALIGN;
        agent.boostTick = 0;
        agent.boostFailCount = 0;
        setGoal(slotId, GOAL.RECOMPUTE, 'boost long timeout');
      }
    }
    return;
  }

  const actor = getPlayer(slotId);
  if (!actor) return;

  // STUCK_CHECK_INTERVAL 틱마다 위치 기록
  const tickNow = latestSnapshot?.tick ?? 0;
  if (tickNow - agent.lastRecordedTick >= STUCK_CHECK_INTERVAL) {
    const distance = Math.abs(actor.x - agent.lastRecordedX);
    if (distance < STUCK_DISTANCE) {
      agent.unchangedTicks += STUCK_CHECK_INTERVAL;
    } else {
      agent.unchangedTicks = 0;
    }
    agent.lastRecordedX = actor.x;
    agent.lastRecordedTick = tickNow;
  }

  // 90틱(3초) 동안 미이동 → 교착
  if (agent.unchangedTicks >= STUCK_TICKS) {
    agent.stuckTicks++;
    agent.unchangedTicks = 0;
    resolveStuck(slotId);
  }
}

/**
 * 교착 해제 순서를 실행한다.
 * FIX-4: resolveStuck에서 desired.jump = true를 직접 설정하지 않는다.
 * @param {string} slotId 슬롯 ID
 * @returns {void}
 */
function resolveStuck(slotId) {
  const agent = agentState.get(slotId);
  if (!agent) return;

  if (agent.stuckTicks < 3) {
    // 1단계: Jiggle
    agent.jiggleDir = -agent.jiggleDir || 1;
    agent.jiggleTicks = JIGGLE_TICKS;
    setGoal(slotId, GOAL.JIGGLE, `stuck=${agent.stuckTicks} jiggle`);
  } else if (agent.stuckTicks < 6) {
    // 2단계: Jiggle (FIX-4: 점프 제거 — 잘못된 위치에서 점프 발동 방지)
    agent.jiggleDir = -agent.jiggleDir || 1;
    agent.jiggleTicks = JIGGLE_TICKS;
    setGoal(slotId, GOAL.JIGGLE, `stuck=${agent.stuckTicks} jiggle-stage2`);
  } else if (agent.stuckTicks < 9) {
    // 3단계: 목표 재계산
    setGoal(slotId, GOAL.RECOMPUTE, `stuck=${agent.stuckTicks} recompute`);
    agent.boostSub = BOOST_SUB.ALIGN;
    agent.boostTick = 0;
  } else {
    // 4단계: Fallback 대기
    agent.fallbackTick = FALLBACK_WAIT_TICKS;
    setGoal(slotId, GOAL.FALLBACK_WAIT, `stuck=${agent.stuckTicks} fallback`);
    agent.stuckTicks = 0; // 리셋
  }
}

/**
 * Jiggle 실행: 반대 방향으로 이동.
 * FIX-3: 발판 가장자리 가드를 적용한다.
 * @param {string} slotId 슬롯 ID
 * @returns {void}
 */
function executeJiggle(slotId) {
  const agent = agentState.get(slotId);
  if (!agent) return;

  if (agent.jiggleTicks <= 0) {
    // Jiggle 종료 → 목표 재계산
    setGoal(slotId, GOAL.RECOMPUTE, 'jiggle done');
    return;
  }

  agent.jiggleTicks--;

  // FIX-3: jiggle 방향도 발판 가장자리 가드를 통과시킨다
  const actor = getPlayer(slotId);
  if (actor && actor.grounded) {
    const platform = findStandingPlatform(slotId);
    if (platform) {
      const safeLeft = platform.x + PLATFORM_EDGE_MARGIN;
      const safeRight = platform.x + platform.width - PLATFORM_EDGE_MARGIN;
      // jiggle이 가장자리 밖으로 향하면 억제
      if (agent.jiggleDir < 0 && actor.x <= safeLeft) {
        agent.jiggleDir = 1; // 방향 반전
      } else if (agent.jiggleDir > 0 && actor.x >= safeRight) {
        agent.jiggleDir = -1; // 방향 반전
      }
    }
  }

  desired[slotId].left = agent.jiggleDir < 0;
  desired[slotId].right = agent.jiggleDir > 0;
}

/**
 * Fallback 대기: 모든 입력 중립으로 일정 시간 대기.
 * @param {string} slotId 슬롯 ID
 * @returns {void}
 */
function executeFallbackWait(slotId) {
  const agent = agentState.get(slotId);
  if (!agent) return;

  clearDesired(slotId);
  agent.fallbackTick--;
  if (agent.fallbackTick <= 0) {
    setGoal(slotId, GOAL.RECOMPUTE, 'fallback done');
  }
}

// ── 메인 틱 루프 ─────────────────────────────────────────────────

/**
 * 30Hz 메인 틱 루프. 슬롯별 독립 에이전트를 실행하고 INPUT을 전송한다.
 * @returns {void}
 */
function tick() {
  if (!gameStarted || !latestSnapshot) return;
  if (latestSnapshot.phase !== 'playing' && latestSnapshot.phase !== 'result') return;

  for (const slotId of ownedIds) {
    const actor = getPlayer(slotId);
    if (!actor) continue;

    const agent = agentState.get(slotId);
    if (!agent) { initAgent(slotId); continue; }

    // 1. 리스폰 중 → 입력 억제
    if (actor.respawnTimer > 0) {
      clearDesired(slotId);
      setGoal(slotId, GOAL.WAIT_RESPAWN);
      continue;
    }

    // 2. 리스폰 복귀 감지 → 목표 재계산
    if (agent.goal === GOAL.WAIT_RESPAWN) {
      setGoal(slotId, GOAL.RECOMPUTE, 'respawn done');
      resetStuck(slotId);
      agent.boostSub = BOOST_SUB.ALIGN;
      agent.boostTick = 0;
    }

    // 3. 교착 감지 (JIGGLE/FALLBACK 중에는 건너뜀)
    if (agent.goal !== GOAL.JIGGLE && agent.goal !== GOAL.FALLBACK_WAIT) {
      detectStuck(slotId);
    }

    // 4. JIGGLE/FALLBACK 실행 중이면 computeGoal 건너뜀
    if (agent.goal === GOAL.JIGGLE) {
      executeGoal(slotId, GOAL.JIGGLE);
      continue;
    }
    if (agent.goal === GOAL.FALLBACK_WAIT) {
      executeGoal(slotId, GOAL.FALLBACK_WAIT);
      continue;
    }

    // 5. 목표 계산
    const goal = computeGoal(slotId);
    setGoal(slotId, goal);

    // 6. 목표 실행
    executeGoal(slotId, goal);
  }

  // 7. 소유 슬롯 INPUT 전송
  for (const slotId of ownedIds) sendInput(slotId);
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
