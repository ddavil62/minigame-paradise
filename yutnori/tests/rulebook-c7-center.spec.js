/**
 * @fileoverview YR-C7 시리즈 — 중앙 분기 (10개)
 * 룰북 참조: minigames/yutnori/docs/RULEBOOK.md §10-3~5 (중앙 출구), §13-2 (centerExitB 즉시 완주), §13-6 (양방향 자유)
 *
 * YR-C7-001~009: computeNextCell 단위 직접 import.
 * YR-C7-010: WS inject + MOVE_PIECE 후 awaitingBranchAt STATE 검증.
 */

import { test, expect } from 'playwright/test';
import { computeNextCell, createApp } from '../server.js';
import { startServer, stopServer, setupGame, inject } from './rulebook-helpers.js';

const GOAL = 99;

// ── §10-3 centerExitA (top) ────────────────────────────────────────

test('YR-C7-001: cell 23 + do(1) + branchChoice=null → awaitingBranch=true (§10-3)', () => {
  // Given: 중앙 23에서 출발 분기 미결정
  // When: branchChoice=null로 호출
  // Then: awaitingBranch=true (분기 선택 요청)
  const r = computeNextCell(23, 1, null);
  expect(r.toCell).toBe(23);
  expect(r.awaitingBranch).toBe(true);
});

test('YR-C7-002: cell 23 + do(1) + top → cell 28 (centerExitA 중간 칸, 버그B 2026-06-16) (§10-3)', () => {
  // 갱신 사유: 버그B 수정(2026-06-16) — centerExitA가 23→15 즉시 합류에서
  //   23→28→29→15로 변경(centerExitB 24/25와 대칭). 도(1)이면 첫 중간 칸 28.
  // Given: 중앙 23
  // When: top 분기 + 도(1)
  // Then: 칸 28 (centerExitA 첫 중간 칸)
  expect(computeNextCell(23, 1, 'top').toCell).toBe(28);
});

test('YR-C7-003: cell 23 + gae(2) + top → cell 29 (23→28→29, 버그B 2026-06-16) (§10-3)', () => {
  // 갱신 사유: 버그B 수정 — 23→28→29.
  // Given: 중앙 23
  // When: top + 개(2)
  // Then: 칸 29 (centerExitA 둘째 중간 칸)
  expect(computeNextCell(23, 2, 'top').toCell).toBe(29);
});

test('YR-C7-004: cell 23 + mo(5) + top → cell 17 (23→28→29→15→16→17, 버그B 2026-06-16) (§10-3)', () => {
  // 갱신 사유: 버그B 수정 — 중간 칸 28/29 추가로 외곽 합류 2칸 늦어짐.
  // Given: 중앙 23
  // When: top + 모(5) — 23→28→29→15→16→17
  // Then: 칸 17
  expect(computeNextCell(23, 5, 'top').toCell).toBe(17);
});

test('YR-C7-005: cell 23 + 6 + top → cell 18 (23→28→29→15→16→17→18, 버그B 2026-06-16) (§10-3 §11-3)', () => {
  // 갱신 사유: 버그B 수정 — 중간 칸 2개 추가로 6칸이어도 GOAL 미도달(cell 18 정착).
  // Given: 중앙 23
  // When: top + 6칸 — 23→28→29→15→16→17→18
  // Then: 칸 18 (완주 직전, passedStart=false)
  const r = computeNextCell(23, 6, 'top');
  expect(r.toCell).toBe(18);
  expect(r.passedStart).toBe(false);
});

// ── §10-4 §13-2 centerExitB (bottom) — 24/25 거쳐 완주 ───────────

test('YR-C7-006: cell 23 + do(1) + bottom → cell 24 (centerExitB 중간 칸) (§10-4 §13-2)', () => {
  // 갱신 사유: §13-2 해소 — 즉시 GOAL에서 23→24→25→GOAL 잔여 steps 소진으로 변경.
  // Given: 중앙 23
  // When: bottom + 도(1)
  // Then: 칸 24 (날밭 첫 칸)
  const r = computeNextCell(23, 1, 'bottom');
  expect(r.toCell).toBe(24);
  expect(r.passedStart).toBe(false);
});

