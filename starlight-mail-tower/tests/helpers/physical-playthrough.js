/**
 * @fileoverview 공개 입력 API와 30Hz 고정 스텝만으로 두 플레이어의 전 레벨 완주를 구동한다.
 */

import { applyInput, createSimulation, stepSimulation } from '../../game/simulation.js';

const STEP = 1 / 30;
const PLAYER_HALF_HEIGHT = 28;

/**
 * 실패 진단에 필요한 현재 진행 정보를 문자열로 만든다.
 * @param {object} simulation 시뮬레이션
 * @param {string} stage 현재 단계
 * @param {Array<object>} events 최근 이벤트
 * @returns {string}
 */
function diagnostic(simulation, stage, events) {
  const players = simulation.players.map((player) => `${player.id}=(${player.x.toFixed(1)},${player.y.toFixed(1)}) v=(${player.vx.toFixed(1)},${player.vy.toFixed(1)})`).join(' ');
  return `${simulation.levelId} cp=${simulation.checkpointId} stage=${stage} ${players} last=${events.at(-1)?.kind ?? 'none'}`;
}

/**
 * 결정론적 두 플레이어 입력 드라이버를 만든다.
 * @param {string} levelId 레벨 ID
 * @returns {object}
 */
export function createPhysicalDriver(levelId) {
  const simulation = createSimulation(levelId, { startPlaying: true });
  const desired = new Map(simulation.players.map((player) => [player.id, { left: false, right: false, jump: false, interact: false }]));
  const sequences = new Map(simulation.players.map((player) => [player.id, 0]));
  const events = [];

  /** @param {number} count 스텝 수 @returns {void} */
  function tick(count = 1) {
    for (let index = 0; index < count; index += 1) {
      for (const player of simulation.players) {
        const input = desired.get(player.id);
        applyInput(simulation, player.id, { seq: sequences.get(player.id), ...input });
        sequences.set(player.id, sequences.get(player.id) + 1);
        input.jump = false;
      }
      events.push(...stepSimulation(simulation, STEP));
    }
  }

  /** @param {string} playerId 플레이어 ID @returns {object} */
  function player(playerId) { return simulation.players.find((item) => item.id === playerId); }

  /** @param {string} platformId 발판 ID @returns {object} */
  function platform(platformId) { return simulation.dynamicPlatforms.find((item) => item.id === platformId); }

  /**
   * 한 플레이어를 입력만으로 목표 발판에 착지시킨다.
   * @param {string} playerId 플레이어 ID
   * @param {string} platformId 목표 발판 ID
   * @param {number} [maxTicks] 최대 틱
   * @param {number|null} [preferredX] 다음 점프를 고려한 착지 X
   * @returns {void}
   */
  function reachPlatform(playerId, platformId, maxTicks = 720, preferredX = null) {
    const controls = desired.get(playerId);
    for (let index = 0; index < maxTicks; index += 1) {
      const actor = player(playerId);
      const target = platform(platformId);
      const targetX = preferredX === null ? target.x + target.width / 2 : Math.max(target.x + 28, Math.min(target.x + target.width - 28, preferredX));
      const feet = actor.y + PLAYER_HALF_HEIGHT;
      const support = actor.grounded ? simulation.dynamicPlatforms.find((item) => Math.abs(item.y - feet) <= 2 && actor.x >= item.x + 20 && actor.x <= item.x + item.width - 20) : null;
      const climbing = actor.grounded && feet > target.y + 5;
      const takeoffX = climbing && support ? Math.max(support.x + 28, Math.min(support.x + support.width - 28, targetX)) : targetX;
      const horizontalGap = support ? Math.max(target.x - (support.x + support.width), support.x - (target.x + target.width), 0) : 0;
      const jumpReach = target.dynamic ? 160 : Number.isFinite(simulation.level.physics.moveAcceleration) ? 240 : 220;
      const targetDevice = Number.isInteger(target.deviceIndex) ? simulation.devices[target.deviceIndex] : null;
      const targetMech = Number.isInteger(target.deviceIndex) ? simulation.level.modules[target.deviceIndex]?.mechanics : null;
      const safeRise = (simulation.level.physics.gravity ?? 1450) < 1000 ? 175 : 122;

      // 타이머 게이트 / 사이클 플랫폼: 잔여 솔리드 윈도우가 부족하면 다음 사이클 시작까지 대기한다.
      let solidWindowTooShort = false;
      if (targetDevice?.solid && targetMech) {
        if (targetMech.solidMs !== undefined) {
          // cycle-platform: phaseMs < solidMs 구간이 솔리드. 잔여 = solidMs - phaseMs.
          solidWindowTooShort = (targetMech.solidMs - (targetDevice.phaseMs ?? 0)) < 1500;
        } else if (targetMech.cycleMs !== undefined && targetMech.openMs !== undefined) {
          // timer-gate: phaseMs >= openMs 구간이 솔리드. 잔여 = cycleMs - phaseMs.
          solidWindowTooShort = (targetMech.cycleMs - (targetDevice.phaseMs ?? 0)) < 2000;
        }
      }

      const waitingForRange = climbing && support && (horizontalGap > jumpReach || target.y < feet - safeRise || targetDevice?.solid === false || solidWindowTooShort);
      const steeringX = climbing && (Math.abs(takeoffX - actor.x) > 10 || waitingForRange) ? takeoffX : targetX;
      const dx = steeringX - actor.x;
      const braking = Number.isFinite(simulation.level.physics.moveAcceleration) && Math.abs(dx) < 28 && Math.abs(actor.vx) > 45;
      controls.left = braking ? actor.vx > 0 : dx < -7;
      controls.right = braking ? actor.vx < 0 : dx > 7;
      if (waitingForRange && Math.abs(takeoffX - actor.x) <= 12) { controls.left = false; controls.right = false; }
      if (climbing && !waitingForRange && (!support || Math.abs(takeoffX - actor.x) <= 12)) controls.jump = true;
      tick();
      const landedTarget = platform(platformId);
      const upper = landedTarget.returnPlatform ? platform(landedTarget.upperPlatformId) : null;
      const passedReturn = upper && Math.abs(actor.y + PLAYER_HALF_HEIGHT - upper.y) <= 2;
      const landed = actor.grounded && (Math.abs(actor.y + PLAYER_HALF_HEIGHT - landedTarget.y) <= 2 || passedReturn) && actor.x >= landedTarget.x + 20 && actor.x <= landedTarget.x + landedTarget.width - 20;
      if (landed) { controls.left = false; controls.right = false; return; }
    }
    throw new Error(diagnostic(simulation, `reach:${playerId}:${platformId}`, events));
  }

  /**
   * 플레이어를 현재 발판 위 목표 X까지 이동시킨다.
   * @param {string} playerId 플레이어 ID
   * @param {number} targetX 목표 X
   * @param {number} [maxTicks] 최대 틱
   * @returns {void}
   */
  function moveToX(playerId, targetX, maxTicks = 360) {
    const controls = desired.get(playerId);
    for (let index = 0; index < maxTicks; index += 1) {
      const actor = player(playerId);
      const dx = targetX - actor.x;
      if (!Number.isFinite(simulation.level.physics.moveAcceleration) && Math.abs(dx) <= 9) { controls.left = false; controls.right = false; tick(); return; }
      const braking = Number.isFinite(simulation.level.physics.moveAcceleration) && Math.abs(dx) < 24 && Math.abs(actor.vx) > 35;
      controls.left = braking ? actor.vx > 0 : dx < -5;
      controls.right = braking ? actor.vx < 0 : dx > 5;
      tick();
      if (Math.abs(targetX - actor.x) <= 7 && Math.abs(actor.vx) < 55) { controls.left = false; controls.right = false; tick(2); return; }
    }
    throw new Error(diagnostic(simulation, `move:${playerId}:${targetX}`, events));
  }

  /**
   * 하단 발판에서 역할 플레이어를 실제 점프 충돌로 상단 발판에 올린다.
   * @param {object} module 모듈
   * @returns {object} 발생한 부스트 이벤트
   */
  function boostToModule(module) {
    const receiverId = module.requiredPlayerId;
    const strikerId = receiverId === 'p1' ? 'p2' : 'p1';
    const lower = platform(module.approachPlatformId);
    const upper = platform(module.boostLandingPlatformId);
    const left = Math.max(lower.x + 28, upper.x + 28);
    const right = Math.min(lower.x + lower.width - 28, upper.x + upper.width - 28);
    const alignX = (left + right) / 2;
    moveToX(receiverId, alignX);
    moveToX(strikerId, alignX);
    const before = events.length;
    desired.get(receiverId).jump = true;
    tick(5);
    desired.get(strikerId).jump = true;
    for (let index = 0; index < 90; index += 1) {
      tick();
      const boost = events.slice(before).find((event) => event.kind === 'COOP_BOOST' && event.payload.receiverId === receiverId);
      if (boost) {
        for (let landingTick = 0; landingTick < 180; landingTick += 1) {
          tick();
          const actor = player(receiverId);
          if (actor.grounded && Math.abs(actor.y + PLAYER_HALF_HEIGHT - upper.y) <= 2) return boost;
        }
      }
    }
    throw new Error(diagnostic(simulation, `boost:${module.id}`, events));
  }

  return { simulation, desired, events, tick, player, platform, reachPlatform, moveToX, boostToModule };
}

