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
    branchTitleEl: document.querySelector('#branch-modal .branch-title'),
    branchTopBtn: document.getElementById('branch-top-btn'),
    branchBottomBtn: document.getElementById('branch-bottom-btn'),
    myPiecesEl: document.getElementById('my-pieces'),
    oppPiecesEl: document.getElementById('opp-pieces'),
    myDoneEl: document.getElementById('my-done'),
    oppDoneEl: document.getElementById('opp-done'),
    lastThrowEl: document.getElementById('last-throw'),
    toastEl: document.getElementById('toast'),
    aiPanelEl: document.getElementById('ai-panel'),
    btnStartAiEl: document.getElementById('btn-start-ai'),
  };

  const ui = createUI(els);
  const game = createGame();

  let net = null;
  let myId = null;
  // FIX-2: 현재 열린 분기 모달의 유형. 'center'(중앙) | 'corner'(모서리).
  // 분기 버튼 클릭 시 pathChoice를 결정하는 데 사용한다.
  let currentBranchType = 'center';

  // ── 네트워크 핸들러 ──
  net = createNetwork({
    // 연결(또는 재연결) 확립 직후 JOIN 송신 — open 이전 송신은 network.js가 드롭하므로
    // 반드시 이 콜백에서 보낸다. 재연결 시에도 재JOIN되어 myId가 항상 갱신된다.
    onOpen: () => {
      const playerName = `Player-${Math.floor(Math.random() * 1000)}`;
      net.join(playerName);
    },
    onJoined: ({ playerId, waiting, hostUrl }) => {
      myId = playerId;
      ui.setMyId(playerId);
      els.playerLabelEl.textContent = playerId === 'p1' ? '나 (P1, 빨강)' : '나 (P2, 파랑)';
      if (waiting) {
        ui.setStatus('상대방을 기다리는 중...');
      } else {
        ui.setStatus('상대 입장. 준비 버튼을 눌러주세요.');
      }
      // P1/P2 준비 상태 초기화 (입장 시점에는 양쪽 모두 아직 READY 전).
      ui.showReadyStatus(false, false);
      // AI 버튼 노출: p1이고 혼자 대기 중이고 이미 ai 모드가 아닐 때만.
      // (이미 mode=ai면 곧 봇이 들어오므로 중복 버튼을 숨긴다.)
      const currentMode = new URLSearchParams(location.search).get('mode') || 'human';
      if (playerId === 'p1' && waiting && currentMode !== 'ai') {
        els.aiPanelEl.classList.remove('hidden');
      } else {
        els.aiPanelEl.classList.add('hidden');
      }
    },
    onStart: (countdown) => {
      ui.hideResult();
      els.readyBtnEl.classList.add('hidden');
      els.rematchBtnEl.classList.add('hidden');
      els.aiPanelEl.classList.add('hidden'); // 게임 시작 시 AI 버튼 숨김
      ui.showReadyStatus(true, true); // 양쪽 준비 완료 반영 후 숨김
      ui.hideReadyStatus();
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
      // 분기 모달 (FIX-2: branchType 반영)
      if (state.awaitingBranchAt !== null && state.currentTurn === myId) {
        currentBranchType = state.awaitingBranchType || 'center';
        ui.showBranchModal(true, currentBranchType);
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
    onBranchRequest: ({ pieceIndex, playerId, branchType }) => {
      // STATE에서도 awaitingBranchAt를 통해 모달이 떠야 하지만 보조로 처리.
      if (playerId === myId) {
        currentBranchType = branchType || 'center'; // FIX-2
        ui.showBranchModal(true, currentBranchType);
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
      // 런처 모드에서 상대 disconnect 시 로비로 자동 복귀
      if (reason === 'disconnect' && window.location.pathname.startsWith('/yutnori/')) {
        setTimeout(() => { window.location.href = '/'; }, 1200);
      }
    },
    onRematchStatus: ({ p1Ready, p2Ready }) => {
      const myReady = (myId === 'p1' && p1Ready) || (myId === 'p2' && p2Ready);
      const oppReady = (myId === 'p1' && p2Ready) || (myId === 'p2' && p1Ready);
      ui.setStatus(`재대결 대기: 나 ${myReady ? '완료' : '대기'} / 상대 ${oppReady ? '완료' : '대기'}`);
      // 재대결 진행 중에는 AI 버튼을 숨긴다 (새 매칭 진입과 구분, rummikub 동일 패턴).
      els.aiPanelEl.classList.add('hidden');
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
    // 자기 자신 준비 상태 즉시 반영 (상대 상태는 START 시점에 양쪽 준비로 확정).
    if (myId === 'p1') {
      ui.showReadyStatus(true, false);
    } else {
      ui.showReadyStatus(false, true);
    }
  });

  // ── AI랑 시작 버튼 ──
  // 클릭 시 ?mode=ai로 새로고침 → network.js가 WS URL에 mode=ai를 부착 →
  // 서버가 봇 자식 프로세스를 자동 spawn한다.
  els.btnStartAiEl.addEventListener('click', () => {
    els.btnStartAiEl.disabled = true;
    els.btnStartAiEl.textContent = '🤖 AI 호출 중...';
    const url = new URL(location.href);
    url.searchParams.set('mode', 'ai');
    location.href = url.toString();
  });

  // ── 재대결 버튼 ──
  els.rematchBtnEl.addEventListener('click', () => {
    net.sendRematch();
    els.rematchBtnEl.disabled = true;
    els.rematchBtnEl.textContent = '재대결 대기 중';
  });

  // ── 로비 복귀 버튼 ──
  const returnLobbyBtn = document.getElementById('btn-return-lobby');
  if (returnLobbyBtn) {
    returnLobbyBtn.addEventListener('click', () => {
      fetch('/lobby/return', { method: 'POST' }).catch(() => {});
      location.href = '/';
    });
  }

  // ── 상시 뒤로가기 버튼 (게임 중 로비 복귀) ──
  const backToLobbyBtn = document.getElementById('btn-back-to-lobby');
  if (backToLobbyBtn) {
    backToLobbyBtn.addEventListener('click', () => {
      if (!confirm('게임을 중단하고 게임 선택 화면으로 돌아가시겠어요? 상대방도 함께 로비로 이동합니다.')) return;
      fetch('/lobby/return', { method: 'POST' }).catch(() => {});
      location.href = '/';
    });
  }

  // ── 분기 선택 버튼 (FIX-2: branchType에 따라 pathChoice 결정) ──
  // corner: top버튼='외곽 계속'→'outer', bottom버튼='지름길 진입'→'shortcut'.
  // center: 기존 top/bottom 그대로.
  els.branchTopBtn.addEventListener('click', () => {
    const pathChoice = currentBranchType === 'corner' ? 'outer' : 'top';
    net.choosePath(pathChoice);
    ui.showBranchModal(false);
  });
  els.branchBottomBtn.addEventListener('click', () => {
    const pathChoice = currentBranchType === 'corner' ? 'shortcut' : 'bottom';
    net.choosePath(pathChoice);
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
    // 클릭 좌표를 BOARD_SIZE(560) 좌표계로 변환한다.
    // resizeBoard()가 canvas.width를 dpr 반영 내부 해상도(≈avail×dpr)로 키우므로
    // (canvas.width/rect.width)로 스케일하면 화면 픽셀 그대로가 되어 board.js의
    // hitTestCell/cellToCoord(560 좌표계)와 어긋난다. 렌더는 0~BOARD_SIZE 좌표를
    // CSS 표시폭(rect)으로 스케일해 그리므로, 클릭은 CSS 표시 좌표를 560으로 역매핑한다(dpr 무관).
    // 보드는 정사각이라 x/y 스케일은 같으나 안전하게 각 축의 표시 크기로 나눈다.
    const scaleX = BOARD_SIZE / rect.width;
    const scaleY = BOARD_SIZE / rect.height;
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
  // JOIN은 onOpen 콜백에서 송신한다 (고정 300ms 타이머는 연결 지연 시 JOIN 유실
  // → myId=null 소프트락을 유발해 폐기. 2026-06-12 fix).
  net.connect();

  // 초기 보드 그리기 (빈 보드)
  ui.renderBoard(null);

  console.log('[main] 초기화 완료');
});