test('YR-C7-007: cell 23 + mo(5) + bottom → GOAL (24→25→GOAL 잔여 소진) (§10-4 §13-2)', () => {
  // 갱신 사유: §13-2 해소 — steps가 경로 길이(3)를 초과하면 잔여 소진 후 GOAL.
  // Given: 중앙 23
  // When: bottom + 모(5) — 23→24→25→GOAL(잔여 흡수)
  // Then: GOAL
  const r = computeNextCell(23, 5, 'bottom');
  expect(r.toCell).toBe(GOAL);
  expect(r.passedStart).toBe(true);
});

// ── §10-5 §13-6 진입 경로별 출구 (지름길B 자동 / 지름길A 자유) ─────

test('YR-C7-008: 지름길B(10→) 경유 중앙 정착 → 자동 bottom (WS, 모달 없음) (§10-5 §13-6)', async () => {
  // 갱신 사유: §13-6 해소(2026-06-15) — 지름길B 경유 중앙 자동 centerExitB(bottom) 적용.
  //   이전: computeNextCell 자유 선택(bottom 명시) 단위 검증.
  //   변경 후: WS 통합 — 지름길B 칸(27)에서 do(1)로 중앙 23 정착 후, 다음 MOVE_PIECE(do)에서
  //            BRANCH_REQUEST 없이 자동 bottom(centerExitB 첫 칸 24)으로 이동.
  // Given: cell 27(지름길B 안)에 P1 말 + pendingResults=['do','do']
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, {
      started: true,
      currentTurn: 'p1',
      pendingResults: ['do', 'do'],
      pieces: {
        p1: [
          { cell: 27, stack: 1, done: false },
          { cell: -1, stack: 1, done: false },
          { cell: -1, stack: 1, done: false },
          { cell: -1, stack: 1, done: false },
        ],
      },
    });
    await p1.next('STATE');
    await p2.next('STATE');

    // 1차 이동: 27 → 23 (지름길B 경유 중앙 정착, lastPath='shortcutB')
    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
    const s1 = await p1.next('STATE');
    expect(s1.players.find((pp) => pp.id === 'p1').pieces[0].cell).toBe(23);
    // STATE에 lastPath 미노출 확인
    expect(s1.players.find((pp) => pp.id === 'p1').pieces[0].lastPath).toBeUndefined();
    p2.drain('STATE');

    // 2차 이동: 23 → 자동 bottom centerExitB 첫 칸 24 (BRANCH_REQUEST 없음)
    let branchSeen = false;
    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
    const s2 = await p1.next('STATE');
    // STATE 도착 시점까지 BRANCH_REQUEST가 큐에 없어야 함 (자동 라우팅)
    branchSeen = p1.drain('BRANCH_REQUEST') > 0;
    expect(branchSeen).toBe(false);
    expect(s2.players.find((pp) => pp.id === 'p1').pieces[0].cell).toBe(24);
    expect(s2.awaitingBranchAt).toBe(null);
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C7-009: 지름길A(5→) 진입 후에도 bottom 출구 선택 가능 (§10-5 §13-6)', () => {
  // 갱신 사유: FIX-2 — 지름길 진입은 shortcut 명시. §13-2 해소 — bottom은 24 경유.
  // Given: cell 5 + geol(3) + shortcut → 중앙 23 도달 (지름길A 경유)
  // When: 23 + bottom
  // Then: 칸 24 (top/bottom 자유 정책)
  const arrived = computeNextCell(5, 3, 'shortcut');
  expect(arrived.toCell).toBe(23);
  const next = computeNextCell(23, 1, 'bottom');
  expect(next.toCell).toBe(24);
});

// ── §10-3 WS 통합: awaitingBranchAt STATE 반영 ───────────────────

