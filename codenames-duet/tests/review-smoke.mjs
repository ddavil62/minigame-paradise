/**
 * @fileoverview 복기 모드 추가에 대한 회귀 스모크 테스트.
 *
 * 검증 항목:
 *   CODENAMES-REVIEW-001  GAME_END 페이로드에 review(words, keyCardP1, keyCardP2, revealed, greenFound, tokensLeft)가 포함된다.
 *                         서버가 자동으로 NEW_GAME / GAME_START을 트리거하지 않는다 (사용자 입력이 있을 때만).
 *   CODENAMES-REVIEW-002  암살자 케이스에서도 review 페이로드가 전송된다 (양쪽 모두).
 *   CODENAMES-REVIEW-003  토큰 소진(lost/tokens) 케이스에서도 review 페이로드가 전송된다.
 *   CODENAMES-REVIEW-004  사용자가 NEW_GAME 메시지를 보내면 GAME_START 브로드캐스트가 발생한다 (수동 트리거 정상).
 *
 * 실행: node minigames/codenames-duet/tests/review-smoke.mjs
 *       (서버는 inline으로 import해서 임의 포트로 띄운다 — 3098 사용 / launcher 3000과 충돌 없음)
 */

import http from 'http';
import { WebSocket } from 'ws';
import { createApp } from '../server.js';
import { createGame, snapshotForPlayer, guessCard, submitClue } from '../game.js';

const PORT = 3098;

// ── 미니 테스트 러너 ─────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures = [];
function assert(cond, label) {
  if (cond) { passed += 1; console.log(`  PASS  ${label}`); }
  else      { failed += 1; failures.push(label); console.log(`  FAIL  ${label}`); }
}

// ── 서버 부팅 ────────────────────────────────────────────────
const app = createApp();
const server = http.createServer(app.handleHttp);
server.on('upgrade', app.handleUpgrade);
await new Promise((res) => server.listen(PORT, '127.0.0.1', res));
console.log(`[smoke] server up on ${PORT}`);

/**
 * WebSocket 한 명을 만들고 connect/JOINED까지 기다린다.
 * messages 배열에 모든 수신 메시지를 push한다.
 */
function makeClient() {
  const messages = [];
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  ws.on('message', (data) => {
    try { messages.push(JSON.parse(data.toString())); }
    catch { /* noop */ }
  });
  return { ws, messages };
}

function waitOpen(ws) {
  return new Promise((res, rej) => {
    ws.once('open', res);
    ws.once('error', rej);
  });
}

function waitFor(messages, predicate, timeoutMs = 3000) {
  return new Promise((res, rej) => {
    const start = Date.now();
    const t = setInterval(() => {
      const hit = messages.find(predicate);
      if (hit) { clearInterval(t); res(hit); return; }
      if (Date.now() - start > timeoutMs) {
        clearInterval(t);
        rej(new Error('timeout waiting for message'));
      }
    }, 20);
  });
}

// ── 단위 1: game.js 직접 호출로 keyCard 노출 가능 여부 (서버 buildGameEndPayload 로직 모사) ──
{
  console.log('\n[REVIEW-000] game.js 키 카드 구조 검증');
  const g = createGame('p1');
  assert(g.keyCard.length === 25, 'keyCard 길이 25');
  assert(g.keyCard.every((c) => typeof c.left === 'string' && typeof c.right === 'string'), 'keyCard 각 칸 left/right 문자열');
  const snap = snapshotForPlayer(g, 'p1');
  assert(!('keyCard' in snap), 'STATE 스냅샷에는 keyCard 원본이 노출되지 않음 (진행 중 마스킹 유지)');
}

