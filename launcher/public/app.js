/**
 * @fileoverview 미니게임 천국 런처 클라이언트 — 포탈 + 게임별 대기실.
 *
 *   포탈 뷰: WS 연결 없이 games.json을 fetch하여 게임 카드 그리드를 표시한다.
 *   대기실 뷰: 카드 클릭 시 `/lobby/ws?gameId={gameId}` WS 연결 → ROOM_STATE 수신 → 준비/시작.
 *
 *   상태 흐름:
 *     닉네임 게이트 → 포탈 (WS 없음, 카드 그리드)
 *        ↓  카드 클릭
 *     대기실 (WS 연결, READY 대기)
 *        ↓  REDIRECT 수신
 *     location.href = `/{gameId}/?mode=...` (게임 페이지로 이동)
 */

const GRID_EL_ID = 'game-grid';

/** localStorage 닉네임 키 (오목 방의 omok:name과 충돌 방지). */
const NICKNAME_KEY = 'minigames:nickname';

/** @returns {'ko'|'en'} 별빛 우편탑과 공유하는 런처 표시 언어 */
function getLauncherLocale() { return localStorage.getItem('starlight-locale') === 'en' ? 'en' : 'ko'; }

/** @param {string} key 문구 키 @param {Record<string,string|number>} [values] 치환 값 @returns {string} 현재 런처 언어 문구 */
function launcherText(key, values = {}) {
  const copy = {
    ko: { enter: '입장', ready: '준비', cancelReady: '준비 ✓', waiting: '대기 중', me: '나', connecting: '서버에 연결 중...', joined: '대기실에 입장했습니다.', disconnected: '연결이 끊겼습니다.', starting: '게임을 시작합니다...', needPlayers: '{min}명 이상 필요 (현재 {count}/{max})', notReady: '{count}명이 아직 준비하지 않았습니다.', allReady: '모두 준비 완료!', moving: '{game}로 이동 중...', empty: '친구를 기다리는 중', leave: '나가기' },
    en: { enter: 'Enter', ready: 'READY', cancelReady: 'READY ✓', waiting: 'Waiting', me: 'Me', connecting: 'Connecting to server...', joined: 'Joined the waiting room.', disconnected: 'Connection lost.', starting: 'Starting game...', needPlayers: 'Need {min} players ({count}/{max})', notReady: '{count} player(s) are not ready.', allReady: 'Everyone is ready!', moving: 'Moving to {game}...', empty: 'Waiting for a friend', leave: 'Leave' },
  };
  return Object.entries(values).reduce((text, [name, value]) => text.replace(`{${name}}`, String(value)), copy[getLauncherLocale()][key] || key);
}

/** @param {object} game 게임 메타 @param {string} field 지역화 필드명 @returns {string} */
function localizedGameField(game, field) { const suffix = getLauncherLocale() === 'en' ? 'En' : 'Ko'; return game[`${field}${suffix}`] || game[field] || ''; }

// ── 모듈 수준 상태 ─────────────────────────────────────────────
/** @type {WebSocket | null} 대기실 WS 연결 (포탈 뷰에서는 null) */
let ws = null;

/** @type {string} 닉네임 게이트 통과 후 확정된 내 닉네임. JOIN 송신에 사용. */
let myName = '';

/** @type {Array<object>} games.json 캐시 */
let gamesCache = [];

/** @type {string|null} 현재 대기실에 입장한 gameId (포탈 뷰에서는 null) */
let currentGameId = null;

/** @type {object|null} 가장 최근 수신한 ROOM_STATE */
let lastRoomState = null;

// ── 유틸 ───────────────────────────────────────────────────────
/** @type {number|null} 토스트 자동 소멸 타이머. */
let toastTimer = null;

/**
 * 토스트를 표시한다 (2.5초 자동 소멸).
 * 현재 활성 뷰의 토스트 요소를 자동 탐색한다.
 * @param {string} text 표시할 텍스트
 */
