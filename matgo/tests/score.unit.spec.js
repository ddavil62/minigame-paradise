/**
 * @fileoverview 맞고 점수 계산 단위 테스트 — 룰북 §5 족보 기준.
 *
 * 브라우저 불필요. Playwright test runner가 Node.js에서 직접 실행.
 * 서버 미시작 상태에서도 단독 실행 가능.
 *
 * 룰 기준: .claude/specs/2026-05-30-matgo-rulebook.md
 *
 * 실행: npx playwright test tests/score.unit.spec.js --reporter=list
 *       (matgo/ 디렉토리에서 실행)
 */

import { test, expect } from '@playwright/test';
import { calculateScore, applyFinalMultipliers } from '../score.js';

// ── 카드 팩토리 (calculateScore에 필요한 최소 필드만) ────────────────────────
const mk = (type, subtype) => ({ type, ...(subtype ? { subtype } : {}) });
const gwang   = () => mk('gwang');
const bigwang = () => mk('gwang', 'bigwang'); // 12월 비광
const tHong   = () => mk('tti', 'hong');      // 홍단 (1/2/3월)
const tCheong = () => mk('tti', 'cheong');    // 청단 (6/9/10월)
const tCho    = () => mk('tti', 'cho');       // 초단 (4/5/7월)
const tBi     = () => mk('tti', 'bi');        // 비단 (12월)
const kkeut   = () => mk('kkeut');
const godori  = () => mk('kkeut', 'godori');  // 고도리 (2/4/8월)
const pi      = () => mk('pi');
const ssangpi = () => mk('pi', 'ssangpi');    // 쌍피 (9/11/12월)
/** 9월 술잔 — id가 'm09_kkeut'이어야 kkeutAsSsangpi 전환 로직이 작동한다. */
const m09kkeut = () => ({ id: 'm09_kkeut', type: 'kkeut' });

/** @param {() => object} fn @param {number} n */
const repeat = (fn, n) => Array.from({ length: n }, fn);

// ============================================================
// §1 광 (Gwang) — 룰북 §5.1
// ============================================================

test('S-G1: 3광(비광 없음) = 3점', () => {
  const r = calculateScore([gwang(), gwang(), gwang()]);
  expect(r.score).toBe(3);
  expect(r.gwang).toBe(3);
});

test('S-G2: 3광(비광 포함) = 2점', () => {
  // 12월 비광이 포함된 3광은 2점
  const r = calculateScore([gwang(), gwang(), bigwang()]);
  expect(r.score).toBe(2);
  expect(r.gwang).toBe(3);
});

test('S-G3: 4광 = 4점 (비광 여부 무관)', () => {
  const r = calculateScore([gwang(), gwang(), gwang(), bigwang()]);
  expect(r.score).toBe(4);
  expect(r.gwang).toBe(4);
});

test('S-G4: 5광 = 15점', () => {
  const r = calculateScore([gwang(), gwang(), gwang(), gwang(), bigwang()]);
  expect(r.score).toBe(15);
  expect(r.gwang).toBe(5);
});

test('S-G5: 2광 = 0점', () => {
  const r = calculateScore([gwang(), bigwang()]);
  expect(r.score).toBe(0);
  expect(r.gwang).toBe(2);
});

// ============================================================
// §2 띠 (Tti) — 룰북 §5.2
// ============================================================

test('S-T1: 4띠(단 미달) = 0점', () => {
  // 홍단 2장 + 청단 1장 + 초단 1장 = 4띠 → 단 점수 없음(각 2장 이하), 5장 미달 → 0점
  const r = calculateScore([tHong(), tHong(), tCheong(), tCho()]);
  expect(r.score).toBe(0);
  expect(r.tti).toBe(4);
  expect(r.hasHong).toBe(false);
});

test('S-T2: 5띠(혼합) = 1점', () => {
  // 홍단 3 + 청단 1 + 초단 1 = 5띠
  const cards = [tHong(), tHong(), tHong(), tCheong(), tCho()];
  const r = calculateScore(cards);
  expect(r.score).toBe(4); // 홍단 3점 + 5띠 1점 = 4점
  expect(r.tti).toBe(5);
});

test('S-T3: 5띠(단 없음) = 1점', () => {
  // 홍단 2 + 비단 + 청단 1 + 초단 1 = 5띠, 하지만 홍단 2장으로 홍단 미완성
  const cards = [tHong(), tHong(), tBi(), tCheong(), tCho()];
  const r = calculateScore(cards);
  expect(r.score).toBe(1); // 단 없음, 5띠 기본 1점
  expect(r.hasHong).toBe(false);
});

