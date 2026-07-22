/**
 * @fileoverview 기본 코스와 서로 다른 좌표·물리·동적 지형을 소유한 다섯 레벨 카탈로그를 제공한다.
 */

import { CHECKPOINTS, FINISH, MODULES, PLATFORMS, WORLD } from './level-data.js';

/** @param {number[]} values 좌표 튜플 @returns {{x:number,y:number,width:number,height:number}} */
function rectangle(values) { return { x: values[0], y: values[1], width: values[2], height: values[3] }; }

/**
 * 기본 지형을 보존하면서 모듈별 필수 부스트와 전력 연동 복귀 발판을 합성한다.
 * @param {Array<object>} terrain 기본 27개 지형
 * @param {Array<object>} modules 모듈 정의
 * @returns {{platforms:Array<object>,modules:Array<object>}}
 */
function addCoopRoutes(terrain, modules) {
  const returnPlatforms = modules.map((_, index) => {
    const lower = index === 0 ? terrain.find((platform) => platform.id === 'floor-left') : terrain.find((platform) => platform.id === `m${index}-end`);
    const upper = terrain.find((platform) => platform.id === `m${index + 1}-start`);
    const overlapLeft = Math.max(lower.x, upper.x);
    const overlapRight = Math.min(lower.x + lower.width, upper.x + upper.width);
    const width = Math.min(180, overlapRight - overlapLeft);
    return { id: `m${index + 1}-return`, x: overlapLeft + (overlapRight - overlapLeft - width) / 2, y: (lower.y + upper.y) / 2, width, height: 20, deviceIndex: index, returnPlatform: true, lowerPlatformId: lower.id, upperPlatformId: upper.id };
  });
  return {
    platforms: [...terrain, ...returnPlatforms],
    modules: modules.map((module, index) => ({ ...module, boostRequired: true, approachPlatformId: index === 0 ? 'floor-left' : `m${index}-end`, boostLandingPlatformId: `m${index + 1}-start`, returnPlatformId: `m${index + 1}-return` })),
  };
}

/**
 * 완전한 행 데이터에서 독립 플랫폼과 모듈 배열을 만든다.
 * @param {object} definition 레벨 원본 정의
 * @returns {object}
 */
function buildIndependentLevel(definition) {
  const platforms = [
    { id: 'floor-left', ...rectangle(definition.floor[0]) }, { id: 'floor-right', ...rectangle(definition.floor[1]) },
    ...definition.rows.flatMap((row, index) => ['start', 'route', 'end'].map((kind, part) => ({ id: `m${index + 1}-${kind}`, ...rectangle(row.platforms[part]), ...(part === 1 ? { deviceIndex: index, dynamic: row.dynamic ?? null } : {}) }))),
    { id: 'finish-deck', ...rectangle(definition.finishDeck) },
  ];
  for (let index = 0; index < definition.rows.length; index += 1) {
    const start = platforms.find((platform) => platform.id === `m${index + 1}-start`);
    const route = platforms.find((platform) => platform.id === `m${index + 1}-route`);
    const end = platforms.find((platform) => platform.id === `m${index + 1}-end`);
    if (!route.dynamic || ['rotary', 'merge-lift'].includes(definition.rows[index].type)) {
      const neighbors = [start, end];
      for (const neighbor of neighbors) {
        if (route.x > neighbor.x + neighbor.width + 120) { const extension = route.x - (neighbor.x + neighbor.width + 120); route.x -= extension; route.width += extension; }
        else if (neighbor.x > route.x + route.width + 120) route.width += neighbor.x - (route.x + route.width + 120);
      }
    }
    const safeRise = (definition.physics.gravity ?? 1450) < 1000 ? 175 : 122;
    route.y = Math.max(route.y, start.y - safeRise);
    end.y = Math.max(end.y, route.y - safeRise);
  }
  // 결승 데크가 마지막 모듈 end에서 safeRise 이내에 있도록 보정한다.
  const globalSafeRise = (definition.physics.gravity ?? 1450) < 1000 ? 175 : 122;
  const finishDeck = platforms.find((platform) => platform.id === 'finish-deck');
  const lastEnd = platforms.find((platform) => platform.id === `m${definition.rows.length}-end`);
  const finishYShift = lastEnd && finishDeck && lastEnd.y - finishDeck.y > globalSafeRise ? (lastEnd.y - globalSafeRise + 12) - finishDeck.y : 0;
  if (finishYShift !== 0) finishDeck.y += finishYShift;
  const modules = definition.rows.map((row, index) => ({ id: `${definition.id}-m${index + 1}`, number: index + 1, type: row.type, section: definition.motif, requiredPlayerId: index % 2 === 0 ? 'p1' : 'p2', anchor: { x: row.anchor[0], y: row.anchor[1] }, switch: { x: row.switch[0], y: row.switch[1] }, checkpoint: rectangle(row.zone), mechanics: row.mechanics ?? {} }));
  const coop = addCoopRoutes(platforms, modules);
  return Object.freeze({ id: definition.id, nameKey: definition.nameKey, themeKey: definition.themeKey, descriptionKey: definition.descriptionKey, minutes: definition.minutes, palette: definition.palette, motif: definition.motif, world: { ...definition.world }, physics: { ...definition.physics }, platforms: coop.platforms, checkpoints: definition.checkpoints.map((item, id) => ({ id, x1: item[0], y1: item[1], x2: item[2], y2: item[3] })), finish: { leftSwitch: { x: definition.finish[0], y: definition.finish[1] + finishYShift }, rightSwitch: { x: definition.finish[2], y: definition.finish[3] + finishYShift }, launcher: { x: definition.finish[4], y: definition.finish[5] + finishYShift }, windowMs: definition.finish[6], launchMs: definition.finish[7] }, modules: coop.modules, hazards: definition.hazards.map((item) => ({ ...item })) });
}

const PALETTES = Object.freeze({
  tower: { sky: '#0B1322', haze: '#15213A', structure: '#344B68', accent: '#C68A3A' }, cloud: { sky: '#15213A', haze: '#3E91A3', structure: '#344B68', accent: '#B9E8E7' }, moon: { sky: '#0B1322', haze: '#786EA8', structure: '#344B68', accent: '#FFD97A' }, storm: { sky: '#07101D', haze: '#344B68', structure: '#3E91A3', accent: '#FFB454' }, orbit: { sky: '#07101D', haze: '#786EA8', structure: '#1F2C47', accent: '#D97FA5' },
  ocean: { sky: '#060F1C', haze: '#0A3550', structure: '#1A4560', accent: '#00D4CC' },
  volcano: { sky: '#0E0800', haze: '#3A1200', structure: '#5C2200', accent: '#FF6A1A' },
  crystal: { sky: '#0D0A1E', haze: '#2A1A5E', structure: '#4A2A8E', accent: '#80E8FF' },
  snowpeak: { sky: '#060E1A', haze: '#1A3450', structure: '#305878', accent: '#A8E8FF' },
  desert: { sky: '#0F0A02', haze: '#3C2006', structure: '#6A3A0A', accent: '#FFAA3A' },
  space: { sky: '#040810', haze: '#0A1420', structure: '#162438', accent: '#4AFF8A' },
  glacier: { sky: '#080E16', haze: '#143060', structure: '#1C4882', accent: '#78D8F8' },
  rainforest: { sky: '#050E06', haze: '#0A2810', structure: '#1A4A1A', accent: '#80FF60' },
  factory: { sky: '#080808', haze: '#1A1814', structure: '#342C24', accent: '#FF8030' },
  temple: { sky: '#0A0806', haze: '#2A1E10', structure: '#4A3820', accent: '#D4AA50' },
  garden: { sky: '#070C1A', haze: '#1A3048', structure: '#2A5070', accent: '#80E8C8' },
  library: { sky: '#08090E', haze: '#14182E', structure: '#242840', accent: '#C8A050' },
});

