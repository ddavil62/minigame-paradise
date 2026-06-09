/**
 * @fileoverview HUD + 결과 화면 + 토스트.
 *
 * - 헤더 점수바(P1/P2 총점, 현재 턴 강조)
 * - 점수표 풋(상단합/보너스/야츠보너스/총점)
 * - 종료 오버레이(승/패/무, 카테고리별 breakdown)
 * - 토스트
 */

import { CATEGORY_LABEL, ALL_CATEGORIES } from './game.js';

/**
 * 헤더 점수바 + 턴 번호 + 점수표 풋을 갱신한다.
 *
 * @param {object} els DOM 참조
 * @param {object} state STATE 스냅샷
 * @param {string|null} myId
 */
export function renderHud(els, state, myId) {
  // 헤더 총점 + 이름.
  els.hdrP1Total.textContent = state.totals.p1;
  els.hdrP2Total.textContent = state.totals.p2;
  // 본인 이름에 (나) 표시.
  els.hdrP1Name.textContent = 'P1' + (myId === 'p1' ? ' (나)' : '');
  els.hdrP2Name.textContent = 'P2' + (myId === 'p2' ? ' (나)' : '');
  els.tblP1Name.textContent = 'P1' + (myId === 'p1' ? ' (나)' : '');
  els.tblP2Name.textContent = 'P2' + (myId === 'p2' ? ' (나)' : '');

  // 현재 턴.
  els.turnLabel.textContent = state.turnNumber;
  if (state.phase === 'playing') {
    const turnText = state.currentTurn === myId
      ? '내 턴'
      : (state.currentTurn === 'p1' ? 'P1 턴' : 'P2 턴');
    els.statusMsg.textContent = turnText;
  } else if (state.phase === 'ended') {
    els.statusMsg.textContent = '게임 종료';
  }

  // 점수표 풋: 상단합/보너스/야츠보너스/총점.
  els.p1UpperSum.textContent = state.upper.p1.sum;
  els.p2UpperSum.textContent = state.upper.p2.sum;
  els.p1UpperBonus.textContent = state.upper.p1.bonus;
  els.p2UpperBonus.textContent = state.upper.p2.bonus;
  els.p1YahtzeeBonus.textContent = state.yahtzeeBonus.p1;
  els.p2YahtzeeBonus.textContent = state.yahtzeeBonus.p2;
  els.p1Total.textContent = state.totals.p1;
  els.p2Total.textContent = state.totals.p2;

  // 점수표 컬럼 강조 (현재 턴).
  els.scoreboard.classList.remove('current-p1', 'current-p2');
  if (state.phase === 'playing') {
    els.scoreboard.classList.add('current-' + state.currentTurn);
  }

  // 굴림 횟수.
  els.rollCount.textContent = state.rollCount;
}

/**
 * 굴리기 버튼 + 액션 힌트 갱신.
 *
 * @param {object} els
 * @param {object} state
 * @param {string|null} myId
 */
export function renderActionBar(els, state, myId) {
  const myTurn = state.currentTurn === myId && state.phase === 'playing';
  const canRoll = myTurn && state.rollCount < 3;
  els.btnRoll.disabled = !canRoll;

  if (state.phase === 'ended') {
    els.actionHint.textContent = '게임이 종료되었습니다.';
    els.btnRoll.textContent = '주사위 굴리기';
    return;
  }
  if (!myTurn) {
    els.actionHint.textContent = '상대 턴입니다. 잠시 기다려 주세요.';
    els.btnRoll.textContent = '주사위 굴리기';
    return;
  }
  if (state.rollCount === 0) {
    els.btnRoll.textContent = '주사위 굴리기 (1/3)';
    els.actionHint.textContent = '내 턴: 주사위를 굴려 시작하세요.';
  } else if (state.rollCount < 3) {
    els.btnRoll.textContent = `다시 굴리기 (${state.rollCount + 1}/3)`;
    els.actionHint.textContent = '유지할 다이스를 클릭하고 다시 굴리거나, 점수표에서 카테고리를 선택하세요.';
  } else {
    els.btnRoll.textContent = '굴림 종료 (3/3)';
    els.actionHint.textContent = '굴림이 끝났습니다. 점수표에서 카테고리를 선택하세요.';
  }
}

/**
 * 종료 오버레이를 렌더한다.
 *
 * @param {object} els
 * @param {object} result { winner, p1Total, p2Total, breakdown }
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
  els.resultP1Total.textContent = result.p1Total;
  els.resultP2Total.textContent = result.p2Total;
  els.resultP1Name.textContent = 'P1' + (myId === 'p1' ? ' (나)' : '');
  els.resultP2Name.textContent = 'P2' + (myId === 'p2' ? ' (나)' : '');

  // winner 클래스 토글.
  els.resultP1Side.classList.toggle('winner', result.winner === 'p1');
  els.resultP2Side.classList.toggle('winner', result.winner === 'p2');

  // breakdown 테이블.
  const br = result.breakdown || { p1: {}, p2: {} };
  let html = '<table><thead><tr><td></td><td class="br-num">P1</td><td class="br-num">P2</td></tr></thead><tbody>';
  for (const cat of ALL_CATEGORIES) {
    const p1v = (br.p1.sheet && br.p1.sheet[cat] !== null && br.p1.sheet[cat] !== undefined) ? br.p1.sheet[cat] : '-';
    const p2v = (br.p2.sheet && br.p2.sheet[cat] !== null && br.p2.sheet[cat] !== undefined) ? br.p2.sheet[cat] : '-';
    html += `<tr><td class="br-cat">${CATEGORY_LABEL[cat] || cat}</td>`;
    html += `<td class="br-num">${p1v}</td><td class="br-num">${p2v}</td></tr>`;
  }
  html += `<tr><td class="br-cat">상단 합</td><td class="br-num">${br.p1.upperSum || 0}</td><td class="br-num">${br.p2.upperSum || 0}</td></tr>`;
  html += `<tr><td class="br-cat">상단 보너스</td><td class="br-num">${br.p1.upperBonus || 0}</td><td class="br-num">${br.p2.upperBonus || 0}</td></tr>`;
  html += `<tr><td class="br-cat">추가 야츠 보너스</td><td class="br-num">${br.p1.yahtzeeBonus || 0}</td><td class="br-num">${br.p2.yahtzeeBonus || 0}</td></tr>`;
  html += `<tr><td class="br-cat"><strong>총점</strong></td><td class="br-num"><strong>${br.p1.total || result.p1Total}</strong></td><td class="br-num"><strong>${br.p2.total || result.p2Total}</strong></td></tr>`;
  html += '</tbody></table>';
  els.resultBreakdown.innerHTML = html;
}

/**
 * 토스트 표시.
 *
 * @param {HTMLElement} toastEl
 * @param {string} message
 * @param {'info'|'error'} [kind]
 */
let toastTimer = null;
export function showToast(toastEl, message, kind) {
  toastEl.textContent = message;
  toastEl.className = 'toast show' + (kind === 'error' ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.className = 'toast'; }, 2400);
}
