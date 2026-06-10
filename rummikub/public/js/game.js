/**
 * @fileoverview 루미큐브 클라이언트 상태 캐시 + 점수 계산 헬퍼.
 *
 * 서버 권위 — 클라이언트는 마지막 STATE를 캐시하고, 미리보기는 보조용일 뿐.
 * (서버 game.js와 동일 룰을 재구현하여 본인이 보드에 올린 타일의 점수를 미리 보여준다.)
 */

export const INITIAL_MELD_THRESHOLD = 30;
export const MIN_SET_LENGTH = 3;
export const MAX_GROUP_LENGTH = 4;
export const MAX_RUN_LENGTH = 13;

let cached = null;

/**
 * 마지막으로 받은 STATE 저장.
 * @param {object} state
 */
export function setState(state) {
  cached = state;
}

/**
 * 현재 STATE 스냅샷 반환(없으면 null).
 * @returns {object|null}
 */
export function getState() {
  return cached;
}

/**
 * 타일 ID → 타일 객체 lookup. (state.tileDict 우선, 없으면 null.)
 * @param {object} state
 * @param {string} tileId
 * @returns {object|null}
 */
export function lookupTile(state, tileId) {
  if (!state || !state.tileDict) return null;
  return state.tileDict[tileId] || null;
}

/**
 * 단일 세트의 valid 여부 + 점수 계산. 서버 game.js의 validateSet과 동일 룰.
 *
 * @param {Array<object>} tiles 타일 객체 배열
 * @returns {{ valid: boolean, type: string|null, score: number, error?: string }}
 */
export function validateSet(tiles) {
  if (!Array.isArray(tiles) || tiles.length < MIN_SET_LENGTH) {
    return { valid: false, type: null, score: 0, error: '세트는 최소 3장 이상이어야 합니다.' };
  }
  if (tiles.length > MAX_RUN_LENGTH) {
    return { valid: false, type: null, score: 0, error: '세트가 너무 깁니다.' };
  }
  const jokers = tiles.filter((t) => t && t.kind === 'joker');
  const nums = tiles.filter((t) => t && t.kind === 'num');
  if (jokers.length + nums.length !== tiles.length) {
    return { valid: false, type: null, score: 0, error: '알 수 없는 타일이 포함되어 있습니다.' };
  }
  if (jokers.length > 2) {
    return { valid: false, type: null, score: 0, error: '조커는 최대 2장.' };
  }
  if (nums.length === 0) {
    return { valid: false, type: null, score: 0, error: '숫자 타일이 1장 이상 필요.' };
  }

  // 그룹.
  const sampleNumber = nums[0].number;
  const allSameNumber = nums.every((t) => t.number === sampleNumber);
  if (allSameNumber) {
    if (tiles.length >= MIN_SET_LENGTH && tiles.length <= MAX_GROUP_LENGTH) {
      const colorSet = new Set(nums.map((t) => t.color));
      if (colorSet.size === nums.length) {
        const score = sampleNumber * tiles.length;
        return { valid: true, type: 'group', score };
      }
      return { valid: false, type: null, score: 0, error: '그룹은 색이 모두 달라야 합니다.' };
    }
  }
  // 런.
  const sampleColor = nums[0].color;
  const allSameColor = nums.every((t) => t.color === sampleColor);
  if (!allSameColor) {
    return { valid: false, type: null, score: 0, error: '같은 숫자/색 모두 아님.' };
  }
  const numberSet = new Set(nums.map((t) => t.number));
  if (numberSet.size !== nums.length) {
    return { valid: false, type: null, score: 0, error: '런에 같은 숫자 중복.' };
  }
  const minN = Math.min(...nums.map((t) => t.number));
  const maxN = Math.max(...nums.map((t) => t.number));
  const span = maxN - minN + 1;
  if (span > tiles.length) {
    return { valid: false, type: null, score: 0, error: '연속 숫자 범위가 넓음.' };
  }
  const startMin = Math.max(1, maxN - tiles.length + 1);
  const startMax = Math.min(minN, 13 - tiles.length + 1);
  if (startMin > startMax) {
    return { valid: false, type: null, score: 0, error: '1~13 범위 벗어남.' };
  }
  let bestScore = -1;
  for (let start = startMin; start <= startMax; start++) {
    const end = start + tiles.length - 1;
    let ok = true;
    for (const n of nums) {
      if (n.number < start || n.number > end) { ok = false; break; }
    }
    if (!ok) continue;
    const missing = tiles.length - nums.length;
    if (missing !== jokers.length) continue;
    let score = 0;
    for (let v = start; v <= end; v++) score += v;
    if (score > bestScore) bestScore = score;
  }
  if (bestScore < 0) {
    return { valid: false, type: null, score: 0, error: '런 구성 불가.' };
  }
  return { valid: true, type: 'run', score: bestScore };
}