const cloudRows = [
  ['moving-car',[90,3050,350,24],[520,2960,260,24],[990,2840,340,24],[250,3022],[1110,2812],[1010,2760,260,100],{axis:'x',from:520,to:850,periodMs:4200,carryRiders:true}],
  ['timer-gate',[930,2690,360,24],[520,2580,220,24],[140,2490,370,24],[1080,2662],[260,2462],[180,2410,260,100],null,{cycleMs:6000,openMs:2100,transitionMs:240}],
  ['cargo-lock',[100,2340,390,24],[610,2240,200,24],[1030,2150,320,24],[270,2312],[1160,2122],[1050,2070,260,100]],
  ['moving-car',[940,1980,360,24],[560,1880,250,24],[90,1800,390,24],[1120,1952],[220,1772],[130,1720,260,100],{axis:'y',from:1760,to:1980,periodMs:3800,carryRiders:true}],
  ['timer-gate',[80,1630,370,24],[560,1530,220,24],[960,1450,390,24],[240,1602],[1090,1422],[1010,1370,260,100],null,{cycleMs:6000,openMs:2100,transitionMs:240}],
  ['signal-link',[930,1280,390,24],[520,1180,240,24],[150,1100,350,24],[1110,1252],[280,1072],[190,1020,260,100]],
  ['moving-car',[110,930,370,24],[570,830,260,24],[1010,750,330,24],[250,902],[1140,722],[1040,670,260,100],{axis:'x',from:520,to:900,periodMs:3600,carryRiders:true}],
  ['merge-lift',[930,580,390,24],[610,490,220,24],[290,410,390,24],[1100,552],[430,382],[340,330,260,100],{axis:'y',from:490,to:350,periodMs:4800,carryRiders:true}],
];
const moonRows = [
  ['cycle-platform',[70,3670,300,24],[470,3560,190,24],[830,3420,330,24],[210,3642],[970,3392],[880,3340,250,100],null,{cycleMs:3000,solidMs:1800,phaseOffsetMs:0}],
  ['rotary',[850,3230,330,24],[510,3110,220,20],[130,2980,330,24],[1010,3202],[250,2952],[170,2900,250,100],{pivot:[620,3120],length:220,periodMs:4200}],
  ['clock-latch',[90,2790,350,24],[520,2670,210,24],[850,2540,350,24],[240,2762],[1030,2512],[900,2460,250,100],null,{cycleMs:3000,targetMs:1500,toleranceMs:120}],
  ['cycle-platform',[850,2350,350,24],[500,2230,190,24],[100,2100,350,24],[1020,2322],[250,2072],[140,2020,250,100],null,{cycleMs:3000,solidMs:1800,phaseOffsetMs:1500}],
  ['rotary',[80,1910,350,24],[480,1790,230,20],[850,1660,350,24],[230,1882],[1030,1632],[900,1580,250,100],{pivot:[595,1800],length:230,periodMs:3600}],
  ['clock-latch',[850,1470,350,24],[510,1350,180,24],[120,1220,330,24],[1020,1442],[260,1192],[170,1140,250,100],null,{cycleMs:3000,targetMs:0,toleranceMs:120}],
  ['cycle-platform',[100,1030,340,24],[500,910,240,24],[830,780,350,24],[240,1002],[1010,752],[880,700,250,100],null,{cycleMs:3000,solidMs:1800,phaseOffsetMs:750}],
  ['merge-lift',[850,590,330,24],[520,490,220,20],[300,410,360,24],[1010,562],[430,382],[350,330,250,100],{axis:'y',from:490,to:340,periodMs:4800,carryRiders:true}],
];
const stormRows = [
  ['wind-shutter',[90,3280,420,24],[650,3180,230,24],[1080,3030,350,24],[260,3252],[1240,3002],[1120,2950,270,100],null,{forceX:820,activeMs:2400,cycleMs:3600}],
  ['updraft',[1050,2860,370,24],[670,2740,180,24],[170,2650,420,24],[1220,2832],[340,2622],[230,2570,270,100],null,{liftAcceleration:-1900}],
  ['safe-ground',[120,2480,420,24],[650,2360,250,24],[1050,2270,390,24],[280,2452],[1230,2242],[1090,2190,270,100],null,{strikeCycleMs:2400,warningMs:700}],
  ['wind-shutter',[1050,2100,390,24],[620,1980,210,24],[100,1890,430,24],[1220,2072],[250,1862],[140,1810,270,100],null,{forceX:-900,activeMs:2200,cycleMs:3600}],
  ['updraft',[90,1720,420,24],[670,1600,180,24],[1050,1510,390,24],[250,1692],[1210,1482],[1090,1430,270,100],null,{liftAcceleration:-1900}],
  ['lightning-lock',[1050,1340,390,24],[650,1220,230,24],[150,1130,420,24],[1220,1312],[310,1102],[210,1050,270,100],null,{strikeCycleMs:1800,warningMs:900}],
  ['safe-ground',[100,960,430,24],[650,840,250,24],[1040,750,400,24],[260,932],[1210,722],[1080,670,270,100],null,{strikeCycleMs:2400,warningMs:700}],
  ['merge-lift',[1050,580,390,24],[680,480,210,24],[370,410,410,24],[1220,552],[520,382],[420,330,270,100],{axis:'y',from:480,to:330,periodMs:4800,carryRiders:true}],
];
const orbitRows = [
  ['low-gravity',[70,3990,330,24],[540,3840,190,24],[900,3680,350,24],[220,3962],[1050,3652],[950,3600,260,100]],
  ['relay',[900,3500,350,24],[500,3370,220,24],[130,3220,350,24],[1060,3472],[270,3192],[180,3140,260,100]],
  ['docking-lock',[100,3040,370,24],[560,2910,180,24],[880,2760,370,24],[250,3012],[1050,2732],[930,2680,260,100],{axis:'x',from:520,to:760,periodMs:5200,carryRiders:true},{maxRelativeSpeed:45,maxHeightDelta:300}],
  ['low-gravity',[900,2580,350,24],[520,2450,190,24],[100,2300,370,24],[1060,2552],[250,2272],[150,2220,260,100]],
  ['relay',[90,2120,370,24],[540,1990,250,24],[880,1840,370,24],[240,2092],[1050,1812],[930,1760,260,100]],
  ['docking-lock',[900,1660,350,24],[520,1530,190,24],[120,1380,360,24],[1060,1632],[270,1352],[170,1300,260,100],{axis:'x',from:470,to:700,periodMs:4800,carryRiders:true},{maxRelativeSpeed:45,maxHeightDelta:300}],
  ['signal-link',[100,1200,370,24],[550,1070,220,24],[880,920,370,24],[250,1172],[1050,892],[930,840,260,100]],
  ['merge-lift',[900,740,350,24],[560,590,200,24],[330,410,390,24],[1060,712],[470,382],[380,330,260,100],{axis:'y',from:590,to:340,periodMs:5600,carryRiders:true}],
];

