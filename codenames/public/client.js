/**
 * @fileoverview 코드네임 클래식(정통 4인 2:2 팀 대전) 클라이언트.
 *
 * - WebSocket으로 서버에 연결 → 닉네임 입장(JOIN) → 팀/역할 선택(PICK_ROLE) → 게임 진행
 * - 서버 권위: 모든 게임 규칙은 game.js가 처리하고, 클라는 STATE 스냅샷을 받아 렌더만 한다.
 * - 역할별 시야 분리: 서버가 보내는 myKey가 스파이마스터=전체 / 요원=공개 카드만 이므로
 *   클라는 myKey를 "그대로" 렌더할 뿐 키를 추론하지 않는다(요원 화면 키 누설 방지).
 *
 * ES 모듈로 로드되며 모듈 스코프에 격리된다(전역 오염 없음).
 */

'use strict';

// ── DOM 참조 ───────────────────────────────────────────────────────
const youTagEl        = document.getElementById('you-tag');

// 대기/역할선택 화면
const screenWaiting   = document.getElementById('screen-waiting');
const waitingTitleEl  = document.getElementById('waiting-title');
const nameGateInline  = document.getElementById('name-gate-inline');
const inlineNameInput = document.getElementById('inline-name-input');
const btnInlineEnter  = document.getElementById('btn-inline-enter');
const roleRoom        = document.getElementById('role-room');
const slotButtons     = Array.from(document.querySelectorAll('.slot'));
const btnStartGame    = document.getElementById('btn-start-game');
const startHintEl     = document.getElementById('start-hint');

// 게임 화면
const screenGame      = document.getElementById('screen-game');
const scoreRedEl      = document.getElementById('score-red');
const scoreBlueEl     = document.getElementById('score-blue');
const firstTeamTagEl  = document.getElementById('first-team-tag');
const turnStatusEl    = document.getElementById('turn-status');
const clueCurrentEl   = document.getElementById('clue-current');
const myRoleTagEl     = document.getElementById('my-role-tag');
const boardEl         = document.getElementById('board');

// 컨트롤
const clueControl     = document.getElementById('clue-control');
const clueStatusEl    = document.getElementById('clue-status');
const clueWordEl      = document.getElementById('clue-word');
const clueNumberEl    = document.getElementById('clue-number');
const btnClue         = document.getElementById('btn-clue');
const guessControl    = document.getElementById('guess-control');
const guessStatusEl   = document.getElementById('guess-status');
const guessesLeftEl   = document.getElementById('guesses-left');
const btnPass         = document.getElementById('btn-pass');

// 모달/배너/토스트
const modalEl         = document.getElementById('modal');
const modalTitle      = document.getElementById('modal-title');
const modalMsg        = document.getElementById('modal-message');
const btnReview       = document.getElementById('btn-review');
const btnRematch      = document.getElementById('btn-rematch');
const rematchWaitEl   = document.getElementById('rematch-wait');
const btnReturnLobby  = document.getElementById('btn-return-lobby');
const reviewBannerEl  = document.getElementById('review-banner');
const reviewSummaryEl = document.getElementById('review-summary');
const btnReviewClose  = document.getElementById('btn-review-close');
const oppLeftBanner   = document.getElementById('opponent-left-banner');
const oppLeftMsg      = document.getElementById('opponent-left-msg');
const btnBannerReturn = document.getElementById('btn-banner-return-lobby');
const toastEl         = document.getElementById('toast');

// ── 상태 ───────────────────────────────────────────────────────────
const BOARD_SIZE = 25;
/** sessionStorage 닉네임 키. */
const NAME_KEY = 'codenames:name';

/** @type {WebSocket|null} */
let ws = null;
/** 내 플레이어 ID ('p1'~'p4'). */
let me = null;
/** 내가 호스트인지. */
let isHost = false;
/** 내 팀 ('red'|'blue'|null) — ROLE_STATE에서 갱신, 게임 중 유지. */
let myTeam = null;
/** 내 역할 ('spymaster'|'operative'|null). */
let myRole = null;
/** 가장 최근 STATE 스냅샷. */
let lastState = null;
/** 마지막 GAME_OVER 컨텍스트(복기 재진입용). */
let lastOverContext = null;
/**
 * 복기 모드 데이터. null이면 비활성.
 * @type {null|{words:string[], keyCard:string[], revealed:(string|null)[], firstTeam:string, winner:string, reason:string}}
 */