function showToast(text) {
  // 대기실 뷰가 표시 중이면 wr-toast, 아니면 범용
  const toastEl = document.getElementById('wr-toast');
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
 * 클릭 시 enterWaitingRoom(gameId)을 호출한다.
 * @param {object} game games.json 한 항목
 * @returns {HTMLElement}
 */
function createCard(game) {
  const card = document.createElement('article');
  card.className = 'game-card';
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  const localizedName = localizedGameField(game, 'name');
  const localizedDescription = localizedGameField(game, 'description');
  card.setAttribute('aria-label', getLauncherLocale() === 'en' ? `Select ${localizedName}. ${localizedDescription}` : `${localizedName} 선택. ${localizedDescription}`);
  card.dataset.gameId = game.id;
  card.dataset.botAvailable = game.botAvailable ? 'true' : 'false';
  card.style.setProperty('--game-color', game.color);

  // 상단 컬러 띠
  const stripe = document.createElement('div');
  stripe.className = 'game-card-stripe';
  card.appendChild(stripe);

  // 본문
  const body = document.createElement('div');
  body.className = 'game-card-body';

  if (game.keyArt) {
    const keyArt = document.createElement('img'); keyArt.className = 'game-card-keyart'; keyArt.src = game.keyArt; keyArt.width = 160; keyArt.height = 96; keyArt.alt = ''; keyArt.setAttribute('aria-hidden', 'true'); body.appendChild(keyArt);
  } else {
    const emoji = document.createElement('div'); emoji.className = 'game-card-emoji'; emoji.textContent = game.emoji || ''; emoji.setAttribute('aria-hidden', 'true'); body.appendChild(emoji);
  }

  const title = document.createElement('h2');
  title.className = 'game-card-title';
  title.textContent = localizedName;
  body.appendChild(title);

  const desc = document.createElement('p');
  desc.className = 'game-card-desc';
  desc.textContent = localizedDescription;
  body.appendChild(desc);

  if (game.playersLabelKo || game.playersLabelEn || game.botLabelKo || game.botLabelEn) {
    const meta = document.createElement('div'); meta.className = 'game-card-meta';
    const suffix = getLauncherLocale() === 'en' ? 'En' : 'Ko';
    // 선택적 메타 필드는 존재하는 값만 조합해 카드에 "undefined"가 노출되지 않게 한다.
    meta.textContent = [game[`playersLabel${suffix}`], game[`botLabel${suffix}`]]
      .filter((label) => typeof label === 'string' && label.trim())
      .join(' · ');
    if (meta.textContent) body.appendChild(meta);
  }

  // 단일 포트 통합 라우터에서는 path(`/matgo/` 등)를 표시한다.
  const port = document.createElement('div');
  port.className = 'game-card-port';
  port.textContent = game.httpPath || `/${game.id}/`;
  body.appendChild(port);

  const btn = document.createElement('button');
  btn.className = 'game-card-play';
  btn.type = 'button';
  btn.textContent = launcherText('enter');
  body.appendChild(btn);

  card.appendChild(body);

  // ── 클릭/키보드 핸들러 ────────────────────────────
  /**
   * 카드 클릭 시 해당 게임의 대기실로 진입한다.
   * 닉네임 게이트를 통과한 모든 사용자가 클릭 가능.
   */
  const pick = (event) => {
    if (event) event.stopPropagation();
    enterWaitingRoom(game.id);
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
}

// ── 뷰 전환 ────────────────────────────────────────────────────
/**
 * 지정한 뷰만 표시하고 나머지를 숨긴다.
 * @param {'nickname-gate' | 'portal-view' | 'waiting-room-view'} viewId
 */
function showView(viewId) {
  const views = ['nickname-gate', 'portal-view', 'waiting-room-view'];
  for (const id of views) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (id === viewId) {
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  }
}

// ── 포탈 뷰 ────────────────────────────────────────────────────
/**
 * 포탈 뷰를 표시한다. WS 연결 없이 게임 카드만 표시.
 * 닉네임 인사말을 갱신한다.
 */
function enterPortal() {
  // 닉네임 인사말 갱신
  const nameEl = document.getElementById('portal-player-name');
  if (nameEl) nameEl.textContent = `${myName}님, 게임을 골라주세요!`;

  showView('portal-view');
}

// ── 대기실 뷰 ──────────────────────────────────────────────────
/**
 * 대기실 뷰로 전환하고 WS를 연결한다.
 * @param {string} gameId 입장할 게임의 ID
 */
function enterWaitingRoom(gameId) {
  // 이미 대기실에 있으면 무시
  if (currentGameId && ws) return;

  currentGameId = gameId;
  document.getElementById('waiting-room-view').dataset.gameId = gameId;
  lastRoomState = null;

  // 게임 이름 표시
  const game = gamesCache.find(g => g.id === gameId);
  const gameNameEl = document.getElementById('wr-game-name');
  if (gameNameEl) gameNameEl.textContent = game ? localizedGameField(game, 'name') : gameId;

  // 준비 버튼 초기화
  const readyBtn = document.getElementById('btn-ready');
  if (readyBtn) {
    readyBtn.classList.remove('ready');
    readyBtn.textContent = launcherText('ready');
  }

  const leaveBtn = document.getElementById('btn-leave-room');
  if (leaveBtn) leaveBtn.textContent = launcherText('leave');

  // AI 채우기 버튼 숨김
  const fillAiBtn = document.getElementById('btn-wr-fill-ai');
  if (fillAiBtn) fillAiBtn.hidden = true;

  // 플레이어 목록 초기화
  const playersEl = document.getElementById('wr-players');
  if (playersEl) playersEl.innerHTML = '';

  // 상태 텍스트 초기화
  const statusEl = document.getElementById('wr-status');
  if (statusEl) statusEl.textContent = launcherText('connecting');

  // 뷰 전환
  showView('waiting-room-view');

  // WS 연결
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const host = location.host || 'localhost:3000';
  const url = `${proto}://${host}/lobby/ws?gameId=${encodeURIComponent(gameId)}`;
  ws = new WebSocket(url);

  ws.addEventListener('open', () => {
    const statusEl = document.getElementById('wr-status');
    if (statusEl) statusEl.textContent = launcherText('joined');
    // 닉네임 전송
    if (myName) {
      ws.send(JSON.stringify({ type: 'JOIN', name: myName }));
    }
  });

  ws.addEventListener('message', onWaitingRoomMessage);

  ws.addEventListener('close', (event) => {
    // REDIRECT/LEAVE_ROOM/ROOM_FULL/KICKED 에 의한 정상 종료가 아닌 경우
    if (currentGameId) {
      // 예외적 연결 종료 — 포탈 뷰로 복귀
      showToast(launcherText('disconnected'));
      leaveWaitingRoom(true);
    }
  });

  ws.addEventListener('error', (err) => {
    console.error('[launcher] WS 에러:', err);
  });
}

/**
 * 대기실에서 나간다. WS 연결을 닫고 포탈 뷰로 복귀한다.
 * @param {boolean} [skipSend=false] LEAVE_ROOM 메시지 전송 생략 여부 (이미 연결 종료된 경우)
 */
function leaveWaitingRoom(skipSend = false) {
  if (ws && !skipSend) {
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'LEAVE_ROOM' }));
      }
    } catch (_) { /* noop */ }
  }
  if (ws) {
    // close 이벤트에서 재진입 방지
    const oldWs = ws;
    ws = null;
    currentGameId = null;
    lastRoomState = null;
    try { oldWs.close(); } catch (_) { /* noop */ }
  } else {
    currentGameId = null;
    lastRoomState = null;
  }
  enterPortal();
}

