/**
 * @fileoverview 미니게임 천국 런처 클라이언트 — WS 기반 로비 상태 머신.
 *   페이지 로드 시 launcher 서버의 WebSocket에 접속하여 LOBBY_STATE / PHASE / REDIRECT
 *   메시지를 수신하고, 화면을 로비 ↔ 종목 선택 사이에서 전환한다.
 *
 *   상태 흐름:
 *     lobby (player count 표시, 스타트 버튼)
 *        ↓  PHASE 수신
 *     game-select (게임 카드 그리드, 호스트만 선택 가능)
 *        ↓  REDIRECT 수신
 *     location.href = `http://${hostname}:${port}` (게임 페이지로 이동)
 */

const GRID_EL_ID = 'game-grid';
const LOBBY_VIEW_ID = 'lobby-view';
const SELECT_VIEW_ID = 'game-select-view';

// ── 모듈 수준 상태 ─────────────────────────────────────────────
/** @type {WebSocket | null} */
let ws = null;

/** @type {'host' | 'guest' | null} */
let myRole = null;

/** @type {'lobby' | 'game-select'} */
let currentPhase = 'lobby';

/** @type {'ai' | 'human' | null} */
let currentMode = null;

/** @type {Array<object>} games.json 캐시 */
let gamesCache = [];

/** @type {boolean} 카드 렌더링 완료 여부 (중복 렌더 방지) */
let cardsRendered = false;

// ── 유틸 ───────────────────────────────────────────────────────
/**
 * games.json을 fetch하여 게임 메타데이터 배열을 반환한다.
 * @returns {Promise<Array<object>>}
 */
async function loadGames() {
  const res = await fetch('./games.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`games.json fetch 실패: HTTP ${res.status}`);
  return await res.json();
}

/**
 * 게임 한 개에 대한 카드 DOM을 생성한다.
 * 클릭 핸들러는 PICK_GAME WS 메시지를 보낸다 (호스트일 때만 등록).
 * @param {object} game games.json 한 항목
 * @returns {HTMLElement}
 */
function createCard(game) {
  const card = document.createElement('article');
  card.className = 'game-card';
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', `${game.name} 선택`);
  card.dataset.gameId = game.id;
  card.dataset.botAvailable = game.botAvailable ? 'true' : 'false';
  card.style.setProperty('--game-color', game.color);

  // 봇 미지원 게임은 클래스 부여 (AI 모드에서만 CSS로 비활성화 됨)
  if (!game.botAvailable) {
    card.classList.add('no-bot');
  }

  // 상단 컬러 띠
  const stripe = document.createElement('div');
  stripe.className = 'game-card-stripe';
  card.appendChild(stripe);

  // 본문
  const body = document.createElement('div');
  body.className = 'game-card-body';

  const emoji = document.createElement('div');
  emoji.className = 'game-card-emoji';
  emoji.textContent = game.emoji || '🎮';
  emoji.setAttribute('aria-hidden', 'true');
  body.appendChild(emoji);

  const title = document.createElement('h2');
  title.className = 'game-card-title';
  title.textContent = game.name;
  body.appendChild(title);

  const desc = document.createElement('p');
  desc.className = 'game-card-desc';
  desc.textContent = game.description;
  body.appendChild(desc);

  // 단일 포트 통합 라우터에서는 포트 배지가 의미 없으므로 path(`/matgo/` 등)를 표시한다.
  const port = document.createElement('div');
  port.className = 'game-card-port';
  port.textContent = game.httpPath || `/${game.id}/`;
  body.appendChild(port);

  const btn = document.createElement('button');
  btn.className = 'game-card-play';
  btn.type = 'button';
  btn.textContent = '선택';
  body.appendChild(btn);

  card.appendChild(body);

  // ── 클릭/키보드 핸들러 ────────────────────────────
  /**
   * 호스트가 카드를 선택할 때 호출. WS로 PICK_GAME 전송.
   * 게스트 또는 비활성 카드는 CSS pointer-events로 차단되므로 보조 가드만.
   */
  const pick = (event) => {
    if (event) event.stopPropagation();
    if (myRole !== 'host') return;
    // AI 모드 + 봇 미지원이면 차단
    if (currentMode === 'ai' && game.botAvailable === false) return;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'PICK_GAME', gameId: game.id }));
  };

  card.addEventListener('click', pick);
  btn.addEventListener('click', pick);
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      pick(event);
    }
  });

  return card;
}

