/**
 * @fileoverview 윷놀이 순수 단위 테스트 — throwYutSticks + computeNextCell.
 *
 * 서버/브라우저 불필요. server.js에서 함수만 임포트하여 실행한다.
 *
 * 실행:
 *   npx playwright test tests/yut.unit.spec.js --reporter=list
 *
 * §1  throwYutSticks 구조 검증  (U-01~U-05)
 * §2  throwYutSticks 결과 로직  (U-06~U-17)
 * §3  computeNextCell — HOME에서 이동  (U-18~U-22)
 * §4  computeNextCell — 외곽 경로  (U-23~U-32)
 * §5  computeNextCell — 지름길A  (U-33~U-39)
 * §6  computeNextCell — 지름길B  (U-40~U-46)
 * §7  computeNextCell — 중앙 분기  (U-47~U-55)
 * §8  computeNextCell — 백도(-1)  (U-56~U-63)
 */

import { test, expect } from 'playwright/test';
import { throwYutSticks, computeNextCell } from '../server.js';

// ── 헬퍼 ─────────────────────────────────────────────────────────

/**
 * Math.random을 순서대로 주어진 값으로 대체한 후 fn을 실행한다.
 * fn 실행 후 원래 Math.random으로 복원한다.
 *
 * @param {number[]} values - 순서대로 반환할 값들
 * @param {Function} fn - 실행할 함수
 * @returns {*} fn의 반환값
 */
function withRandom(values, fn) {
  let idx = 0;
  const saved = Math.random;
  Math.random = () => {
    const v = values[idx % values.length];
    idx++;
    return v;
  };
  try {
    return fn();
  } finally {
    Math.random = saved;
  }
}

/** 완주 상태 (GOAL). server.js와 동일하게 99. */
const GOAL = 99;
/** 출발 전 상태 (HOME). */
const HOME = -1;

// ── §1 throwYutSticks 구조 검증 ──────────────────────────────────

test('U-01: throwYutSticks 반환 구조 — 필수 필드 존재', () => {
  const r = throwYutSticks();
  expect(r).toHaveProperty('sticks');
  expect(r).toHaveProperty('result');
  expect(r).toHaveProperty('steps');
  expect(r).toHaveProperty('bonus');
  expect(r).toHaveProperty('markedIndex');
});

test('U-02: sticks 배열 길이는 4', () => {
  const r = throwYutSticks();
  expect(Array.isArray(r.sticks)).toBe(true);
  expect(r.sticks).toHaveLength(4);
});

test('U-03: sticks 각 값은 0 또는 1', () => {
  for (let i = 0; i < 20; i++) {
    const r = throwYutSticks();
    for (const s of r.sticks) {
      expect(s === 0 || s === 1).toBe(true);
    }
  }
});

test('U-04: markedIndex는 항상 0', () => {
  for (let i = 0; i < 10; i++) {
    expect(throwYutSticks().markedIndex).toBe(0);
  }
});

test('U-05: bonus는 boolean', () => {
  for (let i = 0; i < 10; i++) {
    expect(typeof throwYutSticks().bonus).toBe('boolean');
  }
});

// ── §2 throwYutSticks 결과 로직 ──────────────────────────────────

test('U-06: fronts=0 → 모 (steps=5, bonus=true)', () => {
  // Math.random >= 0.5 → 뒷면(0). 4개 모두 뒷면 → fronts=0 → mo
  const r = withRandom([0.9, 0.9, 0.9, 0.9], () => throwYutSticks());
  expect(r.result).toBe('mo');
  expect(r.steps).toBe(5);
  expect(r.bonus).toBe(true);
  expect(r.sticks).toEqual([0, 0, 0, 0]);
});

test('U-07: sticks=[1,0,0,0] → 백도 (steps=-1, bonus=false)', () => {
  // 마크(0번) 가락만 앞면 → 유일 앞면이 마크 가락 → 백도
  const r = withRandom([0.1, 0.9, 0.9, 0.9], () => throwYutSticks());
  expect(r.result).toBe('backdo');
  expect(r.steps).toBe(-1);
  expect(r.bonus).toBe(false);
  expect(r.sticks).toEqual([1, 0, 0, 0]);
});

test('U-08: sticks=[0,1,0,0] → 도 (steps=1, bonus=false)', () => {
  // 마크(0번) 뒷면, 1번만 앞면 → fronts=1, 마크가 아닌 가락이 앞면 → do
  const r = withRandom([0.9, 0.1, 0.9, 0.9], () => throwYutSticks());
  expect(r.result).toBe('do');
  expect(r.steps).toBe(1);
  expect(r.bonus).toBe(false);
});

