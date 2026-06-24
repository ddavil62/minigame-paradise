/**
 * @fileoverview 루미큐브 WebSocket 클라이언트 — 서버와 메시지 송수신.
 *
 * 서버 권위 모델(server.js 기준 진실 원천). 메시지 프로토콜:
 *  C→S: JOIN { playerName? } / READY {} / NEW_SET {} /
 *       MOVE_TILE { from, to } / SWAP_JOKER { setId, jokerIndex, handTileId } /
 *       END_TURN {} / REMATCH {}
 *  S→C: JOINED { playerId, waiting, hostUrl, opponentName? } /
 *       READY_STATE { myReady, opponentReady } / READY_STATUS / START {} /
 *       STATE { board, myHand, oppHandCount, deckSize, currentTurn, turnNumber, played, tileDict } /
 *       TURN_RESULT { by, committed, drewTile, reason, error } /
 *       GAME_OVER / OPPONENT_LEFT { name?, message } / REMATCH_STATUS / ERROR
 *
 * from/to 위치 형식:
 *   { kind: 'hand', tileId: string }
 *   { kind: 'set', setId: string, tileId?: string, index?: number }
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
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const seg = location.pathname.split('/').filter(Boolean)[0] || '';
    const wsPath = seg ? `/${seg}/ws` : '/ws';
    // mode 정보 유지: URL query 우선, 없으면 sessionStorage. 새로고침해도 같은 모드 재진입.
    const urlParams = new URLSearchParams(location.search);
    let mode = urlParams.get('mode');
    if (mode) {
      sessionStorage.setItem('rummikub:mode', mode);
    } else {
      mode = sessionStorage.getItem('rummikub:mode') || 'human';
    }
    const wsQuery = `?mode=${encodeURIComponent(mode)}`;
    const url = `${proto}://${location.host}${wsPath}${wsQuery}`;
    console.log('[net] 연결 시도:', url);
    ws = new WebSocket(url);

    // 닉네임 전달(3단계 폴백): URL ?name= 우선 → sessionStorage rummikub:name 저장.
    const urlName = urlParams.get('name');
    if (urlName) {
      sessionStorage.setItem('rummikub:name', decodeURIComponent(urlName));
    }

    ws.addEventListener('open', () => {
      console.log('[net] 연결됨');
      reconnectAttempted = false;
      // 닉네임이 있으면 즉시 JOIN 송신. 없으면 인라인 게이트가 JOIN 시점을 결정한다.
      const storedName = sessionStorage.getItem('rummikub:name');
      if (storedName) {
        ws.send(JSON.stringify({ type: 'JOIN', playerName: storedName }));
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
      case 'READY_STATUS':
        // 후방 호환 — 기존 테스트가 아직 READY_STATUS를 구독할 수 있다.
        handlers.onReadyStatus && handlers.onReadyStatus({
          p1Ready: !!msg.p1Ready,
          p2Ready: !!msg.p2Ready,
        });
        break;
      case 'START':
        handlers.onStart && handlers.onStart();
        break;
      case 'STATE':
        handlers.onState && handlers.onState(msg);
        break;
      case 'TURN_RESULT':
        handlers.onTurnResult && handlers.onTurnResult({
          by: msg.by,
          committed: !!msg.committed,
          drewTile: msg.drewTile || null,
          reason: msg.reason || null,
          error: msg.error || null,
        });
        break;
      case 'GAME_OVER':
        handlers.onGameOver && handlers.onGameOver({
          winner: msg.winner,
          reason: msg.reason,
          handCounts: msg.handCounts,
        });
        break;
      case 'OPPONENT_LEFT':
        handlers.onOpponentLeft && handlers.onOpponentLeft({
          name: typeof msg.name === 'string' ? msg.name : '',
          message: msg.message || '상대방이 나갔습니다.',
        });
        break;
      case 'REMATCH_STATUS':
        handlers.onRematchStatus && handlers.onRematchStatus({
          p1Ready: !!msg.p1Ready,
          p2Ready: !!msg.p2Ready,
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
    join(playerName) { send({ type: 'JOIN', playerName: playerName || 'Player' }); },
    sendJoin(name) { send({ type: 'JOIN', playerName: name }); },
    sendReady() { send({ type: 'READY' }); },
    newSet() { send({ type: 'NEW_SET' }); },
    moveTile(from, to) { send({ type: 'MOVE_TILE', from, to }); },
    swapJoker(setId, jokerIndex, handTileId) {
      send({ type: 'SWAP_JOKER', setId, jokerIndex, handTileId });
    },
    endTurn() { send({ type: 'END_TURN' }); },
    sendRematch() { send({ type: 'REMATCH' }); },
  };
}
