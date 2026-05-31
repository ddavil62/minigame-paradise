/**
 * @fileoverview YR-C1 시리즈 — 윷가락 결과 (30개)
 * 룰북 참조: minigames/yutnori/docs/RULEBOOK.md §3 (윷가락 결과 표) + §13-3 §13-4
 *
 * 단위 테스트: throwYutSticks를 직접 import. withRandom으로 결정론 주입.
 * 서버 불필요. 기존 U-01~U-17과 ID/주석은 독립.
 */

import { test, expect } from 'playwright/test';
import { throwYutSticks } from '../server.js';
import { withRandom } from './rulebook-helpers.js';

// ── §3-1 구조 검증 ──────────────────────────────────────────────────

test('YR-C1-001: throwYutSticks 반환 구조 — 필수 필드 5개 (§3-2)', () => {
  // Given: 윷가락을 한 번 던짐
  // When: 반환 객체 검사
  // Then: sticks/result/steps/bonus/markedIndex 필드가 모두 존재
  const r = throwYutSticks();
  expect(r).toHaveProperty('sticks');
  expect(r).toHaveProperty('result');
  expect(r).toHaveProperty('steps');
  expect(r).toHaveProperty('bonus');
  expect(r).toHaveProperty('markedIndex');
});

test('YR-C1-002: sticks 배열 길이는 4 (§3-1)', () => {
  // Given: 표준 윷가락은 4개
  // When: sticks 배열을 확인
  // Then: 길이 4
  const r = throwYutSticks();
  expect(Array.isArray(r.sticks)).toBe(true);
  expect(r.sticks).toHaveLength(4);
});

test('YR-C1-003: sticks 각 값은 0 또는 1 (§3-1)', () => {
  // Given: 각 가락은 앞(1)/뒤(0) 두 상태
  // When: 30회 던지며 sticks 값 검사
  // Then: 모두 0 또는 1
  for (let i = 0; i < 30; i++) {
    const r = throwYutSticks();
    for (const s of r.sticks) {
      expect(s === 0 || s === 1).toBe(true);
    }
  }
});

test('YR-C1-004: markedIndex는 항상 0 (마크 가락 고정) (§3-1)', () => {
  // Given: 마크 가락 인덱스는 상수(MARKED_STICK_INDEX=0)
  // When: 여러 번 던짐
  // Then: markedIndex는 항상 0
  for (let i = 0; i < 10; i++) {
    expect(throwYutSticks().markedIndex).toBe(0);
  }
});

test('YR-C1-005: bonus 필드는 boolean (§3-2)', () => {
  // Given: 결과별 보너스 여부
  // When: 여러 번 던짐
  // Then: bonus는 항상 boolean
  for (let i = 0; i < 10; i++) {
    expect(typeof throwYutSticks().bonus).toBe('boolean');
  }
});

// ── §3-2 결과 매핑 (결정론) ────────────────────────────────────────

test('YR-C1-006: fronts=0 → 모 (steps=5, bonus=true) (§3-2)', () => {
  // Given: 4개 모두 뒷면 (Math.random>=0.5)
  // When: throwYutSticks 호출
  // Then: 모, 5칸, 보너스 발생
  const r = withRandom([0.9, 0.9, 0.9, 0.9], () => throwYutSticks());
  expect(r.result).toBe('mo');
  expect(r.steps).toBe(5);
  expect(r.bonus).toBe(true);
  expect(r.sticks).toEqual([0, 0, 0, 0]);
});

test('YR-C1-007: sticks=[1,0,0,0] → 백도 (steps=-1, bonus=false) (§3-3)', () => {
  // Given: 마크 가락(idx 0)만 앞면
  // When: 한 번 던짐
  // Then: 백도(-1칸), 보너스 없음
  const r = withRandom([0.1, 0.9, 0.9, 0.9], () => throwYutSticks());
  expect(r.result).toBe('backdo');
  expect(r.steps).toBe(-1);
  expect(r.bonus).toBe(false);
  expect(r.sticks).toEqual([1, 0, 0, 0]);
});

