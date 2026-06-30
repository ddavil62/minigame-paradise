/**
 * @fileoverview 코드네임 클래식 AI 봇 — mode=ai 사용자가 들어오면 server.js가
 * child_process로 빈 (팀,역할) 슬롯마다 1개씩 spawn 한다.
 *
 * 실행:
 *   node bot.js --url ws://localhost:3014/ws?mode=bot&team=red&role=spymaster
 *   node bot.js --url ws://localhost:3014/ws?mode=bot&team=blue&role=operative
 *
 * 역할:
 *   - 스파이마스터: 키 카드 전체를 보고 자기팀 미공개 단어 ≥2개를 묶는 공통 태그를
 *     단서로 제시한다. 암살자·상대팀 단어가 연상되는 태그는 제외한다.
 *   - 요원: 키를 모르므로 currentClue(태그) 역조회로 보드 미공개 단어를 추측한다.
 *     보너스 추측(+1)은 안전하게 미사용(보수적).
 *
 * 외부 의존성 0 원칙: bot-knowledge.js(정적 태그맵)와 ws만 import 한다.
 * game.js·server.js 등 서버 모듈은 import 하지 않는다.
 */

import { WebSocket } from 'ws';
import { wordsForTag, tagsForWord, commonTags } from './bot-knowledge.js';

// ── 인자 파싱 ─────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const urlIdx = argv.indexOf('--url');
const URL = urlIdx >= 0 && argv[urlIdx + 1]
  ? argv[urlIdx + 1]
  : 'ws://localhost:3014/ws?mode=bot&team=red&role=spymaster';

/**
 * URL 쿼리에서 team/role을 파싱한다. URLSearchParams로 안전 추출.
 * team·role이 **둘 다** 유효하게 주어졌을 때만 explicit=true(게임 내 FILL_WITH_AI 경로).
 * 하나라도 없으면(런처 로비 제너릭 ?mode=bot spawn) 자동배정 모드로 둔다.
 * @param {string} url
 * @returns {{ team: ('red'|'blue'|null), role: ('spymaster'|'operative'|null), explicit: boolean }}
 */
function parseRole(url) {
  try {
    const q = url.split('?')[1] || '';
    const params = new URLSearchParams(q);
    const t = params.get('team');
    const r = params.get('role');
    const team = (t === 'red' || t === 'blue') ? t : null;
    const role = (r === 'spymaster' || r === 'operative') ? r : null;
    if (team && role) return { team, role, explicit: true };
  } catch { /* 파싱 실패 시 자동배정 모드로 폴백 */ }
  return { team: null, role: null, explicit: false };
}

const { team: INIT_TEAM, role: INIT_ROLE, explicit: EXPLICIT_ROLE } = parseRole(URL);
/**
 * 봇의 (팀,역할). explicit 모드는 URL 값으로 고정, 자동배정 모드는 null로 시작해
 * 서버가 빈 슬롯에 배정한 뒤 ROLE_STATE에서 자기 playerId로 조회해 채택한다.
 */
let MY_TEAM = INIT_TEAM;
let MY_ROLE = INIT_ROLE;

/** 한글 팀명. */
const TEAM_KO = { red: '빨강', blue: '파랑' };
/** 한글 역할명. */
const ROLE_KO = { spymaster: '스파이마스터', operative: '요원' };
// 자동배정 모드는 JOIN 시점에 슬롯을 모르므로 제너릭 이름을 쓴다(배정 후 갱신 불필요 — 표시는 isBot 뱃지로 구분).
const BOT_NAME = EXPLICIT_ROLE ? `AI ${TEAM_KO[MY_TEAM]} ${ROLE_KO[MY_ROLE]}` : 'AI';

console.log(`[codenames-bot] 접속 시도: ${URL} (${BOT_NAME})`);

// ── 행동 딜레이 (테스트 단축용 환경변수) ─────────────────────────
const DELAY_MIN = parseInt(process.env.CODENAMES_BOT_DELAY_MIN || '1000', 10);
const DELAY_RAND = parseInt(process.env.CODENAMES_BOT_DELAY_RAND || '1000', 10);

