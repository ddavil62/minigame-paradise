/**
 * @fileoverview 15Hz 서버 스냅샷 사이를 디스플레이 프레임에 맞춰 보간한다.
 * 판정 상태는 최신 권위 값을 유지하고 화면에 보이는 연속 수치만 섞는다.
 */
export const DEFAULT_INTERVAL_MS = 1000 / 15;
export const LONG_GAP_MS = 500;
export const ENTITY_SNAP_DISTANCE = 180;
const MIN_INTERVAL_MS = 40;
const MAX_INTERVAL_MS = 100;
const EWMA_WEIGHT = 0.2;

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
export function lerp(start, end, alpha) { return start + (end - start) * clamp(alpha, 0, 1); }

export function updateIntervalEwma(previous, sample) {
  const safePrevious = Number.isFinite(previous) ? previous : DEFAULT_INTERVAL_MS;
  const safeSample = clamp(sample, MIN_INTERVAL_MS, MAX_INTERVAL_MS);
  return safePrevious + (safeSample - safePrevious) * EWMA_WEIGHT;
}

export function calculateInterpolationAlpha(previousReceivedAt, currentReceivedAt, renderTime) {
  const duration = currentReceivedAt - previousReceivedAt;
  return duration > 0 ? clamp((renderTime - previousReceivedAt) / duration, 0, 1) : 1;
}

function canInterpolatePosition(previous, current) {
  return Boolean(previous && previous.id === current.id
    && Number.isFinite(previous.x) && Number.isFinite(previous.y)
    && Number.isFinite(current.x) && Number.isFinite(current.y)
    && Math.hypot((current.x ?? 0) - (previous.x ?? 0), (current.y ?? 0) - (previous.y ?? 0)) <= ENTITY_SNAP_DISTANCE);
}

export function interpolatePlayer(previous, current, alpha) {
  if (!canInterpolatePosition(previous, current)) return { ...current };
  return { ...current, x: lerp(previous.x, current.x, alpha), y: lerp(previous.y, current.y, alpha) };
}

export function interpolateItem(previous, current, alpha) {
  const stableIdentity = previous
    && previous.location === current.location
    && previous.holderId === current.holderId
    && previous.process === current.process;
  if (!stableIdentity || !canInterpolatePosition(previous, current)) return { ...current };
  return { ...current, x: lerp(previous.x, current.x, alpha), y: lerp(previous.y, current.y, alpha) };
}

export function interpolateStation(previous, current, alpha) {
  if (!previous || previous.id !== current.id || previous.state !== current.state || previous.revision !== current.revision) return { ...current };
  return {
    ...current,
    progressMs: lerp(Number(previous.progressMs) || 0, Number(current.progressMs) || 0, alpha),
    readyMs: lerp(Number(previous.readyMs) || 0, Number(current.readyMs) || 0, alpha),
  };
}

function interpolateOptionalNumber(previous, current, alpha) {
  return Number.isFinite(previous) && Number.isFinite(current) ? lerp(previous, current, alpha) : current;
}

export function interpolateSnapshot(previous, current, alpha) {
  const previousPlayers = new Map((previous.players ?? []).map((entry) => [entry.id, entry]));
  const previousItems = new Map((previous.items ?? []).map((entry) => [entry.id, entry]));
  const previousStations = new Map((previous.stations ?? []).map((entry) => [entry.id, entry]));
  const train = current.train ?? {};
  const previousTrain = previous.train ?? {};
  const heat = lerp(Number(previous.heat) || 0, Number(current.heat) || 0, alpha);
  return {
    ...current,
    elapsedMs: lerp(Number(previous.elapsedMs) || 0, Number(current.elapsedMs) || 0, alpha),
    heat,
    players: (current.players ?? []).map((entry) => interpolatePlayer(previousPlayers.get(entry.id), entry, alpha)),
    items: (current.items ?? []).map((entry) => interpolateItem(previousItems.get(entry.id), entry, alpha)),
    stations: (current.stations ?? []).map((entry) => interpolateStation(previousStations.get(entry.id), entry, alpha)),
    train: {
      ...train,
      heat,
      coolingProgressMs: interpolateOptionalNumber(previousTrain.coolingProgressMs, train.coolingProgressMs, alpha),
      overheatRemainingMs: interpolateOptionalNumber(previousTrain.overheatRemainingMs, train.overheatRemainingMs, alpha),
    },
  };
}

export function createInterpolationBuffer() {
  let previous = null;
  let current = null;
  let previousReceivedAt = 0;
  let currentReceivedAt = 0;
  let intervalMs = DEFAULT_INTERVAL_MS;
  let resetOnNextPush = false;

  function push(value, receivedAt) {
    const transition = current && value.phase !== current.phase;
    const invalidTick = current && value.tick <= current.tick;
    const longGap = current && receivedAt - currentReceivedAt > LONG_GAP_MS;
    if (!current || transition || longGap || resetOnNextPush) {
      previous = value; current = value; previousReceivedAt = receivedAt; currentReceivedAt = receivedAt; resetOnNextPush = false; return true;
    }
    if (invalidTick) return false;
    intervalMs = updateIntervalEwma(intervalMs, receivedAt - currentReceivedAt);
    previous = current; previousReceivedAt = currentReceivedAt;
    current = value; currentReceivedAt = receivedAt;
    return true;
  }

  function sample(now) {
    if (!current || !previous) return current;
    const alpha = calculateInterpolationAlpha(previousReceivedAt, currentReceivedAt, now - intervalMs);
    return interpolateSnapshot(previous, current, alpha);
  }

  function reset() { resetOnNextPush = true; previous = current; previousReceivedAt = currentReceivedAt; }
  function getInterval() { return intervalMs; }
  return { push, sample, reset, getInterval };
}