// ── 레벨 6: 심해 우편소 (상승 기류 + 타이머 게이트) ──────────────────────
// 세계 너비 1280, 높이 3600. 좌측 출발 → 우측 종착 지그재그.
// 기류(updraft) 2회 + 이동 객차(moving-car) + 주기 발판(cycle-platform) +
// 타이머 게이트(timer-gate) 2회 + 신호 연결(signal-link) + 합체 리프트(merge-lift).
const oceanRows = [
  // m1 (p1): updraft — 좌측 출발, 기류 기둥 통과, 우측 착지
  ['updraft',[70,3380,380,24],[490,3280,180,24],[850,3190,360,24],[200,3352],[1060,3162],[900,3110,260,100],null,{liftAcceleration:-1900}],
  // m2 (p2): timer-gate — 우측 출발, 잠긴 게이트, 좌측 착지
  ['timer-gate',[840,3020,370,24],[490,2930,190,24],[70,2840,390,24],[1060,2992],[200,2812],[100,2760,260,100],null,{cycleMs:5500,openMs:1900,transitionMs:220}],
  // m3 (p1): moving-car — 좌측 출발, 횡이동 객차, 우측 착지
  ['moving-car',[70,2660,390,24],[490,2570,210,24],[840,2480,360,24],[200,2632],[1050,2452],[900,2400,260,100],{axis:'x',from:490,to:820,periodMs:3800,carryRiders:true}],
  // m4 (p2): cycle-platform — 우측 출발, 명멸 발판, 좌측 착지
  ['cycle-platform',[840,2290,360,24],[490,2200,170,24],[70,2110,390,24],[1060,2262],[200,2082],[100,2030,260,100],null,{cycleMs:2800,solidMs:1700,phaseOffsetMs:0}],
  // m5 (p1): updraft — 좌측 출발, 기류 2번째 기둥, 우측 착지
  ['updraft',[70,1920,390,24],[490,1830,180,24],[840,1740,360,24],[200,1892],[1060,1712],[900,1660,260,100],null,{liftAcceleration:-1900}],
  // m6 (p2): timer-gate (빠른 주기) — 우측 출발, 좌측 착지
  ['timer-gate',[840,1560,360,24],[490,1470,190,24],[70,1380,390,24],[1060,1532],[200,1352],[100,1300,260,100],null,{cycleMs:4500,openMs:1500,transitionMs:200}],
  // m7 (p1): signal-link — 좌측 출발, 우측 착지
  ['signal-link',[70,1200,390,24],[490,1110,200,24],[840,1020,360,24],[200,1172],[1050,992],[900,940,260,100]],
  // m8 (p2): merge-lift — 우측 출발, 리프트 탑승, 좌측 착지 (결승 진입)
  ['merge-lift',[840,840,360,24],[490,750,200,20],[80,660,380,24],[1060,812],[180,632],[100,580,280,100],{axis:'y',from:750,to:420,periodMs:5000,carryRiders:true}],
];

// ── 레벨 7: 화산 우편대 (낙뢰 안전지대 + 화염풍) ────────────────────────
// 세계 너비 1400, 높이 3400. 좌측 출발 → 우측 종착 지그재그.
// 안전지대(safe-ground) 2회 + 화염풍(wind-shutter) 2회 + 회전 발판(rotary) +
// 시계 래치(clock-latch) + 번개 잠금(lightning-lock) + 합체 리프트(merge-lift).
const volcanoRows = [
  // m1 (p1): safe-ground — 좌측 출발, 피뢰 타이밍, 우측 착지
  ['safe-ground',[70,3180,420,24],[540,3060,220,24],[920,2970,400,24],[200,3152],[1180,2942],[980,2890,290,100],null,{strikeCycleMs:2400,warningMs:700}],
  // m2 (p2): wind-shutter (좌풍) — 우측 출발, 바람 역주행, 좌측 착지
  ['wind-shutter',[920,2820,400,24],[540,2700,220,24],[70,2620,430,24],[1170,2792],[200,2592],[100,2540,290,100],null,{forceX:-860,activeMs:2200,cycleMs:3400}],
  // m3 (p1): rotary — 좌측 출발, 회전 다리, 우측 착지
  ['rotary',[70,2470,430,24],[540,2350,200,20],[920,2240,400,24],[200,2442],[1150,2212],[980,2160,290,100],{pivot:[645,2360],length:220,periodMs:4000}],
  // m4 (p2): clock-latch — 우측 출발, 시계 박자 맞추기, 좌측 착지
  ['clock-latch',[920,2090,400,24],[540,1970,210,24],[70,1870,430,24],[1170,2062],[200,1842],[100,1790,290,100],null,{cycleMs:3000,targetMs:1500,toleranceMs:120}],
  // m5 (p1): safe-ground (빠른 주기) — 좌측 출발, 우측 착지
  ['safe-ground',[70,1720,430,24],[540,1600,220,24],[920,1510,400,24],[200,1692],[1180,1482],[980,1430,290,100],null,{strikeCycleMs:2000,warningMs:600}],
  // m6 (p2): wind-shutter (우풍) — 우측 출발, 방향 바뀐 화염풍, 좌측 착지
  ['wind-shutter',[920,1360,400,24],[540,1240,220,24],[70,1160,430,24],[1170,1332],[200,1132],[100,1080,290,100],null,{forceX:920,activeMs:2000,cycleMs:3200}],
  // m7 (p1): lightning-lock — 좌측 출발, 우측 착지
  ['lightning-lock',[70,1010,430,24],[540,890,220,24],[920,810,400,24],[200,982],[1180,782],[980,730,290,100],null,{strikeCycleMs:1800,warningMs:900}],
  // m8 (p2): merge-lift — 우측 출발, 리프트 탑승, 좌측 착지 (결승 진입)
  ['merge-lift',[920,660,400,24],[550,560,200,20],[80,480,420,24],[1160,632],[190,452],[100,400,300,100],{axis:'y',from:560,to:400,periodMs:4800,carryRiders:true}],
];

// ── 레벨 8: 수정 궁전 (저중력 + 신호 연결) ──────────────────────────────
// 세계 너비 1280, 높이 3600 (템플릿 A). 좌측 출발 → 우측 종착 지그재그.
// relay + rotary + cycle-platform + cargo-lock + low-gravity + docking-lock + signal-link + merge-lift.
const crystalRows = [
  // m1 (p1): relay
  ['relay',[70,3370,390,24],[480,3270,190,24],[840,3180,360,24],[200,3342],[1060,3152],[900,3130,260,100]],
  // m2 (p2): rotary — route h=20, 회전 발판
  ['rotary',[840,3000,360,24],[480,2900,190,20],[70,2820,390,24],[1060,2972],[200,2792],[100,2770,260,100],{pivot:[575,2900],length:190,periodMs:3800}],
  // m3 (p1): cycle-platform
  ['cycle-platform',[70,2640,390,24],[480,2540,190,24],[840,2450,360,24],[200,2612],[1060,2422],[900,2400,260,100],null,{cycleMs:2600,solidMs:1500,phaseOffsetMs:0}],
  // m4 (p2): cargo-lock
  ['cargo-lock',[840,2270,360,24],[480,2170,190,24],[70,2090,390,24],[1060,2242],[200,2062],[100,2040,260,100]],
  // m5 (p1): low-gravity
  ['low-gravity',[70,1910,390,24],[480,1820,190,24],[840,1740,360,24],[200,1882],[1060,1712],[900,1690,260,100]],
  // m6 (p2): docking-lock
  ['docking-lock',[840,1540,360,24],[480,1440,190,24],[70,1360,390,24],[1060,1512],[200,1332],[100,1310,260,100],null,{maxRelativeSpeed:120,maxHeightDelta:300}],
  // m7 (p1): signal-link
  ['signal-link',[70,1180,390,24],[480,1080,190,24],[840,1000,360,24],[200,1152],[1060,972],[900,950,260,100]],
  // m8 (p2): merge-lift — 템플릿 A 표준 dynamic
  ['merge-lift',[840,820,360,24],[480,730,190,20],[70,650,390,24],[1060,792],[200,622],[100,600,260,100],{axis:'y',from:730,to:430,periodMs:5000,carryRiders:true}],
];

// ── 레벨 9: 설산 우편탑 (눈보라 + 시계 장치) ──────────────────────────────
// 세계 너비 1280, 높이 3700 (템플릿 B). 좌측 출발 → 우측 종착 지그재그.
// moving-car + wind-shutter + cycle-platform + updraft + signal-link + clock-latch + timer-gate + merge-lift.
const snowpeakRows = [
  // m1 (p1): moving-car
  ['moving-car',[70,3470,390,24],[480,3350,190,24],[840,3260,360,24],[200,3442],[1060,3232],[900,3210,260,100],{axis:'x',from:480,to:800,periodMs:3600,carryRiders:true}],
  // m2 (p2): wind-shutter
  ['wind-shutter',[840,3100,360,24],[480,2980,190,24],[70,2900,390,24],[1060,3072],[200,2872],[100,2850,260,100],null,{forceX:780,activeMs:2000,cycleMs:3200}],
  // m3 (p1): cycle-platform
  ['cycle-platform',[70,2730,390,24],[480,2610,190,24],[840,2530,360,24],[200,2702],[1060,2502],[900,2480,260,100],null,{cycleMs:2800,solidMs:1600,phaseOffsetMs:0}],
  // m4 (p2): updraft
  ['updraft',[840,2360,360,24],[480,2240,190,24],[70,2160,390,24],[1060,2332],[200,2132],[100,2110,260,100],null,{liftAcceleration:-1900}],
  // m5 (p1): signal-link
  ['signal-link',[70,1990,390,24],[480,1870,190,24],[840,1780,360,24],[200,1962],[1060,1752],[900,1730,260,100]],
  // m6 (p2): clock-latch
  ['clock-latch',[840,1620,360,24],[480,1500,190,24],[70,1420,390,24],[1060,1592],[200,1392],[100,1370,260,100],null,{cycleMs:3000,targetMs:1500,toleranceMs:120}],
  // m7 (p1): timer-gate
  ['timer-gate',[70,1250,390,24],[480,1130,190,24],[840,1050,360,24],[200,1222],[1060,1022],[900,1000,260,100],null,{cycleMs:4800,openMs:1700,transitionMs:200}],
  // m8 (p2): merge-lift — 템플릿 B 표준 dynamic
  ['merge-lift',[840,880,360,24],[480,780,190,20],[70,700,390,24],[1060,852],[200,672],[100,650,260,100],{axis:'y',from:780,to:430,periodMs:5000,carryRiders:true}],
];

