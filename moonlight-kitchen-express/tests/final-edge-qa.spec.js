/** @fileoverview 최종 QA에서 공정 거부, 입력 경계, 환경 사고와 결과 산식을 독립 검증한다. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyInput, createSimulation, finishForTesting, stepSimulation } from '../game/simulation.js';
import { serveDish } from '../game/orders.js';
import { CURVES, ORDER_WAVES, PROCESS, RECIPES, STOPS } from '../shared/game-data.js';

/** @param {number} seq 입력 순번 @param {Partial<object>} [extra] 덮어쓸 키 @returns {object} */
function input(seq, extra = {}) { return { seq, up: false, down: false, left: false, right: false, interact: false, work: false, drop: false, ...extra }; }

/** @param {object} simulation 시뮬레이션 @param {object} player 플레이어 @param {string} kind 종류 @param {string} process 공정 @returns {object} */
function give(simulation, player, kind, process) {
  const item = { id: `qa_${simulation.items.length}`, kind, process, location: 'HELD', holderId: player.id, stationId: null, slotId: null, x: player.x, y: player.y, revision: 0 };
  simulation.items.push(item); player.heldItemId = item.id; return item;
}

test('중복·역순 입력은 상태를 되감지 않고 상승 에지 연타도 한 번만 처리한다', () => {
  const simulation = createSimulation(); simulation.phase = 'playing'; const player = simulation.players[0]; player.x = 100; player.y = 250;
  assert.equal(applyInput(simulation, 'p1', input(7, { interact: true })), true);
  assert.equal(applyInput(simulation, 'p1', input(7, { interact: true })), false);
  assert.equal(applyInput(simulation, 'p1', input(6, { interact: true })), false);
  stepSimulation(simulation); assert.equal(simulation.items.length, 1);
  assert.equal(applyInput(simulation, 'p1', input(8, { interact: true })), true);
  stepSimulation(simulation); assert.equal(simulation.items.length, 1);
});

test('RAW 재료를 잘못된 준비·조리 설비에 넣어도 아이템과 설비가 변하지 않는다', () => {
  const simulation = createSimulation(); simulation.phase = 'playing'; const player = simulation.players[0];
  const raw = give(simulation, player, 'silver_dough', PROCESS.RAW); Object.assign(player, { x: 128, y: 344 });
  applyInput(simulation, 'p1', input(1, { interact: true })); stepSimulation(simulation);
  assert.equal(player.heldItemId, raw.id); assert.equal(simulation.stations.find(s => s.id === 'board_a').contents.length, 0);
  Object.assign(player, { x: 800, y: 280 }); applyInput(simulation, 'p1', input(2)); stepSimulation(simulation); applyInput(simulation, 'p1', input(3, { interact: true })); stepSimulation(simulation);
  assert.equal(player.heldItemId, raw.id); assert.equal(simulation.stations.find(s => s.id === 'brazier').contents.length, 0);
});

test('냉각은 한 명이 떼면 즉시 0으로 초기화되고 두 설비 2인 유지에서만 성공한다', () => {
  const simulation = createSimulation(); simulation.phase = 'playing'; simulation.train.heat = 100; simulation.train.overheatStartedAt = 0;
  Object.assign(simulation.players[0], { x: 430, y: 472 }); Object.assign(simulation.players[1], { x: 1080, y: 560 });
  applyInput(simulation, 'p1', input(1, { work: true })); applyInput(simulation, 'p2', input(1, { work: true }));
  for (let i = 0; i < 30; i += 1) stepSimulation(simulation, 1000 / 30);
  assert.ok(simulation.train.coolingProgressMs > 900);
  applyInput(simulation, 'p2', input(2, { work: false })); stepSimulation(simulation, 1000 / 30);
  assert.equal(simulation.train.coolingProgressMs, 0); assert.ok(simulation.train.heat > 98); assert.equal(simulation.events.some(event => event.kind === 'COOLED'), false);
});

test('8초 미냉각 과열 사고는 음식 소각·감점·콤보 초기화를 한 번만 수행한다', () => {
  const simulation = createSimulation(); simulation.phase = 'playing'; simulation.orderState.score = 100; simulation.orderState.comboStep = 4; simulation.train.heat = 100; simulation.train.overheatStartedAt = 0;
  const station = simulation.stations.find(s => s.id === 'brazier'); station.state = 'ACTIVE'; station.recipeId = 'mushroom_skewer';
  const item = { id: 'hot', kind: 'moon_mushroom', process: PROCESS.COOKING, location: 'STATION', holderId: null, stationId: station.id, slotId: null, x: 0, y: 0, revision: 0 }; simulation.items.push(item); station.contents = [item.id];
  simulation.elapsedMs = 7999; stepSimulation(simulation, 2);
  assert.equal(simulation.train.overheatAccidents, 1); assert.equal(simulation.orderState.score, 75); assert.equal(simulation.orderState.comboStep, 0); assert.equal(item.process, PROCESS.BURNT);
  for (let i = 0; i < 100; i += 1) stepSimulation(simulation, 10);
  assert.equal(simulation.train.overheatAccidents, 1);
});

test('전체 9주문·5역·4커브 경계와 만료 시각이 정확하다', () => {
  assert.deepEqual(ORDER_WAVES.map(w => [w.revealMs, w.count]), [[15000,1],[60000,2],[115000,2],[170000,2],[220000,2]]);
  assert.deepEqual(STOPS.map(s => [s.openMs,s.closeMs]), [[50000,68000],[95000,113000],[150000,168000],[205000,223000],[265000,288000]]);
  assert.deepEqual(CURVES.map(c => [c.startMs,c.endMs,c.direction]), [[82000,88000,1],[137000,143000,-1],[192000,198000,1],[247000,253000,-1]]);
  const simulation = createSimulation(11); simulation.phase = 'playing';
  for (const wave of ORDER_WAVES) { simulation.elapsedMs = wave.revealMs - 1; stepSimulation(simulation, 1); }
  assert.equal(simulation.orderState.orders.length, 9);
  for (const order of simulation.orderState.orders) { const wave = ORDER_WAVES.find(w => w.stationIndex === order.stationIndex); const stop = STOPS.find(s => s.index === order.stationIndex); assert.equal(order.dueAtMs, Math.min(wave.revealMs + RECIPES[order.recipeId].limitMs, stop.closeMs)); }
});

test('6연속 성공은 콤보 상한·기여도·최종 성공 결과를 양쪽 동일 데이터로 확정한다', () => {
  const simulation = createSimulation(); simulation.phase = 'playing'; simulation.elapsedMs = 50000;
  for (let i = 0; i < 6; i += 1) { simulation.orderState.orders.push({ id: `score_${i}`, recipeId: 'mushroom_skewer', stationIndex: 1, dueAtMs: 68000, servedAtMs: null, status: 'ACTIVE' }); assert.equal(serveDish(simulation, 'mushroom_skewer', i % 2 ? 'p2' : 'p1').ok, true); }
  assert.equal(simulation.orderState.comboStep, 4); assert.equal(simulation.orderState.maxCombo, 2); assert.equal(simulation.orderState.served, 6); assert.ok(simulation.orderState.score >= 650);
  finishForTesting(simulation); assert.equal(simulation.result.success, true); assert.equal(simulation.result.players.length, 2); assert.deepEqual(simulation.result.players.map(p => p.contributions.served), [3,3]);
});