/**
 * 그리드에 메시지(로딩/에러)를 표시한다.
 * @param {HTMLElement} grid
 * @param {string} text
 */
function renderMessage(grid, text) {
  grid.innerHTML = '';
  const msg = document.createElement('div');
  msg.className = 'grid-message';
  msg.textContent = text;
  grid.appendChild(msg);
}

/**
 * 카드 그리드를 렌더링한다 (게임 목록 → DOM).
 */
function renderCards() {
  const grid = document.getElementById(GRID_EL_ID);
  if (!grid) return;
  if (!Array.isArray(gamesCache) || gamesCache.length === 0) {
    renderMessage(grid, '게임 목록을 불러올 수 없습니다.');
    return;
  }
  grid.innerHTML = '';
  for (const game of gamesCache) {
    grid.appendChild(createCard(game));
  }
  cardsRendered = true;
}

// ── 화면 전환 ───────────────────────────────────────────────────
/**
 * 로비 / 종목 선택 화면 전환.
 * @param {'lobby' | 'game-select'} phase
 * @param {'ai' | 'human' | null} mode
 */
function transitionTo(phase, mode) {
  currentPhase = phase;
  currentMode = mode;

  const lobbyView = document.getElementById(LOBBY_VIEW_ID);
  const selectView = document.getElementById(SELECT_VIEW_ID);
  if (!lobbyView || !selectView) return;

  if (phase === 'lobby') {
    lobbyView.classList.remove('hidden');
    selectView.classList.add('hidden');
    selectView.classList.remove('guest-mode', 'ai-mode', 'human-mode');
    return;
  }

  // game-select
  lobbyView.classList.add('hidden');
  selectView.classList.remove('hidden');

  // 모드 배지 갱신
  const badge = document.getElementById('mode-badge');
  if (badge) {
    if (mode === 'ai') {
      badge.textContent = 'AI 대전';
      badge.classList.remove('mode-human');
    } else {
      badge.textContent = '인간 대전';
      badge.classList.add('mode-human');
    }
  }

  // 모드 클래스 (CSS에서 .ai-mode 일 때만 .no-bot 카드 비활성화)
  selectView.classList.remove('ai-mode', 'human-mode');
  selectView.classList.add(mode === 'ai' ? 'ai-mode' : 'human-mode');

  // 호스트/게스트 hint
  const hostHint = document.getElementById('host-pick-hint');
  const guestHint = document.getElementById('guest-pick-hint');
  if (myRole === 'host') {
    if (hostHint) hostHint.hidden = false;
    if (guestHint) guestHint.hidden = true;
    selectView.classList.remove('guest-mode');
  } else {
    if (hostHint) hostHint.hidden = true;
    if (guestHint) guestHint.hidden = false;
    selectView.classList.add('guest-mode');
  }

  // 카드 그리드는 init에서 이미 렌더됨, 한번 더 안전 렌더
  if (!cardsRendered) renderCards();
}

// ── 메시지 핸들러 ───────────────────────────────────────────────
/**
 * LOBBY_STATE 메시지 처리: 카운트/역할/힌트 갱신.
 * @param {{count:number, role:'host'|'guest', phase:string, mode:string|null}} msg
 */
function updateLobbyUI(msg) {
  const { count, role, phase, mode } = msg;
  myRole = role;
  currentMode = mode;

  // 카운트 표시
  const countEl = document.getElementById('player-count');
  if (countEl) countEl.textContent = `${count}/2`;

  // 역할 표시
  const roleEl = document.getElementById('player-role');
  if (roleEl) roleEl.textContent = role === 'host' ? '호스트' : '게스트';

  // 힌트 텍스트
  const hintEl = document.getElementById('lobby-hint');
  if (hintEl) {
    if (count === 1) {
      hintEl.textContent = '혼자 시작하면 AI 대전으로 진행됩니다';
    } else {
      hintEl.textContent = '친구가 들어왔습니다! 인간 대전으로 진행됩니다';
    }
  }

  // 호스트는 스타트 활성, 게스트는 비활성 + 대기 안내
  const startBtn = document.getElementById('start-btn');
  const guestWait = document.getElementById('guest-waiting');
  if (startBtn) startBtn.disabled = role !== 'host';
  if (guestWait) guestWait.hidden = role === 'host';

  // 서버에서 알려준 phase가 game-select면 즉시 전환 (재접속 케이스)
  if (phase === 'game-select' && currentPhase !== 'game-select') {
    transitionTo('game-select', mode);
  }
}

