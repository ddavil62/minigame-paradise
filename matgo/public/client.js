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
      case 'sweep_from_flip': text = '쓸!'; break;
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
        break;
      case 'ROUND_START':
        hideRoundModal();
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
        break;
      case 'ERROR':
        if (msg.message && msg.message.includes('가득')) {
          autoReconnect = false;
          if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
          showToast('방이 가득 찼다 (2/2). 다른 탭/PC를 닫고 새로고침해라.');
        } else {
          showToast(msg.message || '알 수 없는 오류');
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
    prevFloorIds = curFloorIds;
    prevCapIds = curCapIds;

    // 액션 토스트 (특수 룰 발생 시 화면 중앙에 한 번 띄움)
    const actionKey = s.lastAction ? JSON.stringify(s.lastAction) : '';
    if (actionKey && actionKey !== prevActionKey) {
      maybeShowActionToast(s.lastAction);
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

    // 손패 / 바닥 / 점수판 렌더
    renderOppHand(s);
    renderMyHand(s);
    renderFloor(s);
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
    renderCaptured('p1', s, flyTargetIds);
    renderCaptured('p2', s, flyTargetIds);

    // 액션 패널
    updateActionPanel(s);

    // 클릭한 손패 카드의 클론을 새 위치로 보간 이동
    // (매칭 시 짝 위치를 거쳐 함께 먹은 패로 가는 2단계 연출을 위해 사라진 카드 정보 전달)
    resolvePendingFlies(removedFloorIds, prevFloorRects);
  }

  /**
   * 현재 phase/turn 기준 배너 상단 상태 텍스트 도출.
   * @param {object} s
   * @returns {string}
   */
  function deriveTurnText(s) {
    if (s.phase === 'round_end') return '라운드 종료';
    if (s.phase === 'shake_decision') {
      return s.pendingShake ? '흔들기 결정' : '상대 흔들기 결정';
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
    sorted.forEach((card) => {
      const el = makeCardEl(card);
      if (canPlay) {
        el.classList.add('clickable');
        el.addEventListener('click', () => sendPlay(card.id));
      }
      myCardsEl.appendChild(el);
    });
  }

  /**
   * 바닥 카드 — 허니콤 12슬롯 절대위치 (deck-card / floor-mission 보존).
   */
  function renderFloor(s) {
    // deck-card / floor-mission / go-stop-overlay 외 카드 제거
    Array.from(floorCardsEl.children).forEach((ch) => {
      if (!ch.classList.contains('deck-card')
       && !ch.classList.contains('floor-mission')
       && ch.id !== 'go-stop-overlay') {
        ch.remove();
      }
    });
    const deckEl = floorCardsEl.querySelector('.deck-card');

    // 바닥 선택은 별도 화면 중앙 모달(floor-choice-modal)에서 처리한다.
    // 여기서 바닥 카드들에 클릭 강조를 걸지 않아도 된다.

    // 같은 월 카드끼리 한 슬롯에 모이도록 그룹화 (등장 순서 유지)
    // 뻑(3장)/또(2장)/단일(1장) 모두 같은 처리. 2장 이상이면 비스듬히 겹침으로
    // 연관 카드임을 시각적으로 드러낸다.
    const monthOrder = [];
    const monthGroups = new Map();
    for (const card of s.floor) {
      if (!monthGroups.has(card.month)) {
        monthGroups.set(card.month, []);
        monthOrder.push(card.month);
      }
      monthGroups.get(card.month).push(card);
    }

    monthOrder.forEach((month, groupIdx) => {
      const cards = monthGroups.get(month);
      const isPpeok = !!s.ppeokFlags[month];
      const stackSize = cards.length;
      const slot = FLOOR_SLOTS[groupIdx % FLOOR_SLOTS.length];
      const center = (stackSize - 1) / 2;

      cards.forEach((card, cardIdxInGroup) => {
        const anim = newFloorIds.has(card.id) ? 'appear' : null;
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
          applyFloorSlot(el, groupIdx);
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
      const effectiveType = (c.id === 'm09_kkeut' && ssangpi) ? 'pi' : c.type;
      if (groups[effectiveType]) groups[effectiveType].push(c);
    }

    const typeLabels = { gwang: '광', kkeut: '끗', tti: '띠', pi: '피' };
    const thresholds = { gwang: 3, kkeut: 5, tti: 5, pi: 10 };

    for (const type of ['gwang', 'kkeut', 'tti', 'pi']) {
      const count   = groups[type].length;
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
    shakeModal.classList.add('hidden');
    bombPanel.classList.add('hidden');

    if (s.phase === 'round_end') {
      actionDisplay.textContent = '라운드 종료 — 결과 모달 확인';
      return;
    }

    const myTurn = s.turn === me;

    if (s.phase === 'shake_decision') {
      if (s.pendingShake) {
        // 흔들기 결정은 라운드 시작 직후 즉시 일어나는 일회성 결정이라
        // 바닥 하단 strip 대신 화면 중앙 모달로 띄워 가독성을 높인다.
        actionDisplay.textContent = `${s.pendingShake.month}월 카드 3장 보유 — 흔들기 결정`;
        if (shakeMonthText) {
          shakeMonthText.textContent = `${s.pendingShake.month}월`;
        }
        shakeModal.classList.remove('hidden');
      } else {
        actionDisplay.textContent = '상대가 흔들기 결정 중...';
      }
      return;
    }

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
    if (!src) return;
    const rect = src.getBoundingClientRect();
    const clone = src.cloneNode(true);
    clone.classList.add('flying-card');
    clone.classList.remove('clickable');
    clone.style.transition = 'none';
    clone.style.left   = `${rect.left}px`;
    clone.style.top    = `${rect.top}px`;
    clone.style.width  = `${rect.width}px`;
    clone.style.height = `${rect.height}px`;
    document.body.appendChild(clone);
    void clone.offsetHeight;
    src.style.visibility = 'hidden';
    pendingFlies.push({ cardId, clone, startedAt: Date.now() });
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
    clone.style.position = 'fixed';
    clone.style.margin = '0';
    clone.style.transition = 'none';
    clone.style.left   = `${rect.left}px`;
    clone.style.top    = `${rect.top}px`;
    clone.style.width  = `${rect.width}px`;
    clone.style.height = `${rect.height}px`;
    document.body.appendChild(clone);
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
   * renderState 직후 호출 — pendingFlies의 카드 각각을 새 위치로 이동.
   *
   * 매칭으로 손→먹은 패가 일어난 경우, 바닥을 거치지 않고 직선으로 가면 어색하다.
   * 그래서 사라진 짝(이전 floor에 있었으나 이번 STATE에서 빠진 카드들)이 있으면:
   *   1) 손에서 낸 카드가 짝의 이전 바닥 위치까지 fly (만남 지점)
   *   2) 짝 카드들도 그 자리에 잠깐 모임 (이전 위치에서 클론으로 띄워둠)
   *   3) 모든 카드가 함께 각자의 먹은 패 자리로 fly
   * 짝이 없으면(=피우는 경우) 기존처럼 단일 fly로 바닥에 도착시킨다.
   *
   * @param {string[]} removedFloorIds 이번 STATE에서 floor에서 사라진 카드 ID 목록
   * @param {Map<string, DOMRect>} prevFloorRects 직전 STATE의 floor 카드 DOM 위치 캐시
   */
  function resolvePendingFlies(removedFloorIds = [], prevFloorRects = new Map()) {
    if (pendingFlies.length === 0) return;
    // fly 시작 — 이 동안 새 STATE/ROUND_END는 큐에 쌓아두고 완료 후 처리한다.
    isAnimating = true;
    const totalFlies = pendingFlies.length;
    let completedCount = 0;
    const markFlyDone = () => {
      completedCount++;
      if (completedCount >= totalFlies) {
        isAnimating = false;
        flushStateQueue();
      }
    };
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // 짝 클론은 fly당 1회만 만들면 안 되고, 한 STATE에 여러 fly가 동시에 있을 수
        // 있으므로 짝 카드 ID별로 클론을 1회 생성해 공유한다.
        const pairClones = new Map(); // cardId -> { clone, target }
        function spawnPairCloneOnce(cardId) {
          if (pairClones.has(cardId)) return pairClones.get(cardId);
          const target =
            myCapturedZoneEl.querySelector(`[data-card-id="${cardId}"]`) ||
            oppCapturedZoneEl.querySelector(`[data-card-id="${cardId}"]`);
          const rect = prevFloorRects.get(cardId);
          if (!target || !rect) return null;
          const clone = spawnCardClone(target, rect);
          const entry = { clone, target };
          pairClones.set(cardId, entry);
          return entry;
        }

        for (const fly of pendingFlies) {
          // v8: 먹은 패 zone은 my-captured-zone / opp-captured-zone (card-stack 내부)
          const target =
            floorCardsEl.querySelector(`[data-card-id="${fly.cardId}"]`) ||
            myCapturedZoneEl.querySelector(`[data-card-id="${fly.cardId}"]`) ||
            oppCapturedZoneEl.querySelector(`[data-card-id="${fly.cardId}"]`);
          if (!target) {
            // 어느 영역에서도 못 찾으면(사라짐) 페이드 아웃 정리
            fly.clone.style.transition = 'opacity 0.4s';
            fly.clone.style.opacity = '0';
            setTimeout(() => { fly.clone.remove(); markFlyDone(); }, 430);
            continue;
          }

          const wentToCaptured = target.closest('.captured-zone') !== null;
          const hasPair = wentToCaptured && removedFloorIds.length > 0;

          if (hasPair) {
            // 만남 지점 = 사라진 짝 중 첫 번째 카드의 이전 바닥 위치
            const meetRect = prevFloorRects.get(removedFloorIds[0]);
            // 짝 카드들 클론을 그 자리에 잠깐 띄움 (각자 자기 이전 위치에서 시작)
            const spawned = removedFloorIds.map(spawnPairCloneOnce).filter(Boolean);

            // 1단계: 손 카드 → 만남 지점
            fly.clone.style.transition = 'all 0.3s ease-out';
            fly.clone.style.left   = `${meetRect.left}px`;
            fly.clone.style.top    = `${meetRect.top}px`;
            fly.clone.style.width  = `${meetRect.width}px`;
            fly.clone.style.height = `${meetRect.height}px`;

            // 2단계: 잠깐 멈춘 뒤 손 카드 + 짝 카드들 모두 각자의 captured 위치로
            const handFinal = target.getBoundingClientRect();
            setTimeout(() => {
              fly.clone.style.transition = 'all 0.35s ease-in';
              fly.clone.style.left   = `${handFinal.left}px`;
              fly.clone.style.top    = `${handFinal.top}px`;
              fly.clone.style.width  = `${handFinal.width}px`;
              fly.clone.style.height = `${handFinal.height}px`;
              target.style.visibility = 'hidden';

              for (const { clone, target: pairTarget } of spawned) {
                const dst = pairTarget.getBoundingClientRect();
                clone.style.transition = 'all 0.35s ease-in';
                clone.style.left   = `${dst.left}px`;
                clone.style.top    = `${dst.top}px`;
                clone.style.width  = `${dst.width}px`;
                clone.style.height = `${dst.height}px`;
              }

              // 정리: 이동 끝난 뒤 원본 가시화 + 클론 제거
              setTimeout(() => {
                target.style.visibility = '';
                fly.clone.remove();
                for (const { clone, target: pairTarget } of spawned) {
                  pairTarget.style.visibility = '';
                  clone.remove();
                }
                markFlyDone();
              }, 380);
            }, 340);
          } else {
            // 매칭 없음 = 피우는 경우(floor에 손 카드가 그대로 놓임) 또는 짝 정보 없음
            const dst = target.getBoundingClientRect();
            fly.clone.style.transition = '';
            void fly.clone.offsetHeight;
            fly.clone.style.left   = `${dst.left}px`;
            fly.clone.style.top    = `${dst.top}px`;
            fly.clone.style.width  = `${dst.width}px`;
            fly.clone.style.height = `${dst.height}px`;
            target.style.visibility = 'hidden';
            setTimeout(() => {
              target.style.visibility = '';
              fly.clone.remove();
              markFlyDone();
            }, 360);
          }
        }
        pendingFlies = [];
      });
    });
  }

  function sendPlay(cardId) {
    if (!ws || ws.readyState !== 1) return;
    startFlyFromHand(cardId);
    ws.send(JSON.stringify({ type: 'PLAY_CARD', cardId }));
  }
  function sendChooseFloor(cardId) {
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ type: 'CHOOSE_FLOOR', cardId }));
  }
  function sendGoStop(decision) {
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ type: 'GO_STOP', decision }));
  }
  function sendShake(decision) {
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ type: 'SHAKE', decision }));
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
  btnShake.addEventListener('click', () => sendShake('shake'));
  btnShakeNo.addEventListener('click', () => sendShake('normal'));
  btnBomb.addEventListener('click', () => {
    if (!lastState || !lastState.bombableMonths || lastState.bombableMonths.length === 0) return;
    const month = lastState.bombableMonths[0]; // 첫 번째 자동 선택
    sendBomb(month);
  });
  btnNewRound.addEventListener('click', sendNewRound);
  btnNewRoundMod.addEventListener('click', () => { hideRoundModal(); sendNewRound(); });

  // "← 다른 종목" 버튼 핸들러 — 로비로 복귀
  const returnLobbyBtn = document.getElementById('btn-return-lobby');
  if (returnLobbyBtn) {
    returnLobbyBtn.addEventListener('click', () => {
      fetch('/lobby/return', { method: 'POST' }).catch(() => {});
      location.href = '/';
    });
  }

  // 9월 술잔 끗/쌍피 선택 핸들러
  function sendKkeutChoice(choice) {
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ type: 'SELECT_KKEUT_TYPE', choice }));
  }
  btnKkeutKkeut.addEventListener('click', () => sendKkeutChoice('kkeut'));
  btnKkeutSsangpi.addEventListener('click', () => sendKkeutChoice('ssangpi'));
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
    if (result.winner === null) {
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
