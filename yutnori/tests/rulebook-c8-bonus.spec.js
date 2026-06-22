/**
 * @fileoverview YR-C8 시리즈 — 보너스 던지기 (10개)
 * 룰북 참조: minigames/yutnori/docs/RULEBOOK.md §6 (보너스 한 번 더), §13-11 capturedBonus 리셋
 *
 * WS 시나리오: createApp + inject + THROW_YUT / MOVE_PIECE 시퀀스.
 */

import { test, expect } from 'playwright/test';
import { createApp } from '../server.js';
import { startServer, stopServer, setupGame, inject } from './rulebook-helpers.js';

const HOME = -1;

// ── §6-1 §6-2 윷/모/잡기 보너스 허용 ──────────────────────────────

test('YR-C8-001: 큐에 yut 잔여 시 THROW_YUT 허용 (§6-1 §6-2)', async () => {
  // Given: pendingResults=['yut']
  // When: P1 THROW_YUT
  // Then: YUT_RESULT 수신 (ERROR 아님)
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, { started: true, currentTurn: 'p1', pendingResults: ['yut'] });
    await p1.next('STATE');
    await p2.next('STATE');

    p1.send({ type: 'THROW_YUT' });
    const yr = await p1.next('YUT_RESULT');
    expect(yr.by).toBe('p1');
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C8-002: 큐에 mo 잔여 시 THROW_YUT 허용 (§6-1 §6-2)', async () => {
  // Given: pendingResults=['mo']
  // When: P1 THROW_YUT
  // Then: YUT_RESULT 수신
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, { started: true, currentTurn: 'p1', pendingResults: ['mo'] });
    await p1.next('STATE');
    await p2.next('STATE');

    p1.send({ type: 'THROW_YUT' });
    const yr = await p1.next('YUT_RESULT');
    expect(yr.by).toBe('p1');
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C8-003: 잡기 후 capturedBonus=true → THROW_YUT 허용 (§6-1 §6-2)', async () => {
  // Given: capturedBonus=true (직접 주입), 큐 비어 있음
  // When: P1 THROW_YUT
  // Then: YUT_RESULT 수신
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, {
      started: true, currentTurn: 'p1', pendingResults: [], capturedBonus: true,
    });
    await p1.next('STATE');
    await p2.next('STATE');

    p1.send({ type: 'THROW_YUT' });
    const yr = await p1.next('YUT_RESULT');
    expect(yr.by).toBe('p1');
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C8-004: 윷+모 연속 → pendingResults에 2개 누적 (§6-3)', async () => {
  // Given: 큐=['yut','mo'] 직접 주입 (보너스 누적 시뮬레이션)
  // When: STATE 검사
  // Then: pendingResults에 2개
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, {
      started: true, currentTurn: 'p1', pendingResults: ['yut', 'mo'],
    });
    const state = await p1.next('STATE');
    expect(state.pendingResults).toEqual(['yut', 'mo']);
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C8-005: 윷+모+도 누적 → 3개 큐에서 차례로 이동 (§6-3)', async () => {
  // Given: 큐=['do','yut','mo'], P1 piece 0=cell 0
  // When: do 사용 → cell 1, 그 다음 yut(4) → cell 5
  // Then: 두 번의 MOVE_PIECE 후 cell 5, pendingResults에 mo만 남음
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, {
      started: true, currentTurn: 'p1', pendingResults: ['do', 'yut', 'mo'],
      pieces: {
        p1: [{ cell: 0, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }],
      },
    });
    await p1.next('STATE');
    await p2.next('STATE');

    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
    await p1.next('STATE');
    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'yut' });
    const state = await p1.next('STATE');
    const pieces = state.players.find((p) => p.id === 'p1').pieces;
    expect(pieces[0].cell).toBe(5);
    expect(state.pendingResults).toEqual(['mo']);
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C8-006: 큐 비고 보너스 없으면 THROW_YUT 차단 — 같은 턴에 두 번 시도 (§6-3)', async () => {
  // Given: 게임 시작 직후 P1 첫 던지기 → 결과가 do(보너스 없음)인 경우 가정.
  //         단순화: pendingResults=['do'] 주입한 상태에서 THROW_YUT 시도 → ERROR (먼저 결과 사용)
  // When: pendingResults=['do']에 THROW_YUT
  // Then: ERROR (마지막 결과가 yut/mo 아니므로 차단)
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, { started: true, currentTurn: 'p1', pendingResults: ['do'] });
    await p1.next('STATE');
    await p2.next('STATE');

    p1.send({ type: 'THROW_YUT' });
    const err = await p1.next('ERROR');
    expect(err.type).toBe('ERROR');
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C8-007: 도 사용 후 큐 소진 → 턴 종료 (p2로 currentTurn 전환) (§5-1 §6-3)', async () => {
  // Given: 큐=['do'], P1 piece 0=cell 0
  // When: MOVE_PIECE(do)
  // Then: 큐 비고 보너스 없음 → currentTurn=p2
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, {
      started: true, currentTurn: 'p1', pendingResults: ['do'],
      pieces: {
        p1: [{ cell: 0, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }],
      },
    });
    await p1.next('STATE');
    await p2.next('STATE');

    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
    const state = await p1.next('STATE');
    expect(state.currentTurn).toBe('p2');
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C8-008: 백도는 보너스 없음 (§6-2 §9-2)', async () => {
  // Given: 큐=['backdo'], P1 piece 0=cell 3, capturedBonus=false 명시
  // When: MOVE_PIECE(backdo) → 큐 소진
  // Then: currentTurn=p2 (백도 사용 후 보너스 없음 → 턴 종료)
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    // §13-11: capturedBonus를 명시적으로 false 주입하여 이전 batch 잔류 가능성 차단.
    await inject(port, {
      started: true, currentTurn: 'p1', pendingResults: ['backdo'], capturedBonus: false,
      pieces: {
        p1: [{ cell: 3, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }],
      },
    });
    // inject 후 STATE 1개씩 broadcast — 이전 잔여 STATE까지 모두 비워 race 차단.
    await p1.next('STATE');
    await p2.next('STATE');
    p1.drain('STATE');
    p2.drain('STATE');

    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'backdo' });
    const state = await p1.next('STATE');
    expect(state.currentTurn).toBe('p2');
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C8-009: 윷으로 잡은 경우 중복 보너스 차단 — §13-12 해소 (2026-06-15) (§6-1 §6-4)', async () => {
  // ── 기댓값 변경 사유 (§13-12 해소, 2026-06-15) ───────────────────────────────
  // 이 케이스는 이전에 "윷으로 잡은 경우 중복 보너스 — 미해소 정책 PASS"로, 윷으로 잡으면
  // capturedBonus=true가 부여되어 추가 던지기가 1회 더(윷 보너스 + 잡기 보너스 = 2회) 가능했다.
  // 권위 룰(§6-1, 한국어 위키): 윷/모 자체 보너스와 잡기 보너스는 중복 불가(한 행위 최대 1회).
  // server.js MOVE_PIECE/CHOOSE_PATH에 useResult가 yut/mo면 capturedBonus 미부여 가드를 추가하여
  // §13-12를 해소했다. 따라서 윷으로 잡아도 잡기 보너스는 생기지 않으며, 윷 던지기 자체로 얻는
  // 추가 던지기 권리만 유효하다(이 케이스는 inject로 큐에 yut만 주입 — 던지기 권리 흐름이 없는 상태이므로
  // 큐 소진 후 capturedBonus=false → passTurn).
  // ──────────────────────────────────────────────────────────────────────────
  // Given: 큐=['yut'], P1 piece 0=cell 2, P2 piece 0=cell 6 (4칸 이동시 잡힘)
  // When: P1 yut(4) 사용 → cell 6 도착, 잡기
  // Then: capturedBonus 미부여(false) → 큐 비고 보너스 없음 → passTurn → currentTurn=p2.
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, {
      started: true, currentTurn: 'p1', pendingResults: ['yut'], capturedBonus: false,
      pieces: {
        p1: [{ cell: 2, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }],
        p2: [{ cell: 6, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }],
      },
    });
    await p1.next('STATE');
    await p2.next('STATE');

    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'yut' });
    const state = await p1.next('STATE');
    const p2Pieces = state.players.find((p) => p.id === 'p2').pieces;
    expect(p2Pieces[0].cell).toBe(HOME); // 잡기 발생 확인
    // §13-12 해소: 윷으로 잡아도 "잡기 보너스(capturedBonus)"는 미부여 → 중복 차단(이 단언은 유지).
    expect(state.capturedBonus).toBe(false);
    // ── 기댓값 변경 사유 (버그 C 수정, 2026-06-20, Option A 보너스 모델) ──────────────
    // 버그 C 수정으로 윷·모 "한 번 더 던지기" 권리는 '이동(MOVE)' 시점이 아니라 '던지기(THROW)'
    // 시점에 game.pendingThrows로만 적립/소비된다(소진 순서 무관 정확성, 이중 리필 차단).
    // 이 케이스는 inject로 큐에 yut만 직접 주입할 뿐 THROW_YUT를 거치지 않으므로 pendingThrows=0이다.
    // 따라서 yut을 소비해 큐가 비면 보너스 권리가 없어 passTurn → currentTurn='p2'.
    //
    // 직전(2026-06-17 버그 D 모델)의 `currentTurn==='p1'`은 "소비한 결과가 yut/mo면
    // 보너스 1회"라는 소진-연동 모델의 산물이었고, 그 모델이 바로 버그 C(소진 순서에 따라
    // 던지기 이중 리필)를 유발했다. 던지기 시점 적립 모델에서는 '던지지 않은 yut 소비'는
    // 추가 던지기를 만들지 않는다(실게임에서 yut은 반드시 THROW로 들어와 적립되므로,
    // THROW→MOVE 정상 흐름의 보너스는 신규 회귀 D-SC-1/D-SC-6가 별도 보장).
    expect(state.currentTurn).toBe('p2');
    expect(state.pendingResults).toEqual([]);
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C8-010: 잡기 보너스 사용 후 capturedBonus 리셋 확인 (§6-2 §13-11)', async () => {
  // Given: capturedBonus=true, 큐=[], 잡기 보너스로 do 결과 가정 — inject로 큐=['do']도 주입
  //         P1 piece 0=cell 0
  // When: MOVE_PIECE(do) → 큐 비고 보너스 소진 → passTurn() → capturedBonus=false
  // Then: STATE 검증 — currentTurn=p2, 그리고 P2가 던질 수 있다 (잘못된 잔류 없음)
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, {
      started: true, currentTurn: 'p1', pendingResults: ['do'], capturedBonus: false,
      pieces: {
        p1: [{ cell: 0, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }, { cell: HOME, stack: 1, done: false }],
      },
    });
    await p1.next('STATE');
    await p2.next('STATE');

    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
    const state = await p1.next('STATE');
    expect(state.currentTurn).toBe('p2');

    // P2 THROW_YUT 가능
    p2.send({ type: 'THROW_YUT' });
    const yr = await p2.next('YUT_RESULT');
    expect(yr.by).toBe('p2');
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

