/**
 * @fileoverview DOM 렌더링 — HP바, 게이지바, 체인 이력, 타이머, 가비지 알림.
 *
 * 모든 DOM 조작은 이 모듈에 집중한다.
 */

// ── DOM 요소 캐시 ───────────────────────────────────────────

const $ = (sel) => document.querySelector(sel);

const el = {
  waitingScreen: $('#waiting-screen'),
  gameScreen: $('#game-screen'),
  waitingMsg: $('#waiting-msg'),

  nameMe: $('#name-me'),
  nameOpp: $('#name-opp'),
  hpMe: $('#hp-me'),
  hpOpp: $('#hp-opp'),
  hpTextMe: $('#hp-text-me'),
  hpTextOpp: $('#hp-text-opp'),
  gaugeMe: $('#gauge-me'),
  gaugeOpp: $('#gauge-opp'),
  gaugeTextMe: $('#gauge-text-me'),
  gaugeTextOpp: $('#gauge-text-opp'),

  chainMe: $('#chain-me'),
  chainOpp: $('#chain-opp'),

  startChar: $('#start-char'),
  timerText: $('#timer-text'),
  timerDisplay: null, // 부모 .timer-display
  wordInput: $('#word-input'),
  submitBtn: $('#submit-btn'),
  feedback: $('#feedback'),

  garbagePopup: $('#garbage-popup'),
  attackPopup: $('#attack-popup'),
  countdownOverlay: $('#countdown-overlay'),
  countdownNum: $('#countdown-num'),

  resultModal: $('#result-modal'),
  resultTitle: $('#result-title'),
  resultDetail: $('#result-detail'),
  rematchBtn: $('#rematch-btn'),
  rematchStatus: $('#rematch-status'),
};

// 타이머 display 부모 요소 찾기
el.timerDisplay = el.timerText ? el.timerText.parentElement : null;

// ── 화면 전환 ───────────────────────────────────────────────

/**
 * 대기 화면을 표시한다.
 */
export function showWaiting() {
  el.waitingScreen.classList.add('active');
  el.gameScreen.classList.remove('active');
}

/**
 * 게임 화면을 표시한다.
 */
export function showGame() {
  el.waitingScreen.classList.remove('active');
  el.gameScreen.classList.add('active');
}

// ── HP 바 업데이트 ──────────────────────────────────────────

/**
 * HP 바를 업데이트한다.
 * @param {'me'|'opp'} who
 * @param {number} hp
 * @param {boolean} [animate=false] 피격 애니메이션
 */
export function updateHp(who, hp, animate = false) {
  const bar = who === 'me' ? el.hpMe : el.hpOpp;
  const text = who === 'me' ? el.hpTextMe : el.hpTextOpp;
  if (!bar || !text) return;

  bar.style.width = `${hp}%`;
  text.textContent = hp;

  // 30 이하 빨간색
  if (hp <= 30) {
    bar.classList.add('low');
  } else {
    bar.classList.remove('low');
  }

  // 피격 애니메이션
  if (animate) {
    bar.classList.remove('hit');
    void bar.offsetWidth; // reflow 강제
    bar.classList.add('hit');
  }
}

// ── 게이지 바 업데이트 ──────────────────────────────────────

/**
 * 게이지 바를 업데이트한다.
 * @param {'me'|'opp'} who
 * @param {number} gauge 0~100
 * @param {boolean} [flash=false] 100 도달 플래시
 */
export function updateGauge(who, gauge, flash = false) {
  const bar = who === 'me' ? el.gaugeMe : el.gaugeOpp;
  const text = who === 'me' ? el.gaugeTextMe : el.gaugeTextOpp;
  if (!bar || !text) return;

  bar.style.width = `${gauge}%`;
  text.textContent = `${gauge}%`;

  if (flash) {
    bar.classList.remove('full');
    void bar.offsetWidth;
    bar.classList.add('full');
  }
}

// ── 플레이어 이름 ───────────────────────────────────────────

/**
 * 플레이어 이름을 설정한다.
 * @param {'me'|'opp'} who
 * @param {string} name
 */
