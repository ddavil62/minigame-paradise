/**
 * @fileoverview 맞고 클라이언트 (v8 시안 UI 이식).
 *
 * - WebSocket 자동 재연결 (backoff 1→2→4→8s)
 * - pagehide 시 즉시 close → 서버 좀비 슬롯 방지
 * - 서버 STATE 스냅샷 수신 → DOM 렌더링
 * - 손패/바닥/점수판 클릭 입력 처리
 *
 * v8 이식 변경 요점:
 *   - 3×3 그리드 레이아웃 / 녹색 펠트 테마
 *   - 바닥 카드는 FLOOR_SLOTS 허니콤 절대위치(R=150px)
 *   - 먹은 패는 captured-summary + card-stack fan 방식
 *   - meta-panel(헤더 흡수) + profile-zone(이름/잔고/점수/손장수/뱃지)
 */

(() => {
  'use strict';

  // ── 해상도 적응: 1280×800 고정 캔버스를 창에 맞춰 비례 유지 스케일 ────────
  const DESIGN_W = 1280;
  const DESIGN_H = 800;
  function fitToWindow() {
    const sx = window.innerWidth / DESIGN_W;
    const sy = window.innerHeight / DESIGN_H;
    const s = Math.min(sx, sy);
    const dx = (window.innerWidth - DESIGN_W * s) / 2;
    const dy = (window.innerHeight - DESIGN_H * s) / 2;
    document.body.style.transform = `translate(${dx}px, ${dy}px) scale(${s})`;
  }
  window.addEventListener('resize', fitToWindow);
  // 초기 1회 + 폰트 로딩 후 한 번 더(폰트 메트릭 안정화)
  fitToWindow();
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(fitToWindow);
  }

  // ── fly 오버레이: body transform 컨테이너 밖에 두어 fixed 좌표가 viewport 기준으로 동작하도록.
  // (body에 transform이 있으면 position:fixed 자식은 body containing block 기준으로 위치가 잡혀
  //  getBoundingClientRect()의 viewport 좌표와 어긋난다.)
  const flyOverlay = document.createElement('div');
  flyOverlay.id = 'fly-overlay';
  flyOverlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; pointer-events:none; z-index:9999;';
  document.documentElement.appendChild(flyOverlay);

  // ── DOM 참조 (v8 신규/이전 ID 반영) ────────────────────────
  const youTagEl       = document.getElementById('you-tag');
  const perPointEl     = document.getElementById('per-point');

  // 양측 프로필 (잔고·점수·손장수·뱃지)
  const myMoneyEl      = document.getElementById('my-money');
  const oppMoneyEl     = document.getElementById('opp-money');
  const myScoreEl      = document.getElementById('my-score');
  const oppScoreEl     = document.getElementById('opp-score');
  const myExtraEl      = document.getElementById('my-extra');
  const oppExtraEl     = document.getElementById('opp-extra');
  const myBadgesEl     = document.getElementById('my-badges');
  const oppBadgesEl    = document.getElementById('opp-badges');

  // 손패 컨테이너 (5×2 그리드)
  const myHandCountEl  = document.getElementById('my-hand-count');
  const oppHandCountEl = document.getElementById('opp-hand-count');
  const myCardsEl      = document.getElementById('my-hand-cards');
  const oppCardsEl     = document.getElementById('opp-hand-cards');

  // 바닥 (펠트)
  const floorZoneEl    = document.getElementById('floor-zone');
  const floorCardsEl   = document.getElementById('floor-cards');
  const deckCountBigEl = document.getElementById('deck-count-big');
  const bannerStatusEl = document.getElementById('banner-status');
  const bannerMultiEl  = document.getElementById('banner-multiplier');

  // 액션 패널 (하단 고정)
  const actionDisplay  = document.getElementById('action-display');
  const goStopOverlay  = document.getElementById('go-stop-overlay');
  const shakeModal     = document.getElementById('shake-modal');
  const shakeMonthText = document.getElementById('shake-month-text');
  const floorChoiceModal     = document.getElementById('floor-choice-modal');
  const floorChoiceMonthText = document.getElementById('floor-choice-month');
  const floorChoiceCardsEl   = document.getElementById('floor-choice-cards');
  const bombPanel      = document.getElementById('bomb-panel');
  const bombMonthsEl   = document.getElementById('bomb-months');

  const btnGo          = document.getElementById('btn-go');
  const btnStop        = document.getElementById('btn-stop');
  const btnShake       = document.getElementById('btn-shake');
  const btnShakeNo     = document.getElementById('btn-shake-no');
  const btnBomb        = document.getElementById('btn-bomb');
  const btnNewRound    = document.getElementById('btn-new-round');
  const btnNewGame     = document.getElementById('btn-new-game');
  const btnNewRoundMod = document.getElementById('btn-new-round-modal');

  // 모달 + 토스트
  const roundModalEl   = document.getElementById('round-modal');
  const roundModalTitle= document.getElementById('round-modal-title');
  const roundModalBody = document.getElementById('round-modal-body');
  const kkeutModalEl   = document.getElementById('kkeut-modal');
  const btnKkeutKkeut  = document.getElementById('btn-kkeut-choice-kkeut');
  const btnKkeutSsangpi= document.getElementById('btn-kkeut-choice-ssangpi');
  // 사통 모달 (라운드 시작 시 같은 월 4장 손)
  const sangtongModalEl       = document.getElementById('sangtong-modal');
  const sangtongMonthTextEl   = document.getElementById('sangtong-month-text');
  const btnSangtongDeclare    = document.getElementById('btn-sangtong-declare');
  const btnSangtongContinue   = document.getElementById('btn-sangtong-continue');
  // 폭탄 확인 모달 (카드 클릭 시점)
  const bombConfirmModalEl    = document.getElementById('bomb-confirm-modal');
  const bombConfirmMonthTextEl = document.getElementById('bomb-confirm-month-text');
  const btnBombConfirm        = document.getElementById('btn-bomb-confirm');
  const btnBombCancel         = document.getElementById('btn-bomb-cancel');
  const toastEl        = document.getElementById('toast');

  // 먹은 패 zone
  const myCapturedZoneEl  = document.getElementById('my-captured-zone');
  const oppCapturedZoneEl = document.getElementById('opp-captured-zone');

  // ── 상태 ─────────────────────────────────────────────────────
  /** @type {WebSocket|null} */
  let ws = null;
  /** 'p1' | 'p2' | null */
  let me = null;
  /** 가장 최근 서버 스냅샷 */
  let lastState = null;
  let autoReconnect = true;
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  let toastTimer = null;

  // ── 애니메이션 diff용 상태 ───────────────────────────────
  /** 이전 STATE의 카드 ID 집합 (등장 애니메이션 트리거용) */
  let prevFloorIds = new Set();
  let prevCapIds   = { p1: new Set(), p2: new Set() };
  /** 현재 STATE에서 새로 등장한 카드 ID */
  let newFloorIds  = new Set();
  let newCapIds    = { p1: new Set(), p2: new Set() };
  /** lastAction 동일성 체크용 키 */
  let prevActionKey = '';
  /**
   * 이미 손→captured fly를 등록한 조커(joker_play, 케이스 A) 액션 키.
   * 서버가 동일 joker_play STATE를 2~3회 송신(hand_played/turn_finished/안전망)해도
   * 조커 fly는 라운드당 1회만 등록되도록 막는다. fly #1 완료로 pendingFlies가
   * 비워진 뒤 큐에서 같은 STATE가 재렌더돼도 이 키로 재등록을 차단한다.
   * 라운드 시작(GAME_START/ROUND_START) 시 리셋해 다음 라운드 조커 fly를 허용한다.
   */
  let lastJokerFlyActionKey = '';
  /** ppeok 토스트 지연 보관. 덱 뒤집기 fly의 DECK_LAND 전환 이후 flush. */
  let pendingPpeokToast = null;
  /** 액션 토스트 DOM (지연 생성, 한 개만 유지) */
  let actionToastEl = null;
  /** 진행 중인 fly 애니메이션 */
  let pendingFlies = [];
  /** fly 진행 중이면 새 STATE 적용을 보류한다. 내 턴에 카드를 낸 직후
   *  바닥/먹은 패 fly가 끝나기 전에 STATE가 즉시 적용되면 actionDisplay가
   *  바로 "상대 차례"로 바뀌어 부자연스러워 보였다. fly 끝날 때 큐에서 꺼내
   *  마지막 STATE만 적용한다 (중간 STATE는 어차피 누적 결과만 의미가 있음). */
  let isAnimating = false;
  /** fly 중에 도착한 STATE 메시지 큐 */
  const stateQueue = [];

  // ── 5건 룰 보강 (2026-05-31) ──
  /**
   * 바닥 카드 ID → 슬롯 인덱스 캐시.
   * 같은 카드는 처음 떨어진 슬롯 위치를 사라질 때까지 유지한다.
   * 다른 카드가 captured로 가도 인덱스 시프트로 자리 이동하지 않는다.
   * ROUND_START / GAME_START 수신 시 clear().
   * @type {Map<string, number>}
   */
  const floorSlotMap = new Map();

  /**
   * 라운드 당 흔들기 모달 1회 표시 제한.
   * ROUND_START / GAME_START 수신 시 false 리셋.
   */
  let shakeAskedThisRound = false;

  /**
   * 폭탄 모달 취소 시 같은 카드를 재클릭해도 모달이 다시 뜨지 않게 하는 일시 가드.
   * 다음 sendPlay 한 번만 우회한다.
   */
  let bombCheckSkipOnce = false;

  /**
   * 폭탄 확인 모달의 fallback 카드 ID (취소 시 한 장 내기로 폴백).
   */
  let pendingBombFallbackCardId = null;

  /**
   * 흔들기 모달의 pending 카드 ID (확인/거절 후 PLAY_CARD를 이어 전송).
   */
  let pendingShakeCardId = null;

  // ── 바닥 카드 허니콤 슬롯 (덱 중심 기준 절대위치) ────────────
  // v8 시안 그대로 이식. R=150px hex 반경.
  // 인덱스 0~5: 덱 주변 hex 6 꼭짓점, 6~11: 가로 외곽 확장.
  const FLOOR_SLOTS = (() => {
    const R = 150;
    const h = R * Math.sqrt(3) / 2; // ≈ 0.866 R
    return [
      { dx:  R,       dy:  0 },     // 0: 우
      { dx:  R / 2,   dy: -h },     // 1: 우상
      { dx: -R / 2,   dy: -h },     // 2: 좌상
      { dx: -R,       dy:  0 },     // 3: 좌
      { dx: -R / 2,   dy:  h },     // 4: 좌하
      { dx:  R / 2,   dy:  h },     // 5: 우하
      { dx:  2 * R,   dy:  0 },     // 6: 우 외곽 가운데
      { dx: -2 * R,   dy:  0 },     // 7: 좌 외곽 가운데
      { dx:  2 * R,   dy: -h },     // 8: 우 외곽 위
      { dx:  2 * R,   dy:  h },     // 9: 우 외곽 아래
      { dx: -2 * R,   dy: -h },     // 10: 좌 외곽 위
      { dx: -2 * R,   dy:  h },     // 11: 좌 외곽 아래
    ];
  })();

  /**
   * 바닥 카드 엘리먼트를 인덱스에 따라 허니콤 슬롯으로 배치.
   * @param {HTMLElement} el
   * @param {number} idx
   */
  function applyFloorSlot(el, idx) {
    const slot = FLOOR_SLOTS[idx % FLOOR_SLOTS.length];
    el.style.left      = `calc(50% + ${slot.dx}px)`;
    el.style.top       = `calc(50% + ${slot.dy}px)`;
    el.style.transform = 'translate(-50%, -50%)';
    el.style.zIndex    = '1';
  }

  /**
   * 두 Set의 차집합 (a − b).
   */
  function setDiff(a, b) {
    const out = new Set();
    for (const v of a) if (!b.has(v)) out.add(v);
    return out;
  }

  /**
   * 특수 액션 발생 시 화면 중앙에 짧은 배너 토스트.
   * @param {object} la lastAction 객체
   */
  function maybeShowActionToast(la) {
    if (!la) return;
    let text = null;
    switch (la.kind) {
      case 'jjok':            text = '쪽!'; break;
      case 'ppeok':           text = `${la.month}월 뻑!`; break;
      case 'ttadak':          text = '따닥!'; break;
      case 'bomb':            text = `${la.month}월 폭탄!`; break;
      // 조커 (2026-06-03): 손에서 조커를 냈을 때 / 더미에서 조커가 뒤집혔을 때
      case 'joker_play':      text = '조커! (피 +2)'; break;
      case 'joker_flip':      text = '조커! (손으로)'; break;
      // 바닥 조커 선공 자동 획득 (2026-06-03 룰 정정): 라운드 시작 시 바닥에 깔린 조커는
      // 선공자 captured로 자동 이동. 추가 보너스 없음. count는 1 또는 2.
      case 'floor_joker_to_first':
        text = `선공 바닥 조커 ${la.count}장 획득!`;
        break;
      // 쓸: chooseFloor 후 더미 매칭으로 그 월 4장 전부 가져간 케이스 (한국 표준 룰).
      // sweep_from_flip은 뻑 풀이(바닥 3장+더미 1장) — 효과는 같지만 의미가 다르므로 표시 분리.
      case 'sseul':           text = la.month ? `${la.month}월 쓸!` : '쓸!'; break;
      case 'sweep_from_flip': text = '뻑 풀이!'; break;
      case 'go':              text = `${la.count}고!`; break;
      case 'shake':           text = `${la.month}월 흔들기!`; break;
      case 'kkeut_choice':    text = la.choice === 'ssangpi' ? '술잔 → 쌍피' : '술잔 → 끗'; break;
      default: return;
    }
    if (!actionToastEl) {
      actionToastEl = document.createElement('div');
      actionToastEl.className = 'action-toast';
      document.body.appendChild(actionToastEl);
    }
    actionToastEl.textContent = text;
    actionToastEl.classList.remove('show');
    void actionToastEl.offsetWidth;
    actionToastEl.classList.add('show');
  }

  // ── WebSocket 연결 ───────────────────────────────────────────
  /**
   * WebSocket 연결을 시작한다. 페이지 host:port 그대로 사용.
   */
  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    // 통합 라우터(launcher) 환경에서는 /matgo/ 하위에서 호스팅되므로 WS path를 path prefix에 맞춰 구성한다.
    // standalone 실행 (`node server.js`) 시에는 pathname이 '/' 이므로 prefix 없이 '/ws'로 연결한다.
    const seg = location.pathname.split('/').filter(Boolean)[0] || '';
    const wsPath = seg ? `/${seg}/ws` : '/ws';
    // mode 정보 유지: URL query 우선, 없으면 sessionStorage. 새로고침해도 같은 모드로 재진입.
    const urlParams = new URLSearchParams(location.search);
    let mode = urlParams.get('mode');
    if (mode) {
      sessionStorage.setItem('matgo:mode', mode);
    } else {
      mode = sessionStorage.getItem('matgo:mode') || 'human';
    }
    const wsQuery = `?mode=${encodeURIComponent(mode)}`;
    ws = new WebSocket(`${proto}://${location.host}${wsPath}${wsQuery}`);
    ws.addEventListener('open', () => {
      console.log('[client] 연결됨');
      reconnectAttempts = 0;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    });
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      handleMessage(msg);
    });
    ws.addEventListener('close', () => {
      console.log('[client] 연결 종료');
      if (!autoReconnect) return;
      if (reconnectAttempts >= 6) {
        autoReconnect = false;
        showToast('재접속 한도 초과. 페이지를 새로고침해라.');
        return;
      }
      const delay = Math.min(8000, 1000 * Math.pow(2, reconnectAttempts));
      reconnectAttempts += 1;
      showToast(`연결이 끊겼다. ${Math.round(delay/1000)}초 후 자동 재접속 시도...`);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, delay);
    });
    ws.addEventListener('error', (err) => {
      console.error('[client] WS 에러', err);
    });
  }

  window.addEventListener('pagehide', () => {
    autoReconnect = false;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.close(1000, 'page hide'); } catch { /* noop */ }
    }
  });

  // ── 메시지 라우터 ───────────────────────────────────────────
  function handleMessage(msg) {
    switch (msg.type) {
      case 'JOINED':
        me = msg.playerId;
        youTagEl.textContent = `너는 ${me === 'p1' ? 'P1 (선공)' : 'P2 (후공)'}`;
        if (msg.waiting) {
          bannerStatusEl.textContent = '상대 대기 중';
          actionDisplay.textContent = '친구가 접속하기를 기다리는 중...';
        }
        break;
      case 'GAME_START':
        hideRoundModal();
        // 5건 룰 보강: 바닥 슬롯 캐시 + 흔들기 모달 1회 제한 초기화
        floorSlotMap.clear();
        shakeAskedThisRound = false;
        bombCheckSkipOnce = false;
        // 지연 보관 중이던 뻑 토스트를 라운드 시작 시 폐기(불용 토스트 잔존 방지).
        pendingPpeokToast = null;
        // 조커 fly 중복 가드 키 리셋 — 다음 라운드 조커 fly 정상 동작.
        lastJokerFlyActionKey = '';
        break;
      case 'ROUND_START':
        hideRoundModal();
        // 5건 룰 보강: 바닥 슬롯 캐시 + 흔들기 모달 1회 제한 초기화
        floorSlotMap.clear();
        shakeAskedThisRound = false;
        bombCheckSkipOnce = false;
        // 지연 보관 중이던 뻑 토스트를 라운드 시작 시 폐기(불용 토스트 잔존 방지).
        pendingPpeokToast = null;
        // 조커 fly 중복 가드 키 리셋 — 다음 라운드 조커 fly 정상 동작.
        lastJokerFlyActionKey = '';
        break;
      case 'STATE':
        lastState = msg;
        if (isAnimating) {
          // fly 진행 중이면 큐잉. 중간 STATE는 무시하고 마지막만 적용해도 무방.
          stateQueue.push(msg);
        } else {
          renderState(msg);
        }
        break;
      case 'ROUND_END':
        if (isAnimating) {
          // fly가 끝난 뒤 결과 모달을 띄워야 자연스럽다.
          stateQueue.push(msg);
        } else {
          showRoundResult(msg.result);
        }
        break;
      case 'OPPONENT_LEFT':
        showToast(msg.message || '상대방이 나갔다.');
        bannerStatusEl.textContent = '상대 대기 중';
        actionDisplay.textContent = '새 친구가 접속하기를 기다리는 중...';
        hideRoundModal();
        // 런처 모드(경로가 /matgo/로 시작)이면 로비로 자동 복귀
        if (window.location.pathname.startsWith('/matgo/')) {
          autoReconnect = false;
          setTimeout(() => { window.location.href = '/'; }, 1200);
        }
        break;
      case 'ERROR':
        if (msg.message && msg.message.includes('가득')) {
          autoReconnect = false;
          if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
          showToast('방이 가득 찼다 (2/2). 다른 탭/PC를 닫고 새로고침해라.');
        } else {
          showToast(msg.message || '알 수 없는 오류');
          // 액션 거절 시 보류 중인 fly clone 정리 — 카드가 사라진 듯 보이는 현상 방지
          if (pendingFlies.length > 0) {
            for (const fly of pendingFlies) {
              if (fly.clone) fly.clone.remove();
              // 원본 visibility 복원
              const src = myCardsEl.querySelector(`[data-card-id="${fly.cardId}"]`);
              if (src) src.style.visibility = '';
            }
            pendingFlies = [];
            isAnimating = false;
          }
        }
        break;
      default:
        console.warn('[client] 알 수 없는 메시지:', msg);
    }
  }

  // ── 렌더링 ──────────────────────────────────────────────────
  /**
   * 서버 STATE 스냅샷을 화면에 반영.
   * @param {object} s
   */
  function renderState(s) {
    // 9월 술잔 끗/쌍피 선택 모달 토글
    const needKkeutChoice = s.phase === 'awaiting_kkeut_choice'
      && s.pendingKkeutChoice && s.pendingKkeutChoice.player === me;
    if (needKkeutChoice) {
      kkeutModalEl.classList.remove('hidden');
    } else {
      kkeutModalEl.classList.add('hidden');
    }

    // 사통 모달 토글 — 라운드 시작 시 같은 월 4장 손 보유자에게 표시.
    const needSangtong = s.phase === 'awaiting_sangtong'
      && s.pendingSangtong && s.pendingSangtong.player === me;
    if (needSangtong && sangtongModalEl) {
      if (sangtongMonthTextEl) {
        sangtongMonthTextEl.textContent = `${s.pendingSangtong.month}월`;
      }
      sangtongModalEl.classList.remove('hidden');
    } else if (sangtongModalEl) {
      sangtongModalEl.classList.add('hidden');
    }

    // 바닥 선택 모달 토글 — 같은 월 후보 카드 중 1장 선택해야 할 때
    // 바닥에 비스듬히 겹쳐있어 가독성 떨어지는 문제를 모달에서 큰 카드로 해결
    const needFloorChoice = s.phase === 'awaiting_floor_choice'
      && s.turn === me && s.pendingChoice;
    if (needFloorChoice) {
      if (floorChoiceMonthText) {
        floorChoiceMonthText.textContent = `${s.pendingChoice.month}월`;
      }
      if (floorChoiceCardsEl) {
        floorChoiceCardsEl.innerHTML = '';
        for (const card of s.pendingChoice.candidates) {
          const el = makeCardEl(card);
          el.addEventListener('click', () => {
            sendChooseFloor(card.id);
            floorChoiceModal.classList.add('hidden');
          });
          floorChoiceCardsEl.appendChild(el);
        }
      }
      floorChoiceModal.classList.remove('hidden');
    } else {
      floorChoiceModal.classList.add('hidden');
    }

    // 매칭 fly 연출용 — 이번 renderState 직전의 floor 카드 DOM 위치를 캡처해두고,
    // 이번 STATE에서 floor에서 사라진 카드 ID(=매칭된 짝)를 미리 추려둔다.
    // resolvePendingFlies가 사용한다.
    const prevFloorRects = new Map();
    for (const el of floorCardsEl.querySelectorAll('[data-card-id]')) {
      prevFloorRects.set(el.dataset.cardId, el.getBoundingClientRect());
    }
    // 덱 뒤집기 fly 시작 좌표 — 더미 카드 DOM 위치
    const deckElForFly = floorCardsEl.querySelector('.deck-card');
    const deckRectForFly = deckElForFly ? deckElForFly.getBoundingClientRect() : null;

    // 애니메이션 diff 계산
    const curFloorIds = new Set(s.floor.map((c) => c.id));
    const removedFloorIds = [...prevFloorIds].filter((id) => !curFloorIds.has(id));
    const curCapIds = {
      p1: new Set(s.captured.p1.map((c) => c.id)),
      p2: new Set(s.captured.p2.map((c) => c.id)),
    };
    newFloorIds = setDiff(curFloorIds, prevFloorIds);
    newCapIds.p1 = setDiff(curCapIds.p1, prevCapIds.p1);
    newCapIds.p2 = setDiff(curCapIds.p2, prevCapIds.p2);
    // 강탈 피 식별용 — prevCapIds를 curCapIds로 덮어쓰기 전에 직전 captured 스냅샷 보존.
    // (아래 stolenPiIds 분기는 "직전 상대 captured에 있었고 이번 내 captured에 새로 등장"을
    //  판정하므로, 덮어쓴 뒤의 prevCapIds로는 교집합이 항상 false가 된다.)
    const prevCapSnapshot = { p1: prevCapIds.p1, p2: prevCapIds.p2 };
    prevFloorIds = curFloorIds;
    prevCapIds = curCapIds;

    // 액션 토스트 (특수 룰 발생 시 화면 중앙에 한 번 띄움)
    // ppeok 종류는 덱 뒤집기 연출이 완료된 후 표시 — DECK_LAND 전환에서 flush.
    const actionKey = s.lastAction ? JSON.stringify(s.lastAction) : '';
    if (actionKey && actionKey !== prevActionKey) {
      if (s.lastAction && s.lastAction.kind === 'ppeok') {
        // 뻑: 덱 fly DECK_LAND 이후 표시. resolvePendingFlies가 flush 책임.
        pendingPpeokToast = s.lastAction;
      } else {
        maybeShowActionToast(s.lastAction);
      }
      prevActionKey = actionKey;
    }

    // me 기준 양측 ID
    const oppId = me === 'p1' ? 'p2' : 'p1';

    // 잔고 (프로필 zone)
    if (me) {
      myMoneyEl.textContent  = `${formatMoney(s.money[me])}원`;
      oppMoneyEl.textContent = `${formatMoney(s.money[oppId])}원`;
    }

    // perPoint — 사용자 입력 중일 때는 갱신하지 않음
    if (document.activeElement !== perPointEl) {
      perPointEl.value = s.perPoint;
    }

    // 점수 (숫자만 — 32px 큰 숫자 표시)
    myScoreEl.textContent  = String(s.score[me] || 0);
    oppScoreEl.textContent = String(s.score[oppId] || 0);

    // 더미 카운트
    deckCountBigEl.textContent = String(s.deckCount);
    // 보너스 뒤집기 가능 표시 — 자기 턴 + awaiting_play + bombDeckCredit > 0
    const canBonusFlip = s.turn === me
      && s.phase === 'awaiting_play'
      && (s.bombDeckCredit?.[me] || 0) > 0
      && s.deckCount > 0;
    const deckCardEl = floorCardsEl.querySelector('.deck-card');
    if (deckCardEl) {
      deckCardEl.classList.toggle('clickable', canBonusFlip);
      deckCardEl.classList.toggle('bonus-available', canBonusFlip);
    }

    // 손패 장수 extras
    myExtraEl.textContent  = `손 ${s.yourHand.length}장`;
    oppExtraEl.textContent = `손 ${s.oppHandCount}장`;

    // 배지 (흔들기/고)
    updateProfileBadges(myBadgesEl,  me, s);
    updateProfileBadges(oppBadgesEl, oppId, s);

    // 배너 상태 텍스트 + 배수 + warning 토글
    bannerStatusEl.textContent = deriveTurnText(s);
    bannerMultiEl.textContent  = deriveBannerMultiplier(s, me, oppId);
    floorZoneEl.classList.toggle(
      'warning',
      (s.score[me] || 0) >= 7 || (s.score[oppId] || 0) >= 7,
    );

    // 손 fly에 이미 있는 카드 ID — 덱/상대손 fly 후보에서 제외
    const flyHandIds = new Set(pendingFlies.map((f) => f.cardId));
    // 직전 floor에서 사라진 카드 ID — 짝 카드(매칭으로 captured 이동)는 hasPair 흐름의
    // spawnPairCloneOnce로 처리되므로 덱 fly 후보에서 제외해야 한다.
    // (그렇지 않으면 짝 카드가 newCapIds에 포함돼 drewIds로 분류되고 startFlyFromDeck가
    //  호출되어 시각상 더미덱에서 짝이 다시 나오는 잘못된 fly가 발동된다.)
    const removedFloorSet = new Set(removedFloorIds);
    // 이번 STATE에서 새로 등장한 카드 ID (손 fly도 아니고 직전 floor 출신도 아님)
    const newCardIds = new Set();
    for (const id of [...newFloorIds, ...newCapIds.p1, ...newCapIds.p2]) {
      if (flyHandIds.has(id)) continue;
      if (removedFloorSet.has(id)) continue;
      newCardIds.add(id);
    }
    // lastAction 캡처 — 아래의 choice_made 분기와 상대 손 origin 식별 양쪽에서 사용.
    // (선언이 사용 뒤에 있으면 TDZ ReferenceError로 첫 STATE 렌더 자체가 멈춘다.)
    const la = s.lastAction;

    // chooseFloorSteps 단계 1 (choice_made): srcCard가 captured에 등장하는데, 이건
    // 사용자가 모달 선택 직전에 던진 자기 카드다. 덱 origin이 아니므로 drewIds에서 제외.
    // (그렇지 않으면 자기가 던진 카드가 더미에서 다시 등장하는 잘못된 fly가 발동된다.)
    // ── B1 수정: la.kind === 'choice_made'에만 의존하면 통합 STATE(choice_made가
    // server.js shouldDeferBroadcast로 보류되어 la.kind가 단계 2 결과로 덮임)에서
    // 가드가 발동하지 않는다. s.choiceFloorSrcCardId를 1차 기준으로 사용한다. ──
    if (s.choiceFloorSrcCardId) {
      newCardIds.delete(s.choiceFloorSrcCardId);
    }
    // 폴백: choice_made가 개별 broadcast로 도착하는 경로(혹시 생기는 경우) 보호.
    if (la && la.kind === 'choice_made' && la.srcCard) {
      newCardIds.delete(la.srcCard.id);
    }

    // 상대 손에서 나온 카드 ID 식별 — lastAction이 상대의 손 origin 단서일 때.
    // 단계 1 (hand_played): place_on_floor / pair_from_hand / sweep_from_hand → 상대 손
    // 단계 2 (deck_flipped): flip_place / pair_from_flip / jjok / ttadak / ppeok → 덱
    // 폭탄(bomb)도 손에서 3장 + 바닥 1장 captured → 상대 손 origin으로 묶음
    const oppHandOriginIds = new Set();
    const HAND_ORIGIN_KINDS = new Set(['place_on_floor', 'pair_from_hand', 'sweep_from_hand', 'choice_made', 'choice_pending']);
    // 1) server snapshot의 lastHandPlayed로 단계 1 손 origin 식별 (defer 통합 STATE 대응)
    const lhp = s.lastHandPlayed;
    if (lhp && lhp.player === oppId && la?.kind !== 'round_start') {
      if (lhp.card && newCardIds.has(lhp.card.id)) oppHandOriginIds.add(lhp.card.id);
      if (Array.isArray(lhp.cards)) {
        for (const c of lhp.cards) if (newCardIds.has(c.id)) oppHandOriginIds.add(c.id);
      }
    }
    // 2) lastAction 기반 fallback (chooseFloor 등 별도 broadcast 케이스)
    if (la && la.player === oppId && la.kind !== 'round_start') {
      if (HAND_ORIGIN_KINDS.has(la.kind)) {
        if (la.card && newCardIds.has(la.card.id)) oppHandOriginIds.add(la.card.id);
        if (la.pair && newCardIds.has(la.pair.id)) oppHandOriginIds.add(la.pair.id);
        if (Array.isArray(la.trio)) {
          for (const t of la.trio) if (newCardIds.has(t.id)) oppHandOriginIds.add(t.id);
        }
      } else if (la.kind === 'bomb' && la.month != null) {
        for (const c of (s.captured[oppId] || [])) {
          if (c.month === la.month && newCardIds.has(c.id)) oppHandOriginIds.add(c.id);
        }
      }
    }
    // 라운드/게임 시작 STATE — 손 8장 분배 + floor 8장 초기 등장. 이 카드들에 대해
    // 덱 fly를 발동하면 "더미에서 나오는" 인상이 되어 어색하다 (사용자 보고).
    // lastAction.kind === 'round_start'이면 fly 보류.
    // 바닥 조커 자동획득(floor_joker_to_first) STATE도 라운드 시작이므로 더미 fly 억제
    // (조커는 captured로, 리필 카드는 floor에 fly 없이 appear — round_start 오프닝과 동일).
    const isRoundStart = la && (la.kind === 'round_start' || la.kind === 'floor_joker_to_first');

    // 강탈 피 식별 — stoleFromOpp > 0인 STATE에서 상대 captured→내 captured로 이동한 카드.
    // stealPi(game.js)가 victim.captured의 실제 피 카드를 taker.captured로 splice/push하므로
    // prevCapIds[opp]에 있었고 newCapIds[me]에 새로 등장한 카드만 강탈 피다.
    // 이 카드들은 oppCapturedZoneEl에서 fly 출발해야 하므로 drewIds(덱 출발)에서 제외한다.
    // (게이트 없이 교집합만으로도 견고하나, 스펙 지정대로 la.stoleFromOpp > 0 게이트를 둔다.)
    const stolenPiIds = new Set();
    if (la && la.stoleFromOpp > 0) {
      for (const id of newCapIds[me]) {
        if (prevCapSnapshot[oppId].has(id)) stolenPiIds.add(id);
      }
      for (const id of stolenPiIds) newCardIds.delete(id);
    }

    // ── R8 수정 (2026-06-16): joker_play 조커 손패 HAND_THROW 등록 ──
    // 손에서 낸 조커(케이스 A)는 서버가 captured로 옮기고 손에서 제거한다. 통합 STATE에서
    // 조커는 newCapIds[me]에 등장하지만 손 origin 식별에 걸리지 않아 drewIds로 분류돼
    // startFlyFromDeck(더미 fly)로 잘못 날아간다. 조커 ID를 newCardIds(→drewIds)에서
    // 제외하고 렌더 후 startFlyFromHand로 손→captured fly를 등록한다.
    // 강탈 피(stoleFromOpp=1)는 위 stolenPiIds 분기가 이미 처리(startFlyFromOppCaptured).
    // 더미 보충 카드(refilled)는 newCapIds가 아니라 yourHand에 들어가 drewIds에 안 나타남
    // → 렌더 후 손 카드 appear로 자연 처리(별도 fly 없음, 허용).
    let _jokerFlyId = null; // R8: joker HAND_THROW 등록용 임시 변수 (renderState 로컬)
    if (la && la.kind === 'joker_play' && la.player === me && la.card) {
      // ── 2026-06-20 조커 fly 중복 재생 수정 ──
      // 서버가 동일 joker_play STATE를 2~3회 송신(hand_played/turn_finished/안전망)하면
      // STATE가 큐잉→flush 재렌더될 때마다 조커 fly가 재등록돼 2~3회 재생되던 버그.
      // 이중 가드로 라운드당 1회만 등록한다.
      //  (1) 중복 가드: pendingFlies에 같은 카드 fly가 이미 있으면 재등록 안 함
      //      (choice srcCard 경로와 동일 패턴).
      //  (2) 액션 키 가드: fly #1 완료로 pendingFlies가 비워진 뒤 같은 STATE가
      //      재렌더돼도 lastJokerFlyActionKey로 차단(prevActionKey 토스트 가드 참고).
      // 가드는 케이스 A(joker_play)에만 적용 — 케이스 B(joker_flip)는 무영향.
      // _jokerFlyId 미설정 시 flyTargetIds.add/startFlyFromHand가 자연 skip되어
      // captured 정적 표시(R8 pi 그룹 합류)는 유지된다(fly만 안 일어남).
      const jokerActionKey = la.kind + '|' + la.card.id + '|' + la.player;
      const alreadyFlying = pendingFlies.some((f) => f.cardId === la.card.id);
      if (jokerActionKey !== lastJokerFlyActionKey) {
        // 이 joker_play 액션을 아직 처리하지 않았다.
        // alreadyFlying이 true면 클릭 핸들러(sendPlay)가 이미 손 fly를 등록했으므로
        // STATE에서 재등록하지 않는다(중복 fly 방지). 단 이 액션은 "처리됨"으로
        // 표시해(키 기록) 이후 동일 STATE 재렌더가 새 fly를 등록하지 못하게 한다.
        // alreadyFlying이 false면(클릭 핸들러를 거치지 않은 폴백 경로) STATE가
        // 손→captured fly를 1회 등록한다.
        if (!alreadyFlying) _jokerFlyId = la.card.id;
        lastJokerFlyActionKey = jokerActionKey;
      }
      // newCardIds 제외는 fly 등록 여부와 무관하게 항상 수행 — 조커가 drewIds로
      // 잘못 분류돼 더미 fly로 날아가는 것을 막아야 한다(중복 STATE 재렌더 포함).
      newCardIds.delete(la.card.id);
    }

    // ── R5 수정 (2026-06-16): choice 흐름 손패 HAND_THROW 등록 ──
    // B1 수정이 s.choiceFloorSrcCardId를 newCardIds에서 제외해 잘못된 덱 fly는 막았으나,
    // 손에서 낸 srcCard의 올바른 손 fly(HAND_THROW)를 등록하지 않아 순간이동이 남아 있었다.
    // (클릭 시점에 등록된 fly는 awaiting_floor_choice STATE에서 도착지를 못 찾아 fade됨.)
    // 통합 STATE에서 srcCard가 captured에 안착하므로 렌더 후 startFlyFromHand로 재등록한다.
    // 라운드 시작 fly 억제(isRoundStart) 시엔 등록하지 않는다 (오프닝 appear 유지).
    // 이미 pendingFlies에 같은 ID가 있으면 중복 등록을 피한다.
    let _choiceSrcFlyId = null; // R5: choice srcCard HAND_THROW 등록용 임시 변수
    if (s.choiceFloorSrcCardId && !isRoundStart) {
      const already = pendingFlies.some((f) => f.cardId === s.choiceFloorSrcCardId);
      if (!already) _choiceSrcFlyId = s.choiceFloorSrcCardId;
    }

    const drewIds = new Set();
    if (!isRoundStart) {
      // 덱 fly 대상 = 새 카드 중 상대 손 origin이 아닌 것
      for (const id of newCardIds) {
        if (!oppHandOriginIds.has(id)) drewIds.add(id);
      }
    }

    // 매칭 fly 대상 카드는 captured에 처음 그려질 때부터 visibility:hidden + 등장 애니메이션 보류.
    // 그렇지 않으면 fly clone이 손→captured 이동 중에 도착지 카드의 fly-in-captured 애니메이션이
    // 먼저 보여서 "바닥 패가 붙는 애니메이션이 손 카드 fly보다 먼저 나오는" 현상이 생긴다.
    const flyTargetIds = new Set();
    for (const f of pendingFlies) flyTargetIds.add(f.cardId);
    for (const id of removedFloorIds) {
      // 짝 카드가 이번 STATE에서 captured로 갔다면 fly 대상에 포함
      if ((s.captured.p1 && s.captured.p1.find((c) => c.id === id))
       || (s.captured.p2 && s.captured.p2.find((c) => c.id === id))) {
        flyTargetIds.add(id);
      }
    }
    // 덱에서 뒤집힌 카드도 fly 대상 — appear 애니메이션 끄고 시작 위치를 deck으로
    for (const id of drewIds) flyTargetIds.add(id);
    // 상대 손에서 나온 카드도 fly 대상
    for (const id of oppHandOriginIds) flyTargetIds.add(id);
    // 강탈 피도 fly 대상 — 도착지(내 captured) appear 애니메이션 끄고 상대 captured에서 출발
    for (const id of stolenPiIds) flyTargetIds.add(id);
    // R5/R8: choice srcCard / 조커도 fly 대상 — captured 도착지 appear 억제 후 손에서 출발.
    // (누락 시 captured에 카드가 보였다가 fly clone이 도착하는 이중 표시 발생.)
    if (_choiceSrcFlyId) flyTargetIds.add(_choiceSrcFlyId);
    if (_jokerFlyId) flyTargetIds.add(_jokerFlyId);

    // 손패 / 바닥 / 점수판 렌더
    renderOppHand(s);
    renderMyHand(s);
    renderFloor(s, flyTargetIds);
    renderCaptured('p1', s, flyTargetIds);
    renderCaptured('p2', s, flyTargetIds);

    // 매칭 가능 표시: 자기 턴 + awaiting_play 시 손패와 바닥 양쪽에 has-match 클래스를 토글한다.
    // (손패 has-match는 renderMyHand에서 이미 처리, 바닥 has-match는 여기서 처리)
    updateFloorMatchHints(s);

    // ── R5 손 fly 후처리: 렌더 완료 후 startFlyFromHand 호출 (덱 fly보다 먼저 등록) ──
    // startFlyFromDeck보다 먼저 호출해야 pendingFlies에 손 카드가 먼저 들어가
    // HAND_THROW → DECK 시퀀스 순서가 자연 정합된다 (R6 순서 해소).
    if (_choiceSrcFlyId) {
      startFlyFromHand(_choiceSrcFlyId);
      _choiceSrcFlyId = null;
    }
    // ── R8 조커 fly 후처리 ──
    if (_jokerFlyId) {
      startFlyFromHand(_jokerFlyId);
      _jokerFlyId = null;
    }

    // 덱 뒤집기 fly 시작 — 도착지(floor 또는 captured) DOM이 그려진 후 클론
    if (deckRectForFly && drewIds.size > 0) {
      for (const id of drewIds) {
        startFlyFromDeck(id, deckRectForFly);
      }
    }
    // 상대 손에서 나온 카드 fly 시작
    if (oppHandOriginIds.size > 0) {
      const oppHandRect = oppCardsEl.getBoundingClientRect();
      for (const id of oppHandOriginIds) {
        startFlyFromOppHand(id, oppHandRect);
      }
    }

    // 강탈 피 fly 시작 — oppCapturedZoneEl에서 내 captured로 날아옴
    if (stolenPiIds.size > 0 && oppCapturedZoneEl) {
      const oppCapRect = oppCapturedZoneEl.getBoundingClientRect();
      for (const id of stolenPiIds) {
        startFlyFromOppCaptured(id, oppCapRect);
      }
    }

    // 액션 패널
    updateActionPanel(s);

    // 3단계 fly: 손→짝 옆 → 멈춤 → 덱→짝 옆 → 멈춤 → 모두 captured (매칭 시)
    resolvePendingFlies(s, removedFloorIds, prevFloorRects);
  }

  /**
   * 현재 phase/turn 기준 배너 상단 상태 텍스트 도출.
   * @param {object} s
   * @returns {string}
   */
  function deriveTurnText(s) {
    if (s.phase === 'round_end') return '라운드 종료';
    if (s.phase === 'awaiting_sangtong') {
      return s.pendingSangtong && s.pendingSangtong.player === me ? '사통 결정' : '상대 사통 결정';
    }
    if (s.phase === 'awaiting_floor_choice') {
      return s.turn === me ? '바닥 선택' : '상대 선택 중';
    }
    if (s.phase === 'awaiting_go_stop') {
      return s.turn === me ? '고/스톱 결정' : '상대 고/스톱';
    }
    if (s.phase === 'awaiting_kkeut_choice') {
      return s.pendingKkeutChoice && s.pendingKkeutChoice.player === me
        ? '9월 술잔 선택'
        : '상대 술잔 선택 중';
    }
    if (s.turn === me) return '내 턴';
    return '상대 턴';
  }

  /**
   * 배너 우측 배수 라벨 (고 횟수 / 흔들기).
   * @param {object} s
   * @param {string} meId
   * @param {string} oppId
   * @returns {string}
   */
  function deriveBannerMultiplier(s, meId, oppId) {
    if (!meId) return '';
    const goCount = (s.goCount && (s.goCount[meId] || 0)) + (s.goCount && (s.goCount[oppId] || 0));
    const shaking = (s.shaking && s.shaking[meId]) || (s.shaking && s.shaking[oppId]);
    if (goCount > 0 && shaking) return `${goCount}고 · ×2`;
    if (goCount > 0) return `${goCount}고`;
    if (shaking) return '×2';
    return '';
  }

  /**
   * 프로필 배지 갱신 (흔들기 / 고).
   * @param {HTMLElement} el
   * @param {string} pid
   * @param {object} s
   */
  function updateProfileBadges(el, pid, s) {
    el.innerHTML = '';
    if (!pid) return;
    if (s.shaking && s.shaking[pid]) {
      const b = document.createElement('span');
      b.className = 'profile-badge';
      b.textContent = '흔들기 ×2';
      el.appendChild(b);
    }
    if (s.goCount && s.goCount[pid] > 0) {
      const b = document.createElement('span');
      b.className = 'profile-badge red';
      b.textContent = `${s.goCount[pid]}고`;
      el.appendChild(b);
    }
    // 폭탄 보너스 뒤집기 권리 잔여 표시.
    if (s.bombDeckCredit && s.bombDeckCredit[pid] > 0) {
      const b = document.createElement('span');
      b.className = 'profile-badge';
      b.textContent = `보너스 뒤집기 ${s.bombDeckCredit[pid]}`;
      el.appendChild(b);
    }
  }

  /**
   * 카드 DOM 엘리먼트 생성.
   * @param {object} card
   * @param {object} [opts]
   * @param {boolean} [opts.back]    - true면 뒷면 (상대 손)
   * @param {boolean} [opts.ppeok]   - 뻑 표시
   * @param {string}  [opts.anim]    - 등장 애니메이션 클래스
   * @returns {HTMLDivElement}
   */
  function makeCardEl(card, opts = {}) {
    const el = document.createElement('div');
    el.className = 'card';
    if (opts.anim)  el.classList.add(`anim-${opts.anim}`);
    if (opts.back) {
      el.classList.add('back');
      el.textContent = '';
      return el;
    }
    el.classList.add(card.type);
    if (card.subtype) el.classList.add(card.subtype);
    if (card.id) el.dataset.cardId = card.id;
    if (card.month) el.dataset.cardMonth = String(card.month);

    // ── 조커 시각화 (2026-06-03) ──────────────────────────────
    // imagePath 없음 → 별 + JOKER 라벨로 다른 카드와 명확히 구별. type-badge도 별도 라벨.
    if (card.type === 'joker') {
      el.classList.add('joker-card');
      const star = document.createElement('span');
      star.className = 'joker-star';
      star.textContent = '★';
      el.appendChild(star);
      const label = document.createElement('span');
      label.className = 'joker-label';
      label.textContent = 'JOKER';
      el.appendChild(label);
      return el;
    }

    // PixelLab/SVG 일러스트 (있으면). 이미지 로드 실패 시 텍스트 라벨로 폴백.
    if (card.imagePath) {
      const img = document.createElement('img');
      img.className = 'card-img';
      img.src = card.imagePath;
      img.alt = `${card.month}월 ${typeLabel(card)}`;
      img.draggable = false;
      img.addEventListener('error', () => {
        img.remove();
        el.classList.add('no-img');
        const fallback = document.createElement('span');
        fallback.className = 'card-label';
        fallback.textContent = typeLabel(card);
        el.appendChild(fallback);
      });
      el.appendChild(img);
    } else {
      el.classList.add('no-img');
      const label = document.createElement('span');
      label.className = 'card-label';
      label.textContent = typeLabel(card);
      el.appendChild(label);
    }

    // 월 태그 (CSS에서 display:none, JS는 단순 보존)
    const mt = document.createElement('span');
    mt.className = 'month-tag';
    mt.textContent = `${card.month}월`;
    el.appendChild(mt);

    // 카드 타입 인디케이터 (좌하단 작은 배지)
    const tb = document.createElement('span');
    tb.className = `type-badge type-${card.type}`;
    tb.textContent = typeLabel(card);
    // 9월 술잔은 끗/쌍피 양면성 — outline 시각만 표시 (dual-badge는 CSS에서 hidden)
    if (card.month === 9 && card.type === 'kkeut') {
      el.classList.add('hybrid-9-kkeut-pi');
      el.classList.add('hybrid-9');
      const dual = document.createElement('span');
      dual.className = 'dual-badge';
      dual.textContent = '끗 · 쌍피';
      dual.title = '9월 술잔은 가져간 후 끗/쌍피 중 자기에게 유리한 쪽으로 선택 가능';
      el.appendChild(dual);
    }
    el.appendChild(tb);

    if (opts.ppeok) el.classList.add('ppeok-mark');
    return el;
  }

  /**
   * 카드 type/subtype → 한글 짧은 라벨.
   * @param {object} card
   */
  function typeLabel(card) {
    if (card.type === 'gwang')   return card.subtype === 'bigwang' ? '비광' : '광';
    if (card.type === 'tti') {
      if (card.subtype === 'hong')   return '홍단';
      if (card.subtype === 'cheong') return '청단';
      if (card.subtype === 'cho')    return '초단';
      if (card.subtype === 'bi')     return '비단';
      return '띠';
    }
    if (card.type === 'kkeut')   return card.subtype === 'godori' ? '고도리' : '끗';
    if (card.type === 'pi')      return card.subtype === 'ssangpi' ? '쌍피' : '피';
    if (card.type === 'joker')   return '조커';
    return '?';
  }

  /**
   * 상대 손 (뒷면만 5×2 슬롯에 표시).
   */
  function renderOppHand(s) {
    oppCardsEl.innerHTML = '';
    oppHandCountEl.textContent = String(s.oppHandCount);
    for (let i = 0; i < s.oppHandCount; i++) {
      oppCardsEl.appendChild(makeCardEl(null, { back: true }));
    }
  }

  /** 손패 정렬 기준: 월 오름차순, 동월 내에서는 광 > 끗 > 띠 > 피 순. */
  const TYPE_ORDER = { gwang: 0, kkeut: 1, tti: 2, pi: 3 };

  /**
   * 내 손 (5×2 그리드). 표시할 때만 정렬 (서버 상태는 그대로 유지).
   */
  function renderMyHand(s) {
    myCardsEl.innerHTML = '';
    myHandCountEl.textContent = String(s.yourHand.length);
    const canPlay = s.turn === me && s.phase === 'awaiting_play';
    const sorted = s.yourHand.slice().sort((a, b) => {
      if (a.month !== b.month) return a.month - b.month;
      const ta = TYPE_ORDER[a.type] ?? 99;
      const tb = TYPE_ORDER[b.type] ?? 99;
      if (ta !== tb) return ta - tb;
      return (a.id || '').localeCompare(b.id || '');
    });
    // 바닥에 존재하는 월 집합 — 매칭 가능 손패 표시 + hover 하이라이트용
    const floorMonths = new Set((s.floor || []).map((c) => c.month));
    sorted.forEach((card) => {
      const el = makeCardEl(card);
      const hasMatch = canPlay && floorMonths.has(card.month);
      if (canPlay) {
        el.classList.add('clickable');
        if (hasMatch) el.classList.add('has-match');
        el.addEventListener('click', () => sendPlay(card.id));
        // hover로 같은 월의 바닥 카드에 매칭 하이라이트 토글
        el.addEventListener('mouseenter', () => highlightMatch(card.month, true));
        el.addEventListener('mouseleave', () => highlightMatch(card.month, false));
      }
      myCardsEl.appendChild(el);
    });

    // pendingFlies에 등록된 손 카드는 DOM 재생성 후에도 visibility:hidden 유지.
    // 버그5: 흔들기/그냥내기 모달 경유 시 SHAKE STATE(shaking[me]=true)가 도착하면
    // renderMyHand가 myCardsEl.innerHTML=''로 원본 DOM을 파괴한다. fly clone은 살아 있으나
    // 새로 그려진 원본 카드가 보이면 "손에 카드가 그대로 있는데 더미서 또 날아오는" 인상이 된다.
    // 새 DOM에 다시 가림 처리해 fly clone이 도착할 때까지 원본을 숨긴다.
    if (pendingFlies.length > 0) {
      for (const fly of pendingFlies) {
        const newSrc = myCardsEl.querySelector(`[data-card-id="${fly.cardId}"]`);
        if (newSrc) newSrc.style.visibility = 'hidden';
      }
    }
  }

  /**
   * 바닥에서 month와 같은 월의 카드들에 match-highlight 클래스를 토글한다.
   * @param {number} month
   * @param {boolean} on
   */
  function highlightMatch(month, on) {
    const els = floorCardsEl.querySelectorAll('[data-card-month]');
    els.forEach((el) => {
      if (Number(el.dataset.cardMonth) === month) {
        el.classList.toggle('match-highlight', on);
      }
    });
  }

  /**
   * 바닥 카드 중 내 손에 같은 월 카드가 있는 것들에 has-match 클래스를 적용한다.
   * 자기 턴 + awaiting_play일 때만 활성, 그 외엔 모두 제거.
   * @param {object} s
   */
  function updateFloorMatchHints(s) {
    const canPlay = s.turn === me && s.phase === 'awaiting_play';
    const handMonths = canPlay ? new Set((s.yourHand || []).map((c) => c.month)) : null;
    const els = floorCardsEl.querySelectorAll('[data-card-month]');
    els.forEach((el) => {
      const m = Number(el.dataset.cardMonth);
      const on = canPlay && handMonths.has(m);
      el.classList.toggle('has-match', on);
    });
  }

  /**
   * 바닥 카드 — 허니콤 12슬롯 절대위치 (deck-card / floor-mission 보존).
   *
   * 5건 룰 보강 (2026-05-31): floorSlotMap(카드 ID → 슬롯 인덱스) 캐시 기반으로
   * 위치를 고정한다. 같은 월의 "첫 카드"가 어느 슬롯에 떨어졌는지를 기준으로
   * 그 월 그룹의 슬롯을 결정한다. 짝 카드가 captured로 가도 남은 카드의 슬롯은
   * 그대로 유지된다. 새 카드가 바닥에 추가되면 비어 있는 슬롯 중 가장 작은
   * 인덱스부터 배정한다.
   */
  function renderFloor(s, flyTargetIds = new Set()) {
    // deck-card / floor-mission / go-stop-overlay 외 카드 제거
    Array.from(floorCardsEl.children).forEach((ch) => {
      if (!ch.classList.contains('deck-card')
       && !ch.classList.contains('floor-mission')
       && ch.id !== 'go-stop-overlay') {
        ch.remove();
      }
    });
    const deckEl = floorCardsEl.querySelector('.deck-card');

    // 바닥에서 사라진 카드는 슬롯 캐시에서 제거. 단 그 슬롯은 이번 STATE 한정으로
    // "최근 비워진" 표시 — 새 카드가 같은 슬롯을 차지하면 시각상 "방금 매칭된 카드 자리로
    // 새 카드가 들어가는" 어색함이 발생한다(사용자 보고).
    const curFloorIdSet = new Set(s.floor.map((c) => c.id));
    const justFreedSlots = new Set();
    for (const id of Array.from(floorSlotMap.keys())) {
      if (!curFloorIdSet.has(id)) {
        justFreedSlots.add(floorSlotMap.get(id));
        floorSlotMap.delete(id);
      }
    }

    // 같은 월 그룹화 (등장 순서 유지)
    const monthOrder = [];
    const monthGroups = new Map();
    for (const card of s.floor) {
      if (!monthGroups.has(card.month)) {
        monthGroups.set(card.month, []);
        monthOrder.push(card.month);
      }
      monthGroups.get(card.month).push(card);
    }

    // 각 월 그룹의 슬롯 인덱스 결정:
    //   1) 그룹 내 카드 중 이미 floorSlotMap에 등록된 카드가 있으면 그 슬롯을 그대로 사용
    //   2) 없으면 비어 있는 슬롯 중 가장 작은 인덱스를 할당
    //   3) 같은 월의 나머지 카드들도 같은 그룹 슬롯에 캐시 등록 (개별 ID 단위 캐시)
    /**
     * 현재 floorSlotMap에서 사용 중이지 않은 슬롯 중 가장 작은 인덱스를 반환.
     * @returns {number}
     */
    function nextFreeSlot() {
      const used = new Set(floorSlotMap.values());
      let i = 0;
      // justFreedSlots(이번 STATE에 비워진 슬롯)는 새 카드 할당 후보에서 제외.
      while (used.has(i) || justFreedSlots.has(i)) i++;
      return i;
    }

    monthOrder.forEach((month) => {
      const cards = monthGroups.get(month);
      // 그룹 슬롯 결정: 캐시에 등록된 카드 우선
      let groupSlotIdx = null;
      for (const c of cards) {
        if (floorSlotMap.has(c.id)) {
          groupSlotIdx = floorSlotMap.get(c.id);
          break;
        }
      }
      if (groupSlotIdx == null) {
        groupSlotIdx = nextFreeSlot();
      }
      // 그룹 내 모든 카드를 같은 슬롯으로 캐시 등록 (집중 표시용)
      for (const c of cards) {
        if (!floorSlotMap.has(c.id)) floorSlotMap.set(c.id, groupSlotIdx);
      }

      const isPpeok = !!s.ppeokFlags[month];
      const stackSize = cards.length;
      const slot = FLOOR_SLOTS[groupSlotIdx % FLOOR_SLOTS.length];
      const center = (stackSize - 1) / 2;

      cards.forEach((card, cardIdxInGroup) => {
        // fly 대상은 fly clone이 도착할 때까지 정지 상태(클론이 보임). appear 애니메이션은 끔.
        const anim = (newFloorIds.has(card.id) && !flyTargetIds.has(card.id)) ? 'appear' : null;
        const el = makeCardEl(card, { ppeok: isPpeok, anim });

        if (stackSize > 1) {
          // 같은 월 카드끼리 한 자리에 비스듬히 누적
          const k = cardIdxInGroup - center;       // -1, 0, 1 (3장) 또는 -0.5, 0.5 (2장)
          const dx = slot.dx + k * 14;             // 좌우 살짝 흩기
          const dy = slot.dy + Math.abs(k) * 3;    // 가운데 카드만 위, 양옆은 살짝 아래
          const rot = k * 8;                       // -8°, 0°, +8° (뻑)
          el.style.left = `calc(50% + ${dx}px)`;
          el.style.top  = `calc(50% + ${dy}px)`;
          el.style.transform = `translate(-50%, -50%) rotate(${rot}deg)`;
          el.style.zIndex = String(cardIdxInGroup + 5);
        } else {
          applyFloorSlot(el, groupSlotIdx);
        }

        floorCardsEl.insertBefore(el, deckEl);
      });
    });
  }

  /**
   * 점수판 (먹은 패) — captured-summary 4줄 + captured-group×4 fan 방식.
   * @param {'p1'|'p2'} pid
   * @param {object} s
   */
  function renderCaptured(pid, s, flyTargetIds = new Set()) {
    const zoneEl = (pid === me) ? myCapturedZoneEl : oppCapturedZoneEl;
    if (!zoneEl) return;
    const cards  = s.captured[pid] || [];
    const newIds = (pid === 'p1') ? newCapIds.p1 : newCapIds.p2;

    // 타입별 분류 (9월 술잔을 쌍피로 카운트 선택했으면 피 그룹으로 시각화)
    const ssangpi = !!(s.kkeutAsSsangpi && s.kkeutAsSsangpi[pid]);
    const groups = { gwang: [], kkeut: [], tti: [], pi: [] };
    for (const c of cards) {
      // 조커(type='joker')는 피 그룹에 합류시켜 captured에 표시한다.
      // (카드 자체는 makeCardEl이 joker-card 스타일로 렌더, 피 가치만 +2 — score.js와 동일)
      const effectiveType =
        (c.type === 'joker') ? 'pi'
        : (c.id === 'm09_kkeut' && ssangpi) ? 'pi'
        : c.type;
      if (groups[effectiveType]) groups[effectiveType].push(c);
    }

    const typeLabels = { gwang: '광', kkeut: '끗', tti: '띠', pi: '피' };
    const thresholds = { gwang: 3, kkeut: 5, tti: 5, pi: 10 };

    for (const type of ['gwang', 'kkeut', 'tti', 'pi']) {
      // 피는 쌍피를 2장으로 환산해서 카운트한다. (점수 계산과 동일 기준)
      // - 명시적 쌍피(subtype='ssangpi'): 11월/12월 카드
      // - 9월 술잔(m09_kkeut): kkeutAsSsangpi 선택 시 쌍피
      let count;
      if (type === 'pi') {
        count = groups.pi.reduce((sum, c) => {
          if (c.type === 'joker') return sum + 2;          // 조커 1장 = 피 2 (score.js: piCount += joker.length*2)
          if (c.subtype === 'ssangpi') return sum + 2;
          if (c.id === 'm09_kkeut' && ssangpi) return sum + 2;
          return sum + 1;
        }, 0);
      } else {
        count = groups[type].length;
      }
      const reached = count >= thresholds[type];

      // captured-summary 카운트 줄 갱신
      const sumRow = zoneEl.querySelector(`.captured-summary .cs-row[data-type="${type}"]`);
      if (sumRow) {
        sumRow.textContent = `${typeLabels[type]} ${count}`;
        sumRow.classList.toggle('empty', count === 0);
        sumRow.classList.toggle('scored', reached);
      }

      // card-stack fan 갱신
      const groupEl = zoneEl.querySelector(`.captured-group[data-type="${type}"]`);
      if (!groupEl) continue;
      const stack = groupEl.querySelector('.card-stack');
      stack.innerHTML = '';
      for (const c of groups[type]) {
        const isFlyTarget = flyTargetIds.has(c.id);
        // fly clone이 도착할 카드는 등장 애니메이션 없음 + 처음부터 hidden.
        // resolvePendingFlies의 setTimeout 정리부에서 visibility를 복원한다.
        const anim = (newIds.has(c.id) && !isFlyTarget) ? 'fly-in-captured' : null;
        const el = makeCardEl(c, { anim });
        if (isFlyTarget) el.style.visibility = 'hidden';
        stack.appendChild(el);
      }
      groupEl.classList.toggle('scored', reached);
    }
  }

  /**
   * 액션 패널 + 안내 텍스트 갱신.
   */
  function updateActionPanel(s) {
    goStopOverlay.classList.add('hidden');
    // 흔들기/폭탄 모달은 카드 클릭 시점에 띄우므로 phase 기반으로 강제 hide하지 않는다.
    // 다만 사통 모달은 renderState에서 토글한다.
    bombPanel.classList.add('hidden');

    if (s.phase === 'round_end') {
      actionDisplay.textContent = '라운드 종료 — 결과 모달 확인';
      return;
    }

    if (s.phase === 'awaiting_sangtong') {
      if (s.pendingSangtong && s.pendingSangtong.player === me) {
        actionDisplay.textContent = `사통! ${s.pendingSangtong.month}월 4장 — 선언/포기 선택`;
      } else {
        actionDisplay.textContent = '상대가 사통 결정 중...';
      }
      return;
    }

    const myTurn = s.turn === me;

    if (!myTurn) {
      actionDisplay.textContent = '상대 차례 — 기다리는 중';
      return;
    }

    switch (s.phase) {
      case 'awaiting_play':
        actionDisplay.textContent = '손에서 카드 1장을 클릭해라.';
        if (s.bombableMonths && s.bombableMonths.length > 0) {
          bombMonthsEl.textContent = s.bombableMonths.join(', ');
          bombPanel.classList.remove('hidden');
        }
        break;
      case 'awaiting_floor_choice':
        actionDisplay.textContent = '바닥에서 가져갈 카드를 선택해라 (강조된 카드).';
        break;
      case 'awaiting_go_stop':
        actionDisplay.textContent = '7점 이상 — 가운데 큰 버튼으로 고/스톱 결정';
        goStopOverlay.classList.remove('hidden');
        break;
      default:
        actionDisplay.textContent = '';
    }
  }

  // ── 입력 핸들러 ─────────────────────────────────────────────
  /**
   * 손패 카드 DOM을 클론해 body에 fixed로 띄우고, 다음 STATE에서
   * 그 카드가 어디로 갔는지 측정해 보간 이동시킨다.
   * @param {string} cardId
   */
  function startFlyFromHand(cardId) {
    const src = myCardsEl.querySelector(`[data-card-id="${cardId}"]`);
    if (src) {
      // 통상 경로(클릭 시점): 카드가 아직 손 DOM에 있다. 손 카드 그대로 클론한다.
      const rect = src.getBoundingClientRect();
      const clone = src.cloneNode(true);
      clone.classList.add('flying-card');
      clone.classList.remove('clickable');
      // 잔류 transform 제거: 바닥 슬롯/스택 카드를 클론하면 translate(-50%,-50%)(+rotate)가
      // 함께 복사돼 flyTo가 left/top을 잡아도 도착 좌표가 좌상단으로 어긋난다. (버그 A 근본 수정)
      // transition:'none' 보다 앞에 둬야 즉시 반영된다. 손 카드 통상 경로는 보통 transform이 없으나 방어용.
      clone.style.transform = '';
      clone.style.transition = 'none';
      clone.style.left   = `${rect.left}px`;
      clone.style.top    = `${rect.top}px`;
      clone.style.width  = `${rect.width}px`;
      clone.style.height = `${rect.height}px`;
      // 던지는 카드는 짝(가만 있는 카드) 위로 와야 한다. z-index 10.
      clone.style.zIndex = '10';
      flyOverlay.appendChild(clone);
      void clone.offsetHeight;
      src.style.visibility = 'hidden';
      recordFlyOrigin(cardId, 'hand', rect.left, rect.top);
      pendingFlies.push({ cardId, clone, startedAt: Date.now() });
      return;
    }
    // ── R5/R8 폴백 (2026-06-16): 카드가 이미 손에서 빠진 통합 STATE 경로 ──
    // 바닥 2장 선택(choice srcCard)이나 조커는 서버에서 이미 captured로 이동했고
    // s.yourHand에서도 제거돼 손 DOM에 없다. 이 경우 도착지(captured/floor) DOM을
    // 클론하되 시작 좌표를 손 영역 중앙으로 잡아 "손에서 날아가는" 연출을 유지한다.
    // origin='hand'를 그대로 기록해 E2E fly-출처 게이트(E-31/E-32)와 정합한다.
    const target =
      myCapturedZoneEl.querySelector(`[data-card-id="${cardId}"]`) ||
      floorCardsEl.querySelector(`[data-card-id="${cardId}"]`) ||
      oppCapturedZoneEl.querySelector(`[data-card-id="${cardId}"]`);
    if (!target) return;
    const handRect = myCardsEl.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const w = targetRect.width || 60;
    const h = targetRect.height || 85;
    const startLeft = handRect.left + (handRect.width / 2) - (w / 2);
    const startTop  = handRect.top  + (handRect.height / 2) - (h / 2);
    const clone = target.cloneNode(true);
    clone.classList.add('flying-card');
    clone.classList.remove('clickable');
    // 잔류 transform 제거(버그 A): 도착지가 floor 슬롯이면 translate(-50%,-50%)(+rotate)가
    // 클론에 복사돼 착지 좌표가 좌상단으로 어긋난다.
    clone.style.transform = '';
    clone.style.position = 'fixed';
    clone.style.margin = '0';
    clone.style.transition = 'none';
    clone.style.left   = `${startLeft}px`;
    clone.style.top    = `${startTop}px`;
    clone.style.width  = `${w}px`;
    clone.style.height = `${h}px`;
    clone.style.visibility = 'visible';
    clone.style.zIndex = '10';
    flyOverlay.appendChild(clone);
    void clone.offsetHeight;
    target.style.visibility = 'hidden';
    recordFlyOrigin(cardId, 'hand', startLeft, startTop);
    pendingFlies.push({ cardId, clone, startedAt: Date.now() });
  }

  /**
   * 테스트 계측용 fly 출처 기록기. 각 fly 등록 시점에 cardId/origin/시작 좌표를
   * window.__matgoFlies에 누적한다. (production 무해 — 배열 미초기화 시 no-op)
   * E2E에서 fly clone 시작 좌표가 손/덱/상대 captured 중 어디인지 검증하는 데 쓴다.
   * @param {string} cardId
   * @param {string} origin
   * @param {number} startLeft
   * @param {number} startTop
   */
  function recordFlyOrigin(cardId, origin, startLeft, startTop) {
    if (typeof window === 'undefined' || !window.__matgoFlies) return;
    window.__matgoFlies.push({ cardId, origin, startLeft, startTop, t: Date.now() });
  }

  /**
   * 상대 손에서 나온 카드의 fly 클론 생성. 시작 좌표를 상대 손 영역 중앙으로 설정.
   * @param {string} cardId
   * @param {DOMRect} oppHandRect 상대 손 영역 DOM의 viewport 좌표
   */
  function startFlyFromOppHand(cardId, oppHandRect) {
    const target =
      floorCardsEl.querySelector(`[data-card-id="${cardId}"]`) ||
      myCapturedZoneEl.querySelector(`[data-card-id="${cardId}"]`) ||
      oppCapturedZoneEl.querySelector(`[data-card-id="${cardId}"]`);
    if (!target) return;
    // 카드 크기는 도착지 기준 — 상대 손 카드 크기와 비슷. 시작은 손 중앙.
    const targetRect = target.getBoundingClientRect();
    const w = targetRect.width || 60;
    const h = targetRect.height || 85;
    const startLeft = oppHandRect.left + (oppHandRect.width / 2) - (w / 2);
    const startTop  = oppHandRect.top  + (oppHandRect.height / 2) - (h / 2);
    const clone = target.cloneNode(true);
    clone.classList.add('flying-card');
    clone.classList.remove('clickable');
    // 잔류 transform 제거(버그 A): 도착지 floor 슬롯의 translate(-50%,-50%)(+rotate) 복사로 인한 착지 어긋남 방지.
    clone.style.transform = '';
    clone.style.position = 'fixed';
    clone.style.margin = '0';
    clone.style.transition = 'none';
    clone.style.left   = `${startLeft}px`;
    clone.style.top    = `${startTop}px`;
    clone.style.width  = `${w}px`;
    clone.style.height = `${h}px`;
    clone.style.visibility = 'visible';
    clone.style.zIndex = '10';
    flyOverlay.appendChild(clone);
    void clone.offsetHeight;
    target.style.visibility = 'hidden';
    recordFlyOrigin(cardId, 'opp-hand', startLeft, startTop);
    pendingFlies.push({ cardId, clone, startedAt: Date.now(), origin: 'opp-hand' });
  }

  /**
   * 상대 먹은 패 영역에서 강탈된 피 카드의 fly 클론 생성.
   * 시작 좌표를 상대 captured zone 중앙으로 설정 — stoleFromOpp > 0 케이스 전용.
   * @param {string} cardId
   * @param {DOMRect} oppCapRect 상대 captured zone DOM의 viewport 좌표
   */
  function startFlyFromOppCaptured(cardId, oppCapRect) {
    const target =
      myCapturedZoneEl.querySelector(`[data-card-id="${cardId}"]`) ||
      floorCardsEl.querySelector(`[data-card-id="${cardId}"]`);
    if (!target) return;
    const targetRect = target.getBoundingClientRect();
    const w = targetRect.width || 60;
    const h = targetRect.height || 85;
    const startLeft = oppCapRect.left + (oppCapRect.width / 2) - (w / 2);
    const startTop  = oppCapRect.top  + (oppCapRect.height / 2) - (h / 2);
    const clone = target.cloneNode(true);
    clone.classList.add('flying-card');
    clone.classList.remove('clickable');
    // 잔류 transform 제거(버그 A): 도착지 floor 슬롯의 translate(-50%,-50%)(+rotate) 복사로 인한 착지 어긋남 방지.
    clone.style.transform = '';
    clone.style.position = 'fixed';
    clone.style.margin = '0';
    clone.style.transition = 'none';
    clone.style.left   = `${startLeft}px`;
    clone.style.top    = `${startTop}px`;
    clone.style.width  = `${w}px`;
    clone.style.height = `${h}px`;
    clone.style.visibility = 'visible';
    clone.style.zIndex = '10';
    flyOverlay.appendChild(clone);
    void clone.offsetHeight;
    target.style.visibility = 'hidden';
    recordFlyOrigin(cardId, 'opp-captured', startLeft, startTop);
    pendingFlies.push({ cardId, clone, startedAt: Date.now(), origin: 'opp-captured' });
  }

  /**
   * 덱에서 뒤집힌 카드의 fly 클론 생성. 도착지(floor 또는 captured) DOM을 클론해
   * 시작 좌표를 deckRect로 설정 → resolvePendingFlies가 도착지로 보간 이동.
   * @param {string} cardId
   * @param {DOMRect} deckRect 덱 카드의 viewport 좌표
   */
  function startFlyFromDeck(cardId, deckRect) {
    const target =
      floorCardsEl.querySelector(`[data-card-id="${cardId}"]`) ||
      myCapturedZoneEl.querySelector(`[data-card-id="${cardId}"]`) ||
      oppCapturedZoneEl.querySelector(`[data-card-id="${cardId}"]`);
    if (!target) return;
    const clone = target.cloneNode(true);
    clone.classList.add('flying-card');
    clone.classList.remove('clickable');
    // 잔류 transform 제거(버그 A): 도착지(floor 슬롯) translate(-50%,-50%)(+rotate) 복사로 인한 착지 어긋남 방지.
    // DECK_FLIP 단계에서 rotateY(-180deg)를 별도로 다시 설정하므로 무충돌(여기서 1회 리셋만).
    clone.style.transform = '';
    clone.style.position = 'fixed';
    clone.style.margin = '0';
    clone.style.transition = 'none';
    clone.style.left   = `${deckRect.left}px`;
    clone.style.top    = `${deckRect.top}px`;
    clone.style.width  = `${deckRect.width}px`;
    clone.style.height = `${deckRect.height}px`;
    // DECK_FLIP state 진입 시점에 보이도록 — HAND_THROW/LAND 동안에는 hidden.
    // (그렇지 않으면 손 fly 진행 중에 deck 위치에 뒷면 카드가 미리 보여 "동시에
    //  더미 뒤집기 시작"하는 인상을 준다.)
    clone.style.visibility = 'hidden';
    clone.style.zIndex = '10';
    flyOverlay.appendChild(clone);
    void clone.offsetHeight;
    target.style.visibility = 'hidden';
    recordFlyOrigin(cardId, 'deck', deckRect.left, deckRect.top);
    pendingFlies.push({ cardId, clone, startedAt: Date.now(), origin: 'deck' });
  }

  /**
   * 카드 DOM을 fixed 클론으로 띄워 특정 위치에 놓는다(공통 헬퍼).
   * @param {HTMLElement} src 원본 카드 DOM (visibility hidden 처리됨)
   * @param {DOMRect}     rect 띄울 위치(viewport 기준)
   * @returns {HTMLElement} 띄워진 클론
   */
  function spawnCardClone(src, rect) {
    const clone = src.cloneNode(true);
    clone.classList.add('flying-card');
    clone.classList.remove('clickable');
    // 잔류 transform 제거(버그 A): floor 슬롯 카드를 클론하면 translate(-50%,-50%)(+rotate)가
    // 복사돼 pair 클론의 출발/도착 좌표가 어긋난다.
    clone.style.transform = '';
    clone.style.position = 'fixed';
    clone.style.margin = '0';
    clone.style.transition = 'none';
    clone.style.left   = `${rect.left}px`;
    clone.style.top    = `${rect.top}px`;
    clone.style.width  = `${rect.width}px`;
    clone.style.height = `${rect.height}px`;
    flyOverlay.appendChild(clone);
    src.style.visibility = 'hidden';
    // 초기 위치 강제 반영
    void clone.offsetHeight;
    return clone;
  }

  /**
   * fly 진행 동안 큐에 쌓인 STATE/ROUND_END 메시지를 비운다.
   *
   * 서버가 단계별 STATE를 STEP_DELAY 간격으로 송신하므로 순서대로 적용해야 한다.
   * (마지막만 적용하면 중간 단계 시각화가 사라져 사용자 의도에 어긋난다.)
   *
   * 한 STATE를 renderState로 적용하면 그 안에서 fly가 일어날 수 있다
   * (resolvePendingFlies에서 isAnimating=true). 그 경우 markFlyDone에서 다시
   * flushStateQueue가 호출되므로 다음 STATE는 그때 처리된다.
   * fly가 일어나지 않는 STATE면 isAnimating 그대로 false라 같은 콜에서
   * 다음 큐를 이어 처리한다.
   */
  function flushStateQueue() {
    while (stateQueue.length > 0 && !isAnimating) {
      const next = stateQueue.shift();
      if (next.type === 'STATE') {
        renderState(next);
      } else if (next.type === 'ROUND_END') {
        showRoundResult(next.result);
      }
    }
  }

  /**
   * renderState 직후 호출 — 3단계 fly 시퀀스.
   *
   * STAGE 1: 손 카드 + 상대 손 카드 fly → 만남 지점(짝 prev 위치) 또는 cur floor 위치
   *   - 매칭 시: 짝 클론을 prev 위치에 띄워둠 (가만히 머묾)
   *   - 비매칭/뻑: 손 카드가 floor의 cur 위치로 정착
   *   ── 멈춤 200ms ──
   * STAGE 2: 덱 카드 fly → 만남 지점 또는 cur floor 위치
   *   ── 멈춤 200ms ──
   * STAGE 3: cur captured에 있는 카드들 모두 captured DOM 위치로 이동 (매칭 시만)
   *
   * @param {object} s 현재 STATE 스냅샷
   * @param {string[]} removedFloorIds 이번 STATE에서 floor에서 사라진 카드 ID
   * @param {Map<string, DOMRect>} prevFloorRects 직전 STATE의 floor 카드 viewport 좌표
   */
  function resolvePendingFlies(s, removedFloorIds = [], prevFloorRects = new Map()) {
    // 짝 카드 클론 생성 — cur captured에 있는 removedFloorIds (매칭으로 captured 간 짝)
    const pairEntries = [];
    for (const id of removedFloorIds) {
      const inMyCap  = (s.captured?.[me] || []).find((c) => c.id === id);
      const oppKey   = me === 'p1' ? 'p2' : 'p1';
      const inOppCap = (s.captured?.[oppKey] || []).find((c) => c.id === id);
      if (!inMyCap && !inOppCap) continue;
      const target = (inMyCap ? myCapturedZoneEl : oppCapturedZoneEl)
        .querySelector(`[data-card-id="${id}"]`);
      const startRect = prevFloorRects.get(id);
      if (!target || !startRect) continue;
      const clone = spawnCardClone(target, startRect);
      clone.style.visibility = 'visible';
      // 짝(가만 있는 카드)은 던지는 카드보다 아래. 부딪힐 때 손/덱이 위로 와야 자연스럽다.
      clone.style.zIndex = '1';
      pairEntries.push({ cardId: id, clone, finalEl: target, origin: 'pair' });
    }

    if (pendingFlies.length === 0 && pairEntries.length === 0) return;
    isAnimating = true;

    // 카드 ID에서 month 추출 (m{NN}_... 패턴).
    function getCardMonth(cardId) {
      const m = /^m(\d{2})_/.exec(cardId);
      return m ? parseInt(m[1], 10) : null;
    }

    // 짝 entry들을 month별로 인덱싱 — 손/덱 fly가 자기 month의 짝으로 가도록.
    const pairsByMonth = new Map();
    for (const pe of pairEntries) {
      const month = getCardMonth(pe.cardId);
      pe.month = month;
      if (!pairsByMonth.has(month)) pairsByMonth.set(month, []);
      pairsByMonth.get(month).push(pe);
    }

    // cardId와 같은 month의 짝의 prev floor 위치 반환 (만남 지점). 없으면 null.
    function findMeetRectFor(cardId) {
      const month = getCardMonth(cardId);
      if (month == null) return null;
      const pairs = pairsByMonth.get(month);
      if (!pairs || pairs.length === 0) return null;
      return prevFloorRects.get(pairs[0].cardId);
    }

    function locateCard(cardId) {
      let el = floorCardsEl.querySelector(`[data-card-id="${cardId}"]`);
      if (el) return { zone: 'floor', el };
      el = myCapturedZoneEl.querySelector(`[data-card-id="${cardId}"]`);
      if (el) return { zone: 'cap', el };
      el = oppCapturedZoneEl.querySelector(`[data-card-id="${cardId}"]`);
      if (el) return { zone: 'cap', el };
      return null;
    }

    const entries = [];
    const fadeEntries = [];
    for (const fly of pendingFlies) {
      const loc = locateCard(fly.cardId);
      if (!loc) { fadeEntries.push(fly); continue; }
      const finalRect = loc.el.getBoundingClientRect();
      const isCap = loc.zone === 'cap';
      // midRect = 같은 month 짝의 prev 위치(cap 도착이면). 없으면 finalRect.
      const meetForThis = findMeetRectFor(fly.cardId);
      const midRect = (isCap && meetForThis) ? meetForThis : finalRect;
      entries.push({
        clone: fly.clone, cardId: fly.cardId, origin: fly.origin || 'hand',
        midRect, finalEl: loc.el, finalRect, isCap,
      });
    }
    for (const pe of pairEntries) {
      const finalRect = pe.finalEl.getBoundingClientRect();
      // 짝은 자기 prev 위치에 머물다가 captured로 — midRect = prev 위치
      const midRect = prevFloorRects.get(pe.cardId) || finalRect;
      entries.push({
        clone: pe.clone, cardId: pe.cardId, origin: 'pair',
        midRect, finalEl: pe.finalEl, finalRect, isCap: true,
      });
    }

    // 도착지 DOM visibility hidden — 클론이 도착할 때까지 가림
    for (const e of entries) {
      if (e.finalEl) e.finalEl.style.visibility = 'hidden';
    }

    // ─────────── 턴 fly state machine ───────────
    // 각 state는 "한 턴 안에서 일어나는 단계적 사건"을 명시한다.
    //   HAND_THROW : A가 던진다 (손→짝 옆 or 빈 공간)
    //   HAND_LAND  : 손 카드 도착, 매칭 시 짝 강조
    //   DECK_FLIP  : 더미 뒷면→앞면 회전
    //   DECK_THROW : 뒤집은 덱 카드 던지기 (덱→매칭 위치 or 빈 공간)
    //   DECK_LAND  : 덱 카드 도착, 매칭 강조
    //   RESOLVE    : 매칭 카드 captured로 (없으면 skip)
    //   CLEANUP    : 클론 제거 + 도착지 복원
    const T = {
      HAND_THROW: 280, HAND_LAND: 240,  // HAND_LAND 늘려 손이 바닥에 붙은 후 잠시 머묾
      DECK_FLIP:  240, DECK_THROW: 260, DECK_LAND: 180,
      RESOLVE:    320, CLEANUP:    220,
    };
    const hasCapMove = entries.some((e) => e.isCap);
    const deckEntries = entries.filter((e) => e.origin === 'deck');
    const handLikeEntries = entries.filter((e) => e.origin === 'hand' || e.origin === 'opp-hand' || e.origin === 'opp-captured');
    const pairOnlyEntries = entries.filter((e) => e.origin === 'pair');

    /**
     * clone을 rect 위치로 이동시킨다.
     * B2 수정: left/top만 transition — width/height를 동시에 transition하면 손패와
     * 바닥 슬롯의 크기 차이(특히 우측 상단)가 cubic-bezier와 맞물려 이동 경로를
     * 비선형으로 휘게 만든다. 크기는 transition 없이 즉시 목표값으로 적용한다.
     * @param {HTMLElement} clone
     * @param {DOMRect}     rect
     * @param {number}      durMs
     */
    function flyTo(clone, rect, durMs) {
      clone.style.transition = `left ${durMs / 1000}s cubic-bezier(0.25, 0.8, 0.35, 1), `
                             + `top ${durMs / 1000}s cubic-bezier(0.25, 0.8, 0.35, 1)`;
      clone.style.left   = `${rect.left}px`;
      clone.style.top    = `${rect.top}px`;
      // width/height는 transition 없이 즉시 목표 크기로 — 경로(left/top)에 영향 없음.
      clone.style.width  = `${rect.width}px`;
      clone.style.height = `${rect.height}px`;
    }
    function flashMeet(clone) {
      const orig = clone.style.boxShadow;
      clone.style.boxShadow = '0 0 18px 5px rgba(255, 209, 102, 0.85), 0 0 32px 10px rgba(255, 209, 102, 0.45)';
      setTimeout(() => { clone.style.boxShadow = orig; }, 220);
    }

    // fadeEntries: 도착지 못 찾은 경우 — opacity 0 후 제거
    for (const f of fadeEntries) {
      f.clone.style.transition = 'opacity 0.3s';
      f.clone.style.opacity = '0';
      setTimeout(() => f.clone.remove(), 350);
    }

    // 덱 클론 뒷면 표시 준비 — DECK_FLIP에서 앞면으로 회전
    for (const e of deckEntries) {
      e.clone.style.transformStyle = 'preserve-3d';
      e.clone.style.perspective = '600px';
      e.clone.style.backfaceVisibility = 'hidden';
      e.clone.style.transform = 'rotateY(-180deg)';
      const back = document.createElement('div');
      back.style.cssText = 'position:absolute; inset:0; background: repeating-linear-gradient(45deg, #5a3a1a 0 6px, #4a2a0a 6px 12px); border-radius:6px; transform: rotateY(180deg); backface-visibility:hidden; border: 2px solid var(--gold);';
      e.clone.appendChild(back);
      e.flipBack = back;
    }

    let stateTimer = null;
    function transition(name) {
      console.log(`[turn-fly] state=${name} (hand=${handLikeEntries.length} deck=${deckEntries.length} pair=${pairOnlyEntries.length} cap=${hasCapMove})`);
      if (stateTimer) { clearTimeout(stateTimer); stateTimer = null; }
      switch (name) {
        case 'HAND_THROW': {
          // A가 던진다 — 손/상대손 → midRect (짝 prev 위치 or cur floor 위치).
          requestAnimationFrame(() => requestAnimationFrame(() => {
            for (const e of handLikeEntries) flyTo(e.clone, e.midRect, T.HAND_THROW);
          }));
          stateTimer = setTimeout(() => transition('HAND_LAND'), T.HAND_THROW);
          break;
        }
        case 'HAND_LAND': {
          // 손 카드 도착 — 손 fly가 짝을 만난 케이스면 해당 짝 강조.
          // 손/덱이 다른 month의 짝과 매칭될 수 있으므로 entry별로 검사.
          for (const e of handLikeEntries) {
            if (!e.isCap) continue;
            const month = getCardMonth(e.cardId);
            const pairs = pairsByMonth.get(month) || [];
            for (const pe of pairs) flashMeet(pe.clone);
          }
          stateTimer = setTimeout(() => transition('DECK_FLIP'), T.HAND_LAND);
          break;
        }
        case 'DECK_FLIP': {
          // 더미 뒷면→앞면 회전 (덱 클론을 이제 visible로 + rotateY 전환).
          for (const e of deckEntries) {
            e.clone.style.visibility = 'visible';
            e.clone.style.transition = `transform ${T.DECK_FLIP / 1000}s ease-in-out`;
            e.clone.style.transform = 'rotateY(0deg)';
          }
          stateTimer = setTimeout(() => transition('DECK_THROW'), T.DECK_FLIP);
          break;
        }
        case 'DECK_THROW': {
          // 뒤집은 덱 카드 던지기 — 덱 → midRect.
          // B2 수정: DECK_FLIP의 rotateY transform 전환 직후 layout이 확정되기 전에
          // 바로 flyTo를 걸면 snap(순간이동)이 발생한다. transform 초기화(transition none)
          // 후 더블 rAF로 layout을 커밋한 뒤 flyTo를 시작해 직선 이동을 보장한다.
          for (const e of deckEntries) {
            if (e.flipBack) { e.flipBack.remove(); e.flipBack = null; }
            e.clone.style.transition = 'none';
            e.clone.style.transform = '';
          }
          requestAnimationFrame(() => requestAnimationFrame(() => {
            for (const e of deckEntries) {
              flyTo(e.clone, e.midRect, T.DECK_THROW);
            }
          }));
          stateTimer = setTimeout(() => transition('DECK_LAND'), T.DECK_THROW);
          break;
        }
        case 'DECK_LAND': {
          // 덱 도착 — 덱 fly가 짝을 만난 케이스면 해당 짝과 덱 강조.
          for (const e of deckEntries) {
            if (!e.isCap) continue;
            flashMeet(e.clone);
            const month = getCardMonth(e.cardId);
            const pairs = pairsByMonth.get(month) || [];
            for (const pe of pairs) flashMeet(pe.clone);
          }
          // 뻑 토스트 지연 flush — 덱이 바닥에 쌓인 직후 표시.
          if (pendingPpeokToast) {
            maybeShowActionToast(pendingPpeokToast);
            pendingPpeokToast = null;
          }
          stateTimer = setTimeout(
            () => transition(hasCapMove ? 'RESOLVE' : 'CLEANUP'),
            T.DECK_LAND,
          );
          break;
        }
        case 'RESOLVE': {
          // 매칭 카드 captured로 이동.
          for (const e of entries) if (e.isCap) flyTo(e.clone, e.finalRect, T.RESOLVE);
          stateTimer = setTimeout(() => transition('CLEANUP'), T.RESOLVE);
          break;
        }
        case 'CLEANUP': {
          // 정리.
          for (const e of entries) {
            if (e.finalEl) e.finalEl.style.visibility = '';
            e.clone.remove();
          }
          // 안전망: DECK_LAND를 거치지 못한 채 CLEANUP에 진입한 경우(덱 empty 등)
          // pendingPpeokToast가 남아 있으면 여기서 flush.
          if (pendingPpeokToast) {
            maybeShowActionToast(pendingPpeokToast);
            pendingPpeokToast = null;
          }
          pendingFlies = [];
          isAnimating = false;
          flushStateQueue();
          break;
        }
      }
    }

    transition('HAND_THROW');
  }

  function sendPlay(cardId) {
    if (!ws || ws.readyState !== 1) return;
    // 한 번 더 검증: STATE 큐잉 중 turn이 상대로 바뀌었거나 phase가 awaiting_play가
    // 아니면 옛 클릭 핸들러 무시. 안 그러면 서버가 stepInProgress 에러로 거절하고
    // fly clone이 떠 있는 채로 카드가 사라진 듯 보인다.
    if (!lastState || lastState.turn !== me || lastState.phase !== 'awaiting_play') {
      return;
    }
    // stepInProgress 가드 — 직전 액션 fly 진행 중이면 중복 입력 차단
    if (isAnimating) return;

    const card = (lastState.yourHand || []).find((c) => c.id === cardId);
    if (!card) {
      // 카드를 찾을 수 없으면 안전하게 그대로 전송 (서버가 검증)
      startFlyFromHand(cardId);
      ws.send(JSON.stringify({ type: 'PLAY_CARD', cardId }));
      return;
    }

    // ── 5건 룰 보강 (2026-05-31): 흔들기 모달 (카드 클릭 시점) ──
    // 그 월 첫 카드를 낼 때만 모달 표시. 같은 라운드에 두 번 묻지 않는다.
    // 폭탄(같은 월 3장 + 바닥 1장) 조건은 아래 폭탄 분기에서 별도 처리하므로 여기서 제외.
    if (!shakeAskedThisRound && !lastState.shaking?.[me]) {
      const sameMonthInHand = (lastState.yourHand || []).filter((c) => c.month === card.month).length;
      const bombable = !!(lastState.bombableMonths && lastState.bombableMonths.includes(card.month));
      // 흔들기 조건: 같은 월 3장 보유 + 폭탄 조건 미충족 (폭탄 가능이면 폭탄 모달 우선)
      if (sameMonthInHand === 3 && !bombable) {
        showShakeConfirmModal(card.month, cardId);
        return;
      }
    }

    // ── 폭탄 확인 모달 (window.confirm → 전용 모달로 교체, 2026-05-31) ──
    if (!bombCheckSkipOnce
        && lastState.bombableMonths
        && lastState.bombableMonths.includes(card.month)) {
      showBombConfirmModal(card.month, cardId);
      return;
    }
    // 폭탄 모달 취소 후 같은 카드 재클릭은 일반 1장 내기로 진행. 일회용 가드.
    bombCheckSkipOnce = false;

    startFlyFromHand(cardId);
    ws.send(JSON.stringify({ type: 'PLAY_CARD', cardId }));
  }

  /**
   * 보너스 뒤집기 요청. 자기 턴 + awaiting_play + bombDeckCredit > 0일 때만 가능.
   * 더미 카드 클릭으로 발동.
   */
  function sendBonusFlip() {
    if (!ws || ws.readyState !== 1) return;
    if (!lastState || lastState.turn !== me || lastState.phase !== 'awaiting_play') return;
    if ((lastState.bombDeckCredit?.[me] || 0) <= 0) return;
    if (isAnimating) return;
    ws.send(JSON.stringify({ type: 'BONUS_FLIP' }));
  }

  /**
   * 흔들기 확인 모달을 표시한다. 그 월 첫 카드 클릭 시점에 호출.
   * @param {number} month - 흔들 월
   * @param {string} cardId - 모달 결과 후 실제 낼 손패 카드 ID
   */
  function showShakeConfirmModal(month, cardId) {
    if (!shakeModal) return;
    if (shakeMonthText) shakeMonthText.textContent = `${month}월`;
    pendingShakeCardId = cardId;
    shakeModal.classList.remove('hidden');
  }

  /**
   * 폭탄 확인 모달을 표시한다. 폭탄 가능 월 카드 클릭 시 호출.
   * @param {number} month
   * @param {string} fallbackCardId - 취소 시 한 장만 내기로 폴백할 카드 ID
   */
  function showBombConfirmModal(month, fallbackCardId) {
    if (!bombConfirmModalEl) return;
    if (bombConfirmMonthTextEl) bombConfirmMonthTextEl.textContent = `${month}월`;
    pendingBombFallbackCardId = fallbackCardId;
    bombConfirmModalEl.classList.remove('hidden');
  }
  function sendChooseFloor(cardId) {
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ type: 'CHOOSE_FLOOR', cardId }));
  }
  function sendGoStop(decision) {
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ type: 'GO_STOP', decision }));
  }
  function sendShake(decision, month) {
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ type: 'SHAKE', decision, month }));
  }
  function sendSangtong(choice) {
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ type: 'SELECT_SANGTONG', choice }));
  }
  function sendBomb(month) {
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ type: 'BOMB', month }));
  }
  function sendNewRound() {
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ type: 'NEW_ROUND' }));
  }
  function sendNewGame() {
    if (!ws || ws.readyState !== 1) return;
    if (!confirm('새 게임을 시작하면 잔고가 리셋된다. 진행할까?')) return;
    ws.send(JSON.stringify({ type: 'NEW_GAME' }));
  }
  function sendPerPoint(v) {
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ type: 'SET_PER_POINT', value: v }));
  }

  btnGo.addEventListener('click', () => sendGoStop('go'));
  btnStop.addEventListener('click', () => sendGoStop('stop'));
  // ── 흔들기 모달 (카드 클릭 시점, 2026-05-31) ──
  // 사용자가 모달에서 결정한 뒤 SHAKE → PLAY_CARD 순서로 전송.
  // shakeAskedThisRound 플래그로 같은 라운드 재표시 차단.
  btnShake.addEventListener('click', () => {
    shakeModal.classList.add('hidden');
    shakeAskedThisRound = true;
    const cardId = pendingShakeCardId;
    pendingShakeCardId = null;
    // 흔들 월은 클릭한 카드 월
    const card = cardId ? (lastState?.yourHand || []).find((c) => c.id === cardId) : null;
    sendShake('shake', card ? card.month : null);
    if (cardId) {
      startFlyFromHand(cardId);
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'PLAY_CARD', cardId }));
      }
    }
  });
  btnShakeNo.addEventListener('click', () => {
    shakeModal.classList.add('hidden');
    shakeAskedThisRound = true;
    const cardId = pendingShakeCardId;
    pendingShakeCardId = null;
    const card = cardId ? (lastState?.yourHand || []).find((c) => c.id === cardId) : null;
    sendShake('normal', card ? card.month : null);
    if (cardId) {
      startFlyFromHand(cardId);
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'PLAY_CARD', cardId }));
      }
    }
  });
  // ── 폭탄 확인 모달 (카드 클릭 시점, 2026-05-31) ──
  if (btnBombConfirm) {
    btnBombConfirm.addEventListener('click', () => {
      if (bombConfirmModalEl) bombConfirmModalEl.classList.add('hidden');
      const cardId = pendingBombFallbackCardId;
      pendingBombFallbackCardId = null;
      const card = cardId ? (lastState?.yourHand || []).find((c) => c.id === cardId) : null;
      if (card) {
        // 폭탄 손 3장도 손에서 출발 — startFlyFromHand 등록.
        // (미등록 시 BOMB STATE에서 손 3장이 newCardIds→drewIds로 분류되어
        //  startFlyFromDeck로 더미에서 날아오는 버그가 발생한다.)
        const bombCards = (lastState?.yourHand || []).filter((c) => c.month === card.month);
        for (const bc of bombCards) startFlyFromHand(bc.id);
        sendBomb(card.month);
      }
    });
  }
  if (btnBombCancel) {
    btnBombCancel.addEventListener('click', () => {
      if (bombConfirmModalEl) bombConfirmModalEl.classList.add('hidden');
      const cardId = pendingBombFallbackCardId;
      pendingBombFallbackCardId = null;
      // 한 장만 내기로 폴백 — 다음 sendPlay 호출 시 폭탄 모달 재진입 차단
      if (cardId) {
        bombCheckSkipOnce = true;
        sendPlay(cardId);
      }
    });
  }
  // 기존 하단 bomb-panel 버튼 (폴백 — 카드 클릭 우회 시 직접 폭탄)
  btnBomb.addEventListener('click', () => {
    if (!lastState || !lastState.bombableMonths || lastState.bombableMonths.length === 0) return;
    const month = lastState.bombableMonths[0]; // 첫 번째 자동 선택
    // 폭탄 손 3장도 손에서 출발 — startFlyFromHand 등록 (btnBombConfirm과 동일).
    const bombCards = (lastState.yourHand || []).filter((c) => c.month === month);
    for (const bc of bombCards) startFlyFromHand(bc.id);
    sendBomb(month);
  });
  // ── 사통 모달 핸들러 (2026-05-31) ──
  if (btnSangtongDeclare) {
    btnSangtongDeclare.addEventListener('click', () => {
      if (sangtongModalEl) sangtongModalEl.classList.add('hidden');
      sendSangtong('declare');
    });
  }
  if (btnSangtongContinue) {
    btnSangtongContinue.addEventListener('click', () => {
      if (sangtongModalEl) sangtongModalEl.classList.add('hidden');
      sendSangtong('continue');
    });
  }
  btnNewRound.addEventListener('click', sendNewRound);
  // 더미 카드 클릭 시 보너스 뒤집기 요청 (renderState에서 bonus-available 클래스 토글)
  floorCardsEl.addEventListener('click', (ev) => {
    const dc = ev.target.closest('.deck-card');
    if (!dc) return;
    if (!dc.classList.contains('bonus-available')) return;
    sendBonusFlip();
  });
  btnNewRoundMod.addEventListener('click', () => {
    const mode = btnNewRoundMod.dataset.mode || 'new-round';
    hideRoundModal();
    if (mode === 'new-game') sendNewGame();
    else sendNewRound();
  });

  // "← 다른 종목" 버튼 핸들러 — 로비로 복귀
  const returnLobbyBtn = document.getElementById('btn-return-lobby');
  if (returnLobbyBtn) {
    returnLobbyBtn.addEventListener('click', () => {
      fetch('/lobby/return', { method: 'POST' }).catch(() => {});
      location.href = '/';
    });
  }

  // ── 상시 뒤로가기 버튼 (게임 중 로비 복귀) ──
  const backToLobbyBtn = document.getElementById('btn-back-to-lobby');
  if (backToLobbyBtn) {
    backToLobbyBtn.addEventListener('click', () => {
      if (!confirm('게임을 중단하고 게임 선택 화면으로 돌아가시겠어요? 상대방도 함께 로비로 이동합니다.')) return;
      fetch('/lobby/return', { method: 'POST' }).catch(() => {});
      location.href = '/';
    });
  }

  // 9월 술잔 끗/쌍피 선택 핸들러
  function sendKkeutChoice(choice) {
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ type: 'SELECT_KKEUT_TYPE', choice }));
  }
  // 클릭 즉시 모달 hide + 송신. STATE 응답이 큐잉(fly 진행 중)되어 지연되면 모달이
  // 계속 visible 상태로 남아 중복 클릭이 발생하고, 서버는 첫 처리 후 phase가 바뀌어
  // 두 번째 메시지에 "지금은 선택할 수 없다" 에러를 반환하는 케이스를 방지한다.
  btnKkeutKkeut.addEventListener('click', () => {
    kkeutModalEl.classList.add('hidden');
    sendKkeutChoice('kkeut');
  });
  btnKkeutSsangpi.addEventListener('click', () => {
    kkeutModalEl.classList.add('hidden');
    sendKkeutChoice('ssangpi');
  });
  btnNewGame.addEventListener('click', sendNewGame);

  perPointEl.addEventListener('change', () => {
    const v = parseInt(perPointEl.value, 10);
    if (Number.isInteger(v) && v >= 1) sendPerPoint(v);
  });

  // ── 라운드 결과 모달 ────────────────────────────────────────
  /**
   * 라운드 결과를 모달로 표시.
   * @param {object} result
   */
  function showRoundResult(result) {
    if (!result) return;
    // 게임 종료(잔고 음수 도달) — 라운드 결과 모달을 게임 종료 모달로 전환.
    const isGameOver = !!result.gameOver;
    if (isGameOver) {
      const won = result.gameWinner === me;
      roundModalTitle.textContent = won ? '게임 승리!' : '게임 패배';
    } else if (result.winner === null) {
      roundModalTitle.textContent = '무승부';
    } else {
      const won = result.winner === me;
      roundModalTitle.textContent = won ? '라운드 승리!' : '라운드 패배';
    }
    const winnerName = result.winner === me ? '나' : '상대';
    const wb = result.winnerBreakdown;
    let html = '';
    if (result.winner !== null && wb) {
      html += `<div class="row"><span>승자</span><span>${winnerName}</span></div>`;
      html += `<div class="row"><span>광 / 띠 / 끗 / 피</span><span>${wb.gwang} / ${wb.tti} / ${wb.kkeut} / ${wb.piCount}</span></div>`;
      html += `<div class="row"><span>기본 점수</span><span>${wb.score}점</span></div>`;
      html += `<div class="row"><span>고 횟수</span><span>${result.goCount[result.winner]}고</span></div>`;
      html += `<div class="row"><span>최종 점수</span><span>${result.finalScore}점 (×${result.multiplier})</span></div>`;
      html += `<div class="row"><span>이동 금액</span><span>${formatMoney(result.money)}원</span></div>`;
    }
    if (result.reasons && result.reasons.length > 0) {
      html += `<div class="reasons">${result.reasons.join(' · ')}</div>`;
    } else if (result.winner === null) {
      html += `<div class="reasons">${result.reasons?.join(' · ') || '무승부'}</div>`;
    }
    // 게임 종료 시 최종 잔고 표시 + "새 게임" 버튼 모드로 전환.
    if (isGameOver) {
      const myFinal = result.moneyAfter?.[me] ?? 0;
      const oppFinal = result.moneyAfter?.[me === 'p1' ? 'p2' : 'p1'] ?? 0;
      html += `<div class="row"><span>내 최종 잔고</span><span>${formatMoney(myFinal)}원</span></div>`;
      html += `<div class="row"><span>상대 최종 잔고</span><span>${formatMoney(oppFinal)}원</span></div>`;
      html += `<div class="reasons">상대 잔고가 마이너스 — 게임 종료. 새 게임으로 시작해라.</div>`;
      btnNewRoundMod.textContent = '새 게임';
      btnNewRoundMod.dataset.mode = 'new-game';
    } else {
      btnNewRoundMod.textContent = '새 라운드';
      btnNewRoundMod.dataset.mode = 'new-round';
    }
    roundModalBody.innerHTML = html;
    roundModalEl.classList.remove('hidden');
  }

  function hideRoundModal() {
    roundModalEl.classList.add('hidden');
  }

  // ── 유틸 ────────────────────────────────────────────────────
  /**
   * 금액 포맷팅 (천단위 콤마).
   */
  function formatMoney(n) {
    if (typeof n !== 'number') return '-';
    return n.toLocaleString('ko-KR');
  }

  /**
   * 토스트 알림 (3초).
   */
  function showToast(text) {
    toastEl.textContent = text;
    toastEl.classList.remove('hidden');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.add('hidden');
    }, 3000);
  }

  // ── 시작 ────────────────────────────────────────────────────
  connect();
})();