let reviewData = null;
/** 현재 화면에 그려진 카드 DOM (인덱스 = 카드 위치). */
const cardEls = new Array(BOARD_SIZE);
let toastTimer = null;

// 자동 재연결 제어
let autoReconnect = true;
let reconnectTimer = null;
let reconnectAttempts = 0;

// ── 화면 전환 헬퍼 ─────────────────────────────────────────────────
/**
 * 대기 화면을 표시하고 게임 화면을 숨긴다.
 */
function showWaitingScreen() {
  screenWaiting.classList.remove('hidden');
  screenGame.classList.add('hidden');
}

/**
 * 게임 화면을 표시하고 대기 화면을 숨긴다.
 */
function showGameScreen() {
  screenWaiting.classList.add('hidden');
  screenGame.classList.remove('hidden');
}

// ── 보드 초기화 ────────────────────────────────────────────────────
/**
 * 25칸 빈 카드 DOM을 한 번만 만들어 둔다. 이후 렌더는 클래스/텍스트만 갱신.
 */
function initBoard() {
  boardEl.innerHTML = '';
  for (let i = 0; i < BOARD_SIZE; i++) {
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.index = String(i);
    const label = document.createElement('span');
    label.className = 'card-label';
    card.appendChild(label);
    card.addEventListener('click', () => onCardClick(i));
    boardEl.appendChild(card);
    cardEls[i] = card;
  }
}

/**
 * 카드의 모든 상태 클래스를 제거한다(렌더/복기 정리 공통).
 * @param {HTMLElement} card
 */
function resetCardClasses(card) {
  card.className = 'card';
}

// ── WebSocket 연결 ─────────────────────────────────────────────────
/**
 * WebSocket을 연결한다. 통합 라우터(/codenames/ws)와 단독 실행(/ws)을 모두 지원.
 */
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  // 통합 라우터 환경: /codenames/ 하위 → /codenames/ws. 단독 실행: pathname '/' → /ws.
  const seg = location.pathname.split('/').filter(Boolean)[0] || '';
  const wsPath = seg ? `/${seg}/ws` : '/ws';

  // 닉네임 폴백: URL ?name= → sessionStorage → 인라인 게이트
  const urlParams = new URLSearchParams(location.search);
  const urlName = urlParams.get('name');
  if (urlName) {
    sessionStorage.setItem(NAME_KEY, decodeURIComponent(urlName));
  }

  ws = new WebSocket(`${proto}://${location.host}${wsPath}`);
  ws.addEventListener('open', () => {
    console.log('[codenames] 연결됨');
    reconnectAttempts = 0;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    const storedName = sessionStorage.getItem(NAME_KEY);
    if (storedName) {
      ws.send(JSON.stringify({ type: 'JOIN', name: storedName }));
    } else {
      // 닉네임 게이트 노출 (입장 버튼이 JOIN 시점을 결정)
      waitingTitleEl.textContent = '닉네임을 입력하세요';
      nameGateInline.classList.remove('hidden');
    }
  });
  ws.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    handleMessage(msg);
  });
  ws.addEventListener('close', () => {
    console.log('[codenames] 연결 종료');
    if (!autoReconnect) return;
    const delay = Math.min(8000, 1000 * Math.pow(2, reconnectAttempts));
    reconnectAttempts += 1;
    showToast(`연결이 끊겼다. ${Math.round(delay / 1000)}초 후 자동 재접속...`);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, delay);
  });
  ws.addEventListener('error', (err) => {
    console.error('[codenames] WS 에러', err);
  });
}

// 페이지 닫기/새로고침 시 즉시 close 통보 → 좀비 슬롯 방지
window.addEventListener('pagehide', () => {
  autoReconnect = false;
  if (ws && ws.readyState === WebSocket.OPEN) {
    try { ws.close(1000, 'page hide'); } catch { /* noop */ }
  }
});

/**
 * 서버 메시지 라우터.
 * @param {object} msg
 */