export function setName(who, name) {
  const el_ = who === 'me' ? el.nameMe : el.nameOpp;
  if (el_) el_.textContent = name;
}

// ── 체인 이력 ───────────────────────────────────────────────

/**
 * 체인 이력에 단어를 추가한다. 최대 5개 유지.
 * @param {'me'|'opp'} who
 * @param {string} word
 * @param {boolean} [isGarbage=false] 가비지 음절로 시작한 단어인지
 */
export function addChainWord(who, word, isGarbage = false) {
  const list = who === 'me' ? el.chainMe : el.chainOpp;
  if (!list) return;

  const li = document.createElement('li');
  li.textContent = word;
  if (isGarbage) li.classList.add('garbage-word');

  // 최상단에 추가
  list.prepend(li);

  // 5개 초과 시 마지막 제거
  while (list.children.length > 5) {
    list.removeChild(list.lastChild);
  }
}

/**
 * 체인 이력을 초기화한다.
 */
export function clearChains() {
  if (el.chainMe) el.chainMe.innerHTML = '';
  if (el.chainOpp) el.chainOpp.innerHTML = '';
}

// ── 시작 글자 표시 ──────────────────────────────────────────

/**
 * 시작 글자 표시를 업데이트한다.
 * @param {string|null} char 시작 글자 (null이면 '자유')
 * @param {boolean} [isForced=false] 가비지 강제 여부
 */
export function setStartChar(char, isForced = false) {
  if (!el.startChar) return;
  if (!char) {
    el.startChar.textContent = '자유';
    el.startChar.classList.remove('forced');
  } else {
    el.startChar.textContent = isForced ? `☄ ${char}` : char;
    if (isForced) {
      el.startChar.classList.add('forced');
    } else {
      el.startChar.classList.remove('forced');
    }
  }
}

// ── 타이머 ──────────────────────────────────────────────────

/**
 * 타이머 텍스트를 업데이트한다.
 * @param {number} remaining 남은 초
 */
export function updateTimer(remaining) {
  if (!el.timerText) return;
  el.timerText.textContent = remaining;

  if (remaining <= 5) {
    if (el.timerDisplay) el.timerDisplay.classList.add('urgent');
  } else {
    if (el.timerDisplay) el.timerDisplay.classList.remove('urgent');
  }
}

// ── 입력 제어 ───────────────────────────────────────────────

/**
 * 입력창을 활성화/비활성화한다.
 * @param {boolean} enabled
 */
export function setInputEnabled(enabled) {
  if (el.wordInput) {
    el.wordInput.disabled = !enabled;
    if (enabled) el.wordInput.focus();
  }
  if (el.submitBtn) el.submitBtn.disabled = !enabled;
}

/**
 * 입력창 값을 초기화한다.
 */
export function clearInput() {
  if (el.wordInput) el.wordInput.value = '';
}

/**
 * 입력창에 에러 표시를 한다.
 */
export function showInputError() {
  if (!el.wordInput) return;
  el.wordInput.classList.remove('error');
  void el.wordInput.offsetWidth;
  el.wordInput.classList.add('error');
  setTimeout(() => el.wordInput.classList.remove('error'), 600);
}

/**
 * 피드백 메시지를 표시한다.
 * @param {string} msg 메시지 (비어있으면 숨김)
 * @param {number} [duration=2000] 표시 시간 (ms)
 */
export function showFeedback(msg, duration = 2000) {
  if (!el.feedback) return;
  el.feedback.textContent = msg;
  if (msg && duration > 0) {
    setTimeout(() => {
      if (el.feedback.textContent === msg) {
        el.feedback.textContent = '';
      }
    }, duration);
  }
}

// ── 가비지 팝업 ─────────────────────────────────────────────

/**
 * 가비지 알림 팝업을 표시한다.
 * @param {string} char 가비지 음절
 */
export function showGarbagePopup(char) {
  if (!el.garbagePopup) return;
  el.garbagePopup.textContent = `☄ 상대가 가비지 음절 "${char}"을 보냈습니다!`;
  el.garbagePopup.classList.remove('hidden');
  setTimeout(() => {
    el.garbagePopup.classList.add('hidden');
  }, 3000);
}

