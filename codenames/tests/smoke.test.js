/**
 * @fileoverview 코드네임 클래식(정통 4인 2:2) WS 스모크 + 순수 로직 + 능동 공격 probe.
 *
 * 실행: node codenames/tests/smoke.test.js   (격리 포트 3114, launcher 3000 미사용)
 *
 * 구성:
 *   [A] 순수 game.js 불변식 (CN-S-DIST / MASK / RESULT / WIN — 다회 반복 결정적)
 *   [B] WS 통합 (CN-S-001~012 — role_select·권위·마스킹·암살자 종료·리매치)
 *   [C] 능동 공격 probe (CN-ATK-xxx — 역할/팀/순서/경계/종료후 공격)
 *
 * 키 색을 알아야 하는 결과 검증은 스파이마스터 STATE.myKey(전체 노출)로 실제 키를 읽어 결정적으로 수행.
 */

import http from 'http';
import { WebSocket } from 'ws';
import { createApp } from '../server.js';
import {
  createGame, giveClue, guessCard, endTurnByPass, snapshotForPlayer,
} from '../game.js';

const PORT = 3114;

// ── 미니 러너 ──────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures = [];
function assert(cond, label) {
  if (cond) { passed += 1; console.log(`  PASS  ${label}`); }
  else      { failed += 1; failures.push(label); console.log(`  FAIL  ${label}`); }
}

// ── WS 헬퍼 ────────────────────────────────────────────────────────
function makeClient() {
  const messages = [];
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  ws.on('message', (data) => {
    try { messages.push(JSON.parse(data.toString())); } catch { /* noop */ }
  });
  return { ws, messages };
}
function waitOpen(ws) {
  return new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
}
function waitFor(target, predicate, timeoutMs = 3000) {
  // target은 messages 배열 또는 {messages} 클라이언트 둘 다 허용.
  const messages = Array.isArray(target) ? target : target.messages;
  return new Promise((res, rej) => {
    const start = Date.now();
    const t = setInterval(() => {
      const hit = [...messages].reverse().find(predicate);
      if (hit) { clearInterval(t); res(hit); return; }
      if (Date.now() - start > timeoutMs) { clearInterval(t); rej(new Error('timeout')); }
    }, 15);
  });
}
const send = (c, o) => c.ws.send(JSON.stringify(o));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** messages에서 가장 최근 STATE 반환. */
function lastState(c) { return [...c.messages].reverse().find((m) => m.type === 'STATE'); }
/** 특정 type 메시지 마지막. */
function lastOf(c, type) { return [...c.messages].reverse().find((m) => m.type === type); }

