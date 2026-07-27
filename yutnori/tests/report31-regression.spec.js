/**
 * @fileoverview 리포트 31 회귀 테스트.
 * 모로 지름길 진입 모서리에 도착한 AI 말의 렌더링과 동일 노드 잡기를 검증한다.
 */

import { test, expect } from 'playwright/test';
import { createApp, computeNextCell } from '../server.js';
import { canonicalNodeId } from '../public/js/board-node.js';
import { BOARD_PIECE_RADIUS, boardPieceVisual } from '../public/js/ui.js';
import {
  startServer,
  stopServer,
  setupGame,
  inject,
} from './rulebook-helpers.js';

/** 기본 말 네 개를 만들되 첫 말만 지정한 칸에 둔다.
 * @param {number} firstCell 첫 말의 칸
 * @returns {Array<{cell:number,stack:number,done:boolean}>}
 */
function piecesAt(firstCell) {
  return [
    { cell: firstCell, stack: 1, done: false },
    { cell: -1, stack: 1, done: false },
    { cell: -1, stack: 1, done: false },
    { cell: -1, stack: 1, done: false },
  ];
}

test('R31-U1: HOME에서 모는 지름길 진입 모서리 node:5에 도착한다', () => {
  const result = computeNextCell(-1, 5);
  expect(result.toCell).toBe(5);
  expect(canonicalNodeId(result.toCell)).toBe('node:5');
});

test('R31-U2: 경로 별칭 20과 시작점 0은 같은 물리 노드다', () => {
  expect(canonicalNodeId(20)).toBe(canonicalNodeId(0));
  expect(canonicalNodeId(-1)).toBeNull();
  expect(canonicalNodeId(99)).toBeNull();
});

test('R31-U3: AI와 사람 말은 모서리·일반 칸에서 같은 크기와 노드 중심을 쓴다', () => {
  const aiCorner = boardPieceVisual({ cell: 5, nodeId: 'node:5' });
  const humanCorner = boardPieceVisual({ cell: 5 });
  const shortcut = boardPieceVisual({ cell: 21 });

  expect(aiCorner).toEqual(humanCorner);
  expect(aiCorner.r).toBe(BOARD_PIECE_RADIUS);
  expect(shortcut.r).toBe(BOARD_PIECE_RADIUS);
  expect(aiCorner.x).toBe(50);
  expect(aiCorner.y).toBe(50);
});

test('R31-WS1: AI가 모로 도착한 모서리에 상대가 착지하면 즉시 잡힌다', async () => {
  const app = createApp();
  const { server, port } = await startServer(app);
  let p1;
  let p2;

  try {
    ({ p1, p2 } = await setupGame(port));
    await inject(port, {
      started: true,
      currentTurn: 'p1',
      pendingResults: ['do'],
      pendingThrows: 0,
      capturedBonus: false,
      pieces: {
        p1: piecesAt(4),
        p2: piecesAt(computeNextCell(-1, 5).toCell),
      },
    });
    await p1.next('STATE');
    await p2.next('STATE');

    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
    const state = await p1.next('STATE');
    await p2.next('STATE');

    const human = state.players.find((player) => player.id === 'p1');
    const ai = state.players.find((player) => player.id === 'p2');
    expect(human.pieces[0].cell).toBe(5);
    expect(human.pieces[0].nodeId).toBe('node:5');
    expect(ai.pieces[0].cell).toBe(-1);
    expect(ai.pieces[0].nodeId).toBeNull();
    expect(state.capturedBonus).toBe(true);
  } finally {
    if (p1) p1.close();
    if (p2) p2.close();
    await stopServer(server);
  }
});
