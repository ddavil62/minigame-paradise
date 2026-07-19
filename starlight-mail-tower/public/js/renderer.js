/**
 * @fileoverview 승인된 산업 판타지 레이어와 상태 모션으로 분류 데크·장치·두 로봇을 Canvas에 렌더링한다.
 */

import { FINISH, MODULES, PLATFORMS, WORLD } from '../shared/level-data.js';
import { getFinishCrossfadeAlpha } from './motion.js';

const COLORS = Object.freeze({ skyDeep: '#0B1322', skyNavy: '#15213A', panel: '#1F2C47', steel: '#344B68', cream: '#F5E9C9', gold: '#FFD97A', brass: '#C68A3A', cyan: '#62D6E8', coral: '#FF8D78', green: '#64DC96', warning: '#FFB454', danger: '#FF7E7E', void: '#07101D', windTeal: '#3E91A3', windMist: '#B9E8E7', violet: '#786EA8', signalRose: '#D97FA5' });
const STARS = Array.from({ length: 60 }, (_, index) => ({ x: (index * 211) % 1280, y: (index * 137) % 720, radius: index % 5 === 0 ? 2 : 1 }));

/**
 * Canvas 렌더러를 생성한다.
 * @param {HTMLCanvasElement} canvas 게임 Canvas
 * @returns {{setSnapshot:Function,setPlayerId:Function,start:Function}}
 */
