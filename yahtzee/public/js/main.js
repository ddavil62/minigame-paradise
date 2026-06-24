/**
 * @fileoverview 요트 다이스 클라이언트 진입점 — 모듈 조율.
 *
 * 흐름:
 *  1) DOM 준비 → Network 연결 → JOIN
 *  2) JOINED(waiting) → 대기 화면 + 초대 URL + READY 버튼 노출
 *  3) READY → 양쪽 READY 시 START → 게임 화면
 *  4) 내 턴: 굴리기 버튼 → DICE_ROLLED → keep 토글 → 다시 굴리기 → ... → 카테고리 선택
 *  5) 상대 턴: 모든 입력 비활성, "상대 턴" 표시
 *  6) GAME_OVER → 종료 오버레이(승/패/무, breakdown) + 재대결 / 다른 종목
 */

import { createNetwork } from './network.js';
import { setState, getState, DICE_COUNT, MAX_ROLLS_PER_TURN } from './game.js';
import { renderDice } from './dice.js';
import { renderScoreboard } from './scoreboard.js';
import { renderHud, renderActionBar, renderGameOver, showToast } from './ui.js';
import {
  isMuted, toggleMuted,
  playRoll, playDiceLand, playKeepToggle, playScore,
  playYahtzee, playUpperBonus, playWin, playLose, playButtonClick,
} from './sounds.js';