/**
 * 한 레벨을 시작부터 결과 이벤트까지 물리 입력만으로 완주한다.
 * @param {string} levelId 레벨 ID
 * @returns {{simulation:object,events:Array<object>,boosts:Array<object>}}
 */
export function runPhysicalPlaythrough(levelId) {
  const driver = createPhysicalDriver(levelId);
  const { simulation, desired, events, tick, reachPlatform, moveToX, boostToModule } = driver;
  const boosts = [];
  const gravity = simulation.level.physics.gravity ?? 1450;
  const safeRisePx = gravity < 1000 ? 175 : 122;
  tick(20);
  for (let index = 0; index < simulation.level.modules.length; index += 1) {
    const module = simulation.level.modules[index];
    boosts.push(boostToModule(module));
    const anchorId = module.requiredPlayerId;
    const partnerId = anchorId === 'p1' ? 'p2' : 'p1';
    moveToX(anchorId, module.anchor.x);
    desired.get(anchorId).interact = true;
    for (let wait = 0; wait < 30 && simulation.devices[index].state !== 'POWERED'; wait += 1) tick();
    if (simulation.devices[index].state !== 'POWERED') throw new Error(diagnostic(simulation, `power:${module.id}`, events));
    // 위험/상승 구역 장치는 스위치 반경에 들어오는 첫 틱을 놓치지 않도록 E를 미리 유지한다.
    desired.get(partnerId).interact = true;
    const route = driver.platform(`m${index + 1}-route`);
    const end = driver.platform(`m${index + 1}-end`);
    const routeExitX = end.x > route.x ? route.x + route.width - 36 : route.x + 36;

    // low-gravity 모듈: 구역이 end 플랫폼 쪽에 집중되므로 반대편 가장자리에 착지시켜 떠내려가는 것을 방지한다.
    const deviceType = simulation.devices[index]?.type;
    const endPreferredX = deviceType === 'low-gravity'
      ? (end.x < route.x ? end.x + end.width - 28 : end.x + 28)
      : null;

    // rotary 루트는 회전 중 착지 실패가 잦으므로 최대 틱을 늘린다.
    const routeMaxTicks = deviceType === 'rotary' ? 720 : 360;

    let partnerCrossed = false;
    for (let attempt = 0; attempt < 4 && !partnerCrossed; attempt += 1) {
      try {
        const partnerActor = driver.player(partnerId);
        const approach = driver.platform(module.approachPlatformId);
        const pFeet = partnerActor.y + PLAYER_HALF_HEIGHT;
        if (pFeet > approach.y + 2) {
          // 플레이어가 어프로치보다 아래에 있을 때, 직접 점프가 불가한 경우 이전 모듈 루트를 경유한다.
          if (index > 0 && pFeet > approach.y + safeRisePx) {
            reachPlatform(partnerId, `m${index}-route`, 360);
          }
          reachPlatform(partnerId, module.approachPlatformId, 360);
        }
        reachPlatform(partnerId, module.returnPlatformId, 360);
        reachPlatform(partnerId, module.boostLandingPlatformId, 360);
        reachPlatform(partnerId, `m${index + 1}-route`, routeMaxTicks, routeExitX);
        reachPlatform(partnerId, `m${index + 1}-end`, 360, endPreferredX);
        partnerCrossed = true;
      } catch (error) { if (attempt === 3) throw error; }
    }
    desired.get(partnerId).interact = true;
    moveToX(partnerId, module.switch.x);
    for (let wait = 0; wait < 240 && simulation.devices[index].state !== 'LATCHED'; wait += 1) tick();
    if (simulation.devices[index].state !== 'LATCHED') throw new Error(diagnostic(simulation, `latch:${module.id}`, events));
    desired.get(anchorId).interact = false;
    desired.get(partnerId).interact = false;
    let anchorCrossed = false;
    for (let attempt = 0; attempt < 4 && !anchorCrossed; attempt += 1) {
      try {
        const anchorActor = driver.player(anchorId);
        const approach = driver.platform(module.approachPlatformId);
        const aFeet = anchorActor.y + PLAYER_HALF_HEIGHT;
        if (aFeet > approach.y + 2) {
          // 플레이어가 어프로치보다 아래에 있을 때, 직접 점프가 불가한 경우 이전 모듈 루트를 경유한다.
          if (index > 0 && aFeet > approach.y + safeRisePx) {
            reachPlatform(anchorId, `m${index}-route`, 360);
          }
          reachPlatform(anchorId, module.approachPlatformId, 360);
        }
        reachPlatform(anchorId, module.returnPlatformId, 360);
        reachPlatform(anchorId, module.boostLandingPlatformId, 360);
        reachPlatform(anchorId, `m${index + 1}-route`, routeMaxTicks, routeExitX);
        reachPlatform(anchorId, `m${index + 1}-end`, 360, endPreferredX);
        anchorCrossed = true;
      } catch (error) { if (attempt === 3) throw error; }
    }
    const checkpointX = module.checkpoint.x + module.checkpoint.width / 2;
    moveToX(anchorId, checkpointX - 24);
    moveToX(partnerId, checkpointX + 24);
    for (let wait = 0; wait < 30 && simulation.checkpointId === index; wait += 1) tick();
    if (simulation.checkpointId !== index + 1) throw new Error(diagnostic(simulation, `checkpoint:${module.id}`, events));
  }
  reachPlatform('p1', 'finish-deck');
  reachPlatform('p2', 'finish-deck');
  moveToX('p1', simulation.level.finish.leftSwitch.x);
  moveToX('p2', simulation.level.finish.rightSwitch.x);
  desired.get('p1').interact = true;
  desired.get('p2').interact = true;
  for (let wait = 0; wait < 180 && simulation.phase !== 'result'; wait += 1) tick();
  if (simulation.phase !== 'result') throw new Error(diagnostic(simulation, 'finish', events));
  return { simulation, events, boosts };
}
