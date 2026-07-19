/**
 * @fileoverview 30Hz 서버 권위 이동·충돌·장치·공동 체크포인트·빠른 복귀 시뮬레이션을 제공한다.
 */

import { isInsideCheckpoint } from '../shared/level-data.js';
import { DEFAULT_LEVEL_ID, getLevel } from '../shared/levels.js';
import { DEVICE_STATE, createDevices, updateDevice } from './devices.js';

const PLAYER_WIDTH = 40;
const PLAYER_HEIGHT = 56;
const MOVE_SPEED = 250;
const JUMP_SPEED = 650;
const GRAVITY = 1450;
const RESPAWN_SECONDS = 1.2;

/**
 * 초기 플레이어 상태를 만든다.
 * @param {'p1'|'p2'} id 플레이어 ID
 * @param {number} x 시작 X
 * @param {number} y 시작 Y
 * @returns {object}
 */
function createPlayer(id, x, y) {
  return { id, x, y, vx: 0, vy: 0, grounded: false, anchored: false, respawnTimer: 0, ackSeq: -1, input: { left: false, right: false, jump: false, interact: false } };
}

/**
 * Phase 1 시뮬레이션 상태를 생성한다.
 * @returns {object}
 */
export function createSimulation(levelId = DEFAULT_LEVEL_ID) {
  const level = getLevel(levelId) ?? getLevel(DEFAULT_LEVEL_ID);
  return {
    levelId: level.id,
    level,
    tick: 0,
    elapsedMs: 0,
    phase: 'waiting',
    players: [createPlayer('p1', 150, level.world.spawnY), createPlayer('p2', 215, level.world.spawnY)],
    devices: createDevices(level.modules),
    dynamicPlatforms: level.platforms.map((platform) => ({ ...platform })),
    activeZones: [],
    checkpointId: 0,
    falls: 0,
    roleSwaps: 0,
    finishState: { phase: 'idle', leftPressedAt: null, rightPressedAt: null, launchStartedMs: null, expiredAtMs: null, expiredSide: null },
    eventCounter: 0,
  };
}

/**
 * 플레이어의 최신 입력을 시퀀스 순서대로 적용한다.
 * @param {object} simulation 시뮬레이션
 * @param {string} playerId 플레이어 ID
 * @param {object} input 검증된 입력
 * @returns {boolean}
 */
export function applyInput(simulation, playerId, input) {
  const player = simulation.players.find((item) => item.id === playerId);
  if (!player || input.seq <= player.ackSeq) return false;
  player.ackSeq = input.seq;
  player.input = { left: input.left, right: input.right, jump: input.jump, interact: input.interact };
  return true;
}

/**
 * 수평 발판과의 하강 충돌을 해결한다.
 * @param {object} player 플레이어
 * @param {number} previousBottom 이전 발끝 Y
 * @param {Array<object>} devices 장치 상태
 * @returns {void}
 */
function resolvePlatforms(player, previousBottom, devices, platforms) {
  player.grounded = false;
  const left = player.x - PLAYER_WIDTH / 2;
  const right = player.x + PLAYER_WIDTH / 2;
  const bottom = player.y + PLAYER_HEIGHT / 2;
  if (player.vy < 0) return;
  for (const platform of platforms) {
    const device = Number.isInteger(platform.deviceIndex) ? devices[platform.deviceIndex] : null;
    if (device && (device.state === DEVICE_STATE.IDLE || device.solid === false)) continue;
    const overlapsX = right > platform.x && left < platform.x + platform.width;
    if (overlapsX && previousBottom <= platform.y && bottom >= platform.y) {
      player.y = platform.y - PLAYER_HEIGHT / 2;
      player.vy = 0;
      player.grounded = true;
      return;
    }
  }
}

/** @param {number} phase 0~1 위상 @returns {number} 0~1 삼각파 */
function triangleWave(phase) { return phase < 0.5 ? phase * 2 : (1 - phase) * 2; }

/**
 * 서버 장치 상태로 동적 충돌체를 변환하고 탑승자를 함께 운반한다.
 * @param {object} simulation 시뮬레이션
 * @param {number} dt 고정 스텝 초
 * @returns {void}
 */
