import crypto from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';

const PRESENCE_STATUSES = new Set(['lobby', 'waiting', 'playing']);
const CONTROL_OR_BIDI = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;
const CHAT_CONTROL_OR_BIDI = /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;
const CHAT_HISTORY_LIMIT = 100;
const CHAT_TEXT_LIMIT = 500;
const CHAT_WINDOW_MS = 10_000;
const CHAT_WINDOW_LIMIT = 20;
const CHAT_HISTORY_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CHAT_CLEANUP_MS = 10 * 60 * 1000;

export function sanitizePresenceName(value) {
  if (typeof value !== 'string') return '';
  return Array.from(value.normalize('NFC').replace(CONTROL_OR_BIDI, '').trim())
    .slice(0, 12)
    .join('');
}

export function sanitizeChatText(value) {
  if (typeof value !== 'string') return '';
  return Array.from(value.normalize('NFC').replace(/\r\n?/g, '\n').replace(CHAT_CONTROL_OR_BIDI, '').trim())
    .slice(0, CHAT_TEXT_LIMIT)
    .join('');
}

export function pruneChatHistory(history, cutoff) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((message) => Number.isFinite(message?.sentAt) && message.sentAt >= cutoff)
    .slice(-CHAT_HISTORY_LIMIT);
}

export function normalizePresenceState(payload, gamesMap) {
  const name = sanitizePresenceName(payload?.name);
  if (!name) return null;

  const requestedStatus = PRESENCE_STATUSES.has(payload?.status) ? payload.status : 'lobby';
  const requestedGameId = typeof payload?.gameId === 'string' ? payload.gameId.trim() : '';
  const hasGame = requestedGameId && gamesMap.has(requestedGameId);
  const status = requestedStatus === 'lobby' || !hasGame ? 'lobby' : requestedStatus;

  return {
    name,
    status,
    gameId: status === 'lobby' ? null : requestedGameId,
  };
}

