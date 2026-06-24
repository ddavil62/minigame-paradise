/**
 * @fileoverview 장기 게임 클라이언트 진입점.
 * WebSocket 연결, URL 쿼리 파싱, 메시지 라우팅, 사용자 입력 처리를 담당한다.
 *
 * 모듈 구조:
 *   main.js - 진입점 + WS 클라이언트 + 이벤트 바인딩
 *   board.js - Canvas 보드 렌더링
 *   pieces.js - 기물 DOM 렌더 + 하이라이트
 *   ui.js - 모달, 시간, 토스트 UI
 */

import { renderBoard, cellToPx, pxToCell, CANVAS_W, CANVAS_H } from './board.js';
import {
  renderPieces, highlightMoves, clearHighlights,
  markLastMove, markCheck, renderCaptured,
} from './pieces.js';
import {
  showSetupModal, hideSetupModal,
  updateTimePanel, showCheckToast,
  showGameOverModal, hideGameOverModal,
  showDrawModal, hideDrawModal,
  showToast, updateYouTag,
} from './ui.js';

// ── 클라이언트 상태 ─────────────────────────────────────────────
/** @type {'han'|'cho'|null} 내 진영 */
let mySide = null;
/** @type {string|null} 내 playerId */
let myPlayerId = null;
/** @type {WebSocket|null} */
let ws = null;
/** @type {boolean} 자동 재연결 활성화 */
let autoReconnect = true;
/** @type {number} 재연결 대기 시간(ms) */
let reconnectDelay = 1000;

/** @type {object|null} 현재 게임 상태 (서버 STATE) */
let gameState = null;
/** @type {{file:number, rank:number}|null} 선택된 기물 좌표 */
let selectedPiece = null;
/** @type {Array<{file:number, rank:number}>} 현재 합법 수 목록 */
let currentLegalMoves = [];
/** @type {any} 직전 STATE의 board 스냅샷 — 매 초 시간 broadcast 시 selectedPiece 유지 판정용 */
let prevBoardSnapshot = null;
/** @type {Map<string, HTMLElement>} 기물 DOM 맵 */
let pieceMap = new Map();
/** @type {boolean} 게임 종료 여부 */
let gameEnded = false;

// ── 대기 화면 상태 ──────────────────────────────────────────────
/** 상대 닉네임(JOINED.opponentName 수신 시 갱신). */
let opponentName = null;
/** 내 READY 상태. */
let myReady = false;
/** 상대 READY 상태. */
let opponentReady = false;

// ── DOM 참조 ────────────────────────────────────────────────────
const boardCanvas = document.getElementById('janggi-board');
const piecesLayer = document.getElementById('janggi-pieces-layer');
const highlightsLayer = document.getElementById('janggi-highlights-layer');
const btnResign = document.getElementById('btn-resign');
const btnDraw = document.getElementById('btn-draw');
const btnBackToLobby = document.getElementById('btn-back-to-lobby');
const btnReturnLobby = document.getElementById('btn-return-lobby');

// ── 대기 화면 (READY 게이트) DOM 참조 ─────────────────────────
const screenWaitingEl     = document.getElementById('screen-waiting');
const screenGameEl        = document.getElementById('screen-game');
const topbarEl            = document.getElementById('topbar');
const waitingTitleEl      = screenWaitingEl ? screenWaitingEl.querySelector('.waiting-title') : null;
const nameGateInlineEl    = document.getElementById('name-gate-inline');
const inlineNameInputEl   = document.getElementById('inline-name-input');
const btnInlineEnterEl    = document.getElementById('btn-inline-enter');
const waitingSoloEl       = document.getElementById('waiting-solo');
const btnStartAiEl        = document.getElementById('btn-start-ai');
const opponentInfoEl      = document.getElementById('opponent-info');
const opponentNameLabelEl = document.getElementById('opponent-name-label');
const readyPanelEl        = document.getElementById('ready-panel');
const myReadyMarkEl       = document.getElementById('my-ready-mark');
const oppReadyMarkEl      = document.getElementById('opp-ready-mark');
const btnReadyEl          = document.getElementById('btn-ready');
const oppLeftBannerEl     = document.getElementById('opponent-left-banner');
const oppLeftMsgEl        = document.getElementById('opponent-left-msg');
const btnBannerReturnEl   = document.getElementById('btn-banner-return-lobby');

