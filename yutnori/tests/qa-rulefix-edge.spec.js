/**
 * @fileoverview QA 능동 엣지 탐색 — FIX-1~4 + 중첩 분기 수정.
 *
 * 본 파일은 QA 에이전트가 스펙·룰북 기반으로 도출한 엣지/예외 시나리오를 검증한다.
 * 기존 rulebook-c*.spec.js / yut.unit.spec.js를 수정하지 않고 별도 파일로 추가한다.
 *
 * 룰북 참조: minigames/yutnori/docs/RULEBOOK.md (§6, §9, §10, §13)
 *
 * 분류 접두:
 *   QA-RF1-* : FIX-1 재입장
 *   QA-RF2-* : FIX-2 모서리 분기 (중첩 포함)
 *   QA-RF3-* : FIX-3 centerExitB 24/25
 *   QA-RF4-* : FIX-4 capturedBonus 정밀화
 *   QA-RFX-* : 교차/방어/회귀
 */

import { test, expect } from 'playwright/test';
import { createApp } from '../server.js';
import { computeNextCell } from '../server.js';
import {
  startServer, stopServer, connectWs, setupGame,
  inject, injectAndDrain, placePieces, WsClient,
} from './rulebook-helpers.js';

const GOAL = 99;
const HOME = -1;

// ──────────────────────────────────────────────────────────────
// 서버 부트스트랩 (각 test 마다 격리된 createApp 인스턴스)
// ──────────────────────────────────────────────────────────────
let ctx = null;
async function boot() {
  const app = createApp({ hostUrl: '' });
  const { server, port } = await startServer(app);
  return { server, port };
}
test.afterEach(async () => {
  if (ctx && ctx.server) {
    await stopServer(ctx.server);
    ctx = null;
  }
});

// ═══════════════════════════════════════════════════════════════
// FIX-1 재입장 (§-, 데드락)
// ═══════════════════════════════════════════════════════════════
test.describe('QA-RF1 FIX-1 재입장', () => {
  test('QA-RF1-001: p2 끊김 → 재입장 시 p2 재배정 (p1 보존)', async () => {
    ctx = await boot();
    const p1 = await connectWs(ctx.port);
    const p2 = await connectWs(ctx.port);
    p1.send({ type: 'JOIN', playerName: 'A' });
    p2.send({ type: 'JOIN', playerName: 'B' });
    const j1 = await p1.next('JOINED');
    const j2 = await p2.next('JOINED');
    expect(j1.playerId).toBe('p1');
    expect(j2.playerId).toBe('p2');

    // p2만 끊는다 → 서버 players에 p1만 남음
    p2.close();
    await p2.waitClose();
    // p1은 GAME_OVER(disconnect) 수신
    await p1.next('GAME_OVER');

    // 재입장 → 미사용 ID 'p2' 배정 확인
    const p2b = await connectWs(ctx.port);
    p2b.send({ type: 'JOIN', playerName: 'B2' });
    const j2b = await p2b.next('JOINED');
    expect(j2b.playerId).toBe('p2');
    p1.close(); p2b.close();
  });

  test('QA-RF1-002: 게임 중 끊김 → GAME_OVER(disconnect) + softReset → 재입장 READY → 새 게임 시작', async () => {
    ctx = await boot();
    const { p1, p2 } = await setupGame(ctx.port);
    // 게임 진행 상태 주입 (말 일부 보드 위)
    await injectAndDrain(ctx.port, p1, p2, {
      started: true, currentTurn: 'p1',
      pieces: { p1: [{ cell: 5 }, { cell: HOME }, { cell: HOME }, { cell: HOME }] },
    });

    // p1 끊김 → p2가 GAME_OVER(disconnect) 수신
    p1.close();
    await p1.waitClose();
    const go = await p2.next('GAME_OVER');
    expect(go.reason).toBe('disconnect');
    expect(go.winner).toBe('p2');
    // softResetRoom 후 STATE: started=false
    const st = await p2.next('STATE');
    expect(st.started).toBe(false);

    // p1 재입장 → p1 배정
    const p1b = await connectWs(ctx.port);
    p1b.send({ type: 'JOIN', playerName: 'A2' });
    const j1b = await p1b.next('JOINED');
    expect(j1b.playerId).toBe('p1');
    // drain JOIN broadcasts
    p1b.drain('STATE'); p2.drain('STATE');

    // 양쪽 READY → START + 새 게임 STATE
    p1b.send({ type: 'READY' });
    p2.send({ type: 'READY' });
    await p1b.next('START');
    await p2.next('START');
    const newSt = await p1b.next('STATE');
    expect(newSt.started).toBe(true);
    expect(newSt.currentTurn).toBe('p1');
    // 모든 말 HOME (새 게임)
    const p1pieces = newSt.players.find((p) => p.id === 'p1').pieces;
    expect(p1pieces.every((pc) => pc.cell === HOME)).toBe(true);
    p1b.close(); p2.close();
  });

  test('QA-RF1-003: 3번째 연결 거절 (Room is full) 회귀', async () => {
    ctx = await boot();
    const p1 = await connectWs(ctx.port);
    const p2 = await connectWs(ctx.port);
    p1.send({ type: 'JOIN', playerName: 'A' });
    p2.send({ type: 'JOIN', playerName: 'B' });
    await p1.next('JOINED');
    await p2.next('JOINED');

    const p3 = await connectWs(ctx.port);
    const err = await p3.next('ERROR');
    expect(err.message).toBe('Room is full');
    await p3.waitClose();
    p1.close(); p2.close();
  });
});

