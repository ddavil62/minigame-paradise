/**
 * @fileoverview 기물 DOM 렌더링 + 합법 수 하이라이트 모듈.
 * AD 컨셉 §4 (기물 디자인), §8-7 (DOM 템플릿) 기준.
 *
 * 기물은 DOM <div>로 렌더링하여 한자 가독성과 접근성을 확보한다.
 * 하이라이트(합법 수, 마지막 수)도 DOM으로 관리한다.
 */

import { cellToPx, CELL } from './board.js';

// ── 한자 매핑 (AD §4-2) ──────────────────────────────────────────
/**
 * 기물 type + side에 따른 한자 표기.
 * 궁과 졸만 한/초 한자가 다르고, 나머지는 동일 한자 + 색 구분.
 */
const PIECE_HANJA = {
  han: {
    king: '漢', advisor: '士', chariot: '車',
    cannon: '包', horse: '馬', elephant: '象', soldier: '兵',
  },
  cho: {
    king: '楚', advisor: '士', chariot: '車',
    cannon: '包', horse: '馬', elephant: '象', soldier: '卒',
  },
};

/**
 * 기물 type의 한글 이름 (디버그/접근성용).
 */
const PIECE_NAME_KO = {
  king: '궁', advisor: '사', chariot: '차',
  cannon: '포', horse: '마', elephant: '상', soldier: '졸',
};

// ── 기물 점수 (잡힌 기물 점수 합산용) ──────────────────────────────
const PIECE_SCORE = {
  chariot: 13, cannon: 7, horse: 5, elephant: 3,
  advisor: 3, soldier: 2, king: 0,
};

/**
 * 보드 데이터를 기물 DOM으로 렌더링한다.
 * 이전 기물 DOM을 전부 제거하고 새로 생성한다.
 * @param {HTMLElement} container #janggi-pieces-layer
 * @param {Array<Array<{type:string,side:string}|null>>} board 서버 보드 데이터
 * @param {'han'|'cho'|null} mySide 내 진영 (클릭 가능 표시용)
 * @param {'han'|'cho'} currentTurn 현재 차례
 * @param {boolean} isPlaying 게임 진행 중인지
 * @returns {Map<string, HTMLElement>} key='file,rank' -> DOM 엘리먼트
 */
export function renderPieces(container, board, mySide, currentTurn, isPlaying) {
  container.innerHTML = '';
  const pieceMap = new Map();

  if (!board) return pieceMap;

  for (let rank = 0; rank < board.length; rank++) {
    for (let file = 0; file < board[rank].length; file++) {
      const piece = board[rank][file];
      if (!piece) continue;

      const el = document.createElement('div');
      el.className = `janggi-piece ${piece.side}`;
      el.textContent = PIECE_HANJA[piece.side][piece.type] || '?';
      el.dataset.piece = piece.type;
      el.dataset.side = piece.side;
      el.dataset.file = String(file);
      el.dataset.rank = String(rank);
      el.title = `${piece.side === 'han' ? '한' : '초'} ${PIECE_NAME_KO[piece.type] || piece.type}`;

      // 자기 차례이고 자기 기물이면 clickable
      if (isPlaying && mySide === piece.side && currentTurn === mySide) {
        el.classList.add('clickable');
      }

      const { x, y } = cellToPx(file, rank);
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;

      container.appendChild(el);
      pieceMap.set(`${file},${rank}`, el);
    }
  }

  return pieceMap;
}

/**
 * 합법 수 하이라이트를 렌더링한다.
 * @param {HTMLElement} container #janggi-highlights-layer
 * @param {number} selectedFile 선택된 기물의 file
 * @param {number} selectedRank 선택된 기물의 rank
 * @param {Array<{file:number,rank:number}>} moves 합법 이동 목록
 * @param {Array<Array<{type:string,side:string}|null>>} board 보드 데이터 (적 기물 잡기 하이라이트용)
 */