test('S-T4: 6띠 = 2점', () => {
  const cards = [tHong(), tHong(), tHong(), tCheong(), tCho(), tBi()];
  const r = calculateScore(cards);
  expect(r.score).toBe(5); // 홍단 3점 + 6띠 2점 = 5점
  expect(r.tti).toBe(6);
});

test('S-T5: 홍단(3장) = 3점, hasHong=true', () => {
  const r = calculateScore([tHong(), tHong(), tHong()]);
  expect(r.score).toBe(3);
  expect(r.hasHong).toBe(true);
  expect(r.hasCheong).toBe(false);
  expect(r.hasCho).toBe(false);
});

test('S-T6: 청단(3장) = 3점, hasCheong=true', () => {
  const r = calculateScore([tCheong(), tCheong(), tCheong()]);
  expect(r.score).toBe(3);
  expect(r.hasCheong).toBe(true);
});

test('S-T7: 초단(3장) = 3점, hasCho=true', () => {
  const r = calculateScore([tCho(), tCho(), tCho()]);
  expect(r.score).toBe(3);
  expect(r.hasCho).toBe(true);
});

test('S-T8: 홍단+청단+초단(9장) = 단3종×3점 + 9띠기본5점 = 14점', () => {
  // 9띠: 1+(9-5)=5점 기본 / 홍단+청단+초단=9점 → 합 14점
  const cards = [...repeat(tHong, 3), ...repeat(tCheong, 3), ...repeat(tCho, 3)];
  const r = calculateScore(cards);
  expect(r.score).toBe(14);
  expect(r.hasHong).toBe(true);
  expect(r.hasCheong).toBe(true);
  expect(r.hasCho).toBe(true);
});

// ============================================================
// §3 끗 (Kkeut) — 룰북 §5.3
// ============================================================

test('S-K1: 4끗 = 0점 (5장 미달)', () => {
  const r = calculateScore(repeat(kkeut, 4));
  expect(r.score).toBe(0);
  expect(r.kkeut).toBe(4);
});

test('S-K2: 5끗 = 1점', () => {
  const r = calculateScore(repeat(kkeut, 5));
  expect(r.score).toBe(1);
  expect(r.kkeut).toBe(5);
});

test('S-K3: 6끗 = 2점', () => {
  const r = calculateScore(repeat(kkeut, 6));
  expect(r.score).toBe(2);
  expect(r.kkeut).toBe(6);
});

test('S-K4: 고도리(2/4/8월 끗 3장) = 5점, hasGodori=true', () => {
  const r = calculateScore([godori(), godori(), godori()]);
  expect(r.score).toBe(5);
  expect(r.hasGodori).toBe(true);
});

test('S-K5: 고도리+끗3장추가(총6끗) = 5+2 = 7점', () => {
  // 6끗 기본: 1+(6-5)=2점 + 고도리 5점 = 7점
  const cards = [godori(), godori(), godori(), kkeut(), kkeut(), kkeut()];
  const r = calculateScore(cards);
  expect(r.score).toBe(7);
  expect(r.hasGodori).toBe(true);
  expect(r.kkeut).toBe(6);
});

test('S-K6: 고도리 2장(미달) = 0점, hasGodori=false', () => {
  const r = calculateScore([godori(), godori()]);
  expect(r.score).toBe(0);
  expect(r.hasGodori).toBe(false);
});

// ============================================================
// §4 피 (Pi) — 룰북 §5.4
// ============================================================

test('S-P1: 9피 = 0점 (10장 미달)', () => {
  const r = calculateScore(repeat(pi, 9));
  expect(r.score).toBe(0);
  expect(r.piCount).toBe(9);
});

test('S-P2: 10피 = 1점', () => {
  const r = calculateScore(repeat(pi, 10));
  expect(r.score).toBe(1);
  expect(r.piCount).toBe(10);
});

test('S-P3: 11피 = 2점', () => {
  const r = calculateScore(repeat(pi, 11));
  expect(r.score).toBe(2);
  expect(r.piCount).toBe(11);
});

test('S-P4: 15피 = 6점', () => {
  const r = calculateScore(repeat(pi, 15));
  expect(r.score).toBe(6);
  expect(r.piCount).toBe(15);
});

