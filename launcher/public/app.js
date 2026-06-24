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

/** localStorage 닉네임 키 (오목 방의 omok:name과 충돌 방지). */
const NICKNAME_KEY = 'minigames:nickname';

// ── 모듈 수준 상태 ─────────────────────────────────────────────
/** @type {WebSocket | null} */
let ws = null;

/** @type {string} 닉네임 게이트 통과 후 확정된 내 닉네임. JOIN 송신에 사용. */
let myName = '';

/** @type {'host' | 'guest' | null} */
let myRole = null;

/** @type {'ai' | 'human' | null} */
let currentMode = null;

/** @type {Array<object>} games.json 캐시 */
let gamesCache = [];

/** @type {number} 서버에서 수신한 현재 접속 인원 수 */
let currentCount = 0;

/** @type {number} 서버에서 수신한 목표 인원 수 (기본값 2) */
let currentTarget = 2;

/** @type {number} 서버에서 수신한 AI 슬롯 카운트 */
let currentAiSlotCount = 0;

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

  // 결정 B: 봇 미지원 카드 비활성화 로직 제거 — 모든 카드 클릭=게임방 입장.
  // (AI 버튼 노출은 각 게임방이 bot.js 존재 여부로 자체 결정)

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
    // 인원 범위 초과/미달 카드는 선택 불가
    if (card.classList.contains('player-disabled')) return;
    // 결정 B: presence 기반 AI 자동결정 제거. 카드 클릭은 항상 게임방(대기) 입장.
    // 봇 미지원 게임이어도 카드 클릭 가능(게임방 입장). AI 버튼 노출 여부는 게임방이 자체 결정.
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
 * @param {{count:number, target?:number, role:'host'|'guest', mode:string|null, votes:object}} msg
 */
function updateLobbyUI(msg) {
  const { count, role, mode, votes } = msg;
  const target = msg.target || 2; // 후방호환: target 없으면 2
  myRole = role;
  currentMode = mode;
  currentCount = count;
  currentTarget = target;
  currentVotes = votes || {};
  currentAiSlotCount = msg.aiSlotCount || 0;

  // 카운트 표시 — N/M (현재/목표) 형식
  const countEl = document.getElementById('player-count');
  if (countEl) countEl.textContent = `${count}/${target}`;

  // 역할 표시
  const roleEl = document.getElementById('player-role');
  if (roleEl) roleEl.textContent = role === 'host' ? '호스트' : '게스트';

  // 인원 선택 UI — 호스트에게만 표시
  const selectorEl = document.getElementById('player-count-selector');
  if (selectorEl) {
    selectorEl.hidden = role !== 'host';
    // 현재 target에 맞는 버튼에 active 클래스 부여
    for (const btn of selectorEl.querySelectorAll('.pcs-btn')) {
      const btnTarget = Number(btn.dataset.target);
      btn.classList.toggle('active', btnTarget === target);
    }
  }

  // 힌트 텍스트 — 게스트 2/2에서는 #guest-waiting만 표시하므로 중복 방지
  const hintEl = document.getElementById('lobby-hint');
  const guestWait = document.getElementById('guest-waiting');
  if (hintEl) {
    if (role === 'guest') {
      // 게스트에게 투표 안내 힌트 표시
      hintEl.textContent = '투표 버튼으로 하고 싶은 게임을 추천할 수 있어요 \uD83D\uDC4D';
    } else if (count + currentAiSlotCount >= target && currentAiSlotCount > 0) {
      hintEl.textContent = 'AI로 채웠습니다! 종목을 선택하세요';
    } else if (count < target) {
      hintEl.textContent = `${target}명이 모이면 종목을 선택할 수 있어요 (현재 ${count}/${target})`;
    } else {
      hintEl.textContent = '인원이 모였습니다! 종목을 선택하세요';
    }
  }

  // 게스트 대기 안내 — 호스트에게는 숨김
  if (guestWait) guestWait.hidden = role === 'host';

  // cardClickEnabled: 호스트이면 클릭 가능.
  // 단, targetPlayers>=3이면 정원이 채워져야만 클릭 가능 (목표 인원 대기).
  // AI 슬롯 포함하여 정원 충족 시 카드 클릭 가능.
  // targetPlayers=2(기본값)는 기존과 동일하게 1인도 즉시 클릭 가능 (AI 모드 하위 호환).
  cardClickEnabled = role === 'host' && (target <= 2 || (count + currentAiSlotCount) >= target);

  // 그리드 비활성 CSS 클래스 갱신
  const grid = document.getElementById(GRID_EL_ID);
  if (grid) {
    // 게스트이면 항상 guest-mode (카드 비활성, 투표 버튼만 활성)
    grid.classList.toggle('guest-mode', role === 'guest');
    // 결정 B: ai-mode(1인 봇 미지원 카드 비활성) 토글 제거 — 카드는 항상 클릭 가능
  }

  // 게임 카드별 인원 범위 활성/비활성 갱신 (실제 인원 + AI 슬롯 합산)
  updateCardPlayerDisabled(count + currentAiSlotCount);

  // AI 채우기 컨트롤 표시/숨김
  const aiControls = document.getElementById('ai-fill-controls');
  if (aiControls) {
    // 호스트 + 3인 이상 목표 + 빈 슬롯 존재 (AI 채운 상태에서도 취소 버튼 보이려면 표시 유지)
    const canShowAiFill = role === 'host' && target >= 3 && (count < target || currentAiSlotCount > 0);
    aiControls.hidden = !canShowAiFill;
  }
  const btnFillAi = document.getElementById('btn-fill-ai');
  if (btnFillAi) {
    // AI 채우기 버튼: 빈 슬롯이 있고 아직 AI 안 채웠을 때만 활성
    const hasEmptySlots = (target - count - currentAiSlotCount) > 0;
    btnFillAi.disabled = !hasEmptySlots;
    btnFillAi.hidden = currentAiSlotCount > 0; // AI 채운 상태면 채우기 버튼 숨김
  }
  const btnCancelAi = document.getElementById('btn-cancel-ai');
  if (btnCancelAi) {
    btnCancelAi.hidden = currentAiSlotCount === 0;
  }
  const aiFillHint = document.getElementById('ai-fill-hint');
  if (aiFillHint) {
    aiFillHint.textContent = currentAiSlotCount > 0
      ? `AI ${currentAiSlotCount}명 대기 중`
      : '';
  }

  // 접속자 목록 (presence) 실시간 렌더 — 새로고침 불필요
  if (Array.isArray(msg.players)) {
    renderPresence(msg.players, msg.aiSlots);
  }

  // 투표 배지 갱신
  updateVoteBadges();
}