/** @returns {number} 1~2초(기본) 사이 사람스러운 지연 ms. */
function actDelay() {
  return DELAY_MIN + Math.floor(Math.random() * Math.max(0, DELAY_RAND));
}

// ── 상태 변수 ─────────────────────────────────────────────────────
/** @type {string|null} */
let myId = null;
/** 중복 행동 방지 키 (역할별 STATE 지문). */
let lastActedFor = null;
/** 가장 최근 STATE (타이머 fire 시점 stale 판정용). */
let lastState = null;
/** 예약된 act 타이머 (새 STATE 도착 시 취소). */
let pendingActTimer = null;
/** PICK_ROLE 예약 타이머. */
let pickRoleTimer = null;
/** 리매치 재송신 타임아웃 핸들. */
let rematchTimer = null;

const ws = new WebSocket(URL);

ws.on('open', () => {
  console.log(`[codenames-bot] 연결됨 — JOIN 송신 (${BOT_NAME})`);
  send({ type: 'JOIN', name: BOT_NAME });
});

ws.on('close', (code) => {
  console.log(`[codenames-bot] 연결 종료 (code=${code})`);
  process.exit(0);
});

ws.on('error', (err) => {
  console.error('[codenames-bot] WS 에러:', err.message);
});

ws.on('message', (data) => {
  let msg;
  try { msg = JSON.parse(data.toString()); } catch { return; }

  switch (msg.type) {
    case 'JOINED':
      myId = msg.playerId;
      if (EXPLICIT_ROLE) {
        // 게임 내 FILL_WITH_AI 경로: URL에 지정된 슬롯을 직접 PICK_ROLE.
        console.log(`[codenames-bot] ${myId} 자리 점유 → PICK_ROLE ${MY_TEAM}/${MY_ROLE}`);
        if (pickRoleTimer) clearTimeout(pickRoleTimer);
        pickRoleTimer = setTimeout(() => {
          pickRoleTimer = null;
          send({ type: 'PICK_ROLE', team: MY_TEAM, role: MY_ROLE });
        }, 200);
      } else {
        // 런처 제너릭 spawn 경로(team/role 미지정): PICK_ROLE을 보내지 않고,
        // 서버가 빈 슬롯에 자동 배정한 결과를 ROLE_STATE에서 채택할 때까지 대기.
        console.log(`[codenames-bot] ${myId} 자리 점유 → 서버 자동배정 대기(team/role 미지정)`);
      }
      break;

    case 'ROLE_STATE':
      // 자동배정 모드: 아직 내 (팀,역할)을 모르면 ROLE_STATE에서 내 playerId로 조회해 채택한다.
      if (!EXPLICIT_ROLE && myId && (!MY_TEAM || !MY_ROLE)) {
        const me = (msg.players || []).find((p) => p.id === myId);
        if (me && me.team && me.role) {
          MY_TEAM = me.team;
          MY_ROLE = me.role;
          console.log(`[codenames-bot] 서버 자동배정 채택: ${MY_TEAM}/${MY_ROLE}`);
        }
      }
      // explicit 모드 봇은 역할이 고정이라 ROLE_STATE는 무시(수신만).
      break;

    case 'GAME_START':
    case 'REMATCH_START':
      console.log(`[codenames-bot] ${msg.type} (선공: ${msg.firstTeam})`);
      lastActedFor = null;
      if (rematchTimer) { clearTimeout(rematchTimer); rematchTimer = null; }
      break;

    case 'STATE':
      handleState(msg);
      break;

    case 'GAME_OVER':
      console.log(`[codenames-bot] 게임 종료: winner=${msg.winner} (${msg.reason})`);
      scheduleRematch();
      break;

    case 'REMATCH_WAITING':
      // 상대가 먼저 동의 → 봇도 즉시 동의(서버 Set이 중복 무시).
      scheduleRematch();
      break;

    case 'OPPONENT_LEFT':
      console.log('[codenames-bot] 플레이어 이탈 → 연결 종료');
      cleanupTimers();
      ws.close();
      break;

    case 'ERROR':
      if (msg.message && (msg.message.includes('가득') || msg.message.includes('이미 선택'))) {
        // 방이 가득 찼거나 자리가 이미 점유됨 → 봇은 빠진다.
        console.error('[codenames-bot] 합류 불가:', msg.message);
        cleanupTimers();
        ws.close();
      } else {
        // 직전 행동이 거절됨 → 다음 STATE에 재행동 가능하게 키 리셋.
        console.warn('[codenames-bot] 서버 에러:', msg.message);
        lastActedFor = null;
        if (pendingActTimer) { clearTimeout(pendingActTimer); pendingActTimer = null; }
      }
      break;

    default:
      // 미정의 메시지에 죽지 않는다.
      console.warn(`[codenames-bot] 알 수 없는 메시지: ${msg.type}`);
  }
});

