/**
 * @fileoverview 말 클릭 핸들링 + 결과 사용 유틸 (클라이언트 측).
 *
 * 실제 이동/잡기/업기 판정은 서버에서 수행한다. 본 모듈은 입력 → 서버 전송만 담당.
 */

import { hitTestCell } from './board.js';

/**
 * 캔버스 클릭 좌표 → 같은 칸에 있는 내 piece 인덱스를 추정.
 * 같은 칸에 여러 말이 있으면 어느 것을 보내도 movePiece에서 같은 cell의 묶음이 함께 움직임.
 *
 * @param {object} state    현재 게임 상태
 * @param {string} myId
 * @param {number} clickX
 * @param {number} clickY
 * @returns {number} pieceIndex (-1이면 매칭 없음)
 */
export function pickMyPieceAt(state, myId, clickX, clickY) {
  if (!state) return -1;
  const me = state.players.find((p) => p.id === myId);
  if (!me) return -1;
  const hit = hitTestCell(clickX, clickY, 30);
  if (!hit) {
    // HOME 영역 클릭? 보드 외부의 HOME 좌표 hit는 별도 처리하지 않고
    // 단순화: 첫 번째 HOME 말을 찾아 반환.
    // (HOME 말을 명시적으로 선택하기 어려우니, "내 결과를 사용하여 HOME 말 출발"은
    // 결과 선택 후 보드 외부를 클릭하거나 첫 HOME 말을 자동 선택하는 방식으로 구현 가능.
    // 아래 pickHomePiece에서 처리.)
    return -1;
  }
  for (let i = 0; i < me.pieces.length; i++) {
    const p = me.pieces[i];
    if (!p.done && p.cell === hit.cell) {
      return i;
    }
  }
  return -1;
}

/**
 * HOME에 있는 내 첫 piece의 인덱스를 반환 (없으면 -1).
 *
 * @param {object} state
 * @param {string} myId
 */
export function pickFirstHomePiece(state, myId) {
  if (!state) return -1;
  const me = state.players.find((p) => p.id === myId);
  if (!me) return -1;
  for (let i = 0; i < me.pieces.length; i++) {
    if (!me.pieces[i].done && me.pieces[i].cell === -1) return i;
  }
  return -1;
}

/**
 * 보드 외부의 HOME 영역(좌하/우상 작은 박스) 클릭 판정.
 * @param {number} clickX
 * @param {number} clickY
 * @param {string} myId
 * @param {number} boardSize
 */
export function isClickOnHomeArea(clickX, clickY, myId, boardSize) {
  if (myId === 'p1') {
    // 좌하 코너 박스: x < 80, y > boardSize - 80
    return clickX < 90 && clickY > boardSize - 90;
  }
  // p2: 우상 코너 박스
  return clickX > boardSize - 90 && clickY < 90;
}