test('U-09: sticks=[0,0,1,0] → 도', () => {
  const r = withRandom([0.9, 0.9, 0.1, 0.9], () => throwYutSticks());
  expect(r.result).toBe('do');
  expect(r.sticks).toEqual([0, 0, 1, 0]);
});

test('U-10: sticks=[0,0,0,1] → 도', () => {
  const r = withRandom([0.9, 0.9, 0.9, 0.1], () => throwYutSticks());
  expect(r.result).toBe('do');
  expect(r.sticks).toEqual([0, 0, 0, 1]);
});

test('U-11: sticks=[1,1,0,0] → 개 (steps=2)', () => {
  const r = withRandom([0.1, 0.1, 0.9, 0.9], () => throwYutSticks());
  expect(r.result).toBe('gae');
  expect(r.steps).toBe(2);
  expect(r.bonus).toBe(false);
});

test('U-12: sticks=[0,1,1,0] → 개', () => {
  const r = withRandom([0.9, 0.1, 0.1, 0.9], () => throwYutSticks());
  expect(r.result).toBe('gae');
  expect(r.sticks).toEqual([0, 1, 1, 0]);
});

test('U-13: sticks=[1,1,1,0] → 걸 (steps=3)', () => {
  const r = withRandom([0.1, 0.1, 0.1, 0.9], () => throwYutSticks());
  expect(r.result).toBe('geol');
  expect(r.steps).toBe(3);
  expect(r.bonus).toBe(false);
});

test('U-14: sticks=[0,1,1,1] → 걸 (마크 가락 뒤, fronts=3)', () => {
  const r = withRandom([0.9, 0.1, 0.1, 0.1], () => throwYutSticks());
  expect(r.result).toBe('geol');
  expect(r.sticks).toEqual([0, 1, 1, 1]);
});

test('U-15: sticks=[1,1,1,1] → 윷 (steps=4, bonus=true)', () => {
  // 4개 모두 앞면 → fronts=4 → yut
  const r = withRandom([0.1, 0.1, 0.1, 0.1], () => throwYutSticks());
  expect(r.result).toBe('yut');
  expect(r.steps).toBe(4);
  expect(r.bonus).toBe(true);
});

test('U-16: bonus는 윷/모에서만 true', () => {
  const bonusTrue = ['yut', 'mo'];
  const bonusFalse = ['backdo', 'do', 'gae', 'geol'];
  // 여러 번 던져서 결과별 bonus 값 검증
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const r = throwYutSticks();
    if (bonusTrue.includes(r.result)) expect(r.bonus).toBe(true);
    if (bonusFalse.includes(r.result)) expect(r.bonus).toBe(false);
    seen.add(r.result);
  }
});

