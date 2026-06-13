/**
 * @fileoverview 빠른 스모크 테스트 — ws 클라 2개로 STATE 분포 검증.
 * 실행: node smoke-test.js
 */

import WebSocket from 'ws';

const URL = 'ws://localhost:3099';

function makeClient(label) {
  const ws = new WebSocket(URL);
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === 'STATE') {
      console.log(`[${label}] STATE: you=${msg.you} hand=${msg.yourHand.length} oppHand=${msg.oppHandCount} floor=${msg.floor.length} deck=${msg.deckCount} phase=${msg.phase} turn=${msg.turn}`);
      const byType = { gwang: 0, tti: 0, kkeut: 0, pi: 0 };
      const allCards = [...msg.yourHand, ...msg.floor];
      // 상대 손은 안 보임. 더미는 안 보임. 그러나 captured + floor + hand + opp개수 + deck = 50 검증
      // (2026-06-03: 조커 2장 추가로 50)
      const total = msg.yourHand.length + msg.oppHandCount + msg.floor.length + msg.deckCount
                  + (msg.captured.p1?.length || 0) + (msg.captured.p2?.length || 0);
      console.log(`[${label}] 카드 총합: ${total}/50`);
      if (label === 'A' && msg.phase === 'awaiting_play') {
        setTimeout(() => ws.close(), 500);
      }
    } else if (msg.type === 'JOINED') {
      console.log(`[${label}] JOINED → playerId=${msg.playerId}, waiting=${msg.waiting}`);
    } else if (msg.type === 'GAME_START') {
      console.log(`[${label}] GAME_START`);
    } else {
      console.log(`[${label}] ${msg.type}`);
    }
  });
  ws.on('open', () => console.log(`[${label}] connected`));
  ws.on('close', () => console.log(`[${label}] closed`));
  ws.on('error', (e) => console.error(`[${label}] error`, e.message));
  return ws;
}

const a = makeClient('A');
setTimeout(() => {
  const b = makeClient('B');
  setTimeout(() => { try { a.close(); b.close(); } catch {} ; process.exit(0); }, 2000);
}, 500);
