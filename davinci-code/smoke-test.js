/**
 * @fileoverview 다빈치 코드 플러스 서버 동작 빠른 검증.
 * 두 ws 클라이언트 띄워 입장 → 조커 배치 → STATE 수신 → GUESS 흐름 → 자기 손 정렬 검증.
 */
import { WebSocket } from 'ws';

const URL = 'ws://localhost:3002';

/**
 * 검증 결과 카운터.
 */
let passed = 0;
let failed = 0;
function assert(cond, label) {
  if (cond) { passed++; console.log(`  \u2713 ${label}`); }
  else      { failed++; console.error(`  \u2717 ${label}`); }
}

/**
 * 손 정렬 검증: 숫자 카드만 value 오름차순, 동률 시 red < yellow < blue.
 * 조커는 위치 고정이므로 건너뛴다.
 * @param {Array} hand
 * @returns {boolean}
 */
const COLOR_ORDER = { red: 0, yellow: 1, blue: 2 };
function isSorted(hand) {
  const numerics = hand.filter((c) => !c.isJoker);
  for (let i = 1; i < numerics.length; i++) {
    const a = numerics[i - 1], b = numerics[i];
    if (a.value > b.value) return false;
    if (a.value === b.value && COLOR_ORDER[a.color] > COLOR_ORDER[b.color]) return false;
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

  // 1. JOINED 확인
  const p1Joined = p1States.find((m) => m.type === 'JOINED');
  const p2Joined = p2States.find((m) => m.type === 'JOINED');
  assert(p1Joined && p1Joined.playerId === 'p1', 'p1 JOINED 수신');
  assert(p2Joined && p2Joined.playerId === 'p2', 'p2 JOINED 수신');

  // 2. 초기 STATE - 조커 배치 페이즈
  const p1State = p1States.filter((m) => m.type === 'STATE').pop();
  const p2State = p2States.filter((m) => m.type === 'STATE').pop();
  assert(p1State !== undefined, 'p1 STATE 수신');
  assert(p2State !== undefined, 'p2 STATE 수신');

  assert(p1State.phase === 'awaiting_joker_placement', 'phase=awaiting_joker_placement');
  assert(p1State.yourHand.length === 4, 'p1 자기 손 4장 (숫자만)');
  assert(p2State.yourHand.length === 4, 'p2 자기 손 4장 (숫자만)');
  assert(p1State.yourUnplacedJoker !== null, 'p1 미배치 조커 존재');
  assert(p2State.yourUnplacedJoker !== null, 'p2 미배치 조커 존재');
  assert(p1State.yourUnplacedJoker.isJoker === true, 'p1 미배치 조커 isJoker=true');

  // 3. 자기 손 정렬 검증
  assert(isSorted(p1State.yourHand), 'p1 자기 손 정렬');
  assert(isSorted(p2State.yourHand), 'p2 자기 손 정렬');

  // 4. 덱 카드 수: 39 - 5*2 = 29
  assert(p1State.deckCount === 29, `덱 카드 수 29 (실제 ${p1State.deckCount})`);

  // 5. 조커 배치: p1은 맨 앞(-1), p2는 맨 뒤(3)
  console.log('[smoke] 조커 배치 진행...');
  p1.send(JSON.stringify({ type: 'PLACE_JOKER', insertAfter: -1 }));
  await new Promise((r) => setTimeout(r, 200));

  const p1AfterPlace = p1States.filter((m) => m.type === 'STATE').pop();
  assert(p1AfterPlace.yourHand.length === 5, 'p1 조커 배치 후 손 5장');
  assert(p1AfterPlace.yourHand[0].isJoker === true, 'p1 조커가 맨 앞에 배치됨');
  assert(p1AfterPlace.phase === 'awaiting_joker_placement', '아직 p2 미배치 → phase 유지');

  p2.send(JSON.stringify({ type: 'PLACE_JOKER', insertAfter: 3 }));
  await new Promise((r) => setTimeout(r, 200));

  const p1AfterBothPlace = p1States.filter((m) => m.type === 'STATE').pop();
  assert(p1AfterBothPlace.phase === 'awaiting_guess', '양쪽 배치 완료 → phase=awaiting_guess');
  assert(p1AfterBothPlace.pendingDrawn !== null, '자동 1장 뽑기 완료');

  // 6. 상대 미공개 카드 value 누출 검증
  const oppLeak = p1AfterBothPlace.oppHand.some((c) => !c.revealed && c.value !== null);
  assert(!oppLeak, '상대 미공개 카드 value 누출 없음');

  // 7. 상대 카드에 isJoker 필드 존재 확인
  const hasJokerField = p1AfterBothPlace.oppHand.every((c) => typeof c.isJoker === 'boolean');
  assert(hasJokerField, '상대 카드에 isJoker 필드 존재');

  // 8. p1 자기가 뽑은 카드 숫자/조커 여부 보임
  if (p1AfterBothPlace.pendingDrawn.isJoker) {
    assert(p1AfterBothPlace.pendingDrawn.value === null, 'p1: pendingDrawn 조커 (value=null)');
  } else {
    assert(typeof p1AfterBothPlace.pendingDrawn.value === 'number', 'p1: pendingDrawn 숫자 보임');
  }

  // 9. p1이 의도적으로 추측 (slot 0, value 0)
  console.log('[smoke] p1 추측 (slot=0, value=0)...');
  p1.send(JSON.stringify({ type: 'GUESS', slot: 0, value: 0 }));
  await new Promise((r) => setTimeout(r, 200));

  const p1StateAfter = p1States.filter((m) => m.type === 'STATE').pop();
  assert(p1StateAfter.lastGuess && p1StateAfter.lastGuess.from === 'p1', 'lastGuess.from === p1');
  assert(p1StateAfter.lastGuess.slot === 0, 'lastGuess.slot === 0');
  assert(p1StateAfter.lastGuess.value === 0, 'lastGuess.value === 0');

  if (p1StateAfter.lastGuess.correct) {
    console.log('  (우연히 정답이었다 → awaiting_continue_decision 검증)');
    assert(p1StateAfter.phase === 'awaiting_continue_decision', 'phase=awaiting_continue_decision');
    p1.send(JSON.stringify({ type: 'CONTINUE', decision: 'stop' }));
    await new Promise((r) => setTimeout(r, 150));
    const s = p1States.filter((m) => m.type === 'STATE').pop();
    assert(s.turn === 'p2', 'stop 후 turn=p2');
  } else {
    console.log('  (오답 → 뽑은 카드 공개되어 손에 추가, 턴 p2)');
    assert(p1StateAfter.turn === 'p2', '오답 후 turn=p2');
    assert(p1StateAfter.yourHand.length === 6, '오답 후 p1 손 +1 (5→6)');
    const revealedAdded = p1StateAfter.yourHand.filter((c) => c.revealed).length;
    assert(revealedAdded >= 1, '오답으로 공개된 카드가 자기 손에 들어감');
  }

  // 10. 조커 추측 테스트 — p2 턴일 때 조커 추측 전송
  if (p1StateAfter.turn === 'p2') {
    console.log('[smoke] p2 조커 추측 (slot=0, value=null)...');
    p2.send(JSON.stringify({ type: 'GUESS', slot: 0, value: null }));
    await new Promise((r) => setTimeout(r, 200));
    const p2StateAfterJoker = p2States.filter((m) => m.type === 'STATE').pop();
    assert(p2StateAfterJoker.lastGuess && p2StateAfterJoker.lastGuess.value === null, '조커 추측 value=null 기록됨');
    assert(typeof p2StateAfterJoker.lastGuess.correct === 'boolean', '조커 추측 정답/오답 판정 완료');
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