/**
 * 대기실 WS 메시지 디스패치.
 * @param {MessageEvent} event
 */
function onWaitingRoomMessage(event) {
  let msg;
  try {
    msg = JSON.parse(event.data);
  } catch (err) {
    console.warn('[launcher] 잘못된 WS 메시지:', err.message);
    return;
  }

  switch (msg.type) {
    case 'ROOM_STATE':
      updateWaitingRoomUI(msg);
      break;

    case 'ROOM_FULL':
      showToast(`방이 꽉 찼습니다. (최대 ${msg.maxPlayers}명)`);
      leaveWaitingRoom(true);
      break;

    case 'KICKED':
      showToast('준비 시간 초과로 퇴장되었습니다.');
      leaveWaitingRoom(true);
      break;

    case 'REDIRECT':
      handleRedirect(msg);
      break;

    case 'ERROR':
      showToast(msg.message || '오류가 발생했습니다.');
      break;

    default:
      console.warn('[launcher] 알 수 없는 메시지 타입:', msg.type);
  }
}

/**
 * ROOM_STATE 수신 시 대기실 뷰를 갱신한다.
 * @param {object} msg ROOM_STATE 페이로드
 */
function updateWaitingRoomUI(msg) {
  lastRoomState = msg;

  // ── 플레이어 목록 렌더 ──
  const playersEl = document.getElementById('wr-players');
  if (playersEl) {
    playersEl.innerHTML = '';

    // 실제 플레이어 카드
    for (const [playerIndex, p] of msg.players.entries()) {
      const card = document.createElement('div');
      const role = playerIndex === 0 ? 'a' : 'b';
      card.className = `player-ready-card role-${role}`;
      if (p.ready) card.classList.add('ready');
      if (p.id === msg.myId) card.classList.add('self');

      const roleMark = document.createElement('span');
      roleMark.className = 'prc-role';
      const isMoonlightKitchen = msg.gameId === 'moonlight-kitchen-express';
      roleMark.textContent = isMoonlightKitchen ? (role === 'a' ? '☾' : '★') : (role === 'a' ? '△' : '○');
      roleMark.setAttribute('aria-label', `Role ${role.toUpperCase()}`);
      card.appendChild(roleMark);

      // 호스트 표시
      if (p.isHost) {
        const hostLabel = document.createElement('div');
        hostLabel.className = 'prc-host';
        hostLabel.textContent = 'HOST';
        card.appendChild(hostLabel);
      }

      // 이름
      const nameEl = document.createElement('div');
      nameEl.className = 'prc-name';
      nameEl.textContent = p.name + (p.id === msg.myId ? ` (${launcherText('me')})` : '');
      card.appendChild(nameEl);

      // 준비 상태 뱃지
      const badge = document.createElement('div');
      badge.className = 'prc-badge ' + (p.ready ? 'is-ready' : 'not-ready');
      badge.textContent = p.ready ? 'READY' : launcherText('waiting');
      card.appendChild(badge);

      const stateIcon = document.createElement('span');
      stateIcon.className = 'prc-state-icon';
      stateIcon.setAttribute('aria-hidden', 'true');
      stateIcon.innerHTML = '<i></i>';
      card.appendChild(stateIcon);

      playersEl.appendChild(card);
    }

    // AI도 정원을 점유하므로 실인원과 AI를 합친 뒤 남은 자리만 빈 슬롯으로 표시한다.
    const aiSlots = Array.isArray(msg.aiSlots) ? msg.aiSlots : [];
    const occupiedSlotCount = Math.min(msg.maxPlayers, msg.players.length + aiSlots.length);
    for (let slotIndex = occupiedSlotCount; slotIndex < msg.maxPlayers; slotIndex += 1) {
      const role = slotIndex === 0 ? 'a' : 'b';
      const card = document.createElement('div');
      card.className = `player-ready-card role-${role} empty-slot`;
      const emptyRoleMark = msg.gameId === 'moonlight-kitchen-express' ? (role === 'a' ? '☾' : '★') : (role === 'a' ? '△' : '○');
      card.innerHTML = `<span class="prc-role" aria-label="Role ${role.toUpperCase()}">${emptyRoleMark}</span><div class="prc-name">${launcherText('empty')}</div><div class="prc-badge not-ready">${launcherText('waiting')}</div><span class="prc-state-icon" aria-hidden="true"><i></i></span>`;
      playersEl.appendChild(card);
    }

    // AI 슬롯 카드
    for (const ai of aiSlots) {
      const card = document.createElement('div');
      card.className = 'player-ready-card ai-slot ready';

      const nameEl = document.createElement('div');
      nameEl.className = 'prc-name';
      nameEl.textContent = ai.name;
      card.appendChild(nameEl);

      const badge = document.createElement('div');
      badge.className = 'prc-badge is-ready';
      badge.textContent = 'AI';
      card.appendChild(badge);

      playersEl.appendChild(card);
    }
    playersEl.classList.toggle('both-ready', msg.players.length === msg.maxPlayers && msg.players.every((player) => player.ready));
  }

  // ── 준비 버튼 상태 ──
  const readyBtn = document.getElementById('btn-ready');
  if (readyBtn) {
    if (msg.myReady) {
      readyBtn.classList.add('ready');
      readyBtn.textContent = launcherText('cancelReady');
    } else {
      readyBtn.classList.remove('ready');
      readyBtn.textContent = launcherText('ready');
    }
  }

  // ── AI 채우기 버튼 (호스트 전용) ──
  const fillAiBtn = document.getElementById('btn-wr-fill-ai');
  if (fillAiBtn) {
    // 본인이 호스트인지 판별 (players의 첫 번째가 호스트)
    const amIHost = msg.players.length > 0 && msg.players[0].id === msg.myId;
    // 봇 지원 게임인지 확인
    const game = gamesCache.find(g => g.id === msg.gameId);
    const botAvailable = game ? game.botAvailable : false;
    // AI 슬롯이 아직 없고, 빈 자리가 있고, 봇 지원이면 표시
    // 일부 다인 게임은 사람 대전 정원과 AI 대전 정원이 다르다.
    // 예: 윷놀이는 사람 2~4인을 유지하되 AI 채우기는 정확히 1 human + 1 AI로 시작한다.
    const aiFillTargetPlayers = Math.min(
      msg.maxPlayers,
      Number.isInteger(game?.aiFillTargetPlayers) ? game.aiFillTargetPlayers : msg.maxPlayers,
    );
    const hasEmptySlots = msg.totalCount < aiFillTargetPlayers;
    fillAiBtn.hidden = !amIHost || !botAvailable || !hasEmptySlots || (msg.aiSlots && msg.aiSlots.length > 0);
  }

  // ── 상태 텍스트 ──
  const statusEl = document.getElementById('wr-status');
  if (statusEl) {
    if (msg.canStart) {
      statusEl.textContent = launcherText('starting');
    } else if (msg.totalCount < msg.minPlayers) {
      statusEl.textContent = launcherText('needPlayers', { min: msg.minPlayers, count: msg.totalCount, max: msg.maxPlayers });
    } else {
      const notReadyCount = msg.players.filter(p => !p.ready).length;
      if (notReadyCount > 0) {
        statusEl.textContent = launcherText('notReady', { count: notReadyCount });
      } else {
        statusEl.textContent = launcherText('allReady');
      }
    }
  }
}

