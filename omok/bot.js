/**
 * @fileoverview 오목(Gomoku) 단순 AI 봇 — mode=ai 사용자가 들어왔을 때
 * server.js가 child_process로 spawn 한다.
 *
 * 실행:
 *   node bot.js                  → ws://localhost:3012/ws?mode=bot 에 접속
 *   node bot.js --url ws://...   → 다른 서버 지정 가능
 *
 * 휴리스틱 (캐주얼 난이도, 1수 전수 평가):
 *   - 자기 턴마다 빈 교차점 361칸을 전수 평가하여 최고 점수 칸에 착수.
 *   - 점수 = 공격(자기 연속 완성 기여) + 0.9 × 수비(상대 위협 차단 기여).
 *     공격을 약간 우선하되, 상대 4목 위협(1000)은 즉시 차단한다.
 *   - 5목 완성(CHAIN_WEIGHT[5]=100000)이 가능하면 무조건 선택.
 *   - 미니맥스/알파베타/MCTS 미사용(스펙 명시).
 *
 * 룰 일관성: 서버 game.js와 동일한 4방향 연속 판정을 이 파일에서 재구현한다.
 * (외부 의존성을 최소화하기 위해 game.js를 import하지 않음.)
 */

import { WebSocket } from 'ws';

// ── 인자 파싱 ─────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const urlIdx = argv.indexOf('--url');
const URL = urlIdx >= 0 && argv[urlIdx + 1] ? argv[urlIdx + 1] : 'ws://localhost:3012/ws?mode=bot';

console.log(`[omok-bot] 서버에 접속 시도: ${URL}`);

// ── 상수 (서버 game.js와 일치) ───────────────────────────────────
const BOARD_SIZE = 19;
const TOTAL_CELLS = BOARD_SIZE * BOARD_SIZE;
/** 승리 탐색 4방향(가로/세로/대각↘/대각↗). */
const DIRS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];
/**
 * 연속 수 → 가중치 테이블. 1수 평가에서 한 방향 연속 길이를 점수화한다.
 *  1: 고립된 1개(기본 존재) / 2: 연속 2 / 3: 연속 3(위협) /
 *  4: 연속 4(즉각 위협) / 5: 5목 완성(최우선)
 */
const CHAIN_WEIGHT = { 1: 1, 2: 10, 3: 100, 4: 1000, 5: 100000 };

// ── 상태 변수 ─────────────────────────────────────────────────────
/** @type {'p1'|'p2'|null} */
let myId = null;
/** @type {'black'|'white'|null} */
let myColor = null;
/** 중복 행동 방지 키 (`${currentTurn}|${moveCount}`). */
let lastActedFor = null;
/** 가장 최근 STATE — fire 시점에 stale 결정 회피를 위해 캐시. */
let lastState = null;
/** 예약된 act 타이머 (새 STATE 도착 시 취소). */
let pendingActTimer = null;
/** 리매치 타임아웃 핸들 (재송신용). */
let rematchTimer = null;

const ws = new WebSocket(URL);

ws.on('open', () => {
  console.log('[omok-bot] 연결됨');
});

ws.on('close', (code, reason) => {
  console.log(`[omok-bot] 연결 종료 (code=${code}, reason=${reason || '?'})`);
  process.exit(0);
});

ws.on('error', (err) => {
  console.error('[omok-bot] 에러:', err.message);
});

ws.on('message', (data) => {
  let msg;
  try { msg = JSON.parse(data.toString()); } catch { return; }
  switch (msg.type) {
    case 'JOINED':
      myId = msg.playerId;
      // 리매치 후 재전송 JOINED에서도 갱신됨(색 swap 반영).
      myColor = msg.color;
      console.log(`[omok-bot] ${myId}(${myColor}) 자리 점유(갱신)`);
      break;
    case 'GAME_START':
      console.log('[omok-bot] 게임 시작');
      lastActedFor = null;
      break;
    case 'STATE':
      handleState(msg);
      break;
    case 'GAME_OVER':
      console.log(`[omok-bot] 게임 종료: winner=${msg.winner}, reason=${msg.reason}`);
      // process.exit 하지 않고 자동 리매치 동의를 예약한다(봇은 계속 대기).
      scheduleRematch();
      break;
    case 'REMATCH_WAITING':
      // 상대가 이미 동의했음 → 봇도 즉시 동의(서버 Set이 중복 무시).
      scheduleRematch();
      break;
    case 'REMATCH_START':
      if (rematchTimer) { clearTimeout(rematchTimer); rematchTimer = null; }
      console.log(`[omok-bot] 리매치 시작 — nextBlack=${msg.nextBlack}`);
      // myColor는 뒤따라 오는 JOINED에서 갱신된다. 여기서는 중복행동 키만 초기화.
      lastActedFor = null;
      break;
    case 'OPPONENT_LEFT':
      console.log('[omok-bot] 상대 이탈 → 연결 종료');
      if (rematchTimer) { clearTimeout(rematchTimer); rematchTimer = null; }
      ws.close();
      break;
    case 'ERROR':
      if (msg.message && msg.message.includes('가득')) {
        console.error('[omok-bot] 방이 가득 찼다. 봇은 빠진다.');
        ws.close();
      } else {
        console.warn('[omok-bot] 서버 에러:', msg.message);
        // 직전 착수가 거절됐으므로 다음 STATE에 재행동할 수 있게 키 리셋.
        lastActedFor = null;
        if (pendingActTimer) {
          clearTimeout(pendingActTimer);
          pendingActTimer = null;
        }
      }
      break;
    default:
      break;
  }
});

/**
 * GAME_OVER 또는 REMATCH_WAITING 수신 시 자동 리매치 동의를 예약한다.
 * 0.5초 지연 후 REMATCH 송신(서버 state 준비 전 과송신 방지),
 * REMATCH_START 미수신 시 10초 후 1회 재송신(타임아웃 보호).
 */
