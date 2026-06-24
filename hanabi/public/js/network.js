/**
 * @fileoverview 하나비 WebSocket 클라이언트 — 서버와 메시지 송수신.
 *
 * 서버 권위 모델(server.js 기준 진실 원천). 메시지 프로토콜:
 *  C->S: JOIN { name } / READY {} / GIVE_CLUE { clueType, value } /
 *       PLAY_CARD { handIndex } / DISCARD_CARD { handIndex } / REMATCH {}
 *  S->C: JOINED { playerId, waiting, hostUrl, opponentName? } / START {} /
 *       READY_STATE { myReady, opponentReady } /
 *       STATE (snapshotForPlayer 구조) / GAME_OVER { result } /
 *       OPPONENT_LEFT { name, message } / REMATCH_STATUS { p1Ready, p2Ready } /
 *       ERROR { message }
 *
 * 힌트 대상(target)은 서버가 항상 상대로 자동 판정하므로(S5-3) 클라가 보내지 않는다.
 *
 * 닉네임 3단계 폴백: URL ?name= -> sessionStorage hanabi:name -> #name-gate-inline
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
    // 통합 라우터(launcher)에서는 /hanabi/ 하위에서 호스팅되므로 WS path에 prefix를 붙인다.
    // 단독 실행 시 pathname은 '/'이므로 prefix 없이 '/ws'로 연결한다(yutnori 패턴).
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const seg = location.pathname.split('/').filter(Boolean)[0] || '';
    const wsPath = seg ? `/${seg}/ws` : '/ws';

    // 닉네임 전달(3단계 폴백): URL ?name= 우선 -> sessionStorage hanabi:name 저장.
    const urlParams = new URLSearchParams(location.search);
    const urlName = urlParams.get('name');
    if (urlName) {
      sessionStorage.setItem('hanabi:name', decodeURIComponent(urlName));
    }

    const url = `${proto}://${location.host}${wsPath}`;
    console.log('[net] 연결 시도:', url);
    ws = new WebSocket(url);

    ws.addEventListener('open', () => {
      console.log('[net] 연결됨');
      reconnectAttempted = false;
      // 닉네임이 있으면 즉시 JOIN 송신. 없으면 인라인 게이트가 JOIN 시점을 결정한다.
      const storedName = sessionStorage.getItem('hanabi:name');
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
        handlers.onOpponentLeft({
          name: typeof msg.name === 'string' ? msg.name : '',
          message: msg.message || '상대방이 나갔습니다.',
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
    sendJoin(name) { send({ type: 'JOIN', name }); },
    sendReady() { send({ type: 'READY' }); },
    /** 힌트 주기 — target은 서버가 상대로 자동 판정(S5-3). */
    giveClue(clueType, value) { send({ type: 'GIVE_CLUE', clueType, value }); },
    playCard(handIndex) { send({ type: 'PLAY_CARD', handIndex }); },
    discardCard(handIndex) { send({ type: 'DISCARD_CARD', handIndex }); },
    sendRematch() { send({ type: 'REMATCH' }); },
  };
}
