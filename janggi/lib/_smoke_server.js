/**
 * @fileoverview Phase 2 서버 스모크 테스트.
 * createApp() 생성, HTTP 서빙 경로 확인, WS 메시지 프로토콜 검증.
 *
 * 실행: node minigame-paradise/janggi/lib/_smoke_server.js
 */

import http from 'http';
import { WebSocket } from 'ws';
import { createApp } from '../server.js';

let pass = 0;
let fail = 0;

function assert(cond, label) {
  if (cond) {
    pass++;
    console.log(`  PASS: ${label}`);
  } else {
    fail++;
    console.log(`  FAIL: ${label}`);
  }
}

async function main() {
  console.log('=== Phase 2 Server Smoke Test ===\n');

  // ── 1. createApp() 기본 검증 ──
  console.log('1. createApp() 기본 검증');
  const app = createApp();
  assert(typeof app.handleHttp === 'function', 'handleHttp is function');
  assert(typeof app.handleUpgrade === 'function', 'handleUpgrade is function');

  // ── 2. HTTP 서버 + WS 서버 기동 ──
  console.log('\n2. HTTP+WS 서버 기동');
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);

  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve());
    server.on('error', reject);
  });

  const addr = server.address();
  const port = addr.port;
  console.log(`  서버 기동: 127.0.0.1:${port}`);
  assert(port > 0, '서버 포트 할당');

  // ── 3. HTTP 정적 파일 확인 ──
  console.log('\n3. HTTP 정적 파일 확인');
  const indexRes = await fetch(`http://127.0.0.1:${port}/index.html`);
  assert(indexRes.status === 200, 'index.html 200 응답');
  const indexBody = await indexRes.text();
  assert(indexBody.includes('janggi-board'), 'index.html에 janggi-board 포함');

  const cssRes = await fetch(`http://127.0.0.1:${port}/css/style.css`);
  assert(cssRes.status === 200, 'style.css 200 응답');
  const cssBody = await cssRes.text();
  assert(cssBody.includes('--janggi-han-primary'), 'CSS에 --janggi-han-primary 변수 포함');

  const jsRes = await fetch(`http://127.0.0.1:${port}/js/main.js`);
  assert(jsRes.status === 200, 'main.js 200 응답');

  // ── 4. WS 연결 + JOINED 수신 ──
  console.log('\n4. WS 연결 + JOINED 수신');

  const p1Msgs = [];
  const p2Msgs = [];

  // p1 연결: 리스너를 먼저 등록한 후 open을 대기
  const ws1 = new WebSocket(`ws://127.0.0.1:${port}/ws?side=han`);
  ws1.on('message', (data) => {
    p1Msgs.push(JSON.parse(data.toString()));
  });
  await new Promise((resolve) => ws1.on('open', resolve));
  assert(true, 'WS p1 연결 성공');

  // p1 JOINED 대기
  await sleep(300);
  assert(p1Msgs.length >= 1, 'p1 메시지 수신');
  const p1Joined = p1Msgs.find(m => m.type === 'JOINED');
  assert(p1Joined && p1Joined.side === 'han', 'p1 JOINED side=han');
  assert(p1Joined && p1Joined.waiting === true, 'p1 JOINED waiting=true');

  // p2 연결: 리스너를 먼저 등록
  const ws2 = new WebSocket(`ws://127.0.0.1:${port}/ws?side=cho`);
  ws2.on('message', (data) => {
    p2Msgs.push(JSON.parse(data.toString()));
  });
  await new Promise((resolve) => ws2.on('open', resolve));
  assert(true, 'WS p2 연결 성공');

  await sleep(300);

  // p2 JOINED
  const p2Joined = p2Msgs.find(m => m.type === 'JOINED');
  assert(p2Joined && p2Joined.side === 'cho', 'p2 JOINED side=cho');
  assert(p2Joined && p2Joined.waiting === false, 'p2 JOINED waiting=false');

  // GAME_START 수신
  const p1GameStart = p1Msgs.find(m => m.type === 'GAME_START');
  assert(p1GameStart && p1GameStart.phase === 'setup_cho', 'p1 GAME_START phase=setup_cho');

  // SETUP_PROMPT 수신
  const p1SetupPrompt = p1Msgs.find(m => m.type === 'SETUP_PROMPT');
  assert(p1SetupPrompt && p1SetupPrompt.side === 'cho', 'SETUP_PROMPT side=cho');

  // ── 5. 배치 선택 흐름 ──
  console.log('\n5. 배치 선택 흐름');

  // 초 배치 선택
  ws2.send(JSON.stringify({ type: 'SELECT_SETUP', setup: 'MSMS' }));
  await sleep(200);

  // STATE 수신 확인 (setup_han)
  const p1State1 = p1Msgs.findLast(m => m.type === 'STATE');
  assert(p1State1 && p1State1.phase === 'setup_han', 'STATE phase=setup_han after cho setup');
  assert(p1State1 && p1State1.choSetup === 'MSMS', 'STATE choSetup=MSMS');

  // 한 배치 선택
  ws1.send(JSON.stringify({ type: 'SELECT_SETUP', setup: 'SMSM' }));
  await sleep(200);

  // playing 상태 확인
  const p1State2 = p1Msgs.findLast(m => m.type === 'STATE');
  assert(p1State2 && p1State2.phase === 'playing', 'STATE phase=playing after both setup');
  assert(p1State2 && p1State2.board !== null, 'STATE board is not null');
  assert(p1State2 && p1State2.turn === 'han', 'STATE turn=han (선수)');

  // 32개 기물 확인
  let pieceCount = 0;
  if (p1State2 && p1State2.board) {
    for (const row of p1State2.board) {
      for (const cell of row) {
        if (cell) pieceCount++;
      }
    }
  }
  assert(pieceCount === 32, `보드 기물 32개 (실제: ${pieceCount})`);

  // GAME_START playing 확인
  const p1GameStartPlay = p1Msgs.findLast(m => m.type === 'GAME_START' && m.phase === 'playing');
  assert(!!p1GameStartPlay, 'GAME_START phase=playing 수신');

  // ── 6. REQUEST_MOVES ──
  console.log('\n6. REQUEST_MOVES');
  const p1MsgsBefore = p1Msgs.length;
  ws1.send(JSON.stringify({ type: 'REQUEST_MOVES', file: 0, rank: 0 }));
  await sleep(200);

  const legalMovesMsg = p1Msgs.findLast(m => m.type === 'LEGAL_MOVES');
  assert(!!legalMovesMsg, 'LEGAL_MOVES 수신');
  assert(legalMovesMsg && legalMovesMsg.file === 0, 'LEGAL_MOVES file=0');
  assert(legalMovesMsg && legalMovesMsg.rank === 0, 'LEGAL_MOVES rank=0');
  assert(legalMovesMsg && Array.isArray(legalMovesMsg.moves), 'LEGAL_MOVES moves is array');

  // ── 7. MOVE (한 차 이동) ──
  console.log('\n7. MOVE');
  // 한 차(0,0)를 (0,1)로 이동 시도
  ws1.send(JSON.stringify({ type: 'MOVE', fromFile: 0, fromRank: 0, toFile: 0, toRank: 1 }));
  await sleep(200);

  const p1StateAfterMove = p1Msgs.findLast(m => m.type === 'STATE');
  assert(p1StateAfterMove && p1StateAfterMove.turn === 'cho', 'MOVE 후 turn=cho');
  assert(p1StateAfterMove && p1StateAfterMove.lastMove?.fromFile === 0, 'lastMove fromFile=0');
  assert(p1StateAfterMove && p1StateAfterMove.lastMove?.toRank === 1, 'lastMove toRank=1');

  // ── 8. 불법 수 ERROR ──
  console.log('\n8. 불법 수 ERROR');
  // 한 차례가 아닌 한이 이동 시도
  ws1.send(JSON.stringify({ type: 'MOVE', fromFile: 4, fromRank: 3, toFile: 4, toRank: 4 }));
  await sleep(200);

  const errorMsg = p1Msgs.findLast(m => m.type === 'ERROR');
  assert(errorMsg && errorMsg.message.includes('차례'), 'ERROR: 차례가 아닌 이동 거부');

  // ── 9. 기권 ──
  console.log('\n9. 기권');
  ws2.send(JSON.stringify({ type: 'RESIGN' }));
  await sleep(200);

  const gameOverMsg = p1Msgs.findLast(m => m.type === 'GAME_OVER');
  assert(gameOverMsg && gameOverMsg.winner === 'han', 'GAME_OVER winner=han after cho resign');
  assert(gameOverMsg && gameOverMsg.reason === 'resign', 'GAME_OVER reason=resign');

  // ── 정리 ──
  ws1.close();
  ws2.close();
  await sleep(100);
  server.close();

  console.log(`\n=== 결과: ${pass} PASS / ${fail} FAIL (총 ${pass + fail}) ===`);
  process.exit(fail > 0 ? 1 : 0);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

main().catch(err => {
  console.error('스모크 테스트 오류:', err);
  process.exit(1);
});
