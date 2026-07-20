/**
 * @fileoverview WebSocket 클라이언트. 서버와 메시지 송수신을 담당한다.
 *
 * 메시지 프로토콜은 plan의 "WebSocket 메시지 프로토콜" 섹션 참조.
 * Phase 2 메시지(ITEM_GRANT/ITEM_USE/ITEM_EFFECT/SHIELD_BLOCK)는 placeholder로만 처리한다.
 */

/**
 * 네트워크 인스턴스를 생성한다.
 *
 * @param {object} handlers - 서버 메시지 핸들러 콜백
 * @param {(payload: {playerId: string, waiting: boolean, hostUrl?: string}) => void} handlers.onJoined
 * @param {(countdown: number) => void} handlers.onStart
 * @param {(lines: number, combo: number) => void} handlers.onGarbage
 * @param {(payload: {height: number, stack: number[]}) => void} handlers.onOpponentBoard
 * @param {(winner: string, reason: string) => void} handlers.onResult
 * @param {(payload: {p1Ready: boolean, p2Ready: boolean}) => void} handlers.onRematchStatus
 * @param {(message: string) => void} handlers.onError
 * @param {(payload: {itemId: string, slotIndex: number}) => void} [handlers.onItemGrant]
 * @param {(payload: {itemId: string, duration: number}) => void} [handlers.onItemEffect]
 * @param {(payload: {itemId: string}) => void} [handlers.onShieldBlock]
 * @param {() => void} [handlers.onShieldActive]
 * @returns {object} 네트워크 컨트롤러
 */
