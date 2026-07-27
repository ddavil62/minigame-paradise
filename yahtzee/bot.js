/**
 * @fileoverview 요트 다이스(Yahtzee) 단순 AI 봇 — mode=ai 사용자가 들어왔을 때
 * server.js가 child_process로 spawn 한다.
 *
 * 실행:
 *   node bot.js                        → ws://localhost:3010/ws?mode=bot 에 접속
 *   node bot.js --url ws://...         → 다른 서버 지정 가능
 *
 * 휴리스틱 (캐주얼 중급):
 *   - 자기 턴마다 1차 굴림 → keep 결정 → 2차 굴림 → keep 결정 → 3차 굴림 → 카테고리 선택
 *   - keep 우선순위:
 *       1) 최빈 숫자가 2개 이상이면 그 숫자들 모두 keep
 *       2) 연속 4개 이상(스트레이트 후보)이면 연속 부분만 keep (중복은 1개만)
 *       3) 그 외에는 가장 큰 다이스 1~2개만 keep
 *   - 카테고리 선택 우선순위:
 *       1) Yahtzee(50) 가능 + 슬롯 비었으면 사용
 *       2) Large/Small Straight(40/30) 가능 + 슬롯 비었으면 사용
 *       3) Full House(25) 가능 + 슬롯 비었으면 사용
 *       4) Four of a Kind 가능 + 슬롯 비었으면 사용
 *       5) Three of a Kind 가능 + 슬롯 비었으면 사용
 *       6) 상단(aces~sixes) 중 점수 가장 높은 미사용 슬롯 (>=face*2 이상이면 우선)
 *       7) Chance (마지막 수단)
 *       8) 그 외 손해 가장 적은 미사용 슬롯에 0점 기록
 *
 * 룰 일관성: 서버 game.js의 calcCategoryScore와 동일 룰을 이 파일에서 재구현한다.
 * (외부 의존성을 최소화하기 위해 game.js를 import하지 않음.)
 *
 * 행동 지연: 1200~2400ms (사람스러운 여유. N1으로 기존 600~1200ms에서 2배 상향.)
 */

import { WebSocket } from 'ws';

// ── 인자 파싱 ─────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const urlIdx = argv.indexOf('--url');
const URL = urlIdx >= 0 && argv[urlIdx + 1] ? argv[urlIdx + 1] : 'ws://localhost:3010/ws?mode=bot';

console.log(`[yahtzee-bot] 서버에 접속 시도: ${URL}`);

// ── 상수 (서버 game.js와 일치) ───────────────────────────────────
const DICE_COUNT = 5;
const MAX_ROLLS_PER_TURN = 3;
const UPPER_CATEGORIES = ['aces', 'twos', 'threes', 'fours', 'fives', 'sixes'];
const LOWER_CATEGORIES = [
  'threeOfAKind', 'fourOfAKind', 'fullHouse',
  'smallStraight', 'largeStraight', 'yahtzee', 'chance',
];
const ALL_CATEGORIES = [...UPPER_CATEGORIES, ...LOWER_CATEGORIES];
const UPPER_FACE_OF = { aces: 1, twos: 2, threes: 3, fours: 4, fives: 5, sixes: 6 };

// ── 상태 변수 ─────────────────────────────────────────────────────
/** @type {'p1'|'p2'|null} */
let myId = null;
/** 중복 행동 방지 키 (currentTurn|rollCount|turnNumber). */
let lastActedFor = null;
/** 가장 최근 STATE — fire 시점에 stale 결정 회피를 위해 캐시. */
let lastState = null;
/** 예약된 act 타이머 (새 STATE 도착 시 취소). */
let pendingActTimer = null;
/** 자동 READY 예약 타이머 (JOINED 재전송 대비 재예약 방어). */
let readyTimer = null;

const ws = new WebSocket(URL);

ws.on('open', () => {
  console.log('[yahtzee-bot] 연결됨, JOIN 송신');
  send({ type: 'JOIN', playerName: 'AI 봇' });
});

ws.on('close', (code, reason) => {
  console.log(`[yahtzee-bot] 연결 종료 (code=${code}, reason=${reason || '?'})`);
  process.exit(0);
});

ws.on('error', (err) => {
  console.error('[yahtzee-bot] 에러:', err.message);
});