/**
 * 접속자 목록을 #presence-list에 렌더한다.
 * 각 항목: 🟢 [name]. name이 null이면 '(입장 중...)' 표시.
 * 본인 항목에는 '(나)' 텍스트 + .self 강조 스타일을 부여한다.
 *   본인 판별: role은 클라당 유일(host/guest)하므로 myRole 일치를 1순위로 쓰고,
 *   동명 방어를 위해 name(myName)도 함께 비교한다. 첫 일치 1개에만 표시한다.
 * AI 슬롯은 실제 플레이어 뒤에 이어 표시한다.
 * @param {Array<{id:string, name:string|null, role:string, online:boolean}>} players
 * @param {Array<{id:string, name:string, online:boolean}>} [aiSlots] AI 슬롯 목록
 */
function renderPresence(players, aiSlots) {
  const listEl = document.getElementById('presence-list');
  if (!listEl) return;
  listEl.innerHTML = '';
  let selfMarked = false; // 첫 일치 1개에만 '(나)' 표시 (동명 케이스 방어)
  for (const p of players) {
    const item = document.createElement('span');
    item.className = 'presence-item';
    if (!p.online) item.classList.add('offline');
    // 본인 판별: 아직 표시 전이고 role+name이 내 것과 일치하는 첫 항목
    const isSelf = !selfMarked && p.role === myRole && p.name === myName;
    if (isSelf) {
      item.classList.add('self');
      selfMarked = true;
    }
    const dot = document.createElement('span');
    dot.className = 'presence-dot';
    dot.textContent = p.online ? '\uD83D\uDFE2' : '\u26AA';
    dot.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.className = 'presence-name';
    label.textContent = (p.name || '(입장 중...)') + (isSelf ? ' (나)' : '');
    item.appendChild(dot);
    item.appendChild(label);
    listEl.appendChild(item);
  }
  // AI 슬롯 항목 렌더
  for (const ai of (aiSlots || [])) {
    const item = document.createElement('span');
    item.className = 'presence-item ai-slot';
    const dot = document.createElement('span');
    dot.className = 'presence-dot';
    dot.textContent = '\uD83E\uDD16';
    dot.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.className = 'presence-name';
    label.textContent = ai.name;
    item.appendChild(dot);
    item.appendChild(label);
    listEl.appendChild(item);
  }
}

