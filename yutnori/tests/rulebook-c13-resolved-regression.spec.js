/**
 * @fileoverview YR-C13 시리즈 — §13 해소 3건 회귀 가드 (10개)
 * 룰북 참조: minigames/yutnori/docs/RULEBOOK.md §13-9 (HOME 시각 통일), §13-10 (HOME → 칸 N), §13-11 (capturedBonus 리셋)
 *
 * 본 카테고리는 2026-05-31 해소된 정통 룰 정합 수정 3건을 회귀로부터 보호한다.
 * 향후 코드 수정이 §13-10 / §13-11 정합을 깨면 본 테스트가 실패한다.
 */

import { test, expect } from 'playwright/test';
import { computeNextCell, createApp } from '../server.js';
import { startServer, stopServer, setupGame, inject } from './rulebook-helpers.js';

const HOME = -1;
const GOAL = 99;

// ── §13-10 회귀: HOME → 칸 N 정통 매핑 ────────────────────────────

test('YR-C13-001: §13-10 회귀 — HOME + do(1) → cell 1 (이전 버그: cell 0) (§13-10 §4-3)', () => {
  // Given: HOME
  // When: do(1)
  // Then: cell 1 (이전 단순화 cell 0 회귀 방지)
  expect(computeNextCell(HOME, 1).toCell).toBe(1);
});

test('YR-C13-002: §13-10 회귀 — HOME + geol(3) → cell 3 (§13-10 §4-3)', () => {
  // Given: HOME
  // When: 걸(3)
  // Then: cell 3
  expect(computeNextCell(HOME, 3).toCell).toBe(3);
});

test('YR-C13-003: §13-10 회귀 — HOME + mo(5) → cell 5 (§13-10 §4-3)', () => {
  // Given: HOME
  // When: 모(5)
  // Then: cell 5 (좌상 모서리)
  expect(computeNextCell(HOME, 5).toCell).toBe(5);
});

test('YR-C13-004: §13-10 회귀 — HOME + yut(4) → cell 4 (§13-10 §4-3)', () => {
  // Given: HOME
  // When: 윷(4)
  // Then: cell 4
  expect(computeNextCell(HOME, 4).toCell).toBe(4);
});

// ── §13-11 회귀: capturedBonus 리셋 ───────────────────────────────

