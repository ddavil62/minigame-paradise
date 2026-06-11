/**
 * @fileoverview YR-C18 시리즈 — FIX-4 capturedBonus 소진 타이밍 정밀화 (4개)
 * 룰북 참조: minigames/yutnori/docs/RULEBOOK.md §6 (보너스), §13-11 (capturedBonus 라이프사이클)
 *
 * 검증 내용:
 *   FIX-4: capturedBonus 소진은 "큐가 비어 있어 capturedBonus 권리로 진입한 던지기"일 때만.
 *     - YR-C18-001: 큐 빈 상태 + capturedBonus=true로 THROW → 소진 → MOVE 후 턴 전환.
 *     - YR-C18-002: 큐에 yut 있고 capturedBonus=true로 THROW → 보존 → 모든 결과 소진 후에도 턴 유지.
 *     - YR-C18-003: QA-D2-001 회귀 — capturedBonus=true + 큐 ['do'] → MOVE 후 p2 턴.
 *     - YR-C18-004: QA-D2-002 회귀 — 실제 WS 사이클 잡기 보너스 THROW → MOVE 후 턴 전환.
 */

import { test, expect } from 'playwright/test';
import { createApp } from '../server.js';
import { startServer, stopServer, setupGame, inject } from './rulebook-helpers.js';

const HOME = -1;

// ── §6 FIX-4 소진 (큐 빈 진입) ───────────────────────────────────