/**
 * 준비 버튼 클릭 핸들러. READY 메시지를 전송한다 (토글).
 */
function handleReady() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'READY' }));
}

/**
 * AI 채우기 버튼 클릭 핸들러. FILL_WITH_AI 메시지를 전송한다 (호스트 전용).
 */
function handleFillWithAi() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'FILL_WITH_AI' }));
}

/**
 * REDIRECT 수신: 해당 게임 페이지로 이동.
 * @param {{path?:string, gameId:string, mode:string, playerCount?:number,role?:string,transitionMs?:number}} msg
 */
function handleRedirect(msg) {
  // REDIRECT 수신 후에는 close 이벤트에서 재진입하지 않도록 상태 정리
  const oldWs = ws;
  ws = null;
  currentGameId = null;
  lastRoomState = null;

  // 통합 라우터에서는 동일 origin의 path로 이동.
  const basePath = msg.path || `/${msg.gameId}/`;
  const sep = basePath.includes('?') ? '&' : '?';
  const playerCount = msg.playerCount || 2;
  const targetPath = `${basePath}${sep}mode=${encodeURIComponent(msg.mode || 'human')}&name=${encodeURIComponent(myName || '')}&players=${playerCount}&role=${encodeURIComponent(msg.role || '')}&lobbyReady=1&fresh=1`;

  // 약간의 시각 피드백
  const statusEl = document.getElementById('wr-status');
  if (statusEl) statusEl.textContent = launcherText('moving', { game: msg.gameId });

  // WS 닫기
  try { if (oldWs) oldWs.close(); } catch (_) { /* noop */ }

  // 즉시 이동
  setTimeout(() => {
    location.href = targetPath;
  }, Math.min(600, Math.max(80, msg.transitionMs || 80)));
}