function updateDynamicPlatforms(simulation, dt) {
  simulation.dynamicPlatforms = simulation.level.platforms.map((source) => {
    const platform = { ...source };
    if (!Number.isInteger(source.deviceIndex) || !source.dynamic) return platform;
    const device = simulation.devices[source.deviceIndex];
    const motion = source.dynamic;
    const previous = simulation.dynamicPlatforms?.find((item) => item.id === source.id) ?? source;
    if (device?.state === DEVICE_STATE.POWERED) {
      if (device.type === 'rotary' && Array.isArray(motion.pivot)) {
        const length = motion.length ?? source.width;
        const x2 = motion.pivot[0] + Math.cos(device.angle) * length;
        const y2 = motion.pivot[1] + Math.sin(device.angle) * length;
        platform.x = Math.min(motion.pivot[0], x2);
        platform.y = Math.min(motion.pivot[1], y2) - source.height / 2;
        platform.width = Math.max(20, Math.abs(x2 - motion.pivot[0]));
        platform.height = Math.max(source.height, Math.abs(y2 - motion.pivot[1]) + source.height);
      } else {
        const phase = (simulation.elapsedMs % motion.periodMs) / motion.periodMs;
        const position = motion.from + (motion.to - motion.from) * triangleWave(phase);
        platform[motion.axis] = position;
      }
    } else {
      platform.x = previous.x;
      platform.y = previous.y;
    }
    const dx = platform.x - previous.x;
    const dy = platform.y - previous.y;
    if (motion.carryRiders && (dx !== 0 || dy !== 0)) {
      simulation.players.forEach((player) => {
        const feet = player.y + PLAYER_HEIGHT / 2;
        const aboard = player.x + PLAYER_WIDTH / 2 > previous.x && player.x - PLAYER_WIDTH / 2 < previous.x + previous.width && Math.abs(feet - previous.y) <= Math.max(8, Math.abs(dy) + 4);
        if (aboard) { player.x += dx; player.y += dy; }
      });
    }
    return platform;
  });
  void dt;
}

/**
 * 현재 장치와 레벨 위험 구역이 만드는 힘을 플레이어 속도에 적용한다.
 * @param {object} simulation 시뮬레이션
 * @param {object} player 플레이어
 * @param {number} dt 고정 스텝 초
 * @returns {void}
 */
function applyZoneForces(simulation, player, dt) {
  const current = simulation.devices[simulation.checkpointId];
  const inZone = current && player.x >= current.checkpoint.x && player.x <= current.checkpoint.x + current.checkpoint.width && player.y >= current.checkpoint.y - 220 && player.y <= current.checkpoint.y + current.checkpoint.height;
  if (inZone && current.active && current.type === 'wind-shutter') {
    player.vx += (current.mechanics?.forceX ?? 0) * dt;
    simulation.activeZones.push({ id: current.id, type: 'wind', active: true, ...current.checkpoint, forceX: current.mechanics?.forceX ?? 0 });
  }
  if (inZone && current.active && current.type === 'updraft') {
    player.vy = Math.max(-760, player.vy + (current.mechanics?.liftAcceleration ?? -1900) * dt);
    simulation.activeZones.push({ id: current.id, type: 'updraft', active: true, ...current.checkpoint, liftAcceleration: current.mechanics?.liftAcceleration ?? -1900 });
  }
}

/**
 * 체크포인트 위치로 플레이어를 원자적으로 복귀시킨다.
 * @param {object} simulation 시뮬레이션
 * @returns {void}
 */
function restoreCheckpoint(simulation) {
  const checkpoint = simulation.level.checkpoints[simulation.checkpointId];
  simulation.players.forEach((player, index) => {
    player.x = index === 0 ? checkpoint.x1 : checkpoint.x2;
    player.y = index === 0 ? checkpoint.y1 : checkpoint.y2;
    player.vx = 0;
    player.vy = 0;
    player.anchored = false;
    player.respawnTimer = 0;
  });
  // 현재 체크포인트 뒤의 장치 진행만 보존하고 진행 중 상태는 안전하게 초기화한다.
  simulation.devices.forEach((device, index) => {
    if (index < simulation.checkpointId) device.state = DEVICE_STATE.LATCHED;
    else if (device.state !== DEVICE_STATE.LATCHED) Object.assign(device, { state: DEVICE_STATE.IDLE, anchorPlayerId: null, holdSeconds: 0, releaseSeconds: 0, closeAtMs: null });
  });
}

/**
 * 결승 동시 스위치와 2400ms 발사 연출의 서버 시계를 진행한다.
 * @param {object} simulation 시뮬레이션
 * @returns {Array<{kind:string,payload:object}>}
 */
