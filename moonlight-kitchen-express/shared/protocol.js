/** @fileoverview 달빛 주방열차 WebSocket 메시지 상수와 엄격한 입력 검증을 정의한다. */

export const TICK_RATE = 30;
export const SNAPSHOT_RATE = 15;
export const MAX_PAYLOAD_BYTES = 8192;
export const CLIENT_MESSAGE = Object.freeze({ JOIN: 'JOIN', READY: 'READY', INPUT: 'INPUT', RESULT_VOTE: 'RESULT_VOTE', LEAVE_GAME: 'LEAVE_GAME' });
export const SERVER_MESSAGE = Object.freeze({ WELCOME: 'WELCOME', READY_STATE: 'READY_STATE', START: 'START', SNAPSHOT: 'SNAPSHOT', EVENT: 'EVENT', BUSY: 'BUSY', PAUSED: 'PAUSED', RESUMED: 'RESUMED', GAME_OVER: 'GAME_OVER', RESULT_VOTE_STATE: 'RESULT_VOTE_STATE', SESSION_ENDED: 'SESSION_ENDED', ERROR: 'ERROR' });
export const ERROR_CODE = Object.freeze({ INVALID_MESSAGE: 'INVALID_MESSAGE', JOIN_REQUIRED: 'JOIN_REQUIRED', ROOM_FULL: 'ROOM_FULL', RESUME_EXPIRED: 'RESUME_EXPIRED', SESSION_ACTIVE: 'SESSION_ACTIVE', RATE_LIMIT: 'RATE_LIMIT' });

/**
 * 클라이언트 메시지를 허용 필드만 남긴 안전한 객체로 검증한다.
 * @param {unknown} value 파싱된 JSON 값
 * @returns {{ok:true,value:object}|{ok:false,code:string}}
 */
export function validateClientMessage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.type !== 'string') return { ok: false, code: ERROR_CODE.INVALID_MESSAGE };
  if (value.type === CLIENT_MESSAGE.JOIN) {
    if (typeof value.name !== 'string' || value.name.trim().length < 1 || value.name.trim().length > 20 || !['ko', 'en'].includes(value.locale)) return { ok: false, code: ERROR_CODE.INVALID_MESSAGE };
    if (value.sessionToken !== undefined && (typeof value.sessionToken !== 'string' || value.sessionToken.length > 64)) return { ok: false, code: ERROR_CODE.INVALID_MESSAGE };
    if (value.requestedRole !== undefined && !['p1', 'p2'].includes(value.requestedRole)) return { ok: false, code: ERROR_CODE.INVALID_MESSAGE };
    return { ok: true, value: { type: value.type, name: value.name.trim(), locale: value.locale, sessionToken: value.sessionToken, requestedRole: value.requestedRole, readyFromLobby: value.readyFromLobby === true } };
  }
  if ([CLIENT_MESSAGE.READY, CLIENT_MESSAGE.LEAVE_GAME].includes(value.type)) return { ok: true, value: { type: value.type } };
  if (value.type === CLIENT_MESSAGE.RESULT_VOTE && ['RETRY', 'LOBBY'].includes(value.action)) return { ok: true, value: { type: value.type, action: value.action } };
  if (value.type === CLIENT_MESSAGE.INPUT) {
    const keys = ['up', 'down', 'left', 'right', 'interact', 'work', 'drop'];
    if (!Number.isSafeInteger(value.seq) || value.seq < 0 || keys.some((key) => typeof value[key] !== 'boolean')) return { ok: false, code: ERROR_CODE.INVALID_MESSAGE };
    return { ok: true, value: Object.fromEntries([['type', value.type], ['seq', value.seq], ...keys.map((key) => [key, value[key]])]) };
  }
  return { ok: false, code: ERROR_CODE.INVALID_MESSAGE };
}