/**
 * GAME_OVER / REMATCH_WAITING 수신 시 자동 리매치 동의를 예약한다.
 * 0.5초 후 REMATCH 송신, REMATCH_START 미수신 시 10초 후 1회 재송신.
 */
function scheduleRematch() {
  if (rematchTimer) clearTimeout(rematchTimer);
  // 500ms 1차 타이머도 rematchTimer에 저장해 cleanupTimers()에서 취소 가능하게 한다(OBS-3).
  rematchTimer = setTimeout(() => {
    send({ type: 'REMATCH' });
    rematchTimer = setTimeout(() => {
      console.log('[codenames-bot] REMATCH_START 미수신 → REMATCH 재송신');
      send({ type: 'REMATCH' });
      rematchTimer = null;
    }, 10000);
  }, 500);
}

/** 모든 예약 타이머를 정리한다(이탈/종료 시). */
function cleanupTimers() {
  if (pendingActTimer) { clearTimeout(pendingActTimer); pendingActTimer = null; }
  if (pickRoleTimer) { clearTimeout(pickRoleTimer); pickRoleTimer = null; }
  if (rematchTimer) { clearTimeout(rematchTimer); rematchTimer = null; }
}

/**
 * STATE 수신 시 자기 차례면 행동을 예약한다.
 * 역할별 STATE 지문으로 중복 행동을 방지한다.
 * @param {object} s STATE 페이로드
 */
function handleState(s) {
  lastState = s;
  if (s.gamePhase !== 'playing') return;
  if (s.currentTeam !== MY_TEAM) {
    // 내 차례가 아니면 보류 타이머 취소(stale fire 방지).
    if (pendingActTimer) { clearTimeout(pendingActTimer); pendingActTimer = null; }
    return;
  }
  // 역할/단계 매칭: 스파이마스터=clue, 요원=guess.
  if (MY_ROLE === 'spymaster' && s.turnPhase !== 'clue') return;
  if (MY_ROLE === 'operative' && s.turnPhase !== 'guess') return;

  const key = stateKey(s);
  if (key === lastActedFor) return;
  lastActedFor = key;

  if (pendingActTimer) { clearTimeout(pendingActTimer); pendingActTimer = null; }
  pendingActTimer = setTimeout(() => {
    pendingActTimer = null;
    const cur = lastState;
    if (!cur || cur.gamePhase !== 'playing' || cur.currentTeam !== MY_TEAM) return;
    if (MY_ROLE === 'spymaster') {
      if (cur.turnPhase !== 'clue') return;
      spymasterAct(cur);
    } else {
      if (cur.turnPhase !== 'guess') return;
      operativeAct(cur);
    }
  }, actDelay());
}

/**
 * 역할별 STATE 지문(중복 행동 방지 키)을 만든다.
 * @param {object} s
 * @returns {string}
 */