/**
 * 공격 성공 알림 팝업을 표시한다. (내가 게이지를 채워 상대에게 가비지를 보냈을 때)
 * @param {string} char 상대에게 강제된 가비지 음절
 */
export function showAttackPopup(char) {
  if (!el.attackPopup) return;
  el.attackPopup.textContent = `⚔ 상대에게 가비지 음절 "${char}"을 보냈습니다!`;
  el.attackPopup.classList.remove('hidden');
  setTimeout(() => {
    el.attackPopup.classList.add('hidden');
  }, 3000);
}

// ── 카운트다운 ──────────────────────────────────────────────

/**
 * 카운트다운 오버레이를 표시한다.
 * @param {number} seconds 카운트다운 초
 * @returns {Promise<void>}
 */
export function showCountdown(seconds) {
  return new Promise((resolve) => {
    if (!el.countdownOverlay || !el.countdownNum) {
      resolve();
      return;
    }

    el.countdownOverlay.classList.remove('hidden');
    let count = seconds;
    el.countdownNum.textContent = count;

    const interval = setInterval(() => {
      count--;
      if (count <= 0) {
        clearInterval(interval);
        el.countdownNum.textContent = '시작!';
        setTimeout(() => {
          el.countdownOverlay.classList.add('hidden');
          resolve();
        }, 500);
      } else {
        el.countdownNum.textContent = count;
      }
    }, 1000);
  });
}

/**
 * 서버의 PLAYING 전이에 맞춰 카운트다운 오버레이를 즉시 숨긴다.
 */
export function hideCountdown() {
  if (el.countdownOverlay) el.countdownOverlay.classList.add('hidden');
}

// ── 결과 모달 ───────────────────────────────────────────────

/**
 * 결과 모달을 표시한다.
 * @param {string} title 제목
 * @param {string} detail 상세
 */
export function showResult(title, detail) {
  if (!el.resultModal) return;
  el.resultTitle.textContent = title;
  el.resultDetail.textContent = detail;
  el.rematchStatus.textContent = '';
  el.resultModal.classList.remove('hidden');
}

/**
 * 결과 모달을 숨긴다.
 */
export function hideResult() {
  if (el.resultModal) el.resultModal.classList.add('hidden');
}

/**
 * 리매치 상태를 업데이트한다.
 * @param {string} text 상태 텍스트
 */
export function setRematchStatus(text) {
  if (el.rematchStatus) el.rematchStatus.textContent = text;
}

// ── 전체 초기화 ─────────────────────────────────────────────

/**
 * 게임 UI를 초기 상태로 리셋한다.
 */
export function resetGameUI() {
  updateHp('me', 100);
  updateHp('opp', 100);
  updateGauge('me', 0);
  updateGauge('opp', 0);
  clearChains();
  setStartChar(null);
  updateTimer(20);
  clearInput();
  showFeedback('');
  hideResult();
}

/**
 * 현재 HP 값은 유지하고 피격 애니메이션만 재생한다.
 * @param {'me'|'opp'} who
 */
export function animateHpHit(who) {
  const bar = who === 'me' ? el.hpMe : el.hpOpp;
  if (!bar) return;
  bar.classList.remove('hit');
  void bar.offsetWidth;
  bar.classList.add('hit');
}

/**
 * 리매치 버튼에 클릭 핸들러를 등록한다.
 * @param {Function} handler
 */
export function onRematchClick(handler) {
  if (el.rematchBtn) el.rematchBtn.addEventListener('click', handler);
}

/**
 * 제출 버튼에 클릭 핸들러를 등록한다.
 * @param {Function} handler
 */
export function onSubmitClick(handler) {
  if (el.submitBtn) el.submitBtn.addEventListener('click', handler);
}

/**
 * 입력창에 Enter 키 핸들러를 등록한다.
 * @param {Function} handler
 */
export function onInputEnter(handler) {
  if (el.wordInput) {
    el.wordInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handler();
    });
  }
}

/**
 * 입력창의 현재 값을 반환한다.
 * @returns {string}
 */
export function getInputValue() {
  return el.wordInput ? el.wordInput.value.trim() : '';
}
