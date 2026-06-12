/**
 * @fileoverview 루미큐브(Rummikub) 순수 게임 로직 — 서버 권위 모델.
 *
 * 표준 룰 (사용자 확정):
 *  - 2인 1:1. 타일 106개 (1~13 × 4색 × 2세트 = 104 + 조커 2).
 *  - 분배: 각자 손 14장. 더미 78장.
 *  - 세트:
 *      그룹(Group): 같은 숫자, 서로 다른 색, 3~4장.
 *      런(Run): 같은 색, 연속 숫자, 3장 이상 (1~13). wrap-around(12-13-1) 없음.
 *  - 첫 등판(Initial Meld): 본인이 처음 보드에 내는 모든 세트의 숫자 합 ≥ 30점.
 *      조커가 등판 세트에 포함되면 조커는 대체한 타일의 값으로 계산.
 *  - 등판 후: 보드의 다른 세트도 자유롭게 분해/재조합 가능.
 *      턴 종료 시점에 보드의 모든 세트가 valid 해야 함.
 *      invalid면 모든 변경 롤백 + 더미 1장 뽑기 + 턴 종료.
 *  - 조커 처리:
 *      어떤 타일도 대체 가능 (그룹/런).
 *      회수는 본 구현에서는 단순화 — 별도 회수 UI 없이 보드 변경 일반 흐름으로 처리.
 *  - 더미 뽑기 + 턴 종료:
 *      변경 없이 종료(못 내거나 invalid)면 더미 1장 뽑고 턴 종료.
 *      더미 비면 뽑기 스킵.
 *  - 승리: 손 타일 0장 즉시 승리.
 *      더미가 비고 양쪽이 한 번씩 연속 "패스"(보드 변경 없이 END_TURN)하면 라운드 종료 →
 *      손 타일 개수 적은 자 승리, 같으면 무승부.
 *  - 조커 회수(SWAP_JOKER):
 *      본인 턴에 보드 위 조커를 회수하려면 본인 손에서 그 조커가 대체하던 정확한 타일을 같은 자리에 넣어야 한다.
 *      회수된 조커는 그 턴 안에 보드의 다른 세트에 반드시 사용해야 한다(보유 불가).
 *      END_TURN 시 회수된 조커가 손에 남아있으면 invalid → 롤백 + 더미 1장.
 *
 * 보드 상태 모델:
 *   board = [{ id: 'set_N', type: 'group'|'run', tiles: [tileId, ...] }, ...]
 *
 * 타일 모델:
 *   { id, kind: 'num'|'joker', color: 'red'|'blue'|'black'|'orange'|null, number: 1~13|null }
 *
 * server.js가 본 모듈을 import 한다. WebSocket 코드는 포함하지 않는다.
 */

// ── 상수 ──────────────────────────────────────────────────────────

/** 색 4종. */
export const COLORS = ['red', 'blue', 'black', 'orange'];

/** 1~13 숫자 면. */
export const NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];

/** 초기 분배 손 타일 수. */
export const INITIAL_HAND_SIZE = 14;

/** 첫 등판 최소 점수. */
export const INITIAL_MELD_THRESHOLD = 30;

/** 그룹/런 최소 길이. */
export const MIN_SET_LENGTH = 3;

/** 그룹 최대 길이(색이 4종이므로). */
export const MAX_GROUP_LENGTH = 4;

/** 런 최대 길이(연속 숫자 1~13이므로). */
export const MAX_RUN_LENGTH = 13;

// ── 내부 헬퍼 ─────────────────────────────────────────────────────

/**
 * 상대 플레이어 ID를 반환한다(2인 고정).
 * @param {string} playerId 'p1'|'p2'
 * @returns {string} 상대 ID
 */
function opponentOf(playerId) {
  return playerId === 'p1' ? 'p2' : 'p1';
}

/**
 * 타일 풀(106장) 생성 + Fisher-Yates 셔플.
 * @returns {Array<object>} 셔플된 타일 배열
 */
function buildShuffledPool() {
  const pool = [];
  // 1~13 × 4색 × 2세트 = 104장.
  for (let copy = 1; copy <= 2; copy++) {
    for (const color of COLORS) {
      for (const number of NUMBERS) {
        pool.push({
          id: `${color}_${number}_${copy}`,
          kind: 'num',
          color,
          number,
        });
      }
    }
  }
  // 조커 2장.
  pool.push({ id: 'joker_a', kind: 'joker', color: null, number: null });
  pool.push({ id: 'joker_b', kind: 'joker', color: null, number: null });

  // Fisher-Yates 셔플 (in-place).
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
  }
  return pool;
}

/**
 * 타일 ID → 타일 객체 매핑(state.tiles에서 lookup).
 * @param {object} state
 * @param {string} tileId
 * @returns {object|null}
 */
function lookupTile(state, tileId) {
  return state.tiles[tileId] || null;
}

/**
 * 런 검증에서 결정된 "최선의 시작 슬롯"을 다시 계산한다.
 * validateSet의 best score를 부여한 start 위치와 동일해야 한다.
 * (swapJoker / computeInitialMeldScore가 호출하므로 헬퍼 섹션 상단에 둔다.)
 *
 * @param {Array<object>} tiles
 * @returns {number} start (1~13) 또는 -1
 */
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

/**
 * 단일 세트의 valid 여부 + 합산 점수를 계산한다.
 * 조커 점수는 "대체한 타일의 값"으로 계산한다(첫 등판 30점 계산에도 동일 적용).
 *
 * @param {Array<object>} tiles 세트 타일 객체 배열(이미 정렬되어 있다고 가정하지 않음 — 내부에서 룰에 맞게 검증)
 * @returns {{ valid: boolean, type: 'group'|'run'|null, score: number, error?: string }}
 */
