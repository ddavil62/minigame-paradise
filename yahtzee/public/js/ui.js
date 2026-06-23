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
 * 헤더 점수바 + 턴 번호 + 점수표 헤더/풋을 N인 동적으로 갱신한다.
 *
 * @param {object} els DOM 참조
 * @param {object} state STATE 스냅샷
 * @param {string|null} myId
 */
export function renderHud(els, state, myId) {
  const pids = state.playerIds || ['p1', 'p2'];

  // ── 헤더 점수바: N인 동적 갱신 ──
  // 기존 2인 DOM 요소가 있으면 갱신, 없으면 무시 (하위 호환).
  if (els.hdrP1Total) els.hdrP1Total.textContent = state.totals.p1 || 0;
  if (els.hdrP2Total) els.hdrP2Total.textContent = state.totals.p2 || 0;
  if (els.hdrP1Name) els.hdrP1Name.textContent = 'P1' + (myId === 'p1' ? ' (나)' : '');
  if (els.hdrP2Name) els.hdrP2Name.textContent = 'P2' + (myId === 'p2' ? ' (나)' : '');

  // ── 점수표 thead 동적 갱신 (N인 열) ──
  const thead = els.scoreboard.querySelector('thead tr');
  if (thead) {
    thead.innerHTML = '';
    const catTh = document.createElement('th');
    catTh.className = 'col-cat';
    catTh.textContent = '카테고리';
    thead.appendChild(catTh);
    for (const pid of pids) {
      const th = document.createElement('th');
      th.className = 'col-' + pid;
      th.id = 'tbl-' + pid + '-name';
      th.textContent = pid.toUpperCase() + (myId === pid ? ' (나)' : '');
      thead.appendChild(th);
    }
  }

  // ── 현재 턴 ──
  const totalTurns = 13 * pids.length;
  els.turnLabel.textContent = state.turnNumber;
  // 턴/N 표시 갱신: 부모 노드에서 '턴 X/Y' 텍스트의 Y를 동적으로 갱신.
  const turnSpan = els.turnLabel.parentNode;
  if (turnSpan) {
    turnSpan.textContent = '';
    turnSpan.appendChild(document.createTextNode('턴 '));
    const turnNumSpan = document.createElement('span');
    turnNumSpan.id = 'turn-label';
    turnNumSpan.textContent = state.turnNumber;
    turnSpan.appendChild(turnNumSpan);
    turnSpan.appendChild(document.createTextNode('/' + totalTurns));
    // els.turnLabel 참조를 새 span으로 재연결
    els.turnLabel = turnNumSpan;
  }

  if (state.phase === 'playing') {
    const turnText = state.currentTurn === myId
      ? '내 턴'
      : state.currentTurn.toUpperCase() + ' 턴';
    els.statusMsg.textContent = turnText;
  } else if (state.phase === 'ended') {
    els.statusMsg.textContent = '게임 종료';
  }

  // ── 점수표 tfoot 동적 갱신 (N인 열) ──
  const tfoot = els.scoreboard.querySelector('tfoot');
  if (tfoot) {
    tfoot.innerHTML = '';

    // 상단 합
    const sumRow = document.createElement('tr');
    sumRow.className = 'subtotal-row';
    const sumCat = document.createElement('td');
    sumCat.className = 'col-cat';
    sumCat.innerHTML = '상단 합 <span class="cond">(≥63 → +35)</span>';
    sumRow.appendChild(sumCat);
    for (const pid of pids) {
      const td = document.createElement('td');
      td.className = 'col-' + pid;
      td.id = pid + '-upper-sum';
      td.textContent = (state.upper[pid] && state.upper[pid].sum) || 0;
      sumRow.appendChild(td);
    }
    tfoot.appendChild(sumRow);

    // 상단 보너스
    const bonusRow = document.createElement('tr');
    bonusRow.className = 'subtotal-row';
    const bonusCat = document.createElement('td');
    bonusCat.className = 'col-cat';
    bonusCat.textContent = '상단 보너스';
    bonusRow.appendChild(bonusCat);
    for (const pid of pids) {
      const td = document.createElement('td');
      td.className = 'col-' + pid;
      td.id = pid + '-upper-bonus';
      td.textContent = (state.upper[pid] && state.upper[pid].bonus) || 0;
      bonusRow.appendChild(td);
    }
    tfoot.appendChild(bonusRow);

    // 추가 야츠 보너스
    const ybRow = document.createElement('tr');
    ybRow.className = 'subtotal-row';
    const ybCat = document.createElement('td');
    ybCat.className = 'col-cat';
    ybCat.textContent = '추가 야츠 보너스';
    ybRow.appendChild(ybCat);
    for (const pid of pids) {
      const td = document.createElement('td');
      td.className = 'col-' + pid;
      td.id = pid + '-yahtzee-bonus';
      td.textContent = state.yahtzeeBonus[pid] || 0;
      ybRow.appendChild(td);
    }
    tfoot.appendChild(ybRow);

    // 총점
    const totalRow = document.createElement('tr');
    totalRow.className = 'total-row';
    const totalCat = document.createElement('td');
    totalCat.className = 'col-cat';
    totalCat.innerHTML = '<strong>총점</strong>';
    totalRow.appendChild(totalCat);
    for (const pid of pids) {
      const td = document.createElement('td');
      td.className = 'col-' + pid;
      td.id = pid + '-total';
      td.textContent = state.totals[pid] || 0;
      totalRow.appendChild(td);
    }
    tfoot.appendChild(totalRow);
  }

  // ── 점수표 컬럼 강조 (현재 턴) ──
  // N인 확장: p1~p4까지 모든 current-pN 클래스를 제거하고 현재 턴만 추가.
  for (const pid of ['p1', 'p2', 'p3', 'p4']) {
    els.scoreboard.classList.remove('current-' + pid);
  }
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
    const who = state.currentTurn ? state.currentTurn.toUpperCase() : '상대';
    els.actionHint.textContent = `${who} 턴입니다. 잠시 기다려 주세요.`;
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
 * N인 확장: totals 객체 순회, 최고점자 winner 강조.
 *
 * @param {object} els
 * @param {object} result { winner, totals, breakdown, p1Total, p2Total (후방 호환) }
 * @param {string|null} myId
 * @param {string[]} [pids] 플레이어 ID 배열 (기본 ['p1', 'p2'])
 */
export function renderGameOver(els, result, myId, pids) {
  const playerIds = Array.isArray(pids) && pids.length >= 2 ? pids : ['p1', 'p2'];
  const totals = result.totals || { p1: result.p1Total || 0, p2: result.p2Total || 0 };

  let outcome;
  if (result.winner === 'draw') {
    outcome = '무승부';
  } else if (result.winner === myId) {
    outcome = '승리!';
  } else if (myId && result.winner) {
    outcome = '패배';
  } else if (result.winner) {
    outcome = result.winner.toUpperCase() + ' 승리';
  } else {
    outcome = '결과';
  }
  els.resultOutcome.textContent = outcome;

  // ── 결과 점수 영역 동적 갱신 ──
  const scoresContainer = els.resultP1Side ? els.resultP1Side.parentNode : null;
  if (scoresContainer) {
    scoresContainer.innerHTML = '';
    for (let i = 0; i < playerIds.length; i++) {
      const pid = playerIds[i];
      if (i > 0) {
        const vs = document.createElement('div');
        vs.className = 'result-vs';
        vs.textContent = 'VS';
        scoresContainer.appendChild(vs);
      }
      const side = document.createElement('div');
      side.className = 'result-side' + (result.winner === pid ? ' winner' : '');
      const nameDiv = document.createElement('div');
      nameDiv.className = 'result-name';
      nameDiv.textContent = pid.toUpperCase() + (myId === pid ? ' (나)' : '');
      side.appendChild(nameDiv);
      const totalDiv = document.createElement('div');
      totalDiv.className = 'result-total';
      totalDiv.textContent = totals[pid] || 0;
      side.appendChild(totalDiv);
      scoresContainer.appendChild(side);
    }
  }

  // ── breakdown 테이블 N인 동적 생성 ──
  const br = result.breakdown || {};
  let html = '<table><thead><tr><td></td>';
  for (const pid of playerIds) {
    html += `<td class="br-num">${pid.toUpperCase()}</td>`;
  }
  html += '</tr></thead><tbody>';
  for (const cat of ALL_CATEGORIES) {
    html += `<tr><td class="br-cat">${CATEGORY_LABEL[cat] || cat}</td>`;
    for (const pid of playerIds) {
      const pBr = br[pid] || {};
      const v = (pBr.sheet && pBr.sheet[cat] !== null && pBr.sheet[cat] !== undefined) ? pBr.sheet[cat] : '-';
      html += `<td class="br-num">${v}</td>`;
    }
    html += '</tr>';
  }
  html += '<tr><td class="br-cat">상단 합</td>';
  for (const pid of playerIds) html += `<td class="br-num">${(br[pid] && br[pid].upperSum) || 0}</td>`;
  html += '</tr>';
  html += '<tr><td class="br-cat">상단 보너스</td>';
  for (const pid of playerIds) html += `<td class="br-num">${(br[pid] && br[pid].upperBonus) || 0}</td>`;
  html += '</tr>';
  html += '<tr><td class="br-cat">추가 야츠 보너스</td>';
  for (const pid of playerIds) html += `<td class="br-num">${(br[pid] && br[pid].yahtzeeBonus) || 0}</td>`;
  html += '</tr>';
  html += '<tr><td class="br-cat"><strong>총점</strong></td>';
  for (const pid of playerIds) {
    const t = (br[pid] && br[pid].total) || totals[pid] || 0;
    html += `<td class="br-num"><strong>${t}</strong></td>`;
  }
  html += '</tr>';
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
