/**
 * @fileoverview 하나비 클라이언트 진입점 — 상태 렌더링 + 사용자 입력 조율.
 *
 * 흐름:
 *  1) DOM 준비 → Network 연결 → JOIN
 *  2) JOINED(waiting) → 대기 화면 + 초대 URL
 *  3) START + STATE → 게임 화면 렌더
 *  4) 내 턴: [카드 내기]/[버리기] → 내 손패 카드 선택 → 전송
 *           [힌트 주기] → 색/숫자 선택 → 전송(서버가 상대 손패에 마킹)
 *  5) GAME_OVER → 종료 오버레이(점수·등급·사유) + 재대결 / 다른 종목
 *
 * 서버가 보내는 STATE 필드(snapshotForPlayer): you, currentTurn, phase, tokens{clue,fuse},
 *   fireworks{white,red,blue,green,yellow}, discardPile[], deckSize, lastRoundTurnsLeft,
 *   lastTouch{target,clueType,value,indices}, result, myHand[], opponentHand[].
 */

import { createNetwork } from './network.js';

document.addEventListener('DOMContentLoaded', () => {
  // ── 상수 (game.js / RULEBOOK §2-1 과 동기화) ──
  const COLORS = ['white', 'red', 'blue', 'green', 'yellow'];
  const COLOR_KO = { white: '흰', red: '빨', blue: '파', green: '초', yellow: '노' };
  const COLOR_KO_FULL = { white: '흰색', red: '빨강', blue: '파랑', green: '초록', yellow: '노랑' };
  const TOTAL_CLUE_TOKENS = 8;
  const TOTAL_FUSE_TOKENS = 3;

  // ── DOM 참조 ──
  const els = {
    screenWaiting: document.getElementById('screen-waiting'),
    screenGame: document.getElementById('screen-game'),
    screenGameOver: document.getElementById('screen-game-over'),
    playerLabel: document.getElementById('player-label'),
    statusMsg: document.getElementById('status-msg'),
    turnLabel: document.getElementById('turn-label'),
    scoreLabel: document.getElementById('score-label'),
    invitePanel: document.getElementById('invite-panel'),
    inviteUrl: document.getElementById('invite-url'),
    copyUrlBtn: document.getElementById('copy-url-btn'),
    opponentHand: document.getElementById('opponent-hand'),
    myHand: document.getElementById('my-hand'),
    deckCount: document.getElementById('deck-count'),
    discardCount: document.getElementById('discard-count'),
    clueTokens: document.getElementById('clue-tokens'),
    fuseTokens: document.getElementById('fuse-tokens'),
    fireworksArea: document.getElementById('fireworks-area'),
    discardPile: document.getElementById('discard-pile'),
    actionHint: document.getElementById('action-hint'),
    btnPlay: document.getElementById('btn-play'),
    btnDiscard: document.getElementById('btn-discard'),
    btnClue: document.getElementById('btn-clue'),
    btnCancel: document.getElementById('btn-cancel'),
    cluePanel: document.getElementById('clue-panel'),
    resultOutcome: document.getElementById('result-outcome'),
    resultScore: document.getElementById('result-score'),
    resultGrade: document.getElementById('result-grade'),
    resultReason: document.getElementById('result-reason'),
    rematchBtn: document.getElementById('rematch-btn'),
    toast: document.getElementById('toast'),
  };

  // ── 클라 상태 캐시 ──
  let myId = null;
  let state = null;
  /** 현재 행동 모드: null | 'play' | 'discard'. 카드 선택 대기 상태를 나타낸다. */
  let actionMode = null;

  // ── 토스트 ──
  let toastTimer = null;
  function showToast(message, kind) {
    els.toast.textContent = message;
    els.toast.className = 'toast show' + (kind === 'error' ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.className = 'toast'; }, 2200);
  }

  // ── 화면 전환 ──
  function showScreen(name) {
    els.screenWaiting.classList.toggle('hidden', name !== 'waiting');
    els.screenGame.classList.toggle('hidden', name !== 'game');
  }

  // ── 카드 DOM 생성 ──
  /**
   * 카드 엘리먼트를 만든다.
   * @param {object} card { id, color, number, clues }
   * @param {boolean} hidden 가림 여부(내 손패는 true → 색·숫자 숨김)
   * @param {boolean} touched 직전 힌트가 닿았는지(하이라이트)
   * @returns {HTMLElement}
   */
  function makeCard(card, hidden, touched) {
    const el = document.createElement('div');
    el.className = 'card';
    el.dataset.cardId = card.id;

    if (hidden) {
      // §1, §12-6: 내 손패는 색·숫자를 볼 수 없다 → 가림 표현.
      el.classList.add('card--hidden');
      const mark = document.createElement('div');
      mark.className = 'card-back-mark';
      mark.textContent = '?';
      el.appendChild(mark);
    } else {
      el.classList.add('card--' + card.color);
      const num = document.createElement('div');
      num.className = 'card-number';
      num.textContent = card.number;
      el.appendChild(num);
      const tl = document.createElement('div');
      tl.className = 'card-corner tl';
      tl.textContent = card.number;
      el.appendChild(tl);
      const br = document.createElement('div');
      br.className = 'card-corner br';
      br.textContent = card.number;
      el.appendChild(br);
    }

    // 받은 힌트 마킹(누적). 본인/상대 모두 표시(§13-4).
    const clues = card.clues || [];
    if (clues.length > 0) {
      const wrap = document.createElement('div');
      wrap.className = 'card-clues';
      // 중복 제거: 같은 속성을 여러 번 받았어도 한 번만 표시.
      const seen = new Set();
      for (const c of clues) {
        const key = c.type + ':' + c.value;
        if (seen.has(key)) continue;
        seen.add(key);
        const m = document.createElement('span');
        if (c.type === 'color') {
          m.className = 'clue-mark clue-color cm-' + c.value;
          m.textContent = COLOR_KO[c.value] || c.value;
        } else {
          m.className = 'clue-mark';
          m.textContent = c.value;
        }
        wrap.appendChild(m);
      }
      el.appendChild(wrap);
    }

    if (touched) el.classList.add('touched');
    return el;
  }

  // ── 손패 렌더 ──
  function renderHands() {
    const lastTouch = state.lastTouch;
    // 상대 손패(공개).
    els.opponentHand.innerHTML = '';
    (state.opponentHand || []).forEach((card, i) => {
      // 직전 힌트는 "내가 상대에게 준 힌트"가 상대 손패에 닿았을 때 강조한다.
      const opponentId = myId === 'p1' ? 'p2' : 'p1';
      const touched = !!(lastTouch && lastTouch.target === opponentId
        && lastTouch.indices && lastTouch.indices.includes(i));
      els.opponentHand.appendChild(makeCard(card, false, touched));
    });

    // 내 손패(가림 + 힌트 마킹).
    els.myHand.innerHTML = '';
    const selectable = (actionMode === 'play' || actionMode === 'discard');
    els.myHand.classList.toggle('selectable', selectable);
    (state.myHand || []).forEach((card, i) => {
      // 상대가 내게 준 힌트가 닿은 카드 강조.
      const touched = !!(lastTouch && lastTouch.target === myId
        && lastTouch.indices && lastTouch.indices.includes(i));
      const el = makeCard(card, true, touched);
      if (selectable) {
        el.addEventListener('click', () => onMyCardClick(i, el));
      }
      els.myHand.appendChild(el);
    });
  }

  // ── 토큰 렌더 ──
  function renderTokens() {
    const clue = state.tokens.clue;
    const fuse = state.tokens.fuse;
    els.clueTokens.innerHTML = '';
    for (let i = 0; i < TOTAL_CLUE_TOKENS; i++) {
      const t = document.createElement('div');
      t.className = 'token ' + (i < clue ? 'token--clue' : 'token--spent');
      els.clueTokens.appendChild(t);
    }
    els.fuseTokens.innerHTML = '';
    for (let i = 0; i < TOTAL_FUSE_TOKENS; i++) {
      const t = document.createElement('div');
      t.className = 'token ' + (i < fuse ? 'token--fuse' : 'token--spent');
      els.fuseTokens.appendChild(t);
    }
  }

  // ── 불꽃 진행 렌더 ──
  function renderFireworks() {
    els.fireworksArea.innerHTML = '';
    for (const color of COLORS) {
      const n = state.fireworks[color] || 0;
      const slot = document.createElement('div');
      slot.className = 'firework-slot firework-slot--' + color
        + (n > 0 ? ' lit' : '') + (n === 5 ? ' complete' : '');

      const num = document.createElement('div');
      if (n > 0) {
        num.className = 'firework-number';
        num.textContent = n;
      } else {
        num.className = 'firework-empty';
        num.textContent = '–';
      }
      slot.appendChild(num);

      // 1~5 진행 핍(점)으로 남은 단계를 직관 표시.
      const pips = document.createElement('div');
      pips.className = 'firework-pips';
      for (let k = 1; k <= 5; k++) {
        const p = document.createElement('div');
        p.className = 'firework-pip' + (k <= n ? ' on' : '');
        pips.appendChild(p);
      }
      slot.appendChild(pips);

      const name = document.createElement('div');
      name.className = 'firework-color-name';
      name.textContent = COLOR_KO_FULL[color];
      slot.appendChild(name);

      els.fireworksArea.appendChild(slot);
    }
  }

  // ── 버림 더미 렌더 ──
  function renderDiscard() {
    const pile = state.discardPile || [];
    els.discardCount.textContent = pile.length;
    els.discardPile.innerHTML = '';
    if (pile.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'discard-empty';
      empty.textContent = '아직 버린 카드가 없습니다.';
      els.discardPile.appendChild(empty);
      return;
    }
    for (const c of pile) {
      const chip = document.createElement('span');
      chip.className = 'discard-chip card--' + c.color;
      chip.textContent = (COLOR_KO[c.color] || '') + c.number;
      els.discardPile.appendChild(chip);
    }
  }

  // ── 행동 버튼 상태 갱신 ──
  function renderActions() {
    const myTurn = state.currentTurn === myId && state.phase === 'playing';
    const clue = state.tokens.clue;

    if (actionMode) {
      // 카드 선택 모드: 안내 + 취소만.
      els.actionHint.textContent = actionMode === 'play'
        ? '내 손패에서 낼 카드를 클릭하세요.'
        : '내 손패에서 버릴 카드를 클릭하세요.';
      els.btnPlay.classList.add('hidden');
      els.btnDiscard.classList.add('hidden');
      els.btnClue.classList.add('hidden');
      els.btnCancel.classList.remove('hidden');
      els.cluePanel.classList.add('hidden');
      return;
    }

    els.btnPlay.classList.remove('hidden');
    els.btnDiscard.classList.remove('hidden');
    els.btnClue.classList.remove('hidden');
    els.btnCancel.classList.add('hidden');

    els.btnPlay.disabled = !myTurn;
    // §13-5: 힌트 토큰이 가득(8)이면 버리기 불가.
    els.btnDiscard.disabled = !myTurn || clue >= TOTAL_CLUE_TOKENS;
    // §5-2: 힌트 토큰이 0이면 힌트 불가.
    els.btnClue.disabled = !myTurn || clue === 0;

    if (!myTurn) {
      els.actionHint.textContent = '상대 턴입니다. 잠시 기다려 주세요.';
    } else {
      let hint = '당신의 턴입니다. 행동을 선택하세요.';
      if (clue === 0) hint += ' (힌트 토큰 없음)';
      if (clue >= TOTAL_CLUE_TOKENS) hint += ' (힌트 가득 — 버리기 불가)';
      els.actionHint.textContent = hint;
    }
  }

  // ── 전체 게임 화면 렌더 ──
  function renderGame() {
    if (!state) return;
    showScreen('game');
    const score = COLORS.reduce((s, c) => s + (state.fireworks[c] || 0), 0);
    els.scoreLabel.textContent = score;
    els.deckCount.textContent = state.deckSize;
    els.turnLabel.textContent = state.currentTurn === myId ? '내 차례' : '상대 차례';
    els.statusMsg.textContent = state.lastRoundTurnsLeft !== null
      ? `덱 소진! 마지막 라운드 (남은 턴 ${state.lastRoundTurnsLeft})`
      : '게임 진행 중';
    renderHands();
    renderTokens();
    renderFireworks();
    renderDiscard();
    renderActions();
  }

  // ── 내 손패 카드 클릭(내기/버리기 확정) ──
  function onMyCardClick(handIndex, cardEl) {
    if (!actionMode) return;
    if (state.currentTurn !== myId) {
      showToast('상대 턴입니다.', 'error');
      return;
    }
    // 시각 피드백 후 전송.
    cardEl.classList.add('selected');
    if (actionMode === 'play') {
      net.playCard(handIndex);
    } else if (actionMode === 'discard') {
      net.discardCard(handIndex);
    }
    actionMode = null; // STATE 수신 시 갱신되지만 즉시 모드 해제.
  }

  // ── 행동 모드 진입/해제 ──
  function enterActionMode(mode) {
    if (state.currentTurn !== myId) {
      showToast('상대 턴입니다.', 'error');
      return;
    }
    actionMode = mode;
    els.cluePanel.classList.add('hidden');
    renderGame();
  }
  function cancelActionMode() {
    actionMode = null;
    els.cluePanel.classList.add('hidden');
    renderGame();
  }

  // ── 종료 화면 ──
  function renderGameOver(result) {
    actionMode = null;
    els.cluePanel.classList.add('hidden');
    const outcome = result.outcome === 'win' ? '승리!' : '게임 종료';
    els.resultOutcome.textContent = outcome;
    els.resultOutcome.className = 'result-outcome ' + (result.outcome === 'win' ? 'win' : 'lose');
    els.resultScore.textContent = `${result.score}점`;
    els.resultGrade.textContent = result.grade || '';
    // §13-6: 폭탄 3소진 패배는 "실패" 라벨 + 현재 점수.
    const reasonText = {
      perfect: '5색 불꽃 완성 — 25점 만점!',
      fuse: '폭탄 토큰 3개 소진 — 실패',
      deck_end: '덱 소진 — 마지막 라운드 종료',
    };
    els.resultReason.textContent = reasonText[result.reason] || '';
    els.rematchBtn.disabled = false;
    els.rematchBtn.textContent = '재대결';
    els.screenGameOver.classList.remove('hidden');
  }

  // ── 초대 URL 패널 ──
  function showInvitePanel(hostUrl) {
    if (!hostUrl) { els.invitePanel.classList.add('hidden'); return; }
    els.inviteUrl.textContent = hostUrl;
    els.invitePanel.classList.remove('hidden');
  }
  els.copyUrlBtn.addEventListener('click', () => {
    const text = els.inviteUrl.textContent || '';
    if (navigator.clipboard && text) {
      navigator.clipboard.writeText(text)
        .then(() => showToast('주소를 복사했습니다.'))
        .catch(() => showToast('복사 실패 — 직접 선택해 주세요.', 'error'));
    }
  });

  // 입장 닉네임은 1회만 생성하여 재연결 시에도 유지한다.
  const playerName = `Player-${Math.floor(Math.random() * 1000)}`;

  // ── 네트워크 핸들러 ──
  const net = createNetwork({
    // WS open 직후 JOIN 전송(고정 타이머 race 방지).
    onOpen: () => { net.join(playerName); },
    onJoined: ({ playerId, waiting, hostUrl }) => {
      myId = playerId;
      els.playerLabel.textContent = playerId === 'p1' ? '나 (P1, 선공)' : '나 (P2, 후공)';
      if (waiting) {
        showScreen('waiting');
        els.statusMsg.textContent = '상대방 대기 중';
        showInvitePanel(hostUrl);
      } else {
        els.statusMsg.textContent = '상대 입장 완료';
      }
    },
    onStart: () => {
      els.screenGameOver.classList.add('hidden');
      actionMode = null;
      showScreen('game');
    },
    onState: (s) => {
      state = s;
      // 종료 상태로 STATE가 와도 게임 화면을 먼저 갱신(점수 반영).
      renderGame();
      // 카운터 모달이 열려있으면 새 STATE 기준으로 즉시 재렌더(HR-C12-008).
      if (typeof window.__hanabiRefreshCounter === 'function') {
        window.__hanabiRefreshCounter();
      }
      if (s.phase === 'ended' && s.result) {
        renderGameOver(s.result);
      }
    },
    onGameOver: (result) => {
      renderGameOver(result);
    },
    onOpponentLeft: (message) => {
      showToast(message, 'error');
      // 런처 모드에서는 상대 이탈 시 로비로 자동 복귀(yutnori 패턴).
      if (window.location.pathname.startsWith('/hanabi/')) {
        setTimeout(() => { window.location.href = '/'; }, 1500);
      } else {
        showScreen('waiting');
        els.statusMsg.textContent = '상대방 대기 중';
      }
    },
    onRematchStatus: ({ p1Ready, p2Ready }) => {
      const myReady = (myId === 'p1' && p1Ready) || (myId === 'p2' && p2Ready);
      const oppReady = (myId === 'p1' && p2Ready) || (myId === 'p2' && p1Ready);
      showToast(`재대결 대기: 나 ${myReady ? '완료' : '대기'} / 상대 ${oppReady ? '완료' : '대기'}`);
    },
    onError: (message) => {
      showToast(message, 'error');
      console.warn('[main] 서버 오류:', message);
    },
  });

  // ── 행동 버튼 이벤트 ──
  els.btnPlay.addEventListener('click', () => enterActionMode('play'));
  els.btnDiscard.addEventListener('click', () => enterActionMode('discard'));
  els.btnCancel.addEventListener('click', cancelActionMode);
  els.btnClue.addEventListener('click', () => {
    if (state.currentTurn !== myId) { showToast('상대 턴입니다.', 'error'); return; }
    // 카드 선택 모드를 해제한 뒤 힌트 패널을 토글한다.
    const wasOpen = !els.cluePanel.classList.contains('hidden');
    actionMode = null;
    renderActions(); // 버튼 표시 상태만 갱신(renderGame은 cluePanel을 항상 닫으므로 미사용).
    els.cluePanel.classList.toggle('hidden', wasOpen);
  });

  // 힌트 색/숫자 버튼(이벤트 위임).
  els.cluePanel.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-clue-type]');
    if (!btn) return;
    if (state.currentTurn !== myId) { showToast('상대 턴입니다.', 'error'); return; }
    const clueType = btn.dataset.clueType;
    const raw = btn.dataset.clueValue;
    const value = clueType === 'number' ? parseInt(raw, 10) : raw;
    net.giveClue(clueType, value);
    els.cluePanel.classList.add('hidden');
  });

  // ── 재대결 버튼 ──
  els.rematchBtn.addEventListener('click', () => {
    net.sendRematch();
    els.rematchBtn.disabled = true;
    els.rematchBtn.textContent = '재대결 대기 중';
  });

  // ── 로비 복귀 버튼(종료 화면) ──
  const returnLobbyBtn = document.getElementById('btn-return-lobby');
  if (returnLobbyBtn) {
    returnLobbyBtn.addEventListener('click', () => {
      fetch('/lobby/return', { method: 'POST' }).catch(() => {});
      location.href = '/';
    });
  }

  // ── 상시 뒤로가기 버튼(게임 중 로비 복귀) ──
  const backToLobbyBtn = document.getElementById('btn-back-to-lobby');
  if (backToLobbyBtn) {
    backToLobbyBtn.addEventListener('click', () => {
      if (!confirm('게임을 중단하고 게임 선택 화면으로 돌아가시겠어요? 상대방도 함께 로비로 이동합니다.')) return;
      fetch('/lobby/return', { method: 'POST' }).catch(() => {});
      location.href = '/';
    });
  }

  // ── 가이드 슬라이더 초기화 ──────────────────────────────────────
  /**
   * 대기 화면 룰 가이드 슬라이더를 초기화하고 이벤트를 등록한다.
   * 7장 인포그래픽(public/assets/guide/1.png~7.png)을 좌/우 버튼·키보드·터치 스와이프로 탐색한다.
   * 화면 전환과 무관하게 1회만 초기화하며 현재 인덱스를 유지한다.
   */
  (function initGuideSlider() {
    const TOTAL = 7;
    let current = 0; // 0-based 인덱스

    const imgEl     = document.getElementById('guide-img');
    const prevBtn   = document.getElementById('guide-prev');
    const nextBtn   = document.getElementById('guide-next');
    const indicator = document.getElementById('guide-indicator');
    const sliderEl  = document.getElementById('guide-slider');

    if (!imgEl || !prevBtn || !nextBtn || !indicator) return;

    /** 슬라이더 UI를 현재 인덱스에 맞게 갱신한다. */
    function updateSlider() {
      imgEl.src = `assets/guide/${current + 1}.png`;
      imgEl.alt = `하나비 룰 가이드 ${current + 1}/${TOTAL}`;
      indicator.textContent = `${current + 1} / ${TOTAL}`;
      prevBtn.disabled = current === 0;
      nextBtn.disabled = current === TOTAL - 1;
    }

    prevBtn.addEventListener('click', () => {
      if (current > 0) { current--; updateSlider(); }
    });
    nextBtn.addEventListener('click', () => {
      if (current < TOTAL - 1) { current++; updateSlider(); }
    });

    // 키보드 탐색 — 대기 화면이 보이고 모달이 닫혀 있을 때만 동작.
    // (모달이 열려 있으면 modal의 키 가드가 처리하므로 인라인 슬라이더는 중복 이동을 회피한다.)
    document.addEventListener('keydown', (e) => {
      if (els.screenWaiting.classList.contains('hidden')) return;
      const modalEl = document.getElementById('guide-modal');
      if (modalEl && !modalEl.classList.contains('hidden')) return;
      if (e.key === 'ArrowLeft' && current > 0) {
        current--; updateSlider();
      } else if (e.key === 'ArrowRight' && current < TOTAL - 1) {
        current++; updateSlider();
      }
    });

    // 터치 스와이프 (50px 임계값 — yutnori/matgo 관례).
    let touchStartX = 0;
    sliderEl.addEventListener('touchstart', (e) => {
      touchStartX = e.changedTouches[0].clientX;
    }, { passive: true });
    sliderEl.addEventListener('touchend', (e) => {
      const dx = e.changedTouches[0].clientX - touchStartX;
      if (dx < -50 && current < TOTAL - 1) { current++; updateSlider(); }
      if (dx >  50 && current > 0)         { current--; updateSlider(); }
    }, { passive: true });

    updateSlider(); // 초기 렌더
  })();

  // ── 가이드 모달 초기화 ─────────────────────────────────────────
  /**
   * 헤더의 📖 가이드 버튼으로 호출되는 모달 슬라이더를 초기화한다.
   * 대기 화면의 인라인 슬라이더(`initGuideSlider`)와 **독립된 인덱스**를 가지며,
   * 게임 진행 중에도 룰 가이드를 다시 볼 수 있게 해준다.
   *
   * 키보드 가드:
   *  - 인라인 슬라이더: "대기 화면이 보이고 모달이 닫혀 있을 때"만 ←/→ 동작 (기존 가드에 모달 추가 가드 병합).
   *  - 모달 슬라이더: "모달이 열려 있을 때"만 ←/→ 동작 + ESC로 닫힘.
   */
  (function initGuideModal() {
    const TOTAL = 7;
    let current = 0; // 0-based 인덱스 (모달 독립 상태)

    const modalEl   = document.getElementById('guide-modal');
    const openBtn   = document.getElementById('btn-open-guide');
    const closeBtn  = document.getElementById('guide-modal-close');
    const imgEl     = document.getElementById('guide-modal-img');
    const prevBtn   = document.getElementById('guide-modal-prev');
    const nextBtn   = document.getElementById('guide-modal-next');
    const indicator = document.getElementById('guide-modal-indicator');

    if (!modalEl || !openBtn || !closeBtn || !imgEl || !prevBtn || !nextBtn || !indicator) return;

    /** 모달 슬라이더 UI를 현재 인덱스에 맞게 갱신한다. */
    function updateModal() {
      imgEl.src = `assets/guide/${current + 1}.png`;
      imgEl.alt = `하나비 룰 가이드 ${current + 1}/${TOTAL}`;
      indicator.textContent = `${current + 1} / ${TOTAL}`;
      prevBtn.disabled = current === 0;
      nextBtn.disabled = current === TOTAL - 1;
    }

    /** 모달을 연다 — 인덱스를 1페이지로 리셋한다. */
    function openModal() {
      current = 0;
      updateModal();
      modalEl.classList.remove('hidden');
    }

    /** 모달을 닫는다. */
    function closeModal() {
      modalEl.classList.add('hidden');
    }

    openBtn.addEventListener('click', openModal);
    closeBtn.addEventListener('click', closeModal);

    // 백드롭 클릭(카드 외부)으로 닫기 — 카드 내부 클릭은 modalEl이 아닌 자식에서 stop된다.
    modalEl.addEventListener('click', (e) => {
      if (e.target === modalEl) closeModal();
    });

    prevBtn.addEventListener('click', () => {
      if (current > 0) { current--; updateModal(); }
    });
    nextBtn.addEventListener('click', () => {
      if (current < TOTAL - 1) { current++; updateModal(); }
    });

    // 키보드 — 모달이 열려있을 때만 동작 (게임 중 키 누수 방지).
    document.addEventListener('keydown', (e) => {
      if (modalEl.classList.contains('hidden')) return;
      if (e.key === 'Escape') {
        closeModal();
      } else if (e.key === 'ArrowLeft' && current > 0) {
        current--; updateModal();
      } else if (e.key === 'ArrowRight' && current < TOTAL - 1) {
        current++; updateModal();
      }
    });
  })();

  // ── 카운터 모달 초기화 ─────────────────────────────────────────
  /**
   * 헤더의 🃏 분포 버튼으로 호출되는 "안 보이는 카드 분포 카운터" 모달을 초기화한다.
   *
   * 표시 대상:
   *  - **안 보이는 영역(덱 + 본인 손패)** 에 남아 있는 색×숫자별 카드 수
   *  - 보이는 영역(상대 손패 · 불꽃 · 버림 더미)을 표준 분포에서 차감한 값
   *
   * 정보 공정성(§1, §13 손패 가림 원칙):
   *  - 본인 손패의 색·숫자를 직접 표시하지 않으므로 가림 정체성이 깨지지 않는다.
   *  - 표준 하나비 디지털 도구(BoardGameArena, Hanab.live 등)에서도 동일 정보를 제공한다.
   *
   * 재계산 트리거:
   *  - 모달을 열 때(초기 렌더)
   *  - STATE 수신 시(`renderGame()`에서 호출). 모달이 열려있지 않으면 비용 없이 종료.
   */
  (function initCounterModal() {
    /** 표준 하나비 1색당 분포(§2-1): 1→3, 2→2, 3→2, 4→2, 5→1. 색당 10장 × 5색 = 50장. */
    const INITIAL_COUNTS = { 1: 3, 2: 2, 3: 2, 4: 2, 5: 1 };

    const modalEl     = document.getElementById('counter-modal');
    const openBtn     = document.getElementById('btn-open-counter');
    const closeBtn    = document.getElementById('counter-modal-close');
    const gridEl      = document.getElementById('counter-grid');
    const deckCountEl = document.getElementById('counter-deck-count');
    const totalEl     = document.getElementById('counter-hidden-total');

    if (!modalEl || !openBtn || !closeBtn || !gridEl || !deckCountEl || !totalEl) return;

    /**
     * 안 보이는 영역(덱 + 본인 손패)의 색×숫자별 카운트를 계산한다.
     *
     * 알고리즘:
     *  1) `INITIAL_COUNTS`로 5색 × 5숫자 격자를 초기화(각 색당 합 10장).
     *  2) `state.fireworks[color]`(완성 숫자 max) → 1..max까지 각 1장씩 차감.
     *  3) `state.discardPile` 전체 차감(공개 카드).
     *  4) `state.opponentHand` 차감(공개 카드 — 본인은 상대 손패의 색·숫자를 안다).
     *
     * 본인 손패(`state.myHand`)는 색·숫자가 마스킹돼 있으므로 차감하지 않는다 →
     * 결과 = "내 손패 + 덱"에 분포된 카드 수의 합과 정확히 일치.
     *
     * @param {object} st 서버에서 받은 STATE(snapshotForPlayer)
     * @returns {{counts: object, totalHidden: number, deckSize: number}} 색별 카운트 + 합계 + 덱 크기
     */
    function computeHiddenCounts(st) {
      const counts = {};
      for (const c of COLORS) {
        counts[c] = {};
        for (let n = 1; n <= 5; n++) counts[c][n] = INITIAL_COUNTS[n];
      }
      // fireworks: 색별 완성 숫자(max). 1~max까지 각 1장씩 보이는 카드.
      const fw = st.fireworks || {};
      for (const c of COLORS) {
        const max = fw[c] || 0;
        for (let n = 1; n <= max; n++) {
          counts[c][n] = Math.max(0, counts[c][n] - 1);
        }
      }
      // discardPile: 모든 카드 색·숫자 공개.
      for (const card of (st.discardPile || [])) {
        if (card && card.color && card.number) {
          counts[card.color][card.number] = Math.max(0, counts[card.color][card.number] - 1);
        }
      }
      // opponentHand: 상대 손패는 본인이 색·숫자 안다.
      for (const card of (st.opponentHand || [])) {
        if (card && card.color && card.number) {
          counts[card.color][card.number] = Math.max(0, counts[card.color][card.number] - 1);
        }
      }
      // 합계 계산.
      let total = 0;
      for (const c of COLORS) {
        for (let n = 1; n <= 5; n++) total += counts[c][n];
      }
      return { counts, totalHidden: total, deckSize: st.deckSize || 0 };
    }

    /**
     * 카운터 그리드 DOM을 현재 STATE 기반으로 다시 그린다.
     * 모달이 열려 있지 않으면 호출되지 않는다(외부 가드).
     */
    function renderCounterGrid() {
      if (!state) {
        // STATE 수신 전이면 그리드는 비워두고 합계만 0으로 표시.
        gridEl.innerHTML = '';
        deckCountEl.textContent = '0';
        totalEl.textContent = '0';
        return;
      }
      const { counts, totalHidden, deckSize } = computeHiddenCounts(state);

      // 그리드 재구성 — DOM 단순 재생성(50셀 + 헤더, 비용 무시 가능).
      gridEl.innerHTML = '';

      // 1행: 헤더(빈칸 + 숫자 1..5)
      const corner = document.createElement('div');
      corner.className = 'counter-grid-head';
      corner.textContent = '';
      gridEl.appendChild(corner);
      for (let n = 1; n <= 5; n++) {
        const h = document.createElement('div');
        h.className = 'counter-grid-head';
        h.textContent = n;
        gridEl.appendChild(h);
      }

      // 색 행 5개 × 숫자 셀 5개
      for (const color of COLORS) {
        const label = document.createElement('div');
        label.className = 'counter-grid-rowlabel card--' + color;
        label.textContent = COLOR_KO[color] || color;
        label.title = COLOR_KO_FULL[color] || color;
        gridEl.appendChild(label);

        for (let n = 1; n <= 5; n++) {
          const cell = document.createElement('div');
          cell.className = 'counter-cell' + (counts[color][n] === 0 ? ' counter-cell--zero' : '');
          cell.dataset.color = color;
          cell.dataset.number = String(n);
          cell.dataset.count = String(counts[color][n]);

          const cnt = document.createElement('div');
          cnt.className = 'counter-cell-count';
          cnt.textContent = counts[color][n];
          cell.appendChild(cnt);

          // 초기 분포 표기 (예: "/3") — 디지털 도구 관례.
          const init = document.createElement('div');
          init.className = 'counter-cell-initial';
          init.textContent = '/ ' + INITIAL_COUNTS[n];
          cell.appendChild(init);

          gridEl.appendChild(cell);
        }
      }

      deckCountEl.textContent = String(deckSize);
      totalEl.textContent = String(totalHidden);
    }

    /** 모달을 연다 — 최신 STATE 기준으로 즉시 재계산. */
    function openModal() {
      renderCounterGrid();
      modalEl.classList.remove('hidden');
    }

    /** 모달을 닫는다. */
    function closeModal() {
      modalEl.classList.add('hidden');
    }

    openBtn.addEventListener('click', openModal);
    closeBtn.addEventListener('click', closeModal);

    // 백드롭(카드 외부) 클릭으로 닫기 — 가이드 모달과 동일 패턴(HR-C11B-004).
    modalEl.addEventListener('click', (e) => {
      if (e.target === modalEl) closeModal();
    });

    // ESC 키로 닫기 — 모달이 열려있을 때만 동작(게임 중 키 누수 방지, HR-C11B 패턴).
    document.addEventListener('keydown', (e) => {
      if (modalEl.classList.contains('hidden')) return;
      if (e.key === 'Escape') closeModal();
    });

    // STATE 수신 시 자동 재렌더를 위해 전역 핸들 노출.
    // (외부 onState 콜백에서 호출 — 모달이 닫혀 있으면 비용 없이 종료.)
    window.__hanabiRefreshCounter = function refreshCounterIfOpen() {
      if (modalEl.classList.contains('hidden')) return;
      renderCounterGrid();
    };
  })();

  // ── 시작 ──
  // JOIN은 network.js의 onOpen 콜백에서 자동 전송된다(연결 race 방지).
  showScreen('waiting');
  net.connect();

  console.log('[main] 초기화 완료');
});
