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

// ── §3 computeNextCell — HOME에서 이동 (§13-10 해소: HOME → 칸 N 정통 매핑) ─

test('U-18: HOME + do(1) → cell 1 (§13-10 정통 매핑)', () => {
  // 2026-05-31 §13-10 해소: HOME에서 도(1)는 칸 1로 진입한다.
  // 이전 단순화(HOME → 칸 N-1)는 폐기. YR-C2-001 / YR-C13-001과 일치.
  const r = computeNextCell(HOME, 1);
  expect(r.toCell).toBe(1);
  expect(r.awaitingBranch).toBe(false);
  expect(r.passedStart).toBe(false);
});

test('U-19: HOME + gae(2) → cell 2 (§13-10)', () => {
  // 2026-05-31 §13-10 해소 후 정통 매핑.
  const r = computeNextCell(HOME, 2);
  expect(r.toCell).toBe(2);
});

test('U-20: HOME + geol(3) → cell 3 (§13-10)', () => {
  // 2026-05-31 §13-10 해소 후 정통 매핑.
  const r = computeNextCell(HOME, 3);
  expect(r.toCell).toBe(3);
});

test('U-21: HOME + yut(4) → cell 4 (§13-10)', () => {
  // 2026-05-31 §13-10 해소 후 정통 매핑.
  const r = computeNextCell(HOME, 4);
  expect(r.toCell).toBe(4);
});