// ── 초기 렌더링 ─────────────────────────────────────────────────
const ctx = boardCanvas.getContext('2d');
renderBoard(ctx);

// ── 대기 화면 헬퍼 함수 ──────────────────────────────────────────

/**
 * 현재 모드(ai|human)를 URL/sessionStorage에서 읽는다.
 * @returns {string}
 */
function getCurrentMode() {
  return new URLSearchParams(location.search).get('mode')
    || sessionStorage.getItem('janggi:mode')
    || 'human';
}

/**
 * "AI랑 시작" 버튼(혼자 대기 패널)을 숨긴다.
 */
function hideAiButton() {
  if (waitingSoloEl) waitingSoloEl.classList.add('hidden');
  if (btnStartAiEl) btnStartAiEl.classList.add('hidden');
}

/**
 * 혼자 대기 패널을 다시 표시한다.
 */
function showAiButton() {
  if (getCurrentMode() === 'ai') return;
  updateWaitingTitle(false);
  if (waitingSoloEl) waitingSoloEl.classList.remove('hidden');
  if (btnStartAiEl) {
    btnStartAiEl.classList.remove('hidden');
    btnStartAiEl.disabled = false;
    btnStartAiEl.textContent = '🤖 AI랑 시작';
  }
}

/**
 * 대기 카드 제목(.waiting-title)을 현재 인원 상태에 맞게 갱신한다.
 * @param {boolean} hasOpponent 상대가 합류했는가
 */
function updateWaitingTitle(hasOpponent) {
  if (!waitingTitleEl) return;
  waitingTitleEl.textContent = hasOpponent
    ? '대전 준비 중'
    : '상대방을 기다리는 중...';
}

/**
 * 상대 이름 표시("OO님과 대전")를 갱신한다.
 */
function updateOpponentInfo() {
  if (opponentName && opponentInfoEl) {
    opponentInfoEl.classList.remove('hidden');
    if (opponentNameLabelEl) opponentNameLabelEl.textContent = opponentName;
  }
}

/**
 * 양방향 READY 상태 마크 + 준비 버튼 표시를 갱신한다.
 */
function updateReadyUI() {
  if (myReadyMarkEl) {
    myReadyMarkEl.textContent = myReady ? '✅' : '⌛';
    myReadyMarkEl.classList.toggle('ready', myReady);
    myReadyMarkEl.classList.toggle('not-ready', !myReady);
  }
  if (oppReadyMarkEl) {
    oppReadyMarkEl.textContent = opponentReady ? '✅' : '⌛';
    oppReadyMarkEl.classList.toggle('ready', opponentReady);
    oppReadyMarkEl.classList.toggle('not-ready', !opponentReady);
  }
  if (btnReadyEl) btnReadyEl.hidden = myReady;
}

/**
 * 상대 이탈 배너를 표시한다.
 * @param {string} name 이탈한 상대 이름
 */
function showOpponentLeftBanner(name) {
  if (oppLeftMsgEl) {
    oppLeftMsgEl.textContent = `${name || '상대방'}님이 나갔어요.`;
  }
  if (oppLeftBannerEl) oppLeftBannerEl.classList.remove('hidden');
}

/**
 * 화면 전환: 'waiting' → 대기, 'game' → 게임(topbar + janggi-app).
 * @param {'waiting'|'game'} name
 */
function showScreen(name) {
  if (screenWaitingEl) screenWaitingEl.classList.toggle('hidden', name !== 'waiting');
  if (screenGameEl) screenGameEl.classList.toggle('hidden', name !== 'game');
  if (topbarEl) topbarEl.classList.toggle('hidden', name !== 'game');
}

/**
 * 인라인 닉네임 입력 제출(직접 진입 폴백 B).
 */
function submitInlineName() {
  const raw = (inlineNameInputEl ? inlineNameInputEl.value : '').trim().slice(0, 12);
  if (!raw) {
    if (inlineNameInputEl) inlineNameInputEl.focus();
    return;
  }
  sessionStorage.setItem('janggi:name', raw);
  if (nameGateInlineEl) nameGateInlineEl.classList.add('hidden');
  if (getCurrentMode() !== 'ai' && waitingSoloEl) {
    waitingSoloEl.classList.remove('hidden');
  }
  if (readyPanelEl) readyPanelEl.classList.remove('hidden');
  send({ type: 'JOIN', name: raw });
}

