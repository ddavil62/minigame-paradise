/**
 * @fileoverview 단어 입력창 관리.
 *
 * 입력 검증(한글 여부), 제출 이벤트 발생, 입력 상태 관리를 담당한다.
 */

/**
 * 입력값이 한글 완성형으로만 구성되어 있는지 검증한다.
 * @param {string} text
 * @returns {boolean}
 */
export function isHangulOnly(text) {
  return /^[가-힣]+$/.test(text);
}

/**
 * 거부 사유를 한국어 메시지로 변환한다.
 * @param {string} reason 거부 사유 코드
 * @returns {string} 한국어 메시지
 */
export function rejectReasonToKo(reason) {
  switch (reason) {
    case 'invalid':     return '사전에 없는 단어입니다.';
    case 'duplicate':   return '이미 사용한 단어입니다.';
    case 'wrong_start': return '잘못된 시작 글자입니다.';
    case 'not_korean':  return '한글 단어를 입력해주세요.';
    case 'not_your_turn': return '상대 차례입니다.';
    case 'wrong_state': return '지금은 단어를 제출할 수 없습니다.';
    case 'unsupported_length': return '2글자 이상의 단어를 입력하세요.';
    default:            return '단어가 거부되었습니다.';
  }
}