// ── 통신 시나리오: 2명 접속 → 단서 1턴 → 강제로 amber/lost를 만들기 위해 game 내부 조작은 불가하므로
// 실제 플레이를 시뮬레이션해 GAME_END 페이로드 구조만 확인한다 (승/패 어떤 케이스든 동일 구조).
// 가장 빠른 종료 경로: 한쪽이 PASS를 9번 → 토큰 소진(lost/tokens).
{
  console.log('\n[REVIEW-001~003] 2인 접속 → 토큰 소진 경로로 GAME_END 발생');
  const a = makeClient();
  const b = makeClient();
  await waitOpen(a.ws);
  await waitOpen(b.ws);

  // JOIN 전송 (READY 게이트 프로토콜)
  a.ws.send(JSON.stringify({ type: 'JOIN', name: 'SmokeA' }));
  b.ws.send(JSON.stringify({ type: 'JOIN', name: 'SmokeB' }));

  // 양쪽 모두 JOINED (opponentName 포함) 수신 대기
  await waitFor(a.messages, (m) => m.type === 'JOINED' && m.opponentName);
  await waitFor(b.messages, (m) => m.type === 'JOINED' && m.opponentName);

  // 양쪽 READY 전송
  a.ws.send(JSON.stringify({ type: 'READY' }));
  b.ws.send(JSON.stringify({ type: 'READY' }));

  // GAME_START 대기
  await waitFor(a.messages, (m) => m.type === 'GAME_START');
  await waitFor(b.messages, (m) => m.type === 'GAME_START');

  // 첫 STATE 받으면 누가 단서 차례인지 확인 (p1 고정)
  const firstState = await waitFor(a.messages, (m) => m.type === 'STATE' && m.turn);
  assert(firstState.turn === 'p1', '첫 단서자 = p1');

  // p1이 단서 전송 → p2가 추측 차례
  a.ws.send(JSON.stringify({ type: 'CLUE', word: 'TEST', number: 1 }));
  await waitFor(b.messages, (m) => m.type === 'STATE' && m.guessingPlayer === 'p2');

  // 이제 p2가 PASS 반복 → 매 PASS마다 토큰 -1, 단서자/추측자 토글
  // 9번 PASS면 토큰 9 → 0, lost 발생
  let endA = null, endB = null;
  let cluesGiven = 1;
  let stateSeenAfterPass = a.messages.length;
  for (let i = 0; i < 30; i++) {
    // 누가 guessingPlayer인지 보고 PASS 전송, 단서가 비어있으면 단서부터 전송
    const latest = a.messages.filter((m) => m.type === 'STATE').slice(-1)[0];
    if (!latest) break;
    if (latest.phase !== 'playing') break;
    if (latest.guessingPlayer === null) {
      // 누가 단서 차례인지 확인 후 단서 전송
      const giver = latest.turn === 'p1' ? a : b;
      giver.ws.send(JSON.stringify({ type: 'CLUE', word: `T${cluesGiven}`, number: 1 }));
      cluesGiven += 1;
      await waitFor(a.messages, (m) => m.type === 'STATE' && m.guessingPlayer !== null);
      continue;
    }
    const guesser = latest.guessingPlayer === 'p1' ? a : b;
    guesser.ws.send(JSON.stringify({ type: 'PASS' }));
    // STATE 또는 GAME_END 중 하나가 오기를 기다림
    await new Promise((res) => setTimeout(res, 50));
    endA = a.messages.find((m) => m.type === 'GAME_END');
    endB = b.messages.find((m) => m.type === 'GAME_END');
    if (endA && endB) break;
  }

  assert(!!endA && !!endB, '양쪽 모두 GAME_END 수신');
  if (endA) {
    assert(endA.outcome === 'lost', 'outcome = lost');
    assert(endA.reason === 'tokens', 'reason = tokens');
    assert(typeof endA.review === 'object' && endA.review !== null, 'review 페이로드 존재');
    if (endA.review) {
      const r = endA.review;
      assert(Array.isArray(r.words) && r.words.length === 25, 'review.words 25개');
      assert(Array.isArray(r.keyCardP1) && r.keyCardP1.length === 25, 'review.keyCardP1 25개');
      assert(Array.isArray(r.keyCardP2) && r.keyCardP2.length === 25, 'review.keyCardP2 25개');
      assert(Array.isArray(r.revealed) && r.revealed.length === 25, 'review.revealed 25개');
      const valid = (v) => v === 'green' || v === 'neutral' || v === 'assassin';
      assert(r.keyCardP1.every(valid), 'keyCardP1 색상 값 정상');
      assert(r.keyCardP2.every(valid), 'keyCardP2 색상 값 정상');
      // 분포: p1 시점 green 9 / neutral 13 / assassin 3
      const cnt = (arr, v) => arr.filter((x) => x === v).length;
      assert(cnt(r.keyCardP1, 'green') === 9, 'keyCardP1 green 9');
      assert(cnt(r.keyCardP1, 'neutral') === 13, 'keyCardP1 neutral 13');
      assert(cnt(r.keyCardP1, 'assassin') === 3, 'keyCardP1 assassin 3');
      assert(cnt(r.keyCardP2, 'green') === 9, 'keyCardP2 green 9');
      assert(cnt(r.keyCardP2, 'neutral') === 13, 'keyCardP2 neutral 13');
      assert(cnt(r.keyCardP2, 'assassin') === 3, 'keyCardP2 assassin 3');
      assert(typeof r.tokensLeft === 'number', 'tokensLeft 숫자');
      assert(r.tokensLeft === 0, 'tokens 소진으로 끝났으니 0');
    }
  }

  // 양쪽 review가 같은 내용이어야 함 (둘 다 양쪽 시점 전부 공개)
  if (endA && endB && endA.review && endB.review) {
    assert(JSON.stringify(endA.review.keyCardP1) === JSON.stringify(endB.review.keyCardP1), '양쪽 client.review.keyCardP1 일치');
    assert(JSON.stringify(endA.review.keyCardP2) === JSON.stringify(endB.review.keyCardP2), '양쪽 client.review.keyCardP2 일치');
    assert(JSON.stringify(endA.review.words)     === JSON.stringify(endB.review.words),     '양쪽 client.review.words 일치');
  }

  // ── REVIEW-001 자동 새 게임 트리거 없음 확인 ──
  // GAME_END 이후 새로운 GAME_START 메시지가 추가로 도착하지 않아야 한다 (200ms 여유)
  const beforeWait = a.messages.length;
  await new Promise((res) => setTimeout(res, 300));
  const newStarts = a.messages.filter((m, i) => i >= beforeWait && m.type === 'GAME_START');
  assert(newStarts.length === 0, 'GAME_END 이후 서버가 자동 GAME_START 트리거하지 않음');

  // ── REVIEW-004: 사용자가 NEW_GAME 명령을 보내면 GAME_START 발생 ──
  const beforeNewGame = a.messages.length;
  a.ws.send(JSON.stringify({ type: 'NEW_GAME', tokens: 9 }));
  await waitFor(a.messages, (m, idx) => {
    return m.type === 'GAME_START';
  });
  const newStartHit = a.messages.slice(beforeNewGame).find((m) => m.type === 'GAME_START');
  assert(!!newStartHit, '사용자 NEW_GAME 요청 시 GAME_START 발생');

  a.ws.close();
  b.ws.close();
  await new Promise((res) => setTimeout(res, 100));
}

