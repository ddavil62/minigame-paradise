/**
 * @fileoverview 클라이언트 게임 상태 헬퍼.
 *
 * 서버 권위 모델이므로 클라이언트는 STATE 메시지를 그대로 저장하고
 * 렌더링과 입력 검증에만 사용한다 (실제 판정/이동은 서버).
 */

/**
 * 게임 상태 컨트롤러 생성.
 * @returns {object}
 */
export function createGame() {
  /** @type {object|null} 가장 최근 STATE 메시지 */
  let state = null;

  /**
   * STATE 수신 시 갱신.
   */
  function setState(newState) {
    state = newState;
  }

  function getState() { return state; }

  /**
   * 내 차례인지 판정.
   * @param {string|null} myId
   */
  function isMyTurn(myId) {
    return !!(state && state.currentTurn === myId);
  }

  /**
   * 분기 선택 대기 중인지.
   * @param {string|null} myId
   */
  function isAwaitingMyBranch(myId) {
    return !!(state && state.awaitingBranchAt !== null && state.currentTurn === myId);
  }

  /**
   * 던질 수 있는 상태인지 판정 (서버 검증과 동일한 규칙).
   * - 내 턴이어야 함
   * - 분기 대기 중이면 불가
   * - pendingResults가 있는 경우 마지막 결과가 yut/mo여야 함
   * (잡기 보너스는 클라에서 알 수 없어 서버가 최종 판정)
   * @param {string|null} myId
   */
  function canThrow(myId) {
    if (!isMyTurn(myId)) return false;
    if (!state || state.winner) return false;
    if (state.awaitingBranchAt !== null) return false;
    const q = state.pendingResults || [];
    if (q.length === 0) return true;
    const last = q[q.length - 1];
    return last === 'yut' || last === 'mo';
  }

  /**
   * 내 piece 배열 반환.
   * @param {string|null} myId
   */
  function getMyPieces(myId) {
    if (!state) return [];
    const me = state.players.find((p) => p.id === myId);
    return me ? me.pieces : [];
  }

  return {
    setState,
    getState,
    isMyTurn,
    isAwaitingMyBranch,
    canThrow,
    getMyPieces,
  };
}