export function validateSet(tiles) {
  if (!Array.isArray(tiles) || tiles.length < MIN_SET_LENGTH) {
    return { valid: false, type: null, score: 0, error: '세트는 최소 3장 이상이어야 합니다.' };
  }
  if (tiles.length > MAX_RUN_LENGTH) {
    return { valid: false, type: null, score: 0, error: '세트가 너무 깁니다.' };
  }

  // 조커와 일반 타일 분리.
  const jokers = tiles.filter((t) => t && t.kind === 'joker');
  const nums = tiles.filter((t) => t && t.kind === 'num');
  if (jokers.length + nums.length !== tiles.length) {
    return { valid: false, type: null, score: 0, error: '알 수 없는 타일이 포함되어 있습니다.' };
  }
  if (jokers.length > 2) {
    return { valid: false, type: null, score: 0, error: '조커는 최대 2장까지만 사용 가능합니다.' };
  }
  if (nums.length === 0) {
    // 조커만으로는 세트 type을 결정할 수 없으므로 invalid.
    return { valid: false, type: null, score: 0, error: '숫자 타일이 1장 이상 있어야 합니다.' };
  }

  // ── 그룹 검증: 같은 숫자, 다른 색 ──
  const sampleNumber = nums[0].number;
  const allSameNumber = nums.every((t) => t.number === sampleNumber);
  if (allSameNumber) {
    // 그룹 길이는 3 또는 4 (색이 4종).
    if (tiles.length < MIN_SET_LENGTH || tiles.length > MAX_GROUP_LENGTH) {
      // 길이 5장 이상 단일 숫자 → 그룹 불가. 런 검증으로 넘어감(아래).
      // 색 중복 검사도 함께 — 단일 숫자가 5장이면 색이 반드시 중복(4종뿐).
    } else {
      // 색 중복 검사.
      const colorSet = new Set(nums.map((t) => t.color));
      if (colorSet.size === nums.length) {
        // 정상 그룹. 점수 = 숫자 × 타일 수.
        const score = sampleNumber * tiles.length;
        return { valid: true, type: 'group', score };
      }
      // 색 중복 → 그룹 불가. 런 검증으로 fallthrough하지만 단일 숫자면 런도 불가.
      return { valid: false, type: null, score: 0, error: '그룹은 색이 모두 달라야 합니다.' };
    }
  }

  // ── 런 검증: 같은 색, 연속 숫자 ──
  const sampleColor = nums[0].color;
  const allSameColor = nums.every((t) => t.color === sampleColor);
  if (!allSameColor) {
    return { valid: false, type: null, score: 0, error: '같은 숫자도 아니고 같은 색도 아닙니다.' };
  }

  // 숫자 + 조커로 연속 배열 구성 가능한지 검증.
  // 알고리즘: 숫자 set, 빠진 자리를 조커로 채울 수 있는지.
  // 단순화: 가능한 시작 숫자 범위에서 길이 = tiles.length의 연속 슬롯 [start..start+len-1] 안에
  //         모든 num이 들어가고, 빠진 자리 수 ≤ jokers.length 여야 함.
  const numberSet = new Set(nums.map((t) => t.number));
  if (numberSet.size !== nums.length) {
    return { valid: false, type: null, score: 0, error: '런에는 같은 숫자가 중복될 수 없습니다.' };
  }
  const minN = Math.min(...nums.map((t) => t.number));
  const maxN = Math.max(...nums.map((t) => t.number));
  const span = maxN - minN + 1;
  // span 자체가 tiles.length보다 크면 조커로 다 못 채움 → invalid.
  // (예: 1,5만 있고 길이 3 = jokers 1장 → span 5 > 3 → invalid)
  if (span > tiles.length) {
    return { valid: false, type: null, score: 0, error: '연속 숫자 범위가 너무 넓습니다.' };
  }
  // tiles.length 길이의 연속 슬롯이어야 한다. 시작 후보는 maxN - tiles.length + 1 .. minN.
  // 시작 ≥ 1, 끝(start + tiles.length - 1) ≤ 13.
  const startMin = Math.max(1, maxN - tiles.length + 1);
  const startMax = Math.min(minN, 13 - tiles.length + 1);
  if (startMin > startMax) {
    return { valid: false, type: null, score: 0, error: '런이 1~13 범위를 벗어납니다.' };
  }
  // 가능한 시작 위치 중 점수 합이 최대가 되는 배치를 선택.
  // 점수 = 연속 슬롯의 모든 숫자 합 (조커는 대체한 자리 숫자로 계산).
  let bestScore = -1;
  let bestStart = -1;
  for (let start = startMin; start <= startMax; start++) {
    const end = start + tiles.length - 1;
    // 모든 num이 [start..end] 안에 들어가야 함.
    let ok = true;
    for (const n of nums) {
      if (n.number < start || n.number > end) { ok = false; break; }
    }
    if (!ok) continue;
    // 빠진 자리 수 = 슬롯 길이 - 일반 타일 수.
    const missing = tiles.length - nums.length;
    if (missing !== jokers.length) {
      // 단순화: 조커 수가 빠진 자리 수와 일치해야 함 (남으면 invalid).
      continue;
    }
    // 점수 계산.
    let score = 0;
    for (let v = start; v <= end; v++) score += v;
    if (score > bestScore) {
      bestScore = score;
      bestStart = start;
    }
  }
  if (bestStart < 0) {
    return { valid: false, type: null, score: 0, error: '런을 구성할 수 없습니다(조커 배치 불가).' };
  }
  return { valid: true, type: 'run', score: bestScore };
}

/**
 * 세트 1개의 타일 객체 배열을 얻는다(state.tiles lookup).
 * 누락된 타일 ID가 있으면 null 반환.
 * @param {object} state
 * @param {Array<string>} tileIds
 * @returns {Array<object>|null}
 */
function resolveSet(state, tileIds) {
  const out = [];
  for (const id of tileIds) {
    const t = lookupTile(state, id);
    if (!t) return null;
    out.push(t);
  }
  return out;
}

/**
 * 보드 전체 valid 여부를 검사한다.
 * 빈 세트는 무시(자동 제거 대상). 하나라도 invalid면 전체 invalid.
 *
 * @param {object} state
 * @returns {{ valid: boolean, errors: Array<{ setId: string, error: string }> }}
 */
export function validateBoard(state) {
  const errors = [];
  for (const set of state.board) {
    if (!set.tiles || set.tiles.length === 0) continue; // 빈 세트는 검사 스킵(자동 제거).
    const resolved = resolveSet(state, set.tiles);
    if (!resolved) {
      errors.push({ setId: set.id, error: '타일 lookup 실패' });
      continue;
    }
    const v = validateSet(resolved);
    if (!v.valid) {
      errors.push({ setId: set.id, error: v.error || '유효하지 않은 세트' });
    }
  }
  return { valid: errors.length === 0, errors };
}

/**
 * 빈 세트를 보드에서 제거한다(in-place).
 * @param {object} state
 */
function removeEmptySets(state) {
  state.board = state.board.filter((s) => s.tiles && s.tiles.length > 0);
}

/**
 * 보드 변경 전 스냅샷을 만든다(turn 시작 시 보존, 롤백용).
 * tiles 객체는 immutable로 가정하므로 ID 구조만 깊은 복사한다.
 * @param {object} state
 * @returns {object} 스냅샷 (board + hands + lastMovedFromHand)
 */
