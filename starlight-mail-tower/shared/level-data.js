/**
 * @fileoverview 세 구간 8모듈과 결승 데크의 지형·장치·체크포인트를 서버와 렌더러가 공유한다.
 */

export const WORLD = Object.freeze({ width: 1280, height: 3600, spawnY: 3490, dangerY: 3650 });

export const PLATFORMS = Object.freeze([
  { id: 'floor-left', x: 0, y: 3550, width: 440, height: 50 }, { id: 'floor-right', x: 780, y: 3550, width: 500, height: 50 },
  { id: 'm1-start', x: 80, y: 3410, width: 330, height: 24 }, { id: 'm1-route', x: 500, y: 3300, width: 270, height: 24, deviceIndex: 0 }, { id: 'm1-end', x: 870, y: 3180, width: 330, height: 24, deviceIndex: 0 },
  { id: 'm2-start', x: 760, y: 3050, width: 360, height: 24 }, { id: 'm2-route', x: 380, y: 2930, width: 270, height: 24, deviceIndex: 1 }, { id: 'm2-end', x: 80, y: 2810, width: 330, height: 24, deviceIndex: 1 },
  { id: 'm3-start', x: 120, y: 2670, width: 330, height: 24 }, { id: 'm3-route', x: 520, y: 2550, width: 270, height: 24, deviceIndex: 2 }, { id: 'm3-end', x: 850, y: 2430, width: 350, height: 24, deviceIndex: 2 },
  { id: 'm4-start', x: 760, y: 2250, width: 360, height: 24 }, { id: 'm4-route', x: 390, y: 2130, width: 280, height: 24, deviceIndex: 3 }, { id: 'm4-end', x: 80, y: 2010, width: 340, height: 24, deviceIndex: 3 },
  { id: 'm5-start', x: 100, y: 1880, width: 350, height: 24 }, { id: 'm5-route', x: 510, y: 1760, width: 270, height: 24, deviceIndex: 4 }, { id: 'm5-end', x: 850, y: 1640, width: 350, height: 24, deviceIndex: 4 },
  { id: 'm6-start', x: 760, y: 1510, width: 360, height: 24 }, { id: 'm6-route', x: 390, y: 1390, width: 280, height: 24, deviceIndex: 5 }, { id: 'm6-end', x: 80, y: 1270, width: 350, height: 24, deviceIndex: 5 },
  { id: 'm7-start', x: 100, y: 1140, width: 350, height: 24 }, { id: 'm7-route', x: 500, y: 1020, width: 280, height: 24, deviceIndex: 6 }, { id: 'm7-end', x: 850, y: 900, width: 350, height: 24, deviceIndex: 6 },
  { id: 'm8-start', x: 760, y: 770, width: 360, height: 24 }, { id: 'm8-route', x: 390, y: 650, width: 280, height: 24, deviceIndex: 7 }, { id: 'm8-end', x: 80, y: 530, width: 350, height: 24, deviceIndex: 7 },
  { id: 'finish-deck', x: 240, y: 380, width: 800, height: 28 },
]);

export const MODULES = Object.freeze([
  { id: 'sorter-a', number: 1, type: 'sorter', section: 'sorting', requiredPlayerId: 'p1', anchor: { x: 305, y: 3382 }, switch: { x: 930, y: 3152 }, checkpoint: { x: 900, y: 3100, width: 250, height: 90 } },
  { id: 'sorter-b', number: 2, type: 'sorter', section: 'sorting', requiredPlayerId: 'p2', anchor: { x: 930, y: 3022 }, switch: { x: 180, y: 2782 }, checkpoint: { x: 110, y: 2730, width: 250, height: 90 } },
  { id: 'sorter-c', number: 3, type: 'sorter', section: 'sorting', requiredPlayerId: 'p1', anchor: { x: 260, y: 2642 }, switch: { x: 1010, y: 2402 }, checkpoint: { x: 890, y: 2350, width: 250, height: 100 } },
  { id: 'wind-rotary', number: 4, type: 'rotary', section: 'wind', requiredPlayerId: 'p2', anchor: { x: 930, y: 2222 }, switch: { x: 180, y: 1982 }, checkpoint: { x: 110, y: 1930, width: 250, height: 100 } },
  { id: 'wind-shutter', number: 5, type: 'wind-shutter', section: 'wind', requiredPlayerId: 'p1', anchor: { x: 260, y: 1852 }, switch: { x: 1010, y: 1612 }, checkpoint: { x: 890, y: 1560, width: 250, height: 100 } },
  { id: 'wind-lift', number: 6, type: 'updraft', section: 'wind', requiredPlayerId: 'p2', anchor: { x: 930, y: 1482 }, switch: { x: 180, y: 1242 }, checkpoint: { x: 110, y: 1190, width: 250, height: 100 } },
  { id: 'star-shutter', number: 7, type: 'starlight-shutter', section: 'observatory', requiredPlayerId: 'p1', anchor: { x: 260, y: 1112 }, switch: { x: 1010, y: 872 }, checkpoint: { x: 890, y: 820, width: 250, height: 100 } },
  { id: 'merge-lift', number: 8, type: 'merge-lift', section: 'observatory', requiredPlayerId: 'p2', anchor: { x: 930, y: 742 }, switch: { x: 180, y: 502 }, checkpoint: { x: 110, y: 450, width: 250, height: 100 } },
]);

export const CHECKPOINTS = Object.freeze([
  { id: 0, x1: 150, y1: 3490, x2: 215, y2: 3490 }, { id: 1, x1: 940, y1: 3120, x2: 1005, y2: 3120 },
  { id: 2, x1: 160, y1: 2750, x2: 225, y2: 2750 }, { id: 3, x1: 930, y1: 2370, x2: 995, y2: 2370 },
  { id: 4, x1: 160, y1: 1950, x2: 225, y2: 1950 }, { id: 5, x1: 930, y1: 1580, x2: 995, y2: 1580 },
  { id: 6, x1: 160, y1: 1210, x2: 225, y2: 1210 }, { id: 7, x1: 930, y1: 840, x2: 995, y2: 840 },
  { id: 8, x1: 160, y1: 470, x2: 225, y2: 470 },
]);

export const FINISH = Object.freeze({ leftSwitch: { x: 390, y: 330 }, rightSwitch: { x: 890, y: 330 }, launcher: { x: 640, y: 300 }, windowMs: 3000, launchMs: 2400 });

/**
 * 좌표가 특정 모듈의 공동 체크포인트 영역 안인지 검사한다.
 * @param {{x:number,y:number}} player 플레이어 위치
 * @param {{checkpoint:{x:number,y:number,width:number,height:number}}} module 모듈 데이터
 * @returns {boolean}
 */
export function isInsideCheckpoint(player, module) {
  const zone = module.checkpoint;
  return player.x >= zone.x && player.x <= zone.x + zone.width && player.y >= zone.y && player.y <= zone.y + zone.height;
}