// ════════════════════════════════════════════════════════════════
// [A] 순수 game.js 불변식
// ════════════════════════════════════════════════════════════════
{
  console.log('\n[A] 순수 game.js 불변식');

  // CN-S-DIST: 키 분배 불변식 (200회 반복)
  let distOk = true;
  let redCounts = { 9: 0, 8: 0 };
  for (let it = 0; it < 200; it++) {
    const g = createGame();
    const c = (v) => g.keyCard.filter((x) => x === v).length;
    const red = c('red'), blue = c('blue'), neu = c('neutral'), ass = c('assassin');
    const first = g.firstTeam;
    const firstCnt = first === 'red' ? red : blue;
    const secondCnt = first === 'red' ? blue : red;
    if (!(firstCnt === 9 && secondCnt === 8 && neu === 7 && ass === 1
          && red + blue + neu + ass === 25 && g.keyCard.length === 25
          && g.words.length === 25 && new Set(g.words).size === 25
          && g.redTotal === red && g.blueTotal === blue
          && g.currentTeam === first && g.turnPhase === 'clue' && g.guessesLeft === 0)) {
      distOk = false; break;
    }
    if (red === 9) redCounts[9]++; else redCounts[8]++;
  }
  assert(distOk, 'CN-S-DIST 키 분배 불변식: 선공9/후공8/중립7/암살1=25, 단어 25 고유, 선공=currentTeam (200회)');

  // CN-S-RAND: 선공 랜덤성 (red 9장 비율이 양극단 아님)
  const ratio = redCounts[9] / 200;
  assert(ratio > 0.25 && ratio < 0.75, `CN-S-RAND 선공 랜덤성 red9 비율=${ratio.toFixed(2)} (0.25~0.75)`);

  // CN-S-MASK(pure): snapshotForPlayer 역할 마스킹
  {
    const g = createGame('red');
    // 카드 3장 강제 공개
    g.revealed[0] = g.keyCard[0];
    g.revealed[1] = g.keyCard[1];
    g.revealed[2] = g.keyCard[2];
    const spy = snapshotForPlayer(g, 'spymaster', 'p1');
    const op = snapshotForPlayer(g, 'operative', 'p2');
    assert(spy.myKey.every((c) => c !== null) && spy.myKey.length === 25,
      'CN-S-005 스파이마스터 snapshot: myKey 전체 비-null');
    assert(JSON.stringify(spy.myKey) === JSON.stringify(g.keyCard),
      'CN-S-005b 스파이마스터 myKey === 실제 keyCard');
    let leak = 0;
    for (let i = 0; i < 25; i++) {
      if (g.revealed[i] === null) { if (op.myKey[i] !== null) leak++; }
      else { if (op.myKey[i] !== g.keyCard[i]) leak++; }
    }
    assert(leak === 0, 'CN-S-006 요원 snapshot: 미공개=null, 공개=실색 (키 누설 0)');
    assert(!('keyCard' in op) && !('keyCard' in spy),
      'CN-S-006b snapshot에 keyCard 원본 필드 미노출');
    // 공개 0장 상태에서 요원 myKey 전부 null
    const g2 = createGame('blue');
    const op2 = snapshotForPlayer(g2, 'operative', 'p2');
    assert(op2.myKey.every((c) => c === null), 'CN-S-006c 공개 0장: 요원 myKey 전부 null (초기 키 누설 0)');
  }

  // CN-S-RESULT: 4결과 + 턴/guessesLeft 처리
  {
    const g = createGame('red'); // red 선공 9장
    const idxOf = (color, skip = 0) => {
      let s = skip;
      for (let i = 0; i < 25; i++) if (g.keyCard[i] === color) { if (s-- <= 0) return i; }
      return -1;
    };
    // clue n=2 → guessesLeft=3
    const clue = giveClue(g, 'red', '테스트', 2);
    assert(clue.ok && g.guessesLeft === 3 && g.turnPhase === 'guess',
      'CN-S-007 giveClue: guessesLeft = number+1 (2+1=3)');
    // correct (red 카드)
    const r1 = guessCard(g, 'red', idxOf('red', 0));
    assert(r1.ok && r1.result === 'correct' && r1.turnEnded === false && g.guessesLeft === 2 && g.currentTeam === 'red',
      'CN-S-RESULT-correct: 자기팀 적중 → guessesLeft 차감, 턴 유지');
    // neutral → 즉시 턴 종료
    const r2 = guessCard(g, 'red', idxOf('neutral', 0));
    assert(r2.ok && r2.result === 'neutral' && r2.turnEnded && g.currentTeam === 'blue' && g.turnPhase === 'clue',
      'CN-S-RESULT-neutral: 중립 → 즉시 턴 종료(상대 clue)');
    // 이제 blue 턴. clue n=1 → guessesLeft=2
    giveClue(g, 'blue', '단서', 1);
    // blue가 red 카드(상대) 적중 → red found+1, 턴 종료
    const redFoundBefore = g.redFound;
    const r3 = guessCard(g, 'blue', idxOf('red', 1));
    assert(r3.ok && r3.result === 'opponent' && r3.turnEnded && g.redFound === redFoundBefore + 1 && g.currentTeam === 'red',
      'CN-S-RESULT-opponent: 상대팀 카드 → 상대 진척+1 + 턴 종료');
    // red 턴. clue n=1 → guessesLeft=2. correct 2번 → 2번째에 guessesLeft 0 → endTurn
    giveClue(g, 'red', '또', 1);
    const a = guessCard(g, 'red', idxOf('red', 2));
    assert(a.ok && a.result === 'correct' && !a.turnEnded && g.guessesLeft === 1, 'CN-S-RESULT-correct2: 1차 유지');
    const b = guessCard(g, 'red', idxOf('red', 3));
    assert(b.ok && b.result === 'correct' && b.turnEnded && g.guessesLeft === 0 && g.currentTeam === 'blue',
      'CN-S-004 guessesLeft 0 소진 → 자동 endTurn');
  }

  // CN-S-ASSASSIN: 암살자 즉시 패배
  {
    const g = createGame('red');
    const ai = g.keyCard.indexOf('assassin');
    giveClue(g, 'red', 'x', 1);
    const r = guessCard(g, 'red', ai);
    assert(r.ok && r.result === 'assassin' && g.gamePhase === 'over' && g.winner === 'blue' && g.winReason === 'assassin',
      'CN-S-009 암살자 → 즉시 패배(상대 승리), gamePhase=over');
  }

  // CN-S-WIN: 자기팀 전체 공개 → 승리 (마지막 한 장 즉시 승리, guessesLeft 차감보다 우선)
  {
    const g = createGame('red'); // red 9장
    const reds = [];
    for (let i = 0; i < 25; i++) if (g.keyCard[i] === 'red') reds.push(i);
    giveClue(g, 'red', 'x', 9); // guessesLeft=10
    let lastRes = null;
    for (let k = 0; k < reds.length; k++) lastRes = guessCard(g, 'red', reds[k]);
    assert(g.gamePhase === 'over' && g.winner === 'red' && g.winReason === 'completed' && lastRes.win === true,
      'CN-S-008 자기팀 전체 공개 → completed 승리');
    // 마지막 한 장 승리 우선: 직전 guessesLeft가 2였고 마지막 정답은 차감 없이 승리
    assert(lastRes.turnEnded && lastRes.win, 'CN-S-WIN-priority: 마지막 카드 승리(win=true)');
  }

  // CN-S-WIN-opp-last: 상대 카드 적중으로 상대가 전체 공개 완료 → 상대 즉시 승리
  {
    const g = createGame('red'); // red 선공 9, blue 8
    // blue 8장 중 7장을 미리 공개시켜 둠 (직접 상태 조작)
    const blues = [];
    for (let i = 0; i < 25; i++) if (g.keyCard[i] === 'blue') blues.push(i);
    for (let k = 0; k < 7; k++) { g.revealed[blues[k]] = 'blue'; g.blueFound++; }
    // red 턴, clue, red가 마지막 blue 카드 적중 → blue 승리
    giveClue(g, 'red', 'x', 1);
    const r = guessCard(g, 'red', blues[7]);
    assert(r.ok && r.result === 'opponent' && r.win === true && g.gamePhase === 'over' && g.winner === 'blue',
      'CN-S-009b 상대 카드로 상대 전체완성 → 상대 즉시 승리');
  }

  // CN-ATK pure: 단서/추측 경계 + 종료후 거부
  {
    const g = createGame('red');
    assert(!giveClue(g, 'blue', 'x', 1).ok, 'CN-ATK-clue-wrongteam: 상대팀 단서 거부');
    assert(!giveClue(g, 'red', '   ', 1).ok, 'CN-ATK-clue-blank: 공백 단서 거부');
    assert(!giveClue(g, 'red', 'x', 0).ok, 'CN-ATK-clue-n0: 숫자 0 거부');
    assert(!giveClue(g, 'red', 'x', 10).ok, 'CN-ATK-clue-n10: 숫자 10 거부');
    assert(!giveClue(g, 'red', 'x', 1.5).ok, 'CN-ATK-clue-nfloat: 비정수 거부');
    // guess는 clue 전이라 거부
    assert(!guessCard(g, 'red', 0).ok, 'CN-ATK-guess-noclue: 단서 전 추측 거부');
    giveClue(g, 'red', 'x', 1);
    assert(!guessCard(g, 'blue', 0).ok, 'CN-ATK-guess-wrongteam: 상대팀 추측 거부');
    assert(!guessCard(g, 'red', -1).ok, 'CN-ATK-guess-neg: 음수 인덱스 거부');
    assert(!guessCard(g, 'red', 25).ok, 'CN-ATK-guess-oob: 범위초과 인덱스 거부');
    // 정상 1회 후 같은 칸 재추측 거부
    const firstRed = g.keyCard.indexOf('red');
    guessCard(g, 'red', firstRed);
    assert(!guessCard(g, 'red', firstRed).ok, 'CN-ATK-guess-dup: 이미 공개 카드 재추측 거부');
    // endTurn 권위
    assert(!endTurnByPass(g, 'blue').ok, 'CN-ATK-pass-wrongteam: 상대팀 패스 거부');
    // 종료 상태 거부
    const g2 = createGame('red');
    giveClue(g2, 'red', 'x', 1);
    guessCard(g2, 'red', g2.keyCard.indexOf('assassin')); // over
    assert(!giveClue(g2, 'red', 'x', 1).ok, 'CN-ATK-over-clue: 종료 후 단서 거부');
    assert(!guessCard(g2, 'red', 0).ok, 'CN-ATK-over-guess: 종료 후 추측 거부');
    assert(!endTurnByPass(g2, 'red').ok, 'CN-ATK-over-pass: 종료 후 패스 거부');
  }
}

