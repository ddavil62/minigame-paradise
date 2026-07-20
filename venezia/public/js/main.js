/**
 * @fileoverview 베네치아 타이핑 배틀 클라이언트 진입점.
 *
 * 흐름:
 *  1) DOM 준비 → 대기 화면 표시
 *  2) 닉네임 입력 + 입장 → WS 연결 → JOIN 전송
 *  3) JOINED(waiting=false) → GAME_START → 게임 화면
 *  4) WORD_ADDED → Canvas에 단어 추가
 *  5) 입력 → 타겟 매칭 → WORD_SUBMIT 전송
 *  6) WORD_CLEARED → 단어 제거·콤보 동기화
 *  7) GAME_OVER → 결과 화면
 *  8) 리매치 / 로비 복귀
 */

import { createNetwork } from './network.js';
import { createRenderer } from './render.js';
import { createInputHandler } from './input.js';
import { getItemSlotIndex } from './item-controls.js';
import { getItemPresentation, t } from './i18n.js';

document.addEventListener('DOMContentLoaded', () => {
  // ── DOM 참조 ────────────────────────────────────────────────
  const screenWaiting = document.getElementById('screen-waiting');
  const screenGame = document.getElementById('screen-game');
  const screenResult = document.getElementById('screen-result');

  // 대기 화면
  const inputName = document.getElementById('input-name');
  const btnJoin = document.getElementById('btn-join');
  const btnAi = document.getElementById('btn-ai');
  const waitingStatus = document.getElementById('waiting-status');
  const hostUrlEl = document.getElementById('host-url');

  // 게임 화면
  const myNameLabel = document.getElementById('my-name-label');
  const oppNameLabel = document.getElementById('opp-name-label');
  const myHpFill = document.getElementById('my-hp-fill');
  const oppHpFill = document.getElementById('opp-hp-fill');
  const myHpValue = document.getElementById('my-hp-value');
  const oppHpValue = document.getElementById('opp-hp-value');
  const timerDisplay = document.getElementById('timer-display');
  const difficultyDisplay = document.getElementById('difficulty-display');
  const gameCanvas = document.getElementById('game-canvas');
  const oppCanvas = document.getElementById('opp-canvas');
  const inputWord = document.getElementById('input-word');
  const btnSubmit = document.getElementById('btn-submit');
  const btnBackToLobby = document.getElementById('btn-back-to-lobby');
  const itemGuide = document.getElementById('item-guide');

  // 결과 화면
  const resultTitle = document.getElementById('result-title');
  const resultDetail = document.getElementById('result-detail');
  const btnRematch = document.getElementById('btn-rematch');
  const btnLobby = document.getElementById('btn-lobby');

  // ── 상태 ────────────────────────────────────────────────────
  let myId = null;
  let myName = '';
  let opponentName = '';
  let gameStartedAt = 0;
  let timerInterval = null;
  let itemUsePending = false;

  /** 서버의 ITEM_SLOTS_SYNC로만 교체하는 권위 아이템 슬롯 배열. */
  const itemSlots = [null, null, null];
  const effectOverlay = document.getElementById('effect-overlay');
  const fastFallOverlayMy = document.getElementById('fast-fall-overlay-my');
  const fastFallOverlayOpp = document.getElementById('fast-fall-overlay-opp');
  const shieldIndicatorEl = document.getElementById('shield-indicator');

  // ── 렌더러 ──────────────────────────────────────────────────
  const renderer = createRenderer(gameCanvas);
  /** 상대방 단어 낙하 캔버스 렌더러 */
  const oppRenderer = createRenderer(oppCanvas);

  // ── 네트워크 ────────────────────────────────────────────────
  const net = createNetwork({
    onOpen() {
      console.log('[main] WS 연결됨');
    },

    onClose() {
      itemUsePending = false;
    },

    onJoined(msg) {
      myId = msg.playerId;
      if (msg.waiting) {
        waitingStatus.classList.remove('hidden');
        if (msg.hostUrl) {
          hostUrlEl.textContent = `접속 URL: ${msg.hostUrl}`;
        }
      } else {
        // 양쪽 입장 완료 — 게임 시작 대기
        waitingStatus.classList.remove('hidden');
        waitingStatus.querySelector('p').textContent = '곧 게임이 시작됩니다...';
      }
    },

    onGameStart(msg) {
      gameStartedAt = Date.now();
      showScreen('game');
      renderer.setGameStartedAt(gameStartedAt);
      renderer.clear();
      renderer.start();
      oppRenderer.setGameStartedAt(gameStartedAt);
      oppRenderer.clear();
      oppRenderer.start();
      inputHandler.focus();
      startTimer();
      updateHp(100, 100);
      // 아이템 슬롯 초기화
      itemSlots.fill(null);
      itemUsePending = false;
      renderItemSlots();
      effectOverlay.classList.add('hidden');
      effectOverlay.classList.remove('dark-active');
      fastFallOverlayMy.classList.add('hidden');
      fastFallOverlayOpp.classList.add('hidden');
      shieldIndicatorEl.classList.add('hidden');
    },

    onState(msg) {
      if (!msg.players) return;
      const me = msg.players.find((p) => p.id === myId);
      const opp = msg.players.find((p) => p.id !== myId);
      if (me && opp) {
        myNameLabel.textContent = me.name || '나';
        oppNameLabel.textContent = opp.name || '상대';
        myName = me.name;
        opponentName = opp.name;
        updateHp(me.hp, opp.hp);
      }
      if (msg.difficulty) {
        const diffNames = { easy: '초급', medium: '중급', hard: '고급' };
        difficultyDisplay.textContent = `난이도: ${diffNames[msg.difficulty] || '초급'}`;
      }
      // 단어 동기화 (STATE에 myWords, oppWords 포함)
      if (msg.myWords) {
        renderer.setWords(msg.myWords);
      }
      if (msg.oppWords) {
        oppRenderer.setWords(msg.oppWords);
      }
      if (msg.fallClocks && myId) {
        const opponentId = myId === 'p1' ? 'p2' : 'p1';
        renderer.setFallClock(msg.fallClocks[myId]);
        oppRenderer.setFallClock(msg.fallClocks[opponentId]);
      }
    },

    onWordAdded(word) {
      renderer.addWord(word);
    },

    onWordCleared(msg) {
      renderer.removeWord(msg.wordId);
      inputHandler.clear();
    },

    onWordsExpired(wordIds, oppWordIds) {
      renderer.removeWords(wordIds);
      if (oppWordIds && oppWordIds.length > 0) {
        oppRenderer.removeWords(oppWordIds);
      }
    },

    onOppWordAdded(word) {
      oppRenderer.addWord(word);
    },

    onOppWordCleared(wordId) {
      oppRenderer.removeWord(wordId);
    },

    onGameOver(msg) {
      renderer.stop();
      oppRenderer.stop();
      stopTimer();
      showScreen('result');

      const isWinner = msg.winner === myId;
      resultTitle.textContent = isWinner ? '승리!' : '패배...';
      // 승리: 금색, 패배: 빨간색
      resultTitle.style.color = isWinner
        ? 'var(--accent-gold-light)'
        : 'var(--hp-red)';
      resultDetail.textContent = `내 HP: ${msg.myHp} | 상대 HP: ${msg.opponentHp}`;
    },

    onRematchWaiting() {
      // 상대가 리매치 요청 — 버튼을 활성화하여 수락 유도
      btnRematch.textContent = '상대가 기다리는 중! 클릭하여 수락';
      btnRematch.disabled = false;
    },

    onRematchStart() {
      // 새 게임 — 리셋
      btnRematch.textContent = '한 판 더';
      btnRematch.disabled = false;
      gameStartedAt = Date.now();
      showScreen('game');
      renderer.setGameStartedAt(gameStartedAt);
      renderer.clear();
      renderer.start();
      oppRenderer.setGameStartedAt(gameStartedAt);
      oppRenderer.clear();
      oppRenderer.start();
      inputHandler.focus();
      startTimer();
      updateHp(100, 100);
      // 아이템 슬롯 초기화
      itemSlots.fill(null);
      itemUsePending = false;
      renderItemSlots();
      // effect overlay 초기화
      effectOverlay.classList.add('hidden');
      effectOverlay.classList.remove('dark-active');
      effectOverlay.textContent = '';
      fastFallOverlayMy.classList.add('hidden');
      fastFallOverlayOpp.classList.add('hidden');
      shieldIndicatorEl.classList.add('hidden');
    },

    onOpponentLeft() {
      renderer.stop();
      oppRenderer.stop();
      stopTimer();
      showScreen('result');
      resultTitle.textContent = '상대방이 나갔습니다';
      resultDetail.textContent = '';
      btnRematch.classList.add('hidden');
    },

    onReturnToLobby() {
      returnToLobby(false);
    },

    onItemGranted(msg) {
      // 레거시 획득 메시지는 연출 호환용이며 슬롯 상태는 전체 동기화만 신뢰한다.
      const presentation = getItemPresentation(msg.itemId);
      showToast(`${presentation.emoji} ${presentation.name}`);
    },

    onItemSlotsSync(slots) {
      itemSlots.fill(null);
      slots.slice(0, 3).forEach((item, index) => {
        itemSlots[index] = item;
      });
      itemUsePending = false;
      renderItemSlots();
    },

    onHit() {
      // HP 수치는 직후 STATE만 신뢰하고, 여기서는 피격 영역 연출만 실행한다.
      screenGame.classList.remove('hit-shake');
      void screenGame.offsetWidth;
      screenGame.classList.add('hit-shake');
      setTimeout(() => screenGame.classList.remove('hit-shake'), 260);
    },

    onItemEffectStart(msg) {
      const isMe = msg.targetId === myId;
      switch (msg.effect) {
        case 'fast_fall': {
          const targetRenderer = isMe ? renderer : oppRenderer;
          const overlay = isMe ? fastFallOverlayMy : fastFallOverlayOpp;
          targetRenderer.setFallClock(msg);
          overlay.classList.remove('hidden');
          overlay.textContent = t('fastFallStart');
          break;
        }
        case 'dark':
          if (isMe) {
            effectOverlay.classList.remove('hidden');
            effectOverlay.classList.add('dark-active');
            effectOverlay.textContent = '';
          }
          break;
        case 'shield_blocked':
          if (isMe) {
            // 방어자: 배지 제거 + 차단 연출
            shieldIndicatorEl.classList.add('hidden');
            showToast('\u{1F6E1}\uFE0F 차단!');
            const myBoardCol = document.querySelector('.board-col-mine');
            if (myBoardCol) {
              myBoardCol.classList.add('shield-blocked');
              setTimeout(() => myBoardCol.classList.remove('shield-blocked'), 1200);
            }
          } else {
            // 공격자: 차단됨 알림
            showToast('\u{1F6E1}\uFE0F 상대 방어막에 차단!');
          }
          break;
        case 'shield':
          if (isMe) {
            // 방어자: 배지 지속 표시
            shieldIndicatorEl.classList.remove('hidden');
            showToast('\u{1F6E1}\uFE0F \uBC29\uC5B4\uB9C9 \uC7A5\uCC29!');
          }
          break;
        case 'bomb':
          if (isMe) {
            showToast('\u{1F9E8} \uD3ED\uD0C4 \uACF5\uACA9!');
          }
          break;
        case 'heal':
          if (isMe) {
            showToast('\u{1F49A} HP \uD68C\uBCF5!');
          }
          break;
        default:
          break;
      }
    },

    onItemEffectEnd(msg) {
      const isMe = msg.targetId === myId;
      switch (msg.effect) {
        case 'fast_fall': {
          const targetRenderer = isMe ? renderer : oppRenderer;
          const overlay = isMe ? fastFallOverlayMy : fastFallOverlayOpp;
          targetRenderer.setFallClock(msg);
          overlay.classList.add('hidden');
          overlay.textContent = '';
          break;
        }
        case 'dark':
          if (!isMe) break;
          effectOverlay.classList.add('hidden');
          effectOverlay.classList.remove('dark-active');
          effectOverlay.textContent = '';
          break;
        default:
          break;
      }
    },

    onError(message) {
      console.warn('[main] 서버 오류:', message);
    },
  });

  // ── 입력 핸들러 ─────────────────────────────────────────────
  const inputHandler = createInputHandler(inputWord, {
    onInputChange(text) {
      renderer.setInput(text);
      // 자동 제출: 입력이 타겟 단어와 정확히 일치하면 즉시 제출
      const target = renderer.getTargetWord();
      if (target && text === target.text) {
        net.sendWordSubmit(target.id, target.text);
        inputHandler.clear();
      }
    },
    onSubmit(text) {
      // Enter 키 수동 제출
      const target = renderer.getTargetWord();
      if (target && text === target.text) {
        net.sendWordSubmit(target.id, target.text);
      } else {
        // 매칭되는 단어가 없으면 오류 표시
        inputHandler.showError();
      }
    },
  });

  // ── 화면 전환 ───────────────────────────────────────────────

  /**
   * 화면을 전환한다.
   * @param {'waiting'|'game'|'result'} name
   */
  function showScreen(name) {
    screenWaiting.classList.remove('active');
    screenGame.classList.remove('active');
    screenResult.classList.remove('active');
    if (name === 'waiting') screenWaiting.classList.add('active');
    else if (name === 'game') screenGame.classList.add('active');
    else if (name === 'result') screenResult.classList.add('active');
  }

  // ── HP 바 업데이트 ──────────────────────────────────────────

  /**
   * HP 바를 업데이트한다.
   * @param {number} myHp
   * @param {number} oppHp
   */
  function updateHp(myHp, oppHp) {
    const myPct = Math.max(0, myHp);
    const oppPct = Math.max(0, oppHp);
    myHpFill.style.width = `${myPct}%`;
    oppHpFill.style.width = `${oppPct}%`;
    myHpValue.textContent = myPct;
    oppHpValue.textContent = oppPct;

    // 위험 구간 (30% 이하)
    myHpFill.classList.toggle('danger', myPct <= 30);
    oppHpFill.classList.toggle('danger', oppPct <= 30);
  }

  // ── 타이머 ──────────────────────────────────────────────────

  /**
   * 게임 타이머를 시작한다.
   */
  function startTimer() {
    stopTimer();
    timerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - gameStartedAt) / 1000);
      const min = Math.floor(elapsed / 60).toString().padStart(2, '0');
      const sec = (elapsed % 60).toString().padStart(2, '0');
      timerDisplay.textContent = `${min}:${sec}`;
    }, 1000);
  }

  /**
   * 게임 타이머를 정지한다.
   */
  function stopTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  // ── 버튼 이벤트 ─────────────────────────────────────────────

  btnJoin.addEventListener('click', () => {
    const name = inputName.value.trim() || '플레이어';
    myName = name;
    sessionStorage.setItem('venezia:mode', 'human');
    net.connect();
    // 연결 후 JOIN 전송 (onOpen에서 처리하기 위해 이름 저장)
    setTimeout(() => net.sendJoin(name), 300);
    btnJoin.disabled = true;
    btnAi.disabled = true;
  });

  btnAi.addEventListener('click', () => {
    const name = inputName.value.trim() || '플레이어';
    myName = name;
    sessionStorage.setItem('venezia:mode', 'ai');
    // mode=ai로 재연결
    const urlParams = new URLSearchParams(location.search);
    urlParams.set('mode', 'ai');
    history.replaceState(null, '', `${location.pathname}?${urlParams}`);
    net.connect();
    setTimeout(() => net.sendJoin(name), 300);
    btnJoin.disabled = true;
    btnAi.disabled = true;
  });

  btnSubmit.addEventListener('click', () => {
    inputHandler.submit();
  });

  btnRematch.addEventListener('click', () => {
    net.sendRematch();
    btnRematch.textContent = '대기중...';
    btnRematch.disabled = true;
  });

  btnLobby.addEventListener('click', () => {
    returnToLobby(true);
  });

  btnBackToLobby.addEventListener('click', () => {
    if (!window.confirm(t('backConfirm'))) return;
    returnToLobby(true);
  });

  // Enter 키로 대기화면에서 입장
  inputName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') btnJoin.click();
  });

  // ── 아이템 슬롯 렌더링 ────────────────────────────────────────

  /**
   * 아이템 슬롯 UI를 갱신한다.
   */
  function renderItemSlots() {
    for (let i = 0; i < 3; i++) {
      const slot = document.getElementById(`item-slot-${i}`);
      const emojiEl = slot.querySelector('.item-slot-emoji');
      const nameEl = slot.querySelector('.item-slot-name');
      if (itemSlots[i]) {
        const presentation = getItemPresentation(itemSlots[i].itemId);
        slot.classList.add('filled');
        emojiEl.textContent = presentation.emoji;
        nameEl.textContent = presentation.name;
        slot.setAttribute('aria-label', `${i + 1}, ${presentation.name}`);
      } else {
        slot.classList.remove('filled');
        emojiEl.textContent = '';
        nameEl.textContent = '';
        slot.setAttribute('aria-label', `${i + 1}, ${t('emptySlot')}`);
      }
    }
  }

  // ── 토스트 ────────────────────────────────────────────────────

  /**
   * 화면 상단에 토스트 메시지를 2초간 표시한다.
   * @param {string} text
   */
  function showToast(text) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = text;
    document.body.appendChild(toast);
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 2100);
  }

  // ── 1/2/3 아이템 사용 키 이벤트 ───────────────────────────────

  window.addEventListener('keydown', (e) => {
    if (!screenGame.classList.contains('active')) return;
    const idx = getItemSlotIndex(e);
    if (idx === null) return;
    e.preventDefault();
    if (itemUsePending || itemSlots[idx] === null) return;
    itemUsePending = net.sendItemUsed(idx);
  });

  /**
   * 재연결을 중단한 뒤 로비 반환을 알리고 통합 게임 선택 화면으로 이동한다.
   * @param {boolean} notifyServer 로비 반환 요청을 보낼지 여부
   */
  function returnToLobby(notifyServer) {
    net.disconnect();
    const rootSegment = location.pathname.split('/').filter(Boolean)[0];
    const lobbyReturnUrl = rootSegment ? `/${rootSegment}/lobby/return` : '/lobby/return';
    const request = notifyServer
      ? fetch(lobbyReturnUrl, { method: 'POST', keepalive: true }).catch(() => null)
      : Promise.resolve();
    Promise.race([
      request,
      new Promise((resolve) => setTimeout(resolve, 150)),
    ]).finally(() => {
      location.href = '/';
    });
  }

  btnBackToLobby.textContent = t('backToMenu');
  itemGuide.textContent = t('itemGuide');
  document.querySelectorAll('[data-i18n="mediumDropGuide"]').forEach((element) => {
    element.textContent = t('mediumDropGuide');
  });
});