function snapshotForRollback(state) {
  return {
    board: state.board.map((s) => ({ id: s.id, type: s.type, tiles: s.tiles.slice() })),
    hands: { p1: state.hands.p1.slice(), p2: state.hands.p2.slice() },
    nextSetSeq: state.nextSetSeq,
    // 롤백 시 회수 조커 추적도 함께 복원(스냅샷 시점 = 턴 시작이므로 일반적으로 빈 dict).
    jokerReturnedThisTurn: { ...(state.jokerReturnedThisTurn || {}) },
  };
}

/**
 * 롤백 스냅샷을 state에 복원한다.
 * @param {object} state
 * @param {object} snap
 */
function restoreFromSnapshot(state, snap) {
  state.board = snap.board.map((s) => ({ id: s.id, type: s.type, tiles: s.tiles.slice() }));
  state.hands = { p1: snap.hands.p1.slice(), p2: snap.hands.p2.slice() };
  state.nextSetSeq = snap.nextSetSeq;
  // 조커 회수 추적도 스냅샷 시점(보통 빈 dict)으로 되돌린다.
  state.jokerReturnedThisTurn = { ...(snap.jokerReturnedThisTurn || {}) };
}

// ── 공개 함수: 게임 상태 ─────────────────────────────────────────

/**
 * 새 게임 상태를 생성한다. 선공 = p1 고정.
 * @returns {GameState}
 */
export function createGame() {
  const pool = buildShuffledPool();

  // 타일 ID → 타일 매핑(전역 lookup용. immutable).
  const tiles = {};
  for (const t of pool) tiles[t.id] = t;

  // 분배: p1 14장, p2 14장. 나머지는 deck.
  const p1Hand = pool.slice(0, INITIAL_HAND_SIZE).map((t) => t.id);
  const p2Hand = pool.slice(INITIAL_HAND_SIZE, INITIAL_HAND_SIZE * 2).map((t) => t.id);
  const deck = pool.slice(INITIAL_HAND_SIZE * 2).map((t) => t.id);

  /** @type {GameState} */
  const state = {
    tiles, // immutable lookup
    hands: { p1: p1Hand, p2: p2Hand },
    deck, // 남은 더미 (tile id 배열)
    board: [], // 세트 배열
    nextSetSeq: 1, // 세트 ID 일련번호
    currentTurn: 'p1',
    turnNumber: 1,
    played: { p1: false, p2: false }, // 첫 등판 완료 여부
    phase: 'playing', // 'playing' | 'ended'
    result: null,
    // 턴 시작 시 스냅샷(턴 도중 롤백 + END_TURN 검증 비교용).
    turnSnapshot: null,
    // 이번 턴에 보드에서 회수된 조커 ID 집합. END_TURN 시 손에 남아있으면 invalid.
    // (Set은 직렬화 어려우니 일반 객체 dict로 보관: { [tileId]: true })
    jokerReturnedThisTurn: {},
    // 더미가 빈 이후 연속 패스(보드 변경 없는 END_TURN) 카운트. 2 도달 시 라운드 종료.
    consecutivePassesAfterDeckEmpty: 0,
  };
  // 첫 턴 스냅샷 캡처.
  state.turnSnapshot = snapshotForRollback(state);
  return state;
}

/**
 * 보드에 새 빈 세트를 추가한다(클라가 NEW_SET 호출 시).
 * @param {object} state
 * @param {string} by
 * @returns {{ ok: boolean, error?: string, setId?: string }}
 */
export function addNewSet(state, by) {
  if (state.phase !== 'playing') return { ok: false, error: '게임이 진행 중이 아닙니다.' };
  if (state.currentTurn !== by) return { ok: false, error: '지금은 당신의 턴이 아닙니다.' };
  // [#8] 빈 세트(tiles.length === 0) 4개 이상이면 추가 거부 — 클라 UI 스크롤 폭주 방지.
  const emptyCount = state.board.filter((s) => !s.tiles || s.tiles.length === 0).length;
  if (emptyCount >= 4) {
    return { ok: false, error: '빈 세트는 동시에 4개까지만 만들 수 있습니다.' };
  }
  const setId = `set_${state.nextSetSeq}`;
  state.nextSetSeq += 1;
  state.board.push({ id: setId, type: 'group', tiles: [] });
  return { ok: true, setId };
}

/**
 * 타일 이동: from(소스 위치)에서 to(대상 위치)로 옮긴다.
 *
 * from / to 위치 형식:
 *   { kind: 'hand', tileId: string }
 *   { kind: 'set', setId: string, tileId?: string, index?: number }
 *
 * - 손 → 세트(끝에 추가): from={kind:'hand', tileId}, to={kind:'set', setId, index?}
 * - 세트 → 손: from={kind:'set', setId, tileId}, to={kind:'hand'}
 *   (단, 첫 등판 전엔 본인 손 타일만 회수 가능 — 보드 위 타일은 본인 turnSnapshot에 없는 한 회수 불가)
 * - 세트 → 다른 세트: from={kind:'set', setId, tileId}, to={kind:'set', setId, index?}
 *
 * 본 함수는 단순 위치 이동만 수행하고 룰 검증은 하지 않는다(END_TURN 시점에 일괄 검증).
 *
 * @param {object} state
 * @param {string} by
 * @param {object} from
 * @param {object} to
 * @returns {{ ok: boolean, error?: string }}
 */
