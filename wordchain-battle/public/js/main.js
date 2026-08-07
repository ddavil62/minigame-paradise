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
let myForced = null;

/** 내 현재 lastSyllable */
let myLastSyllable = null;

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
  const word = ui.getInputValue();
  if (!word) return;

  net.send({ type: 'WORD_SUBMIT', word });
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
  ui.setInputEnabled(true);
  myForced = null;
  myLastSyllable = null;
  ui.setStartChar(null);
  ui.updateTimer(20);
});

net.on('STATE', (msg) => {
  for (const p of msg.players) {
    const who = p.id === myId ? 'me' : 'opp';
    ui.updateHp(who, p.hp);
    ui.updateGauge(who, p.gauge);

    if (p.id === myId) {
      myForced = p.forced;
      myLastSyllable = p.lastSyllable;

      // 시작 글자 표시 우선순위: forced > lastSyllable > 자유
      if (p.forced) {
        ui.setStartChar(p.forced, true);
      } else if (p.lastSyllable) {
        ui.setStartChar(p.lastSyllable, false);
      } else {
        ui.setStartChar(null);
      }
    }
  }
});

net.on('WORD_ACCEPTED', (msg) => {
  const who = msg.playerId === myId ? 'me' : 'opp';

  // 가비지 음절로 시작한 단어인지 판단 (간략화: UI에서는 forced 상태가 해소됐으므로 서버 정보 기준)
  const wasGarbage = msg.garbagedOpponent;
  ui.addChainWord(who, msg.word, false);

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
  }
});

net.on('TIMER_TICK', (msg) => {
  if (msg.playerId === myId) {
    ui.updateTimer(msg.remaining);
  }
});

net.on('TIMER_EXPIRED', (msg) => {
  if (msg.playerId === myId) {
    ui.showFeedback('시간 초과! HP가 감소했습니다.', 2000);
    ui.updateHp('me', msg.newHp, true);
    ui.updateTimer(20);
  } else {
    ui.updateHp('opp', msg.newHp, true);
  }
});

net.on('GAME_OVER', (msg) => {
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
  myForced = null;
  myLastSyllable = null;
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
ui.onRematchClick(() => {
  net.send({ type: 'REMATCH' });
  ui.setRematchStatus('리매치 요청 전송됨...');
});

// ── 초기화 ──────────────────────────────────────────────────

const playerName = getPlayerName();
net.connect(playerName);