// ── 레벨 10: 사막 우편로 (모래폭풍 + 낙뢰) ──────────────────────────────
// 세계 너비 1400, 높이 3400 (템플릿 C). gravity 1600. 좌측 출발 → 우측 종착 지그재그.
// wind-shutter + safe-ground + cargo-lock + moving-car + relay + cycle-platform + clock-latch + merge-lift.
const desertRows = [
  // m1 (p1): wind-shutter
  ['wind-shutter',[70,3180,430,24],[490,3080,200,24],[970,2990,360,24],[200,3152],[1110,2962],[1010,2940,260,100],null,{forceX:-800,activeMs:2200,cycleMs:3600}],
  // m2 (p2): safe-ground
  ['safe-ground',[970,2810,360,24],[490,2710,200,24],[70,2630,430,24],[1110,2782],[200,2602],[100,2580,260,100],null,{strikeCycleMs:2200,warningMs:700}],
  // m3 (p1): cargo-lock
  ['cargo-lock',[70,2440,430,24],[490,2340,200,24],[970,2260,360,24],[200,2412],[1110,2232],[1010,2210,260,100]],
  // m4 (p2): moving-car — route 폭 확장으로 start와의 수평 간격 축소
  ['moving-car',[970,2080,360,24],[490,1980,340,24],[70,1900,430,24],[1110,2052],[200,1872],[100,1850,260,100],{axis:'x',from:490,to:850,periodMs:4000,carryRiders:true}],
  // m5 (p1): relay
  ['relay',[70,1720,430,24],[490,1620,200,24],[970,1540,360,24],[200,1692],[1110,1512],[1010,1490,260,100]],
  // m6 (p2): cycle-platform
  ['cycle-platform',[970,1360,360,24],[490,1260,200,24],[70,1180,430,24],[1110,1332],[200,1152],[100,1130,260,100],null,{cycleMs:2800,solidMs:1600,phaseOffsetMs:0}],
  // m7 (p1): clock-latch
  ['clock-latch',[70,1000,430,24],[490,900,200,24],[970,820,360,24],[200,972],[1110,792],[1010,770,260,100],null,{cycleMs:3200,targetMs:1600,toleranceMs:130}],
  // m8 (p2): merge-lift — 템플릿 C 표준 dynamic
  ['merge-lift',[970,640,360,24],[490,550,200,20],[70,470,430,24],[1110,612],[200,442],[100,420,260,100],{axis:'y',from:550,to:320,periodMs:5200,carryRiders:true}],
];

// ── 레벨 11: 우주정거장 (도킹 + 무중력 구역) ─────────────────────────────
// 세계 너비 1280, 높이 3600 (템플릿 A). 좌측 출발 → 우측 종착 지그재그.
// docking-lock + low-gravity + signal-link + relay + timer-gate + cargo-lock + rotary + merge-lift.
const spaceRows = [
  // m1 (p1): docking-lock
  ['docking-lock',[70,3370,390,24],[480,3270,190,24],[840,3180,360,24],[200,3342],[1060,3152],[900,3130,260,100],null,{maxRelativeSpeed:130,maxHeightDelta:300}],
  // m2 (p2): low-gravity
  ['low-gravity',[840,3000,360,24],[480,2900,190,24],[70,2820,390,24],[1060,2972],[200,2792],[100,2770,260,100]],
  // m3 (p1): signal-link
  ['signal-link',[70,2640,390,24],[480,2540,190,24],[840,2450,360,24],[200,2612],[1060,2422],[900,2400,260,100]],
  // m4 (p2): relay
  ['relay',[840,2270,360,24],[480,2170,190,24],[70,2090,390,24],[1060,2242],[200,2062],[100,2040,260,100]],
  // m5 (p1): timer-gate
  ['timer-gate',[70,1910,390,24],[480,1810,190,24],[840,1730,360,24],[200,1882],[1060,1702],[900,1680,260,100],null,{cycleMs:5000,openMs:1800,transitionMs:220}],
  // m6 (p2): cargo-lock
  ['cargo-lock',[840,1540,360,24],[480,1440,190,24],[70,1360,390,24],[1060,1512],[200,1332],[100,1310,260,100]],
  // m7 (p1): rotary — route h=20
  ['rotary',[70,1180,390,24],[480,1080,190,20],[840,1000,360,24],[200,1152],[1060,972],[900,950,260,100],{pivot:[575,1080],length:190,periodMs:4200}],
  // m8 (p2): merge-lift — 템플릿 A 표준 dynamic
  ['merge-lift',[840,820,360,24],[480,730,190,20],[70,650,390,24],[1060,792],[200,622],[100,600,260,100],{axis:'y',from:730,to:430,periodMs:5000,carryRiders:true}],
];

// ── 레벨 12: 빙하 우편부 (빙하 기류 + 타이밍) ─────────────────────────────
// 세계 너비 1280, 높이 3700 (템플릿 B). 좌측 출발 → 우측 종착 지그재그.
// updraft + moving-car + cycle-platform + wind-shutter + signal-link + clock-latch + timer-gate + merge-lift.
const glacierRows = [
  // m1 (p1): updraft
  ['updraft',[70,3470,390,24],[480,3370,190,24],[840,3280,360,24],[200,3442],[1060,3252],[900,3230,260,100],null,{liftAcceleration:-1900}],
  // m2 (p2): moving-car — route 폭 확장으로 start와의 수평 간격 축소
  ['moving-car',[840,3100,360,24],[480,3000,330,24],[70,2920,390,24],[1060,3072],[200,2892],[100,2870,260,100],{axis:'x',from:480,to:800,periodMs:3800,carryRiders:true}],
  // m3 (p1): cycle-platform
  ['cycle-platform',[70,2730,390,24],[480,2630,190,24],[840,2550,360,24],[200,2702],[1060,2522],[900,2500,260,100],null,{cycleMs:2600,solidMs:1500,phaseOffsetMs:0}],
  // m4 (p2): wind-shutter
  ['wind-shutter',[840,2360,360,24],[480,2260,190,24],[70,2180,390,24],[1060,2332],[200,2152],[100,2130,260,100],null,{forceX:-780,activeMs:2000,cycleMs:3200}],
  // m5 (p1): signal-link
  ['signal-link',[70,1990,390,24],[480,1890,190,24],[840,1800,360,24],[200,1962],[1060,1772],[900,1750,260,100]],
  // m6 (p2): clock-latch
  ['clock-latch',[840,1620,360,24],[480,1520,190,24],[70,1440,390,24],[1060,1592],[200,1412],[100,1390,260,100],null,{cycleMs:3000,targetMs:1500,toleranceMs:120}],
  // m7 (p1): timer-gate
  ['timer-gate',[70,1250,390,24],[480,1150,190,24],[840,1070,360,24],[200,1222],[1060,1042],[900,1020,260,100],null,{cycleMs:5000,openMs:1900,transitionMs:220}],
  // m8 (p2): merge-lift — 템플릿 B 표준 dynamic
  ['merge-lift',[840,880,360,24],[480,790,190,20],[70,710,390,24],[1060,852],[200,682],[100,660,260,100],{axis:'y',from:790,to:440,periodMs:5000,carryRiders:true}],
];

