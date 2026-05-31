/**
 * @fileoverview UI 컴포넌트 모듈. 모달, 시간 패널, 장군 알림, 종료 모달을 관리한다.
 * AD 컨셉 §5 (UI 컴포넌트 가이드) 기준.
 */

// ── DOM 참조 ────────────────────────────────────────────────────
const setupModal = document.getElementById('setup-modal');
const setupTitle = document.getElementById('setup-title');
const setupSubtitle = document.getElementById('setup-subtitle');
const setupTimerEl = document.getElementById('setup-timer');
const setupOptions = document.getElementById('setup-options');
const setupWaitMsg = document.getElementById('setup-wait-msg');

const gameOverModal = document.getElementById('game-over-modal');
const gameOverTitle = document.getElementById('game-over-title');
const gameOverReason = document.getElementById('game-over-reason');
const gameOverScores = document.getElementById('game-over-scores');
const scoreHanEl = document.getElementById('score-han');
const scoreChoEl = document.getElementById('score-cho');

const drawModal = document.getElementById('draw-modal');

const checkToast = document.getElementById('check-toast');
const toastEl = document.getElementById('toast');

const timeHanMainEl = document.getElementById('time-han-main');
const timeHanByoEl = document.getElementById('time-han-byoyomi');
const timeChoMainEl = document.getElementById('time-cho-main');
const timeChoByoEl = document.getElementById('time-cho-byoyomi');

const panelHan = document.getElementById('panel-han');
const panelCho = document.getElementById('panel-cho');

// ── 내부 상태 ───────────────────────────────────────────────────
/** @type {NodeJS.Timeout|null} 배치 선택 카운트다운 인터벌 */
let setupCountdownInterval = null;
let setupCountdownSec = 30;

// ── 배치 선택 모달 (AD §5-1) ────────────────────────────────────

/**
 * 배치 선택 모달을 표시한다.
 * @param {'han'|'cho'} promptSide 선택해야 하는 진영
 * @param {'han'|'cho'} mySide 내 진영
 * @param {function(string):void} onSelect 선택 콜백
 */
export function showSetupModal(promptSide, mySide, onSelect) {
  setupModal.hidden = false;
  gameOverModal.hidden = true;

  const isMyTurn = promptSide === mySide;
  const sideLabel = promptSide === 'cho' ? '초(楚)' : '한(漢)';

  setupTitle.textContent = isMyTurn
    ? '마/상 배치를 선택하세요'
    : `${sideLabel} 배치 선택 중...`;
  setupSubtitle.textContent = promptSide === 'cho'
    ? '초(楚)가 먼저 선택합니다'
    : '한(漢)이 응수 선택합니다';

  // 버튼 활성화/비활성화
  const btns = setupOptions.querySelectorAll('.setup-btn');
  btns.forEach(btn => {
    btn.disabled = !isMyTurn;
    btn.classList.remove('selected-setup');
  });

  // 대기 메시지
  setupWaitMsg.hidden = isMyTurn;

  if (isMyTurn) {
    // 클릭 핸들러
    const handler = (e) => {
      const btn = e.target.closest('.setup-btn');
      if (!btn || btn.disabled) return;
      const code = btn.dataset.setup;
      // 선택된 버튼 표시
      btns.forEach(b => b.classList.remove('selected-setup'));
      btn.classList.add('selected-setup');
      // 모든 버튼 비활성화
      btns.forEach(b => { b.disabled = true; });
      setupOptions.removeEventListener('click', handler);
      onSelect(code);
    };
    setupOptions.addEventListener('click', handler);
  }

  // 카운트다운 시작
  startSetupCountdown(30);
}

/**
 * 배치 선택 모달을 닫는다.
 */
export function hideSetupModal() {
  setupModal.hidden = true;
  stopSetupCountdown();
}

/**
 * 배치 선택 카운트다운을 시작한다.
 * @param {number} sec 초
 */
function startSetupCountdown(sec) {
  stopSetupCountdown();
  setupCountdownSec = sec;
  setupTimerEl.textContent = String(setupCountdownSec);

  setupCountdownInterval = setInterval(() => {
    setupCountdownSec--;
    if (setupCountdownSec <= 0) {
      setupTimerEl.textContent = '0';
      stopSetupCountdown();
    } else {
      setupTimerEl.textContent = String(setupCountdownSec);
    }
  }, 1000);
}

/**
 * 배치 선택 카운트다운을 중지한다.
 */
function stopSetupCountdown() {
  if (setupCountdownInterval) {
    clearInterval(setupCountdownInterval);
    setupCountdownInterval = null;
  }
}

// ── 시간 패널 업데이트 ──────────────────────────────────────────

/**
 * 시간 패널을 업데이트한다.
 * @param {{mainSec:number, byoyomiSec:number, byoyomiLeft:number}} hanTime
 * @param {{mainSec:number, byoyomiSec:number, byoyomiLeft:number}} choTime
 * @param {'han'|'cho'} currentTurn
 */