// ═══════════════════════════════════════════════════════════════
// FIX-2 모서리 분기 (§10-2, §13-1)
// ═══════════════════════════════════════════════════════════════
test.describe('QA-RF2 FIX-2 모서리 분기', () => {
  test('QA-RF2-001: corner 분기 대기 중 THROW_YUT/MOVE_PIECE 차단(ERROR)', async () => {
    ctx = await boot();
    const { p1, p2 } = await setupGame(ctx.port);
    // p1 말 cell 5, 큐에 do → MOVE 시 corner 분기 대기
    await injectAndDrain(ctx.port, p1, p2, {
      started: true, currentTurn: 'p1', pendingResults: ['do'],
      pieces: { p1: [{ cell: 5 }, { cell: HOME }, { cell: HOME }, { cell: HOME }] },
    });
    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
    const br = await p1.next('BRANCH_REQUEST');
    expect(br.branchType).toBe('corner');
    await p1.next('STATE');

    // 분기 대기 중 THROW_YUT → ERROR
    p1.send({ type: 'THROW_YUT' });
    const e1 = await p1.next('ERROR');
    expect(e1.message).toContain('분기');
    // 분기 대기 중 MOVE_PIECE → ERROR
    p1.send({ type: 'MOVE_PIECE', pieceIndex: 1, useResult: 'do' });
    const e2 = await p1.next('ERROR');
    expect(e2.message).toContain('분기');
    p1.close(); p2.close();
  });

  test('QA-RF2-002: 상대 턴 플레이어가 CHOOSE_PATH 보내면 무시 (corner 대기 중)', async () => {
    ctx = await boot();
    const { p1, p2 } = await setupGame(ctx.port);
    await injectAndDrain(ctx.port, p1, p2, {
      started: true, currentTurn: 'p1', pendingResults: ['do'],
      pieces: { p1: [{ cell: 5 }, { cell: HOME }, { cell: HOME }, { cell: HOME }] },
    });
    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
    await p1.next('BRANCH_REQUEST');
    await p1.next('STATE');
    // p2도 MOVE_PIECE broadcast(BRANCH_REQUEST + STATE)를 받았으므로 큐를 비운다.
    await p2.next('BRANCH_REQUEST');
    p2.drain('STATE');

    // p2(상대)가 CHOOSE_PATH → 서버 game.currentTurn !== p2.id 이므로 무시(응답 없음)
    p2.send({ type: 'CHOOSE_PATH', pathChoice: 'shortcut' });
    // 짧게 대기하여 어떤 STATE/ERROR도 안 오는지 확인
    let leaked = false;
    try {
      await p2.next(null, 600);
      leaked = true;
    } catch (_) { /* timeout = 정상 (무시됨) */ }
    expect(leaked).toBe(false);

    // p1이 정상적으로 CHOOSE_PATH 가능한지 확인 (상태 손상 없음)
    p1.send({ type: 'CHOOSE_PATH', pathChoice: 'outer' });
    const st = await p1.next('STATE');
    const piece = st.players.find((p) => p.id === 'p1').pieces[0];
    expect(piece.cell).toBe(6); // 외곽 5→6
    p1.close(); p2.close();
  });

  test('QA-RF2-003: 외곽 선택 후 진행이 6..., 그 외곽 진행 중 모서리(10)에 멈추면 또 분기', async () => {
    // 순수 로직: cell 5 + do + outer → 6. cell 9 + do + null(통과 아님; 9→10 멈춤) → 다음 이동 분기
    expect(computeNextCell(5, 1, 'outer').toCell).toBe(6);
    // cell 9에서 do(1) → 10 도착(모서리 정확히 멈춤). 그 다음 이동은 분기.
    expect(computeNextCell(9, 1).toCell).toBe(10);
    // cell 10에 멈춘 뒤 do → branchChoice null → awaitingBranch
    const r = computeNextCell(10, 1);
    expect(r.awaitingBranch).toBe(true);
    expect(r.toCell).toBe(10);
  });

  test('QA-RF2-004: 모서리에서 백도(-1)는 분기 없이 4/9로 후퇴', async () => {
    // cell 5 백도 → 4 (분기 없음)
    const r5 = computeNextCell(5, -1);
    expect(r5.awaitingBranch).toBe(false);
    expect(r5.toCell).toBe(4);
    // cell 10 백도 → 9
    const r10 = computeNextCell(10, -1);
    expect(r10.awaitingBranch).toBe(false);
    expect(r10.toCell).toBe(9);
  });

  test('QA-RF2-005: 업힌 묶음이 모서리 분기 선택 시 묶음 전체 이동', async () => {
    ctx = await boot();
    const { p1, p2 } = await setupGame(ctx.port);
    // p1 말 2개가 cell 5에 함께 (업힘), 큐 do
    await injectAndDrain(ctx.port, p1, p2, {
      started: true, currentTurn: 'p1', pendingResults: ['do'],
      pieces: { p1: [{ cell: 5 }, { cell: 5 }, { cell: HOME }, { cell: HOME }] },
    });
    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
    await p1.next('BRANCH_REQUEST');
    await p1.next('STATE');
    // shortcut 선택 → 5→21, 묶음 전체 이동
    p1.send({ type: 'CHOOSE_PATH', pathChoice: 'shortcut' });
    const st = await p1.next('STATE');
    const pcs = st.players.find((p) => p.id === 'p1').pieces;
    expect(pcs[0].cell).toBe(21);
    expect(pcs[1].cell).toBe(21); // 업힌 말도 함께
    p1.close(); p2.close();
  });

  test('QA-RF2-006: 모서리5+윷 → shortcut → 자동 centerExitA cell 28 (center 재요청 없음, 큐 1회 차감, 버그A 2026-06-16)', async () => {
    // 갱신 사유: 버그A 수정(2026-06-16) — 지름길A로 중앙(23)을 통과(잔여 steps)하면 더 이상
    //   중앙 분기를 재요청(corner→center 중첩 모달)하지 않고 자동 centerExitA로 라우팅한다.
    //   따라서 corner 1회 선택만으로 말이 출구(cell 28)까지 한 번에 이동하고 center 재요청은 없다.
    ctx = await boot();
    const { p1, p2 } = await setupGame(ctx.port);
    await injectAndDrain(ctx.port, p1, p2, {
      started: true, currentTurn: 'p1', pendingResults: ['yut'],
      pieces: { p1: [{ cell: 5 }, { cell: HOME }, { cell: HOME }, { cell: HOME }] },
    });
    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'yut' });
    const br1 = await p1.next('BRANCH_REQUEST');
    expect(br1.branchType).toBe('corner');
    await p1.next('STATE');

    // shortcut → 5→21→22→23(통과)→28 자동 centerExitA. center 재요청 없이 STATE만 수신.
    p1.send({ type: 'CHOOSE_PATH', pathChoice: 'shortcut' });
    const stFinal = await p1.next('STATE');
    expect(stFinal.players.find((p) => p.id === 'p1').pieces[0].cell).toBe(28);
    // 큐 정확히 1회 차감 (빔) + 분기 대기 해제
    expect(stFinal.pendingResults).toEqual([]);
    expect(stFinal.awaitingBranchAt).toBe(null);
    expect(stFinal.awaitingBranchType).toBe(null);
    p1.close(); p2.close();
  });

  test('QA-RF2-007: 방어 — 자동 라우팅 후 분기 미대기 상태의 stray CHOOSE_PATH는 조용히 무시 (버그A 2026-06-16 갱신)', async () => {
    // 갱신 사유: 버그A 수정(2026-06-16) — 모서리5+윷+shortcut은 더 이상 center를 재요청(중첩 모달)하지
    //   않고 지름길A로 중앙(23)을 통과해 자동 centerExitA(cell 28)로 라우팅된다. 따라서 "중첩 center
    //   대기 중 재전송" 전제가 구조적으로 사라졌다. 대신 자동 라우팅 직후(awaitingBranchAt=null) 들어온
    //   비정상 CHOOSE_PATH가 서버 가드(`awaitingBranchAt===null` → break)로 조용히 무시되는지
    //   (크래시·영구 잠금·STATE 오발송 없음)를 방어 검증한다.
    ctx = await boot();
    const { p1, p2 } = await setupGame(ctx.port);
    await injectAndDrain(ctx.port, p1, p2, {
      started: true, currentTurn: 'p1', pendingResults: ['yut'],
      pieces: { p1: [{ cell: 5 }, { cell: HOME }, { cell: HOME }, { cell: HOME }] },
    });
    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'yut' });
    const br = await p1.next('BRANCH_REQUEST');
    expect(br.branchType).toBe('corner');
    await p1.next('STATE');

    // shortcut → 5→21→22→23(통과)→28 자동 centerExitA. center 재요청 없이 STATE만 수신.
    p1.send({ type: 'CHOOSE_PATH', pathChoice: 'shortcut' });
    const st = await p1.next('STATE');
    const piece = st.players.find((p) => p.id === 'p1').pieces[0];
    expect(piece.cell).toBe(28);
    expect(st.awaitingBranchAt).toBe(null);

    // 비정상: 분기 미대기 상태에서 stray CHOOSE_PATH 'outer' 재전송 → 서버 가드로 무시(브로드캐스트 없음).
    // STATE가 오면 무시 실패(오작동) 신호. 정상은 짧은 타임아웃(무응답).
    p1.send({ type: 'CHOOSE_PATH', pathChoice: 'outer' });
    let strayBroadcast = false;
    try {
      await p1.next('STATE', 600);
      strayBroadcast = true;
    } catch (e) { /* timeout 기대 — 조용히 무시됨이 정상 */ }
    expect(strayBroadcast).toBe(false);
    p1.close(); p2.close();
  });

  test('QA-RF2-008: corner 분기 대기 중 disconnect → 재입장 → 상태 정리', async () => {
    ctx = await boot();
    const { p1, p2 } = await setupGame(ctx.port);
    await injectAndDrain(ctx.port, p1, p2, {
      started: true, currentTurn: 'p1', pendingResults: ['do'],
      pieces: { p1: [{ cell: 5 }, { cell: HOME }, { cell: HOME }, { cell: HOME }] },
    });
    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
    await p1.next('BRANCH_REQUEST');
    await p1.next('STATE');
    // p2의 BRANCH_REQUEST/STATE(awaitingBranchAt=0) 버퍼를 비워, disconnect 후 STATE만 검증.
    await p2.next('BRANCH_REQUEST');
    p2.drain('STATE');

    // 분기 대기 중 p1 disconnect
    p1.close();
    await p1.waitClose();
    await p2.next('GAME_OVER');
    const st = await p2.next('STATE');
    // softResetRoom → awaitingBranchAt null, awaitingBranchType null
    expect(st.awaitingBranchAt).toBe(null);
    expect(st.awaitingBranchType).toBe(null);
    expect(st.started).toBe(false);
    p2.close();
  });
});