// ── 닉네임 게이트 ──────────────────────────────────────────────
/**
 * 닉네임 게이트를 통과하여 포탈로 진입한다.
 * 게이트를 숨기고 포탈을 표시한다 (WS 연결 없음).
 * @param {string} name 확정된 닉네임 (1~12자)
 */
function enterLobby(name) {
  myName = name;
  enterPortal();
}

/**
 * 닉네임 게이트 UI를 초기화하고 제출 핸들러를 연결한다.
 * localStorage에 저장된 닉네임이 있으면 게이트를 건너뛰고 즉시 포탈에 진입한다.
 * 없으면 input에 포커스를 주고 사용자 입력을 대기한다.
 */
function setupNicknameGate() {
  const input = /** @type {HTMLInputElement|null} */ (document.getElementById('nickname-input'));
  const btn = document.getElementById('btn-enter-lobby');
  const errEl = document.getElementById('nickname-error');

  // 재방문 자동 pre-fill
  let stored = '';
  try { stored = localStorage.getItem(NICKNAME_KEY) || ''; } catch (_) { stored = ''; }

  // 저장된 닉네임이 있으면 게이트 표시 없이 즉시 포탈 진입
  if (stored) {
    enterLobby(stored);
    return;
  }

  /**
   * 닉네임 제출: trim + 길이 검사(1~12자) → 저장 → 포탈 진입.
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

// ── 부트스트랩 ─────────────────────────────────────────────────
/**
 * 페이지 초기화.
 * 닉네임 게이트를 먼저 표시하고, 게임 카드는 미리 렌더해 둔다(포탈 진입 시 즉시 표시).
 * WS 연결은 대기실 진입 시에만 일어난다.
 */
async function init() {
  // 게임 목록 로드 후 즉시 카드 렌더링 (포탈은 hidden 상태이므로 사용자엔 비노출)
  try {
    gamesCache = await loadGames();
    renderCards();
  } catch (err) {
    console.error(err);
    const grid = document.getElementById(GRID_EL_ID);
    if (grid) renderMessage(grid, '게임 목록을 불러올 수 없습니다. (콘솔 확인)');
  }

  // 대기실 버튼 이벤트 바인딩
  const readyBtn = document.getElementById('btn-ready');
  if (readyBtn) readyBtn.addEventListener('click', handleReady);

  const fillAiBtn = document.getElementById('btn-wr-fill-ai');
  if (fillAiBtn) fillAiBtn.addEventListener('click', handleFillWithAi);

  const leaveBtn = document.getElementById('btn-leave-room');
  if (leaveBtn) leaveBtn.addEventListener('click', () => leaveWaitingRoom());

  // 닉네임 게이트 표시 — 제출 전까지 WS 연결 보류
  setupNicknameGate();
}

document.addEventListener('DOMContentLoaded', init);