test('S-P5: 쌍피 1장 = 피 2장 카운트 (8피+쌍피 = 10카운트 = 1점)', () => {
  const cards = [...repeat(pi, 8), ssangpi()];
  const r = calculateScore(cards);
  expect(r.piCount).toBe(10);
  expect(r.score).toBe(1);
});

test('S-P6: 쌍피 2장 = 각각 2 카운트 (6피+쌍피2 = 10카운트 = 1점)', () => {
  const cards = [...repeat(pi, 6), ssangpi(), ssangpi()];
  const r = calculateScore(cards);
  expect(r.piCount).toBe(10);
  expect(r.score).toBe(1);
});

test('S-P7: 9월 술잔 kkeut 선택 → 끗으로 카운트 (4끗+술잔=5끗=1점)', () => {
  const cards = [m09kkeut(), ...repeat(kkeut, 4)];
  const r = calculateScore(cards, { kkeutAsSsangpi: false });
  expect(r.kkeut).toBe(5);
  expect(r.score).toBe(1);
  expect(r.piCount).toBe(0);
});

test('S-P8: 9월 술잔 ssangpi 선택 → 피 +2 카운트 (8피+술잔 = 10카운트 = 1점)', () => {
  // m09_kkeut을 ssangpi로 취급 → piCount = 8+2 = 10
  const cards = [...repeat(pi, 8), m09kkeut()];
  const r = calculateScore(cards, { kkeutAsSsangpi: true });
  expect(r.piCount).toBe(10);
  expect(r.kkeut).toBe(0); // 끗 배열에서 제외됨
  expect(r.score).toBe(1);
});

// ============================================================
// §5 복합 시나리오
// ============================================================

test('S-C1: 3광+홍단 = 3+3 = 6점', () => {
  const cards = [gwang(), gwang(), gwang(), tHong(), tHong(), tHong()];
  const r = calculateScore(cards);
  expect(r.score).toBe(6);
});

test('S-C2: 고도리+초단+10피 = 5+3+1 = 9점', () => {
  const cards = [...repeat(godori, 3), ...repeat(tCho, 3), ...repeat(pi, 10)];
  const r = calculateScore(cards);
  expect(r.score).toBe(9);
});

test('S-C3: 0점 케이스 — 광2+끗4+비단4+피9', () => {
  // 비단(12월 비단)은 홍단/청단/초단에 해당 없음 → 단 점수 미발동
  const cards = [gwang(), bigwang(), ...repeat(kkeut, 4), ...repeat(tBi, 4), ...repeat(pi, 9)];
  const r = calculateScore(cards);
  expect(r.score).toBe(0);
});

test('S-C4: ScoreBreakdown 반환 구조 필드 검증', () => {
  const r = calculateScore([gwang()]);
  expect(typeof r.score).toBe('number');
  expect(typeof r.gwang).toBe('number');
  expect(typeof r.tti).toBe('number');
  expect(typeof r.kkeut).toBe('number');
  expect(typeof r.piCount).toBe('number');
  expect(typeof r.hasGodori).toBe('boolean');
  expect(typeof r.hasHong).toBe('boolean');
  expect(typeof r.hasCheong).toBe('boolean');
  expect(typeof r.hasCho).toBe('boolean');
});

// ============================================================
// §6 applyFinalMultipliers — 헬퍼
// ============================================================

/** 기본 승자 ScoreBreakdown 생성 (필드 override 가능). */
const mkW = (o = {}) => ({
  score: 7, gwang: 0, tti: 0, kkeut: 5, piCount: 0,
  hasGodori: false, hasHong: false, hasCheong: false, hasCho: false,
  ...o,
});
/** 기본 패자 ScoreBreakdown 생성 (필드 override 가능). */
const mkL = (o = {}) => ({
  score: 0, gwang: 0, tti: 0, kkeut: 5, piCount: 10,
  hasGodori: false, hasHong: false, hasCheong: false, hasCho: false,
  ...o,
});
const noF = { winnerGoCount: 0, winnerShake: false, loserShake: false, gobakApplies: false };

// ============================================================
// §7 고 보너스 — 룰북 §6.1
// ============================================================

test('M-01: 고 없음 + 박 없음 → finalScore=7, mult=1, reasons=[]', () => {
  const r = applyFinalMultipliers(mkW(), mkL(), noF);
  expect(r.finalScore).toBe(7);
  expect(r.multiplier).toBe(1);
  expect(r.reasons).toHaveLength(0);
});

