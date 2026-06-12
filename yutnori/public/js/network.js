/**
 * @fileoverview WebSocket 클라이언트. 서버와 메시지 송수신.
 *
 * 메시지 프로토콜 (서버 권위 모델):
 *  - JOIN → JOINED
 *  - READY → (양쪽 모두 READY 시) START + STATE
 *  - THROW_YUT → YUT_RESULT (양쪽 broadcast) + STATE
 *  - MOVE_PIECE { pieceIndex, useResult } → STATE (또는 BRANCH_REQUEST)
 *  - CHOOSE_PATH { pathChoice: 'top'|'bottom' } → STATE
 *  - GAME_OVER { winner, reason? }
 *  - REMATCH → REMATCH_STATUS → START
 *  - STATE { started, currentTurn, pendingResults, awaitingBranchAt, players: [...] }
 */

/**
 * 네트워크 인스턴스 생성.
 *
 * @param {object} handlers
 * @param {(payload: {playerId: string, waiting: boolean, hostUrl?: string}) => void} handlers.onJoined
 * @param {(countdown: number) => void} handlers.onStart
 * @param {(state: object) => void} handlers.onState
 * @param {(payload: {by:string, sticks:number[], result:string, steps:number, bonus:boolean}) => void} handlers.onYutResult
 * @param {(payload: {pieceIndex:number, playerId:string, branchType:('center'|'corner')}) => void} handlers.onBranchRequest
 * @param {(payload: {winner:string, reason?:string}) => void} handlers.onGameOver
 * @param {(payload: {p1Ready:boolean, p2Ready:boolean}) => void} handlers.onRematchStatus
 * @param {(message:string) => void} handlers.onError
 * @returns {object} 네트워크 컨트롤러
 */
export function createNetwork(handlers) {
  /** @type {WebSocket|null} */
  let ws = null;
  let myPlayerId = null;
  let reconnectAttempted = false;

  function connect() {
    // 통합 라우터(launcher) 환경에서는 /yutnori/ 하위에서 호스팅되므로 WS path를 path prefix에 맞춰 구성한다.
    // standalone 실행 시에는 pathname이 '/' 이므로 prefix 없이 '/ws'로 연결한다.
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const seg = location.pathname.split('/').filter(Boolean)[0] || '';
    const wsPath = seg ? `/${seg}/ws` : '/ws';
    // mode 쿼리 부착 — '?mode=ai' 진입 시 서버가 봇을 자동 spawn한다.
    // 새로고침으로 쿼리가 유실되는 경우를 대비해 sessionStorage에 백업한다(matgo/rummikub 동일 패턴).
    const urlParams = new URLSearchParams(location.search);
    let mode = urlParams.get('mode');
    if (mode) {
      sessionStorage.setItem('yutnori:mode', mode);
    } else {
      mode = sessionStorage.getItem('yutnori:mode') || 'human';
    }
    const wsQuery = `?mode=${encodeURIComponent(mode)}`;
    const url = `${proto}://${location.host}${wsPath}${wsQuery}`;
    console.log('[net] 연결 시도:', url);
    ws = new WebSocket(url);

    ws.addEventListener('open', () => {
      console.log('[net] 연결됨');
      reconnectAttempted = false;
      // 연결 확립 시점을 상위(main.js)에 알린다 — JOIN은 반드시 open 이후에 보내야 한다.
      // (고정 타이머로 JOIN을 보내면 연결이 늦게 열릴 때 JOIN이 유실되어
      //  myId=null 소프트락("상대 턴" 오표시)이 발생한다. 재연결 시 재JOIN도 이 경로로 처리.)
      if (typeof handlers.onOpen === 'function') handlers.onOpen();
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
        handlers.onJoined({
          playerId: msg.playerId,
          waiting: msg.waiting,
          hostUrl: typeof msg.hostUrl === 'string' ? msg.hostUrl : '',
        });
        break;
      case 'START':
        handlers.onStart(msg.countdown || 3);
        break;
      case 'STATE':
        handlers.onState(msg);
        break;
      case 'YUT_RESULT':
        handlers.onYutResult({
          by: msg.by,
          sticks: msg.sticks || [0, 0, 0, 0],
          result: msg.result,
          steps: typeof msg.steps === 'number' ? msg.steps : 0,
          bonus: !!msg.bonus,
          markedIndex: typeof msg.markedIndex === 'number' ? msg.markedIndex : 0,
          discarded: !!msg.discarded,
        });
        break;
      case 'BRANCH_REQUEST':
        handlers.onBranchRequest({
          pieceIndex: msg.pieceIndex,
          playerId: msg.playerId,
          branchType: msg.branchType || 'center', // FIX-2: 분기 유형
        });
        break;
      case 'GAME_OVER':
        handlers.onGameOver({
          winner: msg.winner,
          reason: msg.reason || 'finish',
        });
        break;
      case 'REMATCH_STATUS':
        handlers.onRematchStatus({
          p1Ready: !!msg.p1Ready,
          p2Ready: !!msg.p2Ready,
        });
        break;
      case 'ERROR':
        handlers.onError(msg.message || '알 수 없는 오류');
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
    ready() { send({ type: 'READY' }); },
    throwYut() { send({ type: 'THROW_YUT' }); },
    movePiece(pieceIndex, useResult) { send({ type: 'MOVE_PIECE', pieceIndex, useResult }); },
    choosePath(pathChoice) { send({ type: 'CHOOSE_PATH', pathChoice }); },
    sendRematch() { send({ type: 'REMATCH' }); },
  };
}
