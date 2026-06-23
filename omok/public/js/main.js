/**
 * @fileoverview 오목 클라이언트 진입점 — 모듈 조율.
 *
 * 흐름:
 *  1) DOM 준비 → Network 연결(JOINED 자동 수신, READY 단계 없음 — janggi 패턴)
 *  2) JOINED(waiting) → 대기 화면 + 초대 URL + "AI랑 시작" 버튼(p1 단독 시)
 *  3) GAME_START → 게임 화면, 보드 렌더
 *  4) STATE → 보드 갱신 + 내 턴 여부에 따라 클릭 활성/비활성
 *  5) 보드 클릭 → canvasToCell → sendPlace(row, col)
 *  6) GAME_OVER → 종료 오버레이(승/패/무 + winLine 하이라이트)
 *  7) 기권 / 재대결 / 다른 종목 버튼
 */

import { createNetwork } from './network.js';
import { render, canvasToCell } from './board.js';

document.addEventListener('DOMContentLoaded', () => {
  // ── DOM 참조 ────────────────────────────────────────────────
  const els = {
    screenWaiting: document.getElementById('screen-waiting'),
    screenGame: document.getElementById('screen-game'),
    screenGameOver: document.getElementById('screen-game-over'),
    playerLabel: document.getElementById('player-label'),
    statusMsg: document.getElementById('status-msg'),
    turnIndicator: document.getElementById('turn-indicator'),
    moveCount: document.getElementById('move-count'),

    // 대기 화면 — 신규 READY 게이트 UI
    waitingTitle: document.querySelector('#screen-waiting .waiting-title'),
    waitingSolo: document.getElementById('waiting-solo'),
    btnStartAi: document.getElementById('btn-start-ai'),
    opponentInfo: document.getElementById('opponent-info'),
    opponentNameLabel: document.getElementById('opponent-name-label'),
    readyPanel: document.getElementById('ready-panel'),
    myReadyMark: document.getElementById('my-ready-mark'),
    oppReadyMark: document.getElementById('opp-ready-mark'),
    btnReady: document.getElementById('btn-ready'),
    // 직접 진입 인라인 닉네임 게이트
    nameGateInline: document.getElementById('name-gate-inline'),
    inlineNameInput: document.getElementById('inline-name-input'),
    btnInlineEnter: document.getElementById('btn-inline-enter'),
    // 상대 이탈 배너
    opponentLeftBanner: document.getElementById('opponent-left-banner'),
    opponentLeftMsg: document.getElementById('opponent-left-msg'),
    btnBannerReturnLobby: document.getElementById('btn-banner-return-lobby'),

    canvas: document.getElementById('board-canvas'),
    btnResign: document.getElementById('btn-resign'),

    resultOutcome: document.getElementById('result-outcome'),
    resultDetail: document.getElementById('result-detail'),
    rematchBtn: document.getElementById('rematch-btn'),
    returnLobbyBtn: document.getElementById('btn-return-lobby'),
    backToLobbyBtn: document.getElementById('btn-back-to-lobby'),

    toast: document.getElementById('toast'),
  };

  // ── 상태 ────────────────────────────────────────────────────
  let myId = null;
  let myColor = null;
  let lastState = null;
  // 마지막 착수 좌표 (빨간 점 표시용). moveCount 변화 시 board diff로 추정.
  let lastMove = null;
  let prevBoard = null;
  /** 내가 리매치("한 판 더") 버튼을 눌렀는가(중복 클릭 방지). */
  let rematchRequested = false;
  /** 상대 닉네임(JOINED.opponentName 수신 시 갱신). */
  let opponentName = null;
  /** 내 READY 상태. */
  let myReady = false;
  /** 상대 READY 상태. */
  let opponentReady = false;

  /**
   * 현재 모드(ai|human)를 URL/sessionStorage에서 읽는다.
   * @returns {string}
   */
  function getCurrentMode() {
    return new URLSearchParams(location.search).get('mode')
      || sessionStorage.getItem('omok:mode')
      || 'human';
  }

  /**
   * "🤖 AI랑 시작" 버튼(혼자 대기 패널)을 숨긴다.
   * 친구가 합류해 2인이 되면 호출(사람 대전 흐름 전환).
   */
  function hideAiButton() {
    if (els.waitingSolo) els.waitingSolo.classList.add('hidden');
    if (els.btnStartAi) els.btnStartAi.classList.add('hidden');
  }

  /**
   * 혼자 대기 패널을 다시 표시한다(상대 이탈 시 — AI 모드가 아니고 사람일 때만).
   */
  function showAiButton() {
    if (getCurrentMode() === 'ai') return;
    // 다시 1인 대기로 돌아가므로 제목도 "상대방을 기다리는 중..."으로 복귀(WARN-3).
    updateWaitingTitle(false);
    if (els.waitingSolo) els.waitingSolo.classList.remove('hidden');
    if (els.btnStartAi) {
      els.btnStartAi.classList.remove('hidden');
      els.btnStartAi.disabled = false;
      els.btnStartAi.textContent = '🤖 AI랑 시작';
    }
  }

  /**
   * 대기 카드 제목(.waiting-title)을 현재 인원 상태에 맞게 갱신한다.
   * 상대 합류 시 "상대방을 기다리는 중..."이 남아 .opponent-info와 충돌하던
   * 혼란(WARN-3)을 제거한다.
   * @param {boolean} hasOpponent 상대가 합류했는가
   */
  function updateWaitingTitle(hasOpponent) {
    if (!els.waitingTitle) return;
    els.waitingTitle.textContent = hasOpponent
      ? '대전 준비 중'
      : '상대방을 기다리는 중...';
  }

  /**
   * 상대 이름 표시("○○님과 대전")를 갱신한다.
   */
  function updateOpponentInfo() {
    if (opponentName && els.opponentInfo) {
      els.opponentInfo.classList.remove('hidden');
      if (els.opponentNameLabel) els.opponentNameLabel.textContent = opponentName;
    }
  }

  /**
   * 양방향 READY 상태 마크 + 준비 버튼 표시를 갱신한다.
   */
  function updateReadyUI() {
    if (els.myReadyMark) {
      els.myReadyMark.textContent = myReady ? '✅' : '⌛';
      els.myReadyMark.classList.toggle('ready', myReady);
      els.myReadyMark.classList.toggle('not-ready', !myReady);
    }
    if (els.oppReadyMark) {
      els.oppReadyMark.textContent = opponentReady ? '✅' : '⌛';
      els.oppReadyMark.classList.toggle('ready', opponentReady);
      els.oppReadyMark.classList.toggle('not-ready', !opponentReady);
    }
    // 내가 아직 준비 안 했으면 버튼 노출.
    if (els.btnReady) els.btnReady.hidden = myReady;
  }

  /**
   * 상대 이탈 배너를 표시한다(자동 사라지지 않음 — 사용자가 버튼 클릭 시 이동).
   * @param {string} name 이탈한 상대 이름
   */
  function showOpponentLeftBanner(name) {
    if (els.opponentLeftMsg) {
      els.opponentLeftMsg.textContent = `${name || '상대방'}님이 나갔어요.`;
    }
    if (els.opponentLeftBanner) els.opponentLeftBanner.classList.remove('hidden');
  }

  // ── 화면 전환 ────────────────────────────────────────────────
  function showScreen(name) {
    els.screenWaiting.classList.toggle('hidden', name !== 'waiting');
    els.screenGame.classList.toggle('hidden', name !== 'game');
    if (name !== 'gameover') {
      els.screenGameOver.classList.add('hidden');
    }
  }

  /**
   * 간단한 토스트 표시.
   * @param {string} message
   * @param {string} [kind] 'error' 시 에러 스타일
   */
  function showToast(message, kind) {
    if (!els.toast) return;
    els.toast.textContent = message;
    els.toast.classList.toggle('error', kind === 'error');
    els.toast.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => {
      els.toast.classList.remove('show');
    }, 2500);
  }

  /**
   * 이전 보드와 비교해 새로 놓인 돌의 좌표를 찾는다(마지막 착수 표시용).
   * @param {Array} board
   * @returns {{row:number, col:number}|null}
   */
  function detectLastMove(board) {
    if (!prevBoard) return null;
    for (let i = 0; i < board.length; i++) {
      if (board[i] !== null && prevBoard[i] === null) {
        return { row: Math.floor(i / 19), col: i % 19 };
      }
    }
    return null;
  }

  /**
   * 현재 STATE 기준 내 턴 여부.
   * @returns {boolean}
   */
  function isMyTurn() {
    return !!lastState
      && lastState.phase === 'playing'
      && lastState.currentTurn === myColor;
  }

  /**
   * 보드를 다시 그리고 커서/상태 표시를 갱신한다.
   */
  function renderAll() {
    if (!lastState) return;
    render(els.canvas, lastState, myColor, lastMove);

    // 턴 표시.
    if (lastState.phase === 'playing') {
      const turnKo = lastState.currentTurn === 'black' ? '흑' : '백';
      els.turnIndicator.textContent = `${turnKo}의 차례`;
      els.turnIndicator.classList.toggle('my-turn', isMyTurn());
    } else {
      els.turnIndicator.textContent = '게임 종료';
      els.turnIndicator.classList.remove('my-turn');
    }
    els.moveCount.textContent = `착수 ${lastState.moveCount}수`;

    // 내 턴이면 클릭 가능 커서.
    els.canvas.style.cursor = isMyTurn() ? 'pointer' : 'default';
  }

  // ── 네트워크 핸들러 ──────────────────────────────────────────
  const net = createNetwork({
    onOpen: ({ hasName }) => {
      // 닉네임이 없으면(직접 진입) 인라인 게이트를 노출하고 JOIN을 보류한다.
      if (!hasName) {
        if (els.nameGateInline) els.nameGateInline.classList.remove('hidden');
        // 닉네임 확정 전까지 혼자 대기/AI/READY 패널은 숨긴다.
        if (els.waitingSolo) els.waitingSolo.classList.add('hidden');
        if (els.readyPanel) els.readyPanel.classList.add('hidden');
      }
    },
    onJoined: ({ playerId, color, waiting, opponentName: oppName }) => {
      myId = playerId;
      myColor = color;
      const colorKo = color === 'black' ? '흑' : '백';
      els.playerLabel.textContent = `${playerId === 'p1' ? 'P1' : 'P2'} (${colorKo})`;

      // 상대 이름 수신 시 갱신 + AI 버튼 소멸(사람 대전 흐름 전환).
      if (oppName) {
        opponentName = oppName;
        updateOpponentInfo();
        hideAiButton();
      }

      els.statusMsg.textContent = (waiting && !oppName) ? '상대방 대기 중' : '게임 시작 준비';

      // 대기 카드 제목: 상대 합류(상대 이름 존재 또는 waiting=false) 시 "대전 준비 중".
      updateWaitingTitle(!!oppName || !waiting);

      // 양쪽 입장(waiting=false 또는 상대 이름 존재)이면 혼자 대기 패널 숨김.
      if (!waiting || oppName) {
        hideAiButton();
      } else {
        // 단독 대기: AI 버튼은 mode≠ai일 때만.
        if (getCurrentMode() !== 'ai') {
          if (els.waitingSolo) els.waitingSolo.classList.remove('hidden');
        } else {
          hideAiButton();
        }
      }

      // READY 패널은 닉네임 확정(JOIN 송신) 이후 항상 노출.
      if (els.readyPanel) els.readyPanel.classList.remove('hidden');

      showScreen('waiting');
    },
    onReadyState: ({ myReady: mr, opponentReady: or }) => {
      myReady = mr;
      opponentReady = or;
      updateReadyUI();
    },
    onGameStart: () => {
      rematchRequested = false;
      lastMove = null;
      prevBoard = null;
      // READY 상태 초기화(다음 리매치 대비).
      myReady = false;
      opponentReady = false;
      showScreen('game');
      els.screenGameOver.classList.add('hidden');
      els.rematchBtn.disabled = false;
      els.rematchBtn.textContent = '한 판 더';
      els.rematchBtn.classList.remove('rematch-requested');
      els.btnResign.disabled = false;
    },
    onState: (state) => {
      // 새 착수 추정(이전 보드 대비).
      const detected = detectLastMove(state.board);
      if (detected) lastMove = detected;
      prevBoard = state.board.slice();
      lastState = state;
      renderAll();
    },
    onGameOver: ({ winner, reason, winLine }) => {
      // 종료 결과를 lastState.result에도 반영(승리선 렌더용).
      if (lastState) {
        lastState.result = { winner, reason };
        if (winLine) lastState.result.winLine = winLine;
        lastState.phase = 'ended';
        renderAll();
      }

      let outcome;
      let detail;
      if (winner === 'draw') {
        outcome = '무승부';
        detail = '361칸이 모두 채워졌습니다.';
      } else {
        const iWon = winner === myColor;
        outcome = iWon ? '승리!' : '패배';
        const winnerKo = winner === 'black' ? '흑' : '백';
        if (reason === 'resign') {
          detail = iWon ? '상대가 기권했습니다.' : '기권했습니다.';
        } else {
          detail = `${winnerKo}이(가) 5목 이상을 완성했습니다.`;
        }
      }
      els.resultOutcome.textContent = outcome;
      els.resultOutcome.classList.toggle('win', winner === myColor);
      els.resultOutcome.classList.toggle('lose', winner !== myColor && winner !== 'draw');
      els.resultDetail.textContent = detail;
      els.btnResign.disabled = true;
      els.screenGameOver.classList.remove('hidden');
    },
    onOpponentLeft: ({ name }) => {
      // 자동 redirect 제거 — showScreen('waiting')로 배너를 가리지 않는다.
      // 사라지지 않는 배너 + "로비로 돌아가기" 버튼만 표시(사용자가 직접 이동).
      els.screenGameOver.classList.add('hidden');
      showOpponentLeftBanner(name);
    },
    onRematchWaiting: () => {
      // 상대가 먼저 "한 판 더"를 눌렀다 → 토스트 + 버튼 강조로 동의 유도.
      showToast('상대방이 재대결을 요청했습니다.');
      els.rematchBtn.classList.add('rematch-requested');
    },
    onRematchStart: () => {
      // 양쪽 동의 완료. 뒤따라 오는 JOINED(갱신 color)/READY_STATE가 대기·READY UI를
      // 재구성한다. 여기서는 상태/오버레이만 정리하고 READY 게이트로 되돌아간다.
      rematchRequested = false;
      lastMove = null;
      prevBoard = null;
      lastState = null;
      // READY 상태 초기화 → 양쪽 다시 READY 필요.
      myReady = false;
      opponentReady = false;
      updateReadyUI();
      els.screenGameOver.classList.add('hidden');
      els.rematchBtn.disabled = false;
      els.rematchBtn.textContent = '한 판 더';
      els.rematchBtn.classList.remove('rematch-requested');
      showToast('재대결 — 준비 완료를 눌러주세요!');
    },
    onError: (message) => {
      showToast(message, 'error');
    },
  });

  // ── 보드 클릭 → 착수 ─────────────────────────────────────────
  els.canvas.addEventListener('click', (event) => {
    if (!isMyTurn()) return; // 내 턴 아니면 무시.
    const cell = canvasToCell(els.canvas, event);
    if (!cell) return;
    // 이미 돌이 있으면 송신하지 않음(서버도 막지만 UX 차원).
    if (lastState.board[cell.row * 19 + cell.col] !== null) return;
    net.sendPlace(cell.row, cell.col);
  });

  // ── 기권 ─────────────────────────────────────────────────────
  els.btnResign.addEventListener('click', () => {
    if (!lastState || lastState.phase !== 'playing') return;
    if (confirm('정말 기권하시겠습니까?')) {
      net.sendResign();
    }
  });

  // ── AI랑 시작 (유일한 mode=ai 진입 경로) ──────────────────────
  // ?mode=ai&name=... 로 재접속 → network.js가 sessionStorage 저장 + WS URL에 mode=ai 부착
  // → server.js가 봇 자식 프로세스 자동 spawn. 이 버튼 클릭 외에는 mode=ai가 되지 않는다.
  els.btnStartAi.addEventListener('click', () => {
    els.btnStartAi.disabled = true;
    els.btnStartAi.textContent = '🤖 AI 호출 중...';
    const name = sessionStorage.getItem('omok:name') || '';
    const base = location.pathname; // '/omok/' 또는 '/'
    location.href = `${base}?mode=ai&name=${encodeURIComponent(name)}`;
  });

  // ── 준비 완료(READY) ─────────────────────────────────────────
  els.btnReady.addEventListener('click', () => {
    els.btnReady.hidden = true;
    net.sendReady();
  });

  // ── 상대 이탈 배너 → 로비로 돌아가기 ─────────────────────────
  els.btnBannerReturnLobby.addEventListener('click', () => returnToLobby());

  // ── 인라인 닉네임 게이트(직접 진입 폴백 B) ────────────────────
  function submitInlineName() {
    const name = (els.inlineNameInput.value || '').trim().slice(0, 12);
    if (!name) {
      els.inlineNameInput.focus();
      return;
    }
    sessionStorage.setItem('omok:name', name);
    els.nameGateInline.classList.add('hidden');
    // 닉네임 확정 후 혼자 대기/READY 패널 노출 + JOIN 송신.
    if (getCurrentMode() !== 'ai' && els.waitingSolo) {
      els.waitingSolo.classList.remove('hidden');
    }
    if (els.readyPanel) els.readyPanel.classList.remove('hidden');
    net.sendJoin(name);
  }
  els.btnInlineEnter.addEventListener('click', submitInlineName);
  els.inlineNameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submitInlineName();
    }
  });

  // ── 재대결("한 판 더"): WS 동의 흐름. 양쪽 동의 시 새 판(reload 없음). ──
  els.rematchBtn.addEventListener('click', () => {
    if (rematchRequested) return; // 중복 클릭 방지.
    rematchRequested = true;
    els.rematchBtn.textContent = '상대 동의 대기 중...';
    els.rematchBtn.disabled = true;
    net.sendRematch();
  });

  // ── 런처 통합 모드: 다른 종목 / 게임 선택 → 로비로 ──────────
  function returnToLobby() {
    // 사용자가 직접 버튼을 누른 경우에만 호출된다 → 자동 setTimeout redirect 제거.
    // POST 완료/실패와 무관하게 즉시 로비로 이동(단순화).
    fetch('/lobby/return', { method: 'POST' })
      .catch(() => { /* noop */ })
      .finally(() => {
        location.href = '/';
      });
  }
  els.returnLobbyBtn.addEventListener('click', returnToLobby);
  els.backToLobbyBtn.addEventListener('click', () => {
    if (confirm('정말 로비로 돌아가시겠습니까? 진행 중인 게임은 끝납니다.')) {
      returnToLobby();
    }
  });

  // ── 시작 ─────────────────────────────────────────────────────
  net.connect();
  showScreen('waiting');
});