/**
 * REDIRECT 수신: 해당 게임 페이지로 이동.
 * 통합 라우터(단일 포트) 환경에서는 같은 origin의 path(`/{gameId}/`)로 이동한다.
 * @param {{path?:string, gameId:string, mode:string}} msg
 */
function handleRedirect(msg) {
  // 통합 라우터에서는 동일 origin의 path로 이동. 폴백으로 gameId 기반 path 생성.
  // mode 정보를 URL query에 포함해서 게임 페이지가 새로고침해도 모드를 유지할 수 있게 한다.
  // 게임은 sessionStorage에도 저장해 새 탭/창에서도 이어진다.
  const basePath = msg.path || `/${msg.gameId}/`;
  const sep = basePath.includes('?') ? '&' : '?';
  const targetPath = `${basePath}${sep}mode=${encodeURIComponent(msg.mode || 'human')}`;
  // 약간의 시각 피드백
  const statusEl = document.getElementById('lobby-status');
  if (statusEl) statusEl.textContent = `→ ${msg.gameId} (${msg.mode}) 로 이동 중...`;
  // 즉시 이동
  setTimeout(() => {
    location.href = targetPath;
  }, 80);
}

/**
 * FULL 수신: 정원 초과 안내.
 */
function showFullAlert() {
  const statusEl = document.getElementById('lobby-status');
  const startBtn = document.getElementById('start-btn');
  if (statusEl) {
    statusEl.textContent = '현재 게임이 진행 중입니다. 잠시 후 다시 시도하세요.';
    statusEl.classList.add('full');
  }
  if (startBtn) startBtn.disabled = true;
  // 카운트/역할 표시도 정리
  const countEl = document.getElementById('player-count');
  if (countEl) countEl.textContent = '2/2';
  const roleEl = document.getElementById('player-role');
  if (roleEl) roleEl.textContent = '관전 불가';
}

/**
 * RESET 수신 (호스트 disconnect 등): 로비 초기화.
 */
function resetToLobby() {
  transitionTo('lobby', null);
}

/**
 * 메시지 디스패치.
 * @param {MessageEvent} event
 */
function onMessage(event) {
  let msg;
  try {
    msg = JSON.parse(event.data);
  } catch (err) {
    console.warn('[launcher] 잘못된 WS 메시지:', err.message);
    return;
  }

  switch (msg.type) {
    case 'LOBBY_STATE':
      updateLobbyUI(msg);
      break;
    case 'PHASE':
      transitionTo(msg.phase, msg.mode);
      break;
    case 'REDIRECT':
      handleRedirect(msg);
      break;
    case 'FULL':
      showFullAlert();
      break;
    case 'RESET':
      resetToLobby();
      break;
    default:
      console.warn('[launcher] 알 수 없는 메시지 타입:', msg.type);
  }
}

// ── WS 연결 ────────────────────────────────────────────────────
/**
 * WS 연결을 시작한다.
 */
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const host = location.host || 'localhost:3000';
  // 통합 라우터: 런처 로비 WS는 `/ws` namespace에서만 동작한다.
  const url = `${proto}://${host}/ws`;
  ws = new WebSocket(url);

  ws.addEventListener('open', () => {
    const statusEl = document.getElementById('lobby-status');
    if (statusEl) statusEl.textContent = '서버 연결됨';
  });

  ws.addEventListener('message', onMessage);

  ws.addEventListener('close', () => {
    const statusEl = document.getElementById('lobby-status');
    if (statusEl && !statusEl.classList.contains('full')) {
      statusEl.textContent = '서버 연결이 끊겼습니다. 새로고침해 주세요.';
    }
  });

  ws.addEventListener('error', (err) => {
    console.error('[launcher] WS 에러:', err);
  });
}

// ── 부트스트랩 ─────────────────────────────────────────────────
/**
 * 페이지 초기화.
 */
async function init() {
  // 게임 목록 미리 로드 (카드 그리드용)
  try {
    gamesCache = await loadGames();
    renderCards();
  } catch (err) {
    console.error(err);
    const grid = document.getElementById(GRID_EL_ID);
    if (grid) renderMessage(grid, '게임 목록을 불러올 수 없습니다. (콘솔 확인)');
  }

  // 스타트 버튼 핸들러
  const startBtn = document.getElementById('start-btn');
  if (startBtn) {
    startBtn.addEventListener('click', () => {
      if (myRole !== 'host') return;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: 'START' }));
    });
  }

  // WS 연결 시작
  connectWS();
}

document.addEventListener('DOMContentLoaded', init);
