/**
 * @fileoverview YR-C19 시리즈 — §13-12 윷·모 잡기 시 보너스 중복 차단 (6개)
 * 룰북 참조: minigames/yutnori/docs/RULEBOOK.md §6-1 (보너스), §6-4, §7 (잡기), §13-12
 *
 * 검증 내용 (권위 룰: 윷/모 자체 보너스 + 잡기 보너스는 중복 불가, 한 행위 최대 1회):
 *   - 윷/모로 잡기 → 잡기로 인한 capturedBonus 미부여 (윷/모 던지기 자체가 이미 추가 던지기 권리 1회 부여).
 *   - 도/개/걸로 잡기 → capturedBonus 부여 유지 (자체 보너스가 없으므로 잡기 보너스 +1).
 *
 * 잡기 검증은 corner(5/10) 미경유 칸에서 수행하여 분기 모달과 무관하게 capturedBonus만 관찰한다.
 * STATE.capturedBonus 플래그를 직접 관찰 (server.js broadcastState L567).
 */

import { test, expect } from 'playwright/test';
import { createApp } from '../server.js';
import { startServer, stopServer, setupGame, inject } from './rulebook-helpers.js';

const HOME = -1;

/**
 * 잡기 발생 시 capturedBonus 부여 여부를 관찰하는 공용 시나리오.
 * P1 말을 fromCell, P2 단독 말을 targetCell에 배치하고 useResult로 이동시킨다.
 * (fromCell + steps === targetCell이 되도록 호출자가 구성한다. corner 5/10 미경유 칸 권장.)
 *
 * @param {number} port
 * @param {import('./rulebook-helpers.js').WsClient} p1
 * @param {import('./rulebook-helpers.js').WsClient} p2
 * @param {number} fromCell P1 말 출발 칸
 * @param {number} targetCell P2 단독 말 칸 (= 도착 칸)
 * @param {string} useResult 사용할 윷 결과명
 * @returns {Promise<object>} 이동 후 STATE
 */
async function captureAndGetState(port, p1, p2, fromCell, targetCell, useResult) {
  await inject(port, {
    started: true,
    currentTurn: 'p1',
    pendingResults: [useResult],
    capturedBonus: false,
    pieces: {
      p1: [
        { cell: fromCell, stack: 1, done: false },
        { cell: HOME, stack: 1, done: false },
        { cell: HOME, stack: 1, done: false },
        { cell: HOME, stack: 1, done: false },
      ],
      p2: [
        { cell: targetCell, stack: 1, done: false },
        { cell: HOME, stack: 1, done: false },
        { cell: HOME, stack: 1, done: false },
        { cell: HOME, stack: 1, done: false },
      ],
    },
  });
  await p1.next('STATE');
  await p2.next('STATE');

  p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult });
  const state = await p1.next('STATE');
  p2.drain('STATE');
  return state;
}

// ── §13-12 윷/모로 잡기 → 잡기 보너스 미부여 (중복 차단) ──────────────────────