// ════════════════════════════════════════════════════════════════
// [B] WS 통합 + [C] 능동 공격
// ════════════════════════════════════════════════════════════════
const app = createApp();
const server = http.createServer(app.handleHttp);
server.on('upgrade', app.handleUpgrade);
await new Promise((res) => server.listen(PORT, '127.0.0.1', res));
console.log(`\n[B/C] WS 통합 — server up on ${PORT}`);

/** 4인 입장 + 역할 배정 + START 까지. 반환: {clients, byRole, firstTeam} */
async function setupGame() {
  const clients = [makeClient(), makeClient(), makeClient(), makeClient()];
  for (const c of clients) await waitOpen(c.ws);
  // JOIN
  clients.forEach((c, i) => send(c, { type: 'JOIN', name: `P${i + 1}` }));
  for (const c of clients) await waitFor(c.messages, (m) => m.type === 'JOINED');
  return clients;
}

let G = null; // { clients, firstTeam, spy, op, oppSpy, oppOp }

// ── CN-S-001~003: role_select ──
{
  console.log('\n[B] role_select 흐름');
  const clients = await setupGame();
  const [p1, p2, p3, p4] = clients;

  await waitFor(p1.messages, (m) => m.type === 'ROLE_STATE');
  assert(true, 'CN-S-001 4인 JOIN → ROLE_STATE 수신');

  // 호스트 = p1 (첫 입장). JOINED.isHost 확인
  const j1 = lastOf(p1, 'JOINED');
  assert(j1.isHost === true, 'CN-S-001b 첫 입장자 p1 = 호스트');

  // canStart 안 된 상태에서 START_GAME → ERROR
  send(p1, { type: 'START_GAME' });
  const e0 = await waitFor(p1.messages, (m) => m.type === 'ERROR', 1500);
  assert(/슬롯/.test(e0.message), 'CN-ATK-start-notfull: 슬롯 미충족 START → ERROR');

  // 역할 배정
  send(p1, { type: 'PICK_ROLE', team: 'red', role: 'spymaster' });
  send(p2, { type: 'PICK_ROLE', team: 'red', role: 'operative' });
  send(p3, { type: 'PICK_ROLE', team: 'blue', role: 'spymaster' });
  await sleep(80);
  // CN-S-002: 중복 (p4가 이미 점유된 red/spymaster 시도) → ERROR
  send(p4, { type: 'PICK_ROLE', team: 'red', role: 'spymaster' });
  const eDup = await waitFor(p4.messages, (m) => m.type === 'ERROR', 1500);
  assert(/이미 선택/.test(eDup.message), 'CN-S-002 중복 (팀,역할) 선택 → ERROR');
  // 잘못된 값
  send(p4, { type: 'PICK_ROLE', team: 'green', role: 'spymaster' });
  const eBad = await waitFor(p4.messages, (m) => m.type === 'ERROR' && /잘못된/.test(m.message), 1500);
  assert(!!eBad, 'CN-ATK-pick-invalid: 잘못된 팀/역할 → ERROR');
  // p4 정상 배정
  send(p4, { type: 'PICK_ROLE', team: 'blue', role: 'operative' });
  const rsFull = await waitFor(p1.messages, (m) => m.type === 'ROLE_STATE' && m.canStart === true, 1500);
  assert(rsFull.canStart === true, 'CN-S-003 4슬롯 충족 → canStart=true');

  // 비호스트 START_GAME 거부
  send(p2, { type: 'START_GAME' });
  const eHost = await waitFor(p2.messages, (m) => m.type === 'ERROR', 1500);
  assert(/호스트/.test(eHost.message), 'CN-ATK-start-nonhost: 비호스트 START → ERROR');

  // 호스트 START_GAME
  send(p1, { type: 'START_GAME' });
  const gs = await waitFor(p1.messages, (m) => m.type === 'GAME_START', 1500);
  assert(!!gs.firstTeam, 'CN-S-004 호스트 START_GAME → GAME_START');
  for (const c of clients) await waitFor(c.messages, (m) => m.type === 'STATE', 1500);

  // 역할 매핑: p1 red/spy, p2 red/op, p3 blue/spy, p4 blue/op
  const firstTeam = gs.firstTeam;
  G = {
    clients, firstTeam,
    spy: firstTeam === 'red' ? p1 : p3,
    op: firstTeam === 'red' ? p2 : p4,
    oppSpy: firstTeam === 'red' ? p3 : p1,
    oppOp: firstTeam === 'red' ? p4 : p2,
    redSpy: p1, redOp: p2, blueSpy: p3, blueOp: p4,
  };
}

