/**
 * @fileoverview 클라이언트 진입점. UI/Game/Network를 결합하고 사용자 입력을 조율.
 *
 * 흐름:
 *  1) DOM 준비 → UI/Game/Network 인스턴스
 *  2) WS 연결 → JOIN → 대기/READY
 *  3) 양쪽 READY → START → STATE 수신 시작
 *  4) 내 턴: [윷 던지기] → YUT_RESULT → 결과 칩 클릭 → 말 클릭 → 서버 이동
 *  5) 중앙 도달 시 BRANCH_REQUEST → 모달에서 선택 → CHOOSE_PATH
 *  6) GAME_OVER → 결과 오버레이 + 재대결 버튼
 */

import { createUI } from './ui.js';
import { createNetwork } from './network.js';
import { createGame } from './game.js';
import { pickMyPieceAt, pickFirstHomePiece, isClickOnHomeArea } from './piece.js';
import { YUT_NAMES_KO } from './yut.js';
import { BOARD_SIZE } from './board.js';

document.addEventListener('DOMContentLoaded', () => {
  const els = {
    boardCanvas: document.getElementById('board-canvas'),
    yutCanvas: document.getElementById('yut-canvas'),
    statusEl: document.getElementById('status-msg'),
    playerLabelEl: document.getElementById('player-label'),
    turnLabelEl: document.getElementById('turn-label'),
    throwBtnEl: document.getElementById('throw-btn'),
    yutResultEl: document.getElementById('yut-result'),
    resultQueueEl: document.getElementById('result-queue'),
    readyBtnEl: document.getElementById('ready-btn'),
    rematchBtnEl: document.getElementById('rematch-btn'),
    resultOverlay: document.getElementById('result-overlay'),
    resultText: document.getElementById('result-text'),
    countdownEl: document.getElementById('countdown'),
    branchModalEl: document.getElementById('branch-modal'),
    branchTopBtn: document.getElementById('branch-top-btn'),
    branchBottomBtn: document.getElementById('branch-bottom-btn'),
    myPiecesEl: document.getElementById('my-pieces'),
    oppPiecesEl: document.getElementById('opp-pieces'),
    myDoneEl: document.getElementById('my-done'),
    oppDoneEl: document.getElementById('opp-done'),
    lastThrowEl: document.getElementById('last-throw'),
    invitePanelEl: document.getElementById('invite-panel'),
    inviteUrlEl: document.getElementById('invite-url'),
    copyUrlBtnEl: document.getElementById('copy-url-btn'),
    toastEl: document.getElementById('toast'),
  };

  const ui = createUI(els);
  const game = createGame();
  ui.bindCopyUrlButton();

  let net = null;
  let myId = null;

  // ── 네트워크 핸들러 ──
  net = createNetwork({
    onJoined: ({ playerId, waiting, hostUrl }) => {
      myId = playerId;
      ui.setMyId(playerId);
      els.playerLabelEl.textContent = playerId === 'p1' ? '나 (P1, 빨강)' : '나 (P2, 파랑)';
      if (waiting) {
        ui.setStatus('상대방을 기다리는 중...');
      } else {
        ui.setStatus('상대 입장. 준비 버튼을 눌러주세요.');
      }
      ui.showInvitePanel(hostUrl || '');
    },
    onStart: (countdown) => {
      ui.hideResult();
      els.readyBtnEl.classList.add('hidden');
      els.rematchBtnEl.classList.add('hidden');
      ui.hideInvitePanel();
      ui.setStatus('');
      runCountdown(countdown, () => {
        ui.setStatus('게임 시작!');
        updateThrowButtonState();
      });
    },
    onState: (state) => {
      game.setState(state);
      ui.renderBoard(state);
      ui.renderPieceStatus(state, myId);
      const turnText = state.currentTurn === myId ? '내 턴' : '상대 턴';
      ui.setTurnLabel(state.currentTurn ? turnText : '-');
      // 결과 큐 렌더링
      ui.renderResultQueue(state.pendingResults || [], state.currentTurn === myId, (pickedResult) => {
        // 결과 선택 시 안내 메시지
        ui.setStatus(`${YUT_NAMES_KO[pickedResult]} 결과 선택됨. 말을 클릭하여 이동하세요.`);
      });
      // 분기 모달
      if (state.awaitingBranchAt !== null && state.currentTurn === myId) {
        ui.showBranchModal(true);
      } else {
        ui.showBranchModal(false);
      }
      updateThrowButtonState();
    },
    onYutResult: ({ by, sticks, result, steps, bonus, discarded }) => {
      ui.renderYut(sticks);
      ui.showYutResultText(result, by === myId);
      const byLabel = by === myId ? '나' : '상대';
      // 백도는 -1칸. 자동 폐기됐다면 별도 라벨로 안내.
      const stepText = steps < 0 ? `${steps}칸` : `${steps}칸`;
      const extraTag = discarded ? ', 사용불가→폐기'
        : (bonus ? ', 한번더!' : '');
      ui.setLastThrow(`${byLabel}: ${YUT_NAMES_KO[result]} (${stepText}${extraTag})`);
    },
    onBranchRequest: ({ pieceIndex, playerId }) => {
      // STATE에서도 awaitingBranchAt를 통해 모달이 떠야 하지만 보조로 처리.
      if (playerId === myId) {
        ui.showBranchModal(true);
      }
    },
    onGameOver: ({ winner, reason }) => {
      const won = winner === myId;
      let msg;
      if (reason === 'disconnect') {
        msg = won ? '상대방 연결이 끊겼습니다. 승리!' : '연결이 끊겼습니다.';
      } else {
        msg = won ? '승리! 4개 말 모두 완주!' : '패배... 다음엔 이길 수 있어요!';
      }
      ui.showResult(msg, won ? 'win' : 'lose');
      els.rematchBtnEl.classList.remove('hidden');
      els.rematchBtnEl.disabled = false;
      els.rematchBtnEl.textContent = '재대결';
      ui.setThrowEnabled(false, '윷 던지기');
    },
    onRematchStatus: ({ p1Ready, p2Ready }) => {
      const myReady = (myId === 'p1' && p1Ready) || (myId === 'p2' && p2Ready);
      const oppReady = (myId === 'p1' && p2Ready) || (myId === 'p2' && p1Ready);
      ui.setStatus(`재대결 대기: 나 ${myReady ? '완료' : '대기'} / 상대 ${oppReady ? '완료' : '대기'}`);
    },
    onError: (message) => {
      ui.showToast(message, 'error');
      console.error('[main] 서버 오류:', message);
    },
  });

  // ── 던지기 버튼 ──
  els.throwBtnEl.addEventListener('click', () => {
    if (!game.canThrow(myId)) {
      ui.showToast('지금은 던질 수 없습니다.', 'error');
      return;
    }
    net.throwYut();
  });

  // ── 준비 버튼 ──
  els.readyBtnEl.addEventListener('click', () => {
    net.ready();
    els.readyBtnEl.disabled = true;
    els.readyBtnEl.textContent = '준비 완료 (상대 대기)';
  });

  // ── 재대결 버튼 ──
  els.rematchBtnEl.addEventListener('click', () => {
    net.sendRematch();
    els.rematchBtnEl.disabled = true;
    els.rematchBtnEl.textContent = '재대결 대기 중';
  });

  // ── 분기 선택 버튼 ──
  els.branchTopBtn.addEventListener('click', () => {
    net.choosePath('top');
    ui.showBranchModal(false);
  });
  els.branchBottomBtn.addEventListener('click', () => {
    net.choosePath('bottom');
    ui.showBranchModal(false);
  });

  // ── 보드 클릭 → 말 이동 시도 ──
  els.boardCanvas.addEventListener('click', (event) => {
    const state = game.getState();
    if (!state || state.winner) return;
    if (state.currentTurn !== myId) {
      ui.showToast('상대 턴입니다.', 'error');
      return;
    }
    if (state.awaitingBranchAt !== null) {
      ui.showToast('분기 선택을 먼저 해주세요.', 'error');
      return;
    }
    const picked = ui.getSelectedResult();
    if (!picked) {
      ui.showToast('먼저 사용할 결과(도/개/걸/윷/모)를 클릭하세요.', 'error');
      return;
    }
    const rect = els.boardCanvas.getBoundingClientRect();
    // 캔버스 좌표 보정 (CSS 스케일 대응)
    const scaleX = els.boardCanvas.width / rect.width;
    const scaleY = els.boardCanvas.height / rect.height;
    const x = (event.clientX - rect.left) * scaleX;
    const y = (event.clientY - rect.top) * scaleY;

    // 1) 보드 칸 위 내 piece 클릭?
    let pieceIdx = pickMyPieceAt(state, myId, x, y);
    if (pieceIdx < 0) {
      // 2) HOME 영역 클릭 → 첫 HOME 말 자동 선택
      if (isClickOnHomeArea(x, y, myId, BOARD_SIZE)) {
        pieceIdx = pickFirstHomePiece(state, myId);
      }
    }
    if (pieceIdx < 0) {
      // 3) 폴백: HOME 말이 있으면 첫 번째 자동 선택 (사용자가 빈 칸 클릭 시 친절 처리)
      pieceIdx = pickFirstHomePiece(state, myId);
      if (pieceIdx < 0) {
        ui.showToast('이동할 말을 클릭하세요.', 'error');
        return;
      }
    }
    // 서버에 이동 요청
    net.movePiece(pieceIdx, picked);
    // 선택된 결과는 이동 후 STATE에서 큐가 갱신되며 자동 클리어됨.
    // 다만 UI 측 선택 표시는 즉시 비움.
    ui.clearSelectedResult();
  });

  // ── 던지기 버튼 활성 상태 갱신 헬퍼 ──
  function updateThrowButtonState() {
    const ok = game.canThrow(myId);
    let label = '윷 던지기';
    const state = game.getState();
    if (state && state.currentTurn === myId && !ok && (state.pendingResults || []).length > 0) {
      const last = state.pendingResults[state.pendingResults.length - 1];
      if (last === 'yut' || last === 'mo') {
        label = '한 번 더 던지기!';
      } else {
        label = '결과 사용 후 던지기';
      }
    }
    ui.setThrowEnabled(ok, label);
  }

  // ── 카운트다운 ──
  function runCountdown(seconds, onComplete) {
    let remaining = seconds;
    els.countdownEl.classList.remove('hidden', 'go');
    els.countdownEl.textContent = String(remaining);
    triggerCountdownPulse();
    const interval = setInterval(() => {
      remaining -= 1;
      if (remaining > 0) {
        els.countdownEl.textContent = String(remaining);
        triggerCountdownPulse();
      } else if (remaining === 0) {
        els.countdownEl.textContent = 'GO!';
        els.countdownEl.classList.add('go');
        triggerCountdownPulse();
      } else {
        clearInterval(interval);
        els.countdownEl.classList.add('hidden');
        els.countdownEl.classList.remove('go');
        onComplete();
      }
    }, 1000);
  }
  function triggerCountdownPulse() {
    els.countdownEl.classList.remove('pulse');
    void els.countdownEl.offsetWidth;
    els.countdownEl.classList.add('pulse');
  }

  // ── 시작 ──
  net.connect();
  setTimeout(() => {
    const playerName = `Player-${Math.floor(Math.random() * 1000)}`;
    net.join(playerName);
  }, 300);

  // 초기 보드 그리기 (빈 보드)
  ui.renderBoard(null);

  console.log('[main] 초기화 완료');
});
