/**
 * @fileoverview 코드네임 듀엣 클라이언트.
 *
 * - WebSocket으로 서버에 연결 후 상태 스냅샷을 받아 DOM 렌더링
 * - 클릭(추측) / 단서 전송 / 패스 / 새 게임 입력 처리
 * - 서버가 모든 게임 규칙을 권위적으로 처리하므로 클라는 단순 표시 + 입력만 담당
 */

(() => {
  'use strict';

  // ── DOM 참조 ─────────────────────────────────────────────────
  const boardEl     = document.getElementById('board');
  const youTagEl    = document.getElementById('you-tag');
  const tokensEl    = document.getElementById('tokens');
  const myGreenEl   = document.getElementById('my-green');
  const opGreenEl   = document.getElementById('op-green');
  const turnEl      = document.getElementById('turn-status');
  const clueDisplay = document.getElementById('clue-display');
  const clueWordEl  = document.getElementById('clue-word');
  const clueNumEl   = document.getElementById('clue-number');
  const btnClue     = document.getElementById('btn-clue');
  const btnPass     = document.getElementById('btn-pass');
  const modalEl     = document.getElementById('modal');
  const modalTitle  = document.getElementById('modal-title');
  const modalMsg    = document.getElementById('modal-message');
  const btnNewGame  = document.getElementById('btn-new-game');
  const nextTokensEl = document.getElementById('next-tokens');
  const btnRestart   = document.getElementById('btn-restart');
  const toastEl     = document.getElementById('toast');

  // ── 상태 ─────────────────────────────────────────────────────
  /** @type {WebSocket|null} */
  let ws = null;
  /** 'p1' | 'p2' | null */
  let me = null;
  /** 가장 최근 서버 스냅샷 */
  let lastState = null;
  /** 현재 화면에 그려진 카드 DOM (인덱스 = 카드 위치) */
  const cardEls = new Array(25);
  let toastTimer = null;
  /** 자동 재연결 활성 여부 (페이지 닫기 시 false로 전환) */
  let autoReconnect = true;
  /** 재연결 타이머 핸들 (중복 예약 방지) */
  let reconnectTimer = null;
  /** 재연결 시도 횟수 (backoff용) */
  let reconnectAttempts = 0;

  // ── 초기 보드 그리기 ─────────────────────────────────────────
  /**
   * 25칸 빈 카드 DOM을 한 번만 만들어둔다. 이후 update 함수가 클래스/텍스트만 갱신.
   */
  function initBoard() {
    boardEl.innerHTML = '';
    for (let i = 0; i < 25; i++) {
      const card = document.createElement('div');
      card.className = 'card';
      card.dataset.index = String(i);
      const indicator = document.createElement('div');
      indicator.className = 'my-indicator';
      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = '';
      card.appendChild(indicator);
      card.appendChild(label);
      card.addEventListener('click', () => onCardClick(i));
      boardEl.appendChild(card);
      cardEls[i] = card;
    }
  }

  // ── WebSocket 연결 ───────────────────────────────────────────
  /**
   * WebSocket을 연결한다. 현재 페이지의 host:port를 그대로 사용.
   */
  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    // 통합 라우터(launcher) 환경에서는 /codenames-duet/ 하위에서 호스팅되므로 WS path를 path prefix에 맞춰 구성한다.
    // standalone 실행 시에는 pathname이 '/' 이므로 prefix 없이 '/ws'로 연결한다.
    const seg = location.pathname.split('/').filter(Boolean)[0] || '';
    const wsPath = seg ? `/${seg}/ws` : '/ws';
    ws = new WebSocket(`${proto}://${location.host}${wsPath}`);
    ws.addEventListener('open', () => {
      console.log('[client] 연결됨');
      reconnectAttempts = 0;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    });
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      handleMessage(msg);
    });
    ws.addEventListener('close', () => {
      console.log('[client] 연결 종료');
      if (!autoReconnect) return;
      // backoff: 1s → 2s → 4s → 최대 8s
      const delay = Math.min(8000, 1000 * Math.pow(2, reconnectAttempts));
      reconnectAttempts += 1;
      showToast(`연결이 끊겼다. ${Math.round(delay/1000)}초 후 자동 재접속 시도...`);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, delay);
    });
    ws.addEventListener('error', (err) => {
      console.error('[client] WS 에러', err);
    });
  }

  // 페이지 닫기/새로고침 시 서버에 즉시 close 통보 → 좀비 슬롯 방지
  window.addEventListener('pagehide', () => {
    autoReconnect = false; // 의도적 종료이므로 재연결 시도 안 함
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.close(1000, 'page hide'); } catch { /* noop */ }
    }
  });

  /**
   * 서버 메시지 라우터.
   * @param {object} msg
   */
  function handleMessage(msg) {
    switch (msg.type) {
      case 'JOINED':
        me = msg.playerId;
        youTagEl.textContent = `너는 ${me === 'p1' ? '플레이어 1 (호스트)' : '플레이어 2 (게스트)'}`;
        if (msg.waiting) {
          turnEl.textContent = '상대 대기 중';
          clueDisplay.textContent = '친구가 접속하기를 기다리는 중...';
        }
        break;
      case 'GAME_START':
        hideModal();
        turnEl.textContent = '게임 시작!';
        break;
      case 'STATE':
        lastState = msg;
        renderState(msg);
        break;
      case 'GAME_END':
        if (msg.outcome === 'won') {
          showModal('승리!', '양 시점 그린 카드 9개씩을 모두 발견했다. 완벽한 호흡!', 'won');
        } else {
          const reason = msg.reason === 'assassin'
            ? '암살자 카드를 눌렀다. 임무 실패.'
            : '미션 토큰이 다 떨어졌다. 다음엔 더 신중하게.';
          showModal('패배', reason, 'lost');
        }
        break;
      case 'OPPONENT_LEFT':
        showToast(msg.message || '상대방이 나갔다.');
        turnEl.textContent = '상대 대기 중';
        clueDisplay.textContent = '새 친구가 접속하기를 기다리는 중...';
        hideModal();
        break;
      case 'ERROR':
        showToast(msg.message || '알 수 없는 오류');
        break;
      default:
        console.warn('[client] 알 수 없는 메시지:', msg);
    }
  }

  // ── 렌더링 ──────────────────────────────────────────────────
  /**
   * 서버에서 받은 STATE 스냅샷을 화면에 반영한다.
   * @param {object} s
   */
  function renderState(s) {
    // 상단 통계
    tokensEl.textContent = String(s.tokens);
    // greenFound: 단서를 준 사람의 시점에서 발견된 green 카운트
    // → "내 시점 그린"이라는 표시는 "상대가 단서를 줘서 내가 찾은 green"의 합 = greenFound[opponent]
    // 잠깐 — 정리하면:
    //   greenFound[p1]은 "p1이 단서를 줬을 때 발견된 green" = "p2가 클릭해서 맞춘 카드 중 p1 시점에서 green인 것"
    //                                                    = p1의 키 카드 그린 발견 진행도
    // 즉 greenFound[me]는 "나의 키 카드 그린이 얼마나 발견됐는지" = "내 시점 그린 진행도"가 맞다.
    const myKey = me;
    const opKey = me === 'p1' ? 'p2' : 'p1';
    myGreenEl.textContent = `${s.greenFound[myKey]} / 9`;
    opGreenEl.textContent = `${s.greenFound[opKey]} / 9`;

    // 턴 상태 텍스트
    let turnText = '';
    if (s.phase !== 'playing') {
      turnText = s.phase === 'won' ? '승리' : '패배';
    } else if (s.guessingPlayer === null) {
      turnText = s.turn === me ? '단서 입력 차례' : '상대가 단서 입력 중';
    } else {
      turnText = s.guessingPlayer === me ? '추측 차례' : '상대가 추측 중';
    }
    turnEl.textContent = turnText;

    // 단서 디스플레이
    if (s.currentClue) {
      const giver = s.currentClue.from === me ? '내' : '상대';
      clueDisplay.textContent = `${giver} 단서: "${s.currentClue.word}" ${s.currentClue.number}  (남은 추측: ${s.guessesLeft})`;
    } else if (s.phase === 'playing') {
      clueDisplay.textContent = s.turn === me
        ? '단서를 입력해라 (단어 + 숫자 1~9)'
        : '상대의 단서를 기다리는 중...';
    } else {
      clueDisplay.textContent = '게임 종료';
    }

    // 카드 렌더링
    for (let i = 0; i < 25; i++) {
      const card = cardEls[i];
      const word = s.words[i] || '';
      const myColor = s.myKey[i]; // 자기 시점 색상 (모서리 점)
      const revealed = s.revealed[i]; // null이면 미공개, 아니면 단서 준 사람 시점 색상

      const label = card.querySelector('.label');
      label.textContent = word;

      const indicator = card.querySelector('.my-indicator');
      indicator.className = `my-indicator ${myColor}`;

      // 클래스 초기화
      card.classList.remove('revealed', 'green', 'neutral', 'assassin', 'guessable', 'disabled');

      if (revealed) {
        card.classList.add('revealed', revealed);
        // 공개된 카드 위의 자기 시점 점은 숨김 (이미 색상이 결정됐으므로)
        indicator.style.display = 'none';
      } else {
        indicator.style.display = '';
        // 추측 가능 상태(내가 추측자이고 추측 횟수 남음)일 때 하이라이트
        if (s.phase === 'playing' && s.guessingPlayer === me && s.guessesLeft > 0) {
          card.classList.add('guessable');
        } else {
          card.classList.add('disabled');
        }
      }
    }

    // 단서 입력 패널 상태
    const canSubmitClue = s.phase === 'playing' && s.turn === me && s.guessingPlayer === null;
    clueWordEl.disabled = !canSubmitClue;
    clueNumEl.disabled = !canSubmitClue;
    btnClue.disabled = !canSubmitClue;

    // 패스 버튼: 내가 추측자이고 진행 중일 때만 활성화
    const canPass = s.phase === 'playing' && s.guessingPlayer === me;
    btnPass.disabled = !canPass;
  }

  // ── 입력 처리 ───────────────────────────────────────────────
  /**
   * 카드 클릭 핸들러.
   * @param {number} index
   */
  function onCardClick(index) {
    if (!ws || ws.readyState !== 1) return;
    if (!lastState) return;
    if (lastState.phase !== 'playing') return;
    if (lastState.guessingPlayer !== me) {
      showToast('지금은 너의 추측 차례가 아니다.');
      return;
    }
    if (lastState.revealed[index] !== null) return;
    ws.send(JSON.stringify({ type: 'GUESS', index }));
  }

  btnClue.addEventListener('click', () => {
    if (!ws || ws.readyState !== 1) return;
    const word = clueWordEl.value.trim();
    const number = parseInt(clueNumEl.value, 10);
    if (!word) { showToast('단서 단어를 입력해라'); return; }
    if (!Number.isInteger(number) || number < 1 || number > 9) {
      showToast('단서 숫자는 1~9');
      return;
    }
    ws.send(JSON.stringify({ type: 'CLUE', word, number }));
    clueWordEl.value = '';
  });

  btnPass.addEventListener('click', () => {
    if (!ws || ws.readyState !== 1) return;
    if (!confirm('정말 패스하겠는가? 미션 토큰 1개를 소비한다.')) return;
    ws.send(JSON.stringify({ type: 'PASS' }));
  });

  /**
   * 헤더의 토큰 입력값을 읽어 1~15로 클램프해 반환한다.
   * @returns {number}
   */
  function readNextTokens() {
    const v = parseInt(nextTokensEl.value, 10);
    if (!Number.isInteger(v)) return 9;
    return Math.max(1, Math.min(15, v));
  }

  btnNewGame.addEventListener('click', () => {
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ type: 'NEW_GAME', tokens: readNextTokens() }));
  });

  // 헤더의 "새 게임" 버튼 — 게임 진행 중에도 토큰 수 바꿔서 즉시 새 게임 시작
  btnRestart.addEventListener('click', () => {
    if (!ws || ws.readyState !== 1) return;
    if (lastState && lastState.phase === 'playing') {
      if (!confirm('진행 중인 게임을 종료하고 새 게임을 시작하겠는가?')) return;
    }
    ws.send(JSON.stringify({ type: 'NEW_GAME', tokens: readNextTokens() }));
  });

  // "← 다른 종목" 버튼 핸들러 — 로비로 복귀
  const returnLobbyBtn = document.getElementById('btn-return-lobby');
  if (returnLobbyBtn) {
    returnLobbyBtn.addEventListener('click', () => {
      fetch('/lobby/return', { method: 'POST' }).catch(() => {});
      location.href = '/';
    });
  }

  // 엔터키로 단서 전송 편의
  clueWordEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') btnClue.click();
  });
  clueNumEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') btnClue.click();
  });

  // ── 모달/토스트 ─────────────────────────────────────────────
  /**
   * 결과 모달을 표시한다.
   * @param {string} title
   * @param {string} message
   * @param {'won'|'lost'} kind
   */
  function showModal(title, message, kind) {
    modalEl.classList.remove('hidden', 'won', 'lost');
    modalEl.classList.add(kind);
    modalTitle.textContent = title;
    modalMsg.textContent = message;
  }

  function hideModal() {
    modalEl.classList.add('hidden');
    modalEl.classList.remove('won', 'lost');
  }

  /**
   * 화면 하단에 토스트 알림을 띄운다 (3초).
   * @param {string} text
   */
  function showToast(text) {
    toastEl.textContent = text;
    toastEl.classList.remove('hidden');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.add('hidden');
    }, 3000);
  }

  // ── 부트스트랩 ──────────────────────────────────────────────
  initBoard();
  connect();
})();