export function createNetwork(handlers) {
  /** @type {WebSocket|null} */
  let ws = null;
  let myPlayerId = null;
  let reconnectAttempted = false;
  // 입장 이름을 보관한다. WS open 이전에 join()이 호출돼도(레이스) open 직후 이 값으로 JOIN을 전송한다.
  // 재연결(close→connect) 시에도 동일 값으로 자동 재JOIN.
  let pendingJoinName = null;

  /**
   * 서버에 연결한다. 자동으로 현재 호스트 기반 ws:// URL을 사용.
   */
  function connect() {
    // 통합 라우터(launcher) 환경에서는 /tetris-battle/ 하위에서 호스팅되므로 WS path를 path prefix에 맞춰 구성한다.
    // standalone 실행 시에는 pathname이 '/' 이므로 prefix 없이 '/ws'로 연결한다.
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const seg = location.pathname.split('/').filter(Boolean)[0] || '';
    const wsPath = seg ? `/${seg}/ws` : '/ws';

    // mode 쿼리 파라미터 파싱 + sessionStorage 보존 (새로고침 후에도 AI 모드 유지).
    // server.js는 mode=ai 진입 시 봇 자식 프로세스를 자동 spawn 한다.
    const urlParams = new URLSearchParams(location.search);
    let mode = urlParams.get('mode') || sessionStorage.getItem('tetris:mode') || '';
    if (mode) sessionStorage.setItem('tetris:mode', mode);

    const modeQuery = mode ? `?mode=${encodeURIComponent(mode)}` : '';
    const url = `${proto}://${location.host}${wsPath}${modeQuery}`;
    console.log('[net] 연결 시도:', url);
    ws = new WebSocket(url);

    // 닉네임 3단계 폴백: URL ?name= → sessionStorage tetris-battle:name → 인라인 입력.
    const nameParam = urlParams.get('name');
    let resolvedName = null;
    if (nameParam) {
      resolvedName = nameParam.slice(0, 12);
      sessionStorage.setItem('tetris-battle:name', resolvedName);
    } else {
      resolvedName = sessionStorage.getItem('tetris-battle:name') || null;
    }
    // 이전에 join()으로 보관된 이름보다 폴백 이름을 우선한다.
    if (resolvedName && !pendingJoinName) {
      pendingJoinName = resolvedName;
    }

    ws.addEventListener('open', () => {
      console.log('[net] 연결됨');
      reconnectAttempted = false;
      const hasName = !!pendingJoinName;
      // 닉네임이 있으면 즉시 JOIN, 없으면 main.js가 인라인 게이트를 표시.
      if (hasName) {
        ws.send(JSON.stringify({ type: 'JOIN', playerName: pendingJoinName }));
      }
      if (typeof handlers.onOpen === 'function') handlers.onOpen({ hasName });
    });

    ws.addEventListener('message', (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch (e) {
        console.warn('[net] JSON 파싱 실패:', event.data);
        return;
      }
      route(msg);
    });

    ws.addEventListener('close', () => {
      console.log('[net] 연결 종료');
      // 1회 재연결 시도
      if (!reconnectAttempted) {
        reconnectAttempted = true;
        setTimeout(() => {
          console.log('[net] 재연결 시도');
          connect();
        }, 3000);
      }
    });

    ws.addEventListener('error', (err) => {
      console.error('[net] WebSocket 에러:', err);
    });
  }

  /**
   * 수신 메시지 라우팅.
   * @param {object} msg
   */
  function route(msg) {
    switch (msg.type) {
      case 'JOINED':
        myPlayerId = msg.playerId;
        // Phase 4 C-2: 서버가 알려준 호스트 LAN URL을 함께 전달 (없으면 빈 문자열).
        handlers.onJoined({
          playerId: msg.playerId,
          waiting: msg.waiting,
          hostUrl: typeof msg.hostUrl === 'string' ? msg.hostUrl : '',
        });
        break;
      case 'START':
        handlers.onStart(msg.countdown || 3);
        break;
      case 'GARBAGE_RECV':
        handlers.onGarbage(msg.lines || 0, msg.combo || 0);
        break;
      case 'OPPONENT_BOARD':
        handlers.onOpponentBoard({ height: msg.height || 0, stack: msg.stack || [] });
        break;
      case 'GAME_RESULT':
        handlers.onResult(msg.winner, msg.reason || 'topout');
        break;
      case 'REMATCH_STATUS':
        handlers.onRematchStatus({
          p1Ready: !!msg.p1Ready,
          p2Ready: !!msg.p2Ready,
        });
        break;
      case 'READY_STATE':
        if (typeof handlers.onReadyState === 'function') {
          handlers.onReadyState({
            myReady: !!msg.myReady,
            opponentReady: !!msg.opponentReady,
          });
        }
        break;
      case 'OPPONENT_LEFT':
        if (typeof handlers.onOpponentLeft === 'function') {
          handlers.onOpponentLeft({ name: msg.name || '' });
        }
        break;
      case 'ERROR':
        handlers.onError(msg.message || 'Unknown error');
        break;
      // ── Phase 2 아이템 메시지 ──
      case 'ITEM_GRANT':
        if (handlers.onItemGrant) {
          handlers.onItemGrant({
            itemId: msg.itemId,
            slotIndex: typeof msg.slotIndex === 'number' ? msg.slotIndex : -1,
          });
        }
        break;
      case 'ITEM_EFFECT':
        if (handlers.onItemEffect) {
          handlers.onItemEffect({
            itemId: msg.itemId,
            duration: msg.duration || 0,
          });
        }
        break;
      case 'SHIELD_BLOCK':
        if (handlers.onShieldBlock) {
          handlers.onShieldBlock({ itemId: msg.itemId });
        }
        break;
      case 'SHIELD_ACTIVE':
        // 상대방이 방어막을 사용했음 — 상대 보드에 배지 표시
        if (handlers.onShieldActive) {
          handlers.onShieldActive();
        }
        break;
      default:
        console.warn('[net] 알 수 없는 메시지 타입:', msg.type);
    }
  }

  /**
   * 서버에 메시지 전송.
   * @param {object} payload
   */
  function send(payload) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn('[net] 연결되지 않은 상태에서 전송 시도:', payload.type);
      return;
    }
    ws.send(JSON.stringify(payload));
  }

  // ── 외부 API ──
  return {
    connect,
    /** 내 플레이어 ID 반환 (JOINED 이후 유효). */
    getMyId() { return myPlayerId; },
    /** 방 입장 메시지 전송. 연결 전 호출 시 open에서 자동 전송(레이스 방지). */
    join(playerName) {
      pendingJoinName = playerName || 'Player';
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'JOIN', playerName: pendingJoinName }));
      }
    },
    /** 게임 준비 완료 메시지 전송. */
    ready() { send({ type: 'READY' }); },
    /** 가비지 전송. */
    sendGarbage(lines, combo) { send({ type: 'GARBAGE_SEND', lines, combo }); },
    /** 보드 상태(미니맵용) 전송. */
    sendBoardState(height, stack) { send({ type: 'BOARD_STATE', height, stack }); },
    /** 게임 오버 선언. */
    sendGameOver() { send({ type: 'GAME_OVER' }); },
    /** 재대결 요청. */
    sendRematch() { send({ type: 'REMATCH' }); },
    /**
     * AI 대전 진입: 현재 URL에 ?mode=ai를 붙여 재접속한다.
     * sessionStorage에도 저장해 새로고침/재연결 시 AI 모드를 유지한다.
     */
    aiStart() {
      sessionStorage.setItem('tetris:mode', 'ai');
      const base = location.origin + location.pathname;
      location.href = `${base}?mode=ai`;
    },
    // Phase 2 placeholder
    sendItemUse(itemId, slotIndex) { send({ type: 'ITEM_USE', itemId, slotIndex }); },
  };
}
