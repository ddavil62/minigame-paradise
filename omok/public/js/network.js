/**
 * @fileoverview 오목 WebSocket 클라이언트 — 서버와 메시지 송수신.
 *
 * 서버 권위 모델(server.js 기준 진실 원천). 메시지 프로토콜:
 *  C→S: JOIN { name } / READY {} / PLACE { row, col } / RESIGN {} / REMATCH {}
 *  S→C: JOINED { playerId, color, waiting, hostUrl, opponentName? } / GAME_START / STATE /
 *       READY_STATE { myReady, opponentReady } /
 *       GAME_OVER { winner, reason, winLine? } / OPPONENT_LEFT { name, message } / ERROR /
 *       REMATCH_WAITING {} / REMATCH_START { nextBlack }
 */

/**
 * 네트워크 인스턴스 생성.
 * @param {object} handlers
 * @returns {object} 네트워크 컨트롤러
 */
export function createNetwork(handlers) {
  /** @type {WebSocket|null} */
  let ws = null;
  let myPlayerId = null;
  let reconnectAttempted = false;

  function connect() {
    // 통합 라우터(launcher)에서는 /omok/ 하위에서 호스팅되므로 WS path에 prefix를 붙인다.
    // 단독 실행 시 pathname은 '/'이므로 prefix 없이 '/ws'로 연결한다.
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const seg = location.pathname.split('/').filter(Boolean)[0] || '';
    const wsPath = seg ? `/${seg}/ws` : '/ws';
    // mode 정보 유지: URL query 우선, 없으면 sessionStorage. 새로고침해도 같은 모드 재진입.
    // server.js는 mode=ai 진입 시 봇 자식 프로세스를 자동 spawn 한다.
    const urlParams = new URLSearchParams(location.search);
    let mode = urlParams.get('mode');
    if (mode) {
      sessionStorage.setItem('omok:mode', mode);
    } else {
      mode = sessionStorage.getItem('omok:mode') || 'human';
    }
    // 닉네임 전달(포크 A/B): URL ?name= 우선 → sessionStorage omok:name 저장.
    const urlName = urlParams.get('name');
    if (urlName) {
      sessionStorage.setItem('omok:name', decodeURIComponent(urlName));
    }
    const wsQuery = `?mode=${encodeURIComponent(mode)}`;
    const url = `${proto}://${location.host}${wsPath}${wsQuery}`;
    console.log('[net] 연결 시도:', url);
    ws = new WebSocket(url);

    ws.addEventListener('open', () => {
      console.log('[net] 연결됨');
      reconnectAttempted = false;
      // 닉네임이 있으면 즉시 JOIN 송신. 없으면 인라인 게이트가 JOIN 시점을 결정한다.
      const storedName = sessionStorage.getItem('omok:name');
      if (storedName) {
        ws.send(JSON.stringify({ type: 'JOIN', name: storedName }));
      }
      if (typeof handlers.onOpen === 'function') handlers.onOpen({ hasName: !!storedName });
    });
    ws.addEventListener('message', (event) => {
      let msg;
      try { msg = JSON.parse(event.data); }
      catch (e) { console.warn('[net] JSON 파싱 실패:', event.data); return; }
      route(msg);
    });
    ws.addEventListener('close', () => {
      console.log('[net] 연결 종료');
      if (!reconnectAttempted) {
        reconnectAttempted = true;
        setTimeout(() => { console.log('[net] 재연결 시도'); connect(); }, 3000);
      }
    });
    ws.addEventListener('error', (err) => {
      console.error('[net] WebSocket 에러:', err);
    });
  }

  function route(msg) {
    switch (msg.type) {
      case 'JOINED':
        myPlayerId = msg.playerId;
        handlers.onJoined && handlers.onJoined({
          playerId: msg.playerId,
          color: msg.color,
          waiting: !!msg.waiting,
          hostUrl: typeof msg.hostUrl === 'string' ? msg.hostUrl : '',
          opponentName: typeof msg.opponentName === 'string' ? msg.opponentName : '',
        });
        break;
      case 'READY_STATE':
        handlers.onReadyState && handlers.onReadyState({
          myReady: !!msg.myReady,
          opponentReady: !!msg.opponentReady,
        });
        break;
      case 'GAME_START':
        handlers.onGameStart && handlers.onGameStart(msg);
        break;
      case 'STATE':
        handlers.onState && handlers.onState(msg);
        break;
      case 'GAME_OVER':
        handlers.onGameOver && handlers.onGameOver({
          winner: msg.winner,
          reason: msg.reason,
          winLine: msg.winLine || null,
        });
        break;
      case 'OPPONENT_LEFT':
        handlers.onOpponentLeft && handlers.onOpponentLeft({
          name: typeof msg.name === 'string' ? msg.name : '',
          message: msg.message || '상대방이 나갔습니다.',
        });
        break;
      case 'REMATCH_WAITING':
        handlers.onRematchWaiting && handlers.onRematchWaiting();
        break;
      case 'REMATCH_START':
        handlers.onRematchStart && handlers.onRematchStart({
          nextBlack: msg.nextBlack,
        });
        break;
      case 'ERROR':
        handlers.onError && handlers.onError(msg.message || '알 수 없는 오류');
        break;
      default:
        console.warn('[net] 알 수 없는 메시지 타입:', msg.type);
    }
  }

  function send(payload) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn('[net] 연결되지 않은 상태에서 전송 시도:', payload.type);
      return;
    }
    ws.send(JSON.stringify(payload));
  }

  return {
    connect,
    getMyId() { return myPlayerId; },
    sendJoin(name) { send({ type: 'JOIN', name }); },
    sendReady() { send({ type: 'READY' }); },
    sendPlace(row, col) { send({ type: 'PLACE', row, col }); },
    sendResign() { send({ type: 'RESIGN' }); },
    sendRematch() { send({ type: 'REMATCH' }); },
  };
}