function handleMessage(msg) {
  switch (msg.type) {
    case 'JOINED':
      me = msg.playerId;
      isHost = !!msg.isHost;
      youTagEl.textContent = `${sessionStorage.getItem(NAME_KEY) || ''} (${me})`;
      break;

    case 'ROLE_STATE':
      renderRoleState(msg);
      break;

    case 'GAME_START':
      // 역할 선택 → 게임 화면 전환. 곧 STATE가 도착해 보드를 채운다.
      clearReviewState();
      hideModal();
      hideOppLeftBanner();
      showGameScreen();
      break;

    case 'STATE':
      lastState = msg;
      // STATE에는 team이 없으므로 yourRole만 동기화(team은 ROLE_STATE에서 확정됨).
      if (msg.yourRole) myRole = msg.yourRole;
      renderState(msg);
      break;

    case 'GAME_OVER':
      lastOverContext = {
        winner: msg.winner,
        reason: msg.reason,
        review: msg.review || null,
      };
      reviewData = null;
      hideReviewBanner();
      showResultModal(msg.winner, msg.reason);
      break;

    case 'REMATCH_WAITING':
      renderRematchWaiting(msg.readyIds || []);
      break;

    case 'REMATCH_START':
      // 새 게임 시작 — 복기/모달 정리 후 STATE 대기.
      clearReviewState();
      hideModal();
      showGameScreen();
      break;

    case 'OPPONENT_LEFT':
      showToast(msg.message || '플레이어가 나갔다.');
      hideModal();
      showOppLeftBanner(msg.message || '플레이어가 나갔다.');
      break;

    case 'ERROR':
      showToast(msg.message || '알 수 없는 오류');
      break;

    default:
      console.warn('[codenames] 알 수 없는 메시지:', msg);
  }
}

// ── role_select 렌더링 ─────────────────────────────────────────────
/**
 * ROLE_STATE를 받아 4슬롯 현황 + 내 팀/역할 + 시작 버튼을 갱신한다.
 * @param {object} msg - { players:[{id,name,team,role,isHost}], canStart, you }
 */
function renderRoleState(msg) {
  if (msg.you) me = msg.you;
  showWaitingScreen();
  nameGateInline.classList.add('hidden');
  roleRoom.classList.remove('hidden');
  waitingTitleEl.textContent = '팀과 역할을 선택하세요';

  // 내 팀/역할/호스트 여부 갱신(게임 화면 가드의 기준값).
  const meEntry = msg.players.find((p) => p.id === me) || null;
  if (meEntry) {
    myTeam = meEntry.team;
    myRole = meEntry.role;
    isHost = !!meEntry.isHost;
  }

  // 슬롯별 점유자 표시.
  const occupant = {}; // 'red-spymaster' → name
  for (const p of msg.players) {
    if (p.team && p.role) occupant[`${p.team}-${p.role}`] = p;
  }
  for (const slot of slotButtons) {
    const key = `${slot.dataset.team}-${slot.dataset.role}`;
    const nameSpan = slot.querySelector('.slot-name');
    const p = occupant[key];
    slot.classList.toggle('filled', !!p);
    slot.classList.toggle('mine', !!(p && p.id === me));
    if (p) {
      nameSpan.textContent = p.name + (p.id === me ? ' (나)' : '') + (p.isHost ? ' 👑' : '');
    } else {
      nameSpan.textContent = '비어있음';
    }
  }

  // 호스트 시작 버튼 가드.
  if (isHost) {
    btnStartGame.classList.remove('hidden');
    btnStartGame.disabled = !msg.canStart;
    startHintEl.textContent = msg.canStart
      ? '모든 자리가 채워졌습니다. 시작하세요!'
      : '4자리가 모두 채워지면 시작할 수 있습니다.';
  } else {
    btnStartGame.classList.add('hidden');
    startHintEl.textContent = msg.canStart
      ? '호스트가 시작하기를 기다리는 중...'
      : '나머지 플레이어의 팀/역할 선택을 기다리는 중...';
  }
}

// ── 게임 STATE 렌더링 ──────────────────────────────────────────────
/**
 * 팀 한글 라벨.
 * @param {'red'|'blue'} team
 * @returns {string}
 */
function teamLabel(team) {
  return team === 'red' ? '레드' : team === 'blue' ? '블루' : '';
}

/**
 * 역할 한글 라벨.
 * @param {'spymaster'|'operative'} role
 * @returns {string}
 */
function roleLabel(role) {
  return role === 'spymaster' ? '스파이마스터' : role === 'operative' ? '요원' : '';
}

/**
 * STATE 스냅샷을 화면에 반영한다.
 * @param {object} s
 */