// ── CN-S-005/006: 마스킹 (wire) ──
{
  console.log('\n[B] 역할 마스킹 (wire)');
  const spyState = lastState(G.spy);
  const opState = lastState(G.op);
  assert(spyState.myKey.every((c) => c !== null), 'CN-S-005 스파이마스터 STATE.myKey 전체 비-null (wire)');
  assert(opState.myKey.every((c) => c === null), 'CN-S-006 요원 STATE.myKey 전부 null (게임시작 미공개) — 키 누설 0 (wire)');
  assert(!('keyCard' in opState) && !('keyCard' in spyState), 'CN-S-006b wire STATE에 keyCard 원본 미포함');
  // 양 팀 요원 모두 마스킹 확인
  assert(lastState(G.oppOp).myKey.every((c) => c === null), 'CN-S-006c 상대 요원도 마스킹 (wire)');
}

// ── CN-S-007/008 + 권위 공격 (wire) ──
{
  console.log('\n[B/C] CLUE/GUESS + 권위 공격 (wire)');

  // 요원이 CLUE → ERROR (스파이마스터 전용)
  send(G.op, { type: 'CLUE', word: 'x', number: 1 });
  const eOpClue = await waitFor(G.op, (m) => m.type === 'ERROR' && /스파이마스터/.test(m.message), 1500);
  assert(!!eOpClue, 'CN-ATK-clue-byop: 요원 CLUE → ERROR');

  // 상대팀 스파이마스터가 CLUE → ERROR (현재 팀 아님)
  send(G.oppSpy, { type: 'CLUE', word: 'x', number: 1 });
  const eOppClue = await waitFor(G.oppSpy, (m) => m.type === 'ERROR', 1500);
  assert(/차례/.test(eOppClue.message), 'CN-ATK-clue-oppteam: 상대팀 CLUE → ERROR');

  // 스파이마스터가 GUESS → ERROR (요원 전용)
  send(G.spy, { type: 'GUESS', cardIndex: 0 });
  const eSpyGuess = await waitFor(G.spy, (m) => m.type === 'ERROR' && /요원/.test(m.message), 1500);
  assert(!!eSpyGuess, 'CN-ATK-guess-byspy: 스파이마스터 GUESS → ERROR');

  // 요원이 단서 전 GUESS → ERROR
  send(G.op, { type: 'GUESS', cardIndex: 0 });
  const ePreGuess = await waitFor(G.op, (m) => m.type === 'ERROR' && /단서/.test(m.message), 1500);
  assert(!!ePreGuess, 'CN-ATK-guess-preclue: 단서 전 GUESS → ERROR');

  // 단서 빈 단어/범위 밖 숫자 (wire)
  send(G.spy, { type: 'CLUE', word: '   ', number: 1 });
  const eBlank = await waitFor(G.spy, (m) => m.type === 'ERROR' && /비어/.test(m.message), 1500);
  assert(!!eBlank, 'CN-ATK-clue-blank-wire: 빈 단서 → ERROR');
  send(G.spy, { type: 'CLUE', word: 'x', number: 99 });
  const eRange = await waitFor(G.spy, (m) => m.type === 'ERROR' && /1~9/.test(m.message), 1500);
  assert(!!eRange, 'CN-ATK-clue-range-wire: 숫자 범위 밖 → ERROR');

  // 정상 CLUE n=2 → guessesLeft=3
  send(G.spy, { type: 'CLUE', word: '정답', number: 2 });
  const st = await waitFor(G.op, (m) => m.type === 'STATE' && m.turnPhase === 'guess', 1500);
  assert(st.guessesLeft === 3, 'CN-S-007 CLUE n=2 → guessesLeft = 3 (wire)');
  assert(st.currentClue && st.currentClue.word === '정답' && st.currentClue.number === 2,
    'CN-S-007b currentClue 브로드캐스트');

  // 상대팀 요원이 GUESS (현재 내 팀 아님) → ERROR
  send(G.oppOp, { type: 'GUESS', cardIndex: 0 });
  const eOppGuess = await waitFor(G.oppOp, (m) => m.type === 'ERROR' && /차례/.test(m.message), 1500);
  assert(!!eOppGuess, 'CN-ATK-guess-oppteam: 상대팀 요원 GUESS → ERROR');

  // 스파이마스터 STATE에서 실제 키를 읽어 자기팀 카드 1장 추측 → correct, 턴 유지
  const fullKey = lastState(G.spy).myKey;
  const myColorIdx = fullKey.findIndex((c) => c === G.firstTeam);
  const before = lastState(G.op);
  send(G.op, { type: 'GUESS', cardIndex: myColorIdx });
  const after = await waitFor(G.op, (m) => m.type === 'STATE' && m.revealed[myColorIdx] === G.firstTeam, 1500);
  assert(after.revealed[myColorIdx] === G.firstTeam && after.currentTeam === G.firstTeam && after.guessesLeft === 2,
    'CN-S-008 GUESS 자기팀 적중 → revealed 갱신, 턴 유지, guessesLeft 차감 (wire)');
  // 요원 STATE에서 방금 공개된 카드만 색 노출, 나머지 미공개는 여전히 null
  let opLeak = 0;
  for (let i = 0; i < 25; i++) {
    if (after.revealed[i] === null && after.myKey[i] !== null) opLeak++;
  }
  assert(opLeak === 0, 'CN-S-006d GUESS 후에도 요원 미공개 카드 마스킹 유지 (키 누설 0)');

  // CN-S-011: END_TURN → 상대 팀 clue 단계
  send(G.op, { type: 'END_TURN' });
  const passed2 = await waitFor(G.op, (m) => m.type === 'STATE' && m.currentTeam !== G.firstTeam, 1500);
  assert(passed2.currentTeam !== G.firstTeam && passed2.turnPhase === 'clue',
    'CN-S-011 END_TURN → 상대 팀 turnPhase=clue');

  // 상대팀이 아닌 요원이 END_TURN (이제 상대 턴) → 원래 firstTeam 요원이 패스 시도 → ERROR
  send(G.op, { type: 'END_TURN' });
  const ePass = await waitFor(G.op, (m) => m.type === 'ERROR' && /차례/.test(m.message), 1500);
  assert(!!ePass, 'CN-ATK-pass-wrongturn: 상대 턴에 패스 → ERROR');
}

