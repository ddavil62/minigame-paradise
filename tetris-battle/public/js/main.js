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
    readyBtn: document.getElementById('ready-btn'),
    rematchBtn: document.getElementById('rematch-btn'),
    playerLabel: document.getElementById('player-label'),
    opponentStatus: document.getElementById('opponent-status'),
    countdownEl: document.getElementById('countdown'),
  };

  // UI
  const ui = createUI(els);
  // Phase 4 C-2: 주소 복사 버튼 핸들러 등록 (한 번만)
  ui.bindCopyUrlButton();

  // Game (콜백 주입은 network/input 생성 후 와이어업)
  let net = null;
  let input = null;
  let items = null;

  const game = createGame({
    renderBoard: ui.renderBoard,
    renderHUD: ui.renderHUD,
    renderNext: ui.renderNext,
    renderHold: ui.renderHold,
    onAttack: (lines, combo) => {
      // 라인 클리어 → 가비지 전송
      if (net) net.sendGarbage(lines, combo);
    },
    onGameOver: () => {
      // 자기 토프아웃 → 서버에 알림
      if (net) net.sendGameOver();
      if (input) input.disable();
      // 결과 오버레이는 서버 GAME_RESULT 수신 시 표시
    },
    onBoardChange: (payload) => {
      if (net) net.sendBoardState(payload.height, payload.stack);
    },
  });

  // Network
  net = createNetwork({
    onJoined: ({ playerId, waiting, hostUrl }) => {
      els.playerLabel.textContent = playerId === 'p1' ? '나 (P1)' : '나 (P2)';
      if (waiting) {
        ui.setStatus('상대방을 기다리는 중...');
        els.opponentStatus.textContent = '대기 중';
      } else {
        ui.setStatus('상대 입장. 준비 버튼을 눌러주세요.');
        els.opponentStatus.textContent = '입장 완료';
      }
      // Phase 4 C-2: 대기 화면에서 친구 접속 안내 패널 표시.
      // hostUrl은 서버가 자동 감지한 LAN URL (없으면 클라이언트가 폴백).
      ui.showInvitePanel(hostUrl || '');
    },
    onStart: (countdown) => {
      // 카운트다운 표시 후 게임 시작
      ui.hideResult();
      els.readyBtn.classList.add('hidden');
      els.rematchBtn.classList.add('hidden');
      // Phase 4 C-2: 게임 시작 시 친구 접속 안내 패널 숨김.
      ui.hideInvitePanel();
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
      const myId = net.getMyId();
      const won = winner === myId;
      let msg;
      if (reason === 'disconnect') {
        msg = won ? '상대방 연결 끊김. 승리!' : '연결이 끊겼습니다.';
      } else {
        msg = won ? '승리!' : '패배...';
      }
      ui.showResult(msg, won ? 'win' : 'lose');
      game.stop();
      if (input) input.disable();
      // Phase 3 LOW-3: 결과 화면 표시 시 잔존 아이템 효과/슬롯/타이머를 정리한다.
      // (다크 오버레이, 프리즈 펄스가 결과 화면 위로 보이지 않도록.)
      if (items) items.reset();
      // Phase 3 LOW-2: 슬롯 마우스 클릭으로 사후 ITEM_USE가 송신되지 않도록 비활성화.
      ui.setItemSlotsInteractive(false);
      els.rematchBtn.classList.remove('hidden');
      els.opponentStatus.textContent = '대기 중';
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
    onShieldBlock: ({ itemId }) => {
      console.log(`[main] 방어막으로 ${itemId} 차단됨`);
      if (items) items.onShieldBlocked(itemId);
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

  // ── 버튼 이벤트 ──
  els.readyBtn.addEventListener('click', () => {
    net.ready();
    els.readyBtn.disabled = true;
    els.readyBtn.textContent = '준비 완료 (상대 대기)';
  });

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

  // ── 시작: WebSocket 연결 + JOIN ──
  net.connect();
  // 약간의 지연 후 JOIN (open 이벤트 안정성)
  setTimeout(() => {
    const playerName = `Player-${Math.floor(Math.random() * 1000)}`;
    net.join(playerName);
  }, 300);

  console.log('[main] 초기화 완료');
});
