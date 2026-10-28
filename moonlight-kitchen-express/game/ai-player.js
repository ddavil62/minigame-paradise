/** @fileoverview 서버 권위 상태를 읽고 사람과 동일한 INPUT만 생성하는 협력 AI 작업자다. */
import { ITEM_LOCATION, PLAYER_COLLIDER, PROCESS, RECIPES, STATIONS, STOPS, WALLS } from '../shared/game-data.js';
import { applyInput } from './simulation.js';

const GRID = 32;
// 서버의 64px 범위보다 훨씬 가까이 붙어 인접 설비를 잘못 집는 일을 막는다.
const INTERACTION_RANGE = 40;
const NAV_GOAL_RANGE = 80;
const COOKER_TYPES = new Set(['brazier', 'steamer', 'pot']);
const PREP_TYPES = new Set(['board', 'dough']);
const DELIVERY_BUFFER_MS = 3500;
const BASE_TRAVEL_ESTIMATE_MS = 18000;
const AI_LABELS = Object.freeze({ mushroom_skewer: '달버섯 꼬치', lantern_dumpling: '등불잎 만두', comet_noodle: '혜성무 국수', moon_mushroom: '달버섯', sunset_pepper: '노을고추', silver_dough: '은빛 반죽', lantern_leaf: '등불잎', comet_radish: '혜성무', star_noodle: '별국수' });

/** AI 제어 상태를 생성하거나 반환한다. @param {object} simulation @param {string} playerId @returns {object} */
export function ensureAiPlayer(simulation, playerId) {
  simulation.aiPlayers ??= {};
  simulation.aiPlayers[playerId] ??= { playerId, seq: 0, orderId: null, recipeId: null, deliveryStationIndex: null, deliveryOpenMs: null, deliveryCloseMs: null, estimatedReadyMs: null, goal: '대기', targetId: null, action: 'wait', path: [], pathIndex: 0, plannedAtTick: -999, lastX: null, lastY: null, stuckTicks: 0 };
  return simulation.aiPlayers[playerId];
}

/** 활성 AI마다 서로 다른, 아직 완수 가능한 주문을 예약한다. @param {object} simulation @returns {void} */
export function assignAiOrders(simulation) {
  const agents = Object.values(simulation.aiPlayers ?? {}).sort((a, b) => a.playerId.localeCompare(b.playerId));
  const activeOrders = simulation.orderState.orders.filter((order) => order.status === 'ACTIVE');
  const reserved = new Set();
  for (const ai of agents) {
    const existing = activeOrders.find((order) => order.id === ai.orderId);
    if (existing && orderCanStillBeDelivered(simulation, existing, true)) reserved.add(existing.id);
    else clearAssignment(ai);
  }
  for (const ai of agents) {
    if (ai.orderId) { updateAssignmentDetails(simulation, ai); continue; }
    const candidates = activeOrders
      .filter((order) => !reserved.has(order.id) && orderCanStillBeDelivered(simulation, order, false))
      .sort((a, b) => a.dueAtMs - b.dueAtMs || a.id.localeCompare(b.id));
    const order = candidates[0];
    if (!order) continue;
    ai.orderId = order.id; reserved.add(order.id); updateAssignmentDetails(simulation, ai);
  }
}