test('YR-C1-008: sticks=[0,1,0,0] → 도 (steps=1) (§3-2)', () => {
  // Given: 비마크 가락(idx 1)만 앞면 → 도
  // When: 한 번 던짐
  // Then: 도, 1칸
  const r = withRandom([0.9, 0.1, 0.9, 0.9], () => throwYutSticks());
  expect(r.result).toBe('do');
  expect(r.steps).toBe(1);
});

test('YR-C1-009: sticks=[0,0,1,0] → 도 (마크 뒤, 비마크 앞) (§3-2)', () => {
  // Given: 비마크 가락(idx 2)만 앞면
  // When: 한 번 던짐
  // Then: 도 (백도 아님 — 앞면이 마크 가락이 아니므로)
  const r = withRandom([0.9, 0.9, 0.1, 0.9], () => throwYutSticks());
  expect(r.result).toBe('do');
  expect(r.sticks).toEqual([0, 0, 1, 0]);
});

test('YR-C1-010: sticks=[0,0,0,1] → 도 (§3-2)', () => {
  // Given: 비마크 가락(idx 3)만 앞면
  // When: 한 번 던짐
  // Then: 도
  const r = withRandom([0.9, 0.9, 0.9, 0.1], () => throwYutSticks());
  expect(r.result).toBe('do');
  expect(r.sticks).toEqual([0, 0, 0, 1]);
});

test('YR-C1-011: sticks=[1,1,0,0] → 개 (steps=2) (§3-2)', () => {
  // Given: 앞면 2개
  // When: 한 번 던짐
  // Then: 개, 2칸, 보너스 없음
  const r = withRandom([0.1, 0.1, 0.9, 0.9], () => throwYutSticks());
  expect(r.result).toBe('gae');
  expect(r.steps).toBe(2);
  expect(r.bonus).toBe(false);
});

test('YR-C1-012: sticks=[0,1,1,0] → 개 (마크 가락 뒤) (§3-2)', () => {
  // Given: 비마크 가락 2개 앞면
  // When: 한 번 던짐
  // Then: 개 (마크 가락 위치와 무관)
  const r = withRandom([0.9, 0.1, 0.1, 0.9], () => throwYutSticks());
  expect(r.result).toBe('gae');
  expect(r.sticks).toEqual([0, 1, 1, 0]);
});

test('YR-C1-013: sticks=[1,1,1,0] → 걸 (steps=3) (§3-2)', () => {
  // Given: 앞면 3개 (마크 가락 포함)
  // When: 한 번 던짐
  // Then: 걸, 3칸
  const r = withRandom([0.1, 0.1, 0.1, 0.9], () => throwYutSticks());
  expect(r.result).toBe('geol');
  expect(r.steps).toBe(3);
  expect(r.bonus).toBe(false);
});

test('YR-C1-014: sticks=[0,1,1,1] → 걸 (마크 가락 뒷면) (§3-2)', () => {
  // Given: 마크 가락 뒷면, 비마크 3개 앞면
  // When: 한 번 던짐
  // Then: 걸
  const r = withRandom([0.9, 0.1, 0.1, 0.1], () => throwYutSticks());
  expect(r.result).toBe('geol');
  expect(r.sticks).toEqual([0, 1, 1, 1]);
});

test('YR-C1-015: sticks=[1,1,1,1] → 윷 (steps=4, bonus=true) (§3-2)', () => {
  // Given: 4개 모두 앞면
  // When: 한 번 던짐
  // Then: 윷, 4칸, 보너스 발생
  const r = withRandom([0.1, 0.1, 0.1, 0.1], () => throwYutSticks());
  expect(r.result).toBe('yut');
  expect(r.steps).toBe(4);
  expect(r.bonus).toBe(true);
});

test('YR-C1-016: bonus=true는 윷/모에서만 발생 (§3-2 §6-1)', () => {
  // Given: 보너스 규칙은 윷·모 전용
  // When: 200회 던지기
  // Then: 결과별 bonus 값이 룰북과 일치
  const bonusTrue = ['yut', 'mo'];
  const bonusFalse = ['backdo', 'do', 'gae', 'geol'];
  for (let i = 0; i < 200; i++) {
    const r = throwYutSticks();
    if (bonusTrue.includes(r.result)) expect(r.bonus).toBe(true);
    if (bonusFalse.includes(r.result)) expect(r.bonus).toBe(false);
  }
});