ws.on('message', (data) => {
  let msg;
  try { msg = JSON.parse(data.toString()); } catch { return; }
  switch (msg.type) {
    case 'JOINED':
      myId = msg.playerId;
      console.log(`[yahtzee-bot] ${myId} 자리 점유(갱신)`);
      // 입장(또는 리매치 재진입) 즉시 자동 READY 예약(0.2~0.5초 지연).
      scheduleReady();
      break;
    case 'START':
      console.log('[yahtzee-bot] 게임 시작');
      lastActedFor = null;
      break;
    case 'STATE':
      handleState(msg);
      break;
    case 'DICE_ROLLED':
      // STATE가 같이 broadcast되므로 별도 처리 불필요.
      break;
    case 'CATEGORY_SCORED':
      // STATE가 같이 broadcast되므로 별도 처리 불필요.
      break;
    case 'GAME_OVER':
      console.log(`[yahtzee-bot] 게임 종료: winner=${msg.winner}, p1=${msg.p1Total}, p2=${msg.p2Total}`);
      // 자동 재대결: REMATCH 송신 (사람이 다시 시작하면 봇도 호응).
      // 사람이 로비로 나가면 disconnect로 봇도 종료된다.
      setTimeout(() => {
        send({ type: 'REMATCH' });
      }, 500);
      break;
    case 'OPPONENT_LEFT':
      console.log('[yahtzee-bot] 상대 이탈 → 연결 종료');
      if (readyTimer) { clearTimeout(readyTimer); readyTimer = null; }
      ws.close();
      break;
    case 'READY_STATE':
    case 'READY_STATUS':
    case 'REMATCH_STATUS':
      // 정보성 메시지 — 무시.
      break;
    case 'ERROR':
      if (msg.message && msg.message.includes('가득')) {
        console.error('[yahtzee-bot] 방이 가득 찼다. 봇은 빠진다.');
        ws.close();
      } else {
        console.warn('[yahtzee-bot] 서버 에러:', msg.message);
        // 직전 액션이 거절되었으므로 다음 STATE에 재행동할 수 있게 키 리셋.
        lastActedFor = null;
        if (pendingActTimer) {
          clearTimeout(pendingActTimer);
          pendingActTimer = null;
        }
      }
      break;
    default:
      // 기타 메시지 무시
      break;
  }
});

/**
 * JOINED 수신 후 자동 READY를 예약한다(0.2~0.5초 지연).
 * 리매치 시 JOINED가 재전송되므로 기존 예약을 clear 후 재예약한다(중복 방어).
 */
function scheduleReady() {
  if (readyTimer) clearTimeout(readyTimer);
  readyTimer = setTimeout(() => {
    readyTimer = null;
    send({ type: 'READY' });
    console.log('[yahtzee-bot] READY 송신');
  }, 200 + Math.floor(Math.random() * 300));
}

/**
 * STATE 메시지를 받아 자기 차례면 행동 예약.
 * 같은 (turn|rollCount|turnNumber) 조합에서 중복 행동 방지.
 * @param {object} s 서버가 보낸 STATE 페이로드
 */
function handleState(s) {
  lastState = s;
  if (!myId) return;
  if (s.phase !== 'playing') return;
  if (s.currentTurn !== myId) {
    // 자기 차례 아니어도 보류 타이머는 취소 (stale STATE 기반 fire 방지).
    if (pendingActTimer) {
      clearTimeout(pendingActTimer);
      pendingActTimer = null;
    }
    return;
  }

  const key = `${s.currentTurn}|${s.rollCount}|${s.turnNumber}`;
  if (key === lastActedFor) return;
  lastActedFor = key;

  if (pendingActTimer) {
    clearTimeout(pendingActTimer);
    pendingActTimer = null;
  }

  // 사람스러운 지연 (1.2~2.4초) — N1: 봇 행동이 너무 빨라 따라가기 어렵다는 피드백 반영해 2배로 상향.
  const delay = 1200 + Math.floor(Math.random() * 1200);
  pendingActTimer = setTimeout(() => {
    pendingActTimer = null;
    const cur = lastState;
    if (!cur || cur.phase !== 'playing' || cur.currentTurn !== myId) return;
    act(cur);
  }, delay);
}

/**
 * 현재 STATE에 따라 행동 결정.
 * - rollCount=0: 첫 굴림(ROLL_DICE, keep 무시)
 * - rollCount=1,2: keep 결정 후 ROLL_DICE 또는 카테고리 선택
 * - rollCount=3: 무조건 카테고리 선택
 * @param {object} s
 */