export function highlightMoves(container, selectedFile, selectedRank, moves, board) {
  clearHighlights(container);

  // 선택된 기물 칸 하이라이트
  const selfHL = document.createElement('div');
  selfHL.className = 'highlight-self';
  const selfPos = cellToPx(selectedFile, selectedRank);
  selfHL.style.left = `${selfPos.x}px`;
  selfHL.style.top = `${selfPos.y}px`;
  container.appendChild(selfHL);

  // 합법 이동 칸
  for (const m of moves) {
    const pos = cellToPx(m.file, m.rank);
    const target = board[m.rank]?.[m.file];
    const dot = document.createElement('div');

    if (target) {
      // 잡을 수 있는 적 기물
      dot.className = 'highlight-dot highlight-capture';
    } else {
      // 빈 칸 이동
      dot.className = 'highlight-dot highlight-move';
    }
    dot.style.left = `${pos.x}px`;
    dot.style.top = `${pos.y}px`;
    dot.dataset.file = String(m.file);
    dot.dataset.rank = String(m.rank);
    container.appendChild(dot);
  }
}

/**
 * 모든 하이라이트를 제거한다.
 * @param {HTMLElement} container #janggi-highlights-layer
 */
export function clearHighlights(container) {
  container.innerHTML = '';
}

/**
 * 마지막 수의 from/to 칸에 잔상 마커를 표시한다.
 * @param {HTMLElement} container #janggi-highlights-layer
 * @param {{fromFile:number,fromRank:number,toFile:number,toRank:number}|null} lastMove
 */
export function markLastMove(container, lastMove) {
  // 기존 마커 제거
  const existing = container.querySelectorAll('.last-move-marker');
  existing.forEach(el => el.remove());

  if (!lastMove) return;

  const fromPos = cellToPx(lastMove.fromFile, lastMove.fromRank);
  const fromEl = document.createElement('div');
  fromEl.className = 'last-move-marker';
  fromEl.style.left = `${fromPos.x}px`;
  fromEl.style.top = `${fromPos.y}px`;
  container.appendChild(fromEl);

  const toPos = cellToPx(lastMove.toFile, lastMove.toRank);
  const toEl = document.createElement('div');
  toEl.className = 'last-move-marker';
  toEl.style.left = `${toPos.x}px`;
  toEl.style.top = `${toPos.y}px`;
  container.appendChild(toEl);
}

/**
 * 장군 받은 궁에 펄스 애니메이션 클래스를 적용한다.
 * @param {Map<string, HTMLElement>} pieceMap
 * @param {Array<Array<{type:string,side:string}|null>>} board
 * @param {'han'|'cho'|null} checkedSide 장군 받은 진영 (null이면 해제)
 */
export function markCheck(pieceMap, board, checkedSide) {
  // 기존 체크 마크 모두 해제
  for (const el of pieceMap.values()) {
    el.classList.remove('in-check');
  }

  if (!checkedSide || !board) return;

  // 해당 진영 궁 찾기
  for (let r = 0; r < board.length; r++) {
    for (let f = 0; f < board[r].length; f++) {
      const p = board[r][f];
      if (p && p.type === 'king' && p.side === checkedSide) {
        const el = pieceMap.get(`${f},${r}`);
        if (el) el.classList.add('in-check');
        return;
      }
    }
  }
}

/**
 * 잡힌 기물을 패널에 렌더링한다.
 * @param {HTMLElement} container 잡힌 기물 표시 영역
 * @param {HTMLElement} scoreEl 점수 표시 영역
 * @param {Array<{type:string,side:string}>} capturedPieces 잡힌 기물 배열
 */
export function renderCaptured(container, scoreEl, capturedPieces) {
  container.innerHTML = '';
  let totalScore = 0;

  for (const p of capturedPieces) {
    const el = document.createElement('div');
    el.className = `captured-piece ${p.side}`;
    el.textContent = PIECE_HANJA[p.side]?.[p.type] || '?';
    el.title = PIECE_NAME_KO[p.type] || p.type;
    container.appendChild(el);
    totalScore += PIECE_SCORE[p.type] || 0;
  }

  scoreEl.textContent = `${totalScore}점`;
}
