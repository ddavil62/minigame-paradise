/**
 * @fileoverview 서버 권위 스냅샷 사이의 렌더 전용 좌표와 수신 시간축을 계산한다.
 */

export const DEFAULT_INTERVAL_MS = 1000 / 15;
export const LONG_GAP_MS = 500;
export const PLAYER_SNAP_DISTANCE = 240;
export const PLATFORM_SNAP_DISTANCE = 240;
const MIN_INTERVAL_MS = 40;
const MAX_INTERVAL_MS = 100;
const EWMA_WEIGHT = 0.2;

/** @param {number} value 값 @param {number} min 최솟값 @param {number} max 최댓값 @returns {number} */
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

/** @param {number} start 시작값 @param {number} end 끝값 @param {number} alpha 진행도 @returns {number} */
export function lerp(start, end, alpha) { return start + (end - start) * clamp(alpha, 0, 1); }

/**
 * 최근 수신 간격을 비정상 표본에 흔들리지 않는 EWMA로 갱신한다.
 * @param {number} previous 이전 추정값
 * @param {number} sample 새 표본
 * @returns {number}
 */
export function updateIntervalEwma(previous, sample) {
  const safePrevious = Number.isFinite(previous) ? previous : DEFAULT_INTERVAL_MS;
  const safeSample = clamp(sample, MIN_INTERVAL_MS, MAX_INTERVAL_MS);
  return safePrevious + (safeSample - safePrevious) * EWMA_WEIGHT;
}

/**
 * 렌더 시각이 두 수신 시각 사이에서 차지하는 비율을 구한다.
 * @param {number} previousReceivedAt 이전 수신 시각
 * @param {number} currentReceivedAt 현재 수신 시각
 * @param {number} renderTime 렌더 대상 시각
 * @returns {number}
 */
export function calculateInterpolationAlpha(previousReceivedAt, currentReceivedAt, renderTime) {
  const duration = currentReceivedAt - previousReceivedAt;
  return duration > 0 ? clamp((renderTime - previousReceivedAt) / duration, 0, 1) : 1;
}

/** @param {object} first 첫 개체 @param {object} second 둘째 개체 @returns {number} */
function distance(first, second) { return Math.hypot((second.x ?? 0) - (first.x ?? 0), (second.y ?? 0) - (first.y ?? 0)); }

/**
 * 개체 좌표를 가로질러 그리지 않고 최신 위치로 스냅할지 판정한다.
 * @param {object|undefined} previous 이전 개체
 * @param {object} current 최신 개체
 * @param {{distanceLimit:number,checkRespawn?:boolean}} context 판정 조건
 * @returns {boolean}
 */
export function shouldSnapEntity(previous, current, context) {
  if (!previous || previous.id !== current.id) return true;
  if (context.checkRespawn) {
    const previousRespawning = (previous.respawnTimer ?? 0) > 0;
    const currentRespawning = (current.respawnTimer ?? 0) > 0;
    if (previousRespawning !== currentRespawning || previous.alive !== current.alive) return true;
  }
  return distance(previous, current) > context.distanceLimit;
}

/**
 * 최신 이산 상태를 유지하면서 플레이어 운동값만 보간한다.
 * @param {object|undefined} previous 이전 플레이어
 * @param {object} current 최신 플레이어
 * @param {number} alpha 진행도
 * @returns {object}
 */
export function interpolatePlayer(previous, current, alpha) {
  if (shouldSnapEntity(previous, current, { distanceLimit: PLAYER_SNAP_DISTANCE, checkRespawn: true })) return { ...current };
  return { ...current, x: lerp(previous.x, current.x, alpha), y: lerp(previous.y, current.y, alpha), vx: lerp(previous.vx, current.vx, alpha), vy: lerp(previous.vy, current.vy, alpha) };
}

/**
 * 최신 이산 상태를 유지하면서 발판 좌표만 보간한다.
 * @param {object|undefined} previous 이전 발판
 * @param {object} current 최신 발판
 * @param {number} alpha 진행도
 * @returns {object}
 */