function act(s) {
  const dice = s.dice || [];
  const sheet = (s.sheets && s.sheets[myId]) || {};
  const rollCount = s.rollCount || 0;

  if (rollCount === 0) {
    // 1차 굴림 — keep 무시.
    console.log(`[yahtzee-bot] ROLL_DICE 1차`);
    send({ type: 'ROLL_DICE', keep: [false, false, false, false, false] });
    return;
  }

  // 2/3차 굴림 또는 카테고리 선택 선택지 결정.
  // 3차 굴림 완료 → 무조건 카테고리 선택.
  if (rollCount >= MAX_ROLLS_PER_TURN) {
    pickAndScore(dice, sheet);
    return;
  }

  // 2차/3차로 더 굴릴지 결정.
  // 휴리스틱: 야츠/스트레이트/풀하우스가 이미 완성되었거나,
  // 추가 굴림으로 기대치 향상이 적으면 카테고리 선택으로 종료.
  if (shouldStopRolling(dice, sheet, rollCount)) {
    pickAndScore(dice, sheet);
    return;
  }

  // 추가 굴림.
  const keep = decideKeep(dice);
  // 풀하우스처럼 현재 전략이 다섯 주사위를 모두 보관하기로 결정했다면
  // 같은 눈을 그대로 두고 굴림 횟수만 소비하지 말고 즉시 점수 칸을 선택한다.
  if (keep.length === 5 && keep.every(Boolean)) {
    pickAndScore(dice, sheet);
    return;
  }
  console.log(`[yahtzee-bot] ROLL_DICE ${rollCount + 1}차 keep=[${keep.map((k) => k ? 'K' : '_').join(',')}] dice=[${dice.join(',')}]`);
  send({ type: 'ROLL_DICE', keep });
}

/**
 * 추가 굴림을 멈출지 판정.
 * 이미 완성된 강한 패가 있으면 멈춘다.
 * @param {number[]} dice
 * @param {Record<string, number|null>} sheet
 * @param {number} rollCount 현재까지 굴린 횟수(1 또는 2)
 * @returns {boolean}
 */
function shouldStopRolling(dice, sheet, rollCount) {
  // 야츠 완성 + yahtzee 슬롯 비었거나 50점 기록(보너스 +100 가능)이면 멈춘다.
  if (calcScore(dice, 'yahtzee') === 50) {
    if (sheet.yahtzee === null || sheet.yahtzee === 50) return true;
  }
  // 라지 스트레이트 완성 + 슬롯 비었으면 멈춘다.
  if (calcScore(dice, 'largeStraight') === 40 && sheet.largeStraight === null) return true;
  // 풀하우스 완성 + 슬롯 비었으면 멈춘다 (2차에선 야츠 노릴 수 있으나 보수적).
  if (rollCount >= 2 && calcScore(dice, 'fullHouse') === 25 && sheet.fullHouse === null) return true;
  // 스몰 스트레이트 + 슬롯 비었으면 2차에서는 라지를 노리고, 3차는 멈춘다.
  if (rollCount >= 2 && calcScore(dice, 'smallStraight') === 30 && sheet.smallStraight === null) {
    // 라지 스트레이트로 갈 수 있으면(슬롯 비고 + 4연속만 있고 끝 다이스 1개만 떨굴 수 있으면)
    // 한 번 더 굴릴 가치 있음 → 멈추지 않음. 단순화: 3차에서만 멈춤.
    return true;
  }
  return false;
}

/**
 * keep 결정 휴리스틱.
 * 1) 최빈 숫자가 2개 이상이면 그 숫자들 모두 keep
 * 2) 연속 4개 이상(스트레이트 후보)이면 연속 부분만 keep
 * 3) 그 외에는 가장 큰 다이스 1~2개만 keep
 * @param {number[]} dice
 * @returns {boolean[]} 길이 5
 */