// ── 레벨 13: 열대우림 우편소 (회전 덩굴 + 낙뢰) ──────────────────────────
// 세계 너비 1280, 높이 3600 (템플릿 A). 좌측 출발 → 우측 종착 지그재그.
// cycle-platform + updraft + cargo-lock + moving-car + rotary + relay + lightning-lock + merge-lift.
const rainforestRows = [
  // m1 (p1): cycle-platform
  ['cycle-platform',[70,3370,390,24],[480,3270,190,24],[840,3180,360,24],[200,3342],[1060,3152],[900,3130,260,100],null,{cycleMs:3000,solidMs:1800,phaseOffsetMs:0}],
  // m2 (p2): updraft
  ['updraft',[840,3000,360,24],[480,2900,190,24],[70,2820,390,24],[1060,2972],[200,2792],[100,2770,260,100],null,{liftAcceleration:-1900}],
  // m3 (p1): cargo-lock
  ['cargo-lock',[70,2640,390,24],[480,2540,190,24],[840,2450,360,24],[200,2612],[1060,2422],[900,2400,260,100]],
  // m4 (p2): moving-car — route 폭 확장으로 start와의 수평 간격 축소
  ['moving-car',[840,2270,360,24],[480,2170,330,24],[70,2090,390,24],[1060,2242],[200,2062],[100,2040,260,100],{axis:'x',from:480,to:800,periodMs:3800,carryRiders:true}],
  // m5 (p1): rotary — route h=20
  ['rotary',[70,1910,390,24],[480,1810,190,20],[840,1730,360,24],[200,1882],[1060,1702],[900,1680,260,100],{pivot:[575,1810],length:190,periodMs:4000}],
  // m6 (p2): relay
  ['relay',[840,1540,360,24],[480,1440,190,24],[70,1360,390,24],[1060,1512],[200,1332],[100,1310,260,100]],
  // m7 (p1): lightning-lock
  ['lightning-lock',[70,1180,390,24],[480,1080,190,24],[840,1000,360,24],[200,1152],[1060,972],[900,950,260,100],null,{strikeCycleMs:2000,warningMs:800}],
  // m8 (p2): merge-lift — 템플릿 A 표준 dynamic
  ['merge-lift',[840,820,360,24],[480,730,190,20],[70,650,390,24],[1060,792],[200,622],[100,600,260,100],{axis:'y',from:730,to:430,periodMs:5000,carryRiders:true}],
];

// ── 레벨 14: 기계 공장 (이동 기계 + 화염풍) ──────────────────────────────
// 세계 너비 1280, 높이 3600 (템플릿 A). 좌측 출발 → 우측 종착 지그재그.
// moving-car(수직) + timer-gate + cargo-lock + cycle-platform + clock-latch + wind-shutter + safe-ground + merge-lift.
const factoryRows = [
  // m1 (p1): moving-car (수직 이동) — route 폭 확장으로 end와의 수평 간격 축소
  ['moving-car',[70,3370,390,24],[480,3270,330,24],[840,3180,360,24],[200,3342],[1060,3152],[900,3130,260,100],{axis:'y',from:3270,to:3170,periodMs:3200,carryRiders:true}],
  // m2 (p2): timer-gate
  ['timer-gate',[840,3000,360,24],[480,2900,190,24],[70,2820,390,24],[1060,2972],[200,2792],[100,2770,260,100],null,{cycleMs:5200,openMs:2000,transitionMs:220}],
  // m3 (p1): cargo-lock
  ['cargo-lock',[70,2640,390,24],[480,2540,190,24],[840,2450,360,24],[200,2612],[1060,2422],[900,2400,260,100]],
  // m4 (p2): cycle-platform
  ['cycle-platform',[840,2270,360,24],[480,2170,190,24],[70,2090,390,24],[1060,2242],[200,2062],[100,2040,260,100],null,{cycleMs:2800,solidMs:1700,phaseOffsetMs:0}],
  // m5 (p1): clock-latch
  ['clock-latch',[70,1910,390,24],[480,1810,190,24],[840,1730,360,24],[200,1882],[1060,1702],[900,1680,260,100],null,{cycleMs:3000,targetMs:1500,toleranceMs:120}],
  // m6 (p2): wind-shutter
  ['wind-shutter',[840,1540,360,24],[480,1440,190,24],[70,1360,390,24],[1060,1512],[200,1332],[100,1310,260,100],null,{forceX:-700,activeMs:2000,cycleMs:3200}],
  // m7 (p1): safe-ground
  ['safe-ground',[70,1180,390,24],[480,1080,190,24],[840,1000,360,24],[200,1152],[1060,972],[900,950,260,100],null,{strikeCycleMs:2200,warningMs:600}],
  // m8 (p2): merge-lift — 템플릿 A 표준 dynamic
  ['merge-lift',[840,820,360,24],[480,730,190,20],[70,650,390,24],[1060,792],[200,622],[100,600,260,100],{axis:'y',from:730,to:430,periodMs:5000,carryRiders:true}],
];

// ── 레벨 15: 고대 신전 (회전 함정 + 낙뢰) ────────────────────────────────
// 세계 너비 1280, 높이 3600 (템플릿 A). 좌측 출발 → 우측 종착 지그재그.
// rotary + docking-lock + cycle-platform + relay + wind-shutter + cargo-lock + lightning-lock + merge-lift.
const templeRows = [
  // m1 (p1): rotary — route h=20
  ['rotary',[70,3370,390,24],[480,3250,190,20],[840,3160,360,24],[200,3342],[1060,3132],[900,3110,260,100],{pivot:[575,3250],length:190,periodMs:3600}],
  // m2 (p2): docking-lock
  ['docking-lock',[840,3000,360,24],[480,2880,190,24],[70,2800,390,24],[1060,2972],[200,2772],[100,2750,260,100],null,{maxRelativeSpeed:120,maxHeightDelta:300}],
  // m3 (p1): cycle-platform
  ['cycle-platform',[70,2640,390,24],[480,2520,190,24],[840,2430,360,24],[200,2612],[1060,2402],[900,2380,260,100],null,{cycleMs:2600,solidMs:1500,phaseOffsetMs:0}],
  // m4 (p2): relay
  ['relay',[840,2270,360,24],[480,2150,190,24],[70,2070,390,24],[1060,2242],[200,2042],[100,2020,260,100]],
  // m5 (p1): wind-shutter
  ['wind-shutter',[70,1910,390,24],[480,1790,190,24],[840,1700,360,24],[200,1882],[1060,1672],[900,1650,260,100],null,{forceX:800,activeMs:2000,cycleMs:3400}],
  // m6 (p2): cargo-lock
  ['cargo-lock',[840,1540,360,24],[480,1420,190,24],[70,1340,390,24],[1060,1512],[200,1312],[100,1290,260,100]],
  // m7 (p1): lightning-lock
  ['lightning-lock',[70,1180,390,24],[480,1060,190,24],[840,980,360,24],[200,1152],[1060,952],[900,930,260,100],null,{strikeCycleMs:1800,warningMs:900}],
  // m8 (p2): merge-lift — 템플릿 A 표준 dynamic
  ['merge-lift',[840,820,360,24],[480,720,190,20],[70,640,390,24],[1060,792],[200,612],[100,590,260,100],{axis:'y',from:720,to:420,periodMs:5000,carryRiders:true}],
];

