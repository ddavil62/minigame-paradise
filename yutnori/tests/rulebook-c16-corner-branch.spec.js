/**
 * @fileoverview YR-C16 시리즈 — FIX-2 모서리(5/10) 외곽/지름길 분기 (9개)
 * 룰북 참조: minigames/yutnori/docs/RULEBOOK.md §10-1~3 (모서리 분기), §13-1 (외곽/지름길 선택, 2026-06-11 해소)
 *
 * 검증 내용:
 *   - computeNextCell 단위: 모서리에서 branchChoice=null → awaitingBranch, 'outer'/'shortcut' 분기.
 *   - 모서리 통과(멈추지 않음)는 분기 없음.
 *   - WS 통합: MOVE_PIECE → BRANCH_REQUEST(branchType='corner') → CHOOSE_PATH(outer/shortcut).
 */

import { test, expect } from 'playwright/test';
import { computeNextCell, createApp } from '../server.js';
import { startServer, stopServer, setupGame, inject } from './rulebook-helpers.js';

const HOME = -1;

// ── §10-2 §13-1 단위: 분기 대기 / outer / shortcut ───────────────

test('YR-C16-001: cell 5 + do(1) + null → awaitingBranch=true, toCell=5 (§10-2 §13-1)', () => {
  // Given: 좌상 모서리 5에 멈춤
  // When: 도(1), 분기 미선택
  // Then: 분기 대기 (piece 미이동)
  const r = computeNextCell(5, 1, null);
  expect(r.awaitingBranch).toBe(true);
  expect(r.toCell).toBe(5);
});

test('YR-C16-002: cell 5 + do(1) + outer → cell 6 (외곽 계속) (§10-2 §13-1)', () => {
  // Given: 모서리 5
  // When: 도(1) + 외곽 선택
  // Then: 외곽 진행 칸 6
  const r = computeNextCell(5, 1, 'outer');
  expect(r.toCell).toBe(6);
  expect(r.awaitingBranch).toBe(false);
});

test('YR-C16-003: cell 5 + do(1) + shortcut → cell 21 (지름길 진입) (§10-2 §13-1)', () => {
  // Given: 모서리 5
  // When: 도(1) + 지름길 선택
  // Then: 지름길A 칸 21
  const r = computeNextCell(5, 1, 'shortcut');
  expect(r.toCell).toBe(21);
  expect(r.awaitingBranch).toBe(false);
});

test('YR-C16-004: cell 10 + gae(2) + outer → cell 12 (외곽 계속) (§10-2 §13-1)', () => {
  // Given: 우상 모서리 10
  // When: 개(2) + 외곽 선택 — 10→11→12
  // Then: 칸 12
  expect(computeNextCell(10, 2, 'outer').toCell).toBe(12);
});

test('YR-C16-005: cell 10 + gae(2) + shortcut → cell 27 (지름길B) (§10-2 §13-1)', () => {
  // Given: 모서리 10
  // When: 개(2) + 지름길 선택 — 10→26→27
  // Then: 칸 27
  expect(computeNextCell(10, 2, 'shortcut').toCell).toBe(27);
});

test('YR-C16-006: cell 4 + gae(2) → cell 6 (모서리 5 통과, 분기 없음) (§10-1)', () => {
  // Given: 칸 4 (모서리 직전)
  // When: 개(2) — 4→5→6 (5에 멈추지 않고 통과)
  // Then: 분기 없이 외곽 유지 칸 6
  const r = computeNextCell(4, 2);
  expect(r.toCell).toBe(6);
  expect(r.awaitingBranch).toBe(false);
});

test('YR-C16-007: cell 5 + yut(4) + shortcut → 중앙 도달 시 awaitingBranch=true (§10-2 §10-3 §13-1)', () => {
  // Given: 모서리 5
  // When: 윷(4) + 지름길 선택 — 5→21→22→23(중앙, 잔여 1) → 중앙 분기 대기
  // Then: 중앙(23) 도달 후 새 분기(center) 대기. corner 선택값('shortcut')은 중앙 출구로 해석되지 않음.
  const r = computeNextCell(5, 4, 'shortcut');
  expect(r.toCell).toBe(23);
  expect(r.awaitingBranch).toBe(true);
});

