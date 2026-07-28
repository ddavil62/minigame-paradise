/**
 * @fileoverview 맞고 점수 계산 + 라운드 종료 배수 처리.
 *
 * 기본 점수 항목:
 *   광  : 3광=3점(비광 포함 시 2점), 4광=4점, 5광=15점
 *   띠  : 5장=1점, 1장당 +1점 누적, 홍단/청단/초단 각 3점
 *         (12월 비단은 별도 분류 — 띠 5장 모음에는 포함되지만 홍단 3장 등 색깔 단 점수에선 제외)
 *   끗  : 5장=1점, 1장당 +1점 누적, 고도리(2/4/8 매조·흑싸리·공산 끗 3장)=5점
 *   피  : 10장=1점, 1장당 +1점 누적 (쌍피는 2장으로 카운트)
 *
 * 라운드 종료 배수 (곱셈 누적):
 *   흔들기   : ×2 (선언자 측만)
 *   고박     : ×2 (해당 시 — 패배 시 패자 점수 ×2)
 *   광박     : ×2 (승자 광 3+ & 패자 광 0)
 *   피박     : ×2 (패자 피 ≤6)
 *   멍박     : ×2 (승자 끗 7장 이상)
 *   고 보너스: 1고 +1, 2고 +2, 3고 이후 ×2 누적
 */

/**
 * @typedef {object} ScoreBreakdown
 * @property {number} score        - 기본 점수
 * @property {number} gwang        - 광 장수
 * @property {number} tti          - 띠 장수
 * @property {number} kkeut        - 끗 장수
 * @property {number} piCount      - 피 카운트 (쌍피는 2)
 * @property {boolean} hasGodori
 * @property {boolean} hasHong
 * @property {boolean} hasCheong
 * @property {boolean} hasCho
 */

/**
 * 점수판(captured)에서 기본 점수와 분포를 계산한다.
 * @param {Array<{id?:string, type:string, subtype?:string}>} captured
 * @param {object} [opts]
 * @param {boolean} [opts.kkeutAsSsangpi] - true면 9월 술잔(m09_kkeut)을 쌍피로 카운트
 * @returns {ScoreBreakdown}
 */
export function calculateScore(captured, opts = {}) {
  let score = 0;
  // 9월 술잔 선택에 따라 m09_kkeut을 끗에서 빼고 쌍피로 옮긴다.
  let pool = captured;
  if (opts.kkeutAsSsangpi) {
    const m09Idx = pool.findIndex((c) => c.id === 'm09_kkeut');
    if (m09Idx >= 0) {
      pool = pool.slice();
      const m09Card = pool[m09Idx];
      pool[m09Idx] = { ...m09Card, type: 'pi', subtype: 'ssangpi' };
    }
  }
  const gwang = pool.filter((c) => c.type === 'gwang');
  const tti   = pool.filter((c) => c.type === 'tti');
  const kkeut = pool.filter((c) => c.type === 'kkeut');
  const pi    = pool.filter((c) => c.type === 'pi');
  // 조커: 2026-06-03 추가. captured에 들어가면 피 2장 가치 (쌍피 동일).
  // 광/끗/띠 묶음·고도리·홍단·청단·초단·비단에는 영향 없음.
  const joker = pool.filter((c) => c.type === 'joker');

  // ── 광 ─────────────────────────────────────────────────────
  const hasBigwang = gwang.some((c) => c.subtype === 'bigwang');
  if (gwang.length === 5)      score += 15;
  else if (gwang.length === 4) score += 4;
  else if (gwang.length === 3) score += hasBigwang ? 2 : 3;

  // ── 띠 ─────────────────────────────────────────────────────
  if (tti.length >= 5) score += 1 + (tti.length - 5);
  const hasHong   = tti.filter((c) => c.subtype === 'hong').length   >= 3;
  const hasCheong = tti.filter((c) => c.subtype === 'cheong').length >= 3;
  const hasCho    = tti.filter((c) => c.subtype === 'cho').length    >= 3;
  if (hasHong)   score += 3;
  if (hasCheong) score += 3;
  if (hasCho)    score += 3;

  // ── 끗 ─────────────────────────────────────────────────────
  if (kkeut.length >= 5) score += 1 + (kkeut.length - 5);
  const godoriCount = kkeut.filter((c) => c.subtype === 'godori').length;
  const hasGodori = godoriCount === 3;
  if (hasGodori) score += 5;

  // ── 피 ─────────────────────────────────────────────────────
  // 조커는 쌍피와 동일하게 1장당 +2 가치로 piCount에 합산 (2026-06-03).
  const piCount = pi.reduce((sum, c) => sum + (c.subtype === 'ssangpi' ? 2 : 1), 0)
                + (joker.length * 2);
  if (piCount >= 10) score += 1 + (piCount - 10);

  return {
    score,
    gwang: gwang.length,
    tti: tti.length,
    kkeut: kkeut.length,
    piCount,
    hasGodori,
    hasHong, hasCheong, hasCho,
  };
}

