/**
 * @fileoverview YR-C12 시리즈 — §13 미해소 8건 정책 PASS (8개)
 * 룰북 참조: minigames/yutnori/docs/RULEBOOK.md §13-1 ~ §13-8
 *
 * 각 시나리오는 "현재 구현 정책이 의도대로 동작하는지" 확인하는 정책 PASS 테스트.
 * 정책 변경 시 본 테스트가 실패하므로 함께 갱신해야 한다.
 */

import { test, expect } from 'playwright/test';
import { computeNextCell, throwYutSticks, createApp } from '../server.js';
import { startServer, stopServer, setupGame, inject } from './rulebook-helpers.js';

const GOAL = 99;

// ── §13-1 모서리 강제 지름길 (HIGH, 미해소) ───────────────────────

test('YR-C12-001: §13-1 PASS — cell 5 멈춤 후 도(1) → 무조건 지름길A 진입 (외곽 선택 없음) (§13-1 §10-2)', () => {
  // Given: 모서리 5에 정확히 멈춤
  // When: 도(1)
  // Then: 칸 21 (외곽 칸 6이 아닌 지름길A 강제 진입)
  expect(computeNextCell(5, 1).toCell).toBe(21);
});

// ── §13-2 centerExitB 즉시 완주 (HIGH, 미해소) ────────────────────

test('YR-C12-002: §13-2 PASS — cell 23 + bottom → 즉시 GOAL (steps 무관) (§13-2 §10-4)', () => {
  // Given: 중앙 23
  // When: bottom + mo(5)
  // Then: 즉시 GOAL (남은 steps 무관)
  expect(computeNextCell(23, 5, 'bottom').toCell).toBe(GOAL);
});

// ── §13-3 균등 50% 확률 (LOW, 미해소) ────────────────────────────

test('YR-C12-003: §13-3 PASS — 5000회 분포가 각 결과 이론 ±5%pt 범위 내 (§13-3 §3-2)', () => {
  // Given: 균등 50% 확률 정책
  // When: 5000회 분포
  // Then: 각 결과의 실측이 이론값 ±5%pt 범위 내 (균등 50% 정책 유지 확인)
  const counts = { backdo: 0, do: 0, gae: 0, geol: 0, yut: 0, mo: 0 };
  for (let i = 0; i < 5000; i++) counts[throwYutSticks().result] += 1;
  const expected = {
    backdo: 6.25, do: 18.75, gae: 37.5, geol: 25.0, yut: 6.25, mo: 6.25,
  };
  for (const k of Object.keys(expected)) {
    const pct = (counts[k] / 5000) * 100;
    const diff = Math.abs(pct - expected[k]);
    expect(diff).toBeLessThan(5); // ±5%pt
  }
});

// ── §13-4 매핑 회귀 (MED, 미해소 — 현재 정상) ────────────────────

test('YR-C12-004: §13-4 PASS — fronts=4→yut, fronts=0→mo 매핑 정상 (§13-4 §3-2)', () => {
  // Given: throwYutSticks 정통 매핑
  // When: 강제 결정론으로 4개 앞면 / 4개 뒷면
  // Then: 윷 / 모 (Phase 2 거꾸로 매핑 회귀 없음)
  let savedRandom = Math.random;
  try {
    let idx = 0;
    const values = [0.1, 0.1, 0.1, 0.1]; // 4개 앞면
    Math.random = () => { const v = values[idx % values.length]; idx++; return v; };
    expect(throwYutSticks().result).toBe('yut');

    idx = 0;
    const values2 = [0.9, 0.9, 0.9, 0.9]; // 4개 뒷면
    Math.random = () => { const v = values2[idx % values2.length]; idx++; return v; };
    expect(throwYutSticks().result).toBe('mo');
  } finally {
    Math.random = savedRandom;
  }
});

// ── §13-5 HOME 백도 자동 폐기 (LOW, 미해소) ──────────────────────