function decideKeep(dice) {
  const keep = [false, false, false, false, false];
  const counts = countFaces(dice);

  // 1) 최빈 숫자 찾기 (2개 이상).
  let bestFace = 0;
  let bestCount = 0;
  for (let f = 1; f <= 6; f++) {
    if (counts[f] >= 2 && counts[f] > bestCount) {
      bestFace = f;
      bestCount = counts[f];
    } else if (counts[f] >= 2 && counts[f] === bestCount && f > bestFace) {
      // 동률이면 큰 숫자 우선 (점수 기대치 높음).
      bestFace = f;
    }
  }

  // 풀하우스/투페어 처리: 2개씩 두 종류 있으면 둘 다 keep (Four/Full 향).
  const pairFaces = [];
  for (let f = 1; f <= 6; f++) {
    if (counts[f] >= 2) pairFaces.push(f);
  }

  if (pairFaces.length >= 1) {
    // 모든 페어/트리플/쿼드 숫자를 keep.
    for (let i = 0; i < dice.length; i++) {
      if (pairFaces.includes(dice[i])) keep[i] = true;
    }
    return keep;
  }

  // 2) 스트레이트 후보 — 연속 4개 이상 (1234/2345/3456/12345/23456).
  const has = (n) => counts[n] >= 1;
  // 가능한 연속 구간 중 가장 긴 것을 찾는다.
  let bestRun = null; // { start, len }
  for (let start = 1; start <= 6; start++) {
    let len = 0;
    for (let n = start; n <= 6 && has(n); n++) len++;
    if (len >= 4 && (!bestRun || len > bestRun.len)) {
      bestRun = { start, len };
    }
  }
  if (bestRun) {
    // 그 연속 부분만 keep, 중복은 한 번만.
    const used = new Set();
    for (let i = 0; i < dice.length; i++) {
      const d = dice[i];
      if (d >= bestRun.start && d < bestRun.start + bestRun.len && !used.has(d)) {
        keep[i] = true;
        used.add(d);
      }
    }
    return keep;
  }

  // 3) 그 외 — 큰 다이스 1~2개만 keep (Chance/상단 향).
  // 5, 6만 keep (점수 기대치 높은 면만).
  for (let i = 0; i < dice.length; i++) {
    if (dice[i] >= 5) keep[i] = true;
  }
  // 5/6도 하나 없으면 전부 다시 굴린다 (모두 false 유지).
  return keep;
}

/**
 * 카테고리 선택 + SCORE_CATEGORY 송신.
 * @param {number[]} dice
 * @param {Record<string, number|null>} sheet
 */
function pickAndScore(dice, sheet) {
  const category = decideCategory(dice, sheet);
  const previewScore = calcScore(dice, category);
  console.log(`[yahtzee-bot] SCORE_CATEGORY: ${category}=${previewScore} dice=[${dice.join(',')}]`);
  send({ type: 'SCORE_CATEGORY', category });
}

/**
 * 카테고리 선택 휴리스틱.
 * 우선순위는 모듈 상단 주석 참조.
 * @param {number[]} dice
 * @param {Record<string, number|null>} sheet
 * @returns {string} 선택한 카테고리 ID
 */
function decideCategory(dice, sheet) {
  const empty = ALL_CATEGORIES.filter((c) => sheet[c] === null);
  if (empty.length === 0) {
    // 이론상 도달 불가 (서버가 막아야 함).
    return ALL_CATEGORIES[0];
  }

  const score = (cat) => calcScore(dice, cat);

  // 1) Yahtzee 가능 + 슬롯 비었으면 우선.
  if (empty.includes('yahtzee') && score('yahtzee') === 50) {
    return 'yahtzee';
  }
  // 2) Large/Small Straight 가능 + 슬롯 비었으면 우선.
  if (empty.includes('largeStraight') && score('largeStraight') === 40) {
    return 'largeStraight';
  }
  if (empty.includes('smallStraight') && score('smallStraight') === 30) {
    return 'smallStraight';
  }
  // 3) Full House 가능 + 슬롯 비었으면.
  if (empty.includes('fullHouse') && score('fullHouse') === 25) {
    return 'fullHouse';
  }
  // 4) Four of a Kind.
  if (empty.includes('fourOfAKind') && score('fourOfAKind') > 0) {
    return 'fourOfAKind';
  }
  // 5) Three of a Kind.
  if (empty.includes('threeOfAKind') && score('threeOfAKind') > 0) {
    return 'threeOfAKind';
  }

  // 6) 상단 중 점수 face*3 이상(=세 개 이상 매치) 있으면 우선 (예: 4×3=12점).
  let bestUpper = null;
  let bestUpperScore = 0;
  for (const cat of UPPER_CATEGORIES) {
    if (!empty.includes(cat)) continue;
    const s = score(cat);
    const face = UPPER_FACE_OF[cat];
    if (s >= face * 3 && s > bestUpperScore) {
      bestUpper = cat;
      bestUpperScore = s;
    }
  }
  if (bestUpper) return bestUpper;

  // 7) Chance — 점수 보장 (>= 5).
  if (empty.includes('chance')) {
    return 'chance';
  }

  // 8) 손해 가장 적은 미사용 슬롯에 0점.
  // 우선순위: 잃을 점수 큰 슬롯(yahtzee=50)을 비워두고 작은 슬롯에 0점.
  // 즉 점수 가능 낮은 슬롯 우선.
  const losses = {
    yahtzee: 50, largeStraight: 40, smallStraight: 30, fullHouse: 25,
    fourOfAKind: 20, threeOfAKind: 15,
    sixes: 18, fives: 15, fours: 12, threes: 9, twos: 6, aces: 3,
    chance: 5,
  };
  // 미사용 슬롯 중 loss가 가장 작은 것에 0점 기록.
  let pick = empty[0];
  let pickLoss = losses[pick] !== undefined ? losses[pick] : 99;
  for (const cat of empty) {
    const l = losses[cat] !== undefined ? losses[cat] : 99;
    if (l < pickLoss) {
      pick = cat;
      pickLoss = l;
    }
  }
  return pick;
}

