/** @fileoverview 레시피, 300초 타임라인, 점수 수치와 서버 충돌용 열차 배치를 정의한다. */

export const ROUND_DURATION_MS = 300_000;
export const RECONNECT_GRACE_MS = 15_000;
export const PLAYER_SPEED = 180;
export const PLAYER_COLLIDER = Object.freeze({ w: 32, h: 28 });
export const ITEM_LOCATION = Object.freeze({ STOCK: 'STOCK', FLOOR: 'FLOOR', HELD: 'HELD', STATION: 'STATION', PLATED: 'PLATED', TRASHED: 'TRASHED' });
export const PROCESS = Object.freeze({ RAW: 'RAW', PREPPING: 'PREPPING', PREPPED: 'PREPPED', COOKING: 'COOKING', COOKED: 'COOKED', BURNT: 'BURNT' });
export const STATION_STATE = Object.freeze({ IDLE: 'IDLE', OCCUPIED: 'OCCUPIED', ACTIVE: 'ACTIVE', READY: 'READY', BURNT: 'BURNT', LOCKED: 'LOCKED' });

export const RECIPES = Object.freeze({
  mushroom_skewer: { id: 'mushroom_skewer', ingredients: ['moon_mushroom', 'sunset_pepper'], prepMs: { moon_mushroom: 2500, sunset_pepper: 2500 }, prepStation: 'board', cookStation: 'brazier', cookMs: 8000, burnMs: 5000, limitMs: 60000 },
  lantern_dumpling: { id: 'lantern_dumpling', ingredients: ['silver_dough', 'lantern_leaf'], prepMs: { silver_dough: 3500, lantern_leaf: 2500 }, prepStationByKind: { silver_dough: 'dough', lantern_leaf: 'board' }, cookStation: 'steamer', cookMs: 11000, burnMs: 8000, limitMs: 70000 },
  comet_noodle: { id: 'comet_noodle', ingredients: ['comet_radish', 'star_noodle'], prepMs: { comet_radish: 3000, star_noodle: 0 }, prepStationByKind: { comet_radish: 'board', star_noodle: null }, cookStation: 'pot', cookMs: 9000, burnMs: 6000, limitMs: 65000 }
});

export const STOPS = Object.freeze([{ index: 1, openMs: 50000, closeMs: 68000 }, { index: 2, openMs: 95000, closeMs: 113000 }, { index: 3, openMs: 150000, closeMs: 168000 }, { index: 4, openMs: 205000, closeMs: 223000 }, { index: 5, openMs: 265000, closeMs: 288000 }]);
export const ORDER_WAVES = Object.freeze([{ revealMs: 15000, stationIndex: 1, count: 1 }, { revealMs: 60000, stationIndex: 2, count: 2 }, { revealMs: 115000, stationIndex: 3, count: 2 }, { revealMs: 170000, stationIndex: 4, count: 2 }, { revealMs: 220000, stationIndex: 5, count: 2 }]);
export const CURVES = Object.freeze([{ startMs: 82000, endMs: 88000, direction: 1 }, { startMs: 137000, endMs: 143000, direction: -1 }, { startMs: 192000, endMs: 198000, direction: 1 }, { startMs: 247000, endMs: 253000, direction: -1 }]);

export const STATIONS = Object.freeze([
  ...['moon_mushroom', 'sunset_pepper', 'silver_dough', 'lantern_leaf', 'comet_radish'].map((kind, index) => ({ id: `crate_${kind}`, type: 'crate', kind, x: 72 + index * 88, y: 160, w: 72, h: 64 })),
  { id: 'board_a', type: 'board', x: 80, y: 312, w: 96, h: 64 }, { id: 'board_b', type: 'board', x: 80, y: 424, w: 96, h: 64 },
  { id: 'dough_table', type: 'dough', x: 216, y: 424, w: 112, h: 64 }, { id: 'plate_shelf', type: 'plate_shelf', x: 384, y: 248, w: 120, h: 64 },
  { id: 'cooling_pump', type: 'cooling_pump', x: 448, y: 424, w: 96, h: 96 }, { id: 'brazier', type: 'brazier', x: 744, y: 160, w: 112, h: 80 },
  { id: 'steamer', type: 'steamer', x: 888, y: 160, w: 112, h: 80 }, { id: 'pot', type: 'pot', x: 1032, y: 160, w: 112, h: 80 },
  { id: 'noodle_supply', type: 'noodle_supply', kind: 'star_noodle', x: 1152, y: 160, w: 64, h: 80 },
  { id: 'plating_a', type: 'plating', x: 752, y: 424, w: 112, h: 72 }, { id: 'plating_b', type: 'plating', x: 888, y: 424, w: 112, h: 72 },
  { id: 'trash', type: 'trash', x: 1040, y: 424, w: 80, h: 80 }, { id: 'service', type: 'service', x: 1168, y: 288, w: 48, h: 160 },
  { id: 'exhaust_valve', type: 'exhaust_valve', x: 1096, y: 520, w: 96, h: 80 }
]);

export const WALLS = Object.freeze([
  { x: 24, y: 112, w: 1232, h: 16 }, { x: 24, y: 656, w: 1232, h: 16 }, { x: 24, y: 112, w: 16, h: 560 }, { x: 1240, y: 112, w: 16, h: 560 },
  // 연결 발판의 상·하 차단벽은 서버와 Canvas가 같은 112×192 보행 개구부를 사용한다.
  { x: 568, y: 128, w: 144, h: 168 }, { x: 568, y: 488, w: 144, h: 168 },
  ...STATIONS.map(({ x, y, w, h }) => ({ x, y, w, h }))
]);

/**
 * 고정 시드에서 레시피별 최소 2건인 정확히 9건 카탈로그를 만든다.
 * @param {number} seed 라운드 시드
 * @returns {string[]} 레시피 ID 목록
 */
export function buildRecipeCatalog(seed = 1) {
  const base = ['mushroom_skewer', 'lantern_dumpling', 'comet_noodle', 'mushroom_skewer', 'lantern_dumpling', 'comet_noodle', 'mushroom_skewer', 'lantern_dumpling', 'comet_noodle'];
  let state = seed >>> 0;
  for (let index = base.length - 1; index > 0; index -= 1) { state = (state * 1664525 + 1013904223) >>> 0; const target = state % (index + 1); [base[index], base[target]] = [base[target], base[index]]; }
  return base;
}