// ── URL 쿼리 파싱 ───────────────────────────────────────────────
const urlParams = new URLSearchParams(window.location.search);
const queryMode = urlParams.get('mode'); // 'human' 등
const querySide = urlParams.get('side'); // 'han' | 'cho'

// ── WebSocket 연결 ──────────────────────────────────────────────

/**
 * WebSocket 연결을 수립한다.
 */
function connect() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  let wsPath;

  // 런처 통합 모드 판정: pathname이 /janggi/로 시작하면 런처 경유
  if (window.location.pathname.startsWith('/janggi/')) {
    wsPath = `${proto}//${location.host}/janggi/ws`;
  } else {
    wsPath = `${proto}//${location.host}/ws`;
  }

  // mode 정보 유지: URL query 우선, 없으면 sessionStorage. 새로고침해도 같은 모드로 재진입.
  // mode=ai이면 서버가 봇 child_process를 자동 spawn.
  let mode = queryMode;
  if (mode) {
    sessionStorage.setItem('janggi:mode', mode);
  } else {
    mode = sessionStorage.getItem('janggi:mode') || 'human';
  }

  // query 조립 (side + mode)
  const params = new URLSearchParams();
  if (querySide) params.set('side', querySide);
  params.set('mode', mode);
  wsPath += `?${params.toString()}`;

  ws = new WebSocket(wsPath);

  ws.onopen = () => {
    console.log('[janggi] WS 연결 성공');
    reconnectDelay = 1000;
    // ── 닉네임 3단계 폴백: URL ?name= → sessionStorage janggi:name → 인라인 게이트 ──
    const urlName = urlParams.get('name');
    if (urlName) {
      sessionStorage.setItem('janggi:name', decodeURIComponent(urlName));
    }
    const storedName = sessionStorage.getItem('janggi:name');
    if (storedName) {
      send({ type: 'JOIN', name: storedName });
    }
  };

  ws.onmessage = (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch (e) {
      console.warn('[janggi] JSON 파싱 실패:', event.data);
      return;
    }
    handleMessage(msg);
  };

  ws.onclose = () => {
    console.log('[janggi] WS 연결 해제');
    if (autoReconnect && !gameEnded) {
      console.log(`[janggi] ${reconnectDelay}ms 후 재연결 시도...`);
      setTimeout(() => {
        reconnectDelay = Math.min(reconnectDelay * 2, 8000);
        connect();
      }, reconnectDelay);
    }
  };

  ws.onerror = (err) => {
    console.error('[janggi] WS 에러:', err);
  };
}

/**
 * WS 메시지를 전송한다.
 * @param {object} payload
 */
