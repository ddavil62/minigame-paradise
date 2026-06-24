/**
 * @fileoverview 윷놀이(Yutnori) AI 봇 — mode=ai 사용자가 들어왔을 때
 * server.js가 child_process로 spawn 한다.
 *
 * 실행:
 *   node bot.js                        → ws://localhost:3004/ws?mode=bot 접속
 *   node bot.js --url ws://...         → 다른 서버 지정 가능
 *
 * 목적: 강한 AI가 아니라 게임 전 흐름(던지기 → 말 이동 → 분기 선택 → 잡기 보너스 →
 *       완주 → 재대결)을 데드락 없이 끝까지 완주하는 테스트용 봇.
 *
 * 휴리스틱:
 *   - THROW_YUT: 던질 수 있을 때(큐 비었거나 capturedBonus) 항상 던진다.
 *   - MOVE_PIECE: 그리디 — 완주(GOAL=99)에 가장 가까운 말(cell이 큰 말)을 우선.
 *                 동률이면 인덱스 낮은 말. 백도는 HOME(-1) 아닌 말만 대상.
 *   - CHOOSE_PATH (corner): 30% 확률 shortcut, 70% outer (테스트 커버리지 확보).
 *   - CHOOSE_PATH (center): 50% 확률 top, 50% bottom.
 *   - 잡기 보너스(capturedBonus=true, 큐 비어있음): STATE에서 읽어 즉시 던진다(자체 추적 안 함).
 *   - 중첩 분기(corner→center): 서버가 BRANCH_REQUEST(center)를 재발송하므로 두 번 응답한다.
 *   - 재대결(GAME_OVER): 0.5초 후 REMATCH 자동 송신.
 *
 * 설계 참조: rummikub/bot.js의 __isMain 가드 + 테스트 export + actionEpoch 체인 취소 패턴.
 */

import { WebSocket } from 'ws';

// ── 인자 파싱 ─────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const urlIdx = argv.indexOf('--url');
const BOT_URL = urlIdx >= 0 && argv[urlIdx + 1] ? argv[urlIdx + 1] : 'ws://localhost:3004/ws?mode=bot';

// 테스트용 import (실행 진입점이 아닌 경우 WS 연결 생략).
//   - import.meta.url과 process.argv[1]을 비교해 직접 실행 여부 판정.
const __isMain = (() => {
  try {
    const argv1 = process.argv[1] ? process.argv[1].replace(/\\/g, '/') : '';
    const argvUrl = argv1 ? new URL(`file:///${argv1.replace(/^\/+/, '')}`).href : '';
    return import.meta.url === argvUrl;
  } catch { return true; }
})();

if (__isMain) {
  console.log(`[yutnori-bot] 서버에 접속 시도: ${BOT_URL}`);
}

// ── 상수 (서버 server.js와 일치) ─────────────────────────────────
/** 완주 상태를 나타내는 가상 칸 인덱스. */
const GOAL = 99;
/** 아직 출발 안 한 말의 칸 인덱스. */
const HOME = -1;
/** 결과명 → 이동 칸 수. */
const YUT_STEPS = { backdo: -1, do: 1, gae: 2, geol: 3, yut: 4, mo: 5 };

// 행동 지연 범위 [최소, 추가 랜덤]. 기본 300~800ms.
// 테스트(bot-smoke)는 YUTNORI_BOT_DELAY_MIN/RAND 환경변수로 짧게 덮어쓴다(완주 속도 확보).
const DELAY_MIN = Number.isFinite(parseInt(process.env.YUTNORI_BOT_DELAY_MIN, 10))
  ? parseInt(process.env.YUTNORI_BOT_DELAY_MIN, 10) : 300;
const DELAY_RAND = Number.isFinite(parseInt(process.env.YUTNORI_BOT_DELAY_RAND, 10))
  ? parseInt(process.env.YUTNORI_BOT_DELAY_RAND, 10) : 500;

// ── 상태 변수 ─────────────────────────────────────────────────────
/** @type {'p1'|'p2'|null} */
let myId = null;
/** 중복 행동 방지 키: `${currentTurn}|${pendingResults.join(',')}|${awaitingBranchAt}`. */
let lastActedFor = null;
/** 가장 최근 STATE. */
let lastState = null;
/** 행동 예약 타이머. */
let pendingActTimer = null;
/** [rummikub #9 패턴] 액션 체인 에포크. 오래된 setTimeout 콜백을 무효화하는 기준. */
let actionEpoch = 0;

// 테스트 import 시 WS 연결을 만들지 않는다 (휴리스틱 함수만 import).
const ws = __isMain
  ? new WebSocket(BOT_URL)
  : { readyState: 3, send: () => {}, close: () => {}, on: () => {} };

ws.on('open', () => {
  console.log('[yutnori-bot] 연결됨, JOIN 송신');
  send({ type: 'JOIN', playerName: 'AI 봇' });
});

