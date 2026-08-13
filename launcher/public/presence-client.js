(() => {
  'use strict';

  if (window.__presenceWidgetLoaded) return;
  window.__presenceWidgetLoaded = true;

  const NICKNAME_KEY = 'minigames:nickname';
  const ACTIVE_CHAT_KEY = 'minigames:active-chat';
  const MAX_RECONNECT_MS = 15_000;
  const MAX_CHAT_LENGTH = 500;
  let socket = null;
  let reconnectTimer = null;
  let reconnectDelay = 1_000;
  let stopped = false;
  let gameNames = new Map();
  let latestPresence = { selfId: null, users: [] };
  let activePeer = null;
  let notificationAudioContext = null;
  let lastNotificationSoundAt = 0;
  const messagesByPeer = new Map();
  const unreadByPeer = new Map();

  function readStoredActivePeer() {
    try {
      const stored = JSON.parse(sessionStorage.getItem(ACTIVE_CHAT_KEY) || 'null');
      return stored && typeof stored.id === 'string' && typeof stored.name === 'string'
        ? { id: stored.id, name: stored.name, offline: true }
        : null;
    } catch { return null; }
  }

  function storeActivePeer(peer) {
    try {
      if (peer?.id && peer?.name) sessionStorage.setItem(ACTIVE_CHAT_KEY, JSON.stringify({ id: peer.id, name: peer.name }));
      else sessionStorage.removeItem(ACTIVE_CHAT_KEY);
    } catch { /* session storage is optional */ }
  }

  function localeText() {
    let english = false;
    try { english = localStorage.getItem('starlight-locale') === 'en'; } catch { /* noop */ }
    return english ? {
      title: 'Friends', online: 'online', me: 'Me', lobby: 'Lobby', waiting: 'Waiting', playing: 'Playing',
      empty: 'No one is connected yet.', loading: 'Connecting...', close: 'Close', back: 'Back to friends',
      message: 'Message', placeholder: 'Write a message', send: 'Send', offline: 'Offline',
      offlineError: 'This friend is offline.', rateError: 'Too many messages. Please wait a moment.',
    } : {
      title: '친구 목록', online: '온라인', me: '나', lobby: '로비', waiting: '대기실', playing: '플레이 중',
      empty: '아직 접속한 사람이 없어요.', loading: '접속 정보를 불러오는 중...', close: '닫기', back: '친구 목록으로',
      message: '메시지', placeholder: '메시지를 입력하세요', send: '전송', offline: '오프라인',
      offlineError: '상대가 오프라인 상태입니다.', rateError: '메시지를 너무 빠르게 보냈어요. 잠시 후 다시 시도하세요.',
    };
  }

  function injectWidget() {
    const text = localeText();
    const fab = document.createElement('button');
    fab.id = 'pw-fab';
    fab.className = 'pw-fab';
    fab.type = 'button';
    fab.title = '친구 및 채팅';
    fab.setAttribute('aria-label', '친구 및 채팅 열기');
    fab.setAttribute('aria-controls', 'pw-panel');
    fab.setAttribute('aria-expanded', 'false');
    fab.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM8 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm8 1c-1.1 0-2.1.2-3 .6 1.9 1.1 3 3 3 5.4v1h6v-1c0-3.3-2.7-6-6-6ZM8 14c-3.9 0-7 2.7-7 6v1h14v-1c0-3.3-3.1-6-7-6Z"/></svg>' +
      '<span id="pw-fab-count" class="pw-fab-count">0</span>' +
      '<span id="pw-fab-unread" class="pw-fab-unread" hidden>0</span>';

    const panel = document.createElement('section');
    panel.id = 'pw-panel';
    panel.className = 'pw-panel';
    panel.hidden = true;
    panel.setAttribute('aria-label', text.title);
    panel.innerHTML =
      '<div id="pw-friends-view" class="pw-view">' +
        '<header class="pw-header">' +
          '<div><div class="pw-title"><span class="pw-live-dot" aria-hidden="true"></span><span id="pw-title"></span></div>' +
          '<div id="pw-online-label" class="pw-online-label"></div></div>' +
          '<button class="pw-close" type="button" data-pw-close aria-label="' + text.close + '">×</button>' +
        '</header>' +
        '<div class="pw-list-wrap"><p id="pw-empty" class="pw-empty"></p>' +
          '<ul id="pw-list" class="pw-list" aria-live="polite" aria-label="현재 접속자"></ul></div>' +
      '</div>' +
      '<div id="pw-chat-view" class="pw-view pw-chat-view" hidden>' +
        '<header class="pw-chat-header">' +
          '<button id="pw-chat-back" class="pw-icon-button" type="button" aria-label="' + text.back + '">‹</button>' +
          '<span id="pw-chat-avatar" class="pw-chat-avatar" aria-hidden="true"></span>' +
          '<div class="pw-chat-person"><strong id="pw-chat-name"></strong><span id="pw-chat-status"></span></div>' +
          '<button class="pw-close" type="button" data-pw-close aria-label="' + text.close + '">×</button>' +
        '</header>' +
        '<div id="pw-chat-messages" class="pw-chat-messages" role="log" aria-live="polite" aria-label="대화 내용"></div>' +
        '<p id="pw-chat-error" class="pw-chat-error" role="alert" hidden></p>' +
        '<form id="pw-chat-form" class="pw-chat-form">' +
          '<textarea id="pw-chat-input" rows="1" maxlength="' + MAX_CHAT_LENGTH + '" placeholder="' + text.placeholder + '" aria-label="' + text.placeholder + '"></textarea>' +
          '<button id="pw-chat-send" type="submit">' + text.send + '</button>' +
        '</form>' +
      '</div>';

    panel.querySelector('#pw-title').textContent = text.title;
    panel.querySelector('#pw-online-label').textContent = text.loading;
    panel.querySelector('#pw-empty').textContent = text.loading;
    document.body.append(fab, panel);

    fab.addEventListener('click', () => panel.hidden ? openPanel() : closePanel());
    panel.querySelectorAll('[data-pw-close]').forEach((button) => button.addEventListener('click', closePanel));
    panel.querySelector('#pw-chat-back').addEventListener('click', showFriends);
    panel.querySelector('#pw-chat-form').addEventListener('submit', sendChat);
    panel.querySelector('#pw-chat-input').addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        panel.querySelector('#pw-chat-form').requestSubmit();
      }
    });
    window.addEventListener('minigame-presence-close', closePanel);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !panel.hidden) closePanel();
    });
    document.addEventListener('click', (event) => {
      if (panel.hidden || panel.contains(event.target) || fab.contains(event.target)) return;
      closePanel();
    });
    document.addEventListener('pointerdown', unlockNotificationAudio, { capture: true });
    document.addEventListener('keydown', unlockNotificationAudio, { capture: true });
  }

  function unlockNotificationAudio() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    try {
      notificationAudioContext ||= new AudioContextClass();
      if (notificationAudioContext.state === 'suspended') notificationAudioContext.resume().catch(() => {});
      if (notificationAudioContext.state === 'running') {
        document.removeEventListener('pointerdown', unlockNotificationAudio, { capture: true });
        document.removeEventListener('keydown', unlockNotificationAudio, { capture: true });
      }
    } catch { /* audio support is optional; the visual alert remains available */ }
  }

  function playNotificationSound() {
    const timestamp = Date.now();
    if (timestamp - lastNotificationSoundAt < 1_200) return;
    const audio = notificationAudioContext;
    if (!audio || audio.state !== 'running') return;
    lastNotificationSoundAt = timestamp;
    try {
      const start = audio.currentTime;
      const gain = audio.createGain();
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.075, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.42);
      gain.connect(audio.destination);

      const first = audio.createOscillator();
      first.type = 'sine';
      first.frequency.setValueAtTime(659.25, start);
      first.connect(gain);
      first.start(start);
      first.stop(start + 0.2);

      const second = audio.createOscillator();
      second.type = 'sine';
      second.frequency.setValueAtTime(880, start + 0.17);
      second.connect(gain);
      second.start(start + 0.17);
      second.stop(start + 0.42);
    } catch { /* the unread badge and flashing button still notify the user */ }
  }

  function openPanel() {
    const panel = document.getElementById('pw-panel');
    const fab = document.getElementById('pw-fab');
    const bugPanel = document.getElementById('bw-panel');
    if (bugPanel) bugPanel.hidden = true;
    panel.hidden = false;
    fab.setAttribute('aria-expanded', 'true');
    fab.setAttribute('aria-label', `친구 및 채팅 닫기, 온라인 ${latestPresence.users.length}명`);
    if (activePeer) {
      renderChat();
      markRead(activePeer.id);
      requestChatHistory(activePeer.id);
      document.getElementById('pw-chat-input').focus({ preventScroll: true });
    } else {
      panel.querySelector('[data-pw-close]').focus({ preventScroll: true });
    }
  }

  function closePanel() {
    const panel = document.getElementById('pw-panel');
    const fab = document.getElementById('pw-fab');
    if (!panel || !fab) return;
    panel.hidden = true;
    fab.setAttribute('aria-expanded', 'false');
    fab.setAttribute('aria-label', `친구 및 채팅 열기, 온라인 ${latestPresence.users.length}명, 읽지 않음 ${totalUnread()}개`);
  }

  function showFriends() {
    activePeer = null;
    storeActivePeer(null);
    document.getElementById('pw-chat-view').hidden = true;
    document.getElementById('pw-friends-view').hidden = false;
    document.getElementById('pw-chat-error').hidden = true;
    renderPresence(latestPresence);
    document.getElementById('pw-chat-back').blur();
  }

  function openChat(user) {
    if (!user || user.id === latestPresence.selfId) return;
    activePeer = { ...user };
    storeActivePeer(activePeer);
    document.getElementById('pw-friends-view').hidden = true;
    document.getElementById('pw-chat-view').hidden = false;
    document.getElementById('pw-chat-error').hidden = true;
    renderChat();
    markRead(user.id);
    requestChatHistory(user.id);
    document.getElementById('pw-chat-input').focus({ preventScroll: true });
  }

  function readNickname() {
    const queryName = new URLSearchParams(location.search).get('name') || '';
    if (queryName.trim()) return queryName.trim().slice(0, 12);
    try { return (localStorage.getItem(NICKNAME_KEY) || '').trim().slice(0, 12); } catch { return ''; }
  }

  function deriveState() {
    if (window.__minigamePresenceState?.name) return { ...window.__minigamePresenceState };
    const name = readNickname();
    const firstPath = location.pathname.split('/').filter(Boolean)[0] || '';
    return firstPath ? { name, status: 'playing', gameId: firstPath } : { name, status: 'lobby', gameId: null };
  }

  let currentState = deriveState();

  function sendCurrentState() {
    if (!currentState.name || socket?.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: 'PRESENCE_UPDATE', ...currentState }));
  }

  function requestChatHistory(peerId) {
    if (!peerId || socket?.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: 'CHAT_HISTORY_REQUEST', with: peerId }));
  }

  function updateConnectionState(connected) {
    const panel = document.getElementById('pw-panel');
    if (!panel) return;
    panel.dataset.connected = connected ? 'true' : 'false';
    if (!connected) document.getElementById('pw-online-label').textContent = localeText().loading;
    updateChatAvailability();
  }

  function scheduleReconnect() {
    updateConnectionState(false);
    if (stopped || reconnectTimer || !currentState.name) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, reconnectDelay);
    reconnectDelay = Math.min(MAX_RECONNECT_MS, reconnectDelay * 2);
  }

  function connect() {
    if (stopped || !currentState.name || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(`${protocol}//${location.host}/presence/ws`);
    socket.addEventListener('open', () => {
      reconnectDelay = 1_000;
      updateConnectionState(true);
      sendCurrentState();
      if (activePeer) requestChatHistory(activePeer.id);
    });
    socket.addEventListener('message', (event) => {
      let payload;
      try { payload = JSON.parse(event.data); } catch { return; }
      if (payload?.type === 'PRESENCE_STATE' && Array.isArray(payload.users)) renderPresence(payload);
      if (payload?.type === 'CHAT_MESSAGE' && payload.message) receiveChat(payload.message);
      if (payload?.type === 'CHAT_HISTORY' && Array.isArray(payload.messages)) receiveHistory(payload.with, payload.messages);
      if (payload?.type === 'CHAT_ERROR') showChatError(payload.code);
    });
    socket.addEventListener('close', scheduleReconnect);
    socket.addEventListener('error', () => socket?.close());
  }

  function statusText(user) {
    const text = localeText();
    if (!user || user.offline) return text.offline;
    if (user.status === 'lobby' || !user.gameId) return text.lobby;
    const gameName = gameNames.get(user.gameId) || user.gameId;
    return `${gameName} · ${user.status === 'waiting' ? text.waiting : text.playing}`;
  }

  function renderPresence(message) {
    latestPresence = { selfId: message.selfId || latestPresence.selfId, users: [...message.users] };
    if (!activePeer) activePeer = readStoredActivePeer();
    const badge = document.getElementById('pw-fab-count');
    const label = document.getElementById('pw-online-label');
    const list = document.getElementById('pw-list');
    const empty = document.getElementById('pw-empty');
    if (!badge || !label || !list || !empty) return;

    badge.textContent = message.users.length > 99 ? '99+' : String(message.users.length);
    label.textContent = `${localeText().online} ${message.users.length}명`;
    list.replaceChildren();
    empty.hidden = message.users.length > 0;
    empty.textContent = localeText().empty;

    const users = [...message.users].sort((left, right) => {
      if (left.id === message.selfId) return -1;
      if (right.id === message.selfId) return 1;
      return left.name.localeCompare(right.name, 'ko');
    });

    for (const user of users) list.append(createUserItem(user, message.selfId));
    if (activePeer) {
      const onlinePeer = message.users.find((user) => user.id === activePeer.id);
      activePeer = onlinePeer ? { ...onlinePeer } : { ...activePeer, offline: true };
      storeActivePeer(activePeer);
      document.getElementById('pw-friends-view').hidden = true;
      document.getElementById('pw-chat-view').hidden = false;
      renderChat();
      requestChatHistory(activePeer.id);
    }
    updateBadges();
  }

  function createUserItem(user, selfId) {
    const item = document.createElement('li');
    item.className = `pw-user${user.id === selfId ? ' pw-user-self' : ''}`;
    const content = document.createElement(user.id === selfId ? 'div' : 'button');
    content.className = 'pw-user-button';
    if (content.tagName === 'BUTTON') {
      content.type = 'button';
      content.setAttribute('aria-label', `${user.name}에게 메시지 보내기, ${statusText(user)}`);
      content.addEventListener('click', () => openChat(user));
    }

    const avatar = document.createElement('span');
    avatar.className = 'pw-avatar';
    avatar.textContent = Array.from(user.name)[0] || '?';
    avatar.setAttribute('aria-hidden', 'true');
    const onlineDot = document.createElement('span');
    onlineDot.className = 'pw-user-dot';
    onlineDot.setAttribute('aria-hidden', 'true');
    avatar.append(onlineDot);

    const copy = document.createElement('span');
    copy.className = 'pw-user-copy';
    const nameLine = document.createElement('span');
    nameLine.className = 'pw-name-line';
    const name = document.createElement('span');
    name.className = 'pw-name';
    name.textContent = user.name;
    nameLine.append(name);
    if (user.id === selfId) {
      const me = document.createElement('span');
      me.className = 'pw-me';
      me.textContent = localeText().me;
      nameLine.append(me);
    }
    const status = document.createElement('span');
    status.className = `pw-status pw-status-${user.status}`;
    status.textContent = statusText(user);
    copy.append(nameLine, status);
    content.append(avatar, copy);

    const unread = unreadByPeer.get(user.id) || 0;
    if (unread > 0) {
      const unreadBadge = document.createElement('span');
      unreadBadge.className = 'pw-user-unread';
      unreadBadge.textContent = unread > 99 ? '99+' : String(unread);
      unreadBadge.setAttribute('aria-label', `읽지 않은 메시지 ${unread}개`);
      content.append(unreadBadge);
    } else if (user.id !== selfId) {
      const chevron = document.createElement('span');
      chevron.className = 'pw-chevron';
      chevron.textContent = '›';
      chevron.setAttribute('aria-hidden', 'true');
      content.append(chevron);
    }
    item.append(content);
    return item;
  }

  function peerForMessage(message) {
    return message.from === latestPresence.selfId ? message.to : message.from;
  }

  function mergeMessages(peerId, incoming) {
    const current = messagesByPeer.get(peerId) || [];
    const merged = new Map(current.map((message) => [message.id, message]));
    for (const message of incoming) merged.set(message.id, message);
    messagesByPeer.set(peerId, [...merged.values()].sort((left, right) => left.sentAt - right.sentAt).slice(-100));
  }

  function receiveHistory(peerId, messages) {
    if (!peerId) return;
    mergeMessages(peerId, messages);
    if (activePeer?.id === peerId) renderChatMessages();
  }

  function receiveChat(message) {
    if (!message?.id || !message.from || !message.to || typeof message.text !== 'string') return;
    const peerId = peerForMessage(message);
    if (!peerId) return;
    mergeMessages(peerId, [message]);
    const panelOpen = !document.getElementById('pw-panel').hidden;
    if (activePeer?.id === peerId && panelOpen) {
      markRead(peerId);
      renderChatMessages();
    } else if (message.from !== latestPresence.selfId) {
      unreadByPeer.set(peerId, (unreadByPeer.get(peerId) || 0) + 1);
      updateBadges();
      playNotificationSound();
      if (!document.getElementById('pw-friends-view').hidden) renderPresence(latestPresence);
    }
  }

  function sendChat(event) {
    event.preventDefault();
    const input = document.getElementById('pw-chat-input');
    const text = input.value.trim();
    if (!activePeer || !text || text.length > MAX_CHAT_LENGTH) return;
    if (socket?.readyState !== WebSocket.OPEN || activePeer.offline) {
      showChatError('RECIPIENT_OFFLINE');
      return;
    }
    socket.send(JSON.stringify({ type: 'CHAT_SEND', to: activePeer.id, text }));
    input.value = '';
    document.getElementById('pw-chat-error').hidden = true;
  }

  function showChatError(code) {
    const error = document.getElementById('pw-chat-error');
    if (!error) return;
    error.textContent = code === 'RATE_LIMITED' ? localeText().rateError : localeText().offlineError;
    error.hidden = false;
  }

  function renderChat() {
    renderChatHeader();
    renderChatMessages();
    updateChatAvailability();
  }

  function renderChatHeader() {
    if (!activePeer) return;
    document.getElementById('pw-chat-avatar').textContent = Array.from(activePeer.name)[0] || '?';
    document.getElementById('pw-chat-name').textContent = activePeer.name;
    const status = document.getElementById('pw-chat-status');
    status.textContent = statusText(activePeer);
    status.className = activePeer.offline ? 'pw-chat-offline' : '';
  }

  function renderChatMessages() {
    if (!activePeer) return;
    const container = document.getElementById('pw-chat-messages');
    const messages = messagesByPeer.get(activePeer.id) || [];
    container.replaceChildren();
    if (!messages.length) {
      const empty = document.createElement('p');
      empty.className = 'pw-chat-empty';
      empty.textContent = `${activePeer.name}님에게 첫 메시지를 보내보세요.`;
      container.append(empty);
    }
    for (const message of messages) {
      const mine = message.from === latestPresence.selfId;
      const row = document.createElement('div');
      row.className = `pw-message-row ${mine ? 'pw-message-mine' : 'pw-message-theirs'}`;
      const bubble = document.createElement('div');
      bubble.className = 'pw-message-bubble';
      const body = document.createElement('p');
      body.textContent = message.text;
      const time = document.createElement('time');
      time.dateTime = new Date(message.sentAt).toISOString();
      time.textContent = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(message.sentAt);
      bubble.append(body, time);
      row.append(bubble);
      container.append(row);
    }
    requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
  }

  function updateChatAvailability() {
    const input = document.getElementById('pw-chat-input');
    const button = document.getElementById('pw-chat-send');
    if (!input || !button) return;
    const unavailable = !activePeer || activePeer.offline || socket?.readyState !== WebSocket.OPEN;
    input.disabled = unavailable;
    button.disabled = unavailable;
    input.placeholder = activePeer?.offline ? localeText().offlineError : localeText().placeholder;
  }

  function markRead(peerId) {
    if (!peerId || !unreadByPeer.has(peerId)) return;
    unreadByPeer.delete(peerId);
    updateBadges();
    if (!document.getElementById('pw-friends-view').hidden) renderPresence(latestPresence);
  }

  function totalUnread() {
    return [...unreadByPeer.values()].reduce((total, count) => total + count, 0);
  }

  function updateBadges() {
    const total = totalUnread();
    const badge = document.getElementById('pw-fab-unread');
    if (!badge) return;
    badge.hidden = total === 0;
    badge.textContent = total > 99 ? '99+' : String(total);
    const fab = document.getElementById('pw-fab');
    fab.classList.toggle('pw-fab-alerting', total > 0);
    const action = fab.getAttribute('aria-expanded') === 'true' ? '닫기' : '열기';
    fab.setAttribute('aria-label', `친구 및 채팅 ${action}, 온라인 ${latestPresence.users.length}명, 읽지 않음 ${total}개`);
  }

  async function loadGameNames() {
    try {
      const response = await fetch('/games.json', { cache: 'no-store' });
      if (!response.ok) return;
      const games = await response.json();
      let english = false;
      try { english = localStorage.getItem('starlight-locale') === 'en'; } catch { /* noop */ }
      gameNames = new Map(games.map((game) => [
        game.id,
        english ? (game.nameEn || game.name || game.nameKo) : (game.nameKo || game.name || game.nameEn),
      ]));
    } catch { /* status falls back to game id */ }
  }

  window.addEventListener('minigame-presence-update', (event) => {
    const detail = event.detail || {};
    currentState = {
      name: String(detail.name || '').trim().slice(0, 12),
      status: detail.status || 'lobby',
      gameId: detail.gameId || null,
    };
    if (currentState.name) {
      if (!socket || socket.readyState === WebSocket.CLOSED) connect();
      else sendCurrentState();
    }
  });

  window.addEventListener('pagehide', () => {
    stopped = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    socket?.close(1000, 'PAGE_HIDE');
  });

  injectWidget();
  loadGameNames().finally(connect);
})();
