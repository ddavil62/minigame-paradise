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
    // 이전 틱의 이동 발판 X 위치 (이동 방향 계산용)
    let prevTargetX = null;
    for (let index = 0; index < maxTicks; index += 1) {
      const actor = player(playerId);
      const target = platform(platformId);
      const targetX = preferredX === null ? target.x + target.width / 2 : Math.max(target.x + 28, Math.min(target.x + target.width - 28, preferredX));
      const feet = actor.y + PLAYER_HALF_HEIGHT;
      const support = actor.grounded ? simulation.dynamicPlatforms.find((item) => Math.abs(item.y - feet) <= 2 && actor.x >= item.x + 20 && actor.x <= item.x + item.width - 20) : null;
      const climbing = actor.grounded && feet > target.y + 5;
      const takeoffX = climbing && support ? Math.max(support.x + 28, Math.min(support.x + support.width - 28, targetX)) : targetX;
      const horizontalGap = support ? Math.max(target.x - (support.x + support.width), support.x - (target.x + target.width), 0) : 0;

      // 이동 발판(carryRiders=true, axis=x) 방향 추적: 발판이 멀어지는 방향으로 움직이면 점프를 보류한다.
      const isMovingCar = !!target.dynamic?.carryRiders && target.dynamic?.axis === 'x';
      const curCarX = isMovingCar ? target.x : null;
      const carDx = (isMovingCar && prevTargetX !== null) ? curCarX - prevTargetX : 0;
      // playerLeftOfCar: 목표 발판(이동 차)이 현재 발판보다 오른쪽에 있음 (플레이어가 왼쪽에 있음)
      const playerLeftOfCar = isMovingCar && support && target.x > support.x + support.width;
      // playerRightOfCar: 목표 발판(이동 차)이 현재 발판보다 왼쪽에 있음 (플레이어가 오른쪽에 있음)
      const playerRightOfCar = isMovingCar && support && target.x + target.width < support.x;
      // carMovingAway: 이동 차가 플레이어 반대 방향으로 움직이는 중 (접근 불가)
      const carMovingAway = (playerLeftOfCar && carDx > 0) || (playerRightOfCar && carDx < 0);
      // carTooClose: 갭이 너무 좁아 점프 착지 실패 위험 (갭이 120px 미만이고 멀어지지 않는 중)
      const carTooClose = isMovingCar && horizontalGap > 0 && horizontalGap < 120 && !carMovingAway;
      // 다음 틱 비교를 위해 현재 X 기록
      prevTargetX = curCarX;

      // 체크포인트 장치 타입 (low-gravity 구역에서 점프 거리를 확장하기 위해 사용)
      const checkpointDev = simulation.devices[simulation.checkpointId];
      const checkpointDevType = checkpointDev?.type;
      const jumpReach = (target.dynamic?.axis === 'x') ? 200 : target.dynamic ? 160 :
        checkpointDevType === 'low-gravity' ? 520 :
        Number.isFinite(simulation.level.physics.moveAcceleration) ? 240 : 220;
      const targetDevice = Number.isInteger(target.deviceIndex) ? simulation.devices[target.deviceIndex] : null;
      const targetMech = Number.isInteger(target.deviceIndex) ? simulation.level.modules[target.deviceIndex]?.mechanics : null;
      // low-gravity 구역 활성 시 실효 중력 0.42배 → 점프 높이 약 330px. 기본값은 레벨 중력 기준.
      const inLowGravityZone = checkpointDevType === 'low-gravity' && (checkpointDev?.active ?? false);
      const baseGravity = simulation.level.physics.gravity ?? 1450;
      const safeRise = inLowGravityZone ? 330 : baseGravity < 1000 ? 195 : 142;

      // 타이머 게이트 / 사이클 플랫폼: 잔여 솔리드 윈도우가 부족하면 다음 사이클 시작까지 대기한다.
      // LATCHED 상태에서는 phaseMs가 동결되고 발판이 영구 솔리드이므로 solidWindowTooShort 계산을 생략한다.
      let solidWindowTooShort = false;
      if (targetDevice?.solid && targetMech && targetDevice.state !== 'LATCHED') {
        if (targetMech.solidMs !== undefined) {
          // cycle-platform: phaseMs < solidMs 구간이 솔리드. 잔여 솔리드 윈도우가 동적 임계값 미만이면 대기한다.
          // 0.9 임계값: 착지 후 충분한 재이동 시간 확보 (0.7 대비 더 보수적, 큰 재이동 거리 대응).
          const remaining = targetMech.solidMs - (targetDevice.phaseMs ?? 0);
          solidWindowTooShort = remaining < Math.min(1800, targetMech.solidMs * 0.9);
        } else if (targetMech.cycleMs !== undefined && targetMech.openMs !== undefined) {
          // timer-gate: phaseMs >= openMs 구간이 솔리드. 잔여 = cycleMs - phaseMs.
          solidWindowTooShort = (targetMech.cycleMs - (targetDevice.phaseMs ?? 0)) < 2000;
        }
      }

      // X축 이동 발판(carryRiders) 위에 있을 때: target 방향에 따라 최적 위치에서만 점프한다.
      // target이 to 방향이면 to에서 대기, from 방향이면 from에서 대기 (gap 최소화).
      const onXCarSupport = !!support?.dynamic?.carryRiders && support.dynamic.axis === 'x';
      const xCarOptimalX = onXCarSupport
        ? (targetX > (support.dynamic.from + support.dynamic.to + support.width) / 2 ? support.dynamic.to : support.dynamic.from)
        : null;
      const xCarNotAtFrom = onXCarSupport && xCarOptimalX !== null && Math.abs(support.x - xCarOptimalX) > 80;

      // Y축 이동 발판(carryRiders) 위에 있을 때 점프 전략 보정:
      // 1) 수평 갭이 크면 공중 수평 이동 시간 확보를 위해 실효 safeRise를 100px로 축소한다.
      //    (safeRise=142일 때 최초 허용 위치에서 점프하면 수평 이동 거리가 부족해 갭을 못 넘는 문제 해소)
      // 2) 발판이 목표보다 위에 있어 climbing=False인 구간에서도 점프로 수평 갭을 통과한다.
      const onYCarSupport = !!support?.dynamic?.carryRiders && support.dynamic.axis === 'y';
      const safeRiseEffective = (onYCarSupport && horizontalGap > 40) ? Math.min(safeRise, 100) : safeRise;
      const targetSlightlyBelowOnYCar = onYCarSupport && !climbing && target.y >= feet && target.y - feet <= 80 && horizontalGap > 40;
      const climbingEffective = climbing || targetSlightlyBelowOnYCar;
      // climbingEffective가 True이면 support 범위 내로 이착륙 X를 재계산한다.
      // (climbing=False지만 Y축 이동 발판 위에서 수평 점프가 필요할 때 takeoffX를 support 범위 내로 클램프)
      const takeoffXEffective = climbingEffective && support
        ? Math.max(support.x + 28, Math.min(support.x + support.width - 28, targetX))
        : targetX;

      // cycle-platform 지지 발판 위: 솔리드 윈도우 소진 전 착지 가능 위치에서 선제 점프한다.
      // takeoffXEffective까지 이동 시간이 남은 솔리드 윈도우를 초과할 때만 발동한다.
      const supportDevInst = climbingEffective && support && Number.isInteger(support.deviceIndex)
        ? simulation.devices[support.deviceIndex] : null;
      const onCyclePlatformSupport = supportDevInst?.type === 'cycle-platform';
      const cycleSupportMech = onCyclePlatformSupport
        ? simulation.level.modules[support.deviceIndex]?.mechanics : null;
      const cycleSupportRemaining = (onCyclePlatformSupport && cycleSupportMech)
        ? cycleSupportMech.solidMs - (supportDevInst.phaseMs ?? 0) : Infinity;
      // 상승 점프 후 하강 교차 시간: 0.5*g*t²-v₀*t+hRise=0 의 양의 근
      const jSpd = simulation.level.physics.jumpSpeed ?? 650;
      const gAcc = simulation.level.physics.gravity ?? 1450;
      const mSpd = simulation.level.physics.moveSpeed ?? simulation.level.physics.maxSpeed ?? 250;
      const hRise = onCyclePlatformSupport ? support.y - target.y : 0;
      const flightSec = (onCyclePlatformSupport && hRise > 0)
        ? (jSpd + Math.sqrt(Math.max(0, jSpd * jSpd - 2 * gAcc * hRise))) / gAcc : 0;
      // 진행 방향(목표 중심 vs 지지 발판 중심)으로 착지 X 예측
      const tgtCX = target.x + target.width / 2;
      const supCX = onCyclePlatformSupport ? support.x + support.width / 2 : 0;
      const cycleToLeft = onCyclePlatformSupport && tgtCX < supCX;
      const predLandX = onCyclePlatformSupport
        ? actor.x + (cycleToLeft ? -mSpd : mSpd) * flightSec : 0;
      // 잔여 윈도우로 takeoffXEffective 도달 가능 여부 (10px 여유 포함)
      const canReachTakeoffX = cycleSupportRemaining * mSpd / 1000 >= Math.abs(takeoffXEffective - actor.x) + 10;
      // 솔리드 윈도우 부족 + 현재 위치 착지 가능(8px 이산화 오차 보정) → 선제 점프
      const cyclePlatformEarlyJump = onCyclePlatformSupport && climbingEffective
        && !canReachTakeoffX && cycleSupportRemaining > 0
        && predLandX >= target.x + 20 + 8 && predLandX <= target.x + target.width - 20 - 8;

      // updraft/wind-shutter 구역 통과 중 추가 대기 조건
      const checkpointMech = simulation.level.modules[simulation.checkpointId]?.mechanics;
      const updraftActive = checkpointDev?.type === 'updraft' && checkpointDev.active;
      // wind-shutter: 비활성 구간이 존재할 때만(activeMs < cycleMs) 대기한다.
      const windHasInactiveWindow = checkpointMech?.activeMs !== undefined && checkpointMech.activeMs < (checkpointMech.cycleMs ?? 3600);
      const windActive = checkpointDev?.type === 'wind-shutter' && checkpointDev.active && windHasInactiveWindow;

      // updraft 구역 통과 중 interact를 유지하여 상승 기류 억제 (applyZoneForces 보호)
      if (updraftActive) controls.interact = true;

      // wind-shutter 활성 구간 또는 X축 이동 발판이 from 위치에서 멀면 점프를 보류한다.
      const waitingForRange = climbingEffective && support && (horizontalGap > jumpReach || target.y < feet - safeRiseEffective || targetDevice?.solid === false || solidWindowTooShort || windActive || carMovingAway || carTooClose || xCarNotAtFrom);
      const steeringX = climbingEffective && (Math.abs(takeoffXEffective - actor.x) > 10 || waitingForRange) ? takeoffXEffective : targetX;
      const dx = steeringX - actor.x;
      const braking = Number.isFinite(simulation.level.physics.moveAcceleration) && Math.abs(dx) < 28 && Math.abs(actor.vx) > 45;
      controls.left = braking ? actor.vx > 0 : dx < -7;
      controls.right = braking ? actor.vx < 0 : dx > 7;
      if (waitingForRange && Math.abs(takeoffXEffective - actor.x) <= 12) { controls.left = false; controls.right = false; }
      if (climbingEffective && !waitingForRange && (!support || Math.abs(takeoffXEffective - actor.x) <= 12 || cyclePlatformEarlyJump)) controls.jump = true;
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
  const safeRisePx = gravity < 1000 ? 195 : 142;
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
    // X축 이동 발판은 현재 위치(route.x)가 매 틱 변하므로 안정적인 from 위치 기준으로 이탈 X를 계산한다.
    const routeStableX = route.dynamic?.axis === 'x' ? route.dynamic.from : route.x;
    const routeExitX = end.x > routeStableX ? routeStableX + route.width - 36 : routeStableX + 36;

    // low-gravity 모듈: 구역이 end 플랫폼 쪽에 집중되므로 반대편 가장자리에 착지시켜 떠내려가는 것을 방지한다.
    const deviceType = simulation.devices[index]?.type;
    const endPreferredX = deviceType === 'low-gravity'
      ? (end.x < route.x ? end.x + end.width - 28 : end.x + 28)
      : null;

    // rotary·이동 발판·명멸 발판·기류·바람 루트는 대기 시간이 길어질 수 있으므로 최대 틱을 늘린다.
    const routeMaxTicks = (deviceType === 'rotary' || deviceType === 'moving-car' || deviceType === 'cycle-platform' || deviceType === 'updraft' || deviceType === 'wind-shutter') ? 720 : 360;

    let partnerCrossed = false;
    for (let attempt = 0; attempt < 4 && !partnerCrossed; attempt += 1) {
      try {
        const partnerActor = driver.player(partnerId);
        const approach = driver.platform(module.approachPlatformId);
        const pFeet = partnerActor.y + PLAYER_HALF_HEIGHT;
        if (pFeet > approach.y + 2) {
          // 플레이어가 어프로치보다 아래에 있을 때, 직접 점프가 불가한 경우 이전 모듈 경유.
          if (index > 0 && pFeet > approach.y + safeRisePx) {
            // 매우 멀리 아래에 있을 때는 중간 발판을 경유해 단계적으로 올라간다.
            if (index > 1 && pFeet > approach.y + safeRisePx * 2) {
              try { reachPlatform(partnerId, `m${index - 1}-route`, 360); } catch { void 0; }
              try { reachPlatform(partnerId, `m${index - 1}-end`, 360); } catch { void 0; }
              try { reachPlatform(partnerId, `m${index}-return`, 360); } catch { void 0; }
              try { reachPlatform(partnerId, `m${index}-start`, 360); } catch { void 0; }
            }
            reachPlatform(partnerId, `m${index}-route`, 360);
          }
          reachPlatform(partnerId, module.approachPlatformId, 360);
        }
        reachPlatform(partnerId, module.returnPlatformId, 360);
        reachPlatform(partnerId, module.boostLandingPlatformId, 360);
        // low-gravity 모듈: boostLanding에서 바로 end로 점프 후, 오버슛 시 route 경유로 재시도한다.
        if (deviceType === 'low-gravity') {
          try { reachPlatform(partnerId, `m${index + 1}-end`, 360, endPreferredX); }
          catch {
            reachPlatform(partnerId, `m${index + 1}-route`, routeMaxTicks, routeExitX);
            reachPlatform(partnerId, `m${index + 1}-end`, 360, endPreferredX);
          }
        } else {
          reachPlatform(partnerId, `m${index + 1}-route`, routeMaxTicks, routeExitX);
          reachPlatform(partnerId, `m${index + 1}-end`, 360, endPreferredX);
        }
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
          // 플레이어가 어프로치보다 아래에 있을 때, 직접 점프가 불가한 경우 이전 모듈 경유.
          if (index > 0 && aFeet > approach.y + safeRisePx) {
            // 매우 멀리 아래에 있을 때는 중간 발판을 경유해 단계적으로 올라간다.
            if (index > 1 && aFeet > approach.y + safeRisePx * 2) {
              try { reachPlatform(anchorId, `m${index - 1}-route`, 360); } catch { void 0; }
              try { reachPlatform(anchorId, `m${index - 1}-end`, 360); } catch { void 0; }
              try { reachPlatform(anchorId, `m${index}-return`, 360); } catch { void 0; }
              try { reachPlatform(anchorId, `m${index}-start`, 360); } catch { void 0; }
            }
            reachPlatform(anchorId, `m${index}-route`, 360);
          }
          reachPlatform(anchorId, module.approachPlatformId, 360);
        }
        reachPlatform(anchorId, module.returnPlatformId, 360);
        reachPlatform(anchorId, module.boostLandingPlatformId, 360);
        // low-gravity 모듈: boostLanding에서 바로 end로 점프 후, 오버슛 시 route 경유로 재시도한다.
        if (deviceType === 'low-gravity') {
          try { reachPlatform(anchorId, `m${index + 1}-end`, 360, endPreferredX); }
          catch {
            reachPlatform(anchorId, `m${index + 1}-route`, routeMaxTicks, routeExitX);
            reachPlatform(anchorId, `m${index + 1}-end`, 360, endPreferredX);
          }
        } else {
          reachPlatform(anchorId, `m${index + 1}-route`, routeMaxTicks, routeExitX);
          reachPlatform(anchorId, `m${index + 1}-end`, 360, endPreferredX);
        }
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
