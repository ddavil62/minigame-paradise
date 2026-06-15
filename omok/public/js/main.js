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

    invitePanel: document.getElementById('invite-panel'),
    inviteUrl: document.getElementById('invite-url'),
    copyUrlBtn: document.getElementById('copy-url-btn'),
    aiPanel: document.getElementById('ai-panel'),
    btnStartAi: document.getElementById('btn-start-ai'),

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
    onJoined: ({ playerId, color, waiting, hostUrl }) => {
      // 리매치 후 서버가 재전송하는 JOINED는 waiting=false → 화면 전환 없이 color만 갱신.
      const isRematch = !waiting;
      myId = playerId;
      myColor = color;
      const colorKo = color === 'black' ? '흑' : '백';
      els.playerLabel.textContent = `${playerId === 'p1' ? 'P1' : 'P2'} (${colorKo})`;
      if (isRematch) {
        // 리매치 JOINED: 대기 화면으로 되돌리지 않고 color/라벨 갱신만 한다.
        return;
      }
      els.statusMsg.textContent = waiting ? '상대방 대기 중' : '게임 시작 준비';

      // 초대 URL: 호스트(p1) + 단독 대기 시 노출.
      if (playerId === 'p1' && hostUrl) {
        els.inviteUrl.textContent = hostUrl;
        els.invitePanel.classList.remove('hidden');
      } else {
        els.invitePanel.classList.add('hidden');
      }

      // "AI랑 시작" 버튼: 호스트(p1) + 단독 대기 + 현재 mode≠ai 일 때만.
      const currentMode = new URLSearchParams(location.search).get('mode')
        || sessionStorage.getItem('omok:mode')
        || 'human';
      if (playerId === 'p1' && waiting && currentMode !== 'ai') {
        els.aiPanel.classList.remove('hidden');
      } else {
        els.aiPanel.classList.add('hidden');
      }
      showScreen('waiting');
    },
    onGameStart: () => {
      rematchRequested = false;
      lastMove = null;
      prevBoard = null;
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
    onOpponentLeft: (message) => {
      showToast(message, 'error');
      showScreen('waiting');
      els.screenGameOver.classList.add('hidden');
      els.statusMsg.textContent = '상대방 대기 중';
      // 다시 단독 대기 → AI 옵션 재노출.
      const currentMode = new URLSearchParams(location.search).get('mode')
        || sessionStorage.getItem('omok:mode')
        || 'human';
      if (myId === 'p1' && currentMode !== 'ai') {
        els.aiPanel.classList.remove('hidden');
        els.btnStartAi.disabled = false;
        els.btnStartAi.textContent = '🤖 AI랑 시작';
      }
    },
    onRematchWaiting: () => {
      // 상대가 먼저 "한 판 더"를 눌렀다 → 토스트 + 버튼 강조로 동의 유도.
      showToast('상대방이 재대결을 요청했습니다.');
      els.rematchBtn.classList.add('rematch-requested');
    },
    onRematchStart: () => {
      // 양쪽 동의 완료. 뒤따라 오는 JOINED(갱신 color)/GAME_START/STATE가
      // color·화면 전환·보드 렌더를 처리한다. 여기서는 상태/오버레이만 정리.
      rematchRequested = false;
      lastMove = null;
      prevBoard = null;
      lastState = null;
      els.screenGameOver.classList.add('hidden');
      els.rematchBtn.disabled = false;
      els.rematchBtn.textContent = '한 판 더';
      els.rematchBtn.classList.remove('rematch-requested');
      showToast('재대결 시작!');
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

  // ── AI랑 시작 ────────────────────────────────────────────────
  // ?mode=ai 쿼리로 새로고침 → network.js가 sessionStorage 저장 + WS URL에 mode=ai 부착
  // → server.js가 봇 자식 프로세스 자동 spawn.
  els.btnStartAi.addEventListener('click', () => {
    els.btnStartAi.disabled = true;
    els.btnStartAi.textContent = '🤖 AI 호출 중...';
    const url = new URL(location.href);
    url.searchParams.set('mode', 'ai');
    location.href = url.toString();
  });

  // ── 초대 URL 복사 ────────────────────────────────────────────
  els.copyUrlBtn.addEventListener('click', async () => {
    const url = els.inviteUrl.textContent;
    try {
      await navigator.clipboard.writeText(url);
      showToast('초대 URL 복사 완료');
    } catch (e) {
      // execCommand 폴백.
      const range = document.createRange();
      range.selectNode(els.inviteUrl);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      try {
        document.execCommand('copy');
        showToast('초대 URL 복사 완료');
      } catch (e2) {
        showToast('복사 실패 — 수동으로 복사하세요', 'error');
      }
      sel.removeAllRanges();
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
    const seg = location.pathname.split('/').filter(Boolean)[0] || '';
    fetch('/lobby/return', { method: 'POST' })
      .catch(() => { /* noop */ })
      .finally(() => {
        if (!seg) {
          location.href = '/';
        }
        setTimeout(() => {
          if (seg) location.href = '/';
        }, 1500);
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