// ── 레벨 16: 구름 위 정원 (저중력 + 상승 기류) ───────────────────────────
// 세계 너비 1280, 높이 4400 (템플릿 D). gravity 900 (safeRise=175).
// updraft + low-gravity + cycle-platform + wind-shutter + moving-car + relay + timer-gate + merge-lift.
const gardenRows = [
  // m1 (p1): updraft
  ['updraft',[70,4160,390,24],[480,4020,190,24],[840,3920,360,24],[200,4132],[1060,3892],[900,3870,260,100],null,{liftAcceleration:-1900}],
  // m2 (p2): low-gravity
  ['low-gravity',[840,3720,360,24],[480,3580,190,24],[70,3480,390,24],[1060,3692],[200,3452],[100,3430,260,100]],
  // m3 (p1): cycle-platform
  ['cycle-platform',[70,3280,390,24],[480,3140,190,24],[840,3040,360,24],[200,3252],[1060,3012],[900,2990,260,100],null,{cycleMs:3200,solidMs:2000,phaseOffsetMs:0}],
  // m4 (p2): wind-shutter
  ['wind-shutter',[840,2840,360,24],[480,2700,190,24],[70,2600,390,24],[1060,2812],[200,2572],[100,2550,260,100],null,{forceX:-600,activeMs:2500,cycleMs:4000}],
  // m5 (p1): moving-car
  ['moving-car',[70,2400,390,24],[480,2260,190,24],[840,2160,360,24],[200,2372],[1060,2132],[900,2110,260,100],{axis:'x',from:480,to:800,periodMs:4200,carryRiders:true}],
  // m6 (p2): relay
  ['relay',[840,1960,360,24],[480,1820,190,24],[70,1720,390,24],[1060,1932],[200,1692],[100,1670,260,100]],
  // m7 (p1): timer-gate
  ['timer-gate',[70,1520,390,24],[480,1380,190,24],[840,1280,360,24],[200,1492],[1060,1252],[900,1230,260,100],null,{cycleMs:5500,openMs:2200,transitionMs:250}],
  // m8 (p2): merge-lift — 템플릿 D 표준 dynamic
  ['merge-lift',[840,1080,360,24],[480,940,190,20],[70,840,390,24],[1060,1052],[200,812],[100,790,260,100],{axis:'y',from:940,to:520,periodMs:5500,carryRiders:true}],
];

// ── 레벨 17: 별의 도서관 (시계 장치 + 순환 발판) ─────────────────────────
// 세계 너비 1280, 높이 3600 (템플릿 A). 좌측 출발 → 우측 종착 지그재그.
// clock-latch + signal-link + relay + cargo-lock + rotary + timer-gate + cycle-platform + merge-lift.
const libraryRows = [
  // m1 (p1): clock-latch
  ['clock-latch',[70,3370,390,24],[480,3270,190,24],[840,3180,360,24],[200,3342],[1060,3152],[900,3130,260,100],null,{cycleMs:3000,targetMs:1500,toleranceMs:120}],
  // m2 (p2): signal-link
  ['signal-link',[840,3000,360,24],[480,2900,190,24],[70,2820,390,24],[1060,2972],[200,2792],[100,2770,260,100]],
  // m3 (p1): relay
  ['relay',[70,2640,390,24],[480,2540,190,24],[840,2450,360,24],[200,2612],[1060,2422],[900,2400,260,100]],
  // m4 (p2): cargo-lock
  ['cargo-lock',[840,2270,360,24],[480,2170,190,24],[70,2090,390,24],[1060,2242],[200,2062],[100,2040,260,100]],
  // m5 (p1): rotary — route h=20
  ['rotary',[70,1910,390,24],[480,1810,190,20],[840,1730,360,24],[200,1882],[1060,1702],[900,1680,260,100],{pivot:[575,1810],length:190,periodMs:3600}],
  // m6 (p2): timer-gate
  ['timer-gate',[840,1540,360,24],[480,1440,190,24],[70,1360,390,24],[1060,1512],[200,1332],[100,1310,260,100],null,{cycleMs:5000,openMs:1800,transitionMs:200}],
  // m7 (p1): cycle-platform
  ['cycle-platform',[70,1180,390,24],[480,1080,190,24],[840,1000,360,24],[200,1152],[1060,972],[900,950,260,100],null,{cycleMs:2800,solidMs:1600,phaseOffsetMs:0}],
  // m8 (p2): merge-lift — 템플릿 A 표준 dynamic
  ['merge-lift',[840,820,360,24],[480,730,190,20],[70,650,390,24],[1060,792],[200,622],[100,600,260,100],{axis:'y',from:730,to:430,periodMs:5000,carryRiders:true}],
];

/** @param {Array} row 압축 행 @returns {object} */
function unpack(row) { return { type: row[0], platforms: [row[1],row[2],row[3]], anchor: row[4], switch: row[5], zone: row[6], dynamic: row[7] ?? null, mechanics: row[8] ?? {} }; }