/** @type {number|null} 토스트 자동 소멸 타이머. */
let toastTimer = null;

/**
 * 로비 토스트를 표시한다 (2.5초 자동 소멸).
 * @param {string} text 표시할 텍스트
 */
function showLobbyToast(text) {
  const toastEl = document.getElementById('lobby-toast');
  if (!toastEl) return;
  toastEl.textContent = text;
  toastEl.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.classList.remove('show');
    toastTimer = null;
  }, 2500);
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
 * 게임 카드의 인원 범위 비활성 상태를 갱신한다.
 * currentCount가 game.maxPlayers 초과이면 항상 "최대 N인까지" 비활성 표시.
 * currentCount가 game.minPlayers 미만이면 "최소 N인 필요" 비활성 표시 —
 *   단, currentTarget=2(기본값)일 때는 미적용 (1인이 AI 모드로 입장 가능한 하위 호환 흐름).
 * @param {number} count 현재 접속 인원 수
 */
function updateCardPlayerDisabled(count) {
  const grid = document.getElementById(GRID_EL_ID);
  if (!grid) return;
  // targetPlayers>=3이면 minPlayers 미달 비활성 적용. 기본값(2)이면 AI 모드 호환으로 미적용.
  const applyMinCheck = currentTarget > 2;
  for (const card of grid.querySelectorAll('.game-card')) {
    const gameId = card.dataset.gameId;
    const game = gamesCache.find((g) => g.id === gameId);
    if (!game) continue;

    const minP = game.minPlayers || 2;
    const maxP = game.maxPlayers || 2;

    if (applyMinCheck && count < minP) {
      card.classList.add('player-disabled');
      card.dataset.disableReason = `최소 ${minP}인 필요`;
    } else if (count > maxP) {
      card.classList.add('player-disabled');
      card.dataset.disableReason = `최대 ${maxP}인까지`;
    } else {
      card.classList.remove('player-disabled');
      delete card.dataset.disableReason;
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
  // 닉네임을 ?name= 쿼리로 게임 방에 전달 (포크 A — 게임 방이 첫 JOIN에 사용)
  // 다인용 확장: playerCount를 ?players=N 으로 전달하여 게임 서버가 정원을 설정
  const playerCount = msg.playerCount || currentTarget || 2;
  const targetPath = `${basePath}${sep}mode=${encodeURIComponent(msg.mode || 'human')}&name=${encodeURIComponent(myName || '')}&players=${playerCount}`;
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
 * @param {object} [msg] FULL 메시지 (target 포함 가능)
 */
function showFullAlert(msg) {
  const target = (msg && msg.target) || currentTarget || 2;
  const statusEl = document.getElementById('lobby-status');
  if (statusEl) {
    statusEl.textContent = '현재 게임이 진행 중입니다. 잠시 후 다시 시도하세요.';
    statusEl.classList.add('full');
  }
  // 카운트/역할 표시도 정리
  const countEl = document.getElementById('player-count');
  if (countEl) countEl.textContent = `${target}/${target}`;
  const roleEl = document.getElementById('player-role');
  if (roleEl) roleEl.textContent = '관전 불가';
}

/**
 * RESET 수신 (호스트 disconnect 등): 로비 상태 초기화.
 */
function resetToLobby() {
  currentVotes = {};
  currentTarget = 2;
  currentAiSlotCount = 0;
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
    case 'PLAYER_JOINED':
      // 입장 토스트 (목록 갱신은 뒤따르는 LOBBY_STATE가 담당)
      showLobbyToast(`${msg.name || '(알 수 없음)'}님이 입장했습니다.`);
      break;
    case 'PLAYER_LEFT':
      // 퇴장 토스트 (목록 갱신은 뒤따르는 LOBBY_STATE가 담당)
      showLobbyToast(`${msg.name || '(알 수 없음)'}님이 나갔습니다.`);
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
      showFullAlert(msg);
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
    // 닉네임 게이트 통과 후에만 connectWS가 호출되므로 즉시 JOIN 송신.
    // (동일 TCP 스트림 — 서버 connection 처리 완료 후 메시지가 도착함)
    if (myName) {
      ws.send(JSON.stringify({ type: 'JOIN', name: myName }));
    }
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

// ── 닉네임 게이트 ──────────────────────────────────────────────
/**
 * 닉네임 게이트를 통과하여 로비로 진입한다.
 * 게이트를 숨기고 로비를 표시한 뒤 WS 연결 → open에서 JOIN 송신.
 * @param {string} name 확정된 닉네임 (1~12자)
 */
function enterLobby(name) {
  myName = name;
  const gate = document.getElementById('nickname-gate');
  const lobby = document.getElementById('lobby-view');
  if (gate) gate.classList.add('hidden');
  if (lobby) lobby.classList.remove('hidden');
  connectWS();
}

/**
 * 닉네임 게이트 UI를 초기화하고 제출 핸들러를 연결한다.
 * localStorage에 저장된 닉네임이 있으면 게이트를 건너뛰고 즉시 로비에 진입한다.
 * 없으면 input에 포커스를 주고 사용자 입력을 대기한다.
 */
function setupNicknameGate() {
  const input = /** @type {HTMLInputElement|null} */ (document.getElementById('nickname-input'));
  const btn = document.getElementById('btn-enter-lobby');
  const errEl = document.getElementById('nickname-error');

  // 재방문 자동 pre-fill
  let stored = '';
  try { stored = localStorage.getItem(NICKNAME_KEY) || ''; } catch (_) { stored = ''; }

  // 저장된 닉네임이 있으면 게이트 표시 없이 즉시 로비 진입
  if (stored) {
    enterLobby(stored);
    return;
  }

  /**
   * 닉네임 제출: trim + 길이 검사(1~12자) → 저장 → 로비 진입.
   */
  const submit = () => {
    if (!input) return;
    const name = input.value.trim().slice(0, 12);
    if (!name) {
      if (errEl) errEl.textContent = '닉네임을 입력하세요.';
      input.focus();
      return;
    }
    if (errEl) errEl.textContent = '';
    try { localStorage.setItem(NICKNAME_KEY, name); } catch (_) { /* noop */ }
    enterLobby(name);
  };

  if (btn) btn.addEventListener('click', submit);
  if (input) {
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        submit();
      }
    });
    input.focus();
  }
}

// ── 인원 선택 UI ──────────────────────────────────────────────
/**
 * 호스트 전용 인원 선택 버튼에 이벤트를 바인딩한다.
 * 버튼 클릭 시 SET_TARGET WS 메시지를 서버로 전송한다.
 */
function setupPlayerCountSelector() {
  const selectorEl = document.getElementById('player-count-selector');
  if (!selectorEl) return;
  selectorEl.addEventListener('click', (event) => {
    const btn = /** @type {HTMLElement} */ (event.target).closest('.pcs-btn');
    if (!btn) return;
    const target = Number(btn.dataset.target);
    if (!target || target < 2 || target > 5) return;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'SET_TARGET', target }));
  });
}

