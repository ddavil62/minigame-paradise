/**
 * @fileoverview 미니게임 천국 런처 클라이언트 — WS 기반 단일 로비 화면.
 *   페이지 로드 시 launcher 서버의 WebSocket에 접속하여 LOBBY_STATE / REDIRECT
 *   메시지를 수신하고, 인원/역할에 따라 게임 카드 그리드를 활성/비활성 전환한다.
 *   게스트와 호스트 모두 카드에 투표(VOTE_GAME) 할 수 있다.
 *
 *   상태 흐름:
 *     lobby (player count + 게임 카드 즉시 표시, 호스트만 선택 가능)
 *        ↓  REDIRECT 수신
 *     location.href = `/{gameId}/?mode=...` (게임 페이지로 이동)
 */

const GRID_EL_ID = 'game-grid';

// ── 모듈 수준 상태 ─────────────────────────────────────────────
/** @type {WebSocket | null} */
let ws = null;

/** @type {'host' | 'guest' | null} */
let myRole = null;

/** @type {'ai' | 'human' | null} */
let currentMode = null;

/** @type {Array<object>} games.json 캐시 */
let gamesCache = [];

/** @type {number} 서버에서 수신한 현재 접속 인원 수 */
let currentCount = 0;

/** @type {{ [gameId: string]: number }} 서버에서 수신한 투표 현황 */
let currentVotes = {};

/**
 * 로비가 활성화된 상태 (호스트)인지 여부.
 * 이 플래그가 true일 때만 카드 클릭이 가능하다.
 * @type {boolean}
 */
let cardClickEnabled = false;

// ── 유틸 ───────────────────────────────────────────────────────
/**
 * #lobby-status 영역에 메시지를 표시한다.
 * @param {string} text 표시할 텍스트
 */
function showStatus(text) {
  const statusEl = document.getElementById('lobby-status');
  if (statusEl) statusEl.textContent = text;
}

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
 * 클릭 핸들러는 PICK_GAME WS 메시지를 보낸다 (호스트일 때만).
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

  // 투표 버튼 (카드 하단)
  const voteBtn = document.createElement('button');
  voteBtn.className = 'game-card-vote';
  voteBtn.type = 'button';
  voteBtn.dataset.gameId = game.id;
  voteBtn.setAttribute('aria-label', `${game.name} 추천`);
  voteBtn.innerHTML = '\uD83D\uDC4D <span class="vote-count" id="vote-count-' + game.id + '">0</span>';
  body.appendChild(voteBtn);

  card.appendChild(body);

  // ── 클릭/키보드 핸들러 ────────────────────────────
  /**
   * 호스트가 카드를 선택할 때 호출. WS로 PICK_GAME 전송.
   * 게스트 또는 비활성 카드는 CSS pointer-events로 차단되므로 보조 가드만.
   */
  const pick = (event) => {
    if (event) event.stopPropagation();
    if (!cardClickEnabled) return;
    if (myRole !== 'host') return;
    // AI 모드(1인 접속) + 봇 미지원이면 차단 — currentCount 기반 판단
    const effectiveMode = (currentCount === 1) ? 'ai' : 'human';
    if (effectiveMode === 'ai' && game.botAvailable === false) {
      showStatus('이 게임은 AI 봇을 지원하지 않습니다. 친구와 함께 플레이하세요!');
      return;
    }
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

  // 투표 이벤트 — 호스트/게스트 모두 가능, 항상 활성
  voteBtn.addEventListener('click', (event) => {
    event.stopPropagation(); // 카드 pick 이벤트 방지
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'VOTE_GAME', gameId: game.id }));
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
}

// ── 메시지 핸들러 ───────────────────────────────────────────────
/**
 * LOBBY_STATE 메시지 처리: 카운트/역할/힌트/투표 갱신.
 * @param {{count:number, role:'host'|'guest', mode:string|null, votes:object}} msg
 */
function updateLobbyUI(msg) {
  const { count, role, mode, votes } = msg;
  myRole = role;
  currentMode = mode;
  currentCount = count;
  currentVotes = votes || {};

  // 카운트 표시
  const countEl = document.getElementById('player-count');
  if (countEl) countEl.textContent = `${count}/2`;

  // 역할 표시
  const roleEl = document.getElementById('player-role');
  if (roleEl) roleEl.textContent = role === 'host' ? '호스트' : '게스트';

  // 힌트 텍스트 — 게스트 2/2에서는 #guest-waiting만 표시하므로 중복 방지
  const hintEl = document.getElementById('lobby-hint');
  const guestWait = document.getElementById('guest-waiting');
  if (hintEl) {
    if (role === 'guest') {
      // 게스트는 #guest-waiting이 안내를 담당 → #lobby-hint 비움
      hintEl.textContent = '';
    } else if (count === 1) {
      hintEl.textContent = '혼자 플레이 가능 (AI 대전) — 또는 친구를 기다리세요';
    } else {
      hintEl.textContent = '친구가 들어왔습니다! 종목을 선택하세요';
    }
  }

  // 게스트 대기 안내 — 호스트에게는 숨김
  if (guestWait) guestWait.hidden = role === 'host';

  // cardClickEnabled: 호스트이면 항상 클릭 가능 (1/2=ai, 2/2=human 자동 결정)
  cardClickEnabled = role === 'host';

  // 그리드 비활성 CSS 클래스 갱신
  const grid = document.getElementById(GRID_EL_ID);
  if (grid) {
    // 게스트이면 항상 guest-mode (카드 비활성, 투표 버튼만 활성)
    grid.classList.toggle('guest-mode', role === 'guest');
    // 1인(AI) 모드이면 봇 미지원 카드에 시각적 비활성화 적용
    grid.classList.toggle('ai-mode', count === 1);
  }

  // 투표 배지 갱신
  updateVoteBadges();
}

/**
 * 모든 카드의 투표 카운트를 현재 currentVotes로 갱신한다.
 */
function updateVoteBadges() {
  for (const game of gamesCache) {
    const countEl = document.getElementById(`vote-count-${game.id}`);
    if (countEl) {
      const count = currentVotes[game.id] || 0;
      countEl.textContent = count;
    }
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
  if (statusEl) {
    statusEl.textContent = '현재 게임이 진행 중입니다. 잠시 후 다시 시도하세요.';
    statusEl.classList.add('full');
  }
  // 카운트/역할 표시도 정리
  const countEl = document.getElementById('player-count');
  if (countEl) countEl.textContent = '2/2';
  const roleEl = document.getElementById('player-role');
  if (roleEl) roleEl.textContent = '관전 불가';
}

/**
 * RESET 수신 (호스트 disconnect 등): 로비 상태 초기화.
 */
function resetToLobby() {
  currentVotes = {};
  cardClickEnabled = false;
  myRole = null;
  // LOBBY_STATE가 곧 다시 오므로 그때 UI 갱신됨
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
      // 하위 호환 — 무시 (서버에서 더 이상 송신 안 함)
      break;
    case 'RETURN_LOBBY':
      // POST /lobby/return 결과로 서버가 broadcast
      currentVotes = {};
      cardClickEnabled = false;
      location.href = '/';
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
  // 게임 목록 로드 후 즉시 카드 렌더링
  try {
    gamesCache = await loadGames();
    renderCards();
  } catch (err) {
    console.error(err);
    const grid = document.getElementById(GRID_EL_ID);
    if (grid) renderMessage(grid, '게임 목록을 불러올 수 없습니다. (콘솔 확인)');
  }

  // WS 연결 시작
  connectWS();
}

document.addEventListener('DOMContentLoaded', init);
