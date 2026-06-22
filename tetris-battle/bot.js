/**
 * @fileoverview 테트리스 배틀 AI 봇 — 독자 테트리스 엔진 내장 + WS 클라이언트.
 *
 * 아키텍처 특수성: 테트리스 배틀은 클라이언트 권위 구조라 server.js가 보드 STATE를
 * 브로드캐스트하지 않는다(가비지/아이템/게임오버 이벤트만 중계). 따라서 봇은 다른 봇
 * (오목/요트 등)처럼 서버 STATE를 받아 한 수를 결정할 수 없고, **자체 보드·피스 시뮬레이터를
 * 내장**해 보드를 직접 시뮬레이션하고 라인 클리어 시에만 GARBAGE_SEND를 서버로 보낸다.
 *
 * 실행:
 *   node bot.js                  → ws://localhost:3005/ws?mode=bot 에 접속
 *   node bot.js --url ws://...   → 다른 서버 지정 가능
 *
 * 휴리스틱 (캐주얼 난이도, 1-look 전수 평가):
 *   - 매 피스마다 (x위치 × rotation 0~3) 전수 탐색 → 평가 함수 최고점 위치에 하드드롭.
 *   - 평가 = 라인클리어(+) + 구멍(-) + 인접 컬럼 높이차(-) + 최대 높이(-).
 *   - 넥스트 피스 미고려(1-look). 배치 간격 800~1200ms 랜덤(캐주얼 체감).
 *
 * 룰 일관성: board.js / tetromino.js의 상수·로직을 이 파일에서 재구현한다.
 * (Node child_process로 실행되는 독립 프로세스이므로 브라우저용 ES Module을 import하지 않음.)
 */

import { WebSocket } from 'ws';

// ── 인자 파싱 ─────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const urlIdx = argv.indexOf('--url');
const BOT_URL = urlIdx >= 0 && argv[urlIdx + 1]
  ? argv[urlIdx + 1]
  : 'ws://localhost:3005/ws?mode=bot';

console.log(`[tetris-bot] 서버에 접속 시도: ${BOT_URL}`);

// ── 보드 상수 (board.js 동기 유지 필요 — board.js 수정 시 아래 값도 함께 변경) ──
const BOARD_WIDTH = 10;
const VISIBLE_HEIGHT = 20;
const VANISH_ZONE = 2;
const BOARD_HEIGHT = VISIBLE_HEIGHT + VANISH_ZONE; // 22
const GARBAGE_BOMB_LINES = 2; // board.js GARBAGE_BOMB_LINES와 동일

// ── 피스 정의 (tetromino.js 동기 유지 필요) ───────────────────────
/**
 * 7종 피스의 회전 상태 4종 행렬 (tetromino.js PIECES와 100% 동일값).
 * @type {Object<string, number[][][]>}
 */