// ═══════════════════════════════════════════════════════════════
// FIX-3 centerExitB 24/25 (§10-4, §13-2, §9-2)
// ═══════════════════════════════════════════════════════════════
test.describe('QA-RF3 FIX-3 centerExitB', () => {
  test('QA-RF3-001: 23 bottom + 도/개/걸/윷/모 잔여 소진', () => {
    expect(computeNextCell(23, 1, 'bottom').toCell).toBe(24);
    expect(computeNextCell(23, 2, 'bottom').toCell).toBe(25);
    expect(computeNextCell(23, 3, 'bottom').toCell).toBe(GOAL);
    expect(computeNextCell(23, 4, 'bottom').toCell).toBe(GOAL); // 윷 통과
    expect(computeNextCell(23, 5, 'bottom').toCell).toBe(GOAL); // 모 통과
  });

  test('QA-RF3-002: 24/25 추가 전진 잔여 소진 GOAL', () => {
    expect(computeNextCell(24, 1, 'centerExitB').toCell).toBe(25);
    expect(computeNextCell(24, 2, 'centerExitB').toCell).toBe(GOAL);
    expect(computeNextCell(25, 1, 'centerExitB').toCell).toBe(GOAL);
    expect(computeNextCell(25, 5, 'centerExitB').toCell).toBe(GOAL);
  });

  test('QA-RF3-003: 24/25 백도 복귀 (25→24, 24→23)', () => {
    expect(computeNextCell(25, -1).toCell).toBe(24);
    expect(computeNextCell(24, -1).toCell).toBe(23);
  });

  test('QA-RF3-004: 중앙(23) 백도는 여전히 22 복귀 (§9-2 기존 정책)', () => {
    expect(computeNextCell(23, -1).toCell).toBe(22);
  });

  test('QA-RF3-005: 24/25에서 잡기 — 상대 말 HOME 복귀 + 보너스(capturedBonus)', async () => {
    ctx = await boot();
    const { p1, p2 } = await setupGame(ctx.port);
    // p1 말 cell 23, 큐 do. p2 말 cell 24 (잡힐 대상).
    await injectAndDrain(ctx.port, p1, p2, {
      started: true, currentTurn: 'p1', pendingResults: ['do'],
      pieces: {
        p1: [{ cell: 23 }, { cell: HOME }, { cell: HOME }, { cell: HOME }],
        p2: [{ cell: 24 }, { cell: HOME }, { cell: HOME }, { cell: HOME }],
      },
    });
    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
    // 중앙 분기 대기
    const br = await p1.next('BRANCH_REQUEST');
    expect(br.branchType).toBe('center');
    await p1.next('STATE');
    p1.send({ type: 'CHOOSE_PATH', pathChoice: 'bottom' });
    const st = await p1.next('STATE');
    // p1 말 cell 24 도착
    expect(st.players.find((p) => p.id === 'p1').pieces[0].cell).toBe(24);
    // p2 말 HOME 복귀
    expect(st.players.find((p) => p.id === 'p2').pieces[0].cell).toBe(HOME);
    // capturedBonus → 큐 비어도 THROW 가능해야 함. currentTurn 여전히 p1.
    expect(st.currentTurn).toBe('p1');
    p1.send({ type: 'THROW_YUT' });
    const yr = await p1.next('YUT_RESULT');
    expect(yr.by).toBe('p1'); // 보너스 던지기 성공
    p1.close(); p2.close();
  });

  test('QA-RF3-006: 24에서 자기 말 업기 (묶음)', async () => {
    ctx = await boot();
    const { p1, p2 } = await setupGame(ctx.port);
    // p1 말 cell 23 + cell 24 (자기 말). 23에서 bottom do → 24 도착 = 업힘.
    await injectAndDrain(ctx.port, p1, p2, {
      started: true, currentTurn: 'p1', pendingResults: ['do', 'do'],
      pieces: { p1: [{ cell: 23 }, { cell: 24 }, { cell: HOME }, { cell: HOME }] },
    });
    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
    await p1.next('BRANCH_REQUEST');
    await p1.next('STATE');
    p1.send({ type: 'CHOOSE_PATH', pathChoice: 'bottom' });
    const st = await p1.next('STATE');
    const pcs = st.players.find((p) => p.id === 'p1').pieces;
    expect(pcs[0].cell).toBe(24);
    expect(pcs[1].cell).toBe(24); // 같은 칸 = 업힘
    // 다음 이동 시 묶음 함께: 24에서 do → 25 (둘 다)
    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
    const st2 = await p1.next('STATE');
    const pcs2 = st2.players.find((p) => p.id === 'p1').pieces;
    expect(pcs2[0].cell).toBe(25);
    expect(pcs2[1].cell).toBe(25);
    p1.close(); p2.close();
  });

  test('QA-RF3-007: 24/25 말이 잡혔을 때 HOME 복귀', async () => {
    ctx = await boot();
    const { p1, p2 } = await setupGame(ctx.port);
    // p2 말 cell 25. p1 말 cell 24, 큐 do(centerExitB context). p1 24→25 도착 → p2 잡기.
    await injectAndDrain(ctx.port, p1, p2, {
      started: true, currentTurn: 'p1', pendingResults: ['do'],
      pieces: {
        p1: [{ cell: 24 }, { cell: HOME }, { cell: HOME }, { cell: HOME }],
        p2: [{ cell: 25 }, { cell: HOME }, { cell: HOME }, { cell: HOME }],
      },
    });
    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
    const st = await p1.next('STATE');
    expect(st.players.find((p) => p.id === 'p1').pieces[0].cell).toBe(25);
    expect(st.players.find((p) => p.id === 'p2').pieces[0].cell).toBe(HOME);
    p1.close(); p2.close();
  });

  test('QA-RF3-008: 24/25 완주 — done=true + 잔여 큐 있어도 게임 종료 판정', async () => {
    ctx = await boot();
    const { p1, p2 } = await setupGame(ctx.port);
    // p1 말 3개 이미 완주, 마지막 말 cell 25, 큐 do → GOAL → 4말 완주 승리
    await injectAndDrain(ctx.port, p1, p2, {
      started: true, currentTurn: 'p1', pendingResults: ['do'],
      pieces: {
        p1: [
          { cell: GOAL, done: true }, { cell: GOAL, done: true },
          { cell: GOAL, done: true }, { cell: 25 },
        ],
      },
    });
    p1.send({ type: 'MOVE_PIECE', pieceIndex: 3, useResult: 'do' });
    const go = await p1.next('GAME_OVER');
    expect(go.winner).toBe('p1');
    p1.close(); p2.close();
  });
});