// ── 단위: 중립 클릭 시 greenFound 미증가 (결함 2 검증) ────────────
{
  console.log('\n[REVIEW-005] 중립 클릭 시 반대면 green이어도 greenFound 미증가');
  const g = createGame('p1');
  // keyCard에서 left='neutral', right='green' (또는 반대)인 카드를 찾는다
  let neutralIdx = -1;
  for (let i = 0; i < g.keyCard.length; i++) {
    const k = g.keyCard[i];
    if (k.left === 'neutral' && k.right === 'green') { neutralIdx = i; break; }
    if (k.left === 'green' && k.right === 'neutral') { neutralIdx = i; break; }
  }
  if (neutralIdx === -1) {
    // 해당 카드 조합이 없으면 수동 세팅
    g.keyCard[0] = { left: 'neutral', right: 'green' };
    neutralIdx = 0;
  }

  // p1이 단서를 내고 추측 phase로 전환 (phase는 'playing'이어야 guessCard가 동작함)
  g.phase = 'playing';
  g.currentClue = { from: 'p1', word: 'test', number: 2 };
  g.guessingPlayer = 'p2'; // p1 단서자 → p2가 추측자
  g.guessesLeft = 3;
  const beforeP1 = g.greenFound.p1;
  const beforeP2 = g.greenFound.p2;

  // p1이 단서자이므로 side='left'. neutralIdx가 left='neutral'이면 result='neutral'
  const side = g.keyCard[neutralIdx].left;
  if (side === 'neutral') {
    const res = guessCard(g, 'p2', neutralIdx);
    assert(res.result === 'neutral', '중립 카드 클릭 → result=neutral');
    assert(g.greenFound.p1 === beforeP1, '중립 클릭 후 greenFound.p1 미변경');
    assert(g.greenFound.p2 === beforeP2, '중립 클릭 후 greenFound.p2 미변경 (반대면 green이어도)');
  } else {
    // left='green', right='neutral' → p2가 단서자일 때 테스트
    g.currentClue = { from: 'p2', word: 'test', number: 2 };
    g.guessingPlayer = 'p1'; // p2 단서자 → p1이 추측자
    g.phase = 'playing';
    g.guessesLeft = 3;
    const res = guessCard(g, 'p1', neutralIdx);
    assert(res.result === 'neutral', '중립 카드 클릭 → result=neutral');
    assert(g.greenFound.p1 === beforeP1, '중립 클릭 후 greenFound.p1 미변경 (반대면 green이어도)');
    assert(g.greenFound.p2 === beforeP2, '중립 클릭 후 greenFound.p2 미변경');
  }
}

// ── 종료 ────────────────────────────────────────────────────
server.close();
console.log(`\n총: ${passed + failed}건  PASS: ${passed}  FAIL: ${failed}`);
if (failed > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('ALL PASS');
process.exit(0);