document.addEventListener('DOMContentLoaded', () => {
  // ── DOM 참조 ────────────────────────────────────────────────
  const els = {
    screenWaiting: document.getElementById('screen-waiting'),
    screenGame: document.getElementById('screen-game'),
    screenGameOver: document.getElementById('screen-game-over'),
    playerLabel: document.getElementById('player-label'),
    statusMsg: document.getElementById('status-msg'),
    turnLabel: document.getElementById('turn-label'),
    hdrP1Name: document.getElementById('hdr-p1-name'),
    hdrP2Name: document.getElementById('hdr-p2-name'),
    hdrP1Total: document.getElementById('hdr-p1-total'),
    hdrP2Total: document.getElementById('hdr-p2-total'),
    tblP1Name: document.getElementById('tbl-p1-name'),
    tblP2Name: document.getElementById('tbl-p2-name'),
    // 대기 화면 — 신규 Entry UI 통합 요소
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

    diceArea: document.getElementById('dice-area'),
    rollCount: document.getElementById('roll-count'),
    btnRoll: document.getElementById('btn-roll'),
    actionHint: document.getElementById('action-hint'),
    scoreboard: document.querySelector('.scoreboard'),
    scoreboardBody: document.getElementById('scoreboard-body'),
    p1UpperSum: document.getElementById('p1-upper-sum'),
    p2UpperSum: document.getElementById('p2-upper-sum'),
    p1UpperBonus: document.getElementById('p1-upper-bonus'),
    p2UpperBonus: document.getElementById('p2-upper-bonus'),
    p1YahtzeeBonus: document.getElementById('p1-yahtzee-bonus'),
    p2YahtzeeBonus: document.getElementById('p2-yahtzee-bonus'),
    p1Total: document.getElementById('p1-total'),
    p2Total: document.getElementById('p2-total'),

    resultOutcome: document.getElementById('result-outcome'),
    resultP1Name: document.getElementById('result-p1-name'),
    resultP2Name: document.getElementById('result-p2-name'),
    resultP1Total: document.getElementById('result-p1-total'),
    resultP2Total: document.getElementById('result-p2-total'),
    resultP1Side: document.querySelectorAll('.result-side')[0],
    resultP2Side: document.querySelectorAll('.result-side')[1],
    resultBreakdown: document.getElementById('result-breakdown'),
    rematchBtn: document.getElementById('rematch-btn'),
    returnLobbyBtn: document.getElementById('btn-return-lobby'),
    backToLobbyBtn: document.getElementById('btn-back-to-lobby'),
    btnMute: document.getElementById('btn-mute'),

    toast: document.getElementById('toast'),
  };

  // ── 음소거 토글 초기 아이콘 동기화 (localStorage 영속 상태 반영) ──
  // muted=true → 🔇 / false → 🔊. 클래스 .muted로 시각적 디밍.
  function syncMuteIcon() {
    const m = isMuted();
    els.btnMute.textContent = m ? '🔇' : '🔊';
    els.btnMute.classList.toggle('muted', m);
  }
  syncMuteIcon();

  // ── 상태 ────────────────────────────────────────────────────
  let myId = null;
  // N인 플레이어 ID 배열. STATE 수신 시 갱신. 기본 2인.
  let playerIds = ['p1', 'p2'];
  // keep 입력 누적 (다음 ROLL_DICE에 보낼 값). STATE 수신 시 서버 권위로 동기화.
  let pendingKeep = [false, false, false, false, false];
  /** 상대 닉네임(JOINED.opponentName 수신 시 갱신). */
  let opponentName = null;
  /** 내 READY 상태. */
  let myReady = false;
  /** 상대 READY 상태. */
  let opponentReady = false;
  // 효과음 트리거용: 본인 상단 보너스가 0→35 순간을 감지하기 위한 직전값 캐시.
  let lastMyUpperBonus = 0;
  // 카테고리 강조 큐: CATEGORY_SCORED 도착 시 { by, category }를 push,
  // 직후 STATE → renderAll로 DOM이 교체된 뒤 해당 셀에 .scored-flash 클래스를 add.
  let pendingFlash = null;
  // 각 플레이어가 "마지막에 선택한 카테고리"를 추적. 다음 본인 행동 전까지
  // 해당 셀에 .scored-persistent를 부여하여 직전 선택을 지속 강조한다.
  // CATEGORY_SCORED 수신 시 by별로 갱신, START/onStart 시 초기화.
  let lastScoredCategoryByPlayer = {};
  // N4: 굴리기 연타 차단 플래그. click 핸들러에서 true로 세팅,
  // onState(STATE 수신) 시 false로 리셋하여 버튼을 자동 복구한다.
  // disabled=true 는 DOM 업데이트라 동기 억제가 불가 — 앱 레벨 플래그로 보완.
  let _rollPending = false;

  // ── 화면 전환 ────────────────────────────────────────────────
  function showScreen(name) {
    els.screenWaiting.classList.toggle('hidden', name !== 'waiting');
    els.screenGame.classList.toggle('hidden', name !== 'game');
    if (name !== 'gameover') {
      els.screenGameOver.classList.add('hidden');
    }
  }

  /**
   * 현재 모드(ai|human)를 URL/sessionStorage에서 읽는다.
   * @returns {string}
   */
  function getCurrentMode() {
    return new URLSearchParams(location.search).get('mode')
      || sessionStorage.getItem('yahtzee:mode')
      || 'human';
  }

  /**
   * "🤖 AI랑 시작" 버튼(혼자 대기 패널)을 숨긴다.
   */
  function hideAiButton() {
    if (els.waitingSolo) els.waitingSolo.classList.add('hidden');
  }

  /**
   * 혼자 대기 패널을 다시 표시한다(상대 이탈 시 — AI 모드가 아니고 사람일 때만).
   */
  function showAiButton() {
    if (getCurrentMode() === 'ai') return;
    updateWaitingTitle(false);
    if (els.waitingSolo) els.waitingSolo.classList.remove('hidden');
    if (els.btnStartAi) {
      els.btnStartAi.disabled = false;
      els.btnStartAi.textContent = '🤖 AI랑 시작';
    }
  }

  /**
   * 대기 카드 제목을 현재 인원 상태에 맞게 갱신한다.
   * @param {boolean} hasOpponent
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
    if (els.btnReady) els.btnReady.hidden = myReady;
  }

  /**
   * 상대 이탈 배너를 표시한다(자동 사라지지 않음).
   * @param {string} name
   */
  function showOpponentLeftBanner(name) {
    if (els.opponentLeftMsg) {
      els.opponentLeftMsg.textContent = `${name || '상대방'}님이 나갔어요.`;
    }
    if (els.opponentLeftBanner) els.opponentLeftBanner.classList.remove('hidden');
  }

  // ── 네트워크 핸들러 ──────────────────────────────────────────
  const net = createNetwork({
    onOpen: ({ hasName }) => {
      // 닉네임이 없으면(직접 진입) 인라인 게이트를 노출하고 JOIN을 보류한다.
      // ready-panel은 omok 파일럿 패턴에 따라 게이트 중에도 항상 표시한다.
      if (!hasName) {
        if (els.nameGateInline) els.nameGateInline.classList.remove('hidden');
        if (els.waitingSolo) els.waitingSolo.classList.add('hidden');
      }
    },
    onJoined: ({ playerId, waiting, opponentName: oppName }) => {
      myId = playerId;
      els.playerLabel.textContent = `${playerId === 'p1' ? 'P1 (호스트)' : 'P2 (게스트)'}`;

      // 상대 이름 수신 시 갱신 + AI 버튼 소멸(사람 대전 흐름 전환).
      if (oppName) {
        opponentName = oppName;
        updateOpponentInfo();
        hideAiButton();
      }

      els.statusMsg.textContent = (waiting && !oppName) ? '상대방 대기 중' : '게임 시작 준비';

      // 대기 카드 제목: 상대 합류 시 "대전 준비 중".
      updateWaitingTitle(!!oppName || !waiting);

      // 양쪽 입장이면 혼자 대기 패널 숨김.
      if (!waiting || oppName) {
        hideAiButton();
      } else {
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
    onStart: () => {
      pendingKeep = [false, false, false, false, false];
      // 새 게임 시작 — 보너스 감지 캐시 초기화.
      lastMyUpperBonus = 0;
      // 새 게임 — N인 직전 선택 강조 초기화. renderAll에서 모든 셀의 .scored-persistent가 제거된다.
      lastScoredCategoryByPlayer = {};
      for (const pid of playerIds) lastScoredCategoryByPlayer[pid] = null;
      // READY 상태 초기화(다음 리매치 대비).
      myReady = false;
      opponentReady = false;
      // N5: 직전 게임에서 재대결 버튼을 눌렀으면 disabled + '재대결 대기 중...' 상태가 남아 있다.
      // 새 게임 시작 시 초기화하지 않으면 다음 GAME_OVER에서 재대결 버튼이 고착되어 연속 대전이 막힌다.
      els.rematchBtn.disabled = false;
      els.rematchBtn.textContent = '재대결';
      showScreen('game');
      els.screenGameOver.classList.add('hidden');
    },
    onDiceRolled: ({ by, dice, rollCount }) => {
      // 다이스가 굴려진 직후: 토스트로 피드백.
      // 본인 굴림: STATE도 곧 따라오므로 별도 처리 불필요. UX 가독성을 위해 토스트는 1회만.
      const who = by === myId ? '내' : by.toUpperCase();
      // STATE의 keep와 동기화하기 위해 본인 keep 입력을 초기화한다(서버 권위).
      // (다음 STATE 수신 시 pendingKeep = state.keep로 다시 맞춘다.)
      console.log(`[dice] ${who} 굴림 ${rollCount}/3: [${dice.join(',')}]`);
      // 다이스 착지음: playRoll(rattle ~0.4초)이 끝날 무렵에 짧은 "탁" 클릭.
      // 상대 굴림(서버 → broadcast)도 동일하게 들리도록 by 무관 재생.
      setTimeout(() => { playDiceLand(); }, 420);
    },
    onCategoryScored: ({ by, category, scored, yahtzeeBonusAwarded }) => {
      const who = by === myId ? '나' : by.toUpperCase();
      let msg = `${who} → ${category}: ${scored}점`;
      if (yahtzeeBonusAwarded > 0) {
        msg += ` (+야츠 보너스 ${yahtzeeBonusAwarded})`;
      }
      showToast(els.toast, msg);
      // 강조 큐에 저장 → STATE 직후 renderAll로 DOM이 새로 그려지면 그때 .scored-flash 적용.
      // 서버는 CATEGORY_SCORED → broadcastState() 순서로 보내므로 항상 직후에 STATE가 온다.
      pendingFlash = { by, category };
      // 지속 강조 갱신: by별 마지막 선택 카테고리 기록. renderAll에서 셀에 .scored-persistent 부착.
      // 본인이 다시 선택하면 자동으로 새 카테고리로 갱신되어 이전 셀의 강조는 제거된다.
      if (playerIds.includes(by)) {
        lastScoredCategoryByPlayer[by] = category;
      }
      // 점수 효과음: 야츠(첫 50점) 또는 추가 야츠 보너스(+100) → 화려한 아르페지오, 그 외 → 짧은 chime.
      // 보너스(상단 63점 도달)는 STATE 수신 시점에서 별도 감지한다.
      if (category === 'yahtzee' && scored === 50) {
        playYahtzee();
      } else if (yahtzeeBonusAwarded > 0) {
        playYahtzee();
      } else {
        playScore();
      }
    },
    onState: (state) => {
      setState(state);
      // N인 playerIds 갱신 (STATE가 첫 도착할 때 playerIds가 결정된다).
      if (Array.isArray(state.playerIds) && state.playerIds.length >= 2) {
        playerIds = state.playerIds;
      }
      // 서버의 keep를 본 클라이언트의 pendingKeep로 동기화.
      pendingKeep = (state.keep || []).slice();
      // 본인 상단 보너스가 막 달성된 순간(0 → 35) 감지 → 보너스 효과음.
      // upper.{p1|p2}.bonus는 game.js의 upperBonus()가 반환하는 0 또는 35.
      if (myId && state.upper && state.upper[myId]) {
        const curBonus = state.upper[myId].bonus || 0;
        if (lastMyUpperBonus === 0 && curBonus > 0) {
          // playScore가 거의 동시에 울리는 케이스(보너스를 유발한 그 카테고리 기록 직후)도 있어
          // 약간의 stagger를 주어 두 효과음이 겹치지 않게 한다.
          setTimeout(() => { playUpperBonus(); }, 260);
        }
        lastMyUpperBonus = curBonus;
      }
      renderAll();
    },
    onGameOver: (result) => {
      renderGameOver(els, result, myId, playerIds);
      els.screenGameOver.classList.remove('hidden');
      // 본인 승/패/무 효과음. 무승부는 별도 효과음 없음(과한 소리 방지).
      if (result && result.winner) {
        if (result.winner === myId) {
          playWin();
        } else if (result.winner !== 'draw') {
          playLose();
        }
      }
    },
    onOpponentLeft: ({ name, message }) => {
      // 자동 redirect 제거 — 사라지지 않는 배너 + "로비로 돌아가기" 버튼만 표시.
      els.screenGameOver.classList.add('hidden');
      showOpponentLeftBanner(name);
    },
    onRematchStatus: ({ p1Ready, p2Ready }) => {
      const status = `재대결 대기: P1 ${p1Ready ? '✓' : '×'} / P2 ${p2Ready ? '✓' : '×'}`;
      showToast(els.toast, status);
    },
    onError: (message) => {
      showToast(els.toast, message, 'error');
    },
  });

  // ── 전체 렌더 ──────────────────────────────────────────────
  function renderAll() {
    const state = getState();
    if (!state) return;

    renderHud(els, state, myId);

    // 다이스: 본인 턴 + 0 < rollCount < MAX 일 때 keep 토글 가능.
    const myTurn = state.currentTurn === myId && state.phase === 'playing';
    const selectable = myTurn && state.rollCount >= 1 && state.rollCount < MAX_ROLLS_PER_TURN;
    // 상대 keep 시각화: 본인 턴이 아니더라도 state.keep을 그대로 노출(상대가 keep한 다이스 실시간 표시).
    // dice.js 내부에서 selectable=false면 click 비활성 + .die.kept 스타일에 .opponent 보더 색상 적용.
    const drawDice = () => {
      renderDice(els.diceArea, {
        dice: state.dice,
        keep: pendingKeep,
        selectable,
        opponentTurn: !myTurn && state.phase === 'playing',
        // [REROLL-ANIM] 컵 굴림 애니메이션 트리거를 "값 변화"가 아닌 "굴림 이벤트(rollCount 증가)"로 판정하기 위해 전달.
        //  - keep 안 한 다이스가 우연히 직전과 동일 면으로 굴려져도(diceChanged=false) 정상적으로 컵 애니메이션이 발동된다.
        rollCount: state.rollCount,
        // N3: 컵 애니메이션이 완전히 끝나는 시점에 호출된다(dice.js가 _cupTimer를 null로 정리한 직후).
        //  - 여기서 renderAll을 재실행하면 canPreview=!_cupTimer 가 true로 복원되어
        //    사용자 상호작용(keep 토글/다음 STATE) 없이도 컵 착지 즉시 점수 미리보기가 노출된다.
        //  - 재실행 시 dice 값이 동일하므로 dice.js의 rolledNow=false → 컵 애니메이션·onCupDone 재등록 없음(무한 루프 없음).
        onCupDone: () => renderAll(),
        onToggle: (i) => {
          pendingKeep[i] = !pendingKeep[i];
          // 클릭 효과음 (매우 짧은 sine click).
          playKeepToggle();
          // 본인 턴 + 굴림 1회 이상일 때만 서버에 토글 전송 → 상대에게 실시간 동기화.
          // (selectable=true 시점이 곧 본인 턴 + rollCount>=1 + rollCount<MAX 조건과 동치.)
          if (myTurn && state.rollCount >= 1) {
            net.toggleKeep(i, pendingKeep[i]);
          }
          // 다이스만 다시 그리면 충분(점수표 갱신은 불필요).
          drawDice();
        },
      });
    };
    drawDice();

    renderActionBar(els, state, myId);

    // N4: 굴리기 요청 처리 중(컵 애니메이션 진행)이면 버튼을 강제 비활성 유지.
    // STATE가 1ms 이내에 도착해 renderActionBar가 버튼을 복구해도 컵 완료 전까지는 재차 잠근다.
    // onCupDone → renderAll 재진입 시 _cupTimer=null → 플래그 해제, 버튼은 renderActionBar 결과를 따른다.
    if (_rollPending) {
      if (els.diceArea._cupTimer) {
        // 컵 애니메이션 진행 중 — 버튼 강제 비활성.
        els.btnRoll.disabled = true;
      } else {
        // 컵 완료 — 연타 차단 해제 (버튼 상태는 renderActionBar의 canRoll 판정을 유지).
        _rollPending = false;
      }
    }

    // N3: 컵 애니메이션이 진행 중이면 점수 미리보기를 억제한다.
    // dice.js가 컵 흔들기·착지 애니메이션 동안 컨테이너 DOM(els.diceArea)에 _cupTimer를 부착하므로,
    // 그 값이 존재하면 아직 애니메이션 중 → canPreview=false. 완료 후(다음 STATE/keep 토글 시) 자연 복구.
    const canPreview = !els.diceArea._cupTimer;

    renderScoreboard(els.scoreboardBody, {
      myId,
      playerIds,
      currentTurn: state.currentTurn,
      rollCount: state.rollCount,
      dice: state.dice,
      sheets: state.sheets,
      phase: state.phase,
      canPreview,
      onCategoryClick: (cat) => {
        net.scoreCategory(cat);
      },
    });

    // 카테고리 강조 적용: 직전 CATEGORY_SCORED가 큐에 있으면 해당 셀(.score-cell[data-pid][data-category])에
    // .scored-flash 클래스 1.4초간 부여. 본인/상대 모두 동일 강조(시각 피드백 일관성).
    if (pendingFlash) {
      const sel = `.score-cell[data-pid="${pendingFlash.by}"][data-category="${pendingFlash.category}"]`;
      const cell = els.scoreboardBody.querySelector(sel);
      if (cell) {
        // 이미 다른 강조 잔여가 있을 수 있어 한 번 제거 후 재추가(reflow로 애니메이션 재시작).
        cell.classList.remove('scored-flash');
        // void 트릭으로 강제 reflow.
        void cell.offsetWidth;
        cell.classList.add('scored-flash');
        // 1.5초 후 클래스 정리(다음 강조와 잔여 충돌 방지).
        setTimeout(() => { cell.classList.remove('scored-flash'); }, 1500);
      }
      pendingFlash = null;
    }

    // ── 지속 강조(.scored-persistent) 동기화 ──
    // renderScoreboard가 매 렌더마다 셀을 새로 그리므로(셀 객체 교체) 매번 다시 부착해야 한다.
    // 정책: 각 플레이어의 lastScoredCategoryByPlayer[pid] 셀 하나에만 .scored-persistent 부여,
    // 나머지 같은 pid 셀에서는 제거. 새 게임/이탈 시 lastScoredCategoryByPlayer가 null이면 전부 제거.
    for (const pid of playerIds) {
      const targetCat = lastScoredCategoryByPlayer[pid];
      const cells = els.scoreboardBody.querySelectorAll(`.score-cell[data-pid="${pid}"]`);
      cells.forEach((cell) => {
        const cat = cell.getAttribute('data-category');
        if (targetCat && cat === targetCat) {
          cell.classList.add('scored-persistent');
        } else {
          cell.classList.remove('scored-persistent');
        }
      });
    }
  }

  // ── 버튼 이벤트 ──────────────────────────────────────────────
  els.btnReady.addEventListener('click', () => {
    els.btnReady.hidden = true;
    net.sendReady();
  });

  // ── AI랑 시작 ─────────────────────────────────────────────
  els.btnStartAi.addEventListener('click', () => {
    els.btnStartAi.disabled = true;
    els.btnStartAi.textContent = '🤖 AI 호출 중...';
    const name = sessionStorage.getItem('yahtzee:name') || '';
    const base = location.pathname;
    location.href = `${base}?mode=ai&name=${encodeURIComponent(name)}`;
  });

  // ── 상대 이탈 배너 → 로비로 돌아가기 ─────────────────────────
  els.btnBannerReturnLobby.addEventListener('click', () => returnToLobby());

  // ── 인라인 닉네임 게이트(직접 진입 폴백) ────────────────────
  function submitInlineName() {
    const name = (els.inlineNameInput.value || '').trim().slice(0, 12);
    if (!name) {
      els.inlineNameInput.focus();
      return;
    }
    sessionStorage.setItem('yahtzee:name', name);
    els.nameGateInline.classList.add('hidden');
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

  els.btnRoll.addEventListener('click', () => {
    // N4: 앱 레벨 연타 차단 — disabled=true는 DOM 업데이트라
    // native dblclick의 두 번째 click이 실행되기 전에 반영되지 않는다.
    // _rollPending 플래그는 동기적으로 검사되므로 두 번째 ROLL_DICE 전송을 확실히 억제한다.
    if (_rollPending) return;
    const state = getState();
    if (!state) return;
    _rollPending = true;
    els.btnRoll.disabled = true;
    // 1차 굴림은 keep 무시(서버에서 강제). 2/3차는 pendingKeep 전송.
    net.rollDice(pendingKeep.slice());
    // 굴림 효과음(화이트노이즈 rattle ~0.4초). 서버 응답을 기다리지 않고 즉시 재생하여
    // 입력 반응성을 높인다. 다이스 착지음은 onDiceRolled에서 0.42초 뒤 재생.
    playRoll();
  });

  els.rematchBtn.addEventListener('click', () => {
    els.rematchBtn.disabled = true;
    els.rematchBtn.textContent = '재대결 대기 중...';
    net.sendRematch();
  });

  // 런처 통합 모드: 다른 종목 / 게임 선택 → 로비로.
  function returnToLobby() {
    // /yahtzee/... 경로면 launcher가 활성. 단독 실행이면 같은 호스트 루트로.
    const seg = location.pathname.split('/').filter(Boolean)[0] || '';
    // launcher가 /lobby/return POST를 처리하면 양쪽 동시 복귀(RETURN_LOBBY broadcast).
    fetch('/lobby/return', { method: 'POST' })
      .catch(() => { /* noop */ })
      .finally(() => {
        // 단독 실행 시에는 POST가 404이므로 즉시 location 이동.
        if (!seg) {
          location.href = '/';
        }
        // launcher 모드면 RETURN_LOBBY broadcast 수신 후 launcher가 redirect 처리(이 페이지는 그냥 location.href 변경하지 않음).
        // 그러나 명시적 안전망: 1.5초 후에도 이동 안 되면 강제 이동.
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

  // ── 음소거 토글 버튼 ──
  // 클릭마다 muted 반전 + 아이콘 갱신 + 켜질 때만 짧은 click 효과음(첫 인터랙션 시 AudioContext resume 트리거 겸용).
  els.btnMute.addEventListener('click', () => {
    const nowMuted = toggleMuted();
    syncMuteIcon();
    if (!nowMuted) {
      // 음소거 해제 직후: 작동 확인용 짧은 클릭. (muted=true 상태에선 어차피 재생되지 않음.)
      playButtonClick();
    }
  });

  // ── launcher 로비 WS에서 RETURN_LOBBY broadcast 시 자동 redirect ──
  // launcher의 /ws WSS는 본 페이지에서 직접 구독하지 않으므로(게임 WS만 연결),
  // POST /lobby/return 호출 시 자체적으로 redirect는 setTimeout으로 처리한다.

  // ── 시작 ────────────────────────────────────────────────────
  net.connect();
  showScreen('waiting');
});