function updateFinish(simulation) {
  const events = [];
  if (simulation.checkpointId < simulation.level.modules.length) return events;
  const finish = simulation.finishState;
  if (finish.phase === 'launching') {
    if (simulation.elapsedMs - finish.launchStartedMs >= simulation.level.finish.launchMs) {
      finish.phase = 'complete';
      simulation.phase = 'result';
      events.push({ kind: 'GAME_COMPLETED', payload: { elapsedMs: Math.round(simulation.elapsedMs), falls: simulation.falls, roleSwaps: simulation.roleSwaps } });
    }
    return events;
  }
  if (finish.phase !== 'idle') return events;
  const [leftPlayer, rightPlayer] = simulation.players;
  if (leftPlayer.input.interact && Math.hypot(leftPlayer.x - simulation.level.finish.leftSwitch.x, leftPlayer.y - simulation.level.finish.leftSwitch.y) <= 84 && finish.leftPressedAt === null) { finish.leftPressedAt = simulation.elapsedMs; finish.expiredAtMs = null; finish.expiredSide = null; }
  if (rightPlayer.input.interact && Math.hypot(rightPlayer.x - simulation.level.finish.rightSwitch.x, rightPlayer.y - simulation.level.finish.rightSwitch.y) <= 84 && finish.rightPressedAt === null) { finish.rightPressedAt = simulation.elapsedMs; finish.expiredAtMs = null; finish.expiredSide = null; }
  const pressed = [finish.leftPressedAt, finish.rightPressedAt].filter((value) => value !== null);
  if (pressed.length === 2 && Math.abs(finish.leftPressedAt - finish.rightPressedAt) <= simulation.level.finish.windowMs) {
    finish.phase = 'launching';
    finish.launchStartedMs = simulation.elapsedMs;
    events.push({ kind: 'FINISH_STARTED', payload: { launchStartedMs: finish.launchStartedMs } });
  } else if (pressed.length > 0 && simulation.elapsedMs - Math.min(...pressed) > simulation.level.finish.windowMs) {
    finish.expiredAtMs = simulation.elapsedMs;
    finish.expiredSide = finish.leftPressedAt !== null ? 'left' : 'right';
    finish.leftPressedAt = null;
    finish.rightPressedAt = null;
    events.push({ kind: 'FINISH_EXPIRED', payload: { expiredAtMs: finish.expiredAtMs, expiredSide: finish.expiredSide } });
  }
  return events;
}

/**
 * 권위 시뮬레이션을 한 고정 스텝 진행한다.
 * @param {object} simulation 시뮬레이션
 * @param {number} dt 초 단위 고정 스텝
 * @returns {Array<{eventId:number,kind:string,payload:object}>}
 */