/** 한 틱의 AI 의사결정과 입력 생성을 수행한다. @param {object} simulation @param {string} playerId @returns {object|null} */
export function stepAiPlayer(simulation, playerId) {
  if (simulation.phase !== 'playing') return null;
  const player = simulation.players.find((entry) => entry.id === playerId);
  if (!player) return null;
  const ai = ensureAiPlayer(simulation, playerId);
  assignAiOrders(simulation);
  const objective = chooseObjective(simulation, player, ai);
  const goalChanged = ai.targetId !== objective.target?.id || ai.action !== objective.action;
  const moved = ai.lastX === null || Math.hypot(player.x - ai.lastX, player.y - ai.lastY) > 1;
  ai.stuckTicks = moved ? 0 : ai.stuckTicks + 1; ai.lastX = player.x; ai.lastY = player.y;
  ai.goal = objective.label; ai.targetId = objective.target?.id ?? null; ai.action = objective.action; ai.updatedAtTick = simulation.tick;
  let input = neutralInput(ai.seq++);
  if (!objective.target) return applyAndReturn(simulation, playerId, input, ai, objective);
  const distance = distanceToBox(player.x, player.y, objective.target);
  if (distance <= INTERACTION_RANGE && targetIsNearest(player, objective.target)) {
    ai.path = []; ai.pathIndex = 0;
    if (objective.action === 'interact') input.interact = !player.input.interact;
    if (objective.action === 'work') input.work = true;
    return applyAndReturn(simulation, playerId, input, ai, objective);
  }
  if (goalChanged || !ai.path.length || ai.pathIndex >= ai.path.length || simulation.tick - ai.plannedAtTick >= 45 || ai.stuckTicks >= 20) {
    ai.path = findPath(player, objective.target); ai.pathIndex = 0; ai.plannedAtTick = simulation.tick; ai.stuckTicks = 0;
  }
  while (ai.pathIndex < ai.path.length && Math.hypot(ai.path[ai.pathIndex].x - player.x, ai.path[ai.pathIndex].y - player.y) < 10) ai.pathIndex += 1;
  const waypoint = ai.path[ai.pathIndex] ?? interactionPoint(objective.target, player);
  const dx = waypoint.x - player.x; const dy = waypoint.y - player.y;
  if (Math.abs(dx) > 3) input[dx > 0 ? 'right' : 'left'] = true;
  if (Math.abs(dy) > 3) input[dy > 0 ? 'down' : 'up'] = true;
  return applyAndReturn(simulation, playerId, input, ai, objective);
}

function applyAndReturn(simulation, playerId, input, ai, objective) { applyInput(simulation, playerId, input, ++simulation.receiveOrdinal); return { input, goal: ai.goal, targetId: ai.targetId, action: objective.action }; }
function neutralInput(seq) { return { type: 'INPUT', seq, up: false, down: false, left: false, right: false, interact: false, work: false, drop: false }; }