test('YR-C7-010: 중앙(23) 정착 말이 다음 이동 시 awaitingBranchAt=pieceIdx STATE 반영 (§10-3)', async () => {
  // 갱신 사유: 버그A 수정(2026-06-16) — 지름길 경유 중앙 "통과"는 자동 라우팅으로 바뀌어
  //   더 이상 통과 시 BRANCH_REQUEST가 발생하지 않는다. 중앙 분기 모달은 말이 중앙(23)에
  //   **정확히 정착**한 상태에서 다음 이동을 할 때 발생한다. 따라서 setup을 cell 23 정착으로 변경.
  // Given: cell 23에 P1 말 + pendingResults=['gae'] (지름길A 경유 정착 가정 — lastPath 미설정 자유 분기)
  // When: MOVE_PIECE → 23 출발 분기 필요 → BRANCH_REQUEST(center)
  // Then: STATE의 awaitingBranchAt === 이동한 pieceIdx, branchType=center
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, {
      started: true,
      currentTurn: 'p1',
      pendingResults: ['gae'],
      pieces: {
        p1: [
          { cell: 23, stack: 1, done: false },
          { cell: -1, stack: 1, done: false },
          { cell: -1, stack: 1, done: false },
          { cell: -1, stack: 1, done: false },
        ],
      },
    });
    await p1.next('STATE');
    await p2.next('STATE');

    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'gae' });
    const br = await p1.next('BRANCH_REQUEST');
    expect(br.branchType).toBe('center');
    const state = await p1.next('STATE');
    expect(state.awaitingBranchAt).toBe(0);
    expect(state.awaitingBranchResult).toBe('gae');
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

// ── §13-6 지름길B 자동 라우팅 추가 케이스 (2026-06-15 해소) ─────────

test('YR-C7-011: 지름길B 중간 칸(26)+gae(2) 경유 자동 라우팅 (WS, 모달 없음) (§10-5 §13-6)', async () => {
  // §13-6: cell 26(지름길B)에서 개(2)로 26→27→23 중앙 정착(lastPath='shortcutB') →
  //        다음 MOVE_PIECE(do)에서 BRANCH_REQUEST 없이 자동 bottom(cell 24).
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, {
      started: true,
      currentTurn: 'p1',
      pendingResults: ['gae', 'do'],
      pieces: {
        p1: [
          { cell: 26, stack: 1, done: false },
          { cell: -1, stack: 1, done: false },
          { cell: -1, stack: 1, done: false },
          { cell: -1, stack: 1, done: false },
        ],
      },
    });
    await p1.next('STATE');
    await p2.next('STATE');

    // 1차: 26 → 23 (개 2칸, 지름길B 경유 중앙 정착)
    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'gae' });
    const s1 = await p1.next('STATE');
    expect(s1.players.find((pp) => pp.id === 'p1').pieces[0].cell).toBe(23);
    p2.drain('STATE');

    // 2차: 23 → 자동 bottom 24 (모달 없음)
    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
    const s2 = await p1.next('STATE');
    const branchSeen = p1.drain('BRANCH_REQUEST') > 0;
    expect(branchSeen).toBe(false);
    expect(s2.players.find((pp) => pp.id === 'p1').pieces[0].cell).toBe(24);
    expect(s2.awaitingBranchAt).toBe(null);
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C7-012: 지름길A(22) 경유 중앙 정착 → BRANCH_REQUEST 유지(자유 선택) (§10-5 §13-6)', async () => {
  // §13-6 범위 경계: 지름길A 경유 정착 말은 기존 자유 선택(BRANCH_REQUEST center)을 유지한다.
  //   cell 22(지름길A)에서 do(1)로 22→23 정착(lastPath='shortcutA') → 다음 MOVE_PIECE(do)에서
  //   자동 라우팅이 적용되지 않고 BRANCH_REQUEST(center)가 수신되어야 한다.
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, {
      started: true,
      currentTurn: 'p1',
      pendingResults: ['do', 'do'],
      pieces: {
        p1: [
          { cell: 22, stack: 1, done: false },
          { cell: -1, stack: 1, done: false },
          { cell: -1, stack: 1, done: false },
          { cell: -1, stack: 1, done: false },
        ],
      },
    });
    await p1.next('STATE');
    await p2.next('STATE');

    // 1차: 22 → 23 (지름길A 경유 중앙 정착, lastPath='shortcutA')
    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
    const s1 = await p1.next('STATE');
    expect(s1.players.find((pp) => pp.id === 'p1').pieces[0].cell).toBe(23);
    p2.drain('STATE');

    // 2차: 23 + do(1) → 자유 선택 유지 → BRANCH_REQUEST(center) 수신
    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
    const br = await p1.next('BRANCH_REQUEST');
    expect(br.branchType).toBe('center');
    const s2 = await p1.next('STATE');
    expect(s2.awaitingBranchAt).toBe(0); // 분기 대기 상태 (자동 라우팅 미적용)
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});