export function stepSimulation(simulation, dt) {
  if (simulation.phase !== 'playing') return [];
  simulation.tick += 1;
  simulation.elapsedMs += dt * 1000;
  const events = [];
  simulation.activeZones = [];
  updateDynamicPlatforms(simulation, dt);
  for (const player of simulation.players) {
    if (player.respawnTimer > 0 || player.anchored) continue;
    const direction = Number(player.input.right) - Number(player.input.left);
    const physics = simulation.level.physics;
    if (Number.isFinite(physics.moveAcceleration)) {
      player.vx += direction * physics.moveAcceleration * dt;
      const drag = player.grounded ? physics.groundDrag : physics.airDrag;
      if (direction === 0) player.vx *= Math.max(0, 1 - drag * dt);
      player.vx = Math.max(-physics.maxSpeed, Math.min(physics.maxSpeed, player.vx));
    } else player.vx = direction * (physics.moveSpeed ?? MOVE_SPEED);
    const currentDevice = simulation.devices[simulation.checkpointId];
    const gravityScale = currentDevice?.type === 'low-gravity' && currentDevice.active ? 0.42 : 1;
    if (player.input.jump && player.grounded) player.vy = -(physics.jumpSpeed ?? JUMP_SPEED);
    const previousBottom = player.y + PLAYER_HEIGHT / 2;
    player.vy += (physics.gravity ?? GRAVITY) * gravityScale * dt;
    applyZoneForces(simulation, player, dt);
    player.x = Math.max(PLAYER_WIDTH / 2, Math.min(simulation.level.world.width - PLAYER_WIDTH / 2, player.x + player.vx * dt));
    player.y += player.vy * dt;
    resolvePlatforms(player, previousBottom, simulation.devices, simulation.dynamicPlatforms);
  }
  const currentDevice = simulation.devices[simulation.checkpointId];
  if (currentDevice) events.push(...updateDevice(currentDevice, simulation.players, dt, simulation.elapsedMs));
  if (currentDevice?.strikeActive && currentDevice.type === 'safe-ground' && !currentDevice.shelterSafe.every(Boolean)) {
    simulation.falls += 1;
    restoreCheckpoint(simulation);
    events.push({ kind: 'HAZARD_HIT', payload: { deviceId: currentDevice.id, cause: 'lightning' } });
  }
  if (currentDevice?.state === DEVICE_STATE.LATCHED && simulation.players.every((player) => isInsideCheckpoint(player, currentDevice))) {
    simulation.checkpointId += 1;
    simulation.roleSwaps = Math.max(0, simulation.checkpointId - 1);
    events.push({ kind: 'CHECKPOINT', payload: { checkpointId: simulation.checkpointId } });
  }
  events.push(...updateFinish(simulation));
  const fallen = simulation.players.some((player) => player.y > simulation.level.world.dangerY);
  if (fallen && !simulation.players.some((player) => player.respawnTimer > 0)) {
    simulation.falls += 1;
    simulation.players.forEach((player) => { player.respawnTimer = RESPAWN_SECONDS; player.vx = 0; player.vy = 0; });
    events.push({ kind: 'FALL', payload: { checkpointId: simulation.checkpointId } });
  }
  if (simulation.players.some((player) => player.respawnTimer > 0)) {
    simulation.players.forEach((player) => { player.respawnTimer = Math.max(0, player.respawnTimer - dt); });
    if (simulation.players.every((player) => player.respawnTimer === 0)) {
      restoreCheckpoint(simulation);
      events.push({ kind: 'RESPAWN', payload: { checkpointId: simulation.checkpointId } });
    }
  }
  return events.map((event) => ({ ...event, eventId: ++simulation.eventCounter }));
}

/**
 * 네트워크 전송에 필요한 읽기 전용 스냅샷을 만든다.
 * @param {object} simulation 시뮬레이션
 * @returns {object}
 */
export function snapshotSimulation(simulation) {
  return {
    tick: simulation.tick,
    levelId: simulation.levelId,
    level: { id: simulation.level.id, palette: simulation.level.palette, motif: simulation.level.motif, modules: simulation.level.modules, platforms: simulation.dynamicPlatforms, world: simulation.level.world, finish: simulation.level.finish },
    elapsedMs: Math.round(simulation.elapsedMs),
    phase: simulation.phase,
    checkpointId: simulation.checkpointId,
    falls: simulation.falls,
    roleSwaps: simulation.roleSwaps,
    finishState: { ...simulation.finishState },
    players: simulation.players.map(({ input, ...player }) => ({ ...player })),
    devices: simulation.devices.map(({ holdSeconds, releaseSeconds, ...device }) => ({ ...device })),
    activeZones: simulation.activeZones.map((zone) => ({ ...zone })),
  };
}

/**
 * 테스트 환경에서 현재 모듈을 완료하고 공동 체크포인트를 진행시킨다.
 * @param {object} simulation 시뮬레이션
 * @returns {void}
 */
export function advanceModuleForTesting(simulation) {
  const device = simulation.devices[simulation.checkpointId];
  if (!device) return;
  device.state = DEVICE_STATE.LATCHED;
  simulation.players.forEach((player, index) => {
    player.x = device.checkpoint.x + 60 + index * 45;
    player.y = device.checkpoint.y + 40;
    player.vx = 0;
    player.vy = 0;
  });
  stepSimulation(simulation, 1 / 30);
}

/**
 * 테스트 환경에서 두 결승 스위치를 서버 입력과 동일한 상태로 누른다.
 * @param {object} simulation 시뮬레이션
 * @returns {void}
 */
export function triggerFinishForTesting(simulation) {
  simulation.players[0].x = simulation.level.finish.leftSwitch.x;
  simulation.players[0].y = simulation.level.finish.leftSwitch.y;
  simulation.players[0].input.interact = true;
  simulation.players[1].x = simulation.level.finish.rightSwitch.x;
  simulation.players[1].y = simulation.level.finish.rightSwitch.y;
  simulation.players[1].input.interact = true;
  stepSimulation(simulation, 1 / 30);
}