/**
 * 라운드 종료 시 배수 / 박 / 고 보너스를 적용한 최종 점수를 계산한다.
 *
 * @param {ScoreBreakdown} winner   - 승자 점수 분포
 * @param {ScoreBreakdown} loser    - 패자 점수 분포
 * @param {object} flags
 * @param {number} flags.winnerGoCount   - 승자가 부른 '고' 횟수
 * @param {boolean} flags.winnerShake    - 승자 흔들기 여부
 * @param {boolean} flags.loserShake     - 패자 흔들기 여부 (스톱한 측 입장의 추가 케이스 — 보통 미사용)
 * @param {boolean} flags.gobakApplies   - 고박 발동 여부 (고 부른 사람이 결국 패배)
 * @param {number}  flags.winnerPpeokCount - 승자가 라운드 동안 만든 뻑 개수 (×2^N 배수)
 * @param {boolean} [flags.firstPpeokBonus] - 첫뻑 보너스: 라운드 첫 뻑 생성자가 승자이면 +7 가산.
 * @param {boolean} [flags.sangtongBonus]   - 사통 보너스: 사통 선언으로 라운드 종료 시 +7 가산.
 * @param {'normal'|'sangtong'} [flags.settlementType='normal'] - 정산 유형.
 * @returns {{ finalScore:number, multiplier:number, reasons:string[],baseScore:number,bonusScore:number,settlementType:string }}
 */
export function applyFinalMultipliers(winner, loser, flags) {
  const settlementType = flags.settlementType
    || (flags.sangtongBonus ? 'sangtong' : 'normal');
  // 사통은 라운드 시작 즉시 끝나는 독립 정산이다. captured 분포나 이전 상태의
  // 고·흔들기·뻑·박 플래그를 일반 승리 계산에 흘려보내지 않는다.
  if (settlementType === 'sangtong') {
    return {
      finalScore: 7,
      multiplier: 1,
      reasons: ['사통 +7'],
      baseScore: 0,
      bonusScore: 7,
      settlementType,
    };
  }
  let base = winner.score;
  // 고 보너스(가산/배수 혼합):
  //   1고 +1, 2고 +2, 3고 이후 ×2 누적
  const reasons = [];
  let mult = 1;

  const go = flags.winnerGoCount || 0;
  if (go >= 1) {
    base += 1;
    reasons.push('1고 +1');
  }
  if (go >= 2) {
    base += 1; // 누적 +2
    reasons.push('2고 +1 (누적 +2)');
  }
  if (go >= 3) {
    mult *= Math.pow(2, go - 2);
    reasons.push(`${go}고 ×${Math.pow(2, go - 2)}`);
  }

  // 박 판정
  // 광박: 승자 광 ≥3 & 패자 광 0
  if (winner.gwang >= 3 && loser.gwang === 0) {
    mult *= 2;
    reasons.push('광박 ×2');
  }
  // 피박: 패자 피 ≤7 (나무위키 맞고 기준)
  if (loser.piCount <= 7) {
    mult *= 2;
    reasons.push('피박 ×2');
  }
  // 멍박: 승자가 끗 7장 이상을 모으면 패자의 끗 수와 무관하게 발동한다.
  if (winner.kkeut >= 7) {
    mult *= 2;
    reasons.push('멍박 ×2');
  }

  // 흔들기: 선언자가 승자인 경우만 ×2 (스펙 단순화)
  if (flags.winnerShake) {
    mult *= 2;
    reasons.push('흔들기 ×2');
  }

  // 뻑 배수: 1뻑 ×2, 2뻑 ×4, 3뻑은 즉시 승리(game.js)에서 처리되지만 다른 경로로
  // 라운드가 끝날 때(상대 스톱 등)도 ppeokCount만큼 ×2^N 적용.
  const ppCount = flags.winnerPpeokCount || 0;
  if (ppCount > 0) {
    const ppMult = Math.pow(2, ppCount);
    mult *= ppMult;
    reasons.push(`뻑 ${ppCount}개 ×${ppMult}`);
  }

  // 고박: 고를 불렀는데 결국 패배 → 점수 ×2 (해당 사람이 더 잃음)
  // 본 구현에서는 승자측 점수에 ×2로 부과한다 (패자가 그만큼 더 지불).
  if (flags.gobakApplies) {
    mult *= 2;
    reasons.push('고박 ×2');
  }

  // ── 5건 룰 보강 (2026-05-31) ──
  // 첫뻑 보너스: 라운드 첫 뻑을 만든 사람이 승자이면 +7점 base 가산 (multiplier 없이).
  if (flags.firstPpeokBonus) {
    base += 7;
    reasons.push('첫뻑 +7');
  }
  // 사통 보너스: 사통 선언으로 즉시 라운드 종료 시 +7점 base 가산.
  if (flags.sangtongBonus) {
    base += 7;
    reasons.push('사통 +7');
  }

  const finalScore = base * mult;
  return {
    finalScore,
    multiplier: mult,
    reasons,
    baseScore: base,
    bonusScore: base - winner.score,
    settlementType,
  };
}
