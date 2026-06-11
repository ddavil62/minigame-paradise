/**
 * @fileoverview YR-C15 시리즈 — FIX-1 재입장 ID 중복 데드락 해소 (2개)
 * 룰북 참조: minigames/yutnori/docs/RULEBOOK.md §1 (1:1 매칭), §13-13 (재입장 ID 배정)
 *
 * 검증 내용: ws.on('connection') 핸들러가 players.length 기반이 아니라
 *   "현재 players 배열에 없는 ID"를 배정하는지 확인한다.
 *   - 기존: players.length === 0 ? 'p1' : 'p2' → p1 disconnect 후 재접속 시 p2 중복 → 데드락.
 *   - FIX-1: 미사용 ID(p1/p2 중 없는 것)를 배정.
 */

import { test, expect } from 'playwright/test';
import { createApp } from '../server.js';
import { startServer, stopServer, connectWs } from './rulebook-helpers.js';

// ── §13-13 FIX-1 재입장 ID 배정 ──────────────────────────────────

test('YR-C15-001: p1 disconnect 후 재접속 시 다시 p1 배정 (§1 §13-13 FIX-1)', async () => {
  // Given: p1, p2 입장 완료
  // When: p1 연결 종료(disconnect) 후 새 연결 입장
  // Then: 새 연결의 playerId === 'p1' (p2 중복 배정 아님)
  const app = createApp({});
  const { server, port } = await startServer(app);
  const p1 = await connectWs(port);
  const p2 = await connectWs(port);
  try {
    p1.send({ type: 'JOIN', playerName: 'A' });
    const j1 = await p1.next('JOINED');
    expect(j1.playerId).toBe('p1');
    p2.send({ type: 'JOIN', playerName: 'B' });
    const j2 = await p2.next('JOINED');
    expect(j2.playerId).toBe('p2');

    // p1 disconnect → 서버가 players에서 p1 제거
    p1.close();
    await p1.waitClose();
    // 서버 측 close 핸들러 처리(players.filter)가 완료될 시간 확보
    await new Promise((r) => setTimeout(r, 100));

    // 재접속 — 남은 ID(p1)를 배정받아야 함
    const p1b = await connectWs(port);
    p1b.send({ type: 'JOIN', playerName: 'A-again' });
    const j1b = await p1b.next('JOINED');
    expect(j1b.playerId).toBe('p1');
    p1b.close();
  } finally {
    p2.close();
    await stopServer(server);
  }
});

test('YR-C15-002: p2 disconnect 후 재접속 시 다시 p2 배정 (§1 §13-13 FIX-1)', async () => {
  // Given: p1, p2 입장 완료
  // When: p2 연결 종료 후 새 연결 입장
  // Then: 새 연결의 playerId === 'p2'
  const app = createApp({});
  const { server, port } = await startServer(app);
  const p1 = await connectWs(port);
  const p2 = await connectWs(port);
  try {
    p1.send({ type: 'JOIN', playerName: 'A' });
    await p1.next('JOINED');
    p2.send({ type: 'JOIN', playerName: 'B' });
    const j2 = await p2.next('JOINED');
    expect(j2.playerId).toBe('p2');

    p2.close();
    await p2.waitClose();
    await new Promise((r) => setTimeout(r, 100));

    const p2b = await connectWs(port);
    p2b.send({ type: 'JOIN', playerName: 'B-again' });
    const j2b = await p2b.next('JOINED');
    expect(j2b.playerId).toBe('p2');
    p2b.close();
  } finally {
    p1.close();
    await stopServer(server);
  }
});
