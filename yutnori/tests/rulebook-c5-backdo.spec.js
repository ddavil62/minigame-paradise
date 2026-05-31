/**
 * @fileoverview YR-C5 시리즈 — 백도(뒷도/빽도) (10개)
 * 룰북 참조: minigames/yutnori/docs/RULEBOOK.md §9 (백도)
 *
 * YR-C5-001~007 / 009~010: computeNextCell 단위 직접 import.
 * YR-C5-008: WS THROW_YUT 반복으로 discarded:true 발생 케이스 검증.
 */

import { test, expect } from 'playwright/test';
import { computeNextCell, createApp } from '../server.js';
import { startServer, stopServer, setupGame, inject } from './rulebook-helpers.js';

const HOME = -1;

// ── §9-2 외곽/지름길/중앙 백도 ────────────────────────────────────

test('YR-C5-001: cell 1 + backdo(-1) → cell 0 (외곽 1칸 뒤) (§9-2)', () => {
  // Given: 칸 1
  // When: 백도(-1)
  // Then: 칸 0
  const r = computeNextCell(1, -1);
  expect(r.toCell).toBe(0);
  expect(r.awaitingBranch).toBe(false);
});

test('YR-C5-002: cell 0 + backdo(-1) → cell 0 (출발선 뒤로 못 감) (§9-2 §9-3)', () => {
  // Given: 출발선(칸 0)
  // When: 백도
  // Then: 칸 0 유지 (정통 룰 단순화)
  expect(computeNextCell(0, -1).toCell).toBe(0);
});

test('YR-C5-003: cell 21 + backdo(-1) → cell 5 (지름길A 진입 모서리 복귀) (§9-2)', () => {
  // Given: 지름길A 첫 칸 21
  // When: 백도
  // Then: 모서리 5로 복귀
  expect(computeNextCell(21, -1).toCell).toBe(5);
});

test('YR-C5-004: cell 22 + backdo(-1) → cell 21 (지름길A 두 번째 칸) (§9-2)', () => {
  // Given: 지름길A 칸 22
  // When: 백도
  // Then: 칸 21
  expect(computeNextCell(22, -1).toCell).toBe(21);
});

test('YR-C5-005: cell 26 + backdo(-1) → cell 10 (지름길B 진입 모서리 복귀) (§9-2)', () => {
  // Given: 지름길B 첫 칸 26
  // When: 백도
  // Then: 모서리 10으로 복귀
  expect(computeNextCell(26, -1).toCell).toBe(10);
});

test('YR-C5-006: cell 27 + backdo(-1) → cell 26 (지름길B 두 번째 칸) (§9-2)', () => {
  // Given: 지름길B 칸 27
  // When: 백도
  // Then: 칸 26
  expect(computeNextCell(27, -1).toCell).toBe(26);
});

test('YR-C5-007: cell 23 + backdo(-1) → cell 22 (중앙 백도, 정책 지름길A 기준) (§9-2 §13-6)', () => {
  // Given: 중앙(23)
  // When: 백도
  // Then: 칸 22 (구현 정책: 지름길A 경로 기준 — 표준에 명확 정의 없음)
  expect(computeNextCell(23, -1).toCell).toBe(22);
});

// ── §13-5 HOME 백도 자동 폐기 (WS) ────────────────────────────────

test('YR-C5-008: HOME 말만 있을 때 backdo 던지면 discarded:true + 자동 턴 처리 (§9-2 §13-5)', async () => {
  // Given: P1의 모든 말이 HOME에 있고 P1 턴
  // When: 백도가 나올 때까지 THROW_YUT 반복 (모두 HOME이므로 inject 후 새로 시작)
  // Then: discarded=true가 한 번이라도 관측됨
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    let foundDiscarded = false;
    // 시도 한도 100회: 백도(1/16)가 한 번도 안 나올 확률 = (15/16)^100 ≈ 0.16%.
    //                   50회였을 때 fail 확률 ≈ 4% → 100회로 batch 실행 안정성 확보.
    for (let attempt = 0; attempt < 100 && !foundDiscarded; attempt++) {
      // 매 시도 전 상태 초기화 — pendingResults 비우고 모든 말 HOME
      await inject(port, {
        started: true,
        currentTurn: 'p1',
        pendingResults: [],
        capturedBonus: false,
        pieces: {
          p1: [
            { cell: HOME, stack: 1, done: false },
            { cell: HOME, stack: 1, done: false },
            { cell: HOME, stack: 1, done: false },
            { cell: HOME, stack: 1, done: false },
          ],
        },
      });
      await p1.next('STATE');
      await p2.next('STATE');

      p1.send({ type: 'THROW_YUT' });
      const yr = await p1.next('YUT_RESULT');
      await p1.next('STATE');
      // p2도 같은 broadcast 받음 — 소화
      try { p2.drain('YUT_RESULT'); } catch (_) { /* noop */ }
      try { p2.drain('STATE'); } catch (_) { /* noop */ }

      if (yr.result === 'backdo' && yr.discarded === true) {
        foundDiscarded = true;
      }
    }
    expect(foundDiscarded).toBe(true);
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C5-009: 보드 위 말이 있을 때 backdo는 정상 적용 (§9-2)', () => {
  // Given: 외곽 임의 칸들
  // When: 백도 적용 (computeNextCell 직접 호출 — HOME 차단 로직 우회한 후행 케이스)
  // Then: 각 칸이 정상적으로 1칸 뒤로
  expect(computeNextCell(2, -1).toCell).toBe(1);
  expect(computeNextCell(5, -1).toCell).toBe(4);
  expect(computeNextCell(11, -1).toCell).toBe(10);
});

test('YR-C5-010: 외곽 임의 칸(3, 10, 19)에서 backdo → 각각 2, 9, 18 (§9-2)', () => {
  // Given: 외곽 칸 3, 10, 19
  // When: 백도 이동
  // Then: 각각 1칸 뒤 (2, 9, 18)
  expect(computeNextCell(3, -1).toCell).toBe(2);
  expect(computeNextCell(10, -1).toCell).toBe(9);
  expect(computeNextCell(19, -1).toCell).toBe(18);
});