const LEVEL_DEFINITIONS = [
  { id:'cloud-cargo',nameKey:'level.cloud.name',themeKey:'level.cloud.theme',descriptionKey:'level.cloud.description',minutes:'7–11',palette:PALETTES.cloud,motif:'train',world:{width:1440,height:3240,spawnY:3130,dangerY:3360},physics:{gravity:1450,jumpSpeed:650,moveSpeed:250},floor:[[0,3190,520,50],[930,3190,510,50]],finishDeck:[300,300,840,28],finish:[470,250,970,250,720,215,3000,2400],checkpoints:[[180,3130,245,3130],[1050,2820,1115,2820],[250,2470,315,2470],[1110,2130,1175,2130],[170,1780,235,1780],[1020,1430,1085,1430],[300,1080,365,1080],[1080,730,1145,730],[370,390,435,390]],rows:cloudRows.map(unpack),hazards:[] },
  { id:'moon-clock',nameKey:'level.moon.name',themeKey:'level.moon.theme',descriptionKey:'level.moon.description',minutes:'8–12',palette:PALETTES.moon,motif:'clock',world:{width:1280,height:3880,spawnY:3760,dangerY:4020},physics:{gravity:1450,jumpSpeed:650,moveSpeed:250},floor:[[0,3820,390,50],[850,3820,430,50]],finishDeck:[280,300,720,28],finish:[420,245,860,245,640,205,2400,2400],checkpoints:[[120,3760,185,3760],[900,3400,965,3400],[210,2960,275,2960],[920,2520,985,2520],[160,2080,225,2080],[900,1640,965,1640],[230,1200,295,1200],[880,760,945,760],[390,390,455,390]],rows:moonRows.map(unpack),hazards:[] },
  { id:'storm-station',nameKey:'level.storm.name',themeKey:'level.storm.theme',descriptionKey:'level.storm.description',minutes:'8–13',palette:PALETTES.storm,motif:'storm',world:{width:1520,height:3480,spawnY:3370,dangerY:3650},physics:{gravity:1450,jumpSpeed:650,moveSpeed:250},floor:[[0,3430,560,50],[1010,3430,510,50]],finishDeck:[350,300,820,28],finish:[500,250,1020,250,760,210,2600,2400],checkpoints:[[190,3370,255,3370],[1150,3010,1215,3010],[290,2630,355,2630],[1130,2250,1195,2250],[180,1870,245,1870],[1120,1490,1185,1490],[310,1110,375,1110],[1090,730,1155,730],[450,390,515,390]],rows:stormRows.map(unpack),hazards:[{id:'storm-wind',type:'wind',x:480,y:500,width:600,height:2900,forceX:820},{id:'storm-lift',type:'updraft',x:600,y:600,width:260,height:2600,liftAcceleration:-1900}] },
  { id:'orbital-post',nameKey:'level.orbital.name',themeKey:'level.orbital.theme',descriptionKey:'level.orbital.description',minutes:'9–15',palette:PALETTES.orbit,motif:'orbit',world:{width:1360,height:4200,spawnY:4080,dangerY:4460},physics:{gravity:720,jumpSpeed:520,moveAcceleration:680,maxSpeed:310,airDrag:.35,groundDrag:5.5},floor:[[0,4140,430,50],[900,4140,460,50]],finishDeck:[300,300,760,28],finish:[450,245,910,245,680,205,2200,2800],checkpoints:[[150,4080,215,4080],[980,3660,1045,3660],[250,3200,315,3200],[970,2740,1035,2740],[180,2280,245,2280],[940,1820,1005,1820],[280,1360,345,1360],[920,900,985,900],[410,390,475,390]],rows:orbitRows.map(unpack),hazards:[] },
  // 레벨 6: 심해 우편소 — 상승 기류(updraft) × 2 + 타이머 게이트 × 2 + 이동 객차 + 명멸 발판 + 신호 연결 + 합체 리프트
  { id:'deep-sea-post',nameKey:'level.ocean.name',themeKey:'level.ocean.theme',descriptionKey:'level.ocean.description',minutes:'8–13',palette:PALETTES.ocean,motif:'ocean',world:{width:1280,height:3600,spawnY:3480,dangerY:3700},physics:{gravity:1450,jumpSpeed:650,moveSpeed:250},floor:[[0,3540,440,50],[860,3540,420,50]],finishDeck:[270,290,740,28],finish:[440,240,870,240,655,205,2400,2400],checkpoints:[[150,3480,215,3480],[900,3140,965,3140],[110,2780,175,2780],[900,2410,965,2410],[110,2040,175,2040],[900,1680,965,1680],[110,1320,175,1320],[900,960,965,960],[130,610,195,610]],rows:oceanRows.map(unpack),hazards:[] },
  // 레벨 7: 화산 우편대 — 안전지대(safe-ground) × 2 + 번개 잠금 + 화염풍(wind-shutter) × 2 + 회전 발판 + 시계 래치 + 합체 리프트
  { id:'volcanic-mail-base',nameKey:'level.volcano.name',themeKey:'level.volcano.theme',descriptionKey:'level.volcano.description',minutes:'10–15',palette:PALETTES.volcano,motif:'volcano',world:{width:1400,height:3400,spawnY:3280,dangerY:3560},physics:{gravity:1450,jumpSpeed:650,moveSpeed:250},floor:[[0,3340,480,50],[930,3340,470,50]],finishDeck:[290,300,820,28],finish:[450,248,950,248,700,210,2600,2400],checkpoints:[[150,3280,215,3280],[1010,2930,1075,2930],[130,2580,195,2580],[1010,2200,1075,2200],[130,1830,195,1830],[1010,1470,1075,1470],[130,1120,195,1120],[1010,770,1075,770],[130,440,195,440]],rows:volcanoRows.map(unpack),hazards:[] },
  // 레벨 8: 수정 궁전 — relay + rotary + cycle-platform + cargo-lock + low-gravity + docking-lock + signal-link + merge-lift
  { id:'crystal-palace',nameKey:'level.crystal.name',themeKey:'level.crystal.theme',descriptionKey:'level.crystal.description',minutes:'7–10',palette:PALETTES.crystal,motif:'crystal',world:{width:1280,height:3600,spawnY:3480,dangerY:3700},physics:{gravity:1450,jumpSpeed:650,moveSpeed:250},floor:[[0,3540,440,50],[860,3540,420,50]],finishDeck:[270,290,740,28],finish:[440,240,870,240,655,205,2400,2400],checkpoints:[[150,3480,215,3480],[900,3130,965,3130],[110,2770,175,2770],[900,2400,965,2400],[110,2040,175,2040],[900,1670,965,1670],[110,1310,175,1310],[900,950,965,950],[110,610,175,610]],rows:crystalRows.map(unpack),hazards:[] },
  // 레벨 9: 설산 우편탑 — moving-car + wind-shutter + cycle-platform + updraft + signal-link + clock-latch + timer-gate + merge-lift
  { id:'snowpeak-tower',nameKey:'level.snowpeak.name',themeKey:'level.snowpeak.theme',descriptionKey:'level.snowpeak.description',minutes:'9–14',palette:PALETTES.snowpeak,motif:'snowpeak',world:{width:1280,height:3700,spawnY:3580,dangerY:3800},physics:{gravity:1450,jumpSpeed:650,moveSpeed:250},floor:[[0,3640,440,50],[860,3640,420,50]],finishDeck:[270,290,740,28],finish:[440,240,870,240,655,205,2400,2400],checkpoints:[[150,3580,215,3580],[900,3230,965,3230],[110,2870,175,2870],[900,2500,965,2500],[110,2130,175,2130],[900,1750,965,1750],[110,1390,175,1390],[900,1020,965,1020],[110,670,175,670]],rows:snowpeakRows.map(unpack),hazards:[] },
  // 레벨 10: 사막 우편로 — wind-shutter + safe-ground + cargo-lock + moving-car + relay + cycle-platform + clock-latch + merge-lift
  { id:'desert-route',nameKey:'level.desert.name',themeKey:'level.desert.theme',descriptionKey:'level.desert.description',minutes:'8–12',palette:PALETTES.desert,motif:'desert',world:{width:1400,height:3400,spawnY:3280,dangerY:3560},physics:{gravity:1600,jumpSpeed:700,moveSpeed:260},floor:[[0,3340,500,50],[960,3340,440,50]],finishDeck:[280,300,840,28],finish:[480,248,960,248,720,210,2600,2400],checkpoints:[[160,3280,225,3280],[1050,2940,1115,2940],[110,2580,175,2580],[1050,2210,1115,2210],[110,1850,175,1850],[1050,1490,1115,1490],[110,1130,175,1130],[1050,770,1115,770],[110,430,175,430]],rows:desertRows.map(unpack),hazards:[] },
  // 레벨 11: 우주정거장 — docking-lock + low-gravity + signal-link + relay + timer-gate + cargo-lock + rotary + merge-lift
  { id:'space-station',nameKey:'level.space.name',themeKey:'level.space.theme',descriptionKey:'level.space.description',minutes:'9–14',palette:PALETTES.space,motif:'space',world:{width:1280,height:3600,spawnY:3480,dangerY:3700},physics:{gravity:1450,jumpSpeed:650,moveSpeed:250},floor:[[0,3540,440,50],[860,3540,420,50]],finishDeck:[270,290,740,28],finish:[440,240,870,240,655,205,2400,2400],checkpoints:[[150,3480,215,3480],[900,3130,965,3130],[110,2770,175,2770],[900,2400,965,2400],[110,2040,175,2040],[900,1670,965,1670],[110,1310,175,1310],[900,950,965,950],[110,610,175,610]],rows:spaceRows.map(unpack),hazards:[] },
  // 레벨 12: 빙하 우편부 — updraft + moving-car + cycle-platform + wind-shutter + signal-link + clock-latch + timer-gate + merge-lift
  { id:'glacier-bureau',nameKey:'level.glacier.name',themeKey:'level.glacier.theme',descriptionKey:'level.glacier.description',minutes:'8–13',palette:PALETTES.glacier,motif:'glacier',world:{width:1280,height:3700,spawnY:3580,dangerY:3800},physics:{gravity:1450,jumpSpeed:650,moveSpeed:250},floor:[[0,3640,440,50],[860,3640,420,50]],finishDeck:[270,290,740,28],finish:[440,240,870,240,655,205,2400,2400],checkpoints:[[150,3580,215,3580],[900,3230,965,3230],[110,2870,175,2870],[900,2500,965,2500],[110,2130,175,2130],[900,1750,965,1750],[110,1390,175,1390],[900,1020,965,1020],[110,670,175,670]],rows:glacierRows.map(unpack),hazards:[] },
  // 레벨 13: 열대우림 우편소 — cycle-platform + updraft + cargo-lock + moving-car + rotary + relay + lightning-lock + merge-lift
  { id:'rainforest-post',nameKey:'level.rainforest.name',themeKey:'level.rainforest.theme',descriptionKey:'level.rainforest.description',minutes:'9–14',palette:PALETTES.rainforest,motif:'rainforest',world:{width:1280,height:3600,spawnY:3480,dangerY:3700},physics:{gravity:1450,jumpSpeed:650,moveSpeed:250},floor:[[0,3540,440,50],[860,3540,420,50]],finishDeck:[270,290,740,28],finish:[440,240,870,240,655,205,2400,2400],checkpoints:[[150,3480,215,3480],[900,3130,965,3130],[110,2770,175,2770],[900,2400,965,2400],[110,2040,175,2040],[900,1670,965,1670],[110,1310,175,1310],[900,950,965,950],[110,610,175,610]],rows:rainforestRows.map(unpack),hazards:[] },
  // 레벨 14: 기계 공장 — moving-car(수직) + timer-gate + cargo-lock + cycle-platform + clock-latch + wind-shutter + safe-ground + merge-lift
  { id:'machine-factory',nameKey:'level.factory.name',themeKey:'level.factory.theme',descriptionKey:'level.factory.description',minutes:'10–15',palette:PALETTES.factory,motif:'factory',world:{width:1280,height:3600,spawnY:3480,dangerY:3700},physics:{gravity:1450,jumpSpeed:650,moveSpeed:250},floor:[[0,3540,440,50],[860,3540,420,50]],finishDeck:[270,290,740,28],finish:[440,240,870,240,655,205,2400,2400],checkpoints:[[150,3480,215,3480],[900,3130,965,3130],[110,2770,175,2770],[900,2400,965,2400],[110,2040,175,2040],[900,1670,965,1670],[110,1310,175,1310],[900,950,965,950],[110,610,175,610]],rows:factoryRows.map(unpack),hazards:[] },
  // 레벨 15: 고대 신전 — rotary + docking-lock + cycle-platform + relay + wind-shutter + cargo-lock + lightning-lock + merge-lift
  { id:'ancient-temple',nameKey:'level.temple.name',themeKey:'level.temple.theme',descriptionKey:'level.temple.description',minutes:'9–14',palette:PALETTES.temple,motif:'temple',world:{width:1280,height:3600,spawnY:3480,dangerY:3700},physics:{gravity:1450,jumpSpeed:650,moveSpeed:250},floor:[[0,3540,440,50],[860,3540,420,50]],finishDeck:[270,290,740,28],finish:[440,240,870,240,655,205,2400,2400],checkpoints:[[150,3480,215,3480],[900,3130,965,3130],[110,2770,175,2770],[900,2400,965,2400],[110,2040,175,2040],[900,1670,965,1670],[110,1310,175,1310],[900,950,965,950],[110,610,175,610]],rows:templeRows.map(unpack),hazards:[] },
  // 레벨 16: 구름 위 정원 — updraft + low-gravity + cycle-platform + wind-shutter + moving-car + relay + timer-gate + merge-lift
  { id:'sky-garden',nameKey:'level.garden.name',themeKey:'level.garden.theme',descriptionKey:'level.garden.description',minutes:'10–16',palette:PALETTES.garden,motif:'garden',world:{width:1280,height:4400,spawnY:4270,dangerY:4560},physics:{gravity:900,jumpSpeed:650,moveSpeed:250},floor:[[0,4340,440,50],[860,4340,420,50]],finishDeck:[270,290,740,28],finish:[440,240,870,240,655,205,2400,2400],checkpoints:[[150,4270,215,4270],[900,3850,965,3850],[110,3410,175,3410],[900,2970,965,2970],[110,2530,175,2530],[900,2090,965,2090],[110,1650,175,1650],[900,1210,965,1210],[110,770,175,770]],rows:gardenRows.map(unpack),hazards:[] },
  // 레벨 17: 별의 도서관 — clock-latch + signal-link + relay + cargo-lock + rotary + timer-gate + cycle-platform + merge-lift
  { id:'stellar-library',nameKey:'level.library.name',themeKey:'level.library.theme',descriptionKey:'level.library.description',minutes:'8–13',palette:PALETTES.library,motif:'library',world:{width:1280,height:3600,spawnY:3480,dangerY:3700},physics:{gravity:1450,jumpSpeed:650,moveSpeed:250},floor:[[0,3540,440,50],[860,3540,420,50]],finishDeck:[270,290,740,28],finish:[440,240,870,240,655,205,2400,2400],checkpoints:[[150,3480,215,3480],[900,3130,965,3130],[110,2770,175,2770],[900,2400,965,2400],[110,2040,175,2040],[900,1670,965,1670],[110,1310,175,1310],[900,950,965,950],[110,610,175,610]],rows:libraryRows.map(unpack),hazards:[] },
];