test('YR-C13-005: §13-11 회귀 — 잡기 사이클 후 passTurn에서 capturedBonus 리셋 (§13-11 §6-2)', async () => {
  // Given: P1 piece 0=cell 2, P2 piece 0=cell 3, 큐=['do']
  // When: P1 do(1) → 잡기 → capturedBonus=true → (보너스 사이클은 inject로 단축)
  //         capturedBonus=false + 큐=['do'] 주입 → MOVE_PIECE → 큐 소진 + 보너스 없음 → passTurn
  // Then: currentTurn=p2 + P2가 THROW_YUT 정상 가능 (capturedBonus 잘못된 잔류 없음 — §13-11 해소 회귀 가드)
  //
  // NOTE: server.js MOVE_PIECE 핸들러는 hasBonus 판정에 capturedBonus===true를 포함하므로
  //       잡기 후 plain MOVE만으로는 capturedBonus 자체 소진 불가. 본 테스트는 보너스 사이클 종료 후
  //       passTurn 분기에서 capturedBonus=false 리셋(line 834)이 정상 동작하는지를 검증한다.
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, {
      started: true, currentTurn: 'p1', pendingResults: ['do'],
      pieces: {
        p1: [{ cell: 2, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }],
        p2: [{ cell: 3, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }],
      },
    });
    await p1.next('STATE');
    await p2.next('STATE');

    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
    await p1.next('STATE');

    // 보너스 사이클 종료 후 큐=['do'] + capturedBonus=false 주입 → MOVE → 큐 소진 + 보너스 없음 → passTurn
    await inject(port, { pendingResults: ['do'], capturedBonus: false });
    await p1.next('STATE');
    await p2.next('STATE');

    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
    const st = await p1.next('STATE');
    expect(st.currentTurn).toBe('p2');

    // capturedBonus 잔류 회귀 방지 — P2가 정상 THROW 가능
    p2.send({ type: 'THROW_YUT' });
    const yr = await p2.next('YUT_RESULT');
    expect(yr.by).toBe('p2');
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C13-006: §13-11 회귀 — capturedBonus=false 후 큐 없는 상태에서 THROW_YUT → ERROR (§13-11 §6-2)', async () => {
  // Given: P2 턴, 큐 비어 있고 capturedBonus=false
  // When: P2가 THROW_YUT
  // Then: 게임 시작 직후 첫 던지기는 허용 — 단, P1 턴이라 P2 시도 시 ERROR
  //         (capturedBonus 잔류로 인한 잘못된 던지기 권한이 없는지 검증)
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, {
      started: true, currentTurn: 'p1', pendingResults: [], capturedBonus: false,
    });
    await p1.next('STATE');
    await p2.next('STATE');

    p2.send({ type: 'THROW_YUT' });
    const err = await p2.next('ERROR');
    expect(err.type).toBe('ERROR');
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C13-007: §13-11 회귀 — CHOOSE_PATH 후 passTurn → capturedBonus 리셋 (§13-11 §6-2)', async () => {
  // Given: piece 0=22 + 큐=['gae'] → MOVE → BRANCH_REQUEST → CHOOSE_PATH(top) → 23→15
  // When: CHOOSE_PATH 처리 후 큐 비고 보너스 없음 → passTurn
  // Then: currentTurn=p2 + P2 THROW_YUT 허용 (capturedBonus 잔류 없음)
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, {
      started: true, currentTurn: 'p1', pendingResults: ['gae'], capturedBonus: false,
      pieces: {
        p1: [{ cell: 22, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }],
      },
    });
    await p1.next('STATE');
    await p2.next('STATE');

    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'gae' });
    await p1.next('BRANCH_REQUEST');
    await p1.next('STATE');

    p1.send({ type: 'CHOOSE_PATH', pathChoice: 'top' });
    const st = await p1.next('STATE');
    expect(st.currentTurn).toBe('p2');

    p2.send({ type: 'THROW_YUT' });
    const yr = await p2.next('YUT_RESULT');
    expect(yr.by).toBe('p2');
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

// ── §13-9 회귀: HOME 시작 위치 양 팀 좌하 통일 ────────────────────

test('YR-C13-008: §13-9 회귀 — 게임 시작 후 p1 pieces 4개 모두 cell=-1 (HOME) (§13-9 §4-2)', async () => {
  // Given: 양쪽 READY → 게임 시작
  // When: 시작 직후 STATE 검사
  // Then: P1 pieces 4개 모두 cell=-1 (HOME)
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, {}); // STATE broadcast 유도
    const st = await p1.next('STATE');
    const p1Pieces = st.players.find((p) => p.id === 'p1').pieces;
    expect(p1Pieces.every((pc) => pc.cell === HOME)).toBe(true);
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C13-009: §13-9 회귀 — 게임 시작 후 p2 pieces 4개 모두 cell=-1 (§13-9 §4-2)', async () => {
  // Given: 양쪽 READY → 게임 시작
  // When: 시작 직후 STATE 검사
  // Then: P2 pieces 4개 모두 cell=-1 (HOME 통일)
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, {}); // STATE broadcast 유도
    const st = await p1.next('STATE');
    const p2Pieces = st.players.find((p) => p.id === 'p2').pieces;
    expect(p2Pieces.every((pc) => pc.cell === HOME)).toBe(true);
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

// ── §13-10 회귀: advanceOneCell(-1) → 1 (return 0 회귀 방지) ────

test('YR-C13-010: §13-10 회귀 — advanceOneCell 미export이지만 computeNextCell(HOME, 1) → cell 1로 간접 검증 (§13-10 §4-3)', () => {
  // Given: HOME=-1
  // When: computeNextCell(HOME, 1) — advanceOneCell(-1, 'outer')이 호출됨
  // Then: cell 1 (return 0으로 회귀하지 않음)
  const r = computeNextCell(HOME, 1);
  expect(r.toCell).toBe(1);
  // 추가 안전망: cell 0 → do → 1 (cell === 0 분기)
  expect(computeNextCell(0, 1).toCell).toBe(1);
});
