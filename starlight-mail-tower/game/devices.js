/**
 * @fileoverview 고정 단자와 파트너 스위치의 IDLE→POWERED→LATCHED 서버 상태 기계를 구현한다.
 */

export const DEVICE_STATE = Object.freeze({ IDLE: 'IDLE', POWERED: 'POWERED', LATCHED: 'LATCHED' });
const INTERACTION_RADIUS = 84;
const HOLD_SECONDS = 0.3;
const RELEASE_WARNING_SECONDS = 0.5;
const SHUTTER_FIRST_CLOSE_MS = 3000;
const SHUTTER_CYCLE_MS = 3600;
const SHUTTER_TRANSITION_MS = 240;

/**
 * 레벨 모듈에서 실행 상태를 생성한다.
 * @param {ReadonlyArray<object>} modules 공유 레벨 모듈
 * @returns {Array<object>}
 */
export function createDevices(modules) {
  return modules.map((module) => ({
    ...module,
    state: DEVICE_STATE.IDLE,
    anchorPlayerId: null,
    holdSeconds: 0,
    releaseSeconds: 0,
    stateChangedMs: 0,
    phaseMs: 0,
    active: false,
    solid: true,
    warning: false,
    angle: 0,
    targetAngle: 0,
    strikeWarning: false,
    strikeActive: false,
    shelterSafe: [false, false],
    relativeSpeed: 0,
    heightDelta: 0,
    closeAtMs: null,
    shutterCycleMs: module.type === 'wind-shutter' ? SHUTTER_CYCLE_MS : null,
  }));
}

/**
 * 장치 타입별 서버 위상과 시각·충돌 플래그를 갱신한다.
 * @param {object} device 장치 상태
 * @param {Array<object>} players 플레이어 상태
 * @param {number} elapsedMs 서버 경과 시간
 * @returns {void}
 */
function updateRuntime(device, players, elapsedMs) {
  const mechanics = device.mechanics ?? {};
  const powered = device.state === DEVICE_STATE.POWERED;
  const runningMs = powered ? Math.max(0, elapsedMs - device.stateChangedMs) : device.phaseMs;
  device.active = powered;
  if (device.type === 'timer-gate') {
    device.phaseMs = runningMs % (mechanics.cycleMs ?? 3600);
    device.solid = !powered || device.phaseMs >= (mechanics.openMs ?? 2100);
    device.warning = powered && !device.solid && device.phaseMs >= (mechanics.openMs ?? 2100) - (mechanics.transitionMs ?? 240);
  } else if (device.type === 'cycle-platform') {
    const cycleMs = mechanics.cycleMs ?? 3000;
    device.phaseMs = (runningMs + (mechanics.phaseOffsetMs ?? 0)) % cycleMs;
    device.solid = powered && device.phaseMs < (mechanics.solidMs ?? 1800);
    device.warning = device.solid && device.phaseMs >= (mechanics.solidMs ?? 1800) - 240;
  } else if (device.type === 'rotary') {
    const periodMs = device.dynamic?.periodMs ?? 4200;
    device.phaseMs = runningMs % periodMs;
    device.angle = powered ? (device.phaseMs / periodMs) * Math.PI * 2 : device.angle;
    device.targetAngle = Math.round(device.angle / (Math.PI / 2)) * (Math.PI / 2);
    device.warning = Math.abs(Math.atan2(Math.sin(device.angle - device.targetAngle), Math.cos(device.angle - device.targetAngle))) > Math.PI / 30;
  } else if (device.type === 'wind-shutter' || device.type === 'updraft') {
    const cycleMs = mechanics.cycleMs ?? 3600;
    device.phaseMs = runningMs % cycleMs;
    device.active = powered && device.phaseMs < (mechanics.activeMs ?? cycleMs);
  } else if (device.type === 'safe-ground' || device.type === 'lightning-lock') {
    const cycleMs = mechanics.strikeCycleMs ?? 2400;
    const warningMs = Math.max(600, mechanics.warningMs ?? 700);
    device.phaseMs = runningMs % cycleMs;
    device.strikeWarning = powered && device.phaseMs >= cycleMs - warningMs;
    device.strikeActive = powered && device.phaseMs >= cycleMs - 120;
    const half = device.checkpoint.width / 2;
    device.shelterSafe = players.map((player, index) => {
      const centerX = device.checkpoint.x + (index === 0 ? half * 0.5 : half * 1.5);
      return Math.abs(player.x - centerX) <= Math.max(48, half * 0.42) && Math.abs(player.y - (device.checkpoint.y + device.checkpoint.height / 2)) <= 72 && player.input.interact;
    });
  } else if (device.type === 'low-gravity') {
    device.active = powered;
  } else if (device.type === 'docking-lock' || device.type === 'merge-lift') {
    device.relativeSpeed = Math.abs((players[0]?.vx ?? 0) - (players[1]?.vx ?? 0));
    device.heightDelta = Math.abs((players[0]?.y ?? 0) - (players[1]?.y ?? 0));
    device.warning = device.relativeSpeed > (mechanics.maxRelativeSpeed ?? 45) || device.heightDelta > (mechanics.maxHeightDelta ?? 12);
  }
}