test('U-22: HOME + mo(5) → cell 5 (§13-10)', () => {
  // 2026-05-31 §13-10 해소 후 정통 매핑. (보너스 결과는 별도 — 본 케이스는 이동 칸 수만 검증)
  const r = computeNextCell(HOME, 5);
  expect(r.toCell).toBe(5);
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

test('U-33: cell 5 + do(1) + shortcut → cell 21 (지름길A 진입)', () => {
  // 갱신 사유: FIX-2(§13-1 해소) — 모서리는 분기 대기. 지름길 진입은 shortcut 명시.
  const r = computeNextCell(5, 1, 'shortcut');
  expect(r.toCell).toBe(21);
  expect(r.awaitingBranch).toBe(false);
});

test('U-34: cell 5 + gae(2) + shortcut → cell 22', () => {
  // 갱신 사유: FIX-2(§13-1 해소) — 지름길 진입 shortcut 명시.
  expect(computeNextCell(5, 2, 'shortcut').toCell).toBe(22);
});

test('U-35: cell 5 + geol(3) + shortcut → cell 23 (중앙 정착, awaitingBranch=false)', () => {
  // 갱신 사유: FIX-2(§13-1 해소) — 지름길 진입 shortcut 명시.
  // 마지막 스텝에서 23 도달 → 분기 결정은 다음 이동 시
  const r = computeNextCell(5, 3, 'shortcut');
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

test('U-39: cell 22 + gae(2) → cell 28 (지름길A 경유 중앙 통과 → 자동 centerExitA, 버그A 2026-06-16)', () => {
  // 갱신 사유: 버그A 수정(2026-06-16) — 지름길A 경유로 중앙(23)을 통과(잔여 steps)하면
  //   더 이상 중앙 분기를 재대기하지 않고 자동으로 centerExitA로 진행한다.
  //   22→23(i=0, shortcutA→centerExitA 자동)→28(i=1).
  const r = computeNextCell(22, 2);
  expect(r.toCell).toBe(28);
  expect(r.awaitingBranch).toBe(false);
});

// ── §6 computeNextCell — 지름길B (10→26→27→23) ───────────────────

test('U-40: cell 10 + do(1) + shortcut → cell 26 (지름길B 진입)', () => {
  // 갱신 사유: FIX-2(§13-1 해소) — 모서리는 분기 대기. 지름길 진입 shortcut 명시.
  expect(computeNextCell(10, 1, 'shortcut').toCell).toBe(26);
});

test('U-41: cell 10 + gae(2) + shortcut → cell 27', () => {
  // 갱신 사유: FIX-2(§13-1 해소) — 지름길 진입 shortcut 명시.
  expect(computeNextCell(10, 2, 'shortcut').toCell).toBe(27);
});

test('U-42: cell 10 + geol(3) + shortcut → cell 23 (awaitingBranch=false)', () => {
  // 갱신 사유: FIX-2(§13-1 해소) — 지름길 진입 shortcut 명시.
  const r = computeNextCell(10, 3, 'shortcut');
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

test('U-45: cell 27 + gae(2) → cell 24 (지름길B 경유 중앙 통과 → 자동 centerExitB, 버그A 2026-06-16)', () => {
  // 갱신 사유: 버그A 수정(2026-06-16) — 지름길B 경유로 중앙(23)을 통과하면
  //   자동으로 centerExitB로 진행한다. 27→23(i=0, shortcutB→centerExitB 자동)→24(i=1).
  const r = computeNextCell(27, 2);
  expect(r.toCell).toBe(24);
  expect(r.awaitingBranch).toBe(false);
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

test('U-48: cell 23 + do(1), branchChoice=top → cell 28 (centerExitA 중간 칸, 버그B 2026-06-16)', () => {
  // 갱신 사유: 버그B 수정(2026-06-16) — centerExitA가 23→15 즉시 합류에서
  //   23→28→29→15로 변경(centerExitB 24/25와 대칭). 도(1)이면 첫 중간 칸 28에 정착.
  const r = computeNextCell(23, 1, 'top');
  expect(r.toCell).toBe(28);
  expect(r.awaitingBranch).toBe(false);
});

test('U-49: cell 23 + gae(2), branchChoice=top → cell 29 (23→28→29, 버그B 2026-06-16)', () => {
  // 갱신 사유: 버그B 수정 — 23→28→29.
  expect(computeNextCell(23, 2, 'top').toCell).toBe(29);
});

test('U-50: cell 23 + mo(5), branchChoice=top → cell 17 (23→28→29→15→16→17, 버그B 2026-06-16)', () => {
  // 갱신 사유: 버그B 수정 — 중간 칸 28/29 추가로 외곽 합류가 2칸 늦어짐.
  expect(computeNextCell(23, 5, 'top').toCell).toBe(17);
});

test('U-51: cell 23 + 6, branchChoice=top → cell 18 (23→28→29→15→16→17→18, 버그B 2026-06-16)', () => {
  // 갱신 사유: 버그B 수정 — 중간 칸 2개 추가로 6칸이어도 GOAL 미도달(cell 18 정착).
  const r = computeNextCell(23, 6, 'top');
  expect(r.toCell).toBe(18);
  expect(r.passedStart).toBe(false);
});

test('U-52: cell 23 + do(1), branchChoice=bottom → cell 24 (centerExitB 중간 칸)', () => {
  // 갱신 사유: FIX-3(§13-2 해소) — centerExitB가 즉시 GOAL에서 23→24→25→GOAL로 변경됨.
  // 도(1)이면 첫 중간 칸 24에 정착.
  const r = computeNextCell(23, 1, 'bottom');
  expect(r.toCell).toBe(24);
  expect(r.passedStart).toBe(false);
});

test('U-53: cell 15 + do(1) → cell 16 (외곽 계속 진행)', () => {
  expect(computeNextCell(15, 1).toCell).toBe(16);
});

test('U-54: cell 15 + mo(5) → GOAL (15→16→17→18→19→GOAL)', () => {
  const r = computeNextCell(15, 5);
  expect(r.toCell).toBe(GOAL);
  expect(r.passedStart).toBe(true);
});

test('U-55: cell 23 + steps=3, branchChoice=top → cell 15 (23→28→29→15, 버그B 2026-06-16)', () => {
  // 갱신 사유: 버그B 수정 — 23→28→29→15. 걸(3)이면 외곽 우하 출구(15)에 정착.
  expect(computeNextCell(23, 3, 'top').toCell).toBe(15);
});

// ── §8 computeNextCell — 백도(-1) ────────────────────────────────

test('U-56: cell 1, steps=-1 → cell 19 (첫칸 빽도 워프, §13-5 해소)', () => {
  // 갱신 사유: §13-5 해소(2026-06-15) — 첫칸(cell 1) 빽도 워프 규칙 적용.
  //   이전 기댓값 toCell=0(단순 후퇴) → 변경 후 toCell=19(외곽 마지막 칸 워프, done=false).
  const r = computeNextCell(1, -1);
  expect(r.toCell).toBe(19);
  expect(r.awaitingBranch).toBe(false);
  expect(r.passedStart).toBe(false);
});

test('U-56b: cell 19, steps=-1 → cell 1 (워프 복귀 대칭, §13-5 해소)', () => {
  // §13-5 대칭: 첫칸 워프(1→19)의 역방향. 이전 단순 후퇴(19→18)를 대체.
  const r = computeNextCell(19, -1);
  expect(r.toCell).toBe(1);
  expect(r.awaitingBranch).toBe(false);
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

test('U-65: 외곽 임의 칸에서 백도 — 이전 칸 (cell 19는 워프 복귀)', () => {
  // 갱신 사유: §13-5 해소(2026-06-15) — cell 19 빽도가 워프 복귀(→1)로 변경.
  //   이전 19→18(단순 후퇴) → 변경 후 19→1(첫칸 워프 복귀). 3/10은 범용 후퇴 무영향.
  // 3→2, 10→9, 19→1(워프)
  expect(computeNextCell(3, -1).toCell).toBe(2);
  expect(computeNextCell(10, -1).toCell).toBe(9);
  expect(computeNextCell(19, -1).toCell).toBe(1);
});

// ── §9 computeNextCell — 모서리 지름길 + 중앙 통과 복합 분기 (U-66~U-72) ──
//
// FIX-2 중첩 분기 결함 수정 (룰북 §10-2 모서리 외곽/지름길 선택, §10-3 중앙 출구 선택).
// 모서리(5/10)에 멈춘 말이 윷/모로 지름길을 타고 중앙(23)을 잔여 steps 있이 통과하는 경우,
// 1차 모서리 선택('shortcut')과 2차 중앙 선택('top'/'bottom')을 'shortcut-top'/'shortcut-bottom'
// 복합값으로 합성하여 한 번에 계산한다.

test('U-66: cell 5 + yut(4) + shortcut → cell 28 (지름길A 경유 중앙 통과 → 자동 centerExitA, 버그A 2026-06-16)', () => {
  // 갱신 사유: 버그A 수정(2026-06-16) — 지름길A로 중앙을 통과(잔여 steps)하면 더 이상
  //   awaitingBranch=true로 중앙 분기를 재대기하지 않고 자동 centerExitA로 진행한다.
  //   5→21(i=0)→22(i=1)→23(i=2, shortcutA→centerExitA 자동)→28(i=3).
  const r = computeNextCell(5, 4, 'shortcut');
  expect(r.toCell).toBe(28);
  expect(r.awaitingBranch).toBe(false);
});

test('U-67: cell 5 + yut(4) + shortcut-top → cell 28 (지름길A→centerExitA 중간 칸, 버그B 2026-06-16)', () => {
  // 갱신 사유: 버그B 수정 — centerExitA 23→28→29→15 경로화.
  //   5→21→22→23→28. 복합값이므로 중앙 재대기 없이 출구A로 진행.
  const r = computeNextCell(5, 4, 'shortcut-top');
  expect(r.toCell).toBe(28);
  expect(r.awaitingBranch).toBe(false);
});

test('U-68: cell 5 + mo(5) + shortcut-top → cell 29 (5→21→22→23→28→29, 버그B 2026-06-16)', () => {
  // 갱신 사유: 버그B 수정 — centerExitA 중간 칸 28/29 경유.
  expect(computeNextCell(5, 5, 'shortcut-top').toCell).toBe(29);
});

test('U-69: cell 5 + yut(4) + shortcut-bottom → cell 24 (지름길A→centerExitB) (§10-3)', () => {
  // 5→21→22→23→24. centerExitB 첫 중간 칸 24.
  const r = computeNextCell(5, 4, 'shortcut-bottom');
  expect(r.toCell).toBe(24);
  expect(r.awaitingBranch).toBe(false);
});

test('U-70: cell 10 + yut(4) + shortcut-bottom → cell 24 (지름길B→centerExitB) (§10-3)', () => {
  // 10→26→27→23→24.
  expect(computeNextCell(10, 4, 'shortcut-bottom').toCell).toBe(24);
});

test('U-71: cell 10 + mo(5) + shortcut-bottom → cell 25 (10→26→27→23→24→25) (§10-3)', () => {
  expect(computeNextCell(10, 5, 'shortcut-bottom').toCell).toBe(25);
});

test('U-72: cell 5 + geol(3) + shortcut → cell 23 정착 (잔여 없음, awaitingBranch=false) (§10-2)', () => {
  // 5→21→22→23. 마지막 스텝에서 중앙 도달 → 잔여 없음 → 분기 재대기 없이 중앙 정착.
  const r = computeNextCell(5, 3, 'shortcut');
  expect(r.toCell).toBe(23);
  expect(r.awaitingBranch).toBe(false);
});

// ── §10 버그A — 지름길 경유 중앙 통과 자동 라우팅 (U-73~U-77, 2026-06-16) ──
//
// 버그A: 모서리(5/10)에서 'shortcut'으로 지름길을 타고 잔여 steps로 중앙(23)을 **통과**할 때,
// 이전 구현은 awaitingBranch=true로 중앙 분기를 재대기시켰다(2단계 중첩 분기).
// 수정: 통과(정확 착지 아님)는 분기 선택 의미가 없으므로 지름길 방향대로 자동 라우팅한다.
//   - shortcutA 경유 통과 → centerExitA 자동
//   - shortcutB 경유 통과 → centerExitB 자동
// 정확 착지(잔여 0)는 여전히 중앙 정착(U-72) → 다음 이동 시 23 출발 분기.

test('U-73: cell 5 + mo(5) + shortcut → cell 29 (지름길A 통과 자동 centerExitA, 버그A)', () => {
  // 5→21(i0)→22(i1)→23(i2, 자동 centerExitA)→28(i3)→29(i4).
  const r = computeNextCell(5, 5, 'shortcut');
  expect(r.toCell).toBe(29);
  expect(r.awaitingBranch).toBe(false);
  expect(r.finalPath).toBe('centerExitA');
});

test('U-74: cell 10 + yut(4) + shortcut → cell 24 (지름길B 통과 자동 centerExitB, 버그A)', () => {
  // 10→26(i0)→27(i1)→23(i2, 자동 centerExitB)→24(i3).
  const r = computeNextCell(10, 4, 'shortcut');
  expect(r.toCell).toBe(24);
  expect(r.awaitingBranch).toBe(false);
  expect(r.finalPath).toBe('centerExitB');
});

test('U-75: cell 10 + mo(5) + shortcut → cell 25 (지름길B 통과 자동 centerExitB, 버그A)', () => {
  // 10→26→27→23(자동)→24→25.
  const r = computeNextCell(10, 5, 'shortcut');
  expect(r.toCell).toBe(25);
  expect(r.awaitingBranch).toBe(false);
});

test('U-76: cell 22 + geol(3) + shortcut → 자동 centerExitA (22→23 통과, 버그A)', () => {
  // 22→23(i0, 자동 centerExitA)→28(i1)→29(i2). 잔여 통과 → 재대기 없음.
  const r = computeNextCell(22, 3, 'shortcut');
  expect(r.toCell).toBe(29);
  expect(r.awaitingBranch).toBe(false);
});

test('U-77: cell 27 + geol(3) → 자동 centerExitB (27→23 통과, 버그A)', () => {
  // 27→23(i0, shortcutB→centerExitB 자동)→24(i1)→25(i2). branchChoice 불필요.
  const r = computeNextCell(27, 3);
  expect(r.toCell).toBe(25);
  expect(r.awaitingBranch).toBe(false);
});

// ── §11 버그B — centerExitA 중간 칸 28/29 (U-78~U-83, 2026-06-16) ──
//
// 버그B: centerExitA가 23→15로 즉시 합류했으나, centerExitB(23→24→25)와 비대칭이었다.
// 수정: 중앙(23)→28→29→15(우하 출구)→16→...→GOAL. 중간 칸 28/29 신설(centerExitB 24/25 대칭).

test('U-78: cell 28 + do(1) → cell 29 (centerExitA 중간 칸 전진)', () => {
  expect(computeNextCell(28, 1, 'centerExitA').toCell).toBe(29);
});

test('U-79: cell 28 + gae(2) → cell 15 (28→29→15 외곽 합류)', () => {
  expect(computeNextCell(28, 2, 'centerExitA').toCell).toBe(15);
});

test('U-80: cell 29 + do(1) → cell 15 (centerExitA 마지막 중간 칸 → 외곽)', () => {
  expect(computeNextCell(29, 1, 'centerExitA').toCell).toBe(15);
});

test('U-81: cell 29 + mo(5) → GOAL (29→15→16→17→18→19, 외곽 합류 후 완주 직전)', () => {
  // 29→15(i0)→16(i1)→17(i2)→18(i3)→19(i4). cell 19 정착 (GOAL 아님).
  expect(computeNextCell(29, 5, 'centerExitA').toCell).toBe(19);
});

test('U-82: cell 29 + 6 → GOAL (29→15→16→17→18→19→GOAL)', () => {
  const r = computeNextCell(29, 6, 'centerExitA');
  expect(r.toCell).toBe(GOAL);
  expect(r.passedStart).toBe(true);
});

test('U-83: centerExitA 중간 칸 백도 복귀 — 29 → 28, 28 → 23 (centerExitB 대칭)', () => {
  expect(computeNextCell(29, -1).toCell).toBe(28);
  expect(computeNextCell(28, -1).toCell).toBe(23);
});