function renderState(s) {
  // 복기 모드 중에는 STATE 렌더를 보류한다(복기 화면 유지).
  if (reviewData) return;

  // 점수: 남은 카드 수 = total - found.
  const redLeft = s.redTotal - s.redFound;
  const blueLeft = s.blueTotal - s.blueFound;
  scoreRedEl.textContent = String(redLeft);
  scoreBlueEl.textContent = String(blueLeft);
  firstTeamTagEl.textContent = `선공: ${teamLabel(s.firstTeam)}`;

  // 턴/단계 상태.
  const phaseTxt = s.turnPhase === 'clue' ? '단서 입력 중' : '추측 중';
  turnStatusEl.textContent = `${teamLabel(s.currentTeam)} 팀 차례 · ${phaseTxt}`;
  turnStatusEl.className = `turn-status turn-${s.currentTeam}`;

  // 현재 단서.
  if (s.currentClue) {
    clueCurrentEl.textContent = `단서: "${s.currentClue.word}" ${s.currentClue.number} · 남은 추측 ${s.guessesLeft}`;
  } else {
    clueCurrentEl.textContent = '단서 대기 중';
  }

  // 내 역할 태그.
  myRoleTagEl.textContent = `너: ${teamLabel(myTeam)} ${roleLabel(myRole)}`;
  myRoleTagEl.className = `my-role-tag tag-${myTeam || 'none'}`;

  // 카드 렌더.
  const isMyTurn = s.currentTeam === myTeam;
  const canGuessNow = myRole === 'operative' && isMyTurn && s.turnPhase === 'guess' && s.guessesLeft > 0;
  for (let i = 0; i < BOARD_SIZE; i++) {
    const card = cardEls[i];
    resetCardClasses(card);
    card.querySelector('.card-label').textContent = s.words[i] || '';

    const revealedColor = s.revealed[i]; // null이면 미공개
    const keyColor = s.myKey[i];         // 스파이마스터=실제색 / 요원=공개된 것만(미공개 null)

    if (revealedColor) {
      // 공개된 카드: 실제 색으로 표시.
      card.classList.add('revealed', `c-${revealedColor}`);
    } else {
      // 미공개 카드.
      if (keyColor) {
        // 스파이마스터 시야: 키 색을 옅게 오버레이(요원은 keyColor=null이라 표시 안 됨).
        card.classList.add('key', `key-${keyColor}`);
      }
      if (canGuessNow) {
        card.classList.add('guessable');
      }
    }
  }

  // 역할별 컨트롤 표시/활성.
  renderControls(s, isMyTurn);
}

/**
 * 역할에 따라 컨트롤 패널(단서/추측)을 표시·활성화한다.
 * @param {object} s
 * @param {boolean} isMyTurn
 */
function renderControls(s, isMyTurn) {
  const playing = s.gamePhase === 'playing';

  if (myRole === 'spymaster') {
    clueControl.classList.remove('hidden');
    guessControl.classList.add('hidden');
    const canClue = playing && isMyTurn && s.turnPhase === 'clue';
    clueWordEl.disabled = !canClue;
    clueNumberEl.disabled = !canClue;
    btnClue.disabled = !canClue;
    if (canClue) {
      clueStatusEl.textContent = '단서를 입력하세요 (단어 + 숫자 1~9)';
    } else if (!isMyTurn) {
      clueStatusEl.textContent = '상대 팀 차례입니다';
    } else {
      clueStatusEl.textContent = '요원이 추측 중입니다...';
    }
  } else if (myRole === 'operative') {
    guessControl.classList.remove('hidden');
    clueControl.classList.add('hidden');
    const canGuess = playing && isMyTurn && s.turnPhase === 'guess';
    btnPass.disabled = !canGuess;
    guessesLeftEl.textContent = canGuess ? `남은 추측: ${s.guessesLeft}` : '';
    if (canGuess) {
      guessStatusEl.textContent = '카드를 눌러 추측하세요';
    } else if (!isMyTurn) {
      guessStatusEl.textContent = '상대 팀 차례입니다';
    } else {
      guessStatusEl.textContent = '스파이마스터의 단서를 기다리는 중...';
    }
  } else {
    clueControl.classList.add('hidden');
    guessControl.classList.add('hidden');
  }
}

// ── 입력 처리 ──────────────────────────────────────────────────────
/**
 * 카드 클릭 핸들러(요원 추측). 서버가 최종 검증하지만 명백한 무효 클릭은 사전 차단.
 * @param {number} index
 */
