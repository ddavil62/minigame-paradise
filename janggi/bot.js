/**
 * @fileoverview 장기 단순 AI 봇 — mode=ai 사용자가 들어왔을 때 server.js가 spawn 한다.
 *
 * 실행:
 *   node bot.js                        → ws://localhost:3006/ws?mode=bot 에 접속
 *   node bot.js --url ws://...         → 다른 서버 지정 가능
 *
 * 휴리스틱 (1수 평가):
 *   - 합법 수 산출 후 평가 함수 기반 1수 선택
 *   - 평가:
 *       잡는 수: 잡힌 기물의 PIECE_SCORE 점수 가산
 *       장군 보너스: 이 수로 상대가 장군 상태가 되면 +1
 *       기본 이동: +0.1 (점수 0짜리 수들 사이 무작위성 부여)
 *   - 동률 수 여러 개면 random 선택
 *   - 마/상 배치는 'MSMS' 고정
 *   - 무승부 제안 수신: 무시 (봇은 항상 거절)
 *
 * 참고: lib/rules.js의 getAllLegalMoves는 wouldBeSelfCheck 필터를 이미 적용하므로
 *       봇이 자살수를 둘 위험은 없다.
 */

import { WebSocket } from 'ws';
import { getAllLegalMoves, isInCheck } from './lib/rules.js';
import { PIECE_SCORE } from './lib/score.js';
import { cloneBoard, movePiece, deserialize } from './lib/board.js';

// ── 인자 파싱 ─────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const urlIdx = argv.indexOf('--url');
const URL = urlIdx >= 0 && argv[urlIdx + 1] ? argv[urlIdx + 1] : 'ws://localhost:3006/ws?mode=bot';

console.log(`[janggi-bot] 서버에 접속 시도: ${URL}`);

// ── 상태 변수 ─────────────────────────────────────────────────────
/** @type {'han'|'cho'|null} */
let mySide = null;
/** 중복 행동 방지 키 (phase|turn|moveCount). */
let lastActedFor = null;

const ws = new WebSocket(URL);

ws.on('open', () => {
  console.log('[janggi-bot] 연결됨, 게임 시작 대기 중...');
});

ws.on('close', (code, reason) => {
  console.log(`[janggi-bot] 연결 종료 (code=${code}, reason=${reason || '?'})`);
  process.exit(0);
});

ws.on('error', (err) => {
  console.error('[janggi-bot] 에러:', err.message);
});

ws.on('message', (data) => {
  let msg;
  try { msg = JSON.parse(data.toString()); } catch { return; }
  switch (msg.type) {
    case 'JOINED':
      mySide = msg.side;
      console.log(`[janggi-bot] 진영 배정: ${mySide}`);
      break;
    case 'GAME_START':
      console.log(`[janggi-bot] 게임 시작 (phase=${msg.phase})`);
      lastActedFor = null;
      break;
    case 'STATE':
      handleState(msg);
      break;
    case 'SETUP_PROMPT':
      // STATE 기반으로 처리하므로 별도 트리거 불필요 (보조 로그만)
      if (msg.side === mySide) {
        console.log(`[janggi-bot] SETUP_PROMPT: ${msg.side} (대기 STATE 처리)`);
      }
      break;
    case 'CHECK':
      // 다음 STATE에서 자동 응수, 별도 처리 불필요
      break;
    case 'DRAW_OFFERED':
      // 봇은 무승부 거절 (무응답 = 묵시적 거절). 다음 수를 두면 서버가 offer를 리셋한다.
      console.log(`[janggi-bot] DRAW_OFFERED by ${msg.by} — 무시 (거절)`);
      break;
    case 'OPPONENT_LEFT':
      console.log('[janggi-bot] 상대 이탈 → 연결 종료');
      ws.close();
      break;
    case 'GAME_OVER':
      console.log(`[janggi-bot] 게임 종료: winner=${msg.winner}, reason=${msg.reason}`);
      ws.close();
      break;
    case 'ERROR':
      if (msg.message && msg.message.includes('가득')) {
        console.error('[janggi-bot] 방이 가득 찼다. 봇은 빠진다.');
        ws.close();
      } else {
        console.warn('[janggi-bot] 서버 에러:', msg.message);
      }
      break;
    default:
      // 기타 메시지는 무시
      break;
  }
});

