/**
 * @fileoverview HUD + 결과 화면 + 토스트.
 */

/**
 * HUD 갱신.
 *
 * @param {object} els
 * @param {object} state
 * @param {string|null} myId
 */
export function renderHud(els, state, myId) {
  els.hdrP1Name.textContent = 'P1' + (myId === 'p1' ? ' (나)' : '');
  els.hdrP2Name.textContent = 'P2' + (myId === 'p2' ? ' (나)' : '');
  els.turnLabel.textContent = state.turnNumber;
  els.deckLabel.textContent = state.deckSize;

  // 손 타일 수. 본인은 myHand.length, 상대는 oppHandCount.
  const oppId = myId === 'p1' ? 'p2' : 'p1';
  if (myId === 'p1') {
    els.hdrP1Hand.textContent = state.myHand ? state.myHand.length : '?';
    els.hdrP2Hand.textContent = state.oppHandCount;
  } else if (myId === 'p2') {
    els.hdrP2Hand.textContent = state.myHand ? state.myHand.length : '?';
    els.hdrP1Hand.textContent = state.oppHandCount;
  }

  // 첫 등판 상태.
  els.hdrP1Played.textContent = state.played && state.played.p1 ? '·등판' : '·미등판';
  els.hdrP2Played.textContent = state.played && state.played.p2 ? '·등판' : '·미등판';
  els.hdrP1Played.classList.toggle('played', state.played && state.played.p1);
  els.hdrP2Played.classList.toggle('played', state.played && state.played.p2);

  if (state.phase === 'playing') {
    const turnText = state.currentTurn === myId
      ? '내 턴'
      : (state.currentTurn === 'p1' ? 'P1 턴' : 'P2 턴');
    els.statusMsg.textContent = turnText;
  } else if (state.phase === 'ended') {
    els.statusMsg.textContent = '게임 종료';
  }
}

/**
 * 보드 툴바 + 첫 등판 안내 갱신.
 *
 * @param {object} els
 * @param {object} state
 * @param {string|null} myId
 * @param {number} freshMeldScore 이번 턴 본인이 추가한 점수 미리보기
 * @param {boolean} hasChanges 이번 턴에 보드 변경이 있는지
 */
export function renderActionBar(els, state, myId, freshMeldScore, hasChanges) {
  const myTurn = state.currentTurn === myId && state.phase === 'playing';
  const meldThreshold = 30;
  const played = state.played && state.played[myId];

  els.btnNewSet.disabled = !myTurn;
  els.btnEndTurn.disabled = !myTurn;

  if (state.phase === 'ended') {
    els.actionHint.textContent = '게임이 종료되었습니다.';
    els.meldHint.textContent = '';
    return;
  }
  if (!myTurn) {
    els.actionHint.textContent = '상대 턴입니다. 잠시 기다려 주세요.';
    els.meldHint.textContent = '';
    return;
  }

  // 본인 턴.
  if (!played) {
    // 첫 등판 안내.
    els.meldHint.textContent = `첫 등판 ${freshMeldScore}/${meldThreshold}점`;
    if (freshMeldScore >= meldThreshold) {
      els.meldHint.style.color = 'var(--gold)';
      els.actionHint.textContent = '첫 등판 조건 충족! 「턴 종료」를 누르세요.';
    } else {
      els.meldHint.style.color = '';
      els.actionHint.textContent = `첫 등판은 ${meldThreshold}점 이상이어야 합니다. 손 타일을 보드로 옮기세요.`;
    }
  } else {
    // 등판 후.
    els.meldHint.textContent = '등판 완료 · 자유 재조합 가능';
    els.meldHint.style.color = 'var(--gold)';
    if (hasChanges) {
      els.actionHint.textContent = '변경을 적용하려면 「턴 종료」.';
    } else {
      els.actionHint.textContent = '낼 타일이 없으면 「턴 종료」로 더미 1장을 뽑습니다.';
    }
  }
}

/**
 * 종료 오버레이 렌더.
 *
 * @param {object} els
 * @param {object} result { winner, reason, handCounts }
 * @param {string|null} myId
 */
export function renderGameOver(els, result, myId) {
  let outcome;
  if (result.winner === 'draw') {
    outcome = '무승부';
  } else if (result.winner === myId) {
    outcome = '승리!';
  } else if (myId && result.winner) {
    outcome = '패배';
  } else {
    outcome = (result.winner === 'p1' ? 'P1' : 'P2') + ' 승리';
  }
  els.resultOutcome.textContent = outcome;
  els.resultP1Hand.textContent = (result.handCounts && result.handCounts.p1) ?? '-';
  els.resultP2Hand.textContent = (result.handCounts && result.handCounts.p2) ?? '-';
  els.resultP1Name.textContent = 'P1' + (myId === 'p1' ? ' (나)' : '');
  els.resultP2Name.textContent = 'P2' + (myId === 'p2' ? ' (나)' : '');
  els.resultP1Side.classList.toggle('winner', result.winner === 'p1');
  els.resultP2Side.classList.toggle('winner', result.winner === 'p2');
  let reasonText = '';
  if (result.reason === 'empty_hand') reasonText = '손 타일을 모두 비워 승리!';
  else if (result.reason === 'deck_empty_pass') {
    reasonText = result.winner === 'draw'
      ? '더미가 비었고 양쪽 손 타일 수가 같아 무승부.'
      : '더미가 비어 손 타일이 더 적은 쪽이 승리합니다.';
  }
  els.resultReason.textContent = reasonText;
}

/**
 * 토스트 표시.
 *
 * @param {HTMLElement} toastEl
 * @param {string} message
 * @param {'info'|'error'|'success'} [kind]
 */
let toastTimer = null;
export function showToast(toastEl, message, kind) {
  toastEl.textContent = message;
  toastEl.className = 'toast show' + (kind === 'error' ? ' error' : (kind === 'success' ? ' success' : ''));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.className = 'toast'; }, 2600);
}