test('M-02: 1고 → 기본+1 = 8점', () => {
  const r = applyFinalMultipliers(mkW({ score: 7 }), mkL(), { ...noF, winnerGoCount: 1 });
  expect(r.finalScore).toBe(8);
  expect(r.multiplier).toBe(1);
  expect(r.reasons).toContain('1고 +1');
});

test('M-03: 2고 → 기본+2 = 9점', () => {
  const r = applyFinalMultipliers(mkW({ score: 7 }), mkL(), { ...noF, winnerGoCount: 2 });
  expect(r.finalScore).toBe(9);
  expect(r.multiplier).toBe(1);
  expect(r.reasons).toContain('2고 +1 (누적 +2)');
});

test('M-04: 3고 → (7+2)×2 = 18점, mult=2', () => {
  const r = applyFinalMultipliers(mkW({ score: 7 }), mkL(), { ...noF, winnerGoCount: 3 });
  expect(r.finalScore).toBe(18);
  expect(r.multiplier).toBe(2);
});

test('M-05: 4고 → (7+2)×4 = 36점, mult=4', () => {
  const r = applyFinalMultipliers(mkW({ score: 7 }), mkL(), { ...noF, winnerGoCount: 4 });
  expect(r.finalScore).toBe(36);
  expect(r.multiplier).toBe(4);
});

// ============================================================
// §8 박 판정 — 룰북 §6.2
// ============================================================

test('M-06: 피박 발동 — 패자 piCount=7 → ×2', () => {
  // 룰북 §6.2: 피박 기준 패자 피 ≤7장
  const r = applyFinalMultipliers(mkW(), mkL({ piCount: 7, kkeut: 5 }), noF);
  expect(r.multiplier).toBe(2);
  expect(r.reasons).toContain('피박 ×2');
});

test('M-07: 피박 미발동 — 패자 piCount=8', () => {
  const r = applyFinalMultipliers(mkW(), mkL({ piCount: 8, kkeut: 5 }), noF);
  expect(r.reasons).not.toContain('피박 ×2');
});

test('M-08: 피박 경계값 — piCount=7 발동 / piCount=8 미발동', () => {
  const r7 = applyFinalMultipliers(mkW(), mkL({ piCount: 7, kkeut: 5 }), noF);
  const r8 = applyFinalMultipliers(mkW(), mkL({ piCount: 8, kkeut: 5 }), noF);
  expect(r7.multiplier).toBe(2);
  expect(r8.multiplier).toBe(1);
});

test('M-09: 피박 범위 검증 — piCount 0~7 모두 발동', () => {
  // 룰북: 패자 피 ≤7 → 피박. 0~7 전 범위 검증.
  for (let n = 0; n <= 7; n++) {
    const r = applyFinalMultipliers(mkW(), mkL({ piCount: n, kkeut: 5 }), noF);
    expect(r.reasons, `piCount=${n}`).toContain('피박 ×2');
  }
});

test('M-10: 광박 발동 — 승자 gwang≥3 & 패자 gwang=0 → ×2', () => {
  const r = applyFinalMultipliers(mkW({ gwang: 3 }), mkL({ gwang: 0, piCount: 10 }), noF);
  expect(r.multiplier).toBe(2);
  expect(r.reasons).toContain('광박 ×2');
});

test('M-11: 광박 미발동 — 승자 gwang=2', () => {
  const r = applyFinalMultipliers(mkW({ gwang: 2 }), mkL({ gwang: 0, piCount: 10 }), noF);
  expect(r.reasons).not.toContain('광박 ×2');
});

test('M-12: 광박 미발동 — 패자 gwang=1', () => {
  const r = applyFinalMultipliers(mkW({ gwang: 3 }), mkL({ gwang: 1, piCount: 10 }), noF);
  expect(r.reasons).not.toContain('광박 ×2');
});

test('M-13: 멍박 발동 — 패자 kkeut=0 → ×2', () => {
  // 룰북 §6.2: 멍박 기준 패자 끗 0장
  const r = applyFinalMultipliers(mkW(), mkL({ kkeut: 0, piCount: 10 }), noF);
  expect(r.multiplier).toBe(2);
  expect(r.reasons).toContain('멍박 ×2');
});

test('M-14: 멍박 미발동 — 패자 kkeut=1', () => {
  const r = applyFinalMultipliers(mkW(), mkL({ kkeut: 1, piCount: 10 }), noF);
  expect(r.reasons).not.toContain('멍박 ×2');
});

