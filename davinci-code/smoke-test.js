/**
 * @fileoverview 다빈치 코드 서버 동작 빠른 검증.
 * 두 ws 클라이언트 띄워 입장 → STATE 수신 → GUESS 흐름 → 자기 손 정렬 검증.
 */
import { WebSocket } from 'ws';

const URL = 'ws://localhost:3002';

/**
 * 검증 결과 카운터.
 */
let passed = 0;
let failed = 0;
function assert(cond, label) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.error(`  ✗ ${label}`); }
}

/**
 * 손 정렬 검증: value 오름차순, 동률 시 black 먼저.
 * @param {Array} hand
 * @returns {boolean}
 */
function isSorted(hand) {
  for (let i = 1; i < hand.length; i++) {
    const a = hand[i - 1], b = hand[i];
    if (a.value > b.value) return false;
    if (a.value === b.value && a.color === 'white' && b.color === 'black') return false;
  }
  return true;
}

async function run() {
  console.log('[smoke] 두 클라이언트 접속 중...');
  const p1 = new WebSocket(URL);
  const p2 = new WebSocket(URL);

  const p1States = [];
  const p2States = [];
  p1.on('message', (data) => p1States.push(JSON.parse(data.toString())));
  p2.on('message', (data) => p2States.push(JSON.parse(data.toString())));

  await Promise.all([
    new Promise((res) => p1.once('open', res)),
    new Promise((res) => p2.once('open', res)),
  ]);

  // 두 명 모두 입장 + 게임 시작까지 대기
  await new Promise((r) => setTimeout(r, 400));

  console.log('  [debug] p1States types:', p1States.map((m) => m.type).join(','));
  console.log('  [debug] p2States types:', p2States.map((m) => m.type).join(','));
  if (p1States.find((m) => m.type === 'STATE')) {
    const s = p1States.filter((m) => m.type === 'STATE').pop();
    console.log('  [debug] p1 STATE.pendingDrawn:', JSON.stringify(s.pendingDrawn));
    console.log('  [debug] p1 STATE.turn:', s.turn, 'phase:', s.phase, 'deckCount:', s.deckCount);
  }

  // 1. JOINED + GAME_START + 초기 STATE 모두 도착했나
  const p1Joined = p1States.find((m) => m.type === 'JOINED');
  const p2Joined = p2States.find((m) => m.type === 'JOINED');
  assert(p1Joined && p1Joined.playerId === 'p1', 'p1 JOINED 수신');
  assert(p2Joined && p2Joined.playerId === 'p2', 'p2 JOINED 수신');

  const p1State = p1States.filter((m) => m.type === 'STATE').pop();
  const p2State = p2States.filter((m) => m.type === 'STATE').pop();
  assert(p1State !== undefined, 'p1 STATE 수신');
  assert(p2State !== undefined, 'p2 STATE 수신');

  // 2. 손패 크기 4 + pendingDrawn (p1 자기 턴이라 자기는 숫자 봄)
  assert(p1State.yourHand.length === 4, 'p1 자기 손 4장');
  assert(p2State.yourHand.length === 4, 'p2 자기 손 4장');
  assert(p1State.oppHand.length === 4, 'p1이 본 상대 손 4장');
  assert(p2State.oppHand.length === 4, 'p2이 본 상대 손 4장');

  // 3. p1 자기 손이 정렬되어 있나
  assert(isSorted(p1State.yourHand), 'p1 자기 손 정렬');
  assert(isSorted(p2State.yourHand), 'p2 자기 손 정렬');

  // 4. 덱: 24 - 4 - 4 - 1(p1이 자동 뽑음) = 15
  assert(p1State.deckCount === 15, `덱 카드 수 15 (실제 ${p1State.deckCount})`);

  // 5. 상대 미공개 카드의 value는 null이어야 함 (누출 검증)
  const oppLeak = p1State.oppHand.some((c) => !c.revealed && c.value !== null);
  assert(!oppLeak, '상대 미공개 카드 value 누출 없음');

  // 6. p1이 뽑은 카드는 p1에겐 숫자 보임, p2에겐 색깔만
  assert(p1State.pendingDrawn && typeof p1State.pendingDrawn.value === 'number',
    'p1: pendingDrawn 숫자 보임');
  assert(p2State.pendingDrawn && p2State.pendingDrawn.value === null,
    'p2: pendingDrawn 숫자 가려짐');

  // 7. turn=p1
  assert(p1State.turn === 'p1', `turn=p1 (실제 ${p1State.turn})`);

  // 8. p1이 의도적으로 틀린 추측 → pending 카드 공개, 턴 넘김
  console.log('[smoke] p1 의도적 오답 (slot 0에 value 99 시도)');
  // value 99는 범위 밖이라 server가 에러 응답. 0~11 안에서 틀릴 가능성이 높은 값으로 변경.
  // p1이 본 상대 카드는 미공개. 0~11 중 하나 임의 추측.
  // 정답 가능성도 있으니 여러 번 시도하지 말고 일단 한 번 보내고 결과만 확인.
  p1.send(JSON.stringify({ type: 'GUESS', slot: 0, value: 0 }));
  await new Promise((r) => setTimeout(r, 200));

  const p1StateAfter = p1States.filter((m) => m.type === 'STATE').pop();
  const p2StateAfter = p2States.filter((m) => m.type === 'STATE').pop();
  assert(p1StateAfter.lastGuess && p1StateAfter.lastGuess.from === 'p1',
    'lastGuess.from === p1');
  assert(p1StateAfter.lastGuess.slot === 0, 'lastGuess.slot === 0');
  assert(p1StateAfter.lastGuess.value === 0, 'lastGuess.value === 0');

  // 정답 여부에 따라 분기 검증
  if (p1StateAfter.lastGuess.correct) {
    console.log('  (우연히 정답이었다 → awaiting_continue_decision 검증)');
    assert(p1StateAfter.phase === 'awaiting_continue_decision', 'phase=awaiting_continue_decision');
    // 멈춤 보내고 턴 넘김 검증
    p1.send(JSON.stringify({ type: 'CONTINUE', decision: 'stop' }));
    await new Promise((r) => setTimeout(r, 150));
    const s = p1States.filter((m) => m.type === 'STATE').pop();
    assert(s.turn === 'p2', 'stop 후 turn=p2');
    assert(s.yourHand.length === 5, 'stop 후 p1 손 +1');
  } else {
    console.log('  (오답 → 뽑은 카드 공개되어 손에 추가, 턴 p2)');
    assert(p1StateAfter.turn === 'p2', '오답 후 turn=p2');
    assert(p1StateAfter.yourHand.length === 5, '오답 후 p1 손 +1');
    const revealedAdded = p1StateAfter.yourHand.filter((c) => c.revealed).length;
    assert(revealedAdded >= 1, '오답으로 공개된 카드가 자기 손에 들어감');
  }

  // 정리
  p1.close();
  p2.close();
  await new Promise((r) => setTimeout(r, 100));

  console.log(`\n[smoke] 결과: ${passed} PASS / ${failed} FAIL`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((e) => {
  console.error('[smoke] 예외:', e);
  process.exit(1);
});