test('YR-C18-001: 큐 빈 상태 capturedBonus=true로 THROW → 소진 후 MOVE 시 턴 전환 (§6 FIX-4)', async () => {
  // Given: 큐 빈 상태 + capturedBonus=true (잡기 보너스 권리로 진입), P1 말 1개 칸 5.
  // When: THROW(보너스 권리로 진입 → capturedBonus 소진) → 결과가 non-bonus면 MOVE 후 큐 빔.
  // Then: capturedBonus 소진되어 hasBonus=false → passTurn → currentTurn=p2.
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    let nonBonus = null;
    // 큐 빈 + capturedBonus=true로 던져서 non-bonus(do/gae/geol/backdo아님) 확보.
    for (let attempt = 0; attempt < 40 && !nonBonus; attempt++) {
      await inject(port, {
        started: true,
        currentTurn: 'p1',
        pendingResults: [],
        capturedBonus: true,
        pieces: {
          p1: [
            { cell: 5, stack: 1, done: false },
            { cell: HOME, stack: 1, done: false },
            { cell: HOME, stack: 1, done: false },
            { cell: HOME, stack: 1, done: false },
          ],
          p2: [
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
      p2.drain('YUT_RESULT'); p2.drain('STATE');
      if (yr.result === 'do' || yr.result === 'gae' || yr.result === 'geol') {
        nonBonus = yr.result;
      }
    }
    expect(nonBonus).toBeTruthy();

    // 큐에는 nonBonus 1개. MOVE 시 'outer' 분기 불필요 — cell 5는 corner이므로 분기 대기 발생.
    // 분기를 피하기 위해 MOVE 후 BRANCH_REQUEST가 오면 outer로 처리하여 큐를 비운다.
    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: nonBonus });
    let st = await p1.next('STATE');
    if (st.awaitingBranchAt !== null) {
      // corner 분기 — 외곽 선택으로 이동 완료
      p1.drain('BRANCH_REQUEST');
      p1.send({ type: 'CHOOSE_PATH', pathChoice: 'outer' });
      st = await p1.next('STATE');
    }
    p2.drain('STATE'); p2.drain('BRANCH_REQUEST');

    // capturedBonus 소진됨 → 큐 비고 non-bonus → passTurn
    expect(st.currentTurn).toBe('p2');
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C18-002: 큐에 yut 있고 capturedBonus=true로 THROW → capturedBonus 보존 (§6 FIX-4)', async () => {
  // Given: 큐=['yut'] + capturedBonus=true (잡기 보너스 권리 보유 + 윷 던지기 권리).
  // When: THROW(큐에 yut 있어 진입 — capturedBonus 권리로 진입한 게 아님) → capturedBonus 보존.
  //       이후 yut과 추가 결과(non-bonus)를 모두 사용해 큐를 비운다.
  // Then: capturedBonus가 보존(true)이므로 큐가 비고 마지막 결과가 non-bonus여도 턴 유지(p1).
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    let extra = null;
    for (let attempt = 0; attempt < 40 && !extra; attempt++) {
      await inject(port, {
        started: true,
        currentTurn: 'p1',
        pendingResults: ['yut'],
        capturedBonus: true,
        pieces: {
          p1: [
            { cell: 1, stack: 1, done: false },
            { cell: HOME, stack: 1, done: false },
            { cell: HOME, stack: 1, done: false },
            { cell: HOME, stack: 1, done: false },
          ],
          p2: [
            { cell: HOME, stack: 1, done: false },
            { cell: HOME, stack: 1, done: false },
            { cell: HOME, stack: 1, done: false },
            { cell: HOME, stack: 1, done: false },
          ],
        },
      });
      await p1.next('STATE');
      await p2.next('STATE');

      // 큐에 yut가 있으므로 THROW 허용. 이 던지기에서 capturedBonus는 보존돼야 한다.
      p1.send({ type: 'THROW_YUT' });
      const yr = await p1.next('YUT_RESULT');
      await p1.next('STATE');
      p2.drain('YUT_RESULT'); p2.drain('STATE');
      if (yr.result === 'do' || yr.result === 'gae' || yr.result === 'geol') {
        extra = yr.result; // 큐는 ['yut', extra]
      }
    }
    expect(extra).toBeTruthy();

    // 큐 정리: ['yut', extra]를 명확히 세팅 (capturedBonus는 보존된 상태여야 하므로 inject로 강제하지 않음).
    // 두 결과를 모두 사용 — yut부터 사용(cell 1 → 5), 그 다음 extra 사용.
    // yut 사용: 1 → 2 → 3 → 4 → 5 (모서리 도달, 멈춤). 분기 대기 없음(도착만).
    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'yut' });
    let st = await p1.next('STATE');
    p2.drain('STATE');
    expect(st.currentTurn).toBe('p1'); // 큐에 extra 남아 턴 유지

    // extra 사용: cell 5는 모서리 → 분기 대기 발생. outer로 진행하여 큐를 비운다.
    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: extra });
    st = await p1.next('STATE');
    if (st.awaitingBranchAt !== null) {
      p1.drain('BRANCH_REQUEST');
      p1.send({ type: 'CHOOSE_PATH', pathChoice: 'outer' });
      st = await p1.next('STATE');
    }
    p2.drain('STATE'); p2.drain('BRANCH_REQUEST');

    // 큐가 비고 마지막 결과 non-bonus여도, capturedBonus가 보존(true)이므로 턴 유지.
    expect(st.pendingResults).toEqual([]);
    expect(st.currentTurn).toBe('p1');
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

// ── §13-11 회귀: QA-D2 데드락 가드 ───────────────────────────────