function stateKey(s) {
  const revealedCount = (s.revealed || []).filter((x) => x !== null).length;
  if (MY_ROLE === 'spymaster') {
    // DEFECT-1: redFound/blueFound만으로는 요원이 중립 카드만 공개한 턴엔 키가 직전과 같아
    // 단서를 영영 못 주는 데드락이 생긴다. revealedCount(공개 카드 수)를 포함해
    // 보드가 바뀌면(중립 공개 포함) 같은 단서턴이라도 재행동 가능하게 한다(요원 키와 동일 패턴).
    // [P1-FIX-5] turnCount 추가 — 0-공개 패스 연속 시 currentTeam이 돌아와도 키가 달라짐
    return `sm|${s.currentTeam}|${s.turnPhase}|${s.redFound}|${s.blueFound}|${revealedCount}|${s.turnCount ?? 0}`;
  }
  return `op|${s.currentTeam}|${s.turnPhase}|${s.guessesLeft}|${revealedCount}`;
}

// ── 스파이마스터 로직 ─────────────────────────────────────────────
/**
 * 자기팀 미공개 단어를 ≥2개 묶는 안전한 공통 태그로 단서를 제시한다.
 * 암살자·상대팀 단어가 연상되는 태그(태그 교집합)는 제외한다.
 * @param {object} s STATE 페이로드(스파이마스터는 myKey가 키 전체)
 */
function spymasterAct(s) {
  const oppTeam = MY_TEAM === 'red' ? 'blue' : 'red';
  const words = s.words;
  const key = s.myKey;       // 스파이마스터: 전체 키 색상 배열
  const revealed = s.revealed;

  // 보드 단어 집합(단서가 보드 단어와 같으면 금지 — 코드네임 룰).
  const boardWordSet = new Set(words);

  /** 자기팀 미공개 단어. */
  const myWords = [];
  /** 치명 위험 단어(암살자 + 상대팀, 미공개) — 절대 회피 대상. */
  const hardDangerWords = [];
  /** 중립 단어(미공개) — 1차 회피, 폴백 시 허용. */
  const neutralWords = [];
  for (let i = 0; i < words.length; i++) {
    if (revealed[i] !== null) continue;
    if (key[i] === MY_TEAM) myWords.push(words[i]);
    else if (key[i] === 'assassin' || key[i] === oppTeam) hardDangerWords.push(words[i]);
    else if (key[i] === 'neutral') neutralWords.push(words[i]);
  }
  if (myWords.length === 0) return; // 줄 단어 없음(이론상 승리 직전)

  /**
   * 주어진 위험 단어 집합을 회피하는 단서를 시도한다(찾으면 송신 후 true).
   * @param {string[]} dangerWords 회피할 단어들
   * @param {string} label 로그 라벨
   * @returns {boolean} 단서를 송신했으면 true
   */
  function tryClue(dangerWords, label) {
    const dangerTags = new Set();
    for (const w of dangerWords) {
      for (const t of tagsForWord(w)) dangerTags.add(t);
    }
    // 후보 태그: 자기팀 단어 ≥2개를 묶고, 위험 태그가 아니며, 보드 단어와 다른 태그.
    const candidates = commonTags(myWords)
      .filter((c) => c.count >= 2 && !dangerTags.has(c.tag) && !boardWordSet.has(c.tag))
      .map((c) => ({ tag: c.tag, count: c.count, scope: wordsForTag(c.tag).length }));
    if (candidates.length > 0) {
      // 커버 수 최다 → 동점 시 더 좁은(구체적인) 태그(wordsForTag 작은 것) 우선.
      candidates.sort((a, b) => b.count - a.count || a.scope - b.scope || a.tag.localeCompare(b.tag));
      const best = candidates[0];
      const number = Math.max(1, Math.min(9, best.count));
      console.log(`[codenames-bot:SM] CLUE "${best.tag}" ${number} (${best.count}개 커버, ${label})`);
      send({ type: 'CLUE', word: best.tag, number });
      return true;
    }
    // 폴백: 위험·보드단어와 겹치지 않는 태그로 1:1 단서.
    for (const w of myWords) {
      for (const t of tagsForWord(w)) {
        if (!dangerTags.has(t) && !boardWordSet.has(t)) {
          console.log(`[codenames-bot:SM] 폴백 CLUE "${t}" 1 (${label})`);
          send({ type: 'CLUE', word: t, number: 1 });
          return true;
        }
      }
    }
    return false;
  }

  // OBS-1 2단 폴백: 1차로 중립까지 포함해 회피 시도(요원이 중립을 우선 추측해 턴을
  // 낭비하는 것 + DEFECT-1 데드락 트리거 완화). 유효 태그가 0이면 중립은 허용하고
  // 암살자/상대만 회피(단서를 못 내는 것보다 중립 위험이 낫다).
  if (tryClue([...hardDangerWords, ...neutralWords], '중립회피')) return;
  if (tryClue(hardDangerWords, '중립허용')) return;

  // 최후 폴백(모든 태그가 치명 위험과 겹침): 보드 단어만 피한 임의 자기팀 단어의 첫 태그로 1:1.
  for (const w of myWords) {
    const tags = tagsForWord(w).filter((t) => !boardWordSet.has(t));
    if (tags.length > 0) {
      console.log(`[codenames-bot:SM] 최후 폴백 CLUE "${tags[0]}" 1`);
      send({ type: 'CLUE', word: tags[0], number: 1 });
      return;
    }
  }
  console.warn('[codenames-bot:SM] 유효 단서 없음 — 행동 보류');
}