export function interpolatePlatform(previous, current, alpha) {
  if (shouldSnapEntity(previous, current, { distanceLimit: PLATFORM_SNAP_DISTANCE })) return { ...current };
  const result = { ...current, x: lerp(previous.x, current.x, alpha), y: lerp(previous.y, current.y, alpha) };
  if (Number.isFinite(previous.angle) && Number.isFinite(current.angle)) {
    const delta = ((current.angle - previous.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    result.angle = previous.angle + delta * clamp(alpha, 0, 1);
  }
  return result;
}

/**
 * 최신 장치 상태를 유지하면서 회전 장치의 각도만 최단 경로로 보간한다.
 * @param {object|undefined} previous 이전 장치
 * @param {object} current 최신 장치
 * @param {number} alpha 진행도
 * @returns {object}
 */
export function interpolateDevice(previous, current, alpha) {
  if (!previous || previous.id !== current.id || !Number.isFinite(previous.angle) || !Number.isFinite(current.angle)) return { ...current };
  const delta = ((current.angle - previous.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  return { ...current, angle: previous.angle + delta * clamp(alpha, 0, 1) };
}

/**
 * 최신 이산 상태에 두 스냅샷 사이의 렌더 좌표를 합성한다.
 * @param {object} previous 이전 스냅샷
 * @param {object} current 최신 스냅샷
 * @param {number} alpha 진행도
 * @returns {object}
 */
export function interpolateSnapshot(previous, current, alpha) {
  const previousPlayers = new Map((previous.players ?? []).map((item) => [item.id, item]));
  const previousPlatforms = new Map((previous.level?.platforms ?? []).map((item) => [item.id, item]));
  const previousDevices = new Map((previous.devices ?? []).map((item) => [item.id, item]));
  return {
    ...current,
    players: (current.players ?? []).map((item) => interpolatePlayer(previousPlayers.get(item.id), item, alpha)),
    devices: (current.devices ?? []).map((item) => interpolateDevice(previousDevices.get(item.id), item, alpha)),
    level: {
      ...current.level,
      platforms: (current.level?.platforms ?? []).map((item) => interpolatePlatform(previousPlatforms.get(item.id), item, alpha)),
      specials: (current.level?.specials ?? []).map((item) => interpolatePlatform((previous.level?.specials ?? []).find((previousItem) => previousItem.id === item.id), item, alpha)),
    },
  };
}

/**
 * 렌더러가 사용하는 두 스냅샷 시간 버퍼를 만든다.
 * @returns {{push:Function,sample:Function,reset:Function,getInterval:Function}}
 */
export function createInterpolationBuffer() {
  let previous = null;
  let current = null;
  let previousReceivedAt = 0;
  let currentReceivedAt = 0;
  let intervalMs = DEFAULT_INTERVAL_MS;
  let resetOnNextPush = false;

  /** @param {object} value 스냅샷 @param {number} receivedAt 단조 수신 시각 @returns {boolean} */
  function push(value, receivedAt) {
    const transition = current && (value.levelId !== current.levelId || value.phase !== current.phase || value.checkpointId !== current.checkpointId);
    const invalidTick = current && value.tick <= current.tick;
    const longGap = current && receivedAt - currentReceivedAt > LONG_GAP_MS;
    if (!current || transition || longGap || resetOnNextPush) {
      previous = value; current = value; previousReceivedAt = receivedAt; currentReceivedAt = receivedAt; resetOnNextPush = false; return true;
    }
    if (invalidTick) { previous = current; previousReceivedAt = currentReceivedAt; return false; }
    const sample = receivedAt - currentReceivedAt;
    intervalMs = updateIntervalEwma(intervalMs, sample);
    previous = current; previousReceivedAt = currentReceivedAt;
    current = value; currentReceivedAt = receivedAt;
    return true;
  }

  /** @param {number} now 현재 rAF 시각 @returns {object|null} */
  function sample(now) {
    if (!current || !previous) return current;
    const alpha = calculateInterpolationAlpha(previousReceivedAt, currentReceivedAt, now - intervalMs);
    return interpolateSnapshot(previous, current, alpha);
  }

  /** @returns {void} */
  function reset() { resetOnNextPush = true; previous = current; previousReceivedAt = currentReceivedAt; }

  /** @returns {number} */
  function getInterval() { return intervalMs; }

  return { push, sample, reset, getInterval };
}
