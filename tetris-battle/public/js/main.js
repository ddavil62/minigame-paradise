/**
 * @fileoverview 클라이언트 진입점. 모듈을 초기화하고 게임 상태 전환을 조율한다.
 *
 * 흐름:
 *  1) DOM 준비 → UI/Game/Input/Network 인스턴스 생성
 *  2) WebSocket 연결 → JOIN 메시지 전송
 *  3) 사용자가 "준비" 버튼 클릭 → READY 전송
 *  4) 서버가 양쪽 READY 수신 → START 메시지 → 카운트다운 → 게임 시작
 *  5) 가비지/게임오버/재대결 이벤트는 네트워크 핸들러를 통해 처리
 */

import { createGame, STATE } from './game.js';
import { createInput } from './input.js';
import { createNetwork } from './network.js';
import { createUI } from './ui.js';
import { createItems } from './items.js';

// ── DOM 준비 후 초기화 ───────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // 요소 참조
  const els = {
    // 화면 전환 대상
    screenWaiting: document.getElementById('screen-waiting'),
    gameMain: document.querySelector('.game-main'),
    // 대기 화면 요소
    waitingTitle: document.querySelector('#screen-waiting .waiting-title'),
    waitingSolo: document.getElementById('waiting-solo'),
    aiStartBtn: document.getElementById('btn-start-ai'),
    opponentInfo: document.getElementById('opponent-info'),
    opponentNameLabel: document.getElementById('opponent-name-label'),
    readyPanel: document.getElementById('ready-panel'),
    myReadyMark: document.getElementById('my-ready-mark'),
    oppReadyMark: document.getElementById('opp-ready-mark'),
    btnReady: document.getElementById('btn-ready'),
    // 닉네임 게이트
    nameGateInline: document.getElementById('name-gate-inline'),
    inlineNameInput: document.getElementById('inline-name-input'),
    btnInlineEnter: document.getElementById('btn-inline-enter'),
    // 상대 이탈 배너
    opponentLeftBanner: document.getElementById('opponent-left-banner'),
    opponentLeftMsg: document.getElementById('opponent-left-msg'),
    btnBannerReturnLobby: document.getElementById('btn-banner-return-lobby'),
    // 게임 화면 요소
    boardCanvas: document.getElementById('board-canvas'),
    nextCanvas: document.getElementById('next-canvas'),
    holdCanvas: document.getElementById('hold-canvas'),
    opponentCanvas: document.getElementById('opponent-canvas'),
    scoreEl: document.getElementById('score'),
    levelEl: document.getElementById('level'),
    linesEl: document.getElementById('lines'),
    comboEl: document.getElementById('combo'),
    statusEl: document.getElementById('status-msg'),
    resultOverlay: document.getElementById('result-overlay'),
    resultText: document.getElementById('result-text'),
    rematchBtn: document.getElementById('rematch-btn'),
    playerLabel: document.getElementById('player-label'),
    opponentStatus: document.getElementById('opponent-status'),
    countdownEl: document.getElementById('countdown'),
  };

  // ── 화면 전환 ──
  /** @param {'waiting'|'game'} name */
  function showScreen(name) {
    if (els.screenWaiting) els.screenWaiting.classList.toggle('hidden', name !== 'waiting');
    if (els.gameMain) els.gameMain.classList.toggle('hidden', name !== 'game');
  }

  function getCurrentMode() {
    return new URLSearchParams(location.search).get('mode')
      || sessionStorage.getItem('tetris:mode')
      || 'human';
  }

  function updateWaitingTitle(hasOpponent) {
    if (!els.waitingTitle) return;
    els.waitingTitle.textContent = hasOpponent ? '대전 준비 중' : '상대방을 기다리는 중...';
  }

  /** 준비 버튼 없이 상대 입장 즉시 자동으로 READY를 전송한다. */
  let readySent = false;
  function autoReady() {
    if (readySent) return;
    readySent = true;
    net.ready();
  }

  function updateReadyUI(myReadyVal, oppReadyVal) {
    if (els.myReadyMark) {
      els.myReadyMark.textContent = myReadyVal ? '✅' : '⌛';
      els.myReadyMark.classList.toggle('ready', myReadyVal);
      els.myReadyMark.classList.toggle('not-ready', !myReadyVal);
    }
    if (els.oppReadyMark) {
      els.oppReadyMark.textContent = oppReadyVal ? '✅' : '⌛';
      els.oppReadyMark.classList.toggle('ready', oppReadyVal);
      els.oppReadyMark.classList.toggle('not-ready', !oppReadyVal);
    }
  }

  function showOpponentLeftBanner(name) {
    if (els.opponentLeftMsg) {
      els.opponentLeftMsg.textContent = `${name || '상대방'}이(가) 나갔습니다.`;
    }
    if (els.opponentLeftBanner) els.opponentLeftBanner.classList.remove('hidden');
  }

  // UI
  const ui = createUI(els);

  // Game (콜백 주입은 network/input 생성 후 와이어업)
  let net = null;
  let input = null;
  let items = null;
  let resultShown = false; // P2-1: 결과 화면 중복 표시 방지 가드

  const game = createGame({
    renderBoard: ui.renderBoard,
    renderHUD: ui.renderHUD,
    renderNext: ui.renderNext,
    renderHold: ui.renderHold,
    onAttack: (lines, combo, clearEventId) => {
      // 라인 클리어 → 가비지 전송
      if (net) net.sendGarbage(lines, combo, clearEventId);
    },
    onGameOver: () => {
      // 자기 토프아웃 → 서버에 알림
      if (net) net.sendGameOver();
      if (input) input.disable();
      // 결과 오버레이는 서버 GAME_RESULT 수신 시 표시
    },
    onBoardChange: (payload) => {
      if (net) net.sendBoardState(payload);
    },
  });

  // Network
  net = createNetwork({
    // 연결 확립 직후 — 닉네임 3단계 폴백에 따라 JOIN 여부를 결정한다.
    onOpen: ({ hasName }) => {
      if (!hasName) {
        // 닉네임 없음(직접 URL 접근) → 인라인 게이트 표시, JOIN 보류.
        if (els.nameGateInline) els.nameGateInline.classList.remove('hidden');
        if (els.waitingSolo) els.waitingSolo.classList.add('hidden');
        if (els.readyPanel) els.readyPanel.classList.add('hidden');
      }
      // hasName=true인 경우 network.js가 이미 자동 JOIN을 보냈다.
    },
    onJoined: ({ playerId, waiting }) => {
      els.playerLabel.textContent = playerId === 'p1' ? '나 (P1)' : '나 (P2)';
      if (waiting) {
        ui.setStatus('상대방을 기다리는 중...');
        els.opponentStatus.textContent = '대기 중';
        updateWaitingTitle(false);
      } else {
        ui.setStatus('상대 입장. 준비 버튼을 눌러주세요.');
        els.opponentStatus.textContent = '입장 완료';
        updateWaitingTitle(true);
      }
      // READY 마크 초기화
      updateReadyUI(false, false);
      // AI 버튼: p1이고 혼자 대기 중이고 mode!=ai일 때만
      if (playerId === 'p1' && waiting && getCurrentMode() !== 'ai') {
        if (els.waitingSolo) els.waitingSolo.classList.remove('hidden');
      } else {
        if (els.waitingSolo) els.waitingSolo.classList.add('hidden');
      }
      // 상대가 이미 있는 방에 입장(P2) → 바로 READY 전송, ready 패널 불필요
      if (!waiting) {
        updateWaitingTitle(true);
        autoReady();
      }
      showScreen('waiting');
    },
    onStart: (countdown) => {
      // 게임 화면으로 전환
      showScreen('game');
      ui.hideResult();
      resultShown = false; // P2-1: 결과 표시 가드 리셋
      els.rematchBtn.classList.add('hidden');
      ui.setStatus('');
      els.opponentStatus.textContent = '대전 중';
      // Phase 2: 아이템 슬롯/효과/타이머 초기화 (재대결 시에도 안전하게)
      if (items) items.reset();
      // Phase 3 LOW-2: 슬롯 클릭 재활성화 (이전 게임 종료 시 비활성화되었을 수 있음)
      ui.setItemSlotsInteractive(true);
      runCountdown(countdown, () => {
        game.start();
        if (input) input.enable();
      });
    },
    onGarbage: (lines, combo) => {
      console.log(`[main] 가비지 수신: ${lines}줄 (콤보 ${combo})`);
      game.receiveGarbage(lines);
    },
    onOpponentBoard: (state) => {
      ui.renderOpponent(state);
    },
    onResult: (winner, reason) => {
      // P2-1: 중복 GAME_RESULT 수신 시 결과 화면 플리커 방지
      if (resultShown) return;
      resultShown = true;

      const myId = net.getMyId();
      let msg, cssClass;
      if (winner === null) {
        // P2-1: 무승부 (double topout 등)
        msg = '무승부!';
        cssClass = '';
      } else if (reason === 'disconnect') {
        const won = winner === myId;
        msg = won ? '상대방 연결 끊김. 승리!' : '연결이 끊겼습니다.';
        cssClass = won ? 'win' : 'lose';
      } else {
        const won = winner === myId;
        msg = won ? '승리!' : '패배...';
        cssClass = won ? 'win' : 'lose';
      }
      ui.showResult(msg, cssClass);
      game.stop();
      if (input) input.disable();
      // Room-is-full 근본원인 fix: 매치가 끝나는 시점에 sessionStorage의 'ai' 모드 잔존을
      // 제거한다. 그렇지 않으면 이후 같은 탭에서 새로 접속할 때 원치 않게 mode=ai가 재사용되어
      // 서버가 자동으로 봇을 스폰, 슬롯을 선점해 실제 친구가 "Room is full"을 받게 된다.
      // 진행 중인 재대결(REMATCH)은 기존 WS 연결을 그대로 재사용하므로 이 초기화의 영향을 받지 않는다.
      sessionStorage.removeItem('tetris:mode');
      // 멀티룸: 룸 ID도 함께 제거해 다음 접속 시 새 룸으로 진입하도록 한다.
      sessionStorage.removeItem('tetris:room');
      // Phase 3 LOW-3: 결과 화면 표시 시 잔존 아이템 효과/슬롯/타이머를 정리한다.
      // (다크 오버레이, 프리즈 펄스가 결과 화면 위로 보이지 않도록.)
      if (items) items.reset();
      // Phase 3 LOW-2: 슬롯 마우스 클릭으로 사후 ITEM_USE가 송신되지 않도록 비활성화.
      ui.setItemSlotsInteractive(false);
      els.rematchBtn.classList.remove('hidden');
      els.opponentStatus.textContent = '대기 중';
      // 상대 disconnect 시 이탈 배너 표시 (자동 redirect 제거)
      if (reason === 'disconnect') {
        showOpponentLeftBanner();
      }
    },
    onReadyState: () => {
      // 상대 입장이 확인되면 바로 READY 전송 — 준비 버튼 불필요
      updateWaitingTitle(true);
      if (els.waitingSolo) els.waitingSolo.classList.add('hidden');
      autoReady();
    },
    onOpponentLeft: ({ name }) => {
      readySent = false; // 상대가 나가면 초기화 — 새 상대 입장 시 autoReady 재발동
      showOpponentLeftBanner(name);
    },
    onRematchStatus: ({ p1Ready, p2Ready }) => {
      const myId = net.getMyId();
      const myReady = (myId === 'p1' && p1Ready) || (myId === 'p2' && p2Ready);
      const oppReady = (myId === 'p1' && p2Ready) || (myId === 'p2' && p1Ready);
      ui.setStatus(`재대결 대기: 나 ${myReady ? '완료' : '대기'} / 상대 ${oppReady ? '완료' : '대기'}`);
    },
    onError: (message) => {
      ui.setStatus(`오류: ${message}`);
      console.error('[main] 서버 오류:', message);
    },
    // ── Phase 2 아이템 핸들러 ──
    onItemGrant: ({ itemId, slotIndex }) => {
      console.log(`[main] 아이템 지급: ${itemId} → 슬롯 ${slotIndex}`);
      if (items) items.grantItem(itemId, slotIndex);
    },
    onItemEffect: ({ itemId, duration }) => {
      console.log(`[main] 아이템 효과 수신: ${itemId} (${duration}ms)`);
      if (items) items.applyEffect(itemId, duration);
    },
    onShieldBlock: ({ itemId, isDefender }) => {
      console.log(`[main] 방어막으로 ${itemId} 차단됨 (방어자=${isDefender})`);
      if (items) items.onShieldBlocked(itemId, isDefender);
    },
    onShieldActive: () => {
      // 상대방이 방어막 발동 — 상대 미니맵 위에 배지 표시
      console.log('[main] 상대방 방어막 활성화');
      if (ui) ui.setOppShieldBadge(true);
    },
  });

  // Input
  input = createInput({
    moveLeft: () => game.moveLeft(),
    moveRight: () => game.moveRight(),
    softDrop: () => game.softDrop(),
    rotateCW: () => game.rotateCW(),
    rotateCCW: () => game.rotateCCW(),
    hardDrop: () => game.hardDrop(),
    hold: () => game.hold(),
    useItem: (slot) => {
      if (items) items.useItem(slot);
    },
  });

  // 게임 루프가 input의 소프트 드롭 폴링 함수를 사용
  game.bindSoftDropPoll(input.isSoftDropHeld);

  // ── 아이템 시스템 (Phase 2) ──
  items = createItems({ game, input, net, ui });
  // 슬롯 클릭으로도 아이템 사용 가능 (UI에서 이벤트 등록)
  ui.bindItemSlotClick((slot) => items.useItem(slot));
  // 초기 슬롯 렌더링 (모두 비어있음)
  items.reset();

  // ── 버튼 이벤트 ── (준비 버튼 제거 — 자동 READY로 대체)

  // ── AI랑 시작 버튼 ──
  if (els.aiStartBtn) {
    els.aiStartBtn.addEventListener('click', () => {
      els.aiStartBtn.disabled = true;
      els.aiStartBtn.textContent = '🤖 AI 호출 중...';
      net.aiStart();
    });
  }

  // ── 닉네임 게이트 (인라인 입력) ──
  function submitInlineName() {
    const name = (els.inlineNameInput ? els.inlineNameInput.value.trim() : '').slice(0, 12);
    if (!name) return;
    sessionStorage.setItem('tetris-battle:name', name);
    if (els.nameGateInline) els.nameGateInline.classList.add('hidden');
    if (els.waitingSolo) els.waitingSolo.classList.remove('hidden');
    net.join(name);
  }
  if (els.btnInlineEnter) {
    els.btnInlineEnter.addEventListener('click', submitInlineName);
  }
  if (els.inlineNameInput) {
    els.inlineNameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submitInlineName();
    });
  }

  // ── 상대 이탈 배너 — 로비 복귀 버튼 ──
  if (els.btnBannerReturnLobby) {
    els.btnBannerReturnLobby.addEventListener('click', () => {
      sessionStorage.removeItem('tetris:mode');
      sessionStorage.removeItem('tetris:room');
      fetch('/lobby/return', { method: 'POST' }).catch(() => {});
      location.href = '/';
    });
  }

  els.rematchBtn.addEventListener('click', () => {
    net.sendRematch();
    els.rematchBtn.disabled = true;
    els.rematchBtn.textContent = '재대결 대기 중';
    setTimeout(() => {
      // START 수신 시 hidden 처리되므로 여기서는 텍스트만 복구
      els.rematchBtn.disabled = false;
      els.rematchBtn.textContent = '재대결';
    }, 2000);
  });

  // ── 로비 복귀 버튼 ──
  const returnLobbyBtn = document.getElementById('btn-return-lobby');
  if (returnLobbyBtn) {
    returnLobbyBtn.addEventListener('click', () => {
      sessionStorage.removeItem('tetris:mode');
      sessionStorage.removeItem('tetris:room');
      fetch('/lobby/return', { method: 'POST' }).catch(() => {});
      location.href = '/';
    });
  }

  // ── 상시 뒤로가기 버튼 (게임 중 로비 복귀) ──
  const backToLobbyBtn = document.getElementById('btn-back-to-lobby');
  if (backToLobbyBtn) {
    backToLobbyBtn.addEventListener('click', () => {
      if (!confirm('게임을 중단하고 게임 선택 화면으로 돌아가시겠어요? 상대방도 함께 로비로 이동합니다.')) return;
      sessionStorage.removeItem('tetris:mode');
      sessionStorage.removeItem('tetris:room');
      fetch('/lobby/return', { method: 'POST' }).catch(() => {});
      location.href = '/';
    });
  }

  // ── 카운트다운 헬퍼 ──
  /**
   * 카운트다운을 표시한 뒤 onComplete를 호출한다 (Phase 3: 매 단계 펄스 애니메이션).
   * @param {number} seconds
   * @param {() => void} onComplete
   */
  function runCountdown(seconds, onComplete) {
    let remaining = seconds;
    els.countdownEl.classList.remove('hidden');
    els.countdownEl.classList.remove('go');
    els.countdownEl.textContent = remaining.toString();
    // 매 숫자 갱신 시 pulse 애니메이션 재시작
    triggerCountdownPulse();
    const interval = setInterval(() => {
      remaining -= 1;
      if (remaining > 0) {
        els.countdownEl.textContent = remaining.toString();
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

  /**
   * 카운트다운 엘리먼트에 pulse 애니메이션을 트리거한다.
   * CSS class를 잠시 제거했다가 다시 추가하여 애니메이션을 재시작한다.
   */
  function triggerCountdownPulse() {
    els.countdownEl.classList.remove('pulse');
    // reflow 강제 → 애니메이션 재시작
    void els.countdownEl.offsetWidth;
    els.countdownEl.classList.add('pulse');
  }

  // ── Phase 3: 입력 지연 / FPS 측정 (개발 도구) ──
  // window.__perf 로 접근 가능. 실제 친구 대전에는 영향 없음.
  const perf = {
    inputSamples: [],   // 키 누름 시각 → 다음 rAF tick까지의 ms
    frameSamples: [],   // 인접 rAF tick 간격(ms)
    pendingInputAt: 0,
    lastFrameAt: 0,
    /** 입력 지연 통계 반환. */
    inputStats() {
      const s = this.inputSamples;
      if (s.length === 0) return { count: 0, avg: 0, min: 0, max: 0 };
      const sum = s.reduce((a, b) => a + b, 0);
      return {
        count: s.length,
        avg: +(sum / s.length).toFixed(2),
        min: +Math.min(...s).toFixed(2),
        max: +Math.max(...s).toFixed(2),
      };
    },
    /** FPS 통계 반환. */
    fpsStats() {
      const s = this.frameSamples;
      if (s.length === 0) return { count: 0, avgFps: 0, minFps: 0, maxFps: 0 };
      const avgDt = s.reduce((a, b) => a + b, 0) / s.length;
      const maxDt = Math.max(...s);
      const minDt = Math.min(...s);
      return {
        count: s.length,
        avgFps: +(1000 / avgDt).toFixed(1),
        minFps: +(1000 / maxDt).toFixed(1),  // 가장 긴 dt = 가장 낮은 FPS
        maxFps: +(1000 / minDt).toFixed(1),
      };
    },
    /** 콘솔에 요약 출력. */
    report() {
      console.log('[perf] input:', this.inputStats(), 'fps:', this.fpsStats());
    },
    /** 샘플 초기화. */
    reset() { this.inputSamples = []; this.frameSamples = []; },
  };
  if (typeof window !== 'undefined') {
    window.__perf = perf;
  }
  // 키 누름 시각 기록 (게임 입력 키만)
  const measuredKeys = new Set([
    'ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', ' ',
    'Shift', 'Control', 'z', 'Z', 'x', 'X', 'c', 'C',
  ]);
  window.addEventListener('keydown', (e) => {
    if (!measuredKeys.has(e.key)) return;
    if (e.repeat) return;
    perf.pendingInputAt = performance.now();
  }, true); // capture: useCapture로 main의 input 핸들러보다 먼저 시각만 기록
  // 매 rAF에서 가장 최근 입력 지연 + 프레임 간격 측정
  function perfTick(now) {
    if (perf.pendingInputAt > 0) {
      perf.inputSamples.push(now - perf.pendingInputAt);
      perf.pendingInputAt = 0;
      if (perf.inputSamples.length > 200) perf.inputSamples.shift();
    }
    if (perf.lastFrameAt > 0) {
      const dt = now - perf.lastFrameAt;
      // 비정상적으로 큰 dt(탭 비활성, 디버거)는 통계에서 제외
      if (dt > 0 && dt < 500) {
        perf.frameSamples.push(dt);
        if (perf.frameSamples.length > 300) perf.frameSamples.shift();
      }
    }
    perf.lastFrameAt = now;
    requestAnimationFrame(perfTick);
  }
  requestAnimationFrame(perfTick);

  // ── 시작: WebSocket 연결 ──
  // JOIN은 network.js onOpen에서 닉네임 게이트 결과에 따라 자동 전송한다.
  net.connect();

  console.log('[main] 초기화 완료');
});
