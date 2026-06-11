/**
 * @fileoverview QA 검증: Coder 발견 Defect #2 (capturedBonus 잡기 후 잔류).
 *
 * 가설:
 *   잡기 발생 후 capturedBonus=true 상태에서 다음 THROW_YUT가 발생하고
 *   그 결과가 yut/mo가 아닌 경우 (예: do/gae/geol),
 *   MOVE_PIECE 후 hasBonus = capturedBonus(true) || lastResult(false) = true 가 되어
 *   passTurn이 호출되지 않고 턴이 잠긴다.
 *
 * 본 테스트는 inject로 잡기 직후 상태를 재현하지 않고,
 * 실제 WS 사이클로 잡기 → 보너스 THROW → MOVE를 진행하여 currentTurn 변화를 검증한다.
 *
 * 룰북 §13-11 [HIGH, 해소] 항목의 잔존 결함 후보.
 */

import { test, expect } from 'playwright/test';
import { createApp } from '../server.js';
import {
  startServer,
  stopServer,
  setupGame,
  inject,
  withRandom,
} from './rulebook-helpers.js';

const HOME = -1;

/**
 * 잡기 직후 capturedBonus=true 상태 + p1 턴 + 큐 [] + p1 말 1개 칸 5에 있음, p2 모두 HOME 으로 세팅.
 * 후속 THROW_YUT 시 결과를 강제하기 위해 Math.random 컨트롤이 필요하나,
 * 본 테스트는 서버 측에서 random이 동작하므로 직접 컨트롤 불가.
 * 대신 inject로 pendingResults에 'do' (yut/mo 아닌 결과)를 직접 주입한 뒤 MOVE_PIECE만으로도 동일 코드 경로를 타게 한다.
 */

