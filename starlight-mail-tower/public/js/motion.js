/**
 * @fileoverview Canvas와 DOM에서 공유하는 감소 모션 계산을 순수 함수로 제공한다.
 */

/**
 * 감소 모션 결승의 단일 교차 전환 알파를 계산한다.
 * @param {number} rawAge 결승 시작 뒤 경과 밀리초
 * @param {boolean} reducedMotion 감소 모션 활성 여부
 * @returns {number} 0~1 교차 전환 알파
 */
export function getFinishCrossfadeAlpha(rawAge, reducedMotion) {
  return reducedMotion ? Math.max(0, Math.min(1, rawAge / 200)) : 1;
}