function chooseObjective(simulation, player, ai) {
  const held = simulation.items.find((item) => item.id === player.heldItemId);
  const order = simulation.orderState.orders.find((entry) => entry.id === ai.orderId && entry.status === 'ACTIVE') ?? null;
  const recipe = order ? RECIPES[order.recipeId] : null;
  if (simulation.train.heat >= 85) { const type = player.id === 'p1' ? 'cooling_pump' : 'exhaust_valve'; return objective(simulation, type, 'work', type === 'cooling_pump' ? '냉각 펌프 작동' : '배기 밸브 작동'); }
  if (held) return objectiveForHeld(simulation, held, order, ai);
  const burntCooker = simulation.stations.find((station) => COOKER_TYPES.has(station.type) && station.state === 'BURNT');
  if (burntCooker) return { target: burntCooker, action: 'interact', label: '탄 음식 회수' };
  const readyCooker = simulation.stations.find((station) => COOKER_TYPES.has(station.type) && station.state === 'READY' && (!recipe || station.recipeId === recipe.id));
  if (readyCooker) return objective(simulation, 'plate_shelf', 'interact', '빈 접시 가져오기');
  if (!order || !recipe) return { target: null, action: 'wait', label: '완수 가능한 주문 대기' };
  const cooking = simulation.stations.find((station) => station.type === recipe.cookStation && station.recipeId === recipe.id && station.state === 'ACTIVE');
  if (cooking) return objective(simulation, 'plate_shelf', 'interact', `${order.id} 플레이팅 준비`);
  const prepWork = simulation.stations.find((station) => PREP_TYPES.has(station.type) && station.contents.length && itemBelongsToRecipe(simulation, station.contents[0], recipe) && simulation.items.find((item) => item.id === station.contents[0])?.process === PROCESS.PREPPING);
  if (prepWork) return { target: prepWork, action: 'work', label: '재료 손질' };
  const prepReady = simulation.stations.find((station) => PREP_TYPES.has(station.type) && station.contents.length && itemBelongsToRecipe(simulation, station.contents[0], recipe) && simulation.items.find((item) => item.id === station.contents[0])?.process === PROCESS.PREPPED);
  if (prepReady) return { target: prepReady, action: 'interact', label: '손질 재료 회수' };
  const cooker = simulation.stations.find((station) => station.type === recipe.cookStation);
  if (!cooker || !['IDLE', 'OCCUPIED'].includes(cooker.state)) return { target: null, action: 'wait', label: `${order.id} 조리 대기` };
  const accounted = new Set(cooker.contents.map((id) => simulation.items.find((item) => item.id === id)?.kind));
  for (const station of simulation.stations.filter((entry) => PREP_TYPES.has(entry.type))) for (const id of station.contents) { const item = simulation.items.find((entry) => entry.id === id); if (recipe.ingredients.includes(item?.kind)) accounted.add(item.kind); }
  for (const item of simulation.items) if (item.location === ITEM_LOCATION.HELD && recipe.ingredients.includes(item.kind)) accounted.add(item.kind);
  const missing = recipe.ingredients.find((kind) => !accounted.has(kind));
  if (missing) return objective(simulation, missing === 'star_noodle' ? 'noodle_supply' : `crate_${missing}`, 'interact', `${AI_LABELS[missing] ?? missing} 가져오기 · ${order.id}`);
  return { target: null, action: 'wait', label: `${order.id} 동료 작업 대기` };
}

function objectiveForHeld(simulation, held, order, ai) {
  if (held.process === PROCESS.BURNT || held.kind === 'burnt_food') return objective(simulation, 'trash', 'interact', '탄 음식 버리기');
  if (RECIPES[held.kind] && held.process === PROCESS.COOKED) {
    const delivery = matchingDeliveryOrder(simulation, held.kind, order);
    if (!delivery) return objective(simulation, 'trash', 'interact', '마감된 음식 폐기');
    if (ai.orderId !== delivery.id) { ai.orderId = delivery.id; updateAssignmentDetails(simulation, ai); }
    const isOpen = simulation.train.stopIndex === delivery.stationIndex;
    const seconds = Math.max(0, Math.ceil((STOPS.find((stop) => stop.index === delivery.stationIndex).openMs - simulation.elapsedMs) / 1000));
    return objective(simulation, 'service', isOpen ? 'interact' : 'wait', isOpen ? `${delivery.id} 완성 음식 배식` : `${delivery.stationIndex}번 역 정차 ${seconds}초 대기`);
  }
  const focusedRecipe = order ? RECIPES[order.recipeId] : null;
  if (held.kind === 'plate') {
    if (!focusedRecipe) return objective(simulation, 'trash', 'interact', '남은 접시 정리');
    const cooker = simulation.stations.find((station) => station.type === focusedRecipe.cookStation && station.recipeId === focusedRecipe.id && ['ACTIVE', 'READY'].includes(station.state));
    if (!cooker) return objective(simulation, 'trash', 'interact', '불필요한 접시 정리');
    return { target: cooker, action: cooker.state === 'READY' ? 'interact' : 'wait', label: cooker.state === 'READY' ? '완성 음식 담기' : '조리기 앞 플레이팅 대기' };
  }
  const recipe = focusedRecipe?.ingredients.includes(held.kind) ? focusedRecipe : null;
  if (!recipe) return objective(simulation, 'trash', 'interact', '불필요한 물건 버리기');
  if (held.process === PROCESS.PREPPED) return objective(simulation, recipe.cookStation, 'interact', `${AI_LABELS[recipe.id] ?? recipe.id} 조리 재료 넣기`);
  const prepType = recipe.prepStationByKind?.[held.kind] ?? recipe.prepStation;
  if (!prepType) return objective(simulation, recipe.cookStation, 'interact', '손질 완료 재료 넣기');
  const station = nearestAvailableStation(simulation, prepType, held);
  return station ? { target: station, action: 'interact', label: `${AI_LABELS[held.kind] ?? held.kind} 손질대에 놓기` } : { target: null, action: 'wait', label: '손질대 대기' };
}

