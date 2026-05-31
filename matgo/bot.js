/**
 * @fileoverview 맞고 단순 AI 봇 — 혼자 테스트용.
 *
 * 실행:
 *   node bot.js                  → ws://localhost:3003에 접속하여 p2 자리 차지
 *   node bot.js --url ws://...   → 다른 서버 지정 가능
 *
 * 휴리스틱 (대충):
 *   - 손패에서 카드 낼 때: 바닥에 같은 월 매칭 있는 카드 우선, 없으면 피부터, 그 다음 임의
 *   - 바닥 선택 대기: 임의
 *   - 9월 술잔: 손에 피가 적으면 쌍피, 많으면 끗 (단순)
 *   - 흔들기: 안 함 (×2 보너스보다 패배 시 손해 더 큰 케이스 있어 보수적)
 *   - 폭탄: 사용 안 함
 *   - 고/스톱: 점수 < 8이면 무조건 스톱, 8-9이면 70% 스톱, 10+이면 50% 고
 *   - 덱 비어 자기 카드 공개해야 할 때: 손에서 임의 미공개 한 장
 */
import { WebSocket } from 'ws';

const argv = process.argv.slice(2);
const urlIdx = argv.indexOf('--url');
const URL = urlIdx >= 0 && argv[urlIdx + 1] ? argv[urlIdx + 1] : 'ws://localhost:3003';

console.log(`[bot] 서버에 접속 시도: ${URL}`);

let myId = null;
let lastActedFor = null; // 같은 phase에서 두 번 행동 안 하도록 추적
// 새 STATE가 도착하면 기존 보류 중인 act 타이머를 취소해서 항상 최신 STATE 기준으로
// 행동한다. 이전엔 단계 1(pair_from_hand) 보류 + 단계 2(STEP_DELAY 600ms 후 단계 3)
// 사이에 봇이 단계 2 STATE에 반응해 doPlay → 단계 3 phase 변경 후 도착 → 서버 거절
// → 봇 멈춤 케이스가 있었다.
let pendingActTimer = null;

const ws = new WebSocket(URL);

ws.on('open', () => {
  console.log('[bot] 연결됨, 게임 시작 대기 중...');
});

ws.on('close', (code, reason) => {
  console.log(`[bot] 연결 종료 (code=${code}, reason=${reason || '?'})`);
  process.exit(0);
});

ws.on('error', (err) => {
  console.error('[bot] 에러:', err.message);
});

ws.on('message', (data) => {
  let msg;
  try { msg = JSON.parse(data.toString()); } catch { return; }
  switch (msg.type) {
    case 'JOINED':
      myId = msg.playerId;
      console.log(`[bot] ${myId} 자리 점유`);
      break;
    case 'GAME_START':
      console.log('[bot] 게임 시작');
      lastActedFor = null;
      break;
    case 'STATE':
      handleState(msg);
      break;
    case 'ROUND_END':
      console.log('[bot] 라운드 종료, 새 라운드 대기...');
      lastActedFor = null;
      break;
    case 'GAME_END':
      console.log('[bot] 게임 종료');
      break;
    case 'ERROR':
      // 정원 초과 등
      if (msg.message && msg.message.includes('가득')) {
        console.error('[bot] 방이 가득 찼다. 사람 두 명이 이미 있으므로 봇은 빠진다.');
        ws.close();
      } else {
        console.warn('[bot] 서버 에러:', msg.message);
      }
      break;
    default:
      // 기타 메시지 무시
      break;
  }
});

/**
 * STATE 메시지를 받아 자기 차례면 행동 결정.
 * 같은 phase + turn 조합에서 중복 행동 방지.
 * @param {object} s
 */
function handleState(s) {
  if (s.turn !== myId) {
    // 단, 자기에게 온 pending(shake/kkeut)은 자기 차례 아니어도 처리해야 할 수 있음
    if (s.phase === 'shake_decision' && s.pendingShake) {
      // pendingShake는 자기 시점에서만 옴
    } else if (s.phase === 'awaiting_kkeut_choice' && s.pendingKkeutChoice && s.pendingKkeutChoice.player === myId) {
      // 끗 선택은 자기에게만 오니까 처리
    } else {
      return;
    }
  }
  const key = `${s.phase}|${s.turn}|${s.lastAction ? s.lastAction.kind : ''}|${s.lastAction ? (s.lastAction.player || '') : ''}|${s.deckCount}`;
  if (key === lastActedFor) return;
  lastActedFor = key;

  // 새 STATE가 도착했으므로 직전 보류 중이던 act 타이머를 취소.
  // (서버가 단계 1 보류 → 단계 2 broadcast → STEP_DELAY 600ms → 단계 3 broadcast
  //  하는 중간 STATE에서 봇이 행동을 보내면 phase 불일치로 거절되어 멈춘다.)
  if (pendingActTimer) {
    clearTimeout(pendingActTimer);
    pendingActTimer = null;
  }

  // 사람스러운 지연 (0.6~1.4초)
  const delay = 600 + Math.floor(Math.random() * 800);
  pendingActTimer = setTimeout(() => {
    pendingActTimer = null;
    act(s);
  }, delay);
}