// ── §10-2 WS 통합: BRANCH_REQUEST branchType / CHOOSE_PATH ────────

test('YR-C16-008: WS — 모서리 MOVE 후 BRANCH_REQUEST에 branchType=corner 포함 (§10-2 §13-1)', async () => {
  // Given: cell 5에 P1 말, pendingResults=['do']
  // When: MOVE_PIECE
  // Then: BRANCH_REQUEST.branchType === 'corner', STATE.awaitingBranchType === 'corner'
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, {
      started: true,
      currentTurn: 'p1',
      pendingResults: ['do'],
      pieces: {
        p1: [
          { cell: 5, stack: 1, done: false },
          { cell: HOME, stack: 1, done: false },
          { cell: HOME, stack: 1, done: false },
          { cell: HOME, stack: 1, done: false },
        ],
      },
    });
    await p1.next('STATE');
    await p2.next('STATE');

    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
    const br = await p1.next('BRANCH_REQUEST');
    expect(br.branchType).toBe('corner');
    expect(br.pieceIndex).toBe(0);
    const st = await p1.next('STATE');
    expect(st.awaitingBranchType).toBe('corner');
    expect(st.awaitingBranchAt).toBe(0);
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C16-009: WS — CHOOSE_PATH(shortcut) 후 cell 21 STATE 반영 (§10-2 §13-1)', async () => {
  // Given: cell 5 모서리 MOVE → BRANCH_REQUEST(corner) 대기
  // When: CHOOSE_PATH(pathChoice='shortcut')
  // Then: piece가 칸 21로 이동, awaitingBranch* 초기화
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, {
      started: true,
      currentTurn: 'p1',
      pendingResults: ['do'],
      pieces: {
        p1: [
          { cell: 5, stack: 1, done: false },
          { cell: HOME, stack: 1, done: false },
          { cell: HOME, stack: 1, done: false },
          { cell: HOME, stack: 1, done: false },
        ],
      },
    });
    await p1.next('STATE');
    await p2.next('STATE');

    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
    await p1.next('BRANCH_REQUEST');
    await p1.next('STATE');
    p2.drain('BRANCH_REQUEST'); p2.drain('STATE');

    p1.send({ type: 'CHOOSE_PATH', pathChoice: 'shortcut' });
    const st = await p1.next('STATE');
    p2.drain('STATE');
    const me = st.players.find((p) => p.id === 'p1');
    expect(me.pieces[0].cell).toBe(21);
    expect(st.awaitingBranchAt).toBe(null);
    expect(st.awaitingBranchType).toBe(null);
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

// ── §10-2 §10-3 WS 통합: 모서리 지름길 → 중앙 통과 중첩 분기 (FIX-2 결함 수정) ──
//
// 결함(2026-06-11): 모서리5/10 + 윷(4)/모(5) → 'shortcut' 선택 시 지름길로 중앙을 통과하는데,
//   CHOOSE_PATH 핸들러가 awaitingBranch를 처리하지 않아 큐만 차감되고 말은 제자리에 남았다
//   (윷/모 결과 증발 + 말 미이동, HIGH). 수정: 중앙 분기를 재대기(center)시키고, 2차 'top'/'bottom'을
//   모서리 지름길 선택과 합성('shortcut-top'/'shortcut-bottom')하여 출구까지 한 번에 계산한다.