function onCardClick(index) {
  if (!ws || ws.readyState !== 1) return;
  if (reviewData) return; // 복기 중 클릭 무시
  if (!lastState || lastState.gamePhase !== 'playing') return;
  if (myRole !== 'operative') return; // 스파이마스터는 추측 불가
  if (lastState.currentTeam !== myTeam) {
    showToast('지금은 너의 팀 차례가 아니다.');
    return;
  }
  if (lastState.turnPhase !== 'guess') {
    showToast('아직 단서가 나오지 않았다.');
    return;
  }
  if (lastState.revealed[index] !== null) return;
  ws.send(JSON.stringify({ type: 'GUESS', cardIndex: index }));
}

btnClue.addEventListener('click', () => {
  if (!ws || ws.readyState !== 1) return;
  const word = clueWordEl.value.trim();
  const number = parseInt(clueNumberEl.value, 10);
  if (!word) { showToast('단서 단어를 입력해라'); return; }
  if (!Number.isInteger(number) || number < 1 || number > 9) {
    showToast('단서 숫자는 1~9');
    return;
  }
  ws.send(JSON.stringify({ type: 'CLUE', word, number }));
  clueWordEl.value = '';
});

clueWordEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') btnClue.click(); });
clueNumberEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') btnClue.click(); });

btnPass.addEventListener('click', () => {
  if (!ws || ws.readyState !== 1) return;
  if (!confirm('정말 패스하고 턴을 넘기겠는가?')) return;
  ws.send(JSON.stringify({ type: 'END_TURN' }));
});

// 슬롯 선택(팀/역할).
for (const slot of slotButtons) {
  slot.addEventListener('click', () => {
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({
      type: 'PICK_ROLE',
      team: slot.dataset.team,
      role: slot.dataset.role,
    }));
  });
}

// 호스트 시작 버튼.
btnStartGame.addEventListener('click', () => {
  if (!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify({ type: 'START_GAME' }));
});

// 인라인 닉네임 게이트 — 입장.
{
  const doJoin = () => {
    const name = (inlineNameInput.value || '').trim().slice(0, 12);
    if (!name) { showToast('닉네임을 입력해주세요.'); return; }
    sessionStorage.setItem(NAME_KEY, name);
    nameGateInline.classList.add('hidden');
    youTagEl.textContent = name;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'JOIN', name }));
    }
  };
  btnInlineEnter.addEventListener('click', doJoin);
  inlineNameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });
}

// ── 결과 모달 + 리매치 ─────────────────────────────────────────────
/**
 * 게임 종료 결과 모달을 표시한다.
 * @param {'red'|'blue'} winner
 * @param {'completed'|'assassin'|string} reason
 */
function showResultModal(winner, reason) {
  const winTxt = `${teamLabel(winner)} 팀 승리!`;
  let msg;
  if (reason === 'assassin') {
    const loser = winner === 'red' ? 'blue' : 'red';
    msg = `${teamLabel(loser)} 팀이 암살자를 건드렸다. ${teamLabel(winner)} 팀 즉시 승리!`;
  } else {
    msg = `${teamLabel(winner)} 팀이 자기 팀 요원을 모두 찾아냈다.`;
  }
  modalEl.classList.remove('hidden', 'win-red', 'win-blue');
  modalEl.classList.add(`win-${winner}`);
  modalTitle.textContent = winTxt;
  modalMsg.textContent = msg;
  rematchWaitEl.classList.add('hidden');
  rematchWaitEl.textContent = '';
  btnRematch.disabled = false;
  // 복기 데이터가 있을 때만 복기 버튼 노출.
  btnReview.classList.toggle('hidden', !(lastOverContext && lastOverContext.review));
}

function hideModal() {
  modalEl.classList.add('hidden');
  modalEl.classList.remove('win-red', 'win-blue');
}

/**
 * 리매치 대기 현황을 모달에 표시한다.
 * @param {string[]} readyIds
 */
function renderRematchWaiting(readyIds) {
  rematchWaitEl.classList.remove('hidden');
  rematchWaitEl.textContent = `한 판 더 동의: ${readyIds.length}명 · 상대 동의를 기다리는 중...`;
}

btnRematch.addEventListener('click', () => {
  if (!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify({ type: 'REMATCH' }));
  btnRematch.disabled = true;
  rematchWaitEl.classList.remove('hidden');
  rematchWaitEl.textContent = '한 판 더 신청 완료 · 상대를 기다리는 중...';
});

// ── 복기 모드 ──────────────────────────────────────────────────────
/**
 * 결과 모달의 "복기 보기" → 키 카드 전체 공개 보드로 전환한다.
 */