const baseLevel = Object.freeze({ id:'starlight-tower',nameKey:'level.starlight.name',themeKey:'level.starlight.theme',descriptionKey:'level.starlight.description',minutes:'6–10',palette:PALETTES.tower,motif:'tower',world:{...WORLD},physics:{gravity:1450,jumpSpeed:650,moveSpeed:250},platforms:PLATFORMS.map((item)=>({...item})),checkpoints:CHECKPOINTS.map((item)=>({...item})),finish:{...FINISH,leftSwitch:{...FINISH.leftSwitch},rightSwitch:{...FINISH.rightSwitch},launcher:{...FINISH.launcher}},modules:MODULES.map((item)=>({...item,anchor:{...item.anchor},switch:{...item.switch},checkpoint:{...item.checkpoint}})),hazards:[] });

export const LEVELS = Object.freeze([baseLevel, ...LEVEL_DEFINITIONS.map(buildIndependentLevel)]);
export const DEFAULT_LEVEL_ID = baseLevel.id;
export const LEVEL_IDS = Object.freeze(LEVELS.map((level)=>level.id));
/** @param {string} id 레벨 ID @returns {object|null} */
export function getLevel(id) { return LEVELS.find((level)=>level.id===id) ?? null; }
/** @param {string} id 현재 레벨 ID @returns {object} */
export function getNextLevel(id) { const index=LEVELS.findIndex((level)=>level.id===id); return LEVELS[(index+1+LEVELS.length)%LEVELS.length]; }
/** @returns {Array<object>} */
export function getLevelCatalog() { return LEVELS.map(({id,nameKey,themeKey,descriptionKey,minutes,palette,motif})=>({id,nameKey,themeKey,descriptionKey,minutes,palette,motif})); }

/**
 * 레벨 좌표·참조 무결성을 검증한다.
 * @param {object} level 레벨
 * @returns {{ok:boolean,errors:string[]}}
 */
export function validateLevel(level) {
  const errors=[]; const ids=new Set();
  for(const platform of level.platforms){
    if(ids.has(platform.id))errors.push(`duplicate:${platform.id}`); ids.add(platform.id);
    if(platform.x<0||platform.x+platform.width>level.world.width||platform.y<0||platform.y+platform.height>level.world.height)errors.push(`bounds:${platform.id}`);
    if(Number.isInteger(platform.deviceIndex)&&!level.modules[platform.deviceIndex])errors.push(`device:${platform.id}`);
    if(platform.dynamic){const {axis,from,to}=platform.dynamic;if(!['x','y'].includes(axis)&&!Array.isArray(platform.dynamic.pivot))errors.push(`motion-axis:${platform.id}`);if(axis==='x'&&(Math.min(from,to)<0||Math.max(from,to)+platform.width>level.world.width))errors.push(`motion-bounds:${platform.id}`);if(axis==='y'&&(Math.min(from,to)<0||Math.max(from,to)+platform.height>level.world.height))errors.push(`motion-bounds:${platform.id}`);}
  }
  if(level.modules.length!==8)errors.push('modules'); if(level.checkpoints.length!==9)errors.push('checkpoints');
  const terrain=level.platforms.filter((platform)=>!platform.returnPlatform); const returns=level.platforms.filter((platform)=>platform.returnPlatform);
  if(terrain.length!==27)errors.push('platforms');
  for(const [index,module] of level.modules.entries()){
    const landing=level.platforms.find((platform)=>platform.id===module.boostLandingPlatformId); const returning=level.platforms.find((platform)=>platform.id===module.returnPlatformId);
    if(module.boostRequired&&(!landing||landing.width<120))errors.push(`boost:${index}`);
    if(!returning||returning.deviceIndex!==index||returning.width<120||!level.platforms.some((platform)=>platform.id===returning.lowerPlatformId)||!level.platforms.some((platform)=>platform.id===returning.upperPlatformId))errors.push(`return:${index}`);
  }
  level.checkpoints.forEach((checkpoint,index)=>{if(checkpoint.x1<0||checkpoint.x2>level.world.width||checkpoint.y1<0||checkpoint.y2>level.world.height)errors.push(`checkpoint:${index}`);});
  if(level.finish.leftSwitch.x<0||level.finish.rightSwitch.x>level.world.width||level.finish.launcher.y<0)errors.push('finish');
  return {ok:errors.length===0,errors};
}
