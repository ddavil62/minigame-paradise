/** @fileoverview 서버 권위 집기·설비 투입·가공·조리·플레이팅·서빙 상호작용을 처리한다. */
import { ITEM_LOCATION, PROCESS, RECIPES, STATION_STATE } from '../shared/game-data.js';
import { serveDish } from './orders.js';

/**
 * 같은 틱의 상호작용을 수신 순서와 역할 순서로 결정해 처리한다.
 * @param {object} simulation 시뮬레이션
 * @returns {void}
 */
export function resolvePendingInteractions(simulation) {
  const claims = new Set();
  simulation.pendingInteractions.sort((a, b) => a.ordinal - b.ordinal || a.playerId.localeCompare(b.playerId));
  for (const request of simulation.pendingInteractions) {
    const player = simulation.players.find((entry) => entry.id === request.playerId);
    const target = findInteractionTarget(simulation, player);
    if (!target) continue;
    if (claims.has(target.id)) { simulation.directMessages.push({ playerId: player.id, message: { type: 'BUSY', targetId: target.id, reason: 'CLAIMED' } }); continue; }
    claims.add(target.id); interactWithTarget(simulation, player, target);
  }
  simulation.pendingInteractions.length = 0;
}

/**
 * 플레이어 전방 64px 안 후보를 거리와 안정 ID 순으로 선택한다.
 * @param {object} simulation 시뮬레이션
 * @param {object} player 플레이어
 * @returns {object|null} 아이템 또는 설비
 */
export function findInteractionTarget(simulation, player) {
  const candidates = [];
  for (const item of simulation.items) if (item.location === ITEM_LOCATION.FLOOR) { const distance = Math.hypot(item.x - player.x, item.y - player.y); if (distance <= 64) candidates.push({ ...item, targetKind: 'item', distance }); }
  for (const station of simulation.stations) { const distance = distanceToBox(player.x, player.y, station); if (distance <= 64) candidates.push({ ...station, targetKind: 'station', distance }); }
  candidates.sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id));
  return candidates[0] ?? null;
}

/** @param {object} simulation 시뮬레이션 @param {object} player 플레이어 @param {object} target 대상 @returns {void} */
function interactWithTarget(simulation, player, target) {
  if (target.targetKind === 'item') { if (!player.heldItemId) pickFloorItem(simulation, player, target.id); return; }
  const station = simulation.stations.find((entry) => entry.id === target.id);
  if (['crate', 'noodle_supply'].includes(station.type) && !player.heldItemId) { const item = createItem(simulation, station.kind, station.kind === 'star_noodle' ? PROCESS.PREPPED : PROCESS.RAW, ITEM_LOCATION.HELD); assignHeld(item, player); player.contributions.carried += 1; return; }
  if (station.type === 'plate_shelf' && !player.heldItemId) { const item = createItem(simulation, 'plate', PROCESS.RAW, ITEM_LOCATION.HELD); assignHeld(item, player); return; }
  if (station.type === 'trash' && player.heldItemId) { trashHeld(simulation, player); return; }
  if (station.type === 'service' && player.heldItemId) { serveHeld(simulation, player); return; }
  if (['board', 'dough'].includes(station.type)) { handlePrepStation(simulation, player, station); return; }
  if (['brazier', 'steamer', 'pot'].includes(station.type)) handleCookStation(simulation, player, station);
}

/**
 * 누르고 있는 작업 입력으로 준비 공정을 진행한다.
 * @param {object} simulation 시뮬레이션
 * @param {number} dtMs 스텝 밀리초
 * @returns {void}
 */