test('YR-C16-010: WS — 모서리5+윷 → shortcut → center 재수신(큐 미차감) → top → 칸 15 (§10-2 §10-3)', async () => {
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    // Given: P1 말 1개 좌상 모서리 5 + 큐=['yut'].
    await inject(port, {
      started: true, currentTurn: 'p1', pendingResults: ['yut'],
      pieces: {
        p1: [
          { cell: 5, stack: 1, done: false },
          { cell: HOME, stack: 1, done: false },
          { cell: HOME, stack: 1, done: false },
          { cell: HOME, stack: 1, done: false },
        ],
      },
    });
    await p1.next('STATE');
    await p2.next('STATE');

    // 1) MOVE_PIECE(yut) → corner 분기 대기.
    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'yut' });
    const cornerReq = await p1.next('BRANCH_REQUEST');
    expect(cornerReq.branchType).toBe('corner');
    await p1.next('STATE');
    p2.drain('BRANCH_REQUEST'); p2.drain('STATE');

    // 2) CHOOSE_PATH('shortcut') → 지름길A 진입 후 중앙 통과(잔여 steps) → center 재대기.
    p1.send({ type: 'CHOOSE_PATH', pathChoice: 'shortcut' });
    const centerReq = await p1.next('BRANCH_REQUEST');
    expect(centerReq.branchType).toBe('center'); // 중첩 분기 재무장 핵심
    const centerState = await p1.next('STATE');
    p2.drain('BRANCH_REQUEST'); p2.drain('STATE');

    // Then(중간): 큐 미차감 — 'yut' 잔존(결과 증발 방지) + 말 모서리5 유지.
    expect(centerState.pendingResults).toEqual(['yut']);
    expect(centerState.awaitingBranchType).toBe('center');
    expect(centerState.players.find((p) => p.id === 'p1').pieces[0].cell).toBe(5);

    // 3) CHOOSE_PATH('top') → 'shortcut-top' 합성 → 5→21→22→23→15.
    p1.send({ type: 'CHOOSE_PATH', pathChoice: 'top' });
    const finalState = await p1.next('STATE');
    p2.drain('STATE');

    // Then: 말 칸 15 도착 + 큐 1회만 차감(빈 큐).
    expect(finalState.players.find((p) => p.id === 'p1').pieces[0].cell).toBe(15);
    expect(finalState.pendingResults).toEqual([]);
    expect(finalState.awaitingBranchAt).toBe(null);
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C16-011: WS — 모서리10+모 → shortcut → center 재수신 → bottom → 칸 25 (§10-2 §10-3)', async () => {
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    // Given: P1 말 1개 우상 모서리 10 + 큐=['mo'].
    await inject(port, {
      started: true, currentTurn: 'p1', pendingResults: ['mo'],
      pieces: {
        p1: [
          { cell: 10, stack: 1, done: false },
          { cell: HOME, stack: 1, done: false },
          { cell: HOME, stack: 1, done: false },
          { cell: HOME, stack: 1, done: false },
        ],
      },
    });
    await p1.next('STATE');
    await p2.next('STATE');

    // 1) MOVE_PIECE(mo) → corner 분기 대기.
    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'mo' });
    const cornerReq = await p1.next('BRANCH_REQUEST');
    expect(cornerReq.branchType).toBe('corner');
    await p1.next('STATE');
    p2.drain('BRANCH_REQUEST'); p2.drain('STATE');

    // 2) CHOOSE_PATH('shortcut') → 지름길B 진입 후 중앙 통과 → center 재대기.
    p1.send({ type: 'CHOOSE_PATH', pathChoice: 'shortcut' });
    const centerReq = await p1.next('BRANCH_REQUEST');
    expect(centerReq.branchType).toBe('center');
    const centerState = await p1.next('STATE');
    p2.drain('BRANCH_REQUEST'); p2.drain('STATE');
    expect(centerState.pendingResults).toEqual(['mo']); // 큐 미차감

    // 3) CHOOSE_PATH('bottom') → 'shortcut-bottom' 합성 → 10→26→27→23→24→25.
    p1.send({ type: 'CHOOSE_PATH', pathChoice: 'bottom' });
    const finalState = await p1.next('STATE');
    p2.drain('STATE');

    // Then: 말 칸 25 도착 + 큐 1회만 차감.
    expect(finalState.players.find((p) => p.id === 'p1').pieces[0].cell).toBe(25);
    expect(finalState.pendingResults).toEqual([]);
    expect(finalState.awaitingBranchAt).toBe(null);
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});