export function updateTimePanel(hanTime, choTime, currentTurn) {
  // 한 시간
  timeHanMainEl.textContent = formatTime(hanTime.mainSec);
  if (hanTime.mainSec > 0) {
    timeHanByoEl.textContent = `초읽기 ${hanTime.byoyomiSec}초 (${hanTime.byoyomiLeft}회)`;
  } else {
    timeHanByoEl.textContent = `초읽기 ${hanTime.byoyomiSec}초 (${hanTime.byoyomiLeft}회 남음)`;
    timeHanByoEl.style.color = hanTime.byoyomiLeft <= 1 ? '#FF3B30' : '';
  }

  // 초 시간
  timeChoMainEl.textContent = formatTime(choTime.mainSec);
  if (choTime.mainSec > 0) {
    timeChoByoEl.textContent = `초읽기 ${choTime.byoyomiSec}초 (${choTime.byoyomiLeft}회)`;
  } else {
    timeChoByoEl.textContent = `초읽기 ${choTime.byoyomiSec}초 (${choTime.byoyomiLeft}회 남음)`;
    timeChoByoEl.style.color = choTime.byoyomiLeft <= 1 ? '#FF3B30' : '';
  }

  // 현재 차례 표시
  panelHan.classList.toggle('active-turn', currentTurn === 'han');
  panelCho.classList.toggle('active-turn', currentTurn === 'cho');
}

/**
 * 초를 MM:SS 형식으로 포맷한다.
 * @param {number} totalSec
 * @returns {string}
 */
function formatTime(totalSec) {
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

// ── 장군 토스트 (AD §5-4) ──────────────────────────────────────

/**
 * 장군 토스트를 표시한다.
 */
export function showCheckToast() {
  // 기존 토스트 제거 후 재생성 (애니메이션 리트리거)
  const parent = checkToast.parentElement;
  const clone = checkToast.cloneNode(true);
  clone.hidden = false;
  parent.replaceChild(clone, checkToast);

  setTimeout(() => {
    clone.hidden = true;
  }, 1500);
}

// ── 게임 종료 모달 (AD §5-5) ────────────────────────────────────

/**
 * 종료 사유 코드를 한국어로 변환한다.
 * @param {string} reason
 * @returns {string}
 */
const REASON_TEXT = {
  checkmate: '외통수',
  resign: '기권',
  timeout: '시간패',
  repetition: '동형반복 3회 (점수제)',
  fifty_move: '50수 룰 (점수제)',
  draw_score: '합의 무승부 (점수제)',
};

/**
 * 게임 종료 모달을 표시한다.
 * @param {'han'|'cho'} winner
 * @param {string} reason
 * @param {{han:number, cho:number}|null} scores
 * @param {'han'|'cho'} mySide
 */
export function showGameOverModal(winner, reason, scores, mySide) {
  gameOverModal.hidden = false;
  setupModal.hidden = true;

  const isWinner = winner === mySide;
  gameOverTitle.textContent = isWinner ? '승리!' : '패배';
  gameOverTitle.style.color = isWinner ? '#2ecc71' : var_('--janggi-check-glow', '#FF3B30');

  gameOverReason.textContent = REASON_TEXT[reason] || reason;

  if (scores) {
    gameOverScores.hidden = false;
    scoreHanEl.textContent = `한 ${scores.han}점`;
    scoreChoEl.textContent = `초 ${scores.cho}점 (덤 1.5 포함)`;
  } else {
    gameOverScores.hidden = true;
  }
}

/**
 * CSS 변수값을 읽는다 (fallback 포함).
 * @param {string} name
 * @param {string} fallback
 * @returns {string}
 */
function var_(name, fallback) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/**
 * 게임 종료 모달을 닫는다.
 */
export function hideGameOverModal() {
  gameOverModal.hidden = true;
}

// ── 무승부 제안 모달 ────────────────────────────────────────────

/**
 * 무승부 제안 모달을 표시한다.
 * @param {function():void} onAccept
 * @param {function():void} onReject
 */
export function showDrawModal(onAccept, onReject) {
  drawModal.hidden = false;

  const acceptBtn = document.getElementById('btn-draw-accept');
  const rejectBtn = document.getElementById('btn-draw-reject');

  const cleanup = () => {
    drawModal.hidden = true;
    acceptBtn.removeEventListener('click', handleAccept);
    rejectBtn.removeEventListener('click', handleReject);
  };

  const handleAccept = () => { cleanup(); onAccept(); };
  const handleReject = () => { cleanup(); onReject(); };

  acceptBtn.addEventListener('click', handleAccept);
  rejectBtn.addEventListener('click', handleReject);
}

/**
 * 무승부 제안 모달을 닫는다.
 */
export function hideDrawModal() {
  drawModal.hidden = true;
}

// ── 일반 토스트 ─────────────────────────────────────────────────

/**
 * 일반 토스트 메시지를 표시한다.
 * @param {string} message
 * @param {number} [durationMs=2000]
 */
export function showToast(message, durationMs = 2000) {
  const parent = toastEl.parentElement;
  const clone = toastEl.cloneNode(true);
  clone.textContent = message;
  clone.hidden = false;
  parent.replaceChild(clone, toastEl);

  setTimeout(() => {
    clone.hidden = true;
  }, durationMs);
}

// ── you-tag 업데이트 ────────────────────────────────────────────

/**
 * 상단 you-tag를 업데이트한다.
 * @param {'han'|'cho'|null} side
 * @param {boolean} waiting
 */
export function updateYouTag(side, waiting) {
  const el = document.getElementById('you-tag');
  if (!el) return;

  if (waiting) {
    el.textContent = '상대 대기 중...';
  } else if (side) {
    el.textContent = side === 'han' ? '한(漢) 진영' : '초(楚) 진영';
    el.style.borderColor = side === 'han'
      ? 'var(--janggi-han-primary)' : 'var(--janggi-cho-primary)';
  }
}