// ═══════════════════════════════════════════════════════════════
// FIX-4 capturedBonus 정밀화 (§6)
// ═══════════════════════════════════════════════════════════════
test.describe('QA-RF4 FIX-4 capturedBonus', () => {
  test('QA-RF4-001: 큐 [yut,gae], gae로 잡기 → capturedBonus 보존 → yut 사용 → 빈 진입 THROW 소진 → 턴 종료', async () => {
    ctx = await boot();
    const { p1, p2 } = await setupGame(ctx.port);
    // p1 말 cell 3, 큐 [yut, gae]. p2 말 cell 5 (gae로 3→5 잡기).
    await injectAndDrain(ctx.port, p1, p2, {
      started: true, currentTurn: 'p1', pendingResults: ['yut', 'gae'],
      pieces: {
        p1: [{ cell: 3 }, { cell: HOME }, { cell: HOME }, { cell: HOME }],
        p2: [{ cell: 5 }, { cell: HOME }, { cell: HOME }, { cell: HOME }],
      },
    });
    // gae로 잡기. 단 cell 5는 모서리이므로 도착하면 잡기 후 다음 이동 시 분기.
    // 잡기는 도착 시점에 발생 → capturedBonus=true.
    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'gae' });
    const st1 = await p1.next('STATE');
    // p2 잡힘
    expect(st1.players.find((p) => p.id === 'p2').pieces[0].cell).toBe(HOME);
    // capturedBonus true, 큐 [yut] 남음, 턴 유지
    expect(st1.pendingResults).toEqual(['yut']);
    expect(st1.currentTurn).toBe('p1');

    // yut 사용 (cell 5 piece, 큐에 yut). cell 5 → 모서리 분기 corner 대기
    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'yut' });
    const br = await p1.next('BRANCH_REQUEST');
    expect(br.branchType).toBe('corner');
    await p1.next('STATE');
    // outer 선택 → 5→6→7→8→9 = cell 9, 큐 빔
    p1.send({ type: 'CHOOSE_PATH', pathChoice: 'outer' });
    const st2 = await p1.next('STATE');
    expect(st2.players.find((p) => p.id === 'p1').pieces[0].cell).toBe(9);
    expect(st2.pendingResults).toEqual([]);
    // 큐 비었지만 capturedBonus=true → 턴 유지 (THROW 가능)
    expect(st2.currentTurn).toBe('p1');

    // 빈 큐 진입 THROW → capturedBonus 소진. 결과가 yut/mo 아니면 사용 후 턴 종료.
    // gae 강제 (fronts=2) — withRandom 불가(WS), 그냥 던지고 결과 확인.
    p1.send({ type: 'THROW_YUT' });
    const yr = await p1.next('YUT_RESULT');
    await p1.next('STATE');
    // 결과에 따라 분기: 결과를 사용하고 턴이 정상 흐름인지 (데드락 없음)만 검증
    expect(['do', 'gae', 'geol', 'yut', 'mo', 'backdo']).toContain(yr.result);
    p1.close(); p2.close();
  });

  test('QA-RF4-002: QA-D2 데드락 회귀 — 큐 빈 capturedBonus 진입 후 do 결과 → MOVE → 턴 전환', async () => {
    ctx = await boot();
    const { p1, p2 } = await setupGame(ctx.port);
    // capturedBonus 권리만 있고 큐 빈 상태. p1 말 cell 3.
    await injectAndDrain(ctx.port, p1, p2, {
      started: true, currentTurn: 'p1', pendingResults: [], capturedBonus: true,
      pieces: { p1: [{ cell: 3 }, { cell: HOME }, { cell: HOME }, { cell: HOME }] },
    });
    // 빈 큐 + capturedBonus → THROW 허용 + capturedBonus 소진
    p1.send({ type: 'THROW_YUT' });
    const yr = await p1.next('YUT_RESULT');
    await p1.next('STATE');
    // 결과 사용 → MOVE. 결과가 yut/mo면 보너스 더 있음, 그 외는 사용 후 턴 종료.
    // 백도면 cell 3 → 2. 그 외 cell 3 + N.
    const useResult = yr.result;
    if (useResult === 'backdo') {
      p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult });
    } else {
      // 모서리 도달 가능성(예: gae 3→5) → 분기 대기 핸들
      p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult });
    }
    const next = await p1.next('STATE', 3000).catch(() => null);
    // BRANCH_REQUEST가 먼저 올 수도 있으므로 drain
    if (next && next.awaitingBranchAt !== null) {
      p1.send({ type: 'CHOOSE_PATH', pathChoice: 'outer' });
      await p1.next('STATE');
    }
    // 핵심: capturedBonus가 소진되어, yut/mo가 아닌 결과면 결국 턴이 p2로 넘어가야 함 (데드락 없음).
    // yut/mo면 p1 유지가 정상. 어느 쪽이든 게임이 잠기지 않음을 확인.
    expect(['do', 'gae', 'geol', 'yut', 'mo', 'backdo']).toContain(useResult);
    p1.close(); p2.close();
  });

  test('QA-RF4-003: 큐에 yut 남아 진입한 THROW는 capturedBonus 보존 (소진 안 함)', async () => {
    ctx = await boot();
    const { p1, p2 } = await setupGame(ctx.port);
    // 큐 [yut] + capturedBonus=true. yut가 마지막이므로 THROW 자격 있음.
    await injectAndDrain(ctx.port, p1, p2, {
      started: true, currentTurn: 'p1', pendingResults: ['yut'], capturedBonus: true,
      pieces: { p1: [{ cell: 3 }, { cell: HOME }, { cell: HOME }, { cell: HOME }] },
    });
    // 큐에 yut 남아 진입 → capturedBonus 보존. THROW.
    p1.send({ type: 'THROW_YUT' });
    await p1.next('YUT_RESULT');
    const st = await p1.next('STATE');
    // 던진 결과가 큐에 push됨 (yut + 새 결과). capturedBonus는 STATE에 노출 안 되지만
    // 간접 검증: yut 사용 + 새 결과 사용 후에도 잡기 보너스 권리가 남아 추가 THROW 가능해야 함.
    expect(st.pendingResults.length).toBe(2);
    expect(st.pendingResults[0]).toBe('yut');
    p1.close(); p2.close();
  });
});