// ── AI 채우기 버튼 ────────────────────────────────────────────
/**
 * AI 채우기 / AI 취소 버튼에 이벤트를 바인딩한다.
 * FILL_WITH_AI / CANCEL_AI_FILL WS 메시지를 서버로 전송한다.
 */
function setupAiFillButtons() {
  const btnFillAi = document.getElementById('btn-fill-ai');
  const btnCancelAi = document.getElementById('btn-cancel-ai');

  if (btnFillAi) {
    btnFillAi.addEventListener('click', () => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: 'FILL_WITH_AI' }));
    });
  }

  if (btnCancelAi) {
    btnCancelAi.addEventListener('click', () => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: 'CANCEL_AI_FILL' }));
    });
  }
}

// ── 부트스트랩 ─────────────────────────────────────────────────
/**
 * 페이지 초기화.
 * 닉네임 게이트를 먼저 표시하고, 게임 카드는 미리 렌더해 둔다(로비 진입 시 즉시 표시).
 * WS 연결·JOIN 송신은 게이트 통과 후에만 일어난다.
 */
async function init() {
  // 게임 목록 로드 후 즉시 카드 렌더링 (로비는 hidden 상태이므로 사용자엔 비노출)
  try {
    gamesCache = await loadGames();
    renderCards();
  } catch (err) {
    console.error(err);
    const grid = document.getElementById(GRID_EL_ID);
    if (grid) renderMessage(grid, '게임 목록을 불러올 수 없습니다. (콘솔 확인)');
  }

  // 인원 선택 UI 이벤트 바인딩
  setupPlayerCountSelector();

  // AI 채우기 버튼 이벤트 바인딩
  setupAiFillButtons();

  // 닉네임 게이트 표시 — 제출 전까지 WS 연결/JOIN 보류
  setupNicknameGate();
}

document.addEventListener('DOMContentLoaded', init);
