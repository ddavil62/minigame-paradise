/**
 * @fileoverview 베네치아 타이핑 배틀 WebSocket 클라이언트.
 *
 * 서버 권위 모델. 메시지 프로토콜:
 *  C->S: JOIN { playerName } / WORD_SUBMIT { wordId, text } / RESIGN {} / REMATCH {} / ITEM_USED {}
 *  S->C: JOINED / GAME_START / STATE / WORD_ADDED / WORD_CLEARED /
 *         GAME_OVER / REMATCH_WAITING / REMATCH_START / OPPONENT_LEFT / ERROR / WORDS_EXPIRED
 */

/**
 * 네트워크 인스턴스를 생성한다.
 * @param {object} handlers 이벤트 핸들러 객체
 * @returns {object} 네트워크 컨트롤러
 */
export function createNetwork(handlers) {
  /** @type {WebSocket|null} */
  let ws = null;
  let reconnectAttempted = false;
  let reconnectEnabled = true;

  /**
   * WS 서버에 연결한다.
   */
  function connect() {
    reconnectEnabled = true;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    // 통합 라우터: /venezia/ 하위에서 호스팅 → /venezia/ws
    // 단독 실행: pathname '/' → /ws
    const seg = location.pathname.split('/').filter(Boolean)[0] || '';
    const wsPath = seg ? `/${seg}/ws` : '/ws';
    // mode 정보: URL 쿼리 우선, sessionStorage 폴백
    const urlParams = new URLSearchParams(location.search);
    let mode = urlParams.get('mode');
    if (mode) {
      sessionStorage.setItem('venezia:mode', mode);
    } else {
      mode = sessionStorage.getItem('venezia:mode') || 'human';
    }
    const wsQuery = `?mode=${encodeURIComponent(mode)}`;
    const url = `${proto}://${location.host}${wsPath}${wsQuery}`;
    console.log('[venezia-net] 연결 시도:', url);
    ws = new WebSocket(url);

    ws.addEventListener('open', () => {
      console.log('[venezia-net] 연결됨');
      reconnectAttempted = false;
      if (typeof handlers.onOpen === 'function') handlers.onOpen();
    });

    ws.addEventListener('message', (event) => {
      let msg;
      try { msg = JSON.parse(event.data); }
      catch (e) { return; }
      route(msg);
    });

    ws.addEventListener('close', () => {
      console.log('[venezia-net] 연결 종료');
      if (typeof handlers.onClose === 'function') handlers.onClose();
      if (reconnectEnabled && !reconnectAttempted) {
        reconnectAttempted = true;
        setTimeout(() => { console.log('[venezia-net] 재연결 시도'); connect(); }, 3000);
      }
    });

    ws.addEventListener('error', (err) => {
      console.error('[venezia-net] WebSocket 에러:', err);
    });
  }

  /**
   * 수신 메시지를 핸들러로 라우팅한다.
   * @param {object} msg
   */
  function route(msg) {
    switch (msg.type) {
      case 'JOINED':
        handlers.onJoined && handlers.onJoined(msg);
        break;
      case 'GAME_START':
        handlers.onGameStart && handlers.onGameStart(msg);
        break;
      case 'STATE':
        handlers.onState && handlers.onState(msg);
        break;
      case 'WORD_ADDED':
        handlers.onWordAdded && handlers.onWordAdded(msg.word);
        break;
      case 'WORD_CLEARED':
        handlers.onWordCleared && handlers.onWordCleared(msg);
        break;
      case 'WORDS_EXPIRED':
        // wordIds: 내 단어 만료, oppWordIds: 상대 단어 만료
        handlers.onWordsExpired && handlers.onWordsExpired(msg.wordIds || [], msg.oppWordIds || []);
        break;
      case 'OPP_WORD_ADDED':
        handlers.onOppWordAdded && handlers.onOppWordAdded(msg.word);
        break;
      case 'OPP_WORD_CLEARED':
        handlers.onOppWordCleared && handlers.onOppWordCleared(msg.wordId);
        break;
      case 'GAME_OVER':
        handlers.onGameOver && handlers.onGameOver(msg);
        break;
      case 'REMATCH_WAITING':
        handlers.onRematchWaiting && handlers.onRematchWaiting();
        break;
      case 'REMATCH_START':
        handlers.onRematchStart && handlers.onRematchStart();
        break;
      case 'OPPONENT_LEFT':
        handlers.onOpponentLeft && handlers.onOpponentLeft();
        break;
      case 'RETURN_TO_LOBBY':
        handlers.onReturnToLobby && handlers.onReturnToLobby();
        break;
      case 'ITEM_GRANTED':
        handlers.onItemGranted && handlers.onItemGranted(msg);
        break;
      case 'ITEM_SLOTS_SYNC':
        handlers.onItemSlotsSync && handlers.onItemSlotsSync(msg.slots || []);
        break;
      case 'HIT':
        handlers.onHit && handlers.onHit(msg);
        break;
      case 'ITEM_EFFECT_START':
        handlers.onItemEffectStart && handlers.onItemEffectStart(msg);
        break;
      case 'ITEM_EFFECT_END':
        handlers.onItemEffectEnd && handlers.onItemEffectEnd(msg);
        break;
      case 'ERROR':
        handlers.onError && handlers.onError(msg.message || '오류');
        break;
      default:
        break;
    }
  }

  /**
   * JSON 메시지를 서버로 전송한다.
   * @param {object} payload
   */
  function send(payload) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(payload));
    return true;
  }

  /**
   * 자동 재연결을 막고 현재 WebSocket 연결을 닫는다.
   */
  function disconnect() {
    reconnectEnabled = false;
    reconnectAttempted = true;
    if (ws) {
      ws.close(1000, 'return_to_lobby');
      ws = null;
    }
  }

  return {
    connect,
    sendJoin(name) { send({ type: 'JOIN', playerName: name }); },
    sendWordSubmit(wordId, text) { send({ type: 'WORD_SUBMIT', wordId, text }); },
    sendResign() { send({ type: 'RESIGN' }); },
    sendRematch() { send({ type: 'REMATCH' }); },
    sendItemUsed(slotIndex) { return send({ type: 'ITEM_USED', slotIndex }); },
    disconnect,
  };
}
