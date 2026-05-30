/**
 * @fileoverview 다빈치 코드 클라이언트.
 *
 * - WebSocket 자동 재연결 (backoff 1→2→4→8s)
 * - pagehide 시 즉시 close → 서버 좀비 슬롯 방지
 * - 서버 STATE 스냅샷을 받아 DOM 렌더링
 * - 상대 미공개 카드 클릭 → slot 선택 → 숫자 입력 → 추측
 */

(() => {
  'use strict';

  // ── DOM 참조 ─────────────────────────────────────────────────
  const youTagEl       = document.getElementById('you-tag');
  const deckCountEl    = document.getElementById('deck-count');
  const deckCountBigEl = document.getElementById('deck-count-big');
  const turnEl         = document.getElementById('turn-status');
  const oppCardsEl     = document.getElementById('opp-cards');
  const myCardsEl      = document.getElementById('my-cards');
  const pendingCardEl  = document.getElementById('pending-card');
  const lastGuessEl    = document.getElementById('last-guess');
  const actionDisplay  = document.getElementById('action-display');

  const guessPanel     = document.getElementById('guess-panel');
  const continuePanel  = document.getElementById('continue-panel');
  const selfRevealPanel= document.getElementById('self-reveal-panel');

  const selectedSlotEl = document.getElementById('selected-slot');
  const guessValueEl   = document.getElementById('guess-value');
  const btnGuess       = document.getElementById('btn-guess');
  const btnContinue    = document.getElementById('btn-continue');
  const btnStop        = document.getElementById('btn-stop');

  const btnRestart     = document.getElementById('btn-restart');
  const modalEl        = document.getElementById('modal');
  const modalTitle     = document.getElementById('modal-title');
  const modalMsg       = document.getElementById('modal-message');
  const btnNewGame     = document.getElementById('btn-new-game');
  const toastEl        = document.getElementById('toast');

  // ── 상태 ─────────────────────────────────────────────────────
  /** @type {WebSocket|null} */
  let ws = null;
  /** 'p1' | 'p2' | null */
  let me = null;
  /** 가장 최근 서버 스냅샷 */
  let lastState = null;
  /** 현재 선택된 상대 slot (추측 대상) */
  let selectedSlot = null;
  /** 자동 재연결 활성 여부 */
  let autoReconnect = true;
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  let toastTimer = null;

  // ── WebSocket 연결 ───────────────────────────────────────────
  /**
   * WebSocket 연결을 시작한다. 현재 페이지의 host:port를 그대로 사용.
   */
  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    // 통합 라우터(launcher) 환경에서는 /davinci-code/ 하위에서 호스팅되므로 WS path를 path prefix에 맞춰 구성한다.
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

  window.addEventListener('pagehide', () => {
    autoReconnect = false;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.close(1000, 'page hide'); } catch { /* noop */ }
    }
  });

  // ── 서버 메시지 라우터 ──────────────────────────────────────
  /**
   * 서버 메시지 라우터.
   * @param {object} msg
   */
  function handleMessage(msg) {
    switch (msg.type) {
      case 'JOINED':
        me = msg.playerId;
        youTagEl.textContent = `너는 ${me === 'p1' ? '플레이어 1 (선공)' : '플레이어 2 (후공)'}`;
        if (msg.waiting) {
          turnEl.textContent = '상대 대기 중';
          actionDisplay.textContent = '친구가 접속하기를 기다리는 중...';
        }
        break;
      case 'GAME_START':
        hideModal();
        selectedSlot = null;
        break;
      case 'STATE':
        lastState = msg;
        renderState(msg);
        break;
      case 'GAME_END': {
        const won = msg.winner === me;
        showModal(
          won ? '승리!' : '패배',
          won
            ? '상대의 모든 카드를 공개했다!'
            : '내 모든 카드가 공개됐다. 다음 판에 설욕하자.',
          won ? 'won' : 'lost',
        );
        break;
      }
      case 'OPPONENT_LEFT':
        showToast(msg.message || '상대방이 나갔다.');
        turnEl.textContent = '상대 대기 중';
        actionDisplay.textContent = '새 친구가 접속하기를 기다리는 중...';
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
    // 덱
    deckCountEl.textContent = String(s.deckCount);
    deckCountBigEl.textContent = String(s.deckCount);

    // 턴 / phase 텍스트
    const myTurn = s.turn === me;
    let turnText;
    if (s.phase === 'won') {
      turnText = s.winner === me ? '승리' : '패배';
    } else if (myTurn) {
      turnText = '내 턴';
    } else {
      turnText = '상대 턴';
    }
    turnEl.textContent = turnText;

    // 액션 디스플레이 + 패널 전환
    updateActionPanel(s);

    // pending drawn 카드
    renderPending(s.pendingDrawn);

    // 상대 손 렌더
    renderOppHand(s);

    // 자기 손 렌더
    renderMyHand(s);

    // last guess 표시
    renderLastGuess(s.lastGuess);
  }

  /**
   * 액션 패널의 표시 상태와 안내 텍스트를 phase에 맞춰 전환한다.
   * @param {object} s
   */
  function updateActionPanel(s) {
    guessPanel.classList.add('hidden');
    continuePanel.classList.add('hidden');
    selfRevealPanel.classList.add('hidden');

    if (s.phase === 'won') {
      actionDisplay.textContent = '게임 종료';
      return;
    }

    const myTurn = s.turn === me;
    if (!myTurn) {
      actionDisplay.textContent = '상대 차례 — 기다리는 중';
      return;
    }

    switch (s.phase) {
      case 'awaiting_guess':
        if (s.pendingDrawn) {
          actionDisplay.textContent = '덱에서 1장을 뽑았다. 상대 카드를 선택하고 숫자를 추측해라.';
        } else {
          actionDisplay.textContent = '덱이 비었다. 카드를 뽑지 않고 추측만 진행한다.';
        }
        guessPanel.classList.remove('hidden');
        break;
      case 'awaiting_continue_decision':
        actionDisplay.textContent = '정답! 계속 추측할지 멈출지 선택해라.';
        continuePanel.classList.remove('hidden');
        break;
      case 'awaiting_self_reveal':
        actionDisplay.textContent = '추측 실패 + 덱 비어있음 → 자기 카드 중 하나를 골라 공개해야 한다.';
        selfRevealPanel.classList.remove('hidden');
        break;
      default:
        actionDisplay.textContent = '';
    }

    // 선택된 슬롯 표시
    selectedSlotEl.textContent = selectedSlot === null ? '없음' : `${selectedSlot + 1}번째`;
  }

  /**
   * pendingDrawn 카드 렌더링.
   * @param {object|null} p - { color, value } 또는 null. value가 null이면 색깔만 보임.
   */
  function renderPending(p) {
    pendingCardEl.className = 'pending-card';
    if (!p) {
      pendingCardEl.textContent = '없음';
      pendingCardEl.classList.add('empty');
      return;
    }
    pendingCardEl.classList.add(p.color);
    if (p.value === null || p.value === undefined) {
      pendingCardEl.textContent = '?';
      pendingCardEl.classList.add('hidden-value');
    } else {
      pendingCardEl.textContent = String(p.value);
    }
  }

  /**
   * 상대 손 카드 렌더링.
   * @param {object} s
   */
  function renderOppHand(s) {
    oppCardsEl.innerHTML = '';
    const myTurn = s.turn === me;
    const canSelect = myTurn && s.phase === 'awaiting_guess';

    s.oppHand.forEach((card, idx) => {
      const el = document.createElement('div');
      el.className = `card ${card.color}`;
      if (card.revealed) {
        el.classList.add('revealed');
        el.textContent = String(card.value);
      } else {
        el.classList.add('hidden-value');
        el.textContent = '?';
        if (canSelect) {
          el.classList.add('clickable');
          if (selectedSlot === idx) el.classList.add('selected');
          el.addEventListener('click', () => onOppCardClick(idx));
        }
      }
      oppCardsEl.appendChild(el);
    });
  }

  /**
   * 자기 손 카드 렌더링.
   * @param {object} s
   */
  function renderMyHand(s) {
    myCardsEl.innerHTML = '';
    const myTurn = s.turn === me;
    const canSelfReveal = myTurn && s.phase === 'awaiting_self_reveal';

    s.yourHand.forEach((card, idx) => {
      const el = document.createElement('div');
      el.className = `card ${card.color}`;
      el.textContent = String(card.value);
      if (card.revealed) {
        el.classList.add('revealed');
      } else if (canSelfReveal) {
        el.classList.add('clickable');
        el.title = '클릭해서 공개';
        el.addEventListener('click', () => onSelfRevealClick(idx));
      }
      myCardsEl.appendChild(el);
    });
  }

  /**
   * 마지막 추측 결과 표시.
   * @param {object|null} lg
   */
  function renderLastGuess(lg) {
    if (!lg) {
      lastGuessEl.textContent = '';
      lastGuessEl.className = 'last-guess';
      return;
    }
    const who = lg.from === me ? '나' : '상대';
    const slotLabel = `${lg.slot + 1}번째`;
    if (lg.correct) {
      lastGuessEl.textContent = `${who}: ${slotLabel} → "${lg.value}" 정답!`;
      lastGuessEl.className = 'last-guess correct';
    } else {
      lastGuessEl.textContent = `${who}: ${slotLabel} → "${lg.value}" 오답`;
      lastGuessEl.className = 'last-guess wrong';
    }
  }

  // ── 입력 핸들러 ─────────────────────────────────────────────
  /**
   * 상대 카드 클릭 (slot 선택).
   * @param {number} idx
   */
  function onOppCardClick(idx) {
    if (!lastState || lastState.phase !== 'awaiting_guess') return;
    if (lastState.turn !== me) return;
    selectedSlot = idx;
    renderState(lastState); // 하이라이트 재렌더
  }

  /**
   * 자기 카드 클릭 (자기 카드 공개 단계).
   * @param {number} idx
   */
  function onSelfRevealClick(idx) {
    if (!ws || ws.readyState !== 1) return;
    if (!lastState || lastState.phase !== 'awaiting_self_reveal') return;
    if (lastState.turn !== me) return;
    const card = lastState.yourHand[idx];
    if (card.revealed) {
      showToast('이미 공개된 카드는 선택할 수 없다');
      return;
    }
    if (!confirm(`${card.color === 'black' ? '검정' : '흰색'} ${card.value} 카드를 공개하겠는가?`)) return;
    ws.send(JSON.stringify({ type: 'SELF_REVEAL', slot: idx }));
  }

  // 추측 버튼
  btnGuess.addEventListener('click', () => {
    if (!ws || ws.readyState !== 1) return;
    if (selectedSlot === null) { showToast('상대 카드를 먼저 선택해라'); return; }
    const value = parseInt(guessValueEl.value, 10);
    if (!Number.isInteger(value) || value < 0 || value > 11) {
      showToast('숫자는 0~11 사이');
      return;
    }
    ws.send(JSON.stringify({ type: 'GUESS', slot: selectedSlot, value }));
    selectedSlot = null;
    guessValueEl.value = '';
  });

  // 엔터키로 추측 전송
  guessValueEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') btnGuess.click();
  });

  // 계속/멈춤 버튼
  btnContinue.addEventListener('click', () => {
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ type: 'CONTINUE', decision: 'continue' }));
  });
  btnStop.addEventListener('click', () => {
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ type: 'CONTINUE', decision: 'stop' }));
  });

  // 새 게임
  btnNewGame.addEventListener('click', () => {
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ type: 'NEW_GAME' }));
  });
  btnRestart.addEventListener('click', () => {
    if (!ws || ws.readyState !== 1) return;
    if (lastState && lastState.phase !== 'won') {
      if (!confirm('진행 중인 게임을 종료하고 새 게임을 시작하겠는가?')) return;
    }
    ws.send(JSON.stringify({ type: 'NEW_GAME' }));
  });

  // "← 다른 종목" 버튼 핸들러 — 로비로 복귀
  const returnLobbyBtn = document.getElementById('btn-return-lobby');
  if (returnLobbyBtn) {
    returnLobbyBtn.addEventListener('click', () => {
      fetch('/lobby/return', { method: 'POST' }).catch(() => {});
      location.href = '/';
    });
  }

  // ── 모달/토스트 ─────────────────────────────────────────────
  /**
   * 결과 모달 표시.
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
   * 토스트 알림 (3초).
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

  // ── 시작 ────────────────────────────────────────────────────
  connect();
})();