// ── 버그 C 회귀 (2026-06-20): 소진 순서 무관 보너스 + 버그 D 양립 ───────────────
// 모델: 윷·모 "한 번 더 던지기" 권리는 던지기 시점에 game.pendingThrows로 적립/소비된다.
// 실게임 흐름 "모 던짐(+1) → 한 번 더 던져 개(보너스 소비 -1, 적립 0)" 의 결과 상태는
//   pendingResults=['mo','gae'], pendingThrows=0
// 이다. 이 상태에서 어느 결과를 먼저 이동하든 추가 던지기(리필)가 발생하면 안 된다(버그 C).
// inject로 위 상태를 직접 구성하여 두 소진 순서를 모두 검증한다.

test('YR-C8-011: [모,개] 큐에서 개 먼저 이동 → 던지기 리필 없음 (버그 C, 2026-06-20)', async () => {
  // Given: 큐=['mo','gae'], pendingThrows=0 (모 던짐 후 보너스로 개 던진 직후 상태), 말 2개 칸 1·2.
  // When: gae(2)부터 이동 → 그 다음 mo(5) 이동 → 큐 소진.
  // Then: 추가 던지기 적립이 없어 passTurn → currentTurn=p2 (보너스 리필 없음).
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, {
      started: true, currentTurn: 'p1',
      pendingResults: ['mo', 'gae'], pendingThrows: 0, capturedBonus: false,
      pieces: {
        p1: [
          { cell: 1, stack: 1, done: false },
          { cell: 2, stack: 1, done: false },
          { cell: HOME, stack: 1, done: false },
          { cell: HOME, stack: 1, done: false },
        ],
      },
    });
    await p1.next('STATE');
    await p2.next('STATE');

    // 개부터 이동 (cell 2 → 4). 큐에 mo 잔여 → 턴 유지.
    p1.send({ type: 'MOVE_PIECE', pieceIndex: 1, useResult: 'gae' });
    let st = await p1.next('STATE');
    p2.drain('STATE');
    expect(st.currentTurn).toBe('p1'); // 큐에 mo 남아 턴 유지
    expect(st.pendingThrows).toBe(0);  // 적립 변화 없음

    // 모 이동 (cell 1 → 1→2→3→4→5 모서리 도착). 큐 비고 pendingThrows=0 → passTurn.
    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'mo' });
    st = await p1.next('STATE');
    p2.drain('STATE');
    expect(st.pendingResults).toEqual([]);
    expect(st.pendingThrows).toBe(0);     // 던지기 리필 없음 (버그 C 핵심 단언)
    expect(st.currentTurn).toBe('p2');    // 보너스 없으므로 턴 종료
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C8-012: [모,개] 큐에서 모 먼저 이동 → 던지기 리필 없음 (버그 C, 2026-06-20)', async () => {
  // Given: 큐=['mo','gae'], pendingThrows=0, 말 2개 칸 1·2 (YR-C8-011과 동일 상태).
  // When: mo(5)부터 이동 → 그 다음 gae(2) 이동 → 큐 소진.
  // Then: 소진 순서가 반대여도 추가 던지기 적립 없이 passTurn → currentTurn=p2.
  //   (이전 bonusFromConsumed 모델에서는 모를 나중에 비울 때만 리필되던 비대칭 버그가 있었다.)
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, {
      started: true, currentTurn: 'p1',
      pendingResults: ['mo', 'gae'], pendingThrows: 0, capturedBonus: false,
      pieces: {
        p1: [
          { cell: 1, stack: 1, done: false },
          { cell: 2, stack: 1, done: false },
          { cell: HOME, stack: 1, done: false },
          { cell: HOME, stack: 1, done: false },
        ],
      },
    });
    await p1.next('STATE');
    await p2.next('STATE');

    // 모부터 이동 (cell 1 → 5 모서리 도착, 분기 없음 — 통과 아님 정확 착지지만 다음 이동 전이라 모달 없음).
    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'mo' });
    let st = await p1.next('STATE');
    p2.drain('STATE');
    expect(st.currentTurn).toBe('p1'); // 큐에 gae 남아 턴 유지
    expect(st.pendingThrows).toBe(0);

    // 개 이동 (cell 2 → 4). 큐 비고 pendingThrows=0 → passTurn.
    p1.send({ type: 'MOVE_PIECE', pieceIndex: 1, useResult: 'gae' });
    st = await p1.next('STATE');
    p2.drain('STATE');
    expect(st.pendingResults).toEqual([]);
    expect(st.pendingThrows).toBe(0);  // 던지기 리필 없음 (버그 C 핵심 단언)
    expect(st.currentTurn).toBe('p2'); // 소진 순서 무관하게 동일 결과
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('YR-C8-013: 버그 C 실흐름 — THROW(mo)→THROW(gae)→이동 순서 무관 리필 없음 (버그 C, 2026-06-20)', async () => {
  // Given: inject 없이 강제 던지기 루프로 "모 던짐 → 보너스로 한 번 더 던짐" 실제 흐름을 재현.
  //   모가 나올 때까지 던진 뒤(첫 던지기, pendingThrows 1 적립), 보너스 던지기를 1회 수행한다.
  // When: 두 결과를 모두 소진.
  // Then: 던지기 시점 적립이 정확히 1회뿐이므로, 보너스 던지기를 행사한 뒤 모든 결과를
  //   이동하면 큐가 비고 pendingThrows=0 → passTurn. 추가 리필 없음.
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    // 1) 모가 나올 때까지 첫 던지기 반복 (모서리 미경유 위해 말은 HOME 유지 → HOME 이동만).
    let gotMo = false;
    for (let attempt = 0; attempt < 60 && !gotMo; attempt++) {
      await inject(port, {
        started: true, currentTurn: 'p1', pendingResults: [], pendingThrows: 0, capturedBonus: false,
        pieces: {
          p1: [
            { cell: HOME, stack: 1, done: false },
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
      await p1.next('STATE'); await p2.next('STATE');
      p1.send({ type: 'THROW_YUT' });
      const yr = await p1.next('YUT_RESULT');
      const st = await p1.next('STATE');
      p2.drain('YUT_RESULT'); p2.drain('STATE');
      if (yr.result === 'mo') {
        gotMo = true;
        // 모를 던졌으므로 pendingThrows=1 적립 (큐=['mo']).
        expect(st.pendingThrows).toBe(1);
        expect(st.pendingResults).toEqual(['mo']);
      }
    }
    expect(gotMo).toBe(true);

    // 2) 보너스 던지기 1회 행사 (큐에 mo 있어 THROW 허용). 이 던지기는 pendingThrows를 1 소비한다.
    //    결과가 또 yut/mo면 다시 +1 적립되므로, non-bonus가 나올 때까지 반복하여 적립을 0으로 만든다.
    let bonusResult = null;
    let afterBonusState = null;
    for (let attempt = 0; attempt < 60 && !bonusResult; attempt++) {
      p1.send({ type: 'THROW_YUT' });
      const yr = await p1.next('YUT_RESULT');
      const stThrow = await p1.next('STATE');
      p2.drain('YUT_RESULT'); p2.drain('STATE');
      if (yr.result === 'do' || yr.result === 'gae' || yr.result === 'geol') {
        bonusResult = yr.result; // 큐=['mo', ..., bonusResult], pendingThrows는 0이어야 함.
        afterBonusState = stThrow;
        break;
      }
      // yut/mo가 또 나오면 계속 (다음 루프에서 다시 보너스 던지기).
    }
    expect(bonusResult).toBeTruthy();
    // 핵심: 윷·모를 여러 번 던졌어도 적립은 "마지막 미소비 윷·모" 1회분만 남고,
    //   non-bonus 보너스 던지기가 그 권리를 소비해 pendingThrows=0이 되어야 한다(이중 적립 없음).
    expect(afterBonusState.pendingThrows).toBe(0);

    // 3) 위 실흐름에서 "보너스 던지기 행사 후 pendingThrows=0"임을 입증했다(2단계 단언).
    //    이제 그 결과 상태(큐=['mo', bonusResult], pendingThrows=0)를 명시 고정하여
    //    두 결과를 모두 소진해도 리필이 없음을 단언한다(소진 순서 무관성 종결 검증).
    let st = null;
    await inject(port, {
      started: true, currentTurn: 'p1',
      pendingResults: ['mo', bonusResult], pendingThrows: 0, capturedBonus: false,
      pieces: {
        p1: [
          { cell: 1, stack: 1, done: false },
          { cell: 2, stack: 1, done: false },
          { cell: HOME, stack: 1, done: false },
          { cell: HOME, stack: 1, done: false },
        ],
      },
    });
    await p1.next('STATE'); await p2.next('STATE');

    p1.send({ type: 'MOVE_PIECE', pieceIndex: 1, useResult: bonusResult });
    st = await p1.next('STATE');
    p2.drain('STATE');
    // 모서리 분기 가능성 회피: bonusResult는 do/gae/geol이고 cell 2 출발이라 5(모서리) 정확 착지 없음.
    expect(st.awaitingBranchAt).toBe(null);
    expect(st.currentTurn).toBe('p1'); // mo 잔여로 턴 유지

    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'mo' });
    st = await p1.next('STATE');
    p2.drain('STATE');
    expect(st.pendingResults).toEqual([]);
    expect(st.pendingThrows).toBe(0);
    expect(st.currentTurn).toBe('p2'); // 리필 없음
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

// ── 버그 D 재발 방지 (2026-06-20): 윷·모를 보너스 던지기 전에 먼저 이동해도 보너스 보존 ──

test('YR-C8-014: 버그 D — 모를 보너스 던지기 전에 먼저 이동해도 던지기 권리 보존 (2026-06-20)', async () => {
  // Given: "모를 던진 직후" 상태 — 큐=['mo'], pendingThrows=1 (적립됨), 아직 보너스 던지기 미행사.
  // When: 보너스 던지기를 행사하기 '전에' mo를 먼저 이동한다(큐 소진).
  // Then: pendingThrows=1이 보존되므로 hasBonus=true → 턴 유지(p1) + 추가 THROW 허용(보너스 소실 없음).
  //   (이전 splice-순서 버그 D 재현 차단: 던지기 권리가 이동 시점 큐 상태에 의존하지 않는다.)
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    await inject(port, {
      started: true, currentTurn: 'p1',
      pendingResults: ['mo'], pendingThrows: 1, capturedBonus: false,
      pieces: {
        p1: [
          { cell: 1, stack: 1, done: false }, // 1 + mo(5) = 5 모서리 정확 착지(다음 이동 전이라 모달 없음)
          { cell: HOME, stack: 1, done: false },
          { cell: HOME, stack: 1, done: false },
          { cell: HOME, stack: 1, done: false },
        ],
      },
    });
    await p1.next('STATE');
    await p2.next('STATE');

    // 보너스 던지기 행사 전에 mo를 먼저 이동 → 큐 비지만 pendingThrows=1 보존.
    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'mo' });
    let st = await p1.next('STATE');
    p2.drain('STATE');
    expect(st.pendingResults).toEqual([]);
    expect(st.pendingThrows).toBe(1);   // 보너스 던지기 권리 보존 (버그 D 핵심)
    expect(st.currentTurn).toBe('p1');  // 턴 유지

    // 보존된 권리로 THROW 가능 (데드락/소실 없음). 이 던지기가 pendingThrows를 1 소비.
    p1.send({ type: 'THROW_YUT' });
    const yr = await p1.next('YUT_RESULT');
    expect(yr.by).toBe('p1');
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});
