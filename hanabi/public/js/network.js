/**
 * @fileoverview 하나비 WebSocket 클라이언트 — 서버와 메시지 송수신.
 *
 * 서버 권위 모델(server.js 기준 진실 원천). 메시지 프로토콜:
 *  C→S: JOIN { playerName } / GIVE_CLUE { clueType, value } /
 *       PLAY_CARD { handIndex } / DISCARD_CARD { handIndex } / REMATCH {}
 *  S→C: JOINED { playerId, waiting, hostUrl } / START {} /
 *       STATE (snapshotForPlayer 구조) / GAME_OVER { result } /
 *       OPPONENT_LEFT { message } / REMATCH_STATUS { p1Ready, p2Ready } /
 *       ERROR { message }
 *
 * 힌트 대상(target)은 서버가 항상 상대로 자동 판정하므로(§5-3) 클라가 보내지 않는다.
 */

/**
 * 네트워크 인스턴스 생성.
 *
 * @param {object} handlers
 * @param {(payload:{playerId:string, waiting:boolean, hostUrl:string}) => void} handlers.onJoined
 * @param {() => void} handlers.onStart
 * @param {(state:object) => void} handlers.onState
 * @param {(result:object) => void} handlers.onGameOver
 * @param {(message:string) => void} handlers.onOpponentLeft
 * @param {(payload:{p1Ready:boolean, p2Ready:boolean}) => void} handlers.onRematchStatus
 * @param {(message:string) => void} handlers.onError
 * @returns {object} 네트워크 컨트롤러
 */
export function createNetwork(handlers) {
  /** @type {WebSocket|null} */
  let ws = null;
  let myPlayerId = null;
  let reconnectAttempted = false;

  function connect() {
    // 통합 라우터(launcher)에서는 /hanabi/ 하위에서 호스팅되므로 WS path에 prefix를 붙인다.
    // 단독 실행 시 pathname은 '/'이므로 prefix 없이 '/ws'로 연결한다(yutnori 패턴).
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const seg = location.pathname.split('/').filter(Boolean)[0] || '';
    const wsPath = seg ? `/${seg}/ws` : '/ws';
    const url = `${proto}://${location.host}${wsPath}`;
    console.log('[net] 연결 시도:', url);
    ws = new WebSocket(url);

    ws.addEventListener('open', () => {
      console.log('[net] 연결됨');
      reconnectAttempted = false;
      // 연결 직후 JOIN 자동 전송(고정 타이머 race 방지). 재연결 시에도 재입장된다.
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
          waiting: !!msg.waiting,
          hostUrl: typeof msg.hostUrl === 'string' ? msg.hostUrl : '',
        });
        break;
      case 'START':
        handlers.onStart();
        break;
      case 'STATE':
        handlers.onState(msg);
        break;
      case 'GAME_OVER':
        handlers.onGameOver(msg.result || {});
        break;
      case 'OPPONENT_LEFT':
        handlers.onOpponentLeft(msg.message || '상대방이 나갔습니다.');
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
    /** 힌트 주기 — target은 서버가 상대로 자동 판정(§5-3). */
    giveClue(clueType, value) { send({ type: 'GIVE_CLUE', clueType, value }); },
    playCard(handIndex) { send({ type: 'PLAY_CARD', handIndex }); },
    discardCard(handIndex) { send({ type: 'DISCARD_CARD', handIndex }); },
    sendRematch() { send({ type: 'REMATCH' }); },
  };
}