export function moveTile(state, by, from, to) {
  if (state.phase !== 'playing') return { ok: false, error: '게임이 진행 중이 아닙니다.' };
  if (state.currentTurn !== by) return { ok: false, error: '지금은 당신의 턴이 아닙니다.' };
  if (!from || !to) return { ok: false, error: '이동 위치가 누락되었습니다.' };

  // ── 1단계: from 검증(splice 없이 dry-run) ──
  // from의 타일 ID와 인덱스 확인만 하고 실제 splice는 to 검증 후로 미룬다.
  // 이렇게 해야 to 라우터에서 거부될 때 from을 복구할 필요가 없어 트랜잭션 일관성이 보장된다.
  let tileId = null;
  let fromSet = null;
  let fromSetIdx = -1;
  let fromHandIdx = -1;
  if (from.kind === 'hand') {
    tileId = from.tileId;
    if (!tileId) return { ok: false, error: 'from.tileId 누락' };
    const hand = state.hands[by];
    fromHandIdx = hand.indexOf(tileId);
    if (fromHandIdx < 0) return { ok: false, error: '본인 손에 해당 타일이 없습니다.' };
  } else if (from.kind === 'set') {
    fromSet = state.board.find((s) => s.id === from.setId);
    if (!fromSet) return { ok: false, error: `세트 ${from.setId} 없음` };
    tileId = from.tileId;
    if (!tileId) return { ok: false, error: 'from.tileId 누락' };
    fromSetIdx = fromSet.tiles.indexOf(tileId);
    if (fromSetIdx < 0) return { ok: false, error: `세트 ${from.setId}에 타일 ${tileId} 없음` };
    // 보드 → 손 회수 가드: 본인이 아직 첫 등판 전이면 본인 turnSnapshot 손에 있던 타일만 회수 가능.
    // (= 이번 턴에 본인이 보드로 옮긴 타일을 다시 회수하는 케이스만 허용)
    // 첫 등판 후엔 룰상 보드 자유 분해가 가능하므로 가드 해제. invalid한 보드 상태로 END_TURN 시 자동 롤백.
    if (to.kind === 'hand' && !state.played[by]) {
      const wasInMyHand = state.turnSnapshot && state.turnSnapshot.hands[by].includes(tileId);
      if (!wasInMyHand) {
        return { ok: false, error: '첫 등판 전에는 보드의 다른 타일을 회수할 수 없습니다. 본인이 이번 턴에 낸 타일만 가능합니다.' };
      }
    }
    // [#2] 첫 등판 전: 보드 타일을 다른 보드 세트로 이동하는 것도 차단.
    // (기존 보드 타일을 본인 등판 세트에 결합해 30점 계산을 오염시키는 것을 막는다.
    //  본인이 이번 턴에 손에서 낸 타일만 세트 이동을 허용한다.)
    if (to.kind === 'set' && !state.played[by]) {
      const wasInMyHand = state.turnSnapshot && state.turnSnapshot.hands[by].includes(tileId);
      if (!wasInMyHand) {
        return {
          ok: false,
          error: '첫 등판 전에는 본인이 이번 턴에 낸 타일로만 새 세트를 만들 수 있습니다.',
        };
      }
    }
  } else {
    return { ok: false, error: '알 수 없는 from.kind' };
  }

  // ── 2단계: to 검증(여전히 splice 없이 dry-run) ──
  // 잘못된 to.kind / 없는 to.setId는 여기서 모두 거부한다. from은 아직 손대지 않았으므로 유실 위험 없음.
  let toSet = null;
  if (to.kind === 'hand') {
    // 본인 손으로 회수 — 추가 검증 없음.
  } else if (to.kind === 'set') {
    toSet = state.board.find((s) => s.id === to.setId);
    if (!toSet) return { ok: false, error: `세트 ${to.setId} 없음` };
  } else {
    return { ok: false, error: '알 수 없는 to.kind' };
  }

  // ── 3단계: 양쪽 검증 통과 → 실제 mutation 수행 ──
  // from에서 제거.
  if (from.kind === 'hand') {
    state.hands[by].splice(fromHandIdx, 1);
  } else { // 'set'
    fromSet.tiles.splice(fromSetIdx, 1);
  }
  // to에 추가.
  if (to.kind === 'hand') {
    state.hands[by].push(tileId);
  } else { // 'set'
    // [#6] to.index는 "이동 전 배열" 기준 슬롯 위치다. 같은 세트면 위에서 from을
    // 이미 splice해 길이가 1 줄었으므로, 유효 범위 판정도 이동 전 길이 기준이어야
    // 끝 슬롯(index === 이동 전 length)이 잘못 클램프되지 않는다. (QA-ISSUE-1 fix)
    const preLen = (toSet === fromSet) ? toSet.tiles.length + 1 : toSet.tiles.length;
    let insertIdx = (Number.isInteger(to.index) && to.index >= 0 && to.index <= preLen)
      ? to.index
      : preLen;
    // 같은 세트 내 오른쪽 이동: from 제거로 이후 인덱스가 1 당겨지므로 보정한다.
    // (from.kind === 'hand'이면 fromSet === null이라 조건이 false → 보정 없음)
    if (toSet === fromSet && insertIdx > fromSetIdx) {
      insertIdx -= 1;
    }
    toSet.tiles.splice(insertIdx, 0, tileId);
  }

  // ── 정규화: 영향받은 세트가 valid이면 tiles 배열을 오름차순 재정렬(표시 목적) ──
  // invalid(배치 중) 세트는 normalizeSetTiles 내부에서 자동 스킵된다.
  // 동일 세트(toSet === fromSet) 내 이동이면 한 번만 호출.
  if (fromSet) normalizeSetTiles(state, fromSet);
  if (toSet && toSet !== fromSet) normalizeSetTiles(state, toSet);

  return { ok: true };
}

/**
 * valid 세트의 tiles 배열을 오름차순으로 정규화한다(in-place, 표시 목적).
 *
 * - 런: `findRunStart`로 시작 슬롯 결정 후 start~end 슬롯 순서로 재배열.
 *       숫자 타일은 자기 슬롯에, 빠진 슬롯에는 조커를 오름차순으로 배정한다.
 * - 그룹: COLOR_ORDER(red, blue, black, orange) 순 + 조커 마지막.
 *
 * invalid 세트(배치 중 / 부분 구성)는 절대 건드리지 않는다.
 * 정규화는 순수 표시 목적이며 endTurn/rollback/점수 계산 로직과 무관하다.
 * (export하지 않음 — moveTile / swapJoker 내부에서만 호출)
 *
 * @param {object} state
 * @param {{ id: string, type: string, tiles: Array<string> }} set 정규화 대상 세트(in-place 수정)
 */