const PIECES = {
  I: [
    [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
    [[0, 0, 1, 0], [0, 0, 1, 0], [0, 0, 1, 0], [0, 0, 1, 0]],
    [[0, 0, 0, 0], [0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0]],
    [[0, 1, 0, 0], [0, 1, 0, 0], [0, 1, 0, 0], [0, 1, 0, 0]],
  ],
  O: [
    [[0, 1, 1, 0], [0, 1, 1, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
    [[0, 1, 1, 0], [0, 1, 1, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
    [[0, 1, 1, 0], [0, 1, 1, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
    [[0, 1, 1, 0], [0, 1, 1, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
  ],
  T: [
    [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
    [[0, 1, 0], [0, 1, 1], [0, 1, 0]],
    [[0, 0, 0], [1, 1, 1], [0, 1, 0]],
    [[0, 1, 0], [1, 1, 0], [0, 1, 0]],
  ],
  S: [
    [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
    [[0, 1, 0], [0, 1, 1], [0, 0, 1]],
    [[0, 0, 0], [0, 1, 1], [1, 1, 0]],
    [[1, 0, 0], [1, 1, 0], [0, 1, 0]],
  ],
  Z: [
    [[1, 1, 0], [0, 1, 1], [0, 0, 0]],
    [[0, 0, 1], [0, 1, 1], [0, 1, 0]],
    [[0, 0, 0], [1, 1, 0], [0, 1, 1]],
    [[0, 1, 0], [1, 1, 0], [1, 0, 0]],
  ],
  J: [
    [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
    [[0, 1, 1], [0, 1, 0], [0, 1, 0]],
    [[0, 0, 0], [1, 1, 1], [0, 0, 1]],
    [[0, 1, 0], [0, 1, 0], [1, 1, 0]],
  ],
  L: [
    [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
    [[0, 1, 0], [0, 1, 0], [0, 1, 1]],
    [[0, 0, 0], [1, 1, 1], [1, 0, 0]],
    [[1, 1, 0], [0, 1, 0], [0, 1, 0]],
  ],
};
const PIECE_TYPES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
/** 피스 → 색상 인덱스 (tetromino.js PIECE_COLORS와 동일). */
const PIECE_COLORS = { I: 1, O: 2, T: 3, S: 4, Z: 5, J: 6, L: 7 };

// ── 봇 배치 상수 ──────────────────────────────────────────────────
const BOT_PLACE_INTERVAL_MIN = 800;   // ms, 최소 배치 간격
const BOT_PLACE_INTERVAL_RANGE = 400; // ms, 추가 랜덤 범위 (800~1200ms)

// ── 평가 함수 가중치 상수 (tuning 시 한 줄만 수정) ────────────────
const W_CLEAR = 1.0;   // 라인 클리어 수 (많을수록 좋음)
const W_HOLES = -3.5;  // 구멍 수 (블록 아래 빈칸, 적을수록 좋음)
const W_BUMP = -0.5;   // 인접 컬럼 높이 차이 합 (평탄할수록 좋음)
const W_HEIGHT = -0.5; // 최대 스택 높이 (낮을수록 좋음)

// ── 내장 보드 시뮬레이터 ──────────────────────────────────────────
/**
 * 빈 그리드를 생성한다 (BOARD_HEIGHT × BOARD_WIDTH, 모두 0).
 * @returns {number[][]}
 */
function createEmptyGrid() {
  return Array.from({ length: BOARD_HEIGHT }, () => Array(BOARD_WIDTH).fill(0));
}

/**
 * 특정 피스/회전의 행렬을 반환한다.
 * @param {string} type
 * @param {number} rotation
 * @returns {number[][]}
 */
function getMatrix(type, rotation) {
  return PIECES[type][rotation];
}

/**
 * 피스가 주어진 위치/회전에서 보드와 충돌하는지 검사한다 (board.js isColliding 동일 로직).
 * @param {number[][]} grid
 * @param {string} type
 * @param {number} rotation
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
function isColliding(grid, type, rotation, x, y) {
  const matrix = getMatrix(type, rotation);
  for (let r = 0; r < matrix.length; r++) {
    for (let c = 0; c < matrix[r].length; c++) {
      if (matrix[r][c] === 0) continue;
      const gx = x + c;
      const gy = y + r;
      if (gx < 0 || gx >= BOARD_WIDTH || gy >= BOARD_HEIGHT) return true;
      if (gy < 0) continue; // 상단 경계는 음수 허용 (스폰 직후 일부가 보드 밖)
      if (grid[gy][gx] !== 0) return true;
    }
  }
  return false;
}

/**
 * 피스를 보드에 고정한다 (board.js lockPiece 동일 로직, in-place).
 * @param {number[][]} grid
 * @param {string} type
 * @param {number} rotation
 * @param {number} x
 * @param {number} y
 * @returns {void}
 */
function lockPiece(grid, type, rotation, x, y) {
  const matrix = getMatrix(type, rotation);
  const colorIdx = PIECE_COLORS[type];
  for (let r = 0; r < matrix.length; r++) {
    for (let c = 0; c < matrix[r].length; c++) {
      if (matrix[r][c] === 0) continue;
      const gy = y + r;
      const gx = x + c;
      if (gy >= 0 && gy < BOARD_HEIGHT && gx >= 0 && gx < BOARD_WIDTH) {
        grid[gy][gx] = colorIdx;
      }
    }
  }
}

/**
 * 꽉 찬 줄을 모두 제거한다 (board.js clearLines 동일 로직, in-place).
 * @param {number[][]} grid
 * @returns {number} 제거된 줄 수
 */
function clearLines(grid) {
  let cleared = 0;
  for (let r = BOARD_HEIGHT - 1; r >= 0; r--) {
    if (grid[r].every((v) => v !== 0)) {
      grid.splice(r, 1);
      grid.unshift(Array(BOARD_WIDTH).fill(0));
      cleared++;
      r++; // 같은 r 위치를 다시 검사 (위에서 내려온 줄)
    }
  }
  return cleared;
}

/**
 * 가비지 라인을 보드 하단에 추가한다 (board.js addGarbage 동일 로직 — 같은 hole 위치).
 * @param {number[][]} grid
 * @param {number} lines
 * @returns {void}
 */
function addGarbage(grid, lines) {
  if (lines <= 0) return;
  const holeCol = Math.floor(Math.random() * BOARD_WIDTH);
  for (let i = 0; i < lines; i++) {
    grid.shift();
    const garbageRow = Array(BOARD_WIDTH).fill(8); // 8 = 가비지 색상 인덱스
    garbageRow[holeCol] = 0;
    grid.push(garbageRow);
  }
}

/**
 * 7-bag 생성기 (tetromino.js createBag 로직 — Fisher-Yates 셔플).
 * @returns {{ next: () => string }}
 */
function createBag() {
  let queue = [];
  function refill() {
    const bag = [...PIECE_TYPES];
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    queue.push(...bag);
  }
  refill();
  refill();
  return {
    next() {
      if (queue.length < 7) refill();
      return queue.shift();
    },
  };
}

/**
 * 가비지 변환표: 라인 클리어 줄 수 → 전송할 가비지 줄 수 (board.js garbageFromLines 동일).
 * @param {number} linesCleared
 * @returns {number}
 */
function garbageFromLines(linesCleared) {
  switch (linesCleared) {
    case 1: return 0;   // Single
    case 2: return 1;   // Double
    case 3: return 2;   // Triple
    case 4: return 4;   // Tetris
    default: return 0;
  }
}

/**
 * 콤보 보너스 계산: 콤보 1당 가비지 +0.5줄 (board.js comboBonus 동일).
 * @param {number} combo - 0 이상 (첫 클리어가 콤보 0)
 * @returns {number}
 */
function comboBonus(combo) {
  if (combo <= 0) return 0;
  return Math.round(combo * 0.5);
}

/**
 * 보드 스택 높이를 반환한다 (board.js getStackHeight 동일 — VANISH_ZONE 이후만 측정).
 * @param {number[][]} grid
 * @returns {number} 0~VISIBLE_HEIGHT
 */
function getStackHeight(grid) {
  for (let r = VANISH_ZONE; r < BOARD_HEIGHT; r++) {
    if (grid[r].some((v) => v !== 0)) return BOARD_HEIGHT - r;
  }
  return 0;
}

/**
 * 컬럼별 visible 높이 배열을 반환한다 (board.js getColumnHeights와 동일 — VANISH_ZONE부터 스캔).
 * 상대 화면 미니맵(ui.js renderOpponent)이 이 배열로 봇 보드를 그린다. 사람 클라와 동일 포맷이라야
 * 미니맵이 정상 렌더된다 (이전엔 봇이 stack:[]를 보내 상대 미니맵이 비어 보였다).
 * @param {number[][]} grid
 * @returns {number[]} 길이 BOARD_WIDTH, 각 값 0~VISIBLE_HEIGHT
 */
function getColumnHeights(grid) {
  const heights = new Array(BOARD_WIDTH).fill(0);
  for (let c = 0; c < BOARD_WIDTH; c++) {
    for (let r = VANISH_ZONE; r < BOARD_HEIGHT; r++) {
      if (grid[r][c] !== 0) {
        heights[c] = BOARD_HEIGHT - r;
        break;
      }
    }
  }
  return heights;
}

// ── 봇 휴리스틱 ───────────────────────────────────────────────────
/**
 * 보드 상태를 평가한다. 높이/구멍 계산은 BOARD_HEIGHT 전체를 스캔하되 결과는
 * "스택 높이"(BOARD_HEIGHT - r)로 환산해 hidden zone 왜곡을 피한다.
 * @param {number[][]} grid
 * @param {number} clearedLines
 * @returns {number}
 */
function evaluateBoard(grid, clearedLines) {
  // 구멍: 각 컬럼에서 첫 블록 아래의 빈칸 수.
  let holes = 0;
  for (let c = 0; c < BOARD_WIDTH; c++) {
    let blockFound = false;
    for (let r = 0; r < BOARD_HEIGHT; r++) {
      if (grid[r][c] !== 0) blockFound = true;
      else if (blockFound) holes++;
    }
  }

  // 컬럼별 높이.
  const colHeights = new Array(BOARD_WIDTH).fill(0);
  for (let c = 0; c < BOARD_WIDTH; c++) {
    for (let r = 0; r < BOARD_HEIGHT; r++) {
      if (grid[r][c] !== 0) {
        colHeights[c] = BOARD_HEIGHT - r;
        break;
      }
    }
  }

  let maxHeight = 0;
  for (let c = 0; c < BOARD_WIDTH; c++) {
    if (colHeights[c] > maxHeight) maxHeight = colHeights[c];
  }

  let bumpiness = 0;
  for (let i = 0; i < BOARD_WIDTH - 1; i++) {
    bumpiness += Math.abs(colHeights[i + 1] - colHeights[i]);
  }

  return clearedLines * W_CLEAR
    + holes * W_HOLES
    + bumpiness * W_BUMP
    + maxHeight * W_HEIGHT;
}

/**
 * 모든 (x위치 × rotation) 조합을 전수 평가하여 최적 배치를 고른다.
 * @param {number[][]} grid
 * @param {string} pieceType
 * @returns {{x:number, rotation:number, y:number, cleared:number}|null}
 */
function chooseBestPlacement(grid, pieceType) {
  let bestScore = -Infinity;
  let best = null;

  for (let rotation = 0; rotation < 4; rotation++) {
    const matrix = getMatrix(pieceType, rotation);
    const matWidth = matrix[0].length;
    // 피스가 부분적으로 보드 밖에 걸쳐도 isColliding이 걸러주므로 넓게 탐색.
    for (let x = -(matWidth - 1); x < BOARD_WIDTH; x++) {
      // 스폰 위치(y=0)에서 유효하지 않으면(겹침) 이 조합 스킵.
      if (isColliding(grid, pieceType, rotation, x, 0)) continue;

      // 하드드롭: 충돌 직전까지 y를 내린다.
      let y = 0;
      while (!isColliding(grid, pieceType, rotation, x, y + 1)) y++;

      // 시뮬 보드에 락 + 클리어 후 평가.
      const simGrid = grid.map((row) => row.slice());
      lockPiece(simGrid, pieceType, rotation, x, y);
      const cleared = clearLines(simGrid);
      const score = evaluateBoard(simGrid, cleared);

      if (score > bestScore) {
        bestScore = score;
        best = { x, rotation, y, cleared };
      }
    }
  }
  return best;
}

// ── 봇 상태 변수 ──────────────────────────────────────────────────
/** @type {'p1'|'p2'|null} */
let myPlayerId = null;
let isRunning = false;       // 게임 진행 중
let pendingGarbage = 0;      // 받은 가비지 대기 줄 수
let rematchTimer = null;     // GAME_RESULT 후 REMATCH 예약 타이머
let placeTimer = null;       // 다음 피스 배치 타이머

let botGrid = createEmptyGrid();
let botBag = createBag();
let botCombo = -1;           // ⚠️ 초기값 -1 (서버 콤보 로직과 일치). 첫 클리어 시 ++ → 0.

// ── 봇 메인 루프 ──────────────────────────────────────────────────
/**
 * 다음 피스 배치를 800~1200ms 후로 예약한다.
 * @returns {void}
 */
function scheduleNextPiece() {
  if (!isRunning) return;
  const type = botBag.next();
  const delay = BOT_PLACE_INTERVAL_MIN + Math.floor(Math.random() * BOT_PLACE_INTERVAL_RANGE);
  placeTimer = setTimeout(() => {
    placeTimer = null;
    doPlace(type);
  }, delay);
}

/**
 * 한 피스를 배치한다: 가비지 적용 → 최적 위치 탐색 → 토프아웃 검사 → 락 → 클리어 → 가비지 전송.
 * @param {string} type
 * @returns {void}
 */
function doPlace(type) {
  if (!isRunning) return;

  // 받아둔 가비지를 피스 락 직전에 적용.
  if (pendingGarbage > 0) {
    addGarbage(botGrid, pendingGarbage);
    pendingGarbage = 0;
  }

  // 스폰 충돌 = 토프아웃 (가비지로 보드가 천장까지 찬 경우).
  if (isColliding(botGrid, type, 0, Math.floor((BOARD_WIDTH - getMatrix(type, 0)[0].length) / 2), 0)) {
    console.log('[tetris-bot] 토프아웃 → GAME_OVER 전송');
    send({ type: 'GAME_OVER' });
    isRunning = false;
    return;
  }

  // 최적 배치 탐색.
  const placement = chooseBestPlacement(botGrid, type);
  if (!placement) {
    // 둘 곳이 전혀 없음 = 토프아웃.
    console.log('[tetris-bot] 배치 불가 → GAME_OVER 전송');
    send({ type: 'GAME_OVER' });
    isRunning = false;
    return;
  }

  // 락 적용 + 라인 클리어.
  lockPiece(botGrid, type, placement.rotation, placement.x, placement.y);
  const cleared = clearLines(botGrid);

  // 콤보 계산 (서버 로직과 동일: 첫 클리어 콤보 0).
  if (cleared > 0) {
    botCombo++;
    const garbage = garbageFromLines(cleared) + comboBonus(botCombo);
    if (garbage > 0) {
      console.log(`[tetris-bot] ${cleared}줄 클리어 → GARBAGE_SEND ${garbage}줄 (combo ${botCombo})`);
      send({ type: 'GARBAGE_SEND', lines: garbage, combo: botCombo });
    }
  } else {
    botCombo = -1;
  }

  // 미니맵 업데이트: 사람 클라(board.js getColumnHeights)와 동일하게 컬럼별 visible 높이 배열을
  // 전송해 상대 화면 미니맵에 봇 보드가 그려지도록 한다. (이전 stack:[]는 미니맵이 비어 보이던 버그)
  const stack = getColumnHeights(botGrid);
  const height = stack.length ? Math.max(...stack) : 0;
  send({ type: 'BOARD_STATE', height, stack });

  // 다음 피스 예약.
  if (isRunning) scheduleNextPiece();
}

/**
 * 봇 보드/봉투/콤보를 초기 상태로 되돌린다 (게임 시작/재대결 시).
 * @returns {void}
 */
function resetBot() {
  botGrid = createEmptyGrid();
  botBag = createBag();
  botCombo = -1;
  pendingGarbage = 0;
  if (placeTimer) { clearTimeout(placeTimer); placeTimer = null; }
}

/**
 * GAME_RESULT 수신 시 0.5초 후 REMATCH 자동 동의를 예약한다.
 * (REMATCH_STATUS로 상태를 알 수 있어 재송신 타임아웃은 생략 — 스펙 D/E.)
 * @returns {void}
 */
function scheduleRematch() {
  if (rematchTimer) clearTimeout(rematchTimer);
  rematchTimer = setTimeout(() => {
    rematchTimer = null;
    console.log('[tetris-bot] 자동 REMATCH 동의 전송');
    send({ type: 'REMATCH' });
  }, 500);
}

// ── WebSocket 클라이언트 ──────────────────────────────────────────
const ws = new WebSocket(BOT_URL);

ws.on('open', () => {
  console.log('[tetris-bot] 연결됨 → JOIN 전송');
  send({ type: 'JOIN', playerName: 'AI Bot' });
});

ws.on('message', (data) => {
  let msg;
  try { msg = JSON.parse(data.toString()); } catch { return; }
  switch (msg.type) {
    case 'JOINED':
      myPlayerId = msg.playerId;
      console.log(`[tetris-bot] JOINED ${myPlayerId} (waiting=${msg.waiting}) → READY 전송`);
      send({ type: 'READY' });
      break;

    case 'START':
      console.log(`[tetris-bot] START (countdown=${msg.countdown}) → 게임 루프 시작`);
      resetBot();
      isRunning = true;
      scheduleNextPiece();
      break;

    case 'GARBAGE_RECV':
      pendingGarbage += Math.max(0, msg.lines || 0);
      console.log(`[tetris-bot] GARBAGE_RECV ${msg.lines}줄 (대기 합계 ${pendingGarbage})`);
      break;

    case 'ITEM_EFFECT':
      // 가비지 폭탄만 봇 보드에 반영, 나머지(dark/freeze)는 무시 (의도적 비대칭).
      if (msg.itemId === 'garbage_bomb') {
        pendingGarbage += GARBAGE_BOMB_LINES;
        console.log(`[tetris-bot] ITEM_EFFECT garbage_bomb → 가비지 +${GARBAGE_BOMB_LINES}줄`);
      } else {
        console.log(`[tetris-bot] ITEM_EFFECT ${msg.itemId} 무시`);
      }
      break;

    case 'GAME_RESULT':
      console.log(`[tetris-bot] GAME_RESULT winner=${msg.winner}, reason=${msg.reason}`);
      isRunning = false;
      if (placeTimer) { clearTimeout(placeTimer); placeTimer = null; }
      scheduleRematch();
      break;

    case 'REMATCH_STATUS':
      // 봇은 GAME_RESULT에서만 REMATCH를 보낸다 → 무시.
      break;

    case 'ITEM_GRANT':
      // 봇은 아이템 슬롯이 없어 ITEM_USE를 보내지 않음 → 무시.
      break;

    case 'SHIELD_BLOCK':
    case 'OPPONENT_BOARD':
      // 무시 (봇은 미니맵 업데이트 없음).
      break;

    case 'ERROR':
      console.warn('[tetris-bot] 서버 에러:', msg.message);
      break;

    default:
      break;
  }
});

ws.on('close', (code) => {
  console.log(`[tetris-bot] 연결 종료 (code=${code})`);
  if (placeTimer) clearTimeout(placeTimer);
  if (rematchTimer) clearTimeout(rematchTimer);
  process.exit(0);
});

ws.on('error', (err) => {
  console.error('[tetris-bot] WS 에러:', err.message);
});

/**
 * 서버에 JSON 메시지를 송신한다. 연결이 열려있지 않으면 무시.
 * @param {object} msg
 * @returns {void}
 */
function send(msg) {
  if (ws.readyState !== 1) {
    console.log(`[tetris-bot:SEND] DROP (ws not open) msg=${JSON.stringify(msg)}`);
    return;
  }
  ws.send(JSON.stringify(msg));
}