test('U-17: 1000회 던지기에서 모든 6가지 결과가 나온다', () => {
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

// ── §3 computeNextCell — HOME에서 이동 ──────────────────────────

test('U-18: HOME + do(1) → cell 0', () => {
  const r = computeNextCell(HOME, 1);
  expect(r.toCell).toBe(0);
  expect(r.awaitingBranch).toBe(false);
  expect(r.passedStart).toBe(false);
});

test('U-19: HOME + gae(2) → cell 1', () => {
  const r = computeNextCell(HOME, 2);
  expect(r.toCell).toBe(1);
});

test('U-20: HOME + geol(3) → cell 2', () => {
  const r = computeNextCell(HOME, 3);
  expect(r.toCell).toBe(2);
});

test('U-21: HOME + yut(4) → cell 3', () => {
  const r = computeNextCell(HOME, 4);
  expect(r.toCell).toBe(3);
});

test('U-22: HOME + mo(5) → cell 4', () => {
  const r = computeNextCell(HOME, 5);
  expect(r.toCell).toBe(4);
});

// ── §4 computeNextCell — 외곽 경로 ───────────────────────────────

test('U-23: cell 0 + do(1) → cell 1', () => {
  const r = computeNextCell(0, 1);
  expect(r.toCell).toBe(1);
  expect(r.awaitingBranch).toBe(false);
});

test('U-24: cell 18 + do(1) → cell 19', () => {
  expect(computeNextCell(18, 1).toCell).toBe(19);
});

test('U-25: cell 19 + do(1) → GOAL (외곽 완주)', () => {
  const r = computeNextCell(19, 1);
  expect(r.toCell).toBe(GOAL);
  expect(r.passedStart).toBe(true);
});

test('U-26: cell 0 + mo(5) → cell 5 (0→1→2→3→4→5)', () => {
  // 이미 보드 위 0번 칸에서 5칸 이동. HOME에서 mo(5)=4와 다름 (HOME은 -1 → 0 포함)
  expect(computeNextCell(0, 5).toCell).toBe(5);
});

test('U-27: cell 3 + do(1) → cell 4 (모서리 5 직전)', () => {
  expect(computeNextCell(3, 1).toCell).toBe(4);
});

test('U-28: cell 9 + do(1) → cell 10 (모서리 10 도달)', () => {
  // 9에서 1칸 → 10(모서리). 단, 10에 "멈춰서" 다음 이동부터 지름길B 진입.
  // 이번 이동의 결과는 그냥 10에 도착.
  expect(computeNextCell(9, 1).toCell).toBe(10);
});

test('U-29: cell 14 + do(1) → cell 15 (모서리 15)', () => {
  expect(computeNextCell(14, 1).toCell).toBe(15);
});

test('U-30: cell 16 + yut(4) → GOAL (16→17→18→19→GOAL)', () => {
  const r = computeNextCell(16, 4);
  expect(r.toCell).toBe(GOAL);
  expect(r.passedStart).toBe(true);
});

test('U-31: cell 17 + geol(3) → GOAL (17→18→19→GOAL)', () => {
  const r = computeNextCell(17, 3);
  expect(r.toCell).toBe(GOAL);
  expect(r.passedStart).toBe(true);
});

test('U-32: cell 4 + gae(2) → cell 6 (4→5→6, 모서리 통과)', () => {
  // 4에서 출발 → 5(좌상 모서리) 경유 → 6. outer 경로 그대로 (정확히 멈추지 않음).
  // 단, computeNextCell에서 cell=4로 시작하면 pathContext='outer', 4→5→6.
  // 하지만 5에 멈추지 않고 통과하므로 shortcut 진입 없음.
  expect(computeNextCell(4, 2).toCell).toBe(6);
});

// ── §5 computeNextCell — 지름길A (5→21→22→23) ────────────────────

test('U-33: cell 5 + do(1) → cell 21 (지름길A 진입)', () => {
  const r = computeNextCell(5, 1);
  expect(r.toCell).toBe(21);
  expect(r.awaitingBranch).toBe(false);
});

test('U-34: cell 5 + gae(2) → cell 22', () => {
  expect(computeNextCell(5, 2).toCell).toBe(22);
});

test('U-35: cell 5 + geol(3) → cell 23 (중앙 정착, awaitingBranch=false)', () => {
  // 마지막 스텝에서 23 도달 → 분기 결정은 다음 이동 시
  const r = computeNextCell(5, 3);
  expect(r.toCell).toBe(23);
  expect(r.awaitingBranch).toBe(false);
});

test('U-36: cell 21 + do(1) → cell 22', () => {
  expect(computeNextCell(21, 1).toCell).toBe(22);
});

test('U-37: cell 21 + gae(2) → cell 23 (awaitingBranch=false)', () => {
  // 21→22→23. 마지막 스텝에서 23 → 분기 결정 없음
  const r = computeNextCell(21, 2);
  expect(r.toCell).toBe(23);
  expect(r.awaitingBranch).toBe(false);
});

test('U-38: cell 22 + do(1) → cell 23 (awaitingBranch=false)', () => {
  const r = computeNextCell(22, 1);
  expect(r.toCell).toBe(23);
  expect(r.awaitingBranch).toBe(false);
});

test('U-39: cell 22 + gae(2) → awaitingBranch=true (중앙 통과 중 잔여 스텝 있음)', () => {
  // 22→23(i=0, steps-1=1, 0<1 → awaitingBranch=true 즉시 반환)
  const r = computeNextCell(22, 2);
  expect(r.toCell).toBe(23);
  expect(r.awaitingBranch).toBe(true);
});

// ── §6 computeNextCell — 지름길B (10→26→27→23) ───────────────────

test('U-40: cell 10 + do(1) → cell 26 (지름길B 진입)', () => {
  expect(computeNextCell(10, 1).toCell).toBe(26);
});

test('U-41: cell 10 + gae(2) → cell 27', () => {
  expect(computeNextCell(10, 2).toCell).toBe(27);
});

test('U-42: cell 10 + geol(3) → cell 23 (awaitingBranch=false)', () => {
  const r = computeNextCell(10, 3);
  expect(r.toCell).toBe(23);
  expect(r.awaitingBranch).toBe(false);
});

test('U-43: cell 26 + do(1) → cell 27', () => {
  expect(computeNextCell(26, 1).toCell).toBe(27);
});

test('U-44: cell 27 + do(1) → cell 23 (awaitingBranch=false)', () => {
  const r = computeNextCell(27, 1);
  expect(r.toCell).toBe(23);
  expect(r.awaitingBranch).toBe(false);
});

test('U-45: cell 27 + gae(2) → awaitingBranch=true', () => {
  // 27→23(i=0), steps=2, i<steps-1 → awaitingBranch
  const r = computeNextCell(27, 2);
  expect(r.toCell).toBe(23);
  expect(r.awaitingBranch).toBe(true);
});

test('U-46: cell 26 + gae(2) → cell 23 (awaitingBranch=false, 마지막 스텝 도달)', () => {
  // 26→27→23. steps=2, i=1이 마지막 → awaitingBranch 없음
  const r = computeNextCell(26, 2);
  expect(r.toCell).toBe(23);
  expect(r.awaitingBranch).toBe(false);
});

// ── §7 computeNextCell — 중앙 분기 ───────────────────────────────

test('U-47: cell 23 + steps=1, branchChoice=null → awaitingBranch=true', () => {
  const r = computeNextCell(23, 1, null);
  expect(r.toCell).toBe(23);
  expect(r.awaitingBranch).toBe(true);
});

test('U-48: cell 23 + do(1), branchChoice=top → cell 15 (centerExitA)', () => {
  // centerExitA: 23→15→...
  const r = computeNextCell(23, 1, 'top');
  expect(r.toCell).toBe(15);
  expect(r.awaitingBranch).toBe(false);
});

test('U-49: cell 23 + gae(2), branchChoice=top → cell 16', () => {
  // 23→15→16
  expect(computeNextCell(23, 2, 'top').toCell).toBe(16);
});

test('U-50: cell 23 + mo(5), branchChoice=top → cell 19 (23→15→16→17→18→19)', () => {
  expect(computeNextCell(23, 5, 'top').toCell).toBe(19);
});

test('U-51: cell 23 + 6, branchChoice=top → GOAL (23→15→16→17→18→19→GOAL)', () => {
  const r = computeNextCell(23, 6, 'top');
  expect(r.toCell).toBe(GOAL);
  expect(r.passedStart).toBe(true);
});

test('U-52: cell 23 + do(1), branchChoice=bottom → GOAL (centerExitB: 즉시 완주)', () => {
  // centerExitB: 23→GOAL (단순화)
  const r = computeNextCell(23, 1, 'bottom');
  expect(r.toCell).toBe(GOAL);
  expect(r.passedStart).toBe(true);
});

test('U-53: cell 15 + do(1) → cell 16 (외곽 계속 진행)', () => {
  expect(computeNextCell(15, 1).toCell).toBe(16);
});

test('U-54: cell 15 + mo(5) → GOAL (15→16→17→18→19→GOAL)', () => {
  const r = computeNextCell(15, 5);
  expect(r.toCell).toBe(GOAL);
  expect(r.passedStart).toBe(true);
});

test('U-55: cell 23 + steps=3, branchChoice=top → cell 17', () => {
  // 23→15→16→17
  expect(computeNextCell(23, 3, 'top').toCell).toBe(17);
});

// ── §8 computeNextCell — 백도(-1) ────────────────────────────────

test('U-56: cell 1, steps=-1 → cell 0', () => {
  const r = computeNextCell(1, -1);
  expect(r.toCell).toBe(0);
  expect(r.awaitingBranch).toBe(false);
  expect(r.passedStart).toBe(false);
});

test('U-57: cell 5, steps=-1 → cell 4 (외곽 1칸 뒤)', () => {
  // 외곽 5번 칸에서 백도 → 4번 칸
  expect(computeNextCell(5, -1).toCell).toBe(4);
});

test('U-58: cell 0, steps=-1 → cell 0 (출발선 뒤로 못 감)', () => {
  expect(computeNextCell(0, -1).toCell).toBe(0);
});

test('U-59: cell HOME, steps=-1 → cell HOME (출발 전 말은 그대로)', () => {
  expect(computeNextCell(HOME, -1).toCell).toBe(HOME);
});

test('U-60: cell 21, steps=-1 → cell 5 (지름길A 첫 칸 → 모서리)', () => {
  expect(computeNextCell(21, -1).toCell).toBe(5);
});

test('U-61: cell 22, steps=-1 → cell 21', () => {
  expect(computeNextCell(22, -1).toCell).toBe(21);
});

test('U-62: cell 26, steps=-1 → cell 10 (지름길B 첫 칸 → 모서리)', () => {
  expect(computeNextCell(26, -1).toCell).toBe(10);
});

test('U-63: cell 27, steps=-1 → cell 26', () => {
  expect(computeNextCell(27, -1).toCell).toBe(26);
});

test('U-64: cell 23, steps=-1 → cell 22 (중앙 백도)', () => {
  // 중앙에서 백도 → 22로 통일 (지름길A 경로 기준)
  expect(computeNextCell(23, -1).toCell).toBe(22);
});

test('U-65: 외곽 임의 칸에서 백도 — 이전 칸', () => {
  // 3→2, 10→9, 19→18
  expect(computeNextCell(3, -1).toCell).toBe(2);
  expect(computeNextCell(10, -1).toCell).toBe(9);
  expect(computeNextCell(19, -1).toCell).toBe(18);
});