// ── 룰 계산 (서버 game.js calcCategoryScore와 동일) ──────────────

/**
 * 다이스 5개 면값 → 1~6 각 개수 배열.
 * @param {number[]} dice
 * @returns {number[]}
 */
function countFaces(dice) {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const d of dice) counts[d] += 1;
  return counts;
}

/**
 * 다이스 합산.
 * @param {number[]} dice
 * @returns {number}
 */
function sumDice(dice) {
  return dice.reduce((s, n) => s + n, 0);
}

/**
 * 주어진 다이스에 대해 특정 카테고리 점수를 계산한다.
 * 서버 game.js의 calcCategoryScore와 동일한 룰 (사용자 스펙: Full House는 3+2만).
 * @param {number[]} dice
 * @param {string} category
 * @returns {number}
 */
function calcScore(dice, category) {
  if (!Array.isArray(dice) || dice.length !== DICE_COUNT) return 0;
  for (const d of dice) {
    if (!Number.isInteger(d) || d < 1 || d > 6) return 0;
  }
  const counts = countFaces(dice);

  if (UPPER_FACE_OF[category] !== undefined) {
    const face = UPPER_FACE_OF[category];
    return counts[face] * face;
  }

  switch (category) {
    case 'threeOfAKind': {
      const ok = counts.some((c) => c >= 3);
      return ok ? sumDice(dice) : 0;
    }
    case 'fourOfAKind': {
      const ok = counts.some((c) => c >= 4);
      return ok ? sumDice(dice) : 0;
    }
    case 'fullHouse': {
      let hasThree = false;
      let hasTwo = false;
      for (let f = 1; f <= 6; f++) {
        if (counts[f] === 3) hasThree = true;
        else if (counts[f] === 2) hasTwo = true;
      }
      return (hasThree && hasTwo) ? 25 : 0;
    }
    case 'smallStraight': {
      const has = (n) => counts[n] >= 1;
      const s1 = has(1) && has(2) && has(3) && has(4);
      const s2 = has(2) && has(3) && has(4) && has(5);
      const s3 = has(3) && has(4) && has(5) && has(6);
      return (s1 || s2 || s3) ? 30 : 0;
    }
    case 'largeStraight': {
      const has = (n) => counts[n] >= 1;
      const l1 = has(1) && has(2) && has(3) && has(4) && has(5);
      const l2 = has(2) && has(3) && has(4) && has(5) && has(6);
      return (l1 || l2) ? 40 : 0;
    }
    case 'yahtzee': {
      const ok = counts.some((c) => c === DICE_COUNT);
      return ok ? 50 : 0;
    }
    case 'chance': {
      return sumDice(dice);
    }
    default:
      return 0;
  }
}

/**
 * 서버에 JSON 메시지를 송신한다. 연결이 열려있지 않으면 무시.
 * @param {object} msg
 */
function send(msg) {
  if (ws.readyState !== 1) {
    console.log(`[yahtzee-bot:SEND] DROP (ws not open, readyState=${ws.readyState}) msg=${JSON.stringify(msg)}`);
    return;
  }
  ws.send(JSON.stringify(msg));
}
