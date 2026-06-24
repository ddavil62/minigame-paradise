/**
 * @fileoverview 요트 다이스 WebSocket 클라이언트 — 서버와 메시지 송수신.
 *
 * 서버 권위 모델(server.js 기준 진실 원천). 메시지 프로토콜:
 *  C→S: JOIN { playerName?, name? } / READY {} / ROLL_DICE { keep:bool[5] } /
 *       TOGGLE_KEEP { index:0~4, value:bool } / SCORE_CATEGORY { category } / REMATCH {}
 *  S→C: JOINED { playerId, waiting, hostUrl, opponentName? } /
 *       READY_STATE { myReady, opponentReady } / READY_STATUS / START {} /
 *       DICE_ROLLED { by, dice, rollCount } / STATE / CATEGORY_SCORED /
 *       GAME_OVER / OPPONENT_LEFT { name?, message } / REMATCH_STATUS / ERROR
 */

/**
 * 네트워크 인스턴스 생성.
 *
 * @param {object} handlers
 * @returns {object} 네트워크 컨트롤러
 */
export function createNetwork(handlers) {
  /** @type {WebSocket|null} */
  let ws = null;
  let myPlayerId = null;
  let reconnectAttempted = false;

  function connect() {
    // 통합 라우터(launcher)에서는 /yahtzee/ 하위에서 호스팅되므로 WS path에 prefix를 붙인다.
    // 단독 실행 시 pathname은 '/'이므로 prefix 없이 '/ws'로 연결한다.
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const seg = location.pathname.split('/').filter(Boolean)[0] || '';
    const wsPath = seg ? `/${seg}/ws` : '/ws';
    // mode 정보 유지: URL query 우선, 없으면 sessionStorage. 새로고침해도 같은 모드 재진입.
    // matgo/janggi와 동일한 패턴. server.js는 mode=ai 진입 시 봇 자식 프로세스를 자동 spawn 한다.
    const urlParams = new URLSearchParams(location.search);
    let mode = urlParams.get('mode');
    if (mode) {
      sessionStorage.setItem('yahtzee:mode', mode);
    } else {
      mode = sessionStorage.getItem('yahtzee:mode') || 'human';
    }
    const wsQuery = `?mode=${encodeURIComponent(mode)}`;
    const url = `${proto}://${location.host}${wsPath}${wsQuery}`;
    console.log('[net] 연결 시도:', url);
    ws = new WebSocket(url);

    // 닉네임 전달(3단계 폴백): URL ?name= 우선 → sessionStorage yahtzee:name 저장.
    const urlName = urlParams.get('name');
    if (urlName) {
      sessionStorage.setItem('yahtzee:name', decodeURIComponent(urlName));
    }

    ws.addEventListener('open', () => {
      console.log('[net] 연결됨');
      reconnectAttempted = false;
      // 닉네임이 있으면 즉시 JOIN 송신. 없으면 인라인 게이트가 JOIN 시점을 결정한다.
      const storedName = sessionStorage.getItem('yahtzee:name');
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
      case 'DICE_ROLLED':
        handlers.onDiceRolled && handlers.onDiceRolled({
          by: msg.by,
          dice: msg.dice || [],
          rollCount: msg.rollCount || 0,
        });
        break;
      case 'CATEGORY_SCORED':
        handlers.onCategoryScored && handlers.onCategoryScored({
          by: msg.by,
          category: msg.category,
          scored: msg.scored,
          yahtzeeBonusAwarded: msg.yahtzeeBonusAwarded || 0,
        });
        break;
      case 'STATE':
        handlers.onState && handlers.onState(msg);
        break;
      case 'GAME_OVER':
        handlers.onGameOver && handlers.onGameOver({
          winner: msg.winner,
          totals: msg.totals || {},
          p1Total: msg.p1Total,
          p2Total: msg.p2Total,
          breakdown: msg.breakdown,
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
    rollDice(keep) { send({ type: 'ROLL_DICE', keep }); },
    // 본인 턴 keep 1개 토글을 즉시 서버에 전송 → 서버가 STATE broadcast → 상대도 실시간 keep 시각화.
    toggleKeep(index, value) { send({ type: 'TOGGLE_KEEP', index, value }); },
    scoreCategory(category) { send({ type: 'SCORE_CATEGORY', category }); },
    sendRematch() { send({ type: 'REMATCH' }); },
  };
}