function send(payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

// ── 메시지 핸들러 ───────────────────────────────────────────────

/**
 * 서버 메시지를 라우팅하여 적절한 UI 함수를 호출한다.
 * @param {object} msg
 */
function handleMessage(msg) {
  switch (msg.type) {
    case 'JOINED':
      handleJoined(msg);
      break;
    case 'READY_STATE':
      myReady = !!msg.myReady;
      opponentReady = !!msg.opponentReady;
      updateReadyUI();
      break;
    case 'GAME_START':
      handleGameStart(msg);
      break;
    case 'SETUP_PROMPT':
      handleSetupPrompt(msg);
      break;
    case 'STATE':
      handleState(msg);
      break;
    case 'LEGAL_MOVES':
      handleLegalMoves(msg);
      break;
    case 'CHECK':
      handleCheck(msg);
      break;
    case 'GAME_OVER':
      handleGameOver(msg);
      break;
    case 'DRAW_OFFERED':
      handleDrawOffered(msg);
      break;
    case 'OPPONENT_LEFT':
      handleOpponentLeft(msg);
      break;
    case 'ERROR':
      showToast(msg.message || '알 수 없는 오류');
      break;
    default:
      console.warn('[janggi] 알 수 없는 메시지:', msg);
  }
}

/**
 * JOINED 메시지 처리.
 * @param {object} msg
 */
function handleJoined(msg) {
  myPlayerId = msg.playerId;
  mySide = msg.side;
  updateYouTag(mySide, msg.waiting);
  console.log(`[janggi] 접속: ${myPlayerId} (${mySide}), 대기: ${msg.waiting}`);

  // 상대 이름 수신 시 갱신 + AI 버튼 소멸
  if (msg.opponentName) {
    opponentName = msg.opponentName;
    updateOpponentInfo();
    hideAiButton();
  }

  // 대기 카드 제목
  updateWaitingTitle(!!msg.opponentName || !msg.waiting);

  // 양쪽 입장 시 혼자 대기 패널 숨김
  if (!msg.waiting || msg.opponentName) {
    hideAiButton();
  } else {
    if (getCurrentMode() !== 'ai') {
      if (waitingSoloEl) waitingSoloEl.classList.remove('hidden');
    } else {
      hideAiButton();
    }
  }

  // 닉네임이 없으면(직접 진입) 인라인 게이트 노출
  if (!msg.hasName) {
    if (nameGateInlineEl) nameGateInlineEl.classList.remove('hidden');
    if (waitingSoloEl) waitingSoloEl.classList.add('hidden');
    if (readyPanelEl) readyPanelEl.classList.add('hidden');
  } else {
    if (readyPanelEl) readyPanelEl.classList.remove('hidden');
  }

  showScreen('waiting');
}

/**
 * GAME_START 메시지 처리.
 * @param {object} msg
 */
function handleGameStart(msg) {
  gameEnded = false;
  hideGameOverModal();
  // READY 상태 초기화
  myReady = false;
  opponentReady = false;
  // 대기 화면 → 게임 화면 전환
  showScreen('game');
  console.log(`[janggi] 게임 시작: phase=${msg.phase}`);
}

/**
 * SETUP_PROMPT 메시지 처리.
 * @param {object} msg
 */
function handleSetupPrompt(msg) {
  showSetupModal(msg.side, mySide, (code) => {
    send({ type: 'SELECT_SETUP', setup: code });
  });
}

/**
 * STATE 메시지 처리 (보드 전체 스냅샷).
 * @param {object} msg
 */
function handleState(msg) {
  gameState = msg;

  // 배치 선택 단계에서 playing으로 전환 시 모달 닫기
  if (msg.phase === 'playing' || msg.phase === 'ended') {
    hideSetupModal();
  }

  // 기물 렌더링
  const isPlaying = msg.phase === 'playing';
  // 서버가 시간 카운트다운으로 매 초 STATE를 broadcast하기 때문에 selectedPiece를
  // 무조건 리셋하면 사용자 선택 하이라이트가 1초마다 사라진다. 보드 상태(board)가
  // 직전 STATE와 동일하면 선택 유지.
  const boardChanged = JSON.stringify(msg.board) !== JSON.stringify(prevBoardSnapshot);
  prevBoardSnapshot = msg.board;
  if (boardChanged) {
    selectedPiece = null;
    currentLegalMoves = [];
  }
  clearHighlights(highlightsLayer);

  pieceMap = renderPieces(
    piecesLayer, msg.board, mySide, msg.turn, isPlaying
  );

  // 선택 유지 케이스 — 하이라이트 다시 그림 (시그니처: container, file, rank, moves, board)
  if (!boardChanged && selectedPiece && currentLegalMoves.length > 0) {
    highlightMoves(
      highlightsLayer, selectedPiece.file, selectedPiece.rank,
      currentLegalMoves, msg.board
    );
  }

  // 마지막 수 표시
  markLastMove(highlightsLayer, msg.lastMove);

  // 장군 표시
  if (msg.inCheck && msg.phase === 'playing') {
    markCheck(pieceMap, msg.board, msg.turn);
  } else {
    markCheck(pieceMap, msg.board, null);
  }

  // 시간 패널 업데이트
  if (msg.hanTime && msg.choTime) {
    updateTimePanel(msg.hanTime, msg.choTime, msg.turn);
  }

  // 잡힌 기물 패널 업데이트
  renderCaptured(
    document.getElementById('captured-han-pieces'),
    document.getElementById('captured-han-score'),
    msg.capturedByHan || []
  );
  renderCaptured(
    document.getElementById('captured-cho-pieces'),
    document.getElementById('captured-cho-score'),
    msg.capturedByCho || []
  );
}

/**
 * LEGAL_MOVES 메시지 처리.
 * @param {object} msg
 */
function handleLegalMoves(msg) {
  if (!selectedPiece) return;
  if (msg.file !== selectedPiece.file || msg.rank !== selectedPiece.rank) return;

  currentLegalMoves = msg.moves || [];
  if (gameState && gameState.board) {
    highlightMoves(
      highlightsLayer, selectedPiece.file, selectedPiece.rank,
      currentLegalMoves, gameState.board
    );
  }
}

/**
 * CHECK 메시지 처리.
 * @param {object} msg
 */
function handleCheck(msg) {
  showCheckToast();
}

/**
 * GAME_OVER 메시지 처리.
 * @param {object} msg
 */
function handleGameOver(msg) {
  gameEnded = true;
  showGameOverModal(msg.winner, msg.reason, msg.scores, mySide);
}

/**
 * DRAW_OFFERED 메시지 처리.
 * @param {object} msg
 */
function handleDrawOffered(msg) {
  if (msg.by === mySide) {
    showToast('무승부 제안을 보냈습니다');
    return;
  }
  showDrawModal(
    () => send({ type: 'DRAW_ACCEPT' }),
    () => showToast('무승부 제안을 거절했습니다')
  );
}

/**
 * OPPONENT_LEFT 메시지 처리.
 * @param {object} msg
 */
function handleOpponentLeft(msg) {
  hideGameOverModal();
  // 자동 redirect 제거 — 배너 + "로비로 돌아가기" 버튼만 표시
  showOpponentLeftBanner(msg.name || '상대방');
}

// ── 사용자 입력 처리 ────────────────────────────────────────────

/**
 * 보드 클릭 이벤트 핸들러.
 * 기물 선택 또는 이동 대상 칸 클릭을 처리한다.
 * @param {MouseEvent} e
 */
function handleBoardClick(e) {
  if (!gameState || gameState.phase !== 'playing') return;
  if (gameState.turn !== mySide) return;

  // 클릭 좌표 → 격자 좌표
  const rect = boardCanvas.getBoundingClientRect();
  const scaleX = CANVAS_W / rect.width;
  const scaleY = CANVAS_H / rect.height;
  const px = (e.clientX - rect.left) * scaleX;
  const py = (e.clientY - rect.top) * scaleY;
  const cell = pxToCell(px, py);

  if (!cell) return;

  // 합법 수 목표 칸 클릭 시 → 이동
  if (selectedPiece && currentLegalMoves.some(m => m.file === cell.file && m.rank === cell.rank)) {
    send({
      type: 'MOVE',
      fromFile: selectedPiece.file,
      fromRank: selectedPiece.rank,
      toFile: cell.file,
      toRank: cell.rank,
    });
    selectedPiece = null;
    currentLegalMoves = [];
    clearHighlights(highlightsLayer);
    return;
  }

  // 자기 기물 클릭 → 선택 + 합법 수 요청
  const piece = gameState.board?.[cell.rank]?.[cell.file];
  if (piece && piece.side === mySide) {
    selectedPiece = { file: cell.file, rank: cell.rank };
    currentLegalMoves = [];
    clearHighlights(highlightsLayer);
    // 마지막 수 마커는 유지
    markLastMove(highlightsLayer, gameState.lastMove);
    send({ type: 'REQUEST_MOVES', file: cell.file, rank: cell.rank });
    return;
  }

  // 빈 칸 또는 적 기물 (합법 수 아닌 곳) → 선택 해제
  selectedPiece = null;
  currentLegalMoves = [];
  clearHighlights(highlightsLayer);
  markLastMove(highlightsLayer, gameState?.lastMove);
}

// 보드 영역 클릭 이벤트 (기물 레이어 + 하이라이트 레이어 + 캔버스)
const boardContainer = document.querySelector('.janggi-board-container');
boardContainer.addEventListener('click', handleBoardClick);

// ── 하이라이트 클릭 (이동 대상 칸) ──────────────────────────────
highlightsLayer.addEventListener('click', (e) => {
  const dot = e.target.closest('.highlight-dot');
  if (!dot || !selectedPiece) return;
  e.stopPropagation();

  const toFile = parseInt(dot.dataset.file, 10);
  const toRank = parseInt(dot.dataset.rank, 10);

  send({
    type: 'MOVE',
    fromFile: selectedPiece.file,
    fromRank: selectedPiece.rank,
    toFile,
    toRank,
  });
  selectedPiece = null;
  currentLegalMoves = [];
  clearHighlights(highlightsLayer);
});

// ── 기물 클릭 (pieces 레이어) ────────────────────────────────────
piecesLayer.addEventListener('click', (e) => {
  const pieceEl = e.target.closest('.janggi-piece');
  if (!pieceEl) return;
  e.stopPropagation();
  if (!gameState || gameState.phase !== 'playing') return;
  if (gameState.turn !== mySide) return;

  const file = parseInt(pieceEl.dataset.file, 10);
  const rank = parseInt(pieceEl.dataset.rank, 10);
  const piece = gameState.board?.[rank]?.[file];

  // 적 기물 클릭 → 합법 수 이동 시도
  if (piece && piece.side !== mySide) {
    if (selectedPiece && currentLegalMoves.some(m => m.file === file && m.rank === rank)) {
      send({
        type: 'MOVE',
        fromFile: selectedPiece.file,
        fromRank: selectedPiece.rank,
        toFile: file,
        toRank: rank,
      });
      selectedPiece = null;
      currentLegalMoves = [];
      clearHighlights(highlightsLayer);
    }
    return;
  }

  // 자기 기물 클릭 → 선택
  if (piece && piece.side === mySide) {
    selectedPiece = { file, rank };
    currentLegalMoves = [];
    clearHighlights(highlightsLayer);
    markLastMove(highlightsLayer, gameState.lastMove);
    send({ type: 'REQUEST_MOVES', file, rank });
  }
});

// ── 버튼 이벤트 ─────────────────────────────────────────────────

// 기권 버튼
if (btnResign) {
  btnResign.addEventListener('click', () => {
    if (!confirm('기권하시겠습니까?')) return;
    send({ type: 'RESIGN' });
  });
}

// 무승부 제안 버튼
if (btnDraw) {
  btnDraw.addEventListener('click', () => {
    send({ type: 'DRAW_OFFER' });
  });
}

// 뒤로가기 (로비 복귀) 버튼 - 5개 게임과 동일 패턴
if (btnBackToLobby) {
  btnBackToLobby.addEventListener('click', () => {
    if (!confirm('게임을 중단하고 게임 선택 화면으로 돌아가시겠어요? 상대방도 함께 로비로 이동합니다.')) return;
    fetch('/lobby/return', { method: 'POST' }).catch(() => {});
    autoReconnect = false;
    location.href = '/';
  });
}

// 게임 종료 후 "다른 종목" 버튼
if (btnReturnLobby) {
  btnReturnLobby.addEventListener('click', () => {
    fetch('/lobby/return', { method: 'POST' }).catch(() => {});
    autoReconnect = false;
    location.href = '/';
  });
}

// ── pagehide 시 즉시 close (서버 좀비 슬롯 방지) ─────────────────
window.addEventListener('pagehide', () => {
  autoReconnect = false;
  if (ws) ws.close();
});

// ── 대기 화면 이벤트 리스너 ──────────────────────────────────────

// 인라인 닉네임 입력 → 입장
if (btnInlineEnterEl) {
  btnInlineEnterEl.addEventListener('click', submitInlineName);
}
if (inlineNameInputEl) {
  inlineNameInputEl.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submitInlineName();
    }
  });
}

// 준비 완료(READY) 버튼
if (btnReadyEl) {
  btnReadyEl.addEventListener('click', () => {
    if (btnReadyEl) btnReadyEl.hidden = true;
    send({ type: 'READY' });
  });
}

// AI랑 시작 — mode=ai로 재접속
if (btnStartAiEl) {
  btnStartAiEl.addEventListener('click', () => {
    btnStartAiEl.disabled = true;
    btnStartAiEl.textContent = '🤖 AI 호출 중...';
    const name = sessionStorage.getItem('janggi:name') || '';
    const base = location.pathname;
    location.href = `${base}?mode=ai&name=${encodeURIComponent(name)}`;
  });
}

// 상대 이탈 배너 → 로비로 돌아가기
if (btnBannerReturnEl) {
  btnBannerReturnEl.addEventListener('click', () => {
    if (window.location.pathname.startsWith('/janggi/')) {
      autoReconnect = false;
      window.location.href = '/';
    } else {
      window.location.reload();
    }
  });
}

// ── 연결 시작 ───────────────────────────────────────────────────
connect();