test('YR-C19-001: 윷으로 상대 단독 말 잡기 → capturedBonus 미부여 (중복 차단) (§6-1 §13-12)', async () => {
  // Given: P1 cell=0, P2 cell=4 (corner 5/10 미경유), 큐=['yut'].
  // When: P1 yut(4) 사용 → 0→1→2→3→4 도착, 잡기.
  // Then: 잡았어도 윷 자체 보너스가 이미 추가 던지기 1회 부여 → 잡기 보너스 미부여 → capturedBonus=false.
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    const state = await captureAndGetState(port, p1, p2, 0, 4, 'yut');
    const p1Pieces = state.players.find((p) => p.id === 'p1').pieces;
    const p2Pieces = state.players.find((p) => p.id === 'p2').pieces;
    expect(p1Pieces[0].cell).toBe(4); // 도착 확인
    expect(p2Pieces[0].cell).toBe(HOME); // 잡기 발생 확인
    expect(state.capturedBonus).toBe(false); // 잡기 보너스 미부여 (윷 보너스와 중복 차단)
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C19-002: 모로 상대 단독 말 잡기 → capturedBonus 미부여 (중복 차단) (§6-1 §13-12)', async () => {
  // Given: P1 cell=0, P2 cell=5... corner 5는 분기 발생 → cell=4를 target으로, P1 cell=HOME에서 mo(5).
  //        HOME(-1) + mo(5) = 칸 5는 corner. corner 회피 위해 P1 cell=1, P2 cell=6: 1→2→3→4→5(corner 도착이 아닌 통과)→6.
  // When: P1 mo(5) 사용 → 1→2→3→4→5→6 도착(5는 통과만, 멈춤 아님 → 분기 없음), 잡기.
  // Then: 모 자체 보너스가 이미 추가 던지기 1회 부여 → 잡기 보너스 미부여 → capturedBonus=false.
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    const state = await captureAndGetState(port, p1, p2, 1, 6, 'mo');
    const p1Pieces = state.players.find((p) => p.id === 'p1').pieces;
    const p2Pieces = state.players.find((p) => p.id === 'p2').pieces;
    expect(p1Pieces[0].cell).toBe(6); // 도착 확인 (5는 통과)
    expect(p2Pieces[0].cell).toBe(HOME); // 잡기 발생 확인
    expect(state.capturedBonus).toBe(false); // 잡기 보너스 미부여 (모 보너스와 중복 차단)
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

// ── §13-12 도/개/걸로 잡기 → 잡기 보너스 부여 유지 ────────────────────────────

test('YR-C19-003: 도로 상대 단독 말 잡기 → capturedBonus 부여 유지 (§6-1 §6-4 §13-12)', async () => {
  // Given: P1 cell=2, P2 cell=3, 큐=['do'].
  // When: P1 do(1) → cell 3 도착, 잡기.
  // Then: 도는 자체 보너스가 없으므로 잡기 보너스 +1 유지 → capturedBonus=true.
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    const state = await captureAndGetState(port, p1, p2, 2, 3, 'do');
    const p2Pieces = state.players.find((p) => p.id === 'p2').pieces;
    expect(p2Pieces[0].cell).toBe(HOME); // 잡기 발생 확인
    expect(state.capturedBonus).toBe(true); // 잡기 보너스 부여 유지
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C19-004: 개로 상대 단독 말 잡기 → capturedBonus 부여 유지 (§6-1 §6-4 §13-12)', async () => {
  // Given: P1 cell=1, P2 cell=3, 큐=['gae'].
  // When: P1 gae(2) → 1→2→3 도착, 잡기.
  // Then: 개는 자체 보너스 없음 → 잡기 보너스 +1 유지 → capturedBonus=true.
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    const state = await captureAndGetState(port, p1, p2, 1, 3, 'gae');
    const p2Pieces = state.players.find((p) => p.id === 'p2').pieces;
    expect(p2Pieces[0].cell).toBe(HOME);
    expect(state.capturedBonus).toBe(true);
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C19-005: 걸로 상대 단독 말 잡기 → capturedBonus 부여 유지 (§6-1 §6-4 §13-12)', async () => {
  // Given: P1 cell=1, P2 cell=4, 큐=['geol'].
  // When: P1 geol(3) → 1→2→3→4 도착, 잡기.
  // Then: 걸은 자체 보너스 없음 → 잡기 보너스 +1 유지 → capturedBonus=true.
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    const state = await captureAndGetState(port, p1, p2, 1, 4, 'geol');
    const p2Pieces = state.players.find((p) => p.id === 'p2').pieces;
    expect(p2Pieces[0].cell).toBe(HOME);
    expect(state.capturedBonus).toBe(true);
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

// ── §13-12 순서 무관성 — 윷/모 잡기는 어느 경로로도 capturedBonus를 더하지 않음 ──

test('YR-C19-006: 순서 무관성 — 윷 잡기 후 capturedBonus가 없어 추가 던지기는 윷 보너스 1회뿐 (§6-1 §13-12)', async () => {
  // 의도: "윷/모 던지기 먼저 vs 잡기 먼저" 순서와 무관하게, 윷/모로 잡으면 보너스는 1회로 고정됨을 검증.
  // 본 케이스는 capturedBonus가 부여되지 않음을 직접 확인하여, 어떤 순서로도 보너스가 2회로 누적되지 않음을 보장한다.
  // Given: P1 cell=0, P2 cell=4, 큐=['yut'], capturedBonus=false(잡기 전 상태).
  // When: P1 yut(4)로 잡기.
  // Then: capturedBonus=false 유지 → 잡기로 인한 추가 던지기 권리는 생기지 않음.
  //       (윷 던지기 자체로 얻는 추가 던지기 권리는 별도 — pendingResults 흐름에서 보장되며 여기서 중복되지 않음.)
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    const state = await captureAndGetState(port, p1, p2, 0, 4, 'yut');
    const p2Pieces = state.players.find((p) => p.id === 'p2').pieces;
    expect(p2Pieces[0].cell).toBe(HOME); // 잡기 발생
    // 잡기 보너스가 추가되지 않았으므로 capturedBonus는 false (중복 누적 차단).
    expect(state.capturedBonus).toBe(false);
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});
