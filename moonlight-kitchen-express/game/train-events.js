/** @fileoverview 커브 밀림, 공유 열도, 2인 동시 냉각과 과열 사고를 처리한다. */
import { CURVES, ITEM_LOCATION, PROCESS, STOPS } from '../shared/game-data.js';

/** @param {number} elapsedMs 경과 시간 @returns {{startMs:number,endMs:number,direction:number}|null} 활성 커브 */
export function activeCurve(elapsedMs) { return CURVES.find((curve) => elapsedMs >= curve.startMs && elapsedMs < curve.endMs) ?? null; }

/**
 * 열차 환경을 한 고정 스텝 진행한다.
 * @param {object} simulation 시뮬레이션
 * @param {number} dtMs 스텝 밀리초
 * @returns {void}
 */
export function stepTrainEvents(simulation, dtMs) {
  const dt = dtMs / 1000;
  const curve = activeCurve(simulation.elapsedMs);
  simulation.train.curveDirection = curve?.direction ?? 0;
  simulation.train.curveWarningDirection = curve ? 0 : (CURVES.find((entry) => simulation.elapsedMs >= entry.startMs - 5000 && simulation.elapsedMs < entry.startMs)?.direction ?? 0);
  simulation.train.stopIndex = STOPS.find((stop) => simulation.elapsedMs >= stop.openMs && simulation.elapsedMs < stop.closeMs)?.index ?? null;
  simulation.train.stopWarningIndex = simulation.train.stopIndex ? null : (STOPS.find((stop) => simulation.elapsedMs >= stop.openMs - 5000 && simulation.elapsedMs < stop.openMs)?.index ?? null);
  if (curve) {
    for (const player of simulation.players) player.x = clamp(player.x + curve.direction * 55 * dt, 48, 1232);
    for (const item of simulation.items) if (item.location === ITEM_LOCATION.FLOOR) { item.x = clamp(item.x + curve.direction * 90 * dt, 40, 1240); item.revision += 1; }
  }
  const activeCookers = simulation.stations.filter((station) => ['brazier', 'steamer', 'pot'].includes(station.type) && station.state === 'ACTIVE');
  const heatGain = activeCookers.reduce((sum, station) => sum + ({ brazier: 3, steamer: 2, pot: 2 }[station.type] ?? 0), 0);
  simulation.train.heat = clamp(simulation.train.heat + (heatGain || -1.5) * dt, 0, 100);
  if (simulation.train.heat >= 100 && simulation.train.overheatStartedAt === null) simulation.train.overheatStartedAt = simulation.elapsedMs;
  const pump = simulation.players.find((player) => player.work && nearType(simulation, player, 'cooling_pump'));
  const valve = simulation.players.find((player) => player.work && nearType(simulation, player, 'exhaust_valve'));
  if (pump && valve && pump.id !== valve.id) {
    if (simulation.train.coolingStartedAt === null) simulation.train.coolingStartedAt = simulation.elapsedMs;
    simulation.train.coolingProgressMs += dtMs;
    if (simulation.train.coolingProgressMs >= 2000) { simulation.train.heat = 40; simulation.train.coolingProgressMs = 0; simulation.train.coolingStartedAt = null; simulation.train.overheatStartedAt = null; simulation.train.accidentGuardUntil = simulation.elapsedMs + 1500; simulation.events.push({ kind: 'COOLED', payload: {} }); }
  } else { simulation.train.coolingProgressMs = 0; simulation.train.coolingStartedAt = null; }
  if (simulation.train.overheatStartedAt !== null && simulation.elapsedMs - simulation.train.overheatStartedAt >= 8000 && simulation.elapsedMs >= simulation.train.accidentGuardUntil) triggerOverheatAccident(simulation);
  simulation.train.overheatRemainingMs = simulation.train.overheatStartedAt === null ? null : Math.max(0, 8000 - (simulation.elapsedMs - simulation.train.overheatStartedAt));
}

/** @param {object} simulation 시뮬레이션 @param {object} player 플레이어 @param {string} type 설비 유형 @returns {boolean} 근접 여부 */
function nearType(simulation, player, type) { const station = simulation.stations.find((entry) => entry.type === type); return station ? distanceToBox(player.x, player.y, station) <= 64 : false; }

/** @param {number} x 점 x @param {number} y 점 y @param {object} box AABB @returns {number} 최단 거리 */
function distanceToBox(x, y, box) { const dx = Math.max(box.x - x, 0, x - (box.x + box.w)); const dy = Math.max(box.y - y, 0, y - (box.y + box.h)); return Math.hypot(dx, dy); }

/** @param {object} simulation 시뮬레이션 @returns {void} */
function triggerOverheatAccident(simulation) {
  for (const item of simulation.items) if ([PROCESS.COOKING, PROCESS.COOKED].includes(item.process)) { item.process = PROCESS.BURNT; item.revision += 1; }
  for (const station of simulation.stations) if (['brazier', 'steamer', 'pot'].includes(station.type) && station.contents.length) { station.state = 'BURNT'; station.revision += 1; }
  simulation.orderState.score = Math.max(0, simulation.orderState.score - 25); simulation.orderState.comboStep = 0; simulation.train.heat = 60; simulation.train.overheatStartedAt = null; simulation.train.accidentGuardUntil = simulation.elapsedMs + 5000; simulation.train.overheatAccidents += 1; simulation.events.push({ kind: 'OVERHEAT_ACCIDENT', payload: {} });
}

/** @param {number} value 값 @param {number} min 최소 @param {number} max 최대 @returns {number} 제한 값 */
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