// ── CN-S-009: 암살자 → GAME_OVER (wire) ──
{
  console.log('\n[B] 암살자 GAME_OVER (wire)');
  // 현재 상대팀(secondTeam) 턴, clue 단계. 상대 스파이마스터가 단서 → 상대 요원이 암살자 추측.
  const curTeam = lastState(G.spy).currentTeam;
  const curSpy = curTeam === 'red' ? G.redSpy : G.blueSpy;
  const curOp  = curTeam === 'red' ? G.redOp  : G.blueOp;
  send(curSpy, { type: 'CLUE', word: '위험', number: 1 });
  await waitFor(curOp, (m) => m.type === 'STATE' && m.turnPhase === 'guess', 1500);
  const assassinIdx = lastState(curSpy).myKey.indexOf('assassin');
  send(curOp, { type: 'GUESS', cardIndex: assassinIdx });
  const over = await waitFor(curOp, (m) => m.type === 'GAME_OVER', 1500);
  assert(over.reason === 'assassin' && over.winner === (curTeam === 'red' ? 'blue' : 'red'),
    'CN-S-009 암살자 추측 → GAME_OVER reason=assassin, 상대 승리 (wire)');
  assert(over.review && Array.isArray(over.review.keyCard) && over.review.keyCard.length === 25,
    'CN-S-009b GAME_OVER review 키 전체 공개 포함');

  // 종료 후 CLUE/GUESS는 무시(에러 없이 phase!=playing) — 상태 불변 확인
  const lenBefore = curSpy.messages.length;
  send(curSpy, { type: 'CLUE', word: 'x', number: 1 });
  send(curOp, { type: 'GUESS', cardIndex: 0 });
  await sleep(150);
  const newMsgs = curSpy.messages.slice(lenBefore).filter((m) => m.type === 'STATE' || m.type === 'GAME_START');
  assert(newMsgs.length === 0, 'CN-ATK-over-wire: 종료 후 CLUE/GUESS 무시 (STATE/GAME_START 미발생)');
}