function normalizeSetTiles(state, set) {
  if (!set || !set.tiles || set.tiles.length === 0) return;
  const resolved = resolveSet(state, set.tiles);
  if (!resolved) return;
  const v = validateSet(resolved);
  if (!v.valid) return; // invalid 세트(배치 중)는 정규화 안 함.

  if (v.type === 'run') {
    // ── 런 정규화 ──
    // 1) findRunStart로 시작 슬롯 결정(validateSet의 best start와 일치).
    // 2) start~end 슬롯 순으로 tiles 재배열.
    // 3) 숫자 타일은 자기 슬롯, 빠진 슬롯에는 조커를 오름차순으로 배정.
    const start = findRunStart(resolved);
    if (start < 0) return;
    const end = start + set.tiles.length - 1;

    // 숫자 number → tileId 매핑 + 조커 ID 수집.
    const numByValue = new Map(); // number → tileId
    const jokerIds = [];
    for (let i = 0; i < set.tiles.length; i++) {
      const t = resolved[i];
      if (t.kind === 'num') numByValue.set(t.number, set.tiles[i]);
      else jokerIds.push(set.tiles[i]);
    }

    // 슬롯 순서대로 tiles 재배열(빠진 슬롯은 조커로 메움).
    const ordered = [];
    let jokerIdx = 0;
    for (let v2 = start; v2 <= end; v2++) {
      if (numByValue.has(v2)) {
        ordered.push(numByValue.get(v2));
      } else {
        // 빠진 슬롯 → 조커(원래 배열 순서와 무관, 슬롯 오름차순 배정).
        ordered.push(jokerIds[jokerIdx++]);
      }
    }
    set.tiles = ordered;
  } else if (v.type === 'group') {
    // ── 그룹 정규화 ──
    // COLOR_ORDER 순 정렬 + 조커는 항상 마지막.
    const COLOR_ORDER = ['red', 'blue', 'black', 'orange'];
    const numTileIds = [];
    const jokerIds = [];
    for (let i = 0; i < set.tiles.length; i++) {
      const t = resolved[i];
      if (t.kind === 'num') numTileIds.push(set.tiles[i]);
      else jokerIds.push(set.tiles[i]);
    }
    numTileIds.sort((aId, bId) => {
      const ta = state.tiles[aId];
      const tb = state.tiles[bId];
      return COLOR_ORDER.indexOf(ta.color) - COLOR_ORDER.indexOf(tb.color);
    });
    set.tiles = [...numTileIds, ...jokerIds];
  }
}

// ── 조커 회수(SWAP_JOKER) ────────────────────────────────────────

/**
 * 보드 위 조커 1장을, 본인 손의 "그 조커가 대체하던 정확한 타일"과 교환한다.
 *
 * 규칙:
 *  - 본인 턴, playing 상태에서만.
 *  - setId의 jokerIndex 위치에 조커가 있어야 한다.
 *  - 본인 손의 handTileId가 존재하고, 조커가 대체하던 타일(런: 색+숫자 정확, 그룹: 같은 숫자 + 그 세트에 없는 색)과 일치해야 한다.
 *  - 성공 시: 조커 → 본인 손, handTileId → 보드 그 자리.
 *  - jokerReturnedThisTurn[조커ID] = true 표시. END_TURN 시 손에 남아있으면 invalid.
 *
 * @param {object} state
 * @param {string} by
 * @param {{ setId: string, jokerIndex: number, handTileId: string }} params
 * @returns {{ ok: boolean, error?: string, jokerId?: string }}
 */
export function swapJoker(state, by, params) {
  if (state.phase !== 'playing') return { ok: false, error: '게임이 진행 중이 아닙니다.' };
  if (state.currentTurn !== by) return { ok: false, error: '지금은 당신의 턴이 아닙니다.' };
  // [#4] 첫 등판 전에는 조커 회수 불가.
  if (!state.played[by]) {
    return { ok: false, error: '조커 회수는 첫 등판 후에만 가능합니다.' };
  }
  if (!params || typeof params.setId !== 'string' || !Number.isInteger(params.jokerIndex) || typeof params.handTileId !== 'string') {
    return { ok: false, error: 'SWAP_JOKER 인자 누락' };
  }
  const { setId, jokerIndex, handTileId } = params;

  const set = state.board.find((s) => s.id === setId);
  if (!set) return { ok: false, error: `세트 ${setId} 없음` };
  if (jokerIndex < 0 || jokerIndex >= set.tiles.length) return { ok: false, error: '조커 위치 인덱스 범위 밖' };

  const jokerTileId = set.tiles[jokerIndex];
  const jokerTile = lookupTile(state, jokerTileId);
  if (!jokerTile || jokerTile.kind !== 'joker') return { ok: false, error: '해당 위치는 조커가 아닙니다.' };

  // 본인 손에 handTileId 있는지.
  const myHand = state.hands[by];
  const handIdx = myHand.indexOf(handTileId);
  if (handIdx < 0) return { ok: false, error: '본인 손에 해당 타일이 없습니다.' };

  const handTile = lookupTile(state, handTileId);
  if (!handTile || handTile.kind !== 'num') return { ok: false, error: '조커 자리에는 숫자 타일만 넣을 수 있습니다.' };

  // ── [#4] 1차: 정확 대체 타일 검증 (기존 "교체 후 valid" 검증보다 엄격) ──
  const setResolved = set.tiles.map((tid) => lookupTile(state, tid));
  if (setResolved.some((t) => !t)) return { ok: false, error: '세트 타일 lookup 실패' };
  const setValidation = validateSet(setResolved);
  if (!setValidation.valid) {
    return { ok: false, error: '대상 세트가 현재 유효하지 않습니다.' };
  }
  if (setValidation.type === 'group') {
    // 그룹: 같은 숫자 + 세트에 없는 색이어야 한다.
    const groupNums = setResolved.filter((t) => t.kind === 'num');
    const groupNumber = groupNums.length > 0 ? groupNums[0].number : null;
    const usedColors = new Set(groupNums.map((t) => t.color));
    if (handTile.number !== groupNumber || usedColors.has(handTile.color)) {
      return {
        ok: false,
        error: '조커가 대체하던 타일과 일치하지 않습니다. 그룹: 같은 숫자 + 세트에 없는 색이어야 합니다.',
      };
    }
  } else if (setValidation.type === 'run') {
    // 런: 같은 색 + 빠진 슬롯 숫자 중 하나여야 한다.
    const runNums = setResolved.filter((t) => t.kind === 'num');
    if (runNums.length === 0) return { ok: false, error: '세트 타일 오류' };
    const runColor = runNums[0].color;
    if (handTile.color !== runColor) {
      return { ok: false, error: '조커가 대체하던 타일과 일치하지 않습니다. 런: 같은 색이어야 합니다.' };
    }
    // 빠진 슬롯 집합 = [start..end] − {숫자타일 numbers}.
    const start = findRunStart(setResolved);
    if (start < 0) return { ok: false, error: '런 시작 슬롯 계산 실패' };
    const end = start + setResolved.length - 1;
    const numSet = new Set(runNums.map((t) => t.number));
    const missingSlots = [];
    for (let v = start; v <= end; v++) {
      if (!numSet.has(v)) missingSlots.push(v);
    }
    if (!missingSlots.includes(handTile.number)) {
      return {
        ok: false,
        error: `조커가 대체하던 타일과 일치하지 않습니다. 런에서 빠진 슬롯: [${missingSlots.join(',')}]`,
      };
    }
  }

  // 조커를 손 타일로 가상 교체한 세트가 valid한지 + 손 타일이 정확히 그 슬롯에 들어맞는지 검증.
  const candidateTiles = set.tiles.map((tid, i) => i === jokerIndex ? handTile : lookupTile(state, tid));
  if (candidateTiles.some((t) => !t)) return { ok: false, error: '세트 타일 lookup 실패' };
  const v = validateSet(candidateTiles);
  if (!v.valid) {
    return { ok: false, error: '조커가 대체하던 타일과 일치하지 않습니다.' };
  }

  // 추가 안전망: 가상 교체한 세트는 조커가 없어야 한다 — 즉 한 자리만 정확히 메꿔야 한다.
  // (validateSet은 조커가 더 있어도 valid일 수 있으므로 여기서 명시 확인은 생략.
  //  유일한 위험은 같은 세트에 조커가 2장인데 손 타일 1장으로는 1장만 빠진 자리만 메꾸므로 OK.)

  // 교환 수행.
  set.tiles[jokerIndex] = handTileId;
  myHand.splice(handIdx, 1);
  myHand.push(jokerTileId);

  // 회수된 조커 추적(이번 턴에 손에 있으면 안 됨 — END_TURN 검증).
  state.jokerReturnedThisTurn[jokerTileId] = true;

  // ── 정규화: 교환 완료 후 세트가 valid이면 tiles 배열 재정렬(표시 목적) ──
  // jokerIndex 기반 검증/교환은 위에서 이미 완료됐으므로 정규화는 그 이후에 수행한다.
  normalizeSetTiles(state, set);

  return { ok: true, jokerId: jokerTileId };
}