test('YR-C1-017: 1000회 던지기에서 6가지 결과 모두 등장 (§3-2)', () => {
  // Given: 6가지 결과 (backdo/do/gae/geol/yut/mo)
  // When: 1000회 던지기
  // Then: 모든 결과가 최소 1회 등장
  const seen = new Set();
  for (let i = 0; i < 1000; i++) {
    seen.add(throwYutSticks().result);
  }
  expect(seen.has('backdo')).toBe(true);
  expect(seen.has('do')).toBe(true);
  expect(seen.has('gae')).toBe(true);
  expect(seen.has('geol')).toBe(true);
  expect(seen.has('yut')).toBe(true);
  expect(seen.has('mo')).toBe(true);
});

// ── §3-3 백도 발동 조건 ────────────────────────────────────────────

test('YR-C1-018: 백도 발동 조건 — 유일 앞면이 마크 가락이어야 (§3-3)', () => {
  // Given: 마크 가락만 앞면, 나머지 뒷면 (sticks=[1,0,0,0])
  // When: throwYutSticks
  // Then: 백도 발동
  const r = withRandom([0.1, 0.9, 0.9, 0.9], () => throwYutSticks());
  expect(r.result).toBe('backdo');
  expect(r.sticks[r.markedIndex]).toBe(1);
});

test('YR-C1-019: fronts=1이지만 앞면이 비마크면 도 (백도 아님) (§3-3)', () => {
  // Given: 마크 가락 뒷면, 비마크 1개만 앞면
  // When: throwYutSticks
  // Then: 도 (백도 X)
  const r = withRandom([0.9, 0.9, 0.1, 0.9], () => throwYutSticks());
  expect(r.result).toBe('do');
  expect(r.sticks[r.markedIndex]).toBe(0);
});

test('YR-C1-020: fronts=2 → 개 (마크 위치 무관) (§3-2)', () => {
  // Given: 앞면 2개 (어느 가락이든)
  // When: 마크 앞 + 비마크 1 vs 비마크 2 두 케이스 모두 검증
  // Then: 둘 다 개
  const r1 = withRandom([0.1, 0.1, 0.9, 0.9], () => throwYutSticks());
  const r2 = withRandom([0.9, 0.9, 0.1, 0.1], () => throwYutSticks());
  expect(r1.result).toBe('gae');
  expect(r2.result).toBe('gae');
});

test('YR-C1-021: fronts=3 → 걸 (마크 위치 무관) (§3-2)', () => {
  // Given: 앞면 3개 (마크 포함/미포함 모두)
  // When: 두 케이스 검증
  // Then: 둘 다 걸
  const r1 = withRandom([0.1, 0.1, 0.1, 0.9], () => throwYutSticks());
  const r2 = withRandom([0.9, 0.1, 0.1, 0.1], () => throwYutSticks());
  expect(r1.result).toBe('geol');
  expect(r2.result).toBe('geol');
});

// ── §13-4 매핑 회귀 가드 (Phase 2 → 2.1 핫픽스 방지) ────────────────

test('YR-C1-022: 회귀 가드 — sticks=[1,0,0,0] steps=-1 (백도) (§3-2 §13-4)', () => {
  // Given: 마크 가락 유일 앞면
  // When: throwYutSticks
  // Then: steps=-1 (Phase 2 잘못된 매핑으로 회귀하지 않음)
  const r = withRandom([0.1, 0.9, 0.9, 0.9], () => throwYutSticks());
  expect(r.steps).toBe(-1);
});

test('YR-C1-023: 회귀 가드 — sticks=[1,1,1,1] steps=4 (윷) (§3-2 §13-4)', () => {
  // Given: 4개 모두 앞면
  // When: throwYutSticks
  // Then: steps=4 (Phase 2 sticks=[1,1,1,1]→모(5칸) 회귀 방지)
  const r = withRandom([0.1, 0.1, 0.1, 0.1], () => throwYutSticks());
  expect(r.steps).toBe(4);
});