export function createRenderer(canvas) {
  const context = canvas.getContext('2d');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const motionState = new Map();
  const checkpointActivatedAt = new Map();
  let snapshot = null;
  let playerId = 'p1';
  let cameraX = 0;
  let cameraY = WORLD.height - canvas.height;
  let previousCheckpointId = 0;
  /** @returns {object} */
  function level() { return snapshot?.level ?? { finish: FINISH, modules: MODULES, platforms: PLATFORMS, world: WORLD, palette: { sky: COLORS.skyDeep, haze: COLORS.skyNavy, structure: COLORS.steel, accent: COLORS.brass }, motif: 'tower' }; }

  /**
   * 최신 권위 스냅샷을 교체하고 체크포인트 활성 시각의 시작 시간을 기록한다.
   * @param {object} value 스냅샷
   * @returns {void}
   */
  function setSnapshot(value) {
    snapshot = value;
    if (value.checkpointId > previousCheckpointId) {
      for (let index = previousCheckpointId; index < value.checkpointId; index += 1) checkpointActivatedAt.set(index, performance.now());
      previousCheckpointId = value.checkpointId;
    }
  }

  /**
   * 로컬 플레이어 ID를 카메라 기준으로 설정한다.
   * @param {string} value 플레이어 ID
   * @returns {void}
   */
  function setPlayerId(value) { playerId = value; }

  /**
   * L0 고정 밤하늘을 그린다.
   * @returns {void}
   */
  function drawSky() {
    const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, level().palette.haze);
    gradient.addColorStop(1, level().palette.sky);
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = COLORS.cream;
    const visibleStars = level().motif === 'clock' ? STARS.slice(0, 42) : STARS;
    for (const star of visibleStars) {
      context.globalAlpha = 0.35 + star.radius * 0.18;
      context.beginPath(); context.arc(star.x, star.y, star.radius, 0, Math.PI * 2); context.fill();
    }
    context.globalAlpha = 1;
    context.save(); context.globalAlpha = 0.3; context.strokeStyle = level().palette.accent; context.lineWidth = 2;
    if (level().motif === 'train') { for (let x = -40; x < 1280; x += 180) context.strokeRect(x, 560, 150, 70); }
    else if (level().motif === 'clock') { context.beginPath(); context.arc(640, 360, 220, 0, Math.PI * 2); context.stroke(); for (let a = 0; a < 12; a += 1) { context.beginPath(); context.moveTo(640 + Math.cos(a * Math.PI / 6) * 190, 360 + Math.sin(a * Math.PI / 6) * 190); context.lineTo(640 + Math.cos(a * Math.PI / 6) * 220, 360 + Math.sin(a * Math.PI / 6) * 220); context.stroke(); } }
    else if (level().motif === 'storm') { for (let x = 80; x < 1200; x += 260) { context.beginPath(); context.moveTo(x, 120); context.lineTo(x + 36, 190); context.lineTo(x + 10, 190); context.lineTo(x + 54, 270); context.stroke(); } }
    else if (level().motif === 'orbit') { context.beginPath(); context.ellipse(640, 360, 430, 150, -.25, 0, Math.PI * 2); context.stroke(); }
    context.restore();
  }

  /**
   * 신규 월드의 L1 원경 실루엣을 모티프별로 그린다.
   * @param {number} offset 시차 오프셋
   * @returns {boolean} 전용 원경 처리 여부
   */
  function drawMotifDistance(offset) {
    const motif = level().motif; if (motif === 'tower') return false;
    context.save(); context.globalAlpha = motif === 'storm' ? .18 : .28; context.lineWidth = 2;
    if (motif === 'train') {
      context.strokeStyle = COLORS.windMist; for (const [x, y, r] of [[80,150,90],[380,220,120],[900,130,100]]) { context.beginPath(); context.arc(x, y + offset, r, Math.PI, Math.PI * 2); context.stroke(); }
      context.fillStyle = COLORS.steel; context.strokeStyle = COLORS.cream; for (let x = 60; x < 1220; x += 260) { context.fillRect(x, 430 + offset, 220, 100); context.strokeRect(x, 430 + offset, 220, 100); context.fillStyle = COLORS.brass; context.fillRect(x + 220, 470 + offset, 40, 8); context.fillStyle = COLORS.steel; }
    } else if (motif === 'clock') {
      context.strokeStyle = COLORS.violet; for (const radius of [150,210,270]) { context.beginPath(); context.arc(640, 360 + offset, radius, 0, Math.PI * 2); context.stroke(); }
      context.lineWidth = 3; context.beginPath(); context.arc(500, 280 + offset, 110, .35 * Math.PI, 1.65 * Math.PI); context.stroke(); context.beginPath(); context.arc(535, 280 + offset, 88, .35 * Math.PI, 1.65 * Math.PI); context.stroke();
    } else if (motif === 'storm') {
      context.fillStyle = COLORS.steel; for (const [x,y,w] of [[50,170,420],[360,110,520],[800,210,400]]) { context.beginPath(); context.roundRect(x,y+offset,w,74,36); context.fill(); }
      context.strokeStyle = COLORS.windMist; context.beginPath(); context.arc(640, 510 + offset, 130, Math.PI, 0); context.stroke(); context.moveTo(640,380+offset); context.lineTo(640,560+offset); context.stroke(); context.moveTo(600,430+offset); context.lineTo(640,390+offset); context.lineTo(680,430+offset); context.stroke();
    } else {
      context.fillStyle = COLORS.panel; context.strokeStyle = COLORS.steel; context.beginPath(); context.roundRect(250,260+offset,780,190,70); context.fill(); context.stroke();
      context.strokeStyle = COLORS.violet; for (const x of [240,1040]) { context.beginPath(); context.arc(x,355+offset,74,0,Math.PI*2); context.stroke(); context.beginPath(); context.arc(x,355+offset,48,0,Math.PI*2); context.stroke(); }
    }
    context.restore(); return true;
  }

  /**
   * 신규 월드의 L2 신호·경로 구조를 모티프별로 그린다.
   * @param {number} offset 시차 오프셋
   * @returns {boolean} 전용 중경 처리 여부
   */
  function drawMotifMiddle(offset) {
    const motif = level().motif; if (motif === 'tower') return false;
    context.save(); context.globalAlpha = .3; context.lineWidth = 2;
    if (motif === 'train') { context.strokeStyle = COLORS.windMist; context.setLineDash([6,8]); for (const y of [280,540]) { context.beginPath(); context.moveTo(0,y+offset); context.lineTo(1280,y+offset); context.stroke(); } context.setLineDash([]); }
    else if (motif === 'clock') { context.strokeStyle = COLORS.gold; for (const x of [260,1020]) { context.beginPath(); context.arc(x,360+offset,64,0,Math.PI*2); context.stroke(); for(let a=0;a<8;a+=1){context.beginPath();context.moveTo(x+Math.cos(a*Math.PI/4)*64,360+offset+Math.sin(a*Math.PI/4)*64);context.lineTo(x+Math.cos(a*Math.PI/4)*78,360+offset+Math.sin(a*Math.PI/4)*78);context.stroke();} } }
    else if (motif === 'storm') { context.strokeStyle = COLORS.warning; context.lineWidth=3; context.beginPath(); context.moveTo(300,80+offset);context.lineTo(360,190+offset);context.lineTo(330,190+offset);context.lineTo(400,310+offset);context.stroke(); context.strokeStyle=COLORS.windMist;context.lineWidth=2;context.beginPath();context.moveTo(312,82+offset);context.lineTo(372,190+offset);context.lineTo(342,190+offset);context.lineTo(412,310+offset);context.stroke(); }
    else { context.strokeStyle=COLORS.signalRose; for(const [x,y] of [[320,200],[640,520],[960,220]]){context.beginPath();context.arc(x,y+offset,6,0,Math.PI*2);context.fillStyle=COLORS.signalRose;context.fill();context.moveTo(x-16,y+offset);context.lineTo(x+16,y+offset);context.moveTo(x,y-16+offset);context.lineTo(x,y+16+offset);context.stroke();} }
    context.restore(); return true;
  }

  /**
   * L1 먼 우편탑 실루엣을 카메라 이동량의 0.15배로 그린다.
   * @returns {void}
   */
  function drawDistantTowers() {
    const offset = reducedMotion ? 0 : -(cameraY * 0.15) % 220;
    if (drawMotifDistance(offset)) return;
    context.save();
    context.globalAlpha = 0.32;
    context.fillStyle = COLORS.steel;
    context.fillRect(80, 250 + offset, 180, 720);
    context.fillRect(1010, 160 + offset, 150, 800);
    context.fillStyle = COLORS.brass;
    context.fillRect(142, 200 + offset, 56, 60);
    context.fillRect(1056, 116 + offset, 58, 54);
    if ((snapshot?.checkpointId ?? 0) >= 3) {
      context.strokeStyle = (snapshot?.checkpointId ?? 0) >= 6 ? COLORS.violet : COLORS.windTeal;
      context.lineWidth = 3;
      context.beginPath(); context.arc(640, 360 + offset, 260, Math.PI, Math.PI * 2); context.stroke();
    }
    context.restore();
  }

  /**
   * L2 비충돌 창과 배관을 카메라 이동량의 0.45배로 그린다.
   * @returns {void}
   */
  function drawMidStructures() {
    const offset = reducedMotion ? 0 : -(cameraY * 0.45) % 360;
    if (drawMotifMiddle(offset)) return;
    context.save();
    context.globalAlpha = 0.28;
    context.strokeStyle = COLORS.cream;
    context.lineWidth = 2;
    for (let y = -120 + offset; y < canvas.height + 180; y += 360) {
      context.strokeRect(386, y, 264, 24);
      context.fillStyle = COLORS.brass;
      for (let x = 404; x < 634; x += 56) context.fillRect(x, y + 9, 18, 4);
    }
    if ((snapshot?.checkpointId ?? 0) >= 3 && (snapshot?.checkpointId ?? 0) < 6) {
      context.strokeStyle = COLORS.windTeal;
      context.lineWidth = 3;
      context.beginPath(); context.arc(640, 360, 300, 0, Math.PI * 2); context.stroke();
      for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
        context.beginPath(); context.moveTo(640, 360); context.lineTo(640 + Math.cos(angle) * 300, 360 + Math.sin(angle) * 300); context.stroke();
      }
    } else if ((snapshot?.checkpointId ?? 0) >= 6) {
      context.strokeStyle = COLORS.violet;
      for (let x = 80; x < 1280; x += 128) {
        context.beginPath(); context.moveTo(x, 720); context.lineTo(x + 64, 540); context.lineTo(x + 128, 720); context.stroke();
      }
    }
    context.restore();
  }

  /**
   * L3 이동 가능한 발판과 추락 경계를 그린다.
   * @returns {void}
   */
  function drawGeometry() {
    for (const platform of level().platforms) {
      const device = Number.isInteger(platform.deviceIndex) ? snapshot?.devices?.[platform.deviceIndex] : null;
      const active = !device || device.state !== 'IDLE';
      const nonSolid = device?.solid === false;
      context.globalAlpha = nonSolid ? 0.12 : active ? 1 : 0.22;
      context.fillStyle = COLORS.steel;
      context.strokeStyle = nonSolid ? COLORS.steel : COLORS.cream;
      context.lineWidth = 2;
      context.fillRect(platform.x, platform.y, platform.width, platform.height);
      if (nonSolid) context.setLineDash([6, 8]);
      context.strokeRect(platform.x, platform.y, platform.width, platform.height);
      context.setLineDash([]);
      if (nonSolid) {
        context.globalAlpha = 0.72; context.beginPath(); const centerX = platform.x + platform.width / 2; const centerY = platform.y + platform.height / 2; context.moveTo(centerX, centerY - 7); context.lineTo(centerX + 7, centerY); context.lineTo(centerX, centerY + 7); context.lineTo(centerX - 7, centerY); context.closePath(); context.stroke();
      } else {
        context.fillStyle = COLORS.void; context.fillRect(platform.x, platform.y + platform.height - 4, platform.width, 4);
        context.fillStyle = COLORS.brass; for (let x = platform.x + 18; x < platform.x + platform.width - 8; x += 56) context.fillRect(x, platform.y + 8, 18, 4);
      }
      if (device?.warning) {
        context.globalAlpha = 1; context.strokeStyle = COLORS.warning; context.lineWidth = 3; context.strokeRect(platform.x - 2, platform.y - 2, platform.width + 4, platform.height + 4);
        context.lineWidth = 2; for (let mark = 0; mark < 12; mark += 1) { const x = platform.x + (mark + 0.5) * platform.width / 12; context.beginPath(); context.moveTo(x - 4, platform.y + platform.height + 3); context.lineTo(x + 4, platform.y + platform.height + 11); context.stroke(); }
      }
    }
    context.globalAlpha = 1;
    context.strokeStyle = COLORS.danger;
    context.lineWidth = 3;
    context.setLineDash([12, 12]);
    context.beginPath(); context.moveTo(0, level().world.dangerY - 12); context.lineTo(level().world.width, level().world.dangerY - 12); context.stroke();
    context.setLineDash([]);
    for (let x = 18; x < level().world.width; x += 36) {
      context.beginPath(); context.moveTo(x, level().world.dangerY - 22); context.lineTo(x + 12, level().world.dangerY - 10); context.stroke();
      context.beginPath(); context.moveTo(x + 6, level().world.dangerY + 2); context.lineTo(x + 6, level().world.dangerY + 16); context.lineTo(x, level().world.dangerY + 10); context.moveTo(x + 6, level().world.dangerY + 16); context.lineTo(x + 12, level().world.dangerY + 10); context.stroke();
    }
  }

  /**
   * 봉투 모양 우편 인장을 그린다.
   * @param {number} x 중심 X
   * @param {number} y 중심 Y
   * @param {string} color 선 색
   * @returns {void}
   */
  function drawEnvelopeSeal(x, y, color) {
    context.strokeStyle = color;
    context.lineWidth = 2;
    context.strokeRect(x - 8, y - 5, 16, 10);
    context.beginPath(); context.moveTo(x - 8, y - 5); context.lineTo(x, y + 1); context.lineTo(x + 8, y - 5); context.stroke();
  }

  /**
   * 장치 상태 아이콘을 글꼴 없이 선과 원으로 그린다.
   * @param {string} state 장치 상태
   * @param {number} x 중심 X
   * @param {number} y 중심 Y
   * @returns {void}
   */
  function drawStateIcon(state, x, y) {
    context.lineWidth = 2;
    if (state === 'LATCHED') {
      context.beginPath(); context.moveTo(x - 7, y); context.lineTo(x - 1, y + 6); context.lineTo(x + 8, y - 7); context.stroke();
    } else if (state === 'POWERED') {
      context.beginPath(); context.arc(x, y, 7, 0, Math.PI * 2); context.stroke();
      context.beginPath(); context.arc(x, y, 2, 0, Math.PI * 2); context.fill();
    } else {
      context.beginPath(); context.moveTo(x, y - 7); context.lineTo(x + 7, y); context.lineTo(x, y + 7); context.lineTo(x - 7, y); context.closePath(); context.stroke();
    }
  }

  /**
   * 72×96 우편함·별자리 비콘 체크포인트를 그린다.
   * @param {object} module 모듈 정의
   * @param {number} index 모듈 인덱스
   * @param {number} elapsed 애니메이션 시간
   * @returns {void}
   */
  function drawCheckpoint(module, index, elapsed) {
    const active = snapshot?.checkpointId > index;
    const zone = module.checkpoint;
    const centerX = zone.x + zone.width / 2;
    const top = zone.y - 6;
    context.save();
    context.globalAlpha = active ? 0.34 : 0.18;
    context.strokeStyle = active ? COLORS.green : COLORS.cream;
    context.lineWidth = 2;
    context.setLineDash([8, 8]);
    context.strokeRect(zone.x, zone.y, zone.width, zone.height);
    context.setLineDash([]);
    context.globalAlpha = 1;
    context.fillStyle = active ? COLORS.panel : COLORS.steel;
    context.strokeStyle = active ? COLORS.gold : COLORS.cream;
    context.lineWidth = 2;
    context.beginPath(); context.roundRect(centerX - 36, top, 72, 96, 8); context.fill(); context.stroke();
    context.fillStyle = COLORS.void;
    context.fillRect(centerX - 28, top + 32, 56, 44);
    context.strokeStyle = active ? COLORS.green : COLORS.cream;
    drawEnvelopeSeal(centerX, top + 54, active ? COLORS.green : COLORS.cream);
    const breathing = reducedMotion ? 0.72 : 0.58 + Math.sin(elapsed / 223) * 0.14;
    context.globalAlpha = active ? breathing : 0.35;
    context.fillStyle = active ? COLORS.gold : COLORS.cream;
    context.beginPath(); context.arc(centerX, top + 18, active ? 10 : 6, 0, Math.PI * 2); context.fill();
    context.globalAlpha = 1;
    const activatedAt = checkpointActivatedAt.get(index);
    if (active && activatedAt && elapsed - activatedAt < 320) {
      const progress = (elapsed - activatedAt) / 320;
      context.globalAlpha = 0.35 * (1 - progress);
      context.fillStyle = COLORS.gold;
      context.fillRect(centerX - 10, top - progress * 76, 20, 76);
    }
    context.restore();
  }

  /**
   * Phase 2 장치 타입별 풍향·관측 메커니즘을 서버 시계 위상으로 그린다.
   * @param {object} module 모듈 정의
   * @param {object} device 장치 상태
   * @returns {void}
   */
  function drawPhase2Mechanism(module, device) {
    if (module.type === 'sorter') return;
    const powered = device.state === 'POWERED';
    const latched = device.state === 'LATCHED';
    const phaseMs = snapshot?.elapsedMs ?? 0;
    const stateAge = Math.max(0, phaseMs - (device.stateChangedMs ?? 0));
    context.save();
    context.lineWidth = 3;
    if (module.type === 'rotary') {
      context.strokeStyle = latched ? COLORS.green : powered ? COLORS.gold : COLORS.windTeal;
      context.translate(module.switch.x, module.switch.y);
      const transitionAngle = device.angle ?? 0;
      const targetAngle = device.targetAngle ?? transitionAngle;
      const latchProgress = Math.min(1, stateAge / 240);
      const angle = powered ? transitionAngle : latched && !reducedMotion ? transitionAngle + (targetAngle - transitionAngle) * (1 - (1 - latchProgress) ** 3) : transitionAngle;
      context.rotate(angle);
      context.beginPath(); context.arc(0, 0, 80, 0, Math.PI * 2); context.stroke();
      for (let index = 0; index < 8; index += 1) { context.rotate(Math.PI / 4); context.strokeStyle = index === 0 && powered ? COLORS.gold : latched ? COLORS.green : COLORS.windTeal; context.beginPath(); context.moveTo(18, 0); context.lineTo(76, 0); context.stroke(); }
      context.beginPath(); context.arc(0, 0, 18, 0, Math.PI * 2); context.stroke();
      context.fillStyle = COLORS.steel; context.strokeStyle = COLORS.cream;
      // 서로 반대편 궤도에 독립 중심을 둬 140×24px 발판 두 장이 겹치지 않게 한다.
      context.fillRect(-70, -68, 140, 24); context.strokeRect(-70, -68, 140, 24);
      context.fillRect(-70, 44, 140, 24); context.strokeRect(-70, 44, 140, 24);
      if (latched) {
        context.strokeStyle = COLORS.green;
        for (let pin = 0; pin < 4; pin += 1) { context.rotate(Math.PI / 2); context.beginPath(); context.moveTo(28, 0); context.lineTo(38, 0); context.stroke(); }
        context.beginPath(); context.moveTo(-8, 0); context.lineTo(-2, 7); context.lineTo(10, -8); context.stroke();
      }
    } else if (module.type === 'wind-shutter') {
      // 서버 snapshot의 solid/경고 상태만 사용해 셔터 면과 남은 주기를 표현한다.
      const opening = latched || (powered && !device.solid) ? 68 : 0;
      context.strokeStyle = latched ? COLORS.green : COLORS.windTeal;
      context.strokeRect(module.switch.x - 82, module.switch.y - 84, 28, 168);
      context.strokeRect(module.switch.x + 54, module.switch.y - 84, 28, 168);
      context.fillStyle = COLORS.windTeal;
      for (let blade = 0; blade < 6; blade += 1) {
        const side = blade < 3 ? -1 : 1;
        const baseX = module.switch.x + side * (9 + (blade % 3) * 18 + opening);
        context.fillRect(baseX - 9, module.switch.y - 56, 18, 112);
      }
      context.strokeStyle = COLORS.danger;
      context.setLineDash([12, 12]); context.strokeRect(module.switch.x - 68, module.switch.y - 62, 136, 124); context.setLineDash([]);
      const warningCount = device.warning ? 12 : powered && !device.solid ? 6 : 0;
      for (let mark = 0; mark < 12; mark += 1) {
        context.strokeStyle = mark < warningCount ? COLORS.warning : COLORS.steel;
        context.beginPath(); context.moveTo(module.switch.x - 66 + mark * 12, module.switch.y + 74); context.lineTo(module.switch.x - 60 + mark * 12, module.switch.y + 68); context.lineTo(module.switch.x - 54 + mark * 12, module.switch.y + 74); context.stroke();
        context.strokeRect(module.switch.x - 70 + mark * 12, module.switch.y - 104, 8, 6);
      }
      if (latched) {
        context.strokeStyle = COLORS.brass;
        for (const y of [-70, 70]) { context.strokeRect(module.switch.x - 72, module.switch.y + y - 5, 18, 10); context.strokeRect(module.switch.x + 54, module.switch.y + y - 5, 18, 10); }
      }
    } else if (module.type === 'updraft') {
      const ribbonProgress = latched ? 1 : device.active ? Math.min(1, stateAge / 300) : 0;
      const ribbonLength = 36 + ribbonProgress * 60;
      context.strokeStyle = latched ? COLORS.green : COLORS.windMist;
      context.strokeRect(module.switch.x - 48, module.switch.y + 8, 96, 72);
      const latchProgress = latched ? 1 - (1 - Math.min(1, stateAge / 240)) ** 3 : 0;
      const platformTop = module.switch.y - 58 - latchProgress * 24;
      context.strokeRect(module.switch.x - 90, platformTop, 180, 24);
      context.globalAlpha = 0.3; context.strokeRect(module.switch.x - 100, module.switch.y - 112, 200, 196); context.globalAlpha = 1;
      const rotation = device.active && !reducedMotion ? (device.phaseMs ?? 0) / 900 * Math.PI * 2 : 0;
      for (let fan = 0; fan < 4; fan += 1) {
        const angle = rotation + fan * Math.PI / 2;
        context.beginPath(); context.moveTo(module.switch.x, module.switch.y + 44); context.lineTo(module.switch.x + Math.cos(angle) * 32, module.switch.y + 44 + Math.sin(angle) * 24); context.stroke();
      }
      context.globalAlpha = device.active ? 0.42 : 0.18;
      for (let ribbon = -2; ribbon <= 2; ribbon += 1) {
        const endY = module.switch.y - 8 - ribbonLength;
        const x = module.switch.x + ribbon * 18;
        context.beginPath(); context.moveTo(x, module.switch.y - 8); context.bezierCurveTo(x + 12, module.switch.y - 36, x - 10, endY + 20, x, endY); context.stroke();
        context.beginPath(); context.moveTo(x - 5, endY + 7); context.lineTo(x, endY); context.lineTo(x + 5, endY + 7); context.stroke();
      }
      context.globalAlpha = 1;
      for (let arrow = 0; arrow < 3; arrow += 1) { context.strokeStyle = powered && stateAge >= arrow * 180 ? COLORS.gold : COLORS.steel; context.beginPath(); context.moveTo(module.switch.x + 62, module.switch.y - 24 - arrow * 18); context.lineTo(module.switch.x + 70, module.switch.y - 32 - arrow * 18); context.lineTo(module.switch.x + 78, module.switch.y - 24 - arrow * 18); context.stroke(); }
      if (latched && latchProgress >= 1) { context.strokeStyle = COLORS.green; context.beginPath(); context.moveTo(module.switch.x - 102, module.switch.y - 70); context.lineTo(module.switch.x - 90, module.switch.y - 70); context.moveTo(module.switch.x + 90, module.switch.y - 70); context.lineTo(module.switch.x + 102, module.switch.y - 70); context.stroke(); }
    } else if (module.type === 'starlight-shutter') {
      context.strokeStyle = latched ? COLORS.green : COLORS.violet;
      context.fillStyle = latched ? COLORS.gold : COLORS.violet;
      context.beginPath(); context.arc(module.switch.x, module.switch.y, 56, 0, Math.PI * 2); context.fill(); context.stroke();
      context.strokeRect(module.switch.x - 120, module.switch.y - 44, 64, 88); context.strokeRect(module.switch.x + 56, module.switch.y - 44, 64, 88);
      context.strokeStyle = latched ? COLORS.green : COLORS.signalRose; context.globalAlpha = latched ? 1 : 0.45;
      for (let node = 0; node < 4; node += 1) {
        const angle = node * Math.PI / 2;
        context.beginPath(); context.arc(module.switch.x + Math.cos(angle) * 42, module.switch.y + Math.sin(angle) * 42, 4, 0, Math.PI * 2); context.stroke();
      }
      context.globalAlpha = 1; context.strokeStyle = COLORS.cream;
      const shutterAngle = latched ? Math.PI / 2 : powered ? Math.min(3, Math.floor(stateAge / 180) + 1) * 15 * Math.PI / 180 : 0;
      context.beginPath(); context.arc(module.switch.x, module.switch.y, 48, shutterAngle, Math.PI + shutterAngle); context.stroke();
      context.beginPath(); context.arc(module.switch.x, module.switch.y, 48, Math.PI - shutterAngle, Math.PI * 2 - shutterAngle); context.stroke();
      for (let signal = 0; signal < 3; signal += 1) { context.strokeStyle = powered && stateAge >= signal * 180 ? COLORS.gold : COLORS.steel; context.beginPath(); context.moveTo(module.switch.x - 18 + signal * 18, module.switch.y + 70); context.lineTo(module.switch.x - 12 + signal * 18, module.switch.y + 60); context.lineTo(module.switch.x - 6 + signal * 18, module.switch.y + 70); context.stroke(); }
      if (latched) {
        context.strokeStyle = COLORS.green; context.lineWidth = 2;
        context.beginPath(); context.moveTo(module.switch.x - 42, module.switch.y); context.lineTo(module.switch.x + 42, module.switch.y); context.moveTo(module.switch.x, module.switch.y - 42); context.lineTo(module.switch.x, module.switch.y + 42); context.stroke();
        context.fillStyle = COLORS.gold; context.beginPath(); context.moveTo(module.switch.x, module.switch.y - 14); context.lineTo(module.switch.x + 6, module.switch.y - 4); context.lineTo(module.switch.x + 14, module.switch.y); context.lineTo(module.switch.x + 6, module.switch.y + 4); context.lineTo(module.switch.x, module.switch.y + 14); context.lineTo(module.switch.x - 6, module.switch.y + 4); context.lineTo(module.switch.x - 14, module.switch.y); context.lineTo(module.switch.x - 6, module.switch.y - 4); context.closePath(); context.fill();
        context.globalAlpha = 0.18; context.lineWidth = 18; context.beginPath(); context.moveTo(module.switch.x, module.switch.y - 56); context.lineTo(module.switch.x, module.switch.y - 220); context.stroke(); context.globalAlpha = 1; context.lineWidth = 6; context.stroke();
      }
    } else if (['cargo-lock', 'docking-lock', 'timer-gate', 'clock-latch', 'lightning-lock', 'moving-car', 'cycle-platform', 'low-gravity', 'signal-link', 'relay', 'safe-ground'].includes(module.type)) {
      const x = module.switch.x; const y = module.switch.y; const active = powered || latched;
      context.strokeStyle = latched ? COLORS.green : active ? COLORS.gold : level().palette.accent; context.fillStyle = COLORS.panel; context.lineWidth = 3;
      if (module.type === 'cargo-lock' || module.type === 'docking-lock') {
        if (module.type === 'cargo-lock') { context.fillRect(x-82,y-46,164,92); context.strokeRect(x-82,y-46,164,92); for(const wheel of [-50,50]){context.beginPath();context.arc(x+wheel,y+52,14,0,Math.PI*2);context.stroke();} }
        else {
          for(const radius of [42,70]){context.beginPath();context.arc(x,y,radius,0,Math.PI*2);context.stroke();} context.beginPath();context.moveTo(x-90,y);context.lineTo(x+90,y);context.moveTo(x,y-90);context.lineTo(x,y+90);context.stroke();
          const safeSpeed = (device.relativeSpeed ?? Infinity) <= 45; const safeHeight = (device.heightDelta ?? Infinity) <= 12;
          for(let cell=0;cell<6;cell+=1){context.fillStyle=cell<Math.min(6,Math.ceil((device.relativeSpeed??0)/15))?(safeSpeed?COLORS.green:cell<3?COLORS.warning:COLORS.danger):COLORS.steel;context.fillRect(x-54+cell*19,y+98,14,8);}
          context.strokeStyle=safeHeight?COLORS.green:COLORS.warning; for(const side of [-1,1]){context.beginPath();context.moveTo(x+side*84,y-12);context.lineTo(x+side*72,y-12);context.moveTo(x+side*84,y+12);context.lineTo(x+side*72,y+12);context.stroke();}
        }
      } else if (['timer-gate','clock-latch','lightning-lock'].includes(module.type)) {
        context.beginPath(); context.arc(x,y,62,0,Math.PI*2); context.fill(); context.stroke();
        const marks = module.type === 'timer-gate' ? 12 : module.type === 'clock-latch' ? 8 : 6; for(let mark=0;mark<marks;mark+=1){const a=mark/marks*Math.PI*2;context.beginPath();context.moveTo(x+Math.cos(a)*45,y+Math.sin(a)*45);context.lineTo(x+Math.cos(a)*59,y+Math.sin(a)*59);context.stroke();}
        if(module.type==='lightning-lock'){context.strokeStyle=COLORS.warning;context.beginPath();context.moveTo(x-8,y-32);context.lineTo(x+10,y-5);context.lineTo(x-4,y-5);context.lineTo(x+12,y+30);context.stroke();}
      } else if (['moving-car','cycle-platform','low-gravity'].includes(module.type)) {
        context.setLineDash([6,8]); context.beginPath(); context.moveTo(x-130,y); context.lineTo(x+130,y); context.stroke(); context.setLineDash([]);
        if(module.type==='moving-car'){context.fillRect(x-76,y-32,152,64);context.strokeRect(x-76,y-32,152,64);context.fillStyle=COLORS.brass;context.fillRect(x-90,y-4,14,8);context.fillRect(x+76,y-4,14,8);}
        else if(module.type==='cycle-platform'){context.beginPath();context.arc(x,y,72,0,Math.PI*2);context.stroke();context.fillRect(x-70,y-12,140,24);context.strokeRect(x-70,y-12,140,24);}
        else {
          context.globalAlpha=device.active ? .62 : .18; for(let ribbon=-2;ribbon<=2;ribbon+=1){context.beginPath();context.moveTo(x+ribbon*20,y+60);context.bezierCurveTo(x+ribbon*20+12,y+20,x+ribbon*20-12,y-20,x+ribbon*20,y-60);context.stroke();} context.globalAlpha=1; context.beginPath();context.ellipse(x,y,90,42,0,0,Math.PI*2);context.stroke();
          for(const player of snapshot?.players??[]){const speed=Math.abs(player.vx??0);const count=speed<90?0:speed<200?1:speed<310?2:3;for(let trail=0;trail<count;trail+=1){const length=[10,16,22][trail];const direction=Math.sign(player.vx)||1;context.globalAlpha=[.32,.22,.14][trail];context.strokeStyle=COLORS.gold;context.beginPath();context.moveTo(player.x-direction*(26+trail*7),player.y+trail*7-7);context.lineTo(player.x-direction*(26+trail*7+length),player.y+trail*7-7);context.stroke();}context.globalAlpha=1;}
        }
      } else if (module.type === 'safe-ground') {
        context.strokeStyle=latched?COLORS.green:COLORS.warning; context.fillRect(x-100,y-18,200,36);context.strokeRect(x-100,y-18,200,36); for(let pin=-80;pin<=80;pin+=40){context.beginPath();context.moveTo(x+pin,y-18);context.lineTo(x+pin,y-34);context.stroke();}
      } else {
        const isRelay = module.type === 'relay'; const nodes = isRelay ? 4 : 3; context.setLineDash([6,8]);context.beginPath();context.moveTo(x-100,y);context.lineTo(x+100,y);context.stroke();context.setLineDash([]);
        for(let node=0;node<nodes;node+=1){const nx=x-72+node*(144/(nodes-1)); context.beginPath(); if(isRelay) context.arc(nx,y+(node%2?24:-24),12,0,Math.PI*2); else {context.moveTo(nx,y-14);context.lineTo(nx+14,y);context.lineTo(nx,y+14);context.lineTo(nx-14,y);context.closePath();} context.stroke();}
      }
      context.strokeStyle=latched?COLORS.green:active?COLORS.gold:COLORS.cream; for(let mark=0;mark<3;mark+=1){context.beginPath();context.arc(x-18+mark*18,y+78,4,0,Math.PI*2);active&&stateAge>=mark*160?context.fill():context.stroke();}
    } else if (module.type === 'merge-lift') {
      const ascent = latched && !reducedMotion ? (1 - Math.cos(Math.min(1, stateAge / 1400) * Math.PI)) / 2 * 140 : latched ? 140 : 0;
      const platformY = module.switch.y - ascent;
      context.strokeStyle = latched ? COLORS.green : COLORS.violet;
      context.fillStyle = COLORS.panel;
      context.fillRect(module.switch.x - 130, platformY - 14, 260, 28); context.strokeRect(module.switch.x - 130, platformY - 14, 260, 28);
      context.strokeRect(module.switch.x - 130, platformY - 46, 24, 64); context.strokeRect(module.switch.x + 106, platformY - 46, 24, 64);
      const occupants = snapshot?.players?.map((player) => ({ player, aboard: Math.abs(player.x - module.switch.x) <= 130 && Math.abs(player.y - platformY) <= 70 })) ?? [];
      for (const entry of occupants) { if (entry.aboard) { context.globalAlpha = 0.45; context.fillStyle = entry.player.id === 'p1' ? COLORS.cyan : COLORS.coral; context.fillRect(entry.player.id === 'p1' ? module.switch.x - 128 : module.switch.x, platformY - 12, 128, 24); context.globalAlpha = 1; } }
      const aboardIds = new Set(occupants.filter((entry) => entry.aboard).map((entry) => entry.player.id));
      const breathingAlpha = reducedMotion ? 0.18 : 0.12 + (Math.sin(phaseMs / 1200 * Math.PI * 2) + 1) * 0.07;
      for (const [playerId, offset, color] of [['p1', -128, COLORS.cyan], ['p2', 0, COLORS.coral]]) {
        if (aboardIds.has(playerId)) continue;
        context.globalAlpha = breathingAlpha; context.fillStyle = color; context.fillRect(module.switch.x + offset, platformY - 12, 128, 24);
      }
      context.globalAlpha = 1;
      context.lineWidth = 2;
      context.strokeStyle = COLORS.cyan; context.fillStyle = COLORS.cyan; context.beginPath(); context.moveTo(module.switch.x - 64, platformY - 8); context.lineTo(module.switch.x - 74, platformY + 9); context.lineTo(module.switch.x - 54, platformY + 9); context.closePath(); aboardIds.has('p1') ? context.fill() : context.stroke();
      context.strokeStyle = COLORS.coral; context.fillStyle = COLORS.coral; for (const x of [module.switch.x + 58, module.switch.x + 70]) { context.beginPath(); context.arc(x, platformY, 3, 0, Math.PI * 2); aboardIds.has('p2') ? context.fill() : context.stroke(); }
      context.strokeStyle = COLORS.gold; context.beginPath(); context.arc(module.switch.x, platformY, 22, 0, Math.PI * 2); context.stroke(); drawEnvelopeSeal(module.switch.x, platformY, powered || latched ? COLORS.gold : COLORS.cream);
      if (powered || latched) { const pinLength = latched ? 12 : 12 * Math.min(1, stateAge / 180); context.strokeStyle = COLORS.green; for (const side of [-1, 1]) { context.beginPath(); context.moveTo(module.switch.x + side * 92, platformY - 18); context.lineTo(module.switch.x + side * (92 + pinLength), platformY - 18); context.moveTo(module.switch.x + side * 92, platformY + 18); context.lineTo(module.switch.x + side * (92 + pinLength), platformY + 18); context.stroke(); } }
      for (let node = 0; node < 6; node += 1) { context.fillStyle = latched && stateAge >= node * 120 ? COLORS.gold : COLORS.violet; context.beginPath(); context.arc(module.switch.x + 154, module.switch.y - node * 26, 4, 0, Math.PI * 2); context.fill(); }
    }
    context.restore();
  }

  /**
   * 단자와 스위치를 상태별 부품·아이콘·발광, 모듈별 인장 수로 그린다.
   * @param {object} module 모듈 정의
   * @param {number} index 모듈 인덱스
   * @returns {void}
   */
  function drawDevice(module, index) {
    const device = snapshot?.devices?.[index] ?? { state: 'IDLE' };
    const powered = device.state === 'POWERED';
    const latched = device.state === 'LATCHED';
    const idleRoleColor = module.requiredPlayerId === 'p1' ? COLORS.cyan : COLORS.coral;
    const color = latched ? COLORS.green : powered ? COLORS.gold : idleRoleColor;
    drawPhase2Mechanism(module, device);
    context.save();
    context.shadowColor = powered || latched ? 'rgba(255,217,122,0.30)' : 'rgba(0,0,0,0)';
    context.shadowBlur = powered || latched ? 9 : 0;
    context.fillStyle = COLORS.panel;
    context.strokeStyle = color;
    context.lineWidth = 3;
    context.beginPath(); context.roundRect(module.anchor.x - 21, module.anchor.y - 27, 42, 54, 6); context.fill(); context.stroke();
    context.fillStyle = color;
    context.beginPath(); context.arc(module.anchor.x, module.anchor.y - 8, 6, 0, Math.PI * 2); context.fill();
    drawStateIcon(device.state, module.anchor.x, module.anchor.y + 14);
    context.fillStyle = COLORS.panel;
    context.beginPath(); context.roundRect(module.switch.x - 36, module.switch.y - 19, 72, 38, 7); context.fill(); context.stroke();
    context.fillStyle = color;
    context.fillRect(module.switch.x - 22, module.switch.y - 3, latched ? 44 : powered ? 28 : 12, 6);
    context.shadowBlur = 0;
    const stampStart = module.switch.x - ((module.number - 1) * 13);
    for (let stamp = 0; stamp < module.number; stamp += 1) drawEnvelopeSeal(stampStart + stamp * 26, module.switch.y - 31, color);
    context.restore();
  }

  /**
   * 48×58 정비 로봇을 팔·다리·가슴 역할표식과 상태 모션으로 그린다.
   * @param {object} player 플레이어 스냅샷
   * @param {number} elapsed 애니메이션 시간
   * @returns {void}
   */
  function drawRobot(player, elapsed) {
    const isA = player.id === 'p1';
    const main = isA ? COLORS.cyan : COLORS.coral;
    const previous = motionState.get(player.id) ?? { grounded: player.grounded, anchored: player.anchored, landedAt: -Infinity, jumpAt: -Infinity, anchoredAt: elapsed };
    if (!previous.grounded && player.grounded) previous.landedAt = elapsed;
    if (previous.grounded && !player.grounded && player.vy < 0) previous.jumpAt = elapsed;
    if (!previous.anchored && player.anchored) previous.anchoredAt = elapsed;
    const idle = player.grounded && Math.abs(player.vx) < 1 && !player.anchored;
    const bob = !reducedMotion && idle ? Math.sin(elapsed * Math.PI * 2 / 1200) * 2 : 0;
    const runningFrame = !reducedMotion && player.grounded && Math.abs(player.vx) > 1 ? Math.floor(elapsed / 90) % 4 : 0;
    const leftArmY = [1, 3, 2, 0][runningFrame];
    const rightArmY = [1, 0, 2, 3][runningFrame];
    const leftLegY = [17, 15, 16, 17][runningFrame];
    const rightLegY = [17, 17, 15, 16][runningFrame];
    const landingProgress = Math.min(1, Math.max(0, (elapsed - previous.landedAt) / 120));
    const landingScale = reducedMotion || elapsed - previous.landedAt > 120 ? 1 : 0.88 + landingProgress * 0.12;
    const jumpProgress = Math.min(1, Math.max(0, (elapsed - previous.jumpAt) / 90));
    const jumpScale = !reducedMotion && !player.grounded && elapsed - previous.jumpAt <= 90 ? 1 - Math.sin(jumpProgress * Math.PI) * 0.1 : 1;
    const fallingTilt = !player.grounded && player.vy > 80 && !reducedMotion ? (Math.floor(elapsed / 140) % 2 ? 10 : -10) * Math.PI / 180 : 0;
    context.save();
    context.translate(Math.round(player.x), Math.round(player.y + bob + (1 - landingScale) * 5));
    context.scale(1, landingScale * jumpScale);
    context.strokeStyle = COLORS.void;
    context.lineWidth = 3;
    context.lineJoin = 'round';
    context.fillStyle = main;
    context.fillRect(-24, leftArmY, 7, 20);
    context.strokeRect(-24, leftArmY, 7, 20);
    context.fillRect(17, rightArmY, 7, 20);
    context.strokeRect(17, rightArmY, 7, 20);
    context.beginPath(); context.roundRect(-17, 0, 34, 24, 5); context.fill(); context.stroke();
    context.fillStyle = COLORS.cream;
    context.beginPath(); context.roundRect(-15, -24, 30, 24, 5); context.fill(); context.stroke();
    context.fillStyle = COLORS.void;
    context.fillRect(-8, -15, 4, 4); context.fillRect(4, -15, 4, 4);
    context.save();
    context.translate(0, -24);
    context.rotate(fallingTilt);
    context.fillStyle = main;
    if (isA) {
      context.beginPath(); context.moveTo(0, -5); context.lineTo(-6, 0); context.lineTo(6, 0); context.closePath(); context.fill(); context.stroke();
    } else {
      context.beginPath(); context.arc(0, -2.5, 2.5, 0, Math.PI * 2); context.fill(); context.stroke();
    }
    context.restore();
    context.fillStyle = COLORS.cream;
    context.fillRect(-12, leftLegY, 8, 12); context.strokeRect(-12, leftLegY, 8, 12);
    context.fillRect(4, rightLegY, 8, 12); context.strokeRect(4, rightLegY, 8, 12);
    context.fillStyle = COLORS.gold;
    context.fillRect(-9, 7, 18, 7);
    context.strokeStyle = COLORS.void;
    context.lineWidth = 2;
    if (isA) {
      context.beginPath(); context.moveTo(-6, 12); context.lineTo(0, 8); context.lineTo(6, 12); context.stroke();
    } else {
      context.fillStyle = COLORS.void;
      context.beginPath(); context.arc(-4, 10.5, 2, 0, Math.PI * 2); context.arc(4, 10.5, 2, 0, Math.PI * 2); context.fill();
    }
    if (player.anchored) {
      const since = elapsed - previous.anchoredAt;
      const closing = Math.min(1, since / 180);
      const alpha = reducedMotion ? 0.65 : 0.45 + (Math.sin(Math.max(0, since - 180) * Math.PI * 2 / 900) + 1) * 0.175;
      context.globalAlpha = alpha;
      context.strokeStyle = COLORS.gold;
      context.lineWidth = 2;
      context.beginPath(); context.ellipse(0, 27, 13 * closing, 4 * closing, 0, 0, Math.PI * 2); context.stroke();
    }
    context.restore();
    Object.assign(previous, { grounded: player.grounded, anchored: player.anchored });
    motionState.set(player.id, previous);
  }

  /**
   * L6 상호작용 범위와 전력 상태 피드백을 그린다.
   * @param {number} elapsed 애니메이션 시간
   * @returns {void}
   */
  function drawWorldFeedback(elapsed) {
    const index = snapshot?.checkpointId ?? 0;
    const module = level().modules[index];
    const device = snapshot?.devices?.[index];
    if (!module || !device) return;
    context.save();
    context.strokeStyle = device.state === 'IDLE' ? (module.requiredPlayerId === 'p1' ? COLORS.cyan : COLORS.coral) : COLORS.gold;
    context.lineWidth = 2;
    context.setLineDash([6, 8]);
    context.globalAlpha = reducedMotion ? 0.42 : 0.35 + Math.sin(elapsed / 180) * 0.08;
    const focus = device.state === 'POWERED' ? module.switch : module.anchor;
    context.beginPath(); context.arc(focus.x, focus.y, 78, 0, Math.PI * 2); context.stroke();
    context.restore();
    if (device.type === 'safe-ground' || device.type === 'lightning-lock') {
      const zone = module.checkpoint;
      context.save();
      if (device.strikeWarning || device.strikeActive) {
        context.strokeStyle = device.strikeActive ? COLORS.danger : COLORS.warning; context.lineWidth = 3; context.setLineDash([]); context.strokeRect(zone.x, zone.y - 120, zone.width, zone.height + 120);
        context.lineWidth = 2; for (let tick = 0; tick < 12; tick += 1) { const x = zone.x + tick * zone.width / 12; context.beginPath(); context.moveTo(x, zone.y - 128); context.lineTo(x + 8, zone.y - 120); context.stroke(); }
        const strikeX = zone.x + zone.width / 2; context.beginPath(); context.moveTo(strikeX - 18, zone.y - 210); context.lineTo(strikeX + 8, zone.y - 166); context.lineTo(strikeX - 4, zone.y - 166); context.lineTo(strikeX + 18, zone.y - 122); context.stroke();
      }
      const half = zone.width / 2;
      for (let role = 0; role < 2; role += 1) {
        const safe = Boolean(device.shelterSafe?.[role]); const centerX = zone.x + half * (role + .5); const roofY = zone.y - 18;
        context.strokeStyle = safe ? COLORS.green : role === 0 ? COLORS.cyan : COLORS.coral; context.lineWidth = safe ? 3 : 2; context.beginPath(); context.moveTo(centerX - half * .35, roofY + 24); context.lineTo(centerX, roofY); context.lineTo(centerX + half * .35, roofY + 24); context.lineTo(centerX + half * .35, roofY + 70); context.lineTo(centerX - half * .35, roofY + 70); context.closePath(); context.stroke();
        context.beginPath(); if (role === 0) { context.moveTo(centerX, roofY + 30); context.lineTo(centerX - 7, roofY + 43); context.lineTo(centerX + 7, roofY + 43); context.closePath(); } else { context.arc(centerX - 5, roofY + 38, 3, 0, Math.PI * 2); context.arc(centerX + 5, roofY + 38, 3, 0, Math.PI * 2); } context.stroke();
      }
      if (device.shelterSafe?.every(Boolean)) { context.strokeStyle = COLORS.green; context.lineWidth = 2; context.setLineDash([6,8]); context.beginPath(); context.moveTo(zone.x + half * .5, zone.y + 62); context.lineTo(zone.x + half * 1.5, zone.y + 62); context.stroke(); }
      context.restore();
    }
  }

  /**
   * 결승 동시 스위치와 서버 시계 기반 2400ms 우편 발사 연출을 그린다.
   * @returns {void}
   */
  function drawFinale() {
    if ((snapshot?.checkpointId ?? 0) < level().modules.length) return;
    const finish = snapshot.finishState;
    context.save();
    const isLaunching = finish.phase === 'launching' || finish.phase === 'complete';
    const rawAge = isLaunching ? (finish.phase === 'complete' ? FINISH.launchMs : Math.max(0, snapshot.elapsedMs - finish.launchStartedMs)) : 0;
    // 감소 모션은 공간 이동 없이 완성 상태를 고정하고 전체 알파만 200ms 한 번 전환한다.
    const finishAlpha = isLaunching ? getFinishCrossfadeAlpha(rawAge, reducedMotion) : 1;
    context.globalAlpha = finishAlpha;
    const expiredAge = finish.expiredAtMs === null ? Infinity : Math.max(0, snapshot.elapsedMs - finish.expiredAtMs);
    const switches = [{ ...FINISH.leftSwitch, side: 'left', color: COLORS.cyan, triangle: true, pressed: finish.leftPressedAt !== null }, { ...FINISH.rightSwitch, side: 'right', color: COLORS.coral, triangle: false, pressed: finish.rightPressedAt !== null }];
    for (const item of switches) {
      const restoring = finish.expiredSide === item.side && expiredAge < 180;
      const pressProgress = item.pressed ? 1 : restoring ? 1 - expiredAge / 180 : 0;
      context.fillStyle = pressProgress > 0 ? item.color : COLORS.panel;
      context.strokeStyle = pressProgress > 0 ? COLORS.green : COLORS.gold;
      context.lineWidth = 3;
      context.beginPath(); context.roundRect(item.x - 48, item.y - 24 + pressProgress * 8, 96, 48, 7); context.fill(); context.stroke();
      if (pressProgress > 0) { context.strokeStyle = COLORS.green; for (const pinX of [-30, 30]) { context.beginPath(); context.moveTo(item.x + pinX, item.y - 28); context.lineTo(item.x + pinX, item.y - 28 + 10 * pressProgress); context.stroke(); } }
      context.strokeStyle = COLORS.cream;
      if (item.triangle) { context.beginPath(); context.moveTo(item.x, item.y - 10); context.lineTo(item.x - 9, item.y + 7); context.lineTo(item.x + 9, item.y + 7); context.closePath(); context.stroke(); }
      else { context.beginPath(); context.arc(item.x - 6, item.y, 3, 0, Math.PI * 2); context.arc(item.x + 6, item.y, 3, 0, Math.PI * 2); context.stroke(); }
      const firstPressedAt = [finish.leftPressedAt, finish.rightPressedAt].filter((value) => value !== null).sort((a, b) => a - b)[0];
      const remainingTicks = firstPressedAt === undefined ? 12 : Math.max(0, Math.ceil((FINISH.windowMs - (snapshot.elapsedMs - firstPressedAt)) / 250));
      const expiredCleared = finish.expiredSide === item.side && expiredAge < 240 ? Math.floor(expiredAge / 20) : finish.expiredSide === item.side && expiredAge >= 240 ? 12 : 0;
      for (let tick = 0; tick < 12; tick += 1) {
        context.globalAlpha = finishAlpha * (tick < remainingTicks && tick < 12 - expiredCleared ? 1 : 0.18);
        const angle = Math.PI + tick / 11 * Math.PI;
        context.beginPath(); context.moveTo(item.x + Math.cos(angle) * 34, item.y + Math.sin(angle) * 34); context.lineTo(item.x + Math.cos(angle) * 42, item.y + Math.sin(angle) * 42); context.stroke();
      }
      context.globalAlpha = finishAlpha;
    }
    context.strokeStyle = finish.phase === 'launching' || finish.phase === 'complete' ? COLORS.green : COLORS.brass;
    context.fillStyle = COLORS.panel;
    context.fillRect(FINISH.launcher.x - 90, FINISH.launcher.y - 110, 180, 220); context.strokeRect(FINISH.launcher.x - 90, FINISH.launcher.y - 110, 180, 220);
    if (isLaunching) {
      const visualAge = reducedMotion ? FINISH.launchMs : rawAge;
      const combine = Math.min(1, visualAge / 300);
      context.strokeStyle = COLORS.green; context.lineWidth = 3;
      context.beginPath(); context.moveTo(FINISH.leftSwitch.x + 48, FINISH.leftSwitch.y); context.lineTo(FINISH.leftSwitch.x + 48 + (FINISH.launcher.x - FINISH.leftSwitch.x - 48) * combine, FINISH.leftSwitch.y + (FINISH.launcher.y - FINISH.leftSwitch.y) * combine); context.moveTo(FINISH.rightSwitch.x - 48, FINISH.rightSwitch.y); context.lineTo(FINISH.rightSwitch.x - 48 + (FINISH.launcher.x - FINISH.rightSwitch.x + 48) * combine, FINISH.rightSwitch.y + (FINISH.launcher.y - FINISH.rightSwitch.y) * combine); context.stroke();
      if (combine >= 1) { context.strokeStyle = COLORS.gold; context.beginPath(); context.moveTo(FINISH.launcher.x, FINISH.launcher.y - 16); context.lineTo(FINISH.launcher.x + 12, FINISH.launcher.y); context.lineTo(FINISH.launcher.x, FINISH.launcher.y + 16); context.lineTo(FINISH.launcher.x - 12, FINISH.launcher.y); context.closePath(); context.stroke(); drawEnvelopeSeal(FINISH.launcher.x, FINISH.launcher.y, COLORS.green); }
      const chargeCount = Math.max(0, Math.min(8, Math.ceil((visualAge - 300) / 75)));
      for (let node = 0; node < 8; node += 1) { context.fillStyle = node < chargeCount ? COLORS.gold : COLORS.steel; context.beginPath(); context.arc(FINISH.launcher.x, FINISH.launcher.y + 84 - node * 20, 5, 0, Math.PI * 2); context.fill(); }
      const launchProgress = Math.max(0, Math.min(1, (visualAge - 900) / 600));
      const capsuleY = FINISH.launcher.y - launchProgress * 320;
      if (launchProgress > 0) { context.strokeStyle = COLORS.gold; context.setLineDash([6, 8]); for (const offset of [-12, 0, 12]) { context.beginPath(); context.moveTo(FINISH.launcher.x + offset, FINISH.launcher.y); context.lineTo(FINISH.launcher.x + offset, capsuleY + 18); context.stroke(); } context.setLineDash([]); }
      context.fillStyle = COLORS.gold; context.strokeStyle = COLORS.cream;
      context.fillRect(FINISH.launcher.x - 22, capsuleY - 14, 44, 28); context.strokeRect(FINISH.launcher.x - 22, capsuleY - 14, 44, 28);
      const sealProgress = Math.max(0, Math.min(1, (visualAge - 1500) / 500));
      if (sealProgress > 0) { context.save(); context.translate(640, 70); context.scale(0.85 + sealProgress * 0.15, 0.85 + sealProgress * 0.15); context.strokeStyle = COLORS.gold; context.lineWidth = 3; context.beginPath(); context.moveTo(0, -36); context.lineTo(14, -12); context.lineTo(36, 0); context.lineTo(14, 12); context.lineTo(0, 36); context.lineTo(-14, 12); context.lineTo(-36, 0); context.lineTo(-14, -12); context.closePath(); context.stroke(); drawEnvelopeSeal(0, 0, COLORS.green); context.restore(); }
      const dimProgress = Math.max(0, Math.min(1, (visualAge - 2000) / 400));
      if (dimProgress > 0) { context.fillStyle = `rgba(7,16,29,${0.46 * dimProgress})`; context.fillRect(0, cameraY, 1280, 720); }
    }
    context.restore();
  }

  /**
   * 한 프레임을 레이어 순서대로 그리고 다음 프레임을 예약한다.
   * @param {number} elapsed requestAnimationFrame 시간
   * @returns {void}
   */
  function render(elapsed) {
    const localPlayer = snapshot?.players?.find((player) => player.id === playerId);
    if (localPlayer) {
      const finaleTarget = level().finish.launcher.y - canvas.height * 0.52;
      const target = Math.max(0, Math.min(level().world.height - canvas.height, (snapshot?.checkpointId ?? 0) >= level().modules.length ? finaleTarget : localPlayer.y - canvas.height * 0.56));
      cameraY = (snapshot?.checkpointId ?? 0) >= level().modules.length || reducedMotion ? target : cameraY + (target - cameraY) * 0.1;
      const module = level().modules[snapshot?.checkpointId ?? 0];
      const device = snapshot?.devices?.[snapshot?.checkpointId ?? 0];
      const partner = snapshot?.players?.find((player) => player.id !== playerId);
      const playerFocusX = partner && Math.abs(partner.x - localPlayer.x) <= 960 ? (localPlayer.x + partner.x) / 2 : localPlayer.x;
      const activeFocus = module ? (device?.state === 'POWERED' ? module.switch.x : device?.state === 'LATCHED' ? module.checkpoint.x + module.checkpoint.width / 2 : module.anchor.x) : playerFocusX;
      const focusX = module ? (activeFocus * .65 + playerFocusX * .35) : playerFocusX;
      const maxCameraX = Math.max(0, level().world.width - canvas.width);
      const targetX = Math.max(0, Math.min(maxCameraX, focusX - canvas.width / 2));
      cameraX = reducedMotion ? targetX : cameraX + (targetX - cameraX) * .1;
    }
    drawSky();
    drawDistantTowers();
    drawMidStructures();
    context.save();
    context.translate(-Math.round(cameraX), -Math.round(cameraY));
    drawGeometry();
    level().modules.forEach((module, index) => { drawCheckpoint(module, index, elapsed); drawDevice(module, index); });
    drawFinale();
    snapshot?.players?.forEach((player) => drawRobot(player, elapsed));
    drawWorldFeedback(elapsed);
    context.restore();
    requestAnimationFrame(render);
  }

  /**
   * 렌더 루프를 시작한다.
   * @returns {void}
   */
  function start() { requestAnimationFrame(render); }

  return { setSnapshot, setPlayerId, start };
}