/**
 * 턴 종료: 보드 검증 + 첫 등판 점수 검증 + 더미 뽑기/턴 교대/승리 판정.
 *
 * 흐름:
 *  1) 보드 valid? → invalid면 turnSnapshot으로 롤백 + 더미 1장 뽑기 + 턴 교대.
 *  2) 이번 턴에 변경이 없었는가?
 *     - 변경 없음: 더미 1장 뽑기 + 턴 교대 (passive turn).
 *  3) 변경 있음 + valid:
 *     - 첫 등판 미완료인 경우: 본인이 이번 턴에 보드에 새로 추가한 타일들의 점수 합 ≥ 30 검증.
 *       부족하면 롤백 + 더미 1장 뽑기 + 턴 교대.
 *     - 충족 또는 이미 등판: 변경 확정.
 *  4) 손 0장이면 승리.
 *  5) 다음 턴 시작 — 빈 세트 제거 + 새 turnSnapshot 캡처.
 *
 * @param {object} state
 * @param {string} by
 * @returns {{
 *   ok: boolean,
 *   error?: string,
 *   committed: boolean,
 *   drewTile?: string|null,
 *   gameOver?: boolean,
 *   reason?: 'invalid_board'|'no_change'|'initial_meld_short'|'joker_unused'|'no_tile_played'|'committed'
 * }}
 */
export function endTurn(state, by) {
  if (state.phase !== 'playing') return { ok: false, committed: false, error: '게임이 진행 중이 아닙니다.' };
  if (state.currentTurn !== by) return { ok: false, committed: false, error: '지금은 당신의 턴이 아닙니다.' };

  const snap = state.turnSnapshot;
  const handChanged = !arraysEqualUnordered(state.hands[by], snap.hands[by]);
  // 실질 보드 변화 판정: 빈 세트를 무시한 상태(=commit 후 모습)에서 스냅샷 보드와 비교.
  // 빈 NEW_SET 추가/제거만으로는 실질 변화로 보지 않는다 — 안 그러면 패스 카운터 무한 우회 가능.
  // (보드에 변경이 있어도 손 변화가 0장이고 빈 세트 제거 후 동일하면 = 사실상 패스)
  const boardChanged = !boardsEqualIgnoringEmpty(state.board, snap.board);
  const hasChange = handChanged || boardChanged;

  // ── 케이스 1: 변경 없음 ──
  if (!hasChange) {
    // 빈 NEW_SET이 남아있다면 정리하고 패스로 처리.
    removeEmptySets(state);
    const drewTile = drawOne(state, by);
    // 더미가 비고 + 보드 변경 없음 → 패스 1회로 카운트.
    if (drewTile === null && state.deck.length === 0) {
      state.consecutivePassesAfterDeckEmpty = (state.consecutivePassesAfterDeckEmpty || 0) + 1;
    }
    return finishTurn(state, by, { committed: false, drewTile, reason: 'no_change' });
  }

  // ── 케이스 2: 변경 있음 → 보드 valid 검사 ──
  // 빈 세트는 검증에서 무시(commit 시점에 자동 제거).
  const v = validateBoard(state);
  if (!v.valid) {
    // 롤백 + 더미 1장 + 턴 교대.
    restoreFromSnapshot(state, snap);
    const drewTile = drawOne(state, by);
    if (drewTile === null && state.deck.length === 0) {
      state.consecutivePassesAfterDeckEmpty = (state.consecutivePassesAfterDeckEmpty || 0) + 1;
    }
    return finishTurn(state, by, {
      committed: false,
      drewTile,
      reason: 'invalid_board',
      error: '보드에 유효하지 않은 세트가 있어 변경이 롤백되었습니다.',
    });
  }

  // ── 회수된 조커가 손에 남아있는지 검증(SWAP_JOKER 후 미사용) ──
  // 이번 턴 swapJoker로 회수된 조커 ID들이 현재 손에 있으면 invalid → 롤백.
  const returnedJokerIds = Object.keys(state.jokerReturnedThisTurn || {});
  if (returnedJokerIds.length > 0) {
    const myHandSet = new Set(state.hands[by]);
    const stuck = returnedJokerIds.filter((jid) => myHandSet.has(jid));
    if (stuck.length > 0) {
      restoreFromSnapshot(state, snap);
      const drewTile = drawOne(state, by);
      if (drewTile === null && state.deck.length === 0) {
        state.consecutivePassesAfterDeckEmpty = (state.consecutivePassesAfterDeckEmpty || 0) + 1;
      }
      return finishTurn(state, by, {
        committed: false,
        drewTile,
        reason: 'joker_unused',
        error: '회수한 조커는 그 턴 안에 다른 세트에 사용해야 합니다.',
      });
    }
  }

  // ── [#1] 손 타일 감소 검사: 보드에 최소 1장을 내야 commit 가능 ──
  // 보드 변경이 있더라도 손에서 타일을 1장도 내지 않은 경우(순수 재배치)는 패스로 처리.
  // (손이 줄지 않았다 = 손에서 보드로 옮긴 타일이 없다)
  if (state.hands[by].length >= snap.hands[by].length) {
    restoreFromSnapshot(state, snap);
    const drewTile = drawOne(state, by);
    if (drewTile === null && state.deck.length === 0) {
      state.consecutivePassesAfterDeckEmpty = (state.consecutivePassesAfterDeckEmpty || 0) + 1;
    }
    return finishTurn(state, by, {
      committed: false,
      drewTile,
      reason: 'no_tile_played',
      error: '손에서 1장 이상 내지 않아 변경이 롤백되었습니다.',
    });
  }

  // ── 첫 등판(Initial Meld) 검증 ──
  if (!state.played[by]) {
    const meldScore = computeInitialMeldScore(state, snap, by);
    if (meldScore < INITIAL_MELD_THRESHOLD) {
      // 롤백 + 더미 1장 + 턴 교대.
      restoreFromSnapshot(state, snap);
      const drewTile = drawOne(state, by);
      if (drewTile === null && state.deck.length === 0) {
        state.consecutivePassesAfterDeckEmpty = (state.consecutivePassesAfterDeckEmpty || 0) + 1;
      }
      return finishTurn(state, by, {
        committed: false,
        drewTile,
        reason: 'initial_meld_short',
        error: `첫 등판은 30점 이상이어야 합니다 (현재 ${meldScore}점).`,
      });
    }
    state.played[by] = true;
  }

  // ── commit ──
  removeEmptySets(state);
  // 보드 변경 commit → 더미 빈 후 패스 카운터 리셋.
  state.consecutivePassesAfterDeckEmpty = 0;
  // 승리 판정.
  if (state.hands[by].length === 0) {
    state.phase = 'ended';
    state.result = {
      winner: by,
      reason: 'empty_hand',
      handCounts: {
        p1: state.hands.p1.length,
        p2: state.hands.p2.length,
      },
    };
    return { ok: true, committed: true, gameOver: true, reason: 'committed' };
  }
  return finishTurn(state, by, { committed: true, drewTile: null, reason: 'committed' });
}

