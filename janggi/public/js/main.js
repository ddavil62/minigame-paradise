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
/** @type {Map<string, HTMLElement>} 기물 DOM 맵 */
let pieceMap = new Map();
/** @type {boolean} 게임 종료 여부 */
let gameEnded = false;

// ── DOM 참조 ────────────────────────────────────────────────────
const boardCanvas = document.getElementById('janggi-board');
const piecesLayer = document.getElementById('janggi-pieces-layer');
const highlightsLayer = document.getElementById('janggi-highlights-layer');
const btnResign = document.getElementById('btn-resign');
const btnDraw = document.getElementById('btn-draw');
const btnBackToLobby = document.getElementById('btn-back-to-lobby');
const btnReturnLobby = document.getElementById('btn-return-lobby');

// ── 초기 렌더링 ─────────────────────────────────────────────────
const ctx = boardCanvas.getContext('2d');
renderBoard(ctx);

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

  // side 쿼리 전달
  if (querySide) {
    wsPath += `?side=${querySide}`;
  }

  ws = new WebSocket(wsPath);

  ws.onopen = () => {
    console.log('[janggi] WS 연결 성공');
    reconnectDelay = 1000;
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
}

/**
 * GAME_START 메시지 처리.
 * @param {object} msg
 */
function handleGameStart(msg) {
  gameEnded = false;
  hideGameOverModal();
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
  selectedPiece = null;
  currentLegalMoves = [];
  clearHighlights(highlightsLayer);

  pieceMap = renderPieces(
    piecesLayer, msg.board, mySide, msg.turn, isPlaying
  );

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
  showToast(msg.message || '상대방이 나갔다.');
  // 런처 모드이면 로비로 자동 복귀
  if (window.location.pathname.startsWith('/janggi/')) {
    autoReconnect = false;
    setTimeout(() => { window.location.href = '/'; }, 1200);
  }
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

// ── 연결 시작 ───────────────────────────────────────────────────
connect();