test('YR-C12-005: §13-5 PASS — HOME 말만 있을 때 backdo → discarded:true 발생 (§13-5 §9-2)', async () => {
  // Given: P1 모든 말 HOME
  // When: backdo가 나올 때까지 반복
  // Then: discarded=true 메시지 한 번이라도 관측 (현재 정책)
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    let found = false;
    // 시도 한도 100회: 백도(1/16)가 한 번도 안 나올 확률 = (15/16)^100 ≈ 0.16%.
    //                   50회였을 때 fail 확률 ≈ 4% → batch 실행 안정성 확보.
    for (let attempt = 0; attempt < 100 && !found; attempt++) {
      await inject(port, {
        started: true, currentTurn: 'p1', pendingResults: [], capturedBonus: false,
        pieces: {
          p1: [
            { cell: -1, stack: 1, done: false },
            { cell: -1, stack: 1, done: false },
            { cell: -1, stack: 1, done: false },
            { cell: -1, stack: 1, done: false },
          ],
        },
      });
      await p1.next('STATE');
      await p2.next('STATE');

      p1.send({ type: 'THROW_YUT' });
      const yr = await p1.next('YUT_RESULT');
      await p1.next('STATE');
      p2.drain('YUT_RESULT');
      p2.drain('STATE');

      if (yr.result === 'backdo' && yr.discarded === true) {
        found = true;
      }
    }
    expect(found).toBe(true);
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

// ── §13-6 중앙 양방향 자유 (LOW, 미해소) ─────────────────────────

test('YR-C12-006: §13-6 PASS — 지름길B(cell 10) 진입 후 중앙에서 top/bottom 모두 선택 가능 (§13-6 §10-5)', () => {
  // Given: cell 10 + geol(3) → 중앙 23 (지름길B 경유)
  // When: top과 bottom 두 선택 모두 호출
  // Then: 둘 다 정상 진행 (양방향 자유 정책)
  const arrived = computeNextCell(10, 3);
  expect(arrived.toCell).toBe(23);
  // top 선택
  expect(computeNextCell(23, 1, 'top').toCell).toBe(15);
  // bottom 선택 (자유 정책 — 진입 경로 무관)
  expect(computeNextCell(23, 1, 'bottom').toCell).toBe(GOAL);
});

// ── §13-7 선후공 p1 고정 (LOW, 미해소) ──────────────────────────

test('YR-C12-007: §13-7 PASS — 게임 시작 후 currentTurn=p1 고정 (§13-7 §1)', async () => {
  // Given: 양쪽 READY → 게임 시작
  // When: 시작 직후 STATE 검사
  // Then: currentTurn === 'p1' (선후공 결정 절차 생략)
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, {}); // STATE broadcast 유도
    const st = await p1.next('STATE');
    expect(st.currentTurn).toBe('p1');
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

// ── §13-8 외곽 인덱스 20/24/25/28 미사용 (LOW, 미해소) ─────────

test('YR-C12-008: §13-8 PASS — computeNextCell이 20/24/25/28을 반환하지 않음 (§13-8 §2-2)', () => {
  // Given: 외곽/지름길/중앙 출구의 다양한 이동
  // When: 가능한 입력 조합 전수 검증
  // Then: 결과 인덱스가 20/24/25/28 미반환
  const forbidden = new Set([20, 24, 25, 28]);
  const samples = [];
  for (let c = -1; c <= 23; c++) {
    if (c === 20 || c === 24 || c === 25 || c === 28) continue; // 입력으로도 미사용
    for (let s = -1; s <= 5; s++) {
      if (s === 0) continue;
      if (c === 23) {
        samples.push(computeNextCell(c, s, 'top').toCell);
        samples.push(computeNextCell(c, s, 'bottom').toCell);
      } else {
        samples.push(computeNextCell(c, s).toCell);
      }
    }
  }
  for (const cell of samples) {
    expect(forbidden.has(cell)).toBe(false);
  }
});