/**
 * 이번 턴에 본인이 보드에 새로 추가한 타일들의 점수 합(첫 등판 미리보기용).
 *
 * @param {object} state 현재 STATE
 * @param {Set<string>} freshTileIds 이번 턴에 손에서 보드로 옮긴 타일 ID 집합
 * @returns {number}
 */
export function computeFreshMeldScore(state, freshTileIds) {
  if (!state || !state.board) return 0;
  let total = 0;
  for (const set of state.board) {
    if (!set.tiles || set.tiles.length === 0) continue;
    const resolved = set.tiles.map((id) => lookupTile(state, id)).filter(Boolean);
    if (resolved.length !== set.tiles.length) continue;
    const v = validateSet(resolved);
    if (!v.valid) continue;
    // 이 세트에서 fresh 타일의 점수 기여 계산.
    if (v.type === 'group') {
      const firstNum = resolved.find((t) => t.kind === 'num');
      const groupNumber = firstNum ? firstNum.number : 0;
      for (const tid of set.tiles) {
        if (freshTileIds.has(tid)) total += groupNumber;
      }
    } else if (v.type === 'run') {
      const start = findRunStart(resolved);
      if (start < 0) continue;
      for (let i = 0; i < set.tiles.length; i++) {
        const tid = set.tiles[i];
        if (freshTileIds.has(tid)) total += start + i;
      }
    }
  }
  return total;
}

/**
 * 조커가 대체하는 타일 후보 목록을 추론한다(런: 색+숫자 1개, 그룹: 같은 숫자 + 그 세트에 없는 색 N개).
 * 본 함수는 단일 세트 valid 상태에서만 의미가 있다.
 *
 * @param {Array<object>} resolvedTiles 세트의 타일 객체 배열 (이미 resolved)
 * @param {number} jokerIndex 그 조커의 인덱스(세트 내)
 * @returns {Array<{ color: string, number: number }>} 회수 가능한 손 타일 후보의 (color, number) 페어
 */
export function inferJokerReplacement(resolvedTiles, jokerIndex) {
  if (!Array.isArray(resolvedTiles) || jokerIndex < 0 || jokerIndex >= resolvedTiles.length) return [];
  const tile = resolvedTiles[jokerIndex];
  if (!tile || tile.kind !== 'joker') return [];
  const v = validateSet(resolvedTiles);
  if (!v.valid) return [];
  const out = [];
  if (v.type === 'group') {
    // 그룹: 같은 숫자 + 세트에 아직 없는 색.
    const nums = resolvedTiles.filter((t) => t && t.kind === 'num');
    if (nums.length === 0) return [];
    const groupNumber = nums[0].number;
    const usedColors = new Set(nums.map((t) => t.color));
    const COLORS = ['red', 'blue', 'black', 'orange'];
    for (const c of COLORS) {
      if (!usedColors.has(c)) out.push({ color: c, number: groupNumber });
    }
  } else if (v.type === 'run') {
    // 런: 같은 색 + 그 조커가 점유하는 슬롯의 숫자.
    const nums = resolvedTiles.filter((t) => t && t.kind === 'num');
    if (nums.length === 0) return [];
    const color = nums[0].color;
    const start = findRunStart(resolvedTiles);
    if (start < 0) return [];
    const slotNumber = start + jokerIndex;
    if (slotNumber >= 1 && slotNumber <= 13) out.push({ color, number: slotNumber });
  }
  return out;
}

/** validateSet 내부 best start와 동일. */
function findRunStart(tiles) {
  const jokers = tiles.filter((t) => t.kind === 'joker');
  const nums = tiles.filter((t) => t.kind === 'num');
  if (nums.length === 0) return -1;
  const minN = Math.min(...nums.map((t) => t.number));
  const maxN = Math.max(...nums.map((t) => t.number));
  const startMin = Math.max(1, maxN - tiles.length + 1);
  const startMax = Math.min(minN, 13 - tiles.length + 1);
  let bestScore = -1;
  let bestStart = -1;
  for (let start = startMin; start <= startMax; start++) {
    const end = start + tiles.length - 1;
    let ok = true;
    for (const n of nums) {
      if (n.number < start || n.number > end) { ok = false; break; }
    }
    if (!ok) continue;
    const missing = tiles.length - nums.length;
    if (missing !== jokers.length) continue;
    let score = 0;
    for (let v = start; v <= end; v++) score += v;
    if (score > bestScore) {
      bestScore = score;
      bestStart = start;
    }
  }
  return bestStart;
}