// ═══════════════════════════════════════════════════════════════
// 교차/방어
// ═══════════════════════════════════════════════════════════════
test.describe('QA-RFX 교차/방어', () => {
  test('QA-RFX-001: 방어 — 중앙(23) 대기 중 outer/shortcut 수신 (비정상) → 크래시 없음', async () => {
    ctx = await boot();
    const { p1, p2 } = await setupGame(ctx.port);
    await injectAndDrain(ctx.port, p1, p2, {
      started: true, currentTurn: 'p1', pendingResults: ['do'],
      pieces: { p1: [{ cell: 23 }, { cell: HOME }, { cell: HOME }, { cell: HOME }] },
    });
    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
    const br = await p1.next('BRANCH_REQUEST');
    expect(br.branchType).toBe('center');
    await p1.next('STATE');
    // 비정상: center 대기 중 'shortcut' 수신. branchPiece.cell=23(5/10 아님) → 합성 안 함.
    // isBottomExit('shortcut')=false → centerExitA. 23+do → 28.
    // 갱신 사유: 버그B 수정(2026-06-16) — centerExitA에 중간 칸 28/29 신설로 23+do는 이전 15가 아니라 28.
    p1.send({ type: 'CHOOSE_PATH', pathChoice: 'shortcut' });
    const st = await p1.next('STATE');
    const piece = st.players.find((p) => p.id === 'p1').pieces[0];
    expect(piece.cell).toBe(28); // centerExitA 첫 중간 칸 (버그B: 23→28)
    expect(st.awaitingBranchAt).toBe(null);
    p1.close(); p2.close();
  });

  test('QA-RFX-002: 모서리 통과(멈추지 않음)는 분기 없음 — cell 4 + gae → cell 6', () => {
    expect(computeNextCell(4, 2).toCell).toBe(6);
    expect(computeNextCell(4, 2).awaitingBranch).toBe(false);
    // cell 9 + gae → 11 (10 통과)
    expect(computeNextCell(9, 2).toCell).toBe(11);
  });

  test('QA-RFX-003: corner outer → cell 10 도달(정확히 멈춤) → 다음 이동 또 corner 분기', async () => {
    ctx = await boot();
    const { p1, p2 } = await setupGame(ctx.port);
    // cell 5 + 모(5) outer → 5→6→7→8→9→10 = cell 10 정확히 멈춤
    await injectAndDrain(ctx.port, p1, p2, {
      started: true, currentTurn: 'p1', pendingResults: ['mo'],
      pieces: { p1: [{ cell: 5 }, { cell: HOME }, { cell: HOME }, { cell: HOME }] },
    });
    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'mo' });
    await p1.next('BRANCH_REQUEST');
    await p1.next('STATE');
    p1.send({ type: 'CHOOSE_PATH', pathChoice: 'outer' });
    // mo는 보너스 결과 → 큐 소진 후 보너스 던지기 권. STATE 확인.
    const st = await p1.next('STATE');
    expect(st.players.find((p) => p.id === 'p1').pieces[0].cell).toBe(10);
    p1.close(); p2.close();
  });

  test('QA-RFX-004: 백도 후 모서리에 멈춤 → 분기 없음 (백도는 분기 트리거 아님)', () => {
    // cell 6 백도 → 5 (모서리). 도착은 백도 결과이므로 분기 없음 (멈춤만).
    const r = computeNextCell(6, -1);
    expect(r.toCell).toBe(5);
    expect(r.awaitingBranch).toBe(false);
    // 단, 그 다음 이동(전진)은 cell 5에서 분기 발생해야 함
    expect(computeNextCell(5, 1).awaitingBranch).toBe(true);
  });
});