export function stepWorkAndStations(simulation, dtMs) {
  for (const station of simulation.stations) {
    if (['board', 'dough'].includes(station.type) && station.contents.length) {
      const item = simulation.items.find((entry) => entry.id === station.contents[0]);
      const operator = simulation.players.find((player) => player.work && distanceToBox(player.x, player.y, station) <= 64);
      if (operator && item?.process === PROCESS.PREPPING) {
        station.operatorId = operator.id; station.state = STATION_STATE.ACTIVE; station.progressMs += dtMs;
        const required = prepDuration(item.kind);
        if (station.progressMs >= required) { item.process = PROCESS.PREPPED; item.revision += 1; station.state = STATION_STATE.READY; operator.contributions.prepped += 1; simulation.events.push({ kind: 'PREP_READY', payload: { stationId: station.id } }); }
      } else if (station.state === STATION_STATE.ACTIVE) { station.state = STATION_STATE.OCCUPIED; station.operatorId = null; }
    }
    if (['brazier', 'steamer', 'pot'].includes(station.type) && station.state === STATION_STATE.ACTIVE) {
      const recipe = RECIPES[station.recipeId];
      const heatScale = simulation.train.heat >= 85 ? 0.8 : 1;
      station.progressMs += dtMs * heatScale;
      if (station.progressMs >= recipe.cookMs) { station.state = STATION_STATE.READY; station.readyMs = 0; station.contents.forEach((id) => { const item = simulation.items.find((entry) => entry.id === id); item.process = PROCESS.COOKED; item.revision += 1; }); simulation.events.push({ kind: 'COOK_READY', payload: { stationId: station.id } }); }
    } else if (['brazier', 'steamer', 'pot'].includes(station.type) && station.state === STATION_STATE.READY) {
      station.readyMs += dtMs;
      if (station.readyMs >= RECIPES[station.recipeId].burnMs) { station.state = STATION_STATE.BURNT; station.contents.forEach((id) => { const item = simulation.items.find((entry) => entry.id === id); item.process = PROCESS.BURNT; item.revision += 1; }); simulation.events.push({ kind: 'FOOD_BURNT', payload: { stationId: station.id } }); }
    }
  }
}

/** @param {object} simulation 시뮬레이션 @param {object} player 플레이어 @param {object} station 준비 설비 @returns {void} */
function handlePrepStation(simulation, player, station) {
  if (!station.contents.length && player.heldItemId) {
    const item = heldItem(simulation, player); const expected = prepStationFor(item.kind);
    if (expected !== station.type) return;
    releaseToStation(item, player, station); item.process = PROCESS.PREPPING; station.state = STATION_STATE.OCCUPIED; return;
  }
  if (station.contents.length && !player.heldItemId && [STATION_STATE.READY, STATION_STATE.OCCUPIED].includes(station.state)) takeStationItem(simulation, player, station);
}

/** @param {object} simulation 시뮬레이션 @param {object} player 플레이어 @param {object} station 조리 설비 @returns {void} */
function handleCookStation(simulation, player, station) {
  if (station.state === STATION_STATE.READY && player.heldItemId && heldItem(simulation, player)?.kind === 'plate') { plateCookedDish(simulation, player, station); return; }
  if (station.state === STATION_STATE.BURNT && !player.heldItemId) { const item = createItem(simulation, 'burnt_food', PROCESS.BURNT, ITEM_LOCATION.HELD); assignHeld(item, player); clearStation(simulation, station); return; }
  if (!player.heldItemId || ![STATION_STATE.IDLE, STATION_STATE.OCCUPIED].includes(station.state)) return;
  const item = heldItem(simulation, player);
  if (item.process !== PROCESS.PREPPED) return;
  const possible = Object.values(RECIPES).filter((recipe) => recipe.cookStation === station.type && recipe.ingredients.includes(item.kind));
  if (!possible.length) return;
  releaseToStation(item, player, station); station.state = STATION_STATE.OCCUPIED;
  const kinds = station.contents.map((id) => simulation.items.find((entry) => entry.id === id).kind).sort();
  const recipe = possible.find((entry) => [...entry.ingredients].sort().join('|') === kinds.join('|'));
  if (recipe) { station.recipeId = recipe.id; station.state = STATION_STATE.ACTIVE; station.progressMs = 0; player.contributions.cooked += 1; }
}

/** @param {object} simulation 시뮬레이션 @param {object} player 플레이어 @param {object} station 조리 설비 @returns {void} */
function plateCookedDish(simulation, player, station) { const plate = heldItem(simulation, player); plate.kind = station.recipeId; plate.process = PROCESS.COOKED; plate.location = ITEM_LOCATION.HELD; plate.revision += 1; clearStation(simulation, station); }

/** @param {object} simulation 시뮬레이션 @param {object} station 설비 @returns {void} */
function clearStation(simulation, station) { for (const id of station.contents) { const item = simulation.items.find((entry) => entry.id === id); item.location = ITEM_LOCATION.TRASHED; item.stationId = null; item.revision += 1; } station.contents = []; station.state = STATION_STATE.IDLE; station.progressMs = 0; station.readyMs = 0; station.recipeId = null; station.revision += 1; }