/**
 * 더미에서 1장 뽑아 손에 넣는다. 더미가 비면 null.
 * @param {object} state
 * @param {string} by
 * @returns {string|null} 뽑은 타일 ID
 */
function drawOne(state, by) {
  if (state.deck.length === 0) return null;
  const tileId = state.deck.shift();
  state.hands[by].push(tileId);
  return tileId;
}

/**
 * 턴 종료 후 상태 갱신(턴 교대 + 새 스냅샷).
 * @param {object} state
 * @param {string} by
 * @param {{committed: boolean, drewTile: string|null, reason: string, error?: string}} info
 * @returns {object}
 */
function finishTurn(state, by, info) {
  // ── 라운드 종료 트리거: 더미 비고 + 양쪽 연속 패스 2회(=한 번씩) ──
  if ((state.consecutivePassesAfterDeckEmpty || 0) >= 2 && state.deck.length === 0) {
    // 손 타일 개수 적은 자 승리, 같으면 무승부.
    const p1Cnt = state.hands.p1.length;
    const p2Cnt = state.hands.p2.length;
    let winner = 'draw';
    if (p1Cnt < p2Cnt) winner = 'p1';
    else if (p2Cnt < p1Cnt) winner = 'p2';
    state.phase = 'ended';
    state.result = {
      winner,
      reason: 'deck_empty_pass',
      handCounts: { p1: p1Cnt, p2: p2Cnt },
    };
    return {
      ok: true,
      committed: info.committed,
      drewTile: info.drewTile,
      gameOver: true,
      reason: info.reason,
      error: info.error,
    };
  }

  state.currentTurn = opponentOf(by);
  state.turnNumber += 1;
  removeEmptySets(state); // 빈 세트 정리(다음 턴 시작 전).
  state.turnSnapshot = snapshotForRollback(state);
  // 새 턴 시작 — 회수 조커 추적 초기화.
  state.jokerReturnedThisTurn = {};
  return {
    ok: true,
    committed: info.committed,
    drewTile: info.drewTile,
    gameOver: false,
    reason: info.reason,
    error: info.error,
  };
}

/**
 * 두 손패 배열이 (순서 무관) 동일한지.
 * @param {Array<string>} a
 * @param {Array<string>} b
 * @returns {boolean}
 */
function arraysEqualUnordered(a, b) {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return false;
  return true;
}

/**
 * 두 보드(set 배열)가 동일한지(순서 무관, 세트별 타일 순서 비교).
 * 동일 세트 ID + 동일 타일 ID 시퀀스.
 * @param {Array<object>} a
 * @param {Array<object>} b
 * @returns {boolean}
 */
function boardsEqual(a, b) {
  if (a.length !== b.length) return false;
  const mapA = new Map(a.map((s) => [s.id, s.tiles.join(',')]));
  for (const sb of b) {
    const va = mapA.get(sb.id);
    if (va === undefined) return false;
    if (va !== sb.tiles.join(',')) return false;
  }
  return true;
}

/**
 * 빈 세트를 무시한 보드 동등 비교.
 * `endTurn`에서 빈 NEW_SET 추가/제거만으로는 실질 보드 변화로 보지 않는 용도.
 * 양쪽 보드를 tiles.length > 0인 세트만 추려 비교한다.
 * @param {Array<object>} a
 * @param {Array<object>} b
 * @returns {boolean}
 */
function boardsEqualIgnoringEmpty(a, b) {
  const aNon = a.filter((s) => s.tiles && s.tiles.length > 0);
  const bNon = b.filter((s) => s.tiles && s.tiles.length > 0);
  return boardsEqual(aNon, bNon);
}

/**
 * 첫 등판 점수 계산: 이번 턴에 보드에 "새로 추가된" 타일들의 합.
 * 본인 손에서 보드로 옮긴 타일만 점수에 포함된다(보드 재구성은 점수 X).
 *
 * 알고리즘:
 *  1) 현재 보드의 모든 타일 ID 집합 = boardNow.
 *  2) 턴 시작 시 보드 타일 ID 집합 = boardBefore.
 *  3) added = boardNow - boardBefore.
 *  4) added 중 본인 turnSnapshot의 손에 있던 타일만 점수에 포함.
 *  5) 점수 = 각 타일이 속한 세트의 validateSet 결과 type에 따라:
 *     - 그룹: 타일.number 그대로 (조커는 그 세트의 sampleNumber로).
 *     - 런: 타일이 점유한 슬롯 숫자 (조커는 점유한 슬롯 숫자로).
 *
 * 단순화: 각 세트별로 점수 계산 후 added 타일의 비율로 안분.
 *   - 그룹: 그룹 점수는 number × 길이. added 타일 수 × number = added 분 점수.
 *   - 런: 런 점수는 연속 합. 정확 안분 어려우니 "added 타일이 점유한 슬롯의 숫자" 합산이 필요.
 *
 * 안분 정확성을 위해 본 구현은 세트별로 다음을 수행:
 *   - 그룹: added 타일 1장당 number 점수.
 *   - 런: validateSet가 결정한 시작 슬롯에서, added 타일의 위치(인덱스)를 추적해 점수 합.
 *
 * @param {object} state 현재(=턴 종료 직전) state
 * @param {object} snap 턴 시작 시 스냅샷
 * @param {string} by
 * @returns {number} 첫 등판 점수 합
 */