test('YR-C18-003: FIX-4 — capturedBonus=true(미소진) + 큐 ["do"]에서 MOVE → 턴 보존(p1) + 추가 던지기 권리 (§6 §13-11)', async () => {
  // ── 기댓값 변경 사유 (FIX-4, §6 잡기 보너스 보존) ──────────────────────────
  // 이 상태(capturedBonus=true + 큐=['do'])는 정상 게임 흐름에서 다음과 같이 발생한다:
  //   큐 ['gae','do'] 중 gae로 잡기 → capturedBonus=true, 잔여 ['do'] → do로 이동 → 큐 소진.
  // 이때 잡기 보너스(추가 던지기 1회) 권리는 아직 미소진이므로 플레이어는 던지기를 1회 더 보유한다.
  // MOVE 핸들러는 큐가 비어도 hasBonus(=capturedBonus===true)면 passTurn하지 않는다 → 턴 보존(p1).
  // 이것이 FIX-4의 취지(잡기 보너스 보존)다.
  //
  // 본 케이스는 "THROW로 진입하며 capturedBonus를 소진한 뒤"의 QA-D2-001 데드락 흐름과 다르다.
  // QA-D2-001 데드락 흐름(잡기 → 큐 빈 상태 → 보너스 THROW(소진) → non-bonus → MOVE → passTurn)은
  // YR-C18-004가 별도로 회귀 검증한다. (이전 기댓값 p2는 이 두 흐름을 혼동한 것 — 메인 오케스트레이터 판정)
  // ──────────────────────────────────────────────────────────────────────────
  // Given: capturedBonus=true(미소진), 큐=['do'], P1 말 칸 1.
  // When: MOVE_PIECE('do') — THROW를 거치지 않으므로 capturedBonus는 그대로 보존.
  // Then: 큐는 비지만 hasBonus=true → 턴 보존(p1). 이후 추가 THROW 1회 가능(non-bonus여도 그 뒤 passTurn).
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, {
      currentTurn: 'p1',
      pendingResults: ['do'],
      capturedBonus: true,
      pieces: {
        p1: [
          { cell: 1, stack: 1, done: false },
          { cell: HOME, stack: 1, done: false },
          { cell: HOME, stack: 1, done: false },
          { cell: HOME, stack: 1, done: false },
        ],
        p2: [
          { cell: HOME, stack: 1, done: false },
          { cell: HOME, stack: 1, done: false },
          { cell: HOME, stack: 1, done: false },
          { cell: HOME, stack: 1, done: false },
        ],
      },
    });
    await p1.next('STATE');
    await p2.next('STATE');

    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
    let st = await p1.next('STATE');
    p2.drain('STATE');
    // 큐 소진됐지만 잡기 보너스 권리(capturedBonus)가 미소진 → 턴 보존.
    expect(st.pendingResults).toEqual([]);
    expect(st.currentTurn).toBe('p1');

    // 보유한 추가 던지기 권리로 THROW 가능해야 한다(데드락 없음). 이 THROW는 큐 빈 진입 → capturedBonus 소진.
    p1.send({ type: 'THROW_YUT' });
    await p1.next('YUT_RESULT');
    st = await p1.next('STATE');
    p2.drain('YUT_RESULT'); p2.drain('STATE');
    // THROW가 정상 수락되어 큐에 결과 1개가 쌓였다(권리 행사 성공 = 데드락 아님).
    expect(st.pendingResults.length).toBeGreaterThanOrEqual(1);
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C18-004: QA-D2-002 회귀 — 잡기 보너스 THROW(non-bonus) → MOVE 후 턴 전환 (§13-11)', async () => {
  // Given: 잡기 직후 상태 — capturedBonus=true, 큐 비어 있음, P1 말 칸 1.
  // When: 보너스 THROW(큐 빈 진입 → capturedBonus 소진) → non-bonus 결과로 MOVE.
  // Then: 큐 비고 capturedBonus 소진 → passTurn → currentTurn=p2.
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    let nonBonus = null;
    for (let attempt = 0; attempt < 40 && !nonBonus; attempt++) {
      await inject(port, {
        currentTurn: 'p1',
        pendingResults: [],
        capturedBonus: true,
        pieces: {
          p1: [
            { cell: 1, stack: 1, done: false },
            { cell: HOME, stack: 1, done: false },
            { cell: HOME, stack: 1, done: false },
            { cell: HOME, stack: 1, done: false },
          ],
          p2: [
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
      p2.drain('YUT_RESULT'); p2.drain('STATE');
      if (yr.result === 'do' || yr.result === 'gae' || yr.result === 'geol') {
        nonBonus = yr.result;
      }
    }
    expect(nonBonus).toBeTruthy();

    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: nonBonus });
    const st = await p1.next('STATE');
    p2.drain('STATE');
    expect(st.currentTurn).toBe('p2');
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});
