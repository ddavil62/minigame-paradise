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

test('QA-D2-001: capturedBonus=true + pendingResults=["do"] + MOVE → passTurn 호출 안 됨 (잔류 확인)', async () => {
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    // Given: 잡기 직후 상태 시뮬레이션 — capturedBonus=true, 큐에는 보너스 THROW로 얻은 'do', P1 말 1개 칸 5.
    // (보너스 THROW 결과 'do'를 직접 inject. 실제 코드 흐름과 동일한 진입점)
    await inject(port, {
      currentTurn: 'p1',
      pendingResults: ['do'],
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

    // When: P1이 'do' 사용하여 piece 0 이동 (5 → 지름길A 진입 후 shortcutA cell 21로 진행)
    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
    const stateAfter = await p1.next('STATE');
    p2.drain('STATE');

    // Then: 큐가 비고 결과는 yut/mo가 아니므로 정상이라면 passTurn 발생해야 함.
    // 잠재 결함: capturedBonus=true 잔류로 hasBonus=true → passTurn 안 됨 → currentTurn 여전히 p1.
    console.log(`[QA-D2-001] currentTurn after MOVE: ${stateAfter.currentTurn}, pendingResults: ${JSON.stringify(stateAfter.pendingResults)}`);
    // 기대: currentTurn === 'p2' (정상 패스턴).
    // 실측: 결함이 확정되면 currentTurn === 'p1' 잔류.
    expect(stateAfter.currentTurn).toBe('p2');
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('QA-D2-002: 잡기 시퀀스 전체 WS 사이클 — 잡기 → 보너스 THROW(do/gae/geol 강제) → MOVE 후 턴 전환 검증', async () => {
  // 실제 WS 사이클로 잡기 → 보너스 THROW → MOVE 흐름.
  // Math.random 제어는 어렵지만, inject로 직접 capturedBonus 세팅하고 추가 THROW를 통해 검증.
  const app = createApp({});
  const { server, port } = await startServer(app);
  const { p1, p2 } = await setupGame(port);
  try {
    // Given: P1이 잡기로 capturedBonus=true 획득한 직후 상태 (큐는 비어 있음).
    await inject(port, {
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

    // When: P1이 보너스 던지기 시도 (큐 비어있지만 capturedBonus=true이므로 허용됨)
    let bonusResult = null;
    let attempts = 0;
    // 보너스 결과가 yut/mo면 큐에 yut/mo가 쌓여 hasBonus=true (정상), 그래서 우리는 do/gae/geol/backdo를 원함.
    // 최대 30회 던지기로 non-bonus 결과 확보.
    while (attempts < 30) {
      p1.send({ type: 'THROW_YUT' });
      const yr = await p1.next('YUT_RESULT');
      await p1.next('STATE');
      p2.drain('YUT_RESULT'); p2.drain('STATE');
      if (yr.result === 'do' || yr.result === 'gae' || yr.result === 'geol') {
        bonusResult = yr.result;
        break;
      }
      // yut/mo가 나오면 큐에 쌓이고 추가 던지기 가능 → 계속 시도
      // backdo는 자동 폐기될 수 있어 큐 비어있을 수 있음 → 다음 던지기 가능
      attempts++;
      if (yr.result === 'backdo' && yr.discarded) {
        // 큐가 비고 capturedBonus가 살아있으면 계속 시도 가능
        // 그런데 inject로 다시 큐 비우는 게 더 명확
        await inject(port, { pendingResults: [], capturedBonus: true });
        await p1.next('STATE');
        await p2.next('STATE');
        continue;
      }
      if (yr.result === 'yut' || yr.result === 'mo') {
        // 큐에 yut/mo가 있으니 추가 던지기로 일반 결과 노림
        continue;
      }
      // 정상 결과 도달
      bonusResult = yr.result;
      break;
    }

    console.log(`[QA-D2-002] 보너스 결과 확보: ${bonusResult}, attempts=${attempts}`);
    if (!bonusResult) {
      // 시도 한도 초과 — 테스트 자체 한계
      console.log('[QA-D2-002] 30회 안에 do/gae/geol 확보 실패');
      return;
    }

    // 큐 정리: 잔여 yut/mo 결과는 제거하고 bonusResult만 남기기 위해 inject
    await inject(port, { pendingResults: [bonusResult], capturedBonus: true });
    await p1.next('STATE');
    await p2.next('STATE');

    // When: 보너스 결과로 MOVE
    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: bonusResult });
    const stateAfter = await p1.next('STATE');
    p2.drain('STATE');

    console.log(`[QA-D2-002] MOVE 후 currentTurn: ${stateAfter.currentTurn}, queue: ${JSON.stringify(stateAfter.pendingResults)}`);
    expect(stateAfter.currentTurn).toBe('p2');
  } finally {
    p1.close(); p2.close();
    await stopServer(server);
  }
});

test('QA-D2-003: THROW_YUT 핸들러가 capturedBonus를 리셋하는지 확인 (Defect #2 핵심 경로)', async () => {
  // inject로 직접 시뮬레이션:
  //   capturedBonus=true + 큐 빈 상태에서 THROW_YUT → 보너스 인정 (큐 비어도)
  //   THROW 후 capturedBonus가 false로 리셋되는가? (코드상 안 됨 — 결함 확정)
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