export function createPresenceHub({
  gamesMap,
  identityForRequest = () => null,
  heartbeatMs = 30_000,
  chatCleanupMs = DEFAULT_CHAT_CLEANUP_MS,
  now = () => Date.now(),
} = {}) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2048 });
  const clients = new Map();
  const conversations = new Map();

  function conversationKey(left, right) {
    return [left, right].sort().join(':');
  }

  function sendJson(ws, payload) {
    if (ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify(payload));
    } catch (error) {
      console.error('[presence] 메시지 전송 실패:', error.message);
    }
  }

  function sendToIdentity(identity, payload) {
    for (const [client, meta] of clients) {
      if (meta.identity === identity) sendJson(client, payload);
    }
  }

  function visibleIdentity(identity) {
    for (const meta of clients.values()) {
      if (meta.identity === identity && meta.name) return true;
    }
    return false;
  }

  function pruneConversation(key) {
    const history = conversations.get(key);
    if (!history) return [];
    const cutoff = now() - CHAT_HISTORY_TTL_MS;
    const fresh = pruneChatHistory(history, cutoff);
    if (fresh.length) conversations.set(key, fresh);
    else conversations.delete(key);
    return fresh;
  }

  function pruneAllConversations() {
    for (const key of conversations.keys()) pruneConversation(key);
  }

  function currentUsers() {
    const statusPriority = { lobby: 0, waiting: 1, playing: 2 };
    const latestByIdentity = new Map();
    for (const meta of clients.values()) {
      if (!meta.name) continue;
      const current = latestByIdentity.get(meta.identity);
      const higherPriority = !current || statusPriority[meta.status] > statusPriority[current.status];
      const equallyRecent = current
        && statusPriority[meta.status] === statusPriority[current.status]
        && meta.updatedAt >= current.updatedAt;
      if (higherPriority || equallyRecent) latestByIdentity.set(meta.identity, meta);
    }

    return [...latestByIdentity.values()]
      .sort((left, right) => left.connectedAt - right.connectedAt || left.name.localeCompare(right.name, 'ko'))
      .map(({ identity, name, status, gameId }) => ({ id: identity, name, status, gameId }));
  }

  function sendState(ws, users = currentUsers()) {
    if (ws.readyState !== WebSocket.OPEN) return;
    const meta = clients.get(ws);
    sendJson(ws, {
      type: 'PRESENCE_STATE',
      selfId: meta?.identity || null,
      count: users.length,
      users,
    });
  }

  function broadcastState() {
    const users = currentUsers();
    for (const ws of clients.keys()) sendState(ws, users);
  }

  wss.on('connection', (ws, req) => {
    const sessionIdentity = identityForRequest(req);
    const connectedAt = now();
    clients.set(ws, {
      identity: sessionIdentity || `guest-${crypto.randomUUID()}`,
      name: '',
      status: 'lobby',
      gameId: null,
      connectedAt,
      updatedAt: connectedAt,
      isAlive: true,
      chatSentAt: [],
    });

    ws.on('pong', () => {
      const meta = clients.get(ws);
      if (meta) meta.isAlive = true;
    });

    ws.on('message', (data) => {
      let message;
      try {
        message = JSON.parse(data.toString());
      } catch {
        return;
      }
      const meta = clients.get(ws);
      if (!meta) return;

      if (message?.type === 'CHAT_HISTORY_REQUEST') {
        const peerId = typeof message.with === 'string' ? message.with : '';
        if (!peerId || peerId === meta.identity) return;
        sendJson(ws, {
          type: 'CHAT_HISTORY',
          with: peerId,
          messages: pruneConversation(conversationKey(meta.identity, peerId)),
        });
        return;
      }

      if (message?.type === 'CHAT_SEND') {
        const recipientId = typeof message.to === 'string' ? message.to : '';
        const text = sanitizeChatText(message.text);
        const timestamp = now();
        meta.chatSentAt = meta.chatSentAt.filter((sentAt) => sentAt > timestamp - CHAT_WINDOW_MS);
        if (!meta.name || !recipientId || recipientId === meta.identity || !text) return;
        if (!visibleIdentity(recipientId)) {
          sendJson(ws, { type: 'CHAT_ERROR', code: 'RECIPIENT_OFFLINE', to: recipientId });
          return;
        }
        if (meta.chatSentAt.length >= CHAT_WINDOW_LIMIT) {
          sendJson(ws, { type: 'CHAT_ERROR', code: 'RATE_LIMITED', to: recipientId });
          return;
        }
        meta.chatSentAt.push(timestamp);
        const chatMessage = {
          id: crypto.randomUUID(),
          from: meta.identity,
          fromName: meta.name,
          to: recipientId,
          text,
          sentAt: timestamp,
        };
        const key = conversationKey(meta.identity, recipientId);
        const history = pruneConversation(key);
        history.push(chatMessage);
        conversations.set(key, history.slice(-CHAT_HISTORY_LIMIT));
        sendToIdentity(meta.identity, { type: 'CHAT_MESSAGE', message: chatMessage });
        sendToIdentity(recipientId, { type: 'CHAT_MESSAGE', message: chatMessage });
        return;
      }

      if (message?.type === 'PRESENCE_UPDATE') {
        const state = normalizePresenceState(message, gamesMap);
        if (!state) {
          try { ws.close(1008, 'INVALID_PRESENCE'); } catch { /* noop */ }
          return;
        }
        Object.assign(meta, state, { updatedAt: now() });
        broadcastState();
      }
    });

    ws.on('close', () => {
      const wasVisible = Boolean(clients.get(ws)?.name);
      clients.delete(ws);
      if (wasVisible) broadcastState();
    });

    ws.on('error', (error) => {
      console.error('[presence] WebSocket 오류:', error.message);
    });

    sendState(ws);
  });

  const heartbeatTimer = setInterval(() => {
    for (const [ws, meta] of clients) {
      if (!meta.isAlive) {
        ws.terminate();
        continue;
      }
      meta.isAlive = false;
      try { ws.ping(); } catch { ws.terminate(); }
    }
  }, heartbeatMs);
  heartbeatTimer.unref?.();

  const chatCleanupTimer = setInterval(pruneAllConversations, Math.max(1_000, chatCleanupMs));
  chatCleanupTimer.unref?.();

  return {
    handleUpgrade(req, socket, head) {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    },
    snapshot: currentUsers,
    close() {
      clearInterval(heartbeatTimer);
      clearInterval(chatCleanupTimer);
      for (const ws of clients.keys()) ws.terminate();
      wss.close();
    },
  };
}
