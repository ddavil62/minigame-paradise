/**
 * @fileoverview 끝말잇기 배틀 클라이언트 진입점.
 *
 * 네트워크 메시지 수신 → UI 업데이트 파이프라인을 구성한다.
 * 모든 게임 상태는 서버 권위이며, 클라이언트는 렌더링만 담당한다.
 */

import * as net from './network.js';
import * as ui from './ui.js';
import { rejectReasonToKo } from './input.js';

// ── 클라이언트 상태 ─────────────────────────────────────────

/** 내 플레이어 ID */
let myId = null;

/** 내 현재 forced 글자 */
let isPlaying = false;

/** 현재 입력 가능한 플레이어 ID */
let currentTurn = null;

// ── 닉네임 취득 ─────────────────────────────────────────────

/**
 * 세션스토리지 또는 URL 파라미터에서 닉네임을 가져온다.
 * @returns {string}
 */
function getPlayerName() {
  const urlParams = new URLSearchParams(location.search);
  const fromUrl = urlParams.get('name');
  if (fromUrl) return fromUrl;

  const stored = sessionStorage.getItem('playerName');
  if (stored) return stored;

  return '플레이어';
}

// ── 단어 제출 핸들러 ────────────────────────────────────────

/**
 * 입력창의 단어를 서버에 제출한다.
 */
function handleSubmit() {
  if (!isPlaying || currentTurn !== myId) return;
  const word = ui.getInputValue();
  if (!word) return;

  net.send({ type: 'WORD_SUBMIT', word });
  net.send({ type: 'TYPING', count: 0 });
  ui.clearInput();
}

// ── 메시지 핸들러 등록 ──────────────────────────────────────

net.on('JOINED', (msg) => {
  myId = msg.yourId;
  console.log(`[main] 입장: ${myId}, 대기=${msg.waiting}`);

  if (msg.waiting) {
    ui.showWaiting();
  }
});

net.on('GAME_START', (msg) => {
  console.log('[main] 게임 시작, 카운트다운:', msg.countdown);

  // UI 리셋
  ui.resetGameUI();
  ui.showGame();
  isPlaying = false;
  currentTurn = null;

  // 플레이어 이름 설정
  for (const p of msg.players) {
    const who = p.id === myId ? 'me' : 'opp';
    ui.setName(who, p.name);
    ui.updateHp(who, p.hp);
    ui.updateGauge(who, p.gauge);
  }

  // 카운트다운
  ui.showCountdown(msg.countdown);
});

net.on('PLAYING', () => {
  console.log('[main] 게임 진행 시작');
  ui.hideCountdown();
  isPlaying = true;
  ui.setInputEnabled(false);
  // 실제 시작 글자는 바로 뒤따르는 STATE 메시지에서 공개된다.
  // 그 전까지 '자유'로 오인되지 않도록 대기 표시를 유지한다.
  ui.setStartCharPending();
  ui.updateTimer(10);
});

net.on('STATE', (msg) => {
  for (const p of msg.players) {
    const who = p.id === myId ? 'me' : 'opp';
    ui.updateHp(who, p.hp);
    ui.updateGauge(who, p.gauge);

  }

  currentTurn = msg.turn || null;
  const isMyTurn = isPlaying && currentTurn === myId;
  ui.setTurn(isMyTurn);
  ui.setInputEnabled(isMyTurn);
  const chain = msg.chain || {};
  if (chain.forced) ui.setStartChar(chain.forced, true);
  else if (chain.lastSyllable) ui.setStartChar(chain.lastSyllable, false, chain.deadEndAlts);
  else ui.setStartChar(null);
});

net.on('WORD_ACCEPTED', (msg) => {
  const who = msg.playerId === myId ? 'me' : 'opp';

  // 가비지 음절로 시작한 단어인지 판단 (간략화: UI에서는 forced 상태가 해소됐으므로 서버 정보 기준)
  ui.addChainWord(who, msg.word, Boolean(msg.wasGarbage));

  // 게이지 플래시
  if (msg.garbagedOpponent) {
    ui.updateGauge(who, msg.newGauge, true);
  }

  if (msg.playerId === myId) {
    ui.showFeedback('', 0);
  }
});