/** @param {object} simulation 시뮬레이션 @param {object} player 플레이어 @returns {void} */
function serveHeld(simulation, player) { const item = heldItem(simulation, player); if (!item || item.process !== PROCESS.COOKED || !RECIPES[item.kind]) return; const result = serveDish(simulation, item.kind, player.id); if (result.ok) { item.location = ITEM_LOCATION.TRASHED; item.holderId = null; player.heldItemId = null; item.revision += 1; } }

/** @param {object} simulation 시뮬레이션 @param {object} player 플레이어 @returns {void} */
export function dropHeld(simulation, player) { const item = heldItem(simulation, player); if (!item) return; item.location = ITEM_LOCATION.FLOOR; item.holderId = null; item.x = Math.max(40, Math.min(1240, player.x + player.facingX * 40)); item.y = Math.max(144, Math.min(600, player.y + player.facingY * 40)); item.revision += 1; player.heldItemId = null; }

/** @param {object} simulation 시뮬레이션 @param {object} player 플레이어 @param {string} itemId 아이템 ID @returns {void} */
function pickFloorItem(simulation, player, itemId) { const item = simulation.items.find((entry) => entry.id === itemId && entry.location === ITEM_LOCATION.FLOOR); if (item) assignHeld(item, player); }

/** @param {object} simulation 시뮬레이션 @param {object} player 플레이어 @returns {void} */
function trashHeld(simulation, player) { const item = heldItem(simulation, player); item.location = ITEM_LOCATION.TRASHED; item.holderId = null; item.revision += 1; player.heldItemId = null; }

/** @param {object} simulation 시뮬레이션 @param {object} player 플레이어 @param {object} station 설비 @returns {void} */
function takeStationItem(simulation, player, station) { const item = simulation.items.find((entry) => entry.id === station.contents.shift()); assignHeld(item, player); station.state = STATION_STATE.IDLE; station.progressMs = 0; station.operatorId = null; station.revision += 1; }

/** @param {object} item 아이템 @param {object} player 플레이어 @param {object} station 설비 @returns {void} */
function releaseToStation(item, player, station) { item.location = ITEM_LOCATION.STATION; item.holderId = null; item.stationId = station.id; item.revision += 1; station.contents.push(item.id); station.revision += 1; player.heldItemId = null; }

/** @param {object} item 아이템 @param {object} player 플레이어 @returns {void} */
function assignHeld(item, player) { item.location = ITEM_LOCATION.HELD; item.holderId = player.id; item.stationId = null; item.revision += 1; player.heldItemId = item.id; }

/** @param {object} simulation 시뮬레이션 @param {object} player 플레이어 @returns {object|null} */
function heldItem(simulation, player) { return simulation.items.find((entry) => entry.id === player.heldItemId) ?? null; }

/** @param {object} simulation 시뮬레이션 @param {string} kind 종류 @param {string} process 공정 @param {string} location 위치 @returns {object} */
function createItem(simulation, kind, process, location) { const item = { id: `item_${++simulation.nextItemId}`, kind, process, location, holderId: null, stationId: null, slotId: null, x: 0, y: 0, revision: 0 }; simulation.items.push(item); return item; }

/** @param {string} kind 재료 종류 @returns {string|null} */
function prepStationFor(kind) { for (const recipe of Object.values(RECIPES)) { if (!recipe.ingredients.includes(kind)) continue; return recipe.prepStationByKind?.[kind] ?? recipe.prepStation ?? null; } return null; }

/** @param {string} kind 재료 종류 @returns {number} 준비 시간 */
function prepDuration(kind) { for (const recipe of Object.values(RECIPES)) if (recipe.prepMs[kind] !== undefined) return recipe.prepMs[kind]; return 0; }

/** @param {number} x 점 x @param {number} y 점 y @param {object} box AABB @returns {number} 최단 거리 */
function distanceToBox(x, y, box) { const dx = Math.max(box.x - x, 0, x - (box.x + box.w)); const dy = Math.max(box.y - y, 0, y - (box.y + box.h)); return Math.hypot(dx, dy); }
