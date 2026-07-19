/** @fileoverview 30Hz 서버 권위 월드 상태, 이동 충돌, 입력 시퀀스와 스냅샷을 관리한다. */
import { PLAYER_COLLIDER, PLAYER_SPEED, ROUND_DURATION_MS, STATIONS, STATION_STATE, WALLS } from '../shared/game-data.js';
import { createOrderState, finishRound, stepOrders } from './orders.js';
import { dropHeld, resolvePendingInteractions, stepWorkAndStations } from './interactions.js';
import { stepTrainEvents } from './train-events.js';

/**
 * 새 라운드 시뮬레이션을 만든다.
 * @param {number} [seed] 고정 레시피 시드
 * @returns {object} 시뮬레이션 상태
 */
export function createSimulation(seed = 20260719) {
  return {
    phase: 'waiting', seed, tick: 0, elapsedMs: 0, nextItemId: 0, nextEventId: 0, receiveOrdinal: 0, items: [], events: [], directMessages: [], pendingInteractions: [], result: null,
    players: [createPlayer('p1', 128, 272, 1), createPlayer('p2', 800, 304, -1)],
    stations: STATIONS.map((station) => ({ ...station, state: STATION_STATE.IDLE, contents: [], progressMs: 0, readyMs: 0, operatorId: null, recipeId: null, revision: 0 })),
    orderState: createOrderState(seed), train: { heat: 0, curveDirection: 0, curveWarningDirection: 0, stopIndex: null, stopWarningIndex: null, coolingProgressMs: 0, coolingStartedAt: null, overheatStartedAt: null, overheatRemainingMs: null, accidentGuardUntil: 0, overheatAccidents: 0 }
  };
}

/** @param {string} id 역할 ID @param {number} x 좌표 @param {number} y 좌표 @param {number} facingX 방향 @returns {object} 플레이어 */
function createPlayer(id, x, y, facingX) { return { id, x, y, facingX, facingY: 0, heldItemId: null, ackSeq: -1, work: false, input: emptyInput(), previousInput: emptyInput(), contributions: { carried: 0, prepped: 0, cooked: 0, served: 0 } }; }

/** @returns {object} 빈 입력 */
function emptyInput() { return { up: false, down: false, left: false, right: false, interact: false, work: false, drop: false }; }

/**
 * 단조 증가 입력을 저장하고 상승 에지 작업을 예약한다.
 * @param {object} simulation 시뮬레이션
 * @param {string} playerId 플레이어 ID
 * @param {object} input 검증된 입력
 * @param {number} [ordinal] 서버 수신 순서
 * @returns {boolean} 입력 수락 여부
 */
export function applyInput(simulation, playerId, input, ordinal = ++simulation.receiveOrdinal) {
  const player = simulation.players.find((entry) => entry.id === playerId);
  if (!player || input.seq <= player.ackSeq || simulation.phase !== 'playing') return false;
  player.previousInput = player.input; player.input = { up: input.up, down: input.down, left: input.left, right: input.right, interact: input.interact, work: input.work, drop: input.drop }; player.ackSeq = input.seq; player.work = input.work;
  if (input.interact && !player.previousInput.interact) simulation.pendingInteractions.push({ playerId, ordinal });
  if (input.drop && !player.previousInput.drop) dropHeld(simulation, player);
  return true;
}

/**
 * 권위 시뮬레이션을 한 고정 스텝 진행한다.
 * @param {object} simulation 시뮬레이션
 * @param {number} [dtMs] 스텝 밀리초
 * @returns {void}
 */
export function stepSimulation(simulation, dtMs = 1000 / 30) {
  if (simulation.phase !== 'playing') return;
  simulation.tick += 1; simulation.elapsedMs = Math.min(ROUND_DURATION_MS, simulation.elapsedMs + dtMs);
  for (const player of simulation.players) movePlayer(player, dtMs);
  resolvePendingInteractions(simulation); stepWorkAndStations(simulation, dtMs); stepTrainEvents(simulation, dtMs); stepOrders(simulation);
  for (const item of simulation.items) if (item.location === 'HELD') { const holder = simulation.players.find((player) => player.id === item.holderId); if (holder) { item.x = holder.x + holder.facingX * 24; item.y = holder.y + holder.facingY * 24; } }
}

/** @param {object} player 플레이어 @param {number} dtMs 스텝 밀리초 @returns {void} */
function movePlayer(player, dtMs) {
  let dx = Number(player.input.right) - Number(player.input.left); let dy = Number(player.input.down) - Number(player.input.up);
  const length = Math.hypot(dx, dy); if (!length) return;
  dx /= length; dy /= length; player.facingX = dx; player.facingY = dy;
  const distance = PLAYER_SPEED * dtMs / 1000;
  const nextX = player.x + dx * distance; if (!collides(nextX, player.y)) player.x = nextX;
  const nextY = player.y + dy * distance; if (!collides(player.x, nextY)) player.y = nextY;
}

/** @param {number} x 중심 x @param {number} y 중심 y @returns {boolean} 고정 설비 충돌 여부 */
function collides(x, y) { const box = { x: x - PLAYER_COLLIDER.w / 2, y: y - PLAYER_COLLIDER.h / 2, w: PLAYER_COLLIDER.w, h: PLAYER_COLLIDER.h }; return WALLS.some((wall) => box.x < wall.x + wall.w && box.x + box.w > wall.x && box.y < wall.y + wall.h && box.y + box.h > wall.y); }

/**
 * 네트워크 전송용 완전 권위 상태를 복제한다.
 * @param {object} simulation 시뮬레이션
 * @returns {object} JSON 안전 스냅샷
 */
export function snapshotSimulation(simulation) {
  return { tick: simulation.tick, phase: simulation.phase, elapsedMs: simulation.elapsedMs, players: simulation.players.map(({ input, previousInput, ...player }) => ({ ...player })), items: simulation.items.filter((item) => item.location !== 'TRASHED').map((item) => ({ ...item })), stations: simulation.stations.map((station) => ({ ...station, contents: [...station.contents] })), orders: simulation.orderState.orders.map((order) => ({ ...order })), train: { ...simulation.train }, heat: simulation.train.heat, score: simulation.orderState.score, combo: Math.min(2, 1 + simulation.orderState.comboStep * 0.25), result: simulation.result };
}

/** @param {object} simulation 시뮬레이션 @returns {void} */
export function finishForTesting(simulation) { simulation.elapsedMs = ROUND_DURATION_MS; finishRound(simulation); }