// ── CN-S-012: 리매치 → 선공 교체 (wire) ──
{
  console.log('\n[B] 리매치 선공 교체 (wire)');
  const prevFirst = G.firstTeam;
  // 한쪽 팀만 REMATCH → WAITING
  send(G.redSpy, { type: 'REMATCH' });
  const waiting = await waitFor(G.redSpy, (m) => m.type === 'REMATCH_WAITING', 1500);
  assert(Array.isArray(waiting.readyIds) && waiting.readyIds.length === 1,
    'CN-S-012a 한 팀만 REMATCH → REMATCH_WAITING (재시작 안 함)');
  // 상대팀도 REMATCH → START
  send(G.blueOp, { type: 'REMATCH' });
  const rstart = await waitFor(G.blueOp, (m) => m.type === 'REMATCH_START', 1500);
  assert(rstart.firstTeam !== prevFirst, `CN-S-012 REMATCH 양팀 동의 → 선공 교체 (${prevFirst}→${rstart.firstTeam})`);
  // 새 게임 STATE 도착 + 역할 유지(마스킹 그대로)
  await waitFor(G.redSpy, (m) => m.type === 'STATE', 1500);
  const newSpyState = lastState(G.redSpy);
  const newOpState = lastState(G.redOp);
  assert(newSpyState.myKey.every((c) => c !== null), 'CN-S-012b 리매치 후 스파이마스터 역할 유지(myKey 전체)');
  assert(newOpState.myKey.every((c) => c === null), 'CN-S-012c 리매치 후 요원 역할 유지(myKey 마스킹)');
  assert(newSpyState.currentTeam === rstart.firstTeam, 'CN-S-012d 리매치 선공이 새 currentTeam');

  for (const c of G.clients) c.ws.close();
  await sleep(120);
}

// ── 회귀: 정원 초과 거부 ──
{
  console.log('\n[C] 정원 초과 거부');
  const five = [];
  for (let i = 0; i < 5; i++) { const c = makeClient(); await waitOpen(c.ws); five.push(c); send(c, { type: 'JOIN', name: `Q${i}` }); }
  const rej = await waitFor(five[4], (m) => m.type === 'ERROR' && /가득/.test(m.message), 2000).catch(() => null);
  assert(!!rej, 'CN-ATK-room-full: 5번째 입장 → 방 가득 ERROR');
  for (const c of five) c.ws.close();
  await sleep(120);
}

// ── 종료 ──
server.close();
console.log(`\n총: ${passed + failed}건  PASS: ${passed}  FAIL: ${failed}`);
if (failed > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('ALL PASS');
process.exit(0);