test('QA-D2-001: capturedBonus=true(미소진) + pendingResults=["do"] + MOVE → 턴 보존(p1) + 데드락 없음', async () => {
  // ── 배치 이동 + 기댓값 갱신 사유 (FIX-2 §13-1, FIX-4 §6) ──────────────────────
  // (1) FIX-2(§13-1) 모서리 분기 도입으로 칸 5 출발 이동은 awaitingBranch(corner) 대기가 되어
  //     본 시나리오(capturedBonus 라이프사이클)와 무관한 분기 흐름으로 변질된다.
  //     → 검증 의도(capturedBonus 잔류/데드락)는 불변, piece를 모서리가 아닌 칸 1로 이동 배치.
  // (2) FIX-4(§6) + 메인 오케스트레이터 판정(쟁점 1): inject로 capturedBonus=true를 직접 주입하고
  //     THROW를 거치지 않은 채 MOVE하면, capturedBonus는 소진되지 않으므로 hasBonus=true →
  //     passTurn하지 않는 것이 정답이다(턴 보존 p1 + 추가 던지기 1회 권리 보유).
  //     이전 기댓값 p2는 "THROW로 진입하며 capturedBonus를 소진한 뒤"의 흐름(QA-D2-002)과 혼동한 것.
  //     본 케이스에서 "데드락 없음"은 보유한 추가 던지기 권리가 정상 행사 가능함으로 검증한다.
  // ──────────────────────────────────────────────────────────────────────────────
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    // Given: capturedBonus=true(미소진), 큐=['do'], P1 말 1개 칸 1(모서리 아님).
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

    // When: P1이 'do' 사용하여 piece 0 이동 (1 → 2, 분기 없음).
    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
    const stateAfter = await p1.next('STATE');
    p2.drain('STATE');

    // Then: 큐는 비지만 capturedBonus(미소진)로 hasBonus=true → 턴 보존(p1).
    console.log(`[QA-D2-001] currentTurn after MOVE: ${stateAfter.currentTurn}, pendingResults: ${JSON.stringify(stateAfter.pendingResults)}`);
    expect(stateAfter.pendingResults).toEqual([]);
    expect(stateAfter.currentTurn).toBe('p1');

    // 데드락 없음 검증: 보유한 추가 던지기 권리가 정상 행사 가능(THROW 수락 → 큐에 결과 누적).
    p1.send({ type: 'THROW_YUT' });
    await p1.next('YUT_RESULT');
    const stateThrow = await p1.next('STATE');
    p2.drain('YUT_RESULT'); p2.drain('STATE');
    expect(stateThrow.pendingResults.length).toBeGreaterThanOrEqual(1);
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('QA-D2-002: 잡기 후 보너스 THROW(큐 빈 진입 → 소진) → non-bonus MOVE 후 턴 전환(p2) — 데드락 가드', async () => {
  // ── 배치 이동 사유 (FIX-2 §13-1) + 핵심 데드락 흐름 (FIX-4 §6) ────────────────
  // FIX-2(§13-1): 칸 5 출발은 corner 분기가 되어 흐름이 변질되므로 piece를 칸 1로 이동 배치
  //   (검증 의도 = capturedBonus 데드락 가드, 불변).
  // 본 테스트가 검증하는 "진짜 데드락 흐름"(메인 오케스트레이터 판정 쟁점 2):
  //   잡기 → 큐 빈 상태 → THROW(큐 빈 진입이므로 FIX-4가 capturedBonus 소진) → non-bonus(do/gae/geol)
  //   → MOVE → 큐 빔 + capturedBonus=false → passTurn(p2).
  // 보강 전(§13-11 미해소) 코드는 이 지점에서 capturedBonus 잔류로 p1 잠금이 발생했다.
  // 주의: THROW가 capturedBonus를 소진하므로, 이후 큐 정리 inject에서 capturedBonus를 다시 true로
  //       강제하면 안 된다(데드락 흐름이 무효화됨).
  // ──────────────────────────────────────────────────────────────────────────────
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    let bonusResult = null;
    // 큐 빈 + capturedBonus=true에서 THROW → non-bonus 확보. 매 시도마다 상태를 재주입해
    // "큐 빈 진입" 조건을 보장한다(THROW가 capturedBonus를 소진하므로 매번 재무장).
    for (let attempt = 0; attempt < 40 && !bonusResult; attempt++) {
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

      // 큐 빈 + capturedBonus=true로 진입한 THROW → FIX-4가 capturedBonus를 소진한다.
      p1.send({ type: 'THROW_YUT' });
      const yr = await p1.next('YUT_RESULT');
      await p1.next('STATE');
      p2.drain('YUT_RESULT'); p2.drain('STATE');
      if (yr.result === 'do' || yr.result === 'gae' || yr.result === 'geol') {
        bonusResult = yr.result; // 큐=[bonusResult], capturedBonus는 소진된 상태
      }
    }
    expect(bonusResult).toBeTruthy();

    // When: non-bonus 결과로 MOVE (capturedBonus는 이미 소진됨 — 재무장 금지).
    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: bonusResult });
    const stateAfter = await p1.next('STATE');
    p2.drain('STATE');

    // Then: 큐 빔 + capturedBonus 소진 → hasBonus=false → passTurn(p2). 데드락 없음.
    console.log(`[QA-D2-002] MOVE 후 currentTurn: ${stateAfter.currentTurn}, queue: ${JSON.stringify(stateAfter.pendingResults)}`);
    expect(stateAfter.currentTurn).toBe('p2');
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('QA-D2-003: THROW_YUT 핸들러가 capturedBonus를 리셋하는지 확인 (Defect #2 핵심 경로)', async () => {
  // ── 배치 이동 사유 (FIX-2 §13-1) ────────────────────────────────────────────
  // FIX-2(§13-1) 모서리 분기 도입으로 칸 5 출발 MOVE는 corner 분기가 되므로 piece를 칸 1로 이동 배치.
  //   검증 의도(THROW 후 capturedBonus 소진 → non-bonus MOVE 시 passTurn) 불변.
  //   본 흐름은 "큐 빈 진입 THROW → FIX-4 소진"이므로 MOVE 후 정상 passTurn(p2).
  // ──────────────────────────────────────────────────────────────────────────────
  // inject로 직접 시뮬레이션:
  //   capturedBonus=true + 큐 빈 상태에서 THROW_YUT → 보너스 인정 (큐 비어도)
  //   THROW 후 capturedBonus가 false로 소진되는가? (FIX-4: 큐 빈 진입 THROW에서 1회 소진)
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
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

    // THROW_YUT 시도 (큐 빈 상태 + capturedBonus 보유 → 허용됨)
    p1.send({ type: 'THROW_YUT' });
    const yr = await p1.next('YUT_RESULT');
    await p1.next('STATE');
    p2.drain('YUT_RESULT'); p2.drain('STATE');

    console.log(`[QA-D2-003] THROW 결과: ${yr.result}`);
    // 본 테스트의 핵심: THROW_YUT 핸들러가 capturedBonus를 false로 리셋해야 정상.
    // 현 코드는 리셋 안 함 → server.js MOVE_PIECE 경로에서 검증되어야.
    //
    // 검증 방법: 결과가 non-bonus(do/gae/geol)인 경우 inject로 큐 비우고 다시 MOVE 한 직후 turn 전환 보는 것은 D2-001.
    // 본 테스트는 단순 "THROW만으로 capturedBonus 리셋되는가" 관측.
    //
    // 직접 game.capturedBonus를 읽을 수 없으므로 간접 측정:
    //   결과가 'do'이면 큐에 'do' 1개. MOVE 직후 currentTurn 변화 확인.
    if (yr.result === 'do' || yr.result === 'gae' || yr.result === 'geol') {
      p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: yr.result });
      const stateAfter = await p1.next('STATE');
      p2.drain('STATE');
      console.log(`[QA-D2-003] MOVE 후 currentTurn: ${stateAfter.currentTurn}, queue=${JSON.stringify(stateAfter.pendingResults)}`);
      expect(stateAfter.currentTurn).toBe('p2');
    } else {
      console.log(`[QA-D2-003] 보너스 결과(${yr.result})로 인해 본 회 시도 미관측 — 재실행 시 검증 가능`);
    }
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});