test('M-15: 흔들기(winnerShake) → ×2', () => {
  const r = applyFinalMultipliers(mkW(), mkL({ piCount: 10 }), { ...noF, winnerShake: true });
  expect(r.multiplier).toBe(2);
  expect(r.reasons).toContain('흔들기 ×2');
});

test('M-16: 고박(gobakApplies) → ×2', () => {
  const r = applyFinalMultipliers(mkW(), mkL({ piCount: 10 }), { ...noF, gobakApplies: true });
  expect(r.multiplier).toBe(2);
  expect(r.reasons).toContain('고박 ×2');
});

// ============================================================
// §9 복합 배수
// ============================================================

test('M-17: 피박+멍박 → ×4', () => {
  // 패자 piCount=5(피박) + kkeut=0(멍박) → 2×2=4
  const r = applyFinalMultipliers(mkW(), mkL({ piCount: 5, kkeut: 0 }), noF);
  expect(r.multiplier).toBe(4);
});

test('M-18: 광박+피박+멍박 → ×8', () => {
  const r = applyFinalMultipliers(
    mkW({ gwang: 3 }),
    mkL({ gwang: 0, piCount: 5, kkeut: 0 }),
    noF,
  );
  expect(r.multiplier).toBe(8);
});

test('M-19: 3고+피박 → (7+2)×2(3고)×2(피박) = 36점', () => {
  const r = applyFinalMultipliers(
    mkW({ score: 7 }),
    mkL({ piCount: 5, kkeut: 5 }),
    { ...noF, winnerGoCount: 3 },
  );
  // base=7+2=9, mult=2(3고)×2(피박)=4, final=36
  expect(r.finalScore).toBe(36);
  expect(r.multiplier).toBe(4);
});

test('M-20: 흔들기+고박 → ×4', () => {
  const r = applyFinalMultipliers(mkW(), mkL({ piCount: 10 }), {
    ...noF, winnerShake: true, gobakApplies: true,
  });
  expect(r.multiplier).toBe(4);
});

test('M-21: 모든 박(광+피+멍+흔들기+고박) 1고 → mult=32, finalScore=8×32=256', () => {
  // base=7+1=8 (1고+1), mult=광×피×멍×흔×고박=2^5=32
  const r = applyFinalMultipliers(
    mkW({ score: 7, gwang: 3 }),
    mkL({ gwang: 0, piCount: 5, kkeut: 0 }),
    { winnerGoCount: 1, winnerShake: true, loserShake: false, gobakApplies: true },
  );
  expect(r.multiplier).toBe(32);
  expect(r.finalScore).toBe(8 * 32);
});

// ============================================================
// §10 첫뻑/사통 보너스 — 2026-05-31 신규
// ============================================================

test('M-22: 첫뻑 보너스 +7 → base에 가산, reasons에 "첫뻑 +7"', () => {
  const r = applyFinalMultipliers(mkW({ score: 7 }), mkL(), { ...noF, firstPpeokBonus: true });
  expect(r.finalScore).toBe(7 + 7);
  expect(r.multiplier).toBe(1);
  expect(r.reasons).toContain('첫뻑 +7');
});

test('M-23: 첫뻑 + 피박 → base=7+7=14, mult=2, final=28', () => {
  const r = applyFinalMultipliers(
    mkW({ score: 7 }),
    mkL({ piCount: 5, kkeut: 5 }),
    { ...noF, firstPpeokBonus: true },
  );
  expect(r.multiplier).toBe(2);
  expect(r.finalScore).toBe(14 * 2);
});

test('M-24: 사통 보너스 +7 → base 가산, reasons에 "사통 +7"', () => {
  const r = applyFinalMultipliers(mkW({ score: 0 }), mkL({ score: 0 }), { ...noF, sangtongBonus: true });
  expect(r.finalScore).toBe(7);
  expect(r.multiplier).toBe(1);
  expect(r.reasons).toContain('사통 +7');
});

test('M-25: 첫뻑 + 사통 동시 → 둘 다 가산 (base = score+7+7)', () => {
  const r = applyFinalMultipliers(mkW({ score: 0 }), mkL(), {
    ...noF, firstPpeokBonus: true, sangtongBonus: true,
  });
  expect(r.finalScore).toBe(14);
  expect(r.reasons).toContain('첫뻑 +7');
  expect(r.reasons).toContain('사통 +7');
});