/**
 * STATE 메시지를 받아 자기 차례 또는 자기 배치 차례면 행동을 예약한다.
 * 같은 phase + turn + moveCount 조합에서 중복 행동 방지.
 * @param {object} s 서버가 보낸 STATE 페이로드 (serializeState 결과)
 */
function handleState(s) {
  if (!mySide) return;

  // 행동이 필요한 단계만 처리
  const needSetup = (s.phase === 'setup_cho' && mySide === 'cho')
                 || (s.phase === 'setup_han' && mySide === 'han');
  const needMove  = s.phase === 'playing' && s.turn === mySide;

  if (!needSetup && !needMove) return;

  const key = `${s.phase}|${s.turn}|${s.moveCount}`;
  if (key === lastActedFor) return;
  lastActedFor = key;

  // 사람스러운 지연 (0.4~0.9초)
  const delay = 400 + Math.floor(Math.random() * 500);
  setTimeout(() => act(s), delay);
}

/**
 * phase에 맞는 액션 송신.
 * @param {object} s STATE 페이로드
 */
function act(s) {
  if (s.phase === 'setup_cho' || s.phase === 'setup_han') {
    // 봇은 MSMS 고정
    console.log(`[janggi-bot] SELECT_SETUP: MSMS (${mySide})`);
    send({ type: 'SELECT_SETUP', setup: 'MSMS' });
    return;
  }
  if (s.phase === 'playing' && s.turn === mySide) {
    if (!s.board) return;
    const board = deserialize(s.board);
    const move = chooseMove(board, mySide);
    if (!move) {
      // 합법 수가 없으면 외통수 직전이거나 비정상 상태 — 기권
      console.log('[janggi-bot] 합법 수 없음 → RESIGN');
      send({ type: 'RESIGN' });
      return;
    }
    console.log(`[janggi-bot] MOVE: (${move.fromFile},${move.fromRank})→(${move.toFile},${move.toRank})`);
    send({
      type: 'MOVE',
      fromFile: move.fromFile,
      fromRank: move.fromRank,
      toFile:   move.toFile,
      toRank:   move.toRank,
    });
  }
}

/**
 * 1수 휴리스틱: 잡는 수 + 장군 보너스 평가로 최선 수 선택.
 *
 * 점수 계산:
 *   - 잡는 수: 잡힌 기물의 PIECE_SCORE 가산
 *   - 장군 보너스: 이 수 둔 후 상대가 장군 상태이면 +1
 *   - 그 외: +0.1 (점수 0 동률 사이 무작위성)
 *
 * @param {Array<Array<{type:string,side:string}|null>>} board 복원된 보드
 * @param {'han'|'cho'} side 봇 진영
 * @returns {{fromFile:number,fromRank:number,toFile:number,toRank:number}|null}
 */
function chooseMove(board, side) {
  const moves = getAllLegalMoves(board, side);
  if (moves.length === 0) return null;

  const opponent = side === 'han' ? 'cho' : 'han';

  const scored = moves.map((m) => {
    let value = 0.1; // 기본 이동 가중치 (동률 무작위성)

    // 잡는 수 평가
    const target = board[m.toRank][m.toFile];
    if (target && target.side === opponent) {
      value += PIECE_SCORE[target.type] || 0;
    }

    // 장군 보너스 (시뮬레이션)
    const sim = cloneBoard(board);
    movePiece(sim, m.fromFile, m.fromRank, m.toFile, m.toRank);
    if (isInCheck(sim, opponent)) {
      value += 1;
    }

    return { move: m, value };
  });

  // 최고 점수 동률 수 중 random 선택
  let maxVal = -Infinity;
  for (const s of scored) {
    if (s.value > maxVal) maxVal = s.value;
  }
  const top = scored.filter((s) => s.value === maxVal);
  return top[Math.floor(Math.random() * top.length)].move;
}

/**
 * 서버에 JSON 메시지를 송신한다. 연결이 열려있지 않으면 무시.
 * @param {object} msg
 */
function send(msg) {
  if (ws.readyState !== 1) return;
  ws.send(JSON.stringify(msg));
}
