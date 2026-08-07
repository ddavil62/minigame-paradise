/**
 * @fileoverview WS 연결 + 메시지 처리.
 *
 * 서버와의 WebSocket 연결을 관리하고,
 * 수신 메시지를 콜백 핸들러로 디스패치한다.
 */

// ── 연결 상태 ───────────────────────────────────────────────

/** @type {WebSocket|null} */
let ws = null;

/** @type {Object<string, Function>} 메시지 타입별 핸들러 */
const handlers = {};

/** 재연결 시도 여부 */
let shouldReconnect = true;

// ── 공개 API ────────────────────────────────────────────────

/**
 * 메시지 핸들러를 등록한다.
 * @param {string} type 메시지 타입
 * @param {Function} handler 핸들러 함수
 */
export function on(type, handler) {
  handlers[type] = handler;
}

/**
 * 서버에 JSON 메시지를 전송한다.
 * @param {object} payload
 */
export function send(payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

/**
 * WebSocket 연결을 시작한다.
 * @param {string} playerName 닉네임
 */
export function connect(playerName) {
  if (ws) return;

  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  // 통합 라우터: /wordchain-battle/ws, 단독: /ws
  const pathname = location.pathname.replace(/\/$/, '');
  const wsPath = pathname ? `${pathname}/ws` : '/ws';
  const url = `${proto}://${location.host}${wsPath}`;

  ws = new WebSocket(url);

  ws.onopen = () => {
    console.log('[network] 연결됨');
    send({ type: 'JOIN', name: playerName });
  };

  ws.onmessage = (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch (e) { return; }
    if (!msg || typeof msg.type !== 'string') return;

    const handler = handlers[msg.type];
    if (handler) handler(msg);
  };

  ws.onclose = () => {
    console.log('[network] 연결 끊김');
    ws = null;
    if (shouldReconnect) {
      setTimeout(() => connect(playerName), 2000);
    }
  };

  ws.onerror = (err) => {
    console.error('[network] 에러:', err);
  };
}

/**
 * 재연결을 중단하고 WS 연결을 닫는다.
 */
export function disconnect() {
  shouldReconnect = false;
  if (ws) {
    ws.close();
    ws = null;
  }
}