function itemBelongsToRecipe(simulation, itemId, recipe) { const item = simulation.items.find((entry) => entry.id === itemId); return Boolean(item && recipe.ingredients.includes(item.kind)); }

function matchingDeliveryOrder(simulation, recipeId, preferred) {
  if (preferred?.recipeId === recipeId && orderCanStillBeDelivered(simulation, preferred, true)) return preferred;
  return simulation.orderState.orders.filter((order) => order.status === 'ACTIVE' && order.recipeId === recipeId && orderCanStillBeDelivered(simulation, order, true)).sort((a, b) => a.dueAtMs - b.dueAtMs)[0] ?? null;
}

function orderCanStillBeDelivered(simulation, order, alreadyAssigned) {
  const stop = STOPS.find((entry) => entry.index === order.stationIndex);
  if (!stop) return false;
  const deadline = Math.min(order.dueAtMs, stop.closeMs);
  if (simulation.elapsedMs >= deadline) return false;
  if (alreadyAssigned) return true;
  return simulation.elapsedMs + estimateOrderReadyMs(simulation, order.recipeId) + DELIVERY_BUFFER_MS < deadline;
}

function estimateOrderReadyMs(simulation, recipeId) {
  const recipe = RECIPES[recipeId];
  const heldDish = simulation.items.some((item) => item.kind === recipeId && item.process === PROCESS.COOKED && item.location === ITEM_LOCATION.HELD);
  if (heldDish) return 1500;
  const cooker = simulation.stations.find((station) => station.type === recipe.cookStation);
  if (cooker?.recipeId === recipeId) {
    if (cooker.state === 'READY') return 2500;
    if (cooker.state === 'ACTIVE') return Math.max(0, recipe.cookMs - cooker.progressMs) + 3500;
  }
  let prepMs = 0;
  for (const kind of recipe.ingredients) {
    const existing = simulation.items.find((item) => item.kind === kind && [ITEM_LOCATION.HELD, ITEM_LOCATION.STATION].includes(item.location));
    if (!existing || existing.process === PROCESS.RAW || existing.process === PROCESS.PREPPING) prepMs += recipe.prepMs[kind] ?? 0;
  }
  return BASE_TRAVEL_ESTIMATE_MS + prepMs + recipe.cookMs;
}

function updateAssignmentDetails(simulation, ai) {
  const order = simulation.orderState.orders.find((entry) => entry.id === ai.orderId);
  const stop = order && STOPS.find((entry) => entry.index === order.stationIndex);
  if (!order || !stop) { clearAssignment(ai); return; }
  ai.recipeId = order.recipeId; ai.deliveryStationIndex = order.stationIndex; ai.deliveryOpenMs = stop.openMs; ai.deliveryCloseMs = Math.min(stop.closeMs, order.dueAtMs); ai.estimatedReadyMs = estimateOrderReadyMs(simulation, order.recipeId);
}

function clearAssignment(ai) { ai.orderId = null; ai.recipeId = null; ai.deliveryStationIndex = null; ai.deliveryOpenMs = null; ai.deliveryCloseMs = null; ai.estimatedReadyMs = null; }

