/** @fileoverview 9건 주문 공개·역 정차·점수·콤보·최종 결과를 서버 권위로 계산한다. */
import { ORDER_WAVES, RECIPES, ROUND_DURATION_MS, STOPS, buildRecipeCatalog } from '../shared/game-data.js';

/**
 * 주문 시스템 초기 상태를 만든다.
 * @param {number} seed 라운드 시드
 * @returns {object} 주문 상태
 */
export function createOrderState(seed) { return { catalog: buildRecipeCatalog(seed), orders: [], revealedWaves: new Set(), score: 0, comboStep: 0, maxCombo: 1, served: 0, expired: 0 }; }

/** @param {number} comboStep 성공 누적 단계 @returns {number} 콤보 배수 */
export function comboMultiplier(comboStep) { return Math.min(2, 1 + comboStep * 0.25); }

/**
 * 경과 시간에 따라 주문을 공개하고 만료한다.
 * @param {object} simulation 시뮬레이션
 * @returns {void}
 */
export function stepOrders(simulation) {
  const orderState = simulation.orderState;
  let catalogIndex = orderState.orders.length;
  ORDER_WAVES.forEach((wave, waveIndex) => {
    if (simulation.elapsedMs < wave.revealMs || orderState.revealedWaves.has(waveIndex)) return;
    orderState.revealedWaves.add(waveIndex);
    const stop = STOPS.find((entry) => entry.index === wave.stationIndex);
    for (let index = 0; index < wave.count; index += 1) {
      const recipeId = orderState.catalog[catalogIndex++];
      const dueAtMs = Math.min(wave.revealMs + RECIPES[recipeId].limitMs, stop.closeMs);
      const order = { id: `order_${catalogIndex}`, recipeId, stationIndex: wave.stationIndex, dueAtMs, servedAtMs: null, status: 'ACTIVE' };
      orderState.orders.push(order); simulation.events.push({ kind: 'ORDER_REVEALED', payload: { orderId: order.id, recipeId } });
    }
  });
  for (const order of orderState.orders) {
    if (order.status === 'ACTIVE' && simulation.elapsedMs >= order.dueAtMs) { order.status = 'EXPIRED'; orderState.expired += 1; orderState.score = Math.max(0, orderState.score - 30); orderState.comboStep = 0; simulation.events.push({ kind: 'ORDER_EXPIRED', payload: { orderId: order.id } }); }
  }
  if (simulation.elapsedMs >= ROUND_DURATION_MS && simulation.phase === 'playing') finishRound(simulation);
}

/** @param {number} elapsedMs 경과 시간 @returns {number|null} 열려 있는 역 번호 */
export function openStationIndex(elapsedMs) { return STOPS.find((stop) => elapsedMs >= stop.openMs && elapsedMs < stop.closeMs)?.index ?? null; }

/**
 * 완성 메뉴를 현재 역 주문에 서빙한다.
 * @param {object} simulation 시뮬레이션
 * @param {string} recipeId 완성 레시피
 * @param {string} playerId 서빙 플레이어
 * @returns {{ok:boolean,reason?:string,points?:number}}
 */
export function serveDish(simulation, recipeId, playerId) {
  const stationIndex = openStationIndex(simulation.elapsedMs);
  const order = simulation.orderState.orders.find((entry) => entry.status === 'ACTIVE' && entry.stationIndex === stationIndex && entry.recipeId === recipeId);
  if (!order) { simulation.orderState.score = Math.max(0, simulation.orderState.score - 15); simulation.orderState.comboStep = 0; return { ok: false, reason: 'WRONG_MENU' }; }
  const secondsLeft = Math.max(0, Math.floor((order.dueAtMs - simulation.elapsedMs) / 1000));
  const multiplier = comboMultiplier(simulation.orderState.comboStep);
  const points = Math.floor((100 + secondsLeft * 2) * multiplier);
  order.status = 'SERVED'; order.servedAtMs = simulation.elapsedMs; simulation.orderState.score += points; simulation.orderState.served += 1; simulation.orderState.comboStep = Math.min(4, simulation.orderState.comboStep + 1); simulation.orderState.maxCombo = Math.max(simulation.orderState.maxCombo, comboMultiplier(simulation.orderState.comboStep));
  simulation.players.find((player) => player.id === playerId).contributions.served += 1;
  simulation.events.push({ kind: 'ORDER_SERVED', payload: { orderId: order.id, points } });
  return { ok: true, points };
}

/**
 * 라운드를 종료하고 양쪽에 동일한 결과를 확정한다.
 * @param {object} simulation 시뮬레이션
 * @returns {void}
 */
export function finishRound(simulation) {
  for (const order of simulation.orderState.orders) if (order.status === 'ACTIVE') { order.status = 'EXPIRED'; simulation.orderState.expired += 1; }
  simulation.phase = 'result';
  simulation.result = { success: simulation.orderState.served >= 6 && simulation.orderState.score >= 650, score: Math.max(0, simulation.orderState.score), served: simulation.orderState.served, expired: simulation.orderState.expired, maxCombo: simulation.orderState.maxCombo, overheatAccidents: simulation.train.overheatAccidents, players: simulation.players.map((player) => ({ id: player.id, contributions: { ...player.contributions } })) };
  simulation.events.push({ kind: 'GAME_OVER', payload: simulation.result });
}