/**
 * phase에 맞는 액션 전송.
 * @param {object} s
 */
function act(s) {
  switch (s.phase) {
    case 'awaiting_play':           return doPlay(s);
    case 'awaiting_floor_choice':   return doChooseFloor(s);
    case 'awaiting_go_stop':        return doGoStop(s);
    case 'shake_decision':          return send({ type: 'SHAKE', decision: 'normal' });
    case 'awaiting_kkeut_choice':   return doKkeutChoice(s);
    case 'awaiting_self_reveal':    return doSelfReveal(s);
    default: /* 다른 단계는 가만히 있음 */ break;
  }
}

/**
 * 손패에서 카드 한 장 던지기.
 * 우선순위:
 *   1. 바닥에 같은 월 있는 카드 (즉시 매칭 → 점수 확보)
 *   2. 피 (값 낮은 카드부터 던져서 광/끗/띠 보존)
 *   3. 임의
 */
function doPlay(s) {
  const hand = s.yourHand;
  if (!hand || hand.length === 0) return;
  const floorMonths = new Set(s.floor.map((c) => c.month));
  const matching = hand.filter((c) => floorMonths.has(c.month));
  let pick;
  if (matching.length > 0) {
    pick = matching[Math.floor(Math.random() * matching.length)];
  } else {
    // 피 우선 던지기
    const pis = hand.filter((c) => c.type === 'pi' && c.subtype !== 'ssangpi');
    pick = pis.length > 0
      ? pis[Math.floor(Math.random() * pis.length)]
      : hand[Math.floor(Math.random() * hand.length)];
  }
  console.log(`[bot] PLAY_CARD: ${pick.id} (${pick.month}월 ${pick.type})`);
  send({ type: 'PLAY_CARD', cardId: pick.id });
}

function doChooseFloor(s) {
  if (!s.pendingChoice || !s.pendingChoice.candidates) return;
  const candidates = s.pendingChoice.candidates;
  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  console.log(`[bot] CHOOSE_FLOOR: ${pick.id}`);
  send({ type: 'CHOOSE_FLOOR', cardId: pick.id });
}

function doGoStop(s) {
  const myScore = s.score[myId];
  let decision;
  if (myScore < 8)        decision = 'stop';
  else if (myScore < 10)  decision = Math.random() < 0.3 ? 'go' : 'stop';
  else                    decision = Math.random() < 0.5 ? 'go' : 'stop';
  console.log(`[bot] GO_STOP: ${decision} (점수=${myScore})`);
  send({ type: 'GO_STOP', decision });
}

function doKkeutChoice(s) {
  // 손/점수판에서 피 카운트 추정. 피 부족하면 쌍피, 많으면 끗
  const cap = s.captured && s.captured[myId] ? s.captured[myId] : [];
  const piCount = cap.reduce((sum, c) => sum + (c.type === 'pi' ? (c.subtype === 'ssangpi' ? 2 : 1) : 0), 0);
  // 9점 임계: 피 7장 이하면 쌍피 가치 더 큼
  const choice = piCount <= 7 ? 'ssangpi' : 'kkeut';
  console.log(`[bot] SELECT_KKEUT_TYPE: ${choice} (피=${piCount})`);
  send({ type: 'SELECT_KKEUT_TYPE', choice });
}

function doSelfReveal(s) {
  const hand = s.yourHand || [];
  const unrevealedIdx = hand.findIndex((c) => !c.revealed);
  if (unrevealedIdx < 0) return;
  console.log(`[bot] SELF_REVEAL: slot=${unrevealedIdx}`);
  send({ type: 'SELF_REVEAL', slot: unrevealedIdx });
}

/**
 * 서버에 JSON 메시지 전송.
 */
function send(msg) {
  if (ws.readyState !== 1) return;
  ws.send(JSON.stringify(msg));
}