function nearestAvailableStation(simulation, type, held) { return simulation.stations.filter((station) => station.type === type && !station.contents.length).sort((a, b) => Math.hypot(a.x - held.x, a.y - held.y) - Math.hypot(b.x - held.x, b.y - held.y))[0] ?? null; }
function objective(simulation, idOrType, action, label) { const target = simulation.stations.find((station) => station.id === idOrType || station.type === idOrType); return { target: target ?? null, action, label }; }

function findPath(player, target) {
  const nodes = gridNodes(); const start = nearestNode(nodes, player.x, player.y); const goals = nodes.filter((node) => distanceToBox(node.x, node.y, target) <= NAV_GOAL_RANGE);
  if (!start || !goals.length) return [];
  const goalKeys = new Set(goals.map(key)); const open = [{ node: start, score: 0 }]; const came = new Map(); const cost = new Map([[key(start), 0]]); let found = null;
  while (open.length) {
    open.sort((a, b) => a.score - b.score); const current = open.shift().node; const currentKey = key(current);
    if (goalKeys.has(currentKey)) { found = current; break; }
    for (const next of neighbors(current)) { const nextKey = key(next); const nextCost = cost.get(currentKey) + 1; if (nextCost >= (cost.get(nextKey) ?? Infinity)) continue; cost.set(nextKey, nextCost); came.set(nextKey, current); const heuristic = Math.min(...goals.map((goal) => Math.abs(goal.x - next.x) + Math.abs(goal.y - next.y))) / GRID; open.push({ node: next, score: nextCost + heuristic }); }
  }
  if (!found) return [];
  const path = []; let cursor = found; while (key(cursor) !== key(start)) { path.push(cursor); cursor = came.get(key(cursor)); if (!cursor) break; } return path.reverse();
}

let cachedNodes = null; let cachedLookup = null;
function gridNodes() { if (cachedNodes) return cachedNodes; cachedNodes = []; for (let y = 144; y <= 624; y += GRID) for (let x = 56; x <= 1224; x += GRID) if (walkable(x, y)) cachedNodes.push({ x, y }); cachedLookup = new Map(cachedNodes.map((entry) => [key(entry), entry])); return cachedNodes; }
function neighbors(node) { return [[GRID, 0], [-GRID, 0], [0, GRID], [0, -GRID]].map(([dx, dy]) => cachedLookup.get(`${node.x + dx}:${node.y + dy}`)).filter(Boolean); }
function nearestNode(nodes, x, y) { return [...nodes].sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0] ?? null; }
function interactionPoint(target, player) { const offset = 20; const candidates = [{ x: target.x - offset, y: target.y + target.h / 2 }, { x: target.x + target.w + offset, y: target.y + target.h / 2 }, { x: target.x + target.w / 2, y: target.y - offset }, { x: target.x + target.w / 2, y: target.y + target.h + offset }].filter((point) => walkable(point.x, point.y) && targetIsNearest(point, target)); return candidates.sort((a, b) => Math.hypot(a.x - player.x, a.y - player.y) - Math.hypot(b.x - player.x, b.y - player.y))[0] ?? { x: player.x, y: player.y }; }
function walkable(x, y) { const margin = 3; const box = { x: x - PLAYER_COLLIDER.w / 2 - margin, y: y - PLAYER_COLLIDER.h / 2 - margin, w: PLAYER_COLLIDER.w + margin * 2, h: PLAYER_COLLIDER.h + margin * 2 }; return !WALLS.some((wall) => box.x < wall.x + wall.w && box.x + box.w > wall.x && box.y < wall.y + wall.h && box.y + box.h > wall.y); }
function distanceToBox(x, y, box) { const dx = Math.max(box.x - x, 0, x - (box.x + box.w)); const dy = Math.max(box.y - y, 0, y - (box.y + box.h)); return Math.hypot(dx, dy); }
function targetIsNearest(point, target) { const wanted = distanceToBox(point.x, point.y, target); return STATIONS.every((station) => station.id === target.id || wanted + 1 < distanceToBox(point.x, point.y, station)); }
function key(node) { return `${node.x}:${node.y}`; }