net.on('WORD_REJECTED', (msg) => {
  if (msg.playerId === myId) {
    ui.showInputError();
    ui.showFeedback(rejectReasonToKo(msg.reason));
  }
});

net.on('GARBAGE_RECEIVED', (msg) => {
  if (msg.targetId === myId) {
    ui.showGarbagePopup(msg.garbageChar);
    ui.setStartChar(msg.garbageChar, true);
    ui.animateHpHit('me'); // 실제 HP 값은 이어지는 STATE 메시지에서 갱신
  } else {
    // 상대가 가비지를 받았음 — 내가 보낸 것
    ui.updateGauge('me', 0, true);
    ui.showAttackPopup(msg.garbageChar);
  }
});

net.on('TIMER_TICK', (msg) => {
  ui.updateTimer(msg.remaining);
});

net.on('TIMER_EXPIRED', (msg) => {
  const who = msg.playerId === myId ? 'me' : 'opp';

  if (msg.playerId === myId) {
    const detail = msg.autoWord
      ? `시간 초과! HP가 감소했고, "${msg.autoWord}"(으)로 자동 진행됩니다.`
      : '시간 초과! HP가 감소했습니다.';
    ui.showFeedback(detail, 2500);
    ui.updateHp('me', msg.newHp, true);
  } else {
    ui.updateHp('opp', msg.newHp, true);
  }

  if (msg.autoWord) {
    ui.addChainWord(who, msg.autoWord, false, true);
  }

  ui.updateTimer(10);
});

net.on('TYPING', (msg) => {
  if (msg.playerId !== myId && currentTurn === msg.playerId) {
    ui.setTypingProgress(msg.count);
  }
});

net.on('GAME_OVER', (msg) => {
  isPlaying = false;
  currentTurn = null;
  ui.setInputEnabled(false);

  const iWon = msg.winner === myId;
  const title = iWon ? '승리!' : '패배...';

  let detail = '';
  if (msg.reason === 'hp_zero') {
    detail = iWon ? '상대의 HP가 0이 되었습니다!' : '내 HP가 0이 되었습니다.';
  } else if (msg.reason === 'resign') {
    detail = iWon ? '상대가 기권했습니다.' : '기권했습니다.';
  }

  ui.showResult(title, detail);
});

net.on('REMATCH_WAITING', (msg) => {
  ui.setRematchStatus('상대의 응답을 기다리는 중...');
});

net.on('REMATCH_START', () => {
  ui.hideResult();
  ui.resetGameUI();
  isPlaying = false;
  currentTurn = null;
});

net.on('OPPONENT_LEFT', () => {
  ui.setInputEnabled(false);
  ui.showResult('상대 퇴장', '상대가 게임을 나갔습니다.');
});

net.on('ERROR', (msg) => {
  console.warn('[main] 서버 에러:', msg.message);
});

// ── 이벤트 바인딩 ───────────────────────────────────────────

ui.onSubmitClick(handleSubmit);
ui.onInputEnter(handleSubmit);
ui.onInputChange((count) => {
  if (isPlaying && currentTurn === myId) net.send({ type: 'TYPING', count });
});
ui.onRematchClick(() => {
  net.send({ type: 'REMATCH' });
  ui.setRematchStatus('리매치 요청 전송됨...');
});
ui.onExitClick(() => {
  if (isPlaying && !window.confirm('게임을 나가시겠습니까? 기권 처리됩니다.')) return;
  if (isPlaying) net.send({ type: 'RESIGN' });
  net.disconnect();
  location.href = '/';
});

// ── 초기화 ──────────────────────────────────────────────────

const playerName = getPlayerName();
net.connect(playerName);