ws.on('close', (code, reason) => {
  console.log(`[yutnori-bot] 연결 종료 (code=${code}, reason=${reason || '?'})`);
  process.exit(0);
});

ws.on('error', (err) => {
  console.error('[yutnori-bot] 에러:', err.message);
});

ws.on('message', (data) => {
  let msg;
  try { msg = JSON.parse(data.toString()); } catch { return; }
  switch (msg.type) {
    case 'JOINED':
      myId = msg.playerId;
      console.log(`[yutnori-bot] ${myId} 자리 점유 → scheduleReady`);
      scheduleReady();
      break;
    case 'START':
      console.log('[yutnori-bot] 게임 시작');
      lastActedFor = null;
      break;
    case 'STATE':
      handleState(msg);
      break;
    case 'YUT_RESULT':
    case 'BRANCH_REQUEST':
    case 'REMATCH_STATUS':
      // 정보성 — 무시 (분기/던지기 결정은 STATE 기반으로만 한다).
      break;
    case 'GAME_OVER':
      console.log(`[yutnori-bot] 게임 종료: winner=${msg.winner}, reason=${msg.reason || '?'}`);
      setTimeout(() => { send({ type: 'REMATCH' }); }, 500);
      break;
    case 'OPPONENT_LEFT':
      console.log('[yutnori-bot] 상대 이탈 → 연결 종료');
      ws.close();
      break;
    case 'ERROR':
      if (msg.message && (msg.message.includes('가득') || msg.message.includes('full'))) {
        console.error('[yutnori-bot] 방이 가득 찼다. 봇은 빠진다.');
        ws.close();
      } else {
        console.warn('[yutnori-bot] 서버 에러:', msg.message);
        // 직전 액션 거절 → 다음 STATE에 재시도.
        lastActedFor = null;
        actionEpoch += 1; // [#9] 에러 → 진행 중 체인 취소.
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
 * STATE 메시지를 받아 본인 차례면 행동 예약.
 * @param {object} s 서버 STATE 페이로드
 */
function handleState(s) {
  lastState = s;
  if (!myId) return;
  if (s.winner) return;               // 게임 종료 후 상태 무시
  if (!s.started) return;             // 시작 전(대기/카운트다운) 무시
  if (s.currentTurn !== myId) {
    // 내 턴 아님 → 진행 중 체인 취소 + lastActedFor 리셋.
    // [중요] STATE에 turnNumber가 없으므로, 리셋하지 않으면 다음 내 턴의 빈 큐 시작 상태
    // (`myId||null|0`)가 직전 턴과 동일 키가 되어 행동을 영원히 건너뛴다(턴 잠금).
    // 상대 턴으로 넘어갈 때마다 리셋하여 새 턴에 반드시 다시 행동하도록 한다.
    if (pendingActTimer) {
      clearTimeout(pendingActTimer);
      pendingActTimer = null;
    }
    lastActedFor = null;
    actionEpoch += 1; // [#9]
    return;
  }

  // 중복 행동 방지 키 — pendingResults 내용 + awaitingBranchAt로 같은 턴 안 상태 변화 감지.
  // capturedBonus도 키에 포함하여 "잡기 보너스로 큐가 비고 다시 던질 수 있는" 상태 변화를 감지.
  // [중요] awaitingBranchType도 반드시 포함 — 중첩 분기(corner 지름길 → center 재무장) 시
  // pieceIdx(awaitingBranchAt)·큐·capturedBonus가 전부 그대로라 키가 동일해져
  // 2차 center 분기 요청을 무시하고 영구 잠금된다 (간헐 데드락 원인).
  const key = `${s.currentTurn}|${(s.pendingResults || []).join(',')}|${s.awaitingBranchAt}|${s.awaitingBranchType || ''}|${s.capturedBonus ? 1 : 0}`;
  if (key === lastActedFor) return;
  lastActedFor = key;

  if (pendingActTimer) {
    clearTimeout(pendingActTimer);
    pendingActTimer = null;
  }

  const delay = DELAY_MIN + Math.floor(Math.random() * DELAY_RAND); // 기본 300~800ms
  pendingActTimer = setTimeout(() => {
    pendingActTimer = null;
    const cur = lastState;
    if (!cur || cur.currentTurn !== myId || cur.winner || !cur.started) return;
    actTurn(cur);
  }, delay);
}

/**
 * 본인 턴 행동 — 분기 대기 → 말 이동 → 던지기 순으로 상태 머신을 처리한다.
 * @param {object} s 서버 STATE 페이로드
 */
function actTurn(s) {
  actionEpoch += 1; // [#9] 새 체인 시작.

  // 1) 분기 대기 중이면 CHOOSE_PATH 최우선 (턴 잠금 방지).
  if (s.awaitingBranchAt !== null && s.awaitingBranchAt !== undefined) {
    const branchType = s.awaitingBranchType; // 'center' | 'corner'
    let pathChoice;
    if (branchType === 'corner') {
      // 모서리: 30% 지름길, 70% 외곽 (테스트 커버리지 확보).
      pathChoice = Math.random() < 0.3 ? 'shortcut' : 'outer';
    } else {
      // 중앙(또는 미지정): 50/50 top/bottom.
      pathChoice = Math.random() < 0.5 ? 'top' : 'bottom';
    }
    send({ type: 'CHOOSE_PATH', pathChoice });
    return;
  }

  // 2) pendingResults에 사용 가능한 결과가 있으면 MOVE_PIECE.
  const pending = s.pendingResults || [];
  if (pending.length > 0) {
    const useResult = pending[0]; // 큐 첫 결과 사용.
    const myPlayer = (s.players || []).find((p) => p.id === myId);
    if (!myPlayer) return;
    const pieceIdx = choosePiece(myPlayer.pieces, useResult);
    if (pieceIdx >= 0) {
      send({ type: 'MOVE_PIECE', pieceIndex: pieceIdx, useResult });
    } else {
      // 사용 가능한 말이 없는 경우(예: 백도인데 출발한 말이 없음).
      // 서버가 자동 폐기/턴 종료를 처리하므로 봇은 추가 행동하지 않는다.
      // (정상적으로는 서버가 미리 큐에서 제외하므로 도달하기 어려운 경로.)
    }
    return;
  }

  // 3) 큐가 비었으면 던지기. 서버 검증 조건:
  //    pendingResults.length===0 && (capturedBonus===true || 큐 마지막이 yut/mo)
  //    큐가 비어 이 시점에 도달했으면 던지기 가능 상태(첫 던지기 또는 capturedBonus).
  send({ type: 'THROW_YUT' });
}

/**
 * 사용 결과에 대해 이동시킬 말 인덱스를 그리디로 선택한다.
 * 완주(GOAL)에 가장 가까운 말(cell이 큰 말)을 우선, 동률이면 인덱스 낮은 말.
 *
 * @param {Array<{cell:number, stack:number, done:boolean}>} pieces 내 말 4개
 * @param {string} resultName 'backdo'|'do'|'gae'|'geol'|'yut'|'mo'
 * @returns {number} 이동할 말 인덱스 (없으면 -1)
 */
function choosePiece(pieces, resultName) {
  if (!Array.isArray(pieces)) return -1;
  if (YUT_STEPS[resultName] === undefined) return -1;

  // 후보 필터: 완주 안 한 말. 백도는 HOME(출발 전) 말 제외(뒤로 못 감).
  const candidates = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    if (!p || p.done) continue;
    if (p.stack === 0) continue; // 흡수된 말 (현재 모델에선 발생 안 함, 방어)
    if (resultName === 'backdo' && p.cell === HOME) continue;
    candidates.push(i);
  }
  if (candidates.length === 0) return -1;

  // cell이 클수록 GOAL에 가까움. HOME(-1)은 출발 전이라 우선순위 최하(-2 취급).
  // 동률이면 인덱스 낮은 말(정렬 안정성으로 보장).
  candidates.sort((a, b) => {
    const ca = pieces[a].cell === HOME ? -2 : pieces[a].cell;
    const cb = pieces[b].cell === HOME ? -2 : pieces[b].cell;
    if (cb !== ca) return cb - ca; // cell 내림차순
    return a - b;                  // 동률 → 인덱스 오름차순
  });
  return candidates[0];
}

/** READY 타이머 (중복 방지). */
let readyTimer = null;

/**
 * JOINED 수신 후 200~500ms 지연으로 READY를 자동 송신한다 (scheduleReady 패턴).
 * 봇이 READY 없이 무한 대기하는 데드락을 방지한다.
 */
function scheduleReady() {
  if (readyTimer) clearTimeout(readyTimer);
  const delay = 200 + Math.floor(Math.random() * 300); // 200~500ms
  readyTimer = setTimeout(() => {
    readyTimer = null;
    console.log('[yutnori-bot] READY 송신');
    send({ type: 'READY' });
  }, delay);
}

/**
 * 서버에 JSON 메시지를 송신한다.
 * @param {object} msg
 */
function send(msg) {
  if (ws.readyState !== 1) {
    if (__isMain) {
      console.log(`[yutnori-bot:SEND] DROP (ws not open, readyState=${ws.readyState}) msg=${JSON.stringify(msg)}`);
    }
    return;
  }
  ws.send(JSON.stringify(msg));
}

// ── 테스트용 export ───────────────────────────────────────────
// 다른 모듈(예: bot-smoke.test.js)이 import하면 WS 연결을 만들지 않고
// 휴리스틱 함수만 사용 가능하다.
export { choosePiece };