test('YR-C1-024: 회귀 가드 — sticks=[0,0,0,0] steps=5 (모) (§3-2 §13-4)', () => {
  // Given: 4개 모두 뒷면
  // When: throwYutSticks
  // Then: steps=5 (Phase 2 sticks=[0,0,0,0]→윷(4칸) 회귀 방지)
  const r = withRandom([0.9, 0.9, 0.9, 0.9], () => throwYutSticks());
  expect(r.steps).toBe(5);
});

// ── §13-3 N=5000 분포 ──────────────────────────────────────────────

/**
 * 5000회 던져 결과별 카운트를 집계한다 (분포 테스트 공용).
 * @returns {Record<string, number>}
 */
function rollDistribution(n) {
  const counts = { backdo: 0, do: 0, gae: 0, geol: 0, yut: 0, mo: 0 };
  for (let i = 0; i < n; i++) {
    counts[throwYutSticks().result] += 1;
  }
  return counts;
}

test('YR-C1-025: 5000회 분포 — 백도 4~9% (이론 6.25%) (§3-2 §13-3)', () => {
  // Given: 백도 이론 확률 1/16 ≈ 6.25%
  // When: 5000회 던지기 분포
  // Then: 4% ~ 9% 범위 (±3%pt 허용)
  const counts = rollDistribution(5000);
  const pct = (counts.backdo / 5000) * 100;
  expect(pct).toBeGreaterThanOrEqual(4);
  expect(pct).toBeLessThanOrEqual(9);
});

test('YR-C1-026: 5000회 분포 — 도 14~23% (이론 18.75%) (§3-2 §13-3)', () => {
  // Given: 도 이론 확률 3/16 ≈ 18.75%
  // When: 5000회 분포
  // Then: 14% ~ 23% 범위
  const counts = rollDistribution(5000);
  const pct = (counts.do / 5000) * 100;
  expect(pct).toBeGreaterThanOrEqual(14);
  expect(pct).toBeLessThanOrEqual(23);
});

test('YR-C1-027: 5000회 분포 — 개 32~43% (이론 37.5%) (§3-2 §13-3)', () => {
  // Given: 개 이론 확률 6/16 = 37.5%
  // When: 5000회 분포
  // Then: 32% ~ 43% 범위
  const counts = rollDistribution(5000);
  const pct = (counts.gae / 5000) * 100;
  expect(pct).toBeGreaterThanOrEqual(32);
  expect(pct).toBeLessThanOrEqual(43);
});

test('YR-C1-028: 5000회 분포 — 걸 20~30% (이론 25%) (§3-2 §13-3)', () => {
  // Given: 걸 이론 확률 4/16 = 25%
  // When: 5000회 분포
  // Then: 20% ~ 30% 범위
  const counts = rollDistribution(5000);
  const pct = (counts.geol / 5000) * 100;
  expect(pct).toBeGreaterThanOrEqual(20);
  expect(pct).toBeLessThanOrEqual(30);
});

test('YR-C1-029: 5000회 분포 — 윷 3~10% (이론 6.25%) (§3-2 §13-3)', () => {
  // Given: 윷 이론 확률 1/16 ≈ 6.25%
  // When: 5000회 분포
  // Then: 3% ~ 10% 범위 (이론±3%pt 허용)
  const counts = rollDistribution(5000);
  const pct = (counts.yut / 5000) * 100;
  expect(pct).toBeGreaterThanOrEqual(3);
  expect(pct).toBeLessThanOrEqual(10);
});

test('YR-C1-030: 5000회 분포 — 모 3~10% (이론 6.25%) (§3-2 §13-3)', () => {
  // Given: 모 이론 확률 1/16 ≈ 6.25%
  // When: 5000회 분포
  // Then: 3% ~ 10% 범위
  const counts = rollDistribution(5000);
  const pct = (counts.mo / 5000) * 100;
  expect(pct).toBeGreaterThanOrEqual(3);
  expect(pct).toBeLessThanOrEqual(10);
});
