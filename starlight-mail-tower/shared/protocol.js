/**
 * @fileoverview 별빛 우편탑의 서버 권위 WebSocket 메시지 계약과 입력 검증을 정의한다.
 */

export const CLIENT_MESSAGE = Object.freeze({ JOIN: 'JOIN', READY: 'READY', INPUT: 'INPUT', SELECT_LEVEL: 'SELECT_LEVEL', RESULT_VOTE: 'RESULT_VOTE', RESTART_VOTE: 'RESTART_VOTE', LEAVE_GAME: 'LEAVE_GAME' });
export const SERVER_MESSAGE = Object.freeze({ WELCOME: 'WELCOME', MENU_STATE: 'MENU_STATE', READY_STATE: 'READY_STATE', SNAPSHOT: 'SNAPSHOT', EVENT: 'EVENT', GAME_OVER: 'GAME_OVER', RESULT_VOTE_STATE: 'RESULT_VOTE_STATE', REMATCH_STATE: 'REMATCH_STATE', PAUSED: 'PAUSED', RESUMED: 'RESUMED', SESSION_ENDED: 'SESSION_ENDED', ERROR: 'ERROR' });
export const ERROR_CODE = Object.freeze({ INVALID_MESSAGE: 'INVALID_MESSAGE', ROOM_FULL: 'ROOM_FULL', JOIN_REQUIRED: 'JOIN_REQUIRED', RESUME_EXPIRED: 'RESUME_EXPIRED' });
export const TICK_RATE = 30;
export const SNAPSHOT_RATE = 15;
export const LEVEL_VERSION = 'coop-boost-2';

/**
 * 수신 메시지가 허용된 형태인지 검사하고 안전한 값만 반환한다.
 * @param {unknown} value 검사할 값
 * @returns {{ok: true, message: object}|{ok: false, code: string}}
 */
export function validateClientMessage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, code: ERROR_CODE.INVALID_MESSAGE };
  const message = /** @type {Record<string, unknown>} */ (value);
  if (message.type === CLIENT_MESSAGE.JOIN) {
    if (typeof message.name !== 'string' || message.name.trim().length < 1 || message.name.length > 20) return { ok: false, code: ERROR_CODE.INVALID_MESSAGE };
    const locale = message.locale === 'en' ? 'en' : 'ko';
    const sessionToken = typeof message.sessionToken === 'string' && message.sessionToken.length <= 64 ? message.sessionToken : '';
    const requestedRole = message.requestedRole === 'p1' || message.requestedRole === 'p2' ? message.requestedRole : null;
    return { ok: true, message: { type: CLIENT_MESSAGE.JOIN, name: message.name.trim(), locale, sessionToken, requestedRole, readyFromLobby: message.readyFromLobby === true } };
  }
  if (message.type === CLIENT_MESSAGE.READY) return { ok: true, message: { type: CLIENT_MESSAGE.READY } };
  if (message.type === CLIENT_MESSAGE.SELECT_LEVEL && typeof message.levelId === 'string' && message.levelId.length <= 32) return { ok: true, message: { type: CLIENT_MESSAGE.SELECT_LEVEL, levelId: message.levelId } };
  if (message.type === CLIENT_MESSAGE.RESULT_VOTE && ['RETRY', 'NEXT', 'SELECT'].includes(message.action)) return { ok: true, message: { type: CLIENT_MESSAGE.RESULT_VOTE, action: message.action } };
  if (message.type === CLIENT_MESSAGE.RESTART_VOTE && typeof message.agree === 'boolean') return { ok: true, message: { type: CLIENT_MESSAGE.RESTART_VOTE, agree: message.agree } };
  if (message.type === CLIENT_MESSAGE.LEAVE_GAME) return { ok: true, message: { type: CLIENT_MESSAGE.LEAVE_GAME } };
  if (message.type === CLIENT_MESSAGE.INPUT) {
    if (!Number.isSafeInteger(message.seq) || Number(message.seq) < 0 || Number(message.seq) > 1_000_000_000) return { ok: false, code: ERROR_CODE.INVALID_MESSAGE };
    return { ok: true, message: {
      type: CLIENT_MESSAGE.INPUT,
      seq: Number(message.seq),
      left: message.left === true,
      right: message.right === true,
      down: message.down === true,
      jump: message.jump === true,
      interact: message.interact === true,
    } };
  }
  return { ok: false, code: ERROR_CODE.INVALID_MESSAGE };
}