function scheduleRematch() {
  if (rematchTimer) clearTimeout(rematchTimer);
  setTimeout(() => {
    send({ type: 'REMATCH' });
    // 10초 내 REMATCH_START 없으면 1회 재시도.
    rematchTimer = setTimeout(() => {
      console.log('[omok-bot] REMATCH_START 미수신 → REMATCH 재송신');
      send({ type: 'REMATCH' });
      rematchTimer = null;
    }, 10000);
  }, 500);
}

/**
 * STATE 메시지를 받아 자기 차례면 행동을 예약한다.
 * 같은 (currentTurn|moveCount) 조합에서 중복 행동을 방지한다.
 * @param {object} s 서버가 보낸 STATE 페이로드
 */
function handleState(s) {
  lastState = s;
  if (!myColor) return;
  if (s.phase !== 'playing') return;
  if (s.currentTurn !== myColor) {
    // 자기 차례 아니어도 보류 타이머는 취소 (stale STATE 기반 fire 방지).
    if (pendingActTimer) {
      clearTimeout(pendingActTimer);
      pendingActTimer = null;
    }
    return;
  }

  const key = `${s.currentTurn}|${s.moveCount}`;
  if (key === lastActedFor) return;
  lastActedFor = key;

  if (pendingActTimer) {
    clearTimeout(pendingActTimer);
    pendingActTimer = null;
  }

  // 사람스러운 지연 (0.5~0.9초).
  const delay = 500 + Math.floor(Math.random() * 400);
  pendingActTimer = setTimeout(() => {
    pendingActTimer = null;
    const cur = lastState;
    if (!cur || cur.phase !== 'playing' || cur.currentTurn !== myColor) return;
    act(cur);
  }, delay);
}

/**
 * 현재 STATE에 따라 최적 착수를 결정하고 PLACE를 송신한다.
 * @param {object} s
 */
function act(s) {
  const move = chooseMove(s);
  if (!move) {
    // 빈 칸이 없으면(이론상 무승부 직전) 행동하지 않음.
    console.log('[omok-bot] 둘 곳 없음 — 패스');
    return;
  }
  console.log(`[omok-bot] PLACE (${move.row},${move.col})`);
  send({ type: 'PLACE', row: move.row, col: move.col });
}

/**
 * 빈 교차점을 전수 평가하여 최고 점수 칸을 고른다.
 * @param {object} s STATE 페이로드
 * @returns {{row:number, col:number}|null}
 */
function chooseMove(s) {
  const board = s.board;
  const opColor = myColor === 'black' ? 'white' : 'black';
  let bestScore = -Infinity;
  let bestMove = null;

  // 첫 수(빈 보드)는 중앙(천원)에 둔다 — 전수 평가 시 전부 동점이라 자연스러운 시작점 확보.
  if (s.moveCount === 0) {
    const center = Math.floor(BOARD_SIZE / 2);
    return { row: center, col: center };
  }

  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      if (board[row * BOARD_SIZE + col] !== null) continue;
      const score = evaluate(board, row, col, myColor, opColor);
      if (score > bestScore) {
        bestScore = score;
        bestMove = { row, col };
      }
    }
  }
  return bestMove;
}

/**
 * 특정 빈 칸의 가치를 평가한다.
 * 공격(내가 두면 만드는 연속) + 0.9 × 수비(상대가 두면 만드는 연속).
 * @param {Array} board 길이 361
 * @param {number} row
 * @param {number} col
 * @param {'black'|'white'} myColorArg
 * @param {'black'|'white'} opColor
 * @returns {number}
 */
function evaluate(board, row, col, myColorArg, opColor) {
  let score = 0;
  // 내 돌 착수 시 공격 점수.
  score += attackScore(board, row, col, myColorArg);
  // 상대가 여기 놓을 경우 얻을 연속 기여 → 차단 가치(수비).
  score += 0.9 * attackScore(board, row, col, opColor);
  return score;
}

/**
 * (row, col)에 color 돌을 가상 착수했을 때 4방향 연속 가중치 합.
 * @param {Array} board
 * @param {number} row
 * @param {number} col
 * @param {'black'|'white'} color
 * @returns {number}
 */
function attackScore(board, row, col, color) {
  let score = 0;
  for (const [dr, dc] of DIRS) {
    // 착수점 자신(1) + 정방향 연속 + 역방향 연속.
    const count = 1
      + countDir(board, row, col, color, dr, dc)
      + countDir(board, row, col, color, -dr, -dc);
    score += CHAIN_WEIGHT[Math.min(count, 5)];
  }
  return score;
}

/**
 * (row, col)에서 (dr, dc) 한 방향으로 같은 color가 연속된 칸 수를 센다.
 * 착수점 자신은 포함하지 않는다.
 * @param {Array} board
 * @param {number} row
 * @param {number} col
 * @param {'black'|'white'} color
 * @param {number} dr
 * @param {number} dc
 * @returns {number}
 */
function countDir(board, row, col, color, dr, dc) {
  let n = 0;
  let r = row + dr;
  let c = col + dc;
  while (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE
    && board[r * BOARD_SIZE + c] === color) {
    n += 1;
    r += dr;
    c += dc;
  }
  return n;
}

/**
 * 서버에 JSON 메시지를 송신한다. 연결이 열려있지 않으면 무시.
 * @param {object} msg
 */
function send(msg) {
  if (ws.readyState !== 1) {
    console.log(`[omok-bot:SEND] DROP (ws not open, readyState=${ws.readyState}) msg=${JSON.stringify(msg)}`);
    return;
  }
  ws.send(JSON.stringify(msg));
}
