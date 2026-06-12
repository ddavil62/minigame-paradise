/**
 * @fileoverview 루미큐브 클라이언트 진입점 — 모듈 조율.
 *
 * 인터랙션 흐름:
 *  1) 본인 턴 손 타일 클릭 → selectedSrc = { kind:'hand', tileId } (시각 강조)
 *  2-a) 보드 빈 세트(.board-set.empty) 클릭 → MOVE_TILE { from:hand, to:set(첫자리) }
 *  2-b) 기존 세트의 슬롯 클릭 → MOVE_TILE { from:hand, to:set(특정 index) }
 *  3) 본인 턴 보드 타일 클릭 → selectedSrc 토글 또는 이미 선택된 타일이면 해제
 *     다른 슬롯 클릭 → MOVE_TILE { from:set, to:set }
 *     손 영역 클릭 → MOVE_TILE { from:set, to:hand } (본인이 이번 턴에 낸 타일만 회수 가능 — 서버 검증)
 *  4) "＋ 새 세트" 클릭 → NEW_SET (빈 세트 생성)
 *  5) "턴 종료" 클릭 → END_TURN
 */

import { createNetwork } from './network.js';
import { setState, getState, computeFreshMeldScore, lookupTile, inferJokerReplacement } from './game.js';
import { renderBoard } from './board.js';
import { renderHand } from './hand.js';
import { renderHud, renderActionBar, renderGameOver, showToast } from './ui.js';
import {
  isMuted, toggleMuted,
  playTileSelect, playTilePlace, playSetComplete,
  playEndTurn, playDraw, playWin, playLose, playButtonClick,
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
    deckLabel: document.getElementById('deck-label'),
    hdrP1Name: document.getElementById('hdr-p1-name'),
    hdrP2Name: document.getElementById('hdr-p2-name'),
    hdrP1Hand: document.getElementById('hdr-p1-hand'),
    hdrP2Hand: document.getElementById('hdr-p2-hand'),
    hdrP1Played: document.getElementById('hdr-p1-played'),
    hdrP2Played: document.getElementById('hdr-p2-played'),
    invitePanel: document.getElementById('invite-panel'),
    inviteUrl: document.getElementById('invite-url'),
    copyUrlBtn: document.getElementById('copy-url-btn'),
    readyPanel: document.getElementById('ready-panel'),
    readyBtn: document.getElementById('ready-btn'),
    p1ReadyMark: document.getElementById('p1-ready-mark'),
    p2ReadyMark: document.getElementById('p2-ready-mark'),
    aiPanel: document.getElementById('ai-panel'),
    btnStartAi: document.getElementById('btn-start-ai'),

    boardArea: document.getElementById('board-area'),
    handArea: document.getElementById('hand-area'),
    handCount: document.getElementById('hand-count'),
    selectionInfo: document.getElementById('selection-info'),
    meldHint: document.getElementById('meld-hint'),
    btnNewSet: document.getElementById('btn-new-set'),
    btnEndTurn: document.getElementById('btn-end-turn'),
    actionHint: document.getElementById('action-hint'),
    btnSortColor: document.getElementById('btn-sort-color'),
    btnSortNumber: document.getElementById('btn-sort-number'),

    resultOutcome: document.getElementById('result-outcome'),
    resultP1Name: document.getElementById('result-p1-name'),
    resultP2Name: document.getElementById('result-p2-name'),
    resultP1Hand: document.getElementById('result-p1-hand'),
    resultP2Hand: document.getElementById('result-p2-hand'),
    resultP1Side: document.querySelectorAll('.result-side')[0],
    resultP2Side: document.querySelectorAll('.result-side')[1],
    resultReason: document.getElementById('result-reason'),
    rematchBtn: document.getElementById('rematch-btn'),
    returnLobbyBtn: document.getElementById('btn-return-lobby'),
    backToLobbyBtn: document.getElementById('btn-back-to-lobby'),
    btnMute: document.getElementById('btn-mute'),

    toast: document.getElementById('toast'),
  };

  // ── 음소거 토글 ─────────────────────────────────────────────
  function syncMuteIcon() {
    const m = isMuted();
    els.btnMute.textContent = m ? '🔇' : '🔊';
    els.btnMute.classList.toggle('muted', m);
  }
  syncMuteIcon();

  // ── 상태 ────────────────────────────────────────────────────
  let myId = null;
  /**
   * 현재 선택된 source. 클릭 이동 흐름의 1단계 — null이면 선택 없음.
   * { kind: 'hand', tileId } | { kind: 'set', setId, tileId }
   */
  let selectedSrc = null;
  /** 이번 턴에 본인이 손에서 보드로 옮긴 타일 ID 집합 — STATE 도착마다 재계산. */
  let freshTileIds = new Set();
  /** 턴 시작 시점의 본인 손 ID 집합 — STATE에서 turnNumber/currentTurn 변경 시 갱신. */
  let turnStartHand = new Set();
  /** 턴 시작 시점의 보드 ID 집합 — fresh 판정 보조용. */
  let turnStartBoardIds = new Set();
  /** 턴 시작 시점 보드 시그니처 맵 (setId → tiles.join(',')) — #5 재배치 감지용. */
  let turnStartBoardSig = new Map();
  /** 직전 turnNumber·currentTurn — 턴 전환 감지. */
  let lastTurnKey = null;
  /**
   * 조커 회수 모드 — 보드 조커 클릭 시 활성화.
   * { setId, jokerIndex, jokerTileId, candidateTileIds: string[] }
   */
  let jokerSwapMode = null;
  /** 손패 정렬 모드 — 'color'(기본) | 'number'. localStorage로 영속(sounds.js mute 패턴). */
  let sortMode = localStorage.getItem('rummikub.sortMode') || 'color';

  // ── 손패 정렬 모드 동기화 ───────────────────────────────────
  /** 현재 활성 정렬 모드 버튼에 .active 적용. */
  function syncSortButtons() {
    els.btnSortColor.classList.toggle('active', sortMode === 'color');
    els.btnSortNumber.classList.toggle('active', sortMode === 'number');
  }
  syncSortButtons();

  // ── 화면 전환 ────────────────────────────────────────────────
  function showScreen(name) {
    els.screenWaiting.classList.toggle('hidden', name !== 'waiting');
    els.screenGame.classList.toggle('hidden', name !== 'game');
    if (name !== 'gameover') {
      els.screenGameOver.classList.add('hidden');
    }
  }

  // ── 네트워크 핸들러 ──────────────────────────────────────────
  const net = createNetwork({
    onOpen: () => { net.join('Player'); },
    onJoined: ({ playerId, waiting, hostUrl }) => {
      myId = playerId;
      els.playerLabel.textContent = `${playerId === 'p1' ? 'P1 (호스트)' : 'P2 (게스트)'}`;
      els.statusMsg.textContent = waiting ? '상대방 대기 중' : '준비를 눌러주세요';

      if (playerId === 'p1' && hostUrl) {
        els.inviteUrl.textContent = hostUrl;
        els.invitePanel.classList.remove('hidden');
      } else {
        els.invitePanel.classList.add('hidden');
      }
      els.readyPanel.classList.remove('hidden');
      const currentMode = new URLSearchParams(location.search).get('mode')
        || sessionStorage.getItem('rummikub:mode')
        || 'human';
      if (playerId === 'p1' && waiting && currentMode !== 'ai') {
        els.aiPanel.classList.remove('hidden');
      } else {
        els.aiPanel.classList.add('hidden');
      }
      showScreen('waiting');
    },
    onReadyStatus: ({ p1Ready, p2Ready }) => {
      els.p1ReadyMark.textContent = p1Ready ? '✓ 준비' : '대기';
      els.p2ReadyMark.textContent = p2Ready ? '✓ 준비' : '대기';
      els.p1ReadyMark.classList.toggle('ready', p1Ready);
      els.p2ReadyMark.classList.toggle('ready', p2Ready);
    },
    onStart: () => {
      selectedSrc = null;
      freshTileIds = new Set();
      turnStartHand = new Set();
      turnStartBoardIds = new Set();
      turnStartBoardSig = new Map();
      lastTurnKey = null;
      showScreen('game');
      els.screenGameOver.classList.add('hidden');
    },
    onState: (state) => {
      setState(state);
      // 턴 전환 감지: turnKey가 변경되면 본인 턴이 시작된 것 → 스냅샷 갱신.
      const tk = `${state.currentTurn}|${state.turnNumber}`;
      if (tk !== lastTurnKey) {
        // 턴이 바뀌었거나 START 직후 첫 STATE.
        if (myId && state.currentTurn === myId) {
          // 본인 턴 시작: turnStart 스냅샷 캡처.
          turnStartHand = new Set(state.myHand || []);
          turnStartBoardIds = new Set();
          turnStartBoardSig = new Map();
          for (const set of state.board || []) {
            for (const tid of set.tiles) turnStartBoardIds.add(tid);
            // #5: 비어있지 않은 세트만 시그니처 맵에 캡처.
            if (set.tiles && set.tiles.length > 0) {
              turnStartBoardSig.set(set.id, set.tiles.join(','));
            }
          }
          freshTileIds = new Set();
        } else {
          // 상대 턴 — 본인 입력 잠금.
          freshTileIds = new Set();
        }
        selectedSrc = null;
        jokerSwapMode = null;
        lastTurnKey = tk;
      } else if (myId && state.currentTurn === myId) {
        // 같은 턴 내 STATE 갱신 — fresh 재계산 (이번 턴 보드에 추가됐고 turnStartHand에 있던 타일).
        freshTileIds = new Set();
        for (const set of state.board || []) {
          for (const tid of set.tiles) {
            if (!turnStartBoardIds.has(tid) && turnStartHand.has(tid)) {
              freshTileIds.add(tid);
            }
          }
        }
      }
      renderAll();
    },
    onTurnResult: ({ by, committed, drewTile, reason, error }) => {
      const isMe = by === myId;
      const who = isMe ? '내' : (by === 'p1' ? 'P1' : 'P2');
      if (committed) {
        // 정상 commit.
        if (isMe) {
          playEndTurn();
          showToast(els.toast, '턴 종료 — 변경 적용됨', 'success');
        }
      } else {
        // 더미 1장 뽑기.
        if (reason === 'invalid_board') {
          if (isMe) {
            showToast(els.toast, error || '유효하지 않은 세트 — 더미 1장 뽑기', 'error');
            playDraw();
          } else {
            showToast(els.toast, `${who} 보드 무효 → 더미 뽑기`);
          }
        } else if (reason === 'initial_meld_short') {
          if (isMe) {
            showToast(els.toast, error || '첫 등판 점수 부족 — 더미 1장 뽑기', 'error');
            playDraw();
          } else {
            showToast(els.toast, `${who} 첫 등판 미달 → 더미 뽑기`);
          }
        } else if (reason === 'no_change') {
          if (isMe) {
            showToast(els.toast, '낼 타일 없음 — 더미 1장 뽑기');
            playDraw();
          } else {
            showToast(els.toast, `${who} 더미 1장 뽑기`);
          }
        } else if (reason === 'joker_unused') {
          if (isMe) {
            showToast(els.toast, error || '회수한 조커를 사용하지 않아 롤백되었습니다.', 'error');
            playDraw();
          } else {
            showToast(els.toast, `${who} 조커 미사용 → 롤백`);
          }
        } else if (reason === 'no_tile_played') {
          if (isMe) {
            showToast(els.toast, error || '손에서 1장 이상 내지 않아 변경이 롤백되었습니다.', 'error');
            playDraw();
          } else {
            showToast(els.toast, `${who} 재배치만 → 롤백 + 더미 뽑기`);
          }
        }
      }
    },
    onGameOver: (result) => {
      renderGameOver(els, result, myId);
      els.screenGameOver.classList.remove('hidden');
      if (result && result.winner) {
        if (result.winner === myId) playWin();
        else if (result.winner === 'p1' || result.winner === 'p2') playLose();
        // draw는 효과음 없음(혹은 중립).
      }
    },
    onOpponentLeft: (message) => {
      showToast(els.toast, message, 'error');
      showScreen('waiting');
      els.screenGameOver.classList.add('hidden');
      els.statusMsg.textContent = '상대방 대기 중';
      els.p1ReadyMark.textContent = '대기';
      els.p2ReadyMark.textContent = '대기';
      els.p1ReadyMark.classList.remove('ready');
      els.p2ReadyMark.classList.remove('ready');
      els.readyBtn.disabled = false;
      els.readyBtn.textContent = '준비 완료';
      const currentMode = new URLSearchParams(location.search).get('mode')
        || sessionStorage.getItem('rummikub:mode')
        || 'human';
      if (myId === 'p1' && currentMode !== 'ai') {
        els.aiPanel.classList.remove('hidden');
        els.btnStartAi.disabled = false;
        els.btnStartAi.textContent = '🤖 AI랑 시작';
      }
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

    const myTurn = state.currentTurn === myId && state.phase === 'playing';

    // 이번 턴에 회수된 조커 — 손에 남아있는 것만 "필수" 배지.
    const returnedJokerIds = new Set(state.jokerReturnedThisTurn || []);
    const handIdSet = new Set(state.myHand || []);
    const mustUseTileIds = new Set();
    for (const jid of returnedJokerIds) {
      if (handIdSet.has(jid)) mustUseTileIds.add(jid);
    }

    // 손 영역 — 본인 턴일 때만 selectable.
    els.handCount.textContent = state.myHand ? state.myHand.length : '0';
    renderHand(els.handArea, {
      state, myTurn, selectedSrc, jokerSwapMode, mustUseTileIds, sortMode,
      onTileClick: (tileId) => handleHandTileClick(tileId),
    });

    // 보드 영역.
    renderBoard(els.boardArea, {
      state, myId, myTurn, selectedSrc, freshTileIds, jokerSwapMode,
      onSetEmptyClick: (setId) => handleBoardEmptySetClick(setId),
      onSetSlotClick: (setId, index) => handleBoardSlotClick(setId, index),
      onBoardTileClick: (setId, tileId) => handleBoardTileClick(setId, tileId),
    });

    // 첫 등판 점수 미리보기 + 액션 바.
    const freshScore = computeFreshMeldScore(state, freshTileIds);
    const hasChanges = freshTileIds.size > 0 || boardChanged(state);
    renderActionBar(els, state, myId, freshScore, hasChanges);

    // [#5] 재배치만(보드 변경 O + 손 타일 0장) 한 상태 경고 힌트 — #1 룰과 정합.
    // renderActionBar가 actionHint를 먼저 설정하므로, 이 조건에서만 덮어쓴다.
    const isMyTurn = state.currentTurn === myId && state.phase === 'playing';
    if (isMyTurn && hasChanges && freshTileIds.size === 0 && els.actionHint) {
      if (!state.played[myId]) {
        // 첫 등판 중 재배치만 한 상태.
        els.actionHint.textContent =
          '보드 변경은 손 타일을 1장 이상 내야 적용됩니다 (아니면 롤백 + 더미 1장)';
      } else {
        // 등판 후 재배치만 한 상태.
        els.actionHint.textContent =
          '재배치만으로는 턴이 종료되지 않습니다. 손 타일을 1장 이상 내야 적용됩니다.';
      }
    }

    // 선택 정보.
    if (selectedSrc) {
      if (selectedSrc.kind === 'hand') {
        const t = lookupTile(state, selectedSrc.tileId);
        const label = t ? (t.kind === 'joker' ? '조커' : `${t.color} ${t.number}`) : '?';
        els.selectionInfo.textContent = `선택: ${label} — 보드 슬롯/세트 클릭`;
      } else {
        els.selectionInfo.textContent = '선택: 보드 타일 — 다른 슬롯 또는 손 영역 클릭';
      }
    } else {
      els.selectionInfo.textContent = '';
    }
  }

  /**
   * 손 영역(전체)을 클릭하면 보드 → 손 회수.
   * 단, 손 영역의 빈 공간 클릭일 때만(타일 자체 클릭은 stopPropagation).
   */
  els.handArea.addEventListener('click', () => {
    if (selectedSrc && selectedSrc.kind === 'set') {
      // 보드 → 손 회수 시도 (서버 검증).
      net.moveTile({ kind: 'set', setId: selectedSrc.setId, tileId: selectedSrc.tileId },
                    { kind: 'hand' });
      playTilePlace();
      selectedSrc = null;
    }
  });

  /**
   * 손 타일 클릭 — 선택 토글.
   * @param {string} tileId
   */
  function handleHandTileClick(tileId) {
    // 조커 회수 모드: 후보 타일 클릭이면 swap 실행.
    if (jokerSwapMode && jokerSwapMode.candidateTileIds.includes(tileId)) {
      const { setId, jokerIndex } = jokerSwapMode;
      net.swapJoker(setId, jokerIndex, tileId);
      playTilePlace();
      jokerSwapMode = null;
      selectedSrc = null;
      renderAll();
      return;
    }
    // 조커 회수 모드에서 후보가 아닌 타일 클릭 → 모드 해제 후 일반 선택 흐름으로.
    if (jokerSwapMode) {
      jokerSwapMode = null;
    }
    if (selectedSrc && selectedSrc.kind === 'hand' && selectedSrc.tileId === tileId) {
      // 같은 타일 재클릭 → 선택 해제.
      selectedSrc = null;
    } else {
      selectedSrc = { kind: 'hand', tileId };
      playTileSelect();
    }
    renderAll();
  }

  /**
   * 보드의 조커를 클릭했을 때 회수 후보를 탐지하고 모드를 활성화한다.
   * 후보 0개: false 반환(일반 선택 흐름 진행).
   * 후보 1개: 즉시 swap 송신, true 반환.
   * 후보 2개 이상: jokerSwapMode 진입 + 손에 강조, true 반환.
   *
   * @param {object} state
   * @param {string} setId
   * @param {string} jokerTileId
   * @returns {boolean} 모드 진입 또는 swap 실행 시 true
   */
  function tryStartJokerSwap(state, setId, jokerTileId) {
    // [#4] 첫 등판 전에는 조커 회수 불가.
    if (!state.played || !state.played[myId]) {
      showToast(els.toast, '조커 회수는 첫 등판 후에만 가능합니다.');
      return false;
    }
    const set = state.board.find((s) => s.id === setId);
    if (!set) return false;
    const jokerIndex = set.tiles.indexOf(jokerTileId);
    if (jokerIndex < 0) return false;
    const resolved = set.tiles.map((id) => lookupTile(state, id));
    if (resolved.some((t) => !t)) return false;
    const replacements = inferJokerReplacement(resolved, jokerIndex);
    if (replacements.length === 0) return false;
    // 본인 손에서 매칭되는 (color, number) 타일 ID 찾기.
    const handIds = state.myHand || [];
    const candidates = [];
    for (const h of handIds) {
      const tile = lookupTile(state, h);
      if (!tile || tile.kind !== 'num') continue;
      for (const r of replacements) {
        if (tile.color === r.color && tile.number === r.number) {
          candidates.push(h);
          break;
        }
      }
    }
    if (candidates.length === 0) {
      showToast(els.toast, '조커 회수 가능한 손 타일이 없습니다.');
      return false;
    }
    if (candidates.length === 1) {
      // 즉시 swap.
      net.swapJoker(setId, jokerIndex, candidates[0]);
      playTilePlace();
      jokerSwapMode = null;
      selectedSrc = null;
      renderAll();
      return true;
    }
    // 여러 후보 → 손에서 클릭 대기.
    jokerSwapMode = {
      setId, jokerIndex, jokerTileId,
      candidateTileIds: candidates,
    };
    selectedSrc = null;
    showToast(els.toast, '회수 가능한 손 타일이 강조되었습니다. 클릭하여 교환하세요.');
    renderAll();
    return true;
  }

  /**
   * 빈 세트 클릭 — 손 선택이면 첫 자리에 삽입. 보드 선택이면 그 세트로 이동.
   * @param {string} setId
   */
  function handleBoardEmptySetClick(setId) {
    if (!selectedSrc) return;
    if (selectedSrc.kind === 'hand') {
      net.moveTile({ kind: 'hand', tileId: selectedSrc.tileId },
                    { kind: 'set', setId, index: 0 });
      playTilePlace();
    } else if (selectedSrc.kind === 'set') {
      // 보드 → 빈 세트.
      if (selectedSrc.setId === setId) {
        selectedSrc = null;
        renderAll();
        return;
      }
      net.moveTile({ kind: 'set', setId: selectedSrc.setId, tileId: selectedSrc.tileId },
                    { kind: 'set', setId, index: 0 });
      playTilePlace();
    }
    selectedSrc = null;
  }

  /**
   * 기존 세트의 슬롯 클릭 — 선택된 타일을 그 인덱스에 삽입.
   * @param {string} setId
   * @param {number} index
   */
  function handleBoardSlotClick(setId, index) {
    if (!selectedSrc) return;
    if (selectedSrc.kind === 'hand') {
      net.moveTile({ kind: 'hand', tileId: selectedSrc.tileId },
                    { kind: 'set', setId, index });
      playTilePlace();
    } else if (selectedSrc.kind === 'set') {
      net.moveTile({ kind: 'set', setId: selectedSrc.setId, tileId: selectedSrc.tileId },
                    { kind: 'set', setId, index });
      playTilePlace();
    }
    selectedSrc = null;
  }

  /**
   * 보드 타일 클릭 — 본인 턴일 때만 동작.
   *  - selectedSrc 없으면 그 타일을 선택(보드 source).
   *  - selectedSrc가 손 타일이면, 그 타일 위치(=세트 내 클릭한 타일 인덱스 직전)에 삽입.
   *  - selectedSrc가 같은 보드 타일이면 선택 해제.
   *  - selectedSrc가 다른 보드 타일이면 그 위치로 이동(=클릭한 타일 직전에 삽입).
   * @param {string} setId
   * @param {string} tileId
   */
  function handleBoardTileClick(setId, tileId) {
    const state = getState();
    if (!state) return;
    const myTurn = state.currentTurn === myId && state.phase === 'playing';
    if (!myTurn) return;

    // 조커 회수 모드 진입 시도: 보드의 조커를 별다른 선택 없이 클릭.
    const clickedTile = lookupTile(state, tileId);
    if (!selectedSrc && clickedTile && clickedTile.kind === 'joker') {
      const result = tryStartJokerSwap(state, setId, tileId);
      if (result) return;
      // 후보가 없거나 즉시 swap 못 한 경우 → 일반 선택 흐름으로 fallthrough.
    }

    if (!selectedSrc) {
      selectedSrc = { kind: 'set', setId, tileId };
      playTileSelect();
      renderAll();
      return;
    }
    // 같은 타일 재클릭 → 해제.
    if (selectedSrc.kind === 'set'
        && selectedSrc.setId === setId
        && selectedSrc.tileId === tileId) {
      selectedSrc = null;
      renderAll();
      return;
    }
    // 클릭한 타일의 인덱스 = 삽입 위치.
    const set = state.board.find((s) => s.id === setId);
    if (!set) return;
    const targetIndex = set.tiles.indexOf(tileId);
    if (targetIndex < 0) return;

    if (selectedSrc.kind === 'hand') {
      net.moveTile({ kind: 'hand', tileId: selectedSrc.tileId },
                    { kind: 'set', setId, index: targetIndex });
      playTilePlace();
    } else {
      net.moveTile({ kind: 'set', setId: selectedSrc.setId, tileId: selectedSrc.tileId },
                    { kind: 'set', setId, index: targetIndex });
      playTilePlace();
    }
    selectedSrc = null;
  }

  /**
   * 현재 보드가 턴 시작과 비교해 실질적으로 변경되었는지 판단.
   * 빈 세트 존재 또는 비어있지 않은 세트의 타일 구성 변화 여부로 판정.
   * 서버 boardsEqualIgnoringEmpty와 동등한 클라 구현 (#5 재배치 감지).
   * @param {object} state
   * @returns {boolean}
   */
  function boardChanged(state) {
    // freshTileIds가 있으면 분명히 손→보드 이동이 있었다.
    if (freshTileIds.size > 0) return true;
    // 빈 세트가 있으면 NEW_SET을 한 적이 있다.
    for (const set of state.board || []) {
      if (!set.tiles || set.tiles.length === 0) return true;
    }
    // 현재 비어있지 않은 세트의 시그니처와 턴 시작 시 시그니처 비교.
    const curNonEmpty = (state.board || []).filter((s) => s.tiles && s.tiles.length > 0);
    if (curNonEmpty.length !== turnStartBoardSig.size) return true; // 세트 수가 다르면 변경.
    for (const set of curNonEmpty) {
      const sig = turnStartBoardSig.get(set.id);
      if (sig === undefined) return true; // 이 턴에 새로 생긴 세트.
      if (sig !== set.tiles.join(',')) return true; // 타일 구성(순서 포함) 변경.
    }
    return false;
  }

  // ── 버튼 이벤트 ──────────────────────────────────────────────
  els.readyBtn.addEventListener('click', () => {
    els.readyBtn.disabled = true;
    els.readyBtn.textContent = '준비 완료 ✓';
    net.sendReady();
  });

  els.btnStartAi.addEventListener('click', () => {
    els.btnStartAi.disabled = true;
    els.btnStartAi.textContent = '🤖 AI 호출 중...';
    const url = new URL(location.href);
    url.searchParams.set('mode', 'ai');
    location.href = url.toString();
  });

  els.btnNewSet.addEventListener('click', () => {
    selectedSrc = null;
    net.newSet();
    playButtonClick();
  });

  els.btnEndTurn.addEventListener('click', () => {
    selectedSrc = null;
    net.endTurn();
  });

  // 손패 정렬 모드 버튼 — 클릭 시 localStorage 영속 + 즉시 재렌더(본인 턴 무관).
  els.btnSortColor.addEventListener('click', () => {
    sortMode = 'color';
    localStorage.setItem('rummikub.sortMode', sortMode);
    syncSortButtons();
    renderAll();
  });
  els.btnSortNumber.addEventListener('click', () => {
    sortMode = 'number';
    localStorage.setItem('rummikub.sortMode', sortMode);
    syncSortButtons();
    renderAll();
  });

  els.copyUrlBtn.addEventListener('click', async () => {
    const url = els.inviteUrl.textContent;
    try {
      await navigator.clipboard.writeText(url);
      showToast(els.toast, '초대 URL 복사 완료', 'success');
    } catch (e) {
      const range = document.createRange();
      range.selectNode(els.inviteUrl);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      try {
        document.execCommand('copy');
        showToast(els.toast, '초대 URL 복사 완료', 'success');
      } catch (e2) {
        showToast(els.toast, '복사 실패 — 수동으로 복사하세요', 'error');
      }
      sel.removeAllRanges();
    }
  });

  els.rematchBtn.addEventListener('click', () => {
    els.rematchBtn.disabled = true;
    els.rematchBtn.textContent = '재대결 대기 중...';
    net.sendRematch();
  });

  function returnToLobby() {
    const seg = location.pathname.split('/').filter(Boolean)[0] || '';
    fetch('/lobby/return', { method: 'POST' })
      .catch(() => {})
      .finally(() => {
        if (!seg) location.href = '/';
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

  els.btnMute.addEventListener('click', () => {
    const nowMuted = toggleMuted();
    syncMuteIcon();
    if (!nowMuted) playButtonClick();
  });

  net.connect();
  showScreen('waiting');
});