/**
 * 두 점 사이 거리가 상호작용 반경 이내인지 검사한다.
 * @param {{x:number,y:number}} a 첫 좌표
 * @param {{x:number,y:number}} b 둘째 좌표
 * @returns {boolean}
 */
function isNear(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y) <= INTERACTION_RADIUS;
}

/**
 * 현재 모듈의 장치 입력을 처리하고 발생 이벤트를 반환한다.
 * @param {object} device 장치 상태
 * @param {Array<object>} players 플레이어 상태
 * @param {number} dt 고정 스텝 초
 * @param {number} elapsedMs 서버 경과 시간
 * @returns {Array<{kind:string,payload:object}>}
 */
export function updateDevice(device, players, dt, elapsedMs = 0) {
  const events = [];
  updateRuntime(device, players, elapsedMs);
  if (device.state === DEVICE_STATE.LATCHED) return events;
  if (device.state === DEVICE_STATE.IDLE) {
    const candidate = players.find((player) => player.id === device.requiredPlayerId && player.input.interact && isNear(player, device.anchor));
    if (!candidate) {
      device.holdSeconds = 0;
      return events;
    }
    device.holdSeconds += dt;
    if (device.holdSeconds >= HOLD_SECONDS) {
      device.state = DEVICE_STATE.POWERED;
      device.stateChangedMs = elapsedMs;
      if (device.type === 'wind-shutter') device.closeAtMs = elapsedMs + SHUTTER_FIRST_CLOSE_MS;
      device.anchorPlayerId = candidate.id;
      candidate.anchored = true;
      candidate.x = device.anchor.x;
      candidate.y = device.anchor.y;
      events.push({ kind: 'DEVICE_POWERED', payload: { deviceId: device.id, playerId: candidate.id } });
    }
    return events;
  }
  const anchorPlayer = players.find((player) => player.id === device.anchorPlayerId);
  if (!anchorPlayer || !anchorPlayer.input.interact) {
    device.releaseSeconds += dt;
    if (device.releaseSeconds <= dt) events.push({ kind: 'DEVICE_WARNING', payload: { deviceId: device.id } });
    if (device.releaseSeconds < RELEASE_WARNING_SECONDS) return events;
    if (anchorPlayer) anchorPlayer.anchored = false;
    Object.assign(device, { state: DEVICE_STATE.IDLE, anchorPlayerId: null, holdSeconds: 0, releaseSeconds: 0, stateChangedMs: elapsedMs, closeAtMs: null });
    events.push({ kind: 'DEVICE_RELEASED', payload: { deviceId: device.id } });
    return events;
  }
  device.releaseSeconds = 0;
  // 폐쇄 240ms와 재개방 240ms가 끝난 뒤 다음 서버 권위 폐쇄 시각을 예약한다.
  if (device.type === 'wind-shutter' && device.closeAtMs !== null) {
    while (elapsedMs >= device.closeAtMs + SHUTTER_TRANSITION_MS * 2) device.closeAtMs += device.shutterCycleMs;
  }
  anchorPlayer.x = device.anchor.x;
  anchorPlayer.y = device.anchor.y;
  const partner = players.find((player) => player.id !== anchorPlayer.id);
  if (partner && partner.input.interact && isNear(partner, device.switch)) {
    if (device.type === 'rotary' && device.warning) return events;
    if (device.type === 'docking-lock' && (Math.abs(partner.vx - anchorPlayer.vx) > (device.mechanics?.maxRelativeSpeed ?? 45) || Math.abs(partner.y - anchorPlayer.y) > (device.mechanics?.maxHeightDelta ?? 12))) return events;
    if (device.type === 'safe-ground' && !device.shelterSafe.every(Boolean)) return events;
    device.state = DEVICE_STATE.LATCHED;
    device.stateChangedMs = elapsedMs;
    anchorPlayer.anchored = false;
    events.push({ kind: 'DEVICE_LATCHED', payload: { deviceId: device.id, playerId: partner.id } });
  }
  return events;
}