function computeInitialMeldScore(state, snap, by) {
  // 턴 시작 시 보드에 있던 타일 ID 집합.
  const beforeIds = new Set();
  for (const s of snap.board) for (const tid of s.tiles) beforeIds.add(tid);
  // 본인 turnSnapshot 손 타일 ID 집합.
  const myHandBefore = new Set(snap.hands[by]);

  let total = 0;
  for (const set of state.board) {
    if (!set.tiles || set.tiles.length === 0) continue;
    const resolved = resolveSet(state, set.tiles);
    if (!resolved) continue;
    const v = validateSet(resolved);
    if (!v.valid) continue;

    // 이 세트의 점수에 기여하는 added 타일(=내 손에서 보드로 옮긴 타일)을 찾는다.
    const addedIndices = [];
    for (let i = 0; i < set.tiles.length; i++) {
      const tid = set.tiles[i];
      if (!beforeIds.has(tid) && myHandBefore.has(tid)) {
        addedIndices.push(i);
      }
    }
    if (addedIndices.length === 0) continue;

    // [#2-2] 방어선 2중화: 이 세트에 본인이 내지 않은 기존 보드 타일이 섞여 있으면 점수 기여 0.
    // (moveTile 가드를 우회했을 때 30점 미달로 자동 롤백되도록)
    const hasNonAdded = set.tiles.some(
      (tid) => !beforeIds.has(tid) && !myHandBefore.has(tid),  // 이번 턴 생긴 보드 타일이지만 내 손에 없던 것
    ) || set.tiles.some((tid) => beforeIds.has(tid));            // 또는 이전 턴부터 보드에 있던 타일
    if (hasNonAdded) continue;

    // 인덱스 오름차순 정렬(조커 점수 배정의 등장 순서 기준).
    addedIndices.sort((a, b) => a - b);

    if (v.type === 'group') {
      // 그룹의 sampleNumber = 첫 num 타일의 number(조커는 대체값).
      const firstNum = resolved.find((t) => t.kind === 'num');
      const groupNumber = firstNum ? firstNum.number : 0;
      total += addedIndices.length * groupNumber;
    } else if (v.type === 'run') {
      // [#3] 런 점수 순서 독립 계산:
      //   빠진 슬롯 집합 = [start..end] − {숫자타일 numbers}.
      //   숫자 타일 → 자기 number, 조커 → 세트 내 조커 등장 순서대로 빠진 슬롯 값 오름차순 배정.
      const start = findRunStart(resolved);
      if (start < 0) continue; // 이론상 도달 불가.
      const runEnd = start + set.tiles.length - 1;
      const numSet = new Set(
        resolved.filter((t) => t.kind === 'num').map((t) => t.number),
      );
      const missingSlots = [];
      for (let v2 = start; v2 <= runEnd; v2++) {
        if (!numSet.has(v2)) missingSlots.push(v2);
      }
      // missingSlots는 이미 오름차순.
      let missingIdx = 0;
      for (const i of addedIndices) {
        const tile = resolved[i];
        if (tile.kind === 'num') {
          total += tile.number;
        } else {
          // 조커: 세트 내 조커 등장 순서대로 빠진 슬롯 배정.
          if (missingIdx < missingSlots.length) {
            total += missingSlots[missingIdx];
          }
          missingIdx += 1;
        }
      }
    }
  }
  return total;
}

/**
 * 특정 플레이어 시점의 STATE 스냅샷을 만든다.
 * - 본인 손: 타일 객체 풀(id+kind+color+number) 그대로 전달.
 * - 상대 손: 갯수만 전달.
 *
 * @param {object} state
 * @param {string} viewerId 'p1'|'p2'
 * @returns {object}
 */
export function snapshotFor(state, viewerId) {
  const opp = opponentOf(viewerId);
  // 보드에 등장한 모든 타일 id → 타일 객체 dict (클라가 lookup용으로 사용).
  const tileDict = {};
  for (const set of state.board) {
    for (const tid of set.tiles) {
      const t = state.tiles[tid];
      if (t) tileDict[tid] = t;
    }
  }
  // 본인 손 타일도 dict에 포함.
  for (const tid of state.hands[viewerId]) {
    const t = state.tiles[tid];
    if (t) tileDict[tid] = t;
  }
  return {
    type: 'STATE',
    currentTurn: state.currentTurn,
    turnNumber: state.turnNumber,
    phase: state.phase,
    board: state.board.map((s) => ({ id: s.id, type: s.type, tiles: s.tiles.slice() })),
    myHand: state.hands[viewerId].slice(),
    oppHandCount: state.hands[opp].length,
    deckSize: state.deck.length,
    played: { ...state.played },
    tileDict,
    result: state.result,
    // 본인 시점에서만 의미가 있는 보조 정보: 이번 턴에 회수했는데 아직 손에 남아있는 조커 ID 배열.
    // (다른 플레이어 시점에서도 같은 dict를 보내도 무방하지만 단순화: 현재 턴 플레이어 본인일 때만 의미)
    jokerReturnedThisTurn: Object.keys(state.jokerReturnedThisTurn || {}),
  };
}

/**
 * @typedef {Object} GameState
 * @property {Record<string, object>} tiles 타일 ID → 타일 객체 (immutable)
 * @property {{p1: Array<string>, p2: Array<string>}} hands 각 플레이어 손 타일 ID
 * @property {Array<string>} deck 남은 더미 타일 ID
 * @property {Array<{id: string, type: string, tiles: Array<string>}>} board 세트 배열
 * @property {number} nextSetSeq 다음 세트 ID 일련번호
 * @property {string} currentTurn 'p1'|'p2'
 * @property {number} turnNumber 1~
 * @property {{p1: boolean, p2: boolean}} played 첫 등판 완료 여부
 * @property {string} phase 'playing'|'ended'
 * @property {object|null} result { winner, reason, handCounts }
 * @property {object|null} turnSnapshot 현재 턴 시작 시 보드/손 스냅샷
 */