// ── 요원 로직 ─────────────────────────────────────────────────────
/**
 * currentClue(태그)를 역조회해 보드 미공개 단어를 태그 매칭 강도순으로 추측한다.
 * 보너스 추측(+1)은 사용하지 않는다(guessesLeft<=1이면 패스).
 * @param {object} s STATE 페이로드(요원은 키를 모름)
 */
function operativeAct(s) {
  const clue = s.currentClue;
  if (!clue || !clue.word) { sendEndTurn(); return; }

  // 보수적: 마지막 보너스 추측은 쓰지 않는다.
  if (s.guessesLeft <= 1) { sendEndTurn(); return; }

  const targetTag = clue.word;
  const candidates = [];
  for (let i = 0; i < s.words.length; i++) {
    if (s.revealed[i] !== null) continue;
    const tags = tagsForWord(s.words[i]);
    const pos = tags.indexOf(targetTag);
    if (pos < 0) continue;
    // 태그 매칭 강도: 태그가 단어의 앞쪽(주 카테고리)일수록, 단어 태그가 적을수록(구체적) 우선.
    candidates.push({ index: i, tagPos: pos, tagCount: tags.length });
  }

  if (candidates.length === 0) {
    // 단서 태그에 맞는 미공개 단어가 없음 → 위험 회피 위해 패스.
    console.log(`[codenames-bot:OP] 단서 "${targetTag}" 매칭 단어 없음 → END_TURN`);
    sendEndTurn();
    return;
  }

  candidates.sort((a, b) => a.tagPos - b.tagPos || a.tagCount - b.tagCount || a.index - b.index);
  const pick = candidates[0];
  console.log(`[codenames-bot:OP] GUESS 카드 ${pick.index} ("${s.words[pick.index]}") — 단서 "${targetTag}"`);
  send({ type: 'GUESS', cardIndex: pick.index });
}

/** 명시적 턴 종료(패스)를 송신한다. */
function sendEndTurn() {
  console.log('[codenames-bot:OP] END_TURN');
  send({ type: 'END_TURN' });
}

/**
 * 서버에 JSON 메시지를 송신한다. 연결이 열려있지 않으면 무시.
 * @param {object} msg
 */
function send(msg) {
  if (ws.readyState !== WebSocket.OPEN) {
    console.log(`[codenames-bot:SEND] DROP (ws not open) ${JSON.stringify(msg)}`);
    return;
  }
  ws.send(JSON.stringify(msg));
}