function enterReviewMode() {
  if (!lastOverContext || !lastOverContext.review) {
    showToast('복기 데이터를 받지 못했다.');
    return;
  }
  reviewData = {
    ...lastOverContext.review,
    winner: lastOverContext.winner,
    reason: lastOverContext.reason,
  };
  hideModal();
  renderReviewBoard();
  showReviewBanner();
}

/**
 * 복기 보드: 25칸 모두 실제 키 색으로 공개하고, 게임 중 공개됐던 카드는 별도 표시.
 */
function renderReviewBoard() {
  if (!reviewData) return;
  showGameScreen();
  for (let i = 0; i < BOARD_SIZE; i++) {
    const card = cardEls[i];
    resetCardClasses(card);
    card.querySelector('.card-label').textContent = reviewData.words[i] || '';
    const trueColor = reviewData.keyCard[i];
    const wasRevealed = reviewData.revealed[i] !== null;
    card.classList.add('review-cell', `c-${trueColor}`);
    if (wasRevealed) card.classList.add('was-revealed');
  }
  // 복기 중 컨트롤 비활성.
  clueControl.classList.add('hidden');
  guessControl.classList.add('hidden');
}

/**
 * 복기 배너를 표시하고 결과 요약을 채운다.
 */
function showReviewBanner() {
  if (!reviewData) return;
  const reasonTxt = reviewData.reason === 'assassin' ? ' (암살자)' : ' (전원 발견)';
  reviewSummaryEl.textContent = `${teamLabel(reviewData.winner)} 팀 승리${reasonTxt}`;
  reviewBannerEl.classList.remove('hidden');
}

function hideReviewBanner() {
  reviewBannerEl.classList.add('hidden');
}

/**
 * 복기 모드에서 보드에 주입한 복기 클래스를 전부 제거한다(잔존 방지 — duet #10 교훈).
 * resetCardClasses가 className을 통째로 초기화하므로 review-cell/was-revealed/c-* 모두 제거된다.
 */
function clearReviewArtifacts() {
  for (let i = 0; i < BOARD_SIZE; i++) {
    if (cardEls[i]) resetCardClasses(cardEls[i]);
  }
}

/**
 * 복기 상태 + 배너 + 보드 아티팩트를 일괄 정리한다(새 게임/리매치 진입 시).
 */
function clearReviewState() {
  reviewData = null;
  hideReviewBanner();
  clearReviewArtifacts();
}

// 결과 모달 "복기 보기".
btnReview.addEventListener('click', enterReviewMode);

// 복기 배너 "결과 다시 보기" → 복기 종료 후 결과 모달 재오픈.
btnReviewClose.addEventListener('click', () => {
  if (!lastOverContext) return;
  clearReviewState();
  if (lastState) renderState(lastState); // 직전 게임 종료 화면 복원
  showResultModal(lastOverContext.winner, lastOverContext.reason);
});

// ── 로비 복귀 / 이탈 배너 ──────────────────────────────────────────
/**
 * "다른 종목/로비로" 공통 복귀 처리.
 * 런처 통합 구조에서 로비 복귀는 포탈(`/`)로 직접 이동한다
 * (구 `POST /lobby/return` 엔드포인트는 삭제됨 — 데드코드 제거).
 */
function returnToLobby() {
  autoReconnect = false;
  location.href = '/';
}

btnReturnLobby.addEventListener('click', returnToLobby);
btnBannerReturn.addEventListener('click', returnToLobby);

const backToLobbyBtn = document.getElementById('btn-back-to-lobby');
backToLobbyBtn.addEventListener('click', () => {
  if (!confirm('게임을 중단하고 게임 선택 화면으로 돌아가시겠어요? 다른 플레이어도 함께 이동합니다.')) return;
  returnToLobby();
});

/**
 * 상대 이탈 배너를 표시한다.
 * @param {string} text
 */
function showOppLeftBanner(text) {
  oppLeftMsg.textContent = text;
  oppLeftBanner.classList.remove('hidden');
}

function hideOppLeftBanner() {
  oppLeftBanner.classList.add('hidden');
}

// ── 토스트 ─────────────────────────────────────────────────────────
/**
 * 하단 토스트 알림(3초).
 * @param {string} text
 */
function showToast(text) {
  toastEl.textContent = text;
  toastEl.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.classList.add('hidden'); }, 3000);
}

// ── 부트스트랩 ─────────────────────────────────────────────────────
initBoard();
connect();
