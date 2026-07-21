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
  const modules = definition.rows.map((row, index) => ({ id: `${definition.id}-m${index + 1}`, number: index + 1, type: row.type, section: definition.motif, requiredPlayerId: index % 2 === 0 ? 'p1' : 'p2', anchor: { x: row.anchor[0], y: row.anchor[1] }, switch: { x: row.switch[0], y: row.switch[1] }, checkpoint: rectangle(row.zone), mechanics: row.mechanics ?? {} }));
  const coop = addCoopRoutes(platforms, modules);
  return Object.freeze({ id: definition.id, nameKey: definition.nameKey, themeKey: definition.themeKey, descriptionKey: definition.descriptionKey, minutes: definition.minutes, palette: definition.palette, motif: definition.motif, world: { ...definition.world }, physics: { ...definition.physics }, platforms: coop.platforms, checkpoints: definition.checkpoints.map((item, id) => ({ id, x1: item[0], y1: item[1], x2: item[2], y2: item[3] })), finish: { leftSwitch: { x: definition.finish[0], y: definition.finish[1] }, rightSwitch: { x: definition.finish[2], y: definition.finish[3] }, launcher: { x: definition.finish[4], y: definition.finish[5] }, windowMs: definition.finish[6], launchMs: definition.finish[7] }, modules: coop.modules, hazards: definition.hazards.map((item) => ({ ...item })) });
}

const PALETTES = Object.freeze({
  tower: { sky: '#0B1322', haze: '#15213A', structure: '#344B68', accent: '#C68A3A' }, cloud: { sky: '#15213A', haze: '#3E91A3', structure: '#344B68', accent: '#B9E8E7' }, moon: { sky: '#0B1322', haze: '#786EA8', structure: '#344B68', accent: '#FFD97A' }, storm: { sky: '#07101D', haze: '#344B68', structure: '#3E91A3', accent: '#FFB454' }, orbit: { sky: '#07101D', haze: '#786EA8', structure: '#1F2C47', accent: '#D97FA5' },
  ocean: { sky: '#060F1C', haze: '#0A3550', structure: '#1A4560', accent: '#00D4CC' },
  volcano: { sky: '#0E0800', haze: '#3A1200', structure: '#5C2200', accent: '#FF6A1A' },
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
  ['updraft',[70,3380,380,24],[490,3260,180,24],[850,3180,360,24],[200,3352],[1060,3152],[900,3100,260,100],null,{liftAcceleration:-1900}],
  // m2 (p2): timer-gate — 우측 출발, 잠긴 게이트, 좌측 착지
  ['timer-gate',[840,3020,370,24],[490,2910,190,24],[70,2820,390,24],[1060,2992],[200,2792],[100,2740,260,100],null,{cycleMs:5500,openMs:1900,transitionMs:220}],
  // m3 (p1): moving-car — 좌측 출발, 횡이동 객차, 우측 착지
  ['moving-car',[70,2660,390,24],[490,2550,210,24],[840,2450,360,24],[200,2632],[1050,2422],[900,2370,260,100],{axis:'x',from:490,to:820,periodMs:3800,carryRiders:true}],
  // m4 (p2): cycle-platform — 우측 출발, 명멸 발판, 좌측 착지
  ['cycle-platform',[840,2290,360,24],[490,2170,170,24],[70,2080,390,24],[1060,2262],[200,2052],[100,2000,260,100],null,{cycleMs:2800,solidMs:1700,phaseOffsetMs:0}],
  // m5 (p1): updraft — 좌측 출발, 기류 2번째 기둥, 우측 착지
  ['updraft',[70,1920,390,24],[490,1800,180,24],[840,1720,360,24],[200,1892],[1060,1692],[900,1640,260,100],null,{liftAcceleration:-1900}],
  // m6 (p2): timer-gate (빠른 주기) — 우측 출발, 좌측 착지
  ['timer-gate',[840,1560,360,24],[490,1440,190,24],[70,1360,390,24],[1060,1532],[200,1332],[100,1280,260,100],null,{cycleMs:4500,openMs:1500,transitionMs:200}],
  // m7 (p1): signal-link — 좌측 출발, 우측 착지
  ['signal-link',[70,1200,390,24],[490,1080,200,24],[840,1000,360,24],[200,1172],[1050,972],[900,920,260,100]],
  // m8 (p2): merge-lift — 우측 출발, 리프트 탑승, 좌측 착지 (결승 진입)
  ['merge-lift',[840,840,360,24],[490,740,200,20],[80,650,380,24],[1060,812],[180,622],[100,570,280,100],{axis:'y',from:740,to:410,periodMs:5000,carryRiders:true}],
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
